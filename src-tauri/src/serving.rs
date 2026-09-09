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
//! All three of those answers now live here
//! ([#228](https://github.com/QuantumFF/walltare/issues/228), ADR 0040), and
//! they are three types in this file:
//!
//! - [`ImageWorkers`] is a stack rather than a queue, so the newest request —
//!   the one whose card is most likely still on screen — is served first, and
//!   nothing is dropped.
//! - [`InFlight`] gives a request that arrives while an identical one is being
//!   answered the first one's answer.
//! - [`ImageCache`] holds the bytes of the last few hundred thumbnails, so a
//!   card that scrolls back into view costs a hash lookup and a copy.
//!
//! A request meets them in that order on the way down and the reverse on the way
//! back, and none of the three is visible to the webview, to `lib.rs`, or to the
//! frontend's three callers of `wallpaperImageUrl`.
//!
//! [`ImageWorkers`] has two producers rather than one
//! ([#232](https://github.com/QuantumFF/walltare/issues/232)). The
//! pre-generation pass hands it one wallpaper at a time through
//! [`ImageWorkers::background`] and waits, so the machine runs the pool's
//! threads rather than the pool's threads plus a decode beside them, and a
//! thumbnail the curator is waiting on is taken off the stack before any of the
//! pass's work.

use std::collections::{HashMap, VecDeque};
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard, PoisonError};

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

/// One wallpaper at one size, which is everything a `wallpaper://` URL says and
/// so the key all three of this module's answers are held under.
type Key = (i64, Size);

/// What a request came away with: the JPEG bytes, or why there are none.
///
/// Shared rather than cloned, because the whole point of [`InFlight`] is that
/// one answer serves every request that asked for it. `Arc<Vec<u8>>` is copied
/// once per response into the `Response<Vec<u8>>` the webview gets, and never
/// per waiter.
type Answer = Result<Arc<Vec<u8>>, AppError>;

/// Starts the threads that answer `wallpaper://` requests, and the two tables
/// they answer through.
///
/// Called once from `setup`, so the pool is up before the first card asks. The
/// pool, the in-flight table and the bytes in memory are private to this module
/// — nothing outside it names the stack, the threads or the job type, which is
/// what kept the admission policy a change to this file and to nothing else.
/// [`ImageCache`] is the one exception and only for what invalidates it: Settings'
/// Clear thumbnail cache throws away rows and files in `lib.rs`, and the bytes
/// have to go with them.
pub fn start(app: &AppHandle) {
    app.manage(ImageWorkers::new(worker_count()));
    app.manage(ImageCache::new(IMAGE_CACHE_ENTRIES));
    app.manage(InFlight::default());
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
/// Everything but a hit in memory happens on a pool thread, never on the thread
/// Tauri calls the protocol handler on: that is the UI thread, and a cache miss
/// there freezes the window for the length of a decode (ADR 0004).
pub fn serve(
    app: &AppHandle,
    asked_for: Result<(i64, Size), AppError>,
    responder: UriSchemeResponder,
) {
    // A hit answers here, on the UI thread, and that is deliberate. The channel
    // hop is one of the six costs #224 counted against a warm request, and this
    // is the one place it can be skipped. What the UI thread does is take a
    // mutex held only for a hash lookup, and copy at most a `medium` — never a
    // `stat`, never a file read, never a decode, and never a lock any of those
    // are holding.
    if let Ok((wallpaper_id, size)) = asked_for {
        if let Some(bytes) = app.state::<ImageCache>().get(wallpaper_id, size) {
            responder.respond(image_response(bytes.to_vec()));
            return;
        }
    }
    // The clone is the job's own handle: the pool answers after this call has
    // returned, so it cannot borrow the caller's.
    let handle = app.clone();
    let job = move || {
        let response = match asked_for {
            Ok((wallpaper_id, size)) => {
                let db = handle.state::<Db>();
                let cache_dir = handle.state::<CacheDir>();
                let memory = handle.state::<ImageCache>();
                let in_flight = handle.state::<InFlight>();
                answer(
                    &db,
                    &cache_dir.0,
                    &memory,
                    &in_flight,
                    wallpaper_id,
                    size,
                    thumbnails::fulfill,
                )
            }
            Err(e) => error_response(&e),
        };
        responder.respond(response);
    };
    app.state::<ImageWorkers>().submit(job);
}

/// One wallpaper at one size, as the response the webview gets.
///
/// The function the tests drive. It takes the connection, the cache directory
/// and the two tables rather than an `AppHandle` so that driving it needs
/// neither a running Tauri app nor a protocol handler — an in-memory database
/// and a temp directory are the whole of the setup.
///
/// The three answers in the order a request meets them: the bytes in memory,
/// then an identical request already being answered, then the work. Production
/// always passes [`thumbnails::fulfill`] for the last of those; a test passes a
/// phase two it can count, which is how "two concurrent requests decode once" is
/// asserted rather than described.
#[allow(clippy::too_many_arguments)]
fn answer<F>(
    db: &Db,
    cache_dir: &Path,
    memory: &ImageCache,
    in_flight: &InFlight,
    wallpaper_id: i64,
    size: Size,
    fulfill: F,
) -> Response<Vec<u8>>
where
    F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
{
    // Checked again here, having been checked on the UI thread: a request that
    // queued behind an identical one may have been overtaken by its answer,
    // which under a stack is the common case rather than the rare one.
    if let Some(bytes) = memory.get(wallpaper_id, size) {
        return image_response(bytes.to_vec());
    }

    let answer = match in_flight.join(wallpaper_id, size) {
        Joined::Leading(leader) => {
            leader.publish(generate(db, cache_dir, memory, wallpaper_id, size, fulfill))
        }
        Joined::Waiting(answer) => answer,
    };

    match answer.as_ref() {
        Ok(bytes) => image_response(bytes.to_vec()),
        Err(e) => error_response(e),
    }
}

/// The work a miss costs, and the one place bytes enter [`ImageCache`].
fn generate<F>(
    db: &Db,
    cache_dir: &Path,
    memory: &ImageCache,
    wallpaper_id: i64,
    size: Size,
    fulfill: F,
) -> Answer
where
    F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
{
    let served = phases(db, cache_dir, wallpaper_id, size, fulfill)?;
    let bytes = Arc::new(served.bytes);
    if served.regenerated {
        // These bytes were made from the source as it is now, so every other
        // size of this wallpaper in memory was made from an older read of it.
        // The source's mtime moving is the only thing that invalidates a
        // thumbnail (ADR 0016), and a regenerate is this module hearing that it
        // moved — for one size, about a file all the sizes share.
        //
        // A first generation of a second size lands here too, and drops a
        // sibling that was in fact still fresh. That costs one cache-file read
        // the next time the sibling is asked for; keeping a stale one would show
        // the curator the wrong picture until it fell out of the cache.
        memory.forget(wallpaper_id);
    }
    memory.store(wallpaper_id, size, Arc::clone(&bytes));
    Ok(bytes)
}

/// What phase two came away with, and whether it did the work.
struct Served {
    bytes: Vec<u8>,
    /// `true` when phase two generated the bytes, `false` when it read the cache
    /// file. The same thing [`thumbnails::record`] reads to decide whether there
    /// is a row to write, and [`generate`] reads it to decide what in memory the
    /// generation just invalidated.
    regenerated: bool,
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
) -> Result<Served, AppError>
where
    F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
{
    let plan = db.read(|conn| thumbnails::plan(conn, wallpaper_id, size))?;
    let resolved = fulfill(&plan, cache_dir)?;
    db.write(|conn| thumbnails::record(conn, &plan, &resolved))?;
    Ok(Served {
        regenerated: resolved.record_mtime.is_some(),
        bytes: resolved.thumbnail.bytes,
    })
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

/// The JPEG bytes of the thumbnails asked for most recently, bounded by
/// [`IMAGE_CACHE_ENTRIES`] and evicting whichever has gone unasked-for longest.
///
/// This is where ADR 0016's parked `Map<id, blob>` landed. It sits behind
/// [`serve`], on the side that already holds the bytes, so it serves all three
/// callers that ADR named — the library card, the review card and the lightbox's
/// two sizes — without any of them knowing it exists.
///
/// What it is worth is the six costs a warm request paid: a channel hop, two
/// mutex acquisitions, a `stat`, an `exists` and a full file read, for bytes the
/// process was already holding a moment ago. A hit is a hash lookup and a copy.
///
/// Bytes go in from [`generate`] and come out of [`ImageCache::get`]. What takes
/// them back out is the three things that invalidate a thumbnail: Clear
/// thumbnail cache calls [`ImageCache::forget_all`], a purge of one wallpaper
/// calls [`ImageCache::forget`], and a regenerate is [`generate`]'s own business.
/// Nothing here expires on a clock — see ADR 0040 for what that costs.
pub struct ImageCache {
    entries: Mutex<Entries>,
    capacity: usize,
}

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
    /// A purge and a regenerate are both about a source file, and every size
    /// came off that one file, so neither invalidates a size at a time.
    pub fn forget(&self, wallpaper_id: i64) {
        self.entries().held.retain(|(id, _), _| *id != wallpaper_id);
    }

    /// Forgets everything, for Settings' Clear thumbnail cache.
    ///
    /// The third half of that operation: `lib.rs` unlinks the files, deletes the
    /// rows, and calls this. A curator who asked for the cache to be thrown away
    /// and then saw the same thumbnails come back would have been told the
    /// button does not work.
    pub fn forget_all(&self) {
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

/// The requests being answered right now, so a second one for the same
/// wallpaper and size waits for the first instead of repeating it.
///
/// Reachable today without contriving anything: the lightbox's filmstrip and the
/// library grid behind it both ask for the same wallpaper's `small`, and both
/// requests used to decode, encode and write the same cache file (#224).
#[derive(Default)]
struct InFlight(Mutex<HashMap<Key, Arc<Flight>>>);

/// One request being answered, and whatever it ends up answering with.
#[derive(Default)]
struct Flight {
    /// `None` until the leader settles it. The condvar's predicate, so it is a
    /// `Mutex` rather than a `OnceLock`.
    answer: Mutex<Option<Arc<Answer>>>,
    ready: Condvar,
    /// How many requests are parked on this one. Nothing in production reads it;
    /// a test does, because a follower that has arrived leaves no trace of
    /// having arrived — the same problem `Db::is_free` solves for the connection.
    waiting: AtomicUsize,
}

/// Which side of a flight a request is on.
enum Joined<'a> {
    /// Nobody was asking for this yet, so this request does the work and
    /// publishes it.
    Leading(Leader<'a>),
    /// An identical request got here first, and this is its answer.
    Waiting(Arc<Answer>),
}

impl InFlight {
    /// Either takes the flight for this wallpaper and size, or waits for the one
    /// already under way.
    ///
    /// The waiting happens on a pool thread, which is a worker not decoding for
    /// however long the leader takes. That is bounded by the pool — at worst
    /// every worker but the leader parks on the same image, and the requests
    /// behind them are answered from memory the moment it lands — and it is
    /// strictly cheaper than what it replaces, which was every one of those
    /// workers decoding the same 4K source.
    fn join(&self, wallpaper_id: i64, size: Size) -> Joined<'_> {
        let key = (wallpaper_id, size);
        let mut flights = self.flights();
        if let Some(flight) = flights.get(&key).cloned() {
            // Released before the wait, or the leader could never publish.
            drop(flights);
            return Joined::Waiting(flight.wait());
        }
        let flight = Arc::new(Flight::default());
        flights.insert(key, Arc::clone(&flight));
        drop(flights);
        Joined::Leading(Leader {
            in_flight: self,
            key,
            flight,
            settled: false,
        })
    }

    fn flights(&self) -> MutexGuard<'_, HashMap<Key, Arc<Flight>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// How many requests are parked on one flight.
    ///
    /// Tests only. Two requests are concurrent when the second is waiting on the
    /// first, and this is what lets a test wait for exactly that rather than
    /// sleeping and hoping.
    #[cfg(test)]
    fn followers(&self, wallpaper_id: i64, size: Size) -> usize {
        self.flights()
            .get(&(wallpaper_id, size))
            .map(|flight| flight.waiting.load(Ordering::SeqCst))
            .unwrap_or(0)
    }
}

impl Flight {
    /// Blocks until the leader settles, and answers with what it settled on.
    fn wait(&self) -> Arc<Answer> {
        self.waiting.fetch_add(1, Ordering::SeqCst);
        let mut answer = self.answer.lock().unwrap_or_else(PoisonError::into_inner);
        while answer.is_none() {
            answer = self
                .ready
                .wait(answer)
                .unwrap_or_else(PoisonError::into_inner);
        }
        self.waiting.fetch_sub(1, Ordering::SeqCst);
        Arc::clone(
            answer
                .as_ref()
                .expect("the loop above ended because it is set"),
        )
    }
}

/// The request doing the work for everyone waiting on the same wallpaper and
/// size.
struct Leader<'a> {
    in_flight: &'a InFlight,
    key: Key,
    flight: Arc<Flight>,
    settled: bool,
}

impl Leader<'_> {
    /// Hands the answer to everyone parked on this flight, and back to the
    /// leader's own request.
    fn publish(mut self, answer: Answer) -> Arc<Answer> {
        let shared = Arc::new(answer);
        self.settle(Some(Arc::clone(&shared)));
        shared
    }

    /// Takes the flight out of the table and wakes its waiters, once.
    ///
    /// The removal comes first, so a request arriving after this instant starts
    /// a fresh flight rather than joining one that is already settled. A waiter
    /// that took its `Arc` before the removal is unaffected — it is holding the
    /// flight, not looking it up.
    fn settle(&mut self, answer: Option<Arc<Answer>>) {
        if self.settled {
            return;
        }
        self.settled = true;
        self.in_flight.flights().remove(&self.key);
        let settled = answer.unwrap_or_else(|| {
            Arc::new(Err(AppError::Image(
                "generating the thumbnail panicked".to_string(),
            )))
        });
        *self
            .flight
            .answer
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(settled);
        self.flight.ready.notify_all();
    }
}

impl Drop for Leader<'_> {
    /// A leader that panicked still answers. The `image` crate decoding
    /// somebody's malformed JPEG is the one place in this path that could, and a
    /// follower parked on the condvar would otherwise wait for the life of the
    /// process while holding one of the pool's threads.
    fn drop(&mut self) {
        self.settle(None);
    }
}

/// A fixed set of threads for image work: `wallpaper://` requests newest first,
/// and the pre-generation pass behind all of them.
pub struct ImageWorkers(Arc<Requests>);

type Job = Box<dyn FnOnce() + Send>;

/// The work waiting for a worker: interactive requests as a stack, and the
/// pre-generation pass's next wallpaper behind them.
///
/// The stack is the whole of the ordering decision for a request (ADR 0040),
/// replacing an `mpsc` FIFO. Under ADR 0016's virtualisation a wheel pass mounts
/// and unmounts cards continuously, so by the time a request reaches a worker
/// the card that asked for it may be long gone — and a FIFO serves it ahead of
/// the cards now on screen. The newest request is the one whose card is most
/// likely still visible.
///
/// The second lane is the whole of the ordering decision between the two
/// producers (#232). A worker takes a request whenever there is one, so a
/// thumbnail the curator is waiting for overtakes one the pass is warming for
/// later. Overtaking is the next thing off the stack and never a cancellation:
/// the `image` crate cannot be interrupted mid-decode, so a background job
/// already running finishes.
///
/// Nothing is dropped from either lane. A card that scrolls back into view is
/// served later, not left blank, and the pass's wallpaper is served once the
/// requests in front of it are — which they are, because a grid asks for a
/// bounded number of thumbnails and then stops asking.
#[derive(Default)]
struct Requests {
    pending: Mutex<Pending>,
    arrived: Condvar,
}

#[derive(Default)]
struct Pending {
    /// Interactive requests, newest first.
    stack: Vec<Job>,
    /// The pre-generation pass's work, oldest first. Nothing about a background
    /// job is about what is on screen, so there is nothing for a stack's
    /// argument to bite on, and the pass keeps at most one job here anyway: it
    /// submits one wallpaper and waits for it (ADR 0012's one-thread budget).
    background: VecDeque<Job>,
    /// Set when the pool is dropped, so a worker parked on the condvar has
    /// something to wake up to. Production never sets it — the pool is app state
    /// until the process exits — and a test does.
    closed: bool,
}

impl Requests {
    fn push(&self, job: Job) {
        self.pending().stack.push(job);
        self.arrived.notify_one();
    }

    fn push_background(&self, job: Job) {
        self.pending().background.push_back(job);
        self.arrived.notify_one();
    }

    /// Blocks until there is work, and answers with the newest request, or with
    /// the pass's next wallpaper when no request is waiting.
    ///
    /// `None` means the pool is gone and both lanes are empty, which is the only
    /// way a worker ever stops. They are drained first even then: a job dropped
    /// without running is a request the webview is still waiting on, or a pass
    /// waiting on an answer that would never come.
    fn take(&self) -> Option<Job> {
        let mut pending = self.pending();
        loop {
            if let Some(job) = pending.stack.pop() {
                return Some(job);
            }
            if let Some(job) = pending.background.pop_front() {
                return Some(job);
            }
            if pending.closed {
                return None;
            }
            pending = self
                .arrived
                .wait(pending)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }

    fn close(&self) {
        self.pending().closed = true;
        self.arrived.notify_all();
    }

    fn pending(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl ImageWorkers {
    fn new(size: usize) -> Self {
        let requests = Arc::new(Requests::default());
        for _ in 0..size {
            let requests = Arc::clone(&requests);
            std::thread::spawn(move || {
                while let Some(job) = requests.take() {
                    // A worker outlives whatever it ran. The `image` crate
                    // decoding somebody's malformed JPEG is the one thing in
                    // here that could panic, and a pool that lost a thread to
                    // each one would end up serving nothing at all — which it
                    // would do silently, since the panic already happened on a
                    // thread nobody joins. The waiter is answered either way: a
                    // request by `Leader`'s `Drop`, and a background job by its
                    // sender being dropped unsent (see
                    // [`ImageWorkers::background`]).
                    let _ = std::panic::catch_unwind(AssertUnwindSafe(job));
                }
            });
        }
        Self(requests)
    }

    fn submit(&self, job: impl FnOnce() + Send + 'static) {
        self.0.push(Box::new(job));
    }

    /// Runs one piece of background work on these threads, behind every
    /// interactive request, and answers with what it produced.
    ///
    /// The pre-generation pass's way in, and the reason there are two lanes. It
    /// blocks, which is what keeps ADR 0012's one-thread budget: the pass hands
    /// over one wallpaper, waits for it, and hands over the next, so the machine
    /// never has more image work in flight than the pool was sized for. The
    /// caller's own thread is parked rather than decoding, so the pass costs a
    /// pool slot instead of a core of its own.
    ///
    /// `None` when the work never ran — a worker that panicked partway, or a
    /// pool that has been dropped, which only a test does. Both leave the sender
    /// dropped unsent, and neither leaves the caller waiting for an answer that
    /// is not coming.
    pub fn background<T>(&self, work: impl FnOnce() -> T + Send + 'static) -> Option<T>
    where
        T: Send + 'static,
    {
        let (done, answer) = mpsc::channel();
        self.0.push_background(Box::new(move || {
            let _ = done.send(work());
        }));
        answer.recv().ok()
    }
}

impl Drop for ImageWorkers {
    /// Production never drops the pool, but a test drops one per test, and a
    /// worker parked on a condvar nothing will ever notify would sit there for
    /// the life of the test binary.
    fn drop(&mut self) {
        self.0.close();
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
    use std::sync::mpsc;

    /// A library holding one 800x600 wallpaper, a cache directory beside it, a
    /// `Db` over an in-memory database, and the two tables a request passes
    /// through. No Tauri app and no protocol handler: the module's own interface
    /// is the whole seam.
    ///
    /// The two directories are separate, the way they are in production — the
    /// cache lives under `app_data` and the Library root is wherever the curator
    /// keeps their wallpapers. Sharing one would make emptying the cache delete
    /// the library, which is the difference between a test that clears a cache
    /// and one that only looks like it.
    struct Library {
        db: Db,
        memory: ImageCache,
        in_flight: InFlight,
        /// Deleted when the fixture is, which is what keeps every path below
        /// valid for the length of a test and no longer.
        _dir: tempfile::TempDir,
        cache: PathBuf,
        wallpaper_id: i64,
        source: PathBuf,
    }

    fn library() -> Library {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("thumbnails");
        let root = dir.path().join("wallpapers");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(&root).unwrap();

        let source = root.join("a.png");
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
            memory: ImageCache::new(IMAGE_CACHE_ENTRIES),
            in_flight: InFlight::default(),
            _dir: dir,
            cache,
            wallpaper_id,
            source,
        }
    }

    impl Library {
        fn cache_dir(&self) -> &Path {
            &self.cache
        }

        fn cache_file(&self, size: &str) -> PathBuf {
            self.cache.join(format!("{}_{size}.jpg", self.wallpaper_id))
        }

        fn serve(&self, size: Size) -> Response<Vec<u8>> {
            self.serve_with(size, thumbnails::fulfill)
        }

        fn serve_with<F>(&self, size: Size, fulfill: F) -> Response<Vec<u8>>
        where
            F: FnOnce(&Plan, &Path) -> Result<Resolved, AppError>,
        {
            answer(
                &self.db,
                self.cache_dir(),
                &self.memory,
                &self.in_flight,
                self.wallpaper_id,
                size,
                fulfill,
            )
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

    /// Spins until `settled`, and fails the test rather than hanging if it never
    /// is. The alternative is a sleep long enough to be safe on a loaded machine,
    /// which is a slow test that is still flaky.
    fn wait_until(what: &str, mut settled: impl FnMut() -> bool) {
        for _ in 0..2_000 {
            if settled() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        panic!("{what} never happened");
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
        // The file tier is this test's subject, and the memory tier answers
        // ahead of it. Forgetting is what a second launch does for free.
        library.memory.forget_all();
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
        // Nothing in memory revalidates, so the tier below it is where the
        // freshness rule lives and where this test looks.
        library.memory.forget_all();

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

        let response = answer(
            &library.db,
            library.cache_dir(),
            &library.memory,
            &library.in_flight,
            9999,
            Size::Small,
            thumbnails::fulfill,
        );

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

        let served = phases(
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

        assert!(image::load_from_memory(&served.bytes).is_ok());
    }

    #[test]
    fn a_repeat_request_is_answered_without_the_connection_or_the_disk() {
        // Everything a miss would need is taken away first: the row `plan`
        // reads, the source `fulfill` stats, and the cache file it reads. Any
        // request that reaches the connection is a 404 and any that reaches the
        // filesystem is a 500, so a 200 with the same bytes is the memory tier
        // and can be nothing else (ADR 0040).
        let library = library();
        let first = library.serve(Size::Small);

        library.db.write(|conn| {
            conn.execute("DELETE FROM wallpapers", []).unwrap();
            conn.execute("DELETE FROM thumbnails", []).unwrap();
        });
        std::fs::remove_file(&library.source).unwrap();
        std::fs::remove_file(library.cache_file("small")).unwrap();

        let second = library.serve(Size::Small);

        assert_eq!(second.status(), StatusCode::OK);
        assert_eq!(second.body(), first.body());
        assert_eq!(
            header(&second, tauri::http::header::CACHE_CONTROL),
            "max-age=300",
            "a memory hit is still cached by the webview for as long as any other"
        );
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
    fn clearing_the_thumbnail_cache_forgets_the_bytes_in_memory() {
        // Settings' Clear thumbnail cache, in the order `clear_cache` runs it:
        // files, then rows, then the bytes (ADR 0039, ADR 0040). With the source
        // gone as well, only the memory tier could still answer with a picture,
        // so an error is the proof that it did not.
        let library = library();
        library.serve(Size::Small);

        thumbnails::clear_cache_files(library.cache_dir()).unwrap();
        library.db.write(thumbnails::forget_thumbnails).unwrap();
        library.memory.forget_all();
        std::fs::remove_file(&library.source).unwrap();

        let response = library.serve(Size::Small);

        assert!(
            response.status().is_client_error() || response.status().is_server_error(),
            "a cleared thumbnail was still served from memory"
        );
    }

    #[test]
    fn purging_one_wallpapers_thumbnails_forgets_its_bytes_in_memory() {
        // The single-wallpaper case of the same three halves, and the reason
        // `ImageCache::forget` takes a wallpaper rather than a wallpaper and a
        // size: a purge is about the source file every size came off.
        let library = library();
        library.serve(Size::Small);

        thumbnails::purge_cache_files(library.cache_dir(), library.wallpaper_id).unwrap();
        library
            .db
            .write(|conn| thumbnails::purge_thumbnails(conn, library.wallpaper_id))
            .unwrap();
        library.memory.forget(library.wallpaper_id);
        std::fs::remove_file(&library.source).unwrap();

        let response = library.serve(Size::Small);

        assert!(
            response.status().is_client_error() || response.status().is_server_error(),
            "a purged thumbnail was still served from memory"
        );
    }

    #[test]
    fn regenerating_a_stale_thumbnail_forgets_the_wallpapers_bytes_in_memory() {
        // A wallpaper edited in place, discovered by a request for one size
        // while another size of it is held in memory. The source moved, so both
        // are stale, and only the size that missed can find that out.
        let library = library();
        library.serve(Size::Small);
        // Straight through the phases, so the medium reaches the disk and the
        // row without reaching memory — which is what makes the request below a
        // miss that has to plan.
        phases(
            &library.db,
            library.cache_dir(),
            library.wallpaper_id,
            Size::Medium,
            thumbnails::fulfill,
        )
        .unwrap();
        library.db.write(|conn| {
            conn.execute("UPDATE thumbnails SET source_mtime = 1", [])
                .unwrap();
        });

        let medium = library.serve(Size::Medium);
        assert_eq!(medium.status(), StatusCode::OK, "the medium regenerated");

        // With the source gone, an answer for the small can only come from
        // memory, and the regenerate above is what should have taken it out.
        std::fs::remove_file(&library.source).unwrap();
        let small = library.serve(Size::Small);

        assert!(
            small.status().is_client_error() || small.status().is_server_error(),
            "a stale small was still served from memory after its wallpaper regenerated"
        );
    }

    #[test]
    fn two_concurrent_requests_for_the_same_thumbnail_decode_once() {
        // The lightbox's filmstrip and the grid behind it, both asking for the
        // same `small`. The leader's phase two blocks until the follower is
        // parked on its flight, so the two are concurrent by construction rather
        // than by timing (ADR 0040).
        let library = Arc::new(library());
        let decodes = Arc::new(AtomicUsize::new(0));
        let (leader_started, leader_is_working) = mpsc::channel();
        let (release_leader, leader_may_finish) = mpsc::channel();

        let leader = {
            let library = Arc::clone(&library);
            let decodes = Arc::clone(&decodes);
            std::thread::spawn(move || {
                library.serve_with(Size::Small, move |plan, cache_dir| {
                    decodes.fetch_add(1, Ordering::SeqCst);
                    leader_started.send(()).unwrap();
                    leader_may_finish.recv().unwrap();
                    thumbnails::fulfill(plan, cache_dir)
                })
            })
        };
        leader_is_working.recv().unwrap();

        let follower = {
            let library = Arc::clone(&library);
            let decodes = Arc::clone(&decodes);
            std::thread::spawn(move || {
                library.serve_with(Size::Small, move |plan, cache_dir| {
                    decodes.fetch_add(1, Ordering::SeqCst);
                    thumbnails::fulfill(plan, cache_dir)
                })
            })
        };
        wait_until("the follower parked on the leader's flight", || {
            library
                .in_flight
                .followers(library.wallpaper_id, Size::Small)
                == 1
        });
        release_leader.send(()).unwrap();

        let leader = leader.join().unwrap();
        let follower = follower.join().unwrap();

        assert_eq!(
            decodes.load(Ordering::SeqCst),
            1,
            "both requests did the work"
        );
        assert_eq!(leader.status(), StatusCode::OK);
        assert_eq!(follower.status(), StatusCode::OK);
        assert_eq!(
            follower.body(),
            leader.body(),
            "the follower was answered with the leader's bytes"
        );
    }

    #[test]
    fn the_newest_request_is_served_first() {
        // One worker, so the order jobs come off the stack is the only thing the
        // recording can be about. The first job holds that worker until the rest
        // have been submitted, which is the state a wheel pass leaves the pool
        // in: more requests waiting than there are threads.
        let workers = ImageWorkers::new(1);
        let served = Arc::new(Mutex::new(Vec::new()));
        let (worker_busy, holding_the_worker) = mpsc::channel();
        let (release, may_finish) = mpsc::channel();

        {
            let served = Arc::clone(&served);
            workers.submit(move || {
                served.lock().unwrap().push(0);
                worker_busy.send(()).unwrap();
                may_finish.recv().unwrap();
            });
        }
        holding_the_worker.recv().unwrap();

        for request in 1..=5 {
            let served = Arc::clone(&served);
            workers.submit(move || served.lock().unwrap().push(request));
        }
        release.send(()).unwrap();
        wait_until("every request was served", || {
            served.lock().unwrap().len() == 6
        });

        assert_eq!(
            *served.lock().unwrap(),
            vec![0, 5, 4, 3, 2, 1],
            "the requests were not served newest first"
        );
    }

    #[test]
    fn a_request_that_waited_behind_two_hundred_others_is_still_served() {
        // Last in, first out is an order and not a bound: a card that scrolls
        // back into view waits longer under a stack than under a queue, and it
        // is never left blank.
        let workers = ImageWorkers::new(1);
        let served = Arc::new(Mutex::new(Vec::new()));
        let (worker_busy, holding_the_worker) = mpsc::channel();
        let (release, may_finish) = mpsc::channel();

        workers.submit(move || {
            worker_busy.send(()).unwrap();
            may_finish.recv().unwrap();
        });
        holding_the_worker.recv().unwrap();

        for request in 1..=200 {
            let served = Arc::clone(&served);
            workers.submit(move || served.lock().unwrap().push(request));
        }
        release.send(()).unwrap();
        wait_until("every request was served", || {
            served.lock().unwrap().len() == 200
        });

        let served = served.lock().unwrap();
        assert_eq!(served.len(), 200, "a request was dropped");
        assert_eq!(
            served.last().copied(),
            Some(1),
            "the request that waited longest was served, and served last"
        );
    }

    #[test]
    fn an_interactive_request_is_served_before_any_queued_background_work() {
        // The two producers, one worker, and the worker held busy while both
        // submit — which is the state the app is in whenever the curator browses
        // during a pre-generation pass. The pass works in an order unrelated to
        // what is on screen (`status = 'rejected' ASC, comparisons_count ASC`,
        // for the pair Rank will draw next), so what it has queued is almost
        // never what the curator is waiting for (#232).
        let workers = ImageWorkers::new(1);
        let served = Arc::new(Mutex::new(Vec::new()));
        let (worker_busy, holding_the_worker) = mpsc::channel();
        let (release, may_finish) = mpsc::channel();

        workers.submit(move || {
            worker_busy.send(()).unwrap();
            may_finish.recv().unwrap();
        });
        holding_the_worker.recv().unwrap();

        for wallpaper in 1..=3 {
            let served = Arc::clone(&served);
            // Not `background`, which waits for its answer: what is being
            // asserted is the order the stack is drained in, and a pass that
            // waited would only ever have one job in it.
            workers
                .0
                .push_background(Box::new(move || served.lock().unwrap().push(-wallpaper)));
        }
        for request in 1..=2 {
            let served = Arc::clone(&served);
            workers.submit(move || served.lock().unwrap().push(request));
        }
        release.send(()).unwrap();
        wait_until("every job was run", || served.lock().unwrap().len() == 5);

        assert_eq!(
            *served.lock().unwrap(),
            vec![2, 1, -1, -2, -3],
            "the background pass was served ahead of a request the curator is waiting for"
        );
    }

    #[test]
    fn background_work_already_under_way_is_finished_rather_than_overtaken() {
        // "Overtake" is the next thing off the stack and never a cancellation:
        // the `image` crate cannot be interrupted mid-decode, so a wallpaper the
        // pass has started is a wallpaper the pass finishes, and the request
        // that arrives meanwhile waits for a worker like any other (#232).
        let workers = ImageWorkers::new(1);
        let served = Arc::new(Mutex::new(Vec::new()));
        let (started, has_started) = mpsc::channel();
        let (release, may_finish) = mpsc::channel();

        {
            let served = Arc::clone(&served);
            workers.0.push_background(Box::new(move || {
                started.send(()).unwrap();
                may_finish.recv().unwrap();
                served.lock().unwrap().push("the pass's wallpaper");
            }));
        }
        has_started.recv().unwrap();

        {
            let served = Arc::clone(&served);
            workers.submit(move || served.lock().unwrap().push("the curator's request"));
        }
        assert!(
            served.lock().unwrap().is_empty(),
            "the decode under way was abandoned partway"
        );

        release.send(()).unwrap();
        wait_until("both jobs ran", || served.lock().unwrap().len() == 2);
        assert_eq!(
            *served.lock().unwrap(),
            vec!["the pass's wallpaper", "the curator's request"]
        );
    }

    #[test]
    fn the_pass_is_answered_with_what_its_wallpaper_produced() {
        // What `background` is for: the pass's own thread parks until a worker
        // takes the wallpaper, so it costs a pool slot rather than a core of its
        // own, and it comes away with the result as if it had done the work.
        let workers = ImageWorkers::new(1);

        let answer = workers.background(|| "both sizes written");

        assert_eq!(answer, Some("both sizes written"));
    }

    #[test]
    fn a_job_that_panics_costs_its_answer_and_not_the_worker() {
        // Every thread in this pool is one somebody is waiting on, and a panic
        // on a thread nobody joins is silent. So the worker outlives a decode
        // that panicked, the pass hears `None` rather than waiting forever, and
        // the next request is still served.
        let workers = ImageWorkers::new(1);

        let answer = workers.background(|| panic!("the decoder gave up"));

        assert_eq!(answer, None::<()>);
        assert_eq!(
            workers.background(|| "the pool still works"),
            Some("the pool still works")
        );
    }

    #[test]
    fn a_served_image_stays_cached_for_five_minutes() {
        // A remounted `<img>` for a wallpaper the user already scrolled past
        // must not cost another stack hop, mutex lock and cache-file read.
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
