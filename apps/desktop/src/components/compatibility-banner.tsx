/**
 * Compatibility của Media Store đang chọn (xem CONTEXT.md): Supported Layout quyết định có được dọn không,
 * Zalo Version chỉ quyết định có cần cảnh báo không.
 */
import { Eye, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { RootInfo } from "@/lib/api";

/** Đã bấm "Đã hiểu" cho Zalo Version nào; Zalo cập nhật sang bản khác thì cảnh báo hiện lại. */
const DISMISS_KEY = "zc.untestedZaloVersion";

const zaloName = (v: string | null) => (v ? `Zalo PC ${v}` : "Zalo PC");

export function CompatibilityBanner({ root }: { root: RootInfo }) {
  const c = root.compatibility;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));
  const versionKey = root.zaloVersion ?? "unknown";

  if (c.status === "unsupported") {
    const advice = {
      updateZalo: `Hãy cập nhật Zalo PC lên bản mới nhất, mở Zalo một lúc để Zalo chuyển xong dữ liệu, rồi mở lại Zola Cleaner.`,
      updateApp: `${zaloName(root.zaloVersion)} mới hơn bản app đã kiểm chứng và Zalo đã đổi cách lưu file. Vào Cài đặt kiểm tra bản cập nhật của Zola Cleaner, hoặc bấm "Xuất báo cáo cấu trúc" và gửi cho nhà phát triển.`,
      report: `Vào Cài đặt, bấm "Xuất báo cáo cấu trúc" và gửi cho nhà phát triển để được hỗ trợ.`,
    }[c.advice];
    return (
      <Alert>
        <Eye />
        <AlertTitle>Chế độ chỉ xem</AlertTitle>
        <AlertDescription>
          Cấu trúc thư mục Zalo trên máy này khác với bản đã kiểm chứng, nên app không dọn để tránh xoá nhầm. {advice}
        </AlertDescription>
      </Alert>
    );
  }

  if (c.status === "untested" && dismissed !== versionKey) {
    const dismiss = () => {
      localStorage.setItem(DISMISS_KEY, versionKey);
      setDismissed(versionKey);
    };
    return (
      <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
        <ShieldQuestion />
        <AlertTitle>
          {c.reason === "unknown"
            ? "Không xác định được phiên bản Zalo PC"
            : `${zaloName(root.zaloVersion)} chưa được kiểm chứng (bản đã kiểm chứng: ${c.verified})`}
        </AlertTitle>
        <AlertDescription className="text-amber-900 dark:text-amber-200">
          <p>
            Cấu trúc thư mục vẫn khớp nên bạn vẫn dọn được. Nên dọn ít trước, mở Zalo kiểm tra ảnh và file vẫn hiện đúng, rồi mới xoá
            vĩnh viễn khỏi thùng rác.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={dismiss}>
            Đã hiểu
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
