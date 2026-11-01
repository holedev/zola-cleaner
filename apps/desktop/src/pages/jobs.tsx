import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useBlocking } from "@/components/blocking";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, formatBytes, formatDate, type Job, type JobStatus } from "@/lib/api";
import { useHealth, useInvalidateIndex, useJobs } from "@/lib/queries";

const STATUS: Record<JobStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  running: { label: "Đang chạy", variant: "outline" },
  quarantined: { label: "Trong thùng rác", variant: "default" },
  restored: { label: "Đã khôi phục", variant: "secondary" },
  purged: { label: "Đã xoá vĩnh viễn", variant: "secondary" },
  failed: { label: "Có lỗi", variant: "destructive" },
};

const isActive = (j: Job) => j.status === "quarantined" || j.status === "failed";

export function JobsPage({ rootId }: { rootId: number }) {
  const jobs = useJobs(rootId);
  const health = useHealth();
  const blocking = useBlocking();
  const invalidate = useInvalidateIndex();
  const [confirmPurge, setConfirmPurge] = useState<Job[] | null>(null);
  const zaloRunning = !!health.data?.zaloRunning;

  const active = (jobs.data ?? []).filter(isActive);
  const holding = active.reduce((s, j) => s + j.totalBytes, 0);

  const purge = async (list: Job[]) => {
    setConfirmPurge(null);
    let freed = 0;
    let failed = 0;
    try {
      await blocking.run("Đang dọn sạch thùng rác…", async () => {
        for (const j of list) {
          const r = await api.purge(j.id);
          freed += r.bytes;
          failed += r.failed;
        }
      });
      toast.success(`Đã xoá vĩnh viễn, ổ đĩa trống thêm ${formatBytes(freed)}`);
      if (failed) toast.warning(`${failed} file chưa xoá được — thử lại sau.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await invalidate();
  };

  const restore = async (j: Job) => {
    try {
      const r = await blocking.run("Đang khôi phục…", () => api.restore(j.id), "Đang trả file về chỗ cũ. Đừng mở Zalo lúc này.");
      if (r.failed) toast.warning(`Đã khôi phục ${r.moved} file, ${r.failed} file lỗi — thử lại sau.`);
      else toast.success(`Đã khôi phục ${r.moved.toLocaleString("vi-VN")} file (${formatBytes(r.bytes)})`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await invalidate();
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <Archive className="size-4" /> Đang nằm trong thùng rác (vẫn chiếm ổ đĩa)
          </CardDescription>
          {jobs.isPending ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <CardTitle className="text-4xl font-semibold tabular-nums">{formatBytes(holding)}</CardTitle>
          )}
          <CardAction>
            <Button size="lg" disabled={active.length === 0} onClick={() => setConfirmPurge(active)}>
              <Trash2 /> Dọn sạch thùng rác
            </Button>
          </CardAction>
          <CardDescription className="text-xs">
            Đây là thùng rác riêng của Zola Cleaner, không phải Thùng rác của Windows. Muốn lấy lại file thì bấm Khôi phục ở
            đây — app sẽ trả file về đúng mọi chỗ Zalo cần.
          </CardDescription>
        </CardHeader>
      </Card>

      {jobs.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !jobs.data?.length ? (
        <p className="text-muted-foreground">Chưa có lần dọn nào.</p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Thời điểm</TableHead>
                <TableHead className="text-right">Số file</TableHead>
                <TableHead className="text-right">Dung lượng</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Tự xoá vĩnh viễn</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.data.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="text-muted-foreground">{j.id}</TableCell>
                  <TableCell>{new Date(j.createdAt).toLocaleString("vi-VN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{j.itemCount.toLocaleString("vi-VN")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(j.totalBytes)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[j.status].variant}>{STATUS[j.status].label}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.status === "quarantined" ? formatDate(j.expiresAt) : "—"}</TableCell>
                  <TableCell className="text-right">
                    {isActive(j) && (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={zaloRunning}
                          title={zaloRunning ? "Hãy thoát hẳn Zalo trước" : undefined}
                          onClick={() => restore(j)}
                        >
                          <RotateCcw /> Khôi phục
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setConfirmPurge([j])}>
                          <Trash2 /> Xoá vĩnh viễn
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={confirmPurge != null} onOpenChange={(o) => !o && setConfirmPurge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Xoá vĩnh viễn {formatBytes((confirmPurge ?? []).reduce((s, j) => s + j.totalBytes, 0))}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(confirmPurge ?? []).reduce((s, j) => s + j.itemCount, 0).toLocaleString("vi-VN")} file sẽ bị xoá vĩnh viễn và
              không khôi phục được nữa. Hãy chắc là bạn đã mở Zalo kiểm tra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => confirmPurge && purge(confirmPurge)}>
              Xoá vĩnh viễn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
