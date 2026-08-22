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

pub fn resolve(
    conn: &Connection,
    cache_dir: &Path,
    wallpaper_id: i64,
    size: Size,
) -> Result<Thumbnail, AppError> {
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
    let source = PathBuf::from(source);
    let source_mtime = source_mtime(Path::new(&source))?;
    let cache_path = cache_dir.join(format!("{wallpaper_id}_{}.jpg", size.label()));

    if let Some(cached) = cached_thumbnail(conn, &cache_path, wallpaper_id, size, source_mtime)? {
        return Ok(cached);
    }

    let img = ImageReader::open(&source)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| AppError::Image(e.to_string()))?;
    let img = downscale_if_wider(img, size);
    let (width, height) = (img.width(), img.height());
    let bytes = encode_jpeg(flatten_to_rgb(img))?;

    std::fs::create_dir_all(cache_dir)?;
    let tmp = cache_path.with_extension("jpg.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &cache_path)?;

    if size != Size::Full {
        conn.execute(
            "INSERT INTO thumbnails (wallpaper_id, size, width, height, source_mtime)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(wallpaper_id, size) DO UPDATE SET
                width = excluded.width,
                height = excluded.height,
                source_mtime = excluded.source_mtime",
            rusqlite::params![wallpaper_id, size.label(), width, height, source_mtime],
        )?;
    }

    Ok(Thumbnail {
        bytes,
        width,
        height,
    })
}

fn cached_thumbnail(
    conn: &Connection,
    cache_path: &Path,
    wallpaper_id: i64,
    size: Size,
    source_mtime: i64,
) -> Result<Option<Thumbnail>, AppError> {
    if size == Size::Full {
        let Ok(md) = std::fs::metadata(cache_path) else {
            return Ok(None);
        };
        let cache_mtime = modified_secs(&md)?;
        if cache_mtime < source_mtime {
            return Ok(None);
        }
        let (width, height) = ImageReader::open(cache_path)?
            .with_guessed_format()?
            .into_dimensions()
            .map_err(|e| AppError::Image(e.to_string()))?;
        return Ok(Some(Thumbnail {
            bytes: std::fs::read(cache_path)?,
            width,
            height,
        }));
    }

    let row = match conn.query_row(
        "SELECT width, height, source_mtime FROM thumbnails
         WHERE wallpaper_id = ?1 AND size = ?2",
        rusqlite::params![wallpaper_id, size.label()],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let (width, height, mtime) = row;
    if mtime != source_mtime || !cache_path.exists() {
        return Ok(None);
    }
    Ok(Some(Thumbnail {
        bytes: std::fs::read(cache_path)?,
        width: width as u32,
        height: height as u32,
    }))
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
                let blend =
                    |c: u8| ((c as u32 * a as u32 + 255 * (255 - a as u32)) / 255) as u8;
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
    modified_secs(&md)
}

fn modified_secs(md: &std::fs::Metadata) -> Result<i64, AppError> {
    Ok(md
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64)
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
        img.save_with_format(&path, image::ImageFormat::Png).unwrap();
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
        let id = seed_wallpaper(&conn, tmp.path(), "a.png", &solid(800, 600, [10, 20, 30, 255]));
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
    fn full_size_never_downscales_and_bypasses_table() {
        let (conn, tmp) = setup();
        let id = seed_wallpaper(&conn, tmp.path(), "f.png", &solid(800, 600, [4, 5, 6, 255]));

        let thumb = resolve(&conn, tmp.path(), id, Size::Full).unwrap();

        assert_eq!((thumb.width, thumb.height), (800, 600));
        assert!(tmp.path().join(format!("{id}_full.jpg")).exists());
        assert_eq!(thumbnail_row(&conn, id, "full"), None);
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
        let near = |a: [u8; 3], b: [u8; 3]| {
            a.iter()
                .zip(b)
                .all(|(x, y)| x.abs_diff(y) <= 4)
        };
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
        let id = seed_wallpaper(&conn, tmp.path(), "gone.png", &solid(10, 10, [0, 0, 0, 255]));
        std::fs::remove_file(tmp.path().join("gone.png")).unwrap();

        let err = resolve(&conn, tmp.path(), id, Size::Small).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
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
