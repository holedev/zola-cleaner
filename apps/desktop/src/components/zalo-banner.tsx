import { useQueryClient } from "@tanstack/react-query";
import { ChevronUp, LogOut, MousePointerClick, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";

/** Hướng dẫn thoát hẳn Zalo (Zalo thường vẫn chạy dưới khay hệ thống sau khi đóng cửa sổ). */
export function ZaloBanner() {
  const Step = ({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) => (
    <li className="flex items-center gap-2">
      <span className="bg-amber-600 text-white flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
        {n}
      </span>
      <span className="text-amber-700 dark:text-amber-400">{icon}</span>
      <span>{children}</span>
    </li>
  );
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <TriangleAlert />
      <AlertTitle>Zalo đang chạy — cần thoát hẳn Zalo trước khi dọn hoặc khôi phục</AlertTitle>
      <AlertDescription className="text-amber-900 dark:text-amber-200">
        <p>Bạn vẫn xem và chọn được. Đóng cửa sổ Zalo là chưa đủ, Zalo vẫn chạy dưới khay hệ thống:</p>
        <ol className="mt-2 grid gap-1.5">
          <Step n={1} icon={<ChevronUp className="size-4" />}>
            Bấm mũi tên <b>^</b> ở góc phải thanh tác vụ (cạnh đồng hồ).
          </Step>
          <Step n={2} icon={<MousePointerClick className="size-4" />}>
            Chuột phải vào biểu tượng <b>Zalo</b>.
          </Step>
          <Step n={3} icon={<LogOut className="size-4" />}>
            Chọn <b>Thoát</b>. App sẽ tự nhận ra trong vài giây.
          </Step>
        </ol>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Zalo đã thoát nhưng còn tiến trình con bị treo (không cửa sổ, không biểu tượng ở khay) — hướng dẫn ở trên không giúp được.
 * Nút kết thúc chỉ chạy khi người dùng bấm, và lõi kiểm tra lại để không bao giờ đụng Zalo đang chạy thật.
 */
export function ZaloStuckBanner({ count }: { count: number }) {
  const qc = useQueryClient();
  const [ending, setEnding] = useState(false);
  const end = async () => {
    setEnding(true);
    try {
      const n = await api.endStuckZalo();
      if (n > 0) toast.success(`Đã kết thúc ${n} tiến trình Zalo bị treo`);
      else toast.error("Không kết thúc được. Hãy dùng Task Manager như hướng dẫn bên dưới.");
      await qc.invalidateQueries({ queryKey: keys.health });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setEnding(false);
    }
  };
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <TriangleAlert />
      <AlertTitle>Zalo đã thoát nhưng còn {count} tiến trình Zalo bị treo</AlertTitle>
      <AlertDescription className="text-amber-900 dark:text-amber-200">
        <p>
          Tiến trình này có thể vẫn giữ file, nên app chưa cho dọn hoặc khôi phục. Nó không có cửa sổ hay biểu tượng ở khay hệ thống,
          nên không thoát theo cách thông thường được.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" className="border-amber-400 bg-white" disabled={ending} onClick={end}>
            {ending && <Spinner />} Kết thúc tiến trình treo
          </Button>
          <span className="text-xs">
            Hoặc tự làm: mở Task Manager (Ctrl+Shift+Esc) → <b>Chi tiết</b> → chọn <b>Zalo.exe</b> → <b>Kết thúc tác vụ</b>. Khởi động
            lại máy cũng được.
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}
