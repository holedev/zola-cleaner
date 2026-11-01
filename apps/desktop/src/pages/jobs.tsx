import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, CircleCheck, FileArchive, FolderOpen, RotateCcw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useBlocking } from "@/components/blocking";
import { DiskCard } from "@/components/disk-card";
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
import { api, type ArchiveResult, errorMessage, formatBytes, formatDate, type Job, type JobStatus } from "@/lib/api";
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
  /** Vừa nén ZIP xong: gợi ý mở thư mục / xoá vĩnh viễn để lấy lại dung lượng. */
  const [exported, setExported] = useState<{ path: string; result: ArchiveResult; jobs: Job[] } | null>(null);
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

  /** Chạy thao tác dài có tiến độ (event archive-progress từ Rust). */
  const withProgress = async <T,>(title: string, fn: () => Promise<T>): Promise<T> => {
    const unlisten = await listen<{ done: number; total: number }>("archive-progress", (e) => {
      const { done, total } = e.payload;
      blocking.set({ title, detail: `${formatBytes(done)} / ${formatBytes(total)}`, percent: total ? (done / total) * 100 : undefined });
    });
    try {
      return await blocking.run(title, fn, "Có thể mất vài phút với thùng rác lớn. Đừng tắt app.");
    } finally {
      unlisten();
    }
  };

  const exportZip = async (list: Job[]) => {
    const day = new Date().toISOString().slice(0, 10);
    const path = await save({
      title: "Lưu bản sao lưu (ZIP)",
      defaultPath: `zola-cleaner-sao-luu-${day}.zip`,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!path) return;
    try {
      const result = await withProgress("Đang nén ZIP…", () =>
        api.exportBackup(
          list.map((j) => j.id),
          path,
        ),
      );
      setExported({ path, result, jobs: list });
    } catch (e) {
      toast.error(errorMessage(e));
    }
    await invalidate();
  };

  const importZip = async () => {
    const path = await open({ title: "Chọn bản sao lưu (ZIP) của Zola Cleaner", filters: [{ name: "ZIP", extensions: ["zip"] }] });
    if (typeof path !== "string") return;
    try {
      const r = await withProgress("Đang nhập lại từ ZIP…", () => api.importBackup(rootId, path));
      toast.success(
        `Đã đưa ${r.files.toLocaleString("vi-VN")} file (${formatBytes(r.bytes)}) về lại Zalo` +
          (r.skipped ? ` · ${r.skipped} file đã có sẵn` : "") +
          (r.failed ? ` · ${r.failed} file lỗi` : ""),
      );
      await api.startScan(rootId); // cập nhật chỉ mục; tiến độ quét hiện ở hộp thoại chung
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
      <div className="grid gap-4 lg:grid-cols-2">
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
          <CardAction className="flex flex-col items-end gap-2">
            <Button size="lg" disabled={active.length === 0} onClick={() => setConfirmPurge(active)}>
              <Trash2 /> Dọn sạch thùng rác
            </Button>
            <Button
              variant="outline"
              disabled={active.length === 0}
              onClick={() => exportZip(active)}
              title="Gom mọi file trong thùng rác vào một file ZIP để tải lên Drive, USB… trước khi xoá vĩnh viễn"
            >
              <FileArchive /> Nén ZIP để sao lưu
            </Button>
          </CardAction>
          <CardDescription className="text-xs">
            Đây là thùng rác riêng của Zola Cleaner, không phải Thùng rác của Windows. Muốn lấy lại file thì bấm Khôi phục ở
            đây — app sẽ trả file về đúng mọi chỗ Zalo cần.
          </CardDescription>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={zaloRunning}
              title={zaloRunning ? "Hãy thoát hẳn Zalo trước" : "Đưa file từ một bản sao lưu ZIP về lại Zalo"}
              onClick={importZip}
            >
              <Upload /> Nhập lại từ ZIP…
            </Button>
          </div>
        </CardHeader>
      </Card>
      <DiskCard rootId={rootId} />
      </div>

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
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={STATUS[j.status].variant}>{STATUS[j.status].label}</Badge>
                      {j.archivePath && (
                        <Badge variant="outline" title={`Đã nén: ${j.archivePath}`}>
                          <FileArchive /> Đã nén ZIP
                        </Badge>
                      )}
                    </div>
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
                        <Button variant="outline" size="sm" onClick={() => exportZip([j])} title="Nén lần dọn này thành ZIP">
                          <FileArchive /> Nén ZIP
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

      <AlertDialog open={exported != null} onOpenChange={(o) => !o && setExported(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-600" />
              Đã nén {exported && formatBytes(exported.result.bytes)} thành ZIP
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p className="text-foreground font-mono text-xs break-all">{exported?.path}</p>
                {exported && exported.result.failed > 0 && (
                  <p className="text-destructive">{exported.result.failed} file không đọc được nên không có trong ZIP.</p>
                )}
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Tải file ZIP lên Google Drive, OneDrive hoặc chép sang USB / ổ khác.</li>
                  <li>
                    Bấm <b>Xoá vĩnh viễn</b> để lấy lại dung lượng trên ổ này.
                  </li>
                  <li>
                    Cần lại thì vào đây bấm <b>Nhập lại từ ZIP…</b> — file về đúng chỗ trong Zalo.
                  </li>
                </ol>
                <p className="text-xs">Ảnh và video vốn đã nén sẵn nên file ZIP gần bằng dung lượng gốc.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" onClick={() => exported && void revealItemInDir(exported.path)}>
              <FolderOpen /> Mở thư mục
            </Button>
            <AlertDialogCancel>Để sau</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const list = exported?.jobs ?? [];
                setExported(null);
                setConfirmPurge(list);
              }}
            >
              Xoá vĩnh viễn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
