# ADR 0041: The library grid pays for the mount, not for the card

**Status:** Accepted
**Ticket:** [#225](https://github.com/QuantumFF/walltare/issues/225)
**Date:** 2026-09-10

## Context

[ADR 0016](0016-library-page-scale.md) virtualised the library grid on mechanism
alone, wrote "Nothing in this ADR is measured", and parked a complete measurement
plan under "If the grid ever janks". That plan has never run. This ADR is that
run, and it supersedes that section.

The harness is [ADR 0007](0007-review-card-layer-promotion.md)'s: Vite stays up,
the binary relaunches per variant because WebKit's warm graphics state survives
`location.reload()`, a probe buffers `requestAnimationFrame` intervals and ships
them at phase end so the measured window is network-silent, and `ydotool`
supplies the wheel.

**The library.** 2,000 synthetic 1920x1080 JPEGs in a scratch Library root, one
seed each so no two decode to the same bytes, scanned through the app's own scan
and warmed by [ADR 0012](0012-thumbnail-pre-generation.md)'s own pre-generation
pass rather than by hand. 2,000 Active Wallpapers, 4,000 `thumbnails` rows, 4,000
cache files. ADR 0016 named 2,000 as the size that exercises mount churn at half
the disk cost of its 5,000 ceiling.

**The window, and it is not the one ADR 0016 reasoned about.** Every launch
tiled to **1269x1388** on a 2560x1440 display, which is **four columns** of
roughly 297px cards, 187.8px a row, 500 rows, 32 cells mounted, and a scroll
range of 92,627px. ADR 0016 argued from "a dense library grid at five or six
columns has cards well under half the area that produced those numbers". These
numbers come from four columns and larger cards than that. All nine launches got
identical geometry, so the comparison between them is sound; the absolute numbers
belong to this window.

**The gesture, and it is faster than a curator's.** Calibration measured one
wheel tick at 181.3px, which on this grid is 0.97 of a row. The pass is 537 ticks
each way at 20ms, so about 8,280px a second, 44 rows a second, and roughly **176
cards entering the DOM per second**. A fast human flick is nearer 900 to 2,700px
a second. The pass condition below is applied at four times a curator's speed,
and every variant is applied at the same speed.

**The display runs at 180Hz and the page does not.** WebKitGTK's
`requestAnimationFrame` settles at about 60fps here — the idle entry window
records 61.6fps — so the 60Hz vsync basis the dropped-frame arithmetic uses is
the rate the page can actually produce. ADR 0016's pass condition is written in
absolute milliseconds and is unaffected either way.

## Decision

### The run is valid

ADR 0016 voids the run if the closing baseline comes back clean. It came back
dirty: 232 frames over 33ms on the down leg, 93.75% of frames over 20ms, which is
the first baseline's result to within the run's own noise.

That pairing is worth more than the void check it was bought for. Six of the nine
launches are the same configuration — V0 first, V0 on the old header, V0 with
`pointer-events: none`, V0 as the closing baseline, and the two counting launches
— and across those six the dropped-frame count over the moving pass is 818, 797,
806, 813, 810 and 798. A spread of 21 on a mean of 807, or 2.6%. **That is the
resolution of this measurement**, and every difference claimed below is larger
than it.

### Everything fails, which is ADR 0016's third outcome

Per variant, per leg, over the moving part of the pass — the frames painted
between the top and the bottom, with the idle head and tail and the turn removed:

| variant | leg | frames | >33ms | >20ms | worst | dropped |
| --- | --- | --- | --- | --- | --- | --- |
| V0 baseline | down | 292 | 233 | 92.8% | 68ms | 402 |
| | up | 279 | 218 | 92.5% | 76ms | 416 |
| V1 no `will-change` | down | 331 | 199 | 89.7% | 67ms | 338 |
| | up | 324 | 217 | 89.2% | 48ms | 341 |
| V2 shipped | down | 332 | 207 | 88.9% | 79ms | 337 |
| | up | 320 | 222 | 91.2% | 46ms | 346 |
| V0 old header | down | 290 | 240 | 92.4% | 67ms | 398 |
| | up | 280 | 221 | 92.9% | 58ms | 399 |
| V0 `pointer-events: none` | down | 293 | 230 | 92.8% | 66ms | 401 |
| | up | 280 | 221 | 91.4% | 56ms | 405 |
| V0 closing baseline | down | 288 | 232 | 93.8% | 73ms | 399 |
| | up | 287 | 219 | 90.6% | 57ms | 414 |

ADR 0016's bar is zero frames over 33ms, no more than 1% over 20ms, and the
upward pass no worse than the downward one. **No variant passes the first two
clauses, and none is close.**

**Two of the three clauses stop carrying information at this scroll rate.** The
median frame is 38ms in the best variant and 42ms in the worst, so nearly every
frame is over 33ms and over 20ms by construction: the "frames over 33ms" column
is really the frame count, and the "over 20ms" column is pinned near 90%
everywhere. What separates the variants is the frame rate and the dropped-frame
count, and the rest of this ADR uses those.

**The third clause passes, and it is the one virtualisation added.** ADR 0016
expected the up leg to be worse, because "a card scrolling back into view is a
fresh mount, so ADR 0007's 'it recovers after the first pass' does not apply".
Up costs between 0.3% and 3.8% more than down across the six V0-family launches,
mean about 2%, which sits inside the 2.6% repeatability above. Coming back up a
grid of 2,000 costs what going down it cost.

### The cost is the mount, and `will-change` is the one card property that moves it

Over the whole moving pass, down and up together:

| variant | frames | median | p90 | p99 | worst | fps | dropped |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V0 baseline | 571 | 42ms | 47ms | 53ms | 76ms | 25.4 | 818 |
| V1 no `will-change` | 655 | 38ms | 43ms | 47ms | 67ms | 29.3 | 679 |
| V2 shipped | 652 | 38ms | 43ms | 46ms | 79ms | 29.2 | 683 |
| V0 old header | 570 | 41ms | 49ms | 52ms | 67ms | 25.5 | 797 |
| V0 `pointer-events: none` | 573 | 42ms | 48ms | 55ms | 66ms | 25.6 | 806 |
| V0 closing baseline | 575 | 41ms | 48ms | 53ms | 73ms | 25.7 | 813 |

The six launches whose card declares `will-change` average 807 dropped frames and
25.7fps. The two whose card does not average 681 and 29.3fps. **A card that
declares `will-change` costs 15.6% more dropped frames on a virtualised grid**,
against a 2.6% resolution, and the effect is present in every launch on both
sides of it.

V1 and V2 land on top of each other — 679 against 683, 29.3fps against 29.2 —
and V1 keeps the transitions while V2 has none. So it is the promotion and not
the animation. This is ADR 0016's claim, which it made from mechanism and marked
as costing nothing to be wrong about: "A card with no animated property has
nothing to promote." It now has a number, and the number says the licence was
right to stay scoped to Review.

### No card takes `:hover` during a virtualised scroll

**Every one of the nine launches recorded zero hover crossings.** The pointer was
parked at the middle of the window before each process started and was still
there at the end of the run; the wheel reached the grid, since every pass covered
the full 92,627px. Across roughly 4,000 card mounts under a stationary pointer,
WebKit fired no `mouseover` on a cell.

The `pointer-events: none` control says the same thing from the other side.
ADR 0007 bought that control to separate mount cost from hover cost, and here it
is statistically identical to the baseline beside it — 806 dropped against 818,
inside the noise — because removing hover from a gesture that had none removes
nothing.

This corrects ADR 0016's reasoning while confirming its decision. That ADR said
that under virtualisation first paint and first hover "are the same moment, and
it is the moment ADR 0007 was moving the cost away from". They are not the same
moment: there is no first hover at all, because the card under the pointer is
replaced rather than moved, and a replacement crosses no boundary WebKit
hit-tests for. What makes `will-change` expensive here is the other half — first
paint stopped being a moment and became a rate, 176 cards a second, and a
declared layer is a layer built at that rate.

ADR 0007's finding is untouched and stays scoped to Review, where fifty cards
mount once and the pointer does cross them.

### Review's current number, and it is clean

Review in its shipped configuration, fifty cards mounted at once with a hundred
declared composited layers, on a 1,150px scroll:

- Median frame 16ms, p90 18ms, 55.9fps.
- One frame over 33ms on the down leg, at 67ms. Zero on the up leg.
- Entering Review costs 5 frames over 33ms and 13 dropped, worst 59ms.

ADR 0007 quoted about 25 dropped frames entering Review, and ADR 0016 flagged that
its numbers were two ADRs old and taken against a grid that fetched through
`get_review`, which [ADR 0028](0028-review-joins-the-listing-vocabulary.md)
deleted. The current figure is 13, roughly half, and the grid at rest holds
55.9fps with every layer it declares.

**Review is not the problem and its `will-change` is not costing it anything
measurable.** The two grids now have opposite results for the same property, and
the difference between them is the mount rate.

### `max-age=300` changes nothing, and it is not what the number answers

ADR 0016 marked as Unverified whether WebKitGTK's memory cache honours `max-age`
for a custom scheme. `PerformanceResourceTiming` records nothing for
`wallpaper://`, so the question was put to a counter in the Rust handler, logging
one line per request that reached it.

Two launches, identical but for the header: **2,582 requests under `max-age=300`
and 2,571 under `max-age=0, must-revalidate`.** A difference of 0.4%, well inside
the run's resolution. The frame times agree: 797 dropped frames on the old header
against 818 on the new one, which is the same number.

**The header buys nothing.** WebKit asks again either way.

Said plainly, because the two are easy to confuse: the reason this costs nothing
is [ADR 0040](0040-a-thumbnail-is-served-newest-first.md), not the header.
Since [#228](https://github.com/QuantumFF/walltare/issues/228) a request that
WebKit does not serve from its own cache is answered from `ImageCache` on the UI
thread — a hash lookup and a copy — instead of ADR 0016's mpsc hop, worker
thread, two mutex acquisitions, 31KB file read and WAL write. The header was
bought to stop the round trip; the round trip was removed underneath it. So this
measurement retires ADR 0016's Unverified flag and does not indict the header,
which is now a 15-character response header doing nothing either way.

The fallback ADR 0016 named if the header turned out this way — a frontend
`Map<id, blob>` bounded to a few hundred entries — is not needed and should not
be built. ADR 0040 put that cache on the Rust side, where it serves all three of
the callers that Map was for.

### What this gates, and the honest answer

[#230](https://github.com/QuantumFF/walltare/issues/230) is the only child of
[#224](https://github.com/QuantumFF/walltare/issues/224) this measurement gates,
and its premise is that an arrow key re-renders the page, the grid and all thirty
to fifty mounted cards.

**This baseline does not support #230 on frame times, and it is not evidence
against the change either. It measures the wrong gesture.** Every variant here is
a wheel pass. Nothing in the harness presses an arrow key, so nothing here prices
one.

What it does establish cuts both ways, and the half that argues against #230 is
the stronger half:

- **Review, fifty cards mounted with a hundred declared layers and no mount
  churn, holds a 16ms median frame.** That is the situation an arrow key creates —
  a fixed set of mounted cards, no scrolling, no new images — and in it the grid
  has frames to spare. A re-render of fifty cards that are already mounted is
  cheaper than the mount this run priced, and the mounted grid is not close to its
  budget.
- **The library grid has no headroom during a gesture**, at 38ms a frame in its
  best configuration. But that cost is the mount, and memoisation does not make a
  mount cheaper. A card that has to be created cannot be skipped by
  `React.memo`.

So the gate reports: **do not justify #230 with this baseline.** This codebase has
twice found the obvious suspect innocent — ADR 0006 cleared the review grid's
blurs, ADR 0007 cleared the hover animations and found layer promotion instead —
and the same discipline applies to the thirty-five-card re-render. #230 should
either be argued on grounds other than dropped frames, such as the render-count
assertion #224 already planned for it, or get the variant that would settle it:
one launch that holds an arrow key at key-repeat rate over a mounted grid and
counts frames. That variant costs one entry in the harness's table and is the
named follow-up here.

> **Amended 2026-09-10: the variant was run, and it justifies #230 on Review's
> number.** Twenty launches on the same harness, same binary, same scratch
> library, same 1269x1388 window as the run above, all twenty at identical
> geometry. What changes is the gesture: the grid is left where it mounted, the
> selected cell is focused, and an arrow key repeats at the system rate of 35 a
> second. Nothing scrolls and nothing mounts, which is what the run above could
> not arrange and what left the cursor unpriced.
>
> The span is 9.8 seconds of key repeat per launch, measured between the first
> cursor move and the last.
>
> | configuration | cells | fps | p90 | dropped |
> | --- | --- | --- | --- | --- |
> | idle control, both grids | 32 and 50 | 62.3 | 16ms | **0** |
> | Library, arrow key held | 32 | 62.2 | 21ms | **5.8** (3 to 8) |
> | Review, arrow key held | 50 | 52.5 | 28ms | **110.2** (104 to 118) |
>
> **The idle control is what makes the rest readable, and it is spotless.** Four
> launches of a focused, mounted, motionless grid: 62.3fps, a 16ms median, a 16ms
> p90, and not one frame over 20ms in any of them. Neither grid has any resting
> noise to confuse a result with. The resolution is the six Review launches,
> which span 104 to 118 — about 13% — against an effect twenty times that.
>
> **Library's arrow key is clean and Review's is not.** Thirty-two cards
> re-rendering at 35 a second cost six dropped frames in ten seconds and no
> measurable frame rate at all, 62.2 against 62.3 idle. Fifty cost 110 and take
> the grid from 62.3fps to 52.5, a 16% frame-rate loss, with the p90 frame going
> from 16ms to 28ms. This is #230's premise measured: the cost is the number of
> mounted cards a cursor move re-renders, and between thirty-two and fifty it
> crosses the frame budget.
>
> **It is the card count and not the layers, which is the one thing that had to
> be ruled out.** Review differs from Library in two ways at once, and the run
> above found `will-change` expensive, so the 2x2 was measured rather than
> assumed. Forcing layers onto Library's thirty-two changes nothing — 6.0 dropped
> against 6.5 shipped. Removing them from Review's fifty changes nothing either —
> 108.0 against 111.5. Both differences are inside the 13% resolution. Layer
> promotion is priced by the mount rate, exactly as the run above concluded, and a
> grid that is not mounting does not pay for it.
>
> **The cursor keeps up; the grid stutters.** Every bounded launch recorded 349
> selection changes against the 344 the key repeat asked for, Review's included.
> So the user story's "moves through the grid rather than lagging behind it" is
> already true — the selection lands on every keypress. What fails is the frame
> the landing is drawn in. That is a smaller complaint than the story implies and
> a real one.
>
> **Holding an arrow key while it drags the window is the wheel run again.**
> Library's traversal shape, ArrowDown held from the top, walks 343 windows and
> 64,813px in ten seconds for 338.5 dropped frames at 37.1fps. That is the same
> regime as the pass above and it is the mount being paid for, not the cursor.
> Review's traversal clamps at its last row after twelve presses, so its span is
> 0.6 seconds and it carries no weight; it is recorded for completeness.
>
> **So the gate reverses, on evidence the run above could not produce.** #230 is
> justified, and the number to hold it to is Review's: 110 dropped frames and 16%
> of the frame rate, per ten seconds of held arrow key, on a fifty-card grid.
> Library's thirty-two are not worth the change on their own, and #230 covers both
> because the cursor has one home.
>
> One confound survives and does not move the verdict. The two grids are two
> pages as well as two card counts, so this separates the count from the layers
> but not the count from the page. Either way #230 is the change that answers it:
> it moves the cursor out of the page and into the grid, so if the page is what
> re-renders, that stops too.
>
> Two things about how the keys were delivered, because they are the part a
> re-run would get wrong. The bounded shape **synthesises** the repeat rather
> than holding one key: it alternates Right and Left, since a held key repeats
> only itself and Right alone walks the list and drags the window. The events go
> out in one `ydotool` call at half the repeat interval apart, because a fork per
> key costs 10 to 20ms of its own and drags the real cadence a quarter below the
> system rate. The traversal shape does hold the key, and the repeat is the
> compositor's own. And the grid's own clamping shapes what each key can do:
> Left and Right walk the list, while Up and Down stop at the ends rather than
> wrapping, which is why Review's traversal stops after twelve presses.

### The CSP caveat, for whoever runs this next

[ADR 0036](0036-the-content-security-policy.md) sets `connect-src 'self' ipc:`,
which blocks a probe posting frame timings to a local sink. It did not apply to
this run: `PROXY_DEV_SERVER` is `cfg!(all(dev, mobile))`, so on desktop under a
dev build Vite serves the document and the policy is not injected.

**A release-build measurement needs the policy relaxed for the duration of the
run.** Nothing fails loudly if it is not — the `fetch` is refused, the probe's
`/ready` never arrives, and the harness reports "the probe never reported a
mounted grid" with an empty application log, which looks exactly like the app
failing to start.

## Alternatives rejected

**Falling back to pagination at 100 cards a page, which is what ADR 0016's third
outcome prescribes.** The letter of that outcome is met and its prescription
still does not follow, for three reasons this run supplies. The failure is
uniform: six configurations of the card land within 2.6% of each other, so
nothing about the grid's contents explains the number and there is no reason to
believe a page of 100 would differ. The one card property that does move the
number, `will-change`, is already off the library card. And pagination mounts 100
cards on every page turn, where this run puts the cost of mounting fifty at 13
dropped frames — so a page turn is about 26, on every turn, which is the
arithmetic ADR 0016 used to reject pagination in the first place and which this
run has now measured rather than assumed. Virtualisation stays.

**Reporting the absolute numbers as the answer.** They are recorded above and they
are real, but they describe a gesture four times faster than a curator's, chosen
by the harness's calibration rather than by anyone's judgement, on a four-column
window. Treating "38ms median" as the library page's frame time would be reading a
stress test as a user report. The comparative results are what this run establishes
at the resolution it measured.

**Re-running the pass at a human scroll rate before deciding.** It would give a
number that could be quoted at a curator, and it would not change any decision
here: the six variants would still be compared against each other, and the one
effect that separates them would still be `will-change`. Worth doing if the
library page is ever reported as janky by a person rather than by a harness, which
is the trigger ADR 0016 wrote its plan for and which has still not happened.

**Extending ADR 0007's `will-change` licence to the library card now that the
grid has been measured.** The measurement points the other way: 15.6% more dropped
frames with it than without. ADR 0016 declined to extend it, and this run turns
that from a cost-nothing-to-be-wrong-about choice into a measured one.

**Removing `will-change` from the review card as well, since it costs the library
grid.** Review holds 55.9fps with it and a 16ms median, and ADR 0007's own
measurement — 10 to 12 stalls without it against 0 with it, on a grid where the
pointer does cross cards — is what put it there. The property is not good or bad;
it is priced by the mount rate, and Review's is one mount per session per card.

**Chasing ADR 0007's unexplained residual**, which is what ADR 0016's second
outcome would have called for. That outcome required V1 or V0 to pass, and neither
did.

**Deleting the `max-age=300` header now that it is measured to do nothing.** It
costs one header on a response and it is correct: five minutes is a true statement
about how long a thumbnail stays valid. Removing it would be a change with no
benefit that a future WebKit could turn into a regression.

## Consequences

**ADR 0016's "If the grid ever janks" section is superseded by this ADR.** The
amendment is recorded there.

**The library card's constraint is now measured rather than argued.** ADR 0016's
"the library card animates no property on hover and declares no `will-change`"
joins the list in #224 of things that must not be undone by a refactor, and it
has a number behind it like the rest of that list.

**The numbers describe today's grid, not the one ADR 0016 shipped.**
[#229](https://github.com/QuantumFF/walltare/issues/229) stabilised the card's
prop identities and cached the column count, and
[#231](https://github.com/QuantumFF/walltare/issues/231) moved the virtualiser's
call site inside `WallpaperGrid` so a scroll re-renders the grid rather than the
page. Both landed before this run. The comparison between variants is unaffected,
since they differ only in the card's CSS and in one response header, but nobody
should read 38ms as what ADR 0016 shipped.

**The cache was warm and pre-generation was idle.** The scratch `XDG_DATA_HOME`
had all 4,000 thumbnails on disk before the first variant, which is what ADR 0016's
plan asked for, and since
[#232](https://github.com/QuantumFF/walltare/issues/232) the pass submits through
the same admission point as an interactive request. So the pass had no work and
nothing contended with the wheel. **This run says nothing about a first launch**,
where a fourteen-minute pre-generation pass runs underneath the same gesture.

**The pre-generation pass's own progress log did not survive.** `out/warm.log`,
which recorded the warm as it happened, was overwritten by a diagnostic run before
the measurement. What carries the claim that the cache was warmed by ADR 0012's
own pass rather than by hand is the 4,000 `thumbnails` rows, the 4,000 cache files,
and the 124 `/warm` posts still in the harness's sink log.

**Zero hover crossings is a property of this harness as well as of the grid.** The
run parks the pointer and never moves it, which is what keeps pointer motion out
of a measured window. A curator whose hand moves the mouse while scrolling would
cross cells and would pay ADR 0007's promotion cost on a `will-change` card. That
is one more reason the library card should not declare it, and it is not something
this run measured.

**The harness lives outside the repository and only the numbers survive here.**
The probe was five modified files and one new one, all temporary, and the branch
that carries this ADR carries none of it. Re-running means rebuilding the probe;
what this ADR owes its successor is the description of the harness in the context
above.

**The measurement has no automated test and is not a gate.** #224 said so when it
scheduled this work: it needs a real WebKitGTK view, real input and a fresh
process per variant, because WebKit's warm graphics state survives a page reload.
It is a recorded measurement.
