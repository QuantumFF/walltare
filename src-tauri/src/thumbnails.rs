use std::collections::HashSet;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, ImageEncoder, ImageReader, Rgb, RgbImage};
use rusqlite::Connection;

use crate::error::AppError;

pub const SMALL_MAX_WIDTH: u32 = 400;
pub const MEDIUM_MAX_WIDTH: u32 = 1920;
const JPEG_QUALITY: u8 = 85;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug)]
pub struct Thumbnail {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Everything the resolver needs from the database before it can do any work.
///
/// Splitting this out lets the caller release the connection lock before
/// [`fulfill`] decodes and re-encodes the image, which for a 4K source is
/// hundreds of milliseconds of CPU that would otherwise block every other
/// command and every other image request.
pub struct Plan {
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
pub struct Resolved {
    pub thumbnail: Thumbnail,
    /// `Some` only when freshly generated, meaning the row needs upserting.
    pub record_mtime: Option<i64>,
}

/// Phase 1 — the only part that touches the database before the image work.
pub fn plan(conn: &Connection, wallpaper_id: i64, size: Size) -> Result<Plan, AppError> {
    let source: String = conn
        .query_row(
            "SELECT path FROM wallpapers WHERE id = ?1",
            [wallpaper_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no wallpaper with id {wallpaper_id}"))
            }
            other => other.into(),
        })?;

    let cached = match conn.query_row(
        "SELECT width, height, source_mtime FROM thumbnails
         WHERE wallpaper_id = ?1 AND size = ?2",
        rusqlite::params![wallpaper_id, size.label()],
        |row| {
            Ok((
                row.get::<_, i64>(0)? as u32,
                row.get::<_, i64>(1)? as u32,
                row.get::<_, i64>(2)?,
            ))
        },
    ) {
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
        source: PathBuf::from(source),
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
    for donor in size.donors() {
        let row = conn.query_row(
            "SELECT width, source_mtime FROM thumbnails
             WHERE wallpaper_id = ?1 AND size = ?2",
            rusqlite::params![wallpaper_id, donor.label()],
            |row| Ok((row.get::<_, i64>(0)? as u32, row.get::<_, i64>(1)?)),
        );
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
pub fn fulfill(plan: &Plan, cache_dir: &Path) -> Result<Resolved, AppError> {
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
pub fn record(conn: &Connection, plan: &Plan, resolved: &Resolved) -> Result<(), AppError> {
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
pub fn record_one(
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
pub struct Recorded {
    pub size: Size,
    pub width: u32,
    pub height: u32,
    pub source_mtime: i64,
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
pub fn generate_both(
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

/// The three phases back to back, for callers that already hold the connection
/// for the whole operation. Production goes through the phases directly so the
/// lock is released across the decode; this exists for the unit tests.
#[cfg(test)]
pub fn resolve(
    conn: &Connection,
    cache_dir: &Path,
    wallpaper_id: i64,
    size: Size,
) -> Result<Thumbnail, AppError> {
    let plan = plan(conn, wallpaper_id, size)?;
    let resolved = fulfill(&plan, cache_dir)?;
    record(conn, &plan, &resolved)?;
    Ok(resolved.thumbnail)
}

/// Throws away one wallpaper's cached thumbnails, rows and files both.
///
/// Nothing in production calls this, which is why the `dead_code` allow is
/// here: the soft reject used to, and stopped, because a Rejected wallpaper is
/// now shown in the library page and can be restored, so its cache is worth
/// keeping (ADR 0012). The function stays because it is the single-wallpaper
/// case of [`clear`], which is what Settings calls.
#[allow(dead_code)]
pub fn purge(conn: &Connection, cache_dir: &Path, wallpaper_id: i64) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM thumbnails WHERE wallpaper_id = ?1",
        [wallpaper_id],
    )?;
    for size in [Size::Small, Size::Medium, Size::Full] {
        match std::fs::remove_file(cache_path(cache_dir, wallpaper_id, size)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
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

/// Counts the cache directory, so 830MB under `app_data` is a number the
/// curator can read rather than invisible (ADR 0012).
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
pub fn cache_size(cache_dir: &Path) -> Result<CacheSize, AppError> {
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

/// Throws away the whole cache: every file in the directory, then every row in
/// `thumbnails`.
///
/// The caller cancels any running pass first. It does not wait for it, because
/// the flag is read between wallpapers and joining would block the IPC thread
/// for up to one decode (ADR 0012), so a pass can still finish the wallpaper it
/// is on while this runs. That decides the order here: the pass writes a
/// wallpaper's files and only then records its rows, so removing them in the
/// same order leaves the row delete last, and every row the pass manages to
/// write before that instant goes with it. Reversed, a pass recording a row
/// after the `DELETE` and having its files swept a moment later would leave a
/// dangling row for almost every way the two can interleave.
///
/// Two residues survive the narrow windows that remain, and the app already
/// handles both: a file with no row is regenerated on demand and relisted by
/// [`work_list`], and a row with no file is exactly what [`fulfill`] and
/// [`work_list`] both read as missing. What cannot happen is a row promising
/// bytes that differ from the file beside it, because the pass never records a
/// row for a file it did not just write.
///
/// The directory itself stays, and nothing restarts. Clearing is a rebuild the
/// next launch pays for rather than a way to reclaim disk (ADR 0012).
pub fn clear(conn: &Connection, cache_dir: &Path) -> Result<(), AppError> {
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
    conn.execute("DELETE FROM thumbnails", [])?;
    Ok(())
}

/// Which of the two pre-generated sizes a wallpaper is short of.
///
/// Two variants rather than a set of sizes, because the pass branches on
/// exactly this: `Both` is the single decode [`generate_both`] exists for, and
/// one missing size is the donor case [`plan`] and [`fulfill`] already handle.
/// "Neither" has no variant because such a wallpaper never joins the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Missing {
    Both,
    Only(Size),
}

/// A wallpaper's Status, the three of `CONTEXT.md`.
///
/// The work list carries the one it saw so the pass can tell a wallpaper that
/// was already Rejected when it was listed, which is the tail group ADR 0016
/// put at the end of the queue, from one rejected since, which is a snapshot
/// gone stale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Active,
    Kept,
    Rejected,
}

impl Status {
    /// Reads the `status` column.
    ///
    /// The schema's `CHECK` constraint allows only these three spellings, so
    /// anything else is a database this app never wrote. Such a row reads as
    /// Active, which is how every other Status read in the codebase treats a
    /// value that is not `rejected`.
    pub fn read(column: &str) -> Self {
        match column {
            "rejected" => Self::Rejected,
            "kept" => Self::Kept,
            _ => Self::Active,
        }
    }
}

/// One wallpaper the pre-generation pass would reach, and what it owes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    pub wallpaper_id: i64,
    /// Where the file sat when the list was built, which is what the freshness
    /// check `stat`ed. A reject or a Restore rewrites `path`, so the pass
    /// re-reads the row under its own lock and generates from what it finds
    /// there rather than from this copy.
    pub source: PathBuf,
    /// The Status the list saw, for the pass to compare the row against.
    pub status: Status,
    pub missing: Missing,
}

/// Every wallpaper the pre-generation pass would generate, in the order it
/// would reach them.
///
/// One query, one `read_dir` of the cache directory, and one `stat` per source
/// file. No image bytes are read at all. Running [`plan`] and [`fulfill`] over
/// the library instead would reuse the freshness rule exactly, and would also
/// read the whole cache off disk on every launch to discover that nothing needs
/// doing — 830MB of pointless reads on a two-thousand-wallpaper library
/// (ADR 0012).
///
/// The order is `status = 'rejected' ASC, comparisons_count ASC, id ASC`.
/// Rejected is a tail group behind the Eligible pool, so warming rejects costs
/// the voting pool nothing (ADR 0016), and `comparisons_count ASC` targets the
/// half of a pair `select_pair` picks by least-compared ties, which is the half
/// anything can aim at. A scan inserts rows at count 0, so freshly scanned
/// files land at the head.
///
/// Each entry carries the Status it was listed under, because the pass compares
/// the row against that rather than against Eligible: a Rejected entry is the
/// tail group and gets generated, one rejected after the fact does not.
///
/// The length is the honest total for the pass's progress, because a wallpaper
/// it would skip never enters the list.
pub fn work_list(conn: &Connection, cache_dir: &Path) -> Result<Vec<Pending>, AppError> {
    let cached = cache_filenames(cache_dir)?;

    let mut stmt = conn.prepare(
        "SELECT w.id, w.path, w.status, s.source_mtime, m.source_mtime
         FROM wallpapers w
         LEFT JOIN thumbnails s ON s.wallpaper_id = w.id AND s.size = 'small'
         LEFT JOIN thumbnails m ON m.wallpaper_id = w.id AND m.size = 'medium'
         ORDER BY w.status = 'rejected' ASC, w.comparisons_count ASC, w.id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<i64>>(3)?,
            row.get::<_, Option<i64>>(4)?,
        ))
    })?;

    let mut pending = Vec::new();
    for row in rows {
        let (wallpaper_id, path, status, small_mtime, medium_mtime) = row?;
        let source = PathBuf::from(path);
        // A source that is not on disk cannot be stat'd, so no recorded mtime
        // can be said to match it and the wallpaper joins the list. That is
        // what makes a missing file counted and skipped rather than silently
        // absent: the pass fails it, reports it, and carries on.
        let on_disk = source_mtime(&source).ok();
        let fresh = |recorded: Option<i64>, size: Size| {
            matches!((recorded, on_disk), (Some(r), Some(d)) if r == d)
                && cached.contains(&cache_filename(wallpaper_id, size))
        };

        let missing = match (
            fresh(small_mtime, Size::Small),
            fresh(medium_mtime, Size::Medium),
        ) {
            (true, true) => continue,
            (false, false) => Missing::Both,
            (false, true) => Missing::Only(Size::Small),
            (true, false) => Missing::Only(Size::Medium),
        };
        pending.push(Pending {
            wallpaper_id,
            source,
            status: Status::read(&status),
            missing,
        });
    }
    Ok(pending)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use image::{Rgba, RgbaImage};
    fn setup() -> (Connection, tempfile::TempDir) {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        let dir = tempfile::tempdir().unwrap();
        (conn, dir)
    }

    fn solid(width: u32, height: u32, color: [u8; 4]) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba(color)))
    }

    fn seed_wallpaper(conn: &Connection, dir: &Path, name: &str, img: &DynamicImage) -> i64 {
        let path = dir.join(name);
        img.save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        conn.execute(
            "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
            rusqlite::params![name, path.to_str().unwrap()],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn thumbnail_row(conn: &Connection, id: i64, size: &str) -> Option<(i64, i64, i64)> {
        conn.query_row(
            "SELECT width, height, source_mtime FROM thumbnails WHERE wallpaper_id = ?1 AND size = ?2",
            rusqlite::params![id, size],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok()
    }

    #[test]
    fn first_request_generates_cache_file_and_upserts_row() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "a.png",
            &solid(800, 600, [10, 20, 30, 255]),
        );
        let expected_mtime = source_mtime(&tmp.path().join("a.png")).unwrap();

        let thumb = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((thumb.width, thumb.height), (400, 300));
        assert!(image::load_from_memory(&thumb.bytes).is_ok());
        let cache_file = tmp.path().join(format!("{id}_small.jpg"));
        assert!(cache_file.exists());
        assert_eq!(
            thumbnail_row(&conn, id, "small"),
            Some((400, 300, expected_mtime))
        );
    }

    #[test]
    fn narrower_source_reuses_source_dimensions() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "n.png", &solid(200, 100, [1, 2, 3, 255]));

        let thumb = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((thumb.width, thumb.height), (200, 100));
        assert_eq!(
            thumbnail_row(&conn, id, "small"),
            Some((200, 100, source_mtime(&tmp.path().join("n.png")).unwrap()))
        );
    }

    #[test]
    fn wider_source_downscales_preserving_aspect_ratio() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "w.png",
            &solid(3840, 2160, [9, 9, 9, 255]),
        );

        let thumb = resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        assert_eq!((thumb.width, thumb.height), (1920, 1080));
    }

    #[test]
    fn a_source_far_wider_than_the_target_still_lands_on_the_exact_size() {
        // Past 2x the target, `downscale_if_wider` box-reduces before running
        // Lanczos3, because Lanczos3's radius scales with the ratio and a
        // 17280-wide source cost seconds of CPU in one step. The two-step
        // route has to produce the same dimensions as the one-step route did.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "huge.png",
            &solid(9600, 2700, [40, 80, 120, 255]),
        );

        let thumb = resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        assert_eq!((thumb.width, thumb.height), (1920, 540));
        // A flat source must survive both filters flat: a pre-reduction that
        // sampled off the edge of the image would show up as banding here.
        let decoded = image::load_from_memory(&thumb.bytes).unwrap().to_rgb8();
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
    fn full_size_never_downscales_and_is_invalidated_like_the_others() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "f.png", &solid(800, 600, [4, 5, 6, 255]));

        let thumb = resolve(&conn, tmp.path(), id, Size::Full).unwrap();

        assert_eq!((thumb.width, thumb.height), (800, 600));
        assert!(tmp.path().join(format!("{id}_full.jpg")).exists());
        assert_eq!(
            thumbnail_row(&conn, id, "full"),
            Some((800, 600, source_mtime(&tmp.path().join("f.png")).unwrap()))
        );
    }

    #[test]
    fn an_edit_within_the_same_second_still_invalidates() {
        // Whole-second mtimes made this case permanently stale: the recorded
        // mtime matched, so the old thumbnail was served forever.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "s.png", &solid(300, 150, [1, 1, 1, 255]));
        let first = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        // Both sizes stay under SMALL_MAX_WIDTH so a changed dimension can only
        // mean the thumbnail was regenerated, never that it was downscaled.
        solid(350, 120, [2, 2, 2, 255])
            .save_with_format(tmp.path().join("s.png"), image::ImageFormat::Png)
            .unwrap();

        let second = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((first.width, first.height), (300, 150));
        assert_eq!((second.width, second.height), (350, 120));
    }

    #[test]
    fn rgba_sources_flatten_onto_white_without_artifacts() {
        let (conn, tmp) = setup();
        let mut img = RgbaImage::from_pixel(100, 100, Rgba([255, 0, 0, 255]));
        for (x, _y, p) in img.enumerate_pixels_mut() {
            if x < 50 {
                *p = Rgba([0, 0, 0, 0]);
            }
        }
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "alpha.png",
            &DynamicImage::ImageRgba8(img),
        );

        let thumb = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        let decoded = image::load_from_memory(&thumb.bytes).unwrap().to_rgb8();
        let near = |a: [u8; 3], b: [u8; 3]| a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= 4);
        assert!(near(decoded.get_pixel(25, 50).0, [255, 255, 255]));
        assert!(near(decoded.get_pixel(75, 50).0, [255, 0, 0]));
    }

    #[test]
    fn unknown_wallpaper_id_resolves_to_not_found_kind() {
        let (conn, tmp) = setup();

        let err = resolve(&conn, tmp.path(), 999, Size::Small).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "not_found");
    }

    #[test]
    fn missing_source_file_resolves_to_not_found() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "gone.png",
            &solid(10, 10, [0, 0, 0, 255]),
        );
        std::fs::remove_file(tmp.path().join("gone.png")).unwrap();

        let err = resolve(&conn, tmp.path(), id, Size::Small).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "not_found");
    }

    #[test]
    fn repeat_request_serves_cached_file_without_regeneration() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "c.png", &solid(300, 150, [7, 7, 7, 255]));
        resolve(&conn, tmp.path(), id, Size::Small).unwrap();
        let cache_file = tmp.path().join(format!("{id}_small.jpg"));
        let mtime_before = std::fs::metadata(&cache_file).unwrap().modified().unwrap();

        let thumb = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((thumb.width, thumb.height), (300, 150));
        let mtime_after = std::fs::metadata(&cache_file).unwrap().modified().unwrap();
        assert_eq!(mtime_before, mtime_after);
    }

    #[test]
    fn changed_source_mtime_regenerates_and_upserts_row() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "r.png", &solid(300, 150, [7, 7, 7, 255]));
        resolve(&conn, tmp.path(), id, Size::Small).unwrap();
        let cache_file = tmp.path().join(format!("{id}_small.jpg"));
        let old_bytes = std::fs::read(&cache_file).unwrap();
        solid(600, 450, [8, 8, 8, 255])
            .save_with_format(tmp.path().join("r.png"), image::ImageFormat::Png)
            .unwrap();
        let file = std::fs::File::options()
            .append(true)
            .open(tmp.path().join("r.png"))
            .unwrap();
        file.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();
        drop(file);

        let thumb = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((thumb.width, thumb.height), (400, 300));
        assert_eq!(
            thumbnail_row(&conn, id, "small").map(|(w, h, _)| (w, h)),
            Some((400, 300))
        );
        assert_eq!(
            thumbnail_row(&conn, id, "small").unwrap().2,
            source_mtime(&tmp.path().join("r.png")).unwrap()
        );
        let new_bytes = std::fs::read(&cache_file).unwrap();
        assert_ne!(old_bytes, new_bytes);
        let cached_img = image::load_from_memory(&new_bytes).unwrap();
        assert_eq!((cached_img.width(), cached_img.height()), (400, 300));
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

    fn only_colour(bytes: &[u8]) -> [u8; 3] {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgb8()
            .get_pixel(5, 5)
            .0
    }

    #[test]
    fn a_small_is_downscaled_from_a_cached_medium_rather_than_the_source() {
        // Decoding a 152MB PNG to make a 400px thumbnail is the review grid's
        // whole cost. The medium beside it is already a 1920px JPEG.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "d.png",
            &solid(3000, 1000, [200, 30, 30, 255]),
        );
        resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        // Same mtime, different pixels: whichever one it decodes shows up in
        // the output. The medium still holds red.
        rewrite_keeping_mtime(
            &tmp.path().join("d.png"),
            &solid(3000, 1000, [30, 30, 200, 255]),
        );

        let small = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((small.width, small.height), (400, 133));
        let px = only_colour(&small.bytes);
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
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "r.png",
            &solid(3000, 1000, [200, 30, 30, 255]),
        );
        resolve(&conn, tmp.path(), id, Size::Medium).unwrap();
        resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        // The small's row survives, its file does not, and the medium beside
        // it is untouched and still fresh.
        std::fs::remove_file(tmp.path().join(format!("{id}_small.jpg"))).unwrap();
        rewrite_keeping_mtime(
            &tmp.path().join("r.png"),
            &solid(3000, 1000, [30, 30, 200, 255]),
        );

        let small = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        let px = only_colour(&small.bytes);
        assert!(
            px[0] > px[2],
            "expected the medium's red, got {px:?} — the source was decoded"
        );
    }

    #[test]
    fn a_donor_whose_cache_file_is_gone_falls_back_to_the_source() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "g.png",
            &solid(3000, 1000, [10, 200, 10, 255]),
        );
        resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        // The medium's row promises a file that is not there.
        std::fs::remove_file(tmp.path().join(format!("{id}_medium.jpg"))).unwrap();

        let small = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((small.width, small.height), (400, 133));
        let px = only_colour(&small.bytes);
        assert!(px[1] > px[0] && px[1] > px[2], "got {px:?}");
    }

    #[test]
    fn a_donor_recorded_against_a_different_source_is_not_trusted() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "s.png",
            &solid(3000, 1000, [200, 30, 30, 255]),
        );
        resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        // A genuine edit: new pixels AND a new mtime. The medium is stale, so
        // the small has to come off the source.
        solid(3000, 1000, [30, 30, 200, 255])
            .save_with_format(tmp.path().join("s.png"), image::ImageFormat::Png)
            .unwrap();
        std::fs::File::options()
            .append(true)
            .open(tmp.path().join("s.png"))
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(60))
            .unwrap();

        let small = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        let px = only_colour(&small.bytes);
        assert!(px[2] > px[0], "expected the source's blue, got {px:?}");
    }

    #[test]
    fn a_donor_narrower_than_the_target_is_left_alone() {
        // The source is 300px, so its medium is 300px too — narrower than a
        // small. Deriving would be correct but pointless, and the rule stays
        // easy to reason about if it simply does not apply.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "n.png",
            &solid(300, 200, [200, 30, 30, 255]),
        );
        let medium = resolve(&conn, tmp.path(), id, Size::Medium).unwrap();
        assert_eq!(medium.width, 300);

        rewrite_keeping_mtime(
            &tmp.path().join("n.png"),
            &solid(300, 200, [30, 30, 200, 255]),
        );
        let small = resolve(&conn, tmp.path(), id, Size::Small).unwrap();

        assert_eq!((small.width, small.height), (300, 200));
        let px = only_colour(&small.bytes);
        assert!(px[2] > px[0], "expected the source's blue, got {px:?}");
    }

    #[test]
    fn purge_removes_rows_and_cache_files_across_sizes() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "p.png",
            &solid(2400, 1200, [3, 3, 3, 255]),
        );
        resolve(&conn, tmp.path(), id, Size::Small).unwrap();
        resolve(&conn, tmp.path(), id, Size::Medium).unwrap();

        purge(&conn, tmp.path(), id).unwrap();

        assert_eq!(thumbnail_row(&conn, id, "small"), None);
        assert_eq!(thumbnail_row(&conn, id, "medium"), None);
        assert!(!tmp.path().join(format!("{id}_small.jpg")).exists());
        assert!(!tmp.path().join(format!("{id}_medium.jpg")).exists());
        assert!(!tmp.path().join(format!("{id}_full.jpg")).exists());
    }

    #[test]
    fn purge_is_idempotent_for_unknown_wallpaper() {
        let (conn, tmp) = setup();

        purge(&conn, tmp.path(), 12345).unwrap();
    }

    /// Generates and records both pre-generated sizes the way the pass will,
    /// which is what "fully warm" means to [`work_list`].
    fn warm(conn: &Connection, cache_dir: &Path, id: i64, source: &Path) {
        for r in generate_both(id, source, cache_dir).unwrap() {
            record_one(conn, id, r.size, r.width, r.height, r.source_mtime).unwrap();
        }
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

    fn rank(conn: &Connection, id: i64, status: &str, comparisons: i64) {
        conn.execute(
            "UPDATE wallpapers SET status = ?2, comparisons_count = ?3 WHERE id = ?1",
            rusqlite::params![id, status, comparisons],
        )
        .unwrap();
    }

    fn listed(conn: &Connection, cache_dir: &Path) -> Vec<(i64, Missing)> {
        work_list(conn, cache_dir)
            .unwrap()
            .into_iter()
            .map(|p| (p.wallpaper_id, p.missing))
            .collect()
    }

    #[test]
    fn generate_both_writes_both_sizes_and_records_them_against_the_source() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "b.png",
            &solid(3000, 1000, [10, 200, 10, 255]),
        );
        let expected_mtime = source_mtime(&tmp.path().join("b.png")).unwrap();

        let recorded = generate_both(id, &tmp.path().join("b.png"), cache.path()).unwrap();

        // Generation order, medium first, so the caller can record them in the
        // order the files were written.
        assert_eq!(
            recorded,
            [
                Recorded {
                    size: Size::Medium,
                    width: 1920,
                    height: 640,
                    source_mtime: expected_mtime,
                },
                Recorded {
                    size: Size::Small,
                    width: 400,
                    height: 133,
                    source_mtime: expected_mtime,
                },
            ]
        );
        for r in recorded {
            let file = cache.path().join(format!("{id}_{}.jpg", r.size.label()));
            let written = image::load_from_memory(&std::fs::read(&file).unwrap()).unwrap();
            assert_eq!((written.width(), written.height()), (r.width, r.height));
            record_one(&conn, id, r.size, r.width, r.height, r.source_mtime).unwrap();
        }
        assert_eq!(
            thumbnail_row(&conn, id, "medium"),
            Some((1920, 640, expected_mtime))
        );
        assert_eq!(
            thumbnail_row(&conn, id, "small"),
            Some((400, 133, expected_mtime))
        );
    }

    #[test]
    fn the_small_comes_off_the_medium_rather_than_off_the_source_again() {
        // One decode, two sizes, is the whole point of `generate_both`, and the
        // only place the chain shows from outside is the rounding. A 3000x1001
        // source gives a medium of 1920x641, and 641 rows scaled to 400px wide
        // round up to 134. Off the source directly the same small would be 133.
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "chain.png",
            &solid(3000, 1001, [30, 30, 200, 255]),
        );

        let [medium, small] =
            generate_both(id, &tmp.path().join("chain.png"), cache.path()).unwrap();

        assert_eq!((medium.width, medium.height), (1920, 641));
        assert_eq!((small.width, small.height), (400, 134));
    }

    #[test]
    fn record_one_upserts_the_row_it_already_wrote() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "u.png", &solid(10, 10, [0, 0, 0, 255]));

        record_one(&conn, id, Size::Small, 400, 300, 111).unwrap();
        record_one(&conn, id, Size::Small, 200, 150, 222).unwrap();

        assert_eq!(thumbnail_row(&conn, id, "small"), Some((200, 150, 222)));
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM thumbnails WHERE wallpaper_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn a_wallpaper_with_neither_size_joins_the_work_list() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "cold.png",
            &solid(20, 10, [1, 1, 1, 255]),
        );

        let list = work_list(&conn, cache.path()).unwrap();

        assert_eq!(
            list,
            vec![Pending {
                wallpaper_id: id,
                source: tmp.path().join("cold.png"),
                status: Status::Active,
                missing: Missing::Both,
            }]
        );
    }

    #[test]
    fn a_wallpaper_with_both_sizes_fresh_stays_out_of_the_work_list() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let warmed = seed_wallpaper(&conn, tmp.path(), "w.png", &solid(20, 10, [1, 1, 1, 255]));
        let cold = seed_wallpaper(&conn, tmp.path(), "c.png", &solid(20, 10, [2, 2, 2, 255]));
        warm(&conn, cache.path(), warmed, &tmp.path().join("w.png"));

        assert_eq!(listed(&conn, cache.path()), vec![(cold, Missing::Both)]);
    }

    #[test]
    fn a_wallpaper_missing_only_one_size_joins_for_that_size_alone() {
        // "Small is missing, medium is fresh" is what `Size::donors` was built
        // for, so the pass has to be told which size rather than just that
        // something is due.
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(&conn, tmp.path(), "one.png", &solid(20, 10, [3, 3, 3, 255]));
        warm(&conn, cache.path(), id, &tmp.path().join("one.png"));
        conn.execute(
            "DELETE FROM thumbnails WHERE wallpaper_id = ?1 AND size = 'small'",
            [id],
        )
        .unwrap();

        assert_eq!(
            listed(&conn, cache.path()),
            vec![(id, Missing::Only(Size::Small))]
        );
    }

    #[test]
    fn a_recorded_mtime_that_no_longer_matches_the_source_rejoins_the_work_list() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(&conn, tmp.path(), "e.png", &solid(20, 10, [4, 4, 4, 255]));
        warm(&conn, cache.path(), id, &tmp.path().join("e.png"));
        assert!(work_list(&conn, cache.path()).unwrap().is_empty());

        touch_later(&tmp.path().join("e.png"));

        assert_eq!(listed(&conn, cache.path()), vec![(id, Missing::Both)]);
    }

    #[test]
    fn a_row_whose_cache_file_is_gone_rejoins_the_work_list() {
        // A row is not a cache hit. The work list reads the directory rather
        // than trusting the table, because a row can outlive its file.
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(&conn, tmp.path(), "f.png", &solid(20, 10, [5, 5, 5, 255]));
        warm(&conn, cache.path(), id, &tmp.path().join("f.png"));

        std::fs::remove_file(cache.path().join(format!("{id}_medium.jpg"))).unwrap();

        assert_eq!(
            listed(&conn, cache.path()),
            vec![(id, Missing::Only(Size::Medium))]
        );
    }

    #[test]
    fn a_wallpaper_whose_source_is_gone_joins_so_the_pass_can_count_it() {
        // Nothing can be said about the freshness of a file that is not there,
        // and a wallpaper the pass never lists is a wallpaper it never reports
        // as failed.
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "gone.png",
            &solid(20, 10, [6, 6, 6, 255]),
        );
        warm(&conn, cache.path(), id, &tmp.path().join("gone.png"));
        std::fs::remove_file(tmp.path().join("gone.png")).unwrap();

        assert_eq!(listed(&conn, cache.path()), vec![(id, Missing::Both)]);
    }

    #[test]
    fn the_work_list_puts_rejected_last_and_least_compared_first() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let img = solid(20, 10, [7, 7, 7, 255]);
        let voted = seed_wallpaper(&conn, tmp.path(), "voted.png", &img);
        let rejected_fresh = seed_wallpaper(&conn, tmp.path(), "rej-new.png", &img);
        let scanned = seed_wallpaper(&conn, tmp.path(), "scanned.png", &img);
        let rejected_voted = seed_wallpaper(&conn, tmp.path(), "rej-old.png", &img);
        let kept = seed_wallpaper(&conn, tmp.path(), "kept.png", &img);
        rank(&conn, voted, "active", 9);
        rank(&conn, rejected_fresh, "rejected", 0);
        rank(&conn, scanned, "active", 0);
        rank(&conn, rejected_voted, "rejected", 9);
        rank(&conn, kept, "kept", 3);

        let order: Vec<(i64, Status)> = work_list(&conn, cache.path())
            .unwrap()
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
    fn the_work_list_is_empty_on_a_fully_warm_library() {
        // Every launch after the first. An empty list is what makes the pass
        // emit nothing rather than flash a finished bar.
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        for name in ["a.png", "b.png", "c.png"] {
            let id = seed_wallpaper(&conn, tmp.path(), name, &solid(20, 10, [8, 8, 8, 255]));
            warm(&conn, cache.path(), id, &tmp.path().join(name));
        }

        assert!(work_list(&conn, cache.path()).unwrap().is_empty());
    }

    #[test]
    fn the_work_list_survives_a_cache_directory_that_does_not_exist_yet() {
        // First launch: nothing has written a thumbnail, so nothing has created
        // the directory either, and the whole library is due.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "first.png",
            &solid(20, 10, [9, 9, 9, 255]),
        );

        let cache = tmp.path().join("no-such-cache");

        assert_eq!(listed(&conn, &cache), vec![(id, Missing::Both)]);
    }

    #[test]
    fn the_cache_size_counts_every_file_and_the_bytes_they_take() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "sized.png",
            &solid(3000, 1000, [10, 200, 10, 255]),
        );
        warm(&conn, cache.path(), id, &tmp.path().join("sized.png"));

        let size = cache_size(cache.path()).unwrap();

        // Two files per warm wallpaper, and the bytes are the files' own, not an
        // estimate: the readout's whole job is to be the number on disk.
        let on_disk: u64 = [Size::Medium, Size::Small]
            .into_iter()
            .map(|s| {
                std::fs::metadata(cache_path(cache.path(), id, s))
                    .unwrap()
                    .len()
            })
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
            cache_size(cache.path()).unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
        assert_eq!(
            cache_size(&cache.path().join("no-such-cache")).unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
    }

    #[test]
    fn clearing_empties_the_directory_and_the_table_and_reports_zero_after() {
        let (conn, tmp) = setup();
        let cache = tempfile::tempdir().unwrap();
        let ids: Vec<i64> = ["one.png", "two.png"]
            .into_iter()
            .map(|name| {
                let id = seed_wallpaper(&conn, tmp.path(), name, &solid(600, 300, [1, 2, 3, 255]));
                warm(&conn, cache.path(), id, &tmp.path().join(name));
                id
            })
            .collect();
        assert_eq!(cache_size(cache.path()).unwrap().files, 4);

        clear(&conn, cache.path()).unwrap();

        for id in ids {
            assert_eq!(thumbnail_row(&conn, id, "medium"), None);
            assert_eq!(thumbnail_row(&conn, id, "small"), None);
        }
        assert_eq!(
            cache_size(cache.path()).unwrap(),
            CacheSize { bytes: 0, files: 0 }
        );
        // The directory stays, so the next pass writes into it rather than
        // recreating it, and the library is due in full again.
        assert!(cache.path().is_dir());
        assert_eq!(work_list(&conn, cache.path()).unwrap().len(), 2);
    }

    #[test]
    fn clearing_a_cache_that_is_not_there_yet_still_empties_the_table() {
        // Nothing has written a thumbnail, so nothing has created the directory,
        // and a row without a file is a row the curator asked to be rid of.
        let (conn, tmp) = setup();
        let id = seed_wallpaper(
            &conn,
            tmp.path(),
            "rowonly.png",
            &solid(20, 10, [4, 4, 4, 255]),
        );
        record_one(&conn, id, Size::Small, 20, 10, 111).unwrap();

        clear(&conn, &tmp.path().join("no-such-cache")).unwrap();

        assert_eq!(thumbnail_row(&conn, id, "small"), None);
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
