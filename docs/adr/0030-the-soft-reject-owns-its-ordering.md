# ADR 0030: The Soft reject owns its ordering

**Status:** Accepted
**Ticket:** [#167](https://github.com/QuantumFF/walltare/issues/167)
**Date:** 2026-09-04

## Context

`db.rs` is 2,467 lines, and 275 of them — `:163-437`, from
`MAX_COLLISION_SUFFIXES` through `move_file`'s close — are filesystem work in a
file named for the database. Five functions do it: `resolve_destination_dir`
(`:335`), `resolve_destination_dir_with` (`:348`, `#[cfg(test)]`),
`create_destination_dir` (`:361`), `unique_destination` (`:378`), `move_file`
(`:407`). **None of the five takes a `Connection`.**

What ties them to the SQL is [ADR 0003](0003-soft-reject-write-ordering.md)'s
write ordering: the row is written first inside a transaction and the file moves
last, so a `UNIQUE(path)` collision or any other database error aborts while the
disk is still untouched. That invariant is the reason the code is shaped the way
it is, and it is currently held by nothing. It is *written down* seven times:

| where | what it says |
| --- | --- |
| `db.rs:176-180` | `move_wallpaper`'s doc, the ordering paragraph |
| `db.rs:244-248` | `restore_wallpaper`'s doc, "the ordering is `move_wallpaper`'s, run backwards" |
| `db.rs:225` | `// Anything below that fails drops tx unread, rolling the row back` |
| `db.rs:314` | the same comment again |
| ADR 0003 | the decision itself, seven steps |
| ADR 0009 `:76-90` | the inbound mirror, seven steps, plus a paragraph restating why |
| ADR 0009 `:200-205` | the crash window, restated |

Seven statements of one rule, and a reader who breaks it — by adding a line
after `move_file` — is not stopped by any of them.

The architecture review rated the move marginal on the deletion test, and on the
five helpers alone that rating was right. This decision is about the invariant,
not the helpers.

### The shape this is judged against

[ADR 0023](0023-a-transition-answers-with-the-row.md),
[0024](0024-status-is-a-type-eligible-is-a-predicate.md) and
[0025](0025-the-transition-guard.md) landed in
[#166](https://github.com/QuantumFF/walltare/issues/166) before this was
decided, which is what makes the question answerable. After them,
`move_wallpaper` (`:181`, 49 lines) and `restore_wallpaper` (`:249`, 70 lines)
each read as one guarded `db::get_wallpaper`, one `UPDATE`, the choreography, one
row read. There is nothing left in either function that is not one of those four
things.

### Only 786 of those 2,467 lines are code

The other 1,681 are a single flat `mod tests` (`:787`). The reject and restore
tests are `:1753-2467`, roughly 715 lines — the larger half of what this decision
moves, and the reason it needs an answer about test helpers at all.

## Decision

### The transition moves, not the choreography

`src/soft_reject.rs`, with two functions in its interface:

```rust
pub fn reject(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError>;

pub fn restore(conn: &Connection, wallpaper_id: i64) -> Result<Wallpaper, AppError>;
```

Behind them: the transaction, the guard, the `UPDATE`, the choreography, the row
read. The five helpers and `MAX_COLLISION_SUFFIXES` go private inside, and
`resolve_destination_dir_with` stays `#[cfg(test)]` — the module keeps the
internal seam it already has for the environment lookup.

The module doc states ADR 0003's ordering once, as the module's reason to exist.
The six other statements of it go: both function doc paragraphs, both inline
comments, and ADR 0009's restatement.

`db.rs` drops from 786 code lines to 511, and from 2,467 total to roughly 1,470.

### Why the choreography could not move on its own

This is the part worth recording, because the smaller move is the one a reader
will propose.

A module holding the five helpers has the same interface they already have: five
free functions, five unchanged signatures, none of them taking a `Connection`.
Nothing about what a caller must know changes, so no depth is gained. Delete such
a module and the complexity returns to `db.rs` unchanged rather than
redistributing across N callers, which is the deletion test failing at the module
level.

Worse, it strands the invariant. The ordering is a relationship between the
`UPDATE` and the move. A module that owns the move but not the `UPDATE` owns one
end of a rule, so the rule still lives in the caller and the new seam is a place
the rule crosses rather than a place it is kept. That is the shape the five
helpers already are.

So owning the ordering means owning the transaction, which means owning the
`UPDATE`, which means the module is the transition rather than a helper under it.
There was no third option; the choice was this or nothing.

### Owning the `UPDATE` is affordable because `db.rs` is not the SQL

The objection to a module writing its own `UPDATE` is that SQL belongs in
`db.rs`. It does not, and has not for a long time: `voting.rs`,
`thumbnails.rs` and `settings.rs` each write their own statements against the
connection they are handed. `soft_reject.rs` doing the same is this crate's
existing pattern.

What `db.rs` owns after this is the Wallpaper row and how it is defined, read,
filtered, ordered and status-written — the schema, `Status`, `Wallpaper`,
`wallpaper_from_row`, `get_wallpaper`, `StatusFilter`, `ListOrdering`,
`list_wallpapers`, `insert_new_wallpapers`, `keep_wallpaper`, `unkeep_wallpaper`.
`soft_reject` reads rows through `db::get_wallpaper`, which is the interface
ADR 0025 built for exactly that.

### The name comes from `CONTEXT.md`

`soft_reject`, and both transitions in it, because the glossary already
subordinates one to the other: Restore is defined as "Undoing a soft reject,"
not as a peer transition. `reject` is the verb at a call site where the module
name supplies "soft"; `restore` is the glossary term verbatim.

`move_wallpaper` does not survive as a function name. `CONTEXT.md` never says
"move a wallpaper" — it says Soft reject — and the name points at the file move,
which is precisely what this decision demotes to implementation. Keeping a
mechanism name on the function while the module is named for the act would leave
the file arguing with itself.

**The wire keeps the old names.** The `lib.rs` commands stay `move_wallpaper` and
`restore_wallpaper`, so `client.ts:399` and `:414` are untouched, the comment
references in six frontend files stay correct, and 41 `mockCommand`
registrations keep working. This accepts one inconsistency knowingly: the command
is named for the mechanism and the function it calls is named for the act.
Renaming the wire is two `invoke` strings and six files of comments for no
behaviour, which is churn a later ticket pays for.

### `keep_wallpaper` and `unkeep_wallpaper` stay in `db.rs`

They are 49 lines of pure SQL with nothing on disk, so they have no ordering to
get wrong. Moving them in would make the module's stated reason to exist true of
half its contents, which is how a module drifts into being "the transitions
file" and stops meaning anything. They stay beside `get_wallpaper` and
`list_wallpapers` as plain row writes, sharing `Status::may_become` with the
reject guard across the module seam exactly as ADR 0025 left it.

### Nine shared test helpers get a `#[cfg(test)]` module

Moving `db.rs:1753-2467` out needs nine helpers that `db.rs`'s remaining tests
also use, roughly 60 lines: `seed_wallpaper` (`:1022`), `origin_path_of`
(`:864`), `count_comparisons` (`:873`), `status_of` (`:1501`),
`seed_real_wallpaper` (`:1510`), `add_comparison` (`:1538`),
`row_status_and_path` (`:1546`), `count_wallpapers` (`:1573`), `review_ids`
(`:1674`).

They go to `src/testing.rs`, `#[cfg(test)]`, holding only helpers two or more
test modules need. Duplicating the 60 lines is drift with a start date. Making
`db::tests` `pub(crate)` would put a test module into the crate's non-test
surface, which is worse than either. A shared `#[cfg(test)]` module is also the
shape this crate already reaches for on testability: `paths::expand_with` and
`resolve_destination_dir_with` both exist to hand a test what it needs.

One test crosses the new seam and stays where it is.
`list_wallpapers_carries_a_rejected_rows_origin` (`:1399`) is a listing test that
calls the reject to make a Rejected row, so it stays in `db.rs` and calls
`crate::soft_reject::reject`. That is the only place `db.rs`'s tests depend on
the new module, and it is the dependency ADR 0023 wants — it asserts that the
listing and the transition are one account of the wallpaper, not two.

## What this does not touch

**ADR 0003's ordering.** Every step, and the reasoning for every step, is
unchanged. This decision moves where the rule is *kept*, not what it says.

**ADR 0024's placement of `Status`.** Its reason — that the `CHECK` constraint
fixing the three legal spellings is at the top of `DDL` — is what ruled out
splitting schema and migration out of `db.rs`, so this confirms it rather than
amending it.

**The error modes.** `NotFound` for a missing row, `InvalidTransition` for a
refused pair, `InvalidPath`, `FileMissing`, `Io`. ADR 0025 settled all five and
they cross the new seam unchanged.

**`paths.rs`.** It gains nothing. Folding `resolve_destination_dir` in beside
`expand` is the obvious-looking redraw — the module that owns Written paths
growing the operation that completes them — and it is ruled out by the one
invariant `paths.rs` has written down: "Nothing here touches the filesystem or
creates anything." `resolve_destination_dir` creates and canonicalizes. The two
doc references at `paths.rs:27` and `:243` follow the function to `soft_reject`;
that is all.

**`CONTEXT.md`.** Nothing reaches it. Soft reject, Restore and Origin are
already there and already exact; what moved is which file the code lives in.
This is the same call ADRs 0015, 0017, 0019, 0021, 0022, 0027 and 0029 made.

## Alternatives rejected

**Leave it in `db.rs`.** The defensible answer, and the one the architecture
review pointed at. It says the invariant is not worth a module — while the
invariant is restated seven times, which is the evidence against it. A rule
written seven times and held zero times is a rule that will be broken by
someone who read one of the seven.

**Move the five helpers only.** Covered above: no interface changes, no depth is
gained, and the invariant ends up crossing the new seam instead of living behind
it.

**Move the helpers and pass the transaction in.** `move_file(&tx, source,
dest)`, so the module can claim to own the ordering. It owns nothing: the caller
still decides when to call it, and the signature would be a comment enforcing
nothing. Taking a `Transaction` it does not use, to imply a rule it cannot
enforce, is worse than taking nothing.

**A `Destination` value the module computes and `db.rs` performs.** The module
answers `{ from, to, to_str, to_name }` and `db.rs` does the `UPDATE` and the
move. This is a genuinely small interface, and it is the choreography split
again: the module computes, the caller sequences, and sequencing is the whole
invariant.

**Fold `resolve_destination_dir` into `paths.rs`.** See above; it breaks that
module's one stated invariant.

**Split schema and migration out of `db.rs` as well.** `:13-133` is 121 lines of
DDL, version stamping and migration sitting beside row reading and the listings,
which reads as a second seam in one file. It is not: after the Soft reject
leaves, `db.rs` is ~511 code lines on one subject, and the DDL *is* the row shape
rather than a different topic from it. ADR 0024 put `Status` in `db.rs` because
the `CHECK` constraint is at the top of `DDL`, so the split would separate that
constraint from that type and undo a decision made six ADRs ago on this exact
ground.

**A trait over `std::fs` under the move.** Ruled out of scope on
[the map](https://github.com/QuantumFF/walltare/issues/149) and it stays there.
`soft_reject.rs` has exactly one filesystem adapter, so nothing about the seam
count changed by moving the code, and the surface a trait would have to cover is
seven calls — `rename`, `copy`, `remove_file`, `create_dir_all`, `canonicalize`,
`exists`, `is_file` — not the two that ruling assumed. Of ADR 0003's three
untested failure paths a trait is needed for two, the cross-device fallback and a
full disk; a permission failure needed only `chmod 0o555`, and
[#181](https://github.com/QuantumFF/walltare/issues/181) tested it without one.

## Consequences

**One named behaviour change, and it is in the tests.** Nine helpers move to a
shared `#[cfg(test)]` module. No assertion changes, and the app behaves
identically in every path. Everything else here is behaviour-preserving in full.

**The crate gains two files and `db.rs` loses 40% of its lines.**
`soft_reject.rs` lands at roughly 1,010 lines, most of it tests, which is smaller
than `thumbnails.rs`. `src/testing.rs` is ~60 lines and exists only under
`cfg(test)`.

**Two names for one operation, on purpose.** The command is `move_wallpaper` and
the function is `soft_reject::reject`. A reader tracing a reject from the
frontend crosses that rename once, at `lib.rs`, where the `#[tauri::command]`
attribute makes it obvious why. The alternative was renaming the wire, and this
was the cheaper of the two inconsistencies.

**ADR 0003 and ADR 0009 now point somewhere for the ordering rule.** Neither
states it as the live authority any more; the module doc does. That is one more
indirection for a reader starting from an ADR, and it is the point — the rule is
next to the code that has to obey it.

**The `#[cfg(test)]` module is a place other test modules will want.**
`thumbnails.rs`, `voting.rs` and `pregen.rs` all seed wallpapers their own way.
Nothing here changes them, and the rule for `src/testing.rs` is deliberately
narrow: helpers two or more test modules need, not helpers. Widening it is a
decision for whoever has the second caller.
