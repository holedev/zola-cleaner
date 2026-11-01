//! Vỏ Tauri: command IPC gọi vào zalo-cleaner-core, protocol `thumb://` cho thumbnail.
//! Không có HTTP server; mọi thao tác trên đĩa chạy ngoài luồng UI.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};
use zc_core::archive::{self, ArchiveResult};
use zc_core::db::{self, Root};
use zc_core::filter::CleanupFilter;
use zc_core::layout::{self, LayoutCheck};
use zc_core::quarantine::{self, CleanupItems, CleanupPreview, Job, JobOptions, JobResult};
use zc_core::scan::{ScanOptions, ScanProgress};
use zc_core::stats::{self, ConversationMonths, ConversationSummary, Stats};
use zc_core::suggest::{self, Suggestion};
use zc_core::{Error, fsx, report, safety, thumbs};

/// Lỗi trả về giao diện: `kind` để giao diện chọn cách hiển thị, `message` hiển thị thẳng.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CmdError {
    kind: &'static str,
    message: String,
}

impl From<Error> for CmdError {
    fn from(e: Error) -> Self {
        let kind = match e {
            Error::ZaloRunning => "zaloRunning",
            Error::Msg(_) => "user",
            _ => "internal",
        };
        if kind == "internal" {
            log::error!("{e}");
        }
        Self {
            kind,
            message: e.to_string(),
        }
    }
}

impl CmdError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

type CmdResult<T> = Result<T, CmdError>;

struct Paths {
    db: PathBuf,
    thumbs: PathBuf,
    /// Bản tạm (giải XOR, có đuôi file) để mở bằng ứng dụng khác; xoá mỗi lần mở app.
    open: PathBuf,
    quarantine: PathBuf,
}

#[derive(Default)]
struct Runtime {
    /// rootId → tiến độ mới nhất của lần quét đang chạy.
    scanning: HashMap<i64, ScanProgress>,
    /// Đang cách ly / khôi phục / giải phóng: chỉ một thao tác trên đĩa tại một thời điểm.
    busy: bool,
    /// Job tự giải phóng lúc khởi động (hết Retention), để giao diện báo lại.
    auto_purged: Vec<JobResult>,
    /// uid của tài khoản Zalo mới phát hiện lúc khởi động (không tính lần chạy đầu tiên).
    new_accounts: Vec<String>,
}

struct AppState {
    paths: Paths,
    rt: Mutex<Runtime>,
}

type AppStateRef<'a> = State<'a, Arc<AppState>>;

impl AppState {
    fn db(&self) -> CmdResult<db::Db> {
        Ok(db::connect(&self.paths.db)?)
    }
    fn job_options(&self) -> JobOptions {
        JobOptions::new(self.paths.quarantine.clone())
    }
}

/// Chạy việc chặn (I/O, SQLite) trên pool riêng để không đứng UI.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CmdError::new("internal", e.to_string()))?
}

/// Giữ khoá "đang có thao tác trên đĩa" trong suốt `f`.
async fn exclusive<T: Send + 'static>(
    state: &Arc<AppState>,
    f: impl FnOnce(&AppState) -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    {
        let mut rt = state.rt.lock().unwrap();
        if rt.busy {
            return Err(CmdError::new("busy", "Đang có thao tác khác, vui lòng chờ"));
        }
        rt.busy = true;
    }
    let s = state.clone();
    let out = blocking(move || f(&s)).await;
    state.rt.lock().unwrap().busy = false;
    out
}

// --- Trạng thái chung ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    version: &'static str,
    zalo_running: bool,
    scanning: Vec<ScanProgressFor>,
    busy: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgressFor {
    root_id: i64,
    #[serde(flatten)]
    progress: ScanProgress,
}

#[tauri::command]
async fn health(state: AppStateRef<'_>) -> CmdResult<Health> {
    let zalo_running = blocking(|| Ok(safety::is_zalo_running())).await?;
    let rt = state.rt.lock().unwrap();
    Ok(Health {
        version: env!("CARGO_PKG_VERSION"),
        zalo_running,
        scanning: rt
            .scanning
            .iter()
            .map(|(&root_id, p)| ScanProgressFor {
                root_id,
                progress: p.clone(),
            })
            .collect(),
        busy: rt.busy,
    })
}

#[tauri::command]
fn take_auto_purged(state: AppStateRef<'_>) -> Vec<JobResult> {
    std::mem::take(&mut state.rt.lock().unwrap().auto_purged)
}

#[tauri::command]
fn take_new_accounts(state: AppStateRef<'_>) -> Vec<String> {
    std::mem::take(&mut state.rt.lock().unwrap().new_accounts)
}

/// Mọi tài khoản Zalo trên máy (kể cả chưa có thư mục media).
#[tauri::command]
async fn accounts() -> CmdResult<Vec<layout::AccountInfo>> {
    blocking(|| {
        Ok(std::env::var_os("APPDATA")
            .map(|a| layout::detect_accounts(Path::new(&a)))
            .unwrap_or_default())
    })
    .await
}

// --- Media Store ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootInfo {
    #[serde(flatten)]
    root: Root,
    uid: Option<String>,
    layout: LayoutCheck,
}

fn root_info(root: Root) -> RootInfo {
    let path = PathBuf::from(&root.path);
    RootInfo {
        uid: layout::account_uid(&path),
        layout: layout::check_layout(&path),
        root,
    }
}

#[tauri::command]
async fn roots(state: AppStateRef<'_>) -> CmdResult<Vec<RootInfo>> {
    let s = state.inner().clone();
    blocking(move || {
        Ok(db::list_roots(&s.db()?)?
            .into_iter()
            .map(root_info)
            .collect())
    })
    .await
}

#[tauri::command]
async fn add_root(state: AppStateRef<'_>, path: String) -> CmdResult<RootInfo> {
    let s = state.inner().clone();
    blocking(move || Ok(root_info(db::add_root(&s.db()?, Path::new(&path), None)?))).await
}

#[tauri::command]
async fn start_scan(app: AppHandle, state: AppStateRef<'_>, root_id: i64) -> CmdResult<()> {
    {
        let rt = state.rt.lock().unwrap();
        if rt.scanning.contains_key(&root_id) {
            return Ok(()); // đang quét rồi: giao diện chỉ cần nghe event tiếp
        }
    }
    let s = state.inner().clone();
    std::thread::spawn(move || {
        let on_progress = |p: &ScanProgress| {
            s.rt.lock().unwrap().scanning.insert(root_id, p.clone());
            let _ = app.emit(
                "scan-progress",
                ScanProgressFor {
                    root_id,
                    progress: p.clone(),
                },
            );
        };
        let result = s.db().map_err(|e| e.message).and_then(|db| {
            zc_core::scan::scan(
                &db,
                root_id,
                &ScanOptions {
                    on_progress: Some(&on_progress),
                    cancel: None,
                },
            )
            .map_err(|e| e.to_string())
        });
        s.rt.lock().unwrap().scanning.remove(&root_id);
        if let Err(e) = result {
            log::error!("Quét thất bại: {e}");
            let _ = app.emit("scan-error", e);
        }
    });
    Ok(())
}

// --- Thống kê, Conversation, Suggestion ---

#[tauri::command]
async fn stats(state: AppStateRef<'_>, root_id: i64) -> CmdResult<Stats> {
    let s = state.inner().clone();
    blocking(move || Ok(stats::get_stats(&s.db()?, root_id, 20)?)).await
}

#[tauri::command]
async fn suggestions(state: AppStateRef<'_>, root_id: i64) -> CmdResult<Vec<Suggestion>> {
    let s = state.inner().clone();
    blocking(move || Ok(suggest::suggestions(&s.db()?, root_id)?)).await
}

fn check_filter(f: &CleanupFilter) -> CmdResult<()> {
    match f
        .categories
        .iter()
        .flatten()
        .find(|c| !safety::is_selectable(c))
    {
        Some(bad) => Err(CmdError::new(
            "user",
            format!("Loại không được phép chọn: {bad}"),
        )),
        None => Ok(()),
    }
}

#[tauri::command]
async fn conversations(
    state: AppStateRef<'_>,
    filter: CleanupFilter,
) -> CmdResult<Vec<ConversationSummary>> {
    check_filter(&filter)?;
    let s = state.inner().clone();
    blocking(move || Ok(stats::list_conversations(&s.db()?, &filter, 10)?)).await
}

#[tauri::command]
async fn conversation_months(
    state: AppStateRef<'_>,
    filter: CleanupFilter,
) -> CmdResult<ConversationMonths> {
    check_filter(&filter)?;
    if filter.conv_ids.as_ref().is_none_or(|c| c.len() != 1) {
        return Err(CmdError::new("user", "Chọn đúng một hội thoại"));
    }
    let s = state.inner().clone();
    blocking(move || Ok(stats::conversation_months(&s.db()?, &filter, 4)?)).await
}

#[tauri::command]
async fn set_alias(
    state: AppStateRef<'_>,
    root_id: i64,
    conv_id: String,
    alias: Option<String>,
) -> CmdResult<()> {
    let s = state.inner().clone();
    blocking(move || {
        Ok(stats::set_alias(
            &s.db()?,
            root_id,
            &conv_id,
            alias.as_deref(),
        )?)
    })
    .await
}

// --- Dọn dẹp ---

#[tauri::command]
async fn preview(state: AppStateRef<'_>, filter: CleanupFilter) -> CmdResult<CleanupPreview> {
    check_filter(&filter)?;
    let s = state.inner().clone();
    blocking(move || Ok(quarantine::preview_cleanup(&s.db()?, &filter, 20)?)).await
}

/// Một trang file sẽ bị dọn, để xem trước và bỏ tick.
#[tauri::command]
async fn cleanup_items(
    state: AppStateRef<'_>,
    filter: CleanupFilter,
    group: String,
    order: String,
    offset: i64,
    limit: i64,
) -> CmdResult<CleanupItems> {
    check_filter(&filter)?;
    let s = state.inner().clone();
    let limit = limit.clamp(1, 500);
    blocking(move || {
        Ok(quarantine::cleanup_items(
            &s.db()?,
            &filter,
            &group,
            &order,
            offset.max(0),
            limit,
        )?)
    })
    .await
}

/// Chỉ dọn Media Store có Supported Layout.
fn assert_supported(db: &db::Db, root_id: i64) -> CmdResult<()> {
    let root = db::get_root(db, root_id)?
        .ok_or_else(|| CmdError::new("user", "Không tìm thấy Media Store"))?;
    match layout::check_layout(Path::new(&root.path)) {
        LayoutCheck::Supported => Ok(()),
        LayoutCheck::Unsupported { reasons } => Err(CmdError::new(
            "unsupported",
            format!(
                "Cấu trúc thư mục Zalo này chưa được hỗ trợ, app chỉ xem không dọn: {}",
                reasons.join("; ")
            ),
        )),
    }
}

#[tauri::command]
async fn quarantine(state: AppStateRef<'_>, filter: CleanupFilter) -> CmdResult<JobResult> {
    check_filter(&filter)?;
    if state
        .rt
        .lock()
        .unwrap()
        .scanning
        .contains_key(&filter.root_id)
    {
        return Err(CmdError::new("busy", "Đang quét, vui lòng chờ quét xong"));
    }
    exclusive(state.inner(), move |s| {
        let db = s.db()?;
        assert_supported(&db, filter.root_id)?;
        let r = quarantine::quarantine(&db, &filter, &s.job_options())?;
        log::info!(
            "Cách ly job #{}: {} file, {} byte, {} lỗi",
            r.job_id,
            r.moved,
            r.bytes,
            r.failed
        );
        Ok(r)
    })
    .await
}

#[tauri::command]
async fn jobs(state: AppStateRef<'_>, root_id: i64) -> CmdResult<Vec<Job>> {
    let s = state.inner().clone();
    blocking(move || Ok(quarantine::list_jobs(&s.db()?, root_id)?)).await
}

#[tauri::command]
async fn restore(state: AppStateRef<'_>, job_id: i64) -> CmdResult<JobResult> {
    exclusive(state.inner(), move |s| {
        let r = quarantine::restore_job(&s.db()?, job_id, &s.job_options())?;
        log::info!(
            "Khôi phục job #{job_id}: {} file, {} lỗi",
            r.moved,
            r.failed
        );
        Ok(r)
    })
    .await
}

#[tauri::command]
async fn purge(state: AppStateRef<'_>, job_id: i64) -> CmdResult<JobResult> {
    exclusive(state.inner(), move |s| {
        let r = quarantine::purge_job(&s.db()?, job_id)?;
        log::info!(
            "Giải phóng job #{job_id}: {} file, {} byte, {} lỗi",
            r.moved,
            r.bytes,
            r.failed
        );
        Ok(r)
    })
    .await
}

// --- Ổ đĩa, sao lưu ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskInfo {
    /// Ổ chứa dữ liệu Zalo, ví dụ "C:".
    drive: String,
    free: u64,
    total: u64,
    /// Media Zalo đang chiếm (không đếm trùng hardlink).
    zalo_bytes: i64,
    /// Thùng rác của app đang giữ (vẫn chiếm ổ đĩa).
    trash_bytes: i64,
}

#[tauri::command]
async fn disk_space(state: AppStateRef<'_>, root_id: i64) -> CmdResult<DiskInfo> {
    let s = state.inner().clone();
    blocking(move || {
        let db = s.db()?;
        let root = db::get_root(&db, root_id)?.ok_or_else(|| CmdError::new("user", "Không tìm thấy Media Store"))?;
        let path = PathBuf::from(&root.path);
        let (free, total) = fsx::disk_space(&path).map_err(|e| CmdError::new("internal", e.to_string()))?;
        let zalo_bytes = stats::get_stats(&db, root_id, 0)?.total.bytes;
        let trash_bytes: i64 = db
            .query_row(
                "SELECT COALESCE(SUM(total_bytes), 0) FROM jobs WHERE root_id = ? AND status IN ('quarantined', 'failed')",
                [root_id],
                |r| r.get(0),
            )
            .map_err(Error::from)?;
        let drive = path.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
        Ok(DiskInfo { drive, free, total, zalo_bytes, trash_bytes })
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveProgress {
    done: u64,
    total: u64,
}

/// Nén các lần dọn trong thùng rác thành ZIP (để sao lưu lên Drive…). Kiểm tra nơi lưu đủ chỗ trước.
#[tauri::command]
async fn export_backup(
    app: AppHandle,
    state: AppStateRef<'_>,
    job_ids: Vec<i64>,
    path: String,
) -> CmdResult<ArchiveResult> {
    exclusive(state.inner(), move |s| {
        let db = s.db()?;
        let need: i64 = job_ids
            .iter()
            .map(|id| db.query_row("SELECT total_bytes FROM jobs WHERE id = ?", [id], |r| r.get::<_, i64>(0)).unwrap_or(0))
            .sum();
        let out = PathBuf::from(&path);
        if let Some((free, _)) = out.parent().and_then(|d| fsx::disk_space(d).ok())
            && free < (need as u64).saturating_add(need as u64 / 50 + 16 * 1024 * 1024)
        {
            return Err(CmdError::new(
                "user",
                format!(
                    "Nơi lưu không đủ chỗ: cần khoảng {}, còn trống {}. Hãy chọn ổ đĩa khác (USB, ổ D…).",
                    zc_core::format_bytes(need as u64),
                    zc_core::format_bytes(free)
                ),
            ));
        }
        let progress = |done, total| {
            let _ = app.emit("archive-progress", ArchiveProgress { done, total });
        };
        let r = archive::export_jobs(&db, &job_ids, &out, &progress)?;
        log::info!("Nén thùng rác: {} file, {} byte, {} lỗi", r.files, r.bytes, r.failed);
        Ok(r)
    })
    .await
}

/// Nhập lại một bản sao lưu ZIP vào tài khoản đang xem. Cần thoát Zalo.
#[tauri::command]
async fn import_backup(
    app: AppHandle,
    state: AppStateRef<'_>,
    root_id: i64,
    path: String,
) -> CmdResult<ArchiveResult> {
    exclusive(state.inner(), move |s| {
        let db = s.db()?;
        let work = s.paths.quarantine.join(format!("import-{}", db::now_ms()));
        let progress = |done, total| {
            let _ = app.emit("archive-progress", ArchiveProgress { done, total });
        };
        let r = archive::import_backup(
            &db,
            root_id,
            Path::new(&path),
            &work,
            &s.job_options(),
            &progress,
        )?;
        log::info!(
            "Nhập lại sao lưu: {} file, {} bỏ qua, {} lỗi",
            r.files,
            r.skipped,
            r.failed
        );
        Ok(r)
    })
    .await
}

/// Mở một Media Item bằng ứng dụng mặc định của Windows (PDF, Word, ảnh…), qua một bản tạm.
#[tauri::command]
async fn open_item(app: AppHandle, state: AppStateRef<'_>, item_id: i64) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let s = state.inner().clone();
    let path = blocking(move || Ok(thumbs::materialize(&s.db()?, item_id, &s.paths.open)?)).await?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| CmdError::new("user", format!("Không mở được file: {e}")))
}

// --- Báo cáo / nhật ký ---

#[tauri::command]
async fn export_report(state: AppStateRef<'_>, root_id: i64, path: String) -> CmdResult<()> {
    let s = state.inner().clone();
    blocking(move || {
        let root = db::get_root(&s.db()?, root_id)?
            .ok_or_else(|| CmdError::new("user", "Không tìm thấy Media Store"))?;
        let r = report::structure_report(Path::new(&root.path));
        let json = serde_json::to_string_pretty(&serde_json::json!({
            "app": env!("CARGO_PKG_VERSION"),
            "report": r,
        }))
        .map_err(|e| CmdError::new("internal", e.to_string()))?;
        std::fs::write(&path, json).map_err(|e| CmdError::new("user", e.to_string()))
    })
    .await
}

/// Lược đường dẫn người dùng và các dãy số dài (uid, ID hội thoại, Message Time) khỏi một dòng nhật ký.
fn sanitize_log(line: &str, home: &str) -> String {
    let line = if home.is_empty() {
        line.to_owned()
    } else {
        line.replace(home, "%USERPROFILE%")
    };
    let mut out = String::with_capacity(line.len());
    let mut digits = String::new();
    for ch in line.chars().chain(std::iter::once('\0')) {
        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }
        if digits.len() >= 10 {
            out.push_str("<id>");
        } else {
            out.push_str(&digits);
        }
        digits.clear();
        if ch != '\0' {
            out.push(ch);
        }
    }
    out
}

#[tauri::command]
async fn export_log(app: AppHandle, path: String) -> CmdResult<()> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| CmdError::new("internal", e.to_string()))?;
    blocking(move || {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let raw = std::fs::read_to_string(dir.join("zola-cleaner.log")).unwrap_or_default();
        let clean: Vec<String> = raw.lines().map(|l| sanitize_log(l, &home)).collect();
        std::fs::write(&path, clean.join("\n")).map_err(|e| CmdError::new("user", e.to_string()))
    })
    .await
}

// --- Khởi động ---

fn app_paths() -> Paths {
    let roaming = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| roaming.clone());
    let data = roaming.join("zola-cleaner");
    Paths {
        db: data.join("zola-cleaner.db"),
        thumbs: local.join("zola-cleaner").join("thumbs"),
        open: local.join("zola-cleaner").join("open"),
        quarantine: quarantine::default_quarantine_base(&roaming),
    }
}

struct Startup {
    purged: Vec<JobResult>,
    new_accounts: Vec<String>,
}

/// Tạo CSDL, tự thêm Media Store của mọi tài khoản tìm thấy (mỗi lần mở app), tự giải phóng job hết Retention.
fn init(paths: &Paths) -> zc_core::Result<Startup> {
    // Bản tạm của lần trước (file đang mở trong ứng dụng khác thì để lần sau)
    let _ = std::fs::remove_dir_all(&paths.open);
    let db = db::open_db(&paths.db)?;
    let known: Vec<String> = db::list_roots(&db)?
        .into_iter()
        .map(|r| r.path.to_lowercase())
        .collect();
    let first_run = known.is_empty();
    let mut new_accounts = Vec::new();
    if let Some(app_data) = std::env::var_os("APPDATA") {
        for store in layout::detect_media_stores(Path::new(&app_data)) {
            let root = db::add_root(&db, &store, None)?;
            if !first_run && !known.contains(&root.path.to_lowercase()) {
                log::info!("Phát hiện tài khoản Zalo mới");
                new_accounts.extend(layout::account_uid(&store));
            }
        }
    }
    let purged = quarantine::purge_expired(&db, db::now_ms())?;
    for r in &purged {
        log::info!(
            "Tự giải phóng job #{} (hết thời gian giữ): {} file, {} byte",
            r.job_id,
            r.moved,
            r.bytes
        );
    }
    Ok(Startup {
        purged,
        new_accounts,
    })
}

/// `thumb://<id>` → ảnh nhỏ cho bảng; `media://<id>` → ảnh lớn để xem.
fn image_response(state: &AppState, uri_path: &str, large: bool) -> Response<Vec<u8>> {
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    };
    let Ok(item_id) = uri_path.trim_matches('/').parse::<i64>() else {
        return not_found();
    };
    let found = state.db().ok().and_then(|db| {
        let render = if large {
            thumbs::render_view
        } else {
            thumbs::render_thumbnail
        };
        render(&db, item_id, &state.paths.thumbs).ok().flatten()
    });
    let Some(src) = found else { return not_found() };
    match std::fs::read(&src.file) {
        Ok(bytes) => Response::builder()
            .header("Content-Type", src.content_type)
            .header("Cache-Control", "max-age=86400")
            .body(bytes)
            .unwrap(),
        Err(_) => not_found(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = app_paths();
    let state = Arc::new(AppState {
        paths,
        rt: Mutex::new(Runtime::default()),
    });
    let thumb_state = state.clone();
    let media_state = state.clone();

    tauri::Builder::default()
        // Mở app lần hai → đưa cửa sổ đang có lên trước
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("zola-cleaner".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("thumb", move |_ctx, request, responder| {
            let s = thumb_state.clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(image_response(&s, &path, false))
            });
        })
        .register_asynchronous_uri_scheme_protocol("media", move |_ctx, request, responder| {
            let s = media_state.clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(image_response(&s, &path, true))
            });
        })
        .setup(move |app| {
            match init(&state.paths) {
                Ok(st) => {
                    let mut rt = state.rt.lock().unwrap();
                    rt.auto_purged = st.purged;
                    rt.new_accounts = st.new_accounts;
                }
                Err(e) => log::error!("Khởi tạo thất bại: {e}"),
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            take_auto_purged,
            take_new_accounts,
            accounts,
            roots,
            add_root,
            start_scan,
            stats,
            suggestions,
            conversations,
            conversation_months,
            set_alias,
            preview,
            cleanup_items,
            quarantine,
            jobs,
            restore,
            purge,
            export_report,
            export_log,
            open_item,
            disk_space,
            export_backup,
            import_backup,
        ])
        .run(tauri::generate_context!())
        .expect("không khởi động được Zola Cleaner");
}

#[cfg(test)]
mod tests {
    use super::sanitize_log;

    #[test]
    fn nhat_ky_khong_lo_duong_dan_va_id() {
        let line = r"Quét C:\Users\an\AppData\Roaming\ZaloData\media\9533337693992746410\ZaloDownloads xong: 123 file";
        assert_eq!(
            sanitize_log(line, r"C:\Users\an"),
            r"Quét %USERPROFILE%\AppData\Roaming\ZaloData\media\<id>\ZaloDownloads xong: 123 file"
        );
    }
}
