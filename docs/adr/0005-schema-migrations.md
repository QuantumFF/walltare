# ADR 0005: Schema changes go through a user_version migration runner

**Status:** Accepted
**Ticket:** [#6](https://github.com/QuantumFF/walltare/issues/6)
**Date:** 2026-08-23

## Context

`init_schema` ran a batch of `CREATE TABLE IF NOT EXISTS` and nothing else.
That is enough to create a database and enough to reopen one, which is why it
looked finished.

It is not enough to change one. `IF NOT EXISTS` skips a table that already
exists, so a new column or a widened `CHECK` reaches new users and no one else.
The app would start normally against an old database and then fail at the first
query that relied on the change. `PRAGMA user_version` sat at 0 and nothing
read it.

The problem stopped being hypothetical when ADR 0004 needed the `thumbnails`
`CHECK` to accept `'full'`. SQLite cannot `ALTER` a `CHECK` constraint, so the
change needs a table rebuild, and the rebuild needs somewhere to live.

The research for [#3](https://github.com/QuantumFF/walltare/issues/3) named
`rusqlite_migration` as the escape hatch if migrations were ever needed. One
migration does not justify a dependency.

## Decision

`db.rs` keeps a `SCHEMA_VERSION` constant and stamps it into
`PRAGMA user_version`.

`init_schema` checks whether the `wallpapers` table exists before running the
DDL. A database that did not have it is new, so the DDL just created the
current shape and the version is stamped directly. Anything else goes through
`migrate`, which applies each step below the target in order.

Every future change to an existing table needs a step in `migrate` as well as
an edit to the DDL. The DDL describes the current shape for new databases;
`migrate` gets old ones there.

`SCHEMA_VERSION` is currently 2. Step 2 drops and recreates `thumbnails` with
the wider `CHECK`.

## Alternatives rejected

**Add `rusqlite_migration`.** It does more than this needs and adds a
dependency to a project that has kept them down to `rusqlite` and `image`.
Worth revisiting if the steps get complicated enough to want its ordering and
validation.

**Delete the database and rescan on any schema change.** Cheap to write, and it
throws away every Comparison the user recorded. Comparisons are permanent by
definition in `CONTEXT.md`.

**Detect the shape instead of versioning it.** Query `sqlite_master` and patch
what is missing. It works for adding a column and falls apart on anything
subtler, and each check has to stay correct forever.

## Consequences

Rebuilding `thumbnails` discards the cache. Every thumbnail regenerates lazily
on next request, which the mtime check already handles. Wallpapers and
comparisons are untouched.

`open` and `migrate` only ever run in production, so they had no test coverage
at all. `db.rs` now builds a real v1 database in a tempdir, migrates it, and
asserts both the version and that a `'full'` row inserts afterwards. There is
also a test that reopening a database twice is idempotent.

Version 1 is the shape the port shipped with. There is no step 1, because
nothing needs to reach it.
