/** Gọi các command của lõi Rust (src-tauri/src/lib.rs). Kiểu dữ liệu khớp serde camelCase bên Rust. */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type LayoutCheck = { status: "supported" } | { status: "unsupported"; reasons: string[] };

export interface RootInfo {
  id: number;
  path: string;
  label: string | null;
  createdAt: number;
  uid: string | null;
  layout: LayoutCheck;
}

export interface AccountInfo {
  uid: string;
  /** Thư mục media của tài khoản, nếu Zalo đã tạo. */
  store: string | null;
}

/** "9533337693992746410" → "…6410" (đủ để phân biệt, không lộ cả uid trên màn hình). */
export const shortUid = (uid: string | null | undefined) => (uid ? `…${uid.slice(-4)}` : "?");

export type ScanPhase = "listing" | "reading" | "writing" | "done" | "failed";

export interface ScanProgress {
  rootId: number;
  scanId: number;
  phase: ScanPhase;
  dirs: number;
  seen: number;
  newFiles: number;
  changed: number;
  read: number;
  bytes: number;
  errors: number;
}

export interface Health {
  version: string;
  zaloRunning: boolean;
  scanning: ScanProgress[];
  busy: boolean;
}

export interface Bucket {
  key: string;
  count: number;
  bytes: number;
}

export interface Stats {
  total: Bucket;
  byCategory: Bucket[];
  byArea: Bucket[];
  byMonth: Bucket[];
  byAge: Bucket[];
}

export interface CleanupFilter {
  rootId: number;
  convIds?: string[];
  categories?: string[];
  olderThanDays?: number;
  minSize?: number;
  /** Chỉ Media Item có thời điểm tin nhắn trước mốc này (epoch ms). */
  beforeTs?: number;
  /** File người dùng bỏ tick trong màn xem trước — giữ lại. */
  excludeIds?: number[];
}

export interface CleanupItem {
  id: number;
  category: string;
  kind: string;
  size: number;
  ts: number;
  convId: string | null;
}

export interface CleanupItems {
  total: number;
  items: CleanupItem[];
}

export type ItemGroup = "media" | "docs";
export type ItemOrder = "largest" | "newest" | "oldest";

export interface MonthBucket {
  /** "YYYY-MM" theo giờ máy. */
  month: string;
  startMs: number;
  count: number;
  bytes: number;
  thumbIds: number[];
}

export interface ConversationMonths {
  /** Mới nhất trước; chỉ gồm file dọn được (không tính file dùng chung). */
  months: MonthBucket[];
  shared: Bucket;
}

export interface Conversation {
  convId: string;
  isGroup: boolean;
  alias: string | null;
  items: number;
  bytes: number;
  ownBytes: number;
  imageBytes: number;
  videoBytes: number;
  documentBytes: number;
  otherBytes: number;
  cleanableCount: number;
  cleanableBytes: number;
  lastTs: number | null;
  thumbIds: number[];
  /** Tài liệu / file nén mới nhất. Zalo không giữ tên gốc trên máy → chỉ có loại, dung lượng, thời điểm. */
  recentDocs: DocRef[];
}

export interface DocRef {
  id: number;
  kind: string;
  size: number;
  ts: number;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  caution: boolean;
  filter: CleanupFilter;
  count: number;
  bytes: number;
}

export interface CleanupPreview {
  count: number;
  bytes: number;
  skippedShared: { count: number; bytes: number };
  byCategory: Bucket[];
}

export type JobStatus = "running" | "quarantined" | "restored" | "purged" | "failed";

export interface Job {
  id: number;
  rootId: number;
  status: JobStatus;
  createdAt: number;
  finishedAt: number | null;
  expiresAt: number;
  itemCount: number;
  totalBytes: number;
}

export interface JobResult {
  jobId: number;
  moved: number;
  failed: number;
  bytes: number;
}

/** Lỗi từ Rust: `kind` quyết định cách hiển thị. */
export interface CmdError {
  kind: "zaloRunning" | "busy" | "unsupported" | "user" | "internal";
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as CmdError).message);
  return String(e);
}

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const api = {
  health: () => call<Health>("health"),
  takeAutoPurged: () => call<JobResult[]>("take_auto_purged"),
  takeNewAccounts: () => call<string[]>("take_new_accounts"),
  accounts: () => call<AccountInfo[]>("accounts"),
  roots: () => call<RootInfo[]>("roots"),
  addRoot: (path: string) => call<RootInfo>("add_root", { path }),
  startScan: (rootId: number) => call<void>("start_scan", { rootId }),
  stats: (rootId: number) => call<Stats>("stats", { rootId }),
  suggestions: (rootId: number) => call<Suggestion[]>("suggestions", { rootId }),
  conversations: (filter: CleanupFilter) => call<Conversation[]>("conversations", { filter }),
  conversationMonths: (filter: CleanupFilter) => call<ConversationMonths>("conversation_months", { filter }),
  setAlias: (rootId: number, convId: string, alias: string | null) =>
    call<void>("set_alias", { rootId, convId, alias }),
  preview: (filter: CleanupFilter) => call<CleanupPreview>("preview", { filter }),
  quarantine: (filter: CleanupFilter) => call<JobResult>("quarantine", { filter }),
  cleanupItems: (filter: CleanupFilter, group: ItemGroup, order: ItemOrder, offset: number, limit: number) =>
    call<CleanupItems>("cleanup_items", { filter, group, order, offset, limit }),
  jobs: (rootId: number) => call<Job[]>("jobs", { rootId }),
  restore: (jobId: number) => call<JobResult>("restore", { jobId }),
  purge: (jobId: number) => call<JobResult>("purge", { jobId }),
  exportReport: (rootId: number, path: string) => call<void>("export_report", { rootId, path }),
  exportLog: (path: string) => call<void>("export_log", { path }),
  thumbUrl: (itemId: number) => convertFileSrc(String(itemId), "thumb"),
  /** Ảnh cỡ lớn để xem (JPEG XL được giải mã). */
  viewUrl: (itemId: number) => convertFileSrc(String(itemId), "media"),
  /** Mở bằng ứng dụng mặc định của Windows (qua một bản tạm, tài liệu fileNoise được giải mã). */
  openItem: (itemId: number) => call<void>("open_item", { itemId }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

export function formatDate(ms: number | null): string {
  return ms == null ? "—" : new Date(ms).toLocaleDateString("vi-VN");
}

export const CATEGORY_LABEL: Record<string, string> = {
  image: "Ảnh",
  video: "Video",
  audio: "Âm thanh",
  document: "Tài liệu",
  archive: "File nén",
  other: "Khác",
  database: "CSDL",
};

/** Tên dễ hiểu của loại tài liệu (kind do lõi nhận diện theo nội dung). */
export const DOC_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  doc: "Word",
  xlsx: "Excel",
  xls: "Excel",
  pptx: "PowerPoint",
  ppt: "PowerPoint",
  office: "Office",
  ole: "Office (cũ)",
  zip: "ZIP",
  rar: "RAR",
  "7z": "7-Zip",
  txt: "Văn bản",
  md: "Markdown",
  csv: "CSV",
  json: "JSON",
  xml: "XML",
  html: "HTML",
  drawio: "draw.io",
};

export const docLabel = (kind: string) => DOC_LABEL[kind] ?? kind.toUpperCase();

/** Màu biểu tượng theo nhóm tài liệu (giống màu quen thuộc của Office). */
export const docColor = (kind: string) =>
  ({ docx: "text-blue-600", doc: "text-blue-600", xlsx: "text-green-600", xls: "text-green-600", pptx: "text-orange-600", ppt: "text-orange-600", pdf: "text-red-600" })[kind] ??
  "text-muted-foreground";

export const AREA_LABEL: Record<string, string> = {
  picture: "Ảnh (picture)",
  video: "Video",
  fileNoise: "Tài liệu (fileNoise)",
  file: "File",
  Cache: "Thumbnail (Cache)",
  richThumb: "Thumbnail link",
  fileThumb: "Thumbnail file",
  voice: "Tin nhắn thoại",
  zinstant: "zinstant",
};
