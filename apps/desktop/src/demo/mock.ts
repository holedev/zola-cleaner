/**
 * Chế độ demo (`vite --mode demo`): giả lập lõi Rust bằng dữ liệu bịa để chụp ảnh giao diện cho README
 * (`pnpm screenshots`). Không có dữ liệu thật nào ở đây: uid, đường dẫn, hội thoại, ảnh đều là giả.
 * Chỉ được nạp khi MODE = "demo", nên không có trong bản build phát hành.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type {
  AppSettings,
  Bucket,
  CleanupFilter,
  CleanupItem,
  Conversation,
  DiskInfo,
  DriveCard,
  Health,
  Job,
  KindBucket,
  RootInfo,
  Stats,
  Suggestion,
} from "@/lib/api";

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;
const DAY = 86_400_000;
const now = Date.now();

const ROOT: RootInfo = {
  id: 1,
  path: "C:\\Users\\demo\\AppData\\Roaming\\ZaloData\\media\\1000000000000000001\\ZaloDownloads",
  label: "Tài khoản chính",
  createdAt: now - 30 * DAY,
  uid: "1000000000000000001",
  layout: { status: "supported" },
  compatibility: { status: "verified" },
  zaloVersion: "26.10.20",
  dbVersions: [
    { name: "Core", version: 12 },
    { name: "Media", version: 2 },
    { name: "MsgInfo", version: 2 },
  ],
  exists: true,
};

const b = (key: string, gb: number, count: number): Bucket => ({ key, bytes: Math.round(gb * GB), count });

const STATS: Stats = {
  total: b("", 13.4, 34_625),
  byCategory: [b("image", 5.5, 21_300), b("document", 3.9, 2_150), b("video", 2.9, 410), b("archive", 0.8, 240), b("audio", 0.2, 520), b("other", 0.1, 90)],
  byAge: [b("< 30 ngày", 0.9, 2_100), b("1–3 tháng", 1.4, 3_400), b("3–6 tháng", 1.8, 4_200), b("6–12 tháng", 2.6, 6_900), b("1–2 năm", 3.9, 9_800), b("> 2 năm", 2.8, 8_225)],
  byArea: [b("fileNoise", 4.9, 2_600), b("picture", 3.5, 18_000), b("video", 1.9, 408), b("Cache", 0.6, 5_800), b("file", 0.3, 123), b("voice", 0.1, 520)],
  byMonth: [],
};

const SUGGESTIONS: Suggestion[] = [
  { id: "media-1y", title: "Ảnh & video cũ hơn 1 năm", description: "Tin nhắn từ hơn một năm trước, ở mọi hội thoại.", caution: false, filter: { rootId: 1, categories: ["image", "video"], olderThanDays: 365 }, count: 14_820, bytes: Math.round(5.1 * GB) },
  { id: "media-6m", title: "Ảnh & video cũ hơn 6 tháng", description: "Tin nhắn từ hơn sáu tháng trước, ở mọi hội thoại.", caution: false, filter: { rootId: 1, categories: ["image", "video"], olderThanDays: 180 }, count: 19_400, bytes: Math.round(6.6 * GB) },
  { id: "video-50mb", title: "Video lớn hơn 50 MB", description: "Mọi video nặng, không kể thời gian.", caution: false, filter: { rootId: 1, categories: ["video"], minSize: 50 * MB }, count: 21, bytes: Math.round(1.7 * GB) },
  { id: "docs-1y", title: "Tài liệu & file nén cũ hơn 1 năm", description: "PDF, Word, Excel, ZIP… nhận qua chat. Có thể không tải lại được từ Zalo — hãy xem kỹ trước.", caution: true, filter: { rootId: 1, categories: ["document", "archive"], olderThanDays: 365 }, count: 1_130, bytes: Math.round(2.4 * GB) },
];

const DISK: DiskInfo = { drive: "C:", free: Math.round(41 * GB), total: Math.round(476 * GB), zaloBytes: STATS.total.bytes, trashBytes: Math.round(1.2 * GB) };

const DRIVES: DriveCard[] = [
  { letter: "C:", model: "NVMe SSD 512GB", media: "ssd", bus: "NVMe", health: "healthy", free: DISK.free, total: DISK.total, roles: ["zalo", "trash"] },
];

/** Hội thoại bịa: [tên tự đặt, nhóm?, GB ảnh, GB video, GB tài liệu, số ngày từ tin nhắn cuối]. */
const CONVS: [string | null, boolean, number, number, number, number][] = [
  ["Gia đình", true, 1.3, 0.9, 0.1, 0],
  ["Lớp 12A1 — Cựu học sinh", true, 0.9, 0.6, 0.2, 2],
  ["Phòng Kế toán", true, 0.3, 0.1, 1.4, 1],
  ["Dự án Website", true, 0.4, 0.2, 0.9, 5],
  ["Mẹ", false, 0.6, 0.3, 0, 0],
  ["Hội chạy bộ cuối tuần", true, 0.45, 0.32, 0, 12],
  ["Chị Lan (khách hàng)", false, 0.1, 0, 0.5, 20],
  [null, false, 0.3, 0.1, 0.05, 45],
  ["Nhóm du lịch Đà Lạt", true, 0.7, 0.45, 0, 210],
  [null, true, 0.2, 0, 0.3, 400],
];

/** Tài liệu bịa: [loại, tên, dung lượng]. */
const DOCS: [string, string, number][] = [
  ["pdf", "Thuc-don-tuan-nay.pdf", 1.1 * MB],
  ["docx", "Ke-hoach-hop-lop.docx", 380 * KB],
  ["pdf", "Ky-yeu-2016.pdf", 24 * MB],
  ["xlsx", "Danh-sach-dong-quy.xlsx", 96 * KB],
  ["xlsx", "Bao-cao-chi-phi-Q3.xlsx", 640 * KB],
  ["pdf", "Hoa-don-thang-10.pdf", 2.4 * MB],
  ["pptx", "Thiet-ke-trang-chu-v2.pptx", 18 * MB],
  ["zip", "Hinh-anh-san-pham.zip", 120 * MB],
  ["pdf", "Hop-dong-dich-vu.pdf", 3.2 * MB],
  ["docx", "Bao-gia-thang-11.docx", 210 * KB],
];

const CONVERSATIONS: Conversation[] = CONVS.map(([alias, isGroup, img, vid, doc, days], i) => {
  const imageBytes = Math.round(img * GB);
  const videoBytes = Math.round(vid * GB);
  const documentBytes = Math.round(doc * GB);
  const otherBytes = Math.round(0.01 * GB);
  const bytes = imageBytes + videoBytes + documentBytes + otherBytes;
  const id = String(100000000 + i * 7919);
  return {
    convId: isGroup ? `g${id}` : id,
    isGroup,
    alias,
    items: Math.round(img * 4000 + vid * 150 + doc * 600),
    bytes,
    ownBytes: Math.round(bytes * 0.97),
    imageBytes,
    videoBytes,
    documentBytes,
    otherBytes,
    cleanableCount: Math.round(img * 3000 + vid * 100),
    cleanableBytes: Math.round(bytes * 0.8),
    lastTs: now - days * DAY,
    thumbIds: Array.from({ length: 4 }, (_, k) => i * 10 + k + 1),
    recentDocs: doc
      ? DOCS.slice((i * 2) % DOCS.length, ((i * 2) % DOCS.length) + 2).map(([kind, name, size], k) => ({
          id: 9000 + i * 10 + k,
          kind,
          size,
          ts: now - (days + 3 + k * 6) * DAY,
          name,
        }))
      : [],
  };
});

const JOBS: Job[] = [
  { id: 3, rootId: 1, status: "quarantined", createdAt: now - 2 * DAY, finishedAt: now - 2 * DAY, expiresAt: now + 5 * DAY, itemCount: 4_210, totalBytes: Math.round(1.2 * GB), archivePath: null },
  { id: 2, rootId: 1, status: "purged", createdAt: now - 20 * DAY, finishedAt: now - 13 * DAY, expiresAt: now - 13 * DAY, itemCount: 9_870, totalBytes: Math.round(3.6 * GB), archivePath: null },
  { id: 1, rootId: 1, status: "restored", createdAt: now - 25 * DAY, finishedAt: now - 25 * DAY, expiresAt: now - 18 * DAY, itemCount: 120, totalBytes: Math.round(0.3 * GB), archivePath: null },
];

const SETTINGS: AppSettings = {
  trash: [{ rootId: 1, dir: "C:\\Users\\demo\\AppData\\Roaming\\ZaloData\\.zola-trash", isDefault: true, sameDrive: true, free: DISK.free }],
  backupDir: "C:\\Users\\demo\\Documents\\Zola Cleaner",
  backupIsDefault: true,
  savedDirs: ["C:\\Users\\demo\\Downloads"],
  savedDirsDefault: true,
};

/** Ước lượng dung lượng dọn được của một bộ lọc, đủ để số liệu trên màn hình hợp lý. */
function estimate(f: CleanupFilter) {
  const convs = f.convIds ? CONVERSATIONS.filter((c) => f.convIds!.includes(c.convId)) : CONVERSATIONS;
  const cats = new Set(f.categories ?? []);
  const age = f.olderThanDays ? Math.max(0.2, 1 - f.olderThanDays / 900) : 1;
  const bytes = convs.reduce(
    (s, c) =>
      s +
      (cats.has("image") ? c.imageBytes : 0) +
      (cats.has("video") ? c.videoBytes : 0) +
      (cats.has("document") ? c.documentBytes : 0),
    0,
  );
  const total = Math.round(bytes * age * 0.8);
  return { count: Math.round(total / (300 * KB)), bytes: total };
}

const ITEMS: CleanupItem[] = Array.from({ length: 48 }, (_, i) => ({
  id: i + 1,
  category: i % 9 === 0 ? "video" : "image",
  kind: i % 9 === 0 ? "mp4" : "jpg",
  size: Math.round((i % 9 === 0 ? 38 : 0.4 + (i % 5) * 0.3) * MB),
  ts: now - (400 + i * 6) * DAY,
  convId: CONVERSATIONS[i % CONVERSATIONS.length]!.convId,
  name: null,
}));

/** Báo một lần quét đã xong sẵn → app không mở hộp thoại "Đang quét" lúc khởi động (sẽ đè lên ảnh chụp). */
const SCAN_DONE = { rootId: 1, scanId: 1, phase: "done" as const, dirs: 0, seen: 0, newFiles: 0, changed: 0, toRead: 0, read: 0, toWrite: 0, written: 0, bytes: 0, errors: 0 };
const HEALTH: Health = { version: "demo", zaloRunning: false, zaloStuck: 0, scanning: [SCAN_DONE], busy: false };

function handle(cmd: string, args: Record<string, unknown>): unknown {
  switch (cmd) {
    case "health":
      return HEALTH;
    case "roots":
      return [ROOT];
    case "accounts":
      return [{ uid: ROOT.uid, store: ROOT.path }];
    case "take_new_accounts":
    case "take_auto_purged":
      return [];
    case "start_scan":
      // Bấm "Quét lại" → xong ngay
      setTimeout(() => void emit("scan-progress", SCAN_DONE), 50);
      return null;
    case "stats":
      return STATS;
    case "suggestions":
      return SUGGESTIONS;
    case "disk_space":
      return DISK;
    case "drives":
      return DRIVES;
    case "conversations":
      return CONVERSATIONS;
    case "preview": {
      const e = estimate(args.filter as CleanupFilter);
      return { ...e, skippedShared: { count: 37, bytes: 41 * MB }, byCategory: [{ key: "image", ...e }] };
    }
    case "doc_kinds":
      return [
        { kind: "pdf", category: "document", count: 820, bytes: 1.6 * GB },
        { kind: "docx", category: "document", count: 410, bytes: 0.5 * GB },
        { kind: "xlsx", category: "document", count: 260, bytes: 0.3 * GB },
        { kind: "zip", category: "archive", count: 140, bytes: 0.6 * GB },
      ] satisfies KindBucket[];
    case "conversation_months":
      return {
        months: Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now - i * 31 * DAY);
          return {
            month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
            startMs: d.getTime(),
            count: 300 - i * 30,
            bytes: (180 - i * 20) * MB,
            thumbIds: [i * 4 + 1, i * 4 + 2, i * 4 + 3, i * 4 + 4],
          };
        }),
        shared: { key: "", count: 12, bytes: 9 * MB },
      };
    case "cleanup_items": {
      const { offset, limit } = args as { offset: number; limit: number };
      return { total: ITEMS.length, items: ITEMS.slice(offset, offset + limit) };
    }
    case "jobs":
      return JOBS;
    case "settings":
      return SETTINGS;
    case "backup_dir":
      return SETTINGS.backupDir;
    default:
      return null;
  }
}

/** Ảnh thu nhỏ giả: phong cảnh vẽ bằng SVG, màu theo id. */
function fakeThumb(id: string): string {
  const n = Number(id) || 0;
  const hue = (n * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,78%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,90%)"/></linearGradient></defs>
<rect width="160" height="160" fill="url(#s)"/>
<circle cx="${40 + (n % 5) * 18}" cy="45" r="16" fill="hsl(${(hue + 180) % 360},80%,85%)"/>
<path d="M0 120 L${50 + (n % 3) * 10} 70 L100 120 Z" fill="hsl(${hue},35%,45%)"/>
<path d="M60 160 L${110 + (n % 4) * 8} 85 L160 140 L160 160 Z" fill="hsl(${hue},40%,35%)"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function installDemo() {
  mockWindows("main");
  mockIPC((cmd, args) => handle(cmd, (args ?? {}) as Record<string, unknown>), { shouldMockEvents: true });
  (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc =
    fakeThumb;
  // Thẻ nhắc bật tự động tải của Zalo hiện như lần đầu mở app
  localStorage.clear();
}
