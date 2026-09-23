# ADR 0047: A control the pointer pressed hands the keyboard back to the page

**Status:** Accepted
**Date:** 2026-09-23

## Context

ADR 0019 put the listing keys on the surface: the grid and the filmstrip answer
the arrows, `K`, `Delete` and `Enter` from `onKeyDown` on their own container,
so a page the shell is only hiding cannot answer keys meant for the one in
front. ADR 0015, as amended, gave bare arrows to whatever has focus and to Rank
only when nothing has marked the key.

Both rules are right, and together they strand the keyboard whenever a control
outside the surface keeps the focus after it is used — which a clicked button
does:

- A clicked tab walks the tablist with the arrows, so the next ← on Rank
  switched to Library instead of voting.
- A clicked button in a page's bar — Review's Strip, Grid and Refresh, Library's
  chips, layout buttons and ordering — answers the arrows with nothing, because
  it is outside the surface that listens.
- Leaving Settings, a toast's Undo and `Ctrl+1/2/3` left the focus on the gear,
  on the toast viewport, or where it was on the page just hidden.

The curator's report was the first two: arrows "stuck" on whatever they last
clicked.

## Decision

**A hand-off, asked for by the control once it has done its job.**
`KeyboardHandoffContext` owns it. After the commit it belongs to, whatever holds
the focus lets go of it and focus moves to the showing page's surface — the
element marked `data-keyboard-surface`, and inside it its roving tab stop, or the
surface itself when nothing holds the stop yet. On Rank and on Settings there is
no surface, and letting go is the whole of it.

> **Amended by [#PRNUM](https://github.com/QuantumFF/walltare/pull/PRNUM),
> 2026-09-23.** The hand-off no longer finds the surface in the DOM or focuses
> its tab stop itself. That walked past [ADR 0029](0029-the-grid-owns-the-focus.md)'s
> one way in from outside, the surface's handle, and past the reveal-before-focus
> order [ADR 0019](0019-library-card-affordance.md) put in the surface's layout
> effect. Each listing page now names the handle it drew with
> `useKeyboardSurface(view, handle)`, and the hand-off calls
> `focusSelection({ reveal: false })` on it. `reveal: false` is new on the handle:
> it focuses the selected entry where it stands, and the container when the
> window has scrolled the entry away, both without scrolling — the answer the
> grid already gave a wheel that moved the window and not the selection. So the
> scroll position the shell keeps views mounted to preserve is still the
> curator's, and the next arrow is the reveal. `data-keyboard-surface` is gone.

**Who asks.**

| control | when |
| --- | --- |
| a tab | a pointer click |
| a button in `PageBar` | a pointer click, unless it opens a popup |
| Library's ordering | when its list closes, if the pointer opened it |
| a toast's buttons | a pointer click |
| `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1/2/3` | always |
| Settings' ways out — the gear, Back, Escape | always |

> **Amended by [#PRNUM](https://github.com/QuantumFF/walltare/pull/PRNUM),
> 2026-09-23.** A `PageBar` button marked `data-moves-focus` does not ask either,
> because it puts the focus somewhere itself: "change in Settings" puts the caret
> in the Reject destination field, and the hand-off's blur only missed it because
> the field's focus happened to run in a later effect. And no hand-off takes the
> focus out of a dialog holding it — `Ctrl+Tab` under the `?` sheet changes the
> page behind it and leaves the curator in the sheet.

**The pointer, not the keyboard.** A control the keyboard pressed keeps the
focus: a tablist's arrows are the ARIA pattern, and a curator who tabbed to a
button expects to stay on it. `detail` tells the two apart, since the click Enter
or Space synthesises carries 0. The navigation shortcuts and Settings' ways out
hand off regardless: the first never had focus on a control to keep, and the
second's control unmounts with the page.

**The hand-off stays open until the curator acts.** Until a `keydown` or a
`pointerdown`, it re-lands whenever the surface is not holding the focus. Two
cases need that: a first visit, where the page enters the tree before its
listing does, and a layout switch, where the surface it first lands in is
replaced once the setting write answers. Once the curator has done something, a
card taking the focus would be focus stolen rather than handed over.

**Not behind a lightbox.** A page under an open lightbox is `inert` (ADR 0022),
and a toast's Undo is pressed from there, so a hand-off into an inert page does
nothing rather than pulling focus off the lightbox.

> **Amended by [#PRNUM](https://github.com/QuantumFF/walltare/pull/PRNUM),
> 2026-09-23.** It re-lands when the page's surface is *replaced* — a new handle
> registered — rather than on every DOM mutation under the page, which stole the
> focus from anything else that took it, a dialog's focus trap included.
>
> And behind a lightbox it waits rather than doing nothing. `Ctrl+1/2/3` closes
> the lightbox, but from `useLightbox`'s passive effect on the view, a commit
> after the navigation, so a hand-off that gave up at the inert page left the
> focus on `body` once the lightbox had gone. It now lands when the lightbox
> closes, if the curator has not acted first; a toast's Undo pressed over the
> picture still leaves the focus alone while the picture is up.

## Considered

**`preventDefault` on `mousedown`**, so a clicked control never takes the focus.
It fixes Rank and nothing else: the focus stays where it was, which after a view
switch is a node under `display: none` or `body`, neither of which reaches a
surface's `onKeyDown`.

**Forwarding unanswered keys from the page to its surface.** It would re-dispatch
synthetic events into a keymap that reads `event.target`, and it would make a
bar button answer `Delete` for a card it is nowhere near.

**Finding the surface in the DOM and focusing its tab stop.** The first cut. It
needed no page to register anything, and it was a second way into the surface
from outside, beside the handle ADR 0029 made the only one: it skipped the
reveal, and it relied on the first `tabindex="0"` under the surface being the
roving stop.

## Consequences

A new surface that answers keys from its own container is registered by its
page with `useKeyboardSurface`, and a new control that keeps the focus after use
belongs in the table above. `PageBar` covers the ordinary case for free.
