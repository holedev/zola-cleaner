import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatBytes, type Health, type Root, type ScanProgress } from "./api.ts";
import { Conversations } from "./Conversations.tsx";
import { Jobs } from "./Jobs.tsx";
import { Overview } from "./Overview.tsx";

type Tab = "conversations" | "jobs" | "overview";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootId, setRootId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("conversations");
  const [scan, setScan] = useState<ScanProgress | null>(null);
  /** Tăng lên mỗi khi dữ liệu trên đĩa đổi (quét xong, cách ly, khôi phục…) để các màn hình tải lại. */
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.roots();
        setRoots(r);
        setRootId((cur) => cur ?? r[0]?.id ?? null);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [version]);

  // Trạng thái Zalo đổi thường xuyên → kiểm tra định kỳ
  useEffect(() => {
    void refreshHealth();
    const t = setInterval(refreshHealth, 5000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  /** scanId đang theo dõi qua SSE — tránh mở hai luồng cho cùng một lần quét. */
  const watching = useRef<number | null>(null);
  const watch = useCallback(
    (scanId: number) => {
      if (watching.current === scanId) return;
      watching.current = scanId;
      api.watchScan(scanId, (p) => {
        setScan(p);
        if (p.phase !== "running") {
          watching.current = null;
          bump();
        }
      });
    },
    [bump],
  );

  // Reload giữa chừng: server vẫn đang quét → theo dõi tiếp
  const runningScan = health?.scanning.find((s) => s.rootId === rootId)?.scanId;
  useEffect(() => {
    if (runningScan != null) watch(runningScan);
  }, [runningScan, watch]);

  const onScan = async () => {
    if (rootId == null) return;
    try {
      const { scanId } = await api.startScan(rootId);
      watch(scanId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const root = roots.find((r) => r.id === rootId);
  const scanning = scan?.phase === "running";

  return (
    <main>
      <header className="top">
        <h1>Zalo Cleaner</h1>
        <nav>
          <TabButton current={tab} value="conversations" onClick={setTab}>
            Hội thoại
          </TabButton>
          <TabButton current={tab} value="jobs" onClick={setTab}>
            Cách ly
          </TabButton>
          <TabButton current={tab} value="overview" onClick={setTab}>
            Tổng quan
          </TabButton>
        </nav>
        <div className="scan">
          {root && (
            <code className="muted" title={root.path}>
              {root.path}
            </code>
          )}
          <button onClick={onScan} disabled={rootId == null || scanning}>
            {scanning ? "Đang quét…" : "Quét lại"}
          </button>
          {scan && (
            <small className="muted">
              {scan.seen.toLocaleString()} link · {formatBytes(scan.bytes)}
              {scan.errors > 0 && ` · lỗi ${scan.errors}`}
            </small>
          )}
        </div>
      </header>

      {health?.zaloRunning && (
        <p className="banner warn">
          Zalo đang chạy. Xem và chọn thoải mái, nhưng phải <b>thoát hẳn Zalo</b> (cả biểu tượng ở khay hệ thống) thì mới
          cách ly / khôi phục được.
        </p>
      )}
      {error && (
        <p className="banner error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {rootId == null ? (
        <Overview rootId={null} version={version} onChanged={bump} onError={setError} />
      ) : tab === "conversations" ? (
        <Conversations
          rootId={rootId}
          version={version}
          zaloRunning={!!health?.zaloRunning}
          onChanged={bump}
          onError={setError}
        />
      ) : tab === "jobs" ? (
        <Jobs rootId={rootId} version={version} zaloRunning={!!health?.zaloRunning} onChanged={bump} onError={setError} />
      ) : (
        <Overview rootId={rootId} version={version} onChanged={bump} onError={setError} />
      )}
    </main>
  );
}

function TabButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button className={current === value ? "tab active" : "tab"} onClick={() => onClick(value)}>
      {children}
    </button>
  );
}
