import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, Search, User, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CleanupRequest } from "@/components/cleanup-dialog";
import { ConversationMonthsDialog } from "@/components/conversation-months";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, CATEGORY_LABEL, type CleanupFilter, type Conversation, errorMessage, formatBytes, formatDate } from "@/lib/api";
import { useConversations, useDebounced, usePreview } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Nhóm Media Kind trên bộ lọc → các category của lõi. Tài liệu không bao giờ được chọn sẵn. */
const KINDS = [
  { key: "image", label: "Ảnh", categories: ["image"], default: true },
  { key: "video", label: "Video", categories: ["video"], default: true },
  { key: "document", label: "Tài liệu", categories: ["document", "archive"], default: false },
  { key: "other", label: "Khác", categories: ["audio", "other"], default: false },
] as const;

const AGES = [
  { days: 0, label: "Mọi lúc" },
  { days: 30, label: "Cũ hơn 1 tháng" },
  { days: 90, label: "Cũ hơn 3 tháng" },
  { days: 180, label: "Cũ hơn 6 tháng" },
  { days: 365, label: "Cũ hơn 1 năm" },
  { days: 730, label: "Cũ hơn 2 năm" },
];

type SortKey = "name" | "bytes" | "cleanable" | "lastTs";
type Sort = { key: SortKey; desc: boolean };

const SORT_VALUE: Record<SortKey, (c: Conversation) => number | string> = {
  name: (c) => (c.alias || c.convId).toLowerCase(),
  bytes: (c) => c.bytes,
  cleanable: (c) => c.cleanableBytes,
  lastTs: (c) => c.lastTs ?? 0,
};

const COLORS = { image: "bg-blue-500", video: "bg-orange-500", document: "bg-emerald-600", other: "bg-zinc-400" };

interface Props {
  rootId: number;
  readOnly: boolean;
  onCleanup: (r: CleanupRequest) => void;
}

export function ConversationsPage({ rootId, readOnly, onCleanup }: Props) {
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.filter((k) => k.default).map((k) => k.key)));
  const [olderThanDays, setOlderThanDays] = useState(0);
  const [minSizeMb, setMinSizeMb] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allConvs, setAllConvs] = useState(false);
  const [query, setQuery] = useState("");
  const [monthsFor, setMonthsFor] = useState<Conversation | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "bytes", desc: true });
  const sortBy = (key: SortKey) =>
    // Bấm lại cột đang sắp → đảo chiều; cột mới → tên A→Z, số liệu lớn → nhỏ
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  const rawBase: CleanupFilter = useMemo(() => {
    const mb = Number(minSizeMb);
    return {
      rootId,
      categories: KINDS.filter((k) => kinds.has(k.key)).flatMap((k) => [...k.categories]),
      olderThanDays: olderThanDays || undefined,
      minSize: mb > 0 ? Math.round(mb * 1024 * 1024) : undefined,
    };
  }, [rootId, kinds, olderThanDays, minSizeMb]);
  const base = useDebounced(rawBase);
  const convs = useConversations(base);
  // Báo "đang tính" ngay khi bộ lọc vừa đổi, không đợi hết thời gian debounce
  const recalculating = rawBase !== base || (convs.isFetching && !convs.isPending);

  const rawSelection: CleanupFilter | null = useMemo(() => {
    if (!rawBase.categories?.length || (!allConvs && selected.size === 0)) return null;
    return { ...rawBase, convIds: allConvs ? undefined : [...selected].sort() };
  }, [rawBase, allConvs, selected]);
  const selection = useDebounced(rawSelection);
  const preview = usePreview(selection);
  const previewing = rawSelection !== selection || preview.isFetching;

  // Đổi Media Store → bỏ chọn
  useEffect(() => setSelected(new Set()), [rootId]);

  const rows = convs.data ?? [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((c) => c.convId.includes(q) || c.alias?.toLowerCase().includes(q)) : [...rows];
    const value = SORT_VALUE[sort.key];
    list.sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const cmp = typeof x === "string" ? x.localeCompare(y as string, "vi") : x - (y as number);
      return sort.desc ? -cmp : cmp;
    });
    return list;
  }, [rows, query, sort]);
  const max = Math.max(1, ...rows.map((c) => c.bytes));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const allShownOn = shown.length > 0 && shown.every((c) => selected.has(c.convId));
  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of shown) {
        if (allShownOn) next.delete(c.convId);
        else next.add(c.convId);
      }
      return next;
    });

  const p = preview.data;
  const title = allConvs ? "Dọn ở mọi hội thoại" : `Dọn ${selected.size} hội thoại đã chọn`;

  return (
    <div className="grid gap-4 pb-24">
      <div className="bg-card flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border p-4">
        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs">Loại</Label>
          <div className="flex gap-4">
            {KINDS.map((k) => (
              <Label key={k.key} className="font-normal">
                <Checkbox
                  checked={kinds.has(k.key)}
                  onCheckedChange={() =>
                    setKinds((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(k.key)) next.add(k.key);
                      return next;
                    })
                  }
                />
                {k.label}
              </Label>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs">Tuổi (thời điểm tin nhắn)</Label>
          <Select value={String(olderThanDays)} onValueChange={(v) => setOlderThanDays(Number(v))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGES.map((a) => (
                <SelectItem key={a.days} value={String(a.days)}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs" htmlFor="min-size">
            Lớn hơn (MB)
          </Label>
          <Input
            id="min-size"
            className="w-24"
            type="number"
            min={0}
            placeholder="0"
            value={minSizeMb}
            onChange={(e) => setMinSizeMb(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs">Áp dụng cho</Label>
          <RadioGroup
            className="flex gap-4"
            value={allConvs ? "all" : "selected"}
            onValueChange={(v) => setAllConvs(v === "all")}
          >
            <Label className="font-normal">
              <RadioGroupItem value="selected" /> Hội thoại đã chọn ({selected.size})
            </Label>
            <Label className="font-normal">
              <RadioGroupItem value="all" /> Mọi hội thoại
            </Label>
          </RadioGroup>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Tìm theo tên tự đặt hoặc ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-muted-foreground text-sm">
          {rows.length} hội thoại · {formatBytes(rows.reduce((s, c) => s + c.bytes, 0))}
        </span>
        {recalculating && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Spinner /> Đang tính lại…
          </span>
        )}
      </div>

      <div className={cn("rounded-xl border transition-opacity", recalculating && "pointer-events-none opacity-50")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox disabled={allConvs} checked={allConvs || allShownOn} onCheckedChange={toggleShown} />
              </TableHead>
              <SortHead label="Hội thoại" k="name" sort={sort} onSort={sortBy} />
              <TableHead>Ảnh gần đây</TableHead>
              <SortHead label="Tổng" k="bytes" sort={sort} onSort={sortBy} right />
              <SortHead
                label="Dọn được"
                k="cleanable"
                sort={sort}
                onSort={sortBy}
                right
                title="Phần chỉ thuộc hội thoại này, khớp bộ lọc ở trên"
              />
              <TableHead className="w-40">
                <Legend />
              </TableHead>
              <SortHead label="Mới nhất" k="lastTs" sort={sort} onSort={sortBy} right />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {convs.isPending
              ? Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-12 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : shown.map((c) => (
                  <Row
                    key={c.convId}
                    rootId={rootId}
                    conv={c}
                    max={max}
                    checked={allConvs || selected.has(c.convId)}
                    disabled={allConvs}
                    onToggle={() => toggle(c.convId)}
                    onMonths={readOnly ? undefined : () => setMonthsFor(c)}
                  />
                ))}
          </TableBody>
        </Table>
      </div>

      <ConversationMonthsDialog conv={monthsFor} base={base} onClose={() => setMonthsFor(null)} onCleanup={onCleanup} />

      <footer className="bg-background/95 fixed inset-x-0 bottom-0 z-10 border-t backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <div className="flex-1 text-sm">
            {!selection ? (
              <span className="text-muted-foreground">Chọn hội thoại (hoặc "Mọi hội thoại") và ít nhất một loại.</span>
            ) : !p || previewing ? (
              <span className="text-muted-foreground flex items-center gap-2">
                <Spinner /> Đang tính…
              </span>
            ) : (
              <div className="grid">
                <span>
                  <b className="text-base tabular-nums">{formatBytes(p.bytes)}</b> · {p.count.toLocaleString("vi-VN")} file ·{" "}
                  <span className="text-muted-foreground">
                    {p.byCategory.map((b) => `${CATEGORY_LABEL[b.key] ?? b.key} ${formatBytes(b.bytes)}`).join(" · ")}
                  </span>
                </span>
                {p.skippedShared.count > 0 && (
                  <span className="text-muted-foreground">
                    Giữ lại {p.skippedShared.count.toLocaleString("vi-VN")} file ({formatBytes(p.skippedShared.bytes)}) còn dùng ở
                    hội thoại khác
                  </span>
                )}
              </div>
            )}
          </div>
          <Button
            size="lg"
            disabled={readOnly || !selection || !p || p.count === 0 || previewing}
            onClick={() =>
              selection &&
              onCleanup({ filter: selection, title, caution: selection.categories?.some((c) => c === "document" || c === "archive") })
            }
          >
            {p?.count ? `Cách ly ${formatBytes(p.bytes)}` : "Cách ly"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  right,
  title,
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  right?: boolean;
  title?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
  return (
    <TableHead className={right ? "text-right" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        title={title}
        onClick={() => onSort(k)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 rounded px-1 -mx-1",
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-50")} />
      </button>
    </TableHead>
  );
}

function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-2 text-[11px] font-normal">
      {(["image", "video", "document", "other"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", COLORS[k])} />
          {CATEGORY_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

function Row({
  rootId,
  conv: c,
  max,
  checked,
  disabled,
  onToggle,
  onMonths,
}: {
  rootId: number;
  conv: Conversation;
  max: number;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Mở hộp thoại dọn hội thoại này theo tháng. */
  onMonths?: () => void;
}) {
  const [alias, setAlias] = useState(c.alias ?? "");
  useEffect(() => setAlias(c.alias ?? ""), [c.alias]);
  const save = async () => {
    if ((c.alias ?? "") === alias.trim()) return;
    try {
      await api.setAlias(rootId, c.convId, alias.trim() || null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const part = (bytes: number) => ({ width: `${(bytes / max) * 100}%` });

  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell>
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      </TableCell>
      <TableCell className="min-w-48">
        <Input
          className="h-7 border-transparent bg-transparent px-1 shadow-none hover:border-input focus-visible:border-input"
          value={alias}
          placeholder="Đặt tên…"
          onChange={(e) => setAlias(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
          {c.isGroup ? (
            <Badge className="border-transparent bg-violet-600 text-white">
              <Users /> Nhóm
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <User /> Cá nhân
            </Badge>
          )}
          <span className="font-mono">{c.convId}</span>
        </div>
      </TableCell>
      <TableCell onClick={disabled ? undefined : onToggle} className="cursor-pointer">
        <div className="flex gap-1">
          {c.thumbIds.map((id) => (
            <img
              key={id}
              src={api.thumbUrl(id)}
              loading="lazy"
              alt=""
              className="bg-muted size-10 rounded object-cover"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatBytes(c.bytes)}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {c.cleanableBytes > 0 ? formatBytes(c.cleanableBytes) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        <div
          className="bg-muted flex h-2 overflow-hidden rounded-full"
          title={`Ảnh ${formatBytes(c.imageBytes)} · Video ${formatBytes(c.videoBytes)} · Tài liệu ${formatBytes(c.documentBytes)} · Khác ${formatBytes(c.otherBytes)}`}
        >
          <span className={COLORS.image} style={part(c.imageBytes)} />
          <span className={COLORS.video} style={part(c.videoBytes)} />
          <span className={COLORS.document} style={part(c.documentBytes)} />
          <span className={COLORS.other} style={part(c.otherBytes)} />
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground text-right">{formatDate(c.lastTs)}</TableCell>
      <TableCell className="text-right">
        {onMonths && (
          <Button variant="ghost" size="sm" onClick={onMonths} title="Chọn một tháng, dọn từ tháng đó trở về trước">
            <CalendarRange /> Theo tháng
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
