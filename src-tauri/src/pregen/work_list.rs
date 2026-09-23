//! The pre-generation pass's work list: which wallpapers it owes something, and
//! in what order it reaches them.
//!
//! Two halves in the order `missing.rs` documents for its own pair: the query
//! under the connection, and the `read_dir` plus one `stat` per row with it
//! released (ADR 0039). The order is the pass's (ADR 0016), and so is what an
//! entry says it is owed. What the cache holds is [`ThumbnailCache`]'s, and all
//! it is asked is [`ThumbnailCache::candidates`] — the rows — and
//! [`ThumbnailCache::cached`] — which files are on disk.

use crate::db::Status;
use crate::error::AppError;
use crate::thumbnails::{source_mtime, Candidate, Missing, Pending, Size, ThumbnailCache};
use crate::Db;

/// Every wallpaper the pre-generation pass would warm, in the order it would
/// reach them.
///
/// `Db::read` drops the guard before it returns, so the second half — 5,000
/// filesystem calls at ADR 0016's ceiling, on whatever drive the Library root
/// sits on — holds nothing while the first view fetches its listing and fires
/// fifty thumbnail requests (ADR 0039).
pub fn work_list(db: &Db, cache: &ThumbnailCache) -> Result<Vec<Pending>, AppError> {
    let mut candidates = cache.candidates(db)?;
    order(&mut candidates);
    due(&candidates, cache)
}

/// Puts the rows in the order the pass reaches them: Rejected last, then least
/// compared first, then by id.
///
/// Rejected is a tail group behind the Eligible pool, so warming rejects costs
/// the voting pool nothing (ADR 0016), and least compared first targets the
/// half of a pair `select_pair` picks by least-compared ties, which is the half
/// anything can aim at. A scan inserts rows at count 0, so freshly scanned
/// files land at the head.
///
/// Each row carries the Status it was listed under, because the pass compares
/// the row against that rather than against Eligible: a Rejected entry is the
/// tail group and gets generated, one rejected after the fact does not.
fn order(candidates: &mut [Candidate]) {
    candidates.sort_by_key(|c| {
        (
            c.status == Status::Rejected,
            c.comparisons_count,
            c.wallpaper_id,
        )
    });
}

/// Every wallpaper the pre-generation pass would generate, in the order it
/// would reach them — the filesystem half, run with the connection released.
///
/// One `read_dir` of the cache directory, through [`ThumbnailCache::cached`],
/// and one `stat` per source file, over the rows [`order`] arranged. No
/// image bytes are read at all. Running the cache's own lookup over the library
/// instead would reuse the freshness
/// rule exactly, and would also read the whole cache off disk on every launch to
/// discover that nothing needs doing — 830MB of pointless reads on a
/// two-thousand-wallpaper library (ADR 0012).
///
/// The order is the one it was handed, and every entry keeps the Status its row
/// was read under.
///
/// The length is the honest total for the pass's progress, because a wallpaper
/// it would skip never enters the list. That is also why a source the pass has
/// already read and failed to decode is left out while the note still matches
/// the file: it is not work, and listing it would spend a decode per launch to
/// re-learn the same answer (ADR 0034).
///
/// Thumbnails are not the only thing that puts a wallpaper on the list. One
/// whose pixel dimensions are unknown is listed for those alone, however warm
/// its cache is, and comes off the list for good once they are written
/// (ADR 0044).
fn due(candidates: &[Candidate], cache: &ThumbnailCache) -> Result<Vec<Pending>, AppError> {
    let cached = cache.cached()?;

    let mut pending = Vec::new();
    for candidate in candidates {
        // A source that is not on disk cannot be stat'd, so no recorded mtime
        // can be said to match it and the wallpaper joins the list. That is
        // what makes a missing file counted and skipped rather than silently
        // absent: the pass fails it, reports it, and carries on.
        let on_disk = source_mtime(&candidate.source).ok();
        // A source the pass already read and could not decode, still the same
        // bytes it could not decode. Skipped here rather than failed again by
        // the pass, so a folder of years of accumulated downloads costs its
        // broken files one decode each and not one per launch (ADR 0034). A
        // note against an mtime the file no longer has does not apply, which is
        // how a re-exported file gets another go.
        if matches!((candidate.failed_mtime, on_disk), (Some(noted), Some(d)) if noted == d) {
            continue;
        }
        let fresh = |recorded: Option<i64>, size: Size| {
            matches!((recorded, on_disk), (Some(r), Some(d)) if r == d)
                && cached.holds(candidate.wallpaper_id, size)
        };

        let missing = match (
            fresh(candidate.small_mtime, Size::Small),
            fresh(candidate.medium_mtime, Size::Medium),
        ) {
            (true, true) => None,
            (false, false) => Some(Missing::Both),
            (false, true) => Some(Missing::Only(Size::Small)),
            (true, false) => Some(Missing::Only(Size::Medium)),
        };
        // A fully warm wallpaper still joins the list when its dimensions are
        // unknown, which is the whole cohort of a library scanned before the
        // columns existed: their thumbnails are fresh, so the freshness rule
        // above would drop every one of them and the backfill would never
        // happen (ADR 0044).
        if missing.is_none() && candidate.dimensions_known {
            continue;
        }
        pending.push(Pending {
            wallpaper_id: candidate.wallpaper_id,
            source: candidate.source.clone(),
            status: candidate.status,
            missing,
        });
    }
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use image::{DynamicImage, Rgba, RgbaImage};
    use rusqlite::Connection;
    use std::path::PathBuf;

    /// A library behind a [`ThumbnailCache`], the way `thumbnails`' own tests
    /// build one: a `Db` over an in-memory database, a folder of sources and a
    /// cache directory of its own. The work list is read through the cache's
    /// public operations, so a wallpaper is made warm by warming it.
    struct Library {
        db: Db,
        cache: ThumbnailCache,
        sources: tempfile::TempDir,
        cache_dir: tempfile::TempDir,
    }

    impl Library {
        fn new() -> Self {
            let conn = Connection::open_in_memory().unwrap();
            db::init_schema(&conn).unwrap();
            let cache_dir = tempfile::tempdir().unwrap();
            Self {
                db: Db::new(conn),
                cache: ThumbnailCache::new(cache_dir.path().to_path_buf()),
                sources: tempfile::tempdir().unwrap(),
                cache_dir,
            }
        }

        /// A wallpaper as a scan leaves it, pixel dimensions recorded (ADR 0044).
        fn seed(&self, name: &str, img: &DynamicImage) -> i64 {
            let id = self.seed_unmeasured(name, img);
            self.db
                .write(|conn| db::record_dimensions(conn, id, img.width(), img.height()))
                .unwrap();
            id
        }

        /// A wallpaper with NULL dimensions: what a database written before the
        /// columns existed holds, and the cohort the pass backfills.
        fn seed_unmeasured(&self, name: &str, img: &DynamicImage) -> i64 {
            let path = self.source(name);
            img.save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            self.db.write(|conn| {
                conn.execute(
                    "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
                    rusqlite::params![name, path.to_str().unwrap()],
                )
                .unwrap();
                conn.last_insert_rowid()
            })
        }

        fn source(&self, name: &str) -> PathBuf {
            self.sources.path().join(name)
        }

        /// Warms a wallpaper the way the pass does for one it has never
        /// generated, which is what "fully warm" means to the work list.
        fn warm(&self, id: i64, name: &str) {
            self.cache
                .warm(
                    &self.db,
                    &Pending {
                        wallpaper_id: id,
                        source: self.source(name),
                        status: Status::Active,
                        missing: Some(Missing::Both),
                    },
                )
                .unwrap();
        }

        fn rank(&self, id: i64, status: &str, comparisons: i64) {
            self.db.write(|conn| {
                conn.execute(
                    "UPDATE wallpapers SET status = ?2, comparisons_count = ?3 WHERE id = ?1",
                    rusqlite::params![id, status, comparisons],
                )
                .unwrap()
            });
        }

        fn note(&self, id: i64, name: &str, message: &str) {
            self.cache.note(&self.db, id, &self.source(name), message);
        }

        fn work_list(&self) -> Vec<Pending> {
            work_list(&self.db, &self.cache).unwrap()
        }

        fn listed(&self) -> Vec<(i64, Option<Missing>)> {
            self.work_list()
                .into_iter()
                .map(|p| (p.wallpaper_id, p.missing))
                .collect()
        }
    }

    fn solid(width: u32, height: u32, color: [u8; 4]) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba(color)))
    }

    /// Moves a file's mtime forward without touching its bytes, so freshness
    /// says "changed" for a file the test does not have to rewrite.
    fn touch_later(path: &std::path::Path) {
        std::fs::File::options()
            .append(true)
            .open(path)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();
    }

    #[test]
    fn a_wallpaper_with_neither_size_joins_the_work_list() {
        let library = Library::new();
        let id = library.seed("cold.png", &solid(20, 10, [1, 1, 1, 255]));

        assert_eq!(
            library.work_list(),
            vec![Pending {
                wallpaper_id: id,
                source: library.source("cold.png"),
                status: Status::Active,
                missing: Some(Missing::Both),
            }]
        );
    }

    #[test]
    fn a_wallpaper_with_both_sizes_fresh_stays_out_of_the_work_list() {
        let library = Library::new();
        let warmed = library.seed("w.png", &solid(20, 10, [1, 1, 1, 255]));
        let cold = library.seed("c.png", &solid(20, 10, [2, 2, 2, 255]));
        library.warm(warmed, "w.png");

        assert_eq!(library.listed(), vec![(cold, Some(Missing::Both))]);
    }

    #[test]
    fn a_wallpaper_missing_only_one_size_joins_for_that_size_alone() {
        // "Small is missing, medium is fresh" is what `Size::donors` was built
        // for, so the pass has to be told which size rather than just that
        // something is due.
        let library = Library::new();
        let id = library.seed("one.png", &solid(20, 10, [3, 3, 3, 255]));
        library.warm(id, "one.png");
        library.db.write(|conn| {
            conn.execute(
                "DELETE FROM thumbnails WHERE wallpaper_id = ?1 AND size = 'small'",
                [id],
            )
            .unwrap()
        });

        assert_eq!(
            library.listed(),
            vec![(id, Some(Missing::Only(Size::Small)))]
        );
    }

    #[test]
    fn a_fully_warm_wallpaper_with_no_dimensions_joins_the_list_for_those_alone() {
        // The cohort of a library scanned before the columns existed, and the
        // reason the backfill cannot ride on the thumbnails: every one of these
        // wallpapers is warm, so the freshness rule on its own drops all of them
        // and the dimensions never arrive (ADR 0044).
        let library = Library::new();
        let id = library.seed_unmeasured("old.png", &solid(20, 10, [5, 5, 5, 255]));
        library.warm(id, "old.png");
        // Warming measures as it goes, so the column is put back to what a
        // database from before it existed holds.
        library.db.write(|conn| {
            conn.execute(
                "UPDATE wallpapers SET width = NULL, height = NULL WHERE id = ?1",
                [id],
            )
            .unwrap()
        });

        // Listed, and owing no thumbnail, which is the only thing that puts a
        // warm wallpaper here.
        assert_eq!(library.listed(), vec![(id, None)]);

        // And it comes off the list for good once they are written, so the
        // backfill is one pass and not one per launch.
        library
            .db
            .write(|conn| db::record_dimensions(conn, id, 20, 10))
            .unwrap();
        assert!(library.work_list().is_empty());
    }

    #[test]
    fn a_cold_wallpaper_with_no_dimensions_is_listed_for_its_thumbnails() {
        // A wallpaper short of both is listed as owing thumbnails and nothing
        // else, because the pass measures every wallpaper it reaches: the entry
        // records only what is not implied (ADR 0044).
        let library = Library::new();
        let id = library.seed_unmeasured("cold.png", &solid(20, 10, [6, 6, 6, 255]));

        assert_eq!(
            library.work_list(),
            vec![Pending {
                wallpaper_id: id,
                source: library.source("cold.png"),
                status: Status::Active,
                missing: Some(Missing::Both),
            }]
        );
    }

    #[test]
    fn a_recorded_mtime_that_no_longer_matches_the_source_rejoins_the_work_list() {
        let library = Library::new();
        let id = library.seed("e.png", &solid(20, 10, [4, 4, 4, 255]));
        library.warm(id, "e.png");
        assert!(library.work_list().is_empty());

        touch_later(&library.source("e.png"));

        assert_eq!(library.listed(), vec![(id, Some(Missing::Both))]);
    }

    #[test]
    fn a_row_whose_cache_file_is_gone_rejoins_the_work_list() {
        // A row is not a cache hit. The work list reads the directory rather
        // than trusting the table, because a row can outlive its file.
        let library = Library::new();
        let id = library.seed("f.png", &solid(20, 10, [5, 5, 5, 255]));
        library.warm(id, "f.png");

        std::fs::remove_file(library.cache.file(id, Size::Medium)).unwrap();

        assert_eq!(
            library.listed(),
            vec![(id, Some(Missing::Only(Size::Medium)))]
        );
    }

    #[test]
    fn a_wallpaper_whose_source_is_gone_joins_so_the_pass_can_count_it() {
        // Nothing can be said about the freshness of a file that is not there,
        // and a wallpaper the pass never lists is a wallpaper it never reports
        // as failed.
        let library = Library::new();
        let id = library.seed("gone.png", &solid(20, 10, [6, 6, 6, 255]));
        library.warm(id, "gone.png");
        std::fs::remove_file(library.source("gone.png")).unwrap();

        assert_eq!(library.listed(), vec![(id, Some(Missing::Both))]);
    }

    #[test]
    fn the_work_list_puts_rejected_last_and_least_compared_first() {
        let library = Library::new();
        let img = solid(20, 10, [7, 7, 7, 255]);
        let voted = library.seed("voted.png", &img);
        let rejected_fresh = library.seed("rej-new.png", &img);
        let scanned = library.seed("scanned.png", &img);
        let rejected_voted = library.seed("rej-old.png", &img);
        let kept = library.seed("kept.png", &img);
        library.rank(voted, "active", 9);
        library.rank(rejected_fresh, "rejected", 0);
        library.rank(scanned, "active", 0);
        library.rank(rejected_voted, "rejected", 9);
        library.rank(kept, "kept", 3);

        let order: Vec<(i64, Status)> = library
            .work_list()
            .into_iter()
            .map(|p| (p.wallpaper_id, p.status))
            .collect();

        // Kept is Eligible, so it sits in the head group with Active; a scan
        // inserts at count 0, which is where the next pair is drawn from. Each
        // entry carries the Status it was listed under, which is what the pass
        // compares the row against when its turn comes.
        assert_eq!(
            order,
            vec![
                (scanned, Status::Active),
                (kept, Status::Kept),
                (voted, Status::Active),
                (rejected_fresh, Status::Rejected),
                (rejected_voted, Status::Rejected),
            ]
        );
    }

    #[test]
    fn the_two_halves_agree_over_a_library_in_every_state_at_once() {
        // The whole list, pinned as one value: which wallpapers are in it, what
        // each is owed, which Status it was listed under, and the order. The
        // split into a query and a filesystem pass (ADR 0039) is meant to change
        // none of that, and this is the test that says so.
        let library = Library::new();
        let img = solid(20, 10, [1, 2, 3, 255]);
        let cold = library.seed("cold.png", &img);
        let warm_one = library.seed("warm.png", &img);
        let half = library.seed("half.png", &img);
        let rejected = library.seed("rejected.png", &img);
        let noted = library.seed("noted.png", &img);
        library.warm(warm_one, "warm.png");
        library.warm(half, "half.png");
        std::fs::remove_file(library.cache.file(half, Size::Small)).unwrap();
        library.rank(cold, "active", 0);
        library.rank(half, "kept", 2);
        library.rank(rejected, "rejected", 0);
        library.note(noted, "noted.png", "image: nope");

        // The order the two halves are called in production: the query, then
        // the `read_dir` and the `stat`s, with nothing borrowed in between.
        let mut rows = library.cache.candidates(&library.db).unwrap();
        order(&mut rows);
        let list = due(&rows, &library.cache).unwrap();

        assert_eq!(
            list,
            vec![
                Pending {
                    wallpaper_id: cold,
                    source: library.source("cold.png"),
                    status: Status::Active,
                    missing: Some(Missing::Both),
                },
                Pending {
                    wallpaper_id: half,
                    source: library.source("half.png"),
                    status: Status::Kept,
                    missing: Some(Missing::Only(Size::Small)),
                },
                Pending {
                    wallpaper_id: rejected,
                    source: library.source("rejected.png"),
                    status: Status::Rejected,
                    missing: Some(Missing::Both),
                },
            ]
        );
        // The two that are not in it, and the two different reasons: one is
        // fully warm and one has a note against the bytes it still has.
        assert!(rows.iter().any(|c| c.wallpaper_id == warm_one));
        assert!(rows.iter().any(|c| c.wallpaper_id == noted));
        // And the operation is the same two halves.
        assert_eq!(library.work_list(), list);
    }

    #[test]
    fn the_filesystem_half_decides_the_list_from_rows_and_no_connection_at_all() {
        // No `Connection` in this test at all, which is the point: everything
        // the pass asks the disk is decidable from the rows it was handed, so
        // the query is finished with — and the lock released — before the first
        // `stat` (ADR 0039). Unwritable while the two were one function.
        let sources = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let thumbnails = ThumbnailCache::new(cache.path().to_path_buf());
        let write = |name: &str| {
            let path = sources.path().join(name);
            solid(20, 10, [1, 1, 1, 255])
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let mtime = source_mtime(&path).unwrap();
            (path, mtime)
        };
        // The cache files are named rather than generated: freshness reads the
        // directory for a filename and never opens what it finds.
        let cache_file = |id: i64, size: Size| {
            std::fs::write(thumbnails.file(id, size), b"a cache file").unwrap();
        };

        let (warm_path, warm_mtime) = write("warm.png");
        cache_file(1, Size::Small);
        cache_file(1, Size::Medium);
        let (cold_path, _) = write("cold.png");
        let (donor_path, donor_mtime) = write("donor.png");
        cache_file(3, Size::Medium);
        let (broken_path, broken_mtime) = write("broken.png");
        let gone_path = sources.path().join("gone.png");

        let rows = vec![
            Candidate {
                wallpaper_id: 1,
                source: warm_path,
                status: Status::Active,
                small_mtime: Some(warm_mtime),
                medium_mtime: Some(warm_mtime),
                failed_mtime: None,
                dimensions_known: true,
                comparisons_count: 0,
            },
            Candidate {
                wallpaper_id: 2,
                source: cold_path.clone(),
                status: Status::Active,
                small_mtime: None,
                medium_mtime: None,
                failed_mtime: None,
                dimensions_known: true,
                comparisons_count: 0,
            },
            Candidate {
                wallpaper_id: 3,
                source: donor_path.clone(),
                status: Status::Kept,
                small_mtime: None,
                medium_mtime: Some(donor_mtime),
                failed_mtime: None,
                dimensions_known: true,
                comparisons_count: 0,
            },
            Candidate {
                wallpaper_id: 4,
                source: broken_path,
                status: Status::Active,
                small_mtime: None,
                medium_mtime: None,
                failed_mtime: Some(broken_mtime),
                dimensions_known: true,
                comparisons_count: 0,
            },
            // Recorded as warm against an mtime nothing can be compared to any
            // more, so it is listed and the pass gets to count it (ADR 0032).
            Candidate {
                wallpaper_id: 5,
                source: gone_path.clone(),
                status: Status::Rejected,
                small_mtime: Some(1),
                medium_mtime: Some(1),
                failed_mtime: None,
                dimensions_known: true,
                comparisons_count: 0,
            },
        ];

        let list = due(&rows, &thumbnails).unwrap();

        assert_eq!(
            list,
            vec![
                Pending {
                    wallpaper_id: 2,
                    source: cold_path,
                    status: Status::Active,
                    missing: Some(Missing::Both),
                },
                Pending {
                    wallpaper_id: 3,
                    source: donor_path,
                    status: Status::Kept,
                    missing: Some(Missing::Only(Size::Small)),
                },
                Pending {
                    wallpaper_id: 5,
                    source: gone_path,
                    status: Status::Rejected,
                    missing: Some(Missing::Both),
                },
            ]
        );
    }

    #[test]
    fn a_noted_source_leaves_the_work_list_until_the_file_changes() {
        // The whole of "not retried endlessly": the pass reads a broken file
        // once, writes down which version of it broke, and every launch after
        // that costs a `stat` instead of a decode. A re-exported file has a new
        // mtime, so the note stops applying and it gets another go (ADR 0034).
        let library = Library::new();
        let broken = library.seed("broken.png", &solid(20, 10, [1, 1, 1, 255]));
        let fine = library.seed("fine.png", &solid(20, 10, [2, 2, 2, 255]));
        assert_eq!(
            library.listed(),
            vec![(broken, Some(Missing::Both)), (fine, Some(Missing::Both))]
        );

        library.note(broken, "broken.png", "image: not an image");

        // The note only takes the wallpaper it is about out of the list.
        assert_eq!(library.listed(), vec![(fine, Some(Missing::Both))]);

        touch_later(&library.source("broken.png"));

        assert_eq!(
            library.listed(),
            vec![(broken, Some(Missing::Both)), (fine, Some(Missing::Both))]
        );
    }

    #[test]
    fn a_noted_source_that_is_no_longer_on_disk_is_listed_again() {
        // Nothing can be said about the freshness of a file that is not there,
        // and a note against an mtime nothing can be compared to is not a reason
        // to stop reporting the wallpaper. The pass fails it, counts it, and
        // does not decode anything to find out (ADR 0032, ADR 0034).
        let library = Library::new();
        let id = library.seed("gone.png", &solid(20, 10, [3, 3, 3, 255]));
        library.note(id, "gone.png", "image: nope");
        assert!(library.work_list().is_empty());

        std::fs::remove_file(library.source("gone.png")).unwrap();

        assert_eq!(library.listed(), vec![(id, Some(Missing::Both))]);
    }

    #[test]
    fn the_work_list_is_empty_on_a_fully_warm_library() {
        // Every launch after the first. An empty list is what makes the pass
        // emit nothing rather than flash a finished bar.
        let library = Library::new();
        for name in ["a.png", "b.png", "c.png"] {
            let id = library.seed(name, &solid(20, 10, [8, 8, 8, 255]));
            library.warm(id, name);
        }

        assert!(library.work_list().is_empty());
    }

    #[test]
    fn the_work_list_survives_a_cache_directory_that_does_not_exist_yet() {
        // First launch: nothing has written a thumbnail, so nothing has created
        // the directory either, and the whole library is due.
        let mut library = Library::new();
        let id = library.seed("first.png", &solid(20, 10, [9, 9, 9, 255]));
        library.cache = ThumbnailCache::new(library.cache_dir.path().join("no-such-cache"));

        assert_eq!(library.listed(), vec![(id, Some(Missing::Both))]);
    }
}
