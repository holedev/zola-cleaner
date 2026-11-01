fn main() {
    let store = zc_core::layout::detect_media_stores(std::path::Path::new(
        &std::env::var("APPDATA").unwrap(),
    ))
    .remove(0);
    let t = std::time::Instant::now();
    let r = zc_core::report::structure_report(&store);
    eprintln!("{:.2}s", t.elapsed().as_secs_f64());
    println!("{}", serde_json::to_string_pretty(&r).unwrap());
}
