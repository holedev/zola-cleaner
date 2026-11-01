import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { AREA_LABEL, type Bucket, CATEGORY_LABEL, formatBytes } from "@/lib/api";
import { useStats } from "@/lib/queries";

/** Tổng quan: thống kê dữ liệu Zalo. Tài khoản và đường dẫn nằm ở Cài đặt. */
export function OverviewPage({ rootId }: { rootId: number }) {
  const stats = useStats(rootId);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <BucketCard title="Theo loại" rows={stats.data?.byCategory} label={(k) => CATEGORY_LABEL[k] ?? k} />
      <BucketCard title="Theo tuổi" rows={stats.data?.byAge} />
      <BucketCard title="Theo thư mục của Zalo" rows={stats.data?.byArea} label={(k) => AREA_LABEL[k] ?? k} />
    </div>
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
