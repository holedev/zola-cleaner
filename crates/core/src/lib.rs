//! Lõi Zola Cleaner. Thuật ngữ: xem `CONTEXT.md`; cấu trúc dữ liệu Zalo: `docs/zalo-layout.md`.

pub mod archive;
pub mod db;
pub mod detect;
pub mod docnames;
pub mod error;
pub mod filter;
pub mod fsx;
pub mod layout;
pub mod quarantine;
pub mod report;
pub mod safety;
pub mod scan;
pub mod stats;
pub mod suggest;
pub mod thumbs;

pub use error::{Error, Result};

/// Định dạng dung lượng kiểu "1.4 GB" (đơn vị 1024).
pub fn format_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    if u == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[u])
    }
}
