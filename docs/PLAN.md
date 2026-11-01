# Zalo Cleaner — Kế hoạch dự án

> Web app chạy local (localhost) để **phân tích và dọn dẹp** dữ liệu media mà Zalo PC lưu trên máy:
> ảnh, video, file đã nhận… vốn đã bị Zalo đổi tên thành chuỗi khó đọc và **không bị xoá theo** khi xoá hội thoại.

---

## 1. Bối cảnh & vấn đề

- Zalo PC 5.x lưu dữ liệu ở `%APPDATA%\ZaloData` (~17 GB trên máy khảo sát). Media đã tải nằm ở
  `media\<uid>\ZaloDownloads\` (~15 GB) — đây là **Media Store**, phạm vi dọn duy nhất. Chi tiết: [zalo-layout.md](zalo-layout.md).
- Tên file là chuỗi băm, thường **không có đuôi file**; tài liệu trong `fileNoise\` còn bị XOR `0x93` → phải nhận diện theo nội dung.
- Mỗi media có một Link "kho" (`picture\`, `video\`, `fileNoise\`…) và hardlink trong `resource\<convId>\…` → **biết được media thuộc hội thoại nào** mà không cần đọc CSDL Zalo. Xem [ADR 0001](adr/0001-media-item-is-physical-file.md).
- Xoá hội thoại trong Zalo **không xoá** media đã cache trên đĩa.
- Tính năng dọn dẹp có sẵn của Zalo chỉ xoá theo nhóm thô, không cho chọn theo hội thoại, tuổi, dung lượng, loại.
- Thuật ngữ: [CONTEXT.md](../CONTEXT.md).

### Những điều CHƯA biết (cần xác minh ở Giai đoạn 0)

| Câu hỏi | Cách xác minh |
|---|---|
| Xoá ảnh gốc (giữ thumbnail) thì Zalo hiện gì? Có tự tải lại không? | Cách ly tay 1 hội thoại nhỏ, mở Zalo, kiểm tra |
| `.rescache` bị lệch có làm Zalo lỗi / báo sai dung lượng? | Như trên; chỉ thêm logic sửa `.rescache` nếu cần |
| Khôi phục (tạo lại hardlink) có làm Zalo hiển thị lại bình thường? | Khôi phục sau thử nghiệm trên |

---

## 2. Mục tiêu

**Phải có (MVP)**
1. Tự tìm Media Store, quét và **nhận diện Media Kind theo nội dung** (magic bytes, giải XOR cho `fileNoise`).
2. Chỉ mục **Media Item** (file vật lý) + các **Link** của nó vào SQLite; dung lượng không đếm trùng hardlink; quét tăng dần.
3. Danh sách **Conversation** xếp theo dung lượng, kèm thumbnail mới nhất và **Alias** do người dùng đặt.
4. Chọn Conversation + lọc theo Media Kind, **Message Time**, kích thước. Tài liệu mặc định không tick.
5. Dọn dẹp **an toàn**: Preview → Quarantine Job → Restore hoặc Purge. Shared Media Item chỉ dọn khi mọi Conversation của nó đều được chọn.

**Nên có**
6. Thumbnail video bằng khung hình đầu.
7. Tìm file trùng lặp (cùng nội dung).
8. Quy tắc dọn dẹp lưu sẵn (ví dụ "video nhóm X cũ hơn 3 tháng") và chạy định kỳ.

**Không làm (ít nhất ở giai đoạn đầu)**
- Không đọc/sửa CSDL của Zalo; không lấy tên thật của hội thoại.
- Không đụng ngoài Media Store (CSDL, cache Chromium, sticker, file người dùng tự lưu như `D:\Zalo`).
- Không xoá Thumbnail (`Cache\`, `richThumb\`, `fileThumb\`).
- Không chạy như dịch vụ nền / không mở ra mạng LAN.

---

## 3. Nguyên tắc an toàn (bất biến)

1. **Mặc định là chạy thử.** Mọi thao tác dọn dẹp đều hiển thị trước: bao nhiêu file, bao nhiêu GB, ví dụ file.
2. **Cách ly trước, xoá sau.** Cách ly một Media Item = `rename` một Link vào `%APPDATA%\zalo-cleaner\quarantine\<jobId>\` (cùng ổ với ZaloData, ngoài ZaloData) và gỡ các Link còn lại. Mọi Link được ghi vào nhật ký **trước**; Restore = rename ngược + tạo lại hardlink. Dung lượng chỉ giảm khi Purge (người dùng bấm, hoặc sau Retention 7 ngày).
   - Không dùng Thùng rác Windows: Recycle Bin có giới hạn dung lượng, chậm, và không hiểu hardlink.
3. **Allowlist theo thư mục kho.** Chỉ Link kho trong `picture\`, `video\`, `fileNoise\`, `file\` được dọn (kèm các Link `resource\` của cùng Media Item). Không bao giờ dọn `Cache\`, `richThumb\`, `fileThumb\`, `voice\`, `zinstant\`, `.rescache`, file `database`.
4. **Kiểm tra Zalo đang chạy** (`tasklist` tìm `Zalo.exe`) trước khi cách ly/xoá; yêu cầu tắt Zalo.
5. **Nhật ký mọi thao tác** trong SQLite (job, file, đường dẫn cũ → mới, thời điểm) để khôi phục được kể cả khi app bị tắt giữa chừng.
6. **Chỉ lắng nghe `127.0.0.1`**, kiểm tra header `Host` và `Origin`, kèm token ngẫu nhiên sinh lúc khởi động → chống trang web lạ gọi vào API localhost (CSRF / DNS rebinding).

---

## 4. Kiến trúc

```
zalo-cleaner/
├─ packages/core        # Logic thuần, không phụ thuộc HTTP — test được độc lập
│  ├─ detect.ts         # Nhận diện loại file qua magic bytes
│  ├─ scan.ts           # Duyệt thư mục, quét tăng dần, ghi chỉ mục
│  ├─ db.ts             # Schema + truy vấn SQLite (node:sqlite)
│  ├─ stats.ts          # Thống kê cho dashboard
│  ├─ quarantine.ts     # Cách ly / khôi phục / xoá vĩnh viễn
│  └─ safety.ts         # Kiểm tra Zalo đang chạy, allowlist
├─ apps/server          # Hono trên Node (@hono/node-server), REST + SSE
└─ apps/web             # Vite + React + TypeScript (UI)
```

### Lựa chọn công nghệ

| Thành phần | Chọn | Lý do |
|---|---|---|
| Runtime | **Node ≥ 22.13** (LTS) | Truy cập file hệ thống, có sẵn `node:sqlite` |
| CSDL | **`node:sqlite`** (built-in) | Không phải build native trên Windows. Nếu cần hiệu năng hơn → `better-sqlite3` |
| API | **Hono** + `@hono/node-server` | Quen thuộc, nhẹ, type-safe với `hono/client` |
| UI | **Vite + React + TS** | Đơn giản cho SPA chạy local; có thể thay bằng framework khác |
| Thumbnail | `sharp` (Giai đoạn 3) | Có prebuilt cho Windows; cache thumbnail ra đĩa |
| Video thumbnail | `ffmpeg` (tuỳ chọn) | Chỉ bật nếu máy có ffmpeg |
| Hash trùng lặp | `node:crypto` (sha1/xxhash) | Chỉ hash file có cùng kích thước |
| Monorepo | **pnpm workspaces** | |
| Đóng gói (sau) | Script `start.bat` mở trình duyệt; hoặc build `.exe` bằng Node SEA | |

### Luồng dữ liệu

```
[Thư mục gốc] ──walk──▶ [stat: size, mtime] ──đã có & không đổi?──▶ bỏ qua
                                   │ mới/đổi
                                   ▼
                          [đọc 64 byte đầu] ─▶ detect() ─▶ category, kind
                                   ▼
                       [SQLite: bảng files, ghi theo lô 1000 dòng/transaction]
                                   ▼
            [stats / filter API] ──▶ [UI dashboard, lưới file, chọn]
                                   ▼
                [cleanup job: dry-run → quarantine → restore | purge]
```

---

## 5. Mô hình dữ liệu (SQLite)

```sql
roots(id, path UNIQUE, label, created_at)                       -- mỗi root là một Media Store (ZaloDownloads)

items(                                                           -- Media Item = file vật lý
  id INTEGER PK, root_id,
  file_key TEXT,                  -- "<dev>:<ino>" (NTFS file id) — UNIQUE(root_id, file_key)
  size, mtime_ms,
  msg_ts INTEGER NULL,            -- Message Time, lấy từ tên Link trong resource/
  area TEXT,                      -- thư mục kho: picture | video | fileNoise | file | Cache | ...
  category, kind,                 -- Media Kind theo nội dung (fileNoise giải XOR 0x93 trước)
  seen_scan_id,
  status                          -- present | quarantined | deleted | missing
)

links(id, item_id, root_id, rel_path, conv_id NULL, seen_scan_id)   -- UNIQUE(root_id, rel_path)
conversations(root_id, conv_id, is_group, alias)                    -- PK(root_id, conv_id); chỉ Alias là dữ liệu người dùng

scans(id, root_id, started_at, finished_at, files_seen, files_new, files_changed, files_missing, error_count)

jobs(id, root_id, filter_json, status, created_at, finished_at, expires_at, item_count, total_bytes, quarantine_dir)
job_items(job_id, item_id, links_json, quarantine_path, state, error)  -- state: pending | moved | restored | purged | failed

rules(id, name, filter_json, enabled, schedule)                    -- Giai đoạn 4
```

**Quét tăng dần:** mỗi Link được `stat` (bigint) để lấy `file_key`. Media Item đã biết, cùng `size` + `mtime_ms` → không đọc lại header.
Mỗi Media Item chỉ đọc header một lần dù có nhiều Link. Cuối lần quét: Link không còn thấy bị xoá khỏi chỉ mục, Media Item `present` không còn thấy → `missing`.

---

## 6. API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Server, phiên bản, Zalo có đang chạy |
| GET/POST/DELETE | `/api/roots` | Quản lý Media Store; `GET /api/roots/detect` gợi ý `%APPDATA%\ZaloData\media\*\ZaloDownloads` |
| POST | `/api/scans` | Bắt đầu quét `{ rootId }` → `{ scanId }`; `GET /api/scans/:id/events` SSE |
| GET | `/api/stats` | Tổng hợp theo loại / thư mục kho / tháng (không đếm trùng hardlink) |
| GET | `/api/conversations` | Danh sách Conversation: bytes, bytes riêng, số item theo loại, item mới nhất |
| PATCH | `/api/conversations/:convId` | Đặt Alias |
| GET | `/api/items/:id/thumb` | Thumbnail (JPEG trong `Cache/` theo Message Time, hoặc ảnh gốc jpg/png/gif/webp) |
| POST | `/api/cleanup/preview` | Preview `{ rootId, convIds?, categories, olderThanDays?, minSize? }` |
| POST | `/api/cleanup` | Tạo Quarantine Job → kết quả |
| GET | `/api/jobs` | Danh sách job |
| POST | `/api/jobs/:id/restore`, `/api/jobs/:id/purge` | Restore / Purge |

---

## 7. Giao diện

1. **Tổng quan** — tổng GB thật, theo loại, theo thư mục kho; nút Quét.
2. **Hội thoại** — bảng xếp theo GB: thumbnail mới nhất, ID + cờ nhóm, ô Alias, GB riêng / GB tổng, checkbox.
   Thanh lọc: loại (Ảnh, Video ✔ — Tài liệu, Khác ☐), cũ hơn N ngày, lớn hơn N MB → **Preview** (số file, GB, số bị bỏ qua vì dùng chung) → Cách ly.
3. **Cách ly** — danh sách job, dung lượng, ngày hết hạn, nút Khôi phục / Xoá vĩnh viễn.

---

## 8. Lộ trình

### Giai đoạn 0 — Khảo sát
- [x] Khảo sát cấu trúc thật → [zalo-layout.md](zalo-layout.md)
- [ ] Thực nghiệm cách ly tay 1 hội thoại nhỏ (xem câu hỏi ở mục 1)

### Giai đoạn 1 — Lõi quét & chỉ mục
- [x] `detect.ts` + test, giải XOR cho `fileNoise`, JPEG XL
- [x] Mô hình Media Item / Link, quét tăng dần theo `file_key`, gắn Conversation + Message Time
- [ ] Đo hiệu năng trên dữ liệu thật
- [ ] Đường dẫn dài > 260 ký tự

### Giai đoạn 2 — Hội thoại & lọc
- [x] `/api/stats` không đếm trùng, `/api/conversations`, Alias, thumbnail từ `Cache/`
- [x] UI Hội thoại + bộ lọc

### Giai đoạn 3 — Dọn dẹp an toàn ← **mục tiêu chính**
- [x] Preview (bỏ qua Shared Media Item), Quarantine Job xử lý mọi Link, Restore tạo lại hardlink, Purge, tự Purge sau Retention
- [x] UI Preview → Cách ly → Khôi phục / Xoá vĩnh viễn
- [ ] Sửa `.rescache` nếu thực nghiệm Giai đoạn 0 cho thấy cần

### Giai đoạn 4 — Nâng cao (tuỳ thời gian)
- [ ] Tìm trùng lặp (nhóm theo size → quick hash → full hash)
- [ ] Quy tắc lưu sẵn + chạy khi mở app
- [ ] Thumbnail video bằng ffmpeg; xem ảnh `.jxl`
- [ ] Đóng gói: `start.bat` / Node SEA `.exe`

---

## 9. Hiệu năng

- Duyệt thư mục bằng stack lặp (không đệ quy) với `fs.readdir({ withFileTypes: true })`.
- Chỉ đọc **64 byte đầu** mỗi Media Item (một lần dù nhiều Link); giới hạn song song ~64 thao tác I/O.
- Ghi SQLite theo lô 1000 dòng trong một transaction; bật `journal_mode=WAL`, `synchronous=NORMAL`.
- Thống kê bằng `GROUP BY` có index; với hàng triệu dòng vẫn < 1 giây.
- Cách ly = `rename` trên cùng ổ → gần như tức thời, kể cả với hàng trăm GB.
- Windows Defender có thể làm chậm quét lần đầu; cân nhắc thêm thư mục Zalo vào ngoại lệ trong lúc quét.

---

## 10. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Xoá nhầm file Zalo cần để chạy | Chỉ dọn trong Media Store, allowlist theo thư mục kho, không bao giờ dọn Thumbnail/`.rescache`/CSDL |
| Xoá một Link mà không giải phóng byte nào | Đơn vị dọn là Media Item; xử lý mọi Link cùng lúc |
| Ảnh vẫn được hội thoại khác dùng | Shared Media Item chỉ dọn khi mọi Conversation của nó được chọn |
| Ảnh trong chat cũ không xem lại được | Cảnh báo rõ trong UI; giữ cách ly 7 ngày để thử |
| Zalo cập nhật đổi cấu trúc lưu trữ | Nhận diện loại theo nội dung; gắn Conversation phụ thuộc `resource/` — xem ADR 0001 |
| Zalo đang ghi file khi cách ly | Bắt buộc tắt Zalo |
| Mất điện giữa chừng | `job_items` ghi trước khi move → khôi phục được |
