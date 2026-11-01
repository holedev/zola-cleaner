/**
 * Hướng dẫn bật "Tự động tải" của Zalo PC: không có zCloud thì file chưa tải về máy sẽ bị máy chủ Zalo xoá sau một số ngày.
 * App không tự tải thay Zalo được (xem docs/adr/0003-khong-dieu-khien-zalo.md), nên chỉ chỉ chỗ bật tuỳ chọn có sẵn.
 */
import { ChevronRight, CloudDownload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DISMISS_KEY = "zc.autoDownloadTip";

/** Đường đi trong Zalo PC, đúng chữ trên giao diện Zalo. */
const ZALO_PATH = ["Cài đặt", "Tin nhắn", "Cài đặt khác"];
const ZALO_OPTION = "Tự động tải trước Ảnh/File/Video/Tin nhắn thoại dưới 30MB";

export function AutoDownloadSteps() {
  return (
    <div className="grid gap-4 text-sm">
      <p>
        Nếu không dùng zCloud, file chỉ nằm trên máy chủ Zalo <b>một số ngày</b> rồi bị xoá. File chưa tải về máy lúc đó sẽ mất hẳn.
      </p>
      <ol className="grid list-decimal gap-3 pl-5">
        <li>
          Trong Zalo PC, mở
          <span className="ml-1.5 inline-flex flex-wrap items-center gap-0.5 font-medium">
            {ZALO_PATH.map((p, i) => (
              <span key={p} className="inline-flex items-center gap-0.5">
                {i > 0 && <ChevronRight className="text-muted-foreground size-3.5" />}
                <span className="bg-muted rounded px-1.5 py-0.5">{p}</span>
              </span>
            ))}
          </span>
        </li>
        <li>
          Bật <b>{ZALO_OPTION}</b>.
        </li>
        <li>Giữ Zalo PC mở. Zalo chỉ tự tải khi đang chạy.</li>
      </ol>
      <p className="text-muted-foreground">
        File <b className="text-foreground">trên 30MB</b> không được tự tải. Hãy bấm tải về trong Zalo trước khi hết hạn. Tài liệu đã dọn
        mà Zalo cũng đã xoá trên máy chủ thì không tải lại được, nên Zola Cleaner không bao giờ chọn sẵn Tài liệu.
      </p>
    </div>
  );
}

/** Thẻ nhắc nhỏ ở cuối màn Dọn nhanh. Bấm "Đã bật" thì ẩn hẳn. */
export function AutoDownloadTip() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(DISMISS_KEY) === "done");
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "done");
    setHidden(true);
    setOpen(false);
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm">
        <CloudDownload className="text-zalo size-5 shrink-0" />
        <p className="min-w-60 flex-1">
          <b>Giữ file Zalo không bị hết hạn.</b>{" "}
          <span className="text-muted-foreground">Không dùng zCloud? Bật tự động tải của Zalo để file về máy trước khi máy chủ xoá.</span>
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Xem cách bật
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Đã bật
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Giữ file Zalo không bị hết hạn</DialogTitle>
            <DialogDescription>Một tuỳ chọn có sẵn trong Zalo PC, bật một lần là xong.</DialogDescription>
          </DialogHeader>
          <AutoDownloadSteps />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Để sau
            </Button>
            <Button onClick={dismiss}>Đã bật</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
