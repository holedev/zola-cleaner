/**
 * Dọn nhanh (màn chính): một câu nói rõ tình hình, dải ổ đĩa cho thấy phần sẽ lấy lại, chọn một cách dọn, một nút hành động.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CleanupRequest } from "@/components/cleanup-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, CATEGORY_LABEL, type DiskInfo, formatBytes, type Suggestion } from "@/lib/api";
import { useStats, useSuggestions } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Props {
  rootId: number;
  readOnly: boolean;
  onCleanup: (r: CleanupRequest) => void;
  /** Sang mục Theo hội thoại để chọn kỹ hơn. */
  onBrowse: () => void;
}

export function SuggestionsPage({ rootId, readOnly, onCleanup, onBrowse }: Props) {
  const stats = useStats(rootId);
  const suggestions = useSuggestions(rootId);
  const disk = useQuery({ queryKey: ["index", "disk", rootId], queryFn: () => api.diskSpace(rootId) });
  const list = suggestions.data ?? [];

  // Chọn sẵn gợi ý đầu tiên có file để dọn
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!picked && list.length) setPicked((list.find((s) => s.count > 0) ?? list[0]!).id);
  }, [list, picked]);
  const sel = list.find((s) => s.id === picked) ?? null;

  const zalo = stats.data?.total.bytes ?? disk.data?.zaloBytes ?? 0;
  const kinds = (stats.data?.byCategory ?? []).filter((b) => b.bytes > 0).slice(0, 4);
  const maxBytes = useMemo(() => Math.max(1, ...list.map((s) => s.bytes)), [list]);

  return (
    // Một cột cùng độ rộng: thanh dung lượng và danh sách cách dọn thẳng hàng, màn hình rộng thì căn giữa
    <div className="mx-auto grid w-full max-w-5xl gap-10">
      <section className="grid gap-5">
        {!disk.data || !stats.data ? (
          <div className="grid gap-3">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-10 w-1/2" />
          </div>
        ) : (
          <h1 className="max-w-4xl text-[2.6rem] leading-[1.15] font-semibold tracking-tight text-balance">
            Zalo đang giữ <span className="text-zalo tabular-nums">{formatBytes(zalo)}</span> trên ổ{" "}
            {disk.data.drive.replace(":", "")}
            {sel && sel.bytes > 0 ? (
              <>
                .{" "}
                <span className="text-muted-foreground">Dọn {sel.title.toLowerCase()} để lấy lại </span>
                <span className="text-reclaim tabular-nums">{formatBytes(sel.bytes)}</span>.
              </>
            ) : (
              "."
            )}
          </h1>
        )}
        {kinds.length > 0 && (
          <p className="text-muted-foreground flex flex-wrap gap-x-5 text-sm">
            {kinds.map((k) => (
              <span key={k.key}>
                {CATEGORY_LABEL[k.key] ?? k.key} <span className="figure text-foreground">{formatBytes(k.bytes)}</span>
              </span>
            ))}
          </p>
        )}
        {disk.data ? (
          <StorageStrip disk={disk.data} zalo={zalo} reclaim={sel?.bytes ?? 0} />
        ) : (
          <Skeleton className="h-14 rounded-xl" />
        )}
      </section>

      <section className="grid gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">Chọn cách dọn</h2>
          <button
            type="button"
            onClick={onBrowse}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            Muốn chọn từng hội thoại? Mở Theo hội thoại
          </button>
        </div>

        <div role="radiogroup" aria-label="Cách dọn" className="grid gap-2">
          {suggestions.isPending
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)
            : list.map((s) => (
                <Option key={s.id} s={s} selected={s.id === picked} max={maxBytes} onSelect={() => setPicked(s.id)} />
              ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Button
            size="lg"
            className="h-11 px-5 text-base"
            disabled={readOnly || !sel || sel.count === 0}
            onClick={() => sel && onCleanup({ filter: sel.filter, title: sel.title, caution: sel.caution })}
          >
            Xem & dọn {sel ? formatBytes(sel.bytes) : ""} <ArrowRight />
          </Button>
          <span className="text-muted-foreground text-sm">
            Bạn sẽ thấy từng file trước khi dọn. File vào thùng rác, khôi phục được trong 7 ngày.
          </span>
        </div>
      </section>
    </div>
  );
}

/**
 * Dải media Zalo (100% = mọi file Zalo đã tải về): phần giữ lại / phần sẽ lấy lại (sọc).
 * Đổi ngay khi người dùng chọn cách dọn khác. Ổ đĩa chỉ là một dòng chữ bên dưới — Zalo thường chỉ chiếm vài % ổ.
 */
function StorageStrip({ disk: d, zalo, reclaim }: { disk: DiskInfo; zalo: number; reclaim: number }) {
  const r = Math.min(reclaim, zalo);
  const keepPct = zalo > 0 ? ((zalo - r) / zalo) * 100 : 100;
  const drive = d.drive.replace(":", "");
  return (
    <div className="grid gap-3">
      <div
        className="bg-card flex h-14 overflow-hidden rounded-xl border"
        role="img"
        aria-label={`Media Zalo ${formatBytes(zalo)}: giữ lại ${formatBytes(zalo - r)}, sẽ lấy lại ${formatBytes(r)}`}
      >
        <span className="bg-zalo h-full transition-[width] duration-500 ease-out" style={{ width: `${keepPct}%` }} />
        <span className="bg-reclaim-hatch h-full flex-1" />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        <Legend cls="bg-zalo" label="Zalo giữ lại" value={zalo - r} />
        <Legend cls="bg-reclaim-hatch" label="Sẽ lấy lại" value={r} strong />
        <span className="text-muted-foreground ml-auto">
          Ổ {drive} còn trống <span className="figure text-foreground">{formatBytes(d.free)}</span>
          {r > 0 && (
            <>
              {" → "}
              <span className="figure text-reclaim font-semibold">{formatBytes(d.free + r)}</span> sau khi dọn sạch thùng rác
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Legend({ cls, label, value, strong }: { cls: string; label: string; value: number; strong?: boolean }) {
  return (
    <span className="text-muted-foreground flex items-center gap-2">
      <span className={cn("size-3 rounded-[4px]", cls)} />
      {label}{" "}
      <span className={cn("figure", strong ? "text-reclaim font-semibold" : "text-foreground")}>
        {formatBytes(Math.max(0, value))}
      </span>
    </span>
  );
}

function Option({ s, selected, max, onSelect }: { s: Suggestion; selected: boolean; max: number; onSelect: () => void }) {
  const empty = s.count === 0;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={empty}
      onClick={onSelect}
      className={cn(
        "focus-visible:ring-ring grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border bg-white px-4 py-3.5 text-left transition-colors outline-none focus-visible:ring-2",
        selected ? "border-primary bg-accent/60 shadow-sm" : "hover:border-input",
        empty && "opacity-50",
      )}
    >
      <span
        className={cn("flex size-5 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-input")}
      >
        {selected && <span className="bg-primary size-2.5 rounded-full" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-medium">
          {s.title}
          {s.caution && (
            <span className="text-trash flex items-center gap-1 text-xs font-normal">
              <TriangleAlert className="size-3.5" /> Cân nhắc
            </span>
          )}
        </span>
        <span className="text-muted-foreground block text-sm">{s.description}</span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className={cn("figure text-lg font-semibold", selected && "text-reclaim")}>{formatBytes(s.bytes)}</span>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          {s.count.toLocaleString("vi-VN")} file
          <span className="bg-muted h-1 w-16 overflow-hidden rounded-full">
            <span className="bg-reclaim block h-full rounded-full" style={{ width: `${(s.bytes / max) * 100}%` }} />
          </span>
        </span>
      </span>
    </button>
  );
}
