//! Tên dễ hiểu cho tài liệu. Zalo lưu tài liệu dưới tên mã (không đuôi); tên gốc chỉ có trong CSDL đã mã hoá.
//! Lấy lại một phần, theo thứ tự tin cậy:
//! 1. **Bản người dùng đã "Lưu về máy"** (Downloads, Zalo Received Files…): cùng nội dung → đúng tên thật.
//! 2. **Tiêu đề ghi bên trong file**: PDF (`/Title`, XMP `dc:title`), Office (`docProps/core.xml`).

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::Serialize;

use crate::db::{Db, now_ms};
use crate::detect::{NOISE_PREFIX, NOISE_TRAILER, unnoise_prefix};
use crate::error::Result;

/// Đọc một file trong Media Store như nội dung gốc: fileNoise/ → giải XOR phần đầu, bỏ đuôi Zalo gắn thêm.
pub struct ZaloFile {
    f: File,
    len: u64,
    pos: u64,
    noise: bool,
}

impl ZaloFile {
    pub fn open(path: &Path, noise: bool) -> io::Result<Self> {
        let mut f = File::open(path)?;
        let mut len = f.metadata()?.len();
        if noise && len >= NOISE_TRAILER.len() as u64 {
            let mut tail = vec![0u8; NOISE_TRAILER.len()];
            f.seek(SeekFrom::Start(len - NOISE_TRAILER.len() as u64))?;
            f.read_exact(&mut tail)?;
            if tail == NOISE_TRAILER {
                len -= NOISE_TRAILER.len() as u64;
            }
            f.seek(SeekFrom::Start(0))?;
        }
        Ok(Self {
            f,
            len,
            pos: 0,
            noise,
        })
    }

    /// Kích thước nội dung gốc (không tính đuôi Zalo).
    pub fn len(&self) -> u64 {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Đọc đoạn `[start, start + n)` (cắt bớt nếu quá cuối file).
    pub fn read_range(&mut self, start: u64, n: usize) -> io::Result<Vec<u8>> {
        self.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::with_capacity(n);
        self.take(n as u64).read_to_end(&mut buf)?;
        Ok(buf)
    }
}

impl Read for ZaloFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.len.saturating_sub(self.pos);
        if left == 0 {
            return Ok(0);
        }
        let want = buf.len().min(left as usize);
        let n = self.f.read(&mut buf[..want])?;
        if self.noise && (self.pos as usize) < NOISE_PREFIX {
            unnoise_prefix(&mut buf[..n], self.pos as usize);
        }
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for ZaloFile {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::End(d) => self.len as i128 + d as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
        };
        if target < 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "seek trước đầu file",
            ));
        }
        self.pos = target as u64;
        self.f.seek(SeekFrom::Start(self.pos))?;
        Ok(self.pos)
    }
}

// --- Tiêu đề trong file ---

/// Số byte đọc ở đầu và cuối PDF khi tìm tiêu đề (Info / XMP thường nằm ở hai đầu).
const PDF_PROBE: usize = 1 << 20;

/// Tiêu đề ghi bên trong tài liệu, đã lọc tiêu đề vô nghĩa.
pub fn title_in_file(file: &mut ZaloFile, kind: &str) -> Option<String> {
    let raw = match kind {
        "pdf" => pdf_title(file),
        "docx" | "xlsx" | "pptx" | "office" => office_title(file),
        _ => None,
    }?;
    clean_title(&raw)
}

fn pdf_title(file: &mut ZaloFile) -> Option<String> {
    let len = file.len();
    let mut text = file.read_range(0, PDF_PROBE).ok()?;
    if len > PDF_PROBE as u64 {
        text.extend(
            file.read_range(len.saturating_sub(PDF_PROBE as u64), PDF_PROBE)
                .ok()?,
        );
    }
    xmp_title(&text).or_else(|| info_title(&text))
}

/// `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">…</rdf:li>` (UTF-8).
fn xmp_title(t: &[u8]) -> Option<String> {
    let at = find(t, b"<dc:title")?;
    // Chỉ tìm trong phạm vi thẻ dc:title — dc:title rỗng thì không được lấy nhầm rdf:li của thẻ sau
    let end = at + find(&t[at..], b"</dc:title>")?;
    let title = &t[at..end];
    let li = find(title, b"<rdf:li")?;
    let open = li + find(&title[li..], b">")? + 1;
    let close = open + find(&title[open..], b"</rdf:li>")?;
    Some(xml_unescape(&String::from_utf8_lossy(&title[open..close])))
}

/// `/Title (chuỗi)` hoặc `/Title <hex>` trong từ điển Info.
fn info_title(t: &[u8]) -> Option<String> {
    let mut from = 0;
    while let Some(i) = find(&t[from..], b"/Title") {
        let mut p = from + i + 6;
        while p < t.len() && t[p].is_ascii_whitespace() {
            p += 1;
        }
        let bytes = match t.get(p) {
            Some(b'(') => pdf_literal(&t[p + 1..]),
            Some(b'<') if t.get(p + 1) != Some(&b'<') => pdf_hex(&t[p + 1..]),
            _ => None,
        };
        if let Some(s) = bytes.map(|b| pdf_text(&b)).filter(|s| !s.trim().is_empty()) {
            return Some(s);
        }
        from = p.max(from + i + 1);
    }
    None
}

/// Chuỗi PDF dạng `( … )`: có thoát `\`, ngoặc lồng nhau.
fn pdf_literal(t: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut i = 0;
    while i < t.len() && i < 4096 {
        match t[i] {
            b'\\' => {
                i += 1;
                match *t.get(i)? {
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'b' => out.push(8),
                    b'f' => out.push(12),
                    d @ b'0'..=b'7' => {
                        let mut v = u32::from(d - b'0');
                        for _ in 0..2 {
                            match t.get(i + 1) {
                                Some(&c @ b'0'..=b'7') => {
                                    v = v * 8 + u32::from(c - b'0');
                                    i += 1;
                                }
                                _ => break,
                            }
                        }
                        out.push(v as u8);
                    }
                    b'\r' | b'\n' => {}
                    c => out.push(c),
                }
            }
            b'(' => {
                depth += 1;
                out.push(b'(');
            }
            b')' if depth == 0 => return Some(out),
            b')' => {
                depth -= 1;
                out.push(b')');
            }
            c => out.push(c),
        }
        i += 1;
    }
    None
}

fn pdf_hex(t: &[u8]) -> Option<Vec<u8>> {
    let end = find(t, b">")?;
    let hex: Vec<u8> = t[..end]
        .iter()
        .copied()
        .filter(u8::is_ascii_hexdigit)
        .collect();
    let mut out = Vec::with_capacity(hex.len() / 2);
    for pair in hex.chunks(2) {
        let s = std::str::from_utf8(pair).ok()?;
        out.push(u8::from_str_radix(&format!("{s:0<2}"), 16).ok()?);
    }
    Some(out)
}

/// Chuỗi văn bản PDF: UTF-16BE (có BOM FE FF), UTF-8 (BOM EF BB BF), hoặc PDFDocEncoding (≈ Latin-1).
fn pdf_text(b: &[u8]) -> String {
    if let Some(rest) = b.strip_prefix(&[0xfe, 0xff]) {
        let (pairs, _) = rest.as_chunks::<2>();
        let units: Vec<u16> = pairs.iter().map(|c| u16::from_be_bytes(*c)).collect();
        return String::from_utf16_lossy(&units);
    }
    if let Some(rest) = b.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    match std::str::from_utf8(b) {
        Ok(s) => s.to_owned(),
        Err(_) => b.iter().map(|&c| c as char).collect(),
    }
}

/// `docProps/core.xml` → `<dc:title>…</dc:title>`.
fn office_title(file: &mut ZaloFile) -> Option<String> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut zip = zip::ZipArchive::new(&mut *file).ok()?;
    let mut core = zip.by_name("docProps/core.xml").ok()?;
    let mut xml = String::new();
    (&mut core).take(256 * 1024).read_to_string(&mut xml).ok()?;
    let open = xml.find("<dc:title")?;
    let start = open + xml[open..].find('>')? + 1;
    let end = start + xml[start..].find("</dc:title>")?;
    Some(xml_unescape(&xml[start..end]))
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Bỏ tiêu đề vô nghĩa ("Document1", "Untitled"…), tách "Microsoft Word - X.docx" → "X.docx".
pub fn clean_title(raw: &str) -> Option<String> {
    let mut t: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_owned();
    for prefix in [
        "Microsoft Word - ",
        "Microsoft PowerPoint - ",
        "Microsoft Excel - ",
    ] {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.trim().to_owned();
        }
    }
    // Tiêu đề là đường dẫn file ("F:\DU LIEU\2026\Hợp đồng.pdf") → chỉ giữ tên file
    if let Some(name) = t.rsplit(['\\', '/']).next()
        && name.len() < t.len()
    {
        t = name.trim().to_owned();
    }
    let lower = t.to_lowercase();
    let generic = [
        "untitled",
        "document",
        "presentation",
        "powerpoint presentation",
        "title",
        "tiêu đề",
        "slide 1",
        "book",
        "sheet",
        "print",
        "pdf",
        "microsoft word",
        "word document",
        "new document",
        "untitled document",
        "untitled spreadsheet",
        "untitled presentation",
    ];
    let numbered = [
        "document",
        "doc",
        "book",
        "sheet",
        "presentation",
        "untitled",
    ]
    .iter()
    .any(|w| {
        lower
            .strip_prefix(w)
            .is_some_and(|rest| rest.trim().chars().all(|c| c.is_ascii_digit()))
    });
    let markup = t.contains('<') || t.contains('>');
    if t.chars().count() < 3
        || generic.contains(&lower.as_str())
        || numbered
        || markup
        || lower.starts_with("~$")
    {
        return None;
    }
    Some(t.chars().take(150).collect())
}

// --- Đối chiếu bản đã lưu về máy ---

/// Độ sâu tối đa khi duyệt thư mục người dùng lưu file.
const SAVED_MAX_DEPTH: usize = 4;
/// Giới hạn số file duyệt (thư mục Downloads có thể rất lớn).
const SAVED_MAX_FILES: usize = 200_000;
/// So toàn bộ nội dung nếu nhỏ hơn mức này; lớn hơn thì so đầu / giữa / cuối.
const FULL_COMPARE: u64 = 32 << 20;

/// Kích thước → các file trong những thư mục người dùng hay lưu file từ Zalo.
pub fn index_saved_files(dirs: &[PathBuf]) -> HashMap<u64, Vec<PathBuf>> {
    let mut index: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut seen = 0usize;
    let mut stack: Vec<(PathBuf, usize)> = dirs
        .iter()
        .filter(|d| d.is_dir())
        .map(|d| (d.clone(), 0))
        .collect();
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if depth < SAVED_MAX_DEPTH && !e.file_name().to_string_lossy().starts_with('.') {
                    stack.push((e.path(), depth + 1));
                }
            } else if ft.is_file()
                && let Ok(m) = e.metadata()
            {
                index.entry(m.len()).or_default().push(e.path());
                seen += 1;
                if seen >= SAVED_MAX_FILES {
                    return index;
                }
            }
        }
    }
    index
}

/// File `saved` có cùng nội dung với tài liệu `doc` (đọc như nội dung gốc) không.
fn same_as_saved(doc: &mut ZaloFile, saved: &Path) -> io::Result<bool> {
    let mut other = ZaloFile::open(saved, false)?;
    if other.len() != doc.len() {
        return Ok(false);
    }
    let len = doc.len();
    let ranges: Vec<(u64, usize)> = if len <= FULL_COMPARE {
        vec![(0, len as usize)]
    } else {
        let chunk = 1 << 20;
        vec![(0, chunk), (len / 2, chunk), (len - chunk as u64, chunk)]
    };
    for (start, n) in ranges {
        if doc.read_range(start, n)? != other.read_range(start, n)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameResult {
    pub checked: i64,
    /// Lấy được tên thật từ bản đã lưu.
    pub from_saved: i64,
    /// Lấy được tiêu đề trong file.
    pub from_title: i64,
}

/// Tìm tên cho mọi tài liệu chưa được kiểm tra của một Media Store. Kết quả lưu ở bảng `doc_names`.
pub fn resolve_doc_names(db: &Db, root_id: i64, saved_dirs: &[PathBuf]) -> Result<NameResult> {
    let root: String = db.query_row("SELECT path FROM roots WHERE id = ?", [root_id], |r| {
        r.get(0)
    })?;
    let todo: Vec<(i64, String, String, Option<String>)> = {
        let mut q = db.prepare(
            "SELECT i.id, i.kind, i.area,
               (SELECT rel_path FROM links WHERE item_id = i.id ORDER BY rel_path LIKE 'resource/%', rel_path LIMIT 1)
             FROM items i
             WHERE i.root_id = ? AND i.status = 'present' AND i.category IN ('document', 'archive')
               AND NOT EXISTS (SELECT 1 FROM doc_names d WHERE d.item_id = i.id)",
        )?;
        q.query_map([root_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    let mut result = NameResult::default();
    if todo.is_empty() {
        return Ok(result);
    }
    let saved = index_saved_files(saved_dirs);
    let mut insert = db.prepare(
        "INSERT INTO doc_names (item_id, name, source, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (item_id) DO UPDATE SET name = excluded.name, source = excluded.source, checked_at = excluded.checked_at",
    )?;
    let now = now_ms();
    for (id, kind, area, rel) in todo {
        let Some(rel) = rel else { continue };
        let path = rel
            .split('/')
            .fold(PathBuf::from(&root), |p, part| p.join(part));
        let Ok(mut doc) = ZaloFile::open(&path, area == "fileNoise") else {
            continue;
        };
        let saved_name = saved.get(&doc.len()).and_then(|cands| {
            cands
                .iter()
                .find(|c| same_as_saved(&mut doc, c).unwrap_or(false))
                .and_then(|c| c.file_name().map(|n| n.to_string_lossy().into_owned()))
        });
        let (name, source) = match saved_name {
            Some(n) => {
                result.from_saved += 1;
                (Some(n), Some("saved"))
            }
            None => match title_in_file(&mut doc, &kind) {
                Some(t) => {
                    result.from_title += 1;
                    (Some(t), Some("title"))
                }
                None => (None, None),
            },
        };
        insert.execute(params![id, name, source, now])?;
        result.checked += 1;
    }
    Ok(result)
}

/// Xoá kết quả cũ để lần sau tìm lại (ví dụ sau khi đổi danh sách thư mục đã lưu).
pub fn reset_doc_names(db: &Db, root_id: i64) -> Result<()> {
    db.execute(
        "DELETE FROM doc_names WHERE item_id IN (SELECT id FROM items WHERE root_id = ?)",
        [root_id],
    )?;
    Ok(())
}

/// Thư mục mặc định nơi người dùng thường lưu file từ Zalo: Downloads, Documents\Zalo Received Files, `<ổ>:\Zalo`.
pub fn default_saved_dirs(home: &Path, drives: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join("Downloads"),
        home.join("Documents").join("Zalo Received Files"),
    ];
    dirs.extend(drives.iter().map(|d| d.join("Zalo")));
    dirs.retain(|d| d.is_dir());
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tieu_de_pdf() {
        let t = b"%PDF-1.4\n1 0 obj<</Title (B\\341o c\\341o qu\\375 3) /Author (A)>>";
        assert_eq!(info_title(t).as_deref(), Some("Báo cáo quý 3"));
        // UTF-16BE trong chuỗi hex
        let mut hex = String::from("<</Title <FEFF");
        for u in "Hợp đồng".encode_utf16() {
            hex.push_str(&format!("{u:04X}"));
        }
        hex.push_str(">>>");
        assert_eq!(info_title(hex.as_bytes()).as_deref(), Some("Hợp đồng"));
        let xmp = "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">Kế hoạch &amp; ngân sách</rdf:li></rdf:Alt></dc:title>";
        assert_eq!(
            xmp_title(xmp.as_bytes()).as_deref(),
            Some("Kế hoạch & ngân sách")
        );
        // dc:title rỗng → không lấy rdf:li của dc:description phía sau
        let empty = "<dc:title><rdf:Alt>
</rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li>Mô tả</rdf:li></rdf:Alt></dc:description>";
        assert_eq!(xmp_title(empty.as_bytes()), None);
    }

    #[test]
    fn loc_tieu_de_vo_nghia() {
        assert_eq!(
            clean_title(r"F:\DU LIEU\2026\2-Truong Dai Hoc.pdf").as_deref(),
            Some("2-Truong Dai Hoc.pdf")
        );
        assert_eq!(clean_title("C:/temp/").as_deref(), None);
        assert_eq!(
            clean_title("Microsoft Word - Báo cáo tháng 9.docx").as_deref(),
            Some("Báo cáo tháng 9.docx")
        );
        for junk in [
            "Document1",
            "Untitled",
            "PowerPoint Presentation",
            "  ",
            "ab",
            "Book 2",
            "Print",
            "Untitled Spreadsheet",
            "</rdf:Alt> </dc:title>",
        ] {
            assert_eq!(clean_title(junk), None, "{junk}");
        }
    }
}
