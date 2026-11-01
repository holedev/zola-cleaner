//! Kiến thức về cấu trúc Media Store (ZaloDownloads) của Zalo PC 5.x. Xem docs/zalo-layout.md.
//!
//! ```text
//!   <area>/<tên>                              Link "kho"
//!   picture/<convId | id_group>/<tên>          Link kho của ảnh, đã chia theo hội thoại
//!   resource/<convId>/<area>/<msgTs>_<uidNgườiGửi>_<convId>_...   hardlink theo hội thoại
//!   resource/<convId>/Cache/<msgTs>_<uidTàiKhoản>_<convId>_t|n   Thumbnail (Cache/ cấp kho đặt tên kiểu khác)
//! ```
//! convId của nhóm là `g<id>`.

use std::path::{Path, PathBuf};

/// Thư mục kho mà Media Item trong đó được phép dọn.
pub const CLEANABLE_AREAS: [&str; 4] = ["picture", "video", "fileNoise", "file"];

/// File sổ sách của Zalo trong mỗi thư mục — không phải media, không bao giờ đụng tới.
pub const RESCACHE_NAME: &str = ".rescache";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkInfo {
    /// Thư mục kho: picture | video | fileNoise | file | Cache | richThumb | ...
    pub area: String,
    pub conv_id: Option<String>,
    /// Message Time (epoch ms) nếu tên Link có tiền tố thời gian.
    pub msg_ts: Option<i64>,
}

/// Tiền tố `<13 chữ số>_` của tên Link trong resource/.
fn msg_ts(name: &str) -> Option<i64> {
    let b = name.as_bytes();
    if b.len() > 13 && b[13] == b'_' && b[..13].iter().all(u8::is_ascii_digit) {
        name[..13].parse().ok()
    } else {
        None
    }
}

/// Phân tích đường dẫn tương đối (dấu "/") của một Link trong Media Store.
pub fn parse_link(rel_path: &str) -> LinkInfo {
    let parts: Vec<&str> = rel_path.split('/').collect();
    let name = parts.last().copied().unwrap_or("");
    let msg_ts = msg_ts(name);

    if parts[0] == "resource" && parts.len() >= 4 {
        return LinkInfo {
            area: parts[2].to_owned(),
            conv_id: Some(canonical_conv_id(parts[1])),
            msg_ts,
        };
    }
    if parts[0] == "picture" && parts.len() >= 3 {
        return LinkInfo {
            area: "picture".to_owned(),
            conv_id: Some(canonical_conv_id(parts[1])),
            msg_ts,
        };
    }
    let area = if parts.len() >= 2 { parts[0] } else { "." };
    LinkInfo {
        area: area.to_owned(),
        conv_id: None,
        msg_ts,
    }
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())
}

/// Zalo viết ID nhóm theo hai kiểu: `g<id>` (resource/, tên file) và `<id>_group` (picture/).
/// Quy về một dạng `g<id>` để một nhóm không bị tách thành hai Conversation.
pub fn canonical_conv_id(dir_name: &str) -> String {
    match dir_name.strip_suffix("_group") {
        Some(id) if all_digits(id) => format!("g{id}"),
        _ => dir_name.to_owned(),
    }
}

pub fn is_group_conversation(conv_id: &str) -> bool {
    conv_id.strip_prefix('g').is_some_and(all_digits)
}

/// Tìm các Media Store trên máy: `<appData>\ZaloData\media\<uid>\ZaloDownloads`.
pub fn detect_media_stores(app_data: &Path) -> Vec<PathBuf> {
    let media = app_data.join("ZaloData").join("media");
    let Ok(entries) = std::fs::read_dir(&media) else {
        return Vec::new();
    };
    let mut stores: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| e.file_name().to_str().is_some_and(all_digits))
        .map(|e| e.path().join("ZaloDownloads"))
        .filter(|p| p.is_dir())
        .collect();
    stores.sort();
    stores
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_trong_resource_mang_hoi_thoai_va_message_time() {
        let l = parse_link("resource/g222/video/1600000000003_sender_g222");
        assert_eq!(
            l,
            LinkInfo {
                area: "video".into(),
                conv_id: Some("g222".into()),
                msg_ts: Some(1600000000003)
            }
        );
    }

    #[test]
    fn picture_dang_id_group_quy_ve_g_id() {
        let l = parse_link("picture/222_group/zg_g.jpg");
        assert_eq!(l.area, "picture");
        assert_eq!(l.conv_id.as_deref(), Some("g222"));
        assert_eq!(l.msg_ts, None);
    }

    #[test]
    fn link_kho_khong_co_hoi_thoai() {
        assert_eq!(
            parse_link("fileNoise/abcdef"),
            LinkInfo {
                area: "fileNoise".into(),
                conv_id: None,
                msg_ts: None
            }
        );
        assert_eq!(parse_link("lonely").area, ".");
    }

    #[test]
    fn nhom_va_ca_nhan() {
        assert!(is_group_conversation("g9118536018086435350"));
        assert!(!is_group_conversation("8735000714"));
        assert!(!is_group_conversation("g"));
        assert_eq!(canonical_conv_id("abc_group"), "abc_group");
    }
}
