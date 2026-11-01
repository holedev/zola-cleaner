/** Tình hình ổ đĩa chứa dữ liệu Zalo: ứng dụng khác / media Zalo / thùng rác / còn trống. */
import { useQuery } from "@tanstack/react-query";
import { HardDrive, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, formatBytes } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Dưới mức này coi là ổ đĩa sắp đầy. */
const LOW_FREE_RATIO = 0.1;

export function DiskCard({ rootId, className }: { rootId: number; className?: string }) {
  const q = useQuery({ queryKey: ["index", "disk", rootId], queryFn: () => api.diskSpace(rootId) });
  const d = q.data;

  if (!d) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

  const other = Math.max(0, d.total - d.free - d.zaloBytes - d.trashBytes);
  const pct = (n: number) => `${(n / d.total) * 100}%`;
  const low = d.free / d.total < LOW_FREE_RATIO;
  const parts = [
    { label: "Ứng dụng & dữ liệu khác", bytes: other, cls: "bg-zinc-400" },
    { label: "Media Zalo", bytes: d.zaloBytes, cls: "bg-blue-500" },
    { label: "Thùng rác của app", bytes: d.trashBytes, cls: "bg-amber-500" },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <HardDrive className="size-4" /> Ổ {d.drive} (nơi Zalo lưu dữ liệu)
        </CardDescription>
        <CardTitle className={cn("flex items-baseline gap-2 text-2xl", low && "text-destructive")}>
          Còn trống {formatBytes(d.free)}
          <span className="text-muted-foreground text-sm font-normal">/ {formatBytes(d.total)}</span>
          {low && (
            <span className="text-destructive flex items-center gap-1 text-sm font-normal">
              <TriangleAlert className="size-4" /> Ổ đĩa sắp đầy
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="bg-muted flex h-3 overflow-hidden rounded-full">
          {parts.map((p) => (
            <span key={p.label} className={p.cls} style={{ width: pct(p.bytes) }} title={`${p.label}: ${formatBytes(p.bytes)}`} />
          ))}
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-sm", p.cls)} />
              {p.label}: <b className="text-foreground tabular-nums">{formatBytes(p.bytes)}</b>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="bg-muted size-2 rounded-sm border" />
            Còn trống: <b className="text-foreground tabular-nums">{formatBytes(d.free)}</b>
          </span>
        </div>
        {d.trashBytes > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Dọn sạch thùng rác sẽ trống thêm {formatBytes(d.trashBytes)} (còn trống {formatBytes(d.free + d.trashBytes)}).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
