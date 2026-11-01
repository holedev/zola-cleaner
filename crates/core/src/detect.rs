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

    d(Other, ext.strip_prefix('.').unwrap_or(ext))
}

/// Nhận diện file trong fileNoise/: giải XOR từng byte với [`NOISE_KEY`] rồi nhận diện như thường.
pub fn detect_noise(header: &[u8], ext: &str) -> Detection {
    let plain: Vec<u8> = header.iter().map(|b| b ^ NOISE_KEY).collect();
    detect(&plain, ext)
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
        assert_eq!(detect(b"hello world", ".txt"), Detection::new(Other, "txt"));
        assert_eq!(detect(&[], ""), Detection::new(Other, ""));
    }
}
