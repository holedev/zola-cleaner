/**
 * Xác nhận → chuyển vào thùng rác → hướng dẫn kiểm tra trong Zalo. Dùng chung cho Gợi ý và Theo hội thoại.
 */
import { CircleCheck, TriangleAlert } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api, CATEGORY_LABEL, type CleanupFilter, errorMessage, formatBytes, type JobResult } from "@/lib/api";
import { describeFilter, describeKept } from "@/lib/describe";
import { useHealth, useInvalidateIndex, usePreview } from "@/lib/queries";

export interface CleanupRequest {
  filter: CleanupFilter;
  title: string;
  /** Tài liệu có thể không tải lại được từ Zalo → nhấn mạnh cảnh báo. */
  caution?: boolean;
}

interface Props {
  request: CleanupRequest | null;
  onClose: () => void;
  /** Sau khi chuyển vào thùng rác, người dùng muốn sang tab Thùng rác. */
  onGoToJobs: () => void;
}

export function CleanupDialog({ request, onClose, onGoToJobs }: Props) {
  const preview = usePreview(request?.filter ?? null);
  const health = useHealth();
  const blocking = useBlocking();
  const invalidate = useInvalidateIndex();
  const [done, setDone] = useState<JobResult | null>(null);
  const zaloRunning = !!health.data?.zaloRunning;
  const p = preview.data;

  const confirm = async () => {
    if (!request) return;
    onClose();
    try {
      const r = await blocking.run("Đang chuyển vào thùng rác…", () => api.quarantine(request.filter), "Đừng mở Zalo lúc này.");
      await invalidate();
      if (r.moved === 0 && r.failed > 0) toast.error(`Không chuyển được ${r.failed} file (có thể đang bị khoá).`);
      else setDone(r);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <AlertDialog open={request != null} onOpenChange={(o) => !o && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-3">
                {!p || preview.isFetching ? (
                  <div className="grid gap-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                ) : (
                  <div>
                    <div className="text-foreground text-2xl font-semibold">{formatBytes(p.bytes)}</div>
                    <div>
                      {p.count.toLocaleString("vi-VN")} file ·{" "}
                      {p.byCategory.map((b) => `${CATEGORY_LABEL[b.key] ?? b.key} ${formatBytes(b.bytes)}`).join(" · ")}
                    </div>
                    {p.skippedShared.count > 0 && (
                      <div className="mt-1">
                        Giữ lại {p.skippedShared.count.toLocaleString("vi-VN")} file ({formatBytes(p.skippedShared.bytes)}) vì
                        còn dùng ở hội thoại không được chọn.
                      </div>
                    )}
                  </div>
                )}
                {request && (
                  <div className="text-foreground rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/30">
                    <b>Sẽ dọn:</b> {describeFilter(request.filter)}
                    <div className="text-muted-foreground mt-0.5">{describeKept(request.filter)}</div>
                  </div>
                )}
                <p>
                  File được chuyển vào <b>thùng rác của Zola Cleaner</b>, chưa xoá hẳn: bạn có 7 ngày để khôi phục. Dung lượng chỉ
                  được trả lại khi <b>dọn sạch thùng rác</b>.
                </p>
                {request?.caution && (
                  <p className="text-destructive flex gap-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    Tài liệu (PDF, Word, ZIP…) có thể không tải lại được từ Zalo nếu đã hết hạn trên máy chủ. Chỉ dọn khi chắc
                    không cần nữa.
                  </p>
                )}
                {zaloRunning && <p className="text-destructive">Zalo đang chạy — hãy thoát hẳn Zalo trước.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction disabled={!p || p.count === 0 || zaloRunning || preview.isFetching} onClick={confirm}>
              Chuyển {p ? formatBytes(p.bytes) : ""} vào thùng rác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={done != null} onOpenChange={(o) => !o && setDone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-600" />
              Đã chuyển {done && formatBytes(done.bytes)} vào thùng rác
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p>
                  {done?.moved.toLocaleString("vi-VN")} file đã vào thùng rác
                  {done && done.failed > 0 ? ` (${done.failed} file bị khoá, giữ nguyên)` : ""}.
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Mở Zalo, xem thử vài hội thoại vừa dọn.</li>
                  <li>
                    Nếu ổn, vào tab <b>Thùng rác</b> bấm <b>Dọn sạch thùng rác</b> để lấy lại dung lượng.
                  </li>
                  <li>Nếu thiếu gì, thoát Zalo rồi bấm <b>Khôi phục</b>.</li>
                </ol>
                <p className="text-xs">Không làm gì thì sau 7 ngày, lần mở app kế tiếp sẽ tự xoá vĩnh viễn.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Để sau</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDone(null);
                onGoToJobs();
              }}
            >
              Đến Thùng rác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
