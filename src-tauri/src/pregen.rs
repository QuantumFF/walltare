//! The thumbnail pre-generation pass of ADR 0012: the cancel flag and thread it
//! runs under, the work list it walks, and the two events it reports through.
//!
//! `start_pregen` and `cancel_pregen` stay in the command surface; everything
//! they set in motion lives here.
//!
//! The work list is in [`work_list`](mod@work_list): which wallpapers the pass
//! owes something, what each is owed, and the order it reaches them in. It asks
//! [`ThumbnailCache`] only which cache files are on disk.
//!
//! The warming does not live here. How a wallpaper is generated, which failures
//! are written down and what that does to the bytes in memory are all
//! [`ThumbnailCache`]'s (#280), and this module hands it one wallpaper at a
//! time. Every wallpaper goes through [`crate::serving`]'s worker pool, behind every `wallpaper://` request the
//! curator is waiting for (#232, ADR 0012's amendment). The thread this module
//! owns reads the list, waits, and counts.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::serving::ImageWorkers;
use crate::thumbnails::{self, ThumbnailCache, Warmed};
use crate::{error, Db};

mod work_list;

pub use work_list::{still_due, work_list, Missing, Pending};

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

/// A pre-generation pass: its cancel flag and its thread.
type Run = (Arc<AtomicBool>, std::thread::JoinHandle<()>);

/// The latest pre-generation pass, whether or not it is still going.
///
/// The cancel flag is per run rather than global, so a cancel aimed at one pass
/// cannot land on the pass that starts a moment later (ADR 0012).
///
/// Nothing clears the entry when its pass ends, panic included, and nothing
/// needs to. A finished pass's flag is one that nothing reads, so cancelling it
/// does nothing; joining its thread returns at once; and nothing in the app asks
/// whether a pass is running. An entry for a pass that has stopped behaves
/// exactly as an empty slot would. Its `JoinHandle`, and the panic payload if the
/// pass panicked, are held until the next start joins them rather than detached.
/// That costs one finished thread's bookkeeping at most, because each start
/// joins the entry before it replaces it, so finished passes never pile up.
///
/// The pass used to clear its own entry as its thread ended. That took a way
/// back to this slot from the pass's thread, which was the `AppHandle`, and a
/// `try_lock` there, because the successor joining that thread holds the mutex
/// while it does. And it still left a stale entry whenever a pass finished
/// before [`Pregen::start`] had installed it, since the `try_lock` lost to the
/// very start that was about to (#287, ADR 0012's amendment).
#[derive(Default)]
pub struct Pregen(Mutex<Option<Run>>);

impl Pregen {
    /// The latest pass, recovering from poisoning for [`Db`]'s reason.
    ///
    /// Held across the join in [`Pregen::start`], which is what makes two
    /// `start_pregen` calls queue up here instead of racing.
    fn current(&self) -> MutexGuard<'_, Option<Run>> {
        self.0.lock().unwrap_or_else(|poisoned| {
            self.0.clear_poison();
            poisoned.into_inner()
        })
    }

    /// Retires the previous pass and starts `run` as the next one, on a thread
    /// of its own, handing it its cancel flag.
    ///
    /// Blocks, which is why `start_pregen` calls this from a supervisor thread
    /// rather than on the IPC thread: the join waits for up to one wallpaper's
    /// decode, and the mutex is held across it, so two starts serialize here
    /// instead of racing over the same state. Two passes never run at once, and
    /// the one that started last is the one left running.
    ///
    /// What runs is a parameter, for [`Report`]'s reason: the retiring, the
    /// join and the per-run flag are worth asserting on without a Tauri app.
    /// Production's is [`supervise`]'s.
    pub fn start(&self, run: impl FnOnce(Arc<AtomicBool>) + Send + 'static) {
        let mut current = self.current();

        if let Some((flag, handle)) = current.take() {
            flag.store(true, Ordering::SeqCst);
            // A pass that panicked is a pass that has stopped, which is all this
            // join wants to know.
            let _ = handle.join();
        }

        let flag = Arc::new(AtomicBool::new(false));
        let handle = {
            let flag = Arc::clone(&flag);
            std::thread::spawn(move || run(flag))
        };
        *current = Some((flag, handle));
    }

    /// Sets the latest pass's cancel flag and returns.
    ///
    /// Never joins. The flag is read between wallpapers, and around the gap
    /// between handing one to the pool and a worker starting it, and the `image`
    /// crate cannot be interrupted mid-decode, so waiting here would block an
    /// IPC call for up to one wallpaper's decode. A cancel therefore lands up to
    /// one decode late, and both callers are fine with that: everything already
    /// generated stays on disk either way.
    pub fn cancel(&self) {
        if let Some((flag, _)) = self.current().as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Retires the previous pass and runs a new one over the app's library:
/// [`Pregen::start`] with the real pass.
pub fn supervise(app: AppHandle) {
    let runner = app.clone();
    app.state::<Pregen>()
        .start(move |cancel| run(&runner, &cancel));
}

/// Builds the work list, then runs it.
///
/// A work list that cannot be built emits nothing. The only way that happens is
/// the database being gone, which is already fatal everywhere else, so there is
/// no `pregen-failed` event for it (ADR 0012).
fn run(app: &AppHandle, cancel: &Arc<AtomicBool>) {
    let db = app.state::<Db>();
    let cache = app.state::<ThumbnailCache>();

    let work = match work_list(&db, &cache) {
        Ok(work) => work,
        Err(e) => {
            eprintln!("pre-generation could not read the library: {e}");
            return;
        }
    };
    pass(&work, cancel, &EventReport(app), |pending| {
        warm_on_the_pool(app, cancel, pending)
    });
}

/// Warms one wallpaper on the pool that serves `wallpaper://`, and waits for it.
///
/// The pass's whole claim on the machine, and there is exactly one of these in
/// flight at a time. Submitting is what makes an interactive request overtake
/// the pass — a worker takes a queued request before it takes this — and waiting
/// is what keeps ADR 0012's one-thread budget: the pass occupies one of the
/// pool's slots rather than a core beside them.
///
/// The cancel flag is read twice more, and both reads are about the same gap.
/// Waiting stops when the pass has been stood down, so its exit stays bounded by
/// a decode rather than by the interactive lane draining — [`Pregen::start`]
/// joins that exit while holding the [`Pregen`] mutex, and an IPC call to Cancel
/// or to Clear thumbnail cache queues behind it. The wallpaper left in the lane
/// reads the flag for itself where the work starts, which is
/// [`warm_unless_cancelled`]'s whole job.
fn warm_on_the_pool(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    pending: &Pending,
) -> Result<Warmed, error::AppError> {
    let handle = app.clone();
    let flag = Arc::clone(cancel);
    let pending = pending.clone();
    let answer = app.state::<ImageWorkers>().background(
        move || {
            let db = handle.state::<Db>();
            let cache = handle.state::<ThumbnailCache>();
            warm_unless_cancelled(&db, &cache, &flag, &pending)
        },
        || cancel.load(Ordering::SeqCst),
    );
    match answer {
        Some(warmed) => warmed,
        // Stood down while this wallpaper waited, so the pass is not waiting for
        // it any more. It is a skip for the same reason a Rejected one is: the
        // pass came away having written nothing, and it stops at the top of its
        // next turn regardless.
        None if cancel.load(Ordering::SeqCst) => Ok(Warmed::Skipped),
        // No answer and nothing was cancelled. A decode that panics is caught by
        // [`ThumbnailCache::warm`] and noted there, so what is left is the job
        // panicking around it, and the pool's worker survived that too. The pass
        // counts a failure, because it came away with no thumbnail.
        None => Err(thumbnails::panicked()),
    }
}

/// One wallpaper, unless the pass was stood down while it waited for a worker.
///
/// The flag is read here as well as between wallpapers because submitting and
/// starting are no longer the same instant: a wallpaper can sit behind a burst
/// of interactive requests, and a pass whose thread has already given up on this
/// job is a pass whose files must not still arrive. Without this read a cancel
/// would leave a decode running to write a wallpaper nobody is waiting for, into
/// a cache directory Clear thumbnail cache may have just emptied. A wallpaper the
/// pass never touched is a skip, which is what the Status re-check already calls
/// the same outcome.
///
/// A decode already under way is not interrupted. The `image` crate cannot be,
/// and a partial cache is a correct cache.
fn warm_unless_cancelled(
    db: &Db,
    cache: &ThumbnailCache,
    cancel: &AtomicBool,
    pending: &Pending,
) -> Result<Warmed, error::AppError> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(Warmed::Skipped);
    }
    cache.warm(db, pending)
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
    /// Wallpapers that were already warm and only owed their pixel dimensions.
    /// Not reported either, and for the same kind of reason: `pregen-complete`
    /// speaks about thumbnails, and nobody acts on how many rows the backfill
    /// filled in (ADR 0044).
    measured: u64,
}

impl Tally {
    /// Wallpapers the pass is finished with, whichever way each of them went.
    /// What `pregen-progress` counts, so the bar reaches its total.
    fn done(&self) -> u64 {
        self.generated + self.failed + self.skipped + self.measured
    }
}

/// Runs a work list, one wallpaper at a time, reporting as it goes.
///
/// Each wallpaper finishes before the next starts, so a cancelled pass leaves a
/// clean prefix: fully warm, in the order the curator will reach it. The cancel
/// flag is read between wallpapers, never inside one — and twice more around the
/// gap between handing a wallpaper to the pool and a worker starting it, which
/// [`warm_on_the_pool`] explains.
///
/// One wallpaper at a time is the budget rather than an implementation detail.
/// ADR 0012 gave the pass one thread of an N-core machine while the curator
/// ranks, and #232 moved where that thread's work runs without widening it:
/// filling the pool to finish a first launch faster is a different feature,
/// argued on first-launch time.
///
/// Where a wallpaper is warmed is a parameter, for [`Report`]'s reason.
/// Production passes [`warm_on_the_pool`], which needs a running Tauri app; what
/// the pass counts, the order it works in and where it stops are worth asserting
/// without one.
///
/// An empty work list — every launch after the first — emits nothing at all,
/// rather than flashing a finished progress bar for work that never happened.
fn pass(
    work: &[Pending],
    cancel: &AtomicBool,
    report: &impl Report,
    warm: impl Fn(&Pending) -> Result<Warmed, error::AppError>,
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
        step(pending, &mut tally, &warm);
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
/// file must not stop a pass over the whole library. Writing down the
/// undecodable ones, so the next pass does not spend the same decode learning
/// the same thing, is [`ThumbnailCache::warm`]'s: the note and the work list
/// that reads it are one module (ADR 0034).
fn step(
    pending: &Pending,
    tally: &mut Tally,
    warm: impl Fn(&Pending) -> Result<Warmed, error::AppError>,
) {
    match warm(pending) {
        Ok(Warmed::Generated) => tally.generated += 1,
        Ok(Warmed::Measured) => tally.measured += 1,
        Ok(Warmed::Skipped) => tally.skipped += 1,
        Err(e) => {
            eprintln!("pre-generation skipped {}: {e}", pending.source.display());
            tally.failed += 1;
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
    use std::sync::atomic::AtomicUsize;
    use thumbnails::Size;

    /// A library the pre-generation pass can be run against: the connection
    /// behind the mutex the pass locks, a folder of source images, and the
    /// thumbnail cache the pass warms, over a directory of its own.
    ///
    /// What is worth asserting here is which wallpapers the pass writes for and
    /// what it counts, and both of those are reachable without a Tauri app.
    /// Which passes run, and when, is [`Pregen`]'s, and its tests at the end of
    /// this module need no library at all.
    struct Library {
        db: Db,
        thumbnails: ThumbnailCache,
        sources: tempfile::TempDir,
        cache_dir: tempfile::TempDir,
    }

    impl Library {
        fn new() -> Self {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            db::init_schema(&conn).unwrap();
            let cache_dir = tempfile::tempdir().unwrap();
            Self {
                db: Db::new(conn),
                thumbnails: ThumbnailCache::new(cache_dir.path().to_path_buf()),
                sources: tempfile::tempdir().unwrap(),
                cache_dir,
            }
        }

        /// Writes a source image and inserts its row the way a scan leaves it,
        /// pixel dimensions recorded and all, answering the [`Pending`] the work
        /// list would hand the pass for it.
        fn seed(
            &self,
            name: &str,
            width: u32,
            height: u32,
            colour: [u8; 4],
            missing: Missing,
        ) -> Pending {
            let pending = self.seed_unmeasured(name, width, height, colour, missing);
            self.db.write(|conn| {
                crate::db::record_dimensions(conn, pending.wallpaper_id, width, height).unwrap()
            });
            pending
        }

        /// The same, with the dimensions left unknown: a row from a database
        /// written before the columns existed, which is the cohort the pass
        /// backfills (ADR 0044).
        fn seed_unmeasured(
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
                missing: Some(missing),
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
                missing: Some(Missing::Both),
            }
        }

        /// What the next pass would be handed, which is the question "is this
        /// wallpaper retried" is actually asking.
        fn work_list(&self) -> Vec<i64> {
            super::work_list(&self.db, &self.thumbnails)
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

        /// Where a wallpaper is warmed in these tests: on the calling thread,
        /// which is what production's [`warm_on_the_pool`] arranges for on a
        /// worker. The pool itself is `serving`'s to test, and reaching it needs
        /// a running Tauri app.
        fn warm(&self) -> impl Fn(&Pending) -> Result<Warmed, error::AppError> + '_ {
            |pending| self.thumbnails.warm(&self.db, pending)
        }

        fn step(&self, pending: &Pending, tally: &mut Tally) {
            super::step(pending, tally, self.warm());
        }

        fn pass(&self, work: &[Pending], report: &impl Report, cancel: &AtomicBool) {
            super::pass(work, cancel, report, self.warm());
        }

        /// The wallpaper row's own pixel dimensions, which is what the pass
        /// writes and what [`Self::row`]'s thumbnail row cannot answer.
        fn dimensions(&self, wallpaper_id: i64) -> (Option<i64>, Option<i64>) {
            self.db
                .read(|conn| crate::testing::dimensions_of(conn, wallpaper_id))
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
            self.cache_dir
                .path()
                .join(format!("{wallpaper_id}_{size}.jpg"))
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
                skipped: 0,
                measured: 0,
            }
        );
    }

    #[test]
    fn a_wallpaper_the_step_generates_is_forgotten_in_memory() {
        // The window ADR 0040 left open and #232 closed: the pass writes files
        // and rows without going through a request, so bytes in memory for the
        // wallpaper were made from an older read of the source it has just read
        // again. That used to be pinned by nothing, because reaching the pass's
        // copy of the rule needed an `AppHandle`; the rule is the thumbnail
        // cache's now, and this is the pass's way into it.
        let library = Library::new();
        let pending = library.seed("held.png", 800, 400, [10, 200, 10, 255], Missing::Both);
        let id = pending.wallpaper_id;
        library
            .thumbnails
            .answer(&library.db, id, Size::Small)
            .unwrap();
        assert!(library.thumbnails.remembered(id, Size::Small).is_some());
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(tally.generated, 1);
        assert_eq!(
            library.thumbnails.remembered(id, Size::Small),
            None,
            "a small made before the pass regenerated its wallpaper was still held in memory"
        );
    }

    #[test]
    fn the_step_backfills_a_warm_wallpapers_dimensions_without_generating_anything() {
        // ADR 0044's second half: the library a curator scanned before the
        // columns existed. Its cache is complete, so the only thing the pass
        // owes it is a header read, and counting that as a thumbnail made would
        // be a number nothing on disk agrees with.
        let library = Library::new();
        let pending = Pending {
            missing: None,
            ..library.seed_unmeasured("warm.png", 3440, 1440, [1, 2, 3, 255], Missing::Both)
        };
        let id = pending.wallpaper_id;
        assert_eq!(library.dimensions(id), (None, None));
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(id), (Some(3440), Some(1440)));
        // Nothing was generated, and the cache it was already holding is
        // untouched.
        assert!(!library.cache_file(id, "medium").exists());
        assert_eq!(library.row(id, "medium"), None);
        assert_eq!(
            tally,
            Tally {
                generated: 0,
                failed: 0,
                skipped: 0,
                measured: 1,
            }
        );
    }

    #[test]
    fn a_cold_wallpaper_comes_out_of_the_step_with_its_thumbnails_and_its_dimensions() {
        // The source's own resolution, not the medium's. The thumbnail rows say
        // 1920x804 for this file, which is the shape it is and not the size it
        // is — the distinction ADR 0044 exists for.
        let library = Library::new();
        let pending =
            library.seed_unmeasured("cold.png", 3440, 1440, [4, 5, 6, 255], Missing::Both);
        let id = pending.wallpaper_id;
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(id), (Some(3440), Some(1440)));
        assert_eq!(library.row(id, "medium"), Some((1920, 804)));
        assert_eq!(tally.generated, 1);
        assert_eq!(tally.measured, 0);
    }

    #[test]
    fn a_re_exported_source_comes_out_of_the_step_with_its_new_dimensions() {
        // The staleness the scan cannot fix. A curator re-exports a wallpaper at
        // a different size: the file's mtime moves, so its thumbnails stop being
        // fresh and the pass decodes it again — and if the measurement were
        // gated on the row being NULL, the pass would rewrite the thumbnails and
        // leave the row claiming a resolution the file no longer has. The
        // undersized badge and the crop caption are read off that row, so this is
        // the pass knowing better than the row and saying so (ADR 0044).
        let library = Library::new();
        let pending = library.seed("exported.png", 3440, 1440, [8, 8, 8, 255], Missing::Both);
        let id = pending.wallpaper_id;
        assert_eq!(library.dimensions(id), (Some(3440), Some(1440)));

        DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 600, Rgba([9, 9, 9, 255])))
            .save_with_format(&pending.source, image::ImageFormat::Png)
            .unwrap();
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(id), (Some(800), Some(600)));
        assert_eq!(tally.generated, 1);
    }

    #[test]
    fn a_source_that_goes_missing_leaves_the_dimensions_it_was_last_measured_at() {
        // Never overwritten with NULL. An unmounted drive or a file mid-rewrite
        // would otherwise turn a measured wallpaper into an unmeasured one, and
        // the app would forget something it knew for as long as the file was
        // away.
        let library = Library::new();
        let pending = library.seed("gone.png", 2560, 1440, [1, 1, 1, 255], Missing::Both);
        let id = pending.wallpaper_id;
        std::fs::remove_file(&pending.source).unwrap();
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(id), (Some(2560), Some(1440)));
        assert_eq!(tally.failed, 1);
    }

    #[test]
    fn a_source_that_will_not_decode_leaves_its_dimensions_null_and_is_only_counted() {
        // A zero-byte `.jpg` has no header to read, so there is nothing to
        // record and nothing to guess. The pass counts the failure it already
        // counted (ADR 0034) and the row keeps the NULL columns that say the app
        // does not know how big the file is.
        let library = Library::new();
        let pending = library.seed_bytes("empty.jpg", b"");
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(pending.wallpaper_id), (None, None));
        assert_eq!(tally.failed, 1);
        assert_eq!(tally.measured, 0);
    }

    #[test]
    fn a_wallpaper_rejected_since_the_list_was_built_is_not_measured_either() {
        // The snapshot goes stale the same way for a backfill as for a
        // thumbnail: a reject rewrites the Status and the path while the pass is
        // running, and the re-read is what the backfill branch shares with the
        // other two.
        let library = Library::new();
        let pending = Pending {
            missing: None,
            ..library.seed_unmeasured("rejected.png", 800, 400, [7, 7, 7, 255], Missing::Both)
        };
        library.reject(pending.wallpaper_id);
        let mut tally = Tally::default();

        library.step(&pending, &mut tally);

        assert_eq!(library.dimensions(pending.wallpaper_id), (None, None));
        assert_eq!(
            tally,
            Tally {
                generated: 0,
                failed: 0,
                skipped: 1,
                measured: 0,
            }
        );
    }

    #[test]
    fn a_backfill_over_a_warm_library_reports_no_thumbnails_and_no_failures() {
        // What the curator sees on the launch after this ships: a progress bar
        // over their whole library, and then nothing. `pregen-complete` speaks
        // about thumbnails, and a pass that made none says so rather than
        // claiming one per wallpaper it measured (ADR 0044, ADR 0021).
        let library = Library::new();
        let work: Vec<Pending> = (1..=3)
            .map(|n| Pending {
                missing: None,
                ..library.seed_unmeasured(
                    &format!("{n}.png"),
                    1600,
                    900,
                    [n as u8, 1, 1, 255],
                    Missing::Both,
                )
            })
            .collect();
        let recorder = Recorder::default();

        library.pass(&work, &recorder, &AtomicBool::new(false));

        for pending in &work {
            assert_eq!(
                library.dimensions(pending.wallpaper_id),
                (Some(1600), Some(900))
            );
        }
        // The bar still reaches its total, so a backfill is not a pass that
        // stalls at zero.
        assert_eq!(recorder.progress.borrow().last().unwrap().done, 3);
        assert_eq!(
            *recorder.complete.borrow(),
            vec![Complete {
                generated: 0,
                failed: 0,
                cancelled: false,
            }]
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

        pending.missing = Some(Missing::Only(Size::Small));
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
                skipped: 1,
                measured: 0,
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
                skipped: 0,
                measured: 0,
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
                skipped: 0,
                measured: 0,
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
    fn the_pass_has_one_wallpaper_in_flight_at_a_time() {
        // ADR 0012 sized the pass at one thread on two grounds, and #232 retires
        // only one of them. The pass now shares the pool that serves
        // `wallpaper://` instead of running a decode beside it, and it still
        // hands over one wallpaper and waits: one thread takes 1/N of an N-core
        // machine while the curator ranks, and taking half an eight-core machine
        // to finish a first launch faster is a different feature, argued on
        // first-launch time (#224, Out of scope). This is the pin, so a later
        // change cannot widen it by accident.
        let library = Library::new();
        let work: Vec<Pending> = (1..=4)
            .map(|n| {
                library.seed(
                    &format!("{n}.png"),
                    800,
                    400,
                    [n as u8, 1, 1, 255],
                    Missing::Both,
                )
            })
            .collect();
        let in_flight = AtomicUsize::new(0);
        let most = AtomicUsize::new(0);
        let recorder = Recorder::default();

        super::pass(&work, &AtomicBool::new(false), &recorder, |pending| {
            let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            most.fetch_max(now, Ordering::SeqCst);
            let warmed = library.thumbnails.warm(&library.db, pending);
            in_flight.fetch_sub(1, Ordering::SeqCst);
            warmed
        });

        assert_eq!(
            most.load(Ordering::SeqCst),
            1,
            "the pass had more than one wallpaper in flight"
        );
        assert_eq!(
            *recorder.complete.borrow(),
            vec![Complete {
                generated: 4,
                failed: 0,
                cancelled: false,
            }]
        );
    }

    #[test]
    fn a_wallpaper_cancelled_while_it_waited_for_a_worker_is_not_generated() {
        // The pass hands a wallpaper to the pool and waits for a worker to take
        // it, so a cancel can land in between — behind a burst of fifty
        // interactive requests, that gap is longer than a decode. Reading the
        // flag again where the work starts is what keeps a cancel landing one
        // decode late (ADR 0012).
        let library = Library::new();
        let pending = library.seed("queued.png", 800, 400, [7, 7, 7, 255], Missing::Both);
        let cancelled = AtomicBool::new(true);

        let warmed = warm_unless_cancelled(&library.db, &library.thumbnails, &cancelled, &pending);

        assert_eq!(warmed.unwrap(), Warmed::Skipped);
        assert_eq!(library.row(pending.wallpaper_id, "medium"), None);
        assert!(!library.cache_file(pending.wallpaper_id, "medium").exists());
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

    /// Passes that stay running until they are stood down, counting how many
    /// run at once and how many have stopped. Stands in for the real pass
    /// wherever what matters is which passes run and when, not what one writes.
    #[derive(Default)]
    struct Passes {
        running: AtomicUsize,
        most_at_once: AtomicUsize,
        stood_down: AtomicUsize,
    }

    impl Passes {
        fn until_cancelled(self: &Arc<Self>) -> impl FnOnce(Arc<AtomicBool>) + Send + 'static {
            let passes = Arc::clone(self);
            move |cancel| {
                let now = passes.running.fetch_add(1, Ordering::SeqCst) + 1;
                passes.most_at_once.fetch_max(now, Ordering::SeqCst);
                while !cancel.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
                passes.running.fetch_sub(1, Ordering::SeqCst);
                passes.stood_down.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    /// Long enough that a pass which was going to report has, on a loaded
    /// machine, and short enough that one which never will fails the test
    /// rather than hanging it.
    const PATIENCE: std::time::Duration = std::time::Duration::from_secs(10);

    #[test]
    fn starts_that_race_leave_the_last_pass_running_and_never_two_at_once() {
        // Launch and `scan-complete` can both call `start_pregen` at once, and
        // Generate now can land on top of either. They serialize on the mutex:
        // each start stands its predecessor down and joins it before its own
        // pass begins, so there is never a second decode beside the first
        // (ADR 0012).
        let pregen = Pregen::default();
        let passes = Arc::new(Passes::default());

        // Every start waits at the barrier and then goes at once, so they really
        // do contend for the mutex rather than arriving one after another.
        let barrier = std::sync::Barrier::new(8);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    barrier.wait();
                    pregen.start(passes.until_cancelled());
                });
            }
        });

        // Every start has returned, and every one of them but the first joined
        // the pass before it, so exactly one pass is still going.
        assert_eq!(passes.stood_down.load(Ordering::SeqCst), 7);

        // A pass that does nothing retires it, the way the next start would.
        pregen.start(|_| {});
        assert_eq!(passes.stood_down.load(Ordering::SeqCst), 8);
        assert_eq!(passes.most_at_once.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_cancel_stands_down_the_running_pass_and_not_the_next_one() {
        let pregen = Pregen::default();
        let (said, heard) = std::sync::mpsc::channel();

        // With nothing running there is nothing to cancel, and nothing is left
        // set for the pass that starts next.
        pregen.cancel();
        let first = said.clone();
        pregen.start(move |cancel| {
            first
                .send(("first began", cancel.load(Ordering::SeqCst)))
                .unwrap();
            while !cancel.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            first.send(("first stood down", true)).unwrap();
        });
        assert_eq!(heard.recv_timeout(PATIENCE), Ok(("first began", false)));

        // The cancel alone is what stops it: no start follows to do the joining.
        pregen.cancel();
        assert_eq!(heard.recv_timeout(PATIENCE), Ok(("first stood down", true)));

        // The flag is per run, so the cancel aimed at the first pass does not
        // land on the one that starts a moment later.
        pregen.start(move |cancel| {
            said.send(("second began", cancel.load(Ordering::SeqCst)))
                .unwrap();
        });
        assert_eq!(heard.recv_timeout(PATIENCE), Ok(("second began", false)));
    }

    #[test]
    fn a_pass_that_panics_leaves_nothing_in_the_way_of_the_next_one() {
        // A panic ends the pass's thread and takes nothing else with it. The
        // mutex is not poisoned, because the pass's thread never holds it; the
        // next cancel sets a flag nothing reads; and the next start's join hands
        // back the panic, which it drops, and starts its own pass as usual.
        let pregen = Pregen::default();
        pregen.start(|_| panic!("a pass panicked"));

        pregen.cancel();
        let (said, heard) = std::sync::mpsc::channel();
        pregen.start(move |cancel| said.send(cancel.load(Ordering::SeqCst)).unwrap());

        assert_eq!(heard.recv_timeout(PATIENCE), Ok(false));
    }
}
