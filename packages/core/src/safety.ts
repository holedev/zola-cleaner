import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Category } from "./detect.ts";

const execFileAsync = promisify(execFile);

/** Loại file mặc định được phép cách ly/xoá. */
export const DEFAULT_DELETABLE: readonly Category[] = ["image", "video"];

/** Loại file KHÔNG BAO GIỜ được xoá, kể cả khi người dùng chọn. */
export const PROTECTED: readonly Category[] = ["database"];

/** Đuôi file không bao giờ đụng tới (CSDL, log, cấu hình của Zalo/Electron). */
export const PROTECTED_EXTENSIONS = new Set([".db", ".db-wal", ".db-shm", ".sqlite", ".ldb", ".log", ".json", ".ini"]);

export function isDeletable(category: string, ext: string, allowed: readonly string[] = DEFAULT_DELETABLE): boolean {
  if ((PROTECTED as readonly string[]).includes(category)) return false;
  if (PROTECTED_EXTENSIONS.has(ext.toLowerCase())) return false;
  return allowed.includes(category);
}

/** Zalo PC có đang chạy không (chỉ kiểm tra trên Windows). */
export async function isZaloRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Zalo.exe", "/NH"], { windowsHide: true });
    return /zalo\.exe/i.test(stdout);
  } catch {
    return false;
  }
}
