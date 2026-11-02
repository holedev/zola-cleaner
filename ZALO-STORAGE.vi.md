# Zalo PC lưu file của bạn ở đâu?

[English](ZALO-STORAGE.md) · **Tiếng Việt**

Trang này giải thích Zalo PC cất ảnh, video, tài liệu bạn nhận qua chat ở đâu trên máy, vì sao ổ C đầy dần, và phần nào dọn được.

> Áp dụng cho **Zalo PC 26 (định dạng lưu dữ liệu 5.x)** trên Windows. Hộp thông tin phiên bản của Zalo sẽ ghi dạng "Phiên bản 26.x.x".

## Mở thư mục dữ liệu Zalo

1. Bấm **Windows + R**.
2. Gõ `%APPDATA%\ZaloData` rồi bấm **Enter**.

Thư mục này thường nằm ở `C:\Users\<tên bạn>\AppData\Roaming\ZaloData`. Trên máy dùng lâu, nó có thể lên tới **hàng chục GB**.

## Bên trong có gì

```
ZaloData
├─ media
│  └─ <số tài khoản>
│     ├─ ZaloDownloads     ← ảnh, video, tài liệu bạn nhận được (chiếm nhiều chỗ nhất)
│     └─ sticker           ← sticker
├─ Database                ← tin nhắn của bạn (đã mã hoá)
└─ Cache, GPUCache …       ← bộ nhớ đệm của giao diện Zalo
```

- **`<số tài khoản>`**: mỗi tài khoản Zalo đăng nhập trên máy có một thư mục riêng, tên là một dãy số.
- **`ZaloDownloads`** là phần phình to nhất và là **nơi duy nhất Zola Cleaner dọn**.
- **`Database`** chứa tin nhắn. Đừng bao giờ xoá hay sửa thư mục này, nếu không Zalo có thể mất lịch sử chat.

## Thư mục `ZaloDownloads`

| Thư mục | Chứa gì | Dọn được? |
|---|---|---|
| `picture` | Ảnh, đã chia thành thư mục con theo từng hội thoại | ✅ |
| `video` | Video | ✅ |
| `fileNoise` | Tài liệu và file nhận qua chat (PDF, Word, Excel, ZIP…) | ✅ (không bao giờ chọn sẵn) |
| `file` | File nhận | ✅ |
| `resource` | Lối tắt tới chính các file ở trên, xếp theo hội thoại | Đi kèm khi dọn file gốc |
| `Cache`, `richThumb`, `fileThumb` | Ảnh thu nhỏ để Zalo hiện khung chat nhanh | ❌ Giữ nguyên |
| `voice` | Tin nhắn thoại | ❌ Giữ nguyên |
| `zinstant` | Nội dung Zalo Instant | ❌ Giữ nguyên |

## Những điều dễ gây bất ngờ

**Tên file khó đọc, thường không có đuôi.** Zalo đổi tên mọi file thành chuỗi ký tự ngẫu nhiên, ví dụ `1730419200000_…_a3f9c1`. Bạn không biết được file nào là ảnh gì hay tài liệu gì nếu chỉ nhìn tên. Tài liệu trong `fileNoise` còn bị Zalo mã hoá nhẹ, nên mở trực tiếp sẽ báo lỗi.

**Một file có thể nằm ở nhiều chỗ mà chỉ tốn chỗ một lần.** Một ảnh vừa có trong `picture`, vừa có trong `resource\<hội thoại>`. Nếu được chuyển tiếp sang nhóm khác, ảnh đó còn có thêm một chỗ nữa. Đây là cùng **một** file trên đĩa (Windows gọi là *hardlink*), không phải bản sao. Hệ quả:
- Xoá tay ở một chỗ thì **không lấy lại được chút dung lượng nào**, vì file vẫn còn ở chỗ kia.
- Windows Explorer có thể cộng trùng và báo dung lượng lớn hơn thực tế.

**Xoá hội thoại trong Zalo không xoá file.** Ảnh, video của hội thoại đã xoá vẫn nằm nguyên trong `ZaloDownloads`.

**Dữ liệu có thể đã nằm ở ổ khác.** Nếu bạn từng đổi **Cài đặt → Quản lý dữ liệu → Vị trí lưu trữ**, media sẽ nằm ở `<ổ>:\Zalo Data\media\<số tài khoản>\ZaloDownloads` (chú ý `Zalo Data` có dấu cách). Zola Cleaner tự tìm ra thư mục này.

## Dọn rồi có lấy lại được không?

- **Ảnh và video**: khi bạn mở lại hội thoại, Zalo thường tự tải lại, miễn là file còn trên máy chủ Zalo.
- **Tài liệu**: nếu không có zCloud, file chỉ nằm trên máy chủ Zalo **một số ngày** kể từ lúc gửi. Đã dọn thì có thể **không tải lại được nữa**. Vì vậy Zola Cleaner không bao giờ chọn sẵn tài liệu.
- Để file kịp về máy trước khi hết hạn, bật trong Zalo PC: **Cài đặt → Tin nhắn → Cài đặt khác → Tự động tải trước Ảnh/File/Video/Tin nhắn thoại dưới 30MB**. Tuỳ chọn này chỉ chạy khi Zalo PC đang mở.

## Vì sao nên dọn bằng Zola Cleaner thay vì xoá tay

| Xoá tay trong Explorer | Zola Cleaner |
|---|---|
| Không biết file nào thuộc hội thoại nào | Chọn theo hội thoại, theo thời gian gửi, theo loại |
| Xoá một chỗ không giải phóng được dung lượng | Gỡ file ở mọi chỗ cùng lúc, dung lượng tính đúng |
| Dễ xoá nhầm ảnh thu nhỏ, tin nhắn | Chỉ đụng tới ảnh, video, tài liệu, file |
| Không có đường lui | Giữ trong thùng rác 7 ngày, khôi phục đúng chỗ cũ |
| Ảnh còn dùng ở hội thoại khác cũng bị xoá | Giữ lại ảnh còn dùng ở hội thoại bạn không chọn |

Trước khi dọn, hãy **thoát hẳn Zalo**: chuột phải biểu tượng Zalo ở khay hệ thống → **Thoát**.

---

Bạn muốn tìm hiểu kỹ hơn? Xem [tài liệu kỹ thuật](docs/zalo-layout.vi.md). Thấy cấu trúc trên máy bạn khác với trang này? Hãy mở một [issue](https://github.com/holedev/zola-cleaner/issues).
