//! Nhận diện loại file dựa vào nội dung (magic bytes), không dựa vào tên.
//! Zalo đổi tên file thành chuỗi băm và thường bỏ đuôi file, nên đây là cách duy nhất đáng tin.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Category {
    Image,
    Video,
    Audio,
    Document,
    Archive,
    /// CSDL — KHÔNG BAO GIỜ được xoá.
    Database,
    Other,
}

impl Category {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Document => "document",
            Self::Archive => "archive",
            Self::Database => "database",
            Self::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "image" => Self::Image,
            "video" => Self::Video,
            "audio" => Self::Audio,
            "document" => Self::Document,
            "archive" => Self::Archive,
            "database" => Self::Database,
            "other" => Self::Other,
            _ => return None,
        })
    }
}

impl fmt::Display for Category {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Detection {
    pub category: Category,
    /// Định dạng cụ thể: jpg, png, mp4, heic, sqlite... ("" nếu không rõ)
    pub kind: String,
}

impl Detection {
    fn new(category: Category, kind: &str) -> Self {
        Self {
            category,
            kind: kind.to_owned(),
        }
    }
}

/// Số byte đầu file cần đọc để nhận diện.
pub const HEADER_BYTES: usize = 64;

/// Khoá XOR Zalo dùng để "làm nhiễu" tài liệu trong thư mục fileNoise/.
pub const NOISE_KEY: u8 = 0x93;

/// Zalo chỉ XOR [`NOISE_PREFIX`] byte đầu của file trong fileNoise/; phần sau giữ nguyên.
pub const NOISE_PREFIX: usize = 100;

/// Đuôi Zalo gắn thêm vào cuối file trong fileNoise/ — không thuộc nội dung tài liệu.
pub const NOISE_TRAILER: &[u8] = b"\x07zAlO\x07";

const HEIF_BRANDS: [&[u8]; 8] = [
    b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1", b"avif", b"avis",
];
const AUDIO_FTYP_BRANDS: [&[u8]; 3] = [b"M4A ", b"M4B ", b"M4P "];

/// Đoạn `h[start..end]`, cắt bớt nếu header ngắn hơn.
fn at(h: &[u8], start: usize, end: usize) -> &[u8] {
    let end = end.min(h.len());
    if start >= end { &[] } else { &h[start..end] }
}

fn has(h: &[u8], offset: usize, bytes: &[u8]) -> bool {
    h.len() >= offset + bytes.len() && &h[offset..offset + bytes.len()] == bytes
}

/// * `header` — các byte đầu file (nên có ít nhất [`HEADER_BYTES`] byte nếu file đủ dài)
/// * `ext` — đuôi file viết thường kèm dấu chấm (".bmp"), dùng làm gợi ý cho định dạng có chữ ký yếu
pub fn detect(h: &[u8], ext: &str) -> Detection {
    use Category::*;
    let d = Detection::new;

    // Ảnh
    if has(h, 0, &[0xff, 0xd8, 0xff]) {
        return d(Image, "jpg");
    }
    if has(h, 0, &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return d(Image, "png");
    }
    if has(h, 0, b"GIF8") {
        return d(Image, "gif");
    }
    if has(h, 0, b"RIFF") && has(h, 8, b"WEBP") {
        return d(Image, "webp");
    }
    // JPEG XL: codestream trần (FF 0A) hoặc container ISO BMFF có hộp "JXL "
    if has(h, 0, &[0xff, 0x0a])
        || has(
            h,
            0,
            &[
                0, 0, 0, 0x0c, b'J', b'X', b'L', b' ', 0x0d, 0x0a, 0x87, 0x0a,
            ],
        )
    {
        return d(Image, "jxl");
    }
    // "BM" chỉ có 2 byte, rất dễ trùng → cần thêm 4 byte reserved = 0 hoặc đuôi .bmp
    if has(h, 0, b"BM") && (ext == ".bmp" || has(h, 6, &[0, 0, 0, 0])) {
        return d(Image, "bmp");
    }

    // Họ ISO BMFF (MP4, MOV, HEIC, M4A...): byte 4–8 là "ftyp", byte 8–12 là brand
    if has(h, 4, b"ftyp") {
        let brand = at(h, 8, 12);
        if HEIF_BRANDS.contains(&brand) {
            return d(
                Image,
                if brand.starts_with(b"av") {
                    "avif"
                } else {
                    "heic"
                },
            );
        }
        if AUDIO_FTYP_BRANDS.contains(&brand) {
            return d(Audio, "m4a");
        }
        if brand == b"qt  " {
            return d(Video, "mov");
        }
        if brand.starts_with(b"3g") {
            return d(Video, "3gp");
        }
        return d(Video, "mp4");
    }

    // Video khác
    if has(h, 0, &[0x1a, 0x45, 0xdf, 0xa3]) {
        return d(Video, "mkv");
    }
    if has(h, 0, b"RIFF") && has(h, 8, b"AVI ") {
        return d(Video, "avi");
    }
    if has(h, 0, b"FLV") {
        return d(Video, "flv");
    }

    // Âm thanh (tin nhắn thoại...)
    if has(h, 0, b"#!AMR\n") {
        return d(Audio, "amr");
    }
    if has(h, 0, b"OggS") {
        return d(Audio, "ogg");
    }
    if has(h, 0, b"RIFF") && has(h, 8, b"WAVE") {
        return d(Audio, "wav");
    }
    if has(h, 0, b"ID3") {
        return d(Audio, "mp3");
    }
    if h.len() >= 2 && h[0] == 0xff && h[1] & 0xf6 == 0xf0 {
        return d(Audio, "aac");
    }
    if h.len() >= 2 && h[0] == 0xff && h[1] & 0xe0 == 0xe0 {
        return d(Audio, "mp3");
    }

    if has(h, 0, b"SQLite format 3\0") {
        return d(Database, "sqlite");
    }

    // Tài liệu & nén
    if has(h, 0, b"%PDF-") {
        return d(Document, "pdf");
    }
    if has(h, 0, &[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
        return d(Document, "ole");
    }
    if has(h, 0, &[b'P', b'K', 0x03, 0x04]) {
        match ext {
            ".docx" => return d(Document, "docx"),
            ".xlsx" => return d(Document, "xlsx"),
            ".pptx" => return d(Document, "pptx"),
            _ => {}
        }
        // Tên mục đầu tiên trong ZIP nằm ở byte 30 của local file header → nhận ra Office Open XML khi không có đuôi
        let first = at(h, 30, 30 + 19);
        if first.starts_with(b"word/") {
            return d(Document, "docx");
        }
        if first.starts_with(b"xl/") {
            return d(Document, "xlsx");
        }
        if first.starts_with(b"ppt/") {
            return d(Document, "pptx");
        }
        if first == b"[Content_Types].xml" {
            return d(Document, "office");
        }
        return d(Archive, "zip");
    }
    if has(h, 0, b"Rar!") {
        return d(Archive, "rar");
    }
    if has(h, 0, &[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
        return d(Archive, "7z");
    }

    // Không có chữ ký nhị phân: tài liệu văn bản (Markdown, JSON, XML, CSV…) gửi qua chat
    if let Some(kind) = text_kind(h) {
        return d(Document, kind);
    }

    d(Other, ext.strip_prefix('.').unwrap_or(ext))
}

/// Header là văn bản UTF-8 (cho phép BOM, cho phép ký tự cuối bị cắt dở) → đoán định dạng văn bản.
fn text_kind(h: &[u8]) -> Option<&'static str> {
    let h = h.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(h);
    let text = match std::str::from_utf8(h) {
        Ok(t) => t,
        // Header cắt ngang một ký tự nhiều byte ở cuối → vẫn là văn bản
        Err(e) if e.error_len().is_none() => std::str::from_utf8(&h[..e.valid_up_to()]).ok()?,
        Err(_) => return None,
    };
    if text.chars().count() < 4
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\x0c'))
    {
        return None;
    }
    let t = text.trim_start();
    let lower = t.get(..t.len().min(16)).unwrap_or(t).to_ascii_lowercase();
    let first_line = t.lines().next().unwrap_or("");
    Some(if t.starts_with("<mxfile") {
        "drawio"
    } else if lower.starts_with("<?xml") {
        "xml"
    } else if lower.starts_with("<!doctype html") || lower.starts_with("<html") {
        "html"
    } else if t.starts_with('{') || t.starts_with('[') {
        "json"
    } else if t.starts_with("---") || t.starts_with("# ") {
        "md"
    } else if t.starts_with("sep=") || first_line.matches(',').count() >= 2 {
        "csv"
    } else {
        "txt"
    })
}

/// Nhận diện file trong fileNoise/: giải XOR phần đầu với [`NOISE_KEY`] rồi nhận diện như thường.
pub fn detect_noise(header: &[u8], ext: &str) -> Detection {
    let mut plain = header.to_vec();
    unnoise_prefix(&mut plain, 0);
    detect(&plain, ext)
}

/// Giải XOR tại chỗ một đoạn bắt đầu ở vị trí `offset` của file fileNoise/ (chỉ phần nằm trong [`NOISE_PREFIX`]).
pub fn unnoise_prefix(buf: &mut [u8], offset: usize) {
    let end = NOISE_PREFIX.saturating_sub(offset).min(buf.len());
    buf[..end].iter_mut().for_each(|b| *b ^= NOISE_KEY);
}

/// Loại cụ thể của file Office / ZIP, dựa vào tên các mục ZIP (thư mục trung tâm nằm ở cuối file)
/// hoặc tên stream của file Office đời cũ (OLE). `head` / `tail` là phần đầu / cuối file đã giải mã.
pub fn refine_container(kind: &str, head: &[u8], tail: &[u8]) -> Option<&'static str> {
    let has = |hay: &[u8], needle: &[u8]| hay.windows(needle.len()).any(|w| w == needle);
    let utf16 = |s: &str| s.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<u8>>();
    match kind {
        "zip" | "office" | "docx" | "xlsx" | "pptx" => {
            for (needle, k) in [(&b"word/"[..], "docx"), (b"xl/", "xlsx"), (b"ppt/", "pptx")] {
                if has(tail, needle) || has(head, needle) {
                    return Some(k);
                }
            }
            None
        }
        "ole" => {
            for (name, k) in [("WordDocument", "doc"), ("Workbook", "xls"), ("PowerPoint Document", "ppt")] {
                let n = utf16(name);
                if has(head, &n) || has(tail, &n) {
                    return Some(k);
                }
            }
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::Category::*;
    use super::*;

    fn bytes(parts: &[&[u8]]) -> Vec<u8> {
        parts.concat()
    }

    fn det(h: &[u8]) -> (Category, String) {
        let d = detect(h, "");
        (d.category, d.kind)
    }

    #[test]
    fn anh_pho_bien() {
        assert_eq!(det(&[0xff, 0xd8, 0xff, 0xe0]), (Image, "jpg".into()));
        assert_eq!(
            det(&bytes(&[&[0x89], b"PNG", &[0x0d, 0x0a, 0x1a, 0x0a]])),
            (Image, "png".into())
        );
        assert_eq!(det(b"GIF89a"), (Image, "gif".into()));
        assert_eq!(
            det(&bytes(&[b"RIFF", &[0; 4], b"WEBPVP8 "])),
            (Image, "webp".into())
        );
        assert_eq!(
            det(&bytes(&[&[0, 0, 0, 0x18], b"ftypheic"])),
            (Image, "heic".into())
        );
    }

    #[test]
    fn video_va_am_thanh() {
        assert_eq!(
            det(&bytes(&[&[0, 0, 0, 0x20], b"ftypisom"])),
            (Video, "mp4".into())
        );
        assert_eq!(
            det(&bytes(&[&[0, 0, 0, 0x14], b"ftypqt  "])),
            (Video, "mov".into())
        );
        assert_eq!(
            det(&bytes(&[&[0, 0, 0, 0x20], b"ftypM4A "])),
            (Audio, "m4a".into())
        );
        assert_eq!(det(b"#!AMR\n"), (Audio, "amr".into()));
    }

    #[test]
    fn csdl_khong_bi_nham_thanh_media() {
        assert_eq!(det(b"SQLite format 3\0"), (Database, "sqlite".into()));
    }

    #[test]
    fn bmp_can_them_bang_chung() {
        assert_eq!(
            detect(&bytes(&[b"BMxx", &[1, 1, 1, 1]]), "").category,
            Other
        );
        assert_eq!(
            detect(&bytes(&[b"BMxxxx", &[0, 0, 0, 0]]), "").category,
            Image
        );
        assert_eq!(
            detect(&bytes(&[b"BMxx", &[1, 1, 1, 1]]), ".bmp").category,
            Image
        );
    }

    #[test]
    fn jpeg_xl() {
        assert_eq!(det(&[0xff, 0x0a, 0xba, 0x54]), (Image, "jxl".into()));
        assert_eq!(
            det(&bytes(&[
                &[0, 0, 0, 0x0c],
                b"JXL ",
                &[0x0d, 0x0a, 0x87, 0x0a]
            ])),
            (Image, "jxl".into())
        );
    }

    #[test]
    fn zip_khong_duoi_nhan_ra_office_qua_ten_muc_dau() {
        let zip = |name: &str| bytes(&[b"PK", &[3, 4], &[b'x'; 26], name.as_bytes()]);
        assert_eq!(
            det(&zip("[Content_Types].xml")),
            (Document, "office".into())
        );
        assert_eq!(det(&zip("word/document.xml")), (Document, "docx".into()));
        assert_eq!(det(&zip("photos/a.jpg")), (Archive, "zip".into()));
    }

    #[test]
    fn file_noise_giai_xor_roi_nhan_dien() {
        // header thật quan sát được trong ZaloDownloads/fileNoise
        assert_eq!(
            detect_noise(&[0xb6, 0xc3, 0xd7, 0xd5, 0xbe], ""),
            Detection::new(Document, "pdf")
        );
        assert_eq!(
            detect_noise(&[0xc3, 0xd8, 0x90, 0x97], ""),
            Detection::new(Archive, "zip")
        );
        assert_eq!(
            detect_noise(&[0xc3, 0xd8, 0x90, 0x97], ".docx"),
            Detection::new(Document, "docx")
        );
    }

    #[test]
    fn khong_ro_thanh_other_giu_duoi_file() {
        assert_eq!(
            detect(&[0x00, 0x01, 0x02, 0x03, 0xfe], ".bin"),
            Detection::new(Other, "bin")
        );
        assert_eq!(detect(&[], ""), Detection::new(Other, ""));
    }

    #[test]
    fn van_ban_la_tai_lieu() {
        let k = |s: &[u8]| detect(s, "").kind;
        assert_eq!(detect(b"---\ntitle: Ghi chu", "").category, Document);
        assert_eq!(k(b"---\ntitle: Ghi chu"), "md");
        assert_eq!(k(b"{\n  \"name\": 1"), "json");
        assert_eq!(k(b"<?xml version=\"1.0\"?>"), "xml");
        assert_eq!(k(b"<!DOCTYPE html><html>"), "html");
        assert_eq!(k(b"<mxfile host=\"app\">"), "drawio");
        assert_eq!(k(b"Order,PID,Qty\r\n1,2,3"), "csv");
        assert_eq!(k("Chào bạn, đây là ghi chú".as_bytes()), "txt");
        // BOM + chữ có dấu bị cắt ngang ở cuối header vẫn là văn bản
        let mut cut = vec![0xef, 0xbb, 0xbf];
        cut.extend_from_slice("Tiếng Việt".as_bytes());
        cut.extend_from_slice(&"ệ".as_bytes()[..2]);
        assert_eq!(k(&cut), "txt");
        // fileNoise: văn bản bị XOR
        let noisy: Vec<u8> = b"dev tunnel\n".iter().map(|b| b ^ NOISE_KEY).collect();
        assert_eq!(detect_noise(&noisy, ""), Detection::new(Document, "txt"));
    }
}
