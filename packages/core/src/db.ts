import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;

const SCHEMA_VERSION = 2;

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS roots (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  INTEGER NOT NULL
);

-- Media Item = một file vật lý (định danh bằng dev + ino). Một Media Item có nhiều Link (hardlink).
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY,
  root_id       INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  file_key      TEXT NOT NULL,          -- "<dev>:<ino>"
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
  conv_id       TEXT,                   -- Conversation (chỉ Link trong resource/<convId>/)
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
  links_json       TEXT NOT NULL,       -- mọi Link (đường dẫn tuyệt đối) của Media Item lúc cách ly
  quarantine_path  TEXT NOT NULL,
  size             INTEGER NOT NULL,
  state            TEXT NOT NULL,       -- pending | moved | restored | purged | failed
  error            TEXT,
  PRIMARY KEY (job_id, item_id)
);
`;

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  // Chỉ mục dựng lại được bằng cách quét lại → đổi schema thì xoá bảng cũ, không cần migration.
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version < SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS job_items; DROP TABLE IF EXISTS jobs; DROP TABLE IF EXISTS files;
      DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS scans;
    `);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Chạy fn trong một transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface Root {
  id: number;
  path: string;
  label: string | null;
  created_at: number;
}

export function listRoots(db: Db): Root[] {
  return db.prepare("SELECT id, path, label, created_at FROM roots ORDER BY id").all() as unknown as Root[];
}

export function getRoot(db: Db, id: number): Root | undefined {
  return db.prepare("SELECT id, path, label, created_at FROM roots WHERE id = ?").get(id) as unknown as
    | Root
    | undefined;
}

/** Thêm thư mục gốc (hoặc trả về bản ghi đã có). Ném lỗi nếu không phải thư mục. */
export function addRoot(db: Db, dir: string, label?: string): Root {
  const abs = path.resolve(dir);
  if (!statSync(abs).isDirectory()) throw new Error(`Không phải thư mục: ${abs}`);
  db.prepare("INSERT INTO roots (path, label, created_at) VALUES (?, ?, ?) ON CONFLICT(path) DO NOTHING").run(
    abs,
    label ?? null,
    Date.now(),
  );
  return db.prepare("SELECT id, path, label, created_at FROM roots WHERE path = ?").get(abs) as unknown as Root;
}

export function removeRoot(db: Db, id: number): void {
  db.prepare("DELETE FROM roots WHERE id = ?").run(id);
}
