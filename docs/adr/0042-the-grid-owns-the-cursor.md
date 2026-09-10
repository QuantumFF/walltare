# ADR 0042: The grid owns the cursor, and publishes it

**Status:** Accepted
**Ticket:** [#230](https://github.com/QuantumFF/walltare/issues/230)
**Date:** 2026-09-10

## Context

Third in a line. [ADR 0027](0027-the-grid-owns-its-geometry.md) moved the
geometry into `WallpaperGrid` on the argument that every input to it is the
grid's own CSS. [ADR 0029](0029-the-grid-owns-the-focus.md) moved the focus in,
on the argument that three of the four refs deciding where focus goes were
already private to the grid and the fourth was crossing a seam for no reason.
The cursor was the last piece of the same thing still sitting in the host, and
it is the piece the render cost hangs off.

Both pages called `useGridSelection` themselves and handed the result back down.
So a cursor move set state in `LibraryView` or `ReviewView`, which re-rendered
the page, which re-rendered the grid, which re-rendered every mounted card:
thirty-five in Library, fifty in Review. Each card rebuilds a badge, up to two
buttons, two icons and roughly eight `twMerge` calls on the way, and there was no
`React.memo` anywhere in `src/` to stop any of it.

### The measurement, and what it does and does not say

[ADR 0041](0041-the-library-grid-pays-for-the-mount.md) came back against this
change on its first run and named the variant that would settle it. That variant
has since been run and is recorded in that ADR's amendment. Twenty launches, same
binary and same 1269x1388 window, a mounted grid that is not scrolling, and an
arrow key at the system repeat rate of 35 a second for 9.8 seconds:

| configuration | cells | fps | p90 | dropped |
| --- | --- | --- | --- | --- |
| idle control, both grids | 32 and 50 | 62.3 | 16ms | 0 |
| Library, arrow key held | 32 | 62.2 | 21ms | 5.8 |
| Review, arrow key held | 50 | 52.5 | 28ms | 110.2 |

The resolution is 13%, from the spread across the six Review launches, against an
effect twenty times that. A 2x2 rules out the other difference between the two
grids: forcing layers onto Library's thirty-two changes nothing (6.0 against
6.5), and removing them from Review's fifty changes nothing either (108.0
against 111.5). **It is the card count.**

**Two things that measurement says have to be carried into this decision rather
than left in the other ADR.**

The first is what it does not justify. Library's thirty-two cards cost six
dropped frames in ten seconds and no measurable frame rate at all. On Library's
number alone this change would not be worth making. Review's fifty is what
carries it, and this ADR covers both because the cursor has one home.

The second is what the user story overclaims.
[#224](https://github.com/QuantumFF/walltare/issues/224) asks for a cursor that
"keeps up with the key repeat rate, so that holding an arrow key moves through
the grid rather than lagging behind it". **The cursor already keeps up.** Every
launch recorded 349 selection changes against the 344 the key repeat asked for,
Review's included. The selection lands on every press; what fails is the frame
it is drawn in. So the honest claim for this change is 110 dropped frames and 16%
of the frame rate per ten seconds of held arrow key — not a keypress that goes
missing.

### The property this most easily breaks

[ADR 0022](0022-lightbox-shares-the-selection.md) has the lightbox render the
grid's selection rather than hold a cursor of its own, and it rejected "a
separate lightbox cursor, synced to the grid's selection on open and close"
because that shape "needs a sync rule in both directions plus a decision about
what happens when a `library-scanned` refetch lands between them". Sharing one
selection has no sync to get wrong, because there are not two things to sync.

`LibraryView` said so where it held the cursor: "held here rather than inside the
grid because ADR 0022 has the lightbox render this same selection and keeps the
lightbox's state on the page that mounted the grid". The property that reasoning
bought is worth more than its location, and a copy of the cursor on the page kept
in step with the grid's would fail this ticket while passing every test it has.

Two things the host genuinely needs from the cursor decide how far this goes.
The lightbox steps through the same list and reads `3 / 50` off it. And Review's
failed reject puts the selection back on the card it re-inserted
([ADR 0023](0023-a-transition-answers-with-the-row.md)'s `optimistic.selectId`).
Neither may widen the seam back to what it was.

## Decision

### The cursor is state in `Grid`, and what crosses the seam is a publication

`useGridSelection` stops being a hook a page calls to *create* a selection and
becomes a hook a subscriber calls to *read* one. The rule is the same rule and
the object is the same object; the resolution — track by wallpaper id, fall back
to the same position clamped to the new length, fall back to nothing when the
list empties — is untouched and now lives in a private `useSelectionCursor`
inside `WallpaperGrid.tsx`.

`WallpaperGridHandle` gains the publication:

```ts
export interface WallpaperGridHandle {
  focusSelection: () => void;
  subscribe: (listener: () => void) => () => void;
  selection: () => GridSelection;
}
```

Two methods and no value, because that is what `useSyncExternalStore` reads. The
grid publishes in a layout effect, so what a subscriber gets is the selection the
cells were actually drawn from rather than one resolved mid-render. `GridSelection`
keeps all five of its members and is still memoised on the values it carries, so
the object's identity moves when the selection or the list does and not otherwise
— which is what [#229](https://github.com/QuantumFF/walltare/issues/229) bought
and what a snapshot comparison now depends on.

The state is in `Grid` and not in `WallpaperGrid` or `WindowedGrid`, which is one
component lower than it had to be. A cursor move re-renders the cells and leaves
the window arithmetic alone; nothing about the window depends on which card is
selected, since the reveal is asked for rather than derived.

### The subscriber takes only the part it draws

`useGridSelection(grid, read)` takes a reader, and the reader is why the
publication is two methods rather than a value handed to everyone:

| caller | reads | re-renders on a cursor move |
| --- | --- | --- |
| `Lightbox`, open | the whole selection | yes, and it is what draws it |
| `Lightbox`, closed | a constant | no |
| `useLightbox` | `wallpaper !== null` | no |

`useLightbox` runs on the page. Without the narrow read, the page would re-render
on every arrow key and this change would buy nothing at all. What it actually
needs is whether there is a selection to show, which flips when the list empties
or fills and on no keystroke.

The closed lightbox stays subscribed and reads a constant rather than
unsubscribing. Both read as nothing selected; the difference is when the
subscription is made. A surface that subscribes on the way open is told about the
selection it opened onto one commit late, through a passive effect, which is a
frame of the outgoing wallpaper. One that never unsubscribed is told inside the
same commit, before anything paints.

### The card memoises, and every prop it takes is a value or a stable identity

`WallpaperCard` is wrapped in `React.memo`. A cursor move re-renders `Grid`,
which rebuilds fifty elements, and the memo stops at the two whose `selected`
changed: the card that lost the selection and the card that gained it.

The memo is the third of three changes that are one mechanism, and any of them
undone undoes it. #229 stabilised `onAction` behind a ref latch and replaced the
`GridCell` object literal with a number and a boolean. This ticket keyed
`openOn` on the grid's handle rather than on the selection, which is the one
identity #229 left churning: it was rebuilt on every cursor move, reached every
mounted card as `onOpen`, and would have defeated the memo silently. And moving
the cursor is what stops the page re-rendering above all of it. A memoised card
under a page that re-renders and hands it fresh props is a shallow comparison
that always fails.

### The handle is held in state, not in a ref

Both pages hold `useState<WallpaperGridHandle | null>(null)` and pass the setter
as the grid's `ref`. ADR 0029 chose a ref and gave a reason — a callback's
identity changes every render, so `close`'s `useCallback` deps churn — and that
reason does not apply to a `useState` setter, whose identity React guarantees is
stable.

What forces the change is that the handle is now a publication, so *when* it
exists is information a subscriber needs. Both pages render their own empty state
**instead of** the grid when the list empties, which ADR 0029 recorded in its
#174 amendment. A ref goes to `null` silently; the setter tells the page, the
page re-renders, the lightbox's snapshot becomes "nothing selected", and the
surface closes onto the empty state the page just put up — which is ADR 0022's
rule for an emptied list, arriving through the same route as every other reading
of the selection instead of through a special case.

The cost is one extra render of each page when its grid mounts or unmounts. That
happens on arrival and when a list empties or fills, and never inside a gesture.

### The exports do not grow

Eight names before, the same eight after: `rowHeight`, `printedKey`,
`actionFor`, `GridSelection`, `WallpaperGridHandle`, `useGridSelection`,
`WallpaperGridProps`, `WallpaperGrid`. ADR 0029's counted table still reads three
— `WallpaperGrid`, `useGridSelection`, `WallpaperGridHandle` — with the same
three names in it.

`useGridSelection` changed signature rather than being replaced by a new name
beside it, because it is the same fact under the same label: the grid's
selection. What moved is which side of the seam holds it. `WallpaperGridProps`
lost its `selection` member, which is the seam narrowing that pays for the two
members `WallpaperGridHandle` gained.

### What pins it

A render-count assertion in `tests/render-scope.test.tsx`, beside the one #231
wrote for the wheel, and white-box for the same reason: the property is invisible
and the cost of losing it is not. happy-dom has no compositor, so frame times
cannot be asserted there; this is the same spirit as
[ADR 0007](0007-review-card-layer-promotion.md)'s `will-change` class-name pin.

The library page at 400 wallpapers and four columns mounts 28 cards. One
`ArrowRight` re-renders **2** of them. Against the code before this ADR it
re-renders all **28**, and the page with them — the test fails that way, which is
what makes it a pin rather than a description.

It reads the render count off `__reactProps$` on each cell, which #231's test
already established as the only way in: JSX builds a fresh props object per
render of the owning component, and React writes it onto the host node only when
that component actually re-rendered. So the object's identity is a per-card
render counter with a resolution of one.

## What this does not touch

**ADR 0007's `will-change` licence.** It stays scoped to `REVIEW_LIMIT`, the
library card still animates nothing, and
`the_two_hover_animated_elements_declare_will_change` passes untouched. ADR 0041
priced layer promotion by the mount rate and its arrow-key amendment found it
irrelevant to a grid that is not mounting; neither result moves the licence.

**The keyboard.** The roving selection, `Left`/`Right` walking the list rather
than the row, `Up`/`Down` doing nothing where the next row has no card in that
column, `Home` and `End`, the `preventDefault` that keeps an arrow from reaching
Rank's vote listener, and the reveal that scrolls a selected card into the window
before focus moves are all exactly as ADR 0019 and ADR 0027 left them.

**ADR 0022's list-walking and the selection outside the window.** The lightbox
steps through the same list with the same clamp at the ends, and the selection is
still resolved against the whole list rather than the mounted range, so wallpaper
3,000 holds it whichever thirty cards have nodes
([#137](https://github.com/QuantumFF/walltare/issues/137)).

**ADR 0023's `optimistic: { selectId }`.** Review still hands
`useWallpaperRows` a `selectId`; it reaches the cursor through the handle
instead of through a selection the page was holding.

**`CONTEXT.md`.** The cursor is UI. Same call ADRs 0015, 0017, 0019, 0021, 0022,
0027 and 0029 made about UI plumbing.

## Alternatives rejected

**Leaving the cursor on the page and memoising the card anyway.** It compiles and
buys nothing measurable: the page still re-renders on every keypress, so every
card still gets a fresh render of its element and the memo's comparison is one
more thing to do before doing the work anyway. #224 said this in advance —
"memoising a card whose props change identity every render buys nothing, and
moving the cursor without memoising the card buys nothing either" — and it is why
the two land together.

**A `selection` prop the page reads off the grid and hands back down.** The
smallest-looking change and the one that fails the ticket. Reading it on the page
is the page re-rendering on every arrow key, which is the cost being removed, and
the moment the page holds it, it is a copy that has to be kept in step with the
grid's — which is precisely the shape ADR 0022 rejected.

**An `onSelectionChange` callback.** The same thing with a different spelling.

**A context provider around both surfaces.** The lightbox is not below the grid,
so the provider would have to sit on the page, which means the page holds the
value, which is the previous two alternatives again. Portalling the lightbox
moves its pixels, not its position in the tree.

**Rendering the lightbox from inside the grid**, so a context would reach it.
It makes the grid know about the lightbox's state, its `perform` and the shell's
portal node — a geometry-and-focus module that knows about the navigation shell
is exactly what ADR 0027 refused, and ADR 0022 keeps the lightbox's state on the
page because the list it walks changes on every action.

**Per-card subscriptions, so a cursor move re-renders the two cards and not
`Grid`.** One more component render per keypress against fifty
`useSyncExternalStore` subscriptions to maintain, an extra hook in the card, and
a card that can no longer be rendered outside a grid without one. `Grid` is the
component that has to re-render anyway: its focus layout effect is what moves
focus to the new cell.

**The cursor as a plain external store, updated synchronously by `moveTo`.** It
removes the one commit of lag between a move and the publication. What it costs
is that the resolution needs the list, which arrives as a prop, so either the
store is written during render or the *grid's own* rendering of `selected` lags
the list by a commit. The second is worse than what it fixes, and the first is
the render-phase mutation this decision avoided in the first place.

**Publishing during render instead of in a layout effect.** Same trade, smaller.
It would let a surface rendering later in the same pass read the selection being
resolved rather than the last one committed, and it is a store mutated during
render, which is the thing `useSyncExternalStore` is documented not to do. The
subscribed-while-closed lightbox above gets the same result inside React's own
contract.

**Keeping the ref ADR 0029 chose and letting `useSyncExternalStore` discover the
detach on its own.** React does re-check a snapshot after each commit, so it
probably works. "Probably" is the objection: the page would depend on when React
schedules a store check rather than on being told, for no saving over a setter
whose identity is already stable.

## Consequences

**ADR 0022 is amended rather than reopened.** The lightbox still renders the
grid's selection and there is still no sync rule, because there are still not two
cursors. What changed is which component holds the one there is. The amendment is
recorded there.

**ADR 0029's ref becomes state, and its consequence about two pages gaining a
ref is amended in place.** The count of exported names it owns is unchanged.

**`LibraryView` and `ReviewView` each lose a hook call and a concept.** Neither
page mentions a selection any more; each holds the grid's handle and passes it to
the two surfaces that need it. Review's `selectId` forward reference survives,
now reaching the cursor through the handle.

**One non-obvious rule now has to hold: the reader passed to `useGridSelection`
must be stable.** A selector rebuilt per render is a new snapshot getter per
render. The three readers this app has are module-level constants in
`Lightbox.tsx` and the hook's doc says why.

**A memoised card is a card whose props are now load-bearing.** Any future prop
that is an object or a function built during the grid's render silently costs
fifty card renders per keypress again. `prop-identities.test.tsx` pins the four
that exist; a fifth would need its own line there.

> **The memo pays for a second gesture nobody bought it for.
> [ADR 0043](0043-a-patch-to-a-hidden-view-costs-a-millisecond.md),
> 2026-09-10.** [#233](https://github.com/QuantumFF/walltare/issues/233) was
> scheduled to route a card's own row and its own score-moved flag through the
> publication above, on the premise that a vote re-renders thirty-five cards on a
> Library page nobody is looking at. Measured, zero of the 36 mounted cards
> re-render: `scoreMoved` reaches a card as a boolean that is `false` on both
> sides of a Comparison it was not in, so the memo holds for every card the vote
> did not name. A vote costs the hidden page about a millisecond, and #233 closed
> `wontfix` without touching `WallpaperGridHandle`.
>
> So this ADR's four prop identities are load-bearing for two things, not one,
> and the second is priced: with the memo defeated the same vote costs the hidden
> page 3.1 to 3.8ms.

**Nothing here is measured on the machine.** The render count is asserted under
happy-dom, which has no compositor. What predicts the frame-time payoff is
ADR 0041's arrow-key run, and confirming it means re-running that harness's
arrow-key variant against this branch — which nobody has done, and which #224
never asked for.

**Library's own number does not justify this on its own**, at 5.8 dropped frames
in ten seconds against an idle control of zero. If a future change ever makes the
grid cheaper per card, Review's fifty is the number that would have to be
re-measured before concluding anything about whether this was worth it.
