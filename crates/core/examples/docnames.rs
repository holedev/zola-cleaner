//! Tìm tên tài liệu trên CSDL thật: cargo run --release --example docnames -- <file.db>
use std::path::PathBuf;
use std::time::Instant;

fn main() -> zc_core::Result<()> {
    let file = std::env::args().nth(1).expect("đường dẫn CSDL");
    let db = zc_core::db::open_db(file.as_ref())?;
    let root = zc_core::db::list_roots(&db)?[0].id;
    let home = PathBuf::from(std::env::var("USERPROFILE").unwrap());
    let dirs = zc_core::docnames::default_saved_dirs(&home, &zc_core::fsx::drives());
    println!("Thư mục đối chiếu: {}", dirs.len());
    let t = Instant::now();
    let r = zc_core::docnames::resolve_doc_names(&db, root, &dirs)?;
    println!(
        "{} tài liệu · bản đã lưu {} · tiêu đề {} · {:.1} s",
        r.checked,
        r.from_saved,
        r.from_title,
        t.elapsed().as_secs_f64()
    );
    Ok(())
}
