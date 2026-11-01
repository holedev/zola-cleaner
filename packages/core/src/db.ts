import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

export type Db = DatabaseSync;

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS roots (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY,
  root_id       INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  rel_path      TEXT NOT NULL,          -- luôn dùng "/" làm dấu phân cách
  size          INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  category      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  top_dir       TEXT NOT NULL,          -- 1–2 cấp thư mục đầu, để thống kê nhanh
  quick_hash    TEXT,
  full_hash     TEXT,
  seen_scan_id  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'present', -- present | quarantined | deleted | missing
  UNIQUE (root_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(status, category);
CREATE INDEX IF NOT EXISTS idx_files_mtime    ON files(status, mtime_ms);
CREATE INDEX IF NOT EXISTS idx_files_size     ON files(status, size);
CREATE INDEX IF NOT EXISTS idx_files_top_dir  ON files(status, top_dir);

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

-- Giai đoạn 3: dọn dẹp an toàn
CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,        -- quarantine | restore | purge
  filter_json     TEXT,
  status          TEXT NOT NULL,        -- pending | running | done | failed
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  file_count      INTEGER NOT NULL DEFAULT 0,
  total_bytes     INTEGER NOT NULL DEFAULT 0,
  quarantine_dir  TEXT
);

CREATE TABLE IF NOT EXISTS job_items (
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_id    INTEGER NOT NULL REFERENCES files(id),
  from_path  TEXT NOT NULL,
  to_path    TEXT NOT NULL,
  state      TEXT NOT NULL,             -- pending | moved | restored | purged | failed
  error      TEXT,
  PRIMARY KEY (job_id, file_id)
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
  db.exec(SCHEMA);
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
