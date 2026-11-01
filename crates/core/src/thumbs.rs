//! Ảnh hiển thị cho một Media Item: Thumbnail Zalo có sẵn, ảnh gốc, hoặc JPEG XL giải mã + thu nhỏ (cache ra đĩa).

use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use image::DynamicImage;
use image::codecs::jpeg::JpegEncoder;
use jxl_oxide::integration::JxlDecoder;
use rusqlite::{OptionalExtension, params};

use crate::db::Db;
use crate::error::{Error, Result};

/// Cạnh dài nhất của thumbnail, px.
pub const THUMB_SIZE: u32 = 320;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbSource {
    pub file: PathBuf,
    pub content_type: &'static str,
}

/// Định dạng WebView hiển thị được trực tiếp.
fn browser_image(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn abs_of(root: &str, rel: &str) -> PathBuf {
    rel.split('/')
        .fold(PathBuf::from(root), |p, part| p.join(part))
}

/// Tìm ảnh để hiển thị cho một Media Item:
/// 1. Thumbnail Zalo tạo sẵn trong resource/<convId>/Cache/, cùng Message Time với Link trong resource/ (ưu tiên `_t`, nhỏ hơn).
/// 2. Chính file gốc nếu WebView hiển thị được (jpg/png/…; JPEG XL thì không).
pub fn find_thumbnail(db: &Db, item_id: i64) -> Result<Option<ThumbSource>> {
    let Some((root_id, kind, category, root_path)) = db
        .query_row(
            "SELECT i.root_id, i.kind, i.category, r.path FROM items i JOIN roots r ON r.id = i.root_id WHERE i.id = ?",
            [item_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
        )
        .optional()?
    else {
        return Ok(None);
    };

    let links: Vec<String> = {
        let mut q = db.prepare("SELECT rel_path FROM links WHERE item_id = ? ORDER BY rel_path")?;
        q.query_map([item_id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?
    };

    // Khoảng ['<dir>/<ts>_', '<dir>/<ts>`') — dùng được index (ký tự '`' đứng ngay sau '_')
    let mut q_cache = db.prepare(
        "SELECT l.rel_path, i.kind FROM links l JOIN items i ON i.id = l.item_id
         WHERE l.root_id = ? AND l.rel_path >= ? AND l.rel_path < ? AND i.status = 'present'",
    )?;
    for rel in &links {
        // resource/<convId>/<area>/<msgTs>_<uidNgườiGửi>_<convId>_...
        //   →  resource/<convId>/Cache/<msgTs>_<uidTàiKhoản>_<convId>_t | _n
        let parts: Vec<&str> = rel.split('/').collect();
        let [first, conv, _, name] = parts[..] else {
            continue;
        };
        if first != "resource" || name.len() < 14 || name.as_bytes()[13] != b'_' {
            continue;
        }
        let ts = &name[..13];
        if !ts.bytes().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let dir = format!("resource/{conv}/Cache");
        let hits: Vec<(String, String)> = q_cache
            .query_map(
                params![root_id, format!("{dir}/{ts}_"), format!("{dir}/{ts}`")],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?
            .collect::<rusqlite::Result<_>>()?;
        for suffix in ["t", "n"] {
            let tail = format!("_{conv}_{suffix}");
            if let Some((path, kind)) = hits.iter().find(|(p, _)| p.ends_with(&tail))
                && let Some(ct) = browser_image(kind)
            {
                return Ok(Some(ThumbSource {
                    file: abs_of(&root_path, path),
                    content_type: ct,
                }));
            }
        }
    }

    if category == "image"
        && let (Some(ct), Some(first)) = (browser_image(&kind), links.first())
    {
        return Ok(Some(ThumbSource {
            file: abs_of(&root_path, first),
            content_type: ct,
        }));
    }
    Ok(None)
}

/// Thumbnail JXL đang được giải mã, theo file cache → nhiều request cùng ảnh chỉ giải mã một lần.
static RENDERING: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(Default::default);

/// Như [`find_thumbnail`], nhưng ảnh JPEG XL được giải mã và thu nhỏ thành JPEG, lưu vào `cache_dir` để lần sau dùng lại.
/// Chạy đồng bộ, nặng CPU: gọi từ luồng nền.
pub fn render_thumbnail(db: &Db, item_id: i64, cache_dir: &Path) -> Result<Option<ThumbSource>> {
    if let Some(direct) = find_thumbnail(db, item_id)? {
        return Ok(Some(direct));
    }
    let Some((kind, size, mtime, src)) = db
        .query_row(
            "SELECT i.kind, i.size, i.mtime_ms, r.path, (SELECT rel_path FROM links WHERE item_id = i.id LIMIT 1)
             FROM items i JOIN roots r ON r.id = i.root_id WHERE i.id = ? AND i.category = 'image'",
            [item_id],
            |r| {
                let root: String = r.get(3)?;
                let rel: Option<String> = r.get(4)?;
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, rel.map(|rel| abs_of(&root, &rel))))
            },
        )
        .optional()?
    else {
        return Ok(None);
    };
    let Some(src) = src.filter(|_| kind == "jxl") else {
        return Ok(None);
    };

    let cached = cache_dir.join(format!("{item_id}-{size}-{mtime}.jpg"));
    let lock = RENDERING
        .lock()
        .unwrap()
        .entry(cached.clone())
        .or_default()
        .clone();
    {
        let _guard = lock.lock().unwrap();
        if !cached.exists() {
            let jpg = jxl_to_jpeg(&src, THUMB_SIZE)?;
            fs::create_dir_all(cache_dir)?;
            let tmp = cached.with_extension("tmp");
            fs::write(&tmp, jpg)?;
            fs::rename(&tmp, &cached)?;
        }
    }
    RENDERING.lock().unwrap().remove(&cached);
    Ok(Some(ThumbSource {
        file: cached,
        content_type: "image/jpeg",
    }))
}

/// Giải mã JPEG XL, thu nhỏ để cạnh dài nhất ≤ `size`, mã hoá JPEG chất lượng 75.
pub fn jxl_to_jpeg(src: &Path, size: u32) -> Result<Vec<u8>> {
    let img_err = |e: image::ImageError| Error::Msg(format!("Không giải mã được ảnh: {e}"));
    let decoder = JxlDecoder::new(BufReader::new(fs::File::open(src)?)).map_err(img_err)?;
    let img = DynamicImage::from_decoder(decoder).map_err(img_err)?;
    let small = if img.width().max(img.height()) > size {
        img.thumbnail(size, size)
    } else {
        img
    };
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 75)
        .encode_image(&small.to_rgb8())
        .map_err(img_err)?;
    Ok(out)
}
