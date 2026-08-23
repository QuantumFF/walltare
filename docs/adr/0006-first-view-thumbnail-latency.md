# ADR 0006: A pick waits for the wallpapers it is a pick between

**Status:** Accepted
**Date:** 2026-08-23

## Context

The app felt broken to use. Three symptoms, one chain.

The library under test is 120 wallpapers: median 7.7MB, p90 44MB, largest a
17280×9720 PNG at 152MB. Timing the real `plan` → `fulfill` → `record` path
against it, cold cache, medium size:

| | mean | worst | first pair |
| --- | --- | --- | --- |
| debug (what `bun tauri dev` builds) | 11664ms | 58236ms | 9888ms |
| release | 386ms | 1962ms | 315ms |

So the first comparison took ten seconds to appear, and a first-view thumbnail
mid-session took anywhere from five seconds to a minute.

That latency is what produced the other two symptoms. An `<img>` whose `src`
changes keeps painting the image it already has until the new one arrives, and
`RankView` released its re-entry guard the moment the vote IPC resolved. So
after a pick the panes went on showing the pair just voted on, fully clickable,
for as long as the thumbnails took. The user picked again — reasonably, the
wallpapers had not changed — and the progress moved. Comparisons are permanent
and never deleted, so each of those is noise written into the record the app
exists to produce.

Separately, nothing kept a fresh pair away from the wallpapers already on
screen. Measured over 20000 successive draws against the same library, 4.16%
reused one of the two showing, which reads as "that one didn't change".

## Decision

Three changes, in order of how much they were worth.

**Dependencies are optimized in the dev profile.** `[profile.dev.package."*"]
opt-level = 3` in `src-tauri/Cargo.toml`. `image` doing 168 megapixels of work
unoptimized is not a debug-build tax worth paying; walltare's own code stays at
opt-level 0 and rebuilds at the same speed. Mean 11664ms → 1387ms.

**`downscale_if_wider` box-reduces before it runs Lanczos3.** Lanczos3's filter
radius scales with the downscale ratio, so 17280→1920 is 55 taps per output
pixel per axis. Past twice the target width, a box pre-reduction to exactly
twice the target — linear in source pixels — leaves Lanczos3 the 2:1 step where
its quality actually shows. Debug worst 6831ms → 2313ms, release worst 1962ms →
1383ms.

**`RankView` refuses a pick until both panes have their image.** Each `<img>`
is keyed on its `src`, so a swap discards the old element instead of repainting
the previous wallpaper, and a spinner sits over a pane that is still waiting.
`onError` counts as arrival, so a missing source file leaves a visibly broken
pane rather than a pair the user can never get past.

**`get_pair` and `vote` take an `exclude` list.** `RankView` passes whatever is
on screen; `vote` always adds the two just voted on. Honoured only while two
candidates remain, so a three-wallpaper library still ranks. Overlap 4.16% → 0%,
with the draw still reaching all 120 wallpapers.

**A thumbnail is downscaled from a wider cached one when there is a fresh one
to use.** `small` is 400px, and generating it decoded the whole source — the
same 152MB PNG decode a `medium` pays, fifty at a time for the review grid.
`Size::donors` names the sizes that can stand in, `plan` picks the cheapest one
wide enough, and `fulfill` re-checks the mtime before trusting it and falls
back to the source on any doubt. The realistic case, where ranking has already
made mediums for the wallpapers that rank lowest, went 3452ms → 391ms; the
slowest single request went 2748ms → 106ms.

**A review card changes no shadow on hover.** Dragging the scrollbar was smooth
while the wheel was not, and that asymmetry is the whole diagnosis: the wheel
holds the pointer still while cards stream underneath, so every card that
passes fires `:hover`, where the scrollbar never moves the pointer across the
grid. `hover:shadow-md` repaints outside the card's own bounds, and with
Tailwind's layered shadows a real WebKitGTK view fell from a locked 16ms frame
to 51ms — 20fps, every frame late. Removing only the transition still dropped
half the frames, so it is the repaint and not the animation. Without it the
grid is back to 16ms with two late frames out of 290.

The hover overlay is the affordance that matters and the image already scales,
so nothing was lost. Both of those measured free, which is why they stayed.

The donor lookup runs even when the requested size already has a row. A row is
not a cache hit — the file behind it can be missing or its mtime stale, and
only `fulfill` touches the filesystem to find out. Consulting the donor only
when the row was absent left it unavailable in precisely the case that has to
regenerate, and the grid stayed slow;
`a_size_with_a_row_but_no_cache_file_still_uses_its_donor` pins it.

## Alternatives rejected

**Ask for a smaller thumbnail.** A rank pane is about 950px wide, so `medium`
at 1920 is four times the pixels it displays. It would cut the resize cost, but
the panes are the one place in the app where the user is judging image quality,
and encode plus decode would remain.

**Let the pick through and just show the spinner.** Cheaper, and it keeps the
app feeling fast. It also leaves the door open for exactly the Comparison this
ADR is about: a permanent vote between two wallpapers nobody looked at.

**Generate thumbnails ahead of time after a scan.** The real fix for first-view
latency — a warm cache makes every number above a file read. It is a feature,
not a bug fix, and the numbers here are what should size it.

**Blame the review grid's blurs.** They were the obvious suspect and they are
innocent: a real WebKitGTK view holds a locked 60fps scrolling 150 cards with
all 300 `backdrop-filter` layers visible, and the same 16ms frames with the
blurs removed. So are the image scale, `transition-all`, the fifty Radix
dialog roots (React builds the grid in 35ms), `get_review` (0.3ms), and the
row set (identical across twenty visits). Removing any of them would have been
churn. What actually cost frames is in the decision above, and it was only
found because the wheel and the scrollbar behaved differently.

## Consequences

The first `bun tauri dev` after this rebuilds every dependency at opt-level 3.
One long compile, then incremental rebuilds of walltare's own code as before.

A first-view thumbnail still costs a few hundred milliseconds to a couple of
seconds. The spinner makes that visible instead of confusing, and the prefetch
slot gives the next pair a head start, but the honest fix is pre-generation.

The frontend tests now have to say when an image arrives: `panesArrive()` in
`tests/RankView.test.tsx` stands in for the browser, because happy-dom never
fetches an `<img>` and every pick would otherwise be refused.
