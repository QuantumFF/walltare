# ADR 0012: Thumbnails are generated ahead of the pair that will need them

**Status:** Accepted
**Ticket:** [#42](https://github.com/QuantumFF/walltare/issues/42)
**Date:** 2026-08-24

## Context

[ADR 0006](0006-first-view-thumbnail-latency.md) listed pre-generation under
"Alternatives rejected" and said why: it is the real fix for first-view
latency, it is a feature rather than a bug fix, and the numbers in that ADR are
what should size it. Those numbers, against the 120-wallpaper test library with
a cold cache at medium size, are 386ms mean and 1962ms worst in release. So a
first-view thumbnail mid-session still costs somewhere between a third of a
second and two seconds, and ADR 0006's spinner makes that visible rather than
absent.

[ADR 0007](0007-review-card-layer-promotion.md) names pre-generation for the
same reason from the review grid's side.

The charting round for [the map](https://github.com/QuantumFF/walltare/issues/37)
settled the outline before this ticket opened: it runs after a scan and on
launch for anything missing, it generates `small` and `medium` only, it shows
cancellable progress, and it must never starve an on-demand `wallpaper://`
request. Everything below is what was left.

Two measurements taken while resolving this ticket size the rest of it. On a
real cache directory, 120 `medium` files occupy 46MB and 52 `small` files
occupy 1.6MB, so a medium averages 383KB, a small 31KB, and a fully warm
wallpaper costs about 414KB. And no caller anywhere asks for `full`:
`wallpaperImageUrl` defaults to it, but `RankView` passes `medium` and
`ReviewView` passes `small`, and the cache directory holds zero `*_full.jpg`.
The cache is exactly two files per wallpaper.

## Decision

### One dedicated background thread, not `ImageWorkers`

`ImageWorkers` is a fixed pool of 2 to 8 threads fed by one `mpsc` channel with
no priority. Anything submitted into it queues ahead of the rank view's next
pair, which is the exact latency this ADR exists to remove. Pre-generation gets
its own single thread instead.

Single-threaded it costs roughly 420ms per wallpaper: ADR 0006's 386ms mean
plus one extra encode for the small. That is 50 seconds for the 120-wallpaper
test library and about 14 minutes for the low-thousands library the overhaul
targets. A four-thread pool would cut the latter to three and a half minutes
and take half an eight-core machine away from the user while they rank. One
thread takes 1/N of an N-core machine, the ordering below means the wallpapers
the user reaches first are done in the opening seconds, and the tail only
matters once, on a first launch.

The single `Db` mutex needs no special handling. ADR 0004's three phases
already put the whole decode outside the lock: `plan` and `record` are two fast
queries and `fulfill` holds nothing. Pre-generation takes the mutex for a few
hundred microseconds per 420ms of work.

### Work order, and one decode for two sizes

The queue is the eligible pool ordered by `comparisons_count ASC, id ASC`.

> **Amended by [ADR 0016](0016-library-page-scale.md), 2026-08-25.** The queue is
> the whole `wallpapers` table ordered by
> `status = 'rejected' ASC, comparisons_count ASC, id ASC`, so rejects form a
> tail group behind the eligible pool. See the amendment at the end of this
> section.

The competing rule was `rating_mu ASC`, which matches what Review shows. It
loses because `select_pair` draws its *first* wallpaper from the least-compared
ties, and its second by a Gaussian weight over the whole pool. Only the first
is targetable, and `comparisons_count ASC` targets it exactly. A scan inserts
rows at count 0, so freshly scanned files land at the head of the queue and are
also precisely what the next pair is drawn from.

Per wallpaper, the pass decodes the source once and writes both sizes from that
single decoded image: downscale to medium, write it, downscale that same
in-memory image to small, write it. This is the one thing pre-generation can do
that the on-demand path cannot. On demand a `small` costs a JPEG decode of the
medium, which ADR 0006 measured at 106ms for the worst file. Here it is a
second `resize_exact` on an image already in memory.

Ordering by what is needed next, plus finishing each wallpaper before starting
the next, means a cancelled pass leaves a clean prefix: everything before the
cut is fully warm, in the order the user will reach it.

### Building the work list without reading the cache

On every launch after the first, almost nothing is missing. Walking the library
through `plan` and `fulfill` would return cache hits, and `fulfill` reads the
whole cache file into memory on a hit. That is 830MB of pointless disk reads
per launch on a 2000-wallpaper library.

So the work list is built without `fulfill`. One query for
`(id, path, small_mtime, medium_mtime)` over the eligible pool, one `read_dir`
of the cache directory into a set of filenames, and one `stat` per source file.
A wallpaper joins the list when a size has no row, no cache file, or a recorded
mtime that no longer matches the source. That is one query, one directory read,
and N stats: milliseconds, and no image bytes read at all. Its length is also
the honest total for the progress below, because skipped wallpapers never enter
it.

> **Amended by [#100](https://github.com/QuantumFF/walltare/issues/100),
> 2026-08-27.** The query runs over every row rather than over the eligible
> pool, as the ADR 0016 amendment below requires, and it carries the row's
> Status as a fifth column so the re-check above has the Status the list saw.

### The `thumbnails` API this needs

Split by case, so the donor logic keeps earning its place.

When both sizes are missing, which is every freshly scanned wallpaper, a new
`generate_both(wallpaper_id, source, cache_dir) -> Result<[Recorded; 2]>` does
the single decode described above. It carries no donor lookup and no freshness
check, because the work list already established both are missing. It returns
dimensions and mtime only, never JPEG bytes, so the pass never holds two
encoded buffers it has no use for.

When only one size is missing, pre-generation calls the existing `plan` /
`fulfill` / `record`. "Small is missing, medium is fresh" is exactly the case
`Size::donors` was built for, and decoding the source again would be worse.

`record` is split so both paths share the write: `record_one(conn,
wallpaper_id, size, width, height, source_mtime)` does the upsert, and the
existing `record` becomes a wrapper over it.

### Starting, cancelling, and restarting

Three new commands: `start_pregen`, `cancel_pregen`, and `clear_cache`.

The frontend owns the trigger, the way it already owns `start_scan`. It calls
`start_pregen` once after the boot gate from [ADR 0010](0010-settings-store.md)
resolves, and again on `scan-complete`. Settings gets a "Generate now" button
over the same command for free. Spawning the thread from `setup()` instead
would start decoding before the window paints, competing with WebKit's startup
for the first frame.

State holds `Pregen(Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>>)`. The
cancel flag is per run, not global, so a scan's cancel cannot land on the run
that starts a moment later. `start_pregen` returns immediately after spawning a
supervisor thread; the supervisor takes the mutex, sets the predecessor's flag,
joins it, then builds the work list and runs. Two `start_pregen` calls
serialize on that mutex rather than racing. The `Option` is the running state,
so there is no separate `ScanRunning`-style bool, and dropping the entry is
what clears it.

`cancel_pregen` and `start_scan` both set the current run's flag and return.
Neither waits. Joining on the IPC thread would block for up to one wallpaper's
decode, and neither has a correctness reason to wait: a scan running alongside
a dying pass only means a few hundred milliseconds of work happens in a
slightly wrong order, and the restart on `scan-complete` covers the new files.
The flag is read between wallpapers, so a cancel lands up to one decode late.
The `image` crate cannot be interrupted mid-decode.

A cancel leaves everything already generated on disk and in the `thumbnails`
table. A partial cache is a correct cache.

Cancel means "not now", not "not ever". There is no settings key for it,
because the launch pass finds nothing to do on every launch after the first, so
a permanent opt-out would be a toggle for a one-time cost.

The pass re-checks a wallpaper's status inside the same lock it takes for its
own read, immediately before generating, and skips one that is no longer
eligible. The work list is a snapshot, and a reject can land in the middle of
it.

> **Amended by [#101](https://github.com/QuantumFF/walltare/issues/101),
> 2026-08-27.** The re-check compares the row against the Status the work list
> saw, not against Eligible. Measured against Eligible it drops the Rejected
> tail group that the ADR 0016 amendment below added, because every wallpaper in
> that group is already Rejected when its turn comes, so the library page would
> pay first-view latency for all of them. The same read carries the row's
> current `path`, and the pass generates from that rather than from the
> snapshot's copy, since a reject or a Restore moves the file after the list was
> built.

### Progress

`pregen-progress { done, total }`, carrying `total` in every emission so the
frontend needs no start event and survives a missed one, plus one emission with
`done: 0` before the first wallpaper so the bar appears immediately instead of
after a two-second decode. Then `pregen-complete { generated, failed,
cancelled }`.

These are separate events rather than an extension of `scan-progress`, whose
payload is `{scanned, added}` and which pre-generation cannot fill on a launch
pass with no scan in sight. The frontend joins them for presentation: a scan
and the pre-generation that follows it render as one progress area with two
phases, because two bars for one click is worse than one bar that admits it has
two parts. Where that area sits in the shell depends on the nav shell and stays
with [#45](https://github.com/QuantumFF/walltare/issues/45).

> **Amended by [ADR 0021](0021-background-work-is-a-pinned-toast.md),
> 2026-08-26.** The area is a pinned toast in
> [ADR 0017](0017-one-toast-at-a-time.md)'s viewport, on a slot below the
> transitions, and the two phases stay joined as one report that changes what
> it says. **Only pre-generation draws a bar.** `scan-progress` carries no
> total, `collect_images` finishes before the first event so the walk is
> silent, and the emitting loop is chunked at 256 inserts, so the live
> 120-wallpaper library fires one `scan-progress` at 100%. The scan phase is a
> line that counts up. The joined presentation this paragraph asks for happens
> across two layers rather than in one bar: `scan-complete` covers the report
> for eight seconds while pre-generation starts underneath it.

A missing or undecodable source increments `failed` and the pass continues.
There is no per-item event and no `pregen-failed`: the only whole-run failure
is the database being gone, which is already fatal everywhere else.

When the work list comes back empty, which is every launch after the first, the
pass emits nothing at all. Otherwise every launch would flash a finished
progress bar for work that never happened.

### The cache has no cap and no eviction

The cache is bounded by the library at two files per wallpaper: about 830MB for
2000 wallpapers, 2GB for 5000. That is not the shape an LRU cache has, and an
eviction policy would fight pre-generation directly, generating and evicting
the same files.

Settings gets a cache size readout and a "Clear thumbnail cache" button, over a
`get_cache_size` command and the `clear_cache` above.

> **Amended by [ADR 0020](0020-settings-page.md), 2026-08-26.**
> `get_cache_size` returns `CacheSize { bytes: u64, files: u64 }`, read on mount,
> on `pregen-complete` and after a clear, never per progress event. Clearing
> confirms through the `alert-dialog` component with the size in the sentence,
> because act-then-undo has nothing to undo here and a misclick costs minutes of
> decoding. **Generate now becomes Cancel while a pass runs**, which is where
> `cancel_pregen` lives: this ADR added the command and gave it no home, and
> [#59](https://github.com/QuantumFF/walltare/issues/59) owns reporting rather
> than control. 830MB of invisible data
under `app_data` deserves a visible number and a way out. Clearing cancels any
running pass, empties the cache directory, runs `DELETE FROM thumbnails`, and
does not restart. `thumbnails::purge` stays the single-wallpaper case.

### A reject stops purging thumbnails

`move_wallpaper` purges a wallpaper's thumbnails on reject. That was right when
Rejected sat out of voting and review and was terminal. It is not right any
more: the library page shows all three statuses filterable, and
[ADR 0009](0009-reject-is-reversible.md) made Rejected reversible.

`move_wallpaper` already updates `path` to the reject destination, and the move
preserves the file's mtime, so a rejected wallpaper's thumbnails stay valid and
resolve exactly as before. Purging them means the library page pays first-view
latency for every rejected wallpaper the user scrolls past, and a Restore pays
it again, all to regenerate byte-identical output. So the purge goes.

This also answers the question ADR 0009 left to this ticket. A restore triggers
no pre-generation, because a wallpaper rejected after this ships still has its
cache, and one rejected before it has no Origin and cannot be restored at all.

The work list stays eligible-only, Active and Kept. Wallpapers rejected before
this ships had their thumbnails purged and will not be pre-generated, because
generating files the user has already thrown out is the wrong default. They
regenerate on demand, once each, and then stay cached, since nothing purges any
more.

### Amendment: rejects are a tail group, not an exclusion

**[ADR 0016](0016-library-page-scale.md), 2026-08-25.** The paragraph above is
reversed. The work list is every row in `wallpapers`, ordered by
`status = 'rejected' ASC, comparisons_count ASC, id ASC`.

The library page that ADR 0016 specifies defaults to a filter of All, so half of
its default view is a status this pass never queued. The gap is narrow. A
wallpaper rejected from Review has a low Score, which takes comparisons, which
means the pass reached it long ago, and the purge is already gone. But a reject
straight from the library page on a freshly scanned library escapes it, and that
path is new.

`move_wallpaper` updates `path` and `filename`, so a Rejected row points at the
file in its new folder and pre-generates with no special handling. The tail runs
last, so the eligible pool pays nothing, and a Restore moves a row up the queue
on the next pass.

The justification widens with it. "Ahead of the pair that will need them" becomes
"ahead of any view that can show them", and the cost is 414KB per rejected
wallpaper on a cache that already has no cap and no eviction.

## Alternatives rejected

**Submit pre-generation into `ImageWorkers` with a priority scheme.** It reuses
a pool that already exists and already bounds memory. But `mpsc` has no
priority, so it would mean replacing the channel with a two-queue structure and
teaching every worker to drain the interactive queue first. That is more
machinery than one thread, for a background task nobody is waiting on.

**Order by `rating_mu ASC` to match Review.** Review is a considered pass over
a grid of `small` thumbnails, where a few hundred milliseconds per card is
survivable and the donor rule from ADR 0006 already helps. The rank view is the
one place a wait blocks the user's next action, and ADR 0006's arrival gate
makes that literal.

**Run `plan` and `fulfill` over the library to find the work.** It reuses the
freshness logic exactly, with no second implementation of "is this stale". It
also reads the entire cache off disk on every launch to discover that nothing
needs doing.

**Two passes, all mediums then all smalls.** A cancelled run would leave every
wallpaper with a medium, which makes every later `small` cheap through the
donor rule. But it doubles the decodes for anything the pass does complete, and
the prefix a single pass leaves is ordered by what the user reaches first,
which is worth more than a uniformly half-warm library.

**A `pregen_enabled` settings key.** The pass costs nothing on a warm library,
so the toggle would exist for a one-time cost and would then sit in Settings
forever meaning nothing.

**Keep the purge and let the library page regenerate on demand.** Correct, and
one fewer behaviour change. It also spends a full source decode per rejected
card to reproduce the bytes it just deleted.

## Consequences

The first pair after scanning a brand new library is still cold. Everything in
it sits at `comparisons_count` 0, so the queue's order among them is arbitrary
and `select_pair` draws from the whole set at random. The hit rate climbs
linearly as the pass works through. The case this ADR does fix outright is the
common one: an incremental scan that adds a handful of files to an established
library puts those files at the head of the queue and warms them in seconds.

The second pane of a pair is warmed only incidentally. `select_pair` picks it
by a Gaussian weight over the whole eligible pool, and a fresh wallpaper's σ of
8.33 makes that weight broad enough to reach almost anywhere. Nothing here can
target it, and ADR 0006's arrival gate means a cold second pane still blocks
the pick.

Clearing the cache is a rebuild, not a way to reclaim disk. The next launch
refills it, because the pass has no opt-out. If that turns out to annoy, the
escape hatch is one row in the settings table.

`bun tauri dev` builds debug, where ADR 0006 measured a mean of 1387ms per
thumbnail after the dependency opt-level fix. A full pass over a large library
in dev takes several times the release estimate, so the progress bar will look
alarming in development and ordinary in a release build.

The frontend owns the trigger, so a frontend that stops calling `start_pregen`
leaves the cache cold and says nothing. `start_scan` has the same property
today.

Nothing generates `full`, and nothing requests it. `Size::Full` stays in the
resolver as the donor of last resort and as the shape the URL parser accepts.
