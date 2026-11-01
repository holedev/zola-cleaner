use zc_core::layout::{check_layout, detect_media_stores};
fn main() {
    for s in detect_media_stores(std::path::Path::new(&std::env::var("APPDATA").unwrap())) {
        println!("{} => {:?}", s.display(), check_layout(&s));
    }
}
