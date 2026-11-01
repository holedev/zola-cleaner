// Kiểu dữ liệu khớp với @zalo-cleaner/core. Có thể chuyển sang hono/client để type-safe hoàn toàn.

export interface Health {
  ok: boolean;
  version: string;
  platform: string;
  zaloRunning: boolean;
  /** Các lần quét đang chạy trên server. */
  scanning: { rootId: number; scanId: number }[];
}

export interface Root {
  id: number;
  path: string;
  label: string | null;
}

export interface Bucket {
  key: string;
  count: number;
  bytes: number;
}

export interface Stats {
  total: { count: number; bytes: number };
  byCategory: Bucket[];
  byArea: Bucket[];
  byMonth: Bucket[];
  byAge: Bucket[];
  largest: { id: number; relPath: string; size: number; category: string; kind: string }[];
}

export interface ScanProgress {
  scanId: number;
  phase: "running" | "done" | "failed";
  seen: number;
  newFiles: number;
  changed: number;
  bytes: number;
  errors: number;
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
  lastTs: number | null;
  thumbIds: number[];
}

export interface CleanupFilter {
  rootId: number;
  convIds?: string[];
  categories?: string[];
  olderThanDays?: number;
  minSize?: number;
}

export interface CleanupPreview {
  count: number;
  bytes: number;
  skippedShared: { count: number; bytes: number };
  byCategory: Bucket[];
  samples: { id: number; relPath: string; size: number; ts: number; category: string; kind: string }[];
}

export interface JobResult {
  jobId: number;
  moved: number;
  failed: number;
  bytes: number;
}

export interface Job {
  id: number;
  root_id: number;
  filter_json: string;
  status: "running" | "quarantined" | "restored" | "purged" | "failed";
  created_at: number;
  finished_at: number | null;
  expires_at: number;
  item_count: number;
  total_bytes: number;
  quarantine_dir: string;
}

let token: Promise<string> | undefined;
const getToken = () => (token ??= fetch("/api/session").then((r) => r.json()).then((d: { token: string }) => d.token));

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init?.method && init.method !== "GET") headers["x-zc-token"] = await getToken();
  const res = await fetch(url, { ...init, headers });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

const post = <T>(url: string, body?: unknown) =>
  req<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => req<Health>("/api/health"),
  roots: () => req<Root[]>("/api/roots"),
  detectRoots: () => req<string[]>("/api/roots/detect"),
  addRoot: (path: string) => post<Root>("/api/roots", { path }),
  removeRoot: (id: number) => req<null>(`/api/roots/${id}`, { method: "DELETE" }),
  startScan: (rootId: number) => post<{ scanId: number }>("/api/scans", { rootId }),
  stats: (rootId: number) => req<Stats>(`/api/stats?rootId=${rootId}`),
  conversations: (rootId: number) => req<Conversation[]>(`/api/conversations?rootId=${rootId}`),
  setAlias: (rootId: number, convId: string, alias: string) =>
    req<null>(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: "PATCH",
      body: JSON.stringify({ rootId, alias }),
    }),
  thumbUrl: (itemId: number) => `/api/items/${itemId}/thumb`,
  preview: (filter: CleanupFilter) => post<CleanupPreview>("/api/cleanup/preview", filter),
  quarantine: (filter: CleanupFilter) => post<JobResult>("/api/cleanup", filter),
  jobs: (rootId: number) => req<Job[]>(`/api/jobs?rootId=${rootId}`),
  restore: (jobId: number) => post<JobResult>(`/api/jobs/${jobId}/restore`),
  purge: (jobId: number) => post<JobResult>(`/api/jobs/${jobId}/purge`),
  /** Theo dõi tiến độ quét qua SSE. Trả về hàm huỷ. */
  watchScan(scanId: number, onProgress: (p: ScanProgress) => void): () => void {
    const es = new EventSource(`/api/scans/${scanId}/events`);
    es.addEventListener("progress", (e) => {
      const p = JSON.parse((e as MessageEvent).data) as ScanProgress;
      onProgress(p);
      if (p.phase !== "running") es.close();
    });
    es.onerror = () => es.close();
    return () => es.close();
  },
};

const UNITS = ["B", "KB", "MB", "GB", "TB"];
export function formatBytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}`;
}

export function formatDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString("vi-VN") : "—";
}
