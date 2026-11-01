import { useCallback, useEffect, useState } from "react";
import { api, type Bucket, formatBytes, type Health, type Root, type ScanProgress, type Stats } from "./api.ts";

const CATEGORY_LABEL: Record<string, string> = {
  image: "Ảnh",
  video: "Video",
  audio: "Âm thanh",
  document: "Tài liệu",
  archive: "File nén",
  database: "CSDL (không xoá)",
  other: "Khác",
};

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newPath, setNewPath] = useState("");
  const [progress, setProgress] = useState<Record<number, ScanProgress>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, r, s] = await Promise.all([api.health(), api.roots(), api.stats()]);
      setHealth(h);
      setRoots(r);
      setStats(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAdd = async () => {
    if (!newPath.trim()) return;
    try {
      await api.addRoot(newPath.trim());
      setNewPath("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onScan = async (root: Root) => {
    try {
      const { scanId } = await api.startScan(root.id);
      api.watchScan(scanId, (p) => {
        setProgress((prev) => ({ ...prev, [root.id]: p }));
        if (p.phase !== "running") void refresh();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main>
      <header>
        <h1>Zalo Cleaner</h1>
        {health?.zaloRunning && <p className="warn">Zalo đang chạy — hãy tắt Zalo trước khi dọn dẹp.</p>}
        {error && <p className="error">{error}</p>}
      </header>

      <section>
        <h2>Thư mục gốc</h2>
        <div className="row">
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
            placeholder="Ví dụ: D:\ZaloData"
          />
          <button onClick={onAdd}>Thêm</button>
        </div>
        <ul className="roots">
          {roots.map((r) => {
            const p = progress[r.id];
            return (
              <li key={r.id}>
                <code>{r.path}</code>
                <button onClick={() => onScan(r)} disabled={p?.phase === "running"}>
                  {p?.phase === "running" ? "Đang quét…" : "Quét"}
                </button>
                {p && (
                  <small>
                    {p.seen.toLocaleString()} file · {formatBytes(p.bytes)} · mới {p.newFiles} · đổi {p.changed} · lỗi{" "}
                    {p.errors}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {stats && (
        <section>
          <h2>Tổng quan</h2>
          <div className="cards">
            <div className="card">
              <span>Tổng dung lượng</span>
              <strong>{formatBytes(stats.total.bytes)}</strong>
            </div>
            <div className="card">
              <span>Số file</span>
              <strong>{stats.total.count.toLocaleString()}</strong>
            </div>
          </div>
          <div className="grid">
            <BucketTable title="Theo loại" rows={stats.byCategory} label={(k) => CATEGORY_LABEL[k] ?? k} />
            <BucketTable title="Theo tuổi" rows={stats.byAge} />
            <BucketTable title="Theo thư mục" rows={stats.byTopDir} />
          </div>
          {/* TODO Giai đoạn 2: biểu đồ theo tháng (stats.byMonth), trang Duyệt file */}
        </section>
      )}
    </main>
  );
}

function BucketTable({ title, rows, label }: { title: string; rows: Bucket[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.bytes));
  return (
    <div>
      <h3>{title}</h3>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{label ? label(r.key) : r.key}</td>
              <td className="num">{r.count.toLocaleString()}</td>
              <td className="num">{formatBytes(r.bytes)}</td>
              <td className="bar">
                <span style={{ width: `${(r.bytes / max) * 100}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
