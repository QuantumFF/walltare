mod db;
mod error;
mod missing;
mod paths;
mod pregen;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod reject_destination;
mod scan;
mod scanner;
mod serving;
mod settings;
mod soft_reject;
#[cfg(test)]
mod testing;
mod thumbnails;
mod voting;
mod window_state;

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::http::Uri;
use tauri::{AppHandle, Emitter, Manager};

use pregen::Pregen;
use thumbnails::ThumbnailCache;

/// The one SQLite connection, reachable only for the length of a query.
///
/// The whole interface is [`Db::read`] and [`Db::write`], each of which lends
/// the connection to a closure and hands back what the closure returns. There
/// is no accessor for the `Mutex` and no way to come away holding a guard: the
/// return type is chosen by the caller before the borrow exists, so a closure
/// that tried to return the connection, a `MutexGuard` or a `Statement` would
/// have to name a lifetime it cannot name.
///
/// That is the point. A `stat` per row under this mutex queues every command
/// and every `wallpaper://` request behind a walk of somebody's external drive
/// — `missing.rs` spends twelve lines saying so, and `thumbnails::work_list`
/// did it anyway for as long as the rule lived only in that prose. The types
/// now hold the half of the rule that can be held: the borrow cannot leave the
/// closure. What is left for a reader is the other half, which is short enough
/// to keep — *nothing called inside one of these closures touches the
/// filesystem* (ADR 0039).
pub struct Db(Mutex<rusqlite::Connection>);

impl Db {
    pub fn new(conn: rusqlite::Connection) -> Self {
        Self(Mutex::new(conn))
    }

    /// Runs a query and answers with what it read.
    pub fn read<T>(&self, query: impl FnOnce(&rusqlite::Connection) -> T) -> T {
        query(&self.connection())
    }

    /// Runs a statement that writes, and answers with whatever it reports.
    ///
    /// Mechanically [`Db::read`]: one connection means one mutex, and SQLite
    /// serializes the two the same way. The name is what the call site says
    /// about itself, and it is the seam a change that treats them differently
    /// would land on — a second connection for readers, or a `BEGIN IMMEDIATE`
    /// around the write — without every caller being revisited.
    pub fn write<T>(&self, statement: impl FnOnce(&rusqlite::Connection) -> T) -> T {
        statement(&self.connection())
    }

    /// Locks the connection, recovering from poisoning rather than bricking the
    /// app.
    ///
    /// A panic anywhere under the guard would otherwise make every later
    /// database call fail for the rest of the process. Nothing here leaves the
    /// connection logically inconsistent — an in-flight transaction rolls back
    /// when its guard drops — so reusing it is strictly better than refusing to
    /// work.
    fn connection(&self) -> MutexGuard<'_, rusqlite::Connection> {
        self.0.lock().unwrap_or_else(|poisoned| {
            self.0.clear_poison();
            poisoned.into_inner()
        })
    }

    /// Whether the connection is unheld at this instant.
    ///
    /// The one thing that can observe the half of ADR 0039's rule the types do
    /// not hold. A released guard leaves no trace, but a `try_lock` from the
    /// thread that would be holding it fails, which is what
    /// `thumbnails::the_connection_is_free_while_the_image_work_happens` asserts
    /// about ADR 0004's phase two. Tests only: production code that asks this
    /// question is deciding whether to wait, which is the mutex's job.
    #[cfg(test)]
    pub fn is_free(&self) -> bool {
        self.0.try_lock().is_ok()
    }
}

#[tauri::command]
fn get_pair(
    state: tauri::State<'_, Db>,
    exclude: Option<Vec<i64>>,
) -> Result<[voting::Wallpaper; 2], error::AppError> {
    state.read(|conn| {
        voting::get_pair(
            conn,
            &exclude.unwrap_or_default(),
            &mut voting::SystemRng::new(),
        )
    })
}

#[tauri::command]
fn vote(
    state: tauri::State<'_, Db>,
    winner_id: i64,
    loser_id: i64,
    exclude: Option<Vec<i64>>,
) -> Result<voting::VoteOutcome, error::AppError> {
    state.write(|conn| {
        voting::vote(
            conn,
            winner_id,
            loser_id,
            &exclude.unwrap_or_default(),
            &mut voting::SystemRng::new(),
        )
    })
}

#[tauri::command]
fn get_stats(state: tauri::State<'_, Db>) -> Result<voting::Stats, error::AppError> {
    state.read(voting::get_stats)
}

/// Starts a scan of `path`, a Written path.
///
/// The parameter is a `String` rather than a `PathBuf` because a `PathBuf`
/// holding `~/pics` is a template, not a path: `is_dir()` on the unexpanded
/// string fails. The command's argument name is unchanged, and the frontend was
/// already sending a string.
///
/// Two failures, and they are answered in two places, because they are two
/// different kinds of thing. A Written path that cannot be expanded is a fact
/// about the string the curator is typing, so it is refused here, before
/// anything starts, and Settings prints it under the field. Whether a folder is
/// there is a fact about the world at the moment the walk begins, and
/// `CONTEXT.md` says the Library root is a stated preference rather than a fact
/// about the library — it can point somewhere that no longer exists. So that one
/// is the scan's own ending, reported on `scan-failed` wherever the curator has
/// wandered to (ADR 0021, ADR 0034).
#[tauri::command]
fn start_scan(path: String, app: AppHandle) -> Result<(), error::AppError> {
    // Before the guard below, so a malformed path costs the curator nothing and
    // leaves no scan running.
    let root = scan::LibraryRoot::expand(&path)?;

    let Some(running) = app.state::<scan::Running>().try_start() else {
        return Err(error::AppError::InvalidTransition(
            "a scan is already running".to_string(),
        ));
    };

    std::thread::spawn(move || {
        let _running = running;
        scan::run(&app.state::<Db>(), root, &ScanEvents(&app));
    });
    Ok(())
}

/// The real scan report: the three events the frontend listens for, and the
/// pre-generation pass standing down once the scan has really begun.
struct ScanEvents<'a>(&'a AppHandle);

impl scan::Report for ScanEvents<'_> {
    fn began(&self) {
        // A running pre-generation pass stands down, and does not hold up the
        // scan while it does. Its work list is a snapshot that the rows this
        // scan is about to insert make stale; the frontend restarts the pass on
        // `scan-complete`, which is what puts the new files at the head of the
        // queue (ADR 0012). Only once the root resolves, which is what
        // `scan::run` guarantees by calling this where it does (ADR 0034).
        self.0.state::<Pregen>().cancel();
    }

    fn progress(&self, progress: scan::Progress) {
        let _ = self.0.emit("scan-progress", progress);
    }

    fn complete(&self, complete: scan::Complete) {
        let _ = self.0.emit("scan-complete", complete);
    }

    fn failed(&self, failed: scan::Failed) {
        let _ = self.0.emit("scan-failed", failed);
    }
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
/// A thin wrapper over [`ThumbnailCache::size`], which is also where its cost is
/// written down. ADR 0020 reads it on mount, on `pregen-complete` and after a
/// clear, never per progress event.
#[tauri::command]
fn get_cache_size(
    thumbnails: tauri::State<'_, ThumbnailCache>,
) -> Result<thumbnails::CacheSize, error::AppError> {
    thumbnails.size()
}

/// Throws the whole thumbnail cache away, and does not start it building again.
///
/// Clearing is a rebuild rather than a way to reclaim disk: the next launch
/// refills it, because the pass has no opt-out (ADR 0012).
#[tauri::command]
fn clear_cache(
    pregen: tauri::State<'_, Pregen>,
    db: tauri::State<'_, Db>,
    thumbnails: tauri::State<'_, ThumbnailCache>,
) -> Result<(), error::AppError> {
    // Before anything is deleted, so a pass is not writing files into the
    // directory this is about to empty. It stands down between wallpapers and
    // this does not wait for it, so it can still finish the wallpaper it is on;
    // what gets deleted in which order around exactly that is
    // [`ThumbnailCache::clear`]'s, and written down there.
    pregen.cancel();
    thumbnails.clear(&db)
}

/// How many Eligible wallpapers have no file behind them, for the Settings
/// read-out.
///
/// A thin wrapper over the two halves of [`missing`], called in the order that
/// module documents: the pool comes off the database, and the `stat` per row
/// happens with the connection already released. That ordering is ADR 0004's —
/// [`Db::read`] drops the guard before it returns, so 5,000 filesystem calls do
/// not queue every command and every `wallpaper://` request behind them
/// (ADR 0039).
///
/// Nothing calls this but the button the curator presses. A listing does no
/// filesystem work at all, and the card's own answer to a missing file is the
/// `wallpaper://` request it was already making (ADR 0032).
#[tauri::command]
fn count_missing_files(
    state: tauri::State<'_, Db>,
) -> Result<missing::MissingFiles, error::AppError> {
    let paths = state.read(missing::eligible_paths)?;
    Ok(missing::count_missing(&paths))
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

/// Whether the Soft reject destination the curator is writing can take a file.
///
/// The second half of the pair with [`expand_path`], and a separate command
/// rather than a field on that one because the two questions have different
/// costs. `expand_path` reads the environment and stats, and the Library root's
/// field must stay that cheap and that harmless; this one writes a probe file
/// into the folder and takes it away again, which is the only way to know
/// whether a reject could land there (ADR 0035).
///
/// It creates no destination. Only a reject does that (ADR 0003), so a curator
/// typing their way to `~/pics/rejected` does not leave a folder behind for
/// every prefix on the way.
#[tauri::command]
fn check_reject_destination(written: String) -> Result<reject_destination::Check, error::AppError> {
    reject_destination::check(&written)
}

#[tauri::command]
fn get_settings(
    state: tauri::State<Db>,
    detected: tauri::State<settings::Detected>,
) -> Result<settings::Settings, error::AppError> {
    let detected = *detected;
    state.read(|conn| settings::get(conn, detected))
}

/// Writes one setting and returns every setting, so a stale read cannot survive
/// a write.
///
/// The value crosses as a `String` because that is what the column holds;
/// `client.ts` keys the call on `SettingKey` so callers stay typed.
#[tauri::command]
fn set_setting(
    key: String,
    value: String,
    state: tauri::State<Db>,
    detected: tauri::State<settings::Detected>,
) -> Result<settings::Settings, error::AppError> {
    let detected = *detected;
    state.write(|conn| settings::set(conn, &key, &value, detected))
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
    state
        .read(|conn| {
            db::list_wallpapers(
                conn,
                filter.unwrap_or_default(),
                ordering.unwrap_or_default(),
                limit,
            )
        })
        .map_err(Into::into)
}

/// Keeps a wallpaper and answers with the row it wrote.
///
/// All four transitions answer with the row rather than with a path or with
/// nothing, so the frontend edits the row it is told about instead of predicting
/// one (ADR 0023).
#[tauri::command]
fn keep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    state.write(|conn| db::keep_wallpaper(conn, id))
}

/// Undoes a Keep, putting the wallpaper back into review, and answers with the
/// row it wrote.
///
/// Nothing on disk moves, so the `status` column is the whole of what changed. A
/// Rejected wallpaper is refused: its file sits in the reject folder, and
/// `restore_wallpaper` is what brings it back.
#[tauri::command]
fn unkeep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    state.write(|conn| db::unkeep_wallpaper(conn, id))
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
///
/// The one place the connection is deliberately held across a filesystem call,
/// and ADR 0003 is why: the row is written first inside a transaction and the
/// file moves last, so a `UNIQUE(path)` collision aborts while the disk is
/// still untouched. That ordering cannot survive releasing the connection in
/// the middle of it. It is one `rename` of one file that the curator is waiting
/// on, rather than a walk of the whole library (ADR 0039).
#[tauri::command]
fn move_wallpaper(
    id: i64,
    destination_folder: String,
    state: tauri::State<Db>,
) -> Result<db::Wallpaper, error::AppError> {
    state.write(|conn| soft_reject::reject(conn, id, &destination_folder))
}

/// Undoes a soft reject and answers with the row it wrote: the file is back at
/// its Origin, which a collision there may have suffixed, and the Origin is
/// spent.
///
/// No pre-generation follows. A wallpaper rejected since the purge went still
/// has its cache, and one rejected before that has no Origin and cannot be
/// restored at all (ADR 0012).
///
/// Holds the connection across the move back, for [`move_wallpaper`]'s reason:
/// the ordering is that one run backwards, and it is the same single `rename`.
#[tauri::command]
fn restore_wallpaper(id: i64, state: tauri::State<Db>) -> Result<db::Wallpaper, error::AppError> {
    state.write(|conn| soft_reject::restore(conn, id))
}

/// Parses `wallpaper://localhost/image/{id}?size={size}`.
///
/// The whole of what the protocol closure does before [`serving::serve`] takes
/// over, and the result crosses as a `Result` rather than being unwrapped here:
/// a URL that named no wallpaper still has to be answered, and what status it is
/// answered with belongs beside every other response the webview gets.
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

/// What the curator reads when their database was written by a newer walltare.
///
/// A pure function so the copy is testable: the versions are the whole point of
/// the message, and a dialog cannot be asserted on.
fn refusal_message(database: i64, app: i64) -> String {
    format!(
        "Your library was written by a newer version of walltare.\n\n\
         The database is at schema version {database}. This walltare understands \
         version {app}, and it cannot read a shape it has never seen.\n\n\
         Nothing has been changed. Install the newer walltare again to open this \
         library — your Comparisons are all in there, and they are permanent."
    )
}

/// Reports a refused database and exits.
///
/// A native dialog rather than a React screen: the database is the app, so there
/// is nothing behind the message to render, and no recovery to offer — the
/// curator downgrades the database or reinstalls the newer walltare, and neither
/// happens in here (issue #199). A log line would be invisible to somebody
/// launching from a desktop menu.
fn refuse_the_database(app: &AppHandle, database: i64, supported: i64) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    // The window is built from the config before `setup` runs, so it already
    // exists. Hiding it leaves the dialog as the whole of the app rather than a
    // window with no database behind it.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // `show` rather than `blocking_show`: both hand the dialog to the event
    // loop, which starts only once `setup` returns, so blocking here would wait
    // on a loop that is waiting on us. The callback runs off the main thread
    // when the curator dismisses it, and the process ends there.
    app.dialog()
        .message(refusal_message(database, supported))
        .kind(MessageDialogKind::Error)
        .title("walltare cannot open this library")
        .show(|_| std::process::exit(1));
}

/// What the primary monitor says it is, which is the default behind the screen
/// setting.
///
/// The one place in the app that can ask, which is why the answer is threaded
/// into `settings` rather than read there. Detection failing is not an error
/// state and never fails the launch: the curator gets
/// [`settings::FALLBACK_SCREEN`] and a field in Settings to correct it, which is
/// the same field a curator with a working monitor and a different opinion uses.
///
/// The primary monitor rather than the one the window happens to be on. Which
/// monitor a multi-monitor curator meant is a question the screen setting exists
/// to answer, and guessing it from a window position would change the default
/// every time they dragged the app across.
fn detect_screen(app: &AppHandle) -> settings::Detected {
    // Physical pixels, which is what a wallpaper's own Dimensions are measured
    // in. A scale factor belongs to how big things look, not to how big the
    // Screen is.
    //
    // What each answer means is `Detected::from_monitor`'s, which is where it
    // can be tested: this reaches for the monitor and says out loud what it
    // found, and nothing here decides anything.
    let measured = match app.primary_monitor() {
        Ok(Some(monitor)) => {
            let size = monitor.size();
            // The same rule `from_monitor` applies, asked rather than restated,
            // so the log cannot come to disagree with the decision.
            if settings::Resolution::new(size.width, size.height).is_none() {
                eprintln!(
                    "settings: the primary monitor reports {}x{}; using the fallback screen",
                    size.width, size.height
                );
            }
            Some((size.width, size.height))
        }
        Ok(None) => {
            eprintln!("settings: no primary monitor; using the fallback screen");
            None
        }
        Err(error) => {
            eprintln!(
                "settings: could not read the primary monitor ({error}); using the fallback screen"
            );
            None
        }
    };

    settings::Detected::from_monitor(measured)
}

/// Where the database and the thumbnail cache live: the app data dir, unless
/// `WALLTARE_DATA_DIR` names another. `bun run dev:app` sets it to a directory
/// inside the checkout, so a worktree's build never migrates the database the
/// installed app and every other checkout open (ADR 0048).
fn data_dir(app: &AppHandle) -> tauri::Result<std::path::PathBuf> {
    match std::env::var_os("WALLTARE_DATA_DIR").filter(|dir| !dir.is_empty()) {
        Some(dir) => Ok(dir.into()),
        None => app.path().app_data_dir(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(window_state::plugin())
        // The Browse button beside each path field on Settings. A folder picker
        // cannot be hand-rolled in a WebView, so this is a dependency rather
        // than a layout decision (ADR 0020). Unlike `window_state`, its `open`
        // command is called from the frontend, so `capabilities/default.json`
        // grants exactly that one.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = data_dir(app.handle())?;
            std::fs::create_dir_all(&dir)?;
            let conn = match db::open(&dir.join("walltare.db")) {
                Ok(conn) => conn,
                // The refusal is the end of the launch: the dialog is up, the
                // window is hidden, and the process exits when it is dismissed.
                // Returning here is what keeps the rest of the setup — the
                // schema, the caches, the state — from running against a
                // database this build cannot read.
                Err(db::OpenError::FromTheFuture {
                    database,
                    app: supported,
                }) => {
                    refuse_the_database(app.handle(), database, supported);
                    return Ok(());
                }
                Err(db::OpenError::Db(e)) => return Err(e.into()),
            };
            db::init_schema(&conn)?;
            let cache_dir = dir.join("thumbnails");
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(ThumbnailCache::new(cache_dir));
            app.manage(Db::new(conn));
            // Read once, here, rather than on every settings call: it is the
            // default behind a stored preference, and a monitor swap is a
            // restart away from being noticed either way.
            app.manage(detect_screen(app.handle()));
            app.manage(scan::Running::default());
            app.manage(Pregen::default());
            serving::start(app.handle());
            Ok(())
        })
        // Reads the URL and hands what it says to [`serving::serve`]. Nothing
        // else: the pool, the headers and the statuses are that module's, and so
        // are two of the three answers
        // [#224](https://github.com/QuantumFF/walltare/issues/224) was owed —
        // the order requests are served in, and one answer for two identical
        // requests. The third, the bytes kept in memory, sits behind the
        // thumbnail cache with ADR 0004's three phases (ADR 0040, #280). None of
        // them landed as a change to this closure.
        .register_asynchronous_uri_scheme_protocol("wallpaper", |ctx, request, responder| {
            serving::serve(
                ctx.app_handle(),
                parse_image_request(request.uri()),
                responder,
            );
        })
        .invoke_handler(tauri::generate_handler![
            start_scan,
            start_pregen,
            cancel_pregen,
            get_cache_size,
            clear_cache,
            count_missing_files,
            expand_path,
            check_reject_destination,
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
    fn a_panic_under_the_connection_leaves_it_usable_rather_than_poisoned() {
        // What `Db::connection` recovers from, and the reason it does: a panic
        // anywhere under the guard would otherwise make every later database
        // call fail for the rest of the process, so one bad query would brick
        // the app until the curator restarted it.
        let db = Db::new(rusqlite::Connection::open_in_memory().unwrap());

        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            db.read(|_| panic!("a query panicked"));
        }));

        assert!(panicked.is_err(), "the panic reached the caller");
        assert_eq!(
            db.read(|conn| conn
                .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .unwrap()),
            1
        );
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

    /// The configured content security policy, directive by directive, read
    /// out of the `tauri.conf.json` this crate actually ships.
    fn content_security_policy() -> Vec<(String, Vec<String>)> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).expect("the config is readable"))
                .expect("the config is well-formed JSON");
        let csp = config["app"]["security"]["csp"]
            .as_str()
            .expect("a content security policy is set")
            .to_owned();
        csp.split(';')
            .filter_map(|directive| {
                let mut words = directive.split_whitespace().map(str::to_owned);
                Some((words.next()?, words.collect()))
            })
            .collect()
    }

    #[test]
    fn the_policy_lets_the_wallpaper_protocol_through() {
        // The other half of the pairing in
        // `the_url_the_frontend_builds_is_the_url_this_handler_accepts`: the
        // handler can answer every request the frontend makes and still render
        // blank cards, because the webview never sends the request. A missing
        // `wallpaper:` here has no symptom a test can otherwise see.
        let policy = content_security_policy();
        let (_, sources) = policy
            .iter()
            .find(|(name, _)| name == "img-src")
            .expect("the policy names img-src");
        assert!(
            sources.iter().any(|source| source == "wallpaper:"),
            "img-src {sources:?} does not allow the wallpaper protocol"
        );
    }

    #[test]
    fn the_policy_names_no_remote_origin() {
        // An allowlist rather than a pattern, so that widening the policy has
        // to be argued for here as well as in the config.
        for (directive, sources) in content_security_policy() {
            for source in sources {
                let local = matches!(
                    source.as_str(),
                    "'self'" | "'none'" | "'unsafe-inline'" | "ipc:" | "wallpaper:"
                );
                assert!(local, "{directive} allows {source}, which is not local");
            }
        }
    }

    #[test]
    fn the_refusal_names_both_versions_and_says_what_to_do() {
        // The dialog is the only thing the curator gets on this path, so the two
        // numbers and the instruction are the whole of what it has to carry. A
        // message naming one version tells them nothing they can act on.
        let message = refusal_message(4, 3);
        assert!(message.contains("schema version 4"), "{message}");
        assert!(message.contains("version 3"), "{message}");
        assert!(message.contains("Nothing has been changed"), "{message}");
        assert!(message.contains("Install the newer walltare"), "{message}");
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
