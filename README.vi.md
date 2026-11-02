<p align="center">
  <img src="apps/desktop/app-icon.png" width="96" alt="" />
</p>

<h1 align="center">Zola Cleaner</h1>

<p align="center">
  Dọn ảnh, video, tài liệu mà <b>Zalo PC</b> tự tải về máy — chọn theo hội thoại và thời gian, xem trước từng file, khôi phục được.
  <br />
  <br />
  <a href="README.md">English</a> · <b>Tiếng Việt</b>
</p>

---

Zalo PC lưu mọi ảnh, video, tài liệu nhận qua chat vào ổ C, thường lên tới hàng chục GB. Zalo không có cách dọn theo hội thoại hay theo thời gian, nên ổ đĩa cứ đầy dần.

Zola Cleaner cho bạn thấy Zalo đang giữ bao nhiêu, ở hội thoại nào, và dọn đúng phần bạn chọn.

## Tính năng

- **Dọn nhanh**: một câu cho biết Zalo đang chiếm bao nhiêu và dọn được bao nhiêu, ví dụ "Ảnh & video cũ hơn 1 năm → lấy lại 4,4 GB".
- **Theo hội thoại**: chọn từng hội thoại hoặc nhóm, lọc theo loại (ảnh, video, tài liệu, file nén…), theo tuổi, theo kích thước, theo định dạng (ZIP, RAR, PDF…), hoặc "từ tháng này trở về trước".
- **Xem trước từng file**: ảnh hiện thành lưới, tài liệu kèm tên thật. Bỏ tick file nào thì file đó được giữ lại.
- **Thùng rác riêng**: file đã dọn được giữ 7 ngày và khôi phục đúng chỗ cũ. Có thể nén ZIP để cất lên Drive / USB rồi nhập lại sau.
- **An toàn với cách Zalo lưu file**: một file có thể nằm ở nhiều hội thoại (hardlink). App không đếm trùng và không dọn file còn dùng ở hội thoại bạn không chọn.
- Nhận ra dữ liệu Zalo đã chuyển sang ổ khác, và hỗ trợ nhiều tài khoản Zalo trên cùng máy.

## Cài đặt

1. Tải file `Zola.Cleaner_x.y.z_x64-setup.exe` ở trang [**Releases**](../../releases/latest).
2. Mở file cài. Cài theo người dùng hiện tại, không cần quyền quản trị.
3. App **chưa được ký số**, nên Windows có thể hiện "Windows protected your PC". Bấm **More info → Run anyway**.

App tự báo khi có bản mới. Bấm **Cập nhật** là tải và cài.

> Yêu cầu: Windows 10/11 64-bit, Zalo PC bản mới (đã chuyển sang cách lưu media mới của Zalo 5.x).
> Nếu cấu trúc thư mục Zalo trên máy bạn khác với cấu trúc app đã kiểm chứng, app chỉ cho **xem**, không dọn.

## Dùng thế nào cho an toàn

- **Thoát hẳn Zalo trước khi dọn**: chuột phải biểu tượng Zalo ở khay hệ thống → Thoát. App sẽ nhắc nếu Zalo còn chạy.
- Ảnh và video đã dọn: Zalo thường tải lại được khi bạn mở hội thoại, nếu file còn trên máy chủ Zalo.
- **Tài liệu không bao giờ được chọn sẵn**. Không có zCloud thì file chỉ nằm trên máy chủ Zalo một số ngày. Tài liệu đã dọn có thể không tải lại được nữa.
- Không dùng zCloud? Bật **Cài đặt → Tin nhắn → Cài đặt khác → Tự động tải trước Ảnh/File/Video/Tin nhắn thoại dưới 30MB** trong Zalo PC để file về máy trước khi hết hạn.
- Ổ đĩa chỉ thật sự trống ra khi bạn **Dọn sạch thùng rác**, hoặc sau 7 ngày.

## Quyền riêng tư

- App chỉ đọc thư mục media của Zalo (`ZaloDownloads`). App **không đọc tin nhắn**, không đọc CSDL của Zalo, và không điều khiển Zalo.
- Không có telemetry. Kết nối mạng duy nhất là hỏi GitHub xem có bản mới không.
- Nhật ký và báo cáo cấu trúc chỉ được lưu vào file bạn chọn, và đã lược bỏ ID tài khoản, ID hội thoại.

## Phát triển

Cần: Windows, [Rust](https://rustup.rs) ≥ 1.95 (MSVC, kèm Visual Studio Build Tools), Node.js ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev                     # chạy app ở chế độ dev (Tauri + Vite)
cargo test --workspace       # test lõi trên Media Store giả có hardlink thật
cargo clippy --workspace --all-targets
pnpm typecheck
pnpm build                   # file cài NSIS trong target/release/bundle/nsis
```

```
crates/core      Lõi Rust: nhận diện layout Zalo, quét, phân loại, thống kê, thùng rác, ZIP, tên tài liệu
apps/desktop     App Tauri v2: src-tauri (command IPC) + src (React, Tailwind, shadcn/ui)
docs/            Kế hoạch, cấu trúc dữ liệu Zalo, ADR
CONTEXT.md       Thuật ngữ dùng trong code và giao diện
```

Nên đọc trước: [`CONTEXT.md`](CONTEXT.md) (thuật ngữ), [`docs/zalo-layout.vi.md`](docs/zalo-layout.vi.md) (Zalo lưu file thế nào), [`docs/adr/`](docs/adr) (các quyết định lớn).

Phát hành tự động. Commit theo [Conventional Commits](https://www.conventionalcommits.org). Khi CI trên `main` xanh, [semantic-release](https://semantic-release.gitbook.io) tính version mới từ các commit kể từ tag trước: `feat` tăng minor, `fix`/`perf` tăng patch, `BREAKING CHANGE` tăng major. Commit `docs`, `ci`, `chore`, `refactor` không tạo bản mới. Sau đó GitHub Actions gắn tag, build file cài, ký bản cập nhật và publish Release kèm ghi chú tự sinh. Version lấy từ git tag, nên không cần sửa `version` trong các file cấu hình bằng tay.

Khi viết test hoặc tài liệu, đừng dùng uid hay ID hội thoại Zalo thật. Hãy dùng số giả.

## Liên hệ

- Báo lỗi, góp ý tính năng: mở [issue](../../issues). Nếu app báo cấu trúc Zalo chưa được hỗ trợ, hãy đính kèm báo cáo cấu trúc mà app xuất ra. Báo cáo này không chứa tên file hay ID.
- Tác giả: [@holedev](https://github.com/holedev)

## Giấy phép

[MIT](LICENSE).
