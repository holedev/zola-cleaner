# Zola Cleaner

Dọn dữ liệu media mà Zalo PC tự tải về máy (ảnh, video, tài liệu nhận qua chat) để giải phóng ổ đĩa,
chọn theo hội thoại và tuổi, an toàn và khôi phục được.

## Dữ liệu của Zalo

**Account**:
Một tài khoản Zalo đã đăng nhập trên máy, định danh bằng uid. Mỗi Account có đúng một Media Store.
_Avoid_: user (người dùng app), profile

**Media Store**:
Thư mục `ZaloDownloads` của một Account, nơi Zalo lưu media đã tải về. Đây là nơi duy nhất app được dọn.
_Avoid_: ZaloData (rộng hơn, gồm cả CSDL và cache trình duyệt), root

**Supported Layout**:
Cách Zalo sắp xếp một Media Store mà app đã khảo sát và hiểu rõ (hiện chỉ Zalo 5.x sau khi chuyển media sang vị trí mới).
Media Store không có Supported Layout chỉ được xem, không được dọn.
_Avoid_: version, phiên bản Zalo

**Structure Report**:
Bản mô tả hình dạng một Media Store (thư mục, số file, dung lượng, loại) không chứa tên file, ID hay nội dung,
để người dùng gửi cho nhà phát triển khi gặp layout chưa hỗ trợ.
_Avoid_: log, nhật ký (nhật ký là chuyện khác: ghi lại thao tác và lỗi của app)

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

**Suggestion**:
Một lựa chọn dọn soạn sẵn trên mọi Conversation (ví dụ "Ảnh & video cũ hơn 1 năm"), kèm số byte dọn được. Chọn một Suggestion dẫn tới Preview.
_Avoid_: preset, rule (rule là dọn định kỳ, chưa có)

**Preview**:
Kết quả chạy thử một lựa chọn: bao nhiêu Media Item, bao nhiêu byte sẽ được giải phóng, bao nhiêu bị bỏ qua và vì sao. Không thay đổi gì trên đĩa.
_Avoid_: dry run

**Quarantine Job**:
Một lần dọn: các Media Item được chọn bị chuyển khỏi Media Store sang thùng rác của app, vẫn khôi phục được.
Trên giao diện, tập hợp các Quarantine Job đang giữ file gọi là "Thùng rác" (của app — không phải Thùng rác Windows,
vì khôi phục phải tạo lại mọi Link). Mặc định nằm cùng ổ với Media Store; người dùng có thể chọn chỗ khác, kể cả ổ khác.
_Avoid_: delete job, cleanup, cách ly (khó hiểu với người dùng phổ thông)

**Restore**:
Đưa mọi Media Item của một Quarantine Job về đúng các Link ban đầu.

**Purge**:
Xoá vĩnh viễn các Media Item của một Quarantine Job. Chỉ lúc này dung lượng ổ đĩa mới được giải phóng.
Trên giao diện: "Xoá vĩnh viễn" (một job) và "Dọn sạch thùng rác" (mọi job).
_Avoid_: delete, giải phóng

**Backup**:
File ZIP gom các Media Item của một hoặc nhiều Quarantine Job, kèm bản kê mọi Link của chúng — để người dùng cất ở nơi khác
(Drive, USB) trước khi Purge. Nhập lại một Backup = đặt Media Item về đúng mọi Link, như Restore; chỉ vào đúng Account đã sao lưu.
Trên giao diện: "Nén ZIP để sao lưu" / "Nhập lại từ ZIP".
_Avoid_: export, archive (archive là Media Kind "file nén")

**Retention**:
Số ngày một Quarantine Job được giữ trước khi tự Purge (mặc định 7 ngày). Chỉ được thực thi khi app được mở; app không chạy nền.
