# ADR 0003: A soft reject writes the row before it moves the file

**Status:** Accepted
**Ticket:** [#19](https://github.com/QuantumFF/walltare/issues/19)
**Date:** 2026-08-23

## Context

`move_wallpaper` has to do two things that can each fail: move a file on disk,
and update the row to Rejected with its new path. The first implementation
moved the file and then updated the row, which is the order the operation reads
in. Three failures came out of it.

**Overwriting.** `fs::rename` replaces its destination without a word. Two
wallpapers with the same basename rejected into one folder meant the second
overwrote the first. The row `UPDATE` then hit `UNIQUE(path)` and failed, so
one image was gone, the first row pointed at the second image's bytes, and the
second row still claimed Active at a path that no longer existed.

**No rollback.** Any `UPDATE` failure left the file moved and the row pointing
at the old location. The image broke in the UI, and a later scan of the
destination folder added it back as a second row.

**Resurrection.** The destination went into the database as written.
`./rejected`, the default the review UI ships with, stored as
`/library/./rejected/x.jpg`. A rescan walks the same file and produces
`/library/rejected/x.jpg`. Different strings, so `UNIQUE(path)` did not match
and `INSERT OR IGNORE` did not ignore. Every rejected file came back as a new
Active wallpaper. The existing regression test passed because it used an
absolute destination, which has no `.` segment to normalize.

## Decision

`move_wallpaper` runs in this order, inside one transaction:

1. Read the row. Refuse if it is already Rejected (see ADR 0001).
2. Resolve the destination directory, create it, and canonicalize it.
3. Refuse if the destination resolves to the folder the wallpaper is in.
4. Pick a destination filename no file currently holds.
5. `UPDATE` the row to Rejected with the new path.
6. Move the file.
7. Commit.

Putting the `UPDATE` before the move is what makes the failure modes tolerable.
Every database error, `UNIQUE(path)` included, now fires while the disk is
still untouched, and dropping the transaction rolls the row back. A failed move
leaves both the file and the row exactly where they started.

Canonicalizing the destination directory is what keeps a rejected file
rejected. `start_scan` canonicalizes its root for the same reason, so both
sides produce the same string for the same file.

Colliding basenames get a ` (n)` suffix, counting from 2, up to 1000 attempts.

## Alternatives rejected

**Move first, undo the move on `UPDATE` failure.** Undoing a move is itself a
filesystem operation that can fail, so the error path has an error path. The
database rolls back reliably. Give it the job.

**Overwrite on collision, matching the reference app.** `rate-wallpaper`
deletes the row on reject, so it has no `UNIQUE(path)` to violate and no row
left pointing at the overwritten file. walltare keeps the row, which is the
whole point of a soft reject, so it cannot inherit that behavior.

**Refuse on collision instead of suffixing.** Honest, but it makes the user
rename files by hand to finish a reject. Two wallpapers called `wallpaper.jpg`
in different folders is ordinary.

## Consequences

A crash between the move and the commit still loses the transition. The window
is one `fs::rename` wide, and the file is where the uncommitted row said it
would be, so a rescan picks it up as Active in the reject folder. Recovering
from that needs the reconciliation work in
[#33](https://github.com/QuantumFF/walltare/issues/33).

Checking that the destination is free and then moving into it is a
time-of-check-to-time-of-use gap. For a single-user desktop app moving files
between its own folders, the race needs another process writing into the reject
folder at that moment.

Canonicalizing resolves symlinks, so a reject destination reached through a
symlink stores the real path. Symlinked images have their own problems, tracked
in [#34](https://github.com/QuantumFF/walltare/issues/34).
