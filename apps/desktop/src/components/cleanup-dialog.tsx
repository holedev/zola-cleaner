/**
 * Xem trước từng file → bỏ tick file muốn giữ → chuyển vào thùng rác → hướng dẫn kiểm tra trong Zalo.
 * Dùng chung cho Gợi ý, Theo hội thoại và Theo tháng.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CircleCheck, FileText, Film, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useBlocking } from "@/components/blocking";
import { useImageViewer } from "@/components/image-viewer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  CATEGORY_LABEL,
  type CleanupFilter,
  type CleanupItem,
  docColor,
  docLabel,
  errorMessage,
  formatBytes,
  formatDate,
  type ItemGroup,
  type ItemOrder,
  type JobResult,
} from "@/lib/api";
import { describeFilter, describeKept } from "@/lib/describe";
import { useDebounced, useHealth, useInvalidateIndex, usePreview } from "@/lib/queries";
import { cn } from "@/lib/utils";

export interface CleanupRequest {
  filter: CleanupFilter;
  title: string;
  /** Tài liệu có thể không tải lại được từ Zalo → nhấn mạnh cảnh báo. */
  caution?: boolean;
}

interface Props {
  request: CleanupRequest | null;
  onClose: () => void;
  /** Sau khi chuyển vào thùng rác, người dùng muốn sang tab Thùng rác. */
  onGoToJobs: () => void;
}

/** Số file mỗi lần tải trong màn xem trước. */
const PAGE = 120;

export function CleanupDialog({ request, onClose, onGoToJobs }: Props) {
  const health = useHealth();
  const blocking = useBlocking();
  const invalidate = useInvalidateIndex();
  const [done, setDone] = useState<JobResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [group, setGroup] = useState<ItemGroup>("media");
  const [order, setOrder] = useState<ItemOrder>("largest");
  // Tiến trình Zalo bị treo vẫn có thể giữ file → chặn như khi Zalo đang chạy
  const zaloRunning = !!health.data?.zaloRunning || !!health.data?.zaloStuck;
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: request != null });
  const trash = settings.data?.trash.find((t) => t.rootId === request?.filter.rootId);

  // Mở yêu cầu mới → tick lại tất cả
  useEffect(() => {
    setExcluded(new Set());
    setGroup("media");
  }, [request]);

  const filter = useMemo(
    () => (request ? { ...request.filter, excludeIds: [...excluded].sort((a, b) => a - b) } : null),
    [request, excluded],
  );
  const debounced = useDebounced(filter, 300);
  const preview = usePreview(debounced);
  const p = request ? preview.data : undefined;
  const counting = filter !== debounced || preview.isFetching;

  const confirm = async () => {
    if (!filter) return;
    onClose();
    try {
      const detail =
        trash && !trash.sameDrive
          ? `Thùng rác ở ổ khác (${trash.dir.slice(0, 3)}): đang chép file sang, có thể mất vài phút. Đừng mở Zalo lúc này.`
          : "Đừng mở Zalo lúc này.";
      const r = await blocking.run("Đang chuyển vào thùng rác…", () => api.quarantine(filter), detail);
      await invalidate();
      if (r.moved === 0 && r.failed > 0) toast.error(`Không chuyển được ${r.failed} file (có thể đang bị khoá).`);
      else setDone(r);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggle = (id: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <Dialog open={request != null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex h-[90vh] max-w-[min(92vw,1400px)] flex-col gap-3 sm:max-w-[min(92vw,1400px)]">
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="grid gap-1">
                {request && (
                  <div className="text-foreground rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/30">
                    <b>Sẽ dọn:</b> {describeFilter(request.filter)}{" "}
                    <span className="text-muted-foreground">{describeKept(request.filter)}</span>
                  </div>
                )}
                <span>Xem từng file bên dưới. Bỏ tick file nào muốn giữ lại; bấm ảnh để xem lớn, bấm tài liệu để mở.</span>
              </div>
            </DialogDescription>
          </DialogHeader>

          {request && (
            <div className="flex flex-wrap items-center gap-3">
              <Tabs value={group} onValueChange={(v) => setGroup(v as ItemGroup)}>
                <TabsList>
                  <TabsTrigger value="media">Ảnh & video</TabsTrigger>
                  <TabsTrigger value="docs">Tài liệu & khác</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={order} onValueChange={(v) => setOrder(v as ItemOrder)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="largest">Lớn nhất trước</SelectItem>
                  <SelectItem value="newest">Mới nhất trước</SelectItem>
                  <SelectItem value="oldest">Cũ nhất trước</SelectItem>
                </SelectContent>
              </Select>
              {excluded.size > 0 && (
                <span className="text-muted-foreground text-sm">
                  Đã bỏ tick {excluded.size.toLocaleString("vi-VN")} file ·{" "}
                  <button type="button" className="text-foreground underline" onClick={() => setExcluded(new Set())}>
                    tick lại tất cả
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-3">
            {request && (
              <ItemList
                key={`${group}-${order}`}
                filter={request.filter}
                group={group}
                order={order}
                excluded={excluded}
                onToggle={toggle}
                title={request.title}
              />
            )}
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <div className="grid text-sm">
              {!p || counting ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Spinner /> Đang tính…
                </span>
              ) : (
                <>
                  <span>
                    <b className="text-base tabular-nums">{formatBytes(p.bytes)}</b> · {p.count.toLocaleString("vi-VN")} file ·{" "}
                    <span className="text-muted-foreground">
                      {p.byCategory.map((b) => `${CATEGORY_LABEL[b.key] ?? b.key} ${formatBytes(b.bytes)}`).join(" · ")}
                    </span>
                  </span>
                  {p.skippedShared.count > 0 && (
                    <span className="text-muted-foreground">
                      Giữ lại {p.skippedShared.count.toLocaleString("vi-VN")} file ({formatBytes(p.skippedShared.bytes)}) còn dùng ở
                      hội thoại không được chọn.
                    </span>
                  )}
                </>
              )}
              {request?.caution && (
                <span className="text-destructive flex gap-1.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  Tài liệu có thể không tải lại được từ Zalo nếu đã hết hạn trên máy chủ.
                </span>
              )}
              {zaloRunning && <span className="text-destructive">Zalo đang chạy — hãy thoát hẳn Zalo trước.</span>}
              <span className="text-muted-foreground text-xs">
                File vào thùng rác của Zola Cleaner, khôi phục được trong 7 ngày. Ổ đĩa chỉ trống ra khi dọn sạch thùng rác.
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Huỷ
              </Button>
              <Button variant="destructive" disabled={!p || p.count === 0 || zaloRunning || counting} onClick={confirm}>
                Chuyển {p && !counting ? formatBytes(p.bytes) : ""} vào thùng rác
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={done != null} onOpenChange={(o) => !o && setDone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-600" />
              Đã chuyển {done && formatBytes(done.bytes)} vào thùng rác
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p>
                  {done?.moved.toLocaleString("vi-VN")} file đã vào thùng rác
                  {done && done.failed > 0 ? ` (${done.failed} file bị khoá, giữ nguyên)` : ""}.
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Mở Zalo, xem thử vài hội thoại vừa dọn.</li>
                  <li>
                    Nếu ổn, vào tab <b>Thùng rác</b> bấm <b>Dọn sạch thùng rác</b> để lấy lại dung lượng.
                  </li>
                  <li>Nếu thiếu gì, thoát Zalo rồi bấm <b>Khôi phục</b>.</li>
                </ol>
                <p className="text-xs">Không làm gì thì sau 7 ngày, lần mở app kế tiếp sẽ tự xoá vĩnh viễn.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Để sau</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDone(null);
                onGoToJobs();
              }}
            >
              Đến Thùng rác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Danh sách file sẽ dọn của một nhóm, tải dần từng trang. */
function ItemList({
  filter,
  group,
  order,
  excluded,
  onToggle,
  title,
}: {
  filter: CleanupFilter;
  group: ItemGroup;
  order: ItemOrder;
  excluded: Set<number>;
  onToggle: (id: number) => void;
  title: string;
}) {
  const view = useImageViewer();
  const q = useInfiniteQuery({
    queryKey: ["index", "items", filter, group, order],
    queryFn: ({ pageParam }) => api.cleanupItems(filter, group, order, pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const images = items.filter((i) => i.category === "image");

  const open = async (it: CleanupItem) => {
    if (it.category === "image") {
      view(
        images.map((i) => i.id),
        images.findIndex((i) => i.id === it.id),
        title,
      );
      return;
    }
    try {
      await api.openItem(it.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (q.isPending) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
        {Array.from({ length: 24 }, (_, i) => (
          <Skeleton key={i} className="aspect-square" />
        ))}
      </div>
    );
  }
  if (total === 0) {
    return <p className="text-muted-foreground py-10 text-center">Không có file nào trong nhóm này.</p>;
  }

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString("vi-VN")} file{items.length < total && ` · đang hiện ${items.length.toLocaleString("vi-VN")}`}
      </p>
      {group === "media" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {items.map((it) => {
            const on = !excluded.has(it.id);
            return (
              <div
                key={it.id}
                className={cn(
                  "group relative overflow-hidden rounded-md border transition",
                  on ? "border-transparent" : "border-dashed opacity-40",
                )}
              >
                <button type="button" className="block w-full" onClick={() => open(it)} title="Xem">
                  <Thumb item={it} />
                </button>
                <label className="bg-background/90 absolute top-1.5 left-1.5 flex size-6 cursor-pointer items-center justify-center rounded shadow">
                  <Checkbox checked={on} onCheckedChange={() => onToggle(it.id)} />
                </label>
                <div className="bg-background/85 absolute inset-x-0 bottom-0 flex justify-between px-1.5 py-0.5 text-[11px] tabular-nums">
                  <span>{formatBytes(it.size)}</span>
                  <span className="text-muted-foreground">{formatDate(it.ts)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y">
          {items.map((it) => {
            const on = !excluded.has(it.id);
            return (
              <div key={it.id} className={cn("flex items-center gap-3 py-1.5 text-sm", !on && "opacity-40")}>
                <Checkbox checked={on} onCheckedChange={() => onToggle(it.id)} />
                <FileText className={cn("size-4 shrink-0", docColor(it.kind))} />
                <span className="w-24 shrink-0 font-medium">{it.category === "audio" ? "Âm thanh" : docLabel(it.kind || "?")}</span>
                <span className="min-w-0 flex-1 truncate" title={it.name ?? undefined}>
                  {it.name ?? <span className="text-muted-foreground">Không rõ tên</span>}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums">{formatBytes(it.size)}</span>
                <span className="text-muted-foreground w-24 shrink-0">{formatDate(it.ts)}</span>
                {it.kind && (
                  <Button variant="ghost" size="sm" onClick={() => open(it)}>
                    Mở
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="outline" className="justify-self-center" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage && <Spinner />} Tải thêm
        </Button>
      )}
    </div>
  );
}

/** Ảnh nhỏ của một file; video không có ảnh thì hiện biểu tượng. */
function Thumb({ item }: { item: CleanupItem }) {
  const [failed, setFailed] = useState(false);
  if (failed || item.category !== "image") {
    // Video: thử Thumbnail Zalo tạo sẵn trước khi chịu hiện biểu tượng
    if (item.category === "video" && !failed) {
      return (
        <img
          src={api.thumbUrl(item.id)}
          loading="lazy"
          alt=""
          className="bg-muted aspect-square w-full object-cover"
          onError={() => setFailed(true)}
        />
      );
    }
    return (
      <div className="bg-muted text-muted-foreground flex aspect-square w-full flex-col items-center justify-center gap-1 text-xs">
        <Film className="size-6" />
        {item.category === "video" ? "Video" : (item.kind || "?").toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={api.thumbUrl(item.id)}
      loading="lazy"
      alt=""
      className="bg-muted aspect-square w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
