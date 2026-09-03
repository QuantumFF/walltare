# ADR 0025: One row read, one table, one answer for a missing row

**Status:** Accepted
**Ticket:** [#152](https://github.com/QuantumFF/walltare/issues/152)
**Date:** 2026-09-03

## Context

The four Status transitions each opened with the same three steps written out
again: read the row, map `QueryReturnedNoRows` to something better, compare the
status. The closure was character-identical four times, at `db.rs:192-197`,
`:267-272`, `:615-620` and `:654-659`.

[ADR 0009](0009-reject-is-reversible.md)'s seven-row transition table existed
nowhere as one object. Each command carried the one row it happened to
implement, and three of the four carried the same row: `status == "rejected"`
at `db.rs:199`, `:274` and `:622`, differing only in the sentence they refuse
with. The fourth, at `:661`, is that check inverted plus a NULL test on
`origin_path`. So the table as built said one thing. Rejected is a one-way door,
and only a Restore leads back out.

Underneath it, "no wallpaper with that id" had three answers depending on which
command was asked:

| kind | where |
| --- | --- |
| `AppError::NotFound` | the four transitions, `thumbnails.rs:108` |
| `AppError::UnknownWallpaper` | `voting.rs:221` |
| `AppError::Db` | `voting.rs:90-91`, through `?` |

Two of #152's premises had expired by the time it was answered, and both are
worth recording because they change what the fix is worth.

The `Db` row named `voting::fetch_wallpaper`, which returned a bare `Db` for a
missing row and which [#158](https://github.com/QuantumFF/walltare/issues/158)
deleted. What replaced it is `get_pair` calling `db::get_wallpaper(conn, id)?`,
and `?` runs `From<rusqlite::Error>`, so the same wrong kind still comes out at
a new address. It is unreachable there: both ids came from `eligible_summaries`
on the same connection moments earlier, and nothing deletes a `wallpapers` row.
So this is a latent kind rather than a live defect.

And the ticket held that the frontend "has to know which command it called to
know which kind means a stale id". It does not try. `not_found` and
`unknown_wallpaper` appear nowhere in `src/` outside `client.ts:197-219`; the
only kind any component reads is `invalid_transition`, at `ToastSurface.tsx:492`.
The cost of three kinds is therefore not confusion. It is that a row that is
genuinely gone gets a plain error toast, while a row that merely changed gets
the refetch [ADR 0017](0017-one-toast-at-a-time.md) asks for.

One more fact settled the shape. `db::get_wallpaper` (`db.rs:478-485`) had two
production callers, both inside `get_pair`, plus one test. Its error type was
nearly free to change.

## Decision

### The shared read is `get_wallpaper`

`db::get_wallpaper` becomes `Result<Wallpaper, AppError>` and maps
`QueryReturnedNoRows` to `NotFound` itself. Each of the four preambles is then
one line:

```rust
let row = db::get_wallpaper(&tx, id)?;
```

No new function. `read_for_transition` would name a read that already exists,
and [ADR 0023](0023-a-transition-answers-with-the-row.md) already has all four
commands calling `get_wallpaper` after `tx.commit()`, so the transitions would
have carried two reads with two names for the same query.

Six sites share the one read: the four preambles, ADR 0023's post-commit read,
and `get_pair`. `voting::fetch_summary` (`voting.rs:211-236`) joins too, which
deletes its four-column query and lets [ADR 0024](0024-status-is-a-type-eligible-is-a-predicate.md)'s
`Status::is_eligible` apply to `row.status` rather than to a string it read
itself. That leaves one `QueryReturnedNoRows` closure in the crate where there
were five.

The cost is eight columns read where three were, on one call per user click,
and the whole row is what the commands want anyway: the reject needs `path` and
`filename`, the Restore needs `path` and `origin_path`, and all four need
`status`. Reading the row once instead of a per-command column list is the same
argument `WALLPAPER_COLUMNS` already won.

`db::get_wallpaper(&tx, id)` works unchanged inside the two transactional
commands, because `Transaction` derefs to `Connection`, which is how those
functions already reach `query_row`.

### ADR 0009's table becomes `Status::may_become`

```rust
impl Status {
    fn may_become(self, to: Status) -> bool;
}
```

An exhaustive `match` on the `(self, to)` tuple, so adding a fourth Status
breaks the build in both positions. That is the property ADR 0024 paid for by
making Status a type, and this is the first thing to spend it on.

One test walks all nine pairs against ADR 0009's table. That is the same move
ADR 0024 made for Eligible one commit earlier: a rule stated in an ADR becomes
a rule a test can fail on.

The refusal *messages* stay in the four commands. They are per-command copy,
they each say something specific and true ("a Restore is what brings it back",
"there is nowhere to put it back"), and a predicate cannot write them.
`restore_wallpaper`'s origin-less refusal stays put for a harder reason: no
table over Statuses can see a column.

### One answer for a missing row

`NotFound` is it, everywhere. It already carried that meaning at five of the six
sites, `error_response` maps it to 404 (`lib.rs:513`), and ADR 0001's
distinction survives intact: `NotFound` for a row that is absent,
`InvalidTransition` for a row that is present and refusing.

`useWallpaperRows.perform` then treats `not_found` exactly as it treats
`invalid_transition`. Both can only mean the row changed underneath the view
that acted, no patch can say what it should be instead, and leaving it on screen
means the next click reproduces it. That is ADR 0017's own reasoning, applied to
the signal it did not cover. This is the one behaviour change here, and it makes
a stale id stop being a dead end on the surface.

The two kinds share one copy row rather than gaining one each.
`<filename> has already changed` is true of a row that is gone and a row that
refused alike, and the surface already reads a single `stale` boolean, so this
is one more kind in that boolean rather than a second branch.

### The pool refusal keeps its own kind

`UnknownWallpaper` survives for `voting.rs:226` alone: a wallpaper that exists,
is Rejected, and sits out of voting. That is a refusal about a real row, so
`NotFound` would hide a state, which is exactly what ADR 0001 refused. Voting is
the one surface where the eligible pool is the meaningful set, and the kind is
the frontend's signal to fetch a new pair rather than to correct a row.

`voting.rs:111`, the "winner and loser must be distinct" check, moves to
`BadRequest`. A caller that sent the same id twice made a caller's mistake, and
nothing about the wallpaper is unknown.

### `get_pair`'s bare `Db` closes without a line

Once `get_wallpaper` maps the variant, `voting.rs:90-91` answers `NotFound` with
nothing written at those lines. The latent kind goes, and it needed no issue of
its own.

## Alternatives rejected

**A new `read_for_transition(conn, id)`.** The ticket's own proposal. It is
`get_wallpaper` with a second name and a narrower caller list, and ADR 0023 had
already put `get_wallpaper` inside all four functions, so the transitions would
run two differently-named reads of one query.

**`legal(from, to) -> bool` as a free function.** Same table, but off the type
that owns the vocabulary, so a fourth Status would not break it in both
positions and the test would be checking a function rather than the type.

**A guard that returns the transition it authorised.** Typestate on a four-call
surface with one implementation. The token would be constructed and consumed in
the same function every time.

**`Status::is_rejected()`.** It collapses the three identical guards just as
well and is shorter. It also names the mechanism instead of the rule, and a
fourth Status slides past it silently, which is the entire failure ADR 0024 was
written to stop.

**Unify on `UnknownWallpaper` instead.** `NotFound` also answers for a missing
source file (`thumbnails.rs:731`) and is the 404 in the asset protocol, so
moving the row case onto `UnknownWallpaper` would split "the thing is not there"
across two kinds to unify "the row is not there".

**Delete `UnknownWallpaper` entirely.** Then a Rejected wallpaper refused a
summary answers `NotFound` about a row that exists, or `InvalidTransition` about
something that is not a Status transition. Neither is true.

**Fold `thumbnails::plan` into the shared read.** `plan` (`:106-111`) wants one
column on the thumbnail path, which runs per card rather than per click, and it
is not a transition. It keeps its own read and its own closure, which is the one
that remains.

**Leave the three kinds and just note the inconsistency.** Cheapest, and it
keeps the thing the unification buys: a stale id that cannot ask for a refetch,
in the one place ADR 0017 established that a refetch is the right answer.

## Consequences

**ADR 0017 gains a kind.** The `InvalidTransition` refetch becomes an
`InvalidTransition`-or-`NotFound` refetch, on the reasoning ADR 0017 already
gave. Recorded there.

**ADR 0009 gets a representation and a test.** The table stops being prose that
four functions each implement a slice of. Recorded there.

**ADR 0001's pricing is unchanged.** Each transition still pays the guard's read
plus ADR 0023's post-commit read. This makes them the same query rather than
adding one.

**ADR 0024's `is_eligible` gets its in-memory caller through the row.**
`fetch_summary` asks `row.status.is_eligible()` instead of comparing a string it
selected itself, which is what ADR 0024 wanted that method for.

**`get_wallpaper` gives up a promise.** Its doc comment said "callers with
something better to say about a missing id map themselves". After this, no
caller has anything better to say, so the comment goes with the mapping it was
deferring.

**One implementation issue covers ADRs 0023, 0024 and 0025.** All three rewrite
the same four `db.rs` functions, and ADR 0024 already said the issue waits for
this decision. The order inside it is fixed: ADR 0023's return-type change
first, since ADR 0025's shared read is the post-commit read that change
introduces.

**One behaviour change, named.** A transition against a missing row now
refetches the page instead of only toasting. Everything else here is
behaviour-preserving, including the four refusal messages, which are unchanged
strings.

**No `CONTEXT.md` change.** Status, Transition and Eligible are already glossary
entries. `may_become` is a representation of ADR 0009's table, which is
implementation, and the nine-pair test makes that table checkable rather than
restating it.
