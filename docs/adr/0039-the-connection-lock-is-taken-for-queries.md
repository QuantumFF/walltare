# ADR 0039: The connection lock is taken for queries only

**Status:** Accepted
**Ticket:** [#226](https://github.com/QuantumFF/walltare/issues/226)
**Date:** 2026-09-09

## Context

There is one SQLite connection behind one mutex, and that is settled
([#3](https://github.com/QuantumFF/walltare/issues/3),
[ADR 0004](0004-thumbnail-resolution-phases.md)). What was never settled is what
a caller is allowed to do while holding it.

`missing.rs` spends twelve lines of module doc on the answer. Its heading is
"Two halves, because one of them must not hold the lock", and the reason it
gives is that at [ADR 0016](0016-library-page-scale.md)'s 5,000-wallpaper
ceiling the filesystem half is 5,000 `stat` calls, and making them under the
connection mutex "would queue every command and every `wallpaper://` request
behind a walk of somebody's external drive". So `eligible_paths` takes a
`&Connection` and no disk, `count_missing` takes a `&[String]` and no database,
and `count_missing_files` calls them in that order.

`thumbnails::work_list` did exactly what those twelve lines forbid: a three way
join over the whole `wallpapers` table, one `read_dir` of the cache directory
and one `stat` per row, all inside a single `lock(&db)`. It runs on launch and
after every scan — the two moments when the first view is fetching its listing
and firing fifty thumbnail requests — and if the Library root is on an external
drive or a network mount, the wait is however long that drive takes.

[ADR 0012](0012-thumbnail-pre-generation.md) said "The single `Db` mutex needs
no special handling", and gave a true reason for it: ADR 0004's three phases put
the whole decode outside the lock, so the pass takes the mutex for a few hundred
microseconds per 420ms of work. That is a claim about `plan` and `record`. It was
never true of the work list that feeds them, and nothing in the type system
noticed the difference.

Two more of the same thing turned up once the rule was written as a rule.
`thumbnails::clear` unlinked every file in the cache directory — up to 10,000 of
them at ADR 0016's ceiling — and only then ran its two `DELETE`s, all under one
guard. `pregen::remember` read a row's `path`, `stat`ed the file and wrote a
note, under one guard as well.

The reason one module's prose could be broken by another is that `Db` was a
shallow module. Its whole interface was a public `Mutex` and a free `lock`
helper — "here is a mutex, lock it yourself" — so each of the ten `lock(&db)`
sites in `lib.rs` and `pregen.rs` invented its own discipline, and one of them
got it wrong.

Underneath all of it, no `synchronous` pragma was set anywhere. SQLite's default
is `FULL`, so with `journal_mode = WAL` every commit fsyncs the write-ahead log.
`thumbnails::record_one` is a bare `execute`, which commits, so a cold burst of
fifty cards is fifty serialised fsyncs inside the critical section, and the
pre-generation pass pays two per Wallpaper.

## Decision

### The connection is reachable only through a closure that returns owned data

`Db` keeps its mutex private and grows an interface:

```rust
impl Db {
    pub fn new(conn: rusqlite::Connection) -> Self;
    pub fn read<T>(&self, query: impl FnOnce(&Connection) -> T) -> T;
    pub fn write<T>(&self, statement: impl FnOnce(&Connection) -> T) -> T;
}
```

`T` is chosen by the caller before the borrow exists, and the closure has to
work for any lifetime the connection might have, so nothing that borrows the
connection can leave: not the `&Connection`, not the `MutexGuard`, not a
`Statement`, not a `Rows`. A caller cannot hold the connection across a
filesystem walk, because a caller cannot hold the connection at all. The guard
is dropped by the time `read` returns.

That is half of the rule, and it is the half a comment could never hold. The
other half — *nothing called inside one of these closures touches the
filesystem* — is one sentence, and it is stated on the type. The difference is
that it is now a sentence about a five-line closure rather than about every
function in the crate that happens to take a `&Connection`.

`read` and `write` are mechanically identical, because one connection means one
mutex and SQLite serialises them the same way. The name is what the call site
says about itself, and it is the seam a change that treats them differently
would land on — a second connection for readers, or a `BEGIN IMMEDIATE` around
the write — without every caller being revisited.

All ten `lock(&db)` sites move in this ticket. `lock` and `lock_conn` are gone,
and the poisoning recovery they carried is now `Db::connection`, private, with a
test that a panic under a query leaves the connection usable rather than
bricking every later call for the rest of the process.

### The work list is two halves, the way `missing.rs` is

`thumbnails::candidates(conn)` is the query. It answers with
`Vec<Candidate>` — id, path, Status and the three recorded mtimes, all owned —
in the order the pass will walk them, which is still
`status = 'rejected' ASC, comparisons_count ASC, id ASC`.

`thumbnails::work_list(&candidates, cache_dir)` is the filesystem pass: one
`read_dir` of the cache directory, one `stat` per source, and the freshness rule
unchanged. `pregen::run` calls the two in order, and `Db::read` has released the
connection before the second one starts.

**Nothing about the list's contents or its order changes.** Every ADR 0012
amendment still holds exactly as written: the Rejected tail group from ADR 0016,
the Status re-check against the Status the list saw, and the
`thumbnail_failures` note from [ADR 0034](0034-a-hostile-library-root.md) that
keeps a broken file out of the list until its mtime moves. The list is pinned as
one value by a test that seeds a library in every state at once.

The split is also what makes the second half testable, which is the same thing
`missing.rs` says about its own: the query needs a `&Connection` and no disk,
and deciding the list needs a temp directory and no database. That test —
rows handed in, no connection anywhere — was unwritable before this.

### The other two places, found by having a rule at all

`thumbnails::clear` becomes `clear_cache_files(cache_dir)` and
`forget_thumbnails(conn)`, and `clear_cache` calls them in that order. The order
is load-bearing and ADR 0012 argues it: a pass that has been asked to stand down
can still be finishing the wallpaper it is on, it writes files before it records
rows, so sweeping in the same order leaves the row delete last. That ordering
now lives across two functions instead of inside one, which is a cost — see the
consequences.

`pregen::remember` keeps its three steps and puts the `stat` between them:
`current_source_path` under a read, `source_mtime` outside, `note_failure` under
a write. The path still comes from the row rather than from the work list's
snapshot, for `still_due`'s reason — a reject or a Restore moves the file while
the pass is running.

### The Soft reject is the one exception, and it is argued

`soft_reject::reject` and `soft_reject::restore` hold the connection across a
file move, and they must.
[ADR 0003](0003-soft-reject-write-ordering.md) writes the row first inside a
transaction and moves the file last, so a `UNIQUE(path)` collision or any other
database error aborts while the disk is still untouched.
[ADR 0030](0030-the-soft-reject-owns-its-ordering.md) moved that invariant into
its own module precisely so it would be held somewhere. Releasing the connection
in the middle of it would be giving up the invariant to gain a rule.

It is also the cheap case: one `rename` of one file, on a path the curator is
waiting on anyway, rather than a walk of the whole library on a path where
nobody asked for anything. Both commands say so where they are defined.

### `synchronous = NORMAL` beside `journal_mode = WAL`

Set in `db::open`, after the from-the-future guard for the reason
[ADR 0005](0005-schema-migrations.md) states, and with the trade named in the
comment beside it.

`NORMAL` is the documented pairing for WAL. It gives up the fsync per commit and
takes on a window in which the last few commits can be lost: on an OS crash or a
power cut, never on walltare itself crashing, and never as a corrupt database,
because WAL recovery replays whatever reached the disk. What sits in that window
is cache bookkeeping, which regenerates on demand, and at worst a Comparison
recorded in the final moments before the power went. `CONTEXT.md` calls
Comparisons permanent, and they stay permanent: this risks the newest one on a
power cut, not the record.

## Alternatives rejected

**Write the rule down on `Db` and keep `lock`.** The cheapest change, and it is
the state this ADR is fixing. The rule was already written down, in twelve lines
in `missing.rs`, and it was already broken in `thumbnails.rs`. A thirteenth
statement of it would have been the seventh copy problem ADR 0030 describes: a
rule written many times and held zero times gets broken by somebody who read one
of the copies.

**A `Db::read()` that returns the guard.** `let conn = db.read();` reads better
than a closure at every one of the ten sites, and enforces nothing at all — it
is `lock` with a new name. The closure is the only shape in which the borrow
cannot outlive the query, and the ten sites are small enough that their
readability is not what is being optimised.

**One method, `with`, instead of `read` and `write`.** Honest about the fact that
the two are the same function today. It also erases the only information the call
site was carrying, and leaves nowhere for a reader-writer distinction to land
later. Two names cost nothing to keep true.

**A connection per caller, or a pool.** ADR 0004 rejected it as larger than the
problem, and `NORMAL` plus WAL would make concurrent readers genuinely cheap, so
the ground has shifted a little. It is still a change to the shape of the app to
solve a problem that a closure and a two-line split solve, and the single
connection is settled in #3.

**Stat as the pass goes, instead of building a list.** No filesystem pass up
front at all: hand the pass the rows and let each wallpaper's turn decide
whether it is due. It also throws away the total, and ADR 0012 wants the list's
length to be the honest denominator for `pregen-progress` — a bar whose total
grows as it goes is worse than a second of `read_dir`.

**Enforce the second half of the rule too, with a token type that closures may
not construct.** Machinery in the type system to say "no filesystem here", for a
rule that fits in one sentence and now has one place to sit. Worth revisiting if
it is broken again; what it would be buying is a third of the problem, since the
two smaller breaks were found by reading the code once with the rule in hand.

**`synchronous = OFF`.** Faster still, and it puts database corruption on the
table after a power cut rather than the loss of recent commits. Nothing here is
worth that: the library is the record of every Comparison the curator ever made
and there is no second copy of it.

## Consequences

**Ten call sites read differently, and one of them changed shape.**
`pregen::generate_one`'s single-size branch used to `return Ok(Step::Skipped)`
from inside the block that held the lock. A closure cannot return from its
caller, so the skip comes back as an `Option` the branch then matches on. That
is the interface doing its job — what leaves it is owned data — and it is the
one place the new shape is longer than the old one.

**The work list allocates a `Vec<Candidate>` per pass.** Roughly 5,000 owned
paths at ADR 0016's ceiling, held for the length of one `read_dir` and 5,000
`stat`s, once per launch and once per scan. That is the cost of the query being
finished with before the disk is touched, and it is a rounding error against the
`stat`s it lets go of.

**The `read_dir` now happens after the query rather than before it.** Both
orders race the same way — a thumbnail written in the gap is regenerated on the
next pass either way, which is a cache entry validated by mtime, so it
self-heals exactly as ADR 0004 describes.

**Clearing the cache has its ordering spread across two functions.** ADR 0030
warns about precisely this: a module that owns one end of a rule leaves the rule
in the caller. It is affordable here because there is exactly one caller, both
halves name the other, and the command that sequences them says why — the same
arrangement `count_missing_files` already has for `missing.rs`. It is the part of
this decision most likely to need revisiting, and the trigger is a second
caller.

**`thumbnails::purge` is untouched and would need the same split.** It deletes
one wallpaper's rows and then its three cache files, and it has no production
caller — `#[allow(dead_code)]` since ADR 0012 removed the purge from a reject.
Whoever gives it one owes it two halves.

**Nothing already measured is undone.** ADR 0004's three phases with the decode
outside the lock, `Size::donors` including the lookup that runs when a row
exists, the box pre-reduce before Lanczos3, `generate_both`'s single decode for
two sizes: all unchanged, and `resolve_image` and `generate_one` still call
`plan` / `fulfill` / `record` in that order. The work list's order and contents
are unchanged and now pinned.

**The next child in [#224](https://github.com/QuantumFF/walltare/issues/224)
inherits an admission point.** `serve(id, size)` lands on top of this interface,
and ordering, deduplication and an in-memory byte cache all sit on the side of
the seam that holds no connection.
