import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type CleanupFilter } from "./api";

export const keys = {
  health: ["health"] as const,
  roots: ["roots"] as const,
  /** Mọi dữ liệu suy ra từ chỉ mục — làm mới sau khi quét / cách ly / khôi phục / giải phóng. */
  index: ["index"] as const,
  stats: (rootId: number) => ["index", "stats", rootId] as const,
  suggestions: (rootId: number) => ["index", "suggestions", rootId] as const,
  conversations: (f: CleanupFilter) => ["index", "conversations", f] as const,
  preview: (f: CleanupFilter) => ["index", "preview", f] as const,
  jobs: (rootId: number) => ["index", "jobs", rootId] as const,
};

/** Trạng thái Zalo đổi bất cứ lúc nào (người dùng tắt / mở) → hỏi lại mỗi 3 giây. */
export const useHealth = () => useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 3000 });

export const useRoots = () => useQuery({ queryKey: keys.roots, queryFn: api.roots });

export const useStats = (rootId: number) => useQuery({ queryKey: keys.stats(rootId), queryFn: () => api.stats(rootId) });

export const useSuggestions = (rootId: number) =>
  useQuery({ queryKey: keys.suggestions(rootId), queryFn: () => api.suggestions(rootId) });

/** Đổi bộ lọc → giữ bảng cũ (làm mờ) trong lúc tính bảng mới, không nhấp nháy về trống. */
export const useConversations = (filter: CleanupFilter) =>
  useQuery({
    queryKey: keys.conversations(filter),
    queryFn: () => api.conversations(filter),
    placeholderData: keepPreviousData,
  });

export const useConversationMonths = (filter: CleanupFilter | null) =>
  useQuery({
    queryKey: ["index", "months", filter] as const,
    queryFn: () => api.conversationMonths(filter!),
    enabled: filter != null,
  });

export const usePreview = (filter: CleanupFilter | null) =>
  useQuery({
    queryKey: keys.preview(filter ?? { rootId: -1 }),
    queryFn: () => api.preview(filter!),
    enabled: filter != null,
    placeholderData: keepPreviousData,
  });

export const useJobs = (rootId: number) => useQuery({ queryKey: keys.jobs(rootId), queryFn: () => api.jobs(rootId) });

export function useInvalidateIndex() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.index });
}

/** Giá trị trễ `ms` sau lần đổi cuối (gõ số MB, bấm liên tục…). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
