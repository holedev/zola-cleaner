use zc_core::layout::{check_compatibility, check_layout, detect_media_stores, zalo_version};
fn main() {
    println!("Zalo Version: {:?}", zalo_version().map(|v| v.to_string()));
    for s in detect_media_stores(std::path::Path::new(&std::env::var("APPDATA").unwrap())) {
        let layout = check_layout(&s);
        println!(
            "{} => {:?} / {:?}",
            s.display(),
            check_compatibility(&s, &layout),
            layout
        );
    }
}
