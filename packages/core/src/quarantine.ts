/**
 * Giai đoạn 3 — Dọn dẹp an toàn. CHƯA CÀI ĐẶT, xem docs/PLAN.md mục 3 và 8.
 *
 * Thiết kế:
 * 1. preview(filter): đếm file + tổng dung lượng + vài ví dụ, KHÔNG thay đổi gì.
 * 2. quarantine(filter):
 *    - Từ chối nếu isZaloRunning().
 *    - Tạo job; thư mục cách ly = <thư mục cha của root>/_zalo_quarantine/<jobId>/ (cùng ổ đĩa → rename tức thời).
 *    - Với từng file: ghi job_items(state='pending') TRƯỚC, rồi rename, rồi cập nhật state='moved'
 *      và files.status='quarantined'. Lỗi EXDEV → copyFile + unlink. Lỗi EBUSY/EPERM → state='failed'.
 *    - Chỉ xử lý file mà isDeletable(category, ext) === true.
 * 3. restore(jobId): rename ngược các item 'moved'; bỏ qua nếu đường dẫn gốc đã có file.
 * 4. purge(jobId): xoá thư mục cách ly của job, files.status='deleted', job_items.state='purged'.
 * 5. Tự purge các job quá hạn giữ (mặc định 7 ngày) khi khởi động server.
 */

import type { Db } from "./db.ts";

export interface CleanupFilter {
  rootId?: number;
  categories?: string[];
  olderThanDays?: number;
  minSize?: number;
  topDir?: string;
  fileIds?: number[];
}

export interface CleanupPreview {
  count: number;
  bytes: number;
  samples: { relPath: string; size: number; category: string }[];
}

const notImplemented = (fn: string): never => {
  throw new Error(`${fn}: chưa cài đặt — xem docs/PLAN.md Giai đoạn 3`);
};

export function previewCleanup(_db: Db, _filter: CleanupFilter): CleanupPreview {
  return notImplemented("previewCleanup");
}

export async function quarantine(_db: Db, _filter: CleanupFilter): Promise<{ jobId: number }> {
  return notImplemented("quarantine");
}

export async function restoreJob(_db: Db, _jobId: number): Promise<void> {
  return notImplemented("restoreJob");
}

export async function purgeJob(_db: Db, _jobId: number): Promise<void> {
  return notImplemented("purgeJob");
}
