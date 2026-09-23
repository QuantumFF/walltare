# ADR 0050: A missing file is rejected in place

**Status:** Accepted
**Ticket:** [#327](https://github.com/QuantumFF/walltare/issues/327),
[#33](https://github.com/QuantumFF/walltare/issues/33)
**Date:** 2026-09-24

## Context

ADR 0032 made a missing file visible (the card says **File is gone** and
Settings counts them) and then stopped: "There is nothing to fix from here." The
wallpaper keeps its Status, so it stays Eligible. Voting still draws it into
pairs, where one side is a panel instead of a picture, and review still shows
it. #33 asked for exactly this to stop, and it was closed by the work that only
added the panel and the count.

The one transition that takes a wallpaper out of the pool is a Soft reject, and
it refused every missing file. It moves the file, the `rename` found nothing to
move, and the transaction rolled back. So a library that lost a folder or a
drive had no way to shed those wallpapers.

## Decision

**A Soft reject of a wallpaper with nothing at its path moves nothing.** The row
becomes Rejected, keeps its `path` and `filename`, and records the Origin as that
same path. Whether the file is there is `missing::is_missing`, the one
`exists()` check the Settings count already uses, so a reject in place only ever
happens to a file the count would count. The Comparisons stay, and the wallpaper leaves voting and review
because it is no longer Eligible.

**The reject destination is not resolved for it.** `reject_destination::prepare`
creates the folder, and a relative destination resolves against the
wallpaper's own folder. For a file on an unplugged drive that folder is under a
mount point with nothing mounted on it, so preparing it would create a
`rejected/` folder on the root filesystem underneath. `reject_in` does not stage
and `reject_with` returns before the destination is read.

**A Restore of a wallpaper whose path is its Origin moves nothing.** The row
becomes Active and the Origin is cleared. `path == origin_path` is only ever
true after an in-place reject, because a moving reject refuses a destination
that is the file's own folder. This rule is what makes the toast's Undo work
while the file is still missing, and it is what restores a file that came back
(a drive plugged in again) where it is. The moving Restore would find the file
in its own way and land it as `name (2).jpg`.

**Settings rejects the missing files in one press.** Once a check has found
some, the Missing files section offers **Reject missing**. The check answers
with the ids it counted as well as the count, and `reject_missing_files` takes
those ids, so the press rejects what the line said. A file that went missing
after the check is not in the number the curator agreed to, and the press does
not walk the library a second time. `soft_reject::reject_missing` asks each id
again under the lock, so a file that came back between the check and the press
is left alone, and a wallpaper something else already rejected is skipped. It
answers with the rows it wrote. The section publishes one `status-changed` per
row, which is the patch Review and Library already apply, and re-reads the
stats for Rank's headline.

**No new Status.** ADR 0032's reasons stand: missing is a fact about the
filesystem, not something the curator did. What changed is that the curator now
has a transition to act on it with, and that transition is the Soft reject
`CONTEXT.md` already defines.

## Alternatives rejected

**Filter missing files out of `get_pair` and `get_review`**, which is what #33
literally asked for. It costs a `stat` per candidate on the hot path of voting,
and it changes what the pool contains without the curator doing anything, which
is the fourth Status ADR 0032 refused, under another name.

**Drop the rows.** It takes their Comparisons with them, and `CONTEXT.md` says
Comparisons are never deleted.

**Reject to the destination anyway and write the path the file would have
had.** The row would name a file that is in neither place, and a Restore would
then say `FileMissing` about the reject folder, which the curator never touched.

**Refuse a Restore whose file is still missing.** It is what the moving Restore
does, and here it would break Undo for no gain. The file never left, so
returning to Active only puts back the state from before the reject.

**Mark the in-place reject with a column.** `path == origin_path` already says
it, and a moving reject cannot produce that equality.

**A confirmation before Reject missing.** Every row it writes can be restored,
and ADR 0009 took the confirm dialog off the single reject for the same reason.

## Consequences

A Rejected row's `path` no longer always points into a reject destination. After
an in-place reject it is the wallpaper's old place, which is also its Origin.
Nothing counts Rejected rows as missing, so the Settings count is unaffected:
the rejected rows leave the pool it walks.

The reject toast says **The file was already gone, so nothing moved.** instead
of a path, because the path it would print is one the file is not at.
`useWallpaperRows` tells the two cases apart by whether the row's `path`
changed.

`failed_move_leaves_db_untouched_and_propagates_io_error` used to delete the
source to make the move fail. That is now a success, so the test makes the move
fail from a read-only source folder instead.

`Command` in `client.ts` names 19 commands, and `MissingFiles` carries an
`ids` list beside its two counts.
