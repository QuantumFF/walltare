# ADR 0032: A missing file is a rendering fact, not a fourth Status

**Status:** Accepted
**Ticket:** [#200](https://github.com/QuantumFF/walltare/issues/200),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

A wallpaper whose file is deleted or moved outside the app leaves a row pointing
at nothing. Nothing deletes a `wallpapers` row — `comparisons` references it with
`RESTRICT` and `CONTEXT.md` says Comparisons are never deleted — so the row
survives, the `wallpaper://` handler answers 404, and the only symptom is a card
that never paints.

Until now that was the whole of what the app said about it. ADR 0022 looked
straight at the case and left it:

> **A missing file fills the window with a broken image.** The lightbox is where
> that is most visible, and the actionable control is Restore, which answers
> with ADR 0009's `FileMissing` sentence. Nothing here improves on that.

That reasoning holds for the machine this was built on, where the library only
changes when the app changes it. It does not hold for the first release. A
stranger's library changes underneath the app constantly: files get deleted,
folders get renamed, external drives get unplugged. Epic #195 names this as the
gap most likely to look like a bug, and a broken image is exactly the reading it
produces — the app looks broken rather than the library looking changed.

Two things were true at the same time, and they pull in opposite directions:

- **The card already knows.** Every card makes a `wallpaper://` request and the
  request either paints or fails. Nothing has to be added for the card to find
  out, and the failure catches every cause — a deleted file, a broken symlink, a
  permission the curator lost, a source that will not decode.
- **The count cannot be free.** "How many are missing?" is a filesystem
  question, and the only honest answer walks the rows. ADR 0016 sizes the
  library grid at 5,000 wallpapers, so a check on the listing path is 5,000
  `stat` calls per visit to serve a case most curators never hit.

## Decision

### There is no fourth Status

A missing file is a fact about the filesystem at the moment somebody asked, not
a thing a wallpaper *is*. It becomes true when a drive is unplugged and false
again when it is plugged back in, with the curator doing nothing either time,
while every Status in `CONTEXT.md` moves only through a transition the curator
asked for.

So `CONTEXT.md` is untouched, ADR 0001's three Statuses stand, and ADR 0025's
transition guard is not widened. Inventing a Status would have reached all three
documents plus the `CHECK` constraint, and the table still could not drop the row
anyway.

That work may be right later. It is not right a week before a first release.

### The card reacts to the load failure it already causes

`WallpaperCard` holds one piece of state — did the `<img>` fire `error` — and
paints a panel over the picture saying **File is gone**, with an `ImageOff` icon
above it.

Detection is the failure and nothing else. No field on the DTO, no flag on the
listing, no second command per card. A flag would need the `stat` per row this
ADR is refusing, and it would still be one pass behind the truth.

The panel goes **over** the `<img>` rather than instead of it, so the element
that would report a change is still mounted and `load` clears the state as well
as `error` setting it. It sits before the badge, the pill and the reveal layer in
the DOM, none of which is in a stacking context of its own, so a gone card keeps
its Score, keeps its Status pill and keeps every transition its Status offers.
Rejecting or restoring a wallpaper whose file is gone is exactly what the curator
might want to do about it, and ADR 0009's `FileMissing` is what answers if the
move has nothing to move. It takes no pointer events, so the cell underneath is
still the click target and a gone card still opens the lightbox.

The gone state joins the card's accessible name, for the reason ADR 0019 put the
Status there: the cell's own `aria-label` hides its contents, so an icon and a
label inside it reach nobody reading with a screen reader unless the name says
it.

### The lightbox says the same thing, with the sentence the card has no room for

Two lines: **File is gone**, and *It was moved or deleted outside walltare.
Nothing here has changed.* The second line is the half the curator cannot see and
the whole point of the state — it is what makes their library reading as changed
rather than the app reading as broken.

`error` still counts as arrival, the way ADR 0006's rank panes count it, because
a `small` held up in front of a picture that is never coming is the spinner that
never resolves. What the failure leaves is this panel instead of ADR 0022's
broken image.

It sits in the same grid cell as the two images and after them in the DOM, so it
covers the failed request with no z-index; the row is absolutely positioned and
comes later still, so the read-out under the picture — which is the one place in
the app that names the path the file was meant to be at — and all four possible
actions stay exactly where they were.

Unlike the card's, this state resets per wallpaper. The `<img>` has no `key`
(ADR 0022: the outgoing picture holds the frame through a step), so without the
reset the message would sit over a picture that is still painted and stay there
for a wallpaper that loads fine.

### Gone is distinguishable from generating because generating says nothing

A thumbnail still on its way is the plain card frame with nothing in it, which
is what it already was. No skeleton and no spinner is added to the grid: ADR 0016
mounts a window of cards out of five thousand and a wheel pass remounts them
continuously, so a placeholder per card would animate the whole grid to announce
something a request resolves in a few hundred milliseconds (ADR 0006: 386ms mean
in release).

The words go to the state that *never* resolves. That asymmetry is the
distinction, and it is the right way round: waiting is temporary and silent,
gone is permanent and says so.

### Settings counts it, on a press, in one pass

```rust
count_missing_files() -> Result<MissingFiles, AppError>
struct MissingFiles { missing: i64, eligible: i64 }
```

A fifth section, **Missing files**, last on the page — first-run need first,
maintenance last, which is the rule that put Thumbnails fourth. One outline
button reading **Check now**, **Checking…** while a walk runs, and one line
about the last press:

| state | line |
| --- | --- |
| never pressed | no line |
| checking | none; the button's verb carries it |
| none missing | `No files missing · 120 wallpapers checked` |
| some missing | `3 files missing · 120 wallpapers checked` |
| failed | `Couldn't check the library for missing files.`, in the destructive colour |

**Nothing reads it on mount**, unlike the Thumbnails line beside it.
`get_cache_size` reads one directory the app owns; this is a `stat` per Active or
Kept row against paths that may be on an external drive or a network mount.
Opening Settings to change the theme must not walk somebody's library. Nothing
refreshes it afterwards either: a count is about the moment it was taken, and the
button is how the curator takes another.

**The pool is Eligible.** Active plus Kept, off `db::Status::ELIGIBLE_SQL` so
this count and `voting.rs`'s four aggregates cannot come to disagree about which
wallpapers that means (ADR 0024). A Rejected wallpaper is excluded because its
file moved to the reject destination on purpose and its row followed it there, so
it is exactly where the library says it is. One whose file the curator has since
emptied out of that folder is not missing either — the destination is a folder
they own, and ADR 0009 already answers a Restore of one with `FileMissing`.

`eligible` rides along with `missing` from the same pass rather than being read
off `Stats`, because a bare count answers nothing — three of five is a broken
library and three of five thousand is a Tuesday — and two numbers from two passes
can print a ratio that was never true.

**The count is of files that are not there, not of every card that will not
paint.** A file that is present and will not decode reads as gone on its card,
because the card reacts to the request failing, and it is not in this number. The
line says `files missing` for exactly that reason. Issue
[#202](https://github.com/QuantumFF/walltare/issues/202) is where a truncated
file gets its own answer.

**There is nothing to fix from here.** No control drops the rows: that would take
their Comparisons with them, which the domain does not allow. The honest offer is
a number, plus the library grid where each card says which wallpaper it was.

### Two halves in Rust, because one of them must not hold the lock

`missing::eligible_paths(&Connection)` is the database half and
`missing::count_missing(&[String])` is the filesystem half. The command in
`lib.rs` calls them in order and holds the lock across only the first, which is
ADR 0004's split for the same reason: 5,000 `stat` calls under the connection
mutex would queue every command and every `wallpaper://` request behind a walk of
somebody's external drive.

It is also what makes each half testable alone — the query wants a `&Connection`
and no disk, the count wants a temp directory and no database — which is what
leaves the command a wrapper with no logic in it.

## Alternatives rejected

**A fourth Status, or a `missing` column.** Legible, sortable, filterable. It
reaches `CONTEXT.md`, ADR 0001, ADR 0025's guard and the `CHECK` constraint, for
a property that changes without the curator doing anything and that the table
cannot act on anyway, because the row cannot be dropped.

**A `missing` boolean on the `Wallpaper` DTO.** The card would read it with no
new state and Settings could count it off a listing it already fetches. It is a
`stat` per row on every listing — 5,000 on the library page, per visit — to serve
a case most curators never hit, and the flag would still be stale by the time the
grid painted. The load failure is free and never stale.

**A spinner on the card while the thumbnail generates.** Makes the wait explicit
and the distinction from gone louder. It is 5,000 animated placeholders under
ADR 0016's virtualisation, remounted continuously by a wheel gesture, to announce
a few hundred milliseconds. ADR 0006 put the spinner on Rank's two panes because
the wait there blocks a permanent Comparison; nothing in a browsing grid is
blocked by it.

**Alt text and the browser's own broken-image glyph**, which is what the app had.
Free, and it is the reading this ADR exists to fix: it says something failed, not
that the file went, and a curator whose drive is unplugged concludes the app is
broken.

**A toast when a card fails to load.** Consistent with ADR 0017's single error
surface. A grid of hundreds would raise hundreds of them for one unplugged drive,
and ADR 0017 allows one toast at a time — so the curator would get one arbitrary
filename and no count. The card is where the wallpaper is, and Settings is where
the count is.

**Reading the count on mount, like the cache size.** One less press, and the
number is there when the curator looks. It spends a filesystem walk of a
library that may be on a network mount on every visit to change the theme, which
is precisely the trade the listing path already refused.

**Putting Missing files under the Library root**, where it is about the same
folder. It sits a filesystem walk between a first-run curator and the Scan button
that is the only thing they need, and ADR 0020's order is need first, maintenance
last.

**Counting every row rather than the Eligible pool.** Simpler query, one number.
It reports every reject the curator ever made as a problem, since a Rejected
row's `path` follows its file into the reject destination and is not missing at
all.

## Consequences

`Command` in `client.ts` names 17 commands rather than 16.

The Settings page has five sections. `SettingsView.test.tsx`'s three
section-count assertions moved with it, which is the whole cost of the change
there: nothing else on the page shifted, because the new section is last.

The card and the lightbox each hold one more piece of local state. Neither is
derived from the row, so neither survives a remount — a card scrolled out of
ADR 0016's window and back in asks the question again, which is correct: the
answer may have changed, and the request is being made either way.

The count and the cards can disagree, in one direction only. A file that is
present and will not decode paints as gone and is not counted. That is stated on
the line's own wording and in `missing.rs`, rather than papered over by having
the count open every file — which would turn a `stat` per row into a decode per
row.

One thing here is not verifiable without a display, and it is the trigger.
happy-dom fetches no `<img>`, so the suite fires the `error` the browser would
rather than WebKitGTK failing a real `wallpaper://` request. Everything after
that — the panel, the accessible name, the reset on a step, the line, the button
— is driven through the mocked IPC seam. Deleting a file under a running app and
looking at the card belongs on the release checklist epic #195 asks for, beside
the content security policy and the NVIDIA launch path, which are untestable for
the same kind of reason.
