/** Thanh bên: tên app, tài khoản đang xem, điều hướng, tình trạng ổ đĩa. */
import { useQuery } from "@tanstack/react-query";
import { ChartPie, MessagesSquare, RefreshCw, Settings, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountName, api, formatBytes, type RootInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Tab = "suggestions" | "conversations" | "jobs" | "overview" | "settings";

export const TAB_TITLE: Record<Tab, string> = {
  suggestions: "Dọn nhanh",
  conversations: "Theo hội thoại",
  jobs: "Thùng rác",
  overview: "Tổng quan",
  settings: "Cài đặt",
};

const NAV: { tab: Tab; icon: ReactNode }[] = [
  { tab: "suggestions", icon: <Sparkles /> },
  { tab: "conversations", icon: <MessagesSquare /> },
  { tab: "jobs", icon: <Trash2 /> },
  { tab: "overview", icon: <ChartPie /> },
  { tab: "settings", icon: <Settings /> },
];

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  roots: RootInfo[];
  rootId: number;
  onRoot: (id: number) => void;
  onScan: () => void;
}

export function Sidebar({ tab, onTab, roots, rootId, onRoot, onScan }: Props) {
  const disk = useQuery({ queryKey: ["index", "disk", rootId], queryFn: () => api.diskSpace(rootId) });
  const d = disk.data;
  const root = roots.find((r) => r.id === rootId);

  return (
    <aside className="bg-sidebar flex h-screen w-60 shrink-0 flex-col border-r px-3 py-4">
      <div className="flex items-center gap-2.5 px-2">
        <Mark />
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">Zola Cleaner</div>
          <div className="text-muted-foreground text-[11px]">Dọn media Zalo PC</div>
        </div>
      </div>

      <div className="mt-5 px-2">
        <div className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase">Tài khoản</div>
        {roots.length > 1 ? (
          <Select value={String(rootId)} onValueChange={(v) => onRoot(Number(v))}>
            <SelectTrigger className="w-full bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roots.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {accountName(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="truncate text-sm font-medium" title="Đặt tên tài khoản ở Cài đặt">
            {root ? accountName(root) : "—"}
          </div>
        )}
      </div>

      <nav className="mt-5 grid gap-0.5">
        {NAV.map(({ tab: t, icon }) => {
          const active = t === tab;
          const meta = t === "jobs" && d && d.trashBytes > 0 ? formatBytes(d.trashBytes) : null;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-2",
                "[&_svg]:size-4 [&_svg]:shrink-0",
                active
                  ? "bg-white font-medium shadow-sm [&_svg]:text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/60",
              )}
            >
              {active && <span className="bg-primary absolute top-2 bottom-2 left-0 w-0.5 rounded-full" />}
              {icon}
              <span className="flex-1">{TAB_TITLE[t]}</span>
              {meta && <span className="figure text-trash text-xs">{meta}</span>}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {d && (
        <div className="grid gap-1.5 rounded-lg bg-white/70 p-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Ổ {d.drive.replace(":", "")} còn trống</span>
            <span className="figure font-medium">{formatBytes(d.free)}</span>
          </div>
          <div className="bg-muted flex h-1.5 overflow-hidden rounded-full">
            <span className="bg-others" style={{ width: pct(d.total - d.free - d.zaloBytes - d.trashBytes, d.total) }} />
            <span className="bg-zalo" style={{ width: pct(d.zaloBytes, d.total) }} />
            <span className="bg-trash" style={{ width: pct(d.trashBytes, d.total) }} />
          </div>
          <div className="text-muted-foreground text-[11px]">
            Zalo chiếm <span className="figure text-foreground">{formatBytes(d.zaloBytes)}</span> / {formatBytes(d.total)}
          </div>
        </div>
      )}
      <Button variant="ghost" size="sm" className="text-muted-foreground mt-2 justify-start" onClick={onScan}>
        <RefreshCw /> Quét lại
      </Button>
    </aside>
  );
}

const pct = (n: number, total: number) => `${Math.max(0, (n / Math.max(1, total)) * 100)}%`;

/** Biểu tượng app (cắt từ public/logo.png, xem app-icon.png). */
function Mark() {
  return <img src="/logo-mark.png" alt="" className="size-9 rounded-[10px]" />;
}
