# Zalo Cleaner

Web app chạy local để **dọn ảnh, video, tài liệu** mà Zalo PC tự tải về máy (`%APPDATA%\ZaloData\media\<uid>\ZaloDownloads`), **chọn theo hội thoại** và tuổi.

- Nhận diện loại file **theo nội dung** (magic bytes; tài liệu trong `fileNoise` được giải XOR), xem được cả ảnh JPEG XL
- Hiểu **hardlink** của Zalo: dung lượng không đếm trùng, dọn một file là gỡ mọi đường dẫn của nó
- Danh sách hội thoại xếp theo dung lượng, kèm ảnh gần đây và tên tự đặt
- Dọn dẹp an toàn: xem trước → cách ly (giữ 7 ngày) → khôi phục / xoá vĩnh viễn

📄 Kế hoạch: [`docs/PLAN.md`](docs/PLAN.md) · Thuật ngữ: [`CONTEXT.md`](CONTEXT.md) · Cấu trúc dữ liệu Zalo: [`docs/zalo-layout.md`](docs/zalo-layout.md)

## Yêu cầu

- Node.js **≥ 22.13** (dùng `node:sqlite` có sẵn, không cần build native)
- pnpm 10 (`corepack enable`)

## Bắt đầu

```bash
pnpm install

# Khảo sát nhanh bằng CLI (chỉ đọc, không xoá gì) — tự tìm thư mục ZaloDownloads
pnpm scan

# Chạy web app: API http://127.0.0.1:5174, UI http://127.0.0.1:5173
pnpm dev
```

> Quét ~35 nghìn file / 15 GB mất vài giây. Các lần sau chỉ đọc lại file mới/thay đổi.

## Cấu trúc

```
packages/core   Logic: layout, detect, scan, db, stats, thumbs/jxl, safety, quarantine
apps/server     Hono API (chỉ lắng nghe 127.0.0.1)
apps/web        Vite + React UI
docs/           Kế hoạch, cấu trúc dữ liệu Zalo, ADR
CONTEXT.md      Thuật ngữ
```

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `pnpm dev` | Chạy server + web ở chế độ dev |
| `pnpm scan [dir] [--db file]` | Quét Media Store và in báo cáo (theo loại, thư mục kho, hội thoại) |
| `pnpm test` | Chạy test |
| `pnpm typecheck` | Kiểm tra kiểu |

Biến môi trường server: `PORT` (mặc định 5174), `ZC_DATA_DIR` (mặc định `./data`), `ZC_QUARANTINE_DIR` (mặc định `%APPDATA%\zalo-cleaner\quarantine`, phải cùng ổ với ZaloData).

## Lưu ý an toàn

- Phải **thoát hẳn Zalo** trước khi cách ly / khôi phục — app tự kiểm tra và từ chối nếu Zalo đang chạy.
- Cách ly chưa giải phóng dung lượng; chỉ khi xoá vĩnh viễn (bấm tay hoặc sau 7 ngày) ổ đĩa mới trống ra.
- Ảnh/video đã xoá có thể không xem lại được trong hội thoại cũ. **Chưa thực nghiệm** Zalo phản ứng thế nào — xem mục "Thực nghiệm" trong [`docs/zalo-layout.md`](docs/zalo-layout.md); nên thử trước với một hội thoại nhỏ.
- Không bao giờ đụng tới thumbnail (`Cache/`…), `.rescache`, CSDL, hay file ngoài ZaloDownloads.
