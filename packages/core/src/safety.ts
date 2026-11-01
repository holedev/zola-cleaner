import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Category } from "./detect.ts";

const execFileAsync = promisify(execFile);

/** Media Kind được chọn sẵn khi dọn. Tài liệu (document/archive) phải tự tick. */
export const DEFAULT_DELETABLE: readonly Category[] = ["image", "video"];

/** Media Kind người dùng được phép chọn. */
export const SELECTABLE: readonly Category[] = ["image", "video", "audio", "document", "archive", "other"];

/** Loại file KHÔNG BAO GIỜ được xoá, kể cả khi người dùng chọn. Thư mục kho được dọn: CLEANABLE_AREAS (layout.ts). */
export const PROTECTED: readonly Category[] = ["database"];

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
