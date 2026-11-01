//! Sao lưu thùng rác ra file ZIP (để tải lên Drive…) và nhập lại từ ZIP.
//!
//! ZIP gồm `manifest.json` (mọi Link của từng Media Item, theo đường dẫn tương đối trong Media Store) và
//! `files/<itemId>` (nội dung file, y như trên đĩa — file fileNoise/ vẫn ở dạng Zalo lưu).
//! Nhập lại = đặt file về đúng mọi Link, như Restore; chỉ nhập vào đúng Account đã sao lưu.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::{Db, get_root, now_ms};
use crate::error::{Error, Result};
use crate::layout::account_uid;
use crate::quarantine::{JobOptions, StoredLink, assert_zalo_closed, restore_links};

const FORMAT: &str = "zola-cleaner-backup";
const VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: u32,
    created_at: i64,
    /// uid của Account đã sao lưu — chỉ nhập lại vào đúng Account này.
    account_uid: Option<String>,
    job_ids: Vec<i64>,
    items: Vec<ManifestItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestItem {
    item_id: i64,
    size: i64,
    category: String,
    kind: String,
    msg_ts: Option<i64>,
    links: Vec<StoredLink>,
    /// Tên mục trong ZIP.
    file: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResult {
    /// Số file đã nén / đã nhập lại.
    pub files: i64,
    pub bytes: i64,
    /// File bỏ qua (nhập lại: đã có sẵn đúng nội dung).
    pub skipped: i64,
    pub failed: i64,
}

/// Nén mọi file đang nằm trong thùng rác của các job `job_ids` vào `out_zip`.
/// `progress(byte đã xong, tổng byte)`.
pub fn export_jobs(
    db: &Db,
    job_ids: &[i64],
    out_zip: &Path,
    progress: &dyn Fn(u64, u64),
) -> Result<ArchiveResult> {
    struct Row {
        root_id: i64,
        item: ManifestItem,
        src: PathBuf,
    }
    let mut rows = Vec::new();
    let mut q = db.prepare(
        "SELECT ji.job_id, j.root_id, ji.item_id, ji.size, i.category, i.kind, i.msg_ts, ji.links_json, ji.quarantine_path
         FROM job_items ji JOIN jobs j ON j.id = ji.job_id JOIN items i ON i.id = ji.item_id
         WHERE ji.job_id = ? AND ji.state = 'moved' AND j.status IN ('quarantined', 'failed')",
    )?;
    for &job_id in job_ids {
        let found = q.query_map([job_id], |r| {
            let item_id: i64 = r.get(2)?;
            let links: String = r.get(7)?;
            Ok(Row {
                root_id: r.get(1)?,
                item: ManifestItem {
                    item_id,
                    size: r.get(3)?,
                    category: r.get(4)?,
                    kind: r.get(5)?,
                    msg_ts: r.get(6)?,
                    links: serde_json::from_str(&links).unwrap_or_default(),
                    file: format!("files/{item_id}"),
                },
                src: PathBuf::from(r.get::<_, String>(8)?),
            })
        })?;
        for row in found {
            rows.push(row?);
        }
    }
    if rows.is_empty() {
        return Err(Error::Msg("Thùng rác không còn file nào để nén".into()));
    }
    let root_ids: std::collections::BTreeSet<i64> = rows.iter().map(|r| r.root_id).collect();
    if root_ids.len() > 1 {
        return Err(Error::Msg(
            "Chỉ nén được các lần dọn của cùng một tài khoản".into(),
        ));
    }
    let root = get_root(db, rows[0].root_id)?
        .ok_or_else(|| Error::Msg("Không tìm thấy Media Store".into()))?;
    let total: u64 = rows.iter().map(|r| r.item.size as u64).sum();

    let tmp = out_zip.with_extension("zip.part");
    let mut zip = ZipWriter::new(BufWriter::new(File::create(&tmp)?));
    let mut done = 0u64;
    let mut result = ArchiveResult::default();
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        // Ảnh / video đã nén sẵn → lưu nguyên (nhanh); tài liệu thì nén thêm
        let method = if matches!(
            row.item.category.as_str(),
            "image" | "video" | "audio" | "archive"
        ) {
            CompressionMethod::Stored
        } else {
            CompressionMethod::Deflated
        };
        let opts = SimpleFileOptions::default()
            .compression_method(method)
            .large_file(row.item.size > 0xffff_0000);
        let mut src = match File::open(&row.src) {
            Ok(f) => BufReader::new(f),
            Err(_) => {
                result.failed += 1; // mất file trong thùng rác — ghi nhận, nén tiếp
                continue;
            }
        };
        zip.start_file(row.item.file.as_str(), opts)
            .map_err(zip_err)?;
        io::copy(&mut src, &mut zip)?;
        done += row.item.size as u64;
        progress(done, total);
        result.files += 1;
        result.bytes += row.item.size;
        items.push(row.item);
    }

    let manifest = Manifest {
        format: FORMAT.into(),
        version: VERSION,
        created_at: now_ms(),
        account_uid: account_uid(Path::new(&root.path)),
        job_ids: job_ids.to_vec(),
        items,
    };
    zip.start_file(
        MANIFEST,
        SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
    )
    .map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| Error::Msg(e.to_string()))?)?;
    zip.finish().map_err(zip_err)?.flush()?;
    fs::rename(&tmp, out_zip)?;

    let path = out_zip.to_string_lossy();
    for id in job_ids {
        db.execute(
            "UPDATE jobs SET archive_path = ? WHERE id = ?",
            params![path, id],
        )?;
    }
    Ok(result)
}

fn zip_err(e: zip::result::ZipError) -> Error {
    Error::Msg(format!("Lỗi file ZIP: {e}"))
}

/// Đường dẫn tương đối an toàn (không `..`, không tuyệt đối) — chống ZIP độc hại ghi ra ngoài Media Store.
fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains('\\')
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// Nhập lại một bản sao lưu vào Media Store `root_id`. Cần thoát Zalo. Sau đó nên quét lại.
/// `work_dir`: thư mục tạm cùng ổ với Media Store (giải nén vào đó rồi rename về chỗ cũ).
pub fn import_backup(
    db: &Db,
    root_id: i64,
    zip_path: &Path,
    work_dir: &Path,
    opts: &JobOptions,
    progress: &dyn Fn(u64, u64),
) -> Result<ArchiveResult> {
    assert_zalo_closed(opts)?;
    let root =
        get_root(db, root_id)?.ok_or_else(|| Error::Msg("Không tìm thấy Media Store".into()))?;
    let root_path = PathBuf::from(&root.path);

    let mut zip = ZipArchive::new(BufReader::new(File::open(zip_path)?)).map_err(zip_err)?;
    let manifest: Manifest = {
        let mut s = String::new();
        zip.by_name(MANIFEST)
            .map_err(|_| Error::Msg("File này không phải bản sao lưu của Zola Cleaner".into()))?
            .read_to_string(&mut s)?;
        serde_json::from_str(&s)
            .map_err(|_| Error::Msg("Bản kê trong file sao lưu bị hỏng".into()))?
    };
    if manifest.format != FORMAT || manifest.version > VERSION {
        return Err(Error::Msg(
            "File này không phải bản sao lưu của Zola Cleaner (hoặc của bản mới hơn)".into(),
        ));
    }
    let here = account_uid(&root_path);
    if manifest.account_uid.is_some() && here.is_some() && manifest.account_uid != here {
        return Err(Error::Msg(
            "Bản sao lưu thuộc tài khoản Zalo khác, không nhập vào tài khoản này được".into(),
        ));
    }
    if manifest
        .items
        .iter()
        .any(|it| it.links.is_empty() || !it.links.iter().all(|l| safe_rel(&l.rel_path)))
    {
        return Err(Error::Msg(
            "Bản kê có đường dẫn không hợp lệ — từ chối nhập".into(),
        ));
    }

    fs::create_dir_all(work_dir)?;
    let total: u64 = manifest.items.iter().map(|i| i.size as u64).sum();
    let mut done = 0u64;
    let mut result = ArchiveResult::default();
    for it in &manifest.items {
        let primary = crate::quarantine::abs_of(&root_path, &it.links[0].rel_path);
        let tmp = work_dir.join(format!("{}.part", it.item_id));
        let extracted = (|| -> Result<()> {
            let mut entry = zip.by_name(&it.file).map_err(zip_err)?;
            let mut out = BufWriter::new(File::create(&tmp)?);
            io::copy(&mut entry, &mut out)?;
            out.flush()?;
            Ok(())
        })();
        let outcome = extracted.and_then(|()| {
            // Đã có sẵn đúng nội dung ở mọi Link → không cần làm gì
            if primary.exists() && crate::fsx::same_content(&primary, &tmp)? {
                let all_linked = it.links[1..].iter().all(|l| {
                    let p = crate::quarantine::abs_of(&root_path, &l.rel_path);
                    p.exists() && crate::fsx::same_file(&primary, &p).unwrap_or(false)
                });
                if all_linked {
                    return Ok(false);
                }
            }
            restore_links(&root_path, &it.links, &tmp).map(|()| true)
        });
        let _ = fs::remove_file(&tmp);
        match outcome {
            Ok(true) => {
                result.files += 1;
                result.bytes += it.size;
            }
            Ok(false) => result.skipped += 1,
            Err(_) => result.failed += 1,
        }
        done += it.size as u64;
        progress(done, total);
    }
    let _ = fs::remove_dir(work_dir);
    Ok(result)
}
