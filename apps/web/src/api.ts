// Kiểu dữ liệu khớp với @zalo-cleaner/core. Có thể chuyển sang hono/client để type-safe hoàn toàn.

export interface Health {
  ok: boolean;
  version: string;
  platform: string;
  zaloRunning: boolean;
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
  byTopDir: Bucket[];
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

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

export const api = {
  health: () => req<Health>("/api/health"),
  roots: () => req<Root[]>("/api/roots"),
  addRoot: (path: string) => req<Root>("/api/roots", { method: "POST", body: JSON.stringify({ path }) }),
  removeRoot: (id: number) => req<null>(`/api/roots/${id}`, { method: "DELETE" }),
  startScan: (rootId: number) =>
    req<{ scanId: number }>("/api/scans", { method: "POST", body: JSON.stringify({ rootId }) }),
  stats: (rootId?: number) => req<Stats>(`/api/stats${rootId ? `?rootId=${rootId}` : ""}`),
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
