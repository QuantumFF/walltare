# CONTEXT

Glossary for walltare. Terms only; no implementation.

## Wallpaper

A single image file known to the app. Identified by its absolute path; one wallpaper per file.

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

## Evaluated / Participated

Two distinct progress notions. **Participated**: has been in at least one comparison. **Evaluated**: its rating is confident enough (low σ) to trust. The progress headline currently uses participated only; which one should headline is an open question.
