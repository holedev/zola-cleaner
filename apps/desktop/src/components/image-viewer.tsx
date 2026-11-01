/** Xem ảnh cỡ lớn trong một danh sách (←/→ để chuyển ảnh). */
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";

interface ViewerState {
  ids: number[];
  index: number;
  title?: string;
}

const Ctx = createContext<((ids: number[], index: number, title?: string) => void) | null>(null);

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewerState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const open = useCallback((ids: number[], index: number, title?: string) => setState({ ids, index, title }), []);
  const id = state?.ids[state.index];
  const count = state?.ids.length ?? 0;

  const go = useCallback(
    (delta: number) => setState((s) => (s ? { ...s, index: (s.index + delta + s.ids.length) % s.ids.length } : s)),
    [],
  );
  useEffect(() => setLoaded(false), [id]);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, go]);

  const openExternal = async () => {
    if (id == null) return;
    try {
      await api.openItem(id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Ctx.Provider value={useMemo(() => open, [open])}>
      {children}
      <Dialog open={state != null} onOpenChange={(o) => !o && setState(null)}>
        <DialogContent className="flex h-[90vh] max-w-[92vw] flex-col gap-3 p-4 sm:max-w-[92vw]">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="truncate text-base">{state?.title ?? "Xem ảnh"}</DialogTitle>
            <DialogDescription className="tabular-nums">
              {state && `${state.index + 1} / ${count}`}
            </DialogDescription>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={openExternal}>
              <ExternalLink /> Mở bằng ứng dụng ảnh
            </Button>
          </div>
          <div className="bg-muted/40 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg">
            {!loaded && <Spinner className="absolute size-8" />}
            {id != null && (
              <img
                key={id}
                src={api.viewUrl(id)}
                alt=""
                className="max-h-full max-w-full object-contain"
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
              />
            )}
            {count > 1 && (
              <>
                <Button variant="secondary" size="icon-lg" className="absolute left-3 rounded-full" onClick={() => go(-1)}>
                  <ChevronLeft />
                </Button>
                <Button variant="secondary" size="icon-lg" className="absolute right-3 rounded-full" onClick={() => go(1)}>
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

/** Mở trình xem: `view(ids, index, tiêu đề)`. */
export function useImageViewer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useImageViewer phải nằm trong ImageViewerProvider");
  return v;
}
