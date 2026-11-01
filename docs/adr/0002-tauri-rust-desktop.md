# Viết lại thành app desktop Tauri với lõi Rust, thay cho web app Node

Bản đầu là web app chạy local: lõi TypeScript trên Node (`node:sqlite`, giải mã JPEG XL bằng WASM), API Hono, UI Vite.
Nó chạy đúng trên máy người viết, nhưng app sẽ được chia sẻ cho người dùng phổ thông trên Windows: họ cần một file `.exe`
cài được không cần quyền admin, nhẹ, mở nhanh, và không mở cổng HTTP trên máy. Chúng tôi chọn **Tauri v2 (WebView2) với lõi
viết lại hoàn toàn bằng Rust**, UI vẫn là React gọi lõi qua IPC.

Các phương án đã cân nhắc:
- **Electron**: dùng lại được gần hết code TS, nhưng file cài ~100 MB, RAM ~200 MB, và giải mã JXL vẫn là WASM.
- **Tauri + Node sidecar**: giữ lõi TS nhưng phải kèm Node (~80 MB) và chạy hai tiến trình, mất gần hết lợi ích của Tauri.
- **Next.js / web app đóng gói bằng Node SEA**: vẫn là server localhost, vẫn cần token và kiểm tra Origin, không có cửa sổ riêng.

## Consequences

- Phải port toàn bộ lõi (quét, nhận diện, cách ly / khôi phục hardlink, thumbnail) sang Rust. Các test TS được port 1-1 làm
  chuẩn đối chiếu; code TS chỉ bị xoá khi bản Rust cho kết quả giống hệt trên cùng fixture và trên dữ liệu thật.
- Bản Rust lấy NTFS file id ngay khi liệt kê thư mục (không phải mở từng file), và giải mã JXL bằng `jxl-oxide`.
- Không còn HTTP server: bỏ được token, kiểm tra Host / Origin. Bề mặt tấn công chỉ còn các command IPC của Tauri.
- Chỉ chạy trên Windows; build và phát hành qua GitHub Actions.
