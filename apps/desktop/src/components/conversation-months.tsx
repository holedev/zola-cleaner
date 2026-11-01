/**
 * Dọn MỘT hội thoại theo mốc thời gian: chọn một tháng → dọn tháng đó và mọi tháng cũ hơn.
 */
import { CalendarRange } from "lucide-react";
import { useEffect, useState } from "react";
import type { CleanupRequest } from "@/components/cleanup-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type CleanupFilter, type Conversation, formatBytes, type MonthBucket } from "@/lib/api";
import { useConversationMonths } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Props {
  conv: Conversation | null;
  /** Bộ lọc loại / kích thước đang chọn ở trang Theo hội thoại. */
  base: CleanupFilter;
  onClose: () => void;
  onCleanup: (r: CleanupRequest) => void;
}

/** "2020-09" → "Tháng 9/2020" */
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  return `Tháng ${Number(mo)}/${y}`;
};

/** Đầu tháng kế tiếp theo giờ máy — mốc "trước" để gồm trọn tháng `m`. */
const nextMonthStart = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y!, mo!, 1).getTime();
};

export function ConversationMonthsDialog({ conv, base, onClose, onCleanup }: Props) {
  const filter: CleanupFilter | null = conv
    ? { rootId: base.rootId, categories: base.categories, minSize: base.minSize, convIds: [conv.convId] }
    : null;
  const q = useConversationMonths(filter);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [conv?.convId]);

  const months = q.data?.months ?? [];
  const idx = picked ? months.findIndex((m) => m.month === picked) : -1;
  const chosen: MonthBucket[] = idx >= 0 ? months.slice(idx) : [];
  const bytes = chosen.reduce((s, m) => s + m.bytes, 0);
  const count = chosen.reduce((s, m) => s + m.count, 0);
  const name = conv?.alias || conv?.convId;

  const start = () => {
    if (!filter || !picked) return;
    onClose();
    onCleanup({
      filter: { ...filter, beforeTs: nextMonthStart(picked) },
      title: `Dọn "${name}" từ ${monthLabel(picked).toLowerCase()} trở về trước`,
      caution: filter.categories?.some((c) => c === "document" || c === "archive"),
    });
  };

  return (
    <Dialog open={conv != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="size-5" /> Dọn theo thời gian — {name}
          </DialogTitle>
          <DialogDescription>
            Bấm vào một tháng: tháng đó và mọi tháng cũ hơn sẽ được dọn. Các tháng mới hơn giữ nguyên.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          {q.isPending ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : months.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center">Không có file nào dọn được với loại đang chọn.</p>
          ) : (
            <ul className="grid gap-1">
              {months.map((m, i) => {
                const on = idx >= 0 && i >= idx;
                return (
                  <li key={m.month}>
                    <button
                      type="button"
                      onClick={() => setPicked(m.month)}
                      className={cn(
                        "hover:bg-muted flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        on ? "border-destructive/40 bg-destructive/5" : "border-transparent",
                        m.month === picked && "ring-destructive/40 ring-2",
                      )}
                    >
                      <span className={cn("w-28 shrink-0 font-medium", on && "text-destructive")}>{monthLabel(m.month)}</span>
                      <span className="flex flex-1 gap-1">
                        {m.thumbIds.map((id) => (
                          <img
                            key={id}
                            src={api.thumbUrl(id)}
                            loading="lazy"
                            alt=""
                            className={cn("bg-muted size-10 rounded object-cover", on && "opacity-60")}
                            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                          />
                        ))}
                      </span>
                      <span className="text-muted-foreground w-20 text-right text-sm tabular-nums">{m.count.toLocaleString("vi-VN")} file</span>
                      <span className="w-20 text-right font-medium tabular-nums">{formatBytes(m.bytes)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {q.data && q.data.shared.count > 0 && (
          <p className="text-muted-foreground text-xs">
            Không tính {q.data.shared.count.toLocaleString("vi-VN")} file ({formatBytes(q.data.shared.bytes)}) dùng chung với hội
            thoại khác — chúng luôn được giữ khi chỉ dọn hội thoại này.
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm">
            {picked ? (
              <>
                <b className="tabular-nums">{formatBytes(bytes)}</b> · {count.toLocaleString("vi-VN")} file · từ{" "}
                {monthLabel(picked).toLowerCase()} trở về trước
              </>
            ) : (
              <span className="text-muted-foreground">Chưa chọn mốc</span>
            )}
          </span>
          <Button variant="destructive" disabled={!picked || count === 0} onClick={start}>
            Xem & dọn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
