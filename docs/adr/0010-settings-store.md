# ADR 0010: Settings live in a key-value table, and window geometry does not

**Status:** Accepted
**Ticket:** [#40](https://github.com/QuantumFF/walltare/issues/40)
**Date:** 2026-08-24

## Context

Nothing the user chooses survives a restart. The scan path is typed into
`ScanView` every launch, `./rejected` is hardcoded in `ReviewView`, the review
limit is a default argument in `client.ts:138`, and there is no theme to
persist because there is no theme control.

The UI/UX overhaul needs all four to persist. It moves scan behind a "Library
folder" field in Settings, gives the library page its own reject, and adds a
three-state theme. ([ADR 0020](0020-settings-page.md) relabels that field
**Library root**, matching the glossary term this document predates.) A setting that resets on every launch is worse than no
setting, because the user has to re-make the choice and re-discover where it
lives.

Two constraints came out of the charting round for
[the map](https://github.com/QuantumFF/walltare/issues/37) and are not
reopened here. Settings persist in SQLite rather than `localStorage`, because
the app already gates its boot on an IPC call and can gate on a second one.
The store is one key-value table.

What was open: its shape, where validation lives, the IPC, and what the window
paints before the theme is known.

## Decision

### The table

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

It joins the DDL and needs no `migrate` step and no `SCHEMA_VERSION` bump, for
the reason now spelled out in [ADR 0005](0005-schema-migrations.md):
`init_schema` runs the DDL before it branches, so an existing database gets the
table on its next launch. `SCHEMA_VERSION` stays 2, which leaves 3 free for
[ADR 0009](0009-reject-is-reversible.md)'s `origin_path` column. That column
alters a table that already exists, so it genuinely needs a step. The two
changes stop competing for a number.

### Defaults

The table holds only what the user changed. It starts empty, and a missing row
means the default:

| key | values | default |
| --- | --- | --- |
| `theme` | `system`, `light`, `dark` | `system` |
| `library_root` | any path string | empty, meaning nothing has been scanned |
| `reject_destination` | any path string | `./rejected` |

`settings.rs` owns the key list, the defaults, the parsing, and the validation.
`get_settings` reads every row into a map and fills the gaps from
`Settings::default()`, so a caller always receives a complete struct.

Reset to default is `DELETE FROM settings WHERE key = ?`, and adding a key
later is a match arm rather than a data migration.

> **Amended by [ADR 0020](0020-settings-page.md), 2026-08-26.** `set_setting`
> performs that delete itself when the value equals the default, so no command
> and no UI control exists for a reset. Typing `./rejected` back into the field
> would otherwise write a row identical to the default and break the property
> this section rests on. `get_settings` already fills gaps from
> `Settings::default()`, so absent and default-valued read the same to every
> caller.

`review_limit` is deliberately not a key. Nobody has asked to change 50, and
the library page may retire the review list's limit entirely.

### The IPC

```rust
get_settings() -> Settings
set_setting(key: String, value: String) -> Settings
```

Both return the whole struct, so the frontend never reassembles state from a
patch and a stale read cannot survive a write. Values cross as strings because
that is what the column holds; `client.ts` exposes
`setSetting<K extends keyof Settings>(key: K, value: Settings[K])` so callers
stay typed and the one `String(value)` sits in the only module allowed to touch
`invoke`.

Reads are forgiving and writes are strict. On read, an unknown key is ignored,
because a downgrade leaves rows a newer version wrote, and a value that fails
to parse falls back to its default with a log line. Boot never fails over a bad
setting. On write, an unknown key or an invalid value is
`AppError::BadRequest`, which already exists on both sides of the IPC, so no
new error kind.

`start_scan` keeps its explicit `path` parameter and never reads the store. The
settings panel writes `library_root` and then calls it with the same path.

### Boot and first paint

`AppProvider` gates on `getStats()` today. It gains `getSettings()` in the same
`Promise.all` and gates on both.

Before that resolves, the palette comes from `prefers-color-scheme` in
`index.css`, and the stored choice overrides it once it lands. `system` is the
default, so most users never see a wrong-coloured frame at all. Someone who
picked Light on a dark desktop, or the reverse, sees one.

Every control writes on change. Text fields write on blur so a path is not
stored per keystroke. There is no Save button and no dirty state.

### Window geometry

`tauri-plugin-window-state` owns size, position, and maximized state, in its
own file. The settings table holds none of it. The first-launch default in
`tauri.conf.json` goes from 800x600 to 1280x800, because two wallpapers side by
side in 800 pixels is the layout the rank view exists to avoid.

## Alternatives rejected

**Typed columns in a one-row table.** Every new key becomes a migration, which
is the cost the key-value shape exists to avoid. The overhaul is going to add
keys from at least two later tickets.

**A single JSON blob.** Read-modify-write on every set, and no way to read one
key in `sqlite3` while debugging. It also moves the schema into a serde struct
where a rename silently drops the old value.

**`localStorage`.** Argued during charting and settled there. It would make the
theme available before the first paint, which is its one real advantage, and it
puts the user's settings somewhere the Rust side cannot read, splits state
across two stores, and dies with the WebView's data directory.

**Seeding default rows when the table is created.** Every key added later needs
a backfill step for existing databases, which is a migration by another name.
It also makes "what did the user actually change" unanswerable.

**A typed patch struct for the write.** `set_settings(patch: SettingsPatch)`
reads better and types the value properly end to end. It costs a Rust struct,
a TypeScript interface, and a serde derive per key, against one match arm.
Worth revisiting if a screen ever needs several settings written atomically.

**Launching the window hidden and showing it after settings resolve.** The only
way to guarantee no wrong-coloured frame. It delays the window for every launch
to fix a single frame that only a minority ever see.

**Window geometry in the settings table.** Geometry is not a stated preference,
it is a side effect of dragging a window, and it would write on every resize.
The plugin already handles multi-monitor and off-screen restore, which is
tedious to get right and invisible when it works.

**`start_scan` reading `library_root` itself.** Fewer arguments at the call
site, at the cost of a command whose behaviour depends on hidden state. Tests
would need the setting written first, and a failed write would silently scan
the wrong folder.

**Validating `library_root` at boot and clearing it when the folder is gone.**
The common cause is an unmounted drive, not a corrupt setting, and clearing it
punishes the user for that. The store keeps the string verbatim, the settings
panel shows "folder not found" beside the field, and a scan against a missing
folder fails the way it already does with `InvalidPath`.

## Consequences

`tauri-plugin-window-state` is the first new Tauri plugin since the port, and
the second dependency added to a project that has kept them down.

A user who has never opened Settings has an empty table, so a corrupt or
deleted `settings` table costs nothing but the choices they made.

The frontend's boot gate now depends on two commands rather than one. If
`get_settings` fails the app must still start, or a bad row locks the user out
of the app that would let them fix it. The catch in `AppContext.tsx:31` already
takes that shape for stats and extends to this.

`library_root` records what the user configured, not what was last scanned
successfully. Those differ after a failed scan, and the Settings field is
labelled as the former.

Whether a configured `library_root` changes which view the app boots into was
left to [#45](https://github.com/QuantumFF/walltare/issues/45), and
[ADR 0015](0015-navigation-shell.md) answers no: the boot rule reads what the
library contains, because a configured root proves only that the user typed
something. Where the
reject destination is edited, now that two views can reject, is left to the
ticket that settles the library card.

**Answered by [ADR 0018](0018-reject-destination-is-edited-in-settings.md)**,
which took it as its own ticket
([#51](https://github.com/QuantumFF/walltare/issues/51)) rather than the library
card's. Settings owns the only editor. The field leaves Review, both rejecting
pages carry a read-only line naming the current destination, and there is no
per-reject override. `move_wallpaper` keeps its explicit `destination_folder`
argument for the reason `start_scan` keeps its `path`, and it gains a `String`
return so the toast can name where the file landed.
