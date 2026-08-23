mod db;
mod error;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod scanner;
mod thumbnails;
mod voting;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::http::{StatusCode, Uri};
use tauri::{AppHandle, Emitter, Manager};

const SCAN_CHUNK_SIZE: usize = 256;

/// Concurrent thumbnail generations. The review grid requests fifty images at
/// once and a 4K decode holds tens of megabytes, so an unbounded thread per
/// request would spike memory and thrash the CPU.
const IMAGE_WORKER_FLOOR: usize = 2;
const IMAGE_WORKER_CEILING: usize = 8;

#[derive(Clone, Serialize)]
struct ScanProgress {
    scanned: u64,
    added: u64,
}

#[derive(Clone, Serialize)]
struct ScanComplete {
    added_count: u64,
    /// Files the walk found, whether or not they were new. Without this the UI
    /// cannot tell "this folder has no images" from "everything here is already
    /// in your library", and reports the second as the first.
    scanned_count: u64,
}

#[derive(Clone, Serialize)]
struct ScanFailed {
    message: String,
}

pub struct Db(pub Mutex<rusqlite::Connection>);

pub struct CacheDir(pub PathBuf);

/// Set while a scan thread is running, so a second `start_scan` is refused
/// rather than racing the first over the same connection.
#[derive(Default)]
pub struct ScanRunning(AtomicBool);

/// Clears [`ScanRunning`] however the scan thread ends, panic included —
/// otherwise one panicked scan would refuse every later scan for the rest of
/// the process.
struct ScanGuard(AppHandle);

impl Drop for ScanGuard {
    fn drop(&mut self) {
        self.0
            .state::<ScanRunning>()
            .0
            .store(false, Ordering::SeqCst);
    }
}

/// A fixed set of threads for `wallpaper://` requests.
///
/// The protocol handler must not decode images on the thread Tauri calls it on
/// — that is the UI thread, and a cache miss freezes the window for as long as
/// the decode takes.
pub struct ImageWorkers(std::sync::mpsc::Sender<Box<dyn FnOnce() + Send>>);

impl ImageWorkers {
    fn new(size: usize) -> Self {
        let (sender, receiver) = std::sync::mpsc::channel::<Box<dyn FnOnce() + Send>>();
        let receiver = Arc::new(Mutex::new(receiver));
        for _ in 0..size {
            let receiver = Arc::clone(&receiver);
            std::thread::spawn(move || loop {
                // The guard is released at the end of this statement, before the
                // job runs, so the workers queue rather than serialize.
                let job = match receiver.lock() {
                    Ok(receiver) => receiver.recv().ok(),
                    Err(_) => return,
                };
                match job {
                    Some(job) => job(),
                    None => return,
                }
            });
        }
        Self(sender)
    }

    fn submit(&self, job: impl FnOnce() + Send + 'static) -> bool {
        self.0.send(Box::new(job)).is_ok()
    }
}

fn image_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(IMAGE_WORKER_FLOOR)
        .clamp(IMAGE_WORKER_FLOOR, IMAGE_WORKER_CEILING)
}

/// Locks the connection, recovering from poisoning rather than bricking the app.
///
/// A panic anywhere under the guard would otherwise make every later database
/// call fail for the rest of the process. Nothing here leaves the connection
/// logically inconsistent — an in-flight transaction rolls back when its guard
/// drops — so reusing it is strictly better than refusing to work.
fn lock(db: &Db) -> MutexGuard<'_, rusqlite::Connection> {
    db.0.lock().unwrap_or_else(|poisoned| {
        db.0.clear_poison();
        poisoned.into_inner()
    })
}

fn lock_conn(state: tauri::State<'_, Db>) -> MutexGuard<'_, rusqlite::Connection> {
    lock(state.inner())
}

#[tauri::command]
fn get_pair(state: tauri::State<'_, Db>) -> Result<[voting::Wallpaper; 2], error::AppError> {
    let conn = lock_conn(state);
    voting::get_pair(&conn, &mut voting::SystemRng::new())
}

#[tauri::command]
fn vote(
    state: tauri::State<'_, Db>,
    winner_id: i64,
    loser_id: i64,
) -> Result<voting::VoteOutcome, error::AppError> {
    let conn = lock_conn(state);
    voting::vote(&conn, winner_id, loser_id, &mut voting::SystemRng::new())
}

#[tauri::command]
fn get_stats(state: tauri::State<'_, Db>) -> Result<voting::Stats, error::AppError> {
    let conn = lock_conn(state);
    voting::get_stats(&conn)
}

#[tauri::command]
fn start_scan(path: PathBuf, app: AppHandle) -> Result<(), error::AppError> {
    if !path.is_dir() {
        return Err(error::AppError::InvalidPath(path.display().to_string()));
    }
    // Canonical roots keep stored paths comparable: a library scanned as
    // `/home/me/./pics` must produce the same strings as one scanned as
    // `/home/me/pics`, or `UNIQUE(path)` sees two different wallpapers.
    let root = path.canonicalize().unwrap_or(path);

    if app.state::<ScanRunning>().0.swap(true, Ordering::SeqCst) {
        return Err(error::AppError::InvalidTransition(
            "a scan is already running".to_string(),
        ));
    }

    std::thread::spawn(move || {
        let _running = ScanGuard(app.clone());
        let files = scanner::collect_images(std::slice::from_ref(&root));
        let mut scanned: u64 = 0;
        let mut added: u64 = 0;
        let mut failure: Option<String> = None;

        for chunk in files.chunks(SCAN_CHUNK_SIZE) {
            let result = db::insert_new_wallpapers(&lock(&app.state::<Db>()), chunk);
            match result {
                Ok(n) => added += n as u64,
                Err(e) => {
                    // Surface it instead of only printing: a silent failure looks
                    // to the user exactly like an empty folder.
                    failure = Some(e.to_string());
                    break;
                }
            }
            scanned += chunk.len() as u64;
            let _ = app.emit("scan-progress", ScanProgress { scanned, added });
        }

        match failure {
            Some(message) => {
                let _ = app.emit("scan-failed", ScanFailed { message });
            }
            None => {
                let _ = app.emit(
                    "scan-complete",
                    ScanComplete {
                        added_count: added,
                        scanned_count: scanned,
                    },
                );
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn get_review(limit: i64, state: tauri::State<Db>) -> Result<Vec<db::Wallpaper>, error::AppError> {
    let conn = lock_conn(state);
    db::get_review(&conn, limit).map_err(Into::into)
}

#[tauri::command]
fn keep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<(), error::AppError> {
    let conn = lock_conn(state);
    db::keep_wallpaper(&conn, id)
}

#[tauri::command]
fn move_wallpaper(
    id: i64,
    destination_folder: String,
    state: tauri::State<Db>,
    cache_dir: tauri::State<CacheDir>,
) -> Result<(), error::AppError> {
    let conn = lock_conn(state);
    db::move_wallpaper(&conn, id, &destination_folder)?;
    // A Rejected wallpaper is out of both voting and review, so its cached
    // thumbnails are dead weight. Best-effort: the reject itself already stuck.
    if let Err(e) = thumbnails::purge(&conn, &cache_dir.0, id) {
        eprintln!("failed to purge thumbnails for wallpaper {id}: {e}");
    }
    Ok(())
}

/// Parses `wallpaper://localhost/image/{id}?size={size}`.
///
/// The `image` segment has to sit in the *path*. A custom-scheme URL parses as
/// `scheme://authority/path`, so `wallpaper://image/7` puts `image` in the
/// authority and leaves `/7` as the path — see `wallpaperImageUrl` in
/// `src/lib/client.ts`, which is the only place these URLs are built.
fn parse_image_request(uri: &Uri) -> Result<(i64, thumbnails::Size), error::AppError> {
    let segments: Vec<&str> = uri.path().trim_start_matches('/').split('/').collect();
    let ["image", id] = segments.as_slice() else {
        return Err(error::AppError::BadRequest(format!(
            "unexpected path {:?}",
            uri.path()
        )));
    };
    let wallpaper_id: i64 = id
        .parse()
        .map_err(|_| error::AppError::BadRequest(format!("malformed wallpaper id {id:?}")))?;
    let size = uri
        .query()
        .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("size=")))
        .and_then(thumbnails::Size::parse)
        .ok_or_else(|| {
            error::AppError::BadRequest(format!("missing or unknown size in {:?}", uri.query()))
        })?;
    Ok((wallpaper_id, size))
}

fn resolve_image(app: &AppHandle, uri: &Uri) -> Result<Vec<u8>, error::AppError> {
    let (wallpaper_id, size) = parse_image_request(uri)?;
    let db = app.state::<Db>();
    let cache_dir = app.state::<CacheDir>();

    // Three phases so the connection is free while the image work happens.
    let plan = thumbnails::plan(&lock(&db), wallpaper_id, size)?;
    let resolved = thumbnails::fulfill(&plan, &cache_dir.0)?;
    thumbnails::record(&lock(&db), &plan, &resolved)?;
    Ok(resolved.thumbnail.bytes)
}

fn image_response(status: StatusCode, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "image/jpeg")
        // Not `immutable`: the URL is keyed on id and size only, so a year-long
        // cache would outlive the mtime-based invalidation in `thumbnails`.
        // Revalidation costs a cache-file read, which is what we want anyway.
        .header(
            tauri::http::header::CACHE_CONTROL,
            "max-age=0, must-revalidate",
        )
        .body(body)
        .unwrap()
}

fn error_response(e: &error::AppError) -> tauri::http::Response<Vec<u8>> {
    let status = match e {
        error::AppError::InvalidPath(_) | error::AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
        error::AppError::NotFound(_) => StatusCode::NOT_FOUND,
        error::AppError::InvalidTransition(_) => StatusCode::CONFLICT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_vec(e).unwrap_or_default())
        .unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("walltare.db"))?;
            db::init_schema(&conn)?;
            let cache_dir = dir.join("thumbnails");
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(CacheDir(cache_dir));
            app.manage(Db(Mutex::new(conn)));
            app.manage(ScanRunning::default());
            app.manage(ImageWorkers::new(image_worker_count()));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("wallpaper", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().clone();
            let respond = move || {
                responder.respond(match resolve_image(&app, &uri) {
                    Ok(bytes) => image_response(StatusCode::OK, bytes),
                    Err(e) => error_response(&e),
                });
            };
            if !ctx.app_handle().state::<ImageWorkers>().submit(respond) {
                eprintln!("image worker pool is gone; dropping a wallpaper:// request");
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            get_pair,
            vote,
            get_stats,
            get_review,
            keep_wallpaper,
            move_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use thumbnails::Size;

    fn parse(url: &str) -> Result<(i64, Size), error::AppError> {
        parse_image_request(&url.parse::<Uri>().expect("test urls are well-formed"))
    }

    #[test]
    fn the_url_the_frontend_builds_is_the_url_this_handler_accepts() {
        // `wallpaperImageUrl` in src/lib/client.ts must keep producing this
        // shape. Without the `localhost` authority the scheme parser reads
        // `image` as the host and leaves `/7` as the whole path.
        assert_eq!(
            parse("wallpaper://localhost/image/7?size=medium").unwrap(),
            (7, Size::Medium)
        );
        assert_eq!(
            parse("wallpaper://localhost/image/42?size=small").unwrap(),
            (42, Size::Small)
        );
        // Windows rewrites custom schemes to `http://<scheme>.localhost/...`.
        assert_eq!(
            parse("http://wallpaper.localhost/image/7?size=full").unwrap(),
            (7, Size::Full)
        );
    }

    #[test]
    fn an_authority_shaped_url_is_rejected_rather_than_silently_mismatched() {
        // The shape the port originally shipped: every request 400ed on Linux
        // and macOS, so no wallpaper ever rendered.
        let err = parse("wallpaper://image/7?size=medium").unwrap_err();
        assert!(matches!(err, error::AppError::BadRequest(_)), "{err:?}");
    }

    #[test]
    fn malformed_requests_are_bad_requests() {
        for url in [
            "wallpaper://localhost/image/notanumber?size=small",
            "wallpaper://localhost/image/7?size=enormous",
            "wallpaper://localhost/image/7",
            "wallpaper://localhost/thumb/7?size=small",
            "wallpaper://localhost/image/7/extra?size=small",
        ] {
            let err = parse(url).unwrap_err();
            assert!(
                matches!(err, error::AppError::BadRequest(_)),
                "{url} gave {err:?}"
            );
        }
    }

    #[test]
    fn size_is_found_wherever_it_sits_in_the_query() {
        assert_eq!(
            parse("wallpaper://localhost/image/1?v=2&size=small").unwrap(),
            (1, Size::Small)
        );
    }
}
