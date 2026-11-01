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
}

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
  jobs: (rootId: number) => call<Job[]>("jobs", { rootId }),
  restore: (jobId: number) => call<JobResult>("restore", { jobId }),
  purge: (jobId: number) => call<JobResult>("purge", { jobId }),
  exportReport: (rootId: number, path: string) => call<void>("export_report", { rootId, path }),
  exportLog: (path: string) => call<void>("export_log", { path }),
  thumbUrl: (itemId: number) => convertFileSrc(String(itemId), "thumb"),
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
