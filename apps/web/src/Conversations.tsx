import { useEffect, useMemo, useState } from "react";
import { api, type CleanupFilter, type CleanupPreview, type Conversation, formatBytes, formatDate } from "./api.ts";
import { CATEGORY_LABEL } from "./labels.ts";

/** Nhóm Media Kind hiển thị trên bộ lọc → các category của core. */
const KINDS: { key: string; label: string; categories: string[]; default: boolean }[] = [
  { key: "image", label: "Ảnh", categories: ["image"], default: true },
  { key: "video", label: "Video", categories: ["video"], default: true },
  { key: "document", label: "Tài liệu", categories: ["document", "archive"], default: false },
  { key: "other", label: "Khác", categories: ["audio", "other"], default: false },
];

const AGES: { days: number; label: string }[] = [
  { days: 0, label: "Mọi lúc" },
  { days: 30, label: "Cũ hơn 1 tháng" },
  { days: 90, label: "Cũ hơn 3 tháng" },
  { days: 180, label: "Cũ hơn 6 tháng" },
  { days: 365, label: "Cũ hơn 1 năm" },
  { days: 730, label: "Cũ hơn 2 năm" },
];

interface Props {
  rootId: number;
  version: number;
  zaloRunning: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function Conversations({ rootId, version, zaloRunning, onChanged, onError }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allConvs, setAllConvs] = useState(false);
  const [kinds, setKinds] = useState<Set<string>>(new Set(KINDS.filter((k) => k.default).map((k) => k.key)));
  const [olderThanDays, setOlderThanDays] = useState(0);
  const [minSizeMb, setMinSizeMb] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.conversations(rootId).then(setConvs, (e: Error) => onError(e.message));
  }, [rootId, version, onError]);

  const filter: CleanupFilter | null = useMemo(() => {
    if (!allConvs && selected.size === 0) return null;
    const categories = KINDS.filter((k) => kinds.has(k.key)).flatMap((k) => k.categories);
    if (categories.length === 0) return null;
    const mb = Number(minSizeMb);
    return {
      rootId,
      convIds: allConvs ? undefined : [...selected],
      categories,
      olderThanDays: olderThanDays || undefined,
      minSize: mb > 0 ? Math.round(mb * 1024 * 1024) : undefined,
    };
  }, [rootId, allConvs, selected, kinds, olderThanDays, minSizeMb]);

  // Preview tự cập nhật khi đổi lựa chọn (truy vấn nhẹ, không đụng đĩa)
  useEffect(() => {
    if (!filter) return setPreview(null);
    const t = setTimeout(() => {
      api.preview(filter).then(setPreview, (e: Error) => onError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [filter, version, onError]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => c.convId.includes(q) || c.alias?.toLowerCase().includes(q));
  }, [convs, query]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllShown = () =>
    setSelected((prev) => {
      const allOn = shown.every((c) => prev.has(c.convId));
      const next = new Set(prev);
      for (const c of shown) {
        if (allOn) next.delete(c.convId);
        else next.add(c.convId);
      }
      return next;
    });

  const saveAlias = async (c: Conversation, alias: string) => {
    if ((c.alias ?? "") === alias.trim()) return;
    try {
      await api.setAlias(rootId, c.convId, alias);
      setConvs((list) => list.map((x) => (x.convId === c.convId ? { ...x, alias: alias.trim() || null } : x)));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const onQuarantine = async () => {
    if (!filter || !preview || preview.count === 0) return;
    const ok = confirm(
      `Cách ly ${preview.count.toLocaleString()} file (${formatBytes(preview.bytes)})?\n\n` +
        "File được chuyển vào khu cách ly, giữ 7 ngày rồi mới xoá hẳn. Có thể khôi phục ở tab Cách ly.\n" +
        "Dung lượng ổ đĩa chỉ giảm khi xoá vĩnh viễn.",
    );
    if (!ok) return;
    setWorking(true);
    try {
      const r = await api.quarantine(filter);
      setNotice(
        `Đã cách ly ${r.moved.toLocaleString()} file (${formatBytes(r.bytes)}) vào job #${r.jobId}` +
          (r.failed ? ` · ${r.failed} file lỗi (bị khoá?)` : "") +
          ". Mở Zalo kiểm tra; nếu ổn, xoá vĩnh viễn ở tab Cách ly.",
      );
      setSelected(new Set());
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const totalBytes = convs.reduce((s, c) => s + c.bytes, 0);

  return (
    <section className="convs">
      <div className="filters">
        <fieldset>
          <legend>Loại</legend>
          {KINDS.map((k) => (
            <label key={k.key}>
              <input
                type="checkbox"
                checked={kinds.has(k.key)}
                onChange={() =>
                  setKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k.key)) next.delete(k.key);
                    else next.add(k.key);
                    return next;
                  })
                }
              />
              {k.label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Tuổi (thời điểm tin nhắn)</legend>
          <select value={olderThanDays} onChange={(e) => setOlderThanDays(Number(e.target.value))}>
            {AGES.map((a) => (
              <option key={a.days} value={a.days}>
                {a.label}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset>
          <legend>Lớn hơn (MB)</legend>
          <input
            className="small"
            type="number"
            min={0}
            value={minSizeMb}
            onChange={(e) => setMinSizeMb(e.target.value)}
            placeholder="0"
          />
        </fieldset>
        <fieldset>
          <legend>Áp dụng cho</legend>
          <label>
            <input type="radio" checked={!allConvs} onChange={() => setAllConvs(false)} />
            Hội thoại đã chọn ({selected.size})
          </label>
          <label>
            <input type="radio" checked={allConvs} onChange={() => setAllConvs(true)} />
            Mọi hội thoại
          </label>
        </fieldset>
      </div>

      <div className="row">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên tự đặt hoặc ID…" />
        <span className="muted nowrap">
          {convs.length} hội thoại · {formatBytes(totalBytes)}
        </span>
      </div>

      <table className="conv-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                disabled={allConvs}
                checked={shown.length > 0 && shown.every((c) => selected.has(c.convId))}
                onChange={toggleAllShown}
              />
            </th>
            <th>Hội thoại</th>
            <th>Ảnh gần đây</th>
            <th className="num">Tổng</th>
            <th className="num" title="Phần không dùng chung với hội thoại khác">
              Riêng
            </th>
            <th className="legend">
              <span className="k-image" />
              Ảnh <span className="k-video" />
              Video <span className="k-document" />
              Tài liệu <span className="k-other" />
              Khác
            </th>
            <th className="num">Mới nhất</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <ConversationRow
              key={c.convId}
              conv={c}
              checked={allConvs || selected.has(c.convId)}
              disabled={allConvs}
              max={convs[0]?.bytes ?? 1}
              onToggle={() => toggle(c.convId)}
              onAlias={(a) => saveAlias(c, a)}
            />
          ))}
        </tbody>
      </table>

      <footer className="action-bar">
        {notice && (
          <p className="notice" onClick={() => setNotice(null)}>
            {notice}
          </p>
        )}
        {!filter ? (
          <span className="muted">Chọn hội thoại (hoặc "Mọi hội thoại") và ít nhất một loại để xem trước.</span>
        ) : !preview ? (
          <span className="muted">Đang tính…</span>
        ) : (
          <PreviewSummary preview={preview} />
        )}
        <button
          className="primary"
          disabled={!preview || preview.count === 0 || working || zaloRunning}
          title={zaloRunning ? "Hãy thoát Zalo trước" : undefined}
          onClick={onQuarantine}
        >
          {working ? "Đang cách ly…" : preview?.count ? `Cách ly ${formatBytes(preview.bytes)}` : "Cách ly"}
        </button>
      </footer>
    </section>
  );
}

function ConversationRow({
  conv: c,
  checked,
  disabled,
  max,
  onToggle,
  onAlias,
}: {
  conv: Conversation;
  checked: boolean;
  disabled: boolean;
  max: number;
  onToggle: () => void;
  onAlias: (alias: string) => void;
}) {
  const [alias, setAlias] = useState(c.alias ?? "");
  useEffect(() => setAlias(c.alias ?? ""), [c.alias]);
  const part = (bytes: number) => `${(bytes / max) * 100}%`;
  return (
    <tr className={checked ? "selected" : undefined}>
      <td>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      </td>
      <td className="who">
        <input
          className="alias"
          value={alias}
          placeholder="Đặt tên…"
          onChange={(e) => setAlias(e.target.value)}
          onBlur={() => onAlias(alias)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <small className="muted">
          {c.isGroup && <span className="badge">Nhóm</span>} {c.convId}
        </small>
      </td>
      <td className="thumbs" onClick={disabled ? undefined : onToggle}>
        {c.thumbIds.slice(0, 6).map((id) => (
          <img
            key={id}
            src={api.thumbUrl(id)}
            loading="lazy"
            alt=""
            onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
          />
        ))}
      </td>
      <td className="num">{formatBytes(c.bytes)}</td>
      <td className="num">{formatBytes(c.ownBytes)}</td>
      <td className="stack" title={`Ảnh ${formatBytes(c.imageBytes)} · Video ${formatBytes(c.videoBytes)} · Tài liệu ${formatBytes(c.documentBytes)} · Khác ${formatBytes(c.otherBytes)}`}>
        <span className="k-image" style={{ width: part(c.imageBytes) }} />
        <span className="k-video" style={{ width: part(c.videoBytes) }} />
        <span className="k-document" style={{ width: part(c.documentBytes) }} />
        <span className="k-other" style={{ width: part(c.otherBytes) }} />
      </td>
      <td className="num muted">{formatDate(c.lastTs)}</td>
    </tr>
  );
}

function PreviewSummary({ preview: p }: { preview: CleanupPreview }) {
  return (
    <div className="preview">
      <strong>
        {p.count.toLocaleString()} file · {formatBytes(p.bytes)}
      </strong>
      <span className="muted">
        {p.byCategory.map((b) => `${CATEGORY_LABEL[b.key] ?? b.key} ${formatBytes(b.bytes)}`).join(" · ")}
      </span>
      {p.skippedShared.count > 0 && (
        <span className="muted">
          Bỏ qua {p.skippedShared.count.toLocaleString()} file ({formatBytes(p.skippedShared.bytes)}) vì còn dùng ở hội
          thoại khác
        </span>
      )}
    </div>
  );
}
