use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] io::Error),
    /// Lỗi nghiệp vụ, thông điệp hiển thị thẳng cho người dùng.
    #[error("{0}")]
    Msg(String),
    #[error("Zalo đang chạy — hãy thoát hẳn Zalo (cả biểu tượng ở khay hệ thống) rồi thử lại.")]
    ZaloRunning,
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// `bail!("…")` → `return Err(Error::Msg(…))`.
#[macro_export]
macro_rules! bail {
    ($($arg:tt)*) => { return Err($crate::error::Error::Msg(format!($($arg)*))) };
}
