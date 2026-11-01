import type { Db } from "./db.ts";
import { CLEANABLE_AREAS, isGroupConversation } from "./layout.ts";

export interface Bucket {
  key: string;
  count: number;
  bytes: number;
}

export interface LargeFile {
  id: number;
  relPath: string;
  size: number;
  ts: number;
  category: string;
  kind: string;
}

export interface Stats {
  /** Đếm theo Media Item → hardlink không bị đếm trùng. */
  total: { count: number; bytes: number };
  byCategory: Bucket[];
  byArea: Bucket[];
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

/** Tuổi của Media Item: Message Time nếu biết, nếu không thì mtime. */
export const ITEM_TS = "COALESCE(i.msg_ts, i.mtime_ms)";

/** Một Link đại diện để hiển thị: ưu tiên Link kho (không nằm trong resource/). */
export const DISPLAY_PATH =
  "(SELECT l.rel_path FROM links l WHERE l.item_id = i.id ORDER BY l.rel_path LIKE 'resource/%', l.rel_path LIMIT 1)";

const sqlList = (xs: readonly string[]) => xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(", ");
export const CLEANABLE_AREAS_SQL = sqlList(CLEANABLE_AREAS);

/** Thống kê các Media Item còn hiện diện. */
export function getStats(db: Db, opts: { rootId?: number; largestLimit?: number } = {}): Stats {
  const { rootId, largestLimit = 20 } = opts;
  const where = rootId == null ? "i.status = 'present'" : "i.status = 'present' AND i.root_id = ?";
  const params = rootId == null ? [] : [rootId];

  const total = db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM items i WHERE ${where}`)
    .get(...params) as { count: number; bytes: number };

  const group = (keyExpr: string, extra = "") =>
    db
      .prepare(
        `SELECT ${keyExpr} AS key, COUNT(*) AS count, SUM(size) AS bytes FROM items i WHERE ${where}
         GROUP BY key ${extra}`,
      )
      .all(...params) as unknown as Bucket[];

  const now = Date.now();
  const ageCase =
    "CASE " +
    AGE_BUCKETS.map(([label, days]) => `WHEN ${ITEM_TS} >= ${now - days * DAY} THEN '${label}'`).join(" ") +
    " ELSE '> 2 năm' END";
  const ageOrder = [...AGE_BUCKETS.map(([l]) => l), "> 2 năm"];

  const largest = db
    .prepare(
      `SELECT i.id, ${DISPLAY_PATH} AS relPath, i.size, ${ITEM_TS} AS ts, i.category, i.kind
       FROM items i WHERE ${where} ORDER BY i.size DESC LIMIT ?`,
    )
    .all(...params, largestLimit) as unknown as LargeFile[];

  return {
    total,
    byCategory: group("category", "ORDER BY bytes DESC"),
    byArea: group("area", "ORDER BY bytes DESC"),
    byMonth: group(`strftime('%Y-%m', ${ITEM_TS} / 1000, 'unixepoch')`, "ORDER BY key"),
    byAge: group(ageCase).sort((a, b) => ageOrder.indexOf(a.key) - ageOrder.indexOf(b.key)),
    largest,
  };
}

export interface ConversationSummary {
  convId: string;
  isGroup: boolean;
  alias: string | null;
  items: number;
  /** Tổng dung lượng media dọn được của hội thoại. */
  bytes: number;
  /** Phần chỉ thuộc riêng hội thoại này (không phải Shared Media Item). */
  ownBytes: number;
  imageBytes: number;
  videoBytes: number;
  documentBytes: number;
  otherBytes: number;
  lastTs: number | null;
  /** Vài ảnh mới nhất, để người dùng nhận ra hội thoại. */
  thumbIds: number[];
}

/** Danh sách Conversation, xếp theo dung lượng media dọn được (chỉ tính thư mục kho được phép dọn). */
export function listConversations(db: Db, rootId: number, thumbs = 8): ConversationSummary[] {
  const rows = db
    .prepare(
      `WITH ci AS (
         SELECT DISTINCT l.conv_id, l.item_id FROM links l JOIN items i ON i.id = l.item_id
         WHERE l.root_id = ? AND l.conv_id IS NOT NULL AND i.status = 'present' AND i.area IN (${CLEANABLE_AREAS_SQL})
       ),
       shared AS (SELECT item_id, COUNT(*) AS n FROM ci GROUP BY item_id)
       SELECT ci.conv_id AS convId, c.alias, COUNT(*) AS items, SUM(i.size) AS bytes,
         SUM(CASE WHEN s.n = 1 THEN i.size ELSE 0 END) AS ownBytes,
         SUM(CASE WHEN i.category = 'image' THEN i.size ELSE 0 END) AS imageBytes,
         SUM(CASE WHEN i.category = 'video' THEN i.size ELSE 0 END) AS videoBytes,
         SUM(CASE WHEN i.category IN ('document', 'archive') THEN i.size ELSE 0 END) AS documentBytes,
         SUM(CASE WHEN i.category NOT IN ('image', 'video', 'document', 'archive') THEN i.size ELSE 0 END) AS otherBytes,
         MAX(${ITEM_TS}) AS lastTs
       FROM ci JOIN items i ON i.id = ci.item_id JOIN shared s ON s.item_id = ci.item_id
       LEFT JOIN conversations c ON c.root_id = ? AND c.conv_id = ci.conv_id
       GROUP BY ci.conv_id ORDER BY bytes DESC`,
    )
    .all(rootId, rootId) as unknown as Omit<ConversationSummary, "isGroup" | "thumbIds">[];

  const thumbRows = db
    .prepare(
      `SELECT conv_id, id FROM (
         SELECT l.conv_id, i.id, ROW_NUMBER() OVER (
           -- ưu tiên ảnh trình duyệt hiển thị được (JPEG XL thì không), rồi mới nhất
           PARTITION BY l.conv_id ORDER BY i.kind IN ('jpg', 'png', 'gif', 'webp') DESC, ${ITEM_TS} DESC
         ) AS rn
         FROM links l JOIN items i ON i.id = l.item_id
         WHERE l.root_id = ? AND l.conv_id IS NOT NULL AND i.status = 'present'
           AND i.area = 'picture' AND i.category = 'image'
         GROUP BY l.conv_id, i.id
       ) WHERE rn <= ?`,
    )
    .all(rootId, thumbs) as { conv_id: string; id: number }[];
  const thumbsByConv = new Map<string, number[]>();
  for (const t of thumbRows) {
    const list = thumbsByConv.get(t.conv_id) ?? [];
    list.push(t.id);
    thumbsByConv.set(t.conv_id, list);
  }

  return rows.map((r) => ({
    ...r,
    isGroup: isGroupConversation(r.convId),
    thumbIds: thumbsByConv.get(r.convId) ?? [],
  }));
}

/** Đặt (hoặc xoá, nếu rỗng) Alias của một Conversation. */
export function setAlias(db: Db, rootId: number, convId: string, alias: string | null): void {
  const value = alias?.trim() || null;
  db.prepare(
    `INSERT INTO conversations (root_id, conv_id, alias) VALUES (?, ?, ?)
     ON CONFLICT (root_id, conv_id) DO UPDATE SET alias = excluded.alias`,
  ).run(rootId, convId, value);
}
