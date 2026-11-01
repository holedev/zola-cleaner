import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useBlocking } from "@/components/blocking";
import { CleanupDialog, type CleanupRequest } from "@/components/cleanup-dialog";
import { ZaloBanner } from "@/components/zalo-banner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { api, errorMessage, formatBytes, type ScanProgress, shortUid } from "@/lib/api";
import { keys, useHealth, useInvalidateIndex, useRoots } from "@/lib/queries";
import { ConversationsPage } from "@/pages/conversations";
import { JobsPage } from "@/pages/jobs";
import { OverviewPage } from "@/pages/overview";
import { SettingsPage } from "@/pages/settings";
import { Sidebar, TAB_TITLE, type Tab } from "@/components/sidebar";
import { SuggestionsPage } from "@/pages/suggestions";


const PHASE: Record<ScanProgress["phase"], string> = {
  listing: "Đang liệt kê thư mục",
  reading: "Đang nhận diện file mới",
  writing: "Đang cập nhật chỉ mục",
  done: "Xong",
  failed: "Lỗi",
};

/** Một dòng giải thích dưới tiêu đề mỗi mục. */
const TAB_HINT: Record<Tab, string> = {
  suggestions: "",
  conversations: "Chọn hội thoại và khoảng thời gian cần dọn. Số liệu đổi ngay theo bộ lọc.",
  jobs: "File đã dọn nằm ở đây 7 ngày. Khôi phục nếu thiếu, dọn sạch để lấy lại dung lượng.",
  overview: "Dữ liệu Zalo trên máy, theo loại, tuổi và thư mục của Zalo.",
  settings: "Tài khoản và mọi đường dẫn: dữ liệu Zalo, thùng rác, bản sao lưu.",
};

export default function App() {
  const roots = useRoots();
  const health = useHealth();
  const blocking = useBlocking();
  const invalidate = useInvalidateIndex();
  const qc = useQueryClient();
  const [rootId, setRootId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("suggestions");
  const [cleanup, setCleanup] = useState<CleanupRequest | null>(null);
  const [closeAsk, setCloseAsk] = useState<{ bytes: number; jobIds: number[] } | null>(null);

  const root = roots.data?.find((r) => r.id === rootId);
  const readOnly = root?.layout.status !== "supported" || !root?.exists;
  /** Thư mục còn trên máy (Zalo có thể đã chuyển dữ liệu sang ổ khác → thư mục cũ biến mất). */
  const liveRoots = (roots.data ?? []).filter((r) => r.exists);

  // Chọn sẵn Media Store đầu tiên được hỗ trợ
  useEffect(() => {
    if (rootId == null && roots.data?.length) {
      setRootId(
        (roots.data.find((r) => r.exists && r.layout.status === "supported") ?? roots.data.find((r) => r.exists) ?? roots.data[0]!)
          .id,
      );
    }
  }, [roots.data, rootId]);

  // Tiến độ quét: event từ Rust → hộp thoại chờ
  const showScan = useCallback(
    (p: ScanProgress) => {
      if (p.phase === "done" || p.phase === "failed") {
        blocking.set(null);
        void invalidate();
        return;
      }
      const toRead = p.newFiles + p.changed;
      blocking.set({
        title: "Đang quét media Zalo…",
        detail: `${PHASE[p.phase]} · ${p.seen.toLocaleString("vi-VN")} file · ${formatBytes(p.bytes)}`,
        percent: p.phase === "reading" && toRead > 0 ? (p.read / toRead) * 100 : undefined,
      });
    },
    [blocking, invalidate],
  );
  useEffect(() => {
    const un = [
      listen<ScanProgress>("scan-progress", (e) => showScan(e.payload)),
      // Tìm xong tên tài liệu (chạy nền sau khi quét) → cập nhật danh sách
      listen("docnames-updated", () => void invalidate()),
      listen<string>("scan-error", (e) => {
        blocking.set(null);
        toast.error(`Quét thất bại: ${e.payload}`);
      }),
    ];
    return () => un.forEach((p) => void p.then((f) => f()));
  }, [showScan, blocking, invalidate]);

  const scan = useCallback(
    async (id: number) => {
      blocking.set({ title: "Đang quét media Zalo…" });
      try {
        await api.startScan(id);
      } catch (e) {
        blocking.set(null);
        toast.error(errorMessage(e));
      }
    },
    [blocking],
  );

  // Mỗi lần mở app: quét lại (nhanh, chỉ đọc file mới) + báo thùng rác đã tự dọn
  const started = useRef(false);
  useEffect(() => {
    if (started.current || rootId == null || !health.data) return;
    started.current = true;
    const running = health.data.scanning.find((s) => s.rootId === rootId);
    if (running) showScan(running);
    else void scan(rootId);
    void api.takeNewAccounts().then((uids) => {
      for (const uid of uids) toast.info(`Phát hiện tài khoản Zalo mới (${shortUid(uid)}) trên máy — chọn ở góc trên để xem.`);
      if (uids.length) void qc.invalidateQueries({ queryKey: keys.roots });
    });
    void api.takeAutoPurged().then((list) => {
      const bytes = list.reduce((s, r) => s + r.bytes, 0);
      if (list.length) toast.info(`Đã tự xoá vĩnh viễn ${formatBytes(bytes)} nằm trong thùng rác quá 7 ngày.`);
    });
  }, [rootId, health.data, scan, showScan, qc]);

  // Đóng app khi thùng rác còn file → nhắc dọn sạch
  useEffect(() => {
    const w = getCurrentWindow();
    const un = w.onCloseRequested(async (event) => {
      if (rootId == null) return;
      const jobs = await api.jobs(rootId).catch(() => []);
      const active = jobs.filter((j) => j.status === "quarantined");
      if (active.length === 0) return;
      event.preventDefault();
      setCloseAsk({ bytes: active.reduce((s, j) => s + j.totalBytes, 0), jobIds: active.map((j) => j.id) });
    });
    return () => void un.then((f) => f());
  }, [rootId]);

  const closeNow = () => void getCurrentWindow().destroy();
  const purgeAndClose = async () => {
    const ids = closeAsk?.jobIds ?? [];
    setCloseAsk(null);
    try {
      await blocking.run("Đang dọn sạch thùng rác…", async () => {
        for (const id of ids) await api.purge(id);
      });
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    closeNow();
  };

  if (roots.isPending) return null;
  if (!roots.data?.length || rootId == null) {
    return (
      <main className="mx-auto grid max-w-xl gap-4 p-10">
        <h1 className="text-2xl font-semibold">Không tìm thấy dữ liệu Zalo</h1>
        <p className="text-muted-foreground">
          App đã tìm ở vị trí mặc định và trên mọi ổ đĩa. Nếu dữ liệu Zalo nằm ở chỗ khác, bấm "Thêm thư mục dữ liệu Zalo…".
        </p>
        <SettingsPage />
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        tab={tab}
        onTab={(t) => {
          setTab(t);
          void qc.invalidateQueries({ queryKey: keys.health });
        }}
        roots={liveRoots.length ? liveRoots : roots.data}
        rootId={rootId}
        onRoot={setRootId}
        onScan={() => scan(rootId)}
      />
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-8 pt-7 pb-10">
      {tab !== "suggestions" && (
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{TAB_TITLE[tab]}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{TAB_HINT[tab]}</p>
        </header>
      )}

      {health.data?.zaloRunning && <ZaloBanner />}
      {root && root.layout.status === "unsupported" && (
        <Alert>
          <Eye />
          <AlertTitle>Chế độ chỉ xem</AlertTitle>
          <AlertDescription>
            Cấu trúc thư mục Zalo trên máy này chưa được kiểm chứng, nên app không dọn để tránh xoá nhầm. Vào Cài đặt, bấm
            "Xuất báo cáo cấu trúc" và gửi cho nhà phát triển để được hỗ trợ.
          </AlertDescription>
        </Alert>
      )}

      {tab === "suggestions" && (
        <SuggestionsPage rootId={rootId} readOnly={readOnly} onCleanup={setCleanup} onBrowse={() => setTab("conversations")} />
      )}
      {tab === "conversations" && <ConversationsPage rootId={rootId} readOnly={readOnly} onCleanup={setCleanup} />}
      {tab === "jobs" && <JobsPage rootId={rootId} />}
      {tab === "overview" && <OverviewPage rootId={rootId} />}
      {tab === "settings" && <SettingsPage />}
      </div>

      <CleanupDialog request={cleanup} onClose={() => setCleanup(null)} onGoToJobs={() => setTab("jobs")} />

      <AlertDialog open={closeAsk != null} onOpenChange={(o) => !o && setCloseAsk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thùng rác còn {closeAsk && formatBytes(closeAsk.bytes)}</AlertDialogTitle>
            <AlertDialogDescription>
              Dung lượng này chưa được trả lại cho ổ đĩa. Nếu đã mở Zalo kiểm tra và thấy ổn, hãy dọn sạch thùng rác. Nếu để sau, lần
              mở app kế tiếp sau 7 ngày sẽ tự xoá vĩnh viễn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ở lại</AlertDialogCancel>
            <Button variant="outline" onClick={closeNow}>
              Để sau, thoát
            </Button>
            <AlertDialogAction onClick={purgeAndClose}>Dọn sạch & thoát</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
    </div>
  );
}
