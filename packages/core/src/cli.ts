/**
 * CLI khảo sát (Giai đoạn 0): quét một thư mục và in báo cáo.
 *   pnpm scan                       (tự tìm %APPDATA%\ZaloData\media\<uid>\ZaloDownloads)
 *   pnpm scan "<ZaloDownloads>" --db data/survey.db
 */
import path from "node:path";
import { addRoot, openDb } from "./db.ts";
import { formatBytes } from "./format.ts";
import { detectMediaStores } from "./layout.ts";
import { startScan } from "./scan.ts";
import { getStats, listConversations, type Bucket } from "./stats.ts";

const [, , cmd, ...args] = process.argv;
const dbFlag = args.indexOf("--db");
const dbFile = path.resolve(dbFlag >= 0 && args[dbFlag + 1] ? args[dbFlag + 1]! : "data/zalo-cleaner.db");
const dir = (dbFlag === 0 ? undefined : args[0]) ?? detectMediaStores()[0];

if (cmd !== "scan" || !dir) {
  console.log('Cách dùng: pnpm scan ["<ZaloDownloads>"] [--db <file.db>]');
  process.exit(1);
}

const table = (title: string, rows: Bucket[]) => {
  console.log(`\n== ${title} ==`);
  console.table(rows.map((r) => ({ nhóm: r.key, "số file": r.count, "dung lượng": formatBytes(r.bytes) })));
};

const db = openDb(dbFile);
const root = addRoot(db, dir);
console.log(`Quét: ${root.path}\nCSDL: ${dbFile}\n`);

const started = Date.now();
const { done } = startScan(db, root.id, {
  onProgress: (p) =>
    process.stderr.write(
      `\r  ${p.seen.toLocaleString()} file · ${formatBytes(p.bytes)} · mới ${p.newFiles} · đổi ${p.changed} · lỗi ${p.errors}   `,
    ),
});
const result = await done;
process.stderr.write("\n");
console.log(`Xong sau ${((Date.now() - started) / 1000).toFixed(1)} giây.`);

const s = getStats(db, { rootId: root.id });
console.log(
  `\nTổng: ${s.total.count.toLocaleString()} Media Item, ${formatBytes(s.total.bytes)} (lỗi: ${result.errors})`,
);
table("Theo loại", s.byCategory);
table("Theo thư mục kho", s.byArea);
table("Theo tuổi (thời điểm tin nhắn)", s.byAge);
console.log("\n== File lớn nhất ==");
console.table(
  s.largest.map((f) => ({ file: f.relPath, loại: `${f.category}/${f.kind}`, "dung lượng": formatBytes(f.size) })),
);

const convs = listConversations(db, root.id);
console.log(`\n== Hội thoại (${convs.length}) — 20 lớn nhất ==`);
console.table(
  convs.slice(0, 20).map((c) => ({
    "hội thoại": c.convId,
    "số file": c.items,
    tổng: formatBytes(c.bytes),
    riêng: formatBytes(c.ownBytes),
    ảnh: formatBytes(c.imageBytes),
    video: formatBytes(c.videoBytes),
    "tài liệu": formatBytes(c.documentBytes),
  })),
);
