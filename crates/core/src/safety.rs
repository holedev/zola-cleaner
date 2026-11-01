//! Các ràng buộc an toàn: loại nào được chọn, loại nào không bao giờ bị xoá, Zalo có đang chạy không.

use crate::detect::Category;

/// Media Kind được chọn sẵn khi dọn.
pub const DEFAULT_DELETABLE: [Category; 2] = [Category::Image, Category::Video];

/// Media Kind người dùng được phép chọn.
pub const SELECTABLE: [Category; 6] = [
    Category::Image,
    Category::Video,
    Category::Audio,
    Category::Document,
    Category::Archive,
    Category::Other,
];

/// Không bao giờ được xoá, kể cả khi người dùng chọn.
pub const PROTECTED: [Category; 1] = [Category::Database];

pub fn is_selectable(category: &str) -> bool {
    Category::parse(category).is_some_and(|c| SELECTABLE.contains(&c))
}

/// Có tiến trình `Zalo.exe` nào đang chạy không (kể cả khi Zalo chỉ còn ở khay hệ thống).
#[cfg(windows)]
pub fn is_zalo_running() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if name.eq_ignore_ascii_case("Zalo.exe") {
                found = true;
                break;
            }
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
        found
    }
}

#[cfg(not(windows))]
pub fn is_zalo_running() -> bool {
    false
}
