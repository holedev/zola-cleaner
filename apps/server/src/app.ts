import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addRoot,
  type CleanupFilter,
  type Db,
  defaultQuarantineBase,
  detectMediaStores,
  getStats,
  isZaloRunning,
  listConversations,
  listJobs,
  listRoots,
  previewCleanup,
  purgeJob,
  quarantine,
  removeRoot,
  renderThumbnail,
  restoreJob,
  type ScanProgress,
  SELECTABLE,
  setAlias,
  startScan,
} from "@zalo-cleaner/core";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export interface AppOptions {
  /** Thư mục dữ liệu của app (CSDL, cache thumbnail). */
  dataDir: string;
  /** Thư mục chứa các Quarantine Job, cùng ổ với ZaloData. */
  quarantineBase?: string;
}

export function createApp(db: Db, opts: AppOptions) {
  /** Tiến độ các lần quét đang chạy / vừa xong, theo scanId. */
  const scans = new Map<number, ScanProgress>();
  /** rootId → scanId của lần quét đang chạy. */
  const runningScans = new Map<number, number>();
  /** Token sinh lúc khởi động; mọi request thay đổi dữ liệu phải gửi kèm (PLAN mục 3.6). */
  const token = randomBytes(24).toString("hex");
  const thumbsDir = path.join(opts.dataDir, "thumbs");
  const jobOpts = { quarantineBase: opts.quarantineBase ?? defaultQuarantineBase() };
  let busy = false; // chỉ một thao tác cách ly / khôi phục / xoá tại một thời điểm

  const app = new Hono();

  // Chỉ chấp nhận request từ localhost — chống CSRF / DNS rebinding từ trang web lạ.
  app.use("/api/*", async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header("host") ?? "")) return c.json({ error: "forbidden host" }, 403);
    const origin = c.req.header("origin");
    if (origin && !LOCAL_ORIGIN.test(origin)) return c.json({ error: "forbidden origin" }, 403);
    if (c.req.method !== "GET" && c.req.header("x-zc-token") !== token) return c.json({ error: "bad token" }, 403);
    await next();
  });

  app.onError((err, c) => c.json({ error: err.message }, 500));

  /** Thao tác trên đĩa: tuần tự, Zalo đang chạy → 409. */
  const exclusive = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    if (busy) throw Object.assign(new Error("Đang có thao tác khác, thử lại sau"), { status: 409 });
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
  const fail = (c: { json: (b: unknown, s: 400 | 409) => Response }, err: unknown) => {
    const e = err as Error & { status?: number };
    return c.json({ error: e.message }, e.status === 409 || /Zalo đang chạy/.test(e.message) ? 409 : 400);
  };

  // Trang khác không đọc được response này (không có CORS) → chỉ UI cùng origin lấy được token.
  app.get("/api/session", (c) => c.json({ token }));

  app.get("/api/health", async (c) =>
    c.json({
      ok: true,
      version: "0.2.0",
      platform: process.platform,
      zaloRunning: await isZaloRunning(),
      // UI vừa reload dùng để bắt lại tiến độ lần quét đang chạy
      scanning: [...runningScans].map(([rootId, scanId]) => ({ rootId, scanId })),
    }),
  );

  // --- Media Store ---
  app.get("/api/roots", (c) => c.json(listRoots(db)));
  app.get("/api/roots/detect", (c) => c.json(detectMediaStores()));

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
    // Đang quét rồi (vd. bấm lại sau khi reload) → trả về lần quét đó để UI theo dõi tiếp
    const running = runningScans.get(rootId);
    if (running != null) return c.json({ scanId: running }, 200);

    const handle = startScan(db, rootId, { onProgress: (p) => scans.set(p.scanId, p) });
    runningScans.set(rootId, handle.scanId);
    handle.done.catch(() => {}).finally(() => runningScans.delete(rootId));
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

  // --- Thống kê & hội thoại ---
  app.get("/api/stats", (c) => {
    const rootId = c.req.query("rootId");
    return c.json(getStats(db, { rootId: rootId ? Number(rootId) : undefined }));
  });

  app.get("/api/conversations", (c) => c.json(listConversations(db, Number(c.req.query("rootId")))));

  app.patch("/api/conversations/:convId", async (c) => {
    const { rootId, alias } = await c.req.json<{ rootId: number; alias: string | null }>();
    setAlias(db, rootId, c.req.param("convId"), alias);
    return c.body(null, 204);
  });

  app.get("/api/items/:id/thumb", async (c) => {
    const thumb = await renderThumbnail(db, Number(c.req.param("id")), thumbsDir).catch(() => null);
    if (!thumb) return c.body(null, 404);
    const data = await readFile(thumb.file).catch(() => null);
    if (!data) return c.body(null, 404);
    return c.body(data, 200, { "content-type": thumb.contentType, "cache-control": "private, max-age=86400" });
  });

  // --- Dọn dẹp ---
  const readFilter = async (req: { json: <T>() => Promise<T> }): Promise<CleanupFilter> => {
    const f = await req.json<CleanupFilter>();
    if (!Number.isInteger(f.rootId)) throw new Error("Thiếu rootId");
    const bad = f.categories?.find((x) => !(SELECTABLE as string[]).includes(x));
    if (bad) throw new Error(`Loại không được phép chọn: ${bad}`);
    return {
      rootId: f.rootId,
      convIds: f.convIds,
      categories: f.categories,
      olderThanDays: f.olderThanDays,
      minSize: f.minSize,
    };
  };

  app.post("/api/cleanup/preview", async (c) => {
    try {
      return c.json(previewCleanup(db, await readFilter(c.req)));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/cleanup", async (c) => {
    try {
      const filter = await readFilter(c.req);
      return c.json(await exclusive(() => quarantine(db, filter, jobOpts)), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/jobs", (c) => {
    const rootId = c.req.query("rootId");
    return c.json(listJobs(db, rootId ? Number(rootId) : undefined));
  });

  app.post("/api/jobs/:id/restore", async (c) => {
    try {
      return c.json(await exclusive(() => restoreJob(db, Number(c.req.param("id")))));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/jobs/:id/purge", async (c) => {
    try {
      return c.json(await exclusive(() => purgeJob(db, Number(c.req.param("id")))));
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}
