# ADR 0027: The grid owns its geometry, and the window is one of its hooks

**Status:** Accepted
**Ticket:** [#155](https://github.com/QuantumFF/walltare/issues/155)
**Date:** 2026-09-03

## Context

[ADR 0016](0016-library-page-scale.md) put a window over the library grid:
thirty cards in the DOM out of five thousand fetched. A window has to know how
tall a row is before the row exists, and the row height is a function of three
CSS quantities. Under happy-dom nothing has a size, so measuring a laid-out card
returns zero, the window collapses, and the tests that pin it have nothing to
assert against (#131). So the numbers are written down instead, and today they
are written down in the wrong file:

| constant | where | the class it restates | where that is |
| --- | --- | --- | --- |
| `GRID_GAP = 24` | `LibraryView.tsx:60` | `gap-6` | `WallpaperGrid.tsx:627` |
| `GRID_PADDING = 16` | `LibraryView.tsx:61` | `p-4` | `LibraryView.tsx:753` |
| `CARD_ASPECT = 9 / 16` | `LibraryView.tsx:62` | `aspect-video` | `WallpaperCard.tsx:259` |

The comment above them (`:47-59`) already names the cost: "a window positioned
against a row height nothing has puts the wrong cards on screen."

`WallpaperGrid` solved this problem once already, for a fourth quantity.
`COLUMNS` (`:33-38`) holds the class and the number in one table, and its doc
says the table is the source of both because "two copies of it drift the moment
someone adds a breakpoint." The pattern was applied to columns and to nothing
else.

Two facts about the current shape decide how far this goes.

**The grid's exports are almost all down to one caller, and that caller is the
block in question.** `GRID_COLUMN_CLASSES` has no caller outside
`WallpaperGrid.tsx:627`. `useGridColumns` has exactly one, `LibraryView.tsx:238`,
and every use of the count it returns is inside the window arithmetic: `:354`,
`:368`, `:413-414`, `:445`. Its doc says it is exported "because #79's
virtualiser needs it too".

**`GRID_PADDING` is not a cross-module duplicate.** Its class is passed by the
host at `LibraryView.tsx:753`, in the same file as the number, and Review passes
`pb-8` there instead. The padding is the windowed host's, not the grid's, which
is why it sits in the table above with a different kind of pair from the other
two.

## Decision

### The geometry is private to `WallpaperGrid.tsx`

The three quantities join `COLUMNS` as private constants, each written beside
the class string it restates, and none of them is exported.

```ts
const GAP = { px: 24, className: "gap-6" };
const CARD_ASPECT = { ratio: 9 / 16, className: "aspect-video" };
const PADDING = { px: 16, className: "p-4" };
```

The `className` field is the cross-reference and not always the thing that gets
worn: `aspect-video` stays literal on `WallpaperCard.tsx:259`, because the card
is what wears it, and this field is how a reader of either file finds the other.
`GAP.className` and `PADDING.className` do get worn, by the container below.

Private rather than moved-and-exported. Exporting three numbers so that
`LibraryView` can multiply them widens the interface without deepening
anything: the host would learn three facts to compute one, which is the shallow
shape this ticket set out to fix.

`UNMEASURED_ROW = 130` and `UNMEASURED_BOX = 800` move with them, and their doc
moves intact. A zero-sized box is not an edge case here: the virtualiser answers
a viewport of zero with an empty range, so every card unmounts rather than
thirty mounting, and ADR 0015 zeroes the box in a real browser too by keeping
the view mounted under `display: none`.

`GRID_COLUMN_CLASSES` and `useGridColumns` lose their `export` as well. The
virtualiser its doc was written for is now in the same file.

### `rowHeight` goes with them

```ts
function rowHeight(boxWidth: number, columns: number): number
```

It has to. A private constant cannot be read by a function in another file, and
`rowHeight` reads all three plus `UNMEASURED_ROW`.

Both parameters stay explicit rather than the function reading `columnsNow()`
for itself, so it is a pure function of two numbers and one test can drive it
over the four column counts. That test is the thing nobody can write today: the
arithmetic is reachable only through a mounted `LibraryView` whose box measures
zero.

### The window is `useGridWindow`

```ts
export function useGridWindow(
  count: number,
  scroller: RefObject<HTMLDivElement | null>,
): { range: GridRange; reveal: (index: number) => void }
```

`LibraryView.tsx:352-418` and `:444-447` move behind it: the `useVirtualizer`
call, the `observeElementRect` wrapper for the zero-rect case, the `measured`
ref, the `boxWidth` state, the measure effect, the `range` computation and
`reveal`. About 120 lines leave the page, and with them the `useVirtualizer` and
`observeElementRect` imports, the `useGridColumns` call and the three constants.
`LibraryView` goes from 782 lines to roughly 660 and back to being a page that
fetches, filters and hands over a list.

`count` and not the list. The hook needs the length and nothing else, so it
never holds the rows.

The scroller arrives as a ref the host owns rather than one the hook creates.
`LibraryView` needs that element for its own `onScroll` handler and its own
restore effect, and a hook that created it would have to hand it back.

It lives in `WallpaperGrid.tsx` beside `useGridSelection`, not in a file of its
own. That is what makes the constants private, and it matches the shape the
module already has: two hooks a host calls and feeds back in through props.

The grid's exported interface goes from five names to three:

| before | after |
| --- | --- |
| `WallpaperGrid`, `useGridSelection`, `useGridColumns`, `GRID_COLUMN_CLASSES`, `GridSelection` | `WallpaperGrid`, `useGridSelection`, `useGridWindow` |

The honest mark against `useGridWindow` is one caller, so the argument is not
duplication. It is that the arithmetic's inputs are this module's own CSS, and
after this they never leave it.

### A windowed grid wears its own padding

```ts
className={cn("grid", GAP.className, range && PADDING.className, GRID_COLUMN_CLASSES, className)}
```

`LibraryView` stops passing `className="p-4"`. Review passes no `range`, so
`pb-8` reaches the same element it reaches today and nothing there changes.

The grid already overrides the top and bottom of that shorthand inline
(`:632-636`), which is the coupling this makes visible: an inline `padding-top`
replaces only the top of the shorthand, so the host's horizontal padding
survives being told where the mounted range sits. The rule is that a windowed
grid wears the padding its window was measured against, and it is the only
version where no padding number leaves the module.

### The scroll position stays on the page

`scrollTop` (`:248`), `toTop` (`:252-255`), the `onScroll` handler (`:662-664`)
and the restore effect (`:342-345`) are also about the scroll box and they do
not move. The restore turns on `showing` from `useApp()` and on ADR 0015's
hidden-view rule, so pulling it in would make the geometry hook know about the
shell, and `toTop` is called from `fetchRows`'s reorder rule, which is about
rows rather than geometry.

### The box gets no injectable seam

`browserLaysOutTheScroller` (`tests/LibraryView.test.tsx:207-217`) stays as it
is: two `Object.defineProperty` calls arranging a box on the real element,
because the virtualiser clamps every scroll it makes to `scrollHeight -
clientHeight` and happy-dom leaves both at zero.

One test calls it, `:267`. The other windowing test arranges nothing and rides
on `UNMEASURED_BOX`. One test and one adapter is a hypothetical seam, and
`useGridColumns`'s own doc already argues the case for arranging the real thing:
"the only way to arrange a known count would be to stand a stub in front of the
component's own internals. `matchMedia` is answered from the viewport, which a
test sets the way `desktopColorScheme` sets the theme."

What the tests gain instead is the `rowHeight` unit test above, plus
`useGridWindow` being reachable from `WallpaperGrid.test.tsx` through the same
harness that already drives `useGridSelection`.

## What this does not touch

**The numbers do not change.** ADR 0016 parks an unrun frame-time measurement
under "If the grid ever janks" and names pagination at 100 cards a page as the
fallback if it fails. Moving the constants leaves that debt exactly where it is.
Retuning them while moving them would make it harder to settle, so the overscan
of 1, the window size, and the card's no-animated-property rule are all
unchanged.

**Nothing reaches `CONTEXT.md`.** Grid geometry is implementation. There is no
new domain term here, which is the same call ADRs 0015, 0017, 0019, 0021 and
0022 made about UI plumbing.

## Alternatives rejected

**Move the three constants beside `COLUMNS` and export them.** The ticket's own
framing, and it is half the fix. `LibraryView` would still hold `rowHeight`, the
virtualiser call, the measure effect and the `range` arithmetic, and it would
import three numbers to feed them. Five exported names instead of four, for a
host that learns three facts to compute one.

**Keep the geometry in `LibraryView` and pair each number with its class by
comment.** Cheapest, and it is what the `:47-59` comment already is. It has not
worked: the comment names the drift risk and the numbers still sit two files
away from two of the three classes.

**A `useGridWindow` in its own file.** Then the constants have to be exported
from `WallpaperGrid` to reach it, which is the rejected alternative above
wearing a different hat.

**Derive `GAP.px` from `GAP.className` at runtime, or the reverse.** Tailwind's
scale makes `gap-6` mean 24px, so one could be computed. Tailwind generates a
utility only when it finds the literal in the source, which is why `COLUMNS`
spells its class strings out, and the same constraint applies here. A pair in
one object is the form that survives it.

**Export `GRID_HOST_CLASS = "p-4"` so the host still spells its own padding.**
Trades a mildly surprising rule for a name that explains less, and leaves a
padding fact in the host's import list for no gain.

**Fold the scroll position in as well**, so the hook owns everything about the
scroll box. See above: it would drag `showing` and ADR 0015's hidden-view rule
into a geometry module, and `toTop` belongs to the reorder rule.

**An injectable box behind the window, so a test can state a viewport.** See
above. One test, one adapter.

**Measure a laid-out card and feed the height back**, which is the answer that
needs no constants at all. happy-dom does no layout, so the measurement is zero,
the window collapses, and the two windowing tests have nothing to assert against
(#131). This is why the numbers exist, and it is unchanged by moving them.

## Consequences

**The row height is still derived from the width rather than measured**, so a
card whose aspect ratio changes in CSS without `CARD_ASPECT.ratio` following it
puts the wrong cards on screen. The failure is quieter than a type error and the
`className` field beside the number is the whole of the defence. That is the
same defence `COLUMNS` has had since #131.

**`useGridColumns` is no longer exported**, so a future second windowed host
cannot read the count without re-exporting it. If that happens, the thing to
export is `useGridWindow`, which such a host wants anyway.

**Review's grid is now the only caller that passes layout classes**, and it
passes `pb-8` while the windowed host passes nothing. A reader comparing the two
call sites sees an asymmetry that the `range && PADDING.className` line explains
and the props do not.

**This is behaviour-preserving in full.** Same classes on the same elements,
same numbers, same window. The only visible change is that `LibraryView` no
longer passes `p-4`, and the grid applies it instead on exactly the calls that
carry a `range`.

**One test moves from unwritable to trivial.** `rowHeight` over the four column
counts, asserting the `UNMEASURED_ROW` fallback when the width is zero, which is
the branch every happy-dom run takes and no test names.
