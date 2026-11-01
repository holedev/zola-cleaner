/**
 * Kiến thức về cấu trúc Media Store (ZaloDownloads) của Zalo PC 5.x. Xem docs/zalo-layout.md.
 *
 *   <area>/<tên>                              Link "kho"
 *   picture/<convId | id_group>/<tên>          Link kho của ảnh, đã chia theo hội thoại
 *   resource/<convId>/<area>/<msgTs>_<uidNgườiGửi>_<convId>_...   hardlink theo hội thoại
 *   resource/<convId>/Cache/<msgTs>_<uidTàiKhoản>_<convId>_t|n   Thumbnail (Cache/ cấp kho đặt tên kiểu khác)
 * convId của nhóm là `g<id>`.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Thư mục kho mà Media Item trong đó được phép dọn. */
export const CLEANABLE_AREAS: readonly string[] = ["picture", "video", "fileNoise", "file"];

/** File sổ sách của Zalo trong mỗi thư mục — không phải media, không bao giờ đụng tới. */
export const RESCACHE_NAME = ".rescache";

export interface LinkInfo {
  /** Thư mục kho: picture | video | fileNoise | file | Cache | richThumb | ... */
  area: string;
  convId: string | null;
  /** Message Time (epoch ms) nếu tên Link có tiền tố thời gian. */
  msgTs: number | null;
}

const MSG_TS = /^(\d{13})_/;

/** Phân tích đường dẫn tương đối (dấu "/") của một Link trong Media Store. */
export function parseLink(relPath: string): LinkInfo {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1]!;
  const ts = MSG_TS.exec(name);
  const msgTs = ts ? Number(ts[1]) : null;

  if (parts[0] === "resource" && parts.length >= 4) {
    return { area: parts[2]!, convId: canonicalConvId(parts[1]!), msgTs };
  }
  if (parts[0] === "picture" && parts.length >= 3) {
    return { area: "picture", convId: canonicalConvId(parts[1]!), msgTs };
  }
  return { area: parts.length >= 2 ? parts[0]! : ".", convId: null, msgTs };
}

/**
 * Zalo viết ID nhóm theo hai kiểu: `g<id>` (resource/, tên file) và `<id>_group` (picture/).
 * Quy về một dạng `g<id>` để một nhóm không bị tách thành hai Conversation.
 */
export function canonicalConvId(dirName: string): string {
  const m = /^(\d+)_group$/.exec(dirName);
  return m ? `g${m[1]}` : dirName;
}

export function isGroupConversation(convId: string): boolean {
  return /^g\d+$/.test(convId);
}

/** Tìm các Media Store trên máy: %APPDATA%\ZaloData\media\<uid>\ZaloDownloads. */
export function detectMediaStores(appData = process.env.APPDATA): string[] {
  if (!appData) return [];
  const media = path.join(appData, "ZaloData", "media");
  if (!existsSync(media)) return [];
  return readdirSync(media, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => path.join(media, e.name, "ZaloDownloads"))
    .filter((p) => existsSync(p));
}
