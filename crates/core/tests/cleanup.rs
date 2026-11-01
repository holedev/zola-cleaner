//! Port 1-1 của packages/core/src/cleanup.test.ts + jxl.test.ts, chạy trên Media Store giả có hardlink thật.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;
use zc_core::db::{Db, add_root, open_db};
use zc_core::detect::{NOISE_KEY, detect};
use zc_core::filter::CleanupFilter;
use zc_core::fsx::file_key;
use zc_core::quarantine::{
    JobOptions, preview_cleanup, purge_expired, purge_job, quarantine, restore_job,
};
use zc_core::scan::{ScanOptions, scan};
use zc_core::stats::{get_stats, list_conversations, set_alias};
use zc_core::suggest::suggestions;
use zc_core::thumbs::{find_thumbnail, jxl_to_jpeg};

const JPEG: &[u8] = &[0xff, 0xd8, 0xff, 0xe0];
const MP4: &[u8] = &[
    0, 0, 0, 0x20, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm',
];

/// Media Store giả, theo đúng cấu trúc Zalo 5.x:
///   a  — ảnh chỉ thuộc hội thoại 111                         (100 B)
///   b  — ảnh thuộc 111 và nhóm g222 (Shared Media Item)      (200 B)
///   g  — ảnh của nhóm, thư mục kho dùng dạng `222_group`     (50 B)
///   v  — video chỉ thuộc nhóm g222                           (400 B)
///   d  — tài liệu (fileNoise) thuộc 111                      (800 B)
///   t  — Thumbnail của a trong Cache/                        (10 B)
/// Tên ảnh trong resource/ mang uid người gửi ("sender"), Thumbnail mang uid tài khoản ("me").
struct Store {
    _dir: TempDir,
    store: PathBuf,
    a: PathBuf,
    a_res: PathBuf,
    b: PathBuf,
    v: PathBuf,
    t: PathBuf,
    quarantine_base: PathBuf,
    db: Db,
    root_id: i64,
}

fn put(store: &Path, rel: &str, header: &[u8], size: usize) -> PathBuf {
    let abs = store.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    let mut buf = vec![0u8; size];
    buf[..header.len()].copy_from_slice(header);
    fs::write(&abs, buf).unwrap();
    abs
}

fn link(store: &Path, target: &Path, rel: &str) -> PathBuf {
    let abs = store.join(rel);
    fs::create_dir_all(abs.parent().unwrap()).unwrap();
    fs::hard_link(target, &abs).unwrap();
    abs
}

fn setup() -> Store {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("ZaloDownloads");
    let old = "16000000000"; // + 2 chữ số → Message Time khác nhau, khoảng 2020-09
    let pdf_noise: Vec<u8> = b"%PDF-1.7".iter().map(|c| c ^ NOISE_KEY).collect();

    let a = put(&store, "picture/111/za_a.jpg", JPEG, 100);
    let a_res = link(
        &store,
        &a,
        &format!("resource/111/picture/{old}01_sender_111_a.jpg"),
    );
    let b = put(&store, "picture/111/zb_b.jpg", JPEG, 200);
    link(
        &store,
        &b,
        &format!("resource/111/picture/{old}02_sender_111_b.jpg"),
    );
    link(
        &store,
        &b,
        &format!("resource/g222/picture/{old}02_sender_g222_b.jpg"),
    );
    let g = put(&store, "picture/222_group/zg_g.jpg", JPEG, 50);
    link(
        &store,
        &g,
        &format!("resource/g222/picture/{old}05_sender_g222_g.jpg"),
    );
    let v = put(&store, "video/group/123", MP4, 400);
    link(
        &store,
        &v,
        &format!("resource/g222/video/{old}03_sender_g222"),
    );
    let d = put(&store, "fileNoise/abcdef", &pdf_noise, 800);
    link(
        &store,
        &d,
        &format!("resource/111/fileNoise/{old}04_sender_111"),
    );
    let t = put(&store, &format!("Cache/{old}01_me_111_t"), JPEG, 10);
    link(&store, &t, &format!("resource/111/Cache/{old}01_me_111_t"));
    fs::write(
        store.join("picture").join(".rescache"),
        r#"{"__version__":1}"#,
    )
    .unwrap();

    let db = open_db(&dir.path().join("test.db")).unwrap();
    let root_id = add_root(&db, &store, None).unwrap().id;
    scan(&db, root_id, &ScanOptions::default()).unwrap();
    let quarantine_base = dir.path().join("quarantine");
    Store {
        _dir: dir,
        store,
        a,
        a_res,
        b,
        v,
        t,
        quarantine_base,
        db,
        root_id,
    }
}

impl Store {
    fn opts(&self) -> JobOptions {
        JobOptions {
            check_zalo: false,
            ..JobOptions::new(self.quarantine_base.clone())
        }
    }
    fn filter(&self, convs: &[&str]) -> CleanupFilter {
        CleanupFilter {
            root_id: self.root_id,
            conv_ids: Some(convs.iter().map(|c| (*c).to_owned()).collect()),
            ..Default::default()
        }
    }
    fn total_bytes(&self) -> i64 {
        get_stats(&self.db, self.root_id, 20).unwrap().total.bytes
    }
    fn rescan(&self) -> zc_core::scan::ScanProgress {
        scan(&self.db, self.root_id, &ScanOptions::default()).unwrap()
    }
    fn item_id_of(&self, rel: &str) -> i64 {
        self.db
            .query_row("SELECT item_id FROM links WHERE rel_path = ?", [rel], |r| {
                r.get(0)
            })
            .unwrap()
    }
    fn status_of(&self, id: i64) -> String {
        self.db
            .query_row("SELECT status FROM items WHERE id = ?", [id], |r| r.get(0))
            .unwrap()
    }
}

fn key(p: &Path) -> String {
    file_key(p).unwrap().0
}
fn nlink(p: &Path) -> u32 {
    file_key(p).unwrap().1
}

#[test]
fn quet_hardlink_khong_dem_trung_gan_dung_hoi_thoai_giai_xor() {
    let s = setup();
    let stats = get_stats(&s.db, s.root_id, 20).unwrap();
    assert_eq!(stats.total.count, 6);
    assert_eq!(stats.total.bytes, 100 + 200 + 50 + 400 + 800 + 10);
    let (cat, kind): (String, String) =
        s.db.query_row(
            "SELECT category, kind FROM items WHERE area = 'fileNoise'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((cat.as_str(), kind.as_str()), ("document", "pdf"));
    let ts: i64 =
        s.db.query_row("SELECT msg_ts FROM items WHERE area = 'video'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(ts, 1600000000003);

    set_alias(&s.db, s.root_id, "111", Some("  Gia đình ")).unwrap();
    let convs = list_conversations(&s.db, &s.filter(&[]), 8).unwrap();
    let c1 = convs.iter().find(|c| c.conv_id == "111").unwrap();
    let c2 = convs.iter().find(|c| c.conv_id == "g222").unwrap();
    assert_eq!(c1.alias.as_deref(), Some("Gia đình"));
    assert_eq!(c1.bytes, 100 + 200 + 800); // Thumbnail trong Cache/ không tính
    assert_eq!(c1.own_bytes, 100 + 800); // b dùng chung với g222
    assert_eq!(c1.document_bytes, 800);
    assert!(c2.is_group);
    assert_eq!(c2.bytes, 200 + 50 + 400); // gộp picture/222_group và resource/g222
    assert_eq!(c2.own_bytes, 50 + 400);
    assert_eq!(convs.len(), 2);
    assert_eq!(c1.thumb_ids.len(), 2);

    // Quét lại: không đổi gì
    let again = s.rescan();
    assert_eq!(again.new_files + again.changed, 0);
    assert_eq!(again.bytes, 1560);
    assert_eq!(again.seen, 13);
}

#[test]
fn cot_don_duoc_doi_theo_bo_loc() {
    let s = setup();
    let base = CleanupFilter {
        root_id: s.root_id,
        ..Default::default()
    }; // mặc định ảnh + video
    let convs = list_conversations(&s.db, &base, 8).unwrap();
    let c1 = convs.iter().find(|c| c.conv_id == "111").unwrap();
    assert_eq!((c1.cleanable_count, c1.cleanable_bytes), (1, 100)); // chỉ a: b dùng chung, d là tài liệu

    let docs = CleanupFilter {
        categories: Some(vec!["image".into(), "document".into()]),
        ..base.clone()
    };
    let c1 = list_conversations(&s.db, &docs, 8)
        .unwrap()
        .into_iter()
        .find(|c| c.conv_id == "111")
        .unwrap();
    assert_eq!(c1.cleanable_bytes, 100 + 800);

    let recent = CleanupFilter {
        older_than_days: Some(365 * 100),
        ..base
    };
    assert!(
        list_conversations(&s.db, &recent, 8)
            .unwrap()
            .iter()
            .all(|c| c.cleanable_bytes == 0)
    );
}

#[test]
fn preview_bo_qua_shared_khong_chon_thumbnail_tai_lieu_phai_tu_chon() {
    let s = setup();
    let p1 = preview_cleanup(&s.db, &s.filter(&["111"]), 20).unwrap();
    assert_eq!((p1.count, p1.bytes), (1, 100)); // chỉ a (b dùng chung, d là tài liệu)
    assert_eq!((p1.skipped_shared.count, p1.skipped_shared.bytes), (1, 200));

    let p2 = preview_cleanup(&s.db, &s.filter(&["111", "g222"]), 20).unwrap();
    assert_eq!(p2.bytes, 100 + 200 + 50 + 400);
    assert_eq!(p2.skipped_shared.count, 0);

    let all = |f: CleanupFilter| preview_cleanup(&s.db, &f, 20).unwrap();
    let base = CleanupFilter {
        root_id: s.root_id,
        ..Default::default()
    };
    let p3 = all(CleanupFilter {
        categories: Some(
            ["image", "video", "document", "database"]
                .map(String::from)
                .to_vec(),
        ),
        ..base.clone()
    });
    assert_eq!(p3.bytes, 100 + 200 + 50 + 400 + 800); // Cache/ bị loại dù là ảnh
    assert_eq!(
        all(CleanupFilter {
            older_than_days: Some(365 * 100),
            ..base.clone()
        })
        .count,
        0
    );
    assert_eq!(
        all(CleanupFilter {
            min_size: Some(300),
            ..base
        })
        .bytes,
        400
    );
}

#[test]
fn cach_ly_go_moi_link_khoi_phuc_tao_lai_hardlink_purge_xoa_han() {
    let s = setup();
    let a_id = s.item_id_of("picture/111/za_a.jpg");
    let a_key = key(&s.a);

    let q = quarantine(&s.db, &s.filter(&["111"]), &s.opts()).unwrap();
    assert_eq!((q.moved, q.failed, q.bytes), (1, 0, 100));
    assert!(!s.a.exists());
    assert!(!s.a_res.exists());
    assert!(s.b.exists()); // dùng chung → giữ
    assert!(s.t.exists()); // Thumbnail → giữ
    assert_eq!(s.total_bytes(), 1560 - 100);

    // Quét trong lúc đang cách ly không làm hỏng trạng thái
    s.rescan();
    assert_eq!(s.status_of(a_id), "quarantined");

    let r = restore_job(&s.db, q.job_id, &s.opts()).unwrap();
    assert_eq!(r.moved, 1);
    assert_eq!(key(&s.a), a_key);
    assert_eq!(key(&s.a_res), a_key);
    assert_eq!(nlink(&s.a), 2);
    let own = |s: &Store| {
        list_conversations(&s.db, &s.filter(&[]), 8)
            .unwrap()
            .into_iter()
            .find(|c| c.conv_id == "111")
            .unwrap()
            .own_bytes
    };
    assert_eq!(own(&s), 900);

    let q2 = quarantine(&s.db, &s.filter(&["111"]), &s.opts()).unwrap();
    assert!(
        purge_expired(&s.db, zc_core::db::now_ms())
            .unwrap()
            .is_empty()
    ); // chưa hết Retention
    let p = purge_job(&s.db, q2.job_id).unwrap();
    assert_eq!(p.bytes, 100);
    assert!(!s.quarantine_base.join(q2.job_id.to_string()).exists());
    assert_eq!(s.status_of(a_id), "deleted");
    assert!(restore_job(&s.db, q2.job_id, &s.opts()).is_err());
}

#[test]
fn khoi_phuc_sau_khi_zalo_tai_lai_anh_noi_lai_thanh_hardlink() {
    let s = setup();
    let original = fs::read(&s.a).unwrap();
    let a_key = key(&s.a);
    let q = quarantine(&s.db, &s.filter(&["111"]), &s.opts()).unwrap();

    // Zalo (có Cloud) tải lại ảnh khi mở hội thoại: chỉ ghi vào resource/, file mới, nlink 1
    fs::write(&s.a_res, &original).unwrap();
    s.rescan(); // người dùng quét lại trước khi khôi phục
    assert_eq!(s.total_bytes(), 1560);

    let r = restore_job(&s.db, q.job_id, &s.opts()).unwrap();
    assert_eq!((r.moved, r.failed), (1, 0));
    assert_eq!(key(&s.a), a_key);
    assert_eq!(key(&s.a_res), a_key); // bản tải lại được thay bằng Link tới bản gốc
    assert_eq!(nlink(&s.a), 2);

    s.rescan();
    assert_eq!(s.total_bytes(), 1560); // không đếm hai bản
}

#[test]
fn khoi_phuc_khi_file_o_dich_khac_noi_dung_giu_file_cua_zalo() {
    let s = setup();
    let q = quarantine(&s.db, &s.filter(&["111"]), &s.opts()).unwrap();
    let other = vec![7u8; 120];
    fs::write(&s.a_res, &other).unwrap();

    let r = restore_job(&s.db, q.job_id, &s.opts()).unwrap();
    assert_eq!(r.failed, 0);
    assert_eq!(fs::metadata(&s.a).unwrap().len(), 100); // bản gốc về chỗ cũ
    assert_eq!(fs::read(&s.a_res).unwrap(), other); // file Zalo vừa ghi còn nguyên
    assert_ne!(key(&s.a_res), key(&s.a));
}

#[test]
fn het_retention_tu_purge() {
    let s = setup();
    let f = CleanupFilter {
        categories: Some(vec!["video".into()]),
        ..s.filter(&["g222"])
    };
    let q = quarantine(
        &s.db,
        &f,
        &JobOptions {
            retention_days: 7,
            ..s.opts()
        },
    )
    .unwrap();
    assert_eq!(q.bytes, 400);
    let purged = purge_expired(&s.db, zc_core::db::now_ms() + 8 * 86_400_000).unwrap();
    assert_eq!(purged.len(), 1);
    assert!(!s.v.exists());
}

#[test]
fn thumbnail_uu_tien_anh_trong_cache_cung_message_time() {
    let s = setup();
    let thumb = find_thumbnail(&s.db, s.item_id_of("picture/111/za_a.jpg"))
        .unwrap()
        .unwrap();
    let file = thumb.file.to_string_lossy().replace('\\', "/");
    assert!(file.ends_with("Cache/1600000000001_me_111_t"), "{file}");
    assert_eq!(thumb.content_type, "image/jpeg");
    assert_eq!(
        find_thumbnail(&s.db, s.item_id_of("video/group/123")).unwrap(),
        None
    );
}

#[test]
fn suggestion_tinh_tren_moi_hoi_thoai() {
    let s = setup();
    let list = suggestions(&s.db, s.root_id).unwrap();
    let media = list.iter().find(|x| x.id == "media-1y").unwrap();
    assert_eq!(media.bytes, 100 + 200 + 50 + 400); // không chọn hội thoại → không có Shared bị bỏ qua
    let docs = list.iter().find(|x| x.id == "docs-1y").unwrap();
    assert!(docs.caution);
    assert_eq!(docs.bytes, 800);
    assert_eq!(list.iter().find(|x| x.id == "video-50mb").unwrap().bytes, 0);
}

#[test]
fn duong_dan_dai_hon_260_ky_tu() {
    let s = setup();
    let deep = format!(
        "resource/333/picture/{}/1600000000009_sender_333_x.jpg",
        ["thu-muc-rat-dai-abcdefghij"; 10].join("/")
    );
    assert!(s.store.join(&deep).to_string_lossy().len() > 260);
    let x = put(&s.store, "picture/333/zx.jpg", JPEG, 30);
    link(&s.store, &x, &deep);
    let p = s.rescan();
    assert_eq!(p.errors, 0);
    assert_eq!(p.bytes, 1560 + 30);

    let q = quarantine(&s.db, &s.filter(&["333"]), &s.opts()).unwrap();
    assert_eq!((q.moved, q.failed), (1, 0));
    restore_job(&s.db, q.job_id, &s.opts()).unwrap();
    assert_eq!(nlink(&x), 2);
}

#[test]
fn jpeg_xl_thanh_thumbnail_jpeg_canh_dai_320() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/gray-640x400.jxl");
    assert_eq!(detect(&fs::read(&src).unwrap(), "").kind, "jxl");
    let jpg = jxl_to_jpeg(&src, 320).unwrap();
    assert_eq!(detect(&jpg, "").kind, "jpg");
    // SOF0/SOF2 chứa kích thước: tìm marker FF C0 / FF C2 rồi đọc chiều cao/rộng
    let sof = jpg
        .windows(2)
        .position(|w| w[0] == 0xff && (w[1] == 0xc0 || w[1] == 0xc2))
        .unwrap();
    let h = u16::from_be_bytes([jpg[sof + 5], jpg[sof + 6]]);
    let w = u16::from_be_bytes([jpg[sof + 7], jpg[sof + 8]]);
    assert_eq!((w, h), (320, 200));
}

#[test]
fn chi_don_supported_layout() {
    use zc_core::layout::{LayoutCheck, account_uid, check_layout};
    let dir = tempfile::tempdir().unwrap();
    let zalo_data = dir.path().join("ZaloData");
    let store = zalo_data.join("media").join("123456").join("ZaloDownloads");
    let a = put(&store, "picture/111/za_a.jpg", JPEG, 100);
    link(
        &store,
        &a,
        "resource/111/picture/1600000000001_sender_111_a.jpg",
    );
    let config = zalo_data.join("config.json");
    fs::write(&config, r#"{"major_version":5,"migrate_full_done":true}"#).unwrap();

    assert_eq!(account_uid(&store).as_deref(), Some("123456"));
    assert_eq!(check_layout(&store), LayoutCheck::Supported);

    fs::write(&config, r#"{"major_version":4}"#).unwrap();
    let LayoutCheck::Unsupported { reasons } = check_layout(&store) else {
        panic!("phải bị từ chối")
    };
    assert_eq!(reasons.len(), 2, "{reasons:?}"); // phiên bản + chưa chuyển media

    // Media Store giả của các test khác: không đúng vị trí, không có config
    let s = setup();
    assert!(!check_layout(&s.store).is_supported());
}
