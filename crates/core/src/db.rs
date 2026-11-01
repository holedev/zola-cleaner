//! Chỉ mục SQLite của app. Dựng lại được hoàn toàn bằng cách quét lại, trừ Alias và nhật ký Quarantine Job.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::{bail, error::Result};

pub type Db = Connection;

const SCHEMA_VERSION: i64 = 2;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS roots (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  INTEGER NOT NULL
);

-- Media Item = một file vật lý (định danh bằng volume + file id). Một Media Item có nhiều Link (hardlink).
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY,
  root_id       INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  file_key      TEXT NOT NULL,          -- "<volume>:<file id>"
  size          INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  msg_ts        INTEGER,                -- Message Time (ms), lấy từ tên Link trong resource/
  area          TEXT NOT NULL,          -- thư mục kho: picture | video | fileNoise | file | Cache | ...
  category      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  quick_hash    TEXT,
  full_hash     TEXT,
  seen_scan_id  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'present', -- present | quarantined | deleted | missing
  UNIQUE (root_id, file_key)
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(status, category);
CREATE INDEX IF NOT EXISTS idx_items_area     ON items(status, area);
CREATE INDEX IF NOT EXISTS idx_items_size     ON items(status, size);

CREATE TABLE IF NOT EXISTS links (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  root_id       INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  rel_path      TEXT NOT NULL,          -- luôn dùng "/" làm dấu phân cách
  conv_id       TEXT,                   -- Conversation (chỉ Link trong resource/<convId>/ và picture/<convId>/)
  seen_scan_id  INTEGER NOT NULL,
  UNIQUE (root_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_links_item ON links(item_id);
CREATE INDEX IF NOT EXISTS idx_links_conv ON links(root_id, conv_id, item_id);

-- Chỉ chứa dữ liệu người dùng (Alias); số liệu luôn tính từ links + items.
CREATE TABLE IF NOT EXISTS conversations (
  root_id   INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  conv_id   TEXT NOT NULL,
  alias     TEXT,
  PRIMARY KEY (root_id, conv_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id             INTEGER PRIMARY KEY,
  root_id        INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  status         TEXT NOT NULL DEFAULT 'running', -- running | done | failed
  files_seen     INTEGER NOT NULL DEFAULT 0,
  files_new      INTEGER NOT NULL DEFAULT 0,
  files_changed  INTEGER NOT NULL DEFAULT 0,
  files_missing  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

-- Quarantine Job
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY,
  root_id         INTEGER NOT NULL REFERENCES roots(id),
  filter_json     TEXT,
  status          TEXT NOT NULL,        -- running | quarantined | restored | purged | failed
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  expires_at      INTEGER NOT NULL,     -- hết Retention → tự Purge
  item_count      INTEGER NOT NULL DEFAULT 0,
  total_bytes     INTEGER NOT NULL DEFAULT 0,
  quarantine_dir  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_items (
  job_id           INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id          INTEGER NOT NULL REFERENCES items(id),
  links_json       TEXT NOT NULL,       -- mọi Link của Media Item lúc cách ly (Link kho đứng đầu)
  quarantine_path  TEXT NOT NULL,
  size             INTEGER NOT NULL,
  state            TEXT NOT NULL,       -- pending | moved | restored | purged | failed
  error            TEXT,
  PRIMARY KEY (job_id, item_id)
);
"#;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn open_db(file: &Path) -> Result<Db> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let db = Connection::open(file)?;
    db.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
    )?;
    // Chỉ mục dựng lại được bằng cách quét lại → đổi schema thì xoá bảng cũ, không cần migration.
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < SCHEMA_VERSION {
        db.execute_batch(
            "DROP TABLE IF EXISTS job_items; DROP TABLE IF EXISTS jobs; DROP TABLE IF EXISTS files;
             DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS scans;",
        )?;
    }
    db.execute_batch(SCHEMA)?;
    db.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
    Ok(db)
}

/// Mở thêm một kết nối tới CSDL đã được [`open_db`] tạo. Nhờ WAL, đọc được trong lúc một kết nối khác đang ghi (quét).
pub fn connect(file: &Path) -> Result<Db> {
    let db = Connection::open(file)?;
    db.execute_batch(
        "PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;",
    )?;
    Ok(db)
}

/// Chạy `f` trong một transaction; lỗi → rollback.
pub fn tx<T>(db: &Db, f: impl FnOnce(&Transaction) -> Result<T>) -> Result<T> {
    let t = db.unchecked_transaction()?;
    let out = f(&t)?;
    t.commit()?;
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: i64,
    pub path: String,
    pub label: Option<String>,
    pub created_at: i64,
}

fn root_row(r: &rusqlite::Row) -> rusqlite::Result<Root> {
    Ok(Root {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        created_at: r.get(3)?,
    })
}

pub fn list_roots(db: &Db) -> Result<Vec<Root>> {
    let mut q = db.prepare("SELECT id, path, label, created_at FROM roots ORDER BY id")?;
    let rows = q
        .query_map([], root_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get_root(db: &Db, id: i64) -> Result<Option<Root>> {
    Ok(db
        .query_row(
            "SELECT id, path, label, created_at FROM roots WHERE id = ?",
            [id],
            root_row,
        )
        .optional()?)
}

/// Thêm Media Store (hoặc trả về bản ghi đã có). Lỗi nếu không phải thư mục.
pub fn add_root(db: &Db, dir: &Path, label: Option<&str>) -> Result<Root> {
    let abs = std::path::absolute(dir)?;
    if !abs.is_dir() {
        bail!("Không phải thư mục: {}", abs.display());
    }
    let path = abs.to_string_lossy().into_owned();
    db.execute(
        "INSERT INTO roots (path, label, created_at) VALUES (?, ?, ?) ON CONFLICT(path) DO NOTHING",
        params![path, label, now_ms()],
    )?;
    Ok(db.query_row(
        "SELECT id, path, label, created_at FROM roots WHERE path = ?",
        [&path],
        root_row,
    )?)
}

pub fn remove_root(db: &Db, id: i64) -> Result<()> {
    db.execute("DELETE FROM roots WHERE id = ?", [id])?;
    Ok(())
}
