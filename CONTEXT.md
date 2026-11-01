# Zalo Cleaner

Dọn dữ liệu media mà Zalo PC tự tải về máy (ảnh, video, tài liệu nhận qua chat) để giải phóng ổ đĩa,
chọn theo hội thoại và tuổi, an toàn và khôi phục được.

## Dữ liệu của Zalo

**Media Store**:
Thư mục `ZaloDownloads` của một tài khoản Zalo, nơi Zalo lưu media đã tải về. Đây là nơi duy nhất app được dọn.
_Avoid_: ZaloData (rộng hơn, gồm cả CSDL và cache trình duyệt), root

**Media Item**:
Một file vật lý trên đĩa, có thể xuất hiện ở nhiều Link. Là đơn vị được đếm dung lượng, cách ly và xoá.
_Avoid_: file, path

**Link**:
Một đường dẫn trỏ tới một Media Item. Một Media Item thường có một Link "kho" (theo loại) và một hoặc nhiều Link "hội thoại".
_Avoid_: hardlink (chi tiết cài đặt), copy, bản sao

**Conversation**:
Một cuộc trò chuyện Zalo (cá nhân hoặc nhóm), định danh bằng ID số mà Zalo dùng trong đường dẫn. App không biết tên thật.
_Avoid_: chat, thread, group (chỉ là một loại Conversation)

**Alias**:
Tên do người dùng tự đặt cho một Conversation để nhận ra nó. Chỉ tồn tại trong app.
_Avoid_: tên hội thoại, nickname

**Shared Media Item**:
Media Item thuộc về nhiều Conversation (ví dụ ảnh được chuyển tiếp). Chỉ được dọn khi mọi Conversation của nó đều được chọn.

**Media Kind**:
Phân loại Media Item theo nội dung: Ảnh, Video, Tài liệu, Thoại. Tài liệu không bao giờ được chọn sẵn.
_Avoid_: category, file type

**Thumbnail**:
Ảnh thu nhỏ Zalo tự tạo cho một ảnh trong chat. Không bao giờ bị dọn, kể cả khi ảnh gốc bị dọn.
_Avoid_: preview

**Message Time**:
Thời điểm tin nhắn chứa Media Item được gửi. Là "tuổi" của Media Item khi lọc.
_Avoid_: mtime, ngày sửa đổi

## Dọn dẹp

**Preview**:
Kết quả chạy thử một lựa chọn: bao nhiêu Media Item, bao nhiêu byte sẽ được giải phóng, bao nhiêu bị bỏ qua và vì sao. Không thay đổi gì trên đĩa.
_Avoid_: dry run

**Quarantine Job**:
Một lần dọn: các Media Item được chọn bị chuyển khỏi Media Store sang khu cách ly, vẫn khôi phục được.
_Avoid_: delete job, cleanup

**Restore**:
Đưa mọi Media Item của một Quarantine Job về đúng các Link ban đầu.

**Purge**:
Xoá vĩnh viễn các Media Item của một Quarantine Job. Chỉ lúc này dung lượng ổ đĩa mới được giải phóng.
_Avoid_: delete

**Retention**:
Số ngày một Quarantine Job được giữ trước khi tự Purge (mặc định 7 ngày).
