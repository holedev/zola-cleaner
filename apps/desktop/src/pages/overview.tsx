import { open, save } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileDown, FolderPlus, ScrollText, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useBlocking } from "@/components/blocking";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { api, AREA_LABEL, type Bucket, CATEGORY_LABEL, errorMessage, formatBytes, type RootInfo } from "@/lib/api";
import { keys, useRoots, useStats } from "@/lib/queries";

export function OverviewPage({ rootId }: { rootId: number }) {
  const stats = useStats(rootId);
  const roots = useRoots();
  const qc = useQueryClient();
  const blocking = useBlocking();

  const addRoot = async () => {
    const dir = await open({ directory: true, title: "Chọn thư mục ZaloDownloads" });
    if (typeof dir !== "string") return;
    try {
      await api.addRoot(dir);
      await qc.invalidateQueries({ queryKey: keys.roots });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const exportReport = async (r: RootInfo) => {
    const path = await save({ title: "Lưu báo cáo cấu trúc", defaultPath: "zola-cleaner-bao-cao.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return;
    try {
      await blocking.run("Đang lập báo cáo cấu trúc…", () => api.exportReport(r.id, path));
      toast.success("Đã lưu báo cáo. Báo cáo không chứa tên file, ID hay nội dung — bạn có thể gửi cho nhà phát triển.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const exportLog = async () => {
    const path = await save({ title: "Lưu nhật ký", defaultPath: "zola-cleaner-nhat-ky.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try {
      await api.exportLog(path);
      toast.success("Đã lưu nhật ký (đã lược đường dẫn và ID).");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <BucketCard title="Theo loại" rows={stats.data?.byCategory} label={(k) => CATEGORY_LABEL[k] ?? k} />
        <BucketCard title="Theo tuổi" rows={stats.data?.byAge} />
        <BucketCard title="Theo thư mục của Zalo" rows={stats.data?.byArea} label={(k) => AREA_LABEL[k] ?? k} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thư mục media của Zalo (theo tài khoản)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {roots.data?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              {r.layout.status === "supported" ? (
                <Badge variant="secondary">
                  <CircleCheck /> Hỗ trợ
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-400 text-amber-700">
                  <TriangleAlert /> Chỉ xem
                </Badge>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs" title={r.path}>
                  {r.path}
                </div>
                {r.layout.status === "unsupported" && (
                  <div className="text-muted-foreground text-xs">{r.layout.reasons.join(" · ")}</div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => exportReport(r)}>
                <FileDown /> Xuất báo cáo cấu trúc
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={addRoot}>
              <FolderPlus /> Thêm thư mục…
            </Button>
            <Button variant="ghost" onClick={exportLog}>
              <ScrollText /> Xuất nhật ký
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            App không gửi dữ liệu nào ra ngoài. Báo cáo và nhật ký chỉ được lưu vào file bạn chọn; hãy gửi chúng cho nhà phát triển
            khi app báo "Chỉ xem" hoặc gặp lỗi.
          </p>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-xs">
        Zola Cleaner là phần mềm mã nguồn mở độc lập, không liên kết với Zalo hay VNG.
      </p>
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
