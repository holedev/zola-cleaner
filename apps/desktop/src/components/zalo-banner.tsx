import { ChevronUp, LogOut, MousePointerClick, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
