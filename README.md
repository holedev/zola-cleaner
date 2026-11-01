# Zalo Cleaner

Web app chạy local để **phân tích và dọn dẹp** dữ liệu ảnh/video mà Zalo PC lưu trên máy — kể cả khi tên file đã bị đổi thành chuỗi khó đọc và không bị xoá theo hội thoại.

- Nhận diện loại file **theo nội dung** (magic bytes), không phụ thuộc tên hay đuôi file
- Chỉ mục SQLite, **quét tăng dần** — phù hợp với hàng trăm GB
- Dọn dẹp an toàn: chạy thử → cách ly → khôi phục / xoá vĩnh viễn *(đang làm, xem kế hoạch)*

📄 Kế hoạch chi tiết: [`docs/PLAN.md`](docs/PLAN.md)

## Yêu cầu

- Node.js **≥ 22.13** (dùng `node:sqlite` có sẵn, không cần build native)
- pnpm 10 (`corepack enable`)

## Bắt đầu

```bash
pnpm install

# Giai đoạn 0 — khảo sát nhanh bằng CLI (không xoá gì)
pnpm scan "D:\ThuMucZalo"

# Chạy web app: API http://127.0.0.1:5174, UI http://127.0.0.1:5173
pnpm dev
```

> Lần đầu quét hàng trăm GB có thể mất vài phút. Các lần sau chỉ xử lý file mới/thay đổi.

## Cấu trúc

```
packages/core   Logic: detect, scan, db, stats, safety, quarantine
apps/server     Hono API (chỉ lắng nghe 127.0.0.1)
apps/web        Vite + React UI
docs/PLAN.md    Kế hoạch & lộ trình
```

## Lệnh

| Lệnh | Mô tả |
|---|---|
| `pnpm dev` | Chạy server + web ở chế độ dev |
| `pnpm scan <dir> [--db file]` | Quét thư mục và in báo cáo |
| `pnpm test` | Chạy test |
| `pnpm typecheck` | Kiểm tra kiểu |

Biến môi trường server: `PORT` (mặc định 5174), `ZC_DATA_DIR` (mặc định `./data`).

## Lưu ý an toàn

- Chưa có chức năng xoá trong bản khung này. Khi cài đặt (Giai đoạn 3), luôn **tắt Zalo** trước khi dọn dẹp.
- Ảnh/video bị xoá khỏi cache có thể không xem lại được trong các hội thoại cũ.
