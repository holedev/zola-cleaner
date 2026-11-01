//! Structure Report: hình dạng một Media Store để người dùng gửi cho nhà phát triển khi gặp layout chưa hỗ trợ.
//! Không chứa tên file, ID hay nội dung: mọi dãy số / hex được thay bằng ký hiệu, tên file chỉ còn "mẫu tên".

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::fsx;
use crate::layout::{LayoutCheck, check_layout};

/// Độ sâu thư mục tối đa đưa vào báo cáo (tính từ ZaloDownloads).
const MAX_DEPTH: usize = 3;
/// Số file tối đa mỗi thư mục được mở để đếm nlink.
const NLINK_SAMPLE: usize = 50;
/// Số mẫu tên giữ lại mỗi thư mục.
const TOP_PATTERNS: usize = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureReport {
    pub layout: LayoutCheck,
    /// Vài khoá không nhạy cảm trong ZaloData\config.json.
    pub zalo_config: BTreeMap<String, serde_json::Value>,
    pub tree: DirNode,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirNode {
    /// Tên đã ẩn danh: `<id>`, `g<id>`, `<id>_group`, hoặc tên thư mục cố định của Zalo (picture, video…).
    pub name: String,
    /// Số thư mục con cùng tên ẩn danh được gộp vào node này.
    pub merged: u64,
    pub files: u64,
    pub bytes: u64,
    /// Đuôi file (viết thường) → số file.
    pub extensions: BTreeMap<String, u64>,
    /// nlink → số file (lấy mẫu).
    pub nlink: BTreeMap<u32, u64>,
    /// Mẫu tên file phổ biến nhất, ví dụ `<n13>_<n>_g<n>_<hex32>.jxl`.
    pub name_patterns: Vec<(String, u64)>,
    pub children: Vec<DirNode>,
}

/// Thay mọi dãy chữ số bằng `<nK>` (K = độ dài nếu ≥ 10, không thì `<n>`) và dãy hex ≥ 16 ký tự bằng `<hexK>`.
pub fn anonymize(name: &str) -> String {
    let b = name.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        let hex_end = (i..b.len())
            .find(|&j| !b[j].is_ascii_hexdigit())
            .unwrap_or(b.len());
        // Dãy hex phải có chữ a–f, không thì là dãy số (ID 19 chữ số cũng toàn ký tự hex)
        if hex_end - i >= 16 && b[i..hex_end].iter().any(u8::is_ascii_alphabetic) {
            out.push_str(&format!("<hex{}>", hex_end - i));
            i = hex_end;
            continue;
        }
        if b[i].is_ascii_digit() {
            let end = (i..b.len())
                .find(|&j| !b[j].is_ascii_digit())
                .unwrap_or(b.len());
            let n = end - i;
            out.push_str(&if n >= 10 {
                format!("<n{n}>")
            } else {
                "<n>".to_owned()
            });
            i = end;
            continue;
        }
        // Giữ ký tự an toàn (chữ, dấu nối); ký tự khác (có dấu, khoảng trắng…) → '?'
        let ch = name[i..].chars().next().unwrap();
        out.push(if ch.is_ascii_alphanumeric() || "._-".contains(ch) {
            ch
        } else {
            '?'
        });
        i += ch.len_utf8();
    }
    out
}

fn build(dir: &Path, name: String, depth: usize) -> DirNode {
    let mut node = DirNode {
        name,
        merged: 1,
        ..Default::default()
    };
    let Ok(entries) = fsx::list_dir(dir) else {
        return node;
    };
    let mut patterns: BTreeMap<String, u64> = BTreeMap::new();
    let mut sampled = 0;
    let mut children: BTreeMap<String, DirNode> = BTreeMap::new();
    for e in entries {
        if e.is_reparse {
            continue;
        }
        let path = dir.join(&e.name);
        if e.is_dir {
            let child = build(&path, anonymize(&e.name), depth + 1);
            let slot = children
                .entry(child.name.clone())
                .or_insert_with(|| DirNode {
                    name: child.name.clone(),
                    merged: 0,
                    ..Default::default()
                });
            merge(slot, child, depth + 1 >= MAX_DEPTH);
            continue;
        }
        node.files += 1;
        node.bytes += e.size;
        let ext = Path::new(&e.name)
            .extension()
            .map(|x| x.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        *node.extensions.entry(ext).or_default() += 1;
        *patterns.entry(anonymize(&e.name)).or_default() += 1;
        if sampled < NLINK_SAMPLE {
            sampled += 1;
            if let Ok((_, n)) = fsx::file_key(&path) {
                *node.nlink.entry(n).or_default() += 1;
            }
        }
    }
    let mut patterns: Vec<(String, u64)> = patterns.into_iter().collect();
    patterns.sort_by_key(|p| std::cmp::Reverse(p.1));
    patterns.truncate(TOP_PATTERNS);
    node.name_patterns = patterns;
    node.children = children.into_values().collect();
    node
}

/// Gộp `child` vào `slot` (các thư mục cùng tên ẩn danh, ví dụ mọi `<n19>` trong resource/). Quá sâu → bỏ con.
fn merge(slot: &mut DirNode, child: DirNode, flatten: bool) {
    slot.merged += 1;
    slot.files += child.files;
    slot.bytes += child.bytes;
    for (k, v) in child.extensions {
        *slot.extensions.entry(k).or_default() += v;
    }
    for (k, v) in child.nlink {
        *slot.nlink.entry(k).or_default() += v;
    }
    let mut pats: BTreeMap<String, u64> = slot.name_patterns.drain(..).collect();
    for (k, v) in child.name_patterns {
        *pats.entry(k).or_default() += v;
    }
    let mut pats: Vec<_> = pats.into_iter().collect();
    pats.sort_by_key(|p| std::cmp::Reverse(p.1));
    pats.truncate(TOP_PATTERNS);
    slot.name_patterns = pats;
    if flatten {
        for c in child.children {
            slot.files += c.files;
            slot.bytes += c.bytes;
        }
    } else {
        for c in child.children {
            match slot.children.iter_mut().find(|x| x.name == c.name) {
                Some(existing) => merge(existing, c, false),
                None => slot.children.push(c),
            }
        }
    }
}

/// Lập Structure Report cho một Media Store. Chỉ đọc.
pub fn structure_report(store: &Path) -> StructureReport {
    const SAFE_KEYS: [&str; 4] = [
        "major_version",
        "migrate_full_done",
        "db_version",
        "current_bu_ver",
    ];
    let zalo_config = store
        .ancestors()
        .nth(3)
        .and_then(|z| std::fs::read_to_string(z.join("config.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&s).ok())
        .map(|m| {
            m.into_iter()
                .filter(|(k, _)| SAFE_KEYS.contains(&k.as_str()))
                .collect()
        })
        .unwrap_or_default();
    StructureReport {
        layout: check_layout(store),
        zalo_config,
        tree: build(store, "ZaloDownloads".into(), 0),
    }
}

#[cfg(test)]
mod tests {
    use super::anonymize;

    #[test]
    fn an_danh_ten_file() {
        assert_eq!(
            anonymize(
                "1761444265166_96907541858280938_g9876055223380920618_0123456789abcdef0123456789abcdef.jxl"
            ),
            "<n13>_<n17>_g<n19>_<hex32>.jxl"
        );
        assert_eq!(anonymize("9876055223380920618_group"), "<n19>_group");
        assert_eq!(
            anonymize("z7156140507732_acadbd2d.jxl"),
            "z<n13>_acadbd<n>d.jxl"
        );
        assert_eq!(anonymize("Ảnh của tôi.png"), "?nh?c?a?t?i.png");
        assert_eq!(anonymize("picture"), "picture");
    }
}
