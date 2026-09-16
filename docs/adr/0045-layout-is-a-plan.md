# ADR 0045: Layout is a plan, and the window is given exact row heights

**Status:** Accepted
**Ticket:** [#261](https://github.com/QuantumFF/walltare/issues/261)
**Date:** 2026-09-17

## Context

[#255](https://github.com/QuantumFF/walltare/issues/255) gives Library a choice
of layouts: masonry at true aspect ratios, justified rows with the rank drawn
behind the image, and the uniform grid the app has always had. Two of those three
have rows that differ from one another in height and in how many cards they hold.

The grid today cannot express either. Every quantity the window turns on is a
single number for the whole list:

| the assumption | where |
| --- | --- |
| a row is `Math.ceil(count / columns)` of the list | `useGridWindow`'s `count` |
| every row is `rowHeight(boxWidth, columns)` tall | `estimateSize: () => rowSize` |
| row *n* holds cards `n * columns` to `(n + 1) * columns` | the `range` arithmetic |
| the card at *i* is in row `Math.floor(i / columns)` | `reveal` |

Four statements of the same assumption in four places, and a layout with an
uneven row breaks all four at once. This is the make-the-change-easy ticket for
the three that follow it, and nothing a curator can see moves on it.

**The conventional answer is measurement, and it is the one being refused.**
`@tanstack/react-virtual` will take an estimate and correct it: each row reports
its real height as it mounts, and everything below shifts by the difference. On a
library of five thousand that is a scroll position that keeps moving under the
hand reaching for a card, and it is exactly what
[#255](https://github.com/QuantumFF/walltare/issues/255) means by "scrolling not
to jump or reflow under me". It is also unassertable here:
[ADR 0027](0027-the-grid-owns-its-geometry.md) records that happy-dom does no
layout, so a measured row is zero, the window collapses and the tests that pin it
have nothing to assert against
([#131](https://github.com/QuantumFF/walltare/issues/131)).

Measurement is unnecessary as well as unwanted. Once
[#256](https://github.com/QuantumFF/walltare/issues/256) puts real pixel
dimensions on the Wallpaper row, both new layouts are fully determined before
anything renders: a justified row's height falls out of its cards' ratios and the
container width, and a masonry column assignment is a greedy pass over the same
numbers. Nothing has to exist before its size is known.

## Decision

### A layout is a plan, and a plan is data

`src/lib/layout-plan.ts`, a module of pure functions that imports nothing — not
React, not a `Wallpaper`, not a class name:

```ts
interface PlannedRow { cards: number[]; height: number; top: number }
interface LayoutPlan { rows: PlannedRow[]; rowOfCard: number[]; total: number }
```

A row carries **the cards in it, as positions in the whole list**, rather than a
first index and a count. The uniform grid's rows do hold runs and a pair of
indexes would serve them; a layout that packs by shortest column does not, and a
window that assumed a run would draw the wrong cards rather than fail. `top` and
`total` are the offsets a scroller works in, with the leading padding and every
gap above the row already in them.

`rowOfCard` is the way back, built while the rows are. The window needs it
whenever the selection lands on a card with no node: the row has to be brought in
before the card can be focused, which is the ordering
[ADR 0019](0019-library-card-affordance.md) forces and `reveal` answers.

Four exported functions, and the grid is the only caller of three of them:

| | |
| --- | --- |
| `uniformRowHeight` | the uniform grid's height, from the width, the columns and the ratio it crops to |
| `planUniformGrid` | that height, tiled: the list cut into rows of `columns` |
| `layoutPlan` | rows with heights in, offsets and `rowOfCard` out — the part every layout shares |
| `windowOf` | a run of rows to the cards it mounts and the space around them |

`layoutPlan` is what makes the next three tickets small. A new layout is a
function that works out a height per row from the ratios and the width and calls
it; nothing about the window, the offsets or the reveal is written twice.

### The uniform grid is one plan among the three it will be

`planUniformGrid` takes the row height already worked out rather than a width and
a ratio, and the grid works it out — which is
[ADR 0027](0027-the-grid-owns-its-geometry.md) held to exactly. `GAP`,
`PADDING`, `CARD_ASPECT` and `UNMEASURED_ROW` stay private to
`WallpaperGrid.tsx`, and `rowHeight(boxWidth, columns)` is still the one place
they are bound to arithmetic over them. It now binds them to `uniformRowHeight`
instead of spelling the division out, so the exported name, its signature and its
test are untouched.

The uniform grid taking one ratio for every card is not a parameter missing from
this plan. It *is* the layout: the card crops each wallpaper to fill a box of the
grid's own shape, so a wallpaper's own ratio reaches nothing. The plans that show
wallpapers uncropped take a ratio per card, and that difference is the whole of
what separates them.

### The window reads the plan, and measures nothing

`useGridWindow` computes the plan once per `(count, columns, boxWidth)` and hands
the virtualiser `plan.rows.length` items and `(row) => plan.rows[row].height`.
The library's parameter is named `estimateSize` and nothing here estimates: no
row is measured on mount and no offset is corrected afterwards.

What the virtualiser still answers is which rows are in view. What the plan
answers is everything else — which cards those rows hold, where the first one
starts, and how much scroll height is left below the last. So the prop the window
crosses the seam on stops being a `range` of `start`/`end` into the list and
becomes `mounted`, the `PlannedWindow` `windowOf` returns, and `Grid` renders
positions out of it rather than a `slice`. The old name went with the old model:
a window over an uneven plan is a set of cards and not a range.

The four assumptions in the table above are now one statement in one place.

### What is asserted, and where

`tests/layout-plan.test.ts` is the one new unit seam, and it is a unit seam
because it can be: the functions need no DOM, no mocks and no mounted page, which
is the part of this work happy-dom structurally cannot check.

A plan of rows that are four different heights and hold one, two, three and four
cards is what pins the property this ticket exists for: the window over rows 1
and 2 mounts *those rows' cards*, the space above it is where row 1 actually
starts, and the space above plus the rows plus the space below is the whole
scroll height. Against the arithmetic this replaces, every one of those is wrong.

Everything else is asserted where it already was. The uniform grid renders
identically, so `WallpaperGrid.test.tsx`, `LibraryView.test.tsx`,
`ReviewView.test.tsx`, `WallpaperCard.test.tsx`, `render-scope.test.tsx` and
`prop-identities.test.tsx` all pass unchanged — which is the strongest statement
available that nothing a curator can see has moved, and the reason no view test
was added.

The varying case is not driven through a mounted grid, because there is no layout
on this branch that produces one. #262 and #263 bring the first, and their own
view tests are where it becomes reachable through the IPC seam.

## What this does not touch

**The split between `WindowedGrid` and `Grid`.** It exists because a virtualiser
hook cannot run conditionally and because a virtualiser standing by on Review is
`setOptions` and three layout effects per render of fifty cards
([ADR 0027](0027-the-grid-owns-its-geometry.md) as amended by
[#231](https://github.com/QuantumFF/walltare/issues/231)). That has nothing to do
with layout and it stays where it is. Review still passes no `scroller`, mounts
every row, and never builds a plan.

**The grid's geometry.** Four private constants, four `className` fields
cross-referencing the CSS they restate, and no number exported. ADR 0027's rule
that a windowed grid wears the padding its window was measured against is
untouched, and `PADDING.px` still reaches the virtualiser off the same pair.

**The cursor, the focus and the keys.** The selection is still resolved against
the whole list rather than the mounted window, `reveal` is still called before the
focus move and never after, and the arrows still move by column and by row
(ADR 0019, [ADR 0029](0029-the-grid-owns-the-focus.md),
[ADR 0042](0042-the-grid-owns-the-cursor.md)).

**The card's memo and its four prop identities.** `cellIndex` is now read off the
plan instead of computed from a slice offset, and it is the same number by value.
`render-scope.test.tsx` and `prop-identities.test.tsx` are what say so, and
[ADR 0043](0043-a-patch-to-a-hidden-view-costs-a-millisecond.md) records that two
separate results depend on them.

**The numbers.** `overscan` is still 1, the fallback row is still 130, the
fallback box is still 800, and the library card still animates nothing
([ADR 0016](0016-library-page-scale.md),
[ADR 0041](0041-the-library-grid-pays-for-the-mount.md)). Retuning while
restructuring would make either one harder to settle.

**`CONTEXT.md`.** A layout plan is implementation. Same call ADRs 0015, 0027,
0029, 0042 and 0043 made about UI plumbing.

## Alternatives rejected

**Measure each row as it mounts and feed the height back.** The conventional
answer, and the thing this ADR exists to refuse. It makes the scroll position
move under the curator by the difference between the estimate and the truth, on
every row, and it is unassertable under happy-dom where every measurement is
zero. Both new layouts are computable before anything renders, so there is
nothing the measurement would tell us that the ratios have not already.

**A component per layout, each with its own window.** The shape the ticket's name
refuses. Three virtualiser call sites, three reveal rules and three answers to
"which cards are mounted", against one plan and one window that reads it. It also
loses the property that makes the layouts switchable at all: the selection, the
keys and the focus are the grid's and do not know which layout is on screen.

**Leave the uniform grid's arithmetic where it is and add the plan beside it for
the new layouts only.** Cheaper today and it leaves two windows to keep in step.
The uniform grid being expressible as a plan is the evidence that the plan is the
right shape, and a plan nothing ships against is a plan nobody has checked.

**Put the grid's four constants in the plan module.** Then `@/lib/layout-plan`
holds CSS, `WallpaperGrid` imports its own geometry back, and ADR 0027's argument
— every input to the arithmetic is this module's own CSS — is reversed for the
convenience of a shorter call. The numbers are arguments instead, which is what
keeps the arithmetic pure and the geometry private.

**Carry a per-card width and height on the plan as well.** Justified rows and
masonry will want them; the uniform grid does not, because its cards are sized by
`grid-cols-N` and `aspect-video` and a px size on a cell would be a second
statement of the same fact for the CSS to disagree with. Fields nothing reads are
fields nothing checks. They arrive with the layout that draws from them.

**Take the wallpapers' aspect ratios as a parameter now, ahead of
[#256](https://github.com/QuantumFF/walltare/issues/256).** There is nothing to
put in it: no row carries pixel dimensions yet, and the uniform grid would ignore
it if it did. A parameter every caller passes a constant to is a parameter nobody
has designed.

**Keep `before` and `after` from the virtualiser rather than from the plan.**
They agree by construction, since the virtualiser is told the same gap, padding
and heights. Reading them off the plan is what makes them assertable without
mounting anything, and it leaves the virtualiser answering the one question it is
actually for.

## Consequences

**A new layout is a function, and the list of what it must not touch is short.**
Work out a height per row, call `layoutPlan`, and the window, the offsets, the
reveal and the mounted-card arithmetic all already work. #262, #263 and #264 are
the test of that claim.

**The window's exactness is now a property of the plan and nothing else.** If a
future layout returns a height a row does not actually take — a card whose CSS
grew a border, a ratio that disagrees with the image — the scroll offsets drift
with nothing to correct them, and the failure is quiet. That is the same trade
ADR 0027 made for `CARD_ASPECT.ratio` and the same defence applies: the number
sits beside the class it restates.

**`planUniformGrid` builds an array per row and an entry per card.** At
ADR 0016's ceiling of five thousand that is a thousand small arrays, rebuilt when
the count, the column count or the box width changes and not on a scroll. It is
not on the gesture's path; ADR 0041 puts the gesture's cost in card mount.

**`Grid` allocates a list of positions for the unwindowed case.** Review's fifty,
memoised on the list, so a cursor move does not rebuild it. The windowed case
takes the plan's own arrays.

**`rowHeight` keeps its export for its test, and now has a caller again.** It is
what `useGridWindow` builds the plan's height from, so ADR 0027's "exported for
the test and nothing else" is no longer quite true — it is exported for the test
and called from one place in the same file.
