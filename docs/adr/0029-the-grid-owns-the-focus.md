# ADR 0029: The grid owns the focus, and the lightbox hands it back

**Status:** Accepted
**Ticket:** [#162](https://github.com/QuantumFF/walltare/issues/162)
**Date:** 2026-09-03

## Context

`GridSelection` has seven members and two of them are one mechanism.
`requestFocus` bumps a counter and `focusRequest` is the count
(`WallpaperGrid.tsx:209-227`, `:245-289`); the grid acknowledges against
`answeredRef` (`:440`), compares at `:466`, and writes back at `:487`, `:497`
and `:507`. The counter is deliberate, and its doc says why: a second request
while the first is still being answered is still a request, not a set bit nobody
cleared.

The shape is not an accident, then. What is wrong with it is that nobody owns
the fact. Three refs decide where focus goes and all three are already private
to the grid: `focusedRef` for what the last commit focused, `holdsFocusRef` for
whether the curator is inside, `answeredRef` for whether a request is
outstanding. The counter is the one piece outside, and it is held by a hook that
is otherwise about which wallpaper is selected. So "does the selection have
focus" is answered in four places across a seam, and the seam is the reason the
counter has to be a counter at all.

There is one caller: `Lightbox.tsx:142`, inside `close()`. No page calls
`requestFocus`.

Four facts about the current code decide how far this goes.

**The lightbox goes down three ways and only one of them is the curator's.**
`useLightbox` calls `setOpenEverywhere(false)` from `close()` (`:140`), from the
view-change effect (`:145-147`), and from the list-emptied effect (`:149-151`).
Only `close()` asks for focus back, and `LightboxProps.onClose`'s doc says so:
"the two closes nobody pressed never reach here."

**Library never removes a row optimistically.** `LibraryView.act` calls, then
publishes the patch (`:494-553`), and its `catch` at `:554` leaves the card
untouched. Review's `restoreCard` (`ReviewView.tsx:105-113`) is the only failure
path in the app that moves the selection, which is why
[ADR 0023](0023-a-transition-answers-with-the-row.md)'s `optimistic` field is
Review's alone.

**A failed transition already lands focus in the right place.** All four cases
work today, and they work because of rules the grid already has rather than by
luck. The ticket's worry was that ADR 0023 moves the optimistic removal into a
module that knows nothing about focus; the trace below is what that worry
resolves to.

**Keeping the last row from inside the lightbox drops focus to `body`.** That
one is a live defect, found while checking this. The removal empties the list,
the `wallpaper === null` effect closes the lightbox, `onCloseAutoFocus` is
`preventDefault`ed (`Lightbox.tsx:418`) so Radix restores nothing, and the
button the curator pressed unmounts. The grid's effect then returns at `:471`
because `holdsFocusRef` is false and nothing requested. Focus is on `body`, and
the next Tab starts from the top of the document, which is the exact outcome the
container-focus branch at `:494-499` exists to prevent. It misses this path only
because nobody asked it.

## Decision

### The pair leaves `GridSelection` and the grid takes a handle

```ts
export interface WallpaperGridHandle {
  /** Put the selected card on screen and focus it, revealing its row first. */
  focusSelection: () => void;
}
```

The page holds a `useRef<WallpaperGridHandle>(null)` and passes it to the grid
as `ref`, which React 19 takes as an ordinary prop with no `forwardRef` in the
way. `useLightbox(selection, grid)` takes that same ref and calls
`grid.current?.focusSelection()` where it calls `requestFocus()` today.

`GridSelection` drops to five members, and the counter disappears from the
codebase rather than moving. Inside the grid it becomes a `wantsFocusRef`
boolean: the case the counter was written for, a second request arriving while
the first is unanswered, cannot produce a different outcome once the request and
the answer live in the same component. Two requests in a row want the same card
focused, and a flag that is already set is already asking for it. `answeredRef`
and its three write-backs become one flag, set by `focusSelection` and cleared
on the commit where a cell actually takes the focus.

The ref object rather than a callback the page wraps around it. A callback's
identity changes every render, so `close`'s `useCallback` deps churn and the
page has to stabilise it; the ref is stable for the life of the page, and
`close` reads `current` at the one moment the handle is guaranteed to exist.

### The lightbox hands focus back whenever it goes away while its page stays

| how it closes | hands focus back | why |
| --- | --- | --- |
| `close()`, the curator's Escape or Close button | yes | unchanged from today |
| the list emptied under it | yes | new; this is the `body` defect above |
| the destination changed | no | the page is being hidden |

The third row is what rules out the shape this decision started as. A `covered`
boolean the grid watches for a falling edge is a smaller interface than a
handle, and it cannot tell these three apart. The view change is the case that
breaks: `Ctrl+2` hides the page with `display: none` (`Layout.tsx:427-432`) in
the same pass, so the grid would take focus back on a page the curator has just
left. In a browser `focus()` on a non-rendered node is a silent no-op; under
happy-dom it succeeds, so the test written for it would assert behaviour the app
does not have. Guarding it inside the grid needs `offsetParent`, and
`useGridColumns`'s doc (`:64-84`) already rules that read out for having no seam
a test can reach.

So the grid is told, and the caller that knows which close this is does the
telling. [ADR 0015](0015-navigation-shell.md)'s hidden-view rule is the whole of
why the third row is silent, and nothing about that rule changes here.

### A failed transition restores the selection and never touches focus

Four cases, and no mechanism in any of them:

1. **Review, failed reject, lightbox closed.** The removal advanced the
   selection and the grid moved focus to card N+1, so `holdsFocusRef` is true.
   `selectId(N)` puts the selection back, the layout effect sees a changed
   target while focus is still inside the grid, and re-homes to card N. If the
   removal dropped focus to `body` first, `handleBlur`'s unmounted-node guard
   (`:610-612`) kept `holdsFocusRef` true for precisely this.
2. **Review, failed reject, lightbox open.** Focus is inside the lightbox,
   `holdsFocusRef` is false, and the grid correctly does nothing. The selection
   move is all the lightbox needs, because under
   [ADR 0022](0022-lightbox-shares-the-selection.md) it renders that selection.
3. **Review, failed reject, curator is elsewhere in the app.** The selection
   moves and focus does not. That is the rule at `:471-474`, and taking focus
   here would be the bug.
4. **Library, any failed transition.** No optimistic removal, so the selection
   never moved and there is nothing to put back.

`perform` therefore owes no focus request, and ADR 0023's `optimistic:
{ selectId }` stands exactly as written. That ADR named this ticket as the open
question behind its choice of `selectId` over the whole `GridSelection`; the
answer is that the module which knows nothing about focus is handed nothing
about focus, and after this there is no `requestFocus` left to hand it.

### What the tests assert

`WallpaperGrid.test.tsx:495` and `:515` call `selection.requestFocus()` today
and call `grid.current.focusSelection()` after, on the harness's ref. That is
the interface, so it is the right test surface, and the reveal-before-focus test
keeps asserting the one ordering that matters.

`lightbox.test.tsx` drives the real pages through the shell, so the three closes
become three facts about where focus lands there: Escape puts it on the card for
the current selection (`:413` already), keeping the last row puts it on the grid
container rather than `body` (new, and it fails today), and changing destination
leaves the hidden page alone (new, and it is what stops the `covered` shape from
creeping back in).

No product read for "the selection has focus." The DOM carries it twice already:
`document.activeElement` is the cell, and that cell is the one at
`tabindex="0"`. A getter on the grid would exist for tests alone, which is the
definition of a shallow member. If the pair of assertions repeats, it pairs up
in a helper local to the test file.

## What this does not touch

**ADR 0019's ordering.** `reveal` runs before the focus move, focus moves in a
layout effect after the row commits, and a request that finds no node stays
outstanding for the commit that follows. That is the mechanism this decision
moves the switch for, not the mechanism itself.

**The no-steal rule.** A selection that moves while the curator is elsewhere
still leaves focus where they put it (`:471-474`), and a handle call is still
the one way in from outside.

**Nothing reaches `CONTEXT.md`.** Focus is implementation. This is the same call
ADRs 0015, 0017, 0019, 0021, 0022 and 0027 made about UI plumbing.

## Alternatives rejected

**Keep the pair on `GridSelection`.** Seven members, and the counter stays state
the page holds on the grid's behalf. It works, which is why it survived this
long. What it costs is that the one question a reader asks about focus has four
answers in two files, and every future member of `GridSelection` is measured
against a shape that already carries two members belonging elsewhere.

**A `covered` boolean and a falling edge.** See the table above. It was the
better shape while the signal looked like it had one meaning, and the lightbox's
close has three.

**A separate `useGridFocus()` object the page threads to both surfaces.** It
gets `GridSelection` down to five members without a ref, and it leaves the
counter crossing the seam, which is the actual problem. The fact would still be
split between a hook the page holds and a ref the grid holds; only the label
would change.

**Radix's `onCloseAutoFocus`.** ADR 0022 rejected it already: `FocusScope`
defers by a `setTimeout(0)` and restores to `context.triggerRef`, the card the
lightbox was opened from, which after two hundred steps is the wrong card and
usually an unmounted one.

**A `hasFocus` member on the handle so tests can ask directly.** Nothing in the
app reads it, and the two DOM facts above are what a curator can actually
observe.

## Consequences

**The grid exports one more name than ADR 0027 left it with.**
`WallpaperGridHandle` joins `WallpaperGrid`, `useGridSelection` and
`useGridWindow`, so that table reads four rather than three. It is a type and
its only method is the one thing the grid can be asked to do from outside, which
is a fair trade for two members leaving `GridSelection`, but it is a widening
and worth saying out loud.

**One named behaviour change.** Keeping or rejecting the last row from inside
the lightbox now lands focus on the grid container instead of `body`. Everything
else about focus behaves exactly as it does today.

**Two pages gain a ref.** Review and Library both mount a grid and a lightbox,
so both hold the `useRef` and pass it twice. That is the visible cost of the
handle, and it is the same two lines in each file.

**Nothing outside the grid can ask whether the selection has focus.** If some
future surface needs to know, the thing to add is a reason rather than a getter,
because the answer is only ever used to decide whether to move focus, and moving
focus is what `focusSelection` is for.

> **Amended by [#174](https://github.com/QuantumFF/walltare/issues/174),
> 2026-09-04.** The named behaviour change did not land, and the reading behind
> it was wrong. Keeping the last row from inside the lightbox still leaves focus
> on `body`, because the grid is not there to be asked: both pages render their
> own empty state *instead of* the grid when the list empties
> (`ReviewView.tsx`, `LibraryView.tsx`), so the component unmounts in the same
> commit that empties it and `grid.current` is `null` by the time the
> list-emptied effect runs. The context section above has the grid's effect
> returning at `:471` on that path; nothing of the sort happens, since the
> effect no longer exists.
>
> The rest of the decision stands and is implemented as written. The
> list-emptied effect does call `focusSelection`, because whether a surface is
> still there to take the focus is the page's decision and this rule holds
> either way — it is simply a no-op on both of today's pages. The three closes
> still differ, and the destination change still hands nothing back.
>
> What it would take to deliver the change is a page that keeps its grid mounted
> over an empty list, which is a different decision about what an empty
> destination looks like and belongs to whoever makes it. The grid's own
> container-focus branch is unaffected and still covered by
> `WallpaperGrid.test.tsx`; `lightbox.test.tsx` pins what a curator gets today.
