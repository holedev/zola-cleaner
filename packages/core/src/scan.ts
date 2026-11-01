import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { type Db, getRoot, tx } from "./db.ts";
import { detect, HEADER_BYTES } from "./detect.ts";

/** Tên thư mục luôn bỏ qua khi quét. */
export const SKIP_DIR_NAMES = new Set(["_zalo_quarantine"]);

export interface ScanProgress {
  scanId: number;
  phase: "running" | "done" | "failed";
  dirs: number;
  seen: number;
  newFiles: number;
  changed: number;
  bytes: number;
  errors: number;
  currentDir?: string;
}

export interface ScanOptions {
  /** Số thao tác I/O song song khi stat + đọc header. Mặc định 64. */
  concurrency?: number;
  /** Số dòng ghi mỗi transaction. Mặc định 1000. */
  batchSize?: number;
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
}

export interface ScanHandle {
  scanId: number;
  done: Promise<ScanProgress>;
}

interface Row {
  relPath: string;
  size: number;
  mtimeMs: number;
  category: string;
  kind: string;
  topDir: string;
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/** 1–2 cấp thư mục đầu của đường dẫn tương đối, dùng để gom nhóm thống kê. */
export function topDirOf(relPath: string, depth = 2): string {
  const parts = relPath.split("/");
  parts.pop(); // bỏ tên file
  return parts.length === 0 ? "." : parts.slice(0, depth).join("/");
}

async function readHeader(file: string): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const buf = new Uint8Array(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

/**
 * Quét tăng dần một thư mục gốc:
 * - file mới / đổi size hoặc mtime → đọc header, nhận diện, ghi lại
 * - file không đổi → chỉ đánh dấu đã thấy
 * - file không còn thấy → status = 'missing'
 */
export function startScan(db: Db, rootId: number, opts: ScanOptions = {}): ScanHandle {
  const root = getRoot(db, rootId);
  if (!root) throw new Error(`Không tìm thấy root #${rootId}`);

  const { concurrency = 64, batchSize = 1000, onProgress, signal } = opts;
  const scanId = Number(
    db.prepare("INSERT INTO scans (root_id, started_at) VALUES (?, ?)").run(rootId, Date.now()).lastInsertRowid,
  );

  const qLookup = db.prepare("SELECT id, size, mtime_ms FROM files WHERE root_id = ? AND rel_path = ?");
  const qTouch = db.prepare("UPDATE files SET seen_scan_id = ?, status = 'present' WHERE id = ?");
  const qUpsert = db.prepare(`
    INSERT INTO files (root_id, rel_path, size, mtime_ms, category, kind, top_dir, seen_scan_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
    ON CONFLICT (root_id, rel_path) DO UPDATE SET
      size = excluded.size, mtime_ms = excluded.mtime_ms,
      category = excluded.category, kind = excluded.kind, top_dir = excluded.top_dir,
      seen_scan_id = excluded.seen_scan_id, status = 'present',
      quick_hash = NULL, full_hash = NULL
  `);

  const progress: ScanProgress = {
    scanId,
    phase: "running",
    dirs: 0,
    seen: 0,
    newFiles: 0,
    changed: 0,
    bytes: 0,
    errors: 0,
  };

  let pendingRows: Row[] = [];
  let pendingTouches: number[] = [];

  const flush = () => {
    if (pendingRows.length === 0 && pendingTouches.length === 0) return;
    const rows = pendingRows;
    const touches = pendingTouches;
    pendingRows = [];
    pendingTouches = [];
    tx(db, () => {
      for (const r of rows) qUpsert.run(rootId, r.relPath, r.size, r.mtimeMs, r.category, r.kind, r.topDir, scanId);
      for (const id of touches) qTouch.run(scanId, id);
    });
  };

  const run = async (): Promise<ScanProgress> => {
    const stack = [root.path];
    let lastEmit = 0;

    while (stack.length > 0) {
      signal?.throwIfAborted();
      const dir = stack.pop()!;
      progress.currentDir = dir;
      progress.dirs++;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        progress.errors++;
        continue;
      }

      const files: string[] = [];
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIR_NAMES.has(e.name)) stack.push(abs);
        } else if (e.isFile()) {
          files.push(abs);
        }
        // Bỏ qua symlink / junction để tránh vòng lặp
      }

      await mapPool(files, concurrency, async (abs) => {
        try {
          const st = await stat(abs);
          const relPath = toRel(root.path, abs);
          const size = st.size;
          const mtimeMs = Math.floor(st.mtimeMs);
          progress.seen++;
          progress.bytes += size;

          const existing = qLookup.get(rootId, relPath) as { id: number; size: number; mtime_ms: number } | undefined;
          if (existing && existing.size === size && existing.mtime_ms === mtimeMs) {
            pendingTouches.push(existing.id);
            return;
          }
          if (existing) progress.changed++;
          else progress.newFiles++;

          const header = await readHeader(abs);
          const { category, kind } = detect(header, path.extname(abs).toLowerCase());
          pendingRows.push({ relPath, size, mtimeMs, category, kind, topDir: topDirOf(relPath) });
        } catch {
          progress.errors++; // file bị khoá (EBUSY/EPERM), đường dẫn quá dài...
        }
      });

      if (pendingRows.length + pendingTouches.length >= batchSize) flush();

      const now = Date.now();
      if (onProgress && now - lastEmit > 250) {
        lastEmit = now;
        onProgress({ ...progress });
      }
    }

    flush();

    const missing = db
      .prepare("UPDATE files SET status = 'missing' WHERE root_id = ? AND status = 'present' AND seen_scan_id < ?")
      .run(rootId, scanId).changes;

    progress.phase = "done";
    progress.currentDir = undefined;
    db.prepare(
      `UPDATE scans SET finished_at = ?, status = 'done', files_seen = ?, files_new = ?, files_changed = ?,
       files_missing = ?, error_count = ? WHERE id = ?`,
    ).run(Date.now(), progress.seen, progress.newFiles, progress.changed, Number(missing), progress.errors, scanId);
    onProgress?.({ ...progress });
    return progress;
  };

  const done = run().catch((err: unknown) => {
    flush();
    progress.phase = "failed";
    db.prepare("UPDATE scans SET finished_at = ?, status = 'failed', error = ? WHERE id = ?").run(
      Date.now(),
      String(err),
      scanId,
    );
    onProgress?.({ ...progress });
    throw err;
  });

  return { scanId, done };
}
