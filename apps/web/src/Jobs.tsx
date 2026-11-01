import { useEffect, useState } from "react";
import { api, formatBytes, formatDate, type Job } from "./api.ts";

const STATUS_LABEL: Record<Job["status"], string> = {
  running: "Đang chạy",
  quarantined: "Đang cách ly",
  restored: "Đã khôi phục",
  purged: "Đã xoá vĩnh viễn",
  failed: "Lỗi",
};

interface Props {
  rootId: number;
  version: number;
  zaloRunning: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function Jobs({ rootId, version, zaloRunning, onChanged, onError }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [working, setWorking] = useState<number | null>(null);

  useEffect(() => {
    api.jobs(rootId).then(setJobs, (e: Error) => onError(e.message));
  }, [rootId, version, onError]);

  const run = async (job: Job, action: "restore" | "purge") => {
    if (
      action === "purge" &&
      !confirm(`Xoá vĩnh viễn ${job.item_count.toLocaleString()} file (${formatBytes(job.total_bytes)})? Không thể hoàn tác.`)
    ) {
      return;
    }
    setWorking(job.id);
    try {
      const r = action === "restore" ? await api.restore(job.id) : await api.purge(job.id);
      if (r.failed) onError(`${r.failed} file không xử lý được — thử lại sau.`);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const holding = jobs.filter((j) => j.status === "quarantined").reduce((s, j) => s + j.total_bytes, 0);

  return (
    <section>
      <p className="muted">
        File đang cách ly vẫn chiếm ổ đĩa: <b>{formatBytes(holding)}</b>. Dung lượng chỉ được giải phóng khi xoá vĩnh viễn
        (bấm tay, hoặc tự động khi hết hạn giữ).
      </p>
      {jobs.length === 0 ? (
        <p className="muted">Chưa có lần cách ly nào.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Thời điểm</th>
              <th className="num">Số file</th>
              <th className="num">Dung lượng</th>
              <th>Trạng thái</th>
              <th>Tự xoá</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const active = j.status === "quarantined" || j.status === "failed";
              return (
                <tr key={j.id}>
                  <td>{j.id}</td>
                  <td>{new Date(j.created_at).toLocaleString("vi-VN")}</td>
                  <td className="num">{j.item_count.toLocaleString()}</td>
                  <td className="num">{formatBytes(j.total_bytes)}</td>
                  <td>{STATUS_LABEL[j.status]}</td>
                  <td className="muted">{j.status === "quarantined" ? formatDate(j.expires_at) : "—"}</td>
                  <td className="actions">
                    {active && (
                      <>
                        <button
                          disabled={working != null || zaloRunning}
                          title={zaloRunning ? "Hãy thoát Zalo trước" : undefined}
                          onClick={() => run(j, "restore")}
                        >
                          Khôi phục
                        </button>
                        <button className="danger" disabled={working != null} onClick={() => run(j, "purge")}>
                          Xoá vĩnh viễn
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
