# ADR 0022: The lightbox renders the grid's selection, and one rule covers every action

**Status:** Accepted
**Ticket:** [#60](https://github.com/QuantumFF/walltare/issues/60)
**Date:** 2026-08-26

## Context

[#44](https://github.com/QuantumFF/walltare/issues/44) settled what this surface
looks like: `medium` only, the image centred, Keep / Reject / Restore in a row
under it at the image's own width, identity on the left and the read-out beside
it, on an opaque backdrop. Every action in it raised a toast and did nothing, so
the behaviour was untouched.

Two of the four open questions turned out to be answered already.
[ADR 0016](0016-library-page-scale.md) decided Review and Library share a card,
a lightbox and an action set but not a page, so there is one component walking
whatever list is behind it. And [ADR 0017](0017-one-toast-at-a-time.md) gave the
toast the highest z-index in the app *because* keep and reject fire from in
here, with [ADR 0021](0021-background-work-is-a-pinned-toast.md) suppressing its
background slot on this surface. The lightbox is not an exception to the toast
rules; it is the case they were written for.

Seven things read out of the live library, `node_modules` and the platform set
most of what follows.

**This library has no portrait wallpapers.** 120 rows in `thumbnails`: the
narrowest is one square image at 1.0, the widest is 2.66, 33 are above 2:1 and
12 below 1.5. So the narrow-image floor below is design work for a category the
library does not contain.

**At the default 1280x800 window, #44's housing is invisible for half the
library.** The image box is about 1216x680, an aspect ratio of 1.79, so anything
wider is width-limited and paints the full 1216. That is 56 of 120 wallpapers
whose measured row is the window's width, which is the full-width caption bar
that #44 rejected. The 12 below 1.5 are where the shrink-wrap actually reads as
designed.

**A `medium` cache file here is 132KB at the smallest, 376KB median, 887KB at
the largest.** One step through the lightbox is that read, through the worker
pool, taking ADR 0016's two `Db` mutex acquisitions.

**A modal Radix Dialog breaks the toast twice.** `DialogContentModal` runs
`hideOthers(content)` from `aria-hidden`, which marks every sibling on the way up
as `aria-hidden="true"`. ADR 0017 established that Radix Toast does not portal
its viewport, so the viewport is one of those siblings and leaves the
accessibility tree, live region included. Separately, `FocusScope` with
`trapped: true` installs a `document`-level `focusin` handler that pulls focus
back to the last in-container element, so Toast's F8 handler does fire (it is
bound on `document.addEventListener("keydown")`) and its `viewport.focus()` is
immediately undone. Both failures land on the exact flow ADR 0017 built F8 and
`altText` for. `trapFocus` is not reachable from the public API:
`DialogContentImpl` takes it, `DialogContentModal` hard-wires it to
`context.open`, and `Dialog.Content` does not forward it.

**`inert` is available.** WebKitGTK 2.52.6 on this machine, and `inert` shipped
in WebKit 15.5.

**Nothing deletes a wallpaper row.** There is no `DELETE FROM wallpapers` in
`src-tauri/src` and no delete command; a scan only inserts. So a row can leave a
list because the user changed a status or a filter, and for no other reason.

**[ADR 0015](0015-navigation-shell.md) suppresses the shell key handler while
the lightbox is open**, which kills ADR 0017's `Ctrl+Z` in the one place a
reject fires from.

## Decision

### The lightbox renders the grid's selection

Not a cursor of its own. The grid and the lightbox share one selection, and the
lightbox is a second rendering of it.

That makes [ADR 0019](0019-library-card-affordance.md)'s selection rule the
answer to what an action does, without writing a second rule. Track by wallpaper
id; when that id is gone from the new list, fall back to the same index clamped
to the new length; when the list empties, fall back to the container. Every case
the ticket asked about falls out of it:

| the action | what the list does | what the lightbox does |
| --- | --- | --- |
| Keep or reject in Review | the row leaves | the index fallback lands on the next wallpaper, which reads as advancing |
| Reject in Library under All | the row stays, turns Rejected | the id still resolves, so it keeps showing the same wallpaper with its new Status and its new actions |
| Reject in Library under Active | the row leaves | advances, as in Review |
| the last row leaves | the list empties | the lightbox closes, onto the page's own empty state |

Advance, stay and close were the ticket's three candidates and all three are
wrong as a blanket rule, because each is right for a different one of those
rows. The list is what decides, and the selection rule already reads the list.

The empty case closes rather than holding a "nothing left" panel, because ADR
0015 already requires every destination to own an empty state that names the
reason and offers the route out. A second one inside the lightbox would be that
screen with less room.

A rescan finishing under an open lightbox adds rows and cannot remove the
current one, per the reading above, so it needs no handling.

### It clamps at the ends

`←` at the first wallpaper and `→` at the last do nothing, and the arrow buttons
render unavailable there.

The prototype wraps, `(index + 1) % list.length`, and nothing argued for it.
Review is a fifty-row worklist and reaching the end of it is information: it is
the moment the sweep is done. Wrapping hides that, and at ADR 0016's ceiling it
also means jumping from wallpaper 5,000 to wallpaper 1.

### The action set comes from the Status, and nothing else

The lightbox does not know which page opened it. It reads the wallpaper's Status
and renders what ADR 0009's transition table offers: Active gets Keep and
Reject, Kept gets **Make Active** and Reject, Rejected gets Restore.

Review's list holds only Active rows, so Restore and Make Active never appear
there without anyone configuring that. One component, no caller flag, and the
action set on a card cannot drift from the action set in the lightbox.

Nothing is greyed out to hold its space. The row's width already changes on
every step, because it is measured off a picture and no two wallpapers here
share an aspect ratio, so reserving button space stabilises the wrong axis. The
one control that renders while unavailable is ADR 0019's `aria-disabled` Restore
on an origin-less row, and it renders because it has a sentence to deliver:
pressing it raises the pinned `Can't restore <filename>` with the reason in the
description, no IPC call, since `origin_path` is on the DTO. The prototype's
`disabled` plus `title` is what ADR 0019 threw out, and it is worth saying again
here, because the prototype is the primary source for everything else on this
screen.

### The keys are the grid's keys, and ADR 0015's suppression goes

`←` and `→` step, `Escape` closes, and `K`, `Delete` and `R` do exactly what ADR
0019 gave them on the grid. One action-key vocabulary in the app, and ADR 0019's
touchscreen path through the lightbox is the keyboard path too.

**ADR 0015's "suppressed while the lightbox is open" clause is deleted.** That
clause buys nothing. The shell handler owns `Ctrl+1/2/3`, `Ctrl+,`, `?` and
`Ctrl+Z`, none of which collide with the five keys above, and the one that looks
dangerous, `Ctrl+2` swapping the view under an open lightbox, is already defined
behaviour: ADR 0015 says changing destination closes the lightbox. What the
clause actually did was disable `Ctrl+Z` in the one place ADR 0017 added it for,
and disable `?` in the one place a user is most likely to want the shortcut
list.

So the shell handler stays live, keeps its text-field suppression, and the
lightbox binds only the keys nothing else claims. `Ctrl+Z` works from in here
because the shell handler is running, not because the lightbox reimplemented it.

`Enter` does nothing inside the lightbox. It is the key that opened it.

### A non-modal Dialog, with `inert` doing the containment

`Dialog.Root modal={false}`, which gives `role="dialog"`, Escape through
`DismissableLayer` and focus restoration through `onCloseAutoFocus`, with
`trapFocus: false`, no `hideOthers` and no `RemoveScroll`. `aria-modal` goes on
the content by hand, and `inert` on the view container behind makes that claim
true.

That is the configuration that keeps both halves. Nothing behind the lightbox is
focusable or clickable, and the toast viewport is untouched, because it is not
inside the inerted container. The modal variant would trade a Tab that escapes
for a toast that no screen reader is ever told about, on the flow where a file
just moved.

Radix wants a `Dialog.Title` for `aria-labelledby`; the filename in the identity
line is it.

### The state is the page's, the DOM is the shell's

`Dialog.Portal`'s `container` points at a shell-owned node sitting between the
view container and the toast viewport. The page keeps the list, the selection
and the handlers; the shell owns the node and the stacking order.

Unlike the Toaster, the lightbox has no reason to survive a view swap, since ADR
0015 closes it on one, so mounting it inside the page was the obvious reading.
Two things rule it out. The toast has to paint above it, and ADR 0017 gave the
toast the highest z-index for this exact reason, so the two need ordering in one
file. And `position: fixed` resolves against the nearest ancestor carrying a
transform, filter or containment, so a lightbox inside a view container is one
`animate-in` variant away from being clipped to the page. `ReviewView` already
carries `animate-in fade-in`.

Keeping the state in the page is what stops this becoming a lifting exercise.
The list changes on every action, so a shell that held it would need re-pushing
each time, and the shared selection above would have to move up with it. The
portal separates where the state lives from where the pixels land, which is the
only reason to reach for one.

It also makes `inert` safe. The lightbox is provably outside the container being
inerted, rather than depending on where in the page tree someone mounted it.

### The row floors at the buttons, and the read-out drops first

The row's width is measured off the painted picture, per #44. Below the width
the buttons need, it overhangs the picture down to a fixed floor, and below that
the read-out is what drops. The identity and the buttons never drop.

The worst realistic case is a 9:16 phone wallpaper at 1280x800, which paints
382px wide against a row holding a Score badge, a filename, a status pill, a
path, a Score and comparison count, a position, and up to two buttons. An
overhanging row reads as controls refusing to shrink. A row that clips its own
buttons reads as a bug, and the read-out is the one part that tells the user
nothing they need in order to act.

The keys move onto the buttons: `Keep K`, `Reject Del`, `Restore R`. The
prototype's `← → navigate · Esc close` hint goes, and the arrows and Escape live
in ADR 0015's `?` dialog. A key printed on the control it fires is worth more
than a key in a hint line, and it survives the row narrowing, because the
buttons are what never drop. The position, `3 / 50`, stays, because clamping
made the end of the list mean something.

### The picture never blanks

On a step, the outgoing image stays painted until the next one fires `load`. The
prototype's `<img key={w.id}>` remounts instead, so a held arrow key strobes to
black at a median 376KB a frame.

On first open there is nothing to hold, so the card's `small` paints scaled up
behind the `medium`. It costs one element and no request, because under ADR
0016's `max-age=300` the `small` the card just painted is in the memory cache.
The lightbox opens on a blurry version of the picture the user clicked, which is
the right thing to be looking at while the `medium` arrives, and it beats a
spinner on the one path where the cache is cold: ADR 0006 measured a cold
release `medium` at 386ms mean and 1962ms worst.

Neither neighbour is prefetched. `max-age=300` already makes a step back free,
so only the forward edge ever pays, and speculative image requests go into the
one pipeline [ADR 0012](0012-thumbnail-pre-generation.md) built a dedicated
thread to keep clear.

### A Rejected wallpaper shows its Origin, and keeps its colour

No dimming and no desaturation. ADR 0019 dims a Rejected card's `<img>` so it
recedes in a mixed grid; the lightbox exists to show one picture at full size,
which is the opposite job. The status pill carries it.

For a Rejected wallpaper the mono line shows the **Origin**, with the current
path in `title`. Every other Status shows `path`.

That is ADR 0017's rule for the toast copy applied to a read-out: name what is
not already on screen. The Origin is what Restore is about to act on and it has
never been rendered anywhere in the app, while the reject folder is named by ADR
0018's bar and by ADR 0019's card. `origin_path` is on the DTO, so this costs a
slot in the row and no call. An origin-less legacy row has no Origin, so its
line falls back to `path`, with the `aria-disabled` Restore beside it carrying
the explanation.

### A failed action brings the selection back

Review removes the card optimistically and re-inserts it on failure
(`restoreCard`, `ReviewView.tsx:85`). Under the selection rule above, an
optimistic reject moves the selection on immediately, so a failure would leave
the lightbox showing wallpaper N+1 while the error toast names wallpaper N. The
failure handler sets the selection back to the re-inserted id.

One line, because the selection is already keyed on id and the id is already in
hand. The alternative, waiting for the call, stalls every reject on a file move
during a sweep, and ADR 0019 chose two keystrokes over four for exactly that
sweep.

### Closing puts the selection back on screen

`preventDefault` on `onCloseAutoFocus`, then scroll the selection into ADR
0016's virtual window and focus that card in a layout effect after the row
commits.

Radix would otherwise focus `context.triggerRef`, the card the lightbox opened
from, which after stepping through 200 wallpapers is both the wrong card and
probably an unmounted one. The mechanism is ADR 0019's, verbatim; that ADR
already owns this problem for the grid's own arrow keys, and closing the
lightbox is one more way to reach an index outside the window.

The grid does not scroll while the lightbox is open. Mounting cards behind an
opaque backdrop paints nothing and fires `small` requests that compete with the
`medium` the lightbox is waiting on.

### The mouse opens it from the card body

Clicking anywhere on the card that is not a button opens the lightbox. There is
no separate open control; ADR 0019 made the card a `gridcell`, so the cell is
the target and the overlay's buttons stop propagation. That is also the
touchscreen path ADR 0019 designed and declined to build anything else for,
since a tap on a hover-less pointer reaches the cell rather than the overlay.

### The surface is called the lightbox

**This corrects the ticket's own title.** The docs carry two names for it, and
one of the two is already doing a different job. ADR 0013, 0015, 0016, 0017,
0019 and 0021 say lightbox. The ticket, ADR 0018 and ADR 0019 say preview.
Meanwhile [ADR 0011](0011-written-paths.md) has a section titled "The preview"
where preview means the resolved-path read-out under a path field, ADR 0018 uses
both senses in one file, and ADR 0020 inherited the path sense. "The preview
shows nothing" in ADR 0018 and "the preview below is what stops it being a
guess" in ADR 0011 are about different screens.

So: the image surface is the **lightbox**, and **preview** stays reserved for
the resolved-path read-out. Lightbox has six ADRs behind it against two, it is
the word #44 settled on, and the path sense has the better claim on "preview",
since showing what a typed path resolves to before you commit is what the word
means. ADR 0018's image-sense uses are corrected in place; ADR 0011 and ADR 0020
keep theirs.

This is ADR 0020's rule from Library root, third application on this map after
that one and ADR 0019's kill of "Return to voting".

## Alternatives rejected

**Advance always.** The ticket's first candidate, and it is wrong in Library
under filter All, where the rejected wallpaper is still in the list and moving
off it hides the state change the user just made.

**Stay always.** Wrong in Review, where staying means looking at a wallpaper
that has left the list being walked.

**Close on every action.** Wrong everywhere. A reject-heavy sweep would reopen
the lightbox once per wallpaper.

**A separate lightbox cursor, synced to the grid's selection on open and close.**
The obvious shape, and it needs a sync rule in both directions plus a decision
about what happens when a `library-scanned` refetch lands between them. Sharing
one selection has no sync to get wrong, and ADR 0019 already wrote the rule it
needs.

**Wrapping at the ends.** What the prototype does. See above.

**A caller flag for the action set.** Two configurations to keep in step with
ADR 0009's transition table, when the Status already answers it.

**Greying unavailable actions so the row keeps its width.** See above.

**A modal Dialog.** Costs the toast twice over. See Context.

**Building on `DismissableLayer` and `FocusScope` directly to get
modal-minus-trap.** More code than the non-modal path, for a worse result:
`FocusScope`'s trap is the half that fights F8, so what survives is the half
worth having anyway.

**Dropping the trap and containing nothing.** What the prototype does, which has
no `role`, no `aria-modal`, no focus restore, and lets Tab walk into the grid
underneath an opaque backdrop.

**Mounting the lightbox inside the page.** See above; the z-index ordering and
`position: fixed` under a transformed ancestor.

**Lifting the list and the selection into the shell.** The other way to get the
DOM into the shell, and it makes the shell hold state that changes on every
action.

**Prefetching the neighbouring `medium`s.** Buys nothing on the way back, which
`max-age=300` already covers, and puts speculative requests into ADR 0012's
protected pipeline.

**A spinner on first open.** Free, and it shows the user a spinner instead of
their wallpaper when a scaled `small` is already in the memory cache.

**Blocking the action on the IPC call, so the lightbox never advances past a
failure.** See above.

**Keeping ADR 0015's suppression and giving the lightbox its own `Ctrl+Z`.** The
first answer to that hole, and hitting the same hole a second time with `?`
showed it was treating the symptom. It also ships two handlers that both think
they own `Ctrl+Z`.

**Scrolling the grid along while the lightbox is open**, so the card is mounted
when it closes. Pays for card mounts nobody sees.

**Capping the image's width so the row never reaches the window's edge**, keeping
#44's shrink-wrap legible for the 56 width-limited wallpapers. It shrinks the
picture on half the library to make a layout decision visible, which is backwards.

**Serving `full` here** so the picture does not upscale on a wide window. Ruled
out of scope on the map: ADR 0006 measured the largest file in the test library
at 1962ms release and 58s debug.

**Keeping "preview" for the image surface and renaming ADR 0011's.** Moves a
term two shipped ADRs and a Settings field already depend on.

## Consequences

**ADR 0015 loses a clause.** "Suppressed while the lightbox is open" is deleted,
and the amendment is recorded there. Any future layered surface that wants the
shell handler off has to say why.

**ADR 0017's z-index paragraph gains its mechanism.** It said Radix does not
portal the viewport and drew the right conclusion. What it could not have known
is that a modal layer over that viewport also aria-hides it, so the z-index is
necessary and not sufficient. Recorded there as a constraint on anything modal
that ever covers this app.

**ADR 0016's unverified `max-age=300` gains two dependents.** The step-back and
the `small` placeholder both assume WebKitGTK's memory cache honours `max-age`
for a custom scheme, which that ADR flags as unverified. If it does not, neither
feature breaks: the placeholder re-requests a 31KB `small` and a step back
re-reads a `medium`. Both get slower, and the fallback that ADR names, a
frontend `Map<id, blob>`, would serve all three.

**ADR 0019 gains the mouse path it left unstated**, and its touchscreen
paragraph is now built rather than promised.

**The floor is untested against a real portrait wallpaper**, because the library
has none. The arithmetic is above; the number wants checking against a 9:16 file
once one exists.

**On a wide window the `medium` upscales.** At 2560 the image box is about
2496px against a 1920px `medium`. Same trade ADR 0016 accepted for HiDPI cards,
and serving `full` is out of scope.

**Two dialogs can be layered**, since `?` now works from inside the lightbox.
Radix's `DismissableLayer` stack gives Escape to the topmost, so the shortcut
list closes before the lightbox does.

**A missing file fills the window with a broken image.** The lightbox is where
that is most visible, and the actionable control is Restore, which answers with
ADR 0009's `FileMissing` sentence. Nothing here improves on that.

**No `CONTEXT.md` change.** The selection model, the keys and the housing are
UI, and the one vocabulary decision in this ADR settles which of two existing
words the docs use rather than adding a term. Lightbox stays out of the glossary
for the same reason toasts and views did.

**This was the map's last open ticket.** With it resolved,
[#37](https://github.com/QuantumFF/walltare/issues/37) has nothing left to
decide.
