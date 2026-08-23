# ADR 0004: Thumbnail resolution splits into three phases

**Status:** Accepted
**Ticket:** [#12](https://github.com/QuantumFF/walltare/issues/12), [#14](https://github.com/QuantumFF/walltare/issues/14)
**Date:** 2026-08-23

## Context

`thumbnails::resolve` used to take a `&Connection` and do everything: read the
source path, check the cached row, decode the source, downscale it, JPEG-encode
it, write the cache file, and upsert the row. One function, one lock, start to
finish.

The protocol handler called it through `register_uri_scheme_protocol`, the
synchronous variant. Tauri's docs describe the asynchronous variant as the one
that lets you "process the request in a separate thread", which tells you what
the synchronous one does: it runs on the thread Tauri calls it on.

So a cache miss decoded a 4K image on the UI thread while holding the only
database connection. The window froze for the length of the decode, and every
other command queued behind the same mutex. The review grid asks for fifty
images at once, and `RankView` preloads two more on every vote.

## Decision

Resolution splits into three functions:

- `plan(conn, id, size)` reads the source path and the cached row. Needs the
  database. Does no image work.
- `fulfill(plan, cache_dir)` serves the cache file when the recorded mtime
  still matches, and otherwise decodes, downscales, encodes, and writes. Does
  all the image work. Touches no database.
- `record(conn, plan, resolved)` upserts the row for a thumbnail that was
  regenerated. No-op on a cache hit.

`resolve_image` in `lib.rs` calls the three in order, taking the lock for the
first and third and releasing it across the second.

The handler moved to `register_asynchronous_uri_scheme_protocol` and submits
work to a fixed pool of threads, sized to `available_parallelism` clamped
between 2 and 8.

`resolve`, the convenience wrapper that runs all three against one connection,
is now `#[cfg(test)]`. Only the unit tests use it.

## Alternatives rejected

**Spawn a thread per request.** What Tauri's own doc example does, and enough
to unblock the UI thread. Fifty concurrent 4K decodes is several gigabytes of
decoded pixels, so the grid would trade a freeze for a memory spike. The pool
bounds it.

**Keep one function and take a `&Mutex<Connection>`.** Fewer moving parts, but
it wires the locking strategy into the module and leaves the tests constructing
a mutex they have no use for.

**Clone the connection per worker.** SQLite handles multiple connections, and
WAL makes concurrent readers cheap. It is a larger change than the problem
needs, and the single-connection design is settled in
[#3](https://github.com/QuantumFF/walltare/issues/3).

## Consequences

Three phases means the connection can change between phase one and phase three.
A wallpaper rejected in that window leaves a thumbnail row that gets purged a
moment later, or a row written just after a purge. Both self-heal: the row is a
cache entry validated by mtime, and a stale one regenerates on the next
request.

The pool holds its threads for the life of the app. Eight idle threads cost
nothing worth measuring.

`Size::Full` now records a row like the other sizes, which needed the schema
change in ADR 0005. It used to skip the table and compare the cache file's own
mtime against the source, which never invalidated when a source was restored
with an older timestamp.
