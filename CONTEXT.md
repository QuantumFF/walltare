# CONTEXT

Glossary for walltare. Terms only; no implementation.

## Wallpaper

A single image file known to the app. Identified by its absolute path; one wallpaper per file.

## Library root

The folder a scan walks to find wallpapers, including everything beneath it.
One folder, chosen by the user.

The Library root is a stated preference, not a fact about the library. It can
point somewhere that no longer exists, and the wallpapers an earlier scan found
stay in the library regardless of where it points now.

## Status

Every wallpaper is exactly one of:

- **Active**: participates in voting and appears in review.
- **Kept**: the user has explicitly decided to keep it despite its rating. Still participates in voting, but never appears in review.
- **Rejected**: the user moved the file out via a soft reject. Sits out of voting and review entirely; its history remains part of the library's record.

Statuses are mutually exclusive; "keep" and "reject" are transitions, not parallel flags.

Active becomes Kept or Rejected. Kept becomes Rejected. Rejected is terminal:
nothing transitions out of it, because the file has left the library. Asking
for any other transition is an error, not a no-op. See
[ADR 0001](docs/adr/0001-status-transitions.md).

## Soft reject

Rejecting a wallpaper by moving its file to a destination folder without erasing its history: the row survives as `rejected`, preserving every comparison it took part in.

The destination is a folder, absolute or relative to the wallpaper's own
folder. A wallpaper is soft-rejected exactly once, and the move never
overwrites a file already sitting in the destination. See
[ADR 0003](docs/adr/0003-soft-reject-write-ordering.md).

## Comparison

One pairwise vote: two wallpapers, one winner, one loser. Permanent. Comparisons are never deleted.

Which of the two the user sees on the left carries no meaning. The pair is
presented in random order so that the habit of picking the left one does not
become part of the rating.

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
below 4.0, roughly half the starting uncertainty.

Both are counted over the eligible pool. Participated is Round progress at
Round 1, and is pinned to the size of the pool from Round 2 onwards, so the
headline reports it per-Round rather than as a total. Evaluated headlines
alongside it as the confidence signal: the two answer different questions and
the app shows both.
