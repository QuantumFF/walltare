//! Discover's downloads: the queue, and the landing of ADR 0051.
//!
//! A download names Results by id, and the backend resolves each from what
//! [`Wallhaven`] served, so the webview never chooses the URL whose bytes are
//! written into the library (ADR 0054). The ids queue in the order they were
//! asked for, one file at a time on the queue's own thread, and ids asked for
//! while a batch runs join it. There is no cancel.
//!
//! Each file then lands as a scan of one file would find it:
//!
//! 1. The Download folder is resolved again, against the Library root as it
//!    stands now, because the answer the click got has expired (ADR 0035). A
//!    folder that cannot be used fails that file.
//! 2. An untracked `wallhaven-<id>.<ext>` already sitting there is **adopted**:
//!    it is almost always an earlier manual download of the same image, and a
//!    suffixed copy would put that image into voting twice.
//! 3. Otherwise the bytes stream, without the key, into a hidden staging file
//!    with no image extension, which a scan ignores. A transfer that fails or
//!    arrives at any size but the `file_size` Wallhaven announced deletes it,
//!    and nothing reaches the library.
//! 4. The staging file is linked into place without overwriting anything.
//! 5. The row is inserted the way a scan inserts it, `INSERT OR IGNORE` on the
//!    canonical path, so a scan that got there first simply wins. It carries
//!    the Wallhaven id, and its Dimensions come from the file's header.
//!
//! No pre-generation pass is started or cancelled: the `wallpaper://` protocol
//! makes a new wallpaper's thumbnails on demand.

use std::collections::VecDeque;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use ureq::unversioned::transport::{
    Buffers, ConnectionDetails, Connector, DefaultConnector, NextTimeout, Transport,
};

use crate::error::AppError;
use crate::wallhaven::{Served, Wallhaven};
use crate::Db;

/// How long a file may take: 10 s to connect, then 30 s between reads, with
/// no cap on the whole (ADR 0054). A slow link finishes, and a dead one fails
/// that file.
pub const DOWNLOAD_TIMEOUTS: Timeouts = Timeouts {
    connect: Duration::from_secs(10),
    between_reads: Duration::from_secs(30),
};

/// The two limits on a download.
#[derive(Clone, Copy, Debug)]
pub struct Timeouts {
    pub connect: Duration,
    pub between_reads: Duration,
}

/// Where a batch reports to.
///
/// A parameter for the reason `scan::Report` is one: production's adapter emits
/// events on an `AppHandle`, which only a running app has, and the tests'
/// records.
pub trait Report {
    /// One file has landed or failed.
    fn progress(&self, progress: Progress);
    /// The queue drained, and this batch is over.
    fn complete(&self, complete: Complete);
}

/// The `download-progress` payload: the batch so far, and the file just done.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub total: u32,
    pub landed: u32,
    pub failed: u32,
    pub item: Item,
}

/// One file of a batch, and how it went.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Item {
    pub wallhaven_id: String,
    pub outcome: Outcome,
}

/// Landed, or failed with the sentence saying why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    Landed,
    Failed { message: String },
}

/// The `download-complete` payload: how the batch ended, with the first
/// failure's sentence for the pinned ending to print.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Complete {
    pub total: u32,
    pub landed: u32,
    pub failed: u32,
    pub first_error: Option<String>,
}

/// One queued file: the id, and what was served under it.
struct Job {
    id: String,
    served: Served,
}

/// The queue, and the batch it is working through.
#[derive(Default)]
struct Queue {
    waiting: VecDeque<Job>,
    /// The id being fetched right now, which counts as queued.
    current: Option<String>,
    /// Whether a thread is draining the queue.
    running: bool,
    batch: Complete,
}

impl Queue {
    fn holds(&self, id: &str) -> bool {
        self.current.as_deref() == Some(id) || self.waiting.iter().any(|job| job.id == id)
    }
}

/// The download queue and the agent its files come through.
///
/// Managed state, so there is one queue for the app. The agent is its own and
/// not [`Wallhaven`]'s: it goes to the image host, which is not rate limited,
/// carries no key, and times out between reads rather than on the whole
/// answer, since a 20 MB file on a slow link is not a search that hung.
pub struct Downloads {
    agent: ureq::Agent,
    queue: Mutex<Queue>,
}

impl Downloads {
    pub fn new(timeouts: Timeouts) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(timeouts.connect))
            // Every status is read below, so a 404 can say which file.
            .http_status_as_error(false)
            .user_agent(concat!("walltare/", env!("CARGO_PKG_VERSION")))
            .build();
        let connector = DefaultConnector::new().chain(BetweenReads(timeouts.between_reads));
        Self {
            agent: ureq::Agent::with_parts(
                config,
                connector,
                ureq::unversioned::resolver::DefaultResolver::default(),
            ),
            queue: Mutex::new(Queue::default()),
        }
    }

    fn queue(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Drain the queue, one file at a time, until it is empty.
    ///
    /// Ids enqueued while this runs join the batch it is reporting. The batch
    /// ends where the queue is found empty, under the same lock an
    /// [`enqueue`] takes, so an id asked for a moment later starts a batch of
    /// its own rather than joining one that has already said it is over.
    ///
    /// [`enqueue`]: Downloads::enqueue
    pub fn run(&self, db: &Db, report: &impl Report) {
        loop {
            let job = {
                let mut queue = self.queue();
                match queue.waiting.pop_front() {
                    Some(job) => {
                        queue.current = Some(job.id.clone());
                        job
                    }
                    None => {
                        queue.running = false;
                        // Under the lock, so this batch's ending is out before
                        // a later one's first event can be.
                        report.complete(std::mem::take(&mut queue.batch));
                        return;
                    }
                }
            };

            let outcome = match self.land(db, &job) {
                Ok(()) => Outcome::Landed,
                Err(error) => Outcome::Failed {
                    message: sentence(error),
                },
            };

            let progress = {
                let mut queue = self.queue();
                queue.current = None;
                let batch = &mut queue.batch;
                match &outcome {
                    Outcome::Landed => batch.landed += 1,
                    Outcome::Failed { message } => {
                        batch.failed += 1;
                        batch.first_error.get_or_insert_with(|| message.clone());
                    }
                }
                Progress {
                    total: batch.total,
                    landed: batch.landed,
                    failed: batch.failed,
                    item: Item {
                        wallhaven_id: job.id,
                        outcome,
                    },
                }
            };
            // Outside the lock: a click answered while this is emitted must
            // not wait on the emit to join the batch.
            report.progress(progress);
        }
    }

    /// Queue `jobs` in order, dropping any id already queued, and answer
    /// whether a thread has to be started to drain them.
    fn enqueue(&self, jobs: Vec<Job>) -> bool {
        let mut queue = self.queue();
        let mut added = 0;
        for job in jobs {
            if queue.holds(&job.id) {
                continue;
            }
            queue.waiting.push_back(job);
            added += 1;
        }
        if added == 0 {
            return false;
        }
        queue.batch.total += added;
        !std::mem::replace(&mut queue.running, true)
    }

    /// One file, from the folder check to the row.
    fn land(&self, db: &Db, job: &Job) -> Result<(), AppError> {
        let name = file_name(&job.id, &job.served)?;
        let (written, root) = db.read(crate::settings::download_paths)?;
        let folder = crate::download_folder::prepare(&written, &root)?;
        let destination = folder.join(&name);

        // A file already carrying the name is adopted rather than fetched.
        if !destination.is_file() {
            if destination.exists() {
                return Err(in_the_way(&destination));
            }
            let staged = self.fetch(job, &folder, &name)?;
            place(&staged, &destination)?;
        }

        // Read with the connection released (ADR 0039). A header that will
        // not read leaves the Dimensions unknown, which is what a scan does.
        let dimensions = crate::scanner::dimensions(&destination);
        db.write(|conn| {
            let added = crate::db::insert_new_wallpapers(conn, &[destination])?;
            if let (Some(row), Some((width, height))) = (added.first(), dimensions) {
                crate::db::record_dimensions(conn, row.id, width, height)?;
            }
            Ok(())
        })
    }

    /// The file's bytes, in a staging file in `folder` that holds exactly the
    /// `file_size` Wallhaven announced, or an error with the staging file
    /// already gone.
    fn fetch(&self, job: &Job, folder: &Path, name: &str) -> Result<Staged, AppError> {
        // The key goes on API calls and nowhere else (ADR 0052), and this
        // agent never learns it.
        let mut response =
            self.agent
                .get(&job.served.path)
                .call()
                .map_err(|error| match error {
                    ureq::Error::Timeout(_) => AppError::Network(
                        "Wallhaven's image host took too long to answer.".to_string(),
                    ),
                    other => AppError::Network(format!(
                        "Couldn't reach Wallhaven's image host ({other})."
                    )),
                })?;
        let status = response.status().as_u16();
        if status != 200 {
            return Err(AppError::Network(format!(
                "Wallhaven's image host refused the file (HTTP {status})."
            )));
        }

        let staged = Staged::new(folder, name);
        let mut file = std::fs::File::create_new(&staged.0)?;
        let expected = job.served.file_size;
        // One byte past the size is enough to know the file is not that size.
        let received = std::io::copy(
            &mut response.body_mut().as_reader().take(expected + 1),
            &mut file,
        )
        // `ureq` hands its own errors through `Read` wrapped in an `io::Error`,
        // and unwrapping it is what tells a stalled host from a broken link.
        .map_err(|error| match ureq::Error::from(error) {
            ureq::Error::Timeout(_) => {
                AppError::Network("Wallhaven's image host stopped sending the file.".to_string())
            }
            other => AppError::Network(format!("The download broke off ({other}).")),
        })?;
        if received != expected {
            return Err(AppError::Network(format!(
                "The file arrived at {received} bytes, not the {expected} Wallhaven announced."
            )));
        }
        Ok(staged)
    }
}

/// Ask for `ids` to be downloaded, and answer whether a thread has to be
/// started to drain the queue.
///
/// Every refusal happens here, before anything is queued: an id no search in
/// this process served, and a Download folder that cannot be used, with the
/// sentence the Settings field prints (ADR 0051, ADR 0054). The folder is
/// checked once more for each file, because this answer expires.
pub fn request(
    db: &Db,
    client: &Wallhaven,
    downloads: &Downloads,
    ids: &[String],
) -> Result<bool, AppError> {
    let jobs = ids
        .iter()
        .map(|id| {
            client
                .served(id)
                .map(|served| Job {
                    id: id.clone(),
                    served,
                })
                .ok_or_else(|| {
                    AppError::BadRequest(format!("{id} is not a Result a search has served"))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (written, root) = db.read(crate::settings::download_paths)?;
    crate::download_folder::prepare(&written, &root)?;
    Ok(downloads.enqueue(jobs))
}

/// The name the file lands under: Wallhaven's own, `wallhaven-<id>.<ext>`, off
/// the URL it was served at, so ADR 0050's grammar still recognises it if the
/// database is lost.
///
/// Read through the same parser the scan uses, and refused when it names some
/// other id, or anything but a plain file name.
fn file_name(id: &str, served: &Served) -> Result<String, AppError> {
    let name = served.path.rsplit('/').next().unwrap_or_default();
    let plain = name.starts_with(&format!("wallhaven-{id}."));
    if plain && crate::scanner::wallhaven_id(name) == Some(id) {
        Ok(name.to_string())
    } else {
        Err(AppError::Network(format!(
            "Wallhaven served {id} under a name that is not its own ({name})."
        )))
    }
}

/// A download in progress, under a hidden name with no image extension in the
/// folder it is about to land in: soft reject's staging pattern, so neither a
/// scan nor a file manager takes it for a wallpaper.
///
/// Dropping it removes the file. After [`place`] the name has been linked into
/// place, and the removal takes away only the staging name.
struct Staged(PathBuf);

impl Staged {
    fn new(folder: &Path, name: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        Self(folder.join(format!(
            ".{name}.walltare-download-{}-{nanos}",
            std::process::id()
        )))
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Put the staged file at `destination` without overwriting whatever might
/// have arrived there during the transfer.
///
/// A hard link, which fails rather than replaces when the name is taken; a
/// `rename` would silently replace it. A file that did arrive there is then
/// adopted like one that was there all along, and the staged copy goes when it
/// drops. A filesystem without hard links falls back to a `rename` behind a
/// check, which leaves the gap between the two open.
fn place(staged: &Staged, destination: &Path) -> Result<(), AppError> {
    match std::fs::hard_link(&staged.0, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if destination.is_file() {
                Ok(())
            } else {
                Err(in_the_way(destination))
            }
        }
        Err(_) if destination.exists() => Err(in_the_way(destination)),
        Err(_) => std::fs::rename(&staged.0, destination).map_err(Into::into),
    }
}

fn in_the_way(destination: &Path) -> AppError {
    AppError::InvalidPath(format!(
        "{} is in the way, and is not a file",
        destination.display()
    ))
}

/// The sentence a failed file reports, which the card's tooltip and the
/// batch's pinned ending print verbatim.
fn sentence(error: AppError) -> String {
    match error {
        AppError::Network(message)
        | AppError::InvalidPath(message)
        | AppError::InvalidPathSyntax(message)
        | AppError::Io(message)
        | AppError::Db(message) => message,
        other => other.to_string(),
    }
}

/// A connector that bounds each wait for input, which is how a download gets
/// its 30 s between reads.
///
/// `ureq`'s own body timeout is a budget for the whole body and is never
/// restarted, so it would cap the total, which ADR 0054 refused. Every wait
/// for input goes through [`Transport::await_input`] with the time left on
/// whichever timeout is next, and capping that wait is a timeout between
/// reads. The traits are `ureq`'s `unversioned` ones, which may change in a
/// minor release; `Cargo.lock` pins the one this is written against.
#[derive(Debug)]
struct BetweenReads(Duration);

impl Connector<Box<dyn Transport>> for BetweenReads {
    type Out = Bounded;

    fn connect(
        &self,
        _: &ConnectionDetails,
        chained: Option<Box<dyn Transport>>,
    ) -> Result<Option<Self::Out>, ureq::Error> {
        Ok(chained.map(|inner| Bounded {
            inner,
            limit: self.0,
        }))
    }
}

#[derive(Debug)]
struct Bounded {
    inner: Box<dyn Transport>,
    limit: Duration,
}

impl Transport for Bounded {
    fn buffers(&mut self) -> &mut dyn Buffers {
        self.inner.buffers()
    }

    fn transmit_output(&mut self, amount: usize, timeout: NextTimeout) -> Result<(), ureq::Error> {
        self.inner.transmit_output(amount, timeout)
    }

    fn await_input(&mut self, timeout: NextTimeout) -> Result<bool, ureq::Error> {
        let after = if *timeout.after > self.limit {
            self.limit.into()
        } else {
            timeout.after
        };
        self.inner.await_input(NextTimeout {
            after,
            reason: timeout.reason,
        })
    }

    fn is_open(&mut self) -> bool {
        self.inner.is_open()
    }

    fn is_tls(&self) -> bool {
        self.inner.is_tls()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{self, dimensions_of, wallhaven_id_of, Canned};
    use std::cell::RefCell;

    /// What a test does as each file is reported.
    type OnProgress<'a> = Box<dyn Fn(&Progress) + 'a>;

    /// A report that records, and may act on each file as it is reported, the
    /// way a curator clicking mid-batch would.
    #[derive(Default)]
    struct Recorder<'a> {
        progress: RefCell<Vec<Progress>>,
        complete: RefCell<Vec<Complete>>,
        events: RefCell<Vec<String>>,
        on_progress: Option<OnProgress<'a>>,
    }

    impl Report for Recorder<'_> {
        fn progress(&self, progress: Progress) {
            self.events
                .borrow_mut()
                .push(format!("progress {}", progress.item.wallhaven_id));
            if let Some(act) = &self.on_progress {
                act(&progress);
            }
            self.progress.borrow_mut().push(progress);
        }

        fn complete(&self, complete: Complete) {
            self.events.borrow_mut().push("complete".to_string());
            self.complete.borrow_mut().push(complete);
        }
    }

    /// A PNG of the given size, as the bytes a file host would send.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::RgbImage::from_pixel(width, height, image::Rgb([7, 90, 200]))
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        bytes
    }

    /// A library with a Library root, and the Download folder left at its
    /// default, `wallhaven` under it.
    struct Library {
        _dir: tempfile::TempDir,
        root: PathBuf,
        db: Db,
    }

    impl Library {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().canonicalize().unwrap();
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            crate::db::init_schema(&conn).unwrap();
            crate::settings::set(
                &conn,
                "library_root",
                root.to_str().unwrap(),
                crate::settings::Detected::from_monitor(None),
            )
            .unwrap();
            Self {
                _dir: dir,
                root,
                db: Db::new(conn),
            }
        }

        fn folder(&self) -> PathBuf {
            self.root.join("wallhaven")
        }

        /// Every entry in the Download folder, staging files included.
        fn entries(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(self.folder())
                .map(|dir| {
                    dir.flatten()
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            names.sort();
            names
        }

        fn rows(&self) -> Vec<(i64, String, String)> {
            self.db.read(|conn| {
                let mut stmt = conn
                    .prepare("SELECT id, path, status FROM wallpapers ORDER BY id")
                    .unwrap();
                stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap()
            })
        }
    }

    /// A Wallhaven search record for `id`, served at `files`.
    fn record(files: &testing::Stub, id: &str, file_size: usize) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "url": format!("https://wallhaven.cc/w/{id}"),
            "short_url": format!("https://whvn.cc/{id}"),
            "views": 1, "favorites": 1, "source": "", "purity": "sfw",
            "category": "anime", "dimension_x": 3840, "dimension_y": 2160,
            "resolution": "3840x2160", "ratio": "1.78",
            "file_size": file_size, "file_type": "image/png",
            "created_at": "2026-09-02 17:01:46", "colors": [],
            "path": format!("{}/full/{}/wallhaven-{id}.png", files.base(), &id[..2]),
            "thumbs": { "large": "", "original": "", "small": "" },
        })
    }

    /// A client that has served one search, of `results` as `(id, file_size)`
    /// at `files`, so a download can name them.
    fn served(files: &testing::Stub, results: &[(&str, usize)]) -> Wallhaven {
        let api = testing::stub(vec![Canned::json(serde_json::json!({
            "data": results.iter().map(|(id, size)| record(files, id, *size)).collect::<Vec<_>>(),
            "meta": { "current_page": 1, "last_page": 1, "per_page": 24, "total": results.len() },
        }))]);
        let client = Wallhaven::new(&api.base(), crate::wallhaven::API_TIMEOUTS);
        let params: crate::wallhaven::SearchParams = serde_json::from_value(serde_json::json!({
            "categories": { "general": true, "anime": true, "people": true },
            "purity": { "sfw": true, "sketchy": false, "nsfw": false },
            "sorting": "date_added",
            "order": "desc",
        }))
        .unwrap();
        client.search(&params).unwrap();
        client
    }

    fn downloads() -> Downloads {
        Downloads::new(DOWNLOAD_TIMEOUTS)
    }

    fn ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn failed_with(progress: &Progress) -> &str {
        match &progress.item.outcome {
            Outcome::Failed { message } => message,
            Outcome::Landed => panic!("{} landed", progress.item.wallhaven_id),
        }
    }

    #[test]
    fn a_download_lands_under_wallhavens_name_as_an_active_row_with_its_id_and_dimensions() {
        let library = Library::new();
        let image = png(12, 5);
        let files = testing::stub(vec![Canned::file(&image)]);
        let client = served(&files, &[("qrow67", image.len())]);
        let downloads = downloads();
        let report = Recorder::default();

        assert!(request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap());
        downloads.run(&library.db, &report);

        let landed = library.folder().join("wallhaven-qrow67.png");
        assert_eq!(std::fs::read(&landed).unwrap(), image);
        // Nothing else: the staging file became the landed one.
        assert_eq!(library.entries(), ["wallhaven-qrow67.png"]);
        let rows = library.rows();
        assert_eq!(rows.len(), 1);
        // Spelled as a scan spells it, so a rescan hits IGNORE.
        assert_eq!(rows[0].1, landed.to_str().unwrap());
        assert_eq!(rows[0].2, "active");
        library.db.read(|conn| {
            assert_eq!(wallhaven_id_of(conn, rows[0].0).as_deref(), Some("qrow67"));
            // The header's, not the API's 3840x2160.
            assert_eq!(dimensions_of(conn, rows[0].0), (Some(12), Some(5)));
        });
        // A rescan of the Download folder finds nothing to add.
        let rescanned = library.db.write(|conn| {
            crate::db::insert_new_wallpapers(
                conn,
                &crate::scanner::collect_images(std::slice::from_ref(&library.root)),
            )
        });
        assert!(rescanned.unwrap().is_empty());
    }

    #[test]
    fn the_file_is_fetched_from_the_path_served_and_without_the_key() {
        let library = Library::new();
        let image = png(2, 2);
        let files = testing::stub(vec![Canned::file(&image)]);
        let client = served(&files, &[("jedzym", image.len())]);
        let downloads = downloads();

        request(&library.db, &client, &downloads, &ids(&["jedzym"])).unwrap();
        downloads.run(&library.db, &Recorder::default());

        let asked = files.requests();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].target(), "/full/je/wallhaven-jedzym.png");
        // The key goes on `api/v1` calls and nowhere else (ADR 0052).
        assert!(
            !asked[0].target().contains("apikey"),
            "{}",
            asked[0].target()
        );
        assert!(
            asked[0]
                .headers
                .iter()
                .all(|(name, _)| name != "x-api-key" && name != "authorization"),
            "{:?}",
            asked[0].headers
        );
    }

    #[test]
    fn a_short_transfer_leaves_no_file_and_no_row() {
        let library = Library::new();
        let image = png(4, 4);
        // A complete answer, of a file that is not the size Wallhaven
        // announced.
        let files = testing::stub(vec![Canned::file(&image[..image.len() - 10])]);
        let client = served(&files, &[("qrow67", image.len())]);
        let downloads = downloads();
        let report = Recorder::default();

        request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap();
        downloads.run(&library.db, &report);

        assert_eq!(library.entries(), Vec::<String>::new());
        assert!(library.rows().is_empty());
        let progress = report.progress.borrow();
        let message = failed_with(&progress[0]);
        assert!(message.contains("not the"), "{message}");
    }

    #[test]
    fn a_file_larger_than_announced_is_refused_too() {
        let library = Library::new();
        let image = png(4, 4);
        let files = testing::stub(vec![Canned::file(&image)]);
        let client = served(&files, &[("qrow67", image.len() - 1)]);
        let downloads = downloads();
        let report = Recorder::default();

        request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap();
        downloads.run(&library.db, &report);

        assert_eq!(library.entries(), Vec::<String>::new());
        assert!(library.rows().is_empty());
        assert_eq!(report.complete.borrow()[0].failed, 1);
    }

    #[test]
    fn a_transfer_that_breaks_off_or_stalls_or_is_refused_leaves_nothing_behind() {
        let library = Library::new();
        let image = png(40, 40);
        let files = testing::stub(vec![
            Canned::file(&image).cut_after(image.len() / 2),
            Canned::html(404, "gone"),
            // Last, because the stub answers one connection at a time and is
            // still sitting on this one when the client gives up on it.
            Canned::file(&image).stalling(Duration::from_millis(600)),
        ]);
        let client = served(
            &files,
            &[
                ("aaaaaa", image.len()),
                ("bbbbbb", image.len()),
                ("cccccc", image.len()),
            ],
        );
        let downloads = Downloads::new(Timeouts {
            connect: Duration::from_secs(10),
            between_reads: Duration::from_millis(150),
        });
        let report = Recorder::default();

        request(
            &library.db,
            &client,
            &downloads,
            &ids(&["aaaaaa", "bbbbbb", "cccccc"]),
        )
        .unwrap();
        downloads.run(&library.db, &report);

        assert_eq!(library.entries(), Vec::<String>::new());
        assert!(library.rows().is_empty());
        let progress = report.progress.borrow();
        assert!(
            failed_with(&progress[0]).contains("broke off"),
            "{}",
            failed_with(&progress[0])
        );
        assert_eq!(
            failed_with(&progress[1]),
            "Wallhaven's image host refused the file (HTTP 404)."
        );
        assert_eq!(
            failed_with(&progress[2]),
            "Wallhaven's image host stopped sending the file."
        );
        let complete = &report.complete.borrow()[0];
        assert_eq!(
            (complete.total, complete.landed, complete.failed),
            (3, 0, 3)
        );
        assert_eq!(
            complete.first_error.as_deref(),
            Some(failed_with(&progress[0]))
        );
    }

    #[test]
    fn an_untracked_file_already_there_is_adopted_without_a_fetch() {
        let library = Library::new();
        std::fs::create_dir(library.folder()).unwrap();
        let by_hand = png(9, 3);
        std::fs::write(library.folder().join("wallhaven-qrow67.png"), &by_hand).unwrap();
        let files = testing::stub(vec![]);
        let client = served(&files, &[("qrow67", 1)]);
        let downloads = downloads();
        let report = Recorder::default();

        request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap();
        downloads.run(&library.db, &report);

        assert!(files.requests().is_empty(), "nothing was fetched");
        // The curator's bytes, untouched, and one row for them.
        assert_eq!(
            std::fs::read(library.folder().join("wallhaven-qrow67.png")).unwrap(),
            by_hand
        );
        let rows = library.rows();
        assert_eq!(rows.len(), 1);
        library.db.read(|conn| {
            assert_eq!(wallhaven_id_of(conn, rows[0].0).as_deref(), Some("qrow67"));
            assert_eq!(dimensions_of(conn, rows[0].0), (Some(9), Some(3)));
        });
        assert_eq!(report.progress.borrow()[0].item.outcome, Outcome::Landed);
    }

    #[test]
    fn placing_never_overwrites_a_file_that_arrived_during_the_transfer() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("wallhaven-qrow67.png");
        let staged = Staged::new(dir.path(), "wallhaven-qrow67.png");
        std::fs::write(&staged.0, b"downloaded").unwrap();
        std::fs::write(&destination, b"already here").unwrap();

        place(&staged, &destination).unwrap();
        drop(staged);

        assert_eq!(std::fs::read(&destination).unwrap(), b"already here");
        // And the staged copy is gone with its guard.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn placing_into_a_free_name_moves_the_staged_file_there() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("wallhaven-qrow67.png");
        let staged = Staged::new(dir.path(), "wallhaven-qrow67.png");
        std::fs::write(&staged.0, b"downloaded").unwrap();
        // Hidden, and no image extension, so a scan passes over it.
        let name = staged.0.file_name().unwrap().to_str().unwrap().to_string();
        assert!(name.starts_with('.'), "{name}");
        assert!(!crate::scanner::is_supported(&staged.0), "{name}");

        place(&staged, &destination).unwrap();
        drop(staged);

        assert_eq!(std::fs::read(&destination).unwrap(), b"downloaded");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn an_id_no_search_served_is_refused_and_nothing_is_queued() {
        let library = Library::new();
        let files = testing::stub(vec![]);
        let client = served(&files, &[("qrow67", 1)]);
        let downloads = downloads();

        let err = request(
            &library.db,
            &client,
            &downloads,
            &ids(&["qrow67", "zzzzzz"]),
        )
        .unwrap_err();

        assert!(
            matches!(err, AppError::BadRequest(ref m) if m == "zzzzzz is not a Result a search has served"),
            "got {err:?}"
        );
        // All or nothing: the served id did not queue either.
        let report = Recorder::default();
        downloads.run(&library.db, &report);
        assert!(report.progress.borrow().is_empty());
    }

    #[test]
    fn with_no_library_root_the_download_is_refused_and_nothing_is_created() {
        let library = Library::new();
        library.db.write(|conn| {
            crate::settings::set(
                conn,
                "library_root",
                "",
                crate::settings::Detected::from_monitor(None),
            )
            .unwrap()
        });
        let files = testing::stub(vec![]);
        let client = served(&files, &[("qrow67", 1)]);
        let downloads = downloads();

        let err = request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap_err();

        assert!(
            matches!(err, AppError::InvalidPath(ref m) if m == "No library root is set, so nothing can be downloaded"),
            "got {err:?}"
        );
        assert!(!library.folder().exists());
    }

    #[test]
    fn a_folder_that_went_bad_since_the_click_fails_that_file() {
        let library = Library::new();
        let files = testing::stub(vec![]);
        let client = served(&files, &[("qrow67", 1)]);
        let downloads = downloads();
        request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap();
        // The click created the folder; something replaced it with a file.
        std::fs::remove_dir(library.folder()).unwrap();
        std::fs::write(library.folder(), b"x").unwrap();
        let report = Recorder::default();

        downloads.run(&library.db, &report);

        assert!(files.requests().is_empty());
        let progress = report.progress.borrow();
        assert!(
            failed_with(&progress[0]).contains("is not a folder, so downloads"),
            "{}",
            failed_with(&progress[0])
        );
    }

    #[test]
    fn an_id_already_queued_is_dropped_and_later_ids_join_the_running_batch() {
        let library = Library::new();
        let (one, two, three) = (png(1, 1), png(2, 1), png(3, 1));
        let files = testing::stub(vec![
            Canned::file(&one),
            Canned::file(&two),
            Canned::file(&three),
        ]);
        let client = served(
            &files,
            &[
                ("aaaaaa", one.len()),
                ("bbbbbb", two.len()),
                ("cccccc", three.len()),
            ],
        );
        let downloads = downloads();

        // The first click starts a batch; its twin within the call is dropped.
        assert!(request(
            &library.db,
            &client,
            &downloads,
            &ids(&["aaaaaa", "aaaaaa"])
        )
        .unwrap());
        // A second click before the thread has started joins the batch, and
        // the id it repeats is dropped.
        assert!(!request(
            &library.db,
            &client,
            &downloads,
            &ids(&["aaaaaa", "bbbbbb"])
        )
        .unwrap());

        // And a third arrives while the first file is being reported: it joins
        // the batch rather than starting one, and repeats of the file in flight
        // or the one waiting are dropped.
        let report = Recorder {
            on_progress: Some(Box::new(|progress: &Progress| {
                if progress.item.wallhaven_id == "aaaaaa" {
                    let started = request(
                        &library.db,
                        &client,
                        &downloads,
                        &ids(&["bbbbbb", "cccccc"]),
                    )
                    .unwrap();
                    assert!(!started, "the running batch takes it");
                }
            })),
            ..Recorder::default()
        };
        downloads.run(&library.db, &report);

        assert_eq!(
            *report.events.borrow(),
            [
                "progress aaaaaa",
                "progress bbbbbb",
                "progress cccccc",
                "complete"
            ]
        );
        let progress = report.progress.borrow();
        let counts: Vec<_> = progress
            .iter()
            .map(|p| (p.total, p.landed, p.failed))
            .collect();
        assert_eq!(counts, [(2, 1, 0), (3, 2, 0), (3, 3, 0)]);
        assert_eq!(
            report.complete.borrow()[0],
            Complete {
                total: 3,
                landed: 3,
                failed: 0,
                first_error: None
            }
        );
        assert_eq!(files.requests().len(), 3);
        assert_eq!(library.rows().len(), 3);

        // The batch is over, so the next click starts a new one, counted from
        // nothing.
        assert!(request(&library.db, &client, &downloads, &ids(&["aaaaaa"])).unwrap());
    }

    #[test]
    fn a_failed_file_counts_and_the_batch_carries_on() {
        let library = Library::new();
        let image = png(2, 2);
        let files = testing::stub(vec![Canned::html(500, "down"), Canned::file(&image)]);
        let client = served(&files, &[("aaaaaa", image.len()), ("bbbbbb", image.len())]);
        let downloads = downloads();
        let report = Recorder::default();

        request(
            &library.db,
            &client,
            &downloads,
            &ids(&["aaaaaa", "bbbbbb"]),
        )
        .unwrap();
        downloads.run(&library.db, &report);

        assert_eq!(library.entries(), ["wallhaven-bbbbbb.png"]);
        assert_eq!(
            report.complete.borrow()[0],
            Complete {
                total: 2,
                landed: 1,
                failed: 1,
                first_error: Some(
                    "Wallhaven's image host refused the file (HTTP 500).".to_string()
                ),
            }
        );
    }

    #[test]
    fn a_row_a_scan_got_to_first_is_left_standing() {
        let library = Library::new();
        std::fs::create_dir(library.folder()).unwrap();
        let path = library.folder().join("wallhaven-qrow67.png");
        std::fs::write(&path, png(3, 3)).unwrap();
        library
            .db
            .write(|conn| crate::db::insert_new_wallpapers(conn, std::slice::from_ref(&path)))
            .unwrap();
        let files = testing::stub(vec![]);
        let client = served(&files, &[("qrow67", 1)]);
        let downloads = downloads();
        let report = Recorder::default();

        request(&library.db, &client, &downloads, &ids(&["qrow67"])).unwrap();
        downloads.run(&library.db, &report);

        assert_eq!(library.rows().len(), 1);
        assert_eq!(report.progress.borrow()[0].item.outcome, Outcome::Landed);
    }

    #[test]
    fn the_events_cross_the_ipc_as_client_ts_reads_them() {
        let landed = serde_json::to_value(Progress {
            total: 2,
            landed: 1,
            failed: 0,
            item: Item {
                wallhaven_id: "qrow67".to_string(),
                outcome: Outcome::Landed,
            },
        })
        .unwrap();
        assert_eq!(
            landed,
            serde_json::json!({
                "total": 2, "landed": 1, "failed": 0,
                "item": { "wallhaven_id": "qrow67", "outcome": { "kind": "landed" } },
            })
        );
        let failed = serde_json::to_value(Outcome::Failed {
            message: "gone".to_string(),
        })
        .unwrap();
        assert_eq!(
            failed,
            serde_json::json!({ "kind": "failed", "message": "gone" })
        );
        let complete = serde_json::to_value(Complete::default()).unwrap();
        assert_eq!(
            complete,
            serde_json::json!({ "total": 0, "landed": 0, "failed": 0, "first_error": null })
        );
    }
}
