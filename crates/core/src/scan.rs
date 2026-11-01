//! Quét tăng dần một Media Store:
//! - liệt kê mọi thư mục kèm file id → gom các Link (hardlink) về cùng một Media Item
//! - Media Item mới / đổi size hoặc mtime → đọc header một lần, nhận diện (fileNoise: giải XOR), ghi lại
//! - Media Item không đổi → chỉ đánh dấu đã thấy
//! - Link không còn thấy → xoá khỏi chỉ mục; Media Item không còn thấy → status = 'missing'

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use rayon::prelude::*;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::db::{Db, get_root, now_ms, tx};
use crate::detect::{
    Category, Detection, HEADER_BYTES, detect, detect_noise, refine_container, unnoise_prefix,
};

/// Số byte đọc thêm ở đầu và cuối file ZIP / Office để biết loại cụ thể.
const CONTAINER_PROBE: usize = 64 * 1024;
use crate::error::{Error, Result};
use crate::fsx;
use crate::layout::{RESCACHE_NAME, parse_link};

/// Tên thư mục luôn bỏ qua khi quét.
pub const SKIP_DIR_NAMES: [&str; 1] = ["_zalo_quarantine"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Đang liệt kê thư mục.
    Listing,
    /// Đang đọc header các Media Item mới / đổi.
    Reading,
    /// Đang ghi chỉ mục.
    Writing,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: i64,
    pub phase: Phase,
    pub dirs: u64,
    /// Số Link đã thấy.
    pub seen: u64,
    /// Số Media Item mới / đã đổi.
    pub new_files: u64,
    pub changed: u64,
    /// Số Media Item đã đọc header trong pha Reading.
    pub read: u64,
    /// Tổng dung lượng các Media Item (không đếm trùng hardlink).
    pub bytes: u64,
    pub errors: u64,
}

#[derive(Default)]
pub struct ScanOptions<'a> {
    pub on_progress: Option<&'a (dyn Fn(&ScanProgress) + Sync)>,
    pub cancel: Option<&'a AtomicBool>,
}

struct LinkRow {
    key: String,
    rel_path: String,
    conv_id: Option<String>,
    msg_ts: Option<i64>,
}

struct ItemRow {
    key: String,
    abs: PathBuf,
    size: i64,
    mtime_ms: i64,
    area: String,
    /// None = không đổi so với chỉ mục, chỉ cần đánh dấu đã thấy.
    detection: Option<Detection>,
}

fn rel_of(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Tạo bản ghi quét (để client theo dõi được ngay) rồi quét đồng bộ.
pub fn scan(db: &Db, root_id: i64, opts: &ScanOptions) -> Result<ScanProgress> {
    let root = get_root(db, root_id)?
        .ok_or_else(|| Error::Msg(format!("Không tìm thấy root #{root_id}")))?;
    db.execute(
        "INSERT INTO scans (root_id, started_at) VALUES (?, ?)",
        params![root_id, now_ms()],
    )?;
    let scan_id = db.last_insert_rowid();

    let mut p = ScanProgress {
        scan_id,
        phase: Phase::Listing,
        dirs: 0,
        seen: 0,
        new_files: 0,
        changed: 0,
        read: 0,
        bytes: 0,
        errors: 0,
    };
    let emit = |p: &ScanProgress| {
        if let Some(f) = opts.on_progress {
            f(p)
        }
    };
    emit(&p);

    match run(db, root_id, Path::new(&root.path), &mut p, opts, &emit) {
        Ok(missing) => {
            p.phase = Phase::Done;
            db.execute(
                "UPDATE scans SET finished_at = ?, status = 'done', files_seen = ?, files_new = ?, files_changed = ?,
                 files_missing = ?, error_count = ? WHERE id = ?",
                params![now_ms(), p.seen as i64, p.new_files as i64, p.changed as i64, missing as i64, p.errors as i64, scan_id],
            )?;
            emit(&p);
            Ok(p)
        }
        Err(err) => {
            p.phase = Phase::Failed;
            db.execute(
                "UPDATE scans SET finished_at = ?, status = 'failed', error = ? WHERE id = ?",
                params![now_ms(), err.to_string(), scan_id],
            )?;
            emit(&p);
            Err(err)
        }
    }
}

fn run(
    db: &Db,
    root_id: i64,
    root: &Path,
    p: &mut ScanProgress,
    opts: &ScanOptions,
    emit: &dyn Fn(&ScanProgress),
) -> Result<u64> {
    let cancelled = || opts.cancel.is_some_and(|c| c.load(Ordering::Relaxed));
    let volume = fsx::volume_serial(root)?;

    // 1. Liệt kê: mọi Link + một ứng viên Media Item cho mỗi file id
    // file_key → (size, mtime, nhận diện lại). Media Item chưa rõ loại ('other', ZIP / Office chung chung) được đọc lại mỗi lần quét:
    // số lượng nhỏ, và nhờ vậy cải tiến nhận diện có hiệu lực mà không cần quét lại từ đầu.
    let known: HashMap<String, (i64, i64, bool)> = {
        let mut q = db.prepare(
            "SELECT file_key, size, mtime_ms, category = 'other' OR kind IN ('zip', 'office', 'ole') FROM items WHERE root_id = ?",
        )?;
        q.query_map([root_id], |r| {
            Ok((r.get(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    let same = |key: &str, size: i64, mtime: i64| {
        known.get(key).is_some_and(|k| k.0 == size && k.1 == mtime)
    };
    let needs_read = |key: &str, size: i64, mtime: i64| {
        !same(key, size, mtime) || known.get(key).is_some_and(|k| k.2)
    };
    let mut links: Vec<LinkRow> = Vec::new();
    let mut items: Vec<ItemRow> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut stack = vec![root.to_path_buf()];
    let mut last_emit = std::time::Instant::now();

    while let Some(dir) = stack.pop() {
        if cancelled() {
            return Err(Error::Msg("Đã huỷ quét".into()));
        }
        p.dirs += 1;
        let entries = match fsx::list_dir(&dir) {
            Ok(e) => e,
            Err(_) => {
                p.errors += 1;
                continue;
            }
        };
        for e in entries {
            let abs = dir.join(&e.name);
            if e.is_reparse {
                continue; // symlink / junction
            }
            if e.is_dir {
                if !SKIP_DIR_NAMES.contains(&e.name.as_str()) {
                    stack.push(abs);
                }
                continue;
            }
            if e.name == RESCACHE_NAME {
                continue;
            }
            let rel_path = rel_of(root, &abs);
            let info = parse_link(&rel_path);
            let key = fsx::make_key(volume, e.file_id);
            p.seen += 1;
            if !index.contains_key(&key) {
                index.insert(key.clone(), items.len());
                p.bytes += e.size;
                let size = e.size as i64;
                let unchanged = same(&key, size, e.mtime_ms);
                items.push(ItemRow {
                    key: key.clone(),
                    abs,
                    size,
                    mtime_ms: e.mtime_ms,
                    area: info.area,
                    detection: None,
                });
                if !unchanged {
                    if known.contains_key(&key) {
                        p.changed += 1;
                    } else {
                        p.new_files += 1;
                    }
                }
            }
            links.push(LinkRow {
                key,
                rel_path,
                conv_id: info.conv_id,
                msg_ts: info.msg_ts,
            });
        }
        if last_emit.elapsed().as_millis() > 200 {
            last_emit = std::time::Instant::now();
            emit(p);
        }
    }

    // 2. Đọc header song song cho Media Item mới / đổi
    p.phase = Phase::Reading;
    emit(p);
    let read = AtomicU64::new(0);
    let errors = AtomicU64::new(0);
    items
        .par_iter_mut()
        .filter(|it| needs_read(&it.key, it.size, it.mtime_ms))
        .for_each(|it| {
            if cancelled() {
                return;
            }
            match fsx::read_header(&it.abs, HEADER_BYTES) {
                Ok(h) => {
                    let ext = it
                        .abs
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                        .unwrap_or_default();
                    let noise = it.area == "fileNoise";
                    let mut d = if noise { detect_noise(&h, &ext) } else { detect(&h, &ext) };
                    // ZIP / Office: 64 byte đầu chưa đủ biết là Word, Excel hay PowerPoint → đọc thêm đầu + cuối file
                    if matches!(d.kind.as_str(), "zip" | "office" | "ole")
                        && let Ok((mut head, tail)) = fsx::read_head_tail(&it.abs, CONTAINER_PROBE)
                    {
                        if noise {
                            unnoise_prefix(&mut head, 0);
                        }
                        if let Some(k) = refine_container(&d.kind, &head, &tail) {
                            d = Detection { category: Category::Document, kind: k.to_owned() };
                        }
                    }
                    it.detection = Some(d);
                }
                Err(_) => {
                    errors.fetch_add(1, Ordering::Relaxed); // file bị khoá, đường dẫn hỏng...
                }
            }
            read.fetch_add(1, Ordering::Relaxed);
        });
    if cancelled() {
        return Err(Error::Msg("Đã huỷ quét".into()));
    }
    p.read = read.into_inner();
    p.errors += errors.into_inner();

    // 3. Ghi chỉ mục trong một transaction
    p.phase = Phase::Writing;
    emit(p);
    let scan_id = p.scan_id;
    let missing = tx(db, |t| {
        let mut touch = t.prepare("UPDATE items SET seen_scan_id = ?, status = 'present' WHERE root_id = ? AND file_key = ?")?;
        let mut upsert = t.prepare(
            "INSERT INTO items (root_id, file_key, size, mtime_ms, area, category, kind, seen_scan_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
             ON CONFLICT (root_id, file_key) DO UPDATE SET
               size = excluded.size, mtime_ms = excluded.mtime_ms, area = excluded.area,
               category = excluded.category, kind = excluded.kind,
               seen_scan_id = excluded.seen_scan_id, status = 'present',
               quick_hash = NULL, full_hash = NULL",
        )?;
        for it in &items {
            match &it.detection {
                Some(d) => {
                    upsert.execute(params![
                        root_id,
                        it.key,
                        it.size,
                        it.mtime_ms,
                        it.area,
                        d.category.as_str(),
                        d.kind,
                        scan_id
                    ])?;
                }
                None if known.contains_key(&it.key) => {
                    touch.execute(params![scan_id, root_id, it.key])?;
                }
                None => {} // mới nhưng đọc header lỗi → lần quét sau thử lại
            }
        }

        let mut item_id = t.prepare("SELECT id FROM items WHERE root_id = ? AND file_key = ?")?;
        let mut upsert_link = t.prepare(
            "INSERT INTO links (item_id, root_id, rel_path, conv_id, seen_scan_id) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (root_id, rel_path) DO UPDATE SET
               item_id = excluded.item_id, conv_id = excluded.conv_id, seen_scan_id = excluded.seen_scan_id",
        )?;
        // Message Time = thời điểm sớm nhất thấy trong tên các Link
        let mut msg_ts = t.prepare(
            "UPDATE items SET msg_ts = ? WHERE id = ? AND (msg_ts IS NULL OR msg_ts > ?)",
        )?;
        for l in &links {
            let Some(id): Option<i64> = item_id
                .query_row(params![root_id, l.key], |r| r.get(0))
                .optional()?
            else {
                continue;
            };
            upsert_link.execute(params![id, root_id, l.rel_path, l.conv_id, scan_id])?;
            if let Some(ts) = l.msg_ts {
                msg_ts.execute(params![ts, id, ts])?;
            }
        }

        t.execute(
            "DELETE FROM links WHERE root_id = ? AND seen_scan_id < ?",
            params![root_id, scan_id],
        )?;
        let missing = t.execute(
            "UPDATE items SET status = 'missing' WHERE root_id = ? AND status = 'present' AND seen_scan_id < ?",
            params![root_id, scan_id],
        )?;
        Ok(missing as u64)
    })?;
    Ok(missing)
}
