//! Loại và sức khoẻ ổ đĩa vật lý chứa một đường dẫn, theo Windows Storage Management API
//! (WMI `ROOT\Microsoft\Windows\Storage`). Không cần quyền admin; nhiệt độ / hao mòn thì cần nên không đọc.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaType {
    Ssd,
    Hdd,
    Unknown,
}

/// Sức khoẻ ổ theo Windows (HealthStatus).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    Healthy,
    Warning,
    Unhealthy,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveDetail {
    /// Ký tự ổ, ví dụ "C:".
    pub letter: String,
    /// Tên ổ vật lý, ví dụ "Lexar SSD NM620 512GB".
    pub model: Option<String>,
    pub media: MediaType,
    /// Giao tiếp: NVMe, SATA, USB…
    pub bus: Option<String>,
    pub health: Health,
}

/// MSFT_PhysicalDisk.MediaType
pub fn media_type(code: u16) -> MediaType {
    match code {
        3 => MediaType::Hdd,
        4 | 5 => MediaType::Ssd, // 5 = SCM (bộ nhớ lưu trữ lớp), hiển thị như SSD
        _ => MediaType::Unknown,
    }
}

/// MSFT_PhysicalDisk.BusType
pub fn bus_type(code: u16) -> Option<&'static str> {
    Some(match code {
        1 => "SCSI",
        3 => "ATA",
        6 => "Fibre Channel",
        7 => "USB",
        8 => "RAID",
        9 => "iSCSI",
        10 => "SAS",
        11 => "SATA",
        12 => "SD",
        13 => "MMC",
        15 => "File-backed",
        16 => "Storage Spaces",
        17 => "NVMe",
        18 => "SCM",
        19 => "UFS",
        _ => return None,
    })
}

/// MSFT_PhysicalDisk.HealthStatus
pub fn health(code: u16) -> Health {
    match code {
        0 => Health::Healthy,
        1 => Health::Warning,
        2 => Health::Unhealthy,
        _ => Health::Unknown,
    }
}

/// Ký tự ổ (viết hoa) của một đường dẫn kiểu `C:\…`.
fn drive_letter(path: &Path) -> Option<char> {
    let s = path.to_str()?;
    let s = s.strip_prefix(r"\\?\").unwrap_or(s);
    let mut chars = s.chars();
    match (chars.next(), chars.next()) {
        (Some(c), Some(':')) if c.is_ascii_alphabetic() => Some(c.to_ascii_uppercase()),
        _ => None,
    }
}

/// Thông tin ổ vật lý chứa `path`. Không đọc được trường nào thì trường đó là Unknown / None.
pub fn drive_detail(path: &Path) -> DriveDetail {
    let letter = drive_letter(path);
    let mut d = DriveDetail {
        letter: letter.map(|c| format!("{c}:")).unwrap_or_default(),
        model: None,
        media: MediaType::Unknown,
        bus: None,
        health: Health::Unknown,
    };
    if let Some(disk) = letter.and_then(physical_disk) {
        d.model = disk
            .friendly_name
            .map(|n| n.trim().to_owned())
            .filter(|n| !n.is_empty());
        d.media = disk.media_type.map_or(MediaType::Unknown, media_type);
        d.bus = disk.bus_type.and_then(bus_type).map(str::to_owned);
        d.health = disk.health_status.map_or(Health::Unknown, health);
    }
    d
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PhysicalDisk {
    friendly_name: Option<String>,
    media_type: Option<u16>,
    bus_type: Option<u16>,
    health_status: Option<u16>,
}

#[cfg(windows)]
fn physical_disk(letter: char) -> Option<PhysicalDisk> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Partition {
        disk_number: u32,
    }
    let wmi = wmi::WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Storage").ok()?;
    let part: Vec<Partition> = wmi
        .raw_query(format!(
            "SELECT DiskNumber FROM MSFT_Partition WHERE DriveLetter = '{letter}'"
        ))
        .ok()?;
    // Ổ ảo (Storage Spaces, VHD) không khớp ổ vật lý nào → None
    let disks: Vec<PhysicalDisk> = wmi
        .raw_query(format!(
            "SELECT FriendlyName, MediaType, BusType, HealthStatus FROM MSFT_PhysicalDisk WHERE DeviceId = '{}'",
            part.first()?.disk_number
        ))
        .ok()?;
    disks.into_iter().next()
}

#[cfg(not(windows))]
fn physical_disk(_letter: char) -> Option<PhysicalDisk> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ma_so_cua_windows() {
        assert_eq!(media_type(3), MediaType::Hdd);
        assert_eq!(media_type(4), MediaType::Ssd);
        assert_eq!(media_type(0), MediaType::Unknown);
        assert_eq!(bus_type(17), Some("NVMe"));
        assert_eq!(bus_type(11), Some("SATA"));
        assert_eq!(bus_type(7), Some("USB"));
        assert_eq!(bus_type(0), None);
        assert_eq!(bus_type(99), None);
        assert_eq!(health(0), Health::Healthy);
        assert_eq!(health(1), Health::Warning);
        assert_eq!(health(2), Health::Unhealthy);
        assert_eq!(health(5), Health::Unknown);
    }

    #[test]
    fn ky_tu_o_dia() {
        assert_eq!(drive_letter(Path::new(r"c:\Users\x")), Some('C'));
        assert_eq!(drive_letter(Path::new(r"\\?\D:\Zalo Data")), Some('D'));
        assert_eq!(drive_letter(Path::new(r"\\server\share")), None);
        assert_eq!(drive_letter(Path::new("relative")), None);
    }
}
