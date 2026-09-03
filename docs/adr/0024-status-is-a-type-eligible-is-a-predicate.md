# ADR 0024: Status is a type, Eligible is a predicate

**Status:** Accepted
**Ticket:** [#151](https://github.com/QuantumFF/walltare/issues/151)
**Date:** 2026-09-03

## Context

`CONTEXT.md` names Status and Eligible. The Rust named neither.

Status was a `String` on `db::Wallpaper` (`db.rs:448`), compared against literals
at five sites: `db.rs:199` and `:274` guarding the reject and the Restore,
`db.rs:611` and `:650` guarding the keep and the un-keep, and `voting.rs:225`
refusing a rejected wallpaper a summary. Eligible was spelled
`status IN ('active', 'kept')` four separate times inside `voting.rs` (`:161`,
`:172`, `:178`, `:198`), once per `get_stats` counter plus `eligible_summaries`.
`StatusFilter::where_clause` (`db.rs:511`) spelled all three values a fifth time.

The one real `Status` enum sat in `thumbnails.rs`, the module with the least
claim to it. That looked worse than it was by the time this was answered:
[#144](https://github.com/QuantumFF/walltare/issues/144) had already moved
`still_due` out of `lib.rs`, so the cross-module reach through
`thumbnails::Status::read` was gone and the type had no caller outside its own
file. It passes the deletion test on `work_list` and `still_due` alone, so the
type was earning its keep. Only its address and its reach were wrong.

The cost of that is one number. Adding a fourth Status meant finding five string
comparisons and eleven SQL fragments, and the compiler would have caught none of
them.

## Decision

### Status lives beside the row

`Status` and `Status::read` move from `thumbnails.rs` into `db.rs`, beside
`Wallpaper` and `StatusFilter`. `thumbnails::Pending.status` becomes
`db::Status`.

`wallpaper_from_row` (`db.rs:465`) is the only place in the crate that reads the
`status` column into the row shape, and the `CHECK` constraint that fixes the
three legal spellings is thirty lines above it at `db.rs:21`. `StatusFilter` is
the same vocabulary and already lives there. Neither `voting.rs` nor
`thumbnails.rs` gains a dependency, because both already import from `db`.

### The row field is typed, the wire is not

`db::Wallpaper.status` becomes `Status`, carrying
`#[serde(rename_all = "lowercase")]`.

This is what makes the type real rather than decorative. Leaving the field a
`String` means every consumer keeps writing `Status::read(&row.status)`, which
is a sixth spelling instead of one fewer.

The wire stays `"active" | "kept" | "rejected"`, so `client.ts:19`, the
`Wallpaper` interface at `:29` and every frontend test are untouched, and
[ADR 0023](0023-a-transition-answers-with-the-row.md)'s row is byte-identical.
One Rust test asserts those three JSON strings directly. The frontend suite
cannot stand in for it: it drives the real components against a mocked IPC seam
whose fixtures are written in TypeScript, so a later edit to `rename_all` would
change the wire and break nothing that runs.

### Eligible is a predicate, in two forms

Eligible is a property of a Status rather than a Status itself, so it is not a
fourth arm. It becomes two members of the same `impl Status`:

```rust
const ELIGIBLE_SQL: &str = "status IN ('active', 'kept')";
fn is_eligible(self) -> bool;
```

Two forms because the code asks the question in two places that cannot share
one. Four uses are SQL and take the fragment. One is in memory: `fetch_summary`
(`voting.rs:225`) refuses a rejected wallpaper, which is an eligibility check
written today as a Rejected check.

Two forms is what five spellings collapse to, not a smaller copy of the same
problem, and the difference is that a test can hold two together. One test seeds
a table with all three Statuses, runs `ELIGIBLE_SQL` against it, and asserts it
selects exactly the rows `is_eligible` returns true for. That is `CONTEXT.md`'s
Eligible entry made checkable.

`thumbnails.rs:559`'s `status = 'rejected' ASC` is not a fifth caller and stays a
literal. It is a Rejected-last ordering over the whole library, which
[ADR 0016](0016-library-page-scale.md) explains, and folding it into an Eligible
fragment would claim a relationship that is not there.

### StatusFilter survives

`StatusFilter` stays its own type. It is the enum the frontend deserializes into,
`client.ts:67` mirrors it by name, and its doc comment carries ADR 0016's reason
for why Eligible is deliberately not one of its variants.

Only `where_clause` changes, building its three fragments from `Status::as_str`
instead of spelling the literals itself. That was the fifth spelling, and it is
the whole of what this touches.

### The type meets SQL through FromSql and ToSql

`impl FromSql` makes `row.get(3)?` in `wallpaper_from_row` return a `Status` with
no change at the call site. `impl ToSql` makes `params![Status::Rejected]` work
for the four `SET status = '...'` writes in the transitions. `as_str` stays
public for `where_clause`, and sits next to `ELIGIBLE_SQL`.

`FromSql` keeps the leniency `Status::read` documents today: anything that is not
`rejected` or `kept` reads as Active, because the `CHECK` constraint allows only
three spellings and anything else is a database this app never wrote.

The schema `CHECK` at `db.rs:21` stays a literal. It is the definition the type
mirrors, and a `format!`-built DDL string is harder to read than the constraint
it would replace.

### The transition guards are only retyped

The four preambles swap `status == "rejected"` for `status == Status::Rejected`
at `db.rs:199`, `:274`, `:611` and `:650`, and stay four preambles. Collapsing
them into one row read, turning [ADR 0009](0009-reject-is-reversible.md)'s table
into one `match`, and settling what a stale id answers is
[#152](https://github.com/QuantumFF/walltare/issues/152)'s job, and #152 is
blocked on this one because it wants the typed Status named here.

## Alternatives rejected

**A `status.rs` of its own.** Its argument was that it would survive unmoved if
the Soft reject choreography ever leaves `db.rs` and splits the file. That buys
stability for a file that does not exist, and it puts the type somewhere other
than the constraint that defines it. If `db.rs` does split, the type moves with
the row shape, which is where it belongs either way.

**Eligible as a fourth `Status` arm.** It would make `match` on a Status
ambiguous about whether a row is Active or Kept, and `CONTEXT.md` is explicit
that the three are mutually exclusive and that Eligible describes two of them.

**Eligible in one form only.** A `const` alone leaves `fetch_summary` comparing
against Rejected, which is the same question asked backwards. A method alone
cannot reach the four queries without pulling every eligible row into Rust to
count it, which is what `get_stats` exists to avoid.

**`StatusFilter` as `Option<Status>`, with `None` for All.** It throws away the
doc comment that records why Eligible is absent, and it makes `"all"` arrive on
the wire as `null`.

**Generating the schema `CHECK` from the type.** The constraint is three literal
words in a `CREATE TABLE`, and a `format!` over an iterator of variants is more
to read for a string that is already the clearest statement of the rule.

## Consequences

**One test guards the wire.** The `rename_all` attribute is the only thing
keeping four IPC payloads stable, and the serialization test is the only thing
watching it. Both are cheap; neither is optional.

**#152 lands on top of this.** It restructures the same four `db.rs` preambles
and wants the typed Status, which is why it was blocked here.

**Each transition still pays two reads.** ADR 0001 priced the guard's `SELECT`
and ADR 0023 added the row read that answers the caller. Typing the column
changes neither count.

**The implementation issue waits for #152.** One `ready-for-agent` issue covering
both decisions is less churn than two that rewrite the same four functions.

**No `CONTEXT.md` change.** Status and Eligible are already glossary entries.
This gives them a representation, which is implementation, and the agreement test
makes the Eligible entry checkable rather than restating it.
