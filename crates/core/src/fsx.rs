//! Thao tác hệ thống file mà std chưa có trên bản stable: NTFS file id (định danh Media Item).
//!
//! Trên Windows, liệt kê thư mục bằng `FileIdBothDirectoryInfo` trả về file id, kích thước, thời điểm sửa
//! của mọi mục trong **một** lời gọi cho cả thư mục — không phải mở từng file như `stat`.

use std::fs::File;
use std::io;
use std::path::Path;

/// Một mục trong thư mục.
#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    /// Symlink / junction: không đi theo, tránh vòng lặp và tránh ra ngoài Media Store.
    pub is_reparse: bool,
    /// Định danh file vật lý trong volume (các hardlink có cùng id).
    pub file_id: u64,
    pub size: u64,
    pub mtime_ms: i64,
}

/// Định danh Media Item: `<volume serial>:<file id>`, hai Link cùng key ⇔ cùng một file vật lý.
pub fn make_key(volume: u32, file_id: u64) -> String {
    format!("{volume:08x}:{file_id:x}")
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::ERROR_NO_MORE_FILES;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_BOTH_DIR_INFO, FileIdBothDirectoryInfo,
        GetFileInformationByHandle, GetFileInformationByHandleEx,
    };

    /// FILETIME (100 ns kể từ 1601) → epoch ms.
    fn filetime_ms(t: i64) -> i64 {
        t / 10_000 - 11_644_473_600_000
    }

    fn open_any(path: &Path) -> io::Result<File> {
        // BACKUP_SEMANTICS để mở được cả thư mục; chỉ đọc thuộc tính, chia sẻ mọi quyền để không khoá file của Zalo
        std::fs::OpenOptions::new()
            .access_mode(0x80) // FILE_READ_ATTRIBUTES
            .share_mode(0x7) // READ | WRITE | DELETE
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    }

    fn handle_info(f: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(info)
    }

    pub fn file_key(path: &Path) -> io::Result<(String, u32)> {
        let info = handle_info(&open_any(path)?)?;
        let id = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
        Ok((make_key(info.dwVolumeSerialNumber, id), info.nNumberOfLinks))
    }

    pub fn volume_serial(path: &Path) -> io::Result<u32> {
        Ok(handle_info(&open_any(path)?)?.dwVolumeSerialNumber)
    }

    pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
        let h = std::fs::OpenOptions::new()
            .access_mode(0x1) // FILE_LIST_DIRECTORY
            .share_mode(0x7)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(dir)?;
        // Bộ đệm căn lề 8 byte cho FILE_ID_BOTH_DIR_INFO
        let mut buf = vec![0u64; 8 * 1024];
        let mut out = Vec::new();
        loop {
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    h.as_raw_handle() as _,
                    FileIdBothDirectoryInfo,
                    buf.as_mut_ptr().cast(),
                    (buf.len() * 8) as u32,
                )
            };
            if ok == 0 {
                let err = io::Error::last_os_error();
                if err.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                    return Ok(out);
                }
                return Err(err);
            }
            let base = buf.as_ptr().cast::<u8>();
            let mut offset = 0usize;
            loop {
                // SAFETY: Windows ghi chuỗi bản ghi hợp lệ vào buf; NextEntryOffset trỏ tới bản ghi kế (0 = hết)
                let rec = unsafe { &*base.add(offset).cast::<FILE_ID_BOTH_DIR_INFO>() };
                let name_len = rec.FileNameLength as usize / 2;
                let name_ptr = std::ptr::addr_of!(rec.FileName).cast::<u16>();
                let name = unsafe { std::slice::from_raw_parts(name_ptr, name_len) };
                let name = std::ffi::OsString::from_wide(name)
                    .to_string_lossy()
                    .into_owned();
                if name != "." && name != ".." {
                    out.push(Entry {
                        name,
                        is_dir: rec.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                        is_reparse: rec.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
                        file_id: rec.FileId as u64,
                        size: rec.EndOfFile.max(0) as u64,
                        mtime_ms: filetime_ms(rec.LastWriteTime),
                    });
                }
                if rec.NextEntryOffset == 0 {
                    break;
                }
                offset += rec.NextEntryOffset as usize;
            }
        }
    }
}

#[cfg(unix)]
mod imp {
    //! Chỉ để chạy test ngoài Windows; app phát hành chỉ cho Windows.
    use super::*;
    use std::os::unix::fs::MetadataExt;

    pub fn file_key(path: &Path) -> io::Result<(String, u32)> {
        let m = std::fs::metadata(path)?;
        Ok((make_key(m.dev() as u32, m.ino()), m.nlink() as u32))
    }

    pub fn volume_serial(path: &Path) -> io::Result<u32> {
        Ok(std::fs::metadata(path)?.dev() as u32)
    }

    pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            let ft = e.file_type()?;
            let m = std::fs::symlink_metadata(e.path())?;
            out.push(Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: ft.is_dir(),
                is_reparse: ft.is_symlink(),
                file_id: m.ino(),
                size: m.len(),
                mtime_ms: m.mtime() * 1000 + m.mtime_nsec() / 1_000_000,
            });
        }
        Ok(out)
    }
}

/// Dung lượng ổ chứa `path`: (còn trống cho người dùng hiện tại, tổng), byte.
#[cfg(windows)]
pub fn disk_space(path: &Path) -> io::Result<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let (mut free, mut total, mut _all_free) = (0u64, 0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut _all_free) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((free, total))
}

#[cfg(not(windows))]
pub fn disk_space(_path: &Path) -> io::Result<(u64, u64)> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "chỉ hỗ trợ Windows",
    ))
}

/// Key Media Item và số Link (nlink) của một đường dẫn.
pub fn file_key(path: &Path) -> io::Result<(String, u32)> {
    imp::file_key(path)
}

/// Volume serial của ổ chứa `path`.
pub fn volume_serial(path: &Path) -> io::Result<u32> {
    imp::volume_serial(path)
}

/// Liệt kê một thư mục (không đệ quy), kèm file id.
pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>> {
    imp::list_dir(dir)
}

/// Hai đường dẫn có cùng là một file vật lý không.
pub fn same_file(a: &Path, b: &Path) -> io::Result<bool> {
    Ok(file_key(a)?.0 == file_key(b)?.0)
}

/// So sánh nội dung hai file theo từng khối (video có thể lớn, không đọc cả file vào bộ nhớ).
pub fn same_content(a: &Path, b: &Path) -> io::Result<bool> {
    use std::io::Read;
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (File::open(a)?, File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 1 << 20], vec![0u8; 1 << 20]);
    loop {
        let na = read_full(&mut fa, &mut ba)?;
        let nb = read_full(&mut fb, &mut bb)?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }

    fn read_full(f: &mut File, buf: &mut [u8]) -> io::Result<usize> {
        let mut n = 0;
        while n < buf.len() {
            match f.read(&mut buf[n..])? {
                0 => break,
                k => n += k,
            }
        }
        Ok(n)
    }
}

/// Đọc tối đa `n` byte đầu file.
pub fn read_header(path: &Path, n: usize) -> io::Result<Vec<u8>> {
    use std::io::Read;
    let mut buf = Vec::with_capacity(n);
    File::open(path)?.take(n as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Đọc tối đa `n` byte đầu và `n` byte cuối file (trùng nhau nếu file nhỏ).
pub fn read_head_tail(path: &Path, n: usize) -> io::Result<(Vec<u8>, Vec<u8>)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = File::open(path)?;
    let len = f.metadata()?.len();
    let mut head = Vec::with_capacity(n);
    (&mut f).take(n as u64).read_to_end(&mut head)?;
    let start = len.saturating_sub(n as u64);
    f.seek(SeekFrom::Start(start))?;
    let mut tail = Vec::with_capacity(n);
    f.take(n as u64).read_to_end(&mut tail)?;
    Ok((head, tail))
}
