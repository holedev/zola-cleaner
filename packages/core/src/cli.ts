/**
 * CLI khảo sát (Giai đoạn 0): quét một thư mục và in báo cáo.
 *   pnpm scan "D:\ZaloData"
 *   pnpm scan "D:\ZaloData" --db data/survey.db
 */
import path from "node:path";
import { addRoot, openDb } from "./db.ts";
import { formatBytes } from "./format.ts";
import { startScan } from "./scan.ts";
import { getStats, type Bucket } from "./stats.ts";

const [, , cmd, dir, ...rest] = process.argv;
const dbFlag = rest.indexOf("--db");
const dbFile = path.resolve(dbFlag >= 0 && rest[dbFlag + 1] ? rest[dbFlag + 1]! : "data/zalo-cleaner.db");

if (cmd !== "scan" || !dir) {
  console.log('Cách dùng: pnpm scan "<thư mục>" [--db <file.db>]');
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
console.log(`\nTổng: ${s.total.count.toLocaleString()} file, ${formatBytes(s.total.bytes)} (lỗi: ${result.errors})`);
table("Theo loại", s.byCategory);
table("Theo thư mục", s.byTopDir);
table("Theo tuổi (ngày sửa đổi)", s.byAge);
console.log("\n== File lớn nhất ==");
console.table(
  s.largest.map((f) => ({ file: f.relPath, loại: `${f.category}/${f.kind}`, "dung lượng": formatBytes(f.size) })),
);
