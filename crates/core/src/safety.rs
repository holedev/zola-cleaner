//! Các ràng buộc an toàn: loại nào được chọn, loại nào không bao giờ bị xoá, Zalo có đang chạy không.

use serde::Serialize;

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

/// Các tiến trình `Zalo.exe` trên máy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZaloProcesses {
    /// Zalo đang chạy thật (tiến trình chính, kể cả khi chỉ còn ở khay hệ thống).
    pub main: bool,
    /// Tiến trình con của Zalo (renderer, GPU…) còn sót lại sau khi Zalo chính đã thoát. Rỗng khi `main`.
    pub stuck: Vec<u32>,
}

impl ZaloProcesses {
    /// Còn bất kỳ tiến trình Zalo nào — tiến trình treo vẫn có thể giữ file, nên vẫn chặn dọn.
    pub fn any(&self) -> bool {
        self.main || !self.stuck.is_empty()
    }
}

/// Tiến trình con của Electron luôn có `--type=` trong dòng lệnh; tiến trình chính thì không.
/// Không đọc được dòng lệnh (`None`) → coi là tiến trình chính, cho an toàn.
fn is_child(cmdline: Option<&str>) -> bool {
    cmdline.is_some_and(|c| c.contains(" --type="))
}

/// Phân loại các tiến trình `Zalo.exe` (pid, dòng lệnh).
pub fn classify(procs: &[(u32, Option<String>)]) -> ZaloProcesses {
    let main = procs.iter().any(|(_, c)| !is_child(c.as_deref()));
    ZaloProcesses {
        main,
        stuck: if main {
            vec![]
        } else {
            procs.iter().map(|(pid, _)| *pid).collect()
        },
    }
}

pub fn is_zalo_running() -> bool {
    zalo_processes().any()
}

#[cfg(windows)]
pub fn zalo_processes() -> ZaloProcesses {
    classify(
        &win::zalo_pids()
            .into_iter()
            .map(|pid| (pid, win::command_line(pid)))
            .collect::<Vec<_>>(),
    )
}

#[cfg(not(windows))]
pub fn zalo_processes() -> ZaloProcesses {
    ZaloProcesses::default()
}

/// Kết thúc các tiến trình Zalo bị treo. Chỉ khi người dùng bấm, và chỉ khi Zalo chính KHÔNG chạy:
/// không bao giờ đụng tới Zalo đang chạy thật. Trả về số tiến trình đã kết thúc.
#[cfg(windows)]
pub fn end_stuck_zalo() -> usize {
    let found = zalo_processes();
    if found.main {
        return 0;
    }
    found
        .stuck
        .into_iter()
        .filter(|&pid| win::terminate_child(pid))
        .count()
}

#[cfg(not(windows))]
pub fn end_stuck_zalo() -> usize {
    0
}

#[cfg(windows)]
mod win {
    use windows_sys::Wdk::System::Threading::{
        NtQueryInformationProcess, ProcessCommandLineInformation,
    };
    use windows_sys::Win32::Foundation::{
        CloseHandle, HANDLE, INVALID_HANDLE_VALUE, UNICODE_STRING,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
    };

    pub fn zalo_pids() -> Vec<u32> {
        let mut pids = vec![];
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return pids;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut entry) != 0;
            while ok {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                if String::from_utf16_lossy(&entry.szExeFile[..len])
                    .eq_ignore_ascii_case("Zalo.exe")
                {
                    pids.push(entry.th32ProcessID);
                }
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
        }
        pids
    }

    /// Dòng lệnh của một tiến trình đã mở (cần quyền PROCESS_QUERY_LIMITED_INFORMATION).
    fn read_command_line(h: HANDLE) -> Option<String> {
        unsafe {
            let mut need = 0u32;
            NtQueryInformationProcess(
                h,
                ProcessCommandLineInformation,
                std::ptr::null_mut(),
                0,
                &mut need,
            );
            if need == 0 {
                return None;
            }
            // Bộ đệm căn 8 byte: đầu bộ đệm là UNICODE_STRING trỏ vào phần còn lại
            let mut buf = vec![0u64; (need as usize).div_ceil(8)];
            let status = NtQueryInformationProcess(
                h,
                ProcessCommandLineInformation,
                buf.as_mut_ptr().cast(),
                need,
                &mut need,
            );
            if status < 0 {
                return None;
            }
            let us = &*(buf.as_ptr() as *const UNICODE_STRING);
            if us.Buffer.is_null() {
                return None;
            }
            let chars = std::slice::from_raw_parts(us.Buffer, us.Length as usize / 2);
            Some(String::from_utf16_lossy(chars))
        }
    }

    pub fn command_line(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let c = read_command_line(h);
            CloseHandle(h);
            c
        }
    }

    /// Kết thúc tiến trình, sau khi kiểm tra lại đúng là tiến trình con của Zalo (pid có thể đã bị dùng lại).
    pub fn terminate_child(pid: u32) -> bool {
        unsafe {
            let h = OpenProcess(
                PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if h.is_null() {
                return false;
            }
            let c = read_command_line(h);
            let is_zalo_child = c.as_deref().is_some_and(|c| {
                super::is_child(Some(c)) && c.to_ascii_lowercase().contains("\\zalo.exe")
            });
            let ok = is_zalo_child && TerminateProcess(h, 1) != 0;
            CloseHandle(h);
            ok
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chi_con_tien_trinh_con_la_treo() {
        let main = (1, Some(r#""C:\Zalo\Zalo.exe""#.to_owned()));
        let child = (
            2,
            Some(r#""C:\Zalo\Zalo.exe" --type=renderer --user-data-dir=x"#.to_owned()),
        );
        let unknown = (3, None);

        let running = classify(&[main.clone(), child.clone()]);
        assert_eq!(
            running,
            ZaloProcesses {
                main: true,
                stuck: vec![]
            }
        );

        let stuck = classify(std::slice::from_ref(&child));
        assert_eq!(
            stuck,
            ZaloProcesses {
                main: false,
                stuck: vec![2]
            }
        );
        assert!(stuck.any());

        // Không đọc được dòng lệnh → coi như Zalo đang chạy thật, không bao giờ cho kết thúc
        assert!(classify(&[child, unknown]).main);
        assert!(!classify(&[]).any());
    }
}
