import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, RefreshCw } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { api, errorMessage, formatBytes, type ScanProgress, shortUid } from "@/lib/api";
import { keys, useHealth, useInvalidateIndex, useRoots } from "@/lib/queries";
import { ConversationsPage } from "@/pages/conversations";
import { JobsPage } from "@/pages/jobs";
import { OverviewPage } from "@/pages/overview";
import { SuggestionsPage } from "@/pages/suggestions";

type Tab = "suggestions" | "conversations" | "jobs" | "overview";

const PHASE: Record<ScanProgress["phase"], string> = {
  listing: "Đang liệt kê thư mục",
  reading: "Đang nhận diện file mới",
  writing: "Đang cập nhật chỉ mục",
  done: "Xong",
  failed: "Lỗi",
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
  const readOnly = root?.layout.status !== "supported";

  // Chọn sẵn Media Store đầu tiên được hỗ trợ
  useEffect(() => {
    if (rootId == null && roots.data?.length) {
      setRootId((roots.data.find((r) => r.layout.status === "supported") ?? roots.data[0]!).id);
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
      listen<string>("scan-error", (e) => {
        blocking.set(null);
        toast.error(`Quét thất bại: ${e.payload}`);
      }),
    ];
    return () => un.forEach((p) => void p.then((f) => f()));
  }, [showScan, blocking]);

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
          App tìm trong %APPDATA%\ZaloData\media. Nếu bạn cài Zalo ở chỗ khác, thêm thư mục ZaloDownloads ở tab Tổng quan.
        </p>
        <OverviewPage rootId={-1} />
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-[1920px] gap-5 px-6 py-5 2xl:px-10">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Zola Cleaner</h1>
        {roots.data.length > 1 && (
          <Select value={String(rootId)} onValueChange={(v) => setRootId(Number(v))}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roots.data.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  Tài khoản {r.uid ? shortUid(r.uid) : `#${r.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {roots.data.length === 1 && root && (
          <Badge variant="outline" title="Tài khoản Zalo đang xem. Có tài khoản khác đăng nhập trên máy thì app tự phát hiện.">
            Tài khoản {shortUid(root.uid)}
          </Badge>
        )}
        <div className="flex-1" />
        <Button variant="outline" onClick={() => scan(rootId)}>
          <RefreshCw /> Quét lại
        </Button>
      </header>

      {health.data?.zaloRunning && <ZaloBanner />}
      {root && root.layout.status === "unsupported" && (
        <Alert>
          <Eye />
          <AlertTitle>Chế độ chỉ xem</AlertTitle>
          <AlertDescription>
            Cấu trúc thư mục Zalo trên máy này chưa được kiểm chứng, nên app không dọn để tránh xoá nhầm. Vào tab Tổng quan, bấm
            "Xuất báo cáo cấu trúc" và gửi cho nhà phát triển để được hỗ trợ.
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
          void qc.invalidateQueries({ queryKey: keys.health });
        }}
      >
        <TabsList>
          <TabsTrigger value="suggestions">Gợi ý</TabsTrigger>
          <TabsTrigger value="conversations">Theo hội thoại</TabsTrigger>
          <TabsTrigger value="jobs">Thùng rác</TabsTrigger>
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
        </TabsList>
        <TabsContent value="suggestions" className="mt-4">
          <SuggestionsPage rootId={rootId} readOnly={readOnly} onCleanup={setCleanup} />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
          <ConversationsPage rootId={rootId} readOnly={readOnly} onCleanup={setCleanup} />
        </TabsContent>
        <TabsContent value="jobs" className="mt-4">
          <JobsPage rootId={rootId} />
        </TabsContent>
        <TabsContent value="overview" className="mt-4">
          <OverviewPage rootId={rootId} />
        </TabsContent>
      </Tabs>

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
  );
}
