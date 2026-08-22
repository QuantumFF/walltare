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

## Soft reject

Rejecting a wallpaper by moving its file to a destination folder without erasing its history: the row survives as `rejected`, preserving every comparison it took part in.

## Comparison

One pairwise vote: two wallpapers, one winner, one loser. Permanent — comparisons are never deleted.

## Evaluated / Participated

Two distinct progress notions. **Participated**: has been in at least one comparison. **Evaluated**: its rating is confident enough (low σ) to trust. The progress headline currently uses participated only; which one should headline is an open question.
