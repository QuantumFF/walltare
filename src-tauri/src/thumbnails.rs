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

    Ok(Plan {
        wallpaper_id,
        size,
        source: PathBuf::from(source),
        cached,
    })
}

/// Phase 2 — no database access. Serves the cache file when it is still fresh,
/// otherwise decodes, downscales and re-encodes the source.
pub fn fulfill(plan: &Plan, cache_dir: &Path) -> Result<Resolved, AppError> {
    let source_mtime = source_mtime(&plan.source)?;
    let cache_path = cache_dir.join(format!("{}_{}.jpg", plan.wallpaper_id, plan.size.label()));

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

    let img = ImageReader::open(&plan.source)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| AppError::Image(e.to_string()))?;
    let img = downscale_if_wider(img, plan.size);
    let (width, height) = (img.width(), img.height());
    let bytes = encode_jpeg(flatten_to_rgb(img))?;

    std::fs::create_dir_all(cache_dir)?;
    let tmp = cache_path.with_extension("jpg.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &cache_path)?;

    Ok(Resolved {
        thumbnail: Thumbnail {
            bytes,
            width,
            height,
        },
        record_mtime: Some(source_mtime),
    })
}

/// Phase 3 — records a freshly generated thumbnail. A no-op for a cache hit.
pub fn record(conn: &Connection, plan: &Plan, resolved: &Resolved) -> Result<(), AppError> {
    let Some(source_mtime) = resolved.record_mtime else {
        return Ok(());
    };
    conn.execute(
        "INSERT INTO thumbnails (wallpaper_id, size, width, height, source_mtime)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(wallpaper_id, size) DO UPDATE SET
            width = excluded.width,
            height = excluded.height,
            source_mtime = excluded.source_mtime",
        rusqlite::params![
            plan.wallpaper_id,
            plan.size.label(),
            resolved.thumbnail.width,
            resolved.thumbnail.height,
            source_mtime
        ],
    )?;
    Ok(())
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

pub fn purge(conn: &Connection, cache_dir: &Path, wallpaper_id: i64) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM thumbnails WHERE wallpaper_id = ?1",
        [wallpaper_id],
    )?;
    for size in [Size::Small, Size::Medium, Size::Full] {
        let cache_path = cache_dir.join(format!("{wallpaper_id}_{}.jpg", size.label()));
        match std::fs::remove_file(&cache_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

fn downscale_if_wider(mut img: DynamicImage, size: Size) -> DynamicImage {
    if let Some(max_width) = size.max_width() {
        let (w, h) = (img.width(), img.height());
        if w > max_width {
            let new_h = ((h as f64 * max_width as f64 / w as f64).round() as u32).max(1);
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

fn encode_jpeg(img: RgbImage) -> Result<Vec<u8>, AppError> {
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

    #[test]
    fn invalid_size_strings_do_not_parse() {
        assert_eq!(Size::parse("small"), Some(Size::Small));
        assert_eq!(Size::parse("medium"), Some(Size::Medium));
        assert_eq!(Size::parse("full"), Some(Size::Full));
        assert_eq!(Size::parse("huge"), None);
        assert_eq!(Size::parse(""), None);
    }
}
