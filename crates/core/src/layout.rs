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

/// Thư mục Zalo tạo khi người dùng chuyển "Vị trí lưu trữ" sang ổ khác: `<ổ>\Zalo Data\media\<uid>\ZaloDownloads`
/// (Zalo chỉ cho chuyển sang ổ khác ổ mặc định; config.json vẫn ở `%APPDATA%\ZaloData`).
pub const MOVED_DATA_DIR: &str = "Zalo Data";

/// Các thư mục `media` có thể chứa Media Store: mặc định `<appData>\ZaloData\media`, và `<ổ>\Zalo Data\media` trên các ổ.
pub fn media_dirs(app_data: &Path, drives: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = vec![app_data.join("ZaloData").join("media")];
    dirs.extend(drives.iter().map(|d| d.join(MOVED_DATA_DIR).join("media")));
    dirs.retain(|d| d.is_dir());
    dirs
}

/// uid (thư mục toàn chữ số) trong một thư mục.
fn uids_in(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .filter(|n| all_digits(n))
        .collect()
}

/// Media Store trong các thư mục `media` cho trước.
pub fn detect_media_stores_in(media_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut stores: Vec<PathBuf> = media_dirs
        .iter()
        .flat_map(|m| {
            uids_in(m)
                .into_iter()
                .map(move |uid| m.join(uid).join("ZaloDownloads"))
        })
        .filter(|p| p.is_dir())
        .collect();
    stores.sort();
    stores.dedup();
    stores
}

/// Tìm mọi Media Store trên máy, kể cả khi người dùng đã chuyển dữ liệu Zalo sang ổ khác.
pub fn detect_media_stores(app_data: &Path) -> Vec<PathBuf> {
    detect_media_stores_in(&media_dirs(app_data, &crate::fsx::drives()))
}

/// Một Account Zalo đã từng đăng nhập trên máy.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub uid: String,
    /// Media Store của Account, nếu Zalo đã tạo (`media\<uid>\ZaloDownloads`, ở ổ mặc định hoặc ổ đã chuyển sang).
    pub store: Option<PathBuf>,
}

/// Mọi Account trên máy: có thư mục media và / hoặc CSDL (`Database\_production\<uid>`).
pub fn detect_accounts(app_data: &Path) -> Vec<AccountInfo> {
    detect_accounts_in(app_data, &media_dirs(app_data, &crate::fsx::drives()))
}

pub fn detect_accounts_in(app_data: &Path, media_dirs: &[PathBuf]) -> Vec<AccountInfo> {
    let mut uids: Vec<String> = media_dirs.iter().flat_map(|m| uids_in(m)).collect();
    uids.extend(uids_in(
        &app_data
            .join("ZaloData")
            .join("Database")
            .join("_production"),
    ));
    uids.sort();
    uids.dedup();
    uids.into_iter()
        .map(|uid| {
            let store = media_dirs
                .iter()
                .map(|m| m.join(&uid).join("ZaloDownloads"))
                .find(|s| s.is_dir());
            AccountInfo { store, uid }
        })
        .collect()
}

/// uid của Account sở hữu Media Store (`media\<uid>\ZaloDownloads`), nếu đúng cấu trúc.
pub fn account_uid(store: &Path) -> Option<String> {
    let uid = store.parent()?.file_name()?.to_str()?;
    all_digits(uid).then(|| uid.to_owned())
}

/// Media Store có Supported Layout không. Không → chỉ được xem, không được dọn.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum LayoutCheck {
    Supported,
    Unsupported { reasons: Vec<String> },
}

impl LayoutCheck {
    pub fn is_supported(&self) -> bool {
        matches!(self, Self::Supported)
    }
}

/// Số file mẫu trong `picture/` dùng để kiểm tra Zalo có tạo hardlink trong `resource/` không.
const SAMPLE_FILES: usize = 40;

/// Kiểm tra Media Store có đúng cấu trúc Zalo 5.x đã khảo sát (docs/zalo-layout.md) không.
pub fn check_layout(store: &Path) -> LayoutCheck {
    let mut reasons = Vec::new();
    if account_uid(store).is_none()
        || store.file_name().and_then(|n| n.to_str()) != Some("ZaloDownloads")
    {
        reasons.push("Thư mục không có dạng ...\\media\\<uid>\\ZaloDownloads".to_owned());
    }
    for dir in ["picture", "resource"] {
        if !store.join(dir).is_dir() {
            reasons.push(format!("Thiếu thư mục {dir}\\"));
        }
    }

    // ZaloData\config.json: Zalo 5.x, đã chuyển media sang vị trí mới
    // ZaloData\config.json nằm cạnh media\ (mặc định) — hoặc vẫn ở %APPDATA%\ZaloData nếu dữ liệu đã chuyển ổ
    let config = store
        .ancestors()
        .nth(3)
        .map(|zalo_data| zalo_data.join("config.json"))
        .into_iter()
        .chain(
            std::env::var_os("APPDATA").map(|a| Path::new(&a).join("ZaloData").join("config.json")),
        )
        .find(|c| c.is_file());
    match config
        .and_then(|c| std::fs::read_to_string(c).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    {
        None => reasons.push("Không đọc được ZaloData\\config.json".to_owned()),
        Some(cfg) => {
            let major = cfg.get("major_version").and_then(serde_json::Value::as_i64);
            if major != Some(5) {
                reasons.push(format!(
                    "Zalo phiên bản chính {} (mới hỗ trợ 5)",
                    major.map_or("?".into(), |m| m.to_string())
                ));
            }
            if cfg
                .get("migrate_full_done")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            {
                reasons.push("Zalo chưa chuyển xong media sang vị trí mới".to_owned());
            }
        }
    }

    // Phải thấy ít nhất một ảnh trong picture/ có hardlink (nlink ≥ 2) — đó là cách app gắn ảnh với hội thoại
    if store.join("picture").is_dir() {
        let linked = sample_files(&store.join("picture"), SAMPLE_FILES)
            .iter()
            .any(|f| crate::fsx::file_key(f).is_ok_and(|(_, n)| n >= 2));
        if !linked {
            reasons.push("Không thấy hardlink giữa picture\\ và resource\\".to_owned());
        }
    }

    if reasons.is_empty() {
        LayoutCheck::Supported
    } else {
        LayoutCheck::Unsupported { reasons }
    }
}

/// Tối đa `n` file (không phải `.rescache`) trong các thư mục con cấp 1 của `dir`.
fn sample_files(dir: &Path, n: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(subdirs) = std::fs::read_dir(dir) else {
        return out;
    };
    for sub in subdirs
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
    {
        let Ok(files) = std::fs::read_dir(sub.path()) else {
            continue;
        };
        for f in files.flatten() {
            if f.file_name() != RESCACHE_NAME && f.file_type().is_ok_and(|t| t.is_file()) {
                out.push(f.path());
                if out.len() >= n {
                    return out;
                }
            }
        }
    }
    out
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
