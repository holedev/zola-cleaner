import type { Db } from "./db.ts";

export interface Bucket {
  key: string;
  count: number;
  bytes: number;
}

export interface LargeFile {
  id: number;
  rootPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  category: string;
  kind: string;
}

export interface Stats {
  total: { count: number; bytes: number };
  byCategory: Bucket[];
  byTopDir: Bucket[];
  byMonth: Bucket[];
  byAge: Bucket[];
  largest: LargeFile[];
}

const DAY = 86_400_000;
const AGE_BUCKETS: [string, number][] = [
  ["< 30 ngày", 30],
  ["1–3 tháng", 90],
  ["3–6 tháng", 180],
  ["6–12 tháng", 365],
  ["1–2 năm", 730],
];

/** Thống kê các file còn hiện diện (status = 'present'). */
export function getStats(db: Db, opts: { rootId?: number; topDirLimit?: number; largestLimit?: number } = {}): Stats {
  const { rootId, topDirLimit = 20, largestLimit = 20 } = opts;
  const where = rootId == null ? "status = 'present'" : "status = 'present' AND root_id = ?";
  const params = rootId == null ? [] : [rootId];

  const total = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE ${where}`).get(
    ...params,
  ) as { count: number; bytes: number };

  const group = (keyExpr: string, extra = "") =>
    db
      .prepare(
        `SELECT ${keyExpr} AS key, COUNT(*) AS count, SUM(size) AS bytes FROM files WHERE ${where}
         GROUP BY key ${extra}`,
      )
      .all(...params) as unknown as Bucket[];

  const now = Date.now();
  const ageCase =
    "CASE " +
    AGE_BUCKETS.map(([label, days]) => `WHEN mtime_ms >= ${now - days * DAY} THEN '${label}'`).join(" ") +
    " ELSE '> 2 năm' END";
  const ageOrder = [...AGE_BUCKETS.map(([l]) => l), "> 2 năm"];

  const largest = db
    .prepare(
      `SELECT f.id, r.path AS rootPath, f.rel_path AS relPath, f.size, f.mtime_ms AS mtimeMs, f.category, f.kind
       FROM files f JOIN roots r ON r.id = f.root_id
       WHERE ${where.replaceAll("status", "f.status").replace("root_id", "f.root_id")}
       ORDER BY f.size DESC LIMIT ?`,
    )
    .all(...params, largestLimit) as unknown as LargeFile[];

  return {
    total,
    byCategory: group("category", "ORDER BY bytes DESC"),
    byTopDir: group("top_dir", `ORDER BY bytes DESC LIMIT ${Number(topDirLimit)}`),
    byMonth: group("strftime('%Y-%m', mtime_ms / 1000, 'unixepoch')", "ORDER BY key"),
    byAge: group(ageCase).sort((a, b) => ageOrder.indexOf(a.key) - ageOrder.indexOf(b.key)),
    largest,
  };
}
