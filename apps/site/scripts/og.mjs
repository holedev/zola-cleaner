// Chụp ảnh xem trước khi chia sẻ link (Open Graph, 1200×630) từ trang /og/<lang>/ vào public/og-<lang>.png.
// Chạy lại khi đổi câu chữ hero hoặc ảnh chụp app: pnpm --filter @zola-cleaner/site og
// Cần Chrome hoặc Edge; đặt CHROME_PATH nếu cài chỗ khác.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { build, preview } from "astro";

const root = path.resolve(import.meta.dirname, "..");
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!chrome) throw new Error("Không tìm thấy Chrome / Edge. Đặt biến CHROME_PATH.");

await build({ root, logLevel: "warn" });
const server = await preview({ root, logLevel: "warn", server: { port: 4322 } });

try {
  for (const lang of ["vi", "en"]) {
    const out = path.join(root, "public", `og-${lang}.png`);
    const { stderr } = await promisify(execFile)(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-sandbox",
        "--window-size=1200,630",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=3000",
        `--screenshot=${out}`,
        `http://localhost:${server.port}/zola-cleaner/og/${lang}/`,
      ],
      { timeout: 60_000 },
    );
    if (!existsSync(out)) throw new Error(`Chrome không ghi được og-${lang}.png\n${stderr}`);
    console.log("✓", path.relative(process.cwd(), out));
  }
} finally {
  await server.stop();
}
