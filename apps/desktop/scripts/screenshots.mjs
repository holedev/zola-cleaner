// Chụp ảnh giao diện cho README bằng dữ liệu demo (src/demo/mock.ts), không đụng tới dữ liệu Zalo thật.
// Chạy: pnpm --filter @zola-cleaner/desktop screenshots   (cần Chrome hoặc Edge; đặt CHROME_PATH nếu cài chỗ khác)
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { build, preview } from "vite";

const OUT = path.resolve(import.meta.dirname, "../../../docs/screenshots");
const SHOTS = [
  ["suggestions", "quick-clean.png"],
  ["conversations", "conversations.png"],
  ["jobs", "trash.png"],
  ["overview", "overview.png"],
];

const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!chrome) throw new Error("Không tìm thấy Chrome / Edge. Đặt biến CHROME_PATH.");

// Build sẵn bản demo rồi phục vụ file tĩnh: dev server của Vite tự tải lại trang khi tối ưu thư viện lần đầu,
// làm Chrome headless bị huỷ giữa chừng.
const root = path.resolve(import.meta.dirname, "..");
const work = mkdtempSync(path.join(tmpdir(), "zc-shots-"));
const dist = path.join(work, "dist");
const profile = path.join(work, "profile");
await build({ root, mode: "demo", logLevel: "warn", build: { outDir: dist, emptyOutDir: true } });
const server = await preview({ root, mode: "demo", logLevel: "warn", build: { outDir: dist }, preview: { port: 1430, strictPort: false } });
const base = server.resolvedUrls.local[0];
mkdirSync(OUT, { recursive: true });

try {
  for (const [tab, file] of SHOTS) {
    const out = path.join(OUT, file);
    // Gọi bất đồng bộ: server Vite chạy trong chính tiến trình này, chặn event loop thì nó không trả lời được Chrome
    await promisify(execFile)(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-component-update",
        `--user-data-dir=${profile}`,
        "--window-size=1600,1000",
        "--force-device-scale-factor=1",
        // Chạy 6 giây thời gian ảo trước khi chụp: đủ để dữ liệu giả về, debounce và hiệu ứng mờ dần chạy xong
        "--virtual-time-budget=6000",
        `--screenshot=${out}`,
        `${base}?tab=${tab}`,
      ],
      { timeout: 60_000 },
    );
    if (!existsSync(out)) throw new Error(`Chrome không ghi được ${file}`);
    console.log("✓", path.relative(process.cwd(), out));
  }
} finally {
  await new Promise((r) => server.httpServer.close(r));
  rmSync(work, { recursive: true, force: true });
}
