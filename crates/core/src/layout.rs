//! Kiến thức về cấu trúc Media Store (ZaloDownloads) của Zalo PC 26 (định dạng lưu dữ liệu 5.x,
//! `major_version` trong config.json). Xem docs/zalo-layout.md.
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

/// Người dùng chọn một thư mục bất kỳ trong cây dữ liệu Zalo (`ZaloDownloads`, `<uid>`, `media`, `Zalo Data`, `ZaloData`)
/// → các Media Store tìm thấy bên trong.
pub fn resolve_stores(picked: &Path) -> Vec<PathBuf> {
    if picked.file_name().and_then(|n| n.to_str()) == Some("ZaloDownloads") && picked.is_dir() {
        return vec![picked.to_path_buf()];
    }
    let candidates = [
        picked.join("ZaloDownloads"),              // chọn thư mục <uid>
        picked.to_path_buf(),                      // chọn thư mục media
        picked.join("media"),                      // chọn ZaloData / Zalo Data
        picked.join(MOVED_DATA_DIR).join("media"), // chọn gốc ổ đĩa
    ];
    if candidates[0].is_dir() {
        return vec![candidates[0].clone()];
    }
    detect_media_stores_in(&candidates[1..])
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

/// Kiểm tra Media Store có đúng cấu trúc đã khảo sát (docs/zalo-layout.md) không.
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

    // ZaloData\config.json: định dạng lưu dữ liệu 5.x (major_version = 5, Zalo PC 26), đã chuyển media sang vị trí mới
    match zalo_config(store) {
        None => reasons.push("Không đọc được ZaloData\\config.json".to_owned()),
        Some(cfg) => {
            let major = cfg.get("major_version").and_then(serde_json::Value::as_i64);
            if major != Some(5) {
                reasons.push(format!(
                    "Zalo đang dùng định dạng lưu dữ liệu {}.x, app mới hỗ trợ 5.x (Zalo PC 26)",
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

/// `ZaloData\config.json` của Media Store: nằm cạnh `media\` (mặc định) — hoặc vẫn ở `%APPDATA%\ZaloData`
/// nếu dữ liệu đã chuyển ổ.
pub fn zalo_config(store: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
    store
        .ancestors()
        .nth(3)
        .map(|zalo_data| zalo_data.join("config.json"))
        .into_iter()
        .chain(
            std::env::var_os("APPDATA").map(|a| Path::new(&a).join("ZaloData").join("config.json")),
        )
        .find(|c| c.is_file())
        .and_then(|c| std::fs::read_to_string(c).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
}

/// Version một CSDL của Zalo, theo `db_version` trong config.json. App không đọc các CSDL này; chỉ để hiển thị và báo cáo.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DbVersion {
    pub name: String,
    pub version: i64,
}

/// `db_version` là một chuỗi JSON: `[{"name":"Core","version":12}, …]`.
pub fn db_versions(config: &serde_json::Map<String, serde_json::Value>) -> Vec<DbVersion> {
    config
        .get("db_version")
        .and_then(serde_json::Value::as_str)
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default()
}

/// Zalo Version: phiên bản app Zalo PC, ví dụ 26.10.20.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ZaloVersion(pub [u32; 3]);

impl std::fmt::Display for ZaloVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let [a, b, c] = self.0;
        write!(f, "{a}.{b}.{c}")
    }
}

impl serde::Serialize for ZaloVersion {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl std::str::FromStr for ZaloVersion {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, ()> {
        let mut parts = s.split('.').map(|p| {
            if all_digits(p) {
                p.parse::<u32>().map_err(|_| ())
            } else {
                Err(())
            }
        });
        let v = [
            parts.next().ok_or(())??,
            parts.next().ok_or(())??,
            parts.next().ok_or(())??,
        ];
        if parts.next().is_some() {
            return Err(());
        }
        Ok(Self(v))
    }
}

/// Verified Version: Zalo Version mới nhất đã khảo sát (docs/zalo-layout.md). Khảo sát bản mới → sửa ở đây rồi phát hành.
pub const VERIFIED_VERSION: ZaloVersion = ZaloVersion([26, 10, 20]);

/// Zalo Version trong thư mục cài đặt: Zalo giữ mỗi bản một thư mục `Zalo-<ver>` (không xoá bản cũ) → lấy bản cao nhất.
pub fn zalo_version_in(install_dir: &Path) -> Option<ZaloVersion> {
    std::fs::read_dir(install_dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().to_str()?.strip_prefix("Zalo-")?.parse().ok())
        .max()
}

/// Zalo Version đang cài trên máy (`%LOCALAPPDATA%\Programs\Zalo`), nếu đọc được.
pub fn zalo_version() -> Option<ZaloVersion> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    zalo_version_in(&Path::new(&local).join("Programs").join("Zalo"))
}

/// Compatibility của một Media Store: Supported Layout là cổng chặn, Zalo Version chỉ là tín hiệu thêm.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Compatibility {
    /// Đã kiểm chứng: dọn bình thường.
    Verified,
    /// Chưa kiểm chứng: cấu trúc vẫn khớp nên dọn được, kèm cảnh báo.
    Untested {
        reason: UntestedReason,
        verified: ZaloVersion,
    },
    /// Không hỗ trợ: chỉ xem.
    Unsupported { advice: Advice },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UntestedReason {
    /// Zalo Version ngoài khoảng đã kiểm chứng: mới hơn Verified Version, hoặc khác số đầu.
    Unverified,
    /// Không đọc được Zalo Version.
    Unknown,
}

/// Lời khuyên khi Media Store không có Supported Layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Advice {
    /// Zalo cũ hơn bản đã kiểm chứng, hoặc chưa chuyển xong media → cập nhật / mở Zalo PC.
    UpdateZalo,
    /// Zalo mới hơn bản đã kiểm chứng → chờ bản Zola Cleaner mới hoặc gửi Structure Report.
    UpdateApp,
    /// Không rõ vì sao → gửi Structure Report.
    Report,
}

/// Kết luận Compatibility từ kết quả kiểm tra cấu trúc và Zalo Version.
/// `migrate_done`: `migrate_full_done` trong config.json (Zalo đã chuyển xong media sang vị trí mới).
pub fn compatibility(
    layout: &LayoutCheck,
    version: Option<ZaloVersion>,
    migrate_done: bool,
) -> Compatibility {
    let verified = |v: ZaloVersion| v.0[0] == VERIFIED_VERSION.0[0] && v <= VERIFIED_VERSION;
    if layout.is_supported() {
        return match version {
            Some(v) if verified(v) => Compatibility::Verified,
            Some(_) => Compatibility::Untested {
                reason: UntestedReason::Unverified,
                verified: VERIFIED_VERSION,
            },
            None => Compatibility::Untested {
                reason: UntestedReason::Unknown,
                verified: VERIFIED_VERSION,
            },
        };
    }
    let advice = match version {
        _ if !migrate_done => Advice::UpdateZalo,
        Some(v) if v < VERIFIED_VERSION => Advice::UpdateZalo,
        Some(v) if !verified(v) => Advice::UpdateApp,
        _ => Advice::Report,
    };
    Compatibility::Unsupported { advice }
}

/// Compatibility của một Media Store trên máy này.
pub fn check_compatibility(store: &Path, layout: &LayoutCheck) -> Compatibility {
    let migrate_done = zalo_config(store)
        .and_then(|c| c.get("migrate_full_done")?.as_bool())
        .unwrap_or(false);
    compatibility(layout, zalo_version(), migrate_done)
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

    fn v(s: &str) -> ZaloVersion {
        s.parse().unwrap()
    }

    #[test]
    fn zalo_version_so_sanh_theo_so() {
        assert!(v("26.9.10") < v("26.10.11"));
        assert_eq!(v("26.10.20").to_string(), "26.10.20");
        for bad in ["26.10", "26.10.20.1", "26.x.1", "", "26..1"] {
            assert!(bad.parse::<ZaloVersion>().is_err(), "{bad}");
        }
    }

    #[test]
    fn compatibility_theo_cau_truc_va_version() {
        use Compatibility::*;
        let ok = LayoutCheck::Supported;
        let bad = LayoutCheck::Unsupported { reasons: vec![] };
        let untested = |reason| Untested {
            reason,
            verified: VERIFIED_VERSION,
        };

        assert_eq!(compatibility(&ok, Some(VERIFIED_VERSION), true), Verified);
        assert_eq!(compatibility(&ok, Some(v("26.9.10")), true), Verified);
        assert_eq!(
            compatibility(&ok, Some(v("26.10.21")), true),
            untested(UntestedReason::Unverified)
        );
        assert_eq!(
            compatibility(&ok, Some(v("27.1.1")), true),
            untested(UntestedReason::Unverified)
        );
        assert_eq!(
            compatibility(&ok, Some(v("25.12.1")), true),
            untested(UntestedReason::Unverified)
        );
        assert_eq!(
            compatibility(&ok, None, true),
            untested(UntestedReason::Unknown)
        );

        let advice = |version, migrate_done| match compatibility(&bad, version, migrate_done) {
            Unsupported { advice } => advice,
            c => panic!("phải là Unsupported: {c:?}"),
        };
        assert_eq!(advice(Some(v("26.9.10")), true), Advice::UpdateZalo);
        assert_eq!(advice(Some(v("27.1.1")), false), Advice::UpdateZalo);
        assert_eq!(advice(Some(v("27.1.1")), true), Advice::UpdateApp);
        assert_eq!(advice(Some(VERIFIED_VERSION), true), Advice::Report);
        assert_eq!(advice(None, true), Advice::Report);
    }

    #[test]
    fn db_version_la_chuoi_json() {
        let cfg: serde_json::Map<String, serde_json::Value> = serde_json::from_str(
            r#"{"db_version":"[{\"name\":\"Core\",\"version\":12},{\"name\":\"Media\",\"version\":2}]"}"#,
        )
        .unwrap();
        assert_eq!(
            db_versions(&cfg),
            vec![
                DbVersion {
                    name: "Core".into(),
                    version: 12
                },
                DbVersion {
                    name: "Media".into(),
                    version: 2
                }
            ]
        );
        assert!(db_versions(&serde_json::Map::new()).is_empty());
    }
}
