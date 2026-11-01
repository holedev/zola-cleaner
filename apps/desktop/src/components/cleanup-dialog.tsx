/**
 * Xác nhận → cách ly → hướng dẫn kiểm tra trong Zalo. Dùng chung cho Gợi ý và Theo hội thoại.
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
  /** Sau khi cách ly xong, người dùng muốn sang tab Cách ly. */
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
      const r = await blocking.run("Đang cách ly…", () => api.quarantine(request.filter), "Đang chuyển file ra khu cách ly. Đừng mở Zalo lúc này.");
      await invalidate();
      if (r.moved === 0 && r.failed > 0) toast.error(`Không cách ly được ${r.failed} file (có thể đang bị khoá).`);
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
                <p>
                  File được chuyển vào <b>khu cách ly</b>, chưa xoá hẳn: bạn có 7 ngày để khôi phục. Dung lượng chỉ được trả lại
                  khi bấm <b>Giải phóng</b>.
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
              Cách ly {p ? formatBytes(p.bytes) : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={done != null} onOpenChange={(o) => !o && setDone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-600" />
              Đã cách ly {done && formatBytes(done.bytes)}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p>
                  {done?.moved.toLocaleString("vi-VN")} file đã vào khu cách ly
                  {done && done.failed > 0 ? ` (${done.failed} file bị khoá, giữ nguyên)` : ""}.
                </p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Mở Zalo, xem thử vài hội thoại vừa dọn.</li>
                  <li>
                    Nếu ổn, vào tab <b>Cách ly</b> bấm <b>Giải phóng ngay</b> để lấy lại dung lượng.
                  </li>
                  <li>Nếu thiếu gì, thoát Zalo rồi bấm <b>Khôi phục</b>.</li>
                </ol>
                <p className="text-xs">Không làm gì thì sau 7 ngày, lần mở app kế tiếp sẽ tự giải phóng.</p>
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
              Đến tab Cách ly
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
