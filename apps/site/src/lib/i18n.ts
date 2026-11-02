// Nội dung landing page, hai ngôn ngữ. Thuật ngữ theo CONTEXT.md: Thùng rác, Dọn, Khôi phục, Dọn sạch thùng rác, Gợi ý.
// Chuỗi có thẻ HTML (<b>, <a>) được render bằng set:html — chỉ chứa nội dung viết tay ở đây.
import { ISSUES_URL, REPO_URL } from "./links";

export type Lang = "vi" | "en";

const storageDoc = (lang: Lang) => `${REPO_URL}/blob/main/${lang === "vi" ? "ZALO-STORAGE.vi.md" : "ZALO-STORAGE.md"}`;

export function t(lang: Lang, verified: string) {
  return lang === "vi" ? vi(verified) : en(verified);
}

export type Copy = ReturnType<typeof vi>;

function vi(verified: string) {
  return {
    htmlLang: "vi",
    title: "Zola Cleaner: dọn dữ liệu Zalo PC, giải phóng ổ C",
    description:
      "Dọn ảnh, video, tài liệu mà Zalo PC tự tải về máy. Chọn theo hội thoại và thời gian, xem trước từng file, khôi phục được trong 7 ngày. Miễn phí, mã nguồn mở.",
    ogAlt: "Zola Cleaner: lấy lại hàng chục GB Zalo chiếm trên ổ C",
    nav: { features: "Tính năng", install: "Cài đặt", faq: "Hỏi đáp", other: "English", otherLang: "en" as Lang },
    hero: {
      title: "Zalo đang chiếm hàng chục GB trên ổ C.",
      accent: "Lấy lại trong vài phút.",
      sub: "Dọn ảnh, video, tài liệu Zalo PC tự tải về, chọn theo hội thoại và thời gian. Xem trước từng file, khôi phục được trong 7 ngày. Miễn phí, mã nguồn mở.",
      shotAlt: "Màn hình Dọn nhanh: Zalo đang giữ 13,4 GB trên ổ C, dọn ảnh và video cũ hơn 1 năm để lấy lại 5,1 GB",
      demoNote: "Ảnh chụp từ dữ liệu minh hoạ.",
    },
    download: {
      label: "Tải cho Windows",
      fallbackMeta: "Windows 10/11 · 64-bit",
      meta: "{version} · {size} · Windows 10/11",
      source: "Mã nguồn trên GitHub",
    },
    limits: {
      title: "Yêu cầu và giới hạn",
      items: [
        "Windows 10 hoặc 11, bản 64-bit.",
        `Zalo PC 26 (định dạng lưu dữ liệu 5.x). <b>Đã kiểm chứng</b> tới Zalo PC ${verified}.`,
        "Zalo mới hơn bản đã kiểm chứng: <b>Chưa kiểm chứng</b>, vẫn dọn được nhưng app cảnh báo trước.",
        "Cấu trúc thư mục Zalo khác với bản đã khảo sát: <b>Không hỗ trợ</b>, app chỉ cho xem, không dọn.",
        "App chưa được ký số, nên lần đầu mở Windows sẽ hỏi lại (xem bước cài).",
      ],
    },
    problem: {
      eyebrow: "Vì sao ổ C cứ đầy",
      title: "Zalo không dọn giúp bạn",
      items: [
        {
          title: "Mọi thứ đổ vào ổ C",
          body: "Ảnh, video, tài liệu nhận qua chat đều được Zalo PC lưu vào ổ C. Dùng lâu, phần này lên tới hàng chục GB.",
        },
        {
          title: "Không dọn được theo hội thoại hay thời gian",
          body: "Công cụ dọn có sẵn của Zalo chỉ xoá theo nhóm thô. Không chọn được nhóm chat cũ, hay ảnh từ năm ngoái.",
        },
        {
          title: "Xoá hội thoại, file vẫn còn",
          body: "Xoá một cuộc trò chuyện trong Zalo không xoá ảnh, video của nó trên đĩa.",
        },
        {
          title: "Xoá tay không lấy lại được chỗ",
          body: "Mỗi file nằm ở nhiều thư mục cùng lúc. Xoá ở một chỗ thì dung lượng không giảm, mà còn dễ xoá nhầm ảnh thu nhỏ hay dữ liệu Zalo cần để chạy.",
        },
        {
          title: "File có hạn trên máy chủ Zalo",
          body: "Không có zCloud thì file chỉ nằm trên máy chủ Zalo một số ngày kể từ lúc gửi. Tự tải của Zalo chỉ nhận file dưới 30 MB, và chỉ khi Zalo PC đang mở.",
        },
      ],
    },
    features: {
      eyebrow: "Tính năng",
      title: "Dọn đúng phần bạn muốn",
      shots: [
        {
          img: "conversations",
          title: "Theo hội thoại",
          body: "Chọn từng hội thoại hoặc nhóm. Lọc theo loại, theo thời gian gửi, theo kích thước hay định dạng (ZIP, RAR, PDF…). Tự đặt tên cho hội thoại để dễ nhận ra.",
          alt: "Màn hình Theo hội thoại: danh sách hội thoại kèm ảnh, tài liệu sẽ dọn và dung lượng dọn được",
        },
        {
          img: "trash",
          title: "Thùng rác 7 ngày",
          body: "File đã dọn nằm trong Thùng rác 7 ngày và được khôi phục đúng chỗ cũ. Muốn giữ lâu hơn thì nén ZIP để cất lên Drive hay USB, rồi nhập lại sau.",
          alt: "Màn hình Thùng rác: các lần dọn, dung lượng, ngày tự xoá, nút Khôi phục và Xoá vĩnh viễn",
        },
        {
          img: "overview",
          title: "Tổng quan",
          body: "Xem Zalo đang giữ gì: theo loại, theo tuổi, theo thư mục của Zalo, kèm loại ổ và tình trạng ổ đĩa. App nhận ra cả dữ liệu Zalo đã chuyển sang ổ khác, và nhiều tài khoản Zalo trên cùng máy.",
          alt: "Màn hình Tổng quan: dung lượng theo loại, theo tuổi và thông tin ổ đĩa",
        },
      ],
      extras: [
        { title: "Dọn nhanh theo Gợi ý", body: "Một câu cho biết dọn được bao nhiêu, ví dụ \"Ảnh & video cũ hơn 1 năm → 5,1 GB\"." },
        { title: "Xem trước từng file", body: "Ảnh hiện thành lưới, tài liệu kèm tên thật. Bỏ tick file nào thì file đó được giữ lại." },
        { title: "Không đếm trùng", body: "Một ảnh có ở nhiều hội thoại chỉ tính một lần, và chỉ được dọn khi mọi hội thoại của nó đều được chọn." },
      ],
    },
    safety: {
      eyebrow: "An toàn",
      title: "An toàn và riêng tư",
      items: [
        { title: "Không đọc tin nhắn", body: "App chỉ đọc thư mục media của Zalo. Không đọc cơ sở dữ liệu tin nhắn, không điều khiển Zalo." },
        { title: "Không gửi gì đi", body: "Không thu thập dữ liệu sử dụng. Kết nối mạng duy nhất là hỏi GitHub xem có bản mới không." },
        { title: "Tài liệu không bao giờ được chọn sẵn", body: "Tài liệu đã dọn có thể không tải lại được từ Zalo, nên bạn phải tự chọn." },
        { title: "Thùng rác trước, xoá sau", body: "Ổ đĩa chỉ trống ra khi bạn bấm Dọn sạch thùng rác, hoặc sau 7 ngày." },
        { title: "Mã nguồn mở", body: "Giấy phép MIT. File cài được build từ mã nguồn công khai bằng GitHub Actions." },
      ],
    },
    install: {
      eyebrow: "Cài đặt",
      title: "Cài trong 3 bước",
      steps: [
        { title: "Tải file cài", body: "Bấm Tải cho Windows để tải file <b>Zola.Cleaner_x.y.z_x64-setup.exe</b>." },
        { title: "Mở file cài", body: "App cài cho người dùng hiện tại, không cần quyền quản trị." },
        {
          title: "Bỏ qua cảnh báo SmartScreen",
          body: "App chưa ký số nên Windows có thể hiện \"Windows protected your PC\". Bấm <b>More info</b>, rồi bấm <b>Run anyway</b>.",
        },
      ],
      smartscreen: { more: "More info", run: "Run anyway", dont: "Don't run", app: "App:", publisher: "Publisher:", unknown: "Unknown publisher" },
      tip: "Trước khi dọn, thoát hẳn Zalo: chuột phải biểu tượng Zalo ở khay hệ thống, chọn <b>Thoát</b>. App sẽ nhắc nếu Zalo còn chạy.",
      update: "App tự báo khi có bản mới. Bấm Cập nhật là tải và cài.",
    },
    faq: {
      eyebrow: "Hỏi đáp",
      title: "Câu hỏi thường gặp",
      items: [
        {
          q: "Dọn rồi có xem lại được ảnh cũ không?",
          a: "Ảnh và video: Zalo thường tự tải lại khi bạn mở hội thoại, miễn là file còn trên máy chủ Zalo. Trong 7 ngày, bạn cũng khôi phục được từ Thùng rác.",
        },
        {
          q: "Vì sao tài liệu không được chọn sẵn?",
          a: "Không có zCloud thì file chỉ nằm trên máy chủ Zalo một số ngày. Tài liệu đã dọn có thể không tải lại được nữa. Để file kịp về máy, bật trong Zalo PC: <b>Cài đặt → Tin nhắn → Cài đặt khác → Tự động tải trước Ảnh/File/Video/Tin nhắn thoại dưới 30MB</b>.",
        },
        {
          q: "Dọn xong sao ổ C chưa trống thêm?",
          a: "File mới được chuyển vào Thùng rác để bạn còn khôi phục được. Ổ đĩa chỉ trống ra khi bạn bấm <b>Dọn sạch thùng rác</b>, hoặc sau 7 ngày. Bạn cũng có thể đặt Thùng rác ở ổ khác trong Cài đặt để ổ C trống ngay.",
        },
        {
          q: "App báo \"Chưa kiểm chứng\" hay \"Không hỗ trợ\" là sao?",
          a: `App chỉ dọn khi hiểu rõ cách Zalo xếp file trên máy bạn. <b>Chưa kiểm chứng</b>: Zalo mới hơn bản ${verified} đã khảo sát, nhưng cấu trúc vẫn khớp nên dọn được, kèm cảnh báo. <b>Không hỗ trợ</b>: cấu trúc khác, app chỉ cho xem. Hãy bấm "Xuất báo cáo cấu trúc" trong app (không chứa tên file hay ID) và gửi kèm một <a href="${ISSUES_URL}">issue</a>.`,
        },
        {
          q: "Có cần thoát Zalo trước khi dọn không?",
          a: "Có. Zalo đang chạy có thể đang ghi file. Chuột phải biểu tượng Zalo ở khay hệ thống, chọn Thoát. App sẽ nhắc nếu Zalo còn chạy.",
        },
        {
          q: "Zalo cất file ở đâu trên máy?",
          a: `Thường ở <b>%APPDATA%\\ZaloData</b>, trong thư mục <b>ZaloDownloads</b> của từng tài khoản. Xem giải thích chi tiết: <a href="${storageDoc("vi")}">Zalo PC lưu file của bạn ở đâu?</a>`,
        },
        {
          q: "Dùng trên Mac được không?",
          a: "Chưa. App hiện chỉ có cho Windows 10/11 64-bit.",
        },
      ],
    },
    footer: {
      tagline: "Dọn media Zalo PC, an toàn và khôi phục được.",
      source: "Mã nguồn",
      issues: "Báo lỗi, góp ý",
      license: "Giấy phép MIT",
      author: "Tác giả",
    },
  };
}

function en(verified: string): Copy {
  return {
    htmlLang: "en",
    title: "Zola Cleaner: clean up Zalo PC data and free up drive C",
    description:
      "Clean up the photos, videos and documents Zalo PC downloads to your computer. Pick by conversation and age, preview every file, restore within 7 days. Free and open source.",
    ogAlt: "Zola Cleaner: get back the tens of GB Zalo takes on drive C",
    nav: { features: "Features", install: "Install", faq: "FAQ", other: "Tiếng Việt", otherLang: "vi" as Lang },
    hero: {
      title: "Zalo is using tens of GB on drive C.",
      accent: "Get it back in minutes.",
      sub: "Clean up the photos, videos and documents Zalo PC downloads, by conversation and by age. Preview every file, restore within 7 days. Free and open source. The app's interface is in Vietnamese.",
      shotAlt: "Quick clean screen: Zalo holds 13.4 GB on drive C; cleaning photos and videos older than 1 year reclaims 5.1 GB",
      demoNote: "Screenshots use made-up demo data.",
    },
    download: {
      label: "Download for Windows",
      fallbackMeta: "Windows 10/11 · 64-bit",
      meta: "{version} · {size} · Windows 10/11",
      source: "Source code on GitHub",
    },
    limits: {
      title: "Requirements and limits",
      items: [
        "Windows 10 or 11, 64-bit.",
        `Zalo PC 26 (data storage format 5.x). <b>Verified</b> up to Zalo PC ${verified}.`,
        "Zalo newer than the verified version: <b>Untested</b>. Cleaning still works, with a warning first.",
        "A Zalo folder layout that differs from the surveyed one: <b>Not supported</b>. The app only shows it and won't clean it.",
        "The app isn't code-signed yet, so Windows asks again the first time you open it (see the install steps).",
      ],
    },
    problem: {
      eyebrow: "Why drive C keeps filling up",
      title: "Zalo won't clean up for you",
      items: [
        { title: "Everything lands on drive C", body: "Zalo PC saves every photo, video and document you receive to drive C. Over time this reaches tens of gigabytes." },
        { title: "No cleaning by conversation or by age", body: "Zalo's built-in cleanup only removes coarse groups. You can't pick an old group chat, or photos from last year." },
        { title: "Deleting a chat keeps its files", body: "Deleting a conversation in Zalo doesn't delete its photos and videos from the disk." },
        {
          title: "Deleting by hand frees no space",
          body: "Each file sits in several folders at once. Deleting it in one place frees nothing, and it's easy to delete thumbnails or data Zalo needs.",
        },
        {
          title: "Files expire on Zalo's servers",
          body: "Without zCloud, files only stay on Zalo's servers for a limited number of days. Zalo's auto-download only takes files under 30 MB, and only while Zalo PC is open.",
        },
      ],
    },
    features: {
      eyebrow: "Features",
      title: "Clean exactly what you want",
      shots: [
        {
          img: "conversations",
          title: "By conversation",
          body: "Pick individual chats or groups. Filter by kind, by when it was sent, by size or by format (ZIP, RAR, PDF…). Give conversations your own names so you can tell them apart.",
          alt: "By conversation screen: conversations with the photos and documents to clean and the space each frees",
        },
        {
          img: "trash",
          title: "7-day trash",
          body: "Cleaned files stay in the app's trash for 7 days and are restored to their original places. To keep them longer, pack them into a ZIP for Drive or USB and import it back later.",
          alt: "Trash screen: cleanup jobs with sizes, auto-delete dates, Restore and Delete permanently buttons",
        },
        {
          img: "overview",
          title: "Overview",
          body: "See what Zalo holds: by kind, by age and by Zalo folder, plus the drive type and its health. The app also finds Zalo data moved to another drive, and several Zalo accounts on the same computer.",
          alt: "Overview screen: space by kind and by age, and drive information",
        },
      ],
      extras: [
        { title: "Quick clean from suggestions", body: "One sentence tells you how much you'd get back, e.g. \"Photos & videos older than 1 year → 5.1 GB\"." },
        { title: "Preview every file", body: "Photos show as a grid and documents with their real names. Untick a file to keep it." },
        { title: "No double counting", body: "A photo in several chats counts once, and is only cleaned when all of its chats are selected." },
      ],
    },
    safety: {
      eyebrow: "Safety",
      title: "Safe and private",
      items: [
        { title: "Doesn't read your messages", body: "The app only reads Zalo's media folder. It doesn't read the message database or control Zalo." },
        { title: "Sends nothing", body: "No usage tracking. The only network connection is asking GitHub whether a new version exists." },
        { title: "Documents are never pre-selected", body: "A cleaned document may not download again from Zalo, so you pick them yourself." },
        { title: "Trash first, delete later", body: "Disk space is only freed when you empty the trash, or after 7 days." },
        { title: "Open source", body: "MIT license. Installers are built from the public source code by GitHub Actions." },
      ],
    },
    install: {
      eyebrow: "Install",
      title: "Install in 3 steps",
      steps: [
        { title: "Download the installer", body: "Click Download for Windows to get <b>Zola.Cleaner_x.y.z_x64-setup.exe</b>." },
        { title: "Run the installer", body: "It installs for the current user and doesn't need admin rights." },
        {
          title: "Get past SmartScreen",
          body: "The app isn't code-signed yet, so Windows may show \"Windows protected your PC\". Click <b>More info</b>, then <b>Run anyway</b>.",
        },
      ],
      smartscreen: { more: "More info", run: "Run anyway", dont: "Don't run", app: "App:", publisher: "Publisher:", unknown: "Unknown publisher" },
      tip: "Before cleaning, quit Zalo completely: right-click the Zalo icon in the system tray and choose <b>Thoát</b> (Quit). The app reminds you if Zalo is still running.",
      update: "The app tells you when a new version is out. Click Cập nhật (Update) to download and install it.",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Frequently asked questions",
      items: [
        {
          q: "Can I still see old photos after cleaning?",
          a: "Photos and videos: Zalo usually downloads them again when you open the chat, as long as they're still on Zalo's servers. For 7 days you can also restore them from the trash.",
        },
        {
          q: "Why aren't documents pre-selected?",
          a: "Without zCloud, files only stay on Zalo's servers for a limited number of days. A cleaned document may not download again. To get files onto your computer in time, turn on in Zalo PC: <b>Settings → Messages → Other settings → Auto-download photos/files/videos/voice messages under 30MB</b>.",
        },
        {
          q: "I cleaned up, so why isn't drive C any freer?",
          a: "Files go to the app's trash first so you can restore them. Space is only freed when you click <b>Dọn sạch thùng rác</b> (Empty trash), or after 7 days. You can also put the trash on another drive in Settings so drive C frees up right away.",
        },
        {
          q: "What do \"Untested\" and \"Not supported\" mean?",
          a: `The app only cleans when it understands how Zalo arranges files on your computer. <b>Untested</b>: Zalo is newer than the surveyed ${verified}, but the layout still matches, so cleaning works with a warning. <b>Not supported</b>: the layout differs, so the app only shows it. Click "Xuất báo cáo cấu trúc" (Export structure report) in the app (it has no file names or IDs) and attach it to an <a href="${ISSUES_URL}">issue</a>.`,
        },
        {
          q: "Do I need to quit Zalo before cleaning?",
          a: "Yes. A running Zalo may be writing files. Right-click the Zalo icon in the system tray and choose Thoát (Quit). The app reminds you if Zalo is still running.",
        },
        {
          q: "Where does Zalo keep files on my computer?",
          a: `Usually in <b>%APPDATA%\\ZaloData</b>, inside each account's <b>ZaloDownloads</b> folder. Full explanation: <a href="${storageDoc("en")}">Where does Zalo PC keep your files?</a>`,
        },
        {
          q: "Does it work on a Mac?",
          a: "Not yet. The app is only available for Windows 10/11 64-bit.",
        },
      ],
    },
    footer: {
      tagline: "Clean up Zalo PC media, safely and reversibly.",
      source: "Source code",
      issues: "Report a bug or suggest a feature",
      license: "MIT license",
      author: "Author",
    },
  };
}
