/**
 * Tự cập nhật qua GitHub Releases. Chỉ kết nối GitHub để đọc latest.json, không gửi dữ liệu nào của người dùng.
 * Bản mới chỉ được tải và cài khi người dùng bấm "Cập nhật".
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

/** Hỏi người dùng có cài bản mới không; cài xong thì mở lại app. */
export function offerUpdate(update: Update) {
  toast.info(`Có bản mới ${update.version}`, {
    description: "Bấm Cập nhật để tải và cài. App sẽ tự mở lại.",
    duration: Infinity,
    action: { label: "Cập nhật", onClick: () => void install(update) },
  });
}

async function install(update: Update) {
  const id = toast.loading(`Đang tải bản ${update.version}…`);
  try {
    await update.downloadAndInstall();
    toast.success("Đã cài xong, đang mở lại app…", { id });
    await relaunch();
  } catch (e) {
    toast.error(`Cập nhật thất bại: ${errorMessage(e)}`, { id });
  }
}

/** Kiểm tra bản mới. `quiet`: lỗi mạng / không có bản mới thì im lặng (lúc mở app). */
export async function checkForUpdate(quiet: boolean) {
  try {
    const update = await check();
    if (update) offerUpdate(update);
    else if (!quiet) toast.success("Bạn đang dùng bản mới nhất.");
  } catch (e) {
    if (!quiet) toast.error(`Không kiểm tra được bản mới: ${errorMessage(e)}`);
  }
}
