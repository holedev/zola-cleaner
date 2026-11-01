//! Đo thời gian các truy vấn đọc trên một CSDL đã quét: cargo run --release --example bench_queries -- data/zc.db
use std::time::Instant;

use zc_core::db::{list_roots, open_db};
use zc_core::filter::CleanupFilter;
use zc_core::quarantine::preview_cleanup;
use zc_core::stats::{get_stats, list_conversations};
use zc_core::suggest::suggestions;

fn main() -> zc_core::Result<()> {
    let file = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "data/zc.db".into());
    let db = open_db(file.as_ref())?;
    let root_id = list_roots(&db)?[0].id;
    let f = CleanupFilter {
        root_id,
        ..Default::default()
    };
    let time =
        |name: &str, run: &mut dyn FnMut() -> zc_core::Result<usize>| -> zc_core::Result<()> {
            let t = Instant::now();
            let n = run()?;
            println!(
                "{name:<28} {:>8.1} ms  ({n})",
                t.elapsed().as_secs_f64() * 1000.0
            );
            Ok(())
        };
    time("get_stats", &mut || {
        Ok(get_stats(&db, root_id, 10)?.by_category.len())
    })?;
    time("list_conversations", &mut || {
        Ok(list_conversations(&db, &f, 8)?.len())
    })?;
    time("suggestions", &mut || Ok(suggestions(&db, root_id)?.len()))?;
    time("preview (mọi hội thoại)", &mut || {
        Ok(preview_cleanup(&db, &f, 20)?.count as usize)
    })?;
    let one = CleanupFilter {
        conv_ids: Some(vec!["g9876055223380920618".into()]),
        ..f.clone()
    };
    time("preview (1 hội thoại)", &mut || {
        Ok(preview_cleanup(&db, &one, 20)?.count as usize)
    })?;
    Ok(())
}
