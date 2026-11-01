import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.ts";
import { jxlToJpeg } from "./jxl.ts";

/** Định dạng ảnh trình duyệt hiển thị được trực tiếp. */
const BROWSER_IMAGE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

export interface ThumbSource {
  file: string;
  contentType: string;
}

/**
 * Tìm ảnh để hiển thị cho một Media Item:
 * 1. Thumbnail Zalo tạo sẵn trong resource/<convId>/Cache/, cùng Message Time với Link trong resource/ (ưu tiên `_t`, nhỏ hơn).
 * 2. Chính file gốc nếu trình duyệt hiển thị được (jpg/png/…; JPEG XL thì không).
 */
export function findThumbnail(db: Db, itemId: number): ThumbSource | null {
  const item = db
    .prepare(
      `SELECT i.root_id, i.kind, i.category, r.path AS rootPath FROM items i JOIN roots r ON r.id = i.root_id
       WHERE i.id = ?`,
    )
    .get(itemId) as { root_id: number; kind: string; category: string; rootPath: string } | undefined;
  if (!item) return null;

  const links = db.prepare("SELECT rel_path FROM links WHERE item_id = ?").all(itemId) as { rel_path: string }[];
  const abs = (rel: string) => path.join(item.rootPath, ...rel.split("/"));

  // Khoảng ['<dir>/<ts>_', '<dir>/<ts>`') — dùng được index (ký tự '`' đứng ngay sau '_')
  const qCache = db.prepare(
    `SELECT l.rel_path, i.kind FROM links l JOIN items i ON i.id = l.item_id
     WHERE l.root_id = ? AND l.rel_path >= ? AND l.rel_path < ? AND i.status = 'present'`,
  );
  for (const { rel_path } of links) {
    // resource/<convId>/<area>/<msgTs>_<uidNgườiGửi>_<convId>_...
    //   →  resource/<convId>/Cache/<msgTs>_<uidTàiKhoản>_<convId>_t | _n
    const m = /^resource\/([^/]+)\/[^/]+\/(\d{13})_/.exec(rel_path);
    if (!m) continue;
    const [, convId, ts] = m;
    const dir = `resource/${convId}/Cache`;
    const hits = qCache.all(item.root_id, `${dir}/${ts}_`, `${dir}/${ts}\``) as { rel_path: string; kind: string }[];
    for (const suffix of ["t", "n"]) {
      const hit = hits.find((h) => h.rel_path.endsWith(`_${convId}_${suffix}`));
      const type = hit && BROWSER_IMAGE[hit.kind];
      if (hit && type) return { file: abs(hit.rel_path), contentType: type };
    }
  }

  const type = item.category === "image" ? BROWSER_IMAGE[item.kind] : undefined;
  if (type && links[0]) return { file: abs(links[0].rel_path), contentType: type };
  return null;
}

/**
 * Như findThumbnail, nhưng ảnh JPEG XL (trình duyệt không hiển thị được) được giải mã và thu nhỏ thành JPEG,
 * lưu vào cacheDir để lần sau dùng lại.
 */
export async function renderThumbnail(db: Db, itemId: number, cacheDir: string): Promise<ThumbSource | null> {
  const direct = findThumbnail(db, itemId);
  if (direct) return direct;

  const item = db
    .prepare(
      `SELECT i.kind, i.size, i.mtime_ms, r.path AS rootPath,
         (SELECT rel_path FROM links WHERE item_id = i.id LIMIT 1) AS relPath
       FROM items i JOIN roots r ON r.id = i.root_id WHERE i.id = ? AND i.category = 'image'`,
    )
    .get(itemId) as { kind: string; size: number; mtime_ms: number; rootPath: string; relPath: string | null } | undefined;
  if (!item || item.kind !== "jxl" || !item.relPath) return null;

  const cached = path.join(cacheDir, `${itemId}-${item.size}-${item.mtime_ms}.jpg`);
  if (!existsSync(cached)) {
    // Trang reload / nhiều tab hỏi cùng một ảnh → chỉ giải mã một lần
    let pending = rendering.get(cached);
    if (!pending) {
      const src = path.join(item.rootPath, ...item.relPath.split("/"));
      pending = (async () => {
        const jpg = await jxlToJpeg(await readFile(src));
        await mkdir(cacheDir, { recursive: true });
        await writeFile(cached, jpg);
      })().finally(() => rendering.delete(cached));
      rendering.set(cached, pending);
    }
    await pending;
  }
  return { file: cached, contentType: "image/jpeg" };
}

/** Thumbnail JXL đang được giải mã, theo đường dẫn file cache. */
const rendering = new Map<string, Promise<void>>();
