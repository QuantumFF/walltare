# ADR 0017: One toast at a time, on the primitive already installed

**Status:** Accepted
**Ticket:** [#49](https://github.com/QuantumFF/walltare/issues/49)
**Date:** 2026-08-25

## Context

[ADR 0009](0009-reject-is-reversible.md) put a toast with an Undo button behind
every keep, reject, restore and un-keep, and made it the only path to Undo in
Review once the reject confirm dialog goes.
[ADR 0015](0015-navigation-shell.md) said the Toaster mounts in the shell,
above the view swap, because a toast has to survive a view change.

Nothing in the project can render one. `src/components/ui/` holds alert-dialog,
badge, button, input and progress.

The ticket framed the choice as sonner, which is a dependency, against roughly
eighty hand-rolled lines, which is one more thing to own. Both readings of the
option set were wrong, for the same reason: nobody looked in `node_modules`.

Review's errors land in a `role="alert"` paragraph
(`ReviewView.tsx:168`). Adding a toast without deciding about that paragraph
leaves two error surfaces in one view, and the two new error kinds this epic
introduces, `FileMissing` from ADR 0009 and `InvalidPathSyntax` from
[ADR 0011](0011-written-paths.md), both arrive on the same code paths.

## Decision

### The primitive is already installed

`radix-ui` ^1.6.7 is a direct dependency and re-exports `Toast`.
`@radix-ui/react-toast@1.2.23` is already in `node_modules` as a transitive of
it. Adding toasts costs no install.

`alert-dialog.tsx` and `progress.tsx` both open with
`import { X as XPrimitive } from "radix-ui"`, so `src/components/ui/toast.tsx`
written the same way is the house style rather than a second one.

What Radix ships is precisely the part of the eighty lines that is hard:

- A `hotkey` on the viewport, defaulting to **F8**, that moves focus into it,
  with the key written into the landmark's own label.
- Pause on pointer-enter, focus-in and **window blur**, resuming on each
  inverse.
- A mandatory `altText` on `ToastAction`, for readers who cannot tab to the
  button in the time it is up.
- `type: "foreground" | "background"` driving the live region's assertiveness.
- `duration: Infinity` short-circuiting the close timer outright
  (`index.js:374`).

Writing the `<div>` was never the work. The landmark, the live region, the
pause timer and the swipe were.

### One slot, and the newest replaces the previous

ADR 0009 settled newest-replaces-previous over stacking. The shell holds
`{ key, ... } | null` and renders at most one `<Toast key={toast.key}>`.

The key is load-bearing. Radix restarts the close timer on `open` and
`duration` and on nothing else (`index.js:403`), so swapping a mounted toast's
content leaves the previous countdown running and the new message inherits
whatever was left of the old eight seconds. A fresh key remounts and starts a
fresh timer.

The outgoing toast therefore skips its exit animation. For a replacement that
is the right reading: the old message is not leaving, it is being overwritten.

### Errors share the surface, and never dismiss themselves

The `role="alert"` paragraph goes. Errors render as a toast with
`duration={Infinity}` and an explicit close, so the surface is shared but the
lifetime is not. An error that vanishes after eight seconds is a worse error
surface than the paragraph it replaced, and a failing action is exactly when
the user wants to read the message twice.

Errors get **no exception** to the replacement rule. The only thing that wipes
an unread error is the user taking another action, which is the one signal that
they have moved on. The durable evidence survives regardless: `ReviewView`
re-inserts the failed card into the grid (`restoreCard`, `ReviewView.tsx:87`),
so the failure is legible in the list and not only in the toast.

An error toast takes its **title from the frontend and its detail from the
backend**. That keeps ADR 0011's rule intact, where `InvalidPathSyntax` is the
one kind whose message the frontend renders verbatim, while still letting
`FileMissing` say the sentence ADR 0009 wrote it to say: the user reads "the
file is no longer in the reject folder", not an errno string.

`InvalidTransition` additionally makes the originating view refetch. It can
only mean the view is holding a stale row, which ADR 0015's patch events exist
to prevent, so it is a bug signal rather than a user error. Leaving the row on
screen means the user's next click reproduces it.

### Four transitions, from anywhere

Keep, reject, restore and un-keep each toast, wherever they were triggered,
Library included. The library row does update in place under the cursor, but
the grid virtualises ([ADR 0016](0016-library-page-scale.md)) and the row may
reorder or filter itself out from under the click
([ADR 0014](0014-library-page-ordering.md)). A card that vanishes is not a
confirmation.

Pressing Undo always produces its own toast, replacing the one that offered it.
The button you pressed turns into the answer, which is what makes a single slot
read correctly rather than feel lossy.

Background work is **not** on this surface.
[#59](https://github.com/QuantumFF/walltare/issues/59) owns ADR 0012's
two-phase pre-generation bar and ADR 0008's "back to Round 1" message.
Pre-generation is progress and belongs in a bar, not an event. Scan-complete is
genuinely toast-shaped and #59 may take this surface for it; this ADR does not
claim it either way.

> **Overturned by [ADR 0021](0021-background-work-is-a-pinned-toast.md),
> 2026-08-26.** Background work is on this surface, on a second slot below the
> one above: the shell renders `transient ?? background`, so one toast is still
> ever mounted and the replacement rule is untouched. Half the reasoning
> survives, in that progress does belong in a bar; the bar now sits inside a
> pinned toast. What this ADR could not have known is that the scan phase
> cannot have a bar at all, `scan-progress` carrying no total, so the phase
> that needed words is the one a bar would have served worst.

### Placement

Fixed to the top-right, offset by the 48px chrome row plus the gap, rendered as
the last child of the shell root, carrying the highest z-index in the app.
`swipeDirection` is `right`.

The z-index is the part worth writing down. Keep and reject fire from inside
the lightbox, whose backdrop is opaque because at 97% the tabs ghosted through
the lightbox ([#44](https://github.com/QuantumFF/walltare/issues/44)), and Radix
does not portal the viewport: it renders where you put it. "Mount it in the
shell" on its own produces a toast nobody can see during the exact flow this
ADR exists for.

The offset clears the chrome row's gear. It leaves the toast overlaying each
page's second bar, which holds a filter row and a destination field, neither of
which anyone reads while a toast is up.

> **Amended by [ADR 0022](0022-lightbox-shares-the-selection.md), 2026-08-26.**
> The z-index is necessary and not sufficient, for a reason this ADR had the
> first half of. A *modal* layer over the viewport also runs
> `hideOthers(content)` from `aria-hidden`, which marks every sibling on the way
> up as `aria-hidden="true"`, and because the viewport is not portalled it is one
> of those siblings. So the toast would paint on top and still be out of the
> accessibility tree, live region included. Radix's own `FocusScope` trap then
> takes back the focus the F8 hotkey moved, since the hotkey is bound on
> `document` and fires regardless. ADR 0022 makes the lightbox a **non-modal**
> Dialog with `inert` on the view container behind it for the same containment,
> and anything modal that ever covers this app owes the same check.

### Keyboard

F8 comes free with the viewport's `hotkey`, and `Ctrl+Z` in the shell presses
the current toast's Undo when it has one. That is a shortcut for the button on
screen, not an undo stack. In Rank nothing happens, because no toast is up, and
that is the honest behaviour: `CONTEXT.md` says comparisons are never deleted
and undo of a vote is out of scope for this epic. `altText` spells the binding
out, `"Undo (Ctrl+Z)"`.

The timer pauses on hover, on focus and on window blur, all Radix defaults, all
kept. Window blur is the one that earns its place: reject, alt-tab to check
something, come back, and without it the eight seconds are long gone.

### Copy

Glossary vocabulary only, so the app says Kept, Rejected, Restored and Active
and never invents Moved, Removed or Archived. The filename truncates with an
ellipsis and carries the full string in `title`. Every toast here is
`type="foreground"`, because every one of them follows the user's own click.

| action | title | description | Undo |
| --- | --- | --- | --- |
| Keep | `Kept <filename>` | none | yes |
| Reject | `Rejected <filename>` | the final path, if renamed or if the destination is relative | yes |
| Restore | `Restored <filename>` | the final path, always | no |
| Un-keep | `<filename> is Active again` | none | no |
| `FileMissing` | `Couldn't restore <filename>` | the backend message | no |
| `InvalidTransition` | `<filename> has already changed` | none | no |

The asymmetry in the path line is deliberate. Both directions can rename,
because `unique_destination` suffixes ` (n)` outbound under
[ADR 0003](0003-soft-reject-write-ordering.md) and inbound under ADR 0009. But
a reject's destination is already on screen, so repeating it on every reject is
noise during a fast review pass, and a rename is one of the two cases where it
has something to say. A restore's Origin appears nowhere on screen, and ADR 0009
asks for the final path by name.

**Amended by [ADR 0018](0018-reject-destination-is-edited-in-settings.md).**
This section originally read "sitting in the field the user typed it into", and
ADR 0018 deletes that field: `reject_destination` is edited only in Settings,
and the two rejecting pages carry a read-out of it on their second bar. That
keeps the destination on screen, so the reasoning survives with one hole in it.
When the destination is relative it names a rule rather than a place, and under
[ADR 0011](0011-written-paths.md) a nested library then has one `rejected/`
folder per source folder, with nothing on screen saying which one took the file.
So the second condition above: name the final path when the file was renamed or
when the destination resolved relative, which is "name the path whenever the bar
could not". The frontend already computes that boolean for the read-out's own
clause.

ADR 0018 also settles where the path comes from, which this ADR asks for
without saying. `move_wallpaper` returns the final absolute path;
`restore_wallpaper` owes the same, from
[#39](https://github.com/QuantumFF/walltare/issues/39).

The origin-less legacy cohort never reaches a toast. ADR 0009 disables that
control on the library row with the reason on it, so the refusal is read before
the click rather than after it.

**Amended by [ADR 0019](0019-library-card-affordance.md).** That cohort does
reach a toast, and it is an error toast. `disabled` becomes `aria-disabled` so
the control stays focusable under ADR 0019's roving grid, and pressing it raises
a pinned `Can't restore <filename>` with the reason in the description. The
description is the frontend's own sentence rather than a backend message, since
`origin_path` is on the DTO and no call is made, which is the one place this
table's "the backend message" column does not apply.

### The keep inverse stays unnamed

`CONTEXT.md` gives the reject inverse a full entry, **Restore**, with its own
rationale. The keep inverse gets a clause in the Status section, "by undoing
the keep, Active again", and no noun. That is why the un-keep row is the only
one that leads with a filename instead of a verb.

Leave it that way. A Restore earns its name because it moves a file, can
rename, can fail on IO and clears an Origin. The keep inverse is one column
write with no story, and naming it invites the symmetry ADR 0009 already
refused when it declined to make `keep_wallpaper` a toggle. The copy names the
resulting Status instead, which is what actually changed.
[#57](https://github.com/QuantumFF/walltare/issues/57) needs a label for that
control and inherits this reasoning rather than the gap.

[ADR 0019](0019-library-card-affordance.md) settled it as **Make Active**, and
threw out the "Return to voting" that the prototype and #57's own body used: a
Kept wallpaper already votes, so that label names a change that does not happen.

## Alternatives rejected

**Sonner.** shadcn's current answer, and the reason the ticket assumed a
dependency was unavoidable. It is a new install, it would be the only component
in `ui/` not sitting on `radix-ui`, and it stacks by default at
`visibleToasts: 3`, so the settled newest-replaces-previous rule would be
something to configure around rather than the natural shape.

**Hand-rolling over the existing primitives.** The eighty lines are eighty
lines of the accessible parts: a keyboard route into a transient region, a live
region that announces without stealing focus, a timer that pauses on three
different signals, and a swipe. Radix has all four, already downloaded.

**Keeping the `role="alert"` paragraph for errors and toasting only successes.**
Two surfaces in one view, which is what the ticket set out to avoid, and it
splits the two ADR 0009 error kinds across both depending on whether the
operation reached the disk.

**Exempting errors from replacement, in a second pinned slot.** It saves an
error the user is ignoring, at the cost of the one-toast rule that every caller
is written against, and it reintroduces the stacking ADR 0009 rejected by a
side door.

> ADR 0021 adds a second slot and this paragraph still holds. That slot carries
> something with no end state and no click behind it, and it is invisible
> whenever anything else has something to say. An unread error is neither.

**Bottom-right.** The web convention, and equally free: ADR 0012's
pre-generation bar sits under the brand at the top and Review's action row sits
under the image, so neither corner is contested. Top-right was chosen on
preference, not on a measured cost.

**A general `Ctrl+Z` undo stack.** It promises to undo a vote, which
`CONTEXT.md` says never happens, and it would need a history the app does not
keep. Scoping the binding to the visible toast means it can only ever do what
the screen already offers.

**Naming the keep inverse in `CONTEXT.md`.** Covered above. Symmetry with
Restore is the trap, not the goal.

## Consequences

`src/components/ui/toast.tsx` is new. The shell owns the single toast slot and
exposes one `show()`; no view holds toast state of its own.

`ReviewView` loses three things at once: the reject confirm dialog that ADR
0009 already required it to lose, the `role="alert"` paragraph, and the `error`
state behind it, along with `KEEP_FAILED_ERROR` and `MOVE_FAILED_ERROR`, whose
generic strings are exactly what the backend messages replace.
`tests/ReviewView.test.tsx` asserts against both the dialog and the paragraph
and is rewritten.

`ReviewView` is the only consumer of `alert-dialog` outside `ui/`, so removing
the confirm dialog leaves that component unused until Settings needs it for
ADR 0012's `clear_cache`.

Nothing reaches `CONTEXT.md`. Toasts are UI plumbing, the same call ADR 0015
made about the freshness events, and the glossary stays free of implementation.

A user who ignores an error and keeps working loses the message. Accepted, with
the failed card left in the grid as the durable signal.

This ADR takes **0017** rather than 0016, because two files on main both
claimed 0015. `0015-library-page-scale.md` is renumbered to 0016 in the same
change, with its six inbound links updated;
`0015-navigation-shell.md` keeps the number it merged with first.
