# Dọn theo file vật lý, gắn hội thoại qua thư mục `resource/`, không đọc CSDL Zalo

Zalo 5.x lưu mỗi media ở một thư mục "kho" theo loại (`picture/`, `video/`, `fileNoise/`…) và đồng thời tạo hardlink
trong `resource/<convId>/…`. Vì thế một đường dẫn không phải là một file: xoá một đường dẫn không giải phóng byte nào,
và cộng dung lượng theo đường dẫn sẽ đếm trùng. Chúng tôi chọn **Media Item = file vật lý** (định danh bằng NTFS file id),
mỗi Media Item có nhiều Link; cách ly/khôi phục/xoá luôn xử lý mọi Link cùng lúc. Conversation của một Media Item được suy ra
từ các Link nằm trong `resource/<convId>/`, thay vì giải mã CSDL tin nhắn của Zalo (đã bị mã hoá, dễ vỡ khi Zalo cập nhật).

## Consequences

- App không biết tên hội thoại; người dùng tự đặt Alias, dựa vào thumbnail.
- Media Item thuộc nhiều Conversation chỉ được dọn khi mọi Conversation đó đều được chọn.
- Nếu Zalo bỏ cấu trúc hardlink trong `resource/`, phải xem lại cách gắn Conversation (phần đếm theo file vật lý vẫn đúng).
