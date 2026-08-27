mod db;
mod error;
mod paths;
pub mod ranking; // consumed by later voting slices; kept Tauri-free
mod scanner;
mod settings;
mod thumbnails;
mod voting;
mod window_state;

use std::path::{Path, PathBuf};
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

/// How far through its work list the pre-generation pass is.
///
/// `total` rides along on every emission rather than arriving once in a start
/// event, so a listener that missed the first one still knows what it is a
/// fraction of.
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
struct PregenProgress {
    done: u64,
    total: u64,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
struct PregenComplete {
    generated: u64,
    /// Wallpapers whose source was gone or would not decode. One bad file
    /// stops nothing, so this is a count rather than an error.
    failed: u64,
    cancelled: bool,
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

/// A pre-generation pass in flight: its cancel flag and its thread.
type Run = (Arc<AtomicBool>, std::thread::JoinHandle<()>);

/// The pre-generation pass currently running, if any.
///
/// `Some` is the running state, so there is no [`ScanRunning`]-style bool
/// beside it. The cancel flag is per run rather than global, so a cancel aimed
/// at one pass cannot land on the pass that starts a moment later (ADR 0012).
#[derive(Default)]
pub struct Pregen(Mutex<Option<Run>>);

impl Pregen {
    /// The running pass, recovering from poisoning for [`lock`]'s reason.
    ///
    /// Held across the join in [`supervise_pregen`], which is what makes two
    /// `start_pregen` calls queue up here instead of racing.
    fn current(&self) -> MutexGuard<'_, Option<Run>> {
        self.0.lock().unwrap_or_else(|poisoned| {
            self.0.clear_poison();
            poisoned.into_inner()
        })
    }

    /// The running pass, or `None` when another thread holds the mutex.
    ///
    /// The pass's own thread clears its entry through this rather than through
    /// [`Pregen::current`]: a second `start_pregen` holds the mutex while it
    /// joins that very thread, so blocking there would deadlock the two.
    fn try_current(&self) -> Option<MutexGuard<'_, Option<Run>>> {
        match self.0.try_lock() {
            Ok(current) => Some(current),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                self.0.clear_poison();
                Some(poisoned.into_inner())
            }
            Err(std::sync::TryLockError::WouldBlock) => None,
        }
    }

    /// Sets the running pass's cancel flag and returns.
    ///
    /// Never joins. The flag is read between wallpapers and the `image` crate
    /// cannot be interrupted mid-decode, so waiting here would block an IPC
    /// call for up to one wallpaper's decode. A cancel therefore lands up to
    /// one decode late, and both callers are fine with that: everything already
    /// generated stays on disk either way.
    fn cancel(&self) {
        if let Some((flag, _)) = self.current().as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Clears a pass's entry in [`Pregen`] however its thread ends, panic included
/// — [`ScanGuard`]'s reasoning, with an entry in place of a bool. An entry that
/// outlived its thread would leave `cancel_pregen` setting a flag nothing reads
/// and reporting a pass that has already stopped.
struct PregenGuard {
    app: AppHandle,
    flag: Arc<AtomicBool>,
}

impl Drop for PregenGuard {
    fn drop(&mut self) {
        let pregen = self.app.state::<Pregen>();
        let Some(mut current) = pregen.try_current() else {
            // A successor is joining this thread and already took the entry as
            // part of doing so, so there is nothing here to clear.
            return;
        };
        // Only this run's own entry. A successor that installed itself while
        // this thread was finishing owns the slot now.
        if matches!(current.as_ref(), Some((flag, _)) if Arc::ptr_eq(flag, &self.flag)) {
            *current = None;
        }
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
    std::thread::spawn(move || supervise_pregen(app));
}

/// Stands the running pass down and returns without waiting for it.
///
/// Everything already generated stays on disk and in the `thumbnails` table: a
/// partial cache is a correct cache, and the pass runs again next launch.
#[tauri::command]
fn cancel_pregen(state: tauri::State<'_, Pregen>) {
    state.cancel();
}

/// Retires the previous pass and installs a new one.
///
/// On its own thread because both halves of that block: the join waits for up
/// to one wallpaper's decode, and the [`Pregen`] mutex is held across it, so two
/// `start_pregen` calls serialize here instead of racing over the same state.
fn supervise_pregen(app: AppHandle) {
    let pregen = app.state::<Pregen>();
    let mut current = pregen.current();

    if let Some((flag, handle)) = current.take() {
        flag.store(true, Ordering::SeqCst);
        // A pass that panicked is a pass that has stopped, which is all this
        // join wants to know.
        let _ = handle.join();
    }

    let flag = Arc::new(AtomicBool::new(false));
    let handle = {
        let app = app.clone();
        let flag = Arc::clone(&flag);
        std::thread::spawn(move || {
            let _clear = PregenGuard {
                app: app.clone(),
                flag: Arc::clone(&flag),
            };
            run_pregen(&app, &flag);
        })
    };
    *current = Some((flag, handle));
}

/// Builds the work list, then runs it.
///
/// A work list that cannot be built emits nothing. The only way that happens is
/// the database being gone, which is already fatal everywhere else, so there is
/// no `pregen-failed` event for it (ADR 0012).
fn run_pregen(app: &AppHandle, cancel: &AtomicBool) {
    let db = app.state::<Db>();
    let cache_dir = app.state::<CacheDir>();

    let work = match thumbnails::work_list(&lock(&db), &cache_dir.0) {
        Ok(work) => work,
        Err(e) => {
            eprintln!("pre-generation could not read the library: {e}");
            return;
        }
    };
    pregen_pass(&db, &cache_dir.0, &work, cancel, &EventReport(app));
}

/// Where a pass reports to.
///
/// A parameter rather than an `AppHandle` reached through the state, so the pass
/// and its per-wallpaper step are drivable from a test: an `AppHandle` only
/// exists inside a running Tauri app, and the counting is worth asserting on
/// without one.
trait PregenReport {
    fn progress(&self, progress: PregenProgress);
    fn complete(&self, complete: PregenComplete);
}

/// The real report: the two events the frontend listens for.
struct EventReport<'a>(&'a AppHandle);

impl PregenReport for EventReport<'_> {
    fn progress(&self, progress: PregenProgress) {
        let _ = self.0.emit("pregen-progress", progress);
    }

    fn complete(&self, complete: PregenComplete) {
        let _ = self.0.emit("pregen-complete", complete);
    }
}

/// What a pass has done so far.
#[derive(Default, Debug, PartialEq, Eq)]
struct PregenTally {
    generated: u64,
    failed: u64,
    /// Wallpapers rejected between the work list and their own turn in it. Not
    /// reported: the curator who rejected one knows, and a count of
    /// their own rejects tells them nothing about the cache.
    skipped: u64,
}

impl PregenTally {
    /// Wallpapers the pass is finished with, whichever way each of them went.
    /// What `pregen-progress` counts, so the bar reaches its total.
    fn done(&self) -> u64 {
        self.generated + self.failed + self.skipped
    }
}

/// Runs a work list, one wallpaper at a time, reporting as it goes.
///
/// Each wallpaper finishes before the next starts, so a cancelled pass leaves a
/// clean prefix: fully warm, in the order the curator will reach it. The cancel
/// flag is read between wallpapers, never inside one.
///
/// An empty work list — every launch after the first — emits nothing at all,
/// rather than flashing a finished progress bar for work that never happened.
fn pregen_pass(
    db: &Db,
    cache_dir: &Path,
    work: &[thumbnails::Pending],
    cancel: &AtomicBool,
    report: &impl PregenReport,
) {
    if work.is_empty() {
        return;
    }

    let total = work.len() as u64;
    let mut tally = PregenTally::default();
    // Before the first wallpaper, so a bar can appear immediately instead of
    // after a two-second decode.
    report.progress(PregenProgress { done: 0, total });

    let mut cancelled = false;
    for pending in work {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        pregen_one(db, cache_dir, pending, &mut tally);
        report.progress(PregenProgress {
            done: tally.done(),
            total,
        });
    }

    report.complete(PregenComplete {
        generated: tally.generated,
        failed: tally.failed,
        cancelled,
    });
}

/// One wallpaper, and the only part of the pass a test drives directly.
///
/// A missing or undecodable source is counted and left behind, because one bad
/// file must not stop a pass over the whole library.
fn pregen_one(db: &Db, cache_dir: &Path, pending: &thumbnails::Pending, tally: &mut PregenTally) {
    match generate_one(db, cache_dir, pending) {
        Ok(Step::Generated) => tally.generated += 1,
        Ok(Step::Skipped) => tally.skipped += 1,
        Err(e) => {
            eprintln!("pre-generation skipped {}: {e}", pending.source.display());
            tally.failed += 1;
        }
    }
}

/// Which way one wallpaper went, short of an error.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    Generated,
    Skipped,
}

/// Generates whichever sizes one wallpaper is short of.
///
/// The connection is taken for the reads and again for the writes, and is never
/// held across a decode (ADR 0004). Both sizes missing is the single decode
/// [`thumbnails::generate_both`] exists for; one size missing goes through
/// `plan` / `fulfill` / `record`, so the cached size beside it donates its
/// pixels instead of the source being decoded a second time.
fn generate_one(
    db: &Db,
    cache_dir: &Path,
    pending: &thumbnails::Pending,
) -> Result<Step, error::AppError> {
    let id = pending.wallpaper_id;
    match pending.missing {
        thumbnails::Missing::Both => {
            let source = {
                let conn = lock(db);
                match still_due(&conn, pending) {
                    Some(source) => source,
                    None => return Ok(Step::Skipped),
                }
            };
            let recorded = thumbnails::generate_both(id, &source, cache_dir)?;
            let conn = lock(db);
            for r in recorded {
                thumbnails::record_one(&conn, id, r.size, r.width, r.height, r.source_mtime)?;
            }
            Ok(Step::Generated)
        }
        thumbnails::Missing::Only(size) => {
            let plan = {
                // The same lock the plan's own read takes, which is the point:
                // the Status the pass acts on and the path it acts on come from
                // one view of the row. The path this drops is the one `plan`
                // reads for itself a line later.
                let conn = lock(db);
                if still_due(&conn, pending).is_none() {
                    return Ok(Step::Skipped);
                }
                thumbnails::plan(&conn, id, size)?
            };
            let resolved = thumbnails::fulfill(&plan, cache_dir)?;
            thumbnails::record(&lock(db), &plan, &resolved)?;
            Ok(Step::Generated)
        }
    }
}

/// Where a wallpaper's file sits now, or `None` if the pass must leave it alone.
///
/// Read immediately before generating, under the same lock, because the work
/// list is a snapshot: a reject can land in the middle of a pass over it, and it
/// rewrites both the Status and the path.
///
/// The Status is compared against the one the list saw rather than against
/// Eligible. A wallpaper listed as Rejected is the tail group ADR 0016 put at
/// the end of the queue so it would be generated last, not dropped, and the
/// library page defaults to a filter of All. A wallpaper listed as Active or
/// Kept and Rejected now is the stale snapshot, and is skipped. A row that is no
/// longer there is skipped too, rather than failed.
///
/// The path comes from this read as well, so a file that moved between the list
/// and its turn is generated where it landed. [`thumbnails::plan`] already
/// re-reads it for the one-size case.
fn still_due(conn: &rusqlite::Connection, pending: &thumbnails::Pending) -> Option<PathBuf> {
    let (status, path) = conn
        .query_row(
            "SELECT status, path FROM wallpapers WHERE id = ?1",
            [pending.wallpaper_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok()?;
    let rejected_since = thumbnails::Status::read(&status) == thumbnails::Status::Rejected
        && pending.status != thumbnails::Status::Rejected;
    (!rejected_since).then(|| PathBuf::from(path))
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

/// Undoes a Keep, putting the wallpaper back into review.
///
/// Nothing on disk moves, so there is nothing to answer with. A Rejected
/// wallpaper is refused: its file sits in the reject folder, and `restore_wallpaper`
/// is what brings it back.
#[tauri::command]
fn unkeep_wallpaper(id: i64, state: tauri::State<Db>) -> Result<(), error::AppError> {
    let conn = lock_conn(state);
    db::unkeep_wallpaper(&conn, id)
}

/// Soft-rejects a wallpaper and answers with the absolute path its file landed
/// at, which a collision may have suffixed.
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
) -> Result<String, error::AppError> {
    let conn = lock_conn(state);
    db::move_wallpaper(&conn, id, &destination_folder)
}

/// Undoes a soft reject and answers with the absolute path the file landed back
/// at, which a collision at the Origin may have suffixed.
///
/// No pre-generation follows. A wallpaper rejected since the purge went still
/// has its cache, and one rejected before that has no Origin and cannot be
/// restored at all (ADR 0012).
#[tauri::command]
fn restore_wallpaper(id: i64, state: tauri::State<Db>) -> Result<String, error::AppError> {
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
            get_review,
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
    use image::{DynamicImage, Rgba, RgbaImage};
    use std::cell::RefCell;
    use thumbnails::{Missing, Pending, Size, Status};

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

    /// A library the pre-generation pass can be run against: the connection
    /// behind the mutex the pass locks, a folder of source images, and a cache
    /// directory of its own.
    ///
    /// The supervisor thread, its join and the atomic flag are deliberately not
    /// covered here. What is worth asserting is which wallpapers the pass
    /// writes for and what it counts, and both of those are reachable without a
    /// Tauri app.
    struct Library {
        db: Db,
        sources: tempfile::TempDir,
        cache: tempfile::TempDir,
    }

    impl Library {
        fn new() -> Self {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            db::init_schema(&conn).unwrap();
            Self {
                db: Db(Mutex::new(conn)),
                sources: tempfile::tempdir().unwrap(),
                cache: tempfile::tempdir().unwrap(),
            }
        }

        /// Writes a source image and inserts its row, answering the [`Pending`]
        /// the work list would hand the pass for it.
        fn seed(
            &self,
            name: &str,
            width: u32,
            height: u32,
            colour: [u8; 4],
            missing: Missing,
        ) -> Pending {
            let path = self.sources.path().join(name);
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba(colour)))
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let conn = lock(&self.db);
            conn.execute(
                "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
                rusqlite::params![name, path.to_str().unwrap()],
            )
            .unwrap();
            Pending {
                wallpaper_id: conn.last_insert_rowid(),
                source: path,
                status: Status::Active,
                missing,
            }
        }

        /// Rejects a wallpaper, leaving whatever the pass is already holding for
        /// it alone.
        fn reject(&self, wallpaper_id: i64) {
            lock(&self.db)
                .execute(
                    "UPDATE wallpapers SET status = 'rejected' WHERE id = ?1",
                    [wallpaper_id],
                )
                .unwrap();
        }

        /// Moves a wallpaper's file and points its row at where it landed, the
        /// way `move_wallpaper` and `restore_wallpaper` both do, so the
        /// [`Pending`] the pass is holding names a file that is no longer there.
        fn relocate(&self, pending: &Pending, to: &str) -> PathBuf {
            let moved = self.sources.path().join(to);
            std::fs::rename(&pending.source, &moved).unwrap();
            lock(&self.db)
                .execute(
                    "UPDATE wallpapers SET path = ?2, filename = ?3 WHERE id = ?1",
                    rusqlite::params![pending.wallpaper_id, moved.to_str().unwrap(), to],
                )
                .unwrap();
            moved
        }

        fn step(&self, pending: &Pending, tally: &mut PregenTally) {
            pregen_one(&self.db, self.cache.path(), pending, tally);
        }

        fn pass(&self, work: &[Pending], report: &impl PregenReport, cancel: &AtomicBool) {
            pregen_pass(&self.db, self.cache.path(), work, cancel, report);
        }

        fn row(&self, wallpaper_id: i64, size: &str) -> Option<(u32, u32)> {
            lock(&self.db)
                .query_row(
                    "SELECT width, height FROM thumbnails
                     WHERE wallpaper_id = ?1 AND size = ?2",
                    rusqlite::params![wallpaper_id, size],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok()
        }

        fn cache_file(&self, wallpaper_id: i64, size: &str) -> PathBuf {
            self.cache.path().join(format!("{wallpaper_id}_{size}.jpg"))
        }

        /// The colour of a written cache file, so a test can tell which image
        /// the pass decoded to make it.
        fn colour_of(&self, wallpaper_id: i64, size: &str) -> [u8; 3] {
            let bytes = std::fs::read(self.cache_file(wallpaper_id, size)).unwrap();
            image::load_from_memory(&bytes)
                .unwrap()
                .to_rgb8()
                .get_pixel(5, 5)
                .0
        }
    }

    /// Records what a pass reported, standing in for the two events, and can
    /// trip a cancel flag partway so the between-wallpapers check has something
    /// to find.
    #[derive(Default)]
    struct Recorder {
        progress: RefCell<Vec<PregenProgress>>,
        complete: RefCell<Vec<PregenComplete>>,
        cancel_at: Option<(u64, Arc<AtomicBool>)>,
    }

    impl PregenReport for Recorder {
        fn progress(&self, progress: PregenProgress) {
            if let Some((done, flag)) = &self.cancel_at {
                if progress.done == *done {
                    flag.store(true, Ordering::SeqCst);
                }
            }
            self.progress.borrow_mut().push(progress);
        }

        fn complete(&self, complete: PregenComplete) {
            self.complete.borrow_mut().push(complete);
        }
    }

    #[test]
    fn the_step_writes_both_sizes_off_one_decode_and_records_both_rows() {
        let library = Library::new();
        let pending = library.seed("cold.png", 800, 400, [10, 200, 10, 255], Missing::Both);
        let mut tally = PregenTally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert!(library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            PregenTally {
                generated: 1,
                failed: 0,
                skipped: 0
            }
        );
    }

    #[test]
    fn the_step_takes_a_single_missing_size_off_its_donor_rather_than_the_source() {
        // "Small is missing, medium is fresh" is what `Size::donors` was built
        // for, and decoding the source again to make a 400px thumbnail is what
        // this path exists to avoid.
        let library = Library::new();
        let mut pending = library.seed(
            "donor.png",
            800,
            400,
            [200, 30, 30, 255],
            Missing::Only(Size::Medium),
        );
        let mut tally = PregenTally::default();
        library.step(&pending, &mut tally);

        // Same mtime, different pixels: whichever image the step decodes shows
        // up in the small. The medium beside it still holds red.
        let before = std::fs::metadata(&pending.source)
            .unwrap()
            .modified()
            .unwrap();
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 400, Rgba([30, 30, 200, 255])))
            .save_with_format(&pending.source, image::ImageFormat::Png)
            .unwrap();
        std::fs::File::options()
            .append(true)
            .open(&pending.source)
            .unwrap()
            .set_modified(before)
            .unwrap();

        pending.missing = Missing::Only(Size::Small);
        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        let px = library.colour_of(id, "small");
        assert!(
            px[0] > px[2],
            "expected the medium's red, got {px:?} — the source was decoded again"
        );
        assert_eq!(tally.generated, 2);
    }

    #[test]
    fn a_reject_landing_after_the_work_list_leaves_the_step_writing_nothing() {
        // The work list is a snapshot. The file is still on disk and still
        // decodable here, so the only thing standing between this wallpaper and
        // a pair of thumbnails is the Status the step re-reads.
        let library = Library::new();
        let pending = library.seed("rejected.png", 800, 400, [1, 2, 3, 255], Missing::Both);
        assert_eq!(pending.status, Status::Active);
        library.reject(pending.wallpaper_id);
        let mut tally = PregenTally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), None);
        assert_eq!(library.row(id, "small"), None);
        assert!(!library.cache_file(id, "medium").exists());
        assert!(!library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            PregenTally {
                generated: 0,
                failed: 0,
                skipped: 1
            }
        );
    }

    #[test]
    fn a_wallpaper_already_rejected_when_it_was_listed_is_generated_by_the_step() {
        // ADR 0016 made Rejected a tail group rather than an exclusion, ahead of
        // a library page that defaults to a filter of All. So the re-check
        // compares the row against the Status the list saw: measured against
        // Eligible instead, every wallpaper in the tail would be dropped and the
        // library page would pay first-view latency for all of them.
        let library = Library::new();
        let mut pending = library.seed("tail.png", 800, 400, [10, 200, 10, 255], Missing::Both);
        library.reject(pending.wallpaper_id);
        // What the work list would hand the pass for it: last, and Rejected.
        pending.status = Status::Rejected;
        let mut tally = PregenTally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert!(library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            PregenTally {
                generated: 1,
                failed: 0,
                skipped: 0
            }
        );
    }

    #[test]
    fn a_source_that_moved_since_the_work_list_is_generated_from_where_the_row_points_now() {
        // A reject rewrites `path` and a Restore rewrites it back, so the
        // snapshot's copy can name a file that has moved out from under it.
        // Decoding that stale path would count the wallpaper as failed for
        // having been rejected, which is the tail group's whole cohort.
        let library = Library::new();
        let pending = library.seed("moving.png", 800, 400, [30, 30, 200, 255], Missing::Both);
        library.relocate(&pending, "moved.png");
        let mut tally = PregenTally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert!(!pending.source.exists());
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert_eq!(
            tally,
            PregenTally {
                generated: 1,
                failed: 0,
                skipped: 0
            }
        );
    }

    #[test]
    fn a_missing_source_is_counted_and_the_pass_carries_on_to_the_next_wallpaper() {
        // One bad file must not stop a pass over the whole library, and a
        // wallpaper the pass never reports is a wallpaper the curator cannot
        // find out about.
        let library = Library::new();
        let gone = library.seed("gone.png", 800, 400, [4, 4, 4, 255], Missing::Both);
        let fine = library.seed("fine.png", 800, 400, [5, 5, 5, 255], Missing::Both);
        std::fs::remove_file(&gone.source).unwrap();
        let recorder = Recorder::default();

        library.pass(
            &[gone.clone(), fine.clone()],
            &recorder,
            &AtomicBool::new(false),
        );

        assert!(!library.cache_file(gone.wallpaper_id, "medium").exists());
        assert!(library.cache_file(fine.wallpaper_id, "medium").exists());
        assert_eq!(
            *recorder.complete.borrow(),
            vec![PregenComplete {
                generated: 1,
                failed: 1,
                cancelled: false,
            }]
        );
    }

    #[test]
    fn an_empty_work_list_emits_nothing_at_all() {
        // Every launch after the first. Otherwise a warm library would flash a
        // finished progress bar for work that never happened.
        let library = Library::new();
        let recorder = Recorder::default();

        library.pass(&[], &recorder, &AtomicBool::new(false));

        assert!(recorder.progress.borrow().is_empty());
        assert!(recorder.complete.borrow().is_empty());
    }

    #[test]
    fn every_progress_emission_carries_the_total_and_the_first_lands_before_any_work() {
        // The `done: 0` emission is what lets a bar appear immediately instead
        // of after a two-second decode, and `total` on each one means a
        // listener needs no start event and survives a missed one.
        let library = Library::new();
        let first = library.seed("a.png", 800, 400, [6, 6, 6, 255], Missing::Both);
        let second = library.seed("b.png", 800, 400, [7, 7, 7, 255], Missing::Both);
        let recorder = Recorder::default();

        library.pass(&[first, second], &recorder, &AtomicBool::new(false));

        assert_eq!(
            *recorder.progress.borrow(),
            vec![
                PregenProgress { done: 0, total: 2 },
                PregenProgress { done: 1, total: 2 },
                PregenProgress { done: 2, total: 2 },
            ]
        );
        assert_eq!(
            *recorder.complete.borrow(),
            vec![PregenComplete {
                generated: 2,
                failed: 0,
                cancelled: false,
            }]
        );
    }

    #[test]
    fn a_cancel_between_wallpapers_leaves_a_clean_prefix_and_reports_itself() {
        // A cancelled pass keeps everything it already generated — a partial
        // cache is a correct cache — and stops at a wallpaper boundary, so the
        // prefix is fully warm rather than half written.
        let library = Library::new();
        let first = library.seed("one.png", 800, 400, [8, 8, 8, 255], Missing::Both);
        let second = library.seed("two.png", 800, 400, [9, 9, 9, 255], Missing::Both);
        let flag = Arc::new(AtomicBool::new(false));
        let recorder = Recorder {
            cancel_at: Some((1, Arc::clone(&flag))),
            ..Recorder::default()
        };

        library.pass(&[first.clone(), second.clone()], &recorder, &flag);

        assert!(library.cache_file(first.wallpaper_id, "small").exists());
        assert!(!library.cache_file(second.wallpaper_id, "small").exists());
        assert_eq!(
            *recorder.progress.borrow(),
            vec![
                PregenProgress { done: 0, total: 2 },
                PregenProgress { done: 1, total: 2 },
            ]
        );
        assert_eq!(
            *recorder.complete.borrow(),
            vec![PregenComplete {
                generated: 1,
                failed: 0,
                cancelled: true,
            }]
        );
    }

    #[test]
    fn the_pregen_events_cross_the_ipc_with_the_fields_client_ts_will_expect() {
        let progress = serde_json::to_value(PregenProgress { done: 3, total: 9 }).unwrap();
        assert_eq!(progress["done"], 3);
        assert_eq!(progress["total"], 9);

        let complete = serde_json::to_value(PregenComplete {
            generated: 7,
            failed: 2,
            cancelled: true,
        })
        .unwrap();
        assert_eq!(complete["generated"], 7);
        assert_eq!(complete["failed"], 2);
        assert_eq!(complete["cancelled"], true);
    }
}
