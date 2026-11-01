//! Dọn dẹp an toàn: Preview → Quarantine Job → Restore | Purge. Xem docs/PLAN.md mục 3 và ADR 0001.
//!
//! Đơn vị là Media Item (file vật lý) chứ không phải đường dẫn:
//! - Cách ly = rename MỘT Link vào thư mục cách ly + gỡ các Link còn lại (mọi Link đều được ghi vào job_items TRƯỚC).
//! - Restore = rename ngược + tạo lại hardlink cho các Link còn lại.
//! - Purge = xoá file trong thư mục cách ly → lúc này dung lượng mới thật sự được giải phóng.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{OptionalExtension, params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};

use crate::db::{Db, get_root, now_ms, tx};
use crate::error::{Error, Result};
use crate::filter::{CleanupFilter, DAY_MS, DISPLAY_PATH, ITEM_TS};
use crate::fsx;
use crate::safety::is_zalo_running;
use crate::stats::Bucket;

pub const DEFAULT_RETENTION_DAYS: i64 = 7;
const BATCH: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSample {
    pub id: i64,
    pub rel_path: Option<String>,
    pub size: i64,
    pub ts: i64,
    pub category: String,
    pub kind: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Amount {
    pub count: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    pub count: i64,
    pub bytes: i64,
    /// Shared Media Item bị bỏ qua vì còn thuộc hội thoại không được chọn.
    pub skipped_shared: Amount,
    pub by_category: Vec<Bucket>,
    pub samples: Vec<CleanupSample>,
}

pub struct JobOptions {
    /// Thư mục chứa các Quarantine Job. Phải cùng ổ đĩa với Media Store.
    pub quarantine_base: PathBuf,
    pub retention_days: i64,
    /// Từ chối nếu Zalo đang chạy. Chỉ tắt trong test.
    pub check_zalo: bool,
}

impl JobOptions {
    pub fn new(quarantine_base: PathBuf) -> Self {
        Self {
            quarantine_base,
            retention_days: DEFAULT_RETENTION_DAYS,
            check_zalo: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: i64,
    pub root_id: i64,
    pub filter_json: Option<String>,
    /// running | quarantined | restored | purged | failed
    pub status: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    pub expires_at: i64,
    pub item_count: i64,
    pub total_bytes: i64,
    pub quarantine_dir: String,
    /// File ZIP sao lưu gần nhất của job (nếu đã nén).
    pub archive_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub job_id: i64,
    pub moved: i64,
    pub failed: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredLink {
    pub(crate) rel_path: String,
    pub(crate) conv_id: Option<String>,
}

/// `%APPDATA%\zola-cleaner\quarantine` — cùng ổ với ZaloData, nằm ngoài ZaloData.
pub fn default_quarantine_base(app_data: &Path) -> PathBuf {
    app_data.join("zola-cleaner").join("quarantine")
}

/// Thư mục thùng rác cho một Media Store: phải cùng ổ (dọn = đổi tên file, không chép).
/// Cùng ổ với `default_base` (thường là ổ C, %APPDATA%) → dùng `default_base`;
/// dữ liệu Zalo đã chuyển sang ổ khác → `<ổ đó>\ZolaCleaner\trash`.
pub fn quarantine_base_for(store: &Path, default_base: &Path) -> PathBuf {
    if drive_of(store) == drive_of(default_base) {
        return default_base.to_path_buf();
    }
    let drive_root: PathBuf = store.components().take(2).collect(); // "D:" + "\"
    drive_root.join("ZolaCleaner").join("trash")
}

pub(crate) fn abs_of(root: &Path, rel_path: &str) -> PathBuf {
    rel_path
        .split('/')
        .fold(root.to_path_buf(), |p, part| p.join(part))
}

/// Chạy thử: không thay đổi gì trên đĩa.
pub fn preview_cleanup(
    db: &Db,
    filter: &CleanupFilter,
    sample_limit: i64,
) -> Result<CleanupPreview> {
    let w = filter.candidate_where();
    let s = filter.shared_cond();

    let mut take = Amount::default();
    let mut skip = Amount::default();
    {
        let sql = format!(
            "SELECT {} AS shared, COUNT(*), COALESCE(SUM(i.size), 0) FROM items i WHERE {} GROUP BY shared",
            s.sql, w.sql
        );
        let params: Vec<Value> = s
            .params
            .iter()
            .cloned()
            .chain(w.params.iter().cloned())
            .collect();
        let mut q = db.prepare(&sql)?;
        let mut rows = q.query(params_from_iter(params))?;
        while let Some(r) = rows.next()? {
            let a = Amount {
                count: r.get(1)?,
                bytes: r.get(2)?,
            };
            if r.get::<_, i64>(0)? != 0 {
                skip = a
            } else {
                take = a
            }
        }
    }

    let kept = |extra: &[Value]| -> Vec<Value> {
        w.params
            .iter()
            .cloned()
            .chain(s.params.iter().cloned())
            .chain(extra.iter().cloned())
            .collect()
    };
    let base = format!("FROM items i WHERE {} AND NOT {}", w.sql, s.sql);

    let mut q = db.prepare(&format!(
        "SELECT i.category, COUNT(*), SUM(i.size) AS bytes {base} GROUP BY i.category ORDER BY bytes DESC"
    ))?;
    let by_category = q
        .query_map(params_from_iter(kept(&[])), |r| {
            Ok(Bucket {
                key: r.get(0)?,
                count: r.get(1)?,
                bytes: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut q = db.prepare(&format!(
        "SELECT i.id, {DISPLAY_PATH}, i.size, {ITEM_TS}, i.category, i.kind {base} ORDER BY i.size DESC LIMIT ?"
    ))?;
    let samples = q
        .query_map(
            params_from_iter(kept(&[Value::Integer(sample_limit)])),
            |r| {
                Ok(CleanupSample {
                    id: r.get(0)?,
                    rel_path: r.get(1)?,
                    size: r.get(2)?,
                    ts: r.get(3)?,
                    category: r.get(4)?,
                    kind: r.get(5)?,
                })
            },
        )?
        .collect::<rusqlite::Result<_>>()?;

    Ok(CleanupPreview {
        count: take.count,
        bytes: take.bytes,
        skipped_shared: skip,
        by_category,
        samples,
    })
}

/// Ổ đĩa của một đường dẫn (`c:\`), để kiểm tra rename không phải chép qua ổ khác.
pub(crate) fn drive_of(p: &Path) -> String {
    p.components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Link kho đứng trước Link trong resource/ → đó là Link được rename vào thư mục cách ly.
fn order_links(mut links: Vec<StoredLink>) -> Vec<StoredLink> {
    links.sort_by_key(|l| l.rel_path.starts_with("resource/"));
    links
}

/// Đưa một Media Item về đủ mọi Link ban đầu. Idempotent: chạy lại sau khi bị ngắt giữa chừng vẫn đúng.
/// Trong lúc cách ly, Zalo có thể đã tải lại đúng ảnh đó (từ Cloud) vào một Link cũ — file mới, nlink 1.
/// Cùng nội dung → thay bằng Link tới bản gốc (không để hai bản). Khác nội dung → giữ file của Zalo.
pub(crate) fn restore_links(
    root: &Path,
    links: &[StoredLink],
    quarantine_path: &Path,
) -> Result<()> {
    let mut paths = links.iter().map(|l| abs_of(root, &l.rel_path));
    let Some(primary) = paths.next() else {
        return Ok(());
    };
    if quarantine_path.exists() {
        if primary.exists() {
            if !fsx::same_content(&primary, quarantine_path)? {
                return Err(Error::Msg(format!(
                    "Đã có file khác ở {}",
                    primary.display()
                )));
            }
            fs::remove_file(&primary)?;
        }
        if let Some(dir) = primary.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::rename(quarantine_path, &primary)?;
    }
    if !primary.exists() {
        return Err(Error::Msg(format!(
            "Mất file trong thư mục cách ly: {}",
            quarantine_path.display()
        )));
    }
    for other in paths {
        if other.exists() {
            if fsx::same_file(&primary, &other)? || !fsx::same_content(&primary, &other)? {
                continue;
            }
            fs::remove_file(&other)?;
        }
        if let Some(dir) = other.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::hard_link(&primary, &other)?;
    }
    Ok(())
}

pub(crate) fn assert_zalo_closed(opts: &JobOptions) -> Result<()> {
    if opts.check_zalo && is_zalo_running() {
        Err(Error::ZaloRunning)
    } else {
        Ok(())
    }
}

struct Planned {
    id: i64,
    size: i64,
    links: Vec<StoredLink>,
    quarantine_path: PathBuf,
}

/// Tạo Quarantine Job cho các Media Item khớp bộ lọc (bỏ qua Shared Media Item).
pub fn quarantine(db: &Db, filter: &CleanupFilter, opts: &JobOptions) -> Result<JobResult> {
    assert_zalo_closed(opts)?;
    let root = get_root(db, filter.root_id)?
        .ok_or_else(|| Error::Msg(format!("Không tìm thấy root #{}", filter.root_id)))?;
    let root_path = PathBuf::from(&root.path);
    let base = std::path::absolute(&opts.quarantine_base)?;
    if drive_of(&base) != drive_of(&root_path) {
        return Err(Error::Msg(format!(
            "Thư mục cách ly ({}) phải cùng ổ đĩa với {}",
            base.display(),
            root_path.display()
        )));
    }

    let w = filter.candidate_where();
    let s = filter.shared_cond();
    let items: Vec<(i64, i64)> = {
        let mut q = db.prepare(&format!(
            "SELECT i.id, i.size FROM items i WHERE {} AND NOT {} ORDER BY i.id",
            w.sql, s.sql
        ))?;
        let params: Vec<Value> = w.params.into_iter().chain(s.params).collect();
        q.query_map(params_from_iter(params), |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };

    let now = now_ms();
    db.execute(
        "INSERT INTO jobs (root_id, filter_json, status, created_at, expires_at, quarantine_dir)
         VALUES (?, ?, 'running', ?, ?, '')",
        params![
            root.id,
            serde_json::to_string(filter).unwrap_or_default(),
            now,
            now + opts.retention_days * DAY_MS
        ],
    )?;
    let job_id = db.last_insert_rowid();
    // Kèm thời điểm tạo: CSDL bị xoá / bản app khác dùng chung thư mục cách ly thì jobId lặp lại,
    // trùng thư mục sẽ khiến Purge job mới xoá luôn file của job cũ
    let job_dir = base.join(format!("{job_id}-{now}"));
    if job_dir.exists() {
        return Err(Error::Msg(format!(
            "Thư mục cách ly đã tồn tại: {}",
            job_dir.display()
        )));
    }
    db.execute(
        "UPDATE jobs SET quarantine_dir = ? WHERE id = ?",
        params![job_dir.to_string_lossy(), job_id],
    )?;
    fs::create_dir_all(&job_dir)?;

    let mut result = JobResult {
        job_id,
        ..Default::default()
    };

    for batch in items.chunks(BATCH) {
        // 1. Ghi nhật ký TRƯỚC khi đụng vào đĩa
        let planned: Vec<Planned> = tx(db, |t| {
            let mut q_links = t.prepare("SELECT rel_path, conv_id FROM links WHERE item_id = ?")?;
            let mut q_insert = t.prepare(
                "INSERT INTO job_items (job_id, item_id, links_json, quarantine_path, size, state)
                 VALUES (?, ?, ?, ?, ?, 'pending')",
            )?;
            let mut out = Vec::with_capacity(batch.len());
            for &(id, size) in batch {
                let links = q_links
                    .query_map([id], |r| {
                        Ok(StoredLink {
                            rel_path: r.get(0)?,
                            conv_id: r.get(1)?,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let links = order_links(links);
                let Some(first) = links.first() else { continue };
                let quarantine_path = abs_of(&job_dir, &first.rel_path);
                q_insert.execute(params![
                    job_id,
                    id,
                    serde_json::to_string(&links).unwrap_or_default(),
                    quarantine_path.to_string_lossy(),
                    size
                ])?;
                out.push(Planned {
                    id,
                    size,
                    links,
                    quarantine_path,
                });
            }
            Ok(out)
        })?;

        // 2. Di chuyển trên đĩa
        let outcomes: Vec<(Planned, Option<String>)> = planned
            .into_iter()
            .map(|p| {
                let err = move_out(&root_path, &p).err().map(|e| e.to_string());
                (p, err)
            })
            .collect();

        // 3. Cập nhật nhật ký + chỉ mục
        tx(db, |t| {
            for (p, err) in &outcomes {
                match err {
                    Some(e) => {
                        t.execute(
                            "UPDATE job_items SET state = 'failed', error = ? WHERE job_id = ? AND item_id = ?",
                            params![e, job_id, p.id],
                        )?;
                        result.failed += 1;
                    }
                    None => {
                        t.execute(
                            "UPDATE job_items SET state = 'moved', error = NULL WHERE job_id = ? AND item_id = ?",
                            params![job_id, p.id],
                        )?;
                        t.execute(
                            "UPDATE items SET status = 'quarantined' WHERE id = ?",
                            [p.id],
                        )?;
                        t.execute("DELETE FROM links WHERE item_id = ?", [p.id])?;
                        result.moved += 1;
                        result.bytes += p.size;
                    }
                }
            }
            Ok(())
        })?;
    }

    let status = if result.moved > 0 || result.failed == 0 {
        "quarantined"
    } else {
        "failed"
    };
    db.execute(
        "UPDATE jobs SET status = ?, finished_at = ?, item_count = ?, total_bytes = ? WHERE id = ?",
        params![status, now_ms(), result.moved, result.bytes, job_id],
    )?;
    Ok(result)
}

/// Rename Link kho vào thư mục cách ly, gỡ các Link còn lại. Lỗi giữa chừng → trả Media Item về như cũ.
fn move_out(root: &Path, p: &Planned) -> Result<()> {
    let mut paths = p.links.iter().map(|l| abs_of(root, &l.rel_path));
    let primary = paths.next().expect("đã lọc Media Item không có Link");
    if let Some(dir) = p.quarantine_path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::rename(&primary, &p.quarantine_path)?;
    for other in paths {
        match fs::remove_file(&other) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                restore_links(root, &p.links, &p.quarantine_path)?; // không để Media Item ở trạng thái nửa vời
                return Err(e.into());
            }
        }
    }
    Ok(())
}

fn job_row(r: &rusqlite::Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: r.get("id")?,
        root_id: r.get("root_id")?,
        filter_json: r.get("filter_json")?,
        status: r.get("status")?,
        created_at: r.get("created_at")?,
        finished_at: r.get("finished_at")?,
        expires_at: r.get("expires_at")?,
        item_count: r.get("item_count")?,
        total_bytes: r.get("total_bytes")?,
        quarantine_dir: r.get("quarantine_dir")?,
        archive_path: r.get("archive_path")?,
    })
}

fn get_job(db: &Db, job_id: i64) -> Result<Job> {
    db.query_row("SELECT * FROM jobs WHERE id = ?", [job_id], job_row)
        .optional()?
        .ok_or_else(|| Error::Msg(format!("Không tìm thấy job #{job_id}")))
}

pub fn list_jobs(db: &Db, root_id: i64) -> Result<Vec<Job>> {
    let mut q = db.prepare("SELECT * FROM jobs WHERE root_id = ? ORDER BY id DESC")?;
    Ok(q.query_map([root_id], job_row)?
        .collect::<rusqlite::Result<_>>()?)
}

struct MovedItem {
    item_id: i64,
    links: Vec<StoredLink>,
    quarantine_path: PathBuf,
    size: i64,
}

fn moved_items(db: &Db, job_id: i64) -> Result<Vec<MovedItem>> {
    let mut q = db.prepare(
        "SELECT item_id, links_json, quarantine_path, size FROM job_items WHERE job_id = ? AND state = 'moved'",
    )?;
    let rows = q
        .query_map([job_id], |r| {
            let json: String = r.get(1)?;
            Ok(MovedItem {
                item_id: r.get(0)?,
                links: serde_json::from_str(&json).unwrap_or_default(),
                quarantine_path: PathBuf::from(r.get::<_, String>(2)?),
                size: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn assert_active(job: &Job, action: &str) -> Result<()> {
    if job.status == "quarantined" || job.status == "failed" {
        Ok(())
    } else {
        Err(Error::Msg(format!(
            "Job #{} đang ở trạng thái '{}', không {action} được",
            job.id, job.status
        )))
    }
}

/// Restore: đưa mọi Media Item của job về đúng các Link ban đầu.
pub fn restore_job(db: &Db, job_id: i64, opts: &JobOptions) -> Result<JobResult> {
    assert_zalo_closed(opts)?;
    let job = get_job(db, job_id)?;
    assert_active(&job, "khôi phục")?;
    let root = get_root(db, job.root_id)?
        .ok_or_else(|| Error::Msg(format!("Không tìm thấy root #{}", job.root_id)))?;
    let root_path = PathBuf::from(&root.path);
    let mut result = JobResult {
        job_id,
        ..Default::default()
    };

    for row in moved_items(db, job_id)? {
        if let Err(e) = restore_links(&root_path, &row.links, &row.quarantine_path) {
            db.execute(
                "UPDATE job_items SET error = ? WHERE job_id = ? AND item_id = ?",
                params![e.to_string(), job_id, row.item_id],
            )?;
            result.failed += 1;
            continue;
        }
        tx(db, |t| {
            let seen: i64 = t.query_row(
                "SELECT seen_scan_id FROM items WHERE id = ?",
                [row.item_id],
                |r| r.get(0),
            )?;
            // Link có thể đang trỏ tới bản Zalo tải lại (nếu đã quét lại) → trỏ về Media Item gốc;
            // lần quét sau tự sửa lại nếu file ở đó thực ra khác
            let mut q = t.prepare(
                "INSERT INTO links (item_id, root_id, rel_path, conv_id, seen_scan_id) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (root_id, rel_path) DO UPDATE SET item_id = excluded.item_id",
            )?;
            for l in &row.links {
                q.execute(params![row.item_id, root.id, l.rel_path, l.conv_id, seen])?;
            }
            t.execute(
                "UPDATE items SET status = 'present' WHERE id = ?",
                [row.item_id],
            )?;
            t.execute(
                "UPDATE job_items SET state = 'restored', error = NULL WHERE job_id = ? AND item_id = ?",
                params![job_id, row.item_id],
            )?;
            Ok(())
        })?;
        result.moved += 1;
        result.bytes += row.size;
    }

    if result.failed == 0 {
        db.execute(
            "UPDATE jobs SET status = 'restored', finished_at = ? WHERE id = ?",
            params![now_ms(), job_id],
        )?;
        remove_dir_if_exists(Path::new(&job.quarantine_dir))?;
    }
    Ok(result)
}

fn remove_dir_if_exists(dir: &Path) -> Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Purge ("Giải phóng"): xoá vĩnh viễn các Media Item của job. Không cần tắt Zalo vì file đã nằm ngoài ZaloData.
pub fn purge_job(db: &Db, job_id: i64) -> Result<JobResult> {
    let job = get_job(db, job_id)?;
    assert_active(&job, "xoá")?;
    let mut result = JobResult {
        job_id,
        ..Default::default()
    };

    for row in moved_items(db, job_id)? {
        match fs::remove_file(&row.quarantine_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                db.execute(
                    "UPDATE job_items SET error = ? WHERE job_id = ? AND item_id = ?",
                    params![e.to_string(), job_id, row.item_id],
                )?;
                result.failed += 1;
                continue;
            }
        }
        tx(db, |t| {
            t.execute(
                "UPDATE items SET status = 'deleted' WHERE id = ?",
                [row.item_id],
            )?;
            t.execute(
                "UPDATE job_items SET state = 'purged' WHERE job_id = ? AND item_id = ?",
                params![job_id, row.item_id],
            )?;
            Ok(())
        })?;
        result.moved += 1;
        result.bytes += row.size;
    }

    if result.failed == 0 {
        remove_dir_if_exists(Path::new(&job.quarantine_dir))?;
        db.execute(
            "UPDATE jobs SET status = 'purged', finished_at = ? WHERE id = ?",
            params![now_ms(), job_id],
        )?;
    }
    Ok(result)
}

/// Tự Purge các job đã hết Retention. Gọi khi app khởi động.
pub fn purge_expired(db: &Db, now: i64) -> Result<Vec<JobResult>> {
    let ids: Vec<i64> = {
        let mut q =
            db.prepare("SELECT id FROM jobs WHERE status = 'quarantined' AND expires_at <= ?")?;
        q.query_map([now], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?
    };
    ids.into_iter().map(|id| purge_job(db, id)).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub id: i64,
    pub category: String,
    pub kind: String,
    pub size: i64,
    pub ts: i64,
    /// Một Conversation của Media Item (để người dùng biết file từ đâu).
    pub conv_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItems {
    pub total: i64,
    pub items: Vec<CleanupItem>,
}

/// Danh sách Media Item sẽ bị dọn theo bộ lọc, theo trang — để người dùng xem trước và bỏ tick.
/// `group`: "media" (ảnh + video) hoặc "docs" (còn lại). `order`: "largest" | "newest" | "oldest".
/// Bỏ qua `exclude_ids`: file đã bỏ tick vẫn hiện (ở trạng thái không tick).
pub fn cleanup_items(
    db: &Db,
    filter: &CleanupFilter,
    group: &str,
    order: &str,
    offset: i64,
    limit: i64,
) -> Result<CleanupItems> {
    let f = CleanupFilter {
        exclude_ids: None,
        ..filter.clone()
    };
    let w = f.candidate_where();
    let s = f.shared_cond();
    let group_cond = if group == "media" {
        "i.category IN ('image', 'video')"
    } else {
        "i.category NOT IN ('image', 'video')"
    };
    let order_by = match order {
        "newest" => format!("{ITEM_TS} DESC"),
        "oldest" => format!("{ITEM_TS} ASC"),
        _ => "i.size DESC".to_owned(),
    };
    let base = format!(
        "FROM items i WHERE {} AND NOT {} AND {group_cond}",
        w.sql, s.sql
    );
    let params = || -> Vec<Value> {
        w.params
            .iter()
            .cloned()
            .chain(s.params.iter().cloned())
            .collect()
    };

    let total: i64 = db.query_row(
        &format!("SELECT COUNT(*) {base}"),
        params_from_iter(params()),
        |r| r.get(0),
    )?;
    let mut q = db.prepare(&format!(
        "SELECT i.id, i.category, i.kind, i.size, {ITEM_TS},
           (SELECT conv_id FROM links WHERE item_id = i.id AND conv_id IS NOT NULL LIMIT 1)
         {base} ORDER BY {order_by}, i.id LIMIT ? OFFSET ?"
    ))?;
    let mut p = params();
    p.push(Value::Integer(limit));
    p.push(Value::Integer(offset));
    let items = q
        .query_map(params_from_iter(p), |r| {
            Ok(CleanupItem {
                id: r.get(0)?,
                category: r.get(1)?,
                kind: r.get(2)?,
                size: r.get(3)?,
                ts: r.get(4)?,
                conv_id: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(CleanupItems { total, items })
}
