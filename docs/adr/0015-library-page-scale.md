# ADR 0015: The library page fetches every row and mounts a window of cards

**Status:** Accepted
**Ticket:** [#46](https://github.com/QuantumFF/walltare/issues/46)
**Date:** 2026-08-25

## Context

[ADR 0014](0014-library-page-ordering.md) settled what the library page is
ordered by and left the command signature, the pagination shape and the indexes
here. `get_review` is the only listing command in the app: one `limit`,
`rating_mu ASC`, Active only, fifty rows, and a grid that mounts all fifty at
once and never changes.

The design target is a library in the low thousands, which is one to two orders
of magnitude past anything the app has been measured against.

Four things in the existing code set the shape of every decision below.

**Every `wallpaper://` request takes the single `Db` mutex twice.**
`resolve_image` calls `thumbnails::plan` (a read) and `thumbnails::record` (an
`INSERT OR REPLACE`) around `fulfill`. The same mutex serves `get_pair`, `vote`,
and [ADR 0012](0012-thumbnail-pre-generation.md)'s background pass.

**The image response carries `Cache-Control: max-age=0, must-revalidate` and no
validator**, no `ETag` and no `Last-Modified`, so WebKit cannot make a
conditional request and re-fetches in full. The comment above that header says
why, and bounds its own reasoning: "Revalidation costs a cache-file read, which
is what we want anyway." That was written for fifty cards that mount once.

**A `Wallpaper` is seven scalar fields**, two of them path strings, so roughly
200 bytes of JSON a row. [ADR 0009](0009-reject-is-reversible.md) adds
`origin_path`.

**[ADR 0007](0007-review-card-layer-promotion.md) closes with an instruction
this ticket has to answer**: "If the grid ever grows to hundreds of cards, or
gets virtualised, re-measure rather than assuming this still holds."

## Decision

### The ceiling is 5,000

5,000 wallpapers is the size that has to feel good. Above it the app stays
correct and gets slower, with nothing that breaks outright. ADR 0012 already
anchors on this range, about fourteen minutes of pre-generation for 2,000, and
5,000 wallpapers at 414KB of cache each is 2GB, which is where a real collection
stops.

### One command, one call, every matching row

```
list_wallpapers(filter, ordering) -> Vec<Wallpaper>
```

No offset, no cursor, no page size. At the ceiling the whole list is about 1MB
of JSON and one SQLite scan, and ADR 0014 already accepts an in-memory sort for
both Score orderings. Fetching everything deletes the keyset-versus-offset
question, the index question, and every page-boundary bug, and the row count is
the total so nothing needs a second query to say how big the library is.

Both arguments are serde enums on the Rust side and string-literal unions on the
TypeScript side, so an unknown value fails to deserialize rather than reaching
the SQL builder. Wire values are `all` / `active` / `kept` / `rejected`, default
`all`, and `score_desc` / `score_asc` / `filename_asc` / `recently_added`,
default `score_desc`. This is ADR 0014's "the frontend picks a name, never a
column or a direction" given a type.

**The filter offers four statuses and not Eligible.** Eligible is a voting-pool
term. On a browsing surface it reads as "everything I haven't thrown out", which
is what All already shows with the rejects greyed, and putting a term with a
precise domain meaning on a chip invites a looser reading of it.

One clause of ADR 0014 loses its force here: "the pagination that #46 picks
needs the backend to know the key anyway." There is no pagination. The
frontend-picks-a-name decision stands on the injection ground by itself.

ADR 0014's `id` tiebreak survives, for a different reason than the one it was
written for. It is no longer stopping a card from duplicating across pages; it
is stopping the 101-row tie in the live library from reshuffling under the user
after every vote.

### The grid virtualises; the card animates nothing

The DOM mounts a window of cards, not the list. `@tanstack/react-virtual`,
headless, with **one row of overscan above and below**. Rendering 5,000 cards
outright is ruled out by ADR 0007's own arithmetic: 5,000 images and 5,000
overlays each declaring `will-change` is 10,000 composited textures.

**The library card animates no property on hover and declares no
`will-change`.** The overlay toggles opacity with no transition and the image
does not scale. This is the reading of ADR 0007's closing instruction that costs
nothing to be wrong about: the licence stays scoped to `REVIEW_LIMIT` exactly as
written and is not extended by assumption, so that ADR needs no amendment.

The reasoning is that ADR 0007's fix buys nothing under virtualisation. With
`will-change`, promotion happens at first paint; without it, at first hover.
On a grid that mounts once those are different moments and the ADR's measurement
turns on the difference. On a grid where a wheel gesture mounts cards
continuously they are the same moment, and it is the moment ADR 0007 was moving
the cost away from. A card with no animated property has nothing to promote.

### Images stay cached across a remount

The response gets `Cache-Control: max-age=300`.

A wheel pass through 5,000 wallpapers unmounts and remounts thousands of `<img>`
elements, and scrolling back up remounts them all again. Under the current
header each remount is a full round trip: an mpsc hop, a worker thread, a mutex
lock, `plan`, a 31KB cache-file read, a second mutex lock, and a WAL write. At a
fast scroll that is a few hundred mutex acquisitions a second contending with a
fourteen-minute pre-generation pass.

Five minutes is chosen against the only thing that invalidates a thumbnail: the
source file's mtime changing, which happens when the user edits a wallpaper in
place. That is rare, and being five minutes late about it does not justify a
versioning scheme.

**Unverified**: whether WebKitGTK's memory cache honours `max-age` for a custom
scheme at all. If it does not, this header buys nothing and the fallback is a
frontend-side `Map<id, blob>` bounded to a few hundred entries. See "If the grid
ever janks" below.

### A library card asks for `small`

400px, the same size a review card asks for. In the default 1280x800 window a
dense aspect-video card is about 290px wide; at 2560 with six columns it is
about 400px. The alternative is a third cached size, which doubles ADR 0012's
pass and its cache footprint for pixels nobody looks at until the lightbox, and
the lightbox serves `medium`.

### Pre-generation covers every wallpaper, with rejects as a tail

ADR 0012's work list becomes the whole `wallpapers` table ordered by
`status = 'rejected' ASC, comparisons_count ASC, id ASC`. This supersedes its
"The work list stays eligible-only" paragraph; the amendment is recorded there.

The library page's default filter is All, so half its default view is a status
pre-generation never queued. The gap is narrower than it looks. A wallpaper
rejected from Review has a low Score, which takes comparisons, which means the
pass reached it long ago, and ADR 0012 stopped a reject from purging. What
escapes is a wallpaper rejected straight from the library page on a freshly
scanned library, which is a path this overhaul creates.

`move_wallpaper` updates `path` and `filename`, so a Rejected row points at the
file in its new folder and pre-generates normally.

### Review keeps its own page and its own command

`get_review` is untouched, and ADR 0013's freeze holds. The two views share a
card component, a lightbox and an action set; they do not share a page.

ADR 0014 flagged that folding them would force a choice it declined to make,
since Review would inherit either the Unrated tail or plain `mu ASC`. Adopting
the tail swaps out twelve of today's fifty review cards, which is a
ranking-quality change arriving through a UI merge. Review is a fifty-row
worklist with a destination bar; the library is an unbounded browsing surface
with three statuses.

The shared card carries the library's constraint in the library and Review's
`will-change` in Review, so `the_two_hover_animated_elements_declare_will_change`
keeps pinning Review and gains no library equivalent.

## If the grid ever janks

No measurement was taken. This section is the plan to run if scrolling the
library page is reported as janky, or if the `max-age` question above turns out
the wrong way. The harness is ADR 0007's: Vite stays up, the binary relaunches
per variant because WebKit's warm graphics state survives `location.reload()`, a
probe buffers `requestAnimationFrame` intervals and ships them at phase end, and
`ydotool` supplies relative `mousemove` steps for the sweep.

**The library.** 5,000 synthetic 1920x1080 JPEGs in a scratch library root,
scanned normally, cache warmed by ADR 0012's real pass rather than by hand. The
compositor cost is indifferent to image content, since ADR 0007 swapped every
image for a 1x1 GIF and still stalled, but the request cost is not. Roughly 2.5GB of
sources plus 2GB of cache. 2,000 wallpapers still exercises mount churn at half
the disk cost and below the ceiling.

**Six process launches.** Three cards, one axis crossing them, one control:

| | |
| --- | --- |
| V0 | today's review card: `group-hover:scale-105`, the overlay's opacity transition, `will-change` on both |
| V1 | V0 with `will-change` removed |
| V2 | no animated property: instant overlay, no image scale, no `will-change`. What this ADR ships |
| V0, current header | isolates whether `max-age=300` does anything |
| V0, `pointer-events: none` | ADR 0007's control; separates mount cost from hover cost, which under virtualisation land in the same gesture |
| V0, closing baseline | the run is void if it comes back clean |

**Pass condition.** One continuous wheel scroll from the top through 2,000 cards
and back to the top, cold process. Zero frames over 33ms, no more than 1% of
frames over 20ms, and the upward pass no worse than the downward one. That last
clause is what virtualisation adds: a card scrolling back into view is a fresh
mount, so ADR 0007's "it recovers after the first pass" does not apply.

**What each outcome decides.**

- **V2 passes.** This ADR was right and the card stays as shipped.
- **V2 fails, V1 or V0 passes.** The cost is not layer promotion, and ADR 0007's
  unexplained residual (six stalls with the overlay at `display: none` and the
  transform removed, against a baseline of ten) is what to chase. The card can
  have its animations back.
- **Everything fails.** The cost is virtualisation itself. The grid falls back
  to pagination at 100 cards a page, which is the configuration ADR 0007
  measured and passed: bounded, mounted once, promotion paid after a click
  rather than inside a gesture. This invalidates the decision above, which is
  why it is written down here rather than left as a surprise.

## Alternatives rejected

**Pagination, on the same footing as virtualisation.** It is the configuration
ADR 0007 measured and passed, which is a real argument once the measurement is
off the table. It loses on two counts. A Score-sorted grid cut into fifty
numbered chunks hides the shape of the ranking, which is what this page exists
to show. And pagination is not measured either at this scale: ADR 0006 put fifty
concurrent `wallpaper://` requests at ~25 dropped frames entering Review, and a
100-card page turn is that twice, on every turn. Neither option has a number
behind it, so "pick the measured one" does not decide it. What separates them is
that ADR 0007's residual scaled with card area, ~50ms at three columns and ~93ms
at four, and a dense library grid at five or six columns has cards well under
half the area that produced those numbers.

**Windowed fetching matched to the virtual window.** Buys nothing until the
library is an order of magnitude past the ceiling, and costs a cursor design
plus a refetch story for every Keep, Reject and Restore.

**An `ETag` so a remount revalidates to a 304.** Saves the 31KB read and nothing
else. The round trip through the worker pool and both mutex acquisitions is the
cost, and a conditional request pays all of it.

**A versioned URL (`?v=<mtime>`) so the response can be `immutable`.** The
standard answer, and it needs a per-size mtime on the DTO, which is awkward
because the DTO is per-wallpaper, and it has nothing to say about a wallpaper
with no `thumbnails` row yet.

**Two rows of overscan.** Doubles the in-flight image requests to buy a margin
the memory cache already provides after the first pass.

**Extending ADR 0007's licence to the virtualised grid without measuring.** The
ADR's closing sentence forbids exactly this, and the map's own note said the
`will-change` "has to be re-measured rather than copied across". Not copying it
across honours that without measuring anything.

**A third thumbnail size for the library card.** See above; doubles ADR 0012's
pass for pixels the lightbox already serves at `medium`.

**Offering Eligible as a fifth filter.** See above.

**Persisting the filter and ordering.** ADR 0014 already refused this for the
ordering, and the filter is view state by the same argument.

## Consequences

**Nothing in this ADR is measured.** ADR 0006, 0007 and 0012 each turned on
numbers taken against a real WebKitGTK view, and this one turns on reading their
numbers and arguing from mechanism. The section above is the debt that leaves,
and it is deliberately parked where an agent reading before a change will find
it. ADR 0007 gains one sentence pointing at it.

**On a 2x HiDPI display a 290px card is 580 device pixels and the 400px
thumbnail upscales.** Nothing in the app reads `devicePixelRatio` today.
Accepted rather than fixed.

**A thumbnail edited in place shows stale for up to five minutes**, in the
library page and everywhere else, since the header is on the response and not on
one caller. Nothing in the app regenerates a thumbnail on a timer, so in
practice the window is until the next launch either way.

**Pre-generation now warms files the user has thrown out.** ADR 0012's
justification widens from "ahead of the pair that will need them" to "ahead of
any view that can show them", and its "generating files the user has already
thrown out is the wrong default" is reversed. The tail runs last, so the
eligible pool pays nothing, and a Restore moves a row up the queue on the next
pass. The cost is 414KB per rejected wallpaper on a cache that already has no
cap and no eviction.

**The two grids will not look identical on hover**, because the library's card
animates nothing and Review's still scales and fades. Whoever finds that
inconsistent should read ADR 0007 before unifying them.

**`list_wallpapers` holds the whole result in memory twice** during a call, once
as `Vec<Wallpaper>` and once as serialized JSON. At the ceiling that is about
2MB, and it is transient.

**Nothing here needs an index.** ADR 0014 already accepted an in-memory sort for
both Score orderings, and `filename_asc` has no index either. At a few thousand
rows a full scan and sort is sub-millisecond work next to the 200-byte-a-row
serialization. If it ever matters, ADR 0014 names the index to add.
