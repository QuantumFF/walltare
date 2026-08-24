# ADR 0001: Which Status transitions are legal

**Status:** Superseded by [ADR 0009](0009-reject-is-reversible.md)
**Ticket:** [#24](https://github.com/QuantumFF/walltare/issues/24)
**Date:** 2026-08-23

ADR 0009 restates the whole transition table. Rejected is no longer terminal,
and Kept can go back to Active. The reasoning below still explains why the
guards exist and why `InvalidTransition` is its own error, so read it for that
and take the table from 0009.

## Context

`CONTEXT.md` says the three Statuses are mutually exclusive and that keep and
reject are transitions rather than flags. It does not say which transitions the
app allows, and the first implementation of `keep_wallpaper` was an
unconditional `UPDATE ... SET status = 'kept'`. That accepted every input,
including a Rejected wallpaper.

Keeping a Rejected wallpaper is not a harmless no-op. The file has already
moved out of the library, so the row would go back into the voting pool
pointing at a path in the reject folder. The user would then be voting on a
picture they threw away.

`move_wallpaper` had the mirror problem. Called twice with the default relative
destination it resolved `rejected` against the wallpaper's current folder,
which by then was already the reject folder, and produced
`library/rejected/rejected/x.jpg`.

## Decision

Only these transitions are legal:

| From | To | Command |
| --- | --- | --- |
| Active | Kept | `keep_wallpaper` |
| Kept | Kept | `keep_wallpaper` (no-op success) |
| Active | Rejected | `move_wallpaper` |
| Kept | Rejected | `move_wallpaper` |

Everything else returns `AppError::InvalidTransition` and changes nothing.
Rejected is terminal: neither command accepts a Rejected wallpaper.

Kept to Rejected stays legal even though the review grid lists Active
wallpapers only, so no UI path reaches it today. A user who kept something and
later changed their mind is asking for a reasonable thing, and refusing it
would be an arbitrary restriction rather than a domain rule.

Re-keeping a Kept wallpaper succeeds silently. It is idempotent, and a double
click on the Keep button should not raise an error.

## Alternatives rejected

**Let keep un-reject.** Rejected would stop being terminal and would need to
mean "moved out, but reversible", which contradicts the glossary. Un-rejecting
also has to move the file back, and the original folder may be gone.

**Reuse `NotFound` for the refusal.** The row exists. Saying it does not would
hide a real state from the caller, and the frontend could not tell a stale id
from an illegal action.

## Consequences

`AppError` carries an `InvalidTransition` variant, mirrored in
`AppErrorKind` in `src/lib/client.ts`. `start_scan` reuses it to refuse a
second concurrent scan, which is the same shape of error: the request is
well-formed but the current state forbids it.

Both guards read the row before writing, so both commands now cost one extra
`SELECT`. At one call per user click that does not matter.

## History

This decision was made once before and lost. PR #25 implemented it against
`task/review-flow`, but PR #22 had already merged an earlier commit of that
branch into `main`, so the merge commit never became an ancestor of `main`.
Issue #24 was closed on the strength of a merged PR. The guard was absent from
`main` for the rest of the port. Check that work lands on `main` before closing
the issue that asked for it.
