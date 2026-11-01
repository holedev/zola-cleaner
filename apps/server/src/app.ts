import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addRoot,
  type Db,
  getStats,
  isZaloRunning,
  listRoots,
  removeRoot,
  type ScanProgress,
  startScan,
} from "@zalo-cleaner/core";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp(db: Db) {
  /** Tiến độ các lần quét đang chạy / vừa xong, theo scanId. */
  const scans = new Map<number, ScanProgress>();
  const runningRoots = new Set<number>();

  const app = new Hono();

  // Chỉ chấp nhận request từ localhost — chống CSRF / DNS rebinding từ trang web lạ.
  // TODO (PLAN mục 3.6): thêm token ngẫu nhiên sinh lúc khởi động.
  app.use("/api/*", async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header("host") ?? "")) return c.json({ error: "forbidden host" }, 403);
    const origin = c.req.header("origin");
    if (origin && !LOCAL_ORIGIN.test(origin)) return c.json({ error: "forbidden origin" }, 403);
    await next();
  });

  app.onError((err, c) => c.json({ error: err.message }, 500));

  app.get("/api/health", async (c) =>
    c.json({ ok: true, version: "0.1.0", platform: process.platform, zaloRunning: await isZaloRunning() }),
  );

  // --- Thư mục gốc ---
  app.get("/api/roots", (c) => c.json(listRoots(db)));

  app.post("/api/roots", async (c) => {
    const body = await c.req.json<{ path?: string; label?: string }>();
    if (!body.path) return c.json({ error: "Thiếu path" }, 400);
    try {
      return c.json(addRoot(db, body.path, body.label), 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete("/api/roots/:id", (c) => {
    removeRoot(db, Number(c.req.param("id")));
    return c.body(null, 204);
  });

  // --- Quét ---
  app.post("/api/scans", async (c) => {
    const { rootId } = await c.req.json<{ rootId: number }>();
    if (runningRoots.has(rootId)) return c.json({ error: "Thư mục này đang được quét" }, 409);

    runningRoots.add(rootId);
    const handle = startScan(db, rootId, { onProgress: (p) => scans.set(p.scanId, p) });
    handle.done.catch(() => {}).finally(() => runningRoots.delete(rootId));
    return c.json({ scanId: handle.scanId }, 202);
  });

  app.get("/api/scans/:id", (c) => {
    const id = Number(c.req.param("id"));
    const live = scans.get(id);
    const row = db.prepare("SELECT * FROM scans WHERE id = ?").get(id);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ ...row, live: live ?? null });
  });

  app.get("/api/scans/:id/events", (c) => {
    const id = Number(c.req.param("id"));
    return streamSSE(c, async (stream) => {
      while (!stream.aborted) {
        const p = scans.get(id);
        if (p) await stream.writeSSE({ event: "progress", data: JSON.stringify(p) });
        if (!p || p.phase !== "running") break;
        await stream.sleep(500);
      }
    });
  });

  // --- Thống kê ---
  app.get("/api/stats", (c) => {
    const rootId = c.req.query("rootId");
    return c.json(getStats(db, { rootId: rootId ? Number(rootId) : undefined }));
  });

  // --- Chưa làm: xem docs/PLAN.md ---
  const todo = (phase: string) => (c: Context) => c.json({ error: `Chưa cài đặt — docs/PLAN.md ${phase}` }, 501);
  app.get("/api/files", todo("Giai đoạn 2"));
  app.get("/api/files/:id/thumb", todo("Giai đoạn 3"));
  app.post("/api/cleanup/preview", todo("Giai đoạn 3"));
  app.post("/api/cleanup", todo("Giai đoạn 3"));
  app.get("/api/jobs", todo("Giai đoạn 3"));
  app.post("/api/jobs/:id/restore", todo("Giai đoạn 3"));
  app.post("/api/jobs/:id/purge", todo("Giai đoạn 3"));

  return app;
}
