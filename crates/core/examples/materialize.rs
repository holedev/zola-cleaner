//! Tạo bản mở được của một Media Item: cargo run --example materialize -- <file.db> <itemId> <thư mục ra>
fn main() -> zc_core::Result<()> {
    let a: Vec<String> = std::env::args().collect();
    let db = zc_core::db::open_db(a[1].as_ref())?;
    let out = zc_core::thumbs::materialize(&db, a[2].parse().unwrap(), a[3].as_ref())?;
    println!("{}", out.display());
    Ok(())
}
