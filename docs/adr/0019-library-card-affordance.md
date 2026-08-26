# ADR 0019: The grid is one composite widget, and a Rejected card stays dimmed

**Status:** Accepted
**Ticket:** [#57](https://github.com/QuantumFF/walltare/issues/57)
**Date:** 2026-08-26

## Context

Keep and Move exist only inside a `group-hover` overlay (`ReviewView.tsx:215`).
There is no keyboard path to either and no touch path to either, and nobody
noticed because Review was one grid of fifty cards that a mouse could always
reach.

Three things landed since that make the gap load-bearing.
[ADR 0009](0009-reject-is-reversible.md) adds Restore and the keep inverse, so
the overlay holds four controls rather than two.
[ADR 0016](0016-library-page-scale.md) virtualises the library grid to a ceiling
of 5,000 wallpapers, so most cards have no DOM node at any moment. And
[#44](https://github.com/QuantumFF/walltare/issues/44) settled the card itself,
a dense `aspect-video` card with the Score badge top right, a status pill top
left, and the actions in a bottom overlay, which is what left the affordance as
the only open half.

Virtualisation is what decides most of this. A tab order that walks DOM nodes
walks a window of about thirty cards and then leaves the grid, so wallpaper
3,000 is unreachable by keyboard no matter how the cards are marked up.

Two things found while reading:

**`RankView.tsx:254` binds `ArrowLeft` and `ArrowRight` on `window`**, and
[ADR 0015](0015-navigation-shell.md) keeps Rank mounted under `display: none`
while another view is showing. Any arrow-key model for the library grid casts
votes in a view nobody can see.

**The prototype's overlay already carries `group-focus-within`** beside
`group-hover`, and its Restore button is `disabled` with the reason in a
`title`. Neither was argued for.

## Decision

### The grid is one tab stop with a roving selection

The grid container is `role="grid"` with one accessible name; each card is a
`gridcell` carrying `tabindex="-1"`, except the selected one at `0`. Tab reaches
the grid and Tab leaves it. Inside, arrow keys move the selection by column and
row, `Home` and `End` reach the first and last card. This is the pattern ADR
0015 already put in the chrome's tablist, so the app has one composite-widget
model rather than two.

The selected card reveals its overlay through `group-focus-within`, which is the
same reveal a hover gives.

Moving the selection to an index outside the virtual window means asking the
virtualiser to scroll it in first, so focus moves in a layout effect after the
row commits rather than inside the key handler. Focusing a node that does not
exist yet is the one way this pattern breaks.

Review's grid gets the same treatment from the same component. Its fifty rows
would work under any of the models here, and a second interaction model to learn
is worse than the one it saves.

**Focus as a second reveal trigger costs nothing to measure.** The ticket asked
whether `group-focus-within` widens what ADR 0016's parked frame-time plan has to
cover. It cannot. That ADR's library card animates no property and declares no
`will-change`, so the overlay pops with no transition and there is no composited
layer to promote on either trigger. The plan under "If the grid ever janks"
stands unchanged. Review's card still animates, but a keyboard selection moves
one card at a time under a deliberate keypress, which is not the streaming wheel
gesture [ADR 0007](0007-review-card-layer-promotion.md) measured.

### The selection acts with direct keys, and Enter opens the preview

On the selected card: `K` keeps, `Delete` rejects, `R` restores, `Enter` and
`Space` open the preview. Each key does nothing when the card's status does not
offer that action.

The keys hang off the grid container's own `keydown`, so they fire only while
focus is inside the grid. That is the dividing line this ADR draws and Q3 below
depends on: global shortcuts live in ADR 0015's shell handler, view-local keys
live on the element that owns the focus.

`Delete` rather than a letter for reject is what keeps `R` unambiguous. A
Rejected card offers only Restore and a non-Rejected card offers only Reject, so
one `R` for both is technically unambiguous, and it would still be the same
finger producing opposite outcomes on cards that sit next to each other in a
mixed-status grid. `Delete` also carries the right shape for the one action here
that moves a file.

Rejecting with a single keypress and no confirm is deliberate. ADR 0009 deleted
the confirm dialog and put act-then-undo in its place, so the safety is
[ADR 0017](0017-one-toast-at-a-time.md)'s toast and its `Ctrl+Z`, which presses
the visible toast's Undo. Focus stays on the grid when a toast appears; Radix
reaches the viewport with `F8` and nothing needs to move.

### Rank's arrow handler gates on the view

`RankView`'s `window` listener checks the current view before voting. One line,
and it is a consequence of ADR 0015 that ADR 0015 did not write down: keeping a
view mounted under `display: none` keeps its global listeners live.

The lightbox case falls out for free. The lightbox opens over Library or Review,
so the view is not Rank and the gate already holds.

### The selection follows the wallpaper, then the position

An action can remove the selected card, restyle it in place, or move it. A
reject under filter Active removes it; under filter All it stays and turns
Rejected; any Score ordering can move it, and a rescan or a vote can reorder
around it.

Track the selection by wallpaper id. When that id is gone from the new list,
fall back to the same index clamped to the new length, and when the list empties,
to the grid container.

Index-only is simpler and wrong in the case that matters. A user mid-sweep who
switches filter or ordering would find the selection jumped to whatever now
occupies that slot. [ADR 0014](0014-library-page-ordering.md)'s `id` tiebreak
already stops the live library's 101-row μ tie reshuffling under a vote, so the
id lookup succeeds almost always and the fallback is for the delete case.

### A touchscreen goes through the preview

Nothing is built for it. A hover-less pointer taps the card, the preview opens,
and [#60](https://github.com/QuantumFF/walltare/issues/60)'s Keep, Reject and
Restore are the touch path. One extra tap per action.

This is a local desktop app for curating a folder of wallpaper files, and both
alternatives cost more than that tap. A `@media (hover: none)` rule that pins the
overlay open covers the bottom of every card permanently, on a grid whose job is
showing images. Tap-to-reveal is a second interaction model to build, test and
explain.

Written down here so the next reader takes it as a decision rather than an
oversight.

### A Rejected card keeps its dimming

The prototype found that `opacity-60 grayscale` reads as a failed thumbnail in a
dense grid, with the `Rejected` pill carrying the whole signal. The treatment
stays anyway.

Library's default filter is All, so rejects sit mixed in with the live library on
every visit, and a wallpaper that has sat out of voting should recede rather than
compete. Dimming says that directly. And the failure it resembles is one ADR 0016
all but removed: pre-generation covers the whole `wallpapers` table with rejects
as a tail group, and anything the pass has not reached generates lazily on
request, so a card showing nothing is a state the app has to work to reach.

One refinement. **The dimming and the desaturation apply to the `<img>`, not to
the card.** In the prototype both sit on the wrapper, which drags the pill, the
Score badge and the whole action overlay to 60% with the image. White text on a
`black/70` gradient at 60% opacity is not a contrast the overlay can afford, and
the buttons are the one part of a Rejected card that has to stay usable, since
Restore lives there. Keeping the card's border and surface at full strength also
does some of the work the prototype's note asked for: a solid frame around a
faded image reads less like a failed load than a faded frame around one.

### The card names the folder that took the file

The overlay's second line reads the comparison count and, for a Rejected card,
the folder its file now sits in.

```
14 comparisons · now in rejected/
```

The containing folder's name only, with the full path in `title`. ADR 0018 put a
read-out of `reject_destination` on both rejecting pages and named the hole it
could not close: a relative destination like the default `./rejected` states a
rule rather than a place, and in a nested library the files scatter across one
`rejected/` folder per source folder. The bar cannot resolve that, because the
answer differs per wallpaper. The card holds the row's real `path`, so it is the
one surface that can answer it, and it answers it for every Rejected wallpaper
rather than only for the one the last toast was about.

### An origin-less row explains itself when pressed

ADR 0009 leaves rows rejected before its migration with no Origin and no way
back, and asks the library page to disable the control with the reason on it. The
prototype read that as `disabled` plus `title`.

Instead: `aria-disabled="true"` on a control that stays focusable and stays in
the roving selection, styled as unavailable. Pressing it raises ADR 0017's error
toast, pinned, titled `Can't restore <filename>` with the sentence in the
description.

A `disabled` button is not focusable, so under the keyboard model above the
reason is unreachable by keyboard and silent to a screen reader, which is most of
the people the explanation exists for. `aria-disabled` is the pattern for a
control that has to explain itself rather than merely refuse.

No IPC call. `origin_path` is on the DTO under ADR 0009, so the frontend knows
the answer before the press, and ADR 0017 already built the surface that holds a
sentence. This is the same instinct ADR 0009 had when it added `FileMissing` so
the user would read a sentence instead of an errno.

### The keep inverse is labelled Make Active

ADR 0017 handed this ticket the label and its reasoning: no coined noun, name the
resulting Status. The control on a Kept card reads **Make Active**, and produces
that ADR's `<filename> is Active again`.

**This corrects "Return to voting"**, which appears in this ticket's own body and
in the prototype, and is wrong against the glossary. `CONTEXT.md` says a Kept
wallpaper "still participates in voting, but never appears in review". Kept is
Eligible and votes exactly as Active does. What un-keeping restores is
appearance in Review, not participation in voting, so the phrase names a change
that does not happen. Anyone reading only the ticket would ship it.

## Alternatives rejected

**Every card a tab stop, with its buttons after it.** The naive reading, and
virtualisation kills it twice. At ADR 0016's ceiling it is 15,000 tab stops, and
Tab from the last mounted card leaves the grid entirely, so most of the library
is unreachable however long the user holds the key.

**The buttons in the tab order and the card out of it.** Same defect, two thirds
of the tab stops.

**The preview as the only keyboard path**, arrow to a card, `Enter`, act, `Escape`.
Zero new bindings and zero new decisions, since #60 already owns the preview's
action set, and it was close. ADR 0016 makes Review and Library share this card,
and Review is a fifty-row worklist that exists to be swept. Four keystrokes per
wallpaper against two, fifty times, is the case that pays for the direct keys.
`Enter` still opens the preview, so this path exists as well.

**`R` for both Reject and Restore.** Never ambiguous on a given card and still a
trap on a mixed-status grid. See above.

**`stopPropagation` on the grid for the Rank collision.** `window` listeners fire
last on the bubble path, so whether this works depends on where the grid's
listener sits relative to the document, which is exactly the kind of ordering
that survives review and breaks on a refactor.

**Moving Rank's arrow handling into ADR 0015's shell handler.** That handler owns
global shortcuts, and Rank's arrows are not global. Folding them in means the
shell knowing which view wants bare arrows, which is the gate this ADR adds,
relocated somewhere with less claim to it.

**A `@media (hover: none)` rule pinning the overlay open**, and **tap-to-reveal**.
See above.

**Dropping the opacity and keeping only the greyscale.** The reading that opacity
is what produces the failed-load impression, since a full-contrast black and
white image looks deliberate and a washed-out one looks broken. It loses to what
the dimming is for: on a grid defaulting to All, a Rejected wallpaper should be
quieter than a live one, and greyscale alone barely is on a wallpaper that was
never colourful.

**Giving Rejected its own pill colour**, or **carrying the status in the card's
border or surface.** Both hedge the dimming with a second visual system for a
complaint this ADR decided to overrule. If the dimming is right, it needs no
hedge, and if it is wrong, a coloured pill will not save it.

**`disabled` plus `title` on the origin-less Restore.** What the prototype did.
Reachable by mouse only, and silent to the assistive technology the sentence was
written for.

**Replacing the origin-less Restore with static text.** Honest and it loses the
sentence: there is no room for "rejected before Restore existed, so nothing
recorded where it came from" in an overlay button's worth of space, which is why
the reason has to arrive somewhere else on demand.

**Un-keep as the label.** Accurate, and it coins the noun ADR 0017 deliberately
kept out of the glossary. Naming the resulting Status is the rule that ADR set,
and this is the control it set it for.

**Return to review as the label.** Accurate where "Return to voting" is not, and
it reads as a demotion for a control the user reaches by changing their mind
about a keep.

## Consequences

`RankView.tsx:254`'s handler gains a view check, and the frontend tests gain a
pin that arrows pressed while Library is showing cast no vote. That is a
regression the current architecture invites every time a view is added.

The grid needs an accessible name, and each card an accessible name carrying the
filename and the status, since the status is otherwise a pill and a dimming.

`the_two_hover_animated_elements_declare_will_change` keeps pinning Review only,
as ADR 0016 said it would. Nothing here adds a library equivalent.

No `CONTEXT.md` change. The keyboard model, the selection and the card treatment
are UI, and the one term this ticket touched, the keep inverse, stays unnamed by
ADR 0017's decision.

**`Delete` rejects with no confirm and no modifier.** A stray press on a focused
grid moves a file. The toast's Undo is the whole safety net, and ADR 0009 already
accepted that trade when it deleted the confirm dialog. Worth watching once it is
in a real hand.

**The two grids diverge on hover and converge on the keyboard.** ADR 0016 already
warned that the library's card animates nothing while Review's scales and fades.
They now share an interaction model exactly, which makes the visual difference
look more like an oversight than it did. It is not; read ADR 0007 before
unifying them.

**A Rejected card's overlay is legible while its image is not.** That is the
point of moving the opacity to the `<img>`, and it does mean a Rejected card's
chrome is brighter than the picture it sits on, which is unusual and deliberate.

**The folder line shows a name, not a path.** Two source folders each with their
own `rejected/` produce the same line on two cards, and the `title` is what tells
them apart. Fixing that means rendering a path in a space that fits about thirty
characters, which is worse.
