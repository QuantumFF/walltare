# CONTEXT

Glossary for walltare. Terms only; no implementation.

## Wallpaper

A single image file known to the app. Identified by its absolute path; one wallpaper per file.

## Library root

The folder a scan walks to find wallpapers, including everything beneath it.
One folder, chosen by the user.

The Library root is a stated preference, not a fact about the library. It can
point somewhere that no longer exists, and the wallpapers an earlier scan found
stay in the library regardless of where it points now. It is a Written path.

## Written path

How the user writes a folder for the app to use: the Library root, and a soft
reject's destination. It may use `~` for the home folder and environment
variables, and the app stores it as written, so it keeps meaning whatever those
mean on the machine reading it. Naming a variable that is not set is an error,
not an empty string.

A Written path that is not absolute is relative to different things depending on
where it is used. A soft reject destination is relative to the wallpaper's own
folder, so a nested library gets one reject folder per source folder. A Library
root is relative to wherever the app was launched from. See
[ADR 0011](docs/adr/0011-written-paths.md).

## Status

Every wallpaper is exactly one of:

- **Active**: participates in voting and appears in review.
- **Kept**: the user has explicitly decided to keep it despite its rating. Still participates in voting, but never appears in review.
- **Rejected**: the user moved the file out via a soft reject. Sits out of voting and review entirely; its history remains part of the library's record.

Statuses are mutually exclusive; "keep" and "reject" are transitions, not parallel flags.

Active becomes Kept or Rejected. Kept becomes Rejected or, by undoing the keep,
Active again. Rejected becomes Active again by a Restore. Asking for any other
transition is an error, not a no-op. A wallpaper rejected before Restore existed
has no Origin to go back to, so for those rows Rejected stays terminal. See
[ADR 0009](docs/adr/0009-reject-is-reversible.md).

## Soft reject

Rejecting a wallpaper by moving its file to a destination folder without erasing its history: the row survives as `rejected`, preserving every comparison it took part in.

The destination is a Written path naming a folder, and the move never
overwrites a file already sitting in it. The reject records the wallpaper's
Origin so a Restore can put it back, so a wallpaper can be rejected and restored
as often as the user changes their mind. See
[ADR 0003](docs/adr/0003-soft-reject-write-ordering.md) and
[ADR 0009](docs/adr/0009-reject-is-reversible.md).

## Restore

Undoing a soft reject: the file moves back to its Origin and the wallpaper
becomes Active, whichever status it held before the reject. Restoring clears the
Origin, so the next reject records a fresh one.

A Restore lands on Active rather than on the previous status because Kept is a
judgement about a rating, and changing your mind about a reject is not that
judgement. A wallpaper with no Origin cannot be restored.

## Origin

Where a wallpaper's file sat before its current soft reject. Recorded by the
reject and cleared by the Restore, so only a currently-rejected wallpaper has
one. A wallpaper rejected before Restore existed has none either, because
nothing recorded it at the time.

## Comparison

One pairwise vote: two wallpapers, one winner, one loser. Permanent. Comparisons are never deleted.

Which of the two the user sees on the left carries no meaning. The pair is
presented in random order so that the habit of picking the left one does not
become part of the rating.

## Score

A wallpaper's standing among the others: the μ of its rating. Every wallpaper
starts at the same Score and moves from there with each Comparison it takes
part in.

A Score is comparable only within one library, because it is a position among
these wallpapers and nothing else. A wallpaper that has been in no Comparison
has no Score yet; the number it starts on is the app's ignorance, not a
judgement of the image.

A Rejected wallpaper sits out of voting, so its Score stops moving and stays
the last thing the app knew about it.

Score answers how good. Evaluated answers how sure. Review lists the lowest
Scores, so the wallpaper the app is least confident about is not thereby the
wallpaper it likes least. See [ADR 0013](docs/adr/0013-review-orders-by-mu.md).

## Eligible

A wallpaper the voting pool draws from: Active or Kept. Rejected wallpapers are
not eligible. Every progress fraction is measured against the eligible pool, not
against the whole library.

## Round

One pass over the eligible pool. Round 4 means every eligible wallpaper has been
in at least three comparisons and the app is working through the fourth.

A Round is derived from the comparison counts, never stored, so it moves in
whichever direction the truth does: rejecting the least-compared wallpaper
advances it, and scanning in unseen files sends it back. Progress within a Round
is the share of the eligible pool that has already had its comparison for that
Round. See [ADR 0008](docs/adr/0008-round-is-derived.md).

## Evaluated / Participated

Two distinct progress notions. **Participated**: has been in at least one
comparison. **Evaluated**: its rating is confident enough to trust, meaning σ
below 4.0, roughly half the starting uncertainty. Evaluated is a late signal: it
takes around seven comparisons to reach, so a young library has none.

Both are counted over the eligible pool. Participated is Round progress at
Round 1, and is pinned to the size of the pool from Round 2 onwards, so the
headline reports it per-Round rather than as a total. Evaluated headlines
alongside it as the confidence signal: the two answer different questions and
the app shows both.
