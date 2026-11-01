//! Tổng "Dọn được" theo từng mốc tuổi trên CSDL thật: cargo run --release --example age_filter -- <file.db>
use zc_core::db::{list_roots, open_db};
use zc_core::filter::CleanupFilter;
use zc_core::format_bytes;
use zc_core::stats::list_conversations;

fn main() -> zc_core::Result<()> {
    let file = std::env::args().nth(1).expect("đường dẫn CSDL");
    let db = open_db(file.as_ref())?;
    let root_id = list_roots(&db)?[0].id;
    for days in [0, 30, 90, 180, 365, 730] {
        let f = CleanupFilter {
            root_id,
            older_than_days: Some(days),
            ..Default::default()
        };
        let convs = list_conversations(&db, &f, 0)?;
        let total: i64 = convs.iter().map(|c| c.cleanable_bytes).sum();
        let top = &convs[0];
        println!(
            "cũ hơn {days:>3} ngày: dọn được {:>9} · hội thoại lớn nhất: {:>9}",
            format_bytes(total as u64),
            format_bytes(top.cleanable_bytes as u64)
        );
    }
    Ok(())
}
