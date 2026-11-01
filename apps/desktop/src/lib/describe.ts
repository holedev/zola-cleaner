import type { CleanupFilter } from "./api";

const DAY = 86_400_000;

/** Nhãn nhóm loại trên giao diện (khớp các ô "Loại" ở trang Theo hội thoại). */
const KIND_GROUPS: { label: string; categories: string[] }[] = [
  { label: "ảnh", categories: ["image"] },
  { label: "video", categories: ["video"] },
  { label: "tài liệu", categories: ["document", "archive"] },
  { label: "âm thanh & khác", categories: ["audio", "other"] },
];

const dateVi = (ms: number) => new Date(ms).toLocaleDateString("vi-VN");

/** Mốc "gửi trước ngày …" của bộ lọc, nếu có. */
export function cutoffMs(f: CleanupFilter): number | null {
  if (f.beforeTs != null) return f.beforeTs;
  if (f.olderThanDays) return Date.now() - f.olderThanDays * DAY;
  return null;
}

/**
 * Câu mô tả những gì sẽ bị dọn, ví dụ:
 * "Ảnh, video gửi trước ngày 01/11/2024, lớn hơn 5 MB, trong 3 hội thoại đã chọn."
 */
export function describeFilter(f: CleanupFilter): string {
  const cats = f.categories ?? ["image", "video"];
  const kinds = KIND_GROUPS.filter((g) => g.categories.some((c) => cats.includes(c))).map((g) => g.label);
  const parts: string[] = [];
  const cut = cutoffMs(f);
  parts.push(cut != null ? `gửi trước ngày ${dateVi(cut)}` : "gửi vào bất kỳ lúc nào");
  if (f.minSize) parts.push(`lớn hơn ${Math.round(f.minSize / 1024 / 1024)} MB`);
  const scope = f.convIds?.length
    ? f.convIds.length === 1
      ? "trong hội thoại đã chọn"
      : `trong ${f.convIds.length} hội thoại đã chọn`
    : "ở mọi hội thoại";
  const what = kinds.length ? kinds.join(", ") : "không loại nào";
  return `${what[0]!.toUpperCase()}${what.slice(1)} ${parts.join(", ")}, ${scope}.`;
}

/** Phần được giữ lại, để người dùng yên tâm. */
export function describeKept(f: CleanupFilter): string {
  const cut = cutoffMs(f);
  const keep = [
    cut != null ? `file gửi từ ngày ${dateVi(cut)} trở đi` : null,
    // Chỉ dọn vài hội thoại → file còn dùng ở hội thoại khác được giữ; dọn mọi hội thoại thì không còn "hội thoại khác"
    f.convIds?.length ? "file dùng chung với hội thoại khác" : null,
    "thumbnail của Zalo",
  ]
    .filter(Boolean)
    .join(", ");
  return `Giữ nguyên: ${keep}.`;
}
