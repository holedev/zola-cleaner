# Zalo Cleaner — Kế hoạch dự án

> Web app chạy local (localhost) để **phân tích và dọn dẹp** dữ liệu media mà Zalo PC lưu trên máy:
> ảnh, video, file đã nhận… vốn đã bị Zalo đổi tên thành chuỗi khó đọc và **không bị xoá theo** khi xoá hội thoại.

---

## 1. Bối cảnh & vấn đề

- Zalo PC mặc định lưu dữ liệu ở `C:\Users\<user>\AppData\Local\ZaloPC\` (mỗi tài khoản là một thư mục đặt tên bằng dãy số). File nhận được nằm trong `Zalo Received Files`.
- Zalo cho phép chuyển nơi lưu trữ sang ổ khác (**Cài đặt → Dữ liệu → Quản lý dữ liệu → Thay đổi**). Trường hợp hiện tại: dữ liệu nằm ở **ổ D**, đã lên tới **vài trăm GB**.
- Tên file là chuỗi băm, thường **không có đuôi file** → không lọc được bằng Explorer theo kiểu `*.jpg`.
- Xoá hội thoại trong Zalo **không xoá** ảnh/video đã cache trên đĩa.
- Tính năng dọn dẹp có sẵn của Zalo chỉ xoá theo nhóm thô (bộ nhớ đệm…), không cho chọn theo tuổi, dung lượng, loại.

### Những điều CHƯA biết (cần xác minh ở Giai đoạn 0)

| Câu hỏi | Cách xác minh |
|---|---|
| Cấu trúc thư mục con thực tế trên ổ D (thư mục nào chứa ảnh, video, sticker, avatar, CSDL…) | Chạy `scan` rồi xem báo cáo "theo thư mục" |
| File có bị mã hoá không, hay chỉ bị đổi tên? | Đọc magic bytes: nếu nhận ra JPEG/PNG/MP4 → chỉ đổi tên |
| Xoá file cache có làm Zalo lỗi không? Ảnh cũ có tải lại được không? | Thử cách ly một ít file cũ, mở lại Zalo, kiểm tra |
| Có liên kết được file ↔ hội thoại không (để xoá theo nhóm chat)? | Spike riêng: tìm CSDL của Zalo, xem có đọc được không. **Không cam kết.** |

---

## 2. Mục tiêu

**Phải có (MVP)**
1. Quét một hoặc nhiều thư mục gốc, **nhận diện loại file theo nội dung** (magic bytes), không dựa vào tên.
2. Lưu chỉ mục vào SQLite để lần quét sau **chỉ xử lý phần thay đổi** (quan trọng với vài trăm GB / hàng triệu file).
3. Dashboard thống kê: tổng dung lượng theo loại, theo thư mục, theo tháng/tuổi, top file lớn nhất.
4. Lọc & chọn file theo: loại, tuổi (ngày sửa đổi), dung lượng, thư mục.
5. Dọn dẹp **an toàn**: chạy thử → cách ly (quarantine) → khôi phục hoặc xoá hẳn.

**Nên có**
6. Xem trước ảnh bằng thumbnail, video bằng khung hình đầu.
7. Tìm file trùng lặp (cùng nội dung).
8. Quy tắc dọn dẹp lưu sẵn (ví dụ "video > 50 MB và cũ hơn 6 tháng") và chạy định kỳ.

**Không làm (ít nhất ở giai đoạn đầu)**
- Không sửa CSDL của Zalo.
- Không cam kết xoá theo hội thoại (phụ thuộc kết quả spike).
- Không chạy như dịch vụ nền / không mở ra mạng LAN.

---

## 3. Nguyên tắc an toàn (bất biến)

1. **Mặc định là chạy thử.** Mọi thao tác dọn dẹp đều hiển thị trước: bao nhiêu file, bao nhiêu GB, ví dụ file.
2. **Cách ly trước, xoá sau.** "Xoá" = `rename` file sang thư mục `_zalo_quarantine/<job-id>/` **trên cùng ổ đĩa** (tức thời, không tốn thêm dung lượng), giữ nguyên đường dẫn tương đối. Có nút **Khôi phục**. Chỉ khi người dùng bấm **Xoá vĩnh viễn** (hoặc hết hạn giữ, ví dụ 7 ngày) mới thật sự xoá.
   - Không dùng Thùng rác Windows: với hàng trăm GB, Recycle Bin có giới hạn dung lượng và rất chậm khi đưa từng file vào.
3. **Danh sách loại được phép xoá (allowlist).** Mặc định chỉ `image`, `video`. Không bao giờ đụng tới file nhận diện là `database` (SQLite…), file `.db`, `.db-wal`, `.db-shm`, `.ldb`, `.log`, và các thư mục cấu hình.
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
                          [đọc 32 byte đầu] ─▶ detect() ─▶ category, kind
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
roots(id, path UNIQUE, label, created_at)

files(
  id INTEGER PK,
  root_id, rel_path,              -- UNIQUE(root_id, rel_path)
  size INTEGER, mtime_ms INTEGER,
  category TEXT,                  -- image | video | audio | document | archive | database | other
  kind TEXT,                      -- jpg, png, mp4, heic, sqlite...
  top_dir TEXT,                   -- 1–2 cấp thư mục đầu, để thống kê nhanh
  quick_hash TEXT NULL,           -- hash 64KB đầu (tìm trùng)
  full_hash TEXT NULL,
  seen_scan_id INTEGER,           -- lần quét gần nhất còn thấy file
  status TEXT DEFAULT 'present'   -- present | quarantined | deleted | missing
)
-- index: (category), (mtime_ms), (size), (top_dir), (status)

scans(id, root_id, started_at, finished_at, files_seen, files_new, files_changed, files_missing, error_count)

jobs(id, type, filter_json, status, created_at, finished_at, file_count, total_bytes, quarantine_dir)
job_items(job_id, file_id, from_path, to_path, state, error)   -- state: pending | moved | restored | purged | failed

rules(id, name, filter_json, enabled, schedule)                -- Giai đoạn 4
```

**Quét tăng dần:** mỗi lần quét tăng `scan_id`; file gặp lại cập nhật `seen_scan_id`. File có `size` + `mtime_ms` không đổi thì **không đọc lại header**. Cuối lần quét, file `present` có `seen_scan_id` cũ → đánh dấu `missing`.

---

## 6. API (dự kiến)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Kiểm tra server, phiên bản, Zalo có đang chạy |
| GET/POST/DELETE | `/api/roots` | Quản lý thư mục gốc |
| POST | `/api/scans` | Bắt đầu quét `{ rootId }` → `{ scanId }` |
| GET | `/api/scans/:id/events` | SSE tiến độ quét |
| GET | `/api/stats` | Tổng hợp theo loại / thư mục / tháng / tuổi, top file lớn |
| GET | `/api/files?category=&olderThanDays=&minSize=&dir=&cursor=` | Danh sách có phân trang (keyset) |
| GET | `/api/files/:id/thumb` | Thumbnail (Giai đoạn 3) |
| POST | `/api/cleanup/preview` | Chạy thử với bộ lọc → số file, tổng GB, ví dụ |
| POST | `/api/cleanup` | Tạo job cách ly → `{ jobId }` |
| GET | `/api/jobs`, `/api/jobs/:id/events` | Danh sách job, SSE tiến độ |
| POST | `/api/jobs/:id/restore` | Khôi phục |
| POST | `/api/jobs/:id/purge` | Xoá vĩnh viễn (cần xác nhận) |

---

## 7. Giao diện

1. **Tổng quan** — thẻ số liệu (tổng GB, số file, GB có thể dọn), biểu đồ theo loại, cột theo tháng, bảng theo thư mục.
2. **Duyệt file** — bộ lọc bên trái, lưới thumbnail / bảng bên phải, chọn nhiều, thanh "Đã chọn: N file, X GB".
3. **Dọn dẹp nhanh** — các preset: "Ảnh cũ hơn 1 năm", "Video lớn hơn 50 MB", "Mọi thứ cũ hơn 2 năm" → xem trước → cách ly.
4. **Cách ly** — danh sách job, dung lượng, ngày hết hạn, nút Khôi phục / Xoá vĩnh viễn.
5. **Cài đặt** — thư mục gốc (gợi ý tự tìm `AppData\Local\ZaloPC`, `Zalo Received Files`, thư mục tên "Zalo" ở gốc các ổ), loại cho phép xoá, số ngày giữ cách ly.

---

## 8. Lộ trình

### Giai đoạn 0 — Khảo sát (½ ngày)
- [ ] Chạy `pnpm scan "D:\<thư mục Zalo>"` (CLI có sẵn trong khung) để lấy báo cáo theo loại & thư mục.
- [ ] Ghi lại cấu trúc thư mục thực tế vào `docs/zalo-layout.md`.
- [ ] Thử thủ công: chuyển 100 ảnh cũ ra ngoài, mở Zalo, xem hội thoại cũ hiển thị thế nào → quyết định mức độ mạnh tay.

### Giai đoạn 1 — Lõi quét & chỉ mục (1–2 ngày)
- [x] `detect.ts` + test (khung đã có)
- [x] `scan.ts` quét + ghi SQLite theo lô (khung đã có, bản đơn giản)
- [x] Quét tăng dần (bỏ qua file không đổi), đánh dấu `missing` (khung đã có)
- [ ] Đo hiệu năng trên dữ liệu thật; chỉnh số luồng đọc header (mặc định 64)
- [ ] Xử lý lỗi: file bị khoá (EBUSY/EPERM), đường dẫn dài > 260 ký tự

### Giai đoạn 2 — Dashboard & lọc (2–3 ngày)
- [x] `/api/stats` cơ bản (khung đã có)
- [ ] `/api/files` phân trang keyset + bộ lọc
- [x] SSE tiến độ quét (khung đã có)
- [x] UI Tổng quan cơ bản (khung đã có)
- [ ] Biểu đồ theo tháng, trang Duyệt file (dạng bảng)

### Giai đoạn 3 — Dọn dẹp an toàn (2–3 ngày) ← **mục tiêu chính**
- [ ] `safety.ts`: kiểm tra `Zalo.exe`, allowlist loại
- [ ] `quarantine.ts`: move cùng ổ (fallback copy+unlink nếu khác ổ), ghi `job_items` **trước** khi move
- [ ] Khôi phục, xoá vĩnh viễn, tự hết hạn
- [ ] UI preview → xác nhận → tiến độ → kết quả
- [ ] Thumbnail ảnh bằng `sharp`

### Giai đoạn 4 — Nâng cao (tuỳ thời gian)
- [ ] Tìm trùng lặp (nhóm theo size → quick hash → full hash)
- [ ] Quy tắc lưu sẵn + chạy định kỳ khi mở app
- [ ] Thumbnail video bằng ffmpeg
- [ ] Spike: đọc CSDL Zalo để gắn file với hội thoại
- [ ] Đóng gói: `start.bat` / Node SEA `.exe`

---

## 9. Hiệu năng (cho vài trăm GB)

- Duyệt thư mục bằng stack lặp (không đệ quy) với `fs.readdir({ withFileTypes: true })`.
- Chỉ đọc **32 byte đầu** mỗi file; giới hạn song song ~64 thao tác I/O.
- Ghi SQLite theo lô 1000 dòng trong một transaction; bật `journal_mode=WAL`, `synchronous=NORMAL`.
- Thống kê bằng `GROUP BY` có index; với hàng triệu dòng vẫn < 1 giây.
- Cách ly = `rename` trên cùng ổ → gần như tức thời, kể cả với hàng trăm GB.
- Windows Defender có thể làm chậm quét lần đầu; cân nhắc thêm thư mục Zalo vào ngoại lệ trong lúc quét.

---

## 10. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Xoá nhầm file Zalo cần để chạy | Allowlist chỉ image/video, cách ly trước, kiểm tra Zalo sau khi cách ly |
| Ảnh trong chat cũ không xem lại được | Cảnh báo rõ trong UI; giữ cách ly 7 ngày để thử |
| Zalo cập nhật đổi cấu trúc lưu trữ | Không phụ thuộc cấu trúc — nhận diện theo nội dung |
| Zalo đang ghi file khi cách ly | Bắt buộc tắt Zalo |
| Mất điện giữa chừng | `job_items` ghi trước khi move → khôi phục được |
