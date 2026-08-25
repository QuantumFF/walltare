# ADR 0007: A review card declares will-change for what it animates

**Status:** Accepted
**Date:** 2026-08-24

## Context

Reported symptom: hovering a wallpaper in review and scrolling lags for a bit,
then goes back to normal.

ADR 0006 removed `hover:shadow-md` from these cards for a neighbouring reason
and cleared the overlay fade, the image scale and the backdrop blurs as free.
That measurement was taken on a grid that had already been scrolled. It missed a
cost that is paid once.

A card animates two properties on hover: the image's `transform`
(`group-hover:scale-105`) and the overlay's `opacity`. WebKit builds the
composited layer an animated property needs the first time that property is
animated, which for these cards is the first time each card is hovered. A wheel
scroll holds the pointer still while cards stream underneath, so every card that
passes gets hovered, and each one pays its promotion mid-gesture.

Measured against the real 120-wallpaper library in a real WebKitGTK view, one
wheel pass down the review grid, cold process, 3 columns at 949x1028:

| | stalls over 33ms | dropped frames |
| --- | --- | --- |
| first pass | 10-12, of 50-58ms each | 20-24 |
| every later pass over the same cards | 0-1 | 0-2 |

The layers survive for the life of the process, which is what "then goes back to
normal" is. They survive a page reload too, so only a fresh process resets the
measurement.

Controls, each in its own process. `pointer-events: none` on the grid — same
wheel input, same scroll distance, no card able to take `:hover` — was clean.
An rAF `scrollBy` of the same distance was clean, and recorded zero hover
crossings, so WebKit does not re-run its hit test on a programmatic scroll.
Swapping every image for a 1x1 GIF still stalled, so this is not JPEG decode;
the `small` thumbnails are 400px and 11-51KB. Removing the blurs, the overlay,
or the rounded clipping each individually still stalled. Across every run the
stall count tracked hover crossings at roughly 2:1, and the stall size tracked
card area: ~50ms at 3 columns, ~93ms at 4.

## Decision

The image carries `will-change-transform` and the overlay carries
`will-change-[opacity]`. Each names the one property that element animates.

Promotion then happens at first paint instead of at first hover. The same wheel
pass measured 0 stalls and 0 dropped frames, three runs out of three, against
12 and 7 for the same build with `will-change` overridden back to `auto` in the
same run.

Neither cost that would have argued against it showed up. Entering Review is
statistically identical either way — 12 stalls and 25 vs 26 dropped frames, the
same pattern — because the grid's first paint is already janky while fifty
images arrive, and the promotions ride along inside that. Resident memory across
the whole webview process tree is identical too: 1221/1222MB with the fix,
1223/1220MB without.

## Alternatives rejected

**Drop the two hover animations, as ADR 0006 dropped the shadow.** The obvious
move, and measurement does not support it: with the overlay set to
`display: none` and the image's transform removed, the first pass still cost 6
stalls where the baseline cost 10. Removing the scale alone also left 6. Only
pre-promotion took it to zero, so the animations are not the whole cost — being
promoted during the gesture is.

**Pre-generate thumbnails after a scan.** Still the honest fix for first-view
latency, and still a feature rather than a bug fix (ADR 0006 said the same). It
would not touch this: the stalls survive with no image to decode at all.

**Leave it.** It is one gesture per session per card, and it does recover on its
own. But review is the one screen the user scrolls, fifty cards at a time, and
the fix costs two class names and no measurable memory.

## Consequences

`will-change` on fifty images and fifty overlays is exactly the blanket use the
property's documentation warns against. What makes it affordable here is that
the count is bounded by `REVIEW_LIMIT` and the elements are on screen anyway;
the measurements above are what license it. If the grid ever grows to hundreds
of cards, or gets virtualised, re-measure rather than assuming this still holds.

[ADR 0015](0015-library-page-scale.md) virtualises the library grid and honours
that sentence by not extending the licence: its card animates no property and
declares no `will-change`, so this ADR stays scoped to Review. The measurement
that would settle whether it could have been extended is written up unrun, under
"If the grid ever janks" there. Start from it if the library page is ever
reported as janky.

Entering Review drops ~25 frames while fifty images land. That is untouched by
this ADR and unexplained by it.

The frontend tests pin the two class names, because happy-dom has no compositor
and frame times cannot be asserted there. The pin is
`the_two_hover_animated_elements_declare_will_change` in
`tests/ReviewView.test.tsx`, in the same spirit as the no-shadow pin from
ADR 0006: it cannot catch a regression in the frame times, only in the decision.
