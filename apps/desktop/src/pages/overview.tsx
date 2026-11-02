import { useQuery } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { api, AREA_LABEL, type Bucket, CATEGORY_LABEL, type DriveCard as Drive, formatBytes } from "@/lib/api";
import { useStats } from "@/lib/queries";

/** Tổng quan: thống kê dữ liệu Zalo. Tài khoản và đường dẫn nằm ở Cài đặt. */
export function OverviewPage({ rootId }: { rootId: number }) {
  const stats = useStats(rootId);
  const drives = useQuery({ queryKey: ["index", "drives", rootId], queryFn: () => api.drives(rootId) });
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {drives.data ? (
          drives.data.map((d) => <DriveCard key={d.letter || d.roles.join()} drive={d} />)
        ) : (
          <Skeleton className="h-36 rounded-xl" />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <BucketCard title="Theo loại" rows={stats.data?.byCategory} label={(k) => CATEGORY_LABEL[k] ?? k} />
        <BucketCard title="Theo tuổi" rows={stats.data?.byAge} />
        <BucketCard title="Theo thư mục của Zalo" rows={stats.data?.byArea} label={(k) => AREA_LABEL[k] ?? k} />
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<Drive["roles"][number], string> = { zalo: "Dữ liệu Zalo", trash: "Thùng rác" };
const MEDIA_LABEL: Record<Drive["media"], string | null> = { ssd: "SSD", hdd: "HDD", unknown: null };
const HEALTH: Record<Drive["health"], { label: string; badge: string; card: string }> = {
  healthy: { label: "Tốt", badge: "border-emerald-300 text-emerald-700 dark:text-emerald-400", card: "" },
  warning: { label: "Cảnh báo", badge: "border-amber-400 text-amber-700 dark:text-amber-400", card: "border-amber-400" },
  unhealthy: { label: "Hỏng", badge: "border-red-400 text-red-700 dark:text-red-400", card: "border-red-400" },
  unknown: { label: "Không rõ", badge: "text-muted-foreground", card: "" },
};

/** Loại và sức khoẻ ổ đĩa theo Windows, kèm dung lượng còn trống. */
function DriveCard({ drive: d }: { drive: Drive }) {
  const h = HEALTH[d.health];
  const kind = [MEDIA_LABEL[d.media], d.bus].filter(Boolean).join(" · ") || "Không rõ loại";
  const used = d.free != null && d.total ? (d.total - d.free) / d.total : null;
  return (
    <Card className={h.card}>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <HardDrive className="text-muted-foreground size-4" />
        <CardTitle className="text-base">
          {d.letter ? `Ổ ${d.letter}` : "Ổ mạng"} · {d.roles.map((r) => ROLE_LABEL[r]).join(", ")}
        </CardTitle>
        <div className="flex-1" />
        <Badge variant="outline">{kind}</Badge>
        <Badge variant="outline" className={h.badge} title="Theo đánh giá của Windows">
          {h.label}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="text-muted-foreground truncate">{d.model ?? "Không đọc được tên ổ"}</div>
        {used != null && (
          <>
            <div className="bg-muted h-2 rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: `${used * 100}%` }} />
            </div>
            <div className="tabular-nums">
              Còn trống <b>{formatBytes(d.free!)}</b> / {formatBytes(d.total!)}
            </div>
          </>
        )}
        {(d.health === "warning" || d.health === "unhealthy") && (
          <p className={d.health === "unhealthy" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
            Windows báo ổ này {d.health === "unhealthy" ? "đang hỏng" : "có dấu hiệu bất thường"}. Hãy sao lưu dữ liệu quan trọng sớm và
            kiểm tra ổ bằng công cụ của hãng sản xuất.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BucketCard({ title, rows, label }: { title: string; rows?: Bucket[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.bytes));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows ? (
          <div className="grid gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        ) : (
          <Table>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="py-1.5">{label ? label(r.key) : r.key}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{formatBytes(r.bytes)}</TableCell>
                  <TableCell className="w-24 py-1.5">
                    <div className="bg-muted h-1.5 rounded-full">
                      <div className="bg-primary h-full rounded-full" style={{ width: `${(r.bytes / max) * 100}%` }} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
