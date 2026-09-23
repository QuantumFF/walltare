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

**Who asks.**

| control | when |
| --- | --- |
| a tab | a pointer click |
| a button in `PageBar` | a pointer click, unless it opens a popup |
| Library's ordering | when its list closes, if the pointer opened it |
| a toast's buttons | a pointer click |
| `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1/2/3` | always |
| Settings' ways out — the gear, Back, Escape | always |

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

## Considered

**`preventDefault` on `mousedown`**, so a clicked control never takes the focus.
It fixes Rank and nothing else: the focus stays where it was, which after a view
switch is a node under `display: none` or `body`, neither of which reaches a
surface's `onKeyDown`.

**Forwarding unanswered keys from the page to its surface.** It would re-dispatch
synthetic events into a keymap that reads `event.target`, and it would make a
bar button answer `Delete` for a card it is nowhere near.

## Consequences

A new surface that answers keys from its own container wears
`data-keyboard-surface`, and a new control that keeps the focus after use belongs
in the table above. `PageBar` covers the ordinary case for free.
