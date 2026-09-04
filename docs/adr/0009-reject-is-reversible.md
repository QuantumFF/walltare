# ADR 0009: A reject is reversible, and a stored origin path is what reverses it

**Status:** Accepted
**Supersedes:** [ADR 0001](0001-status-transitions.md)
**Ticket:** [#39](https://github.com/QuantumFF/walltare/issues/39)
**Date:** 2026-08-24

## Context

ADR 0001 made Rejected terminal. It rejected "let keep un-reject" on two
grounds: the glossary said Rejected meant gone, and un-rejecting has to move
the file back to a folder that may no longer exist.

The UI overhaul reverses the policy. A library page that lists Rejected
wallpapers puts the user in front of a decision they made with one click and
cannot take back.

The policy is the easy half. `db::move_wallpaper` runs
`UPDATE wallpapers SET status = 'rejected', path = ?1, filename = ?2`, so a
reject overwrites the only record of where the file came from. The origin is
not stale, it is gone, and no query against the current schema can answer "put
it back where it was".

Keep has the mirror gap. Kept was reachable from Active and led only to
Rejected, so a mis-click on Keep was as permanent as a reject minus the file
move. Making Rejected reversible and leaving Kept alone would just move the
dead end one square over.

## Decision

Two new transitions and one new column.

`wallpapers` gains `origin_path TEXT`, NULL by default. `move_wallpaper` writes
the pre-reject path into it, in the same `UPDATE` that overwrites `path`:
SQLite evaluates the whole right-hand side against the pre-update row, so
`origin_path = path` captures the old value. `restore_wallpaper` reads it,
moves the file back, and clears it.

Legal transitions:

| From | To | Command |
| --- | --- | --- |
| Active | Kept | `keep_wallpaper` |
| Kept | Kept | `keep_wallpaper` (no-op success) |
| Active | Rejected | `move_wallpaper` |
| Kept | Rejected | `move_wallpaper` |
| Rejected | Active | `restore_wallpaper` |
| Kept | Active | `unkeep_wallpaper` |
| Active | Active | `unkeep_wallpaper` (no-op success) |

Everything else returns `AppError::InvalidTransition` and changes nothing.

**Amended by [ADR 0025](0025-the-transition-guard.md), 2026-09-03.** The table
above becomes `Status::may_become(self, to) -> bool`, an exhaustive `match` on
the pair, and one test walks all nine combinations against these seven rows. It
had lived as four separate guards, three of which were the same
`status == "rejected"` check, so a fourth Status would have needed all four
found by hand. The refusal messages stay with their commands, since each says
something specific that a predicate cannot, and `restore_wallpaper`'s
origin-less refusal stays there too: no table over Statuses can see a column.

A restore lands on Active, never on whatever status the wallpaper held before
the reject. Kept means the user decided to keep this one despite its rating,
and a restore is not that decision. The cost is real but small: a wallpaper
that went Kept, then Rejected, then restored comes back into Review, which the
user had already dismissed by keeping it. Re-keeping is one click, and a second
stored column to save that click buys less than the transition it adds.

`restore_wallpaper` refuses a wallpaper that is not Rejected instead of
treating it as a no-op. There is no file to move and no origin to read, so
succeeding quietly would hide either a stale id or a control the UI left
enabled. `unkeep_wallpaper` against an Active wallpaper succeeds silently, for
the same reason re-keeping a Kept one does: a double click on a button is not
an error.

The write ordering mirrors ADR 0003:

1. Read the row. Refuse unless it is Rejected, and refuse if `origin_path` is
   NULL.
2. Refuse if the file is missing from the path the row currently holds.
3. Create the origin directory if it is gone.
4. Pick a filename in it that no file holds.
5. `UPDATE` the row to Active with the origin path, clearing `origin_path`.
6. Move the file.
7. Commit.

Putting the `UPDATE` before the move is what keeps a failure harmless, exactly
as it does outbound, and for the reasons ADR 0003 gives.

A restore that has to rename is still a restore. Step 4 suffixes ` (n)` from 2
and the UI reports the path the file actually got. Two situations
produce the collision: a bare file has appeared at the origin, or a rescan
picked that file up as its own wallpaper row. Both fall out of the same code,
because `UNIQUE(path)` is enforced by the `UPDATE` in step 5.

`AppError` gains a `FileMissing` variant, mirrored in `AppErrorKind`. The
pre-check in step 2 is not what makes the operation safe, the ordering already
does that. It exists so the user reads "the file is no longer in the reject
folder" rather than an errno string, for a case that is ordinary: cleaning out
the reject folder by hand is the point of having one.

Rows rejected before this migration have `origin_path` NULL and nothing to
backfill it from. `restore_wallpaper` refuses them, and the library page
disables the control with the reason on it. Rejected stays terminal for exactly
that cohort.

**Amended by [ADR 0019](0019-library-card-affordance.md).** "Disables the
control" is now `aria-disabled`, not `disabled`. A `disabled` button is not
focusable, and ADR 0019 makes the library grid a roving-tabindex composite
widget, so the reason would be reachable by mouse only and silent to a screen
reader. The control stays focusable and stays in the selection, and pressing it
raises the reason as a pinned error toast. The refusal is still read without a
round trip, since `origin_path` is on the DTO.

The migration step does not claim a version number in advance. The settings
store lands in the same epic, also needs one, and both were required to be
separately mergeable, so whichever merges first takes 3 and the second takes 4.
Naming a number here would just be wrong half the time.

`db::Wallpaper` gains `origin_path: Option<String>`, mirrored as
`string | null`. NULL is the disabled state and the string is the directory the
control names, so one nullable field answers both questions the UI asks.

## Alternatives rejected

**Un-reject in place.** Flip the status and leave the file in the reject
folder. No column, no inbound move, no collision handling. It also leaves the
wallpaper Active at `library/rejected/x.jpg`, so the reject folder stops
meaning what its name says, and `resolve_destination_dir` joins a relative
destination against the wallpaper's own parent, so the next reject produces
`library/rejected/rejected/x.jpg`. The Rejected guard is the only thing
stopping that today and this ADR removes it.

**A `rejections` table**, one row per reject with a `restored_at`. It answers
"how many times was this rejected", which nothing asks, and it invites the
reconciliation work in [#33](https://github.com/QuantumFF/walltare/issues/33)
to grow into it. One nullable column answers the only question the app has.

**Reconstruct the origin from the destination folder and the library root.**
Free, and guesswork the moment anyone uses an absolute destination.

**Restore an origin-less legacy row to the library root.** The root is not
persisted anywhere today, and the file may never have been in it. Putting
files somewhere they never were is worse than refusing.

**Refuse a colliding restore.** ADR 0003 rejected this outbound because it
makes the user rename files by hand to finish the operation. The argument does
not weaken running backwards.

**One `reactivate_wallpaper` covering both new transitions.** One of them can
fail on IO and the other structurally cannot. Collapsing them makes the
frontend handle `Io` on a path that never produces it.

**Make `keep_wallpaper` a toggle instead of adding `unkeep_wallpaper`.** ADR
0001 made re-keeping idempotent deliberately. A toggle turns a double click
into a keep followed by an un-keep.

## Consequences

`CONTEXT.md` loses two claims that held only while Rejected was terminal: that
nothing transitions out of it, and that a wallpaper is soft-rejected exactly
once. A wallpaper can now cycle through reject and restore as often as the user
changes their mind, and only the current rejection is recorded.

A restore changes the eligible pool, so it moves the derived Round from ADR
0008. A wallpaper rejected early with few comparisons drops the floor and sends
the Round back when it returns. ADR 0008 asked for a Round that moves in
whichever direction the truth does, so this needs no special handling.

Rejecting purges thumbnails, rows and cache files (`lib.rs:240`). A restored
wallpaper therefore has no cache and regenerates lazily on the next request,
which the mtime check already covers. Whether a restore should trigger
pre-generation belongs to
[#42](https://github.com/QuantumFF/walltare/issues/42).

**Amended by [ADR 0012](0012-thumbnail-pre-generation.md).** The purge goes,
for reasons this ADR is half of: a reversible Rejected plus a library page that
shows rejected rows makes throwing the cache away a cost paid twice. `path`
follows the file and the move preserves its mtime, so a rejected wallpaper's
thumbnails stay valid. A restore therefore triggers no pre-generation, and the
paragraph above holds only for rows rejected before ADR 0012 shipped, which are
the same rows that have no Origin and cannot be restored anyway.

The reject confirm dialog in Review goes away. Confirm-then-act and
act-then-undo answer the same problem, and running both costs two interruptions
per reject.

The reversal surfaces twice: a toast with an Undo button right after the
action, and a control on the row in the library page. The toast lives eight
seconds, survives a view change, and the newest replaces the previous rather
than stacking, because a fast review pass would otherwise bury the grid it is
reviewing. Losing an older toast costs nothing, since the library page is the
durable surface. Neither the restore toast nor the un-keep toast offers its own
Undo: both inverses are one click away, and an Undo that shuttles a file back
and forth can suffix it on each leg.

Step 2's check and step 6's move are a time-of-check-to-time-of-use gap, the
same one ADR 0003 accepted for the outbound destination check.

A crash between the move and the commit loses the transition, mirroring ADR
0003. The file sits at the origin while the row still claims Rejected at a path
in the reject folder, so the image breaks in the UI, and a rescan adds the
origin file as a second Active row because the two path strings differ.
Recovering from that needs the same reconciliation work as the outbound case.

> **Amended by [ADR 0030](0030-the-soft-reject-owns-its-ordering.md),
> 2026-09-04.** The Restore leaves `db.rs` for `src/soft_reject.rs`, which owns
> the write ordering above rather than restating it, so that module's doc is
> where the rule now lives and this ADR is no longer a place to read it from.
>
> Two edits followed. The Decision above no longer names `unique_destination`,
> in step 4 or in the collision paragraph below the list: the function is
> private to `soft_reject` now, and an ADR naming another module's private
> helper is a reference that goes stale on someone else's refactor. Both say
> what the step does instead. And the paragraph below the list no longer
> restates why the `UPDATE` comes first — it cites ADR 0003, which decided it.
> **Alternatives rejected** keeps its original wording, including its mention of
> `resolve_destination_dir`, because it is an argument about what the code did
> at the time rather than guidance about what it does now.
>
> The seven steps stay as written. They are the inbound choreography, which is
> this ADR's own content and genuinely different from ADR 0003's outbound one,
> and three later paragraphs refer to steps 2, 5 and 6 by number. The rule that
> was written seven times across the codebase is now written once; the steps
> that obey it are still described where they were decided.
