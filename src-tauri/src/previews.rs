//! Discover's card previews: a Result's full file, fetched by the backend and
//! downscaled to a `medium`, answered over `preview://` (ADR 0062).
//!
//! A card at three columns and fewer is drawn wider than Wallhaven's 432-pixel
//! `lg`, and Wallhaven serves nothing between that and the full file. So the
//! backend fetches the full file, makes the 1920-pixel JPEG a Library card's
//! `medium` is, and keeps it on disk. The webview decodes only that, and never a
//! 4K or 8K file per card, which is what ran WebKitGTK out of graphics memory
//! under ADR 0055's second amendment.
//!
//! One way in: [`serve`] takes the URL the protocol closure was handed. The
//! Result is named by its Wallhaven id alone, and its full file's URL is the
//! one [`Wallhaven`] served, so the webview never chooses what the backend
//! fetches (ADR 0054). An id no search served is a 404, unless its preview is
//! already on disk.
//!
//! What it shares with the rest of the backend, and what it keeps to itself:
//!
//! - The image host's client and its size-checked transfer are the download
//!   queue's (`download::image_host_agent`, `download::fetch_file`).
//! - The decode is a library source's, so ADR 0049's cap and gate hold
//!   (`thumbnails::medium_jpeg`).
//! - The flight table is `serving`'s, keyed on the id, so a card and a quick
//!   remount of it fetch once.
//! - The pool is its own [`ImageWorkers`]: a fetch blocks on the network for
//!   seconds, and on `serving`'s pool it would hold up every library thumbnail
//!   behind it. Newest first, as there, because the newest request is the card
//!   most likely still on screen (ADR 0040).
//! - The disk cache is its own directory, capped, oldest-used first out.
//!   Unlike the thumbnail cache it is not bounded by anything the curator owns:
//!   every page of every search adds to it.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::http::{Response, Uri};
use tauri::{AppHandle, Manager, UriSchemeResponder};

use crate::download::{self, Timeouts};
use crate::error::AppError;
use crate::serving::{self, Answer, ImageWorkers, InFlight, Joined};
use crate::thumbnails;
use crate::wallhaven::{Served, Wallhaven};

/// Fetches at once. Each spends most of its time waiting on the image host and
/// then about a tenth of a second decoding, so four keep a page's cards coming
/// without four 8K decodes' worth of memory being likely at once.
const PREVIEW_WORKERS: usize = 4;

/// How much disk the previews may hold: 512 MiB, about two thousand 1920-pixel
/// JPEGs, or eighty pages of results.
const CACHE_CAP_BYTES: u64 = 512 * 1024 * 1024;

/// What an eviction trims the cache down to, so one does not run on every
/// write once the cache is full.
const CACHE_TRIM_TO: u64 = CACHE_CAP_BYTES / 4 * 3;

/// The previews, the pool that makes them, and the client they come through.
///
/// Managed state, so there is one of each for the app.
pub struct Previews {
    dir: PathBuf,
    cap: u64,
    trim_to: u64,
    agent: ureq::Agent,
    workers: ImageWorkers,
    in_flight: InFlight<String>,
    /// The bytes of previews on disk, counted on the first write and kept up
    /// from there. Also the lock two writers take turns on to evict.
    held: Mutex<Option<u64>>,
}

impl Previews {
    /// Previews kept in `dir`, which need not exist yet: the first one written
    /// creates it.
    pub fn new(dir: PathBuf) -> Self {
        Self::with(
            dir,
            CACHE_CAP_BYTES,
            CACHE_TRIM_TO,
            download::DOWNLOAD_TIMEOUTS,
        )
    }

    fn with(dir: PathBuf, cap: u64, trim_to: u64, timeouts: Timeouts) -> Self {
        Self {
            dir,
            cap,
            trim_to,
            agent: download::image_host_agent(timeouts),
            workers: ImageWorkers::new(PREVIEW_WORKERS),
            in_flight: InFlight::default(),
            held: Mutex::new(None),
        }
    }

    /// One Result's preview: off the disk, or fetched, made and kept.
    ///
    /// `served` is how the full file's URL is found, which is
    /// [`Wallhaven::served`] outside the tests.
    fn answer(&self, id: &str, served: impl FnOnce(&str) -> Option<Served>) -> Arc<Answer> {
        if let Some(kept) = self.kept(id) {
            return Arc::new(kept);
        }
        match self.in_flight.join(id.to_string()) {
            // Asked again as the leader: a flight that settled between the
            // miss above and the join has already written it.
            Joined::Leading(leader) => {
                let answer = self.kept(id).unwrap_or_else(|| self.make(id, served));
                leader.publish(answer)
            }
            Joined::Waiting(answer) => answer,
        }
    }

    /// The preview on disk, touched so the eviction counts it as used, or
    /// nothing when there is none.
    fn kept(&self, id: &str) -> Option<Answer> {
        let path = self.path(id);
        match std::fs::read(&path) {
            Ok(bytes) => {
                // A preview that cannot be touched is still a preview, and is
                // only evicted sooner than it should be.
                let _ = File::options()
                    .write(true)
                    .open(&path)
                    .and_then(|file| file.set_modified(SystemTime::now()));
                Some(Ok(Arc::new(bytes)))
            }
            // Never made, or evicted since: either way it is made again.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => Some(Err(e.into())),
        }
    }

    fn make(&self, id: &str, served: impl FnOnce(&str) -> Option<Served>) -> Answer {
        let served = served(id).ok_or_else(|| {
            AppError::NotFound(format!("no search this session served Result {id}"))
        })?;
        let mut file = Vec::new();
        download::fetch_file(&self.agent, &served, &mut file)?;
        let preview = thumbnails::medium_jpeg(&file)?;
        // A preview that cannot be kept is still this request's answer. It is
        // fetched again next time, which is what having no cache costs.
        let _ = self.keep(id, &preview);
        Ok(Arc::new(preview))
    }

    /// Writes one preview through a temporary name and a rename, so a reader
    /// sees the whole JPEG or none, and evicts once the cache is past its cap.
    fn keep(&self, id: &str, bytes: &[u8]) -> Result<(), AppError> {
        std::fs::create_dir_all(&self.dir)?;
        let path = self.path(id);
        let tmp = path.with_extension("jpg.tmp");
        // What this write replaces: a preview that was there but would not
        // read, so the request came here to make it again.
        let replaced = std::fs::metadata(&path).map_or(0, |m| m.len());
        if let Err(e) = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, &path)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }

        let mut held = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        // Taken rather than read, so a count or an eviction that fails below
        // leaves nothing, and the next write counts the directory again
        // rather than trusting a total that missed something.
        let total = match held.take() {
            Some(total) => (total + bytes.len() as u64).saturating_sub(replaced),
            // Counted after the write, so it already includes this one.
            None => kept_previews(&self.dir)?.iter().map(|p| p.bytes).sum(),
        };
        *held = Some(if total > self.cap {
            evict(&self.dir, self.trim_to)?
        } else {
            total
        });
        Ok(())
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.jpg"))
    }
}

/// One preview file, for the eviction.
struct KeptPreview {
    path: PathBuf,
    bytes: u64,
    used: SystemTime,
}

fn kept_previews(dir: &Path) -> Result<Vec<KeptPreview>, AppError> {
    let mut previews = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        // Previews only: a `.jpg.tmp` is a write under way.
        if path.extension().is_none_or(|e| e != "jpg") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            // Evicted by nobody else, but a stat racing a rename can miss.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        if metadata.is_file() {
            previews.push(KeptPreview {
                path,
                bytes: metadata.len(),
                used: metadata.modified()?,
            });
        }
    }
    Ok(previews)
}

/// How old a `.jpg.tmp` has to be before an eviction takes it for one a crash
/// left behind rather than a write under way. A write takes milliseconds.
const STALE_WRITE: Duration = Duration::from_secs(60);

/// Deletes the least recently used previews until the cache holds at most
/// `trim_to` bytes, and answers with what it holds then. Writes a crash left
/// half done go too: nothing else would ever count or delete them.
fn evict(dir: &Path, trim_to: u64) -> Result<u64, AppError> {
    sweep_stale_writes(dir);
    let mut previews = kept_previews(dir)?;
    let mut total: u64 = previews.iter().map(|p| p.bytes).sum();
    previews.sort_by_key(|p| p.used);
    for preview in previews {
        if total <= trim_to {
            break;
        }
        match std::fs::remove_file(&preview.path) {
            Ok(()) => total -= preview.bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => total -= preview.bytes,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(total)
}

fn sweep_stale_writes(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.to_string_lossy().ends_with(".jpg.tmp") {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > STALE_WRITE);
        if stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Parses `preview://localhost/result/{id}`.
///
/// The id is checked before anything else sees it, because it names a file in
/// the cache directory: Wallhaven's ids are a handful of lowercase letters and
/// digits, and anything else is a bad request. `previewUrl` in
/// `src/lib/client.ts` is the only place these URLs are built.
fn parse_preview_request(uri: &Uri) -> Result<String, AppError> {
    let segments: Vec<&str> = uri.path().trim_start_matches('/').split('/').collect();
    let ["result", id] = segments.as_slice() else {
        return Err(AppError::BadRequest(format!(
            "unexpected path {:?}",
            uri.path()
        )));
    };
    let well_formed = (1..=16).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    if !well_formed {
        return Err(AppError::BadRequest(format!("malformed Result id {id:?}")));
    }
    Ok((*id).to_string())
}

fn respond(answer: &Answer) -> Response<Vec<u8>> {
    match answer {
        Ok(bytes) => serving::image_response(bytes.to_vec()),
        Err(e) => serving::error_response(e),
    }
}

/// Answers one `preview://` request, on the previews' own pool and never on the
/// thread Tauri calls the handler on, which is the UI thread.
pub fn serve(app: &AppHandle, uri: &Uri, responder: UriSchemeResponder) {
    let asked_for = parse_preview_request(uri);
    let handle = app.clone();
    app.state::<Previews>().workers.submit(move || {
        let response = match asked_for {
            Ok(id) => {
                let wallhaven = handle.state::<Wallhaven>();
                let answer = handle
                    .state::<Previews>()
                    .answer(&id, |id| wallhaven.served(id));
                respond(&answer)
            }
            Err(e) => serving::error_response(&e),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{self, Canned};
    use image::{DynamicImage, ImageFormat, RgbImage};
    use std::io::Cursor;
    use tauri::http::StatusCode;

    fn parse(url: &str) -> Result<String, AppError> {
        parse_preview_request(&url.parse::<Uri>().unwrap())
    }

    /// A PNG of `width` by `height`, as the image host would send it.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::new(width, height))
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn served_at(files: &testing::Stub, file: &[u8]) -> Served {
        Served {
            path: format!("{}/full/ab/wallhaven-abc123.png", files.base()),
            file_size: file.len() as u64,
            file_type: "image/png".to_string(),
        }
    }

    fn previews(dir: &Path) -> Previews {
        Previews::with(
            dir.to_path_buf(),
            CACHE_CAP_BYTES,
            CACHE_TRIM_TO,
            download::DOWNLOAD_TIMEOUTS,
        )
    }

    fn dimensions(jpeg: &[u8]) -> (u32, u32) {
        image::load_from_memory(jpeg)
            .unwrap()
            .to_rgb8()
            .dimensions()
    }

    #[test]
    fn the_url_the_frontend_builds_is_the_url_this_handler_accepts() {
        // `previewUrl` in src/lib/client.ts must keep producing this shape.
        assert_eq!(
            parse("preview://localhost/result/abc123").unwrap(),
            "abc123"
        );
        // Windows rewrites custom schemes to `http://<scheme>.localhost/...`.
        assert_eq!(
            parse("http://preview.localhost/result/9dw3qk").unwrap(),
            "9dw3qk"
        );
    }

    #[test]
    fn an_id_that_could_name_another_file_is_a_bad_request() {
        for url in [
            "preview://localhost/result/..",
            "preview://localhost/result/ABC123",
            "preview://localhost/result/abc%2F123",
            "preview://localhost/result/abc.jpg",
            "preview://localhost/result/",
            "preview://localhost/result/abcdefghijklmnopq",
            "preview://localhost/result/abc123/extra",
            "preview://localhost/image/abc123",
        ] {
            let err = parse(url).unwrap_err();
            assert!(matches!(err, AppError::BadRequest(_)), "{url} gave {err:?}");
        }
    }

    #[test]
    fn a_preview_is_the_full_file_at_a_mediums_width_and_kept() {
        let file = png(3840, 2160);
        let files = testing::stub(vec![Canned::file(&file)]);
        let dir = tempfile::tempdir().unwrap();
        let previews = previews(dir.path());

        let first = previews.answer("abc123", |_| Some(served_at(&files, &file)));
        let bytes = first.as_ref().as_ref().unwrap();
        assert_eq!(dimensions(bytes), (1920, 1080));

        // The second answer comes off the disk: the stub has no answer left,
        // and the URL lookup is never asked.
        let second = previews.answer("abc123", |_| panic!("looked up again"));
        assert_eq!(second.as_ref().as_ref().unwrap(), bytes);
        assert_eq!(files.requests().len(), 1);
        assert!(dir.path().join("abc123.jpg").is_file());
    }

    #[test]
    fn a_file_narrower_than_a_medium_is_not_upscaled() {
        let file = png(1280, 720);
        let files = testing::stub(vec![Canned::file(&file)]);
        let dir = tempfile::tempdir().unwrap();

        let answer = previews(dir.path()).answer("abc123", |_| Some(served_at(&files, &file)));
        assert_eq!(dimensions(answer.as_ref().as_ref().unwrap()), (1280, 720));
    }

    #[test]
    fn an_id_no_search_served_is_not_found_and_fetches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let answer = previews(dir.path()).answer("abc123", |_| None);
        let err = answer.as_ref().as_ref().unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert_eq!(respond(&answer).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_failed_fetch_answers_with_the_error_and_keeps_nothing() {
        let file = png(64, 36);
        // Announced at its size, sent short.
        let files = testing::stub(vec![Canned::file(&file).cut_after(10)]);
        let dir = tempfile::tempdir().unwrap();

        let answer = previews(dir.path()).answer("abc123", |_| Some(served_at(&files, &file)));
        let err = answer.as_ref().as_ref().unwrap_err();
        assert!(matches!(err, AppError::Network(_)), "{err:?}");
        assert!(!dir.path().join("abc123.jpg").exists());
    }

    #[test]
    fn a_file_that_will_not_decode_is_an_image_error() {
        let file = b"not an image at all".to_vec();
        let files = testing::stub(vec![Canned::file(&file)]);
        let dir = tempfile::tempdir().unwrap();

        let answer = previews(dir.path()).answer("abc123", |_| Some(served_at(&files, &file)));
        let err = answer.as_ref().as_ref().unwrap_err();
        assert!(matches!(err, AppError::Image(_)), "{err:?}");
    }

    #[test]
    fn two_requests_at_once_fetch_once() {
        let file = png(640, 360);
        // Slow enough that the second request arrives while the first waits.
        let files = testing::stub(vec![Canned::file(&file).after(Duration::from_millis(300))]);
        let dir = tempfile::tempdir().unwrap();
        let previews = previews(dir.path());
        let served = served_at(&files, &file);

        std::thread::scope(|s| {
            let leader = s.spawn(|| previews.answer("abc123", |_| Some(served.clone())));
            // Waits for the leader's flight to exist before following it.
            while files.requests().is_empty() {
                std::thread::sleep(Duration::from_millis(5));
            }
            let follower = s.spawn(|| previews.answer("abc123", |_| panic!("fetched twice")));
            assert!(leader.join().unwrap().is_ok());
            assert!(follower.join().unwrap().is_ok());
        });
        assert_eq!(files.requests().len(), 1);
    }

    #[test]
    fn past_the_cap_the_least_recently_used_previews_go_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path()).unwrap();
        // Three previews of 100 bytes, used oldest to newest a, b, c.
        let now = SystemTime::now();
        for (age, id) in [(30, "aaaaaa"), (20, "bbbbbb"), (10, "cccccc")] {
            let path = dir.path().join(format!("{id}.jpg"));
            std::fs::write(&path, [0u8; 100]).unwrap();
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(now - Duration::from_secs(age))
                .unwrap();
        }
        // A write in progress is never counted or evicted, and one a crash
        // left behind long ago is swept.
        std::fs::write(dir.path().join("dddddd.jpg.tmp"), [0u8; 500]).unwrap();
        let abandoned = dir.path().join("ffffff.jpg.tmp");
        std::fs::write(&abandoned, [0u8; 500]).unwrap();
        File::options()
            .write(true)
            .open(&abandoned)
            .unwrap()
            .set_modified(now - Duration::from_secs(600))
            .unwrap();
        let previews = Previews::with(
            dir.path().to_path_buf(),
            350,
            250,
            download::DOWNLOAD_TIMEOUTS,
        );

        // Reading `a` makes it the most recently used.
        assert!(previews.kept("aaaaaa").is_some());
        // A fourth takes the cache to 400 bytes, past 350, and the trim to 250
        // drops the two least recently used: `b`, then `c`.
        previews.keep("eeeeee", &[0u8; 100]).unwrap();

        let left = |id: &str| dir.path().join(format!("{id}.jpg")).exists();
        assert!(left("aaaaaa"));
        assert!(!left("bbbbbb"));
        assert!(!left("cccccc"));
        assert!(left("eeeeee"));
        assert!(dir.path().join("dddddd.jpg.tmp").exists());
        assert!(!abandoned.exists());
        assert_eq!(*previews.held.lock().unwrap(), Some(200));
    }

    #[test]
    fn a_preview_written_over_is_counted_once() {
        let dir = tempfile::tempdir().unwrap();
        let previews = previews(dir.path());
        previews.keep("aaaaaa", &[0u8; 100]).unwrap();
        previews.keep("aaaaaa", &[0u8; 100]).unwrap();
        previews.keep("bbbbbb", &[0u8; 50]).unwrap();
        assert_eq!(*previews.held.lock().unwrap(), Some(150));
    }
}
