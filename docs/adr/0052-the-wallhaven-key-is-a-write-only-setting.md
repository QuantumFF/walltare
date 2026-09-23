# ADR 0052: The Wallhaven key is a write-only setting in the settings table

**Status:** Accepted
**Ticket:** [#322](https://github.com/QuantumFF/walltare/issues/322), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

Discover works without an account. An optional Wallhaven API key unlocks NSFW
results, the account's browsing settings (its default filters, and the tag and
user blacklists) and private collections. It unlocks nothing else: it is not a
password, it can't pay for anything, and the owner can regenerate it on
Wallhaven at any time.

When charting [the map](https://github.com/QuantumFF/walltare/issues/317), we
settled that API calls go through the Rust backend so that the key never
reaches the webview. [ADR 0010](0010-settings-store.md)'s store works against
that: `get_settings` sends the whole `Settings` struct to the frontend, so any
value it holds gets there too.

## Decision

**Plaintext in the settings table.** The key is one row, `wallhaven_api_key`,
beside every other setting. No row means anonymous.

**Write-only over IPC.** `Settings` never carries the key. It carries
`wallhaven_key_set: bool` in its place. `set_setting("wallhaven_api_key", …)`
stores a key, and an empty value deletes the row, which is ADR 0010's
default-deletes rule applied to a key whose default is absent. The key crosses
into the webview only once, as it is typed into Settings, and nothing ever
sends it back. Settings shows that a key is saved and offers Replace and
Remove. It never shows the key.

**Checked before it is stored.** The write runs one keyed search. A 401 refuses
it as `BadRequest`. A network failure or a 429 stores the key anyway and says it
couldn't be verified. The check deliberately isn't `/api/v1/settings`: that
endpoint answers a bad key with a 404 `Nothing here`, not a 401, which reads as
a missing endpoint rather than a bad key. Search answers with the same 401 that
Discover already handles when a saved key stops working.

**Only API calls carry it.** Thumbnails and full files from `th.` and
`w.wallhaven.cc` load without auth, NSFW included (verified 2026-09-24). The
key goes on `wallhaven.cc/api/v1` requests and nowhere else.

## Considered options

- **The OS keyring** (the `keyring` crate, and Secret Service on Linux). It
  protects the key from a process that can read the user's home directory,
  but such a process already has the library and the database. The cost is a
  dependency, plus boot failure modes: no Secret Service running, a locked
  keyring, an unlock prompt at launch. It would also need a fallback store for
  desktops that have none, which puts the plaintext row back.
- **A masked read** that shows the last four characters. It is still a read
  path for the secret, and it only helps someone telling two keys apart, which
  nobody does.
- **Sending the key in full, as every other setting is sent.** That breaks the
  charting constraint for no gain, since nothing in the frontend needs the key.

## Consequences

`Settings` is no longer a mirror of the table. One row's value is replaced by a
flag derived from it, so `resolve` and `is_default` gain a case that nothing
before them needed. A downgraded build ignores the row as an unknown key, and
the key survives the round trip.

The key sits in `walltare.db`, so a copy of the database for debugging carries
it. Anyone sharing the file should delete the row first, or regenerate the key
afterwards.
