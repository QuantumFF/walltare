//! The bytes of the last few hundred thumbnails, held in memory (ADR 0040).
//!
//! A tier behind [`ThumbnailCache`] and reachable only from it: what puts bytes
//! in and what takes them out are both operations on the cache, so nothing
//! outside `thumbnails` knows this exists.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use super::Size;
#[cfg(doc)]
use super::ThumbnailCache;

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
pub(super) const IMAGE_CACHE_ENTRIES: usize = 256;

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
/// Private to `thumbnails`, and that is the point of #280: bytes go in from
/// [`ThumbnailCache::answer`], and what takes them back out is the things that
/// invalidate a thumbnail, each of which is an operation here —
/// [`ThumbnailCache::clear`] forgets everything, and a regenerate through either
/// [`ThumbnailCache::answer`] or [`ThumbnailCache::warm`] forgets its wallpaper.
/// Nothing expires on a clock — see ADR 0040 for what that costs.
pub(super) struct ImageCache {
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
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(Entries::default()),
            capacity,
        }
    }

    /// The bytes for one wallpaper at one size, if they are still held, and a
    /// note that they were wanted.
    pub(super) fn get(&self, wallpaper_id: i64, size: Size) -> Option<Arc<Vec<u8>>> {
        let mut entries = self.entries();
        entries.clock += 1;
        let used = entries.clock;
        let held = entries.held.get_mut(&(wallpaper_id, size))?;
        held.used = used;
        Some(Arc::clone(&held.bytes))
    }

    /// Holds one thumbnail's bytes, evicting the coldest entries if that puts
    /// the map over its bound.
    pub(super) fn store(&self, wallpaper_id: i64, size: Size, bytes: Arc<Vec<u8>>) {
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
    pub(super) fn forget(&self, wallpaper_id: i64) {
        self.entries().held.retain(|(id, _), _| *id != wallpaper_id);
    }

    /// Forgets everything, for [`ThumbnailCache::clear`].
    pub(super) fn forget_all(&self) {
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
    pub(super) fn holds(&self, wallpaper_id: i64, size: Size) -> bool {
        self.entries().held.contains_key(&(wallpaper_id, size))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
