//! Everything the app knows about answering a `wallpaper://` request.
//!
//! One way in: [`serve`] takes the wallpaper id and the [`Size`] the protocol
//! closure read off the URL, and answers the webview with a response. The
//! worker pool, ADR 0004's three phases, the success headers and the mapping
//! from an [`AppError`] to a status are all in here, and none of them is
//! reachable from anywhere else.
//!
//! Before this module they were four things in three places — a Tauri closure,
//! an `mpsc` channel, and three free functions in `lib.rs` — and none of it was
//! reachable from a test, because the only way in was a protocol handler Tauri
//! owns. What that cost is written down in
//! [#224](https://github.com/QuantumFF/walltare/issues/224): the queue is a
//! FIFO, so a card that has already left the window is served ahead of one that
//! is on screen; nothing deduplicates two requests for the same wallpaper and
//! size, so both decode and both write the same file; and nothing keeps bytes
//! in memory, so a warm hit still costs a channel hop, two lock acquisitions, a
//! `stat`, an `exists` and a file read.
//!
//! This module is where those three answers land
//! ([#228](https://github.com/QuantumFF/walltare/issues/228)). It holds none of
//! them yet.

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::error::AppError;
use crate::thumbnails::{self, Plan, Resolved, Size};
use crate::{CacheDir, Db};

/// Concurrent thumbnail generations. The review grid requests fifty images at
/// once and a 4K decode holds tens of megabytes, so an unbounded thread per
/// request would spike memory and thrash the CPU.
const IMAGE_WORKER_FLOOR: usize = 2;
const IMAGE_WORKER_CEILING: usize = 8;

/// Five minutes is measured against the only thing that invalidates a
/// thumbnail: the source file's mtime changing when someone edits a wallpaper
/// in place. That is rare enough that being five minutes stale about it costs
/// less than a versioning scheme (ADR 0016).
///
/// Not `immutable`: the URL is keyed on id and size only, so nothing in it
/// would change once the source file did.
const IMAGE_CACHE_CONTROL: &str = "max-age=300";

/// Thirty seconds, and the reason is the same shape as the success path's five
/// minutes: how long the answer stays true.
///
/// A failure means the request found no wallpaper, no file, or a file that will
/// not decode, and a card whose file has gone reads as gone by way of exactly
/// this response (ADR 0032). With no header at all, every remount of every
/// broken card re-ran the whole round trip — and under ADR 0016's
/// virtualisation a wheel pass remounts them continuously, so on a library that
/// has drifted from disk the cards that cannot paint cost more than the ones
/// that can.
///
/// It is far shorter than five minutes because what invalidates it is a curator
/// act rather than an edit in place: plugging the drive back in, or putting the
/// file back. Half a minute is long enough to cover a scroll pass and a tab
/// switch, and short enough that a curator who fixes their library sees the
/// cards paint rather than wondering whether the app noticed.
const ERROR_CACHE_CONTROL: &str = "max-age=30";

/// Starts the threads that answer `wallpaper://` requests.
///
/// Called once from `setup`, so the pool is up before the first card asks. The
/// pool itself is private to this module: nothing outside it names the channel,
/// the threads or the job type, which is what makes an admission policy —
/// ordering, deduplication, a byte cache — a change to this file and to nothing
/// else (#228).
pub fn start_workers(app: &AppHandle) {
    app.manage(ImageWorkers::new(worker_count()));
}

/// Answers one `wallpaper://` request: a wallpaper id and a size in, a response
/// out.
///
/// The parameter is the parse rather than the pair, because a URL that named no
/// wallpaper still has to be answered, and the status it is answered with is
/// this module's business. That keeps the protocol closure to reading the URL
/// and calling this, and keeps every response the webview ever sees — the
/// bytes, the statuses and both `Cache-Control`s — inside one file.
///
/// The work happens on a pool thread, never on the thread Tauri calls the
/// protocol handler on: that is the UI thread, and a cache miss there freezes
/// the window for the length of a decode (ADR 0004).
pub fn serve(
    app: &AppHandle,
    asked_for: Result<(i64, Size), AppError>,
    responder: UriSchemeResponder,
) {
    let serving = app.clone();
    let job = move || {
        let response = match asked_for {
            Ok((wallpaper_id, size)) => {
                let db = serving.state::<Db>();
                let cache_dir = serving.state::<CacheDir>();
                answer(&db, &cache_dir.0, wallpaper_id, size)
            }
            Err(e) => error_response(&e),
        };
        responder.respond(response);
    };
    if !app.state::<ImageWorkers>().submit(job) {
        eprintln!("image worker pool is gone; dropping a wallpaper:// request");
    }
}

/// One wallpaper at one size, as the response the webview gets.
///
/// The function the tests drive. It takes the connection and the cache
/// directory rather than an `AppHandle` so that driving it needs neither a
/// running Tauri app nor a protocol handler — an in-memory database and a temp
/// directory are the whole of the setup.
fn answer(db: &Db, cache_dir: &Path, wallpaper_id: i64, size: Size) -> Response<Vec<u8>> {
    match phases(db, cache_dir, wallpaper_id, size, thumbnails::fulfill) {
        Ok(bytes) => image_response(bytes),
        Err(e) => error_response(&e),
    }
}

/// ADR 0004's three phases, in the order `pregen::generate_one` mirrors: the
/// plan under the connection, the image work with it released, the record under
/// it again.
///
/// Phase two is a parameter, and production always passes
/// [`thumbnails::fulfill`]. It is what makes the split assertable rather than
/// merely written down: the connection being free across the decode is the half
/// of ADR 0039's rule no type can hold, and a `plan` whose guard survived into
/// a temporary would compile, return the right bytes, and quietly serialize
/// every request in the app behind one decode.
fn phases<F>(
    db: &Db,
    cache_dir: &Path,
    wallpaper_id: i64,
    size: Size,
    fulfill: F,
) -> Result<Vec<u8>, AppError>
where
    F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
{
    let plan = db.read(|conn| thumbnails::plan(conn, wallpaper_id, size))?;
    let resolved = fulfill(&plan, cache_dir)?;
    db.write(|conn| thumbnails::record(conn, &plan, &resolved))?;
    Ok(resolved.thumbnail.bytes)
}

fn image_response(body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(tauri::http::header::CONTENT_TYPE, "image/jpeg")
        .header(tauri::http::header::CACHE_CONTROL, IMAGE_CACHE_CONTROL)
        .body(body)
        .unwrap()
}

fn error_response(e: &AppError) -> Response<Vec<u8>> {
    let status = match e {
        AppError::InvalidPath(_) | AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
        // `FileMissing` is a 404 for the same reason `NotFound` is: the thing
        // asked for is not there. The protocol handler cannot raise it — only a
        // Restore checks a source file before moving it — but a variant with no
        // arm here would fall through to a 500 the moment one does.
        AppError::NotFound(_) | AppError::FileMissing(_) => StatusCode::NOT_FOUND,
        AppError::InvalidTransition(_) => StatusCode::CONFLICT,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, "application/json")
        .header(tauri::http::header::CACHE_CONTROL, ERROR_CACHE_CONTROL)
        .body(serde_json::to_vec(e).unwrap_or_default())
        .unwrap()
}

/// A fixed set of threads for `wallpaper://` requests.
struct ImageWorkers(std::sync::mpsc::Sender<Box<dyn FnOnce() + Send>>);

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

fn worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(IMAGE_WORKER_FLOOR)
        .clamp(IMAGE_WORKER_FLOOR, IMAGE_WORKER_CEILING)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use image::{DynamicImage, Rgba, RgbaImage};
    use std::path::PathBuf;

    /// A library holding one 800x600 wallpaper, a cache directory beside it, and
    /// a `Db` over an in-memory database. No Tauri app and no protocol handler:
    /// the module's own interface is the whole seam.
    struct Library {
        db: Db,
        dir: tempfile::TempDir,
        wallpaper_id: i64,
        source: PathBuf,
    }

    fn library() -> Library {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        let dir = tempfile::tempdir().unwrap();

        let source = dir.path().join("a.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 600, Rgba([10, 20, 30, 255])))
            .save_with_format(&source, image::ImageFormat::Png)
            .unwrap();
        conn.execute(
            "INSERT INTO wallpapers (filename, path) VALUES (?1, ?2)",
            rusqlite::params!["a.png", source.to_str().unwrap()],
        )
        .unwrap();
        let wallpaper_id = conn.last_insert_rowid();

        Library {
            db: Db::new(conn),
            dir,
            wallpaper_id,
            source,
        }
    }

    impl Library {
        fn cache_dir(&self) -> &Path {
            self.dir.path()
        }

        fn cache_file(&self, size: &str) -> PathBuf {
            self.dir
                .path()
                .join(format!("{}_{size}.jpg", self.wallpaper_id))
        }

        fn serve(&self, size: Size) -> Response<Vec<u8>> {
            answer(&self.db, self.cache_dir(), self.wallpaper_id, size)
        }

        fn recorded_mtime(&self, size: &str) -> Option<i64> {
            self.db.read(|conn| {
                conn.query_row(
                    "SELECT source_mtime FROM thumbnails WHERE wallpaper_id = ?1 AND size = ?2",
                    rusqlite::params![self.wallpaper_id, size],
                    |row| row.get(0),
                )
                .ok()
            })
        }
    }

    fn header(response: &Response<Vec<u8>>, name: tauri::http::HeaderName) -> String {
        response
            .headers()
            .get(name)
            .expect("the header is set")
            .to_str()
            .expect("the header is ASCII")
            .to_owned()
    }

    #[test]
    fn a_first_request_generates_the_thumbnail_and_records_it() {
        let library = library();
        let expected_mtime = thumbnails::source_mtime(&library.source).unwrap();

        let response = library.serve(Size::Small);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header(&response, tauri::http::header::CONTENT_TYPE),
            "image/jpeg"
        );
        let decoded = image::load_from_memory(response.body()).expect("the body is a JPEG");
        assert_eq!((decoded.width(), decoded.height()), (400, 300));
        assert!(library.cache_file("small").exists());
        assert_eq!(library.recorded_mtime("small"), Some(expected_mtime));
    }

    #[test]
    fn a_cache_hit_reads_the_file_rather_than_decoding_the_source_again() {
        // The cache file is tampered with between the two requests, so what
        // comes back says which path ran: the bytes on disk mean the recorded
        // row and the source mtime agreed and nothing was decoded, and a fresh
        // JPEG would mean the hit was missed.
        let library = library();
        library.serve(Size::Small);

        std::fs::write(library.cache_file("small"), b"the cache said so").unwrap();
        let response = library.serve(Size::Small);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"the cache said so");
    }

    #[test]
    fn a_thumbnail_recorded_against_an_older_source_is_regenerated() {
        // A wallpaper edited in place: the row and the file are both there, and
        // the mtime they were recorded against is not the source's any more.
        // The tampered cache file is what makes the regenerate visible.
        let library = library();
        library.serve(Size::Small);
        std::fs::write(library.cache_file("small"), b"stale bytes").unwrap();
        library.db.write(|conn| {
            conn.execute(
                "UPDATE thumbnails SET source_mtime = 1 WHERE wallpaper_id = ?1",
                [library.wallpaper_id],
            )
            .unwrap();
        });

        let response = library.serve(Size::Small);

        assert_eq!(response.status(), StatusCode::OK);
        let decoded = image::load_from_memory(response.body()).expect("the body is a JPEG");
        assert_eq!((decoded.width(), decoded.height()), (400, 300));
        assert_eq!(
            library.recorded_mtime("small"),
            Some(thumbnails::source_mtime(&library.source).unwrap()),
            "the regenerated thumbnail was recorded against the source it was made from"
        );
    }

    #[test]
    fn a_wallpaper_that_does_not_exist_is_a_not_found_the_card_can_read() {
        let library = library();

        let response = answer(&library.db, library.cache_dir(), 9999, Size::Small);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            header(&response, tauri::http::header::CONTENT_TYPE),
            "application/json"
        );
        // The shape `client.ts` reads an `AppError` in, so a 404 is a
        // `not_found` rather than an opaque body.
        let body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(body["kind"], "not_found");
    }

    #[test]
    fn a_wallpaper_whose_file_is_gone_is_answered_rather_than_hung() {
        // ADR 0032: a missing file reads as gone by way of the request failing,
        // and the card's whole detection is that failure.
        let library = library();
        std::fs::remove_file(&library.source).unwrap();

        let response = library.serve(Size::Small);

        assert!(response.status().is_client_error() || response.status().is_server_error());
        assert!(!response.body().is_empty());
    }

    #[test]
    fn the_connection_is_free_while_the_image_work_happens() {
        // ADR 0004's split, pinned. Phase two runs here with the connection
        // released, and `Db::is_free` is a `try_lock` on the thread that would
        // be holding it, so a phase one whose guard leaked into a temporary
        // fails this and nothing else — it would still serve the right bytes.
        let library = library();

        let bytes = phases(
            &library.db,
            library.cache_dir(),
            library.wallpaper_id,
            Size::Small,
            |plan, cache_dir| {
                assert!(
                    library.db.is_free(),
                    "the connection is held across the decode"
                );
                thumbnails::fulfill(plan, cache_dir)
            },
        )
        .unwrap();

        assert!(image::load_from_memory(&bytes).is_ok());
    }

    #[test]
    fn a_served_image_stays_cached_for_five_minutes() {
        // A remounted `<img>` for a wallpaper the user already scrolled past
        // must not cost another mpsc hop, mutex lock and cache-file read.
        // Lowering this value puts those back, so it is pinned.
        let response = image_response(vec![0xff, 0xd8]);
        assert_eq!(
            header(&response, tauri::http::header::CACHE_CONTROL),
            "max-age=300"
        );
    }

    #[test]
    fn a_failed_request_is_cached_too_so_a_gone_card_costs_one_round_trip() {
        // The half that was missing: a card whose file has gone fails on every
        // remount, and under ADR 0016's virtualisation a wheel pass remounts it
        // continuously. Without a header here, a library that has drifted from
        // disk is slower than a live one.
        for e in [
            AppError::NotFound("no wallpaper with id 1".to_string()),
            AppError::BadRequest("unexpected path".to_string()),
            AppError::Io("no such file".to_string()),
        ] {
            let response = error_response(&e);
            assert_eq!(
                header(&response, tauri::http::header::CACHE_CONTROL),
                "max-age=30",
                "{e} carried no cache header"
            );
        }
    }

    #[test]
    fn every_error_lands_on_the_status_that_says_what_went_wrong() {
        for (e, expected) in [
            (
                AppError::BadRequest("bad".to_string()),
                StatusCode::BAD_REQUEST,
            ),
            (
                AppError::InvalidPath("bad".to_string()),
                StatusCode::BAD_REQUEST,
            ),
            (
                AppError::NotFound("gone".to_string()),
                StatusCode::NOT_FOUND,
            ),
            (
                AppError::FileMissing("gone".to_string()),
                StatusCode::NOT_FOUND,
            ),
            (
                AppError::InvalidTransition("no".to_string()),
                StatusCode::CONFLICT,
            ),
            (
                AppError::Image("undecodable".to_string()),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ] {
            assert_eq!(error_response(&e).status(), expected, "{e}");
        }
    }

    #[test]
    fn the_pool_is_bounded_however_many_cores_the_machine_has() {
        // Fifty concurrent 4K decodes is several gigabytes of decoded pixels,
        // which is what the ceiling is for; the floor keeps a single-core
        // machine from serializing every request behind one thread (ADR 0004).
        let count = worker_count();
        assert!(
            (IMAGE_WORKER_FLOOR..=IMAGE_WORKER_CEILING).contains(&count),
            "{count} workers"
        );
    }
}
