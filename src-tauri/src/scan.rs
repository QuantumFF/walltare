//! A scan of the Library root, start to finish: where the root really is, the
//! walk, the chunked insert with each new file measured, and how the scan ended.
//!
//! `start_scan` stays in the command surface and keeps what needs a running
//! Tauri app: the thread, and the [`Report`] that turns this module's account
//! into events. Everything the scan does to the library is here, where a test
//! can drive it against a temporary directory and an in-memory database
//! (#284), and so is the guard that refuses a second scan, which needs no app
//! either (#287).
//!
//! [`crate::scanner`] is the half that reads the disk — which files are
//! wallpapers, and how many pixels each one has. This module decides the order
//! things happen in, which is where the bugs a scan can have actually live.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;

use crate::{db, error, paths, scanner, Db};

/// How many files go into the database under one taking of the connection.
///
/// Also the scan's only heartbeat: the walk emits nothing while it runs, so
/// `scan-progress` fires once per chunk, and a library of 120 wallpapers sees
/// exactly one (ADR 0021).
const CHUNK_SIZE: usize = 256;

/// How far through its walk's files the scan is.
///
/// No total, because the walk has none to give until it is over and the first
/// progress is only sent after that (ADR 0021).
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
pub struct Progress {
    scanned: u64,
    added: u64,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
pub struct Complete {
    added_count: u64,
    /// Files the walk found, whether or not they were new. Without this the UI
    /// cannot tell "this folder has no images" from "everything here is already
    /// in your library", and reports the second as the first.
    scanned_count: u64,
}

/// A scan that ended without finishing.
///
/// The message is a sentence the curator reads as it stands: `scan-failed`'s
/// toast prints it verbatim under `Couldn't finish the scan` (ADR 0021).
#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
pub struct Failed {
    message: String,
}

/// Where a scan reports to.
///
/// A parameter for the reason [`crate::pregen`]'s report is one: the real
/// report emits events, and an `AppHandle` to emit them on only exists inside
/// a running Tauri app, so a scan that reached for one could not be run by a
/// test at all. Production's adapter is `lib.rs`'s; the tests' records.
///
/// Every scan that starts ends in exactly one of [`Report::complete`] and
/// [`Report::failed`].
pub trait Report {
    /// The Library root resolved and the walk is about to begin, so this scan
    /// will add to the library rather than fail before touching it.
    ///
    /// Production stands the pre-generation pass down here, and only here: the
    /// rows about to be inserted make its work list stale, and the frontend
    /// restarts it on `scan-complete`. Nothing restarts it on `scan-failed`, so
    /// a scan whose root never resolved must never get this far, or one
    /// mistyped folder would retire the launch pass for the rest of the session
    /// (ADR 0012, ADR 0034).
    fn began(&self);
    fn progress(&self, progress: Progress);
    fn complete(&self, complete: Complete);
    fn failed(&self, failed: Failed);
}

/// Set while a scan thread is running, so a second `start_scan` is refused
/// rather than racing the first over the same connection.
///
/// The flag is shared with the [`Guard`] it hands out rather than reached
/// through the app's state, so the guard can clear it from the scan's own
/// thread with no `AppHandle` to hand, and two starts can be raced in a test.
#[derive(Default)]
pub struct Running(Arc<AtomicBool>);

impl Running {
    /// Claims the scan for the caller, or `None` when one is already running.
    /// The scan counts as running for exactly as long as the [`Guard`] lives.
    pub fn try_start(&self) -> Option<Guard> {
        if self.0.swap(true, Ordering::SeqCst) {
            return None;
        }
        Some(Guard(Arc::clone(&self.0)))
    }
}

/// Clears [`Running`] however the scan thread ends, panic included —
/// otherwise one panicked scan would refuse every later scan for the rest of
/// the process.
#[must_use = "the scan stops counting as running when the guard is dropped"]
pub struct Guard(Arc<AtomicBool>);

impl Drop for Guard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// A Library root that has been expanded and not yet looked at.
///
/// Expansion and the look are two halves of ADR 0011's order — expand, then
/// check it is a folder, then canonicalize — split across two threads, because
/// their failures are two different kinds of thing. A Written path that will
/// not expand is a fact about the string the curator is typing, so
/// [`LibraryRoot::expand`] runs on the IPC thread and its error is the call's
/// refusal, printed under the Settings field. Whether a folder is there is a
/// fact about the world when the walk begins, so [`run`] looks, and a root
/// that is not there is how the scan ended (ADR 0034).
///
/// The type is what keeps the order. [`run`] takes nothing else, so there is
/// no way to hand a scan a path that skipped the expansion — `~/pics` is a
/// template rather than a path, and `is_dir()` on it fails.
pub struct LibraryRoot(PathBuf);

impl LibraryRoot {
    /// Expands `~` and environment variables in a Written path. Touches no
    /// filesystem, so it is cheap enough to refuse a typo before anything
    /// starts.
    pub fn expand(written: &str) -> Result<Self, error::AppError> {
        paths::expand(written).map(Self)
    }

    /// [`LibraryRoot::expand`] with the environment passed in, for the tests.
    ///
    /// Same reason as [`paths::expand_with`]: the `~` case needs a known
    /// `HOME`, and cargo runs tests as threads in one process, so mutating the
    /// environment would race every other test in the crate.
    #[cfg(test)]
    fn expand_with(
        written: &str,
        lookup: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, error::AppError> {
        paths::expand_with(written, lookup).map(Self)
    }

    /// The folder to walk, or the sentence that says why there is none.
    ///
    /// Canonicalizing last is what keeps `~/pics`, `$HOME/pics` and
    /// `/home/me/./pics` from reaching three libraries: stored paths are
    /// compared as strings, so `UNIQUE(path)` would see the same file three
    /// times. And it is a hard failure rather than a fallback to the
    /// un-canonicalized path — the check before it has already passed, so it
    /// only fires in exotic cases, and storing the un-canonicalized string
    /// there is exactly the duplicate library the canonicalization exists to
    /// prevent (ADR 0011).
    fn resolve(&self) -> Result<PathBuf, String> {
        let expanded = &self.0;
        if !expanded.is_dir() {
            return Err(unwalkable_root(expanded));
        }
        expanded
            .canonicalize()
            .map_err(|_| unwalkable_root(expanded))
    }
}

/// Scans the Library root and reports how it went.
///
/// The whole of what a scan does, in order: resolve the root, report that the
/// scan began, walk, then insert what the walk found a chunk at a time,
/// measuring each chunk's new rows before the next. A chunk that will not
/// insert ends the scan there, on [`Report::failed`], rather than carrying on
/// past a database that has started refusing writes; the chunks before it stay
/// in the library.
///
/// If the root is not a folder that can be walked, what this scan does to the
/// library is nothing. The wallpapers an earlier scan found stay in it, per
/// `CONTEXT.md`, and the message says so.
pub fn run(db: &Db, root: LibraryRoot, report: &impl Report) {
    let root = match root.resolve() {
        Ok(root) => root,
        Err(message) => {
            report.failed(Failed { message });
            return;
        }
    };
    report.began();

    let files = scanner::collect_images(std::slice::from_ref(&root));
    let mut scanned: u64 = 0;
    let mut added: u64 = 0;

    for chunk in files.chunks(CHUNK_SIZE) {
        match db.write(|conn| db::insert_new_wallpapers(conn, chunk)) {
            Ok(new_rows) => {
                added += new_rows.len() as u64;
                record_dimensions(db, &new_rows);
            }
            Err(e) => {
                // Surfaced instead of only printed: a silent failure looks to
                // the curator exactly like an empty folder.
                report.failed(Failed {
                    message: e.to_string(),
                });
                return;
            }
        }
        scanned += chunk.len() as u64;
        report.progress(Progress { scanned, added });
    }

    report.complete(Complete {
        added_count: added,
        scanned_count: scanned,
    });
}

/// Reads each newly scanned file's pixel dimensions and writes them to its row.
///
/// Between the chunk's insert and the next one, and in three steps rather than
/// one: the insert under the connection, the header reads with it released, then
/// the writes (ADR 0039). A chunk is [`CHUNK_SIZE`] files, so holding the lock
/// across the reads would queue every command and every `wallpaper://` request
/// behind that many file opens on whatever drive the Library root sits on.
///
/// Only the rows this chunk actually inserted, which is what makes a rescan of a
/// warm library cost nothing: `INSERT OR IGNORE` hands back the new rows alone,
/// and a wallpaper already in the library already has its dimensions or is the
/// pre-generation pass's to backfill (ADR 0044).
///
/// A file whose dimensions cannot be read is left with NULL in both columns and
/// nothing else happens: the scan does not fail over it, and the pass that
/// decodes it later is where a broken source is counted and reported (ADR 0034).
/// A write that fails is logged rather than surfaced — the dimensions are
/// backfillable and the wallpapers are in the library either way.
fn record_dimensions(db: &Db, new_rows: &[db::Added]) {
    let measured: Vec<(i64, u32, u32)> = new_rows
        .iter()
        .filter_map(|row| {
            scanner::dimensions(&row.path).map(|(width, height)| (row.id, width, height))
        })
        .collect();
    if measured.is_empty() {
        return;
    }
    if let Err(e) = db.write(|conn| db::record_dimensions_batch(conn, &measured)) {
        eprintln!("scan could not record pixel dimensions: {e}");
    }
}

/// What the curator reads when a scan's Library root is not a folder it can
/// walk: deleted since it was set, unmounted, or a file where a folder was.
///
/// It names where the app looked and what did not happen, because the second
/// half is the one the curator cannot see: `CONTEXT.md` says the wallpapers an
/// earlier scan found stay in the library regardless of where the Library root
/// points now, and a curator whose drive is unmounted otherwise reads an empty
/// scan as the app having forgotten their library (ADR 0034).
///
/// A function of its own, rather than inline in [`LibraryRoot::resolve`], for
/// the one branch a test cannot reach through a real folder: the directory
/// check passing and the canonicalization failing.
fn unwalkable_root(expanded: &Path) -> String {
    let where_it_looked = expanded.display();
    let head = if expanded.is_dir() {
        // The directory check passed and the canonicalization did not, which is
        // exotic: a symlink loop, or a component that stopped being readable
        // between the two calls.
        format!("walltare couldn't read the folder at {where_it_looked}.")
    } else {
        format!("There's no folder at {where_it_looked}.")
    };
    format!(
        "{head} Nothing was scanned, and every wallpaper already in your library is still in it."
    )
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::testing;

    /// Records what a scan reported, standing in for the three events and the
    /// pre-generation cancel.
    #[derive(Default)]
    struct Recorder {
        began: RefCell<u32>,
        progress: RefCell<Vec<Progress>>,
        complete: RefCell<Vec<Complete>>,
        failed: RefCell<Vec<Failed>>,
    }

    impl Report for Recorder {
        fn began(&self) {
            *self.began.borrow_mut() += 1;
        }

        fn progress(&self, progress: Progress) {
            self.progress.borrow_mut().push(progress);
        }

        fn complete(&self, complete: Complete) {
            self.complete.borrow_mut().push(complete);
        }

        fn failed(&self, failed: Failed) {
            self.failed.borrow_mut().push(failed);
        }
    }

    impl Recorder {
        /// The one message the scan failed with, and a check that nothing
        /// claimed it completed as well.
        fn failure(&self) -> String {
            assert_eq!(*self.complete.borrow(), vec![], "a failed scan completed");
            let failed = self.failed.borrow();
            assert_eq!(failed.len(), 1, "{failed:?}");
            failed[0].message.clone()
        }

        /// The one completion the scan reported, and a check that nothing
        /// claimed it failed as well.
        fn completion(&self) -> Complete {
            assert_eq!(*self.failed.borrow(), vec![], "a completed scan failed");
            let complete = self.complete.borrow();
            assert_eq!(complete.len(), 1, "{complete:?}");
            complete[0].clone()
        }
    }

    fn library() -> Db {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        Db::new(conn)
    }

    fn scan(db: &Db, dir: &Path) -> Recorder {
        let recorder = Recorder::default();
        let root = LibraryRoot::expand(dir.to_str().unwrap()).unwrap();
        run(db, root, &recorder);
        recorder
    }

    fn scan_root(written: &str) -> Result<PathBuf, String> {
        LibraryRoot::expand(written).unwrap().resolve()
    }

    fn wallpaper_count(db: &Db) -> u64 {
        db.read(|conn| {
            conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap() as u64
        })
    }

    fn id_of(db: &Db, path: &Path) -> i64 {
        db.read(|conn| {
            conn.query_row(
                "SELECT id FROM wallpapers WHERE path = ?1",
                [path.canonicalize().unwrap().to_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap()
        })
    }

    fn dimensions_of(db: &Db, path: &Path) -> (Option<i64>, Option<i64>) {
        let id = id_of(db, path);
        db.read(|conn| testing::dimensions_of(conn, id))
    }

    /// Writes a PNG of the given size, the way a curator's export tool would.
    fn write_png(path: &Path, width: u32, height: u32) {
        image::DynamicImage::ImageRgba8(image::RgbaImage::new(width, height))
            .save_with_format(path, image::ImageFormat::Png)
            .unwrap();
    }

    /// `count` empty `.jpg`s: wallpapers to the walk, which reads names rather
    /// than bytes, and nothing to measure.
    fn fill(dir: &Path, count: usize) {
        for i in 0..count {
            std::fs::write(dir.join(format!("{i:04}.jpg")), b"").unwrap();
        }
    }

    #[test]
    fn a_scan_reports_once_per_chunk_and_completes_with_the_totals() {
        // The heartbeat ADR 0021 designed the toast around: nothing during the
        // walk, then one progress per chunk, the last one short. Two full
        // chunks and a remainder of one.
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        fill(dir.path(), 2 * CHUNK_SIZE + 1);

        let report = scan(&db, dir.path());

        let chunk = CHUNK_SIZE as u64;
        assert_eq!(*report.began.borrow(), 1);
        assert_eq!(
            *report.progress.borrow(),
            vec![
                Progress {
                    scanned: chunk,
                    added: chunk
                },
                Progress {
                    scanned: 2 * chunk,
                    added: 2 * chunk
                },
                Progress {
                    scanned: 2 * chunk + 1,
                    added: 2 * chunk + 1
                },
            ]
        );
        assert_eq!(
            report.completion(),
            Complete {
                added_count: 2 * chunk + 1,
                scanned_count: 2 * chunk + 1,
            }
        );
        assert_eq!(wallpaper_count(&db), 2 * chunk + 1);
    }

    #[test]
    fn a_rescan_counts_every_file_it_found_and_adds_only_the_new_ones() {
        // `scanned_count` against `added_count` is how the toast tells "this
        // folder has no images" from "everything here is already in your
        // library".
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        fill(dir.path(), 3);
        scan(&db, dir.path());
        std::fs::write(dir.path().join("new.jpg"), b"").unwrap();

        let report = scan(&db, dir.path());

        assert_eq!(
            *report.progress.borrow(),
            vec![Progress {
                scanned: 4,
                added: 1
            }]
        );
        assert_eq!(
            report.completion(),
            Complete {
                added_count: 1,
                scanned_count: 4,
            }
        );
    }

    #[test]
    fn an_empty_folder_completes_with_nothing_and_sends_no_progress() {
        let db = library();
        let dir = tempfile::tempdir().unwrap();

        let report = scan(&db, dir.path());

        assert_eq!(*report.began.borrow(), 1);
        assert_eq!(*report.progress.borrow(), vec![]);
        assert_eq!(
            report.completion(),
            Complete {
                added_count: 0,
                scanned_count: 0,
            }
        );
    }

    #[test]
    fn a_chunk_that_will_not_insert_stops_the_scan_and_reports_why() {
        // Surfacing it rather than printing it is the point: a scan that
        // swallowed the error would look to the curator exactly like an empty
        // folder. The trigger refuses the first row past the first chunk, so
        // the second chunk's transaction rolls back whole and the third is
        // never attempted.
        let db = library();
        db.write(|conn| {
            conn.execute_batch(&format!(
                "CREATE TRIGGER refuse BEFORE INSERT ON wallpapers
                 WHEN (SELECT COUNT(*) FROM wallpapers) >= {CHUNK_SIZE}
                 BEGIN SELECT RAISE(ABORT, 'the disk is full'); END;"
            ))
            .unwrap()
        });
        let dir = tempfile::tempdir().unwrap();
        fill(dir.path(), 2 * CHUNK_SIZE + 1);

        let report = scan(&db, dir.path());

        let chunk = CHUNK_SIZE as u64;
        assert_eq!(
            *report.progress.borrow(),
            vec![Progress {
                scanned: chunk,
                added: chunk
            }]
        );
        let message = report.failure();
        assert!(message.contains("the disk is full"), "{message}");
        // The chunk before the failure is in the library and stays there.
        assert_eq!(wallpaper_count(&db), chunk);
    }

    #[test]
    fn a_scan_records_the_dimensions_of_every_file_it_can_read() {
        // ADR 0044's first half. The walk reads names rather than bytes, so a
        // zero-byte `.jpg` and a download that stopped halfway are wallpapers
        // like any other: they come through with NULL dimensions and the files
        // beside them are measured, because a scan that failed over a bad file
        // would lose the library behind it (ADR 0034).
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        let ultrawide = dir.path().join("ultrawide.png");
        write_png(&ultrawide, 5120, 2160);
        let empty = dir.path().join("empty.jpg");
        std::fs::write(&empty, b"").unwrap();

        let report = scan(&db, dir.path());

        assert_eq!(report.completion().added_count, 2);
        assert_eq!(dimensions_of(&db, &ultrawide), (Some(5120), Some(2160)));
        assert_eq!(dimensions_of(&db, &empty), (None, None));
    }

    #[test]
    fn a_rescan_measures_the_files_it_has_never_seen_and_no_others() {
        // What makes a rescan of a warm library cost nothing: `INSERT OR IGNORE`
        // hands back the new rows alone, so the header reads are one per new
        // file rather than one per wallpaper in the library (ADR 0044).
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.png");
        write_png(&first, 1920, 1080);
        scan(&db, dir.path());

        // The curator re-exports the first at a different size and adds a
        // second, then scans again.
        write_png(&first, 800, 600);
        let second = dir.path().join("second.png");
        write_png(&second, 2560, 1440);

        let report = scan(&db, dir.path());

        assert_eq!(report.completion().added_count, 1);
        assert_eq!(dimensions_of(&db, &second), (Some(2560), Some(1440)));
        // The row already in the library still says what it was scanned at. The
        // re-export moved the file's mtime, so its thumbnails have stopped being
        // fresh and the pre-generation pass will decode it again and correct
        // this — the scan is not where that is fixed (ADR 0044).
        assert_eq!(dimensions_of(&db, &first), (Some(1920), Some(1080)));
    }

    #[test]
    fn a_scan_records_the_wallhaven_id_of_every_file_named_the_way_wallhaven_names_it() {
        // ADR 0050: a folder of Wallhaven downloads made before walltare counts
        // as In library from its first scan. The suffix and the extension's
        // case are what a browser and this app's own rejects leave behind; the
        // near misses get none, because a wrong id marks a Result the library
        // does not hold.
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        let named = [
            ("wallhaven-abc123.jpg", Some("abc123")),
            ("wallhaven-abc123 (2).PNG", Some("abc123")),
            ("wallhaven-85e1g1.Jpeg", Some("85e1g1")),
            ("wallpaper-abc123.jpg", None),
            ("wallhaven-abc123(2).jpg", None),
            ("wallhaven-abc123 (two).jpg", None),
            ("sunset.webp", None),
        ];
        for (name, _) in named {
            std::fs::write(dir.path().join(name), b"").unwrap();
        }
        // Not an image, so not a wallpaper at all.
        std::fs::write(dir.path().join("wallhaven-abc123.gif"), b"").unwrap();

        let report = scan(&db, dir.path());

        assert_eq!(report.completion().added_count, named.len() as u64);
        for (name, expected) in named {
            let id = id_of(&db, &dir.path().join(name));
            assert_eq!(
                db.read(|conn| testing::wallhaven_id_of(conn, id))
                    .as_deref(),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn a_library_root_that_is_gone_fails_the_scan_and_touches_nothing() {
        // ADR 0034: the scan's own ending rather than a refusal of the call.
        // And no `began`, which is what keeps the pre-generation pass running:
        // nothing restarts it on `scan-failed`, so a mistyped folder that
        // stood it down would retire it for the rest of the session.
        let db = library();
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("unplugged");

        let report = scan(&db, &gone);

        assert_eq!(*report.began.borrow(), 0);
        assert_eq!(*report.progress.borrow(), vec![]);
        let message = report.failure();
        assert!(message.starts_with("There's no folder at "), "{message}");
        assert_eq!(wallpaper_count(&db), 0);
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
        // unexpanded string fails — the reason `start_scan` takes a `String`.
        //
        // `HOME` is a stand-in home folder rather than the real one, so nothing
        // here reads the process environment.
        let home = tempfile::tempdir().unwrap();
        let pics = home.path().join("pics");
        std::fs::create_dir(&pics).unwrap();

        let home_value = home.path().to_str().unwrap().to_string();
        let root = LibraryRoot::expand_with("~/pics", |name| {
            (name == "HOME").then(|| home_value.clone())
        })
        .unwrap()
        .resolve()
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
        let err = LibraryRoot::expand("$WALLTARE_NO_SUCH_VARIABLE/pics")
            .err()
            .expect("an unset variable does not expand");
        assert!(
            matches!(err, error::AppError::InvalidPathSyntax(ref m)
                if m == "unknown environment variable WALLTARE_NO_SUCH_VARIABLE"),
            "got {err:?}"
        );
    }

    #[test]
    fn a_scan_root_that_is_not_a_directory_is_no_folder() {
        // Pointing a Library root at a JPEG is a typo, and reads the same as a
        // folder that is not there.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.jpg");
        std::fs::write(&file, b"").unwrap();

        for input in [file, dir.path().join("nope")] {
            let written = input.display().to_string();
            let message = scan_root(&written).unwrap_err();
            assert!(
                message.starts_with("There's no folder at "),
                "{written} gave {message}"
            );
        }
    }

    #[test]
    fn a_library_root_that_is_gone_says_where_it_looked_and_what_survived() {
        // The sentence a curator whose drive is unmounted reads. Both halves are
        // load-bearing: the path, because it is the thing to fix, and the second
        // sentence, because `CONTEXT.md` says the wallpapers an earlier scan
        // found stay in the library and nothing else on screen says so.
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("unplugged");

        let message = unwalkable_root(&gone);

        assert!(message.starts_with("There's no folder at "), "{message}");
        assert!(message.contains(&gone.display().to_string()), "{message}");
        assert!(
            message.contains("every wallpaper already in your library is still in it"),
            "{message}"
        );
    }

    #[test]
    fn a_library_root_that_is_there_and_will_not_resolve_reads_as_unreadable() {
        // The exotic half of `LibraryRoot::resolve`: the directory check passed
        // and the canonicalization did not. Telling that curator there is no
        // folder there would be a lie they can see out of the window.
        let dir = tempfile::tempdir().unwrap();

        let message = unwalkable_root(dir.path());

        assert!(
            message.starts_with("walltare couldn't read the folder at "),
            "{message}"
        );
        assert!(
            message.contains("every wallpaper already in your library is still in it"),
            "{message}"
        );
    }

    #[test]
    fn starts_that_race_let_exactly_one_scan_run() {
        // Two scans would race each other over the same connection, inserting
        // the same walk twice. Every start below waits at the barrier and then
        // claims at once, and each holds what it got until all have tried.
        let running = Running::default();
        let barrier = std::sync::Barrier::new(8);

        let claimed = std::thread::scope(|scope| {
            let tries: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        barrier.wait();
                        running.try_start()
                    })
                })
                .collect();
            tries
                .into_iter()
                .map(|t| t.join().unwrap())
                .collect::<Vec<_>>()
        });

        assert_eq!(claimed.iter().filter(|guard| guard.is_some()).count(), 1);
    }

    #[test]
    fn a_scan_that_has_finished_lets_the_next_one_start() {
        let running = Running::default();

        let first = running.try_start().expect("nothing was running");
        assert!(running.try_start().is_none(), "a second scan started");
        drop(first);

        assert!(
            running.try_start().is_some(),
            "the finished scan still held it"
        );
    }

    #[test]
    fn a_scan_that_panics_does_not_refuse_every_later_scan() {
        let running = Running::default();
        let guard = running.try_start().expect("nothing was running");

        let scan = std::thread::spawn(move || {
            let _running = guard;
            panic!("the scan panicked");
        });

        assert!(scan.join().is_err(), "the scan did not panic");
        assert!(
            running.try_start().is_some(),
            "the panicked scan still held it"
        );
    }
}
