//! CLI khảo sát: quét một Media Store và in báo cáo (chỉ đọc, không xoá gì).
//!   zc scan                         (tự tìm %APPDATA%\ZaloData\media\<uid>\ZaloDownloads)
//!   zc scan "<ZaloDownloads>" --db data/zc.db

use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use zc_core::db::{add_root, open_db};
use zc_core::filter::CleanupFilter;
use zc_core::format_bytes;
use zc_core::layout::detect_media_stores;
use zc_core::scan::{ScanOptions, ScanProgress, scan};
use zc_core::stats::{Bucket, get_stats, list_conversations};

fn usage() -> ! {
    eprintln!("Cách dùng: zc scan [\"<ZaloDownloads>\"] [--db <file.db>]");
    std::process::exit(1)
}

fn table(title: &str, rows: &[Bucket]) {
    println!("\n== {title} ==");
    for r in rows {
        println!(
            "  {:<24} {:>8} file  {:>10}",
            r.key,
            r.count,
            format_bytes(r.bytes as u64)
        );
    }
}

fn main() -> zc_core::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("scan") {
        usage();
    }
    let mut db_file = PathBuf::from("data/zc.db");
    let mut dir: Option<PathBuf> = None;
    let mut it = args[1..].iter();
    while let Some(a) = it.next() {
        if a == "--db" {
            db_file = it.next().map(PathBuf::from).unwrap_or_else(|| usage());
        } else {
            dir = Some(PathBuf::from(a));
        }
    }
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    let Some(dir) =
        dir.or_else(|| app_data.and_then(|a| detect_media_stores(&a).into_iter().next()))
    else {
        usage()
    };

    let db = open_db(&db_file)?;
    let root = add_root(&db, &dir, None)?;
    println!("Quét: {}\nCSDL: {}\n", root.path, db_file.display());

    let started = Instant::now();
    let progress = |p: &ScanProgress| {
        eprint!(
            "\r  {:?}: {} link · {} · mới {} · đổi {} · đã đọc {} · lỗi {}   ",
            p.phase,
            p.seen,
            format_bytes(p.bytes),
            p.new_files,
            p.changed,
            p.read,
            p.errors
        );
        let _ = std::io::stderr().flush();
    };
    let result = scan(
        &db,
        root.id,
        &ScanOptions {
            on_progress: Some(&progress),
            cancel: None,
        },
    )?;
    eprintln!();
    println!("Xong sau {:.2} giây.", started.elapsed().as_secs_f64());

    let s = get_stats(&db, root.id, 10)?;
    println!(
        "\nTổng: {} Media Item, {} (lỗi: {})",
        s.total.count,
        format_bytes(s.total.bytes as u64),
        result.errors
    );
    table("Theo loại", &s.by_category);
    table("Theo thư mục kho", &s.by_area);
    table("Theo tuổi (thời điểm tin nhắn)", &s.by_age);

    let convs = list_conversations(
        &db,
        &CleanupFilter {
            root_id: root.id,
            ..Default::default()
        },
        0,
    )?;
    println!("\n== Hội thoại ({}) — 20 lớn nhất ==", convs.len());
    for c in convs.iter().take(20) {
        println!(
            "  {:<24} {:>6} file  tổng {:>10}  riêng {:>10}  dọn được (ảnh+video) {:>10}",
            c.conv_id,
            c.items,
            format_bytes(c.bytes as u64),
            format_bytes(c.own_bytes as u64),
            format_bytes(c.cleanable_bytes as u64)
        );
    }
    Ok(())
}
