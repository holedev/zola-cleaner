//! In loại và sức khoẻ của mọi ổ đang gắn, để so với `Get-PhysicalDisk`.
fn main() {
    for d in zc_core::fsx::drives() {
        println!("{:?}", zc_core::drive::drive_detail(&d));
    }
}
