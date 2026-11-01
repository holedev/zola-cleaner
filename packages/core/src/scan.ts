import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { type Db, getRoot, tx } from "./db.ts";
import { type Detection, detect, detectNoise, HEADER_BYTES } from "./detect.ts";
import { parseLink, RESCACHE_NAME } from "./layout.ts";

/** Tên thư mục luôn bỏ qua khi quét. */
export const SKIP_DIR_NAMES = new Set(["_zalo_quarantine"]);

export interface ScanProgress {
  scanId: number;
  phase: "running" | "done" | "failed";
  dirs: number;
  /** Số Link đã thấy. */
  seen: number;
  /** Số Media Item mới / đã đổi. */
  newFiles: number;
  changed: number;
  /** Tổng dung lượng các Media Item (không đếm trùng hardlink). */
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

/** Media Item cần ghi: mới/đổi (có detection) hoặc chỉ "đã thấy lại". */
interface ItemRow {
  key: string;
  size: number;
  mtimeMs: number;
  area: string;
  detection?: Detection;
}

interface LinkRow {
  key: string;
  relPath: string;
  convId: string | null;
  msgTs: number | null;
}

function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
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
 * Quét tăng dần một Media Store:
 * - mỗi Link được stat để lấy file_key (dev + ino) → gom các hardlink về cùng một Media Item
 * - Media Item mới / đổi size hoặc mtime → đọc header một lần, nhận diện (fileNoise: giải XOR), ghi lại
 * - Media Item không đổi → chỉ đánh dấu đã thấy
 * - Link không còn thấy → xoá khỏi chỉ mục; Media Item không còn thấy → status = 'missing'
 */
export function startScan(db: Db, rootId: number, opts: ScanOptions = {}): ScanHandle {
  const root = getRoot(db, rootId);
  if (!root) throw new Error(`Không tìm thấy root #${rootId}`);

  const { concurrency = 64, batchSize = 1000, onProgress, signal } = opts;
  const scanId = Number(
    db.prepare("INSERT INTO scans (root_id, started_at) VALUES (?, ?)").run(rootId, Date.now()).lastInsertRowid,
  );

  const qLookup = db.prepare("SELECT size, mtime_ms FROM items WHERE root_id = ? AND file_key = ?");
  const qTouch = db.prepare("UPDATE items SET seen_scan_id = ?, status = 'present' WHERE root_id = ? AND file_key = ?");
  const qUpsertItem = db.prepare(`
    INSERT INTO items (root_id, file_key, size, mtime_ms, area, category, kind, seen_scan_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
    ON CONFLICT (root_id, file_key) DO UPDATE SET
      size = excluded.size, mtime_ms = excluded.mtime_ms, area = excluded.area,
      category = excluded.category, kind = excluded.kind,
      seen_scan_id = excluded.seen_scan_id, status = 'present',
      quick_hash = NULL, full_hash = NULL
  `);
  const qItemId = db.prepare("SELECT id FROM items WHERE root_id = ? AND file_key = ?");
  // Message Time = thời điểm sớm nhất thấy trong tên các Link
  const qMsgTs = db.prepare("UPDATE items SET msg_ts = ? WHERE id = ? AND (msg_ts IS NULL OR msg_ts > ?)");
  const qUpsertLink = db.prepare(`
    INSERT INTO links (item_id, root_id, rel_path, conv_id, seen_scan_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (root_id, rel_path) DO UPDATE SET
      item_id = excluded.item_id, conv_id = excluded.conv_id, seen_scan_id = excluded.seen_scan_id
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

  /** file_key đã xử lý trong lần quét này → Link thứ 2, 3… của cùng Media Item không đọc lại header. */
  const seenKeys = new Set<string>();
  let pendingItems: ItemRow[] = [];
  let pendingLinks: LinkRow[] = [];

  const flush = () => {
    if (pendingItems.length === 0 && pendingLinks.length === 0) return;
    const items = pendingItems;
    const links = pendingLinks;
    pendingItems = [];
    pendingLinks = [];
    tx(db, () => {
      // Ghi Media Item trước để Link tra được item_id
      for (const r of items) {
        if (r.detection) {
          qUpsertItem.run(rootId, r.key, r.size, r.mtimeMs, r.area, r.detection.category, r.detection.kind, scanId);
        } else {
          qTouch.run(scanId, rootId, r.key);
        }
      }
      for (const l of links) {
        const item = qItemId.get(rootId, l.key) as { id: number } | undefined;
        if (!item) continue;
        qUpsertLink.run(item.id, rootId, l.relPath, l.convId, scanId);
        if (l.msgTs != null) qMsgTs.run(l.msgTs, item.id, l.msgTs);
      }
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
        } else if (e.isFile() && e.name !== RESCACHE_NAME) {
          files.push(abs);
        }
        // Bỏ qua symlink / junction để tránh vòng lặp
      }

      await mapPool(files, concurrency, async (abs) => {
        try {
          const st = await stat(abs, { bigint: true });
          const relPath = toRel(root.path, abs);
          const key = `${st.dev}:${st.ino}`;
          const info = parseLink(relPath);
          progress.seen++;
          pendingLinks.push({ key, relPath, convId: info.convId, msgTs: info.msgTs });

          if (seenKeys.has(key)) return;
          seenKeys.add(key);

          const size = Number(st.size);
          const mtimeMs = Number(st.mtimeMs);
          progress.bytes += size;

          const existing = qLookup.get(rootId, key) as { size: number; mtime_ms: number } | undefined;
          if (existing && existing.size === size && existing.mtime_ms === mtimeMs) {
            pendingItems.push({ key, size, mtimeMs, area: info.area });
            return;
          }
          if (existing) progress.changed++;
          else progress.newFiles++;

          const header = await readHeader(abs);
          const ext = path.extname(abs).toLowerCase();
          const detection = info.area === "fileNoise" ? detectNoise(header, ext) : detect(header, ext);
          pendingItems.push({ key, size, mtimeMs, area: info.area, detection });
        } catch {
          progress.errors++; // file bị khoá (EBUSY/EPERM), đường dẫn quá dài...
        }
      });

      if (pendingItems.length + pendingLinks.length >= batchSize) flush();

      const now = Date.now();
      if (onProgress && now - lastEmit > 250) {
        lastEmit = now;
        onProgress({ ...progress });
      }
    }

    flush();

    db.prepare("DELETE FROM links WHERE root_id = ? AND seen_scan_id < ?").run(rootId, scanId);
    const missing = db
      .prepare("UPDATE items SET status = 'missing' WHERE root_id = ? AND status = 'present' AND seen_scan_id < ?")
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

  // Báo ngay trạng thái đầu để client theo dõi (SSE) không gặp lúc chưa có tiến độ
  onProgress?.({ ...progress });
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
