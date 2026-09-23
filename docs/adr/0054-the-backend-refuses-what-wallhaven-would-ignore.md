# ADR 0054: The backend refuses what Wallhaven would ignore, and downloads only what it served

**Status:** Accepted
**Ticket:** [#323](https://github.com/QuantumFF/walltare/issues/323), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

Discover's API calls and downloads go through the Rust backend, so that the key
never reaches the webview. The backend has no HTTP client today, and all of its
background work runs on plain threads. Discover's search, filters and sorting
are meant to mirror Wallhaven's as closely as possible.

Two facts about Wallhaven's API
([#318](https://github.com/QuantumFF/walltare/issues/318)) shape this seam more
than anything else:

- **It fails silently.** A malformed `ratios` value is dropped, which leaves the
  search unfiltered. Anonymous `purity=001` returns zero results rather than a
  401. A search that looks filtered can quietly not be.
- **It is limited to 45 calls a minute.** A 429 comes back with an HTML body and
  `Retry-After`. The image hosts aren't limited.

## Decision

### Two modules

- **`wallhaven`**, the client. It covers requests, JSON, and turning status
  codes and bodies into errors, and it knows nothing about the library. The key
  is read from the settings table on every API call, so Replace and Remove take
  effect at once. It goes on `api/v1` requests and nowhere else.
- **`download`**, the queue and the landing of ADR 0051. That is folder
  resolution, staging, the size check, rename without overwrite, and a scan of
  one file plus the id.

The client is `ureq`, which is blocking and uses rustls. Commands call it
through `off_main_thread`, and the queue runs on its own thread.

### Search mirrors Wallhaven and checks every value

`wallhaven_search` takes every `/search` parameter as a typed field: `q`
verbatim, including Wallhaven's own syntax, `categories`, `purity`, all seven
`sorting` values, `order`, `top_range`, `atleast`, `resolutions`, `ratios`,
`colors`, `page` and `seed`.

**The backend refuses, with `BadRequest`, any value Wallhaven would drop.**
That covers a ratio or resolution not shaped `WxH` or one of Wallhaven's named
buckets, a colour outside its 29, and `top_range` without `toplist`. It also
refuses NSFW purity when no key is saved. The frontend disables that control
anyway, so this refusal is a guard.

**`q` is never the first parameter in the query string**, because Cloudflare
challenges a request whose query string starts with `q=like`.

The answer carries Wallhaven's search record for each result, except `path`,
plus a **mark**: in library, Rejected, or none (ADR 0050). The marks come from
one id lookup in the same call.

A successful search records `purity`, `categories`, `sorting`, `order` and
`top_range` as the remembered filters. The rest describe what the curator is
looking for right now, and the ratio goes back to the Screen default on each
visit. Minimum resolution never prefills `atleast`.

### A download names ids, and the backend resolves them

`wallhaven_download(ids)` resolves each id from an **in-memory map of every
result the backend has served** in this process: its `path`, `file_size` and
`file_type`. It refuses an id it never served. It checks the Download folder
(ADR 0051), enqueues, and answers nothing. An id already queued is dropped.

Events:

- `download-progress { total, landed, failed, item }` after each file, where
  `item` is `{ wallhaven_id, outcome }` and the outcome is landed or failed with
  a message.
- `download-complete { total, landed, failed, first_error }` when the queue
  drains.
- `library-scanned` and `stats-changed` for each landed file, as ADR 0051 set.

There is no byte-level progress.

### No throttle, no retry, no page cache

A 429 becomes an error that carries the wait. Nothing queues calls behind a
local limiter, and nothing retries. Search pages aren't cached, because a
cached page would carry stale marks once a download lands. The frontend keeps
the pages it is showing.

### Three new error kinds

- **`network`**: Wallhaven couldn't be reached, timed out, or answered with
  something other than the expected JSON (a 5xx, a Cloudflare challenge). The
  message says which. Being offline is this error. There is no connectivity
  probe and no offline mode.
- **`rate_limited`**: the message is the sentence with the seconds to wait.
- **`key_rejected`**: a saved key got a 401. Discover links to Settings.

Timeouts: an API call gets 10 s to connect and 20 s for the whole response. A
download gets 10 s to connect, then 30 s between reads, with no cap on the
total. A slow link finishes, and a dead one fails that file.

### The key is set by its own command

`set_wallhaven_key(key)` runs off the main thread, performs ADR 0052's keyed
search, and answers `{ settings, verified }`. An empty key removes it. This
replaces ADR 0052's `set_setting("wallhaven_api_key", …)`, which is sync, runs
on the main thread, and answers with `Settings` alone, so it can't wait on the
network or say "couldn't verify".

### Tests run against a stub server

The client takes its base URLs at construction. Tests point them at an
in-process stub on `std::net::TcpListener` in `testing.rs`, which answers with
canned status codes, headers and bodies, including the HTML 429. The code that
parses responses is what's worth testing, and a fake transport would skip it.

## Considered options

- **Pass the query through unchecked.** It is less code, and Wallhaven
  "handles" bad input. It handles it by searching unfiltered, and the curator
  then reads the results as filtered.
- **The frontend echoes a result's `path` and `file_size` back to download
  it.** No map, but the webview then chooses which URL the backend writes into
  the library.
- **One `/w/<id>` call per pick.** Always fresh, but it spends rate limit on
  every download and needs the key for NSFW.
- **A local 45-a-minute limiter, or one silent retry on a short
  `Retry-After`.** Browsing by hand rarely reaches the limit, downloads use the
  unlimited host, and a silent wait reads as a hang.
- **`reqwest`.** Async, and a much larger dependency tree, in a backend that
  doesn't use async I/O anywhere.
- **A `Transport` trait with a fake.** It would be the only other adapter, and
  it exists only for tests.
- **The frontend writes the remembered filters through `set_setting`.** That's
  a second call on every change, and it would also remember filters that were
  never searched.

## Consequences

**The served-results map grows for the life of the process.** It holds a few
KB per hundred results and nothing evicts it. A download of a result from
before a restart can't happen, because the frontend loses those pages too.

**The command table grows by three:** `wallhaven_search`, `wallhaven_download`
and `set_wallhaven_key`. They get ADR 0031's typed entries, and the three error
kinds get typed entries in `AppError`.
