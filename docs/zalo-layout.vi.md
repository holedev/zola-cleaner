# Zalo PC lưu dữ liệu thế nào

[English](zalo-layout.md) · **Tiếng Việt**

Đây là những gì Zola Cleaner dựa vào: Zalo PC cất ảnh, video, tài liệu bạn nhận được ở đâu, đặt tên thế nào, và gắn mỗi file với hội thoại ra sao. Không có gì ở đây lấy từ tài liệu của Zalo. Tất cả được tìm ra bằng cách xem thư mục trên đĩa và đọc chuỗi giao diện trong file của chính Zalo PC, không sửa gì.

> Khảo sát ngày 2026-11-01 trên Zalo PC 26.10.20, sau khi Zalo chuyển media sang cách lưu mới, một máy Windows, một tài khoản.
> Phiên bản hoặc máy khác có thể khác. Vì vậy app luôn kiểm tra cấu trúc trước khi dọn (xem [Zola Cleaner được đụng vào đâu](#zola-cleaner-được-đụng-vào-đâu)).

Mọi ID bên dưới (`<uid>`, `1234567890`, `g9876543210`…) đều là số giả.

## Dữ liệu nằm ở đâu

```
%APPDATA%\ZaloData\                        C:\Users\<bạn>\AppData\Roaming\ZaloData, ~17 GB trên máy khảo sát
├─ config.json                             phiên bản Zalo, trạng thái chuyển dữ liệu
├─ media\<uid>\
│  ├─ ZaloDownloads\                       ← media đã tải (~15 GB): nơi duy nhất Zola Cleaner dọn
│  └─ sticker\                             sticker, không đụng tới
├─ Database\_production\<uid>\             tin nhắn và thông tin kèm theo (SQLite, đã mã hoá)
├─ ftsm_<uid>.db                           chỉ mục tìm kiếm
└─ Partitions\, Cache\, Code Cache\, GPUCache\ …   cache của Electron / Chromium
```

- Phiên bản: **Zalo PC 26 (định dạng lưu dữ liệu 5.x)**. Mục Thông tin của Zalo hiện 26.10.20, còn `config.json` ghi định dạng lưu dữ liệu là `major_version: 5`. Zola Cleaner kiểm tra định dạng lưu dữ liệu.
- `<uid>` là ID số của một tài khoản Zalo. Mỗi tài khoản đăng nhập trên máy có thư mục `media\<uid>\ZaloDownloads` riêng.
- Trên máy khảo sát, `AppData\Local\ZaloPC` không tồn tại, còn `Documents\Zalo Received Files` thì rỗng.
- File bạn chủ động bấm "Lưu về máy" (ví dụ vào `D:\Zalo`) là bản của bạn, không phải cache của Zalo. Zola Cleaner không bao giờ đụng tới.

| Mục trong `ZaloData\` | Dung lượng | Là gì |
|---|---|---|
| `media\` | ~15 GB | Media đã tải |
| `Database\_production\<uid>\` | ~690 MB | CSDL SQLite (Core, Media, MsgInfo, Res…), đã mã hoá |
| `Partitions\`, `Cache\`, `Code Cache\`, `GPUCache\`… | ~1 GB | Electron / Chromium |
| `ftsm_<uid>.db` | ~55 MB | Tìm kiếm toàn văn |

### Khi đổi vị trí lưu trữ sang ổ khác

Zalo PC cho chuyển dữ liệu ở **Cài đặt → Quản lý dữ liệu → Vị trí lưu trữ → Thay đổi**. Phần này rút ra từ mã của Zalo PC (`resources\app.asar`), chưa thử chuyển thật.

- Zalo chỉ cho chọn **ổ khác** ổ mặc định. Media khi đó nằm ở `<ổ>:\Zalo Data\media\<uid>\ZaloDownloads` (chú ý `Zalo Data` có dấu cách). CSDL tin nhắn có thể chuyển theo sang `<ổ>:\Zalo Data\message`.
- Ổ đang dùng được lưu trong cài đặt của Zalo (`resource.location.path` / `.label`) và trong registry `HKCU\Software\vng.zalo.pc`.
- `config.json` vẫn ở `%APPDATA%\ZaloData`.

Mỗi lần mở, Zola Cleaner tìm trong `%APPDATA%\ZaloData\media` và `<mọi ổ cố định / ổ rời>\Zalo Data\media`. Thư mục từng thấy mà nay biến mất thì tài khoản đó được đánh dấu "Không còn ở đây".

## Thư mục media: `ZaloDownloads`

| Thư mục | Dung lượng | Số file | Nội dung |
|---|---|---|---|
| `picture\<convId>\` | 3,7 GB | 18k | Ảnh, tên dạng `z<msgId>_…_<hash>.jxl` hoặc `.jpg`, đã chia theo hội thoại |
| `fileNoise\` | 5,3 GB | 2,6k | Tài liệu và file khác nhận qua chat, đã bị làm nhiễu (xem [Định dạng file](#định-dạng-file)) |
| `video\` | 2,0 GB | 408 | Video (MP4), tên là số, không có đuôi |
| `file\` | 323 MB | 123 | File nhận |
| `Cache\` | 663 MB | 5,8k | Thumbnail Zalo tự tạo cho ảnh |
| `richThumb\`, `fileThumb\` | nhỏ | | Ảnh xem trước của link và tài liệu |
| `voice\`, `zinstant\` | nhỏ | | Tin nhắn thoại, nội dung Zalo Instant |
| `resource\<convId>\{picture,video,fileNoise,file,Cache,richThumb}\` | thêm 0 byte | 35k | **Hardlink** tới file ở các thư mục trên, xếp theo hội thoại |

Trong `video\` và `fileNoise\`, file của nhóm nằm trong thư mục con `group\`.

## Một file, nhiều đường dẫn (hardlink)

Đây là chìa khoá để dọn theo hội thoại mà không cần đọc CSDL của Zalo.

Một ảnh nhận được chỉ được lưu **một lần** trên đĩa, nhưng xuất hiện ở hai đường dẫn trở lên:

```
ZaloDownloads\
├─ picture\9876543210_group\z<msgId>_…_<hash>.jxl                           đường dẫn "kho", theo loại
└─ resource\g9876543210\picture\1730419200000_<uidNgườiGửi>_g9876543210_….jxl   đường dẫn "hội thoại"
```

Cả hai là hardlink NTFS tới cùng một file vật lý. Chỉ xoá một đường dẫn thì không giải phóng được byte nào. Theo thuật ngữ của Zola Cleaner ([CONTEXT.md](../CONTEXT.md)), file vật lý là **Media Item**, mỗi đường dẫn là một **Link**.

- Phần lớn file có 2 Link: một đường dẫn kho và một đường dẫn hội thoại.
- File được chuyển tiếp sang nhiều hội thoại có 3–5 Link, mỗi hội thoại một Link. Đó là **Shared Media Item**: app chỉ dọn khi mọi hội thoại của nó đều được chọn.
- Một ít file chỉ có 1 Link: không gắn hội thoại nào, hoặc chỉ có đường dẫn `resource\` (xem [Sau khi dọn](#zalo-làm-gì-sau-khi-dọn)).
- App đếm file vật lý chứ không đếm đường dẫn, nên dung lượng không bao giờ bị đếm trùng. Cả thư mục `resource\` thêm 0 byte.

### Tên file và ID hội thoại

- Link trong `resource\` có tên `<msgTs>_<uidNgườiGửi>_<convId>_…`:
  - `msgTs` là thời điểm gửi tin nhắn, dạng epoch mili-giây 13 chữ số. Zola Cleaner dùng nó làm **tuổi** của file, không dùng ngày sửa đổi.
  - Trường thứ hai là uid của **người gửi**, không phải chủ tài khoản.
- Hội thoại cá nhân định danh bằng một số (`1234567890`). Nhóm được viết theo hai kiểu: `g<id>` trong `resource\` và tên file, `<id>_group` trong `picture\`. App quy cả hai về `g<id>` để một nhóm không bị tách làm hai.
- Zalo không lưu tên thật của hội thoại trên đĩa ở dạng đọc được. App hiện ID và cho bạn tự đặt **Alias**.

## Định dạng file

Tên file là chuỗi băm và thường **không có đuôi**, nên app nhận diện mỗi file qua vài byte đầu ("magic bytes").

- **Ảnh**: khoảng 65% là **JPEG XL** (`.jxl`), còn lại JPEG hoặc PNG. Trình duyệt chưa hiển thị được JPEG XL, nên app tự giải mã để làm thumbnail.
- **`fileNoise\`**: Zalo làm nhiễu file nhận được ở đây. **100 byte đầu** bị XOR với `0x93`, phần còn lại giữ nguyên, và Zalo gắn thêm đuôi 6 byte `\x07zAlO\x07` vào cuối file. Sau khi giải XOR thì thấy trong đó không chỉ có tài liệu (PDF, Word, Excel…) mà còn có video, MP3, ZIP/RAR gửi dưới dạng file.
- **Tên tài liệu**: tên file gốc không được giữ trên đĩa. Zola Cleaner tìm lại bằng cách đối chiếu với bản bạn đã lưu (Downloads, `Zalo Received Files`, `<ổ>:\Zalo`), hoặc đọc tiêu đề ghi bên trong file PDF và Office.

## `.rescache`

Thư mục nào cũng có file `.rescache`. Đây là sổ sách riêng của Zalo cho phần cache đó:

```json
{"__version__":1,"totalSize":12345,"count":3,"data":{"<tên>":[flag,size], …}}
```

Zalo tự ghi lại file này khi thấy thiếu file (xem bên dưới). App **không bao giờ đọc hay sửa `.rescache`**.

## Zalo làm gì sau khi dọn

Thử nghiệm ngày 2026-11-01: chuyển 10 ảnh JPEG XL (1,4 MB, không dùng chung) của một nhóm ra khỏi thư mục media, trên tài khoản **có Zalo Cloud**.

- **Zalo tự tải lại ảnh khi mở hội thoại.** Ảnh hiển thị bình thường, không báo lỗi. Khoảng 1 phút sau khi mở nhóm, 9/10 ảnh đã về. Ảnh còn lại chưa cuộn tới nên chưa tải. File tải lại **giống từng byte** bản gốc.
- Ảnh tải lại chỉ có đường dẫn hội thoại (`resource\<convId>\picture\…`, 1 Link). Zalo **không** tạo lại đường dẫn kho trong `picture\`.
- Thumbnail trong `resource\<convId>\Cache\` không bị đụng tới.
- Ngay khi mở hội thoại, Zalo ghi `.rescache` của các thư mục liên quan về rỗng, nên app không cần sửa gì.

Hệ quả:

- Có Zalo Cloud thì dọn ảnh gần như không mất gì. Chỉ ảnh nào bạn mở xem lại mới được tải về và chiếm chỗ lại.
- **Không có Cloud** thì file cũ có thể đã hết hạn trên máy chủ Zalo (xem bên dưới) và không về được nữa. Vì vậy app giữ file đã dọn trong thùng rác 7 ngày và không bao giờ chọn sẵn tài liệu.
- Khôi phục sau khi Zalo đã tải lại: nếu file ở đường dẫn cũ cùng nội dung, app thay nó bằng Link tới bản được khôi phục. Nếu khác nội dung, app giữ file của Zalo. Chưa kiểm tra Zalo hiển thị hội thoại ra sao sau khi khôi phục.

## Tự tải và hết hạn file

Theo chuỗi giao diện trong Zalo PC 26.10.20:

- Zalo PC có **Cài đặt → Tin nhắn → Cài đặt khác → "Tự động tải trước Ảnh/File/Video/Tin nhắn thoại dưới 30MB"**. Tuỳ chọn này chỉ áp dụng cho file tối đa 30 MB, và chỉ khi Zalo PC đang chạy.
- **Không có zCloud** thì file chỉ nằm trên máy chủ Zalo một số ngày kể từ lúc gửi ("File chỉ được lưu tối đa N ngày kể từ thời điểm gửi…"). File chưa tải về máy trước lúc đó thì mất hẳn ("File không còn tồn tại").
- `config.json` không chứa tuỳ chọn tự tải, nên app không biết nó đang bật hay tắt. App chỉ hướng dẫn bạn bật.

## Cơ sở dữ liệu

- Các file dùng chung trong `Database\_production\` (`Qos.db`, `Storage.db`, `SecureLocalstorage.db`…) là SQLite thường.
- CSDL theo tài khoản (`<uid>\Core\Message\*.db`, `Media.db`, `MsgInfo.db`, `Res.db`…) **đã bị mã hoá**.

Zola Cleaner không đọc các CSDL này và không điều khiển giao diện Zalo ([ADR 0003](adr/0003-khong-dieu-khien-zalo.md)). Mọi thứ app biết đều đến từ cấu trúc thư mục ở trên.

## Zola Cleaner được đụng vào đâu

**Được dọn**: file có đường dẫn kho trong `picture\`, `video\`, `fileNoise\` hoặc `file\`, cùng mọi Link `resource\` của nó.

**Không bao giờ đụng tới**: `Cache\`, `richThumb\`, `fileThumb\` (thumbnail), `voice\`, `zinstant\`, `.rescache`, `sticker\`, các CSDL, cache Chromium, và mọi thứ nằm ngoài `ZaloDownloads`.

**Kiểm tra cấu trúc được hỗ trợ**: trước khi cho dọn, app kiểm tra thư mục media có giống hệt cấu trúc đã khảo sát ở đây không:

1. Đường dẫn có dạng `…\media\<uid>\ZaloDownloads`.
2. Có thư mục `picture\` và `resource\`.
3. `config.json` có định dạng lưu dữ liệu 5.x (`major_version: 5`) và `migrate_full_done: true`, tức Zalo đã chuyển xong media sang cách lưu mới.
4. Trong tối đa 40 ảnh mẫu ở `picture\`, có ít nhất một ảnh có hardlink (từ 2 Link trở lên).

Thiếu bất kỳ điều nào thì thư mục chỉ được xem. Bạn có thể xuất **báo cáo cấu trúc** (hình dạng thư mục, số file, dung lượng, không có tên file, ID hay nội dung) và gửi kèm một [issue](https://github.com/holedev/zola-cleaner/issues) để được hỗ trợ thêm.

## Số liệu khảo sát

- 63 175 Link → 34 625 Media Item, 13,4 GiB. Quét lần đầu mất khoảng 3,5 giây.
- 161 hội thoại có media dọn được, sau khi gộp hai dạng ID nhóm.
- Theo loại: ảnh 5,9 GB, tài liệu 4,2 GB, video 3,1 GB, file nén 0,8 GB (GB thập phân).
