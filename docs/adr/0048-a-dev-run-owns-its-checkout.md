# ADR 0048: A dev run owns its checkout's port and data dir

**Status:** Accepted
**Date:** 2026-09-23

## Context

Work happens in several worktrees at once, and only one of them could run the
app. Two things were shared that should not have been:

- **The port.** `vite.config.ts` pins Vite to 1420 with `strictPort`, and
  `tauri.conf.json` points `devUrl` at it, so a second `bun tauri dev` dies with
  "Port 1420 is already in use" before the Rust build starts.
- **The database.** Every build, the installed app included, opens
  `walltare.db` in the app data dir. A worktree carrying a new migration
  upgrades it on launch, and from then on every older build — main, the
  installed app — refuses it as a database from the future (ADR 0005). Two runs
  at once would also write each other's Comparisons.

## Decision

`bun run dev:app` (`scripts/dev-app.ts`) runs `tauri dev` with both made local
to the checkout:

- It takes the first port from 1420 that is free on both 127.0.0.1 and ::1,
  hands it to Vite as `WALLTARE_DEV_PORT`, and to Tauri as a `--config`
  override of `build.devUrl`. Both loopbacks, because Vite's `localhost`
  resolves to ::1, and a port held there still binds on 127.0.0.1.
- It sets `WALLTARE_DATA_DIR` to `<checkout>/.dev-data`, which `lib.rs` uses in
  place of the app data dir for the database and the thumbnail cache.
- On the first run it seeds `.dev-data/walltare.db` from the real database with
  `VACUUM INTO`, so a new worktree opens on the curator's library instead of the
  first-run invitation. `VACUUM INTO`, not a copy, because the installed app may
  have the database open and its latest writes are still in the WAL.

Plain `bun tauri dev` is unchanged: port 1420, the app data dir.

## Considered

**A port per worktree derived from its path.** Stable across runs, but two
paths can hash to one port, and a free-port scan answers the only question that
matters at launch.

**A fresh, empty data dir per checkout.** Isolated, but every worktree would
start at the first-run screen with no Wallpapers and no Scores, which is not the
state most changes need testing against.

## Consequences

A dev run's Library root and reject destination are still the real ones, copied
with the rest of the settings, so a Soft reject in a dev run moves the real file
and the real database does not hear of it; ADR 0032 reads the moved file as gone
there. Deleting `.dev-data/` takes a fresh copy. The window state is not
isolated: it lives in the app config dir, and the last window closed wins.
