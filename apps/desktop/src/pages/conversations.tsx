import { ArrowDown, ArrowUp, ArrowUpDown, CalendarRange, FileText, Info, Search, User, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CleanupRequest } from "@/components/cleanup-dialog";
import { ConversationMonthsDialog } from "@/components/conversation-months";
import { useImageViewer } from "@/components/image-viewer";
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
import { api, CATEGORY_LABEL, type CleanupFilter, type Conversation, docColor, docLabel, errorMessage, formatBytes, formatDate, type KindBucket } from "@/lib/api";
import { describeFilter, describeKept } from "@/lib/describe";
import { useConversations, useDebounced, useDocKinds, usePreview } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Nhóm Media Kind trên bộ lọc → các category của lõi. Tài liệu không bao giờ được chọn sẵn. */
const KINDS = [
  { key: "image", label: "Ảnh", categories: ["image"], default: true },
  { key: "video", label: "Video", categories: ["video"], default: true },
  { key: "document", label: "Tài liệu", categories: ["document", "archive"], default: false },
  { key: "other", label: "Âm thanh & khác", categories: ["audio", "other"], default: false },
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

/** Gộp các định dạng cùng nhãn (docx + doc → Word) thành một ô chọn. */
function groupFormats(buckets: KindBucket[]) {
  const map = new Map<string, { label: string; kinds: string[]; count: number; bytes: number }>();
  for (const b of buckets) {
    const label = docLabel(b.kind);
    const g = map.get(label) ?? { label, kinds: [], count: 0, bytes: 0 };
    g.kinds.push(b.kind);
    g.count += b.count;
    g.bytes += b.bytes;
    map.set(label, g);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Chọn định dạng tài liệu cần dọn (ZIP, RAR, PDF…). Không chọn ô nào = mọi định dạng. */
function FormatPicker({
  buckets,
  loading,
  selected,
  onChange,
}: {
  buckets: KindBucket[] | undefined;
  loading: boolean;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const groups = groupFormats(buckets ?? []);
  const toggle = (kinds: string[], on: boolean) => {
    const next = new Set(selected);
    for (const k of kinds) {
      if (on) next.delete(k);
      else next.add(k);
    }
    onChange(next);
  };
  return (
    <div className="grid basis-full gap-2">
      <Label className="text-muted-foreground text-xs">
        Định dạng tài liệu
        <span className="font-normal">
          {selected.size ? "· chỉ dọn các định dạng đã chọn" : "· đang dọn mọi định dạng, bấm để chỉ chọn vài loại"}
        </span>
        {loading && <Spinner className="size-3" />}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        {groups.length === 0 && !loading && <span className="text-muted-foreground text-sm">Không có tài liệu nào khớp bộ lọc.</span>}
        {groups.map((g) => {
          const on = g.kinds.some((k) => selected.has(k));
          return (
            <button
              key={g.label}
              type="button"
              aria-pressed={on}
              title={`${g.count.toLocaleString("vi-VN")} file`}
              onClick={() => toggle(g.kinds, on)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted bg-white",
              )}
            >
              {g.label} <span className={cn("figure", on ? "opacity-90" : "text-muted-foreground")}>{formatBytes(g.bytes)}</span>
            </button>
          );
        })}
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(new Set())}>
            Bỏ chọn
          </Button>
        )}
      </div>
    </div>
  );
}

/** Nhóm "Âm thanh & khác" gồm những gì — hiện khi rê chuột. */
const OTHER_HINT = "Ghi âm, nhạc (mp3, m4a) và vài file không nhận ra loại";

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
  /** Định dạng tài liệu được chọn (zip, pdf…). Rỗng = mọi định dạng. */
  const [docKinds, setDocKinds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allConvs, setAllConvs] = useState(false);
  const [query, setQuery] = useState("");
  const [monthsFor, setMonthsFor] = useState<Conversation | null>(null);
  // Mặc định sắp theo "Dọn được": đổi bộ lọc là thứ tự bảng đổi theo, thấy ngay tác dụng
  const [sort, setSort] = useState<Sort>({ key: "cleanable", desc: true });
  const sortBy = (key: SortKey) =>
    // Bấm lại cột đang sắp → đảo chiều; cột mới → tên A→Z, số liệu lớn → nhỏ
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  const withDocs = kinds.has("document") || kinds.has("other");
  const rawBase: CleanupFilter = useMemo(() => {
    const mb = Number(minSizeMb);
    return {
      rootId,
      categories: KINDS.filter((k) => kinds.has(k.key)).flatMap((k) => [...k.categories]),
      olderThanDays: olderThanDays || undefined,
      minSize: mb > 0 ? Math.round(mb * 1024 * 1024) : undefined,
      docKinds: withDocs && docKinds.size ? [...docKinds].sort() : undefined,
    };
  }, [rootId, kinds, olderThanDays, minSizeMb, withDocs, docKinds]);
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
  // Dung lượng từng định dạng trong phạm vi đang chọn (hội thoại đã tick, hoặc mọi hội thoại)
  const rawKindScope: CleanupFilter | null = useMemo(
    () =>
      withDocs
        ? { ...rawBase, docKinds: undefined, convIds: allConvs || selected.size === 0 ? undefined : [...selected].sort() }
        : null,
    [withDocs, rawBase, allConvs, selected],
  );
  const kindScope = useDebounced(rawKindScope);
  const kindBuckets = useDocKinds(kindScope);

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

  // Bỏ chọn hết → không hiện số liệu cũ còn giữ trong cache (keepPreviousData)
  const p = selection ? preview.data : undefined;
  const title = allConvs ? "Dọn ở mọi hội thoại" : `Dọn ${selected.size} hội thoại đã chọn`;

  return (
    <div className="grid gap-4">
      <div className="bg-card flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border p-4">
        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs">Loại</Label>
          <div className="flex gap-4">
            {KINDS.map((k) => (
              <Label key={k.key} className="font-normal" title={k.key === "other" ? OTHER_HINT : undefined}>
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
        {withDocs && (
          <FormatPicker
            buckets={kindBuckets.data}
            loading={rawKindScope !== kindScope || kindBuckets.isFetching}
            selected={docKinds}
            onChange={setDocKinds}
          />
        )}
      </div>

      {rawBase.categories?.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>Sẽ dọn:</b> {describeFilter(rawSelection ?? { ...rawBase, convIds: allConvs ? undefined : [...selected] })}{" "}
            <span className="text-red-900/70 dark:text-red-200/70">{describeKept(rawSelection ?? rawBase)}</span>
            {!allConvs && selected.size === 0 && <span className="text-red-900/70"> Hãy tick hội thoại cần dọn.</span>}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input className="pl-8" placeholder="Tìm theo tên tự đặt hoặc ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="text-muted-foreground text-sm">
          {rows.length} hội thoại · tổng {formatBytes(rows.reduce((s, c) => s + c.bytes, 0))}
        </span>
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Theo bộ lọc: dọn được <b className="tabular-nums">{formatBytes(rows.reduce((s, c) => s + c.cleanableBytes, 0))}</b> ở{" "}
          {rows.filter((c) => c.cleanableBytes > 0).length} hội thoại
        </span>
        {recalculating && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Spinner /> Đang tính lại…
          </span>
        )}
      </div>

      <div className={cn("overflow-x-auto rounded-xl border bg-white transition-opacity", recalculating && "pointer-events-none opacity-50")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox disabled={allConvs} checked={allConvs || allShownOn} onCheckedChange={toggleShown} />
              </TableHead>
              <SortHead label="Hội thoại" k="name" sort={sort} onSort={sortBy} />
              <TableHead title="Vài ảnh trong số sẽ bị dọn theo bộ lọc. Bấm để xem.">Ảnh sẽ dọn</TableHead>
              <TableHead title="Vài tài liệu trong số sẽ bị dọn theo bộ lọc. Bấm để mở.">Tài liệu sẽ dọn</TableHead>
              <SortHead label="Tổng" k="bytes" sort={sort} onSort={sortBy} right />
              <SortHead
                label="Dọn được"
                hint="theo bộ lọc"
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
                    <TableCell colSpan={9}>
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

      <footer className="bg-background/95 sticky bottom-0 z-10 -mx-8 -mb-10 border-t backdrop-blur">
        <div className="flex items-center gap-4 px-8 py-3">
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
            {p?.count ? `Chuyển ${formatBytes(p.bytes)} vào thùng rác` : "Chuyển vào thùng rác"}
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
  hint,
}: {
  label: string;
  /** Dòng chú thích nhỏ dưới tiêu đề. */
  hint?: string;
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
      {hint && <div className="text-muted-foreground text-[10px] leading-none font-normal">{hint}</div>}
    </TableHead>
  );
}

function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-2 text-[11px] font-normal">
      {(["image", "video", "document", "other"] as const).map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", COLORS[k])} />
          {k === "other" ? <span title={OTHER_HINT}>Âm thanh & khác</span> : CATEGORY_LABEL[k]}
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
  const view = useImageViewer();
  const openDoc = async (id: number) => {
    try {
      await api.openItem(id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

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
      <TableCell>
        <div className="flex gap-1">
          {c.thumbIds.map((id, i) => (
            <button
              key={id}
              type="button"
              title="Xem ảnh"
              // 6 ảnh trên màn hình thường, 10 ảnh trên màn hình lớn
              className={cn("focus-visible:ring-ring shrink-0 rounded outline-none focus-visible:ring-2", i >= 6 && "hidden 2xl:block")}
              onClick={() => view(c.thumbIds, i, c.alias || c.convId)}
            >
              <img
                src={api.thumbUrl(id)}
                loading="lazy"
                alt=""
                className="bg-muted size-10 rounded object-cover transition hover:brightness-90 2xl:size-12"
                onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              />
            </button>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          {c.recentDocs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDoc(d.id)}
              title={`Mở ${d.name ?? docLabel(d.kind)} · ${docLabel(d.kind)} · ${formatBytes(d.size)} · ${formatDate(d.ts)}`}
              className="hover:bg-muted flex max-w-72 items-center gap-1.5 rounded px-1 text-left text-xs"
            >
              <FileText className={cn("size-3.5 shrink-0", docColor(d.kind))} />
              {d.name ? (
                <span className="truncate font-medium">{d.name}</span>
              ) : (
                <span className="font-medium">{docLabel(d.kind)}</span>
              )}
              <span className="text-muted-foreground shrink-0 tabular-nums">{formatBytes(d.size)}</span>
              {!d.name && <span className="text-muted-foreground shrink-0">{formatDate(d.ts)}</span>}
            </button>
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
          title={`Ảnh ${formatBytes(c.imageBytes)} · Video ${formatBytes(c.videoBytes)} · Tài liệu ${formatBytes(c.documentBytes)} · Âm thanh & khác ${formatBytes(c.otherBytes)}`}
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
