/**
 * Dọn dẹp an toàn: Preview → Quarantine Job → Restore | Purge. Xem docs/PLAN.md mục 3 và ADR 0001.
 *
 * Đơn vị là Media Item (file vật lý) chứ không phải đường dẫn:
 * - Cách ly = rename MỘT Link vào thư mục cách ly + gỡ các Link còn lại (mọi Link đều được ghi vào job_items TRƯỚC).
 * - Restore = rename ngược + tạo lại hardlink cho các Link còn lại.
 * - Purge = xoá file trong thư mục cách ly → lúc này dung lượng mới thật sự được giải phóng.
 */
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, getRoot, tx } from "./db.ts";
import { DEFAULT_DELETABLE, isZaloRunning, PROTECTED } from "./safety.ts";
import { type Bucket, CLEANABLE_AREAS_SQL, DISPLAY_PATH, ITEM_TS } from "./stats.ts";

const DAY = 86_400_000;
export const DEFAULT_RETENTION_DAYS = 7;
const BATCH = 500;

export interface CleanupFilter {
  rootId: number;
  /** Conversation được chọn. Rỗng/không có → không lọc theo hội thoại. */
  convIds?: string[];
  /** Media Kind được chọn. Mặc định ảnh + video. */
  categories?: string[];
  /** Chỉ Media Item có Message Time cũ hơn N ngày. */
  olderThanDays?: number;
  /** Chỉ Media Item lớn hơn hoặc bằng N byte. */
  minSize?: number;
}

export interface CleanupSample {
  id: number;
  relPath: string;
  size: number;
  ts: number;
  category: string;
  kind: string;
}

export interface CleanupPreview {
  count: number;
  bytes: number;
  /** Shared Media Item bị bỏ qua vì còn thuộc hội thoại không được chọn. */
  skippedShared: { count: number; bytes: number };
  byCategory: Bucket[];
  samples: CleanupSample[];
}

export interface JobOptions {
  /** Thư mục chứa các Quarantine Job. Phải cùng ổ đĩa với Media Store. */
  quarantineBase?: string;
  retentionDays?: number;
  /** Từ chối nếu Zalo đang chạy. Chỉ tắt trong test. */
  checkZalo?: boolean;
}

export interface Job {
  id: number;
  root_id: number;
  filter_json: string;
  status: "running" | "quarantined" | "restored" | "purged" | "failed";
  created_at: number;
  finished_at: number | null;
  expires_at: number;
  item_count: number;
  total_bytes: number;
  quarantine_dir: string;
}

export interface JobResult {
  jobId: number;
  moved: number;
  failed: number;
  bytes: number;
}

interface StoredLink {
  relPath: string;
  convId: string | null;
}

interface JobItemRow {
  item_id: number;
  links_json: string;
  quarantine_path: string;
  size: number;
  state: string;
}

export function defaultQuarantineBase(): string {
  return path.join(process.env.APPDATA ?? os.homedir(), "zalo-cleaner", "quarantine");
}

/** Mệnh đề WHERE chọn Media Item khớp bộ lọc (chưa loại Shared Media Item). */
function candidateWhere(filter: CleanupFilter): { sql: string; params: (string | number)[] } {
  const categories = (filter.categories ?? DEFAULT_DELETABLE).filter((c) => !(PROTECTED as string[]).includes(c));
  const parts = [
    "i.root_id = ?",
    "i.status = 'present'",
    `i.area IN (${CLEANABLE_AREAS_SQL})`,
    "i.category IN (SELECT value FROM json_each(?))",
  ];
  const params: (string | number)[] = [filter.rootId, JSON.stringify(categories)];
  if (filter.olderThanDays != null && filter.olderThanDays > 0) {
    parts.push(`${ITEM_TS} < ?`);
    params.push(Date.now() - filter.olderThanDays * DAY);
  }
  if (filter.minSize != null && filter.minSize > 0) {
    parts.push("i.size >= ?");
    params.push(filter.minSize);
  }
  if (filter.convIds?.length) {
    parts.push(
      "EXISTS (SELECT 1 FROM links l WHERE l.item_id = i.id AND l.conv_id IN (SELECT value FROM json_each(?)))",
    );
    params.push(JSON.stringify(filter.convIds));
  }
  return { sql: parts.join(" AND "), params };
}

/** Điều kiện "còn thuộc hội thoại không được chọn" → Shared Media Item phải giữ lại. */
function sharedCond(filter: CleanupFilter): { sql: string; params: string[] } {
  if (!filter.convIds?.length) return { sql: "0", params: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM links l WHERE l.item_id = i.id AND l.conv_id IS NOT NULL
            AND l.conv_id NOT IN (SELECT value FROM json_each(?)))`,
    params: [JSON.stringify(filter.convIds)],
  };
}

/** Chạy thử: không thay đổi gì trên đĩa. */
export function previewCleanup(db: Db, filter: CleanupFilter, sampleLimit = 20): CleanupPreview {
  const w = candidateWhere(filter);
  const s = sharedCond(filter);
  const base = `FROM items i WHERE ${w.sql}`;

  const totals = db
    .prepare(
      `SELECT ${s.sql} AS shared, COUNT(*) AS count, COALESCE(SUM(i.size), 0) AS bytes ${base} GROUP BY shared`,
    )
    .all(...s.params, ...w.params) as { shared: number; count: number; bytes: number }[];
  const take = totals.find((t) => !t.shared) ?? { count: 0, bytes: 0 };
  const skip = totals.find((t) => t.shared) ?? { count: 0, bytes: 0 };

  const byCategory = db
    .prepare(
      `SELECT i.category AS key, COUNT(*) AS count, SUM(i.size) AS bytes ${base} AND NOT ${s.sql}
       GROUP BY i.category ORDER BY bytes DESC`,
    )
    .all(...w.params, ...s.params) as unknown as Bucket[];

  const samples = db
    .prepare(
      `SELECT i.id, ${DISPLAY_PATH} AS relPath, i.size, ${ITEM_TS} AS ts, i.category, i.kind
       ${base} AND NOT ${s.sql} ORDER BY i.size DESC LIMIT ?`,
    )
    .all(...w.params, ...s.params, sampleLimit) as unknown as CleanupSample[];

  return {
    count: take.count,
    bytes: take.bytes,
    skippedShared: { count: skip.count, bytes: skip.bytes },
    byCategory,
    samples,
  };
}

function driveOf(p: string): string {
  return path.parse(path.resolve(p)).root.toLowerCase();
}

/** Link kho đứng trước Link trong resource/ → đó là Link được rename vào thư mục cách ly. */
function orderLinks(links: StoredLink[]): StoredLink[] {
  return [...links].sort(
    (a, b) => Number(a.relPath.startsWith("resource/")) - Number(b.relPath.startsWith("resource/")),
  );
}

const absOf = (rootPath: string, relPath: string) => path.join(rootPath, ...relPath.split("/"));

function sameFile(a: string, b: string): boolean {
  const sa = statSync(a, { bigint: true });
  const sb = statSync(b, { bigint: true });
  return sa.dev === sb.dev && sa.ino === sb.ino;
}

/** So sánh nội dung hai file theo từng khối (video có thể lớn, không đọc cả file vào bộ nhớ). */
function sameContent(a: string, b: string): boolean {
  if (statSync(a).size !== statSync(b).size) return false;
  const fa = openSync(a, "r");
  const fb = openSync(b, "r");
  try {
    const ba = Buffer.alloc(1 << 20);
    const bb = Buffer.alloc(1 << 20);
    for (;;) {
      const na = readSync(fa, ba, 0, ba.length, null);
      const nb = readSync(fb, bb, 0, bb.length, null);
      if (na !== nb || !ba.subarray(0, na).equals(bb.subarray(0, nb))) return false;
      if (na === 0) return true;
    }
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}

/**
 * Đưa một Media Item về đủ mọi Link ban đầu. Idempotent: chạy lại sau khi bị ngắt giữa chừng vẫn đúng.
 * Trong lúc cách ly, Zalo có thể đã tải lại đúng ảnh đó (từ Cloud) vào một Link cũ — file mới, nlink 1.
 * Cùng nội dung → thay bằng Link tới bản gốc (không để hai bản). Khác nội dung → giữ file của Zalo.
 */
function restoreLinks(rootPath: string, links: StoredLink[], quarantinePath: string): void {
  const [primary, ...others] = links.map((l) => absOf(rootPath, l.relPath));
  if (!primary) return;
  if (existsSync(quarantinePath)) {
    if (existsSync(primary)) {
      if (!sameContent(primary, quarantinePath)) throw new Error(`Đã có file khác ở ${primary}`);
      unlinkSync(primary);
    }
    mkdirSync(path.dirname(primary), { recursive: true });
    renameSync(quarantinePath, primary);
  }
  if (!existsSync(primary)) throw new Error(`Mất file trong thư mục cách ly: ${quarantinePath}`);
  for (const other of others) {
    if (existsSync(other)) {
      if (sameFile(primary, other) || !sameContent(primary, other)) continue;
      unlinkSync(other);
    }
    mkdirSync(path.dirname(other), { recursive: true });
    linkSync(primary, other);
  }
}

async function assertZaloClosed(opts: JobOptions): Promise<void> {
  if ((opts.checkZalo ?? true) && (await isZaloRunning())) {
    throw new Error("Zalo đang chạy — hãy thoát hẳn Zalo (cả biểu tượng ở khay hệ thống) rồi thử lại.");
  }
}

/** Tạo Quarantine Job cho các Media Item khớp bộ lọc (bỏ qua Shared Media Item). */
export async function quarantine(db: Db, filter: CleanupFilter, opts: JobOptions = {}): Promise<JobResult> {
  await assertZaloClosed(opts);
  const root = getRoot(db, filter.rootId);
  if (!root) throw new Error(`Không tìm thấy root #${filter.rootId}`);

  const base = path.resolve(opts.quarantineBase ?? defaultQuarantineBase());
  if (driveOf(base) !== driveOf(root.path)) {
    throw new Error(`Thư mục cách ly (${base}) phải cùng ổ đĩa với ${root.path}`);
  }

  const w = candidateWhere(filter);
  const s = sharedCond(filter);
  const items = db
    .prepare(`SELECT i.id, i.size FROM items i WHERE ${w.sql} AND NOT ${s.sql} ORDER BY i.id`)
    .all(...w.params, ...s.params) as { id: number; size: number }[];

  const now = Date.now();
  const retention = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const jobId = Number(
    db
      .prepare(
        `INSERT INTO jobs (root_id, filter_json, status, created_at, expires_at, quarantine_dir)
         VALUES (?, ?, 'running', ?, ?, '')`,
      )
      .run(root.id, JSON.stringify(filter), now, now + retention * DAY).lastInsertRowid,
  );
  const jobDir = path.join(base, String(jobId));
  db.prepare("UPDATE jobs SET quarantine_dir = ? WHERE id = ?").run(jobDir, jobId);
  mkdirSync(jobDir, { recursive: true });

  const qLinks = db.prepare("SELECT rel_path AS relPath, conv_id AS convId FROM links WHERE item_id = ?");
  const qInsert = db.prepare(
    `INSERT INTO job_items (job_id, item_id, links_json, quarantine_path, size, state) VALUES (?, ?, ?, ?, ?, 'pending')`,
  );
  const qState = db.prepare("UPDATE job_items SET state = ?, error = ? WHERE job_id = ? AND item_id = ?");
  const qItemStatus = db.prepare("UPDATE items SET status = ? WHERE id = ?");
  const qDropLinks = db.prepare("DELETE FROM links WHERE item_id = ?");

  const result: JobResult = { jobId, moved: 0, failed: 0, bytes: 0 };

  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH);

    // 1. Ghi nhật ký TRƯỚC khi đụng vào đĩa
    const planned = tx(db, () =>
      batch.flatMap((it) => {
        const links = orderLinks(qLinks.all(it.id) as unknown as StoredLink[]);
        if (links.length === 0) return [];
        const quarantinePath = absOf(jobDir, links[0]!.relPath);
        qInsert.run(jobId, it.id, JSON.stringify(links), quarantinePath, it.size);
        return [{ ...it, links, quarantinePath }];
      }),
    );

    // 2. Di chuyển trên đĩa
    const outcomes = planned.map((p) => {
      const [primary, ...others] = p.links.map((l) => absOf(root.path, l.relPath));
      try {
        mkdirSync(path.dirname(p.quarantinePath), { recursive: true });
        renameSync(primary!, p.quarantinePath);
        try {
          for (const other of others) {
            try {
              unlinkSync(other);
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            }
          }
        } catch (err) {
          restoreLinks(root.path, p.links, p.quarantinePath); // không để Media Item ở trạng thái nửa vời
          throw err;
        }
        return { ...p, error: null };
      } catch (err) {
        return { ...p, error: (err as Error).message };
      }
    });

    // 3. Cập nhật nhật ký + chỉ mục
    tx(db, () => {
      for (const o of outcomes) {
        if (o.error) {
          qState.run("failed", o.error, jobId, o.id);
          result.failed++;
        } else {
          qState.run("moved", null, jobId, o.id);
          qItemStatus.run("quarantined", o.id);
          qDropLinks.run(o.id);
          result.moved++;
          result.bytes += o.size;
        }
      }
    });
  }

  db.prepare(
    `UPDATE jobs SET status = ?, finished_at = ?, item_count = ?, total_bytes = ? WHERE id = ?`,
  ).run(result.moved > 0 || result.failed === 0 ? "quarantined" : "failed", Date.now(), result.moved, result.bytes, jobId);
  return result;
}

function getJob(db: Db, jobId: number): Job {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as unknown as Job | undefined;
  if (!job) throw new Error(`Không tìm thấy job #${jobId}`);
  return job;
}

export function listJobs(db: Db, rootId?: number): Job[] {
  return (
    rootId == null
      ? db.prepare("SELECT * FROM jobs ORDER BY id DESC").all()
      : db.prepare("SELECT * FROM jobs WHERE root_id = ? ORDER BY id DESC").all(rootId)
  ) as unknown as Job[];
}

/** Restore: đưa mọi Media Item của job về đúng các Link ban đầu. */
export async function restoreJob(db: Db, jobId: number, opts: JobOptions = {}): Promise<JobResult> {
  await assertZaloClosed(opts);
  const job = getJob(db, jobId);
  if (job.status !== "quarantined" && job.status !== "failed") {
    throw new Error(`Job #${jobId} đang ở trạng thái '${job.status}', không khôi phục được`);
  }
  const root = getRoot(db, job.root_id);
  if (!root) throw new Error(`Không tìm thấy root #${job.root_id}`);

  const rows = db
    .prepare("SELECT * FROM job_items WHERE job_id = ? AND state = 'moved'")
    .all(jobId) as unknown as JobItemRow[];
  const qItem = db.prepare("SELECT seen_scan_id FROM items WHERE id = ?");
  const qLink = db.prepare(
    // Link có thể đang trỏ tới bản Zalo tải lại (nếu đã quét lại) → trỏ về Media Item gốc; lần quét sau tự đánh dấu bản kia missing
    `INSERT INTO links (item_id, root_id, rel_path, conv_id, seen_scan_id) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (root_id, rel_path) DO UPDATE SET item_id = excluded.item_id`,
  );
  const result: JobResult = { jobId, moved: 0, failed: 0, bytes: 0 };

  for (const row of rows) {
    const links = JSON.parse(row.links_json) as StoredLink[];
    try {
      restoreLinks(root.path, links, row.quarantine_path);
    } catch (err) {
      db.prepare("UPDATE job_items SET error = ? WHERE job_id = ? AND item_id = ?").run(
        (err as Error).message,
        jobId,
        row.item_id,
      );
      result.failed++;
      continue;
    }
    tx(db, () => {
      const seen = (qItem.get(row.item_id) as { seen_scan_id: number }).seen_scan_id;
      for (const l of links) qLink.run(row.item_id, root.id, l.relPath, l.convId, seen);
      db.prepare("UPDATE items SET status = 'present' WHERE id = ?").run(row.item_id);
      db.prepare("UPDATE job_items SET state = 'restored', error = NULL WHERE job_id = ? AND item_id = ?").run(
        jobId,
        row.item_id,
      );
    });
    result.moved++;
    result.bytes += row.size;
  }

  if (result.failed === 0) {
    db.prepare("UPDATE jobs SET status = 'restored', finished_at = ? WHERE id = ?").run(Date.now(), jobId);
    rmSync(job.quarantine_dir, { recursive: true, force: true });
  }
  return result;
}

/** Purge: xoá vĩnh viễn các Media Item của job. Không cần tắt Zalo vì file đã nằm ngoài ZaloData. */
export function purgeJob(db: Db, jobId: number): JobResult {
  const job = getJob(db, jobId);
  if (job.status !== "quarantined" && job.status !== "failed") {
    throw new Error(`Job #${jobId} đang ở trạng thái '${job.status}', không xoá được`);
  }
  const rows = db
    .prepare("SELECT * FROM job_items WHERE job_id = ? AND state = 'moved'")
    .all(jobId) as unknown as JobItemRow[];
  const result: JobResult = { jobId, moved: 0, failed: 0, bytes: 0 };

  for (const row of rows) {
    try {
      rmSync(row.quarantine_path, { force: true });
    } catch (err) {
      db.prepare("UPDATE job_items SET error = ? WHERE job_id = ? AND item_id = ?").run(
        (err as Error).message,
        jobId,
        row.item_id,
      );
      result.failed++;
      continue;
    }
    tx(db, () => {
      db.prepare("UPDATE items SET status = 'deleted' WHERE id = ?").run(row.item_id);
      db.prepare("UPDATE job_items SET state = 'purged' WHERE job_id = ? AND item_id = ?").run(jobId, row.item_id);
    });
    result.moved++;
    result.bytes += row.size;
  }

  if (result.failed === 0) {
    rmSync(job.quarantine_dir, { recursive: true, force: true });
    db.prepare("UPDATE jobs SET status = 'purged', finished_at = ? WHERE id = ?").run(Date.now(), jobId);
  }
  return result;
}

/** Tự Purge các job đã hết Retention. Gọi khi server khởi động. */
export function purgeExpired(db: Db, now = Date.now()): JobResult[] {
  const ids = db
    .prepare("SELECT id FROM jobs WHERE status = 'quarantined' AND expires_at <= ?")
    .all(now) as { id: number }[];
  return ids.map(({ id }) => purgeJob(db, id));
}
