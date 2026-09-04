mod db;
mod error;
mod paths;
mod pregen;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod scanner;
mod settings;
#[cfg(test)]
mod testing;
mod thumbnails;
mod voting;
mod window_state;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::http::{StatusCode, Uri};
use tauri::{AppHandle, Emitter, Manager};

use pregen::Pregen;

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
fn get_pair(
    state: tauri::State<'_, Db>,
    exclude: Option<Vec<i64>>,
) -> Result<[voting::Wallpaper; 2], error::AppError> {
    let conn = lock_conn(state);
    voting::get_pair(
        &conn,
        &exclude.unwrap_or_default(),
        &mut voting::SystemRng::new(),
    )
}

#[tauri::command]
fn vote(
    state: tauri::State<'_, Db>,
    winner_id: i64,
    loser_id: i64,
    exclude: Option<Vec<i64>>,
) -> Result<voting::VoteOutcome, error::AppError> {
    let conn = lock_conn(state);
    voting::vote(
        &conn,
        winner_id,
        loser_id,
        &exclude.unwrap_or_default(),
        &mut voting::SystemRng::new(),
    )
}

#[tauri::command]
fn get_stats(state: tauri::State<'_, Db>) -> Result<voting::Stats, error::AppError> {
    let conn = lock_conn(state);
    voting::get_stats(&conn)
}

/// Starts a scan of `path`, a Written path.
///
/// The parameter is a `String` rather than a `PathBuf` because a `PathBuf`
/// holding `~/pics` is a template, not a path: `is_dir()` on the unexpanded
/// string fails. The command's argument name is unchanged, and the frontend was
/// already sending a string.
#[tauri::command]
fn start_scan(path: String, app: AppHandle) -> Result<(), error::AppError> {
    // Before the guard below, so a malformed path costs the user nothing and
    // leaves no scan running.
    let root = scan_root(&path)?;

    if app.state::<ScanRunning>().0.swap(true, Ordering::SeqCst) {
        return Err(error::AppError::InvalidTransition(
            "a scan is already running".to_string(),
        ));
    }

    // A running pre-generation pass stands down, and does not hold up the scan
    // while it does. Its work list is a snapshot that the rows this scan is
    // about to insert make stale; the frontend restarts the pass on
    // `scan-complete`, which is what puts the new files at the head of the
    // queue (ADR 0012). Placed after the refusal above so a scan that never
    // starts cancels nothing.
    app.state::<Pregen>().cancel();

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

/// Expands a Written path, checks it is a directory, then canonicalizes it.
///
/// That order is the whole point. Expanding first is what makes `~/pics` and
/// `$XDG_PICTURES_DIR/walls` scannable at all, and canonicalizing last is what
/// keeps `~/pics`, `$HOME/pics` and `/home/me/./pics` from reaching three
/// libraries: stored paths are compared as strings, so `UNIQUE(path)` would see
/// the same file three times.
fn scan_root(path: &str) -> Result<PathBuf, error::AppError> {
    canonical_scan_root(paths::expand(path)?)
}

/// [`scan_root`] with the environment passed in, for the tests.
///
/// Same reason as [`paths::expand_with`]: the `~` case needs a known `HOME`, and
/// cargo runs tests as threads in one process, so mutating the environment would
/// race every other test in the crate. `db`'s tests reach
/// `resolve_destination_dir_with` for the same reason.
#[cfg(test)]
fn scan_root_with(
    path: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<PathBuf, error::AppError> {
    canonical_scan_root(paths::expand_with(path, lookup)?)
}

/// Everything after expansion: the directory check, then canonicalization.
fn canonical_scan_root(expanded: PathBuf) -> Result<PathBuf, error::AppError> {
    if !expanded.is_dir() {
        return Err(error::AppError::InvalidPath(expanded.display().to_string()));
    }
    // A hard error rather than a fallback to the un-canonicalized path. The
    // check above has already passed, so this only fires in exotic cases, and
    // storing the un-canonicalized string there is exactly the duplicate library
    // the canonicalization exists to prevent.
    expanded
        .canonicalize()
        .map_err(|_| error::AppError::InvalidPath(expanded.display().to_string()))
}

/// Starts generating the `small` and `medium` of every wallpaper that is short
/// of one, in the order the curator will reach them.
///
/// Returns as soon as the supervisor thread is spawned, so a launch pass costs
/// the boot no time at all. Any pass already running is cancelled and joined by
/// that supervisor rather than by this call.
///
/// The frontend owns the trigger, the way it already owns [`start_scan`]:
/// spawning from `setup()` would start decoding before the window paints,
/// competing with WebKit's startup for the first frame (ADR 0012).
#[tauri::command]
fn start_pregen(app: AppHandle) {
    std::thread::spawn(move || pregen::supervise(app));
}

/// Stands the running pass down and returns without waiting for it.
///
/// Everything already generated stays on disk and in the `thumbnails` table: a
/// partial cache is a correct cache, and the pass runs again next launch.
#[tauri::command]
fn cancel_pregen(state: tauri::State<'_, Pregen>) {
    state.cancel();
}

/// How much disk the thumbnail cache is holding, for the Settings readout.
///
/// A thin wrapper: the walk sits beside the rest of the cache in
/// [`thumbnails::cache_size`], which is also where its cost is written down.
/// ADR 0020 reads it on mount, on `pregen-complete` and after a clear, never per
/// progress event.
#[tauri::command]
fn get_cache_size(
    cache_dir: tauri::State<'_, CacheDir>,
) -> Result<thumbnails::CacheSize, error::AppError> {
    thumbnails::cache_size(&cache_dir.0)
}

/// Throws the whole thumbnail cache away, and does not start it building again.
///
/// Clearing is a rebuild rather than a way to reclaim disk: the next launch
/// refills it, because the pass has no opt-out (ADR 0012). `thumbnails::purge`
/// stays the single-wallpaper case.
#[tauri::command]
fn clear_cache(
    pregen: tauri::State<'_, Pregen>,
    db: tauri::State<'_, Db>,
    cache_dir: tauri::State<'_, CacheDir>,
) -> Result<(), error::AppError> {
    // Before anything is deleted, so a pass is not writing files into the
    // directory this is about to empty. It stands down between wallpapers and
    // this does not wait for it, so it can still finish the wallpaper it is on;
    // [`thumbnails::clear`] orders its two halves around exactly that.
    pregen.cancel();
    thumbnails::clear(&lock_conn(db), &cache_dir.0)
}

/// Where a Written path points, and whether a folder is there.
///
/// `exists` is `is_dir()`, so a file at that path reads as nothing there:
/// pointing a Library root at a JPEG is a typo rather than a state that deserves
/// its own sentence.
#[derive(Debug, Serialize)]
struct Expanded {
    resolved: String,
    exists: bool,
}

/// Answers what a Written path resolves to, so a curator reads their typo before
/// a file moves rather than after fifty of them have.
///
/// Creates nothing. [`paths::expand`] stays pure and this stats after it returns,
/// which is why there is no second `directory_exists` command: it would mean two
/// IPC round trips per edit of one string.
#[tauri::command]
fn expand_path(input: String) -> Result<Expanded, error::AppError> {
    let expanded = paths::expand(&input)?;
    Ok(Expanded {
        resolved: expanded.display().to_string(),
        exists: expanded.is_dir(),
    })
}

#[tauri::command]
fn get_settings(state: tauri::State<Db>) -> Result<settings::Settings, error::AppError> {
    let conn = lock_conn(state);
    settings::get(&conn)
}

/// Writes one setting and returns every setting, so a stale read cannot survive
/// a write.
///
/// The value crosses as a `String` because that is what the column holds;
/// `client.ts` keys the call on `keyof Settings` so callers stay typed.
#[tauri::command]
fn set_setting(
    key: String,
    value: String,
    state: tauri::State<Db>,
) -> Result<settings::Settings, error::AppError> {
    let conn = lock_conn(state);
    settings::set(&conn, &key, &value)
}

/// Every wallpaper matching a named filter, in a named ordering, at most `limit`
/// of them.
///
/// An optional count and no cursor: the library page omits it and takes the
/// whole list in one call (ADR 0016), Review passes fifty and takes a bounded
/// worklist (ADR 0028). The filter and the ordering arrive as enums, so an
/// unknown name fails at deserialization and never reaches the query — the
/// caller picks a name, and the backend owns every part of the `ORDER BY` (ADR
/// 0014). Omitting either lands on its default, All and Score high to low.
#[tauri::command]
fn list_wallpapers(
    filter: Option<db::StatusFilter>,
    ordering: Option<db::ListOrdering>,
    limit: Option<i64>,
    state: tauri::State<Db>,
) -> Result<Vec<db::Wallpaper>, error::AppError> {
    let conn = lock_conn(state);
    db::list_wallpapers(
        &conn,
        filter.unwrap_or_default(),
        ordering.unwrap_or_default(),
        limit,
    )
    .map_err(Into::into)
}

/// Keeps a wallpaper and answers with the row it wrote.
///
/// All four transitions answer with the row rather than with a path or with
/// nothing, so the frontend edits the row it is told about instead of predicting
/// one (ADR 0023).
#[tauri::command]
fn keep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    let conn = lock_conn(state);
    db::keep_wallpaper(&conn, id)
}

/// Undoes a Keep, putting the wallpaper back into review, and answers with the
/// row it wrote.
///
/// Nothing on disk moves, so the `status` column is the whole of what changed. A
/// Rejected wallpaper is refused: its file sits in the reject folder, and
/// `restore_wallpaper` is what brings it back.
#[tauri::command]
fn unkeep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    let conn = lock_conn(state);
    db::unkeep_wallpaper(&conn, id)
}

/// Soft-rejects a wallpaper and answers with the row it wrote: the path its file
/// landed at, which a collision may have suffixed, that path's basename, and the
/// Origin the reject recorded.
///
/// The thumbnails stay. A Rejected wallpaper used to be out of voting, out of
/// review and out of reach, so its cache was dead weight; now the library page
/// shows it and a Restore brings it back, while the row's `path` follows the
/// file and the move preserves its mtime, so the cache stays valid and
/// resolves exactly as before (ADR 0012).
#[tauri::command]
fn move_wallpaper(
    id: i64,
    destination_folder: String,
    state: tauri::State<Db>,
) -> Result<db::Wallpaper, error::AppError> {
    let conn = lock_conn(state);
    db::move_wallpaper(&conn, id, &destination_folder)
}

/// Undoes a soft reject and answers with the row it wrote: the file is back at
/// its Origin, which a collision there may have suffixed, and the Origin is
/// spent.
///
/// No pre-generation follows. A wallpaper rejected since the purge went still
/// has its cache, and one rejected before that has no Origin and cannot be
/// restored at all (ADR 0012).
#[tauri::command]
fn restore_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    let conn = lock_conn(state);
    db::restore_wallpaper(&conn, id)
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

    // Three phases so the connection is free while the image work happens
    // (ADR 0004), the same ordering `pregen::generate_one` keeps for the pass.
    let plan = thumbnails::plan(&lock(&db), wallpaper_id, size)?;
    let resolved = thumbnails::fulfill(&plan, &cache_dir.0)?;
    thumbnails::record(&lock(&db), &plan, &resolved)?;
    Ok(resolved.thumbnail.bytes)
}

fn image_response(status: StatusCode, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "image/jpeg")
        // Five minutes is measured against the only thing that invalidates a
        // thumbnail: the source file's mtime changing when someone edits a
        // wallpaper in place. That is rare enough that being five minutes stale
        // about it costs less than a versioning scheme.
        //
        // Not `immutable`: the URL is keyed on id and size only, so nothing in
        // it would change once the source file did.
        .header(tauri::http::header::CACHE_CONTROL, "max-age=300")
        .body(body)
        .unwrap()
}

fn error_response(e: &error::AppError) -> tauri::http::Response<Vec<u8>> {
    let status = match e {
        error::AppError::InvalidPath(_) | error::AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
        // `FileMissing` is a 404 for the same reason `NotFound` is: the thing
        // asked for is not there. The protocol handler cannot raise it — only a
        // Restore checks a source file before moving it — but a variant with no
        // arm here would fall through to a 500 the moment one does.
        error::AppError::NotFound(_) | error::AppError::FileMissing(_) => StatusCode::NOT_FOUND,
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
        .plugin(window_state::plugin())
        // The Browse button beside each path field on Settings. A folder picker
        // cannot be hand-rolled in a WebView, so this is a dependency rather
        // than a layout decision (ADR 0020). Unlike `window_state`, its `open`
        // command is called from the frontend, so `capabilities/default.json`
        // grants exactly that one.
        .plugin(tauri_plugin_dialog::init())
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
            app.manage(Pregen::default());
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
            start_pregen,
            cancel_pregen,
            get_cache_size,
            clear_cache,
            expand_path,
            get_pair,
            vote,
            get_stats,
            list_wallpapers,
            keep_wallpaper,
            unkeep_wallpaper,
            move_wallpaper,
            restore_wallpaper,
            get_settings,
            set_setting
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

    #[test]
    fn a_served_image_stays_cached_for_five_minutes() {
        // A remounted `<img>` for a wallpaper the user already scrolled past
        // must not cost another mpsc hop, mutex lock and cache-file read.
        // Lowering this value puts those back, so it is pinned.
        let response = image_response(StatusCode::OK, vec![0xff, 0xd8]);
        assert_eq!(
            response
                .headers()
                .get(tauri::http::header::CACHE_CONTROL)
                .unwrap(),
            "max-age=300"
        );
    }

    #[test]
    fn a_scan_root_is_canonicalized_so_one_library_keeps_one_spelling() {
        let dir = tempfile::tempdir().unwrap();
        let pics = dir.path().join("pics");
        std::fs::create_dir(&pics).unwrap();

        let written = format!("{}/./pics", dir.path().display());
        assert_eq!(scan_root(&written).unwrap(), pics.canonicalize().unwrap());
    }

    #[test]
    fn a_written_scan_root_expands_before_it_is_checked() {
        // `~/pics` is a template rather than a path, so `is_dir()` on the
        // unexpanded string fails — the reason the parameter is a `String`.
        //
        // `HOME` is a stand-in home folder rather than the real one, so nothing
        // here reads the process environment.
        let home = tempfile::tempdir().unwrap();
        let pics = home.path().join("pics");
        std::fs::create_dir(&pics).unwrap();

        let home_value = home.path().to_str().unwrap().to_string();
        let root = scan_root_with("~/pics", |name| {
            (name == "HOME").then(|| home_value.clone())
        })
        .unwrap();

        assert_eq!(root, pics.canonicalize().unwrap());
    }

    #[test]
    fn a_relative_scan_root_still_resolves_against_the_working_directory() {
        // What keeps `./test-wallpapers` working in development. `src` is this
        // crate's own source folder, and cargo runs tests from the crate root.
        let expected = std::env::current_dir().unwrap().join("src");
        assert_eq!(
            scan_root("./src").unwrap(),
            expected.canonicalize().unwrap()
        );
    }

    #[test]
    fn a_scan_root_naming_an_unset_variable_fails_with_the_variable_in_it() {
        // The message reaches the user verbatim, so it is the assertion.
        let err = scan_root("$WALLTARE_NO_SUCH_VARIABLE/pics").unwrap_err();
        assert!(
            matches!(err, error::AppError::InvalidPathSyntax(ref m)
                if m == "unknown environment variable WALLTARE_NO_SUCH_VARIABLE"),
            "got {err:?}"
        );
    }

    #[test]
    fn a_scan_root_that_is_not_a_directory_is_an_invalid_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.jpg");
        std::fs::write(&file, b"").unwrap();

        for input in [file, dir.path().join("nope")] {
            let written = input.display().to_string();
            let err = scan_root(&written).unwrap_err();
            assert!(
                matches!(err, error::AppError::InvalidPath(_)),
                "{written} gave {err:?}"
            );
        }
    }

    #[test]
    fn expand_path_answers_where_a_written_path_points_and_what_is_there() {
        let dir = tempfile::tempdir().unwrap();
        let written = dir.path().display().to_string();

        let expanded = expand_path(written.clone()).unwrap();
        // Unlike a scan root, the preview does not canonicalize: the user is
        // reading the path they typed, resolved, not a rewrite of it.
        assert_eq!(expanded.resolved, written);
        assert!(expanded.exists);
    }

    #[test]
    fn expand_path_reads_a_file_as_nothing_there_and_creates_nothing() {
        // Pointing a Library root at a JPEG is a typo rather than a state that
        // deserves its own sentence. The preview also runs while the user types,
        // so it must not create the folder it is describing.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.jpg");
        std::fs::write(&file, b"").unwrap();
        let missing = dir.path().join("nope");

        assert!(!expand_path(file.display().to_string()).unwrap().exists);
        assert!(!expand_path(missing.display().to_string()).unwrap().exists);
        assert!(!missing.exists());
    }

    #[test]
    fn expand_path_refuses_a_malformed_input_rather_than_resolving_it() {
        let err = expand_path("$WALLTARE_NO_SUCH_VARIABLE/pics".to_string()).unwrap_err();
        assert!(
            matches!(err, error::AppError::InvalidPathSyntax(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn expanded_crosses_the_ipc_with_the_fields_client_ts_expects() {
        let dir = tempfile::tempdir().unwrap();
        let written = dir.path().display().to_string();

        let json = serde_json::to_value(expand_path(written.clone()).unwrap()).unwrap();
        assert_eq!(json["resolved"], written);
        assert_eq!(json["exists"], true);
    }
}
