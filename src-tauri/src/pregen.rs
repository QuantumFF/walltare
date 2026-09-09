//! The thumbnail pre-generation pass of ADR 0012: the cancel flag and thread it
//! runs under, the work list it walks, and the two events it reports through.
//!
//! `start_pregen` and `cancel_pregen` stay in the command surface; everything
//! they set in motion lives here.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{error, thumbnails, CacheDir, Db};

/// How far through its work list the pre-generation pass is.
///
/// `total` rides along on every emission rather than arriving once in a start
/// event, so a listener that missed the first one still knows what it is a
/// fraction of.
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
struct Progress {
    done: u64,
    total: u64,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
struct Complete {
    generated: u64,
    /// Wallpapers whose source was gone or would not decode. One bad file
    /// stops nothing, so this is a count rather than an error.
    failed: u64,
    cancelled: bool,
}

/// A pre-generation pass in flight: its cancel flag and its thread.
type Run = (Arc<AtomicBool>, std::thread::JoinHandle<()>);

/// The pre-generation pass currently running, if any.
///
/// `Some` is the running state, so there is no [`crate::ScanRunning`]-style bool
/// beside it. The cancel flag is per run rather than global, so a cancel aimed
/// at one pass cannot land on the pass that starts a moment later (ADR 0012).
#[derive(Default)]
pub struct Pregen(Mutex<Option<Run>>);

impl Pregen {
    /// The running pass, recovering from poisoning for [`Db`]'s reason.
    ///
    /// Held across the join in [`supervise`], which is what makes two
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
    pub fn cancel(&self) {
        if let Some((flag, _)) = self.current().as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Clears a pass's entry in [`Pregen`] however its thread ends, panic included
/// — [`crate::ScanGuard`]'s reasoning, with an entry in place of a bool. An
/// entry that outlived its thread would leave `cancel_pregen` setting a flag
/// nothing reads and reporting a pass that has already stopped.
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

/// Retires the previous pass and installs a new one.
///
/// On its own thread because both halves of that block: the join waits for up
/// to one wallpaper's decode, and the [`Pregen`] mutex is held across it, so two
/// `start_pregen` calls serialize here instead of racing over the same state.
pub fn supervise(app: AppHandle) {
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
            run(&app, &flag);
        })
    };
    *current = Some((flag, handle));
}

/// Builds the work list, then runs it.
///
/// A work list that cannot be built emits nothing. The only way that happens is
/// the database being gone, which is already fatal everywhere else, so there is
/// no `pregen-failed` event for it (ADR 0012).
fn run(app: &AppHandle, cancel: &AtomicBool) {
    let db = app.state::<Db>();
    let cache_dir = app.state::<CacheDir>();

    // Two halves in the order `missing.rs` documents for its own pair: the
    // query under the connection, and the `read_dir` plus one `stat` per row
    // with it released. `Db::read` drops the guard before it returns, so the
    // second half — 5,000 filesystem calls at ADR 0016's ceiling, on whatever
    // drive the Library root sits on — holds nothing while the first view
    // fetches its listing and fires fifty thumbnail requests (ADR 0039).
    let work = match db
        .read(thumbnails::candidates)
        .and_then(|candidates| thumbnails::work_list(&candidates, &cache_dir.0))
    {
        Ok(work) => work,
        Err(e) => {
            eprintln!("pre-generation could not read the library: {e}");
            return;
        }
    };
    pass(&db, &cache_dir.0, &work, cancel, &EventReport(app));
}

/// Where a pass reports to.
///
/// A parameter rather than an `AppHandle` reached through the state, so the pass
/// and its per-wallpaper step are drivable from a test: an `AppHandle` only
/// exists inside a running Tauri app, and the counting is worth asserting on
/// without one.
trait Report {
    fn progress(&self, progress: Progress);
    fn complete(&self, complete: Complete);
}

/// The real report: the two events the frontend listens for.
struct EventReport<'a>(&'a AppHandle);

impl Report for EventReport<'_> {
    fn progress(&self, progress: Progress) {
        let _ = self.0.emit("pregen-progress", progress);
    }

    fn complete(&self, complete: Complete) {
        let _ = self.0.emit("pregen-complete", complete);
    }
}

/// What a pass has done so far.
#[derive(Default, Debug, PartialEq, Eq)]
struct Tally {
    generated: u64,
    failed: u64,
    /// Wallpapers rejected between the work list and their own turn in it. Not
    /// reported: the curator who rejected one knows, and a count of
    /// their own rejects tells them nothing about the cache.
    skipped: u64,
}

impl Tally {
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
fn pass(
    db: &Db,
    cache_dir: &Path,
    work: &[thumbnails::Pending],
    cancel: &AtomicBool,
    report: &impl Report,
) {
    if work.is_empty() {
        return;
    }

    let total = work.len() as u64;
    let mut tally = Tally::default();
    // Before the first wallpaper, so a bar can appear immediately instead of
    // after a two-second decode.
    report.progress(Progress { done: 0, total });

    let mut cancelled = false;
    for pending in work {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        step(db, cache_dir, pending, &mut tally);
        report.progress(Progress {
            done: tally.done(),
            total,
        });
    }

    report.complete(Complete {
        generated: tally.generated,
        failed: tally.failed,
        cancelled,
    });
}

/// One wallpaper, and the only part of the pass a test drives directly.
///
/// A missing or undecodable source is counted and left behind, because one bad
/// file must not stop a pass over the whole library. An undecodable one is also
/// written down, so the next pass does not spend the same decode learning the
/// same thing — see [`remember`].
fn step(db: &Db, cache_dir: &Path, pending: &thumbnails::Pending, tally: &mut Tally) {
    match generate_one(db, cache_dir, pending) {
        Ok(Step::Generated) => tally.generated += 1,
        Ok(Step::Skipped) => tally.skipped += 1,
        Err(e) => {
            eprintln!("pre-generation skipped {}: {e}", pending.source.display());
            tally.failed += 1;
            remember(db, pending.wallpaper_id, &e);
        }
    }
}

/// Writes down a source that was read and would not decode, so the work list
/// leaves it out until the file changes (ADR 0034).
///
/// Only [`error::AppError::Image`], which is the one variant that means the
/// bytes were there and are not an image this build can decode: a zero-byte
/// file, a download that stopped halfway, a `.jpg` that is really something
/// else. Every other variant is either about the file being absent — ADR 0032's
/// subject, and cheap, because it costs a `stat` rather than a decode — or about
/// the machine, and a full disk must not permanently retire a wallpaper that is
/// perfectly fine.
///
/// The mtime comes from the row's current `path` rather than from the snapshot,
/// for [`thumbnails::still_due`]'s reason: a reject or a Restore moves the file
/// while the pass is running. A source that cannot be `stat`ed at all is not
/// noted, because there is nothing to say the note is about.
///
/// A note that cannot be written is logged and dropped. It is a cache
/// optimisation, and the pass has already counted the failure the curator reads.
fn remember(db: &Db, wallpaper_id: i64, error: &error::AppError) {
    if !matches!(error, error::AppError::Image(_)) {
        return;
    }
    // Three steps rather than one, with the `stat` in the middle and outside
    // both closures (ADR 0039): where the row points now, what that file's
    // mtime is, then the note.
    let Some(source) = db.read(|conn| thumbnails::current_source_path(conn, wallpaper_id)) else {
        return;
    };
    let Ok(source_mtime) = thumbnails::source_mtime(&source) else {
        return;
    };
    let message = error.to_string();
    db.write(|conn| {
        if let Err(e) = thumbnails::note_failure(conn, wallpaper_id, source_mtime, &message) {
            eprintln!("could not record an undecodable source: {e}");
        }
    });
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
/// held across a decode (ADR 0004) — the same ordering [`crate::serving`] keeps
/// for a request that misses. Both sizes missing is the single decode
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
            let Some(source) = db.read(|conn| thumbnails::still_due(conn, pending)) else {
                return Ok(Step::Skipped);
            };
            let recorded = thumbnails::generate_both(id, &source, cache_dir)?;
            db.write(|conn| {
                for r in recorded {
                    thumbnails::record_one(conn, id, r.size, r.width, r.height, r.source_mtime)?;
                }
                Ok(Step::Generated)
            })
        }
        thumbnails::Missing::Only(size) => {
            // One read for both questions, which is the point: the Status the
            // pass acts on and the path it acts on come from one view of the
            // row. The path `still_due` answers with is the one `plan` reads for
            // itself a line later.
            //
            // A skip comes back as `None` rather than returning from here,
            // because the closure cannot return from its caller. That is the
            // interface doing its job: what leaves it is owned data.
            let plan = db.read(|conn| match thumbnails::still_due(conn, pending) {
                Some(_) => thumbnails::plan(conn, id, size).map(Some),
                None => Ok(None),
            })?;
            let Some(plan) = plan else {
                return Ok(Step::Skipped);
            };
            let resolved = thumbnails::fulfill(&plan, cache_dir)?;
            db.write(|conn| thumbnails::record(conn, &plan, &resolved))?;
            Ok(Step::Generated)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::Status;
    use image::{DynamicImage, Rgba, RgbaImage};
    use std::cell::RefCell;
    use std::path::PathBuf;
    use thumbnails::{Missing, Pending, Size};

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
                db: Db::new(conn),
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
            let wallpaper_id = self.db.write(|conn| {
                conn.execute(
                    "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
                    rusqlite::params![name, path.to_str().unwrap()],
                )
                .unwrap();
                conn.last_insert_rowid()
            });
            Pending {
                wallpaper_id,
                source: path,
                status: Status::Active,
                missing,
            }
        }

        /// Writes a source that is not an image and inserts its row, the way a
        /// scan does: the walk reads names rather than bytes, so a zero-byte
        /// file and a download that stopped halfway both become wallpapers.
        fn seed_bytes(&self, name: &str, bytes: &[u8]) -> Pending {
            let path = self.sources.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            let wallpaper_id = self.db.write(|conn| {
                conn.execute(
                    "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
                    rusqlite::params![name, path.to_str().unwrap()],
                )
                .unwrap();
                conn.last_insert_rowid()
            });
            Pending {
                wallpaper_id,
                source: path,
                status: Status::Active,
                missing: Missing::Both,
            }
        }

        /// What the next pass would be handed, which is the question "is this
        /// wallpaper retried" is actually asking.
        fn work_list(&self) -> Vec<i64> {
            self.db
                .read(thumbnails::candidates)
                .and_then(|candidates| thumbnails::work_list(&candidates, self.cache.path()))
                .unwrap()
                .into_iter()
                .map(|p| p.wallpaper_id)
                .collect()
        }

        /// Rejects a wallpaper, leaving whatever the pass is already holding for
        /// it alone.
        fn reject(&self, wallpaper_id: i64) {
            self.db.write(|conn| {
                conn.execute(
                    "UPDATE wallpapers SET status = 'rejected' WHERE id = ?1",
                    [wallpaper_id],
                )
                .unwrap()
            });
        }

        /// Moves a wallpaper's file and points its row at where it landed, the
        /// way `move_wallpaper` and `restore_wallpaper` both do, so the
        /// [`Pending`] the pass is holding names a file that is no longer there.
        fn relocate(&self, pending: &Pending, to: &str) -> PathBuf {
            let moved = self.sources.path().join(to);
            std::fs::rename(&pending.source, &moved).unwrap();
            self.db.write(|conn| {
                conn.execute(
                    "UPDATE wallpapers SET path = ?2, filename = ?3 WHERE id = ?1",
                    rusqlite::params![pending.wallpaper_id, moved.to_str().unwrap(), to],
                )
                .unwrap()
            });
            moved
        }

        fn step(&self, pending: &Pending, tally: &mut Tally) {
            super::step(&self.db, self.cache.path(), pending, tally);
        }

        fn pass(&self, work: &[Pending], report: &impl Report, cancel: &AtomicBool) {
            super::pass(&self.db, self.cache.path(), work, cancel, report);
        }

        fn row(&self, wallpaper_id: i64, size: &str) -> Option<(u32, u32)> {
            self.db.read(|conn| {
                conn.query_row(
                    "SELECT width, height FROM thumbnails
                     WHERE wallpaper_id = ?1 AND size = ?2",
                    rusqlite::params![wallpaper_id, size],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok()
            })
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
        progress: RefCell<Vec<Progress>>,
        complete: RefCell<Vec<Complete>>,
        cancel_at: Option<(u64, Arc<AtomicBool>)>,
    }

    impl Report for Recorder {
        fn progress(&self, progress: Progress) {
            if let Some((done, flag)) = &self.cancel_at {
                if progress.done == *done {
                    flag.store(true, Ordering::SeqCst);
                }
            }
            self.progress.borrow_mut().push(progress);
        }

        fn complete(&self, complete: Complete) {
            self.complete.borrow_mut().push(complete);
        }
    }

    #[test]
    fn the_step_writes_both_sizes_off_one_decode_and_records_both_rows() {
        let library = Library::new();
        let pending = library.seed("cold.png", 800, 400, [10, 200, 10, 255], Missing::Both);
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert!(library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            Tally {
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
        let mut tally = Tally::default();
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
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), None);
        assert_eq!(library.row(id, "small"), None);
        assert!(!library.cache_file(id, "medium").exists());
        assert!(!library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            Tally {
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
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert!(library.cache_file(id, "small").exists());
        assert_eq!(
            tally,
            Tally {
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
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        let id = pending.wallpaper_id;
        assert!(!pending.source.exists());
        assert_eq!(library.row(id, "medium"), Some((800, 400)));
        assert_eq!(library.row(id, "small"), Some((400, 200)));
        assert!(library.cache_file(id, "medium").exists());
        assert_eq!(
            tally,
            Tally {
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
            vec![Complete {
                generated: 1,
                failed: 1,
                cancelled: false,
            }]
        );
    }

    /// A PNG signature and a header chunk, and then nothing: enough for the
    /// decoder to commit to a format and then run out of file.
    const TRUNCATED_PNG: &[u8] =
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x04\x00\x00\x00\x02\x40\x08\x06\x00\x00\x00";

    #[test]
    fn a_hostile_library_finishes_the_pass_and_counts_every_bad_file_in_it() {
        // The whole of issue #202 from the pass's side. A zero-byte image, a
        // truncated one and a source that is gone sit in front of a perfectly
        // good wallpaper, and the good one is still warm at the end: one
        // undecodable image must not end the pass for every wallpaper behind it
        // in the queue.
        let library = Library::new();
        let empty = library.seed_bytes("empty.jpg", b"");
        let truncated = library.seed_bytes("half.png", TRUNCATED_PNG);
        let gone = library.seed("gone.png", 800, 400, [1, 1, 1, 255], Missing::Both);
        std::fs::remove_file(&gone.source).unwrap();
        let fine = library.seed("fine.png", 800, 400, [2, 2, 2, 255], Missing::Both);
        let recorder = Recorder::default();

        library.pass(
            &[empty.clone(), truncated.clone(), gone.clone(), fine.clone()],
            &recorder,
            &AtomicBool::new(false),
        );

        for bad in [&empty, &truncated, &gone] {
            assert!(!library.cache_file(bad.wallpaper_id, "medium").exists());
            assert_eq!(library.row(bad.wallpaper_id, "medium"), None);
        }
        assert_eq!(library.row(fine.wallpaper_id, "medium"), Some((800, 400)));
        assert_eq!(library.row(fine.wallpaper_id, "small"), Some((400, 200)));
        // The pass reached the end of its list, and the three failures reach the
        // curator as `pregen-complete { failed }` — ADR 0021's
        // `1 thumbnail ready, 3 failed`, rather than three log lines.
        assert_eq!(
            *recorder.complete.borrow(),
            vec![Complete {
                generated: 1,
                failed: 3,
                cancelled: false,
            }]
        );
        assert_eq!(recorder.progress.borrow().last().unwrap().done, 4);
    }

    #[test]
    fn an_undecodable_source_leaves_the_work_list_and_a_missing_one_does_not() {
        // A permanently broken file costs one decode, not one per launch. A
        // file that is not there costs a `stat` either way and has no version to
        // pin a note to, so it stays listed and stays counted — which is the
        // line ADR 0032 drew between the two (ADR 0034).
        let library = Library::new();
        let truncated = library.seed_bytes("half.png", TRUNCATED_PNG);
        let gone = library.seed("gone.png", 800, 400, [3, 3, 3, 255], Missing::Both);
        std::fs::remove_file(&gone.source).unwrap();
        let recorder = Recorder::default();

        library.pass(
            &[truncated.clone(), gone.clone()],
            &recorder,
            &AtomicBool::new(false),
        );

        assert_eq!(library.work_list(), vec![gone.wallpaper_id]);

        // And a second pass over what is left counts only the file that is
        // still worth asking about.
        let second = Recorder::default();
        library.pass(
            std::slice::from_ref(&gone),
            &second,
            &AtomicBool::new(false),
        );
        assert_eq!(
            *second.complete.borrow(),
            vec![Complete {
                generated: 0,
                failed: 1,
                cancelled: false,
            }]
        );
    }

    #[test]
    fn a_broken_source_that_the_curator_replaces_is_tried_again() {
        // The note is keyed on the mtime it was taken at, so it says "these
        // bytes" rather than "this wallpaper". A curator who re-exports the file
        // gets a thumbnail out of the next pass with nothing to press.
        let library = Library::new();
        let pending = library.seed_bytes("fixable.png", TRUNCATED_PNG);
        let mut tally = Tally::default();
        library.step(&pending, &mut tally);
        assert_eq!(tally.failed, 1);
        assert!(library.work_list().is_empty());

        DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 400, Rgba([9, 9, 9, 255])))
            .save_with_format(&pending.source, image::ImageFormat::Png)
            .unwrap();
        std::fs::File::options()
            .append(true)
            .open(&pending.source)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();

        assert_eq!(library.work_list(), vec![pending.wallpaper_id]);
        library.step(&pending, &mut tally);
        assert_eq!(
            library.row(pending.wallpaper_id, "medium"),
            Some((800, 400))
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
                Progress { done: 0, total: 2 },
                Progress { done: 1, total: 2 },
                Progress { done: 2, total: 2 },
            ]
        );
        assert_eq!(
            *recorder.complete.borrow(),
            vec![Complete {
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
                Progress { done: 0, total: 2 },
                Progress { done: 1, total: 2 },
            ]
        );
        assert_eq!(
            *recorder.complete.borrow(),
            vec![Complete {
                generated: 1,
                failed: 0,
                cancelled: true,
            }]
        );
    }

    #[test]
    fn the_pregen_events_cross_the_ipc_with_the_fields_client_ts_will_expect() {
        let progress = serde_json::to_value(Progress { done: 3, total: 9 }).unwrap();
        assert_eq!(progress["done"], 3);
        assert_eq!(progress["total"], 9);

        let complete = serde_json::to_value(Complete {
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
