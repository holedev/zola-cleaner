/**
 * Thao tác dài (quét, chuyển vào thùng rác, khôi phục, dọn sạch) hiện hộp thoại chặn mọi thao tác khác:
 * người dùng biết app đang làm việc và chỉ cần chờ.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

export interface BlockingState {
  title: string;
  detail?: string;
  /** 0–100; không có → thanh chạy vô định. */
  percent?: number;
  /** Dòng ghi chú nhỏ dưới thanh tiến độ. */
  note?: string;
}

interface BlockingApi {
  /** Chạy `fn` trong lúc hiện hộp thoại chờ. */
  run: <T>(title: string, fn: () => Promise<T>, detail?: string) => Promise<T>;
  /** Hiện / cập nhật / ẩn hộp thoại chờ thủ công (ví dụ tiến độ quét đến từ event). */
  set: (s: BlockingState | null) => void;
}

const Ctx = createContext<BlockingApi | null>(null);

export function BlockingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BlockingState | null>(null);

  const run = useCallback(async <T,>(title: string, fn: () => Promise<T>, detail?: string) => {
    setState({ title, detail });
    try {
      return await fn();
    } finally {
      setState(null);
    }
  }, []);

  const api = useMemo(() => ({ run, set: setState }), [run]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={state != null}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Spinner className="size-5" />
              {state?.title}
            </DialogTitle>
            <DialogDescription>{state?.detail ?? "Vui lòng chờ, đừng tắt app."}</DialogDescription>
          </DialogHeader>
          {state?.percent != null ? (
            <Progress value={state.percent} />
          ) : (
            <div className="bg-muted h-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full" />
            </div>
          )}
          {state?.note ? <p className="text-muted-foreground text-xs">{state.note}</p> : null}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useBlocking(): BlockingApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBlocking phải nằm trong BlockingProvider");
  return ctx;
}
