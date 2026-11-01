# Cấu trúc dữ liệu Zalo PC (khảo sát 2026-11-01)

Máy khảo sát: Zalo PC 5.x, đã migrate sang layout mới, một tài khoản (uid `9533337693992746410`).

## Vị trí

- Dữ liệu chính: `%APPDATA%\ZaloData` (`C:\Users\<user>\AppData\Roaming\ZaloData`), tổng ~17 GB.
- `AppData\Local\ZaloPC` **không tồn tại** trên máy này; `Documents\Zalo Received Files` rỗng.
- `D:\Zalo` (~1 GB) là file người dùng chủ động "Lưu về máy" (pdf/docx) — không phải cache, app không đụng.

## `ZaloData\` cấp 1

| Mục | Dung lượng | Ghi chú |
|---|---|---|
| `media\` | ~15 GB | media đã tải — **mục tiêu dọn** |
| `Database\_production\<uid>\` | 688 MB | SQLite (Core, Media, MsgInfo, Res…), đã mã hoá (`db-enc: finished`) |
| `Partitions\`, `Cache\`, `Code Cache\`, `GPUCache\`… | ~1 GB | Electron/Chromium |
| `ftsm_<uid>.db` | 55 MB | full-text search |

## `media\<uid>\ZaloDownloads\`

| Thư mục | Dung lượng | Số file | Nội dung |
|---|---|---|---|
| `picture\<convId>[_group]\` | 3.7 G | 18k | ảnh, tên `z<msgId>_..._<hash>.jpg` hoặc `.jxl` |
| `fileNoise\` | 5.3 G | 2.6k | tài liệu nhận qua chat, **XOR từng byte với `0x93`** |
| `video\` | 2.0 G | 408 | MP4, tên số, không đuôi |
| `file\` | 323 M | 123 | file nhận |
| `Cache\` | 663 M | 5.8k | thumbnail JPEG `<msgTs>_<uid>_<convId>_t` / `_n` |
| `richThumb\`, `fileThumb\`, `voice\`, `zinstant\` | nhỏ | | |
| `resource\<convId>\{picture,video,fileNoise,file,Cache,richThumb}\` | (0 thêm) | 35k | **hardlink** tới file ở các thư mục trên |

- Link trong `resource\` có tên `<msgTs>_<uid người gửi>_<convId>_<...>`; `msgTs` là epoch ms của tin nhắn. Trường thứ 2 là **người gửi**, không phải chủ tài khoản.
- ID hội thoại nhóm có **hai dạng**: `g<id>` (trong `resource\` và tên file) và `<id>_group` (trong `picture\`). App quy về `g<id>`.
- File của nhóm trong `video\` và `fileNoise\` nằm ở thư mục con `group\`.
- `Cache\<convId>\gen-h-<hash>` là thumbnail cấp kho, đặt tên theo hash. `resource\<convId>\Cache\<msgTs>_<uid tài khoản>_<convId>_t|_n` hiếm khi khớp ảnh trong `picture\`.
- Ảnh: ~65% là **JPEG XL** (13k/20k file), còn lại jpg/png. Trình duyệt chưa hiển thị được JXL → app tự giải mã thành thumbnail.
- `fileNoise\` không chỉ là tài liệu: có cả video, mp3, zip gửi dưới dạng file (nhận ra sau khi giải XOR).
- Link count quan sát được: phần lớn 2 (kho + 1 hội thoại), một số 3–5 (ảnh có trong nhiều hội thoại), một ít 1 (không gắn hội thoại).
- Mỗi thư mục có `.rescache`: JSON `{"__version__":1,"totalSize":N,"count":N,"data":{"<tên>":[flag,size],...}}` — sổ sách cache của Zalo.
- `sticker\` nằm cạnh `ZaloDownloads\`, ngoài phạm vi dọn.

## Số liệu quét (2026-11-01)

- 63 175 Link → 34 625 Media Item, 13.4 GiB; quét lần đầu ~3.5 giây.
- 161 hội thoại có media dọn được (sau khi gộp hai dạng ID nhóm).
- Theo loại: ảnh 5.9 GB, tài liệu 4.2 GB, video 3.1 GB, file nén 0.8 GB (GB thập phân).

## Thực nghiệm (Giai đoạn 0)

Chưa làm. Cần trả lời:

- [ ] Xoá ảnh gốc của 1 hội thoại (giữ thumbnail): Zalo hiển thị thumbnail mờ, ô hỏng, hay tự tải lại?
- [ ] `.rescache` bị lệch có làm Zalo lỗi / báo sai dung lượng không? → quyết định có cần sửa `.rescache`.
- [ ] Khôi phục (tạo lại hardlink) có làm Zalo hiển thị lại bình thường không?
