# Chỉ đọc Media Store, không đọc CSDL hay điều khiển Zalo

Người dùng không có zCloud hay mất file: file chưa từng tải về PC thì máy chủ Zalo xoá sau một số ngày (File Expiry).
Đã có đề xuất để app tự phát hiện file mới và tự tải về: đọc CSDL tin nhắn của Zalo, giả lập click vào file trong cửa sổ Zalo,
hoặc gọi thẳng máy chủ Zalo. Chúng tôi quyết định **Zola Cleaner chỉ làm việc với Media Store** (file Zalo đã tải về máy),
không đọc CSDL của Zalo, không điều khiển giao diện Zalo, không gọi máy chủ Zalo. Thay vào đó app hướng dẫn bật
Auto-download có sẵn của Zalo PC.

Các phương án đã cân nhắc:
- **Đọc CSDL tin nhắn** để biết file nào chưa tải: các CSDL theo tài khoản bị mã hoá; phải lấy khoá của Zalo.
  Một app phát hành công khai không nên làm việc đó với dữ liệu tin nhắn của người dùng.
- **Giả lập click trong Zalo**: giành chuột và bàn phím khi người dùng đang làm việc, không chạy khi khoá màn hình,
  hỏng mỗi lần Zalo đổi giao diện, và bấm nhầm có thể gửi hoặc chuyển tiếp file cho người khác.
- **Gọi máy chủ Zalo** bằng phiên đăng nhập của người dùng: không có API công khai, vi phạm điều khoản, có thể bị khoá tài khoản.

## Consequences

- File trên 30MB, hoặc tới khi Zalo PC tắt, vẫn có thể hết hạn. App chỉ nhắc người dùng tự tải.
- App không biết Auto-download đang bật hay tắt; thẻ nhắc trên màn Dọn nhanh ẩn đi khi người dùng bấm "Đã bật".
