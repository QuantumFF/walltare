//! A file arriving in the library: the one way a row is made for a file, and
//! the facts read off it as it comes in.
//!
//! A scan arrives its walk a chunk at a time, and a download arrives the one
//! file it landed — ADR 0051's "a download lands as a scan of one file", held
//! in one place rather than written once in each. Before #417 it was written
//! three times, with three error policies, and two of them were wrong: a
//! download that had inserted its row reported the file Failed when the
//! Dimensions write after it was refused, and a downloaded wallpaper went
//! unhashed until the next launch, so it could not be offered as a
//! Near-duplicate of anything.
//!
//! [`arrive`] is the whole interface, in three steps:
//!
//! 1. **The insert, under the connection.** `INSERT OR IGNORE` on the path, so
//!    only the files that were not already wallpapers come back, each with the
//!    Wallhaven id its name carries (ADR 0050).
//! 2. **The Dimensions, read with the connection released, then recorded
//!    under it** (ADR 0039, ADR 0044) — a header read per new file, never a
//!    decode.
//! 3. **The thumbnails and the perceptual hash**, which are [`Warm`]'s to say:
//!    left to the pass the scan's ending starts, or made now.
//!
//! **One error policy.** Only the insert can fail an arrival, because the row is
//! the arrival: once it is in, the wallpaper is in the library, and everything
//! after it is a fact that is backfillable. A Dimensions write the database
//! refuses is logged, and the pass measures the row the next time it reaches
//! it; a file that will not decode is noted the way the pass notes one
//! (ADR 0034). Neither turns an arrived wallpaper into a failed one.

use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};

use crate::db::{self, Added, Status};
use crate::thumbnails::{Missing, Pending, ThumbnailCache};
use crate::{scanner, Db};

/// When an arrival's thumbnails, and the perceptual hash taken off its Small,
/// are made.
///
/// The hash is off the Small rather than the source, so that every hash in the
/// library is a hash of the same kind of image (ADR 0044's amendment), and a
/// Small is a full decode of the source. That is why the dimensions are an
/// arrival's own and this is a choice.
pub enum Warm<'a> {
    /// By the pre-generation pass: what a scan does. The frontend starts the
    /// pass on the scan's ending, and its work list holds every wallpaper owed a
    /// thumbnail or a hash, so a chunk of hundreds of files is not decoded here,
    /// outside the pass's one-wallpaper budget, progress and cancel (ADR 0012).
    ByThePass,
    /// Here, before [`arrive`] returns: what a download does. No pass follows a
    /// download (ADR 0051), so without this its wallpaper would wait for the
    /// next launch or scan to be hashed, and until then nothing could be offered
    /// as its Near-duplicate. One file per call, one decode, on the caller's
    /// thread and through the same [`ThumbnailCache::warm`] the pass uses, so
    /// ADR 0049's decode cap and gate hold here exactly as they do there.
    Now(&'a ThumbnailCache),
}

/// Makes a wallpaper of each of `paths` that is not one already, and answers
/// with the ones it made.
///
/// The error is the insert's, and it is the only one: a refused insert rolls
/// back whole, so nothing in `paths` arrived. Past it, nothing here fails, per
/// the module's error policy.
///
/// `paths` are spelled as the scan spells them, canonical and absolute, since
/// the path is the wallpaper's identity and `UNIQUE(path)` compares strings.
pub fn arrive(db: &Db, paths: &[PathBuf], warm: Warm) -> Result<Vec<Added>, rusqlite::Error> {
    let added = db.write(|conn| db::insert_new_wallpapers(conn, paths))?;
    // Past the insert, a panic is a fact about one file's bytes like any other
    // failure here, and must not unwind into a caller that would report rows
    // already in the library as not arrived. `warm` catches its own; the header
    // reads are the image crate's too.
    let facts = std::panic::catch_unwind(AssertUnwindSafe(|| {
        record_dimensions(db, added.iter().map(|row| (row.id, row.path.as_path())));
    }));
    if facts.is_err() {
        eprintln!("reading the dimensions of new wallpapers panicked");
    }
    if let Warm::Now(cache) = warm {
        for row in &added {
            warm_now(db, cache, row);
        }
    }
    Ok(added)
}

/// Reads each file's pixel Dimensions and writes them to its row, for a scan's
/// chunk, a download, and every wallpaper the pre-generation pass reaches.
///
/// Two steps: the header reads with the connection released, then the writes
/// under it in one transaction (ADR 0039). A scan's chunk is hundreds of
/// files, so holding the lock across the reads would queue every command and
/// every `wallpaper://` request behind that many file opens on whatever drive
/// the Library root sits on.
///
/// A file whose Dimensions cannot be read is not written at all. NULL is what
/// says they are unknown, and overwriting a known pair with NULL would turn a
/// file that went missing for a moment into a wallpaper the app has forgotten
/// the size of (ADR 0044). The pass that decodes it later is where a broken
/// source is counted and reported (ADR 0034).
///
/// A write that fails is logged rather than surfaced: the Dimensions are
/// backfillable, and the wallpapers are in the library either way.
pub fn record_dimensions<'a>(db: &Db, files: impl IntoIterator<Item = (i64, &'a Path)>) {
    let measured: Vec<(i64, u32, u32)> = files
        .into_iter()
        .filter_map(|(id, path)| {
            scanner::dimensions(path).map(|(width, height)| (id, width, height))
        })
        .collect();
    if measured.is_empty() {
        return;
    }
    if let Err(e) = db.write(|conn| db::record_dimensions_batch(conn, &measured)) {
        eprintln!("could not record pixel dimensions: {e}");
    }
}

/// Makes one arrival's thumbnails and hash, as the pass would have.
///
/// Both sizes are missing, because the row is new and nothing has been made for
/// its id. Its Status is Active, because every row arrives Active; a reject that
/// lands before this runs makes it a skip, which is the pass's Status re-check.
/// The failure is the pass's too: written down against the file's mtime when it
/// will not decode. Nothing reports it beyond a log line, because the file has
/// landed regardless, and the thumbnails are made on demand when the wallpaper
/// is first shown, as ADR 0051 had them.
fn warm_now(db: &Db, cache: &ThumbnailCache, arrived: &Added) {
    let pending = Pending {
        wallpaper_id: arrived.id,
        source: arrived.path.clone(),
        status: Status::Active,
        comparisons_count: 0,
        missing: Some(Missing::Both),
    };
    if let Err(e) = cache.warm(db, &pending) {
        eprintln!("could not warm {}: {e}", arrived.path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{dimensions_of, perceptual_hash_of, wallhaven_id_of};

    struct Library {
        dir: tempfile::TempDir,
        cache_dir: tempfile::TempDir,
        db: Db,
    }

    impl Library {
        fn new() -> Self {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            db::init_schema(&conn).unwrap();
            Self {
                dir: tempfile::tempdir().unwrap(),
                cache_dir: tempfile::tempdir().unwrap(),
                db: Db::new(conn),
            }
        }

        fn cache(&self) -> ThumbnailCache {
            ThumbnailCache::new(self.cache_dir.path().to_path_buf())
        }

        /// A PNG of the given size at `name`, the way a curator's export tool
        /// would write one.
        fn png(&self, name: &str, width: u32, height: u32) -> PathBuf {
            let path = self.dir.path().join(name);
            image::RgbImage::from_fn(width, height, |x, y| {
                image::Rgb([(x * 7) as u8, (y * 11) as u8, ((x + y) * 3) as u8])
            })
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
            path
        }

        fn refuse(&self, statement: &str) {
            self.db.write(|conn| {
                conn.execute_batch(&format!(
                    "CREATE TRIGGER refuse BEFORE {statement} ON wallpapers
                     BEGIN SELECT RAISE(ABORT, 'the disk is full'); END;"
                ))
                .unwrap()
            });
        }

        fn count(&self) -> i64 {
            self.db.read(|conn| {
                conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
                    .unwrap()
            })
        }

        fn thumbnail_rows(&self, id: i64) -> i64 {
            self.db.read(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM thumbnails WHERE wallpaper_id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap()
            })
        }
    }

    #[test]
    fn an_arrival_carries_its_wallhaven_id_and_the_dimensions_off_its_header() {
        let library = Library::new();
        let named = library.png("wallhaven-qrow67.png", 12, 5);
        let plain = library.png("sunset.png", 30, 20);

        let added = arrive(
            &library.db,
            &[named.clone(), plain.clone()],
            Warm::ByThePass,
        )
        .unwrap();

        assert_eq!(
            added.iter().map(|a| &a.path).collect::<Vec<_>>(),
            [&named, &plain]
        );
        library.db.read(|conn| {
            assert_eq!(
                wallhaven_id_of(conn, added[0].id).as_deref(),
                Some("qrow67")
            );
            assert_eq!(dimensions_of(conn, added[0].id), (Some(12), Some(5)));
            assert_eq!(wallhaven_id_of(conn, added[1].id), None);
            assert_eq!(dimensions_of(conn, added[1].id), (Some(30), Some(20)));
        });
    }

    #[test]
    fn only_the_files_that_were_not_wallpapers_arrive() {
        // `INSERT OR IGNORE` is what makes a rescan of a warm library cost a
        // header read per new file rather than one per wallpaper.
        let library = Library::new();
        let first = library.png("first.png", 4, 4);
        arrive(&library.db, std::slice::from_ref(&first), Warm::ByThePass).unwrap();
        let second = library.png("second.png", 8, 8);

        let added = arrive(&library.db, &[first, second.clone()], Warm::ByThePass).unwrap();

        assert_eq!(added.len(), 1);
        assert_eq!(added[0].path, second);
    }

    #[test]
    fn a_file_with_no_readable_header_arrives_with_its_dimensions_unknown() {
        // A zero-byte `.jpg` is a wallpaper to the walk, and failing over it
        // would lose the files beside it (ADR 0034).
        let library = Library::new();
        let empty = library.dir.path().join("empty.jpg");
        std::fs::write(&empty, b"").unwrap();
        let good = library.png("good.png", 6, 2);

        let added = arrive(&library.db, &[empty, good], Warm::Now(&library.cache())).unwrap();

        library.db.read(|conn| {
            assert_eq!(dimensions_of(conn, added[0].id), (None, None));
            assert_eq!(dimensions_of(conn, added[1].id), (Some(6), Some(2)));
        });
    }

    #[test]
    fn an_insert_that_is_refused_is_the_error_and_nothing_arrives() {
        let library = Library::new();
        library.refuse("INSERT");
        let file = library.png("a.png", 4, 4);

        let err = arrive(&library.db, &[file], Warm::ByThePass).unwrap_err();

        assert!(err.to_string().contains("the disk is full"), "{err}");
        assert_eq!(library.count(), 0);
    }

    #[test]
    fn a_refused_dimensions_write_still_arrives_the_wallpaper() {
        // The row is the arrival. Everything after it is backfillable, so a
        // write the database refuses past it is not the arrival failing (#417).
        let library = Library::new();
        library.refuse("UPDATE OF width");
        let file = library.png("a.png", 4, 4);

        let added = arrive(&library.db, &[file], Warm::Now(&library.cache())).unwrap();

        assert_eq!(added.len(), 1);
        library
            .db
            .read(|conn| assert_eq!(dimensions_of(conn, added[0].id), (None, None)));
    }

    #[test]
    fn warming_now_makes_both_thumbnails_and_the_perceptual_hash() {
        let library = Library::new();
        let file = library.png("a.png", 640, 360);

        let added = arrive(&library.db, &[file], Warm::Now(&library.cache())).unwrap();

        let id = added[0].id;
        assert_eq!(library.thumbnail_rows(id), 2);
        assert!(library
            .db
            .read(|conn| perceptual_hash_of(conn, id))
            .is_some());
    }

    #[test]
    fn leaving_it_to_the_pass_decodes_nothing() {
        // A scan's chunk is hundreds of files, and the pass is what owns their
        // decodes (ADR 0012).
        let library = Library::new();
        let file = library.png("a.png", 640, 360);

        let added = arrive(&library.db, &[file], Warm::ByThePass).unwrap();

        let id = added[0].id;
        assert_eq!(library.thumbnail_rows(id), 0);
        assert_eq!(library.db.read(|conn| perceptual_hash_of(conn, id)), None);
    }

    #[test]
    fn a_file_that_will_not_decode_still_arrives_when_warmed_now() {
        // The bytes are there and are not an image: noted as the pass notes
        // one, and the wallpaper is in the library regardless (ADR 0034).
        let library = Library::new();
        let broken = library.dir.path().join("broken.png");
        std::fs::write(&broken, b"not a png").unwrap();

        let added = arrive(&library.db, &[broken], Warm::Now(&library.cache())).unwrap();

        assert_eq!(added.len(), 1);
        assert_eq!(library.thumbnail_rows(added[0].id), 0);
    }
}
