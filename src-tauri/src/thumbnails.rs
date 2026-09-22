//! The thumbnail cache: every thumbnail the app has made, and everything it
//! remembers about them.
//!
//! Four things are kept, and this module is the only one that touches any of
//! them: a JPEG per wallpaper and size in the cache directory, a `thumbnails`
//! row saying which source mtime that JPEG was made from, a `thumbnail_failures`
//! note for a source that would not decode (ADR 0034), and the bytes of the last
//! few hundred thumbnails in memory (ADR 0040).
//!
//! One type, [`ThumbnailCache`], and a handful of operations on it:
//!
//! - [`ThumbnailCache::answer`] — one wallpaper at one size, for `serving`.
//! - [`ThumbnailCache::warm`] — one wallpaper the pre-generation pass reached.
//! - [`ThumbnailCache::work_list`] — which wallpapers the pass owes something.
//! - [`ThumbnailCache::clear`] — Settings' Clear thumbnail cache.
//! - [`ThumbnailCache::size`] — the Settings readout.
//!
//! Everything that has an order lives behind them. ADR 0004's three phases, with
//! ADR 0039's rule that the connection is taken for the queries and released
//! across the image work. The rule that a regenerate drops the wallpaper's bytes
//! in memory (ADR 0040). The order a Clear goes in. Which failures get written
//! down, beside the work list that decides what a note means.
//!
//! Before [#280](https://github.com/QuantumFF/walltare/issues/280) those were
//! seventeen public functions, and the three callers put them in order
//! themselves: `serving` and `pregen` each sequenced the phases and each dropped
//! the bytes in memory on a regenerate, and `lib.rs` alone knew the order of a
//! Clear. A rule written in two places is a rule one of them breaks, and the
//! pregen copy of the invalidation had no test, because reaching it needed an
//! `AppHandle`. Every operation here takes a [`Db`] and nothing from Tauri, so an
//! in-memory database and a temp directory are the whole of a test's setup.
//!
//! What stays outside is what is not about the cache. `serving` keeps the worker
//! pool, the flight table and the mapping from an answer to an HTTP response;
//! `pregen` keeps the run's lifecycle, its tally and its report. Neither holds a
//! connection or names a cache file.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::UNIX_EPOCH;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, ImageReader, Rgb, RgbImage};
use rusqlite::Connection;

use crate::db::{self, Status};
use crate::error::AppError;
use crate::Db;

const SMALL_MAX_WIDTH: u32 = 400;
const MEDIUM_MAX_WIDTH: u32 = 1920;
const JPEG_QUALITY: u8 = 85;

/// How many thumbnails [`ImageCache`] holds at once.
///
/// An entry count, and it bounds memory because an entry's size is bounded:
/// ADR 0012 measured a `small` at about 31KB and a `medium` at about 383KB, and
/// both are capped by a maximum width — 400px and 1920px — rather than by the
/// source. So 256 entries is about 8MB of `small`s, which is the shape a scroll
/// through Library or Review produces, and 98MB in the pathological case of
/// nothing but `medium`s, which takes 256 lightbox steps with no revisit to
/// reach. Next to the 2GB of disk cache ADR 0016 already allows at its ceiling,
/// the first number is nothing and the second is affordable.
///
/// It is sized to hold more than the views can show. Review mounts fifty cards
/// and Library's virtual window with ADR 0016's one row of overscan is around
/// thirty five, so 256 covers both grids at once plus several screens of
/// scrollback and the lightbox's `medium`s — a wheel gesture down and back up
/// hits memory the whole way.
///
/// `full` is not held at all; [`ImageCache::store`] says why.
const IMAGE_CACHE_ENTRIES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Size {
    Small,
    Medium,
    Full,
}

impl Size {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "small" => Some(Self::Small),
            "medium" => Some(Self::Medium),
            "full" => Some(Self::Full),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Full => "full",
        }
    }

    fn max_width(self) -> Option<u32> {
        match self {
            Self::Small => Some(SMALL_MAX_WIDTH),
            Self::Medium => Some(MEDIUM_MAX_WIDTH),
            Self::Full => None,
        }
    }

    /// Cached sizes this one can be downscaled from, cheapest to decode first.
    ///
    /// A `small` off a 152MB PNG pays the same full decode a `medium` does,
    /// and the review grid asks for fifty at once. A `medium` cache file is
    /// already a 1920px JPEG on disk, so deriving from it skips that decode
    /// entirely — 4.5x cheaper across a real library, 26x on the largest file.
    fn donors(self) -> &'static [Size] {
        match self {
            Self::Small => &[Self::Medium, Self::Full],
            Self::Medium => &[Self::Full],
            Self::Full => &[],
        }
    }
}

/// The thumbnail cache, on disk, in the database and in memory.
///
/// Held as app state for the life of the process, beside the [`Db`] every
/// operation takes. The connection is a parameter rather than a field because it
/// is the app's one connection and not this module's: the Soft reject, voting
/// and the listings share it, and ADR 0039's closures are how anything reaches
/// it.
pub struct ThumbnailCache {
    dir: PathBuf,
    memory: ImageCache,
}

/// Which way one wallpaper went when the pass warmed it, short of an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Warmed {
    Generated,
    /// Nothing was generated: a wallpaper whose cache was already warm and that
    /// was on the list for its pixel dimensions alone (ADR 0044). It says what
    /// the pass did not do rather than what it wrote — a source that will not
    /// give up its dimensions lands here too, because there is no thumbnail to
    /// report either way.
    ///
    /// Apart from `Generated` because the curator's ending counts thumbnails.
    /// A backfill over a warm library would otherwise report every wallpaper in
    /// it as a thumbnail made, which is a number nothing on disk agrees with.
    Measured,
    /// Left alone: rejected since the list was built, or gone from the table.
    Skipped,
}

impl ThumbnailCache {
    /// A cache over one directory, with nothing yet in memory.
    ///
    /// The directory need not exist. Nothing is cached before the first
    /// thumbnail is written, and writing one creates it.
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            memory: ImageCache::new(IMAGE_CACHE_ENTRIES),
        }
    }

    /// The bytes for one wallpaper at one size if they are in memory, and
    /// nothing else.
    ///
    /// The one operation that may run on the thread Tauri calls the protocol
    /// handler on, which is the UI thread. It takes a mutex held only for a hash
    /// lookup, and copies nothing: never a `stat`, never a file read, never a
    /// decode, and never a lock any of those are holding (ADR 0040).
    pub fn remembered(&self, wallpaper_id: i64, size: Size) -> Option<Arc<Vec<u8>>> {
        self.memory.get(wallpaper_id, size)
    }

    /// One wallpaper at one size, as JPEG bytes: from memory, from the cache
    /// file, or generated.
    ///
    /// Never on the UI thread. A miss decodes, and a decode there freezes the
    /// window for as long as it takes (ADR 0004).
    pub fn answer(&self, db: &Db, wallpaper_id: i64, size: Size) -> Result<Arc<Vec<u8>>, AppError> {
        self.answer_with(db, wallpaper_id, size, fulfill)
    }

    /// [`ThumbnailCache::answer`], with phase two as a parameter.
    ///
    /// Production always passes [`fulfill`]. A test passes a phase two that
    /// asserts the connection is free before it decodes, which is the half of
    /// ADR 0039's rule no type can hold: a phase one whose guard survived into a
    /// temporary would compile, return the right bytes, and quietly serialize
    /// every request in the app behind one decode.
    fn answer_with<F>(
        &self,
        db: &Db,
        wallpaper_id: i64,
        size: Size,
        fulfill: F,
    ) -> Result<Arc<Vec<u8>>, AppError>
    where
        F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
    {
        // Asked again here, having been asked on the UI thread: a request that
        // queued behind an identical one may have been overtaken by its answer,
        // which under a stack is the common case rather than the rare one.
        if let Some(bytes) = self.memory.get(wallpaper_id, size) {
            return Ok(bytes);
        }
        let plan = db.read(|conn| {
            let (_, source) = wallpaper_row(conn, wallpaper_id)?;
            plan(conn, wallpaper_id, size, source)
        })?;
        let resolved = self.fulfill_and_record(db, &plan, fulfill)?;
        let bytes = Arc::new(resolved.thumbnail.bytes);
        self.memory.store(wallpaper_id, size, Arc::clone(&bytes));
        Ok(bytes)
    }

    /// Phases two and three, and what a regenerate owes the memory tier.
    ///
    /// Shared by [`ThumbnailCache::answer`] and the one-size case of
    /// [`ThumbnailCache::warm`], which differ only in their phase one: a request
    /// reads the row and fails on a missing one, and the pass re-checks the
    /// Status the list saw and skips.
    fn fulfill_and_record<F>(&self, db: &Db, plan: &Plan, fulfill: F) -> Result<Resolved, AppError>
    where
        F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
    {
        let resolved = fulfill(plan, &self.dir)?;
        db.write(|conn| record(conn, plan, &resolved))?;
        if resolved.record_mtime.is_some() {
            // These bytes were made from the source as it is now, so every other
            // size of this wallpaper in memory was made from an older read of it.
            // The source's mtime moving is the only thing that invalidates a
            // thumbnail (ADR 0016), and a regenerate is this module hearing that
            // it moved — for one size, about a file all the sizes share.
            //
            // A first generation of a second size lands here too, and drops a
            // sibling that was in fact still fresh. That costs one cache-file read
            // the next time the sibling is asked for; keeping a stale one would
            // show the curator the wrong picture until it fell out of the cache.
            self.memory.forget(plan.wallpaper_id);
        }
        Ok(resolved)
    }

    /// Generates whichever sizes one listed wallpaper is short of, records the
    /// source's pixel dimensions, and writes down a source that would not decode.
    ///
    /// Three branches rather than two, because a warm wallpaper can be on the list
    /// for its dimensions alone (ADR 0044). Every branch measures, and none of them
    /// asks whether the row already has numbers: a wallpaper is only in the other
    /// two branches because its `source_mtime` stopped matching, which is the file
    /// having been rewritten, and a re-export at a different size is exactly the
    /// case where the stored dimensions have gone stale. The measurement is a header
    /// read either way, so refreshing costs a file open against a decode the pass is
    /// doing regardless.
    ///
    /// The connection is taken for the reads and again for the writes, and is never
    /// held across a decode (ADR 0004) — the same phases a request that misses goes
    /// through. Both sizes missing is the single decode [`generate_both`] exists
    /// for; one size missing goes through [`plan`], [`fulfill`] and [`record`], so
    /// the cached size beside it donates its pixels instead of the source being
    /// decoded a second time. Either way the bytes in memory for this wallpaper go
    /// before this returns, so the pass cannot regenerate behind the memory tier's
    /// back (ADR 0040).
    ///
    /// A failure is the caller's to count and this module's to remember: an
    /// undecodable source is noted against the mtime it failed at, which is what
    /// [`ThumbnailCache::work_list`] reads to leave it out (ADR 0034). A decode
    /// that panics is caught here and treated as one that failed, because the
    /// `image` crate panicking on somebody's malformed file is a fact about those
    /// bytes, and the next pass should not spend the same panic learning it.
    pub fn warm(&self, db: &Db, pending: &Pending) -> Result<Warmed, AppError> {
        let warmed = std::panic::catch_unwind(AssertUnwindSafe(|| self.warm_one(db, pending)))
            .unwrap_or_else(|_| Err(panicked()));
        if let Err(e) = &warmed {
            remember(db, pending.wallpaper_id, e);
        }
        warmed
    }

    fn warm_one(&self, db: &Db, pending: &Pending) -> Result<Warmed, AppError> {
        let id = pending.wallpaper_id;
        // Where the file sits now and which way this wallpaper went, or a skip. The
        // three branches differ in what they generate and agree on everything after,
        // so the measurement below is written once rather than in each of them.
        let (source, warmed) = match pending.missing {
            // Nothing to generate: a warm wallpaper listed for its pixel dimensions
            // alone, which is the whole of a library scanned before the columns
            // existed (ADR 0044). The Status and the path are re-read the same way
            // every other branch re-reads them, so a wallpaper rejected since the
            // list was built is left alone here too.
            None => {
                let Some(source) = db.read(|conn| still_due(conn, pending))? else {
                    return Ok(Warmed::Skipped);
                };
                (source, Warmed::Measured)
            }
            Some(Missing::Both) => {
                let Some(source) = db.read(|conn| still_due(conn, pending))? else {
                    return Ok(Warmed::Skipped);
                };
                let recorded = generate_both(id, &source, &self.dir)?;
                db.write(|conn| {
                    recorded.iter().try_for_each(|r| {
                        record_one(conn, id, r.size, r.width, r.height, r.source_mtime)
                    })
                })?;
                // Both sizes were just made from the source as it is now, for
                // [`ThumbnailCache::fulfill_and_record`]'s reason.
                self.memory.forget(id);
                (source, Warmed::Generated)
            }
            Some(Missing::Only(size)) => {
                // One read for both questions, which is the point: the Status the
                // pass acts on and the path it acts on come from one view of the
                // row, and the path is the one `plan` is handed.
                //
                // A skip comes back as `None` rather than returning from here,
                // because the closure cannot return from its caller. That is the
                // interface doing its job: what leaves it is owned data.
                let planned = db.read(|conn| match still_due(conn, pending)? {
                    Some(source) => {
                        plan(conn, id, size, source.clone()).map(|plan| Some((plan, source)))
                    }
                    None => Ok(None),
                })?;
                let Some((plan, source)) = planned else {
                    return Ok(Warmed::Skipped);
                };
                self.fulfill_and_record(db, &plan, fulfill)?;
                (source, Warmed::Generated)
            }
        };
        measure_and_record(db, id, &source);
        Ok(warmed)
    }

    /// Every wallpaper the pre-generation pass would warm, in the order it would
    /// reach them.
    ///
    /// Two halves in the order `missing.rs` documents for its own pair: the query
    /// under the connection, and the `read_dir` plus one `stat` per row with it
    /// released. `Db::read` drops the guard before it returns, so the second half
    /// — 5,000 filesystem calls at ADR 0016's ceiling, on whatever drive the
    /// Library root sits on — holds nothing while the first view fetches its
    /// listing and fires fifty thumbnail requests (ADR 0039).
    pub fn work_list(&self, db: &Db) -> Result<Vec<Pending>, AppError> {
        let candidates = db.read(candidates)?;
        work_list(&candidates, &self.dir)
    }

    /// Throws the whole cache away: the files, then the rows and the failure
    /// notes, then the bytes in memory.
    ///
    /// The order is the whole of this function, and it is here rather than in its
    /// caller so there is one place to break it. The caller stands any running
    /// pass down first and does not wait for it, because the flag is read between
    /// wallpapers and joining would block the IPC thread for up to one decode
    /// (ADR 0012), so a pass can still finish the wallpaper it is on while this
    /// runs. The pass writes a wallpaper's files and only then records its rows,
    /// so removing them in the same order leaves the row delete last, and every
    /// row the pass manages to write before that instant goes with it. Reversed,
    /// a pass recording a row after the `DELETE` and having its files swept a
    /// moment later would leave a dangling row for almost every way the two can
    /// interleave.
    ///
    /// Two residues survive the narrow windows that remain, and the app already
    /// handles both: a file with no row is regenerated on demand and relisted by
    /// the work list, and a row with no file is exactly what [`fulfill`] and the
    /// work list both read as missing. What cannot happen is a row promising
    /// bytes that differ from the file beside it, because nothing records a row
    /// for a file it did not just write.
    ///
    /// The bytes in memory go last and go regardless of whether the rows did. A
    /// request that was mid-flight through the first two can still have stored
    /// bytes, and a curator who asked for the cache to be thrown away and then
    /// saw the same thumbnails come back would have been told the button does not
    /// work (ADR 0040).
    ///
    /// The failure notes go with the rows, which makes Clear thumbnail cache the
    /// one control that gives an undecodable source another go — the curator
    /// asking for the whole cache to be rebuilt is asking for that too
    /// (ADR 0034).
    ///
    /// Emptying the directory is up to 10,000 unlinks at ADR 0016's ceiling and
    /// takes no connection, so the curator's grid keeps being served while it
    /// happens (ADR 0039). The directory itself stays, and nothing restarts:
    /// clearing is a rebuild the next launch pays for rather than a way to
    /// reclaim disk (ADR 0012).
    pub fn clear(&self, db: &Db) -> Result<(), AppError> {
        clear_cache_files(&self.dir)?;
        let forgotten = db.write(forget_thumbnails);
        self.memory.forget_all();
        forgotten
    }

    /// How much disk the cache is holding, so 830MB under `app_data` is a number
    /// the curator can read rather than invisible (ADR 0012).
    ///
    /// One `read_dir` and one `metadata` per entry: 172 stats on the live library
    /// and about 10,000 at ADR 0016's five-thousand-wallpaper ceiling. That is why
    /// ADR 0020 reads it on mount, on `pregen-complete` and after a clear, and
    /// never per progress event.
    ///
    /// Nothing is capped and nothing is evicted, so this answers a question rather
    /// than feeding a policy: the cache is bounded by the library at two files per
    /// wallpaper, which is not the shape an LRU has, and an eviction rule would
    /// fight the pre-generation pass directly (ADR 0012).
    pub fn size(&self) -> Result<CacheSize, AppError> {
        cache_size(&self.dir)
    }
}

/// What image work is answered with when it panicked rather than finished.
///
/// One sentence in one place, because three places can hear it: a follower in
/// `serving` gets it when the request it waited on panicked, [`ThumbnailCache::warm`]
/// notes it against the source, and the pre-generation pass hears it when the
/// pool came back with nothing.
pub fn panicked() -> AppError {
    AppError::Image("generating the thumbnail panicked".to_string())
}

#[derive(Debug)]
struct Thumbnail {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

/// Everything the resolver needs from the database before it can do any work.
///
/// Splitting this out lets the connection be released before [`fulfill`]
/// decodes and re-encodes the image, which for a 4K source is hundreds of
/// milliseconds of CPU that would otherwise block every other command and every
/// other image request.
struct Plan {
    wallpaper_id: i64,
    size: Size,
    source: PathBuf,
    /// The recorded `(width, height, source_mtime)`, if this size was cached.
    cached: Option<(u32, u32, i64)>,
    /// A wider size already cached, as `(size, its recorded source_mtime)`.
    /// [`fulfill`] decodes this instead of the source when the mtime still
    /// matches; it re-checks rather than trusting the row, because the source
    /// may have changed between the two phases.
    donor: Option<(Size, i64)>,
}

/// A resolved thumbnail, plus the mtime to [`record`] when it was regenerated.
struct Resolved {
    thumbnail: Thumbnail,
    /// `Some` only when freshly generated, meaning the row needs upserting.
    record_mtime: Option<i64>,
}

/// Where a wallpaper's row says its file is, and its Status — the one read of
/// the `wallpapers` table this module makes.
///
/// Three callers used to carry a copy of this query each, and one of them its
/// own `QueryReturnedNoRows` closure. It goes through [`db::get_wallpaper`]
/// instead, which is the crate's one answer for a missing row (ADR 0025): a
/// request for a wallpaper that is not there is a `NotFound`, and a caller that
/// has something better to do with one — skip it — matches on that.
fn wallpaper_row(conn: &Connection, wallpaper_id: i64) -> Result<(Status, PathBuf), AppError> {
    let row = db::get_wallpaper(conn, wallpaper_id)?;
    Ok((row.status, PathBuf::from(row.path)))
}

/// Phase 1 — the only part that touches the database before the image work.
///
/// Every statement is `prepare_cached`, the way `db.rs`, `voting.rs`,
/// `missing.rs` and `settings.rs` all are. This is the crate's hottest query
/// path — the review grid fires fifty of these at once and every remount of a
/// card fires another — and it runs inside the critical section, so compiling
/// three or four statements per request was time no other request could use
/// (ADR 0039). The cache is per connection and there is one connection, so the
/// compiles happen once for the life of the process.
///
/// The source is handed in rather than read here, because both callers have
/// just read the row for reasons of their own.
fn plan(
    conn: &Connection,
    wallpaper_id: i64,
    size: Size,
    source: PathBuf,
) -> Result<Plan, AppError> {
    let cached = match conn
        .prepare_cached(
            "SELECT width, height, source_mtime FROM thumbnails
         WHERE wallpaper_id = ?1 AND size = ?2",
        )?
        .query_row(rusqlite::params![wallpaper_id, size.label()], |row| {
            Ok((
                row.get::<_, i64>(0)? as u32,
                row.get::<_, i64>(1)? as u32,
                row.get::<_, i64>(2)?,
            ))
        }) {
        Ok(row) => Some(row),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e.into()),
    };

    // Looked up even when `cached` is `Some`. A row is not a cache hit: the
    // file behind it may be gone or its mtime stale, and only [`fulfill`]
    // touches the filesystem to find out. Skipping the lookup here would leave
    // the donor unavailable in exactly the case that has to regenerate.
    let donor = find_donor(conn, wallpaper_id, size)?;

    Ok(Plan {
        wallpaper_id,
        size,
        source,
        cached,
        donor,
    })
}

/// The cheapest cached size wide enough to downscale into `size`.
///
/// A donor narrower than the target means the source was narrower too, so
/// deriving would be correct but pointless: such a source is small and decodes
/// quickly anyway. Requiring the width keeps the rule easy to reason about.
fn find_donor(
    conn: &Connection,
    wallpaper_id: i64,
    size: Size,
) -> Result<Option<(Size, i64)>, AppError> {
    let Some(target_width) = size.max_width() else {
        return Ok(None);
    };
    // One prepared statement for both donors, and for every request after
    // this one: the size is a parameter rather than part of the SQL, so the
    // loop reuses one cache entry (ADR 0039).
    let mut stmt = conn.prepare_cached(
        "SELECT width, source_mtime FROM thumbnails
         WHERE wallpaper_id = ?1 AND size = ?2",
    )?;
    for donor in size.donors() {
        let row = stmt.query_row(rusqlite::params![wallpaper_id, donor.label()], |row| {
            Ok((row.get::<_, i64>(0)? as u32, row.get::<_, i64>(1)?))
        });
        match row {
            Ok((width, mtime)) if width >= target_width => return Ok(Some((*donor, mtime))),
            Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(None)
}

/// Phase 2 — no database access. Serves the cache file when it is still fresh,
/// otherwise decodes, downscales and re-encodes the source.
fn fulfill(plan: &Plan, cache_dir: &Path) -> Result<Resolved, AppError> {
    let source_mtime = source_mtime(&plan.source)?;
    let cache_path = cache_path(cache_dir, plan.wallpaper_id, plan.size);

    if let Some((width, height, recorded)) = plan.cached {
        if recorded == source_mtime && cache_path.exists() {
            return Ok(Resolved {
                thumbnail: Thumbnail {
                    bytes: std::fs::read(&cache_path)?,
                    width,
                    height,
                },
                record_mtime: None,
            });
        }
    }

    let img = match decode_donor(plan, cache_dir, source_mtime) {
        Some(img) => img,
        None => ImageReader::open(&plan.source)?
            .with_guessed_format()?
            .decode()
            .map_err(|e| AppError::Image(e.to_string()))?,
    };
    let img = downscale_if_wider(img, plan.size);
    let (width, height) = (img.width(), img.height());
    let bytes = encode_jpeg(&flatten_to_rgb(img))?;
    write_cache_file(cache_dir, plan.wallpaper_id, plan.size, &bytes)?;

    Ok(Resolved {
        thumbnail: Thumbnail {
            bytes,
            width,
            height,
        },
        record_mtime: Some(source_mtime),
    })
}

/// Decodes the donor recorded in the plan, or `None` to fall back to the
/// source — because the source changed since [`plan`] ran, the donor's file is
/// gone, or it failed to decode. Every one of those is a cache problem, and a
/// cache problem must never turn into a failed request.
fn decode_donor(plan: &Plan, cache_dir: &Path, source_mtime: i64) -> Option<DynamicImage> {
    let (size, recorded) = plan.donor?;
    if recorded != source_mtime {
        return None;
    }
    let path = cache_path(cache_dir, plan.wallpaper_id, size);
    ImageReader::open(&path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()
}

/// Phase 3 — records a freshly generated thumbnail. A no-op for a cache hit.
fn record(conn: &Connection, plan: &Plan, resolved: &Resolved) -> Result<(), AppError> {
    let Some(source_mtime) = resolved.record_mtime else {
        return Ok(());
    };
    record_one(
        conn,
        plan.wallpaper_id,
        plan.size,
        resolved.thumbnail.width,
        resolved.thumbnail.height,
        source_mtime,
    )
}

/// The upsert behind [`record`], reachable without a [`Plan`] or a [`Resolved`].
///
/// The three-phase path always has both, but [`generate_both`] has neither: it
/// never plans, because the work list already established both sizes are
/// missing, and it never holds a `Resolved` because it returns no JPEG bytes.
/// Both paths write the row the same way, so the write lives here rather than
/// twice.
fn record_one(
    conn: &Connection,
    wallpaper_id: i64,
    size: Size,
    width: u32,
    height: u32,
    source_mtime: i64,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO thumbnails (wallpaper_id, size, width, height, source_mtime)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(wallpaper_id, size) DO UPDATE SET
            width = excluded.width,
            height = excluded.height,
            source_mtime = excluded.source_mtime",
        rusqlite::params![wallpaper_id, size.label(), width, height, source_mtime],
    )?;
    Ok(())
}

/// One cache file that was just written, as everything [`record_one`] needs.
///
/// Dimensions and mtime, never the JPEG bytes: the pre-generation pass has no
/// use for two encoded buffers once the files are on disk, and holding them
/// would mean carrying a megabyte per wallpaper through a loop over the whole
/// library.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Recorded {
    size: Size,
    width: u32,
    height: u32,
    source_mtime: i64,
}

/// Writes both pre-generated sizes off a single decode of the source, medium
/// first and then the small off that same in-memory image.
///
/// This is the one thing pre-generation can do that the on-demand path cannot.
/// On demand a `small` costs a JPEG decode of the medium beside it, 106ms for
/// the worst file in ADR 0006; here it is a second `resize_exact` on an image
/// already decoded. There is no donor lookup and no freshness check because
/// [`work_list`] only hands over wallpapers whose sizes are both missing, and
/// re-deciding that here would read the cache a second time.
///
/// The returned pair is in generation order, medium then small. Recording is
/// the caller's, so the connection is never held across the decode (ADR 0004).
fn generate_both(
    wallpaper_id: i64,
    source: &Path,
    cache_dir: &Path,
) -> Result<[Recorded; 2], AppError> {
    let source_mtime = source_mtime(source)?;
    let decoded = ImageReader::open(source)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| AppError::Image(e.to_string()))?;

    let medium = flatten_to_rgb(downscale_if_wider(decoded, Size::Medium));
    let recorded_medium = write_size(cache_dir, wallpaper_id, Size::Medium, &medium, source_mtime)?;

    // Wrapping the flattened medium back into a `DynamicImage` is a move, not a
    // copy, and `flatten_to_rgb` on an already-RGB image is another. So the
    // small costs one downscale and one encode, and nothing is decoded twice.
    let small = flatten_to_rgb(downscale_if_wider(
        DynamicImage::ImageRgb8(medium),
        Size::Small,
    ));
    let recorded_small = write_size(cache_dir, wallpaper_id, Size::Small, &small, source_mtime)?;

    Ok([recorded_medium, recorded_small])
}

/// Encodes one size and writes its cache file, reporting what [`record_one`]
/// will need for it.
fn write_size(
    cache_dir: &Path,
    wallpaper_id: i64,
    size: Size,
    img: &RgbImage,
    source_mtime: i64,
) -> Result<Recorded, AppError> {
    let bytes = encode_jpeg(img)?;
    write_cache_file(cache_dir, wallpaper_id, size, &bytes)?;
    Ok(Recorded {
        size,
        width: img.width(),
        height: img.height(),
        source_mtime,
    })
}

/// Reads one source's pixel dimensions and writes them to its row (ADR 0044).
///
/// The read is a file open outside the connection and the write is one
/// statement inside it, which is ADR 0039's split — the same shape [`remember`]
/// keeps for its `stat`.
///
/// A source that will not give up its dimensions is left as it was: the row
/// keeps whatever it held, which is NULL for a wallpaper nothing has measured
/// and the last known pair for one that has been. Overwriting a known pair with
/// NULL would turn a file that went missing for a moment into a wallpaper the
/// app has forgotten the size of, and a badge drawn off no dimensions is a badge
/// nothing draws.
///
/// A write that fails is logged for the reason [`remember`]'s is: the pass has
/// already done the work the curator is waiting on.
fn measure_and_record(db: &Db, wallpaper_id: i64, source: &Path) {
    let Some((width, height)) = crate::scanner::dimensions(source) else {
        return;
    };
    db.write(|conn| {
        if let Err(e) = db::record_dimensions(conn, wallpaper_id, width, height) {
            eprintln!("could not record pixel dimensions: {e}");
        }
    });
}

/// Writes down a source that was read and would not decode, so the work list
/// leaves it out until the file changes (ADR 0034).
///
/// Only [`AppError::Image`], which is the one variant that means the bytes were
/// there and are not an image this build can decode: a zero-byte file, a
/// download that stopped halfway, a `.jpg` that is really something else. Every
/// other variant is either about the file being absent — ADR 0032's subject, and
/// cheap, because it costs a `stat` rather than a decode — or about the machine,
/// and a full disk must not permanently retire a wallpaper that is perfectly
/// fine.
///
/// Three steps rather than one, with the `stat` in the middle and outside both
/// closures (ADR 0039): where the row points now, what that file's mtime is,
/// then the note. The path comes from the row rather than from the work list's
/// snapshot, for [`still_due`]'s reason: a reject or a Restore moves the file
/// while the pass is running. A source that cannot be `stat`ed at all is not
/// noted, because there is nothing to say the note is about.
///
/// A note that cannot be written is logged and dropped. It is a cache
/// optimisation, and the pass has already counted the failure the curator reads.
fn remember(db: &Db, wallpaper_id: i64, error: &AppError) {
    if !matches!(error, AppError::Image(_)) {
        return;
    }
    let Ok((_, source)) = db.read(|conn| wallpaper_row(conn, wallpaper_id)) else {
        return;
    };
    let Ok(source_mtime) = source_mtime(&source) else {
        return;
    };
    let message = error.to_string();
    db.write(|conn| {
        if let Err(e) = note_failure(conn, wallpaper_id, source_mtime, &message) {
            eprintln!("could not record an undecodable source: {e}");
        }
    });
}

/// How much disk the thumbnail cache is holding.
///
/// Both counts are zero for a cache with nothing in it, which is the same
/// answer a cache directory that has not been created yet gives.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct CacheSize {
    pub bytes: u64,
    pub files: u64,
}

fn cache_size(cache_dir: &Path) -> Result<CacheSize, AppError> {
    let entries = match std::fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        // Nothing cached yet, which is a size rather than a failure.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(CacheSize::default()),
        Err(e) => return Err(e.into()),
    };
    let mut size = CacheSize::default();
    for entry in entries {
        let metadata = entry?.metadata()?;
        // Files only. Nothing writes a subdirectory in here, and a directory's
        // own `len()` is a filesystem detail rather than cached bytes.
        if metadata.is_file() {
            size.files += 1;
            size.bytes += metadata.len();
        }
    }
    Ok(size)
}

/// Empties the cache directory — the half of [`ThumbnailCache::clear`] that
/// touches the disk, and the first.
///
/// It takes no `Connection`, which is what lets the clear hold the connection
/// for the `DELETE`s alone (ADR 0039).
fn clear_cache_files(cache_dir: &Path) -> Result<(), AppError> {
    match std::fs::read_dir(cache_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                match std::fs::remove_file(entry.path()) {
                    Ok(()) => {}
                    // Something else got there first, which is the outcome
                    // asked for either way.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

/// Forgets every cached thumbnail and every failure note — the database half of
/// [`ThumbnailCache::clear`], and the second.
fn forget_thumbnails(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM thumbnails", [])?;
    conn.execute("DELETE FROM thumbnail_failures", [])?;
    Ok(())
}

/// Remembers that a source was read and would not decode, so the pass stops
/// decoding it again on every launch.
///
/// Keyed on the mtime the failure was seen at, which is the freshness rule the
/// `thumbnails` rows already keep: a file the curator has since re-exported has
/// a new mtime, the note stops applying, and the wallpaper rejoins the work
/// list. So this suppresses a decode rather than a wallpaper (ADR 0034).
fn note_failure(
    conn: &Connection,
    wallpaper_id: i64,
    source_mtime: i64,
    message: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO thumbnail_failures (wallpaper_id, source_mtime, message)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(wallpaper_id) DO UPDATE SET
            source_mtime = excluded.source_mtime,
            message = excluded.message,
            failed_at = unixepoch()",
        rusqlite::params![wallpaper_id, source_mtime, message],
    )?;
    Ok(())
}

/// Which of the two pre-generated sizes a wallpaper is short of.
///
/// Two variants rather than a set of sizes, because the pass branches on
/// exactly this: `Both` is the single decode [`generate_both`] exists for, and
/// one missing size is the donor case [`plan`] and [`fulfill`] already handle.
/// "Neither" is [`Pending::missing`]'s `None` rather than a third variant: a
/// wallpaper with both sizes fresh owes the pass no thumbnail at all, and a
/// variant of this enum meaning "no size" would have to be matched at every
/// site that asks which size to make.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Missing {
    Both,
    Only(Size),
}

/// One wallpaper the pre-generation pass would reach, and what it owes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    pub wallpaper_id: i64,
    /// Where the file sat when the list was built, which is what the freshness
    /// check `stat`ed. A reject or a Restore rewrites `path`, so
    /// [`ThumbnailCache::warm`] re-reads the row under its own lock and
    /// generates from what it finds there rather than from this copy.
    pub source: PathBuf,
    /// The Status the list saw, for the pass to compare the row against.
    ///
    /// The list carries it so the pass can tell a wallpaper that was already
    /// Rejected when it was listed — the tail group ADR 0016 put at the end of
    /// the queue — from one rejected since, which is a snapshot gone stale.
    pub status: Status,
    /// Which pre-generated sizes this wallpaper is short of, or `None` when both
    /// are fresh and it is on the list for its pixel dimensions alone.
    ///
    /// `None` is the backfill of ADR 0044, and it is the only thing the entry
    /// has to say about dimensions. Every wallpaper the pass reaches is measured
    /// — a wallpaper in the other two cases is there because its `source_mtime`
    /// stopped matching, which is the file having been rewritten, and that is
    /// exactly when stored dimensions go stale. So what the entry records is the
    /// one thing that is not implied: whether there is anything to generate.
    pub missing: Option<Missing>,
}

/// One wallpaper as the query saw it, before anything is asked of the
/// filesystem.
///
/// Owned data and no borrow of the connection, which is what lets
/// [`candidates`] hand the whole library over and be finished with the
/// connection before the first `stat` (ADR 0039).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Candidate {
    wallpaper_id: i64,
    /// Where the row says the file is.
    source: PathBuf,
    status: Status,
    /// The `source_mtime` the `small` was recorded at, if it has a row.
    small_mtime: Option<i64>,
    /// The same for the `medium`.
    medium_mtime: Option<i64>,
    /// The mtime an undecodable source was noted at, if one was (ADR 0034).
    failed_mtime: Option<i64>,
    /// Whether the row already carries the source's pixel dimensions (ADR 0044).
    dimensions_known: bool,
}

/// Every wallpaper the pass might owe something to, in the order it would reach
/// them — the database half of the work list.
///
/// The order is `status = 'rejected' ASC, comparisons_count ASC, id ASC`.
/// Rejected is a tail group behind the Eligible pool, so warming rejects costs
/// the voting pool nothing (ADR 0016), and `comparisons_count ASC` targets the
/// half of a pair `select_pair` picks by least-compared ties, which is the half
/// anything can aim at. A scan inserts rows at count 0, so freshly scanned
/// files land at the head.
///
/// Each row carries the Status it was listed under, because the pass compares
/// the row against that rather than against Eligible: a Rejected entry is the
/// tail group and gets generated, one rejected after the fact does not.
///
/// One statement over the whole `wallpapers` table and nothing else. Everything
/// that touches the disk is [`work_list`]'s, which is the split `missing.rs`
/// already keeps between its own two halves and for the same reason: at
/// ADR 0016's 5,000-wallpaper ceiling the second half is 5,000 `stat` calls, and
/// making them under the connection mutex queues every command and every
/// `wallpaper://` request behind a walk of somebody's external drive (ADR 0039).
fn candidates(conn: &Connection) -> Result<Vec<Candidate>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.path, w.status, s.source_mtime, m.source_mtime, f.source_mtime,
                w.width IS NOT NULL AND w.height IS NOT NULL
         FROM wallpapers w
         LEFT JOIN thumbnails s ON s.wallpaper_id = w.id AND s.size = 'small'
         LEFT JOIN thumbnails m ON m.wallpaper_id = w.id AND m.size = 'medium'
         LEFT JOIN thumbnail_failures f ON f.wallpaper_id = w.id
         ORDER BY w.status = 'rejected' ASC, w.comparisons_count ASC, w.id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Candidate {
            wallpaper_id: row.get(0)?,
            source: PathBuf::from(row.get::<_, String>(1)?),
            status: row.get(2)?,
            small_mtime: row.get(3)?,
            medium_mtime: row.get(4)?,
            failed_mtime: row.get(5)?,
            dimensions_known: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Every wallpaper the pre-generation pass would generate, in the order it
/// would reach them — the filesystem half, run with the connection released.
///
/// One `read_dir` of the cache directory and one `stat` per source file, over
/// the rows [`candidates`] handed over. No image bytes are read at all. Running
/// [`plan`] and [`fulfill`] over the library instead would reuse the freshness
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
fn work_list(candidates: &[Candidate], cache_dir: &Path) -> Result<Vec<Pending>, AppError> {
    let cached = cache_filenames(cache_dir)?;

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
                && cached.contains(&cache_filename(candidate.wallpaper_id, size))
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

/// Where a listed wallpaper's file sits now, or `None` if the pass must leave it
/// alone.
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
/// and its turn is generated where it landed.
fn still_due(conn: &Connection, pending: &Pending) -> Result<Option<PathBuf>, AppError> {
    let (status, path) = match wallpaper_row(conn, pending.wallpaper_id) {
        Ok(row) => row,
        Err(AppError::NotFound(_)) => return Ok(None),
        Err(e) => return Err(e),
    };
    let rejected_since = status == Status::Rejected && pending.status != Status::Rejected;
    Ok((!rejected_since).then_some(path))
}

/// The cache directory's filenames as a set, so freshness costs one directory
/// read for the whole library instead of two `exists` calls per wallpaper.
///
/// A directory that is not there yet reads as empty: nothing is cached before
/// the first thumbnail is written, and [`write_cache_file`] creates it.
fn cache_filenames(cache_dir: &Path) -> Result<HashSet<String>, AppError> {
    let entries = match std::fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashSet::new()),
        Err(e) => return Err(e.into()),
    };
    let mut names = HashSet::new();
    for entry in entries {
        if let Some(name) = entry?.file_name().to_str() {
            names.insert(name.to_string());
        }
    }
    Ok(names)
}

fn cache_filename(wallpaper_id: i64, size: Size) -> String {
    format!("{wallpaper_id}_{}.jpg", size.label())
}

fn cache_path(cache_dir: &Path, wallpaper_id: i64, size: Size) -> PathBuf {
    cache_dir.join(cache_filename(wallpaper_id, size))
}

/// Writes one cache file through a temporary name and a rename, so a reader
/// that arrives mid-write sees either the old file or the new one, never a
/// truncated JPEG.
fn write_cache_file(
    cache_dir: &Path,
    wallpaper_id: i64,
    size: Size,
    bytes: &[u8],
) -> Result<(), AppError> {
    std::fs::create_dir_all(cache_dir)?;
    let cache_path = cache_path(cache_dir, wallpaper_id, size);
    let tmp = cache_path.with_extension("jpg.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &cache_path)?;
    Ok(())
}

fn downscale_if_wider(mut img: DynamicImage, size: Size) -> DynamicImage {
    if let Some(max_width) = size.max_width() {
        let (w, h) = (img.width(), img.height());
        if w > max_width {
            let new_h = ((h as f64 * max_width as f64 / w as f64).round() as u32).max(1);
            // Lanczos3's filter radius scales with the downscale ratio, so a
            // 17280-wide source costs 55 taps per output pixel per axis —
            // seconds of CPU. A box pre-reduction to twice the target is
            // linear in source pixels and leaves Lanczos3 a 2:1 step, where
            // it is both cheap and where its quality actually shows.
            const PRE_REDUCE_AT: u32 = 2;
            if w > max_width * PRE_REDUCE_AT {
                let pre_w = max_width * PRE_REDUCE_AT;
                let pre_h = ((h as f64 * pre_w as f64 / w as f64).round() as u32).max(1);
                img = img.thumbnail_exact(pre_w, pre_h);
            }
            img = img.resize_exact(max_width, new_h, FilterType::Lanczos3);
        }
    }
    img
}

fn flatten_to_rgb(img: DynamicImage) -> RgbImage {
    match img {
        DynamicImage::ImageRgba8(rgba) => {
            let mut out = RgbImage::new(rgba.width(), rgba.height());
            for (x, y, p) in rgba.enumerate_pixels() {
                let [r, g, b, a] = p.0;
                let blend = |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8;
                out.put_pixel(x, y, Rgb([blend(r), blend(g), blend(b)]));
            }
            out
        }
        other => other.into_rgb8(),
    }
}

fn encode_jpeg(img: &RgbImage) -> Result<Vec<u8>, AppError> {
    let mut bytes = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| AppError::Image(e.to_string()))?;
    Ok(bytes.into_inner())
}

/// One `stat` of a source file, as the nanosecond mtime every freshness rule
/// here compares against.
fn source_mtime(path: &Path) -> Result<i64, AppError> {
    let md = std::fs::metadata(path)
        .map_err(|_| AppError::NotFound(format!("missing source file {}", path.display())))?;
    modified_nanos(&md)
}

/// Nanoseconds since the epoch, not seconds: whole-second resolution misses an
/// edit made in the same second the thumbnail was written, and that thumbnail
/// then stays stale forever because the recorded mtime never changes again.
/// i64 nanoseconds runs out in the year 2262.
fn modified_nanos(md: &std::fs::Metadata) -> Result<i64, AppError> {
    Ok(md
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as i64)
}

/// The JPEG bytes of the thumbnails asked for most recently, bounded by
/// [`IMAGE_CACHE_ENTRIES`] and evicting whichever has gone unasked-for longest.
///
/// This is where ADR 0016's parked `Map<id, blob>` landed. It sits behind the
/// thumbnail cache, on the side that already holds the bytes, so it serves all
/// three callers that ADR named — the library card, the review card and the
/// lightbox's two sizes — without any of them knowing it exists.
///
/// What it is worth is the six costs a warm request paid: a channel hop, two
/// mutex acquisitions, a `stat`, an `exists` and a full file read, for bytes the
/// process was already holding a moment ago. A hit is a hash lookup and a copy.
///
/// Private to this module, and that is the point of #280: bytes go in from
/// [`ThumbnailCache::answer`], and what takes them back out is the things that
/// invalidate a thumbnail, each of which is an operation here —
/// [`ThumbnailCache::clear`] forgets everything, and a regenerate through either
/// [`ThumbnailCache::answer`] or [`ThumbnailCache::warm`] forgets its wallpaper.
/// Nothing expires on a clock — see ADR 0040 for what that costs.
struct ImageCache {
    entries: Mutex<Entries>,
    capacity: usize,
}

/// One wallpaper at one size, which is everything a `wallpaper://` URL says and
/// so the key the bytes in memory are held under.
type Key = (i64, Size);

#[derive(Default)]
struct Entries {
    held: HashMap<Key, Held>,
    /// Ticks on every read and every insert, so the smallest stamp in the map is
    /// the least recently used entry. A `u64` of request counter overflows after
    /// more requests than a hundred lifetimes of scrolling.
    clock: u64,
}

struct Held {
    bytes: Arc<Vec<u8>>,
    used: u64,
}

impl ImageCache {
    fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(Entries::default()),
            capacity,
        }
    }

    /// The bytes for one wallpaper at one size, if they are still held, and a
    /// note that they were wanted.
    fn get(&self, wallpaper_id: i64, size: Size) -> Option<Arc<Vec<u8>>> {
        let mut entries = self.entries();
        entries.clock += 1;
        let used = entries.clock;
        let held = entries.held.get_mut(&(wallpaper_id, size))?;
        held.used = used;
        Some(Arc::clone(&held.bytes))
    }

    /// Holds one thumbnail's bytes, evicting the coldest entries if that puts
    /// the map over its bound.
    fn store(&self, wallpaper_id: i64, size: Size, bytes: Arc<Vec<u8>>) {
        // `full` is never held. The bound is an entry count, and an entry count
        // bounds memory only while an entry's size is bounded: a `small` is at
        // most 400px wide and a `medium` at most 1920, while `full` re-encodes
        // the source at whatever resolution it has, so one entry could be tens
        // of megabytes and 256 of them could be gigabytes. Nothing in the app
        // asks for `full` — the card and the filmstrip ask for `small`, Rank and
        // the lightbox for `medium` — so this costs nothing and keeps the
        // constant's arithmetic closed.
        if size == Size::Full {
            return;
        }
        let mut entries = self.entries();
        entries.clock += 1;
        let used = entries.clock;
        entries
            .held
            .insert((wallpaper_id, size), Held { bytes, used });

        while entries.held.len() > self.capacity {
            // A scan of at most `capacity` stamps rather than an intrusive list,
            // and it runs only on the insert after a miss — which has just paid
            // a cache-file read or a whole decode, either of which is orders of
            // magnitude more than 256 integer comparisons (ADR 0040).
            let coldest = entries
                .held
                .iter()
                .min_by_key(|(_, held)| held.used)
                .map(|(key, _)| *key);
            match coldest {
                Some(key) => entries.held.remove(&key),
                None => break,
            };
        }
    }

    /// Forgets every size of one wallpaper.
    ///
    /// A regenerate is about a source file, and every size came off that one
    /// file, so it does not invalidate a size at a time.
    fn forget(&self, wallpaper_id: i64) {
        self.entries().held.retain(|(id, _), _| *id != wallpaper_id);
    }

    /// Forgets everything, for [`ThumbnailCache::clear`].
    fn forget_all(&self) {
        self.entries().held.clear();
    }

    /// Recovers from poisoning rather than bricking every later request, the way
    /// `Db::connection` does and for the same reason: nothing under this guard
    /// leaves the map inconsistent, so reusing it is strictly better than
    /// refusing to serve an image for the rest of the process.
    fn entries(&self) -> MutexGuard<'_, Entries> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether one thumbnail's bytes are held, without counting as a use.
    ///
    /// Tests only, and eviction is why: asking the question through
    /// [`ImageCache::get`] would move the entry to the most recently used end
    /// and change the answer to the next question.
    #[cfg(test)]
    fn holds(&self, wallpaper_id: i64, size: Size) -> bool {
        self.entries().held.contains_key(&(wallpaper_id, size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    /// A library behind a [`ThumbnailCache`]: a `Db` over an in-memory database,
    /// a folder of sources and a cache directory of its own. No Tauri app, which
    /// is the whole seam — every operation takes a `Db` and a directory.
    ///
    /// The two directories are separate, the way they are in production — the
    /// cache lives under `app_data` and the Library root is wherever the curator
    /// keeps their wallpapers. Sharing one would make emptying the cache delete
    /// the library, which is the difference between a test that clears a cache
    /// and one that only looks like it.
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

        /// A wallpaper as a scan leaves it: the file written, the row inserted,
        /// and its pixel dimensions recorded, which is what a scan does now
        /// (ADR 0044). So "warm" in these tests means what it means in a library
        /// the current build scanned, and the one cohort that is not — a row from
        /// before the columns existed — is seeded by [`Self::seed_unmeasured`].
        fn seed(&self, name: &str, img: &DynamicImage) -> i64 {
            let id = self.seed_unmeasured(name, img);
            self.db
                .write(|conn| db::record_dimensions(conn, id, img.width(), img.height()))
                .unwrap();
            id
        }

        /// A wallpaper with NULL dimensions: what a database written before the
        /// columns existed holds, and the cohort the pre-generation pass
        /// backfills.
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

        fn cache_file(&self, id: i64, size: Size) -> PathBuf {
            cache_path(self.cache_dir.path(), id, size)
        }

        fn answer(&self, id: i64, size: Size) -> Result<Arc<Vec<u8>>, AppError> {
            self.cache.answer(&self.db, id, size)
        }

        /// A cache over the same directory with nothing in memory, which is what
        /// a second launch is. Nothing in memory revalidates (ADR 0040), so the
        /// tier below it is where the freshness rule lives, and this is how a
        /// test reaches it.
        fn relaunch(&mut self) {
            self.cache = ThumbnailCache::new(self.cache_dir.path().to_path_buf());
        }

        /// Warms a wallpaper the way the pass does for one it has never
        /// generated, which is what "fully warm" means to the work list.
        fn warm(&self, id: i64, name: &str) -> Warmed {
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
                .unwrap()
        }

        fn thumbnail_row(&self, id: i64, size: &str) -> Option<(i64, i64, i64)> {
            self.db.read(|conn| {
                conn.query_row(
                    "SELECT width, height, source_mtime FROM thumbnails
                     WHERE wallpaper_id = ?1 AND size = ?2",
                    rusqlite::params![id, size],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .ok()
            })
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

        /// Writes a failure note against a source's current bytes, as the pass
        /// would after failing to decode it.
        fn note(&self, id: i64, name: &str, message: &str) {
            let mtime = source_mtime(&self.source(name)).unwrap();
            self.db
                .write(|conn| note_failure(conn, id, mtime, message))
                .unwrap();
        }

        fn work_list(&self) -> Vec<Pending> {
            self.cache.work_list(&self.db).unwrap()
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

    fn dimensions_of(bytes: &[u8]) -> (u32, u32) {
        let img = image::load_from_memory(bytes).expect("the bytes are a JPEG");
        (img.width(), img.height())
    }

    fn only_colour(bytes: &[u8]) -> [u8; 3] {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgb8()
            .get_pixel(5, 5)
            .0
    }

    /// Rewrites a file's bytes while restoring its original mtime, so the
    /// freshness contract still says "unchanged".
    fn rewrite_keeping_mtime(path: &Path, img: &DynamicImage) {
        let before = std::fs::metadata(path).unwrap().modified().unwrap();
        img.save_with_format(path, image::ImageFormat::Png).unwrap();
        std::fs::File::options()
            .append(true)
            .open(path)
            .unwrap()
            .set_modified(before)
            .unwrap();
    }

    /// Moves a file's mtime forward without touching its bytes, so freshness
    /// says "changed" for a file the test does not have to rewrite.
    fn touch_later(path: &Path) {
        std::fs::File::options()
            .append(true)
            .open(path)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();
    }

    #[test]
    fn a_first_answer_generates_the_cache_file_and_records_it() {
        let library = Library::new();
        let id = library.seed("a.png", &solid(800, 600, [10, 20, 30, 255]));
        let expected_mtime = source_mtime(&library.source("a.png")).unwrap();

        let bytes = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&bytes), (400, 300));
        assert!(library.cache_file(id, Size::Small).exists());
        assert_eq!(
            library.thumbnail_row(id, "small"),
            Some((400, 300, expected_mtime))
        );
    }

    #[test]
    fn a_narrower_source_keeps_its_own_dimensions() {
        let library = Library::new();
        let id = library.seed("n.png", &solid(200, 100, [1, 2, 3, 255]));

        let bytes = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&bytes), (200, 100));
        assert_eq!(
            library.thumbnail_row(id, "small"),
            Some((200, 100, source_mtime(&library.source("n.png")).unwrap()))
        );
    }

    #[test]
    fn a_wider_source_downscales_preserving_aspect_ratio() {
        let library = Library::new();
        let id = library.seed("w.png", &solid(3840, 2160, [9, 9, 9, 255]));

        let bytes = library.answer(id, Size::Medium).unwrap();

        assert_eq!(dimensions_of(&bytes), (1920, 1080));
    }

    #[test]
    fn a_source_far_wider_than_the_target_still_lands_on_the_exact_size() {
        // Past 2x the target, `downscale_if_wider` box-reduces before running
        // Lanczos3, because Lanczos3's radius scales with the ratio and a
        // 17280-wide source cost seconds of CPU in one step. The two-step
        // route has to produce the same dimensions as the one-step route did.
        let library = Library::new();
        let id = library.seed("huge.png", &solid(9600, 2700, [40, 80, 120, 255]));

        let bytes = library.answer(id, Size::Medium).unwrap();

        assert_eq!(dimensions_of(&bytes), (1920, 540));
        // A flat source must survive both filters flat: a pre-reduction that
        // sampled off the edge of the image would show up as banding here.
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgb8();
        for (x, y) in [(0, 0), (960, 270), (1919, 539)] {
            let px = decoded.get_pixel(x, y).0;
            assert!(
                px.iter()
                    .zip([40, 80, 120])
                    .all(|(a, b)| a.abs_diff(b) <= 6),
                "pixel at ({x}, {y}) came out {px:?}"
            );
        }
    }

    #[test]
    fn full_size_never_downscales_and_is_recorded_like_the_others() {
        let library = Library::new();
        let id = library.seed("f.png", &solid(800, 600, [4, 5, 6, 255]));

        let bytes = library.answer(id, Size::Full).unwrap();

        assert_eq!(dimensions_of(&bytes), (800, 600));
        assert!(library.cache_file(id, Size::Full).exists());
        assert_eq!(
            library.thumbnail_row(id, "full"),
            Some((800, 600, source_mtime(&library.source("f.png")).unwrap()))
        );
    }

    #[test]
    fn an_edit_within_the_same_second_still_invalidates() {
        // Whole-second mtimes made this case permanently stale: the recorded
        // mtime matched, so the old thumbnail was served forever.
        let mut library = Library::new();
        let id = library.seed("s.png", &solid(300, 150, [1, 1, 1, 255]));
        let first = library.answer(id, Size::Small).unwrap();

        // Both sizes stay under SMALL_MAX_WIDTH so a changed dimension can only
        // mean the thumbnail was regenerated, never that it was downscaled.
        solid(350, 120, [2, 2, 2, 255])
            .save_with_format(library.source("s.png"), image::ImageFormat::Png)
            .unwrap();
        library.relaunch();

        let second = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&first), (300, 150));
        assert_eq!(dimensions_of(&second), (350, 120));
    }

    #[test]
    fn rgba_sources_flatten_onto_white_without_artifacts() {
        let library = Library::new();
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([255, 0, 0, 255]));
        for (x, _y, p) in img.enumerate_pixels_mut() {
            if x < 50 {
                *p = Rgba([0, 0, 0, 0]);
            }
        }
        let id = library.seed("alpha.png", &DynamicImage::ImageRgba8(img));

        let bytes = library.answer(id, Size::Small).unwrap();

        let decoded = image::load_from_memory(&bytes).unwrap().to_rgb8();
        let near = |a: [u8; 3], b: [u8; 3]| a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= 4);
        assert!(near(decoded.get_pixel(25, 50).0, [255, 255, 255]));
        assert!(near(decoded.get_pixel(75, 50).0, [255, 0, 0]));
    }

    #[test]
    fn an_unknown_wallpaper_is_answered_with_the_not_found_kind() {
        // The crate's one answer for a missing row (ADR 0025), which the
        // protocol maps to a 404 the card can read.
        let library = Library::new();

        let err = library.answer(999, Size::Small).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "not_found");
    }

    #[test]
    fn a_missing_source_file_is_answered_with_not_found() {
        let library = Library::new();
        let id = library.seed("gone.png", &solid(10, 10, [0, 0, 0, 255]));
        std::fs::remove_file(library.source("gone.png")).unwrap();

        let err = library.answer(id, Size::Small).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "not_found");
    }

    #[test]
    fn a_cache_hit_reads_the_file_rather_than_decoding_the_source_again() {
        // The cache file is tampered with between the two answers, so what
        // comes back says which path ran: the bytes on disk mean the recorded
        // row and the source mtime agreed and nothing was decoded, and a fresh
        // JPEG would mean the hit was missed.
        let mut library = Library::new();
        let id = library.seed("c.png", &solid(300, 150, [7, 7, 7, 255]));
        library.answer(id, Size::Small).unwrap();

        std::fs::write(library.cache_file(id, Size::Small), b"the cache said so").unwrap();
        library.relaunch();
        let bytes = library.answer(id, Size::Small).unwrap();

        assert_eq!(bytes.as_slice(), b"the cache said so");
    }

    #[test]
    fn a_thumbnail_recorded_against_an_older_source_is_regenerated() {
        // A wallpaper edited in place: the row and the file are both there, and
        // the source's mtime has moved on from the one they were recorded at.
        let mut library = Library::new();
        let id = library.seed("r.png", &solid(300, 150, [7, 7, 7, 255]));
        library.answer(id, Size::Small).unwrap();
        let old_bytes = std::fs::read(library.cache_file(id, Size::Small)).unwrap();
        solid(600, 450, [8, 8, 8, 255])
            .save_with_format(library.source("r.png"), image::ImageFormat::Png)
            .unwrap();
        touch_later(&library.source("r.png"));
        library.relaunch();

        let bytes = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&bytes), (400, 300));
        assert_eq!(
            library.thumbnail_row(id, "small"),
            Some((400, 300, source_mtime(&library.source("r.png")).unwrap())),
            "the regenerated thumbnail was recorded against the source it was made from"
        );
        let new_bytes = std::fs::read(library.cache_file(id, Size::Small)).unwrap();
        assert_ne!(old_bytes, new_bytes);
        assert_eq!(dimensions_of(&new_bytes), (400, 300));
    }

    #[test]
    fn a_small_is_downscaled_from_a_cached_medium_rather_than_the_source() {
        // Decoding a 152MB PNG to make a 400px thumbnail is the review grid's
        // whole cost. The medium beside it is already a 1920px JPEG.
        let library = Library::new();
        let id = library.seed("d.png", &solid(3000, 1000, [200, 30, 30, 255]));
        library.answer(id, Size::Medium).unwrap();

        // Same mtime, different pixels: whichever one it decodes shows up in
        // the output. The medium still holds red.
        rewrite_keeping_mtime(
            &library.source("d.png"),
            &solid(3000, 1000, [30, 30, 200, 255]),
        );

        let small = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&small), (400, 133));
        let px = only_colour(&small);
        assert!(
            px[0] > px[2],
            "expected the medium's red, got {px:?} — the source was decoded"
        );
    }

    #[test]
    fn a_size_with_a_row_but_no_cache_file_still_uses_its_donor() {
        // A row is not a cache hit: the file behind it can be gone while the
        // row survives, and only `fulfill` looks. Consulting the donor only
        // when this size had no row left it unavailable in exactly the case
        // that has to regenerate, so the review grid stayed slow.
        let mut library = Library::new();
        let id = library.seed("r.png", &solid(3000, 1000, [200, 30, 30, 255]));
        library.answer(id, Size::Medium).unwrap();
        library.answer(id, Size::Small).unwrap();

        // The small's row survives, its file does not, and the medium beside
        // it is untouched and still fresh.
        std::fs::remove_file(library.cache_file(id, Size::Small)).unwrap();
        rewrite_keeping_mtime(
            &library.source("r.png"),
            &solid(3000, 1000, [30, 30, 200, 255]),
        );
        library.relaunch();

        let small = library.answer(id, Size::Small).unwrap();

        let px = only_colour(&small);
        assert!(
            px[0] > px[2],
            "expected the medium's red, got {px:?} — the source was decoded"
        );
    }

    #[test]
    fn a_donor_whose_cache_file_is_gone_falls_back_to_the_source() {
        let library = Library::new();
        let id = library.seed("g.png", &solid(3000, 1000, [10, 200, 10, 255]));
        library.answer(id, Size::Medium).unwrap();

        // The medium's row promises a file that is not there.
        std::fs::remove_file(library.cache_file(id, Size::Medium)).unwrap();

        let small = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&small), (400, 133));
        let px = only_colour(&small);
        assert!(px[1] > px[0] && px[1] > px[2], "got {px:?}");
    }

    #[test]
    fn a_donor_recorded_against_a_different_source_is_not_trusted() {
        let library = Library::new();
        let id = library.seed("s.png", &solid(3000, 1000, [200, 30, 30, 255]));
        library.answer(id, Size::Medium).unwrap();

        // A genuine edit: new pixels AND a new mtime. The medium is stale, so
        // the small has to come off the source.
        solid(3000, 1000, [30, 30, 200, 255])
            .save_with_format(library.source("s.png"), image::ImageFormat::Png)
            .unwrap();
        touch_later(&library.source("s.png"));

        let small = library.answer(id, Size::Small).unwrap();

        let px = only_colour(&small);
        assert!(px[2] > px[0], "expected the source's blue, got {px:?}");
    }

    #[test]
    fn a_donor_narrower_than_the_target_is_left_alone() {
        // The source is 300px, so its medium is 300px too — narrower than a
        // small. Deriving would be correct but pointless, and the rule stays
        // easy to reason about if it simply does not apply.
        let library = Library::new();
        let id = library.seed("n.png", &solid(300, 200, [200, 30, 30, 255]));
        let medium = library.answer(id, Size::Medium).unwrap();
        assert_eq!(dimensions_of(&medium).0, 300);

        rewrite_keeping_mtime(
            &library.source("n.png"),
            &solid(300, 200, [30, 30, 200, 255]),
        );
        let small = library.answer(id, Size::Small).unwrap();

        assert_eq!(dimensions_of(&small), (300, 200));
        let px = only_colour(&small);
        assert!(px[2] > px[0], "expected the source's blue, got {px:?}");
    }

    #[test]
    fn the_connection_is_free_while_the_image_work_happens() {
        // ADR 0004's split, pinned. Phase two runs here with the connection
        // released, and `Db::is_free` is a `try_lock` on the thread that would
        // be holding it, so a phase one whose guard leaked into a temporary
        // fails this and nothing else — it would still answer the right bytes.
        let library = Library::new();
        let id = library.seed("a.png", &solid(800, 600, [10, 20, 30, 255]));

        let bytes = library
            .cache
            .answer_with(&library.db, id, Size::Small, |plan, cache_dir| {
                assert!(
                    library.db.is_free(),
                    "the connection is held across the decode"
                );
                fulfill(plan, cache_dir)
            })
            .unwrap();

        assert_eq!(dimensions_of(&bytes), (400, 300));
    }

    #[test]
    fn a_repeat_answer_needs_neither_the_connection_nor_the_disk() {
        // Everything a miss would need is taken away first: the row the plan
        // reads, the source phase two stats, and the cache file it reads. An
        // answer that reached the connection is a `NotFound` and one that
        // reached the filesystem is another, so the same bytes back is the
        // memory tier and can be nothing else (ADR 0040).
        let library = Library::new();
        let id = library.seed("a.png", &solid(800, 600, [10, 20, 30, 255]));
        let first = library.answer(id, Size::Small).unwrap();

        library.db.write(|conn| {
            conn.execute("DELETE FROM wallpapers", []).unwrap();
            conn.execute("DELETE FROM thumbnails", []).unwrap();
        });
        std::fs::remove_file(library.source("a.png")).unwrap();
        std::fs::remove_file(library.cache_file(id, Size::Small)).unwrap();

        assert_eq!(library.answer(id, Size::Small).unwrap(), first);
        // And the UI thread's way in finds the same bytes, which is what lets a
        // hit skip the pool entirely.
        assert_eq!(library.cache.remembered(id, Size::Small), Some(first));
    }

    #[test]
    fn regenerating_a_stale_thumbnail_forgets_the_wallpapers_bytes_in_memory() {
        // A wallpaper edited in place, discovered by a request for one size
        // while another size of it is held in memory. The source moved, so both
        // are stale, and only the size that missed can find that out.
        let library = Library::new();
        let id = library.seed("a.png", &solid(800, 600, [10, 20, 30, 255]));
        // The medium first and the small off it, so the medium reaches the disk
        // and the row while memory ends up holding only the small: the small's
        // first generation drops its sibling.
        library.answer(id, Size::Medium).unwrap();
        library.answer(id, Size::Small).unwrap();
        assert!(library.cache.memory.holds(id, Size::Small));
        assert!(!library.cache.memory.holds(id, Size::Medium));
        library.db.write(|conn| {
            conn.execute("UPDATE thumbnails SET source_mtime = 1", [])
                .unwrap();
        });

        library
            .answer(id, Size::Medium)
            .expect("the medium regenerated");

        // With the source gone, an answer for the small can only come from
        // memory, and the regenerate above is what should have taken it out.
        std::fs::remove_file(library.source("a.png")).unwrap();
        assert!(
            library.answer(id, Size::Small).is_err(),
            "a stale small was still served from memory after its wallpaper regenerated"
        );
    }

    #[test]
    fn warming_a_cold_wallpaper_writes_both_sizes_and_records_them_against_the_source() {
        let library = Library::new();
        let id = library.seed("b.png", &solid(3000, 1000, [10, 200, 10, 255]));
        let expected_mtime = source_mtime(&library.source("b.png")).unwrap();

        assert_eq!(library.warm(id, "b.png"), Warmed::Generated);

        assert_eq!(
            library.thumbnail_row(id, "medium"),
            Some((1920, 640, expected_mtime))
        );
        assert_eq!(
            library.thumbnail_row(id, "small"),
            Some((400, 133, expected_mtime))
        );
        for (size, dimensions) in [(Size::Medium, (1920, 640)), (Size::Small, (400, 133))] {
            let written = std::fs::read(library.cache_file(id, size)).unwrap();
            assert_eq!(dimensions_of(&written), dimensions);
        }
    }

    #[test]
    fn warming_takes_the_small_off_the_medium_rather_than_off_the_source_again() {
        // One decode, two sizes, is the whole point of `generate_both`, and the
        // only place the chain shows from outside is the rounding. A 3000x1001
        // source gives a medium of 1920x641, and 641 rows scaled to 400px wide
        // round up to 134. Off the source directly the same small would be 133.
        let library = Library::new();
        let id = library.seed("chain.png", &solid(3000, 1001, [30, 30, 200, 255]));

        library.warm(id, "chain.png");

        let medium = library.thumbnail_row(id, "medium").unwrap();
        let small = library.thumbnail_row(id, "small").unwrap();
        assert_eq!((medium.0, medium.1), (1920, 641));
        assert_eq!((small.0, small.1), (400, 134));
    }

    #[test]
    fn warming_a_wallpaper_again_replaces_its_rows_rather_than_adding_to_them() {
        // The pass warms a wallpaper again whenever its source moves, and the
        // upsert is what keeps one row per size rather than an error on the key.
        let library = Library::new();
        let id = library.seed("u.png", &solid(20, 10, [0, 0, 0, 255]));
        library.warm(id, "u.png");

        touch_later(&library.source("u.png"));
        library.warm(id, "u.png");

        let rows: i64 = library.db.read(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM thumbnails WHERE wallpaper_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap()
        });
        assert_eq!(rows, 2);
        assert_eq!(
            library.thumbnail_row(id, "small").unwrap().2,
            source_mtime(&library.source("u.png")).unwrap()
        );
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

        std::fs::remove_file(library.cache_file(id, Size::Medium)).unwrap();

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
        std::fs::remove_file(library.cache_file(half, Size::Small)).unwrap();
        library.rank(cold, "active", 0);
        library.rank(half, "kept", 2);
        library.rank(rejected, "rejected", 0);
        library.note(noted, "noted.png", "image: nope");

        // The order the two halves are called in production: the query, then
        // the `read_dir` and the `stat`s, with nothing borrowed in between.
        let rows = library.db.read(candidates).unwrap();
        let list = work_list(&rows, library.cache_dir.path()).unwrap();

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
            write_cache_file(cache.path(), id, size, b"a cache file").unwrap();
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
            },
            Candidate {
                wallpaper_id: 2,
                source: cold_path.clone(),
                status: Status::Active,
                small_mtime: None,
                medium_mtime: None,
                failed_mtime: None,
                dimensions_known: true,
            },
            Candidate {
                wallpaper_id: 3,
                source: donor_path.clone(),
                status: Status::Kept,
                small_mtime: None,
                medium_mtime: Some(donor_mtime),
                failed_mtime: None,
                dimensions_known: true,
            },
            Candidate {
                wallpaper_id: 4,
                source: broken_path,
                status: Status::Active,
                small_mtime: None,
                medium_mtime: None,
                failed_mtime: Some(broken_mtime),
                dimensions_known: true,
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
            },
        ];

        let list = work_list(&rows, cache.path()).unwrap();

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
    fn a_second_failure_replaces_the_note_rather_than_refusing_it() {
        // The pass writes the note from inside a loop it will run again, so the
        // upsert is what keeps a second failure from erroring on the primary
        // key and leaving the row pinned to a version of the file that is gone.
        let library = Library::new();
        let id = library.seed("twice.png", &solid(20, 10, [5, 5, 5, 255]));

        library.db.write(|conn| {
            note_failure(conn, id, 111, "image: first").unwrap();
            note_failure(conn, id, 222, "image: second").unwrap();
        });

        let noted: (i64, String) = library.db.read(|conn| {
            conn.query_row(
                "SELECT source_mtime, message FROM thumbnail_failures WHERE wallpaper_id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
        });
        assert_eq!(noted, (222, "image: second".to_string()));
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

    #[test]
    fn the_cache_size_counts_every_file_and_the_bytes_they_take() {
        let library = Library::new();
        let id = library.seed("sized.png", &solid(3000, 1000, [10, 200, 10, 255]));
        library.warm(id, "sized.png");

        let size = library.cache.size().unwrap();

        // Two files per warm wallpaper, and the bytes are the files' own, not an
        // estimate: the readout's whole job is to be the number on disk.
        let on_disk: u64 = [Size::Medium, Size::Small]
            .into_iter()
            .map(|s| std::fs::metadata(library.cache_file(id, s)).unwrap().len())
            .sum();
        assert_eq!(
            size,
            CacheSize {
                bytes: on_disk,
                files: 2
            }
        );
    }

    #[test]
    fn a_cache_directory_that_is_empty_or_absent_is_zero_rather_than_an_error() {
        // Before the first thumbnail is written nothing has created the
        // directory, and Settings still has to render a line for it.
        let cache = tempfile::tempdir().unwrap();

        assert_eq!(
            ThumbnailCache::new(cache.path().to_path_buf())
                .size()
                .unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
        assert_eq!(
            ThumbnailCache::new(cache.path().join("no-such-cache"))
                .size()
                .unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
    }

    #[test]
    fn clearing_empties_the_directory_the_rows_and_memory_and_reports_zero_after() {
        let library = Library::new();
        let ids: Vec<i64> = ["one.png", "two.png"]
            .into_iter()
            .map(|name| {
                let id = library.seed(name, &solid(600, 300, [1, 2, 3, 255]));
                library.warm(id, name);
                library.answer(id, Size::Small).unwrap();
                id
            })
            .collect();
        assert_eq!(library.cache.size().unwrap().files, 4);

        library.cache.clear(&library.db).unwrap();

        for &id in &ids {
            assert_eq!(library.thumbnail_row(id, "medium"), None);
            assert_eq!(library.thumbnail_row(id, "small"), None);
            assert_eq!(library.cache.remembered(id, Size::Small), None);
        }
        assert_eq!(
            library.cache.size().unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
        // The directory stays, so the next pass writes into it rather than
        // recreating it, and the library is due in full again.
        assert!(library.cache_dir.path().is_dir());
        assert_eq!(library.work_list().len(), 2);
    }

    #[test]
    fn clearing_the_cache_forgets_the_bytes_in_memory() {
        // With the source gone as well, only the memory tier could still answer
        // with a picture, so an error is the proof that it did not (ADR 0040).
        // A clear that stopped at the rows would pass every other test here.
        let library = Library::new();
        let id = library.seed("a.png", &solid(800, 600, [10, 20, 30, 255]));
        library.answer(id, Size::Small).unwrap();

        library.cache.clear(&library.db).unwrap();
        std::fs::remove_file(library.source("a.png")).unwrap();

        assert!(
            library.answer(id, Size::Small).is_err(),
            "a cleared thumbnail was still served from memory"
        );
    }

    #[test]
    fn a_clear_that_cannot_empty_the_directory_leaves_the_rows_alone() {
        // Files first, rows second, for the reason `clear` gives: a pass still
        // finishing its wallpaper writes files before rows, so the row delete
        // has to be the last thing that can happen. That order is only visible
        // from outside when the first half fails — reversed, the rows would
        // already be gone by the time the directory refused.
        let mut library = Library::new();
        let id = library.seed("kept.png", &solid(20, 10, [4, 4, 4, 255]));
        library.warm(id, "kept.png");
        // A file where the directory should be: `read_dir` refuses it, which is
        // the first half failing without needing a permission this test might
        // not be able to take away.
        let not_a_directory = library.cache_dir.path().join("a-file");
        std::fs::write(&not_a_directory, b"").unwrap();
        library.cache = ThumbnailCache::new(not_a_directory);

        assert!(library.cache.clear(&library.db).is_err());

        assert!(library.thumbnail_row(id, "small").is_some());
        assert!(library.thumbnail_row(id, "medium").is_some());
    }

    #[test]
    fn clearing_the_cache_forgets_the_failures_with_the_rows() {
        // Clear thumbnail cache is the one control that gives an undecodable
        // source another go: a curator asking for the whole cache to be rebuilt
        // is asking for that too (ADR 0034).
        let library = Library::new();
        let id = library.seed("again.png", &solid(20, 10, [4, 4, 4, 255]));
        library.note(id, "again.png", "image: nope");
        assert!(library.work_list().is_empty());

        library.cache.clear(&library.db).unwrap();

        assert_eq!(library.listed(), vec![(id, Some(Missing::Both))]);
    }

    #[test]
    fn clearing_a_cache_that_is_not_there_yet_still_empties_the_table() {
        // Nothing has written a thumbnail, so nothing has created the directory,
        // and a row without a file is a row the curator asked to be rid of.
        let mut library = Library::new();
        let id = library.seed("rowonly.png", &solid(20, 10, [4, 4, 4, 255]));
        library
            .db
            .write(|conn| record_one(conn, id, Size::Small, 20, 10, 111))
            .unwrap();
        library.cache = ThumbnailCache::new(library.cache_dir.path().join("no-such-cache"));

        library.cache.clear(&library.db).unwrap();

        assert_eq!(library.thumbnail_row(id, "small"), None);
    }

    #[test]
    fn the_bytes_in_memory_are_bounded_and_the_coldest_goes_first() {
        // The bound is an entry count and eviction is least-recently-used, so a
        // wallpaper asked for again outlives one that was stored later and never
        // asked for. Two entries rather than 256 so the eviction is the test's
        // subject rather than its setup.
        let cache = ImageCache::new(2);
        cache.store(1, Size::Small, Arc::new(vec![1]));
        cache.store(2, Size::Small, Arc::new(vec![2]));

        assert!(cache.get(1, Size::Small).is_some(), "still held");
        cache.store(3, Size::Small, Arc::new(vec![3]));

        assert!(cache.holds(1, Size::Small), "asked for most recently");
        assert!(!cache.holds(2, Size::Small), "the coldest went");
        assert!(cache.holds(3, Size::Small), "just stored");
    }

    #[test]
    fn a_full_size_image_is_never_held_in_memory() {
        // What keeps `IMAGE_CACHE_ENTRIES` an honest bound: `small` and `medium`
        // are capped by a maximum width, `full` is capped by nothing.
        let cache = ImageCache::new(2);

        cache.store(1, Size::Full, Arc::new(vec![0; 4096]));

        assert!(!cache.holds(1, Size::Full));
    }

    #[test]
    fn a_cache_size_crosses_the_ipc_with_the_fields_client_ts_expects() {
        let json = serde_json::to_value(CacheSize {
            bytes: 48_000_000,
            files: 172,
        })
        .unwrap();

        assert_eq!(json["bytes"], 48_000_000);
        assert_eq!(json["files"], 172);
    }

    #[test]
    fn invalid_size_strings_do_not_parse() {
        assert_eq!(Size::parse("small"), Some(Size::Small));
        assert_eq!(Size::parse("medium"), Some(Size::Medium));
        assert_eq!(Size::parse("full"), Some(Size::Full));
        assert_eq!(Size::parse("huge"), None);
        assert_eq!(Size::parse(""), None);
    }
}
