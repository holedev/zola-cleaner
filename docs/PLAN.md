# Zola Cleaner — Kế hoạch dự án

> App desktop Windows (Tauri + Rust) để **phân tích và dọn dẹp** dữ liệu media mà Zalo PC lưu trên máy:
> ảnh, video, file đã nhận… vốn đã bị Zalo đổi tên thành chuỗi khó đọc và **không bị xoá theo** khi xoá hội thoại.
> Phát hành công khai (MIT) cho người dùng phổ thông. Bản đầu tiên là web app Node (commit `3ea7fac`), đang được viết lại — xem [ADR 0002](adr/0002-tauri-rust-desktop.md).

---

## 1. Bối cảnh & vấn đề

- Zalo PC 26 (định dạng lưu dữ liệu 5.x) lưu dữ liệu ở `%APPDATA%\ZaloData` (~17 GB trên máy khảo sát). Media đã tải nằm ở
  `media\<uid>\ZaloDownloads\` (~15 GB) — đây là **Media Store**, phạm vi dọn duy nhất. Chi tiết: [zalo-layout.vi.md](zalo-layout.vi.md).
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
6. Màn chính là các **Suggestion** có sẵn số GB; tab "Theo hội thoại" cho người muốn chọn chi tiết.
7. Nhiều **Account**; chỉ dọn Media Store có **Supported Layout**, còn lại chỉ xem + xuất **Structure Report**.
8. File cài NSIS theo từng user (không cần admin), tự cập nhật qua GitHub Releases.

**Nên có**
9. Thumbnail video bằng khung hình đầu.
10. Tìm file trùng lặp (cùng nội dung).
11. Quy tắc dọn dẹp lưu sẵn (ví dụ "video nhóm X cũ hơn 3 tháng").

**Không làm (ít nhất ở giai đoạn đầu)**
- Không đọc/sửa CSDL của Zalo; không lấy tên thật của hội thoại.
- Không đụng ngoài Media Store (CSDL, cache Chromium, sticker, file người dùng tự lưu như `D:\Zalo`).
- Không xoá Thumbnail (`Cache\`, `richThumb\`, `fileThumb\`).
- Không chạy như dịch vụ nền / không mở cổng mạng; không gửi dữ liệu nào đi (chỉ kiểm tra cập nhật).
- Không tự tắt Zalo (có thể làm hỏng CSDL Zalo đang ghi).

---

## 3. Nguyên tắc an toàn (bất biến)

1. **Mặc định là chạy thử.** Mọi thao tác dọn dẹp đều hiển thị trước: bao nhiêu file, bao nhiêu GB, ví dụ file.
2. **Thùng rác trước, xoá sau.** Chuyển một Media Item vào thùng rác = chuyển một Link vào `<thùng rác>\<jobId>-<thời điểm>\` và gỡ các Link còn lại. Mọi Link được ghi vào nhật ký **trước**; Restore = chuyển ngược + tạo lại hardlink. Thùng rác mặc định cùng ổ với dữ liệu Zalo (`%APPDATA%\zola-cleaner\quarantine`, hoặc `<ổ>\ZolaCleaner\trash`) → đổi tên, tức thì, dung lượng chỉ giảm khi Purge. Người dùng chọn được thùng rác ở ổ khác (tab Cài đặt) → chép rồi xoá bản gốc: chậm hơn nhưng ổ chứa Zalo trống ngay. Không cho đặt thùng rác trong thư mục dữ liệu Zalo.
   - Không dùng Thùng rác Windows: Recycle Bin có giới hạn dung lượng, chậm, và không hiểu hardlink.
3. **Allowlist theo thư mục kho.** Chỉ Link kho trong `picture\`, `video\`, `fileNoise\`, `file\` được dọn (kèm các Link `resource\` của cùng Media Item). Không bao giờ dọn `Cache\`, `richThumb\`, `fileThumb\`, `voice\`, `zinstant\`, `.rescache`, file `database`.
4. **Kiểm tra Zalo đang chạy** (tìm tiến trình `Zalo.exe`) trước khi cách ly/khôi phục; chặn và hướng dẫn người dùng tự thoát Zalo.
5. **Nhật ký mọi thao tác** trong SQLite (job, file, đường dẫn cũ → mới, thời điểm) để khôi phục được kể cả khi app bị tắt giữa chừng.
6. **Không có HTTP server.** UI gọi lõi qua IPC của Tauri; capabilities tối thiểu, CSP chặt.
7. **Chỉ dọn Supported Layout.** Media Store lạ → chỉ đọc.

---

## 4. Kiến trúc

```
zalo-cleaner/
├─ Cargo.toml              # Cargo workspace
├─ crates/core             # zalo-cleaner-core: logic thuần, test độc lập + bin `zc` (quét từ dòng lệnh)
│  ├─ layout.rs            # parse Link, Conversation, Account, Supported Layout (fingerprint)
│  ├─ detect.rs            # magic bytes, JPEG XL, Office trong ZIP, giải XOR fileNoise
│  ├─ scan.rs              # duyệt thư mục, NTFS file id khi liệt kê, quét tăng dần
│  ├─ db.rs                # schema + truy vấn SQLite (rusqlite, bundled)
│  ├─ stats.rs             # thống kê, Conversation theo bộ lọc, Suggestion
│  ├─ quarantine.rs        # Preview / Quarantine / Restore / Purge / Retention
│  ├─ thumbs.rs            # thumbnail; JPEG XL bằng jxl-oxide
│  ├─ safety.rs            # Zalo đang chạy, allowlist
│  └─ report.rs            # Structure Report, xuất nhật ký đã lược
├─ apps/desktop            # Tauri v2: src-tauri (command, protocol thumb://) + src (React + shadcn/ui)
```

### Lựa chọn công nghệ

| Thành phần | Chọn | Lý do |
|---|---|---|
| Vỏ app | **Tauri v2** (WebView2) | File cài ~10 MB, có sẵn trên Windows 11 — xem ADR 0002 |
| Lõi | **Rust** | Nhanh, một tiến trình; NTFS file id qua crate `windows` |
| CSDL | **rusqlite** (bundled) | Không phụ thuộc SQLite của hệ thống |
| JPEG XL | **jxl-oxide** + `image` | Rust thuần, không phải build C++ |
| UI | **Vite + React + TS + Tailwind + shadcn/ui**, TanStack Query | Trạng thái loading rõ ràng |
| Phát hành | GitHub Actions + `tauri-action`, NSIS `currentUser`, Tauri updater | Chưa ký code — hướng dẫn vượt SmartScreen |

### Luồng dữ liệu

```
[Media Store] ──liệt kê thư mục (kèm file id)──▶ đã có & không đổi? ──▶ chỉ đánh dấu đã thấy
                                   │ mới/đổi
                                   ▼
                          [đọc 64 byte đầu] ─▶ detect() ─▶ category, kind
                                   ▼
                       [SQLite: items + links, ghi theo lô]
                                   ▼
          [command IPC: stats / conversations / suggestions] ──▶ [UI]
                                   ▼
                [Preview → Quarantine Job → Restore | Purge]
```

---

## 5. Mô hình dữ liệu (SQLite)

```sql
roots(id, path UNIQUE, label, created_at)                       -- mỗi root là một Media Store (ZaloDownloads)

items(                                                           -- Media Item = file vật lý
  id INTEGER PK, root_id,
  file_key TEXT,                  -- "<volume serial>:<file id>" (NTFS) — UNIQUE(root_id, file_key)
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

**Quét tăng dần:** file id của mỗi Link lấy ngay khi liệt kê thư mục (`FileIdBothDirectoryInfo`), không mở từng file. Media Item đã biết, cùng `size` + `mtime_ms` → không đọc lại header.
Mỗi Media Item chỉ đọc header một lần dù có nhiều Link. Cuối lần quét: Link không còn thấy bị xoá khỏi chỉ mục, Media Item `present` không còn thấy → `missing`.

---

## 6. Command (IPC)

| Command | Mô tả |
|---|---|
| `health` | Phiên bản, Zalo có đang chạy, lần quét đang chạy |
| `roots`, `add_root`, `detect_roots` | Account / Media Store, kèm Supported Layout |
| `start_scan(rootId, channel)` | Quét, tiến độ gửi qua `Channel` |
| `stats`, `suggestions` | Tổng hợp, Suggestion kèm số byte |
| `conversations(filter)` | Conversation: tổng, riêng, **dọn được theo bộ lọc**, thumbnail |
| `set_alias` | Đặt Alias |
| `preview(filter)`, `quarantine(filter)` | Preview / tạo Quarantine Job |
| `jobs`, `restore(jobId)`, `purge(jobId)` | Quarantine Job |
| `export_report`, `export_log` | Structure Report / nhật ký đã lược |
| protocol `thumb://<itemId>` | Thumbnail (Zalo `Cache/`, ảnh gốc, hoặc JXL đã giải mã) |

---

## 7. Giao diện

1. **Tổng quan / Gợi ý** — tổng GB thật; các Suggestion ("Ảnh & video cũ hơn 1 năm", "Video > 50 MB"…) kèm GB → Preview.
2. **Hội thoại** — bảng xếp theo GB: thumbnail mới nhất, ID + cờ nhóm, ô Alias, GB riêng / GB tổng, checkbox.
   Thanh lọc: loại (Ảnh, Video ✔ — Tài liệu, Khác ☐), cũ hơn N ngày, lớn hơn N MB → **Preview** (số file, GB, số bị bỏ qua vì dùng chung) → Cách ly.
3. **Cách ly** — danh sách job, dung lượng, ngày tự xoá, nút **Giải phóng ngay** / Khôi phục. Đóng app khi còn job → nhắc.
4. Thao tác dài có hộp thoại tiến độ chặn thao tác khác; banner "Zalo đang chạy" có hình hướng dẫn thoát; Media Store lạ → chỉ đọc + Xuất báo cáo cấu trúc.

---

## 8. Lộ trình

Bản web Node (commit `3ea7fac`) đã xong: quét, Conversation, Preview, Quarantine / Restore / Purge, thumbnail JXL.

### Giai đoạn 0 — Thực nghiệm (bằng app Node)
- [x] Cách ly 1 hội thoại nhỏ, mở Zalo xem phản ứng → ghi vào [zalo-layout.vi.md](zalo-layout.vi.md): Zalo (có Cloud) tự tải lại ảnh, tự sửa `.rescache` → app không đụng `.rescache`
- [ ] Kiểm tra Zalo hiển thị sau khi Khôi phục

### Giai đoạn 1 — Toolchain
- [x] Rust (stable-msvc) + VS Build Tools (C++)
- [ ] Khoá ký cập nhật Tauri (không commit)

### Giai đoạn 2 — Lõi Rust (`crates/core`)
- [x] Port layout / detect / db / scan / stats / quarantine / thumbs / safety + test đối chiếu từ bản TS (26 test)
- [x] Supported Layout (fingerprint), Structure Report, nhật ký đã lược
- [x] `zc scan` khớp số liệu bản TS trên dữ liệu thật (quét mới 2.4 s, quét lại 1.2 s); đường dẫn > 260 ký tự

### Giai đoạn 3 — App desktop (`apps/desktop`)
- [x] Command + protocol `thumb://`; UI shadcn: Gợi ý, Theo hội thoại (theo bộ lọc), Cách ly, loading / chặn thao tác
- [x] File cài NSIS 3.7 MB
- [x] Biểu tượng app; thử cách ly → khôi phục → giải phóng bằng app desktop trên dữ liệu thật

### Giai đoạn 4 — Phát hành
- [x] Repo public (MIT, lịch sử đã xoá ID thật), CI build NSIS + updater, README người dùng cuối

### Giai đoạn 5 — Gỡ code cũ và nâng cao
- [x] Xoá `packages/core`, `apps/server`, `apps/web`
- [ ] Tìm trùng lặp; quy tắc lưu sẵn; thumbnail video

---

## 9. Hiệu năng

- Liệt kê thư mục kèm file id (một lời gọi cho cả thư mục, không mở từng file); đọc **64 byte đầu** mỗi Media Item một lần, tối đa 8 luồng cùng lấy việc từ một hàng đợi xếp theo file id (đỡ nhảy đầu đọc trên HDD).
- Ghi SQLite theo lô trong một transaction; `journal_mode=WAL`, `synchronous=NORMAL`.
- Giải mã thumbnail JPEG XL trên pool riêng, cache ra đĩa, gộp request trùng — không bao giờ chặn UI.
- Cách ly = `rename` trên cùng ổ → gần như tức thời.
- Windows Defender có thể làm chậm quét lần đầu.

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
| Máy người khác có layout chưa khảo sát | Chỉ dọn Supported Layout; còn lại chỉ đọc + Structure Report |
| Người dùng không mở lại app → file cách ly chiếm chỗ mãi | Sau cách ly hướng dẫn "Giải phóng ngay"; nhắc khi đóng app; tự xoá quá 7 ngày ở lần mở sau |
| SmartScreen cảnh báo file chưa ký | Hướng dẫn có hình + SHA-256; mã nguồn public, build từ CI |
| Lộ dữ liệu riêng tư | Không gửi gì đi; báo cáo / nhật ký đã lược tên file và ID |
