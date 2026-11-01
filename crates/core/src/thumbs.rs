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

/// Ảnh JXL đang được giải mã, theo file cache → nhiều request cùng ảnh chỉ giải mã một lần.
static RENDERING: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(Default::default);

/// Cạnh dài nhất khi xem ảnh lớn, px.
pub const VIEW_SIZE: u32 = 1600;

/// Thông tin một Media Item cần để hiển thị / mở.
struct ItemFile {
    kind: String,
    category: String,
    area: String,
    size: i64,
    mtime: i64,
    /// Link đầu tiên (đường dẫn tuyệt đối).
    src: Option<PathBuf>,
}

fn item_file(db: &Db, item_id: i64) -> Result<Option<ItemFile>> {
    Ok(db
        .query_row(
            "SELECT i.kind, i.category, i.area, i.size, i.mtime_ms, r.path,
               (SELECT rel_path FROM links WHERE item_id = i.id ORDER BY rel_path LIKE 'resource/%', rel_path LIMIT 1)
             FROM items i JOIN roots r ON r.id = i.root_id WHERE i.id = ? AND i.status = 'present'",
            [item_id],
            |r| {
                let root: String = r.get(5)?;
                let rel: Option<String> = r.get(6)?;
                Ok(ItemFile {
                    kind: r.get(0)?,
                    category: r.get(1)?,
                    area: r.get(2)?,
                    size: r.get(3)?,
                    mtime: r.get(4)?,
                    src: rel.map(|rel| abs_of(&root, &rel)),
                })
            },
        )
        .optional()?)
}

/// Giải mã JXL thành JPEG cạnh dài ≤ `size`, lưu `cache_dir/<name>`; đã có thì dùng lại.
fn jxl_cached(
    src: &Path,
    cache_dir: &Path,
    name: String,
    size: u32,
    quality: u8,
) -> Result<ThumbSource> {
    let cached = cache_dir.join(name);
    let lock = RENDERING
        .lock()
        .unwrap()
        .entry(cached.clone())
        .or_default()
        .clone();
    {
        let _guard = lock.lock().unwrap();
        if !cached.exists() {
            let jpg = jxl_to_jpeg(src, size, quality)?;
            fs::create_dir_all(cache_dir)?;
            let tmp = cached.with_extension("tmp");
            fs::write(&tmp, jpg)?;
            fs::rename(&tmp, &cached)?;
        }
    }
    RENDERING.lock().unwrap().remove(&cached);
    Ok(ThumbSource {
        file: cached,
        content_type: "image/jpeg",
    })
}

/// Như [`find_thumbnail`], nhưng ảnh JPEG XL được giải mã và thu nhỏ thành JPEG, lưu vào `cache_dir` để lần sau dùng lại.
/// Chạy đồng bộ, nặng CPU: gọi từ luồng nền.
pub fn render_thumbnail(db: &Db, item_id: i64, cache_dir: &Path) -> Result<Option<ThumbSource>> {
    if let Some(direct) = find_thumbnail(db, item_id)? {
        return Ok(Some(direct));
    }
    let Some(f) = item_file(db, item_id)? else {
        return Ok(None);
    };
    match (&f.src, f.category.as_str(), f.kind.as_str()) {
        (Some(src), "image", "jxl") => Ok(Some(jxl_cached(
            src,
            cache_dir,
            format!("{item_id}-{}-{}.jpg", f.size, f.mtime),
            THUMB_SIZE,
            75,
        )?)),
        _ => Ok(None),
    }
}

/// Ảnh cỡ lớn để xem: chính file gốc nếu WebView hiển thị được, JPEG XL thì giải mã (≤ [`VIEW_SIZE`]).
/// Không dùng Thumbnail của Zalo (quá nhỏ).
pub fn render_view(db: &Db, item_id: i64, cache_dir: &Path) -> Result<Option<ThumbSource>> {
    let Some(f) = item_file(db, item_id)? else {
        return Ok(None);
    };
    let Some(src) = f.src.filter(|_| f.category == "image") else {
        return Ok(None);
    };
    if let Some(ct) = browser_image(&f.kind) {
        return Ok(Some(ThumbSource {
            file: src,
            content_type: ct,
        }));
    }
    if f.kind == "jxl" {
        let name = format!("{item_id}-{}-{}-view.jpg", f.size, f.mtime);
        return Ok(Some(jxl_cached(&src, cache_dir, name, VIEW_SIZE, 85)?));
    }
    Ok(None)
}

/// Tạo một bản của Media Item, có đúng đuôi file, trong `out_dir` để mở bằng ứng dụng mặc định của Windows.
/// File trong fileNoise/ được giải XOR; file khác được chép (file của Zalo thường không có đuôi).
/// Không bao giờ trả về chính file trong Media Store: ứng dụng khác không được sửa / khoá file của Zalo.
pub fn materialize(db: &Db, item_id: i64, out_dir: &Path) -> Result<PathBuf> {
    use std::io::{Read, Write};
    let f = item_file(db, item_id)?.ok_or_else(|| Error::Msg("Không tìm thấy file".into()))?;
    if matches!(f.category.as_str(), "database" | "other") || f.kind.is_empty() {
        return Err(Error::Msg("Không mở được loại file này".into()));
    }
    let src = f
        .src
        .ok_or_else(|| Error::Msg("File không còn trên đĩa".into()))?;
    // Đuôi lấy từ loại đã nhận diện; "ole" là Office đời cũ (doc/xls/ppt) — Windows tự chọn ứng dụng theo .doc
    let ext = match f.kind.as_str() {
        "ole" => "doc",
        "office" => "docx",
        k => k,
    };
    fs::create_dir_all(out_dir)?;
    // Có tên tìm được (bản đã lưu / tiêu đề) → mở bằng đúng tên đó; mỗi file một thư mục con để tên không đụng nhau
    let name: Option<String> = db
        .query_row(
            "SELECT name FROM doc_names WHERE item_id = ?",
            [item_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let file_name = match name
        .as_deref()
        .map(safe_file_name)
        .filter(|n| !n.is_empty())
    {
        Some(n) if n.to_lowercase().ends_with(&format!(".{ext}")) => n,
        Some(n) => format!("{n}.{ext}"),
        None => format!("{item_id}.{ext}"),
    };
    let out_dir = out_dir.join(item_id.to_string());
    fs::create_dir_all(&out_dir)?;
    let out = out_dir.join(file_name);
    let tmp = out.with_extension("part");
    {
        use crate::detect::{NOISE_TRAILER, unnoise_prefix};
        let noise = f.area == "fileNoise";
        let file = fs::File::open(&src)?;
        let len = file.metadata()?.len();
        // fileNoise/: bỏ đuôi Zalo gắn thêm (nếu có) để tài liệu nguyên vẹn như lúc gửi
        let keep = if noise && ends_with(&src, len, NOISE_TRAILER)? {
            len - NOISE_TRAILER.len() as u64
        } else {
            len
        };
        let mut r = BufReader::new(file).take(keep);
        let mut w = std::io::BufWriter::new(fs::File::create(&tmp)?);
        let mut buf = vec![0u8; 1 << 20];
        let mut offset = 0usize;
        loop {
            let n = r.read(&mut buf)?;
            if n == 0 {
                break;
            }
            if noise {
                unnoise_prefix(&mut buf[..n], offset); // chỉ 100 byte đầu bị XOR
            }
            offset += n;
            w.write_all(&buf[..n])?;
        }
        w.flush()?;
    }
    // Bản cũ đang mở trong ứng dụng khác thì không thay được — dùng luôn bản cũ (cùng nội dung)
    match fs::rename(&tmp, &out) {
        Ok(()) => {}
        Err(_) if out.exists() => {
            let _ = fs::remove_file(&tmp);
        }
        Err(e) => return Err(e.into()),
    }
    Ok(out)
}

/// File (dài `len`) có kết thúc bằng `suffix` không.
fn ends_with(path: &Path, len: u64, suffix: &[u8]) -> Result<bool> {
    use std::io::{Read, Seek, SeekFrom};
    if len < suffix.len() as u64 {
        return Ok(false);
    }
    let mut f = fs::File::open(path)?;
    f.seek(SeekFrom::Start(len - suffix.len() as u64))?;
    let mut tail = vec![0u8; suffix.len()];
    f.read_exact(&mut tail)?;
    Ok(tail == suffix)
}

/// Giải mã JPEG XL, thu nhỏ để cạnh dài nhất ≤ `size`, mã hoá JPEG chất lượng `quality`.
pub fn jxl_to_jpeg(src: &Path, size: u32, quality: u8) -> Result<Vec<u8>> {
    let img_err = |e: image::ImageError| Error::Msg(format!("Không giải mã được ảnh: {e}"));
    let decoder = JxlDecoder::new(BufReader::new(fs::File::open(src)?)).map_err(img_err)?;
    let img = DynamicImage::from_decoder(decoder).map_err(img_err)?;
    let small = if img.width().max(img.height()) > size {
        img.thumbnail(size, size)
    } else {
        img
    };
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&small.to_rgb8())
        .map_err(img_err)?;
    Ok(out)
}

/// Tên file hợp lệ trên Windows: bỏ ký tự cấm, dấu chấm / khoảng trắng ở cuối, giới hạn độ dài.
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    cleaned
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(120)
        .collect()
}
