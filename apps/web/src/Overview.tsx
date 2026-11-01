import { useEffect, useState } from "react";
import { api, type Bucket, formatBytes, type Root, type Stats } from "./api.ts";
import { AREA_LABEL, CATEGORY_LABEL } from "./labels.ts";

interface Props {
  rootId: number | null;
  version: number;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function Overview({ rootId, version, onChanged, onError }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [detected, setDetected] = useState<string[]>([]);
  const [newPath, setNewPath] = useState("");

  useEffect(() => {
    api.roots().then(setRoots, (e: Error) => onError(e.message));
    api.detectRoots().then(setDetected, () => {});
    if (rootId != null) api.stats(rootId).then(setStats, (e: Error) => onError(e.message));
  }, [rootId, version, onError]);

  const add = async (p: string) => {
    if (!p.trim()) return;
    try {
      await api.addRoot(p.trim());
      setNewPath("");
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const missing = detected.filter((d) => !roots.some((r) => r.path.toLowerCase() === d.toLowerCase()));

  return (
    <section>
      {stats && (
        <>
          <div className="cards">
            <div className="card">
              <span>Media Zalo trên đĩa</span>
              <strong>{formatBytes(stats.total.bytes)}</strong>
            </div>
            <div className="card">
              <span>Số file (không đếm trùng hardlink)</span>
              <strong>{stats.total.count.toLocaleString()}</strong>
            </div>
          </div>
          <div className="grid">
            <BucketTable title="Theo loại" rows={stats.byCategory} label={(k) => CATEGORY_LABEL[k] ?? k} />
            <BucketTable title="Theo tuổi" rows={stats.byAge} />
            <BucketTable title="Theo thư mục kho" rows={stats.byArea} label={(k) => AREA_LABEL[k] ?? k} />
          </div>
        </>
      )}

      <h2>Thư mục Media Store</h2>
      <p className="muted">Thư mục ZaloDownloads của từng tài khoản Zalo. App chỉ dọn bên trong các thư mục này.</p>
      <ul className="roots">
        {roots.map((r) => (
          <li key={r.id}>
            <code>{r.path}</code>
          </li>
        ))}
        {missing.map((d) => (
          <li key={d}>
            <code className="muted">{d}</code>
            <button onClick={() => add(d)}>Thêm</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(newPath)}
          placeholder="%APPDATA%\ZaloData\media\<uid>\ZaloDownloads"
        />
        <button onClick={() => add(newPath)}>Thêm</button>
      </div>
    </section>
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
