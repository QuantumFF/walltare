# ADR 0040: A thumbnail is served newest first, once, and from memory

**Status:** Accepted
**Ticket:** [#228](https://github.com/QuantumFF/walltare/issues/228)
**Date:** 2026-09-09

## Context

[#227](https://github.com/QuantumFF/walltare/issues/227) made answering a
`wallpaper://` request one module, behind `serve(id, size)`, and said in its own
closing lines that it held none of the behaviour changes it existed for. This is
those changes. Three costs, all read off the source in
[#224](https://github.com/QuantumFF/walltare/issues/224)'s architecture review
and none of them measured in frames.

**The queue was a FIFO, and a scrolling grid wants the opposite.** The pool took
its work off an unbounded `mpsc` channel in submission order.
[ADR 0016](0016-library-page-scale.md) virtualises the library grid, so a wheel
pass mounts and unmounts cards continuously: by the time a request reaches one of
the two to eight workers, the card that asked for it may have been unmounted and
remounted twice, and it was served ahead of the cards now on screen. The order is
worst exactly when it matters, because a fast scroll is what puts more requests
in the queue than there are threads.

**Nothing deduplicated two identical requests.** Both took the connection, both
decoded, both encoded, and both wrote the same cache file over each other.
[ADR 0022](0022-lightbox-shares-the-selection.md) makes this reachable without
contriving anything: the lightbox's filmstrip and the library grid behind it both
ask for the same wallpaper's `small`.

**A warm hit cost six things for bytes the process was holding a moment ago.** A
channel hop, two acquisitions of the single connection, a `stat` of the source, an
`exists` of the cache file, and a full read of it.
[ADR 0012](0012-thumbnail-pre-generation.md) measured what is being read: a
`small` averages 31KB and a `medium` 383KB.

ADR 0016 left the answer to that third one parked. It marked "whether WebKitGTK's
memory cache honours `max-age` for a custom scheme" unverified, named a frontend
`Map<id, blob>` bounded to a few hundred entries as the fallback if it does not,
and listed the callers that would want it: the library card, the review card, and
the lightbox's two assumptions — that stepping back finds the previous `medium`
cached, and that the first frame can scale up the card's `small` for free.
[#225](https://github.com/QuantumFF/walltare/issues/225) is the measurement that
would settle the header question and it has not reported.

## Decision

### The pool takes the newest request first

`ImageWorkers` keeps a `Vec<Job>` under a mutex with a condvar, and a worker pops
the end. Last in, first out.

The newest request is the one whose card is most likely still visible, and that is
the whole argument. It is not a claim that older requests do not matter — it is
that when the queue is deep, the queue is deep *because* the curator is moving,
and every request in it that is not the newest was made by a card that has had
more time to leave.

**Nothing is dropped.** The stack is unbounded and every job that goes in comes
out, so a card that scrolls back into view is served later rather than left blank.
Under a stack a request that waited waits longer than it would have under a queue,
which is the cost, and being blank forever is not on the table.

### A request that arrives while an identical one is in flight joins it

`InFlight` is a map from `(wallpaper_id, size)` to a flight. The first request for
a key takes the flight and does the work; every later one parks on the flight's
condvar and is handed the leader's answer, bytes or error, by `Arc`.

A leader that panics still publishes. The `image` crate decoding somebody's
malformed JPEG is the one thing in this path that could, and a follower parked on
a condvar nothing will notify would wait for the life of the process while holding
one of the pool's threads. So the leader is a guard whose `Drop` settles the
flight either way, with a 500 if it has nothing better.

The waiting happens on a pool thread. That is a worker not decoding for as long as
the leader takes, bounded by the pool at worst every worker but one parked on the
same image — and strictly cheaper than what it replaces, which was every one of
those workers decoding the same source.

### The last 256 thumbnails stay in memory

`ImageCache` holds `Arc<Vec<u8>>` keyed on the wallpaper and the size, bounded by
`IMAGE_CACHE_ENTRIES = 256`, evicting whichever entry has gone unasked-for
longest.

**The bound is an entry count, and it bounds memory because an entry's size is
bounded.** ADR 0012 measured a `small` at about 31KB and a `medium` at about
383KB, and neither is a property of the source: `small` is at most 400px wide and
`medium` at most 1920. So 256 entries is about 8MB in the shape a scroll produces,
all `small`s, and about 98MB in the pathological case of nothing but `medium`s,
which takes 256 lightbox steps with no revisit to reach. Against the 2GB of disk
cache ADR 0016 already allows at its ceiling, the first number is nothing and the
second is affordable.

256 is chosen to hold more than the views can show. Review mounts fifty cards and
Library's virtual window with ADR 0016's one row of overscan is around thirty
five, so both grids fit at once with several screens of scrollback and the
lightbox's `medium`s beside them, and a wheel gesture down and back up hits memory
the whole way.

**`full` is never held.** An entry count bounds memory only while an entry's size
is bounded, and `full` re-encodes the source at whatever resolution it has — one
entry could be tens of megabytes and 256 of them gigabytes. ADR 0012 already
observed that no caller asks for `full`, and ADR 0016's third-size argument keeps
it that way, so this costs nothing and it keeps the constant's arithmetic closed.

**Least recently used, by a scan of the stamps.** Every read and every insert
ticks a counter and writes it on the entry, and an insert over the bound removes
the smallest. That is up to 256 integer comparisons, on an insert that has just
paid a cache-file read or a whole decode, so the O(n) is invisible and there is no
intrusive list to get wrong.

**A hit answers on the thread Tauri calls the protocol handler on.** That is the
UI thread, and ADR 0004 is emphatic that a miss must never be answered there — but
what a hit does is take a mutex held for a hash lookup and copy at most a
`medium`. Never a `stat`, never a file read, never a decode, and never a lock any
of those are holding. The channel hop is one of the six costs above and this is
the only place it can be removed, so it is removed.

**The bytes go when the thumbnail goes.** Three signals, which are the three
things that already invalidate a thumbnail:

- Settings' Clear thumbnail cache calls `ImageCache::forget_all`, third after the
  files and the rows, in that order and for
  [ADR 0039](0039-the-connection-lock-is-taken-for-queries.md)'s reasons.
- A purge of one wallpaper calls `ImageCache::forget`, which takes a wallpaper and
  not a size: a purge is about the source file every size came off.
- A regenerate calls the same thing, from inside the module. Bytes that were just
  generated were made from the source as it is now, so every other size of that
  wallpaper in memory was made from an older read of it, and the source's mtime
  moving is the only thing that invalidates a thumbnail at all (ADR 0016). A first
  generation of a second size lands here too and drops a sibling that was in fact
  still fresh; that costs one cache-file read, and keeping a stale one would show
  the curator the wrong picture.

`purge` was one function doing rows and then files under one connection, which
ADR 0039 recorded as a debt owed by whoever gave it a caller. It got one in a test
and so it is two halves now, `purge_cache_files` and `purge_thumbnails`. It still
has no production caller.

**`Cache-Control: max-age=300` is untouched**, and so is the 30 seconds #227 gave
a failure. This ADR does not replace either. A memory hit is served with the same
five minutes as any other response, because what the header says is how long the
answer stays true, and that is a property of the thumbnail rather than of which
tier answered.

### This is where ADR 0016's `Map<id, blob>` went

Behind the serving module, on the Rust side, and ADR 0016's fallback is settled
rather than still parked.

It serves all three of the callers that ADR named without any of them knowing it
exists: the library card and the review card share a component that asks for
`small`, the lightbox's filmstrip asks for the same `small` the grid behind it
already has, and stepping back through the lightbox asks for a `medium` it asked
for two steps ago. None of them changed. Neither did `wallpaperImageUrl`, and
nothing in `src/` learned a new concept.

It is also the side that already holds the bytes. A frontend map would hold a
second copy of them in the webview's heap, and would have to be handed a blob URL
per entry, revoked per eviction, and threaded through three components that
currently pass a string.

**#225 has not reported, and this cache is worth having either way.** If the
measurement comes back saying WebKitGTK's memory cache does honour `max-age` for a
custom scheme, then a remount inside the five minutes never reaches this module at
all and the overlap is real. What is left over is the first paint of a view — the
first time Review is entered, the first scroll into fresh rows, the first launch
after the pre-generation pass — where there is no webview cache entry yet by
definition, and where ADR 0006's 50 concurrent requests are what
[ADR 0015](0015-navigation-shell.md) and ADR 0016 both cite ~25 dropped frames
for. Saying that here rather than leaving it implied is the point: nobody should
read a positive #225 result as a reason to take this out.

### What this does to ADR 0015's reasoning, which it does not settle

ADR 0015 keeps Rank, Review and Library mounted under `display: none`, and its
stated reason is what a remount costs: "remounting Review is 50 complete IPC round
trips and 50 cache-file reads", the ~25 dropped frames ADR 0006 measured on
entering Review, "paid again every time the user glances at Library and comes
back", against a `get_review` that costs 0.3ms.

Most of that cost is now gone. Counted off the source for a remount of Review's
fifty cards, warm, with every thumbnail already in memory:

| a remount of Review costs | before | after |
| --- | --- | --- |
| requests that reach a worker thread | 50 | 0 |
| acquisitions of the single connection | 100 | 0 |
| prepared queries under it | up to 200 | 0 |
| filesystem calls (`stat`, `exists`, read) | ~150 | 0 |
| bytes read off disk | ~1.55MB | 0 |
| what is left | | 50 hash lookups and ~1.55MB of memcpy |

Two acquisitions per request because `phases` takes the connection for `plan` and
again for `record`, which is a no-op on a hit but still takes the lock. Up to four
prepared queries per request because `plan` reads the path, the row for the size
asked for, and `Size::donors`' two candidates. These are counts, not times:
nothing here has been measured in frames, and the honest statement is that a
remount stopped touching the connection and the disk, not that it stopped dropping
frames.

**The question is therefore open, and this ADR deliberately does not answer it.**
ADR 0015 gave two reasons for staying mounted and this only answers one. The other
was rendered DOM, and a Library page holding a virtual window over 5,000 rows
still rebuilds its React tree, its virtualiser and its scroll position on every
tab switch. Rank's reason is untouched too: its prefetched pair is state rather
than pixels, and a remount throws it away.

So the shape of the open question is narrower than "should views unmount". It is:
Review is the view whose remount cost was almost entirely images, its DOM is
bounded by `REVIEW_LIMIT`, and it is the one whose case for staying mounted this
change most weakens. What would settle it is the measurement ADR 0015 already
wrote a pass condition for — "showing a previously-hidden Library or Review drops
no more frames than remounting it does" — now that remounting is much cheaper than
the number that condition was written against. #225's harness is the one that would
run it. Nothing in this epic acts on it, and the reason it is written down with
numbers beside it is so that whoever does, decides it rather than drifting into it.

## Alternatives rejected

**Leave the FIFO and let `overscan: 1` cover it.** ADR 0016 already bounds how far
ahead the grid mounts, so the queue's depth is bounded by how fast the curator
scrolls rather than by the library's size. That is an argument that the FIFO is
survivable, not that it is right, and the change is a `Vec` and a `pop`.

**A priority queue with an interactive class and a background class.** That is
what ADR 0012 rejected when it gave pre-generation its own thread, on the grounds
that `mpsc` has no priority and teaching every worker to drain two queues was more
machinery than one thread was worth. A stack is not an `mpsc`, so that bullet's
premise is gone — but reversing the bullet means putting the pre-generation pass
through this admission point, which is
[#232](https://github.com/QuantumFF/walltare/issues/232) and not this ticket. This
ADR builds the admission point and wires nothing into it. ADR 0012's rejected list
is #232's to amend, because #232 is what reverses the decision rather than what
removes its premise.

**Drop a request whose card has unmounted.** The strictly better order, and it
needs the frontend to say so: an `AbortController` per card, a cancellation
message, and a key on the queue entry to match it against. It also trades a blank
card for a saved decode in every case where the guess is wrong, and under
virtualisation a card that just unmounted is a card that is about to remount. LIFO
gets most of the benefit by reordering rather than by cancelling, and the epic's
own constraint is that nothing here adds a dependency or a protocol.

**Bound the cache by bytes rather than by entries.** The bound this would fix is
real — 256 `medium`s is 98MB and 256 `small`s is 8MB, so an entry count admits a
twelvefold spread. It costs a running total, a per-entry length, and an eviction
loop that can evict several entries for one insert, and #228 asked for an entry
count. Excluding `full` is what closes the spread's top end, which is where the
number stopped being affordable. The trigger to revisit is a third cached size, or
a caller that asks for `full`.

**Expire an entry after `max-age`'s five minutes.** It would keep the staleness
window exactly where ADR 0016 put it, which is the one property the memory tier
changes for the worse (see the consequences). It also adds a clock to a cache
whose whole interface is a hash lookup, and makes a hit conditional on something
other than the entry being present — which is what a `stat` would have been, and
avoiding the `stat` is the point. ADR 0016's own reasoning applies unchanged: an
edit in place is rare, and nothing in the app regenerates a thumbnail on a timer.

**The `lru` crate.** Correct, intrusive, and a seventh dependency on a crate that
has kept to six. A stamp per entry and a `min_by_key` over 256 of them is twenty
lines and no unsafe.

**Have the leader answer every follower's `UriSchemeResponder` directly.** The
better design on paper: a duplicate request would never enter the queue or occupy
a worker at all, because it would leave its responder on the flight and return.
It puts deduplication above the seam a test can reach, though — the responder only
exists inside the protocol closure, so the property "two concurrent requests decode
once" would be asserted by nothing. The pool is what bounds the cost of parking
anyway, and #227 bought the testable seam at some expense.

**Deduplicate in the frontend.** A module-level map of in-flight `src` values
would collapse the filmstrip-and-grid case, and it cannot collapse the general one:
two `<img>` elements with the same `src` are two requests the browser makes, and
nothing in `src/` is between them and WebKit.

**An `ETag`, a versioned URL, or a third cached size.** All three were argued and
rejected in ADR 0016 and nothing here reopens them. The memory tier makes the
`ETag` case worse rather than better: a conditional request pays the round trip,
which is the cost, and a hit here pays no round trip at all.

## Consequences

**A wallpaper edited in place can now be served stale for the life of the
process.** This is the one property that gets worse. Before, the window was five
minutes plus a remount: `max-age` expired, the request reached `plan`, the mtime
disagreed and it regenerated. Now the memory tier answers first and revalidates
nothing, so the entry serves the old picture until it is evicted, purged, or the
app is relaunched. ADR 0016 accepted five minutes of this and observed that "in
practice the window is until the next launch either way" because nothing
regenerates on a timer; that observation is now true rather than nearly true. It is
accepted for ADR 0016's reason — an edit in place is rare, and the fix is a
versioning scheme that ADR rejected — and the escape hatches are Clear thumbnail
cache and a relaunch.

**The pre-generation pass can regenerate behind the cache's back.** A pass that
finds a stale pair writes both files and both rows without going through this
module, so bytes in memory for that wallpaper survive it. The window is narrow:
the pass runs at launch, when the cache is empty, and after a scan, which does not
change an existing file's mtime. #232 closes it properly by putting the pass
through the same admission point, at which point its regenerates invalidate the
same way an on-demand one does.

**Resident memory grows by up to 98MB, and by about 8MB in the shape the app
actually produces.** Bounded, and it is a bound rather than a measurement.

**A follower occupies a pool thread while it waits.** Bounded by the pool, and the
requests behind it are answered from memory the moment the leader lands.

**`serve` reads the cache on the UI thread.** The one thing in this module that
runs there. It is a mutex held for a hash lookup and a `Vec` copy of at most
383KB, and the invariant that keeps it defensible is that nothing else ever holds
that mutex for longer than the same lookup. A future addition that holds it across
a file read or an eviction that walks something unbounded would break ADR 0004's
rule through this door.

**`thumbnails::purge` is two functions and still has no production caller.** The
`#[allow(dead_code)]` moved with it. Whoever gives it a caller now owes it three
halves rather than two: the files, the rows, and `ImageCache::forget`.

**Nothing already measured is undone.** ADR 0004's three phases with the decode
outside the lock, `Size::donors` including the lookup that runs when a row exists,
the box pre-reduce before Lanczos3, `generate_both`'s single decode for two sizes,
`overscan: 1`, the dev profile's `opt-level = 3`: all unchanged. The test that
pins the connection being free across phase two still runs, against the same
parameterised phase two, and the two `Cache-Control` tests still pin both headers.

**Three properties are pinned by tests that could not have been written before
#227.** The order more requests than workers are served in, one decode for two
concurrent identical requests, and a repeat request answered with its wallpaper's
row deleted, its source deleted and its cache file deleted — which is the only way
to say "it touched neither the connection nor the filesystem" and have it mean
something.
