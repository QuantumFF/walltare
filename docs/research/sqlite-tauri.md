# Research: SQLite access from Tauri/Rust

**Ticket:** [QuantumFF/walltare#3](https://github.com/QuantumFF/walltare/issues/3)
**Date:** 2026-08-22

## Question

Which SQLite approach should walltare's Rust backend use inside Tauri 2 commands?
Compare `rusqlite`, `sqlx`, and `diesel` against these needs:

- Simple schema (two tables)
- Low write volume
- Commands run on a thread pool, so blocking calls are acceptable
- Fresh DB with simple migrations
- Linux-first desktop app

## Recommendation (TL;DR)

**Use `rusqlite` with the `bundled` feature.** Keep a single `Connection` in
`Mutex<Connection>` managed as Tauri app state, call it from synchronous
commands (Tauri runs non-async commands on its own thread pool), and initialize
the schema on first launch with `CREATE TABLE IF NOT EXISTS`. If/when versioned
migrations are needed, use the lightweight `rusqlite_migration` crate rather
than adopting a heavier stack.

## Comparison

### rusqlite — recommended

- **Model:** thin, synchronous wrapper over `libsqlite3-sys` (the C API).
  Mature: created 2014, ~95M total downloads, ~30M recent downloads, 4,469
  dependents ([crates.io](https://crates.io/crates/rusqlite)).
- **Maintenance health:** actively maintained; v0.40.2 published 2026-08-08,
  steady release cadence through 2025–2026, bundles SQLite 3.53.2 as of
  0.40.1 ([GitHub releases](https://github.com/rusqlite/rusqlite/releases),
  [README](https://github.com/rusqlite/rusqlite/)). The `bundled` feature
  compiles SQLite from source, so there is no dependency on the distro's
  system libsqlite3 — good for a Linux-first app where we control the SQLite
  version.
- **Fit for our needs:**
  - Two tables + low write volume → hand-written SQL is trivially small; an
    ORM or compile-time query checker adds nothing.
  - Blocking calls OK → rusqlite is sync by design. Tauri 2 runs non-async
    commands on a separate thread pool, so a blocking call in a sync command
    does not stall the UI or any async runtime.
    ([Tauri docs: async commands](https://v2.tauri.app/develop/calling-rust/) —
    "async commands are executed... on a separate async runtime... Non-async
    and sync commands run on the main thread unless defined in a separate
    thread" — in practice the standard pattern is `#[tauri::command]` fns doing
    direct rusqlite work, or `tokio::task::spawn_blocking` if made async.)
  - Fresh DB / simple migrations → `CREATE TABLE IF NOT EXISTS` at startup is
    idempotent and sufficient at this scale;
    [rusqlite_migration](https://crates.io/crates/rusqlite_migration) provides
    ordered user-version-based migrations if we outgrow that.
- **Caveat:** not async. If a command must be `async fn` (e.g. it also awaits
  other I/O), wrap DB work in `tokio::task::spawn_blocking`. The rusqlite
  maintainers explicitly state rusqlite has no async API and recommend
  `spawn_blocking`
  ([rusqlite#697](https://github.com/rusqlite/rusqlite/issues/697)).

### sqlx — not needed here

- **Model:** async-first, database-agnostic toolkit with optional
  compile-time-checked queries (`query!` macros) and built-in migration
  support. Actively developed: v0.9.0 released 2026-05; note ownership moved
  from LaunchBadge to the new `transact-rs` org in 2026
  ([release announcement](https://github.com/launchbadge/sqlx/discussions/4271),
  [CHANGELOG](https://github.com/transact-rs/sqlx/blob/main/CHANGELOG.md)).
- **Why not:**
  - Compile-time checking needs a live DB or offline metadata (`sqlx-cli`,
    `.sqlx` files) — extra build machinery for two tables.
  - Its async pooling is actively counterproductive for SQLite writes:
    SQLite is single-writer, so tasks yielding while holding the write lock
    cause busy-timeout contention. The documented fix is... a single writer
    connection or falling back to a sync library like rusqlite
    ([Evan Schwartz, "Your SQLite Connection Pool Might Be Ruining Your Write Performance"](https://emschwartz.me/psa-your-sqlite-connection-pool-might-be-ruining-your-write-performance/)).
  - Community reports put sqlx's SQLite throughput well below rusqlite
    ([rusqlite#697 comment](https://github.com/rusqlite/rusqlite/issues/697): "up to 500% slower").
  - We have no need for Postgres/MySQL portability.
- **Where sqlx does appear in Tauri:** the official
  [`tauri-plugin-sql`](https://v2.tauri.app/plugin/sql/) plugin uses sqlx under
  the hood — but that plugin exists to let *frontend JS* run SQL directly,
  which is not our architecture (we want SQL behind Rust commands).

### diesel — overkill

- **Model:** mature ORM/query-builder with a DSL and strong type safety; sync
  (like rusqlite), so it would fit the threading model fine. Healthy:
  v2.3.12 published 2026-08-07, regular monthly-ish releases
  ([crates.io](https://crates.io/crates/diesel),
  [changelog](https://diesel.rs/changelog/)), includes its own migration tooling
  (`diesel_cli`).
- **Why not:**
  - The DSL + schema macro + `diesel_cli` setup is real complexity for a
    two-table schema; the payoff (composable type-safe queries) matters at
    dozens/hundreds of entities, not two.
  - Steeper learning curve than raw SQL; every contributor must learn the DSL.
  - No benefit over rusqlite for this app's access pattern.

## Tauri community conventions

The dominant community pattern for Tauri 2 desktop apps matches the
recommendation: rusqlite directly in Rust commands, `Connection` wrapped in
`std::sync::Mutex` and registered via `app.manage(...)`, DB file placed via
`app_data_dir()`, schema initialized idempotently on first launch
([worked example](https://prodsens.live/2026/06/13/sqlite-in-a-tauri-v2-app-simple-reliable-zero-regrets/);
[async-in-Tauri notes](https://dev.to/hiyoyok/rust-async-in-tauri-v2-what-tripped-me-up-and-how-i-fixed-it-1662)).
`tauri-plugin-sql` (sqlx-based) is the alternative, aimed at frontend-driven
SQL rather than a Rust-owned data layer.

## Suggested shape

```toml
[dependencies.rusqlite]
version = "0.40"
features = ["bundled"]
```

```rust
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<rusqlite::Connection>);

pub fn run(app: &tauri::App) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let conn = rusqlite::Connection::open(dir.join("walltare.db"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS table_a (...);
         CREATE TABLE IF NOT EXISTS table_b (...);",
    )?;
    app.manage(Db(Mutex::new(conn)));
    Ok(())
}

#[tauri::command]
fn add_thing(db: tauri::State<Db>, name: String) -> Result<(), String> {
    db.0.lock().unwrap()
        .execute("INSERT INTO table_a(name) VALUES (?1)", [&name])
        .map(|_| ())
        .map_err(|e| e.to_string())
}
```

If migrations become non-trivial later, swap `execute_batch` for
[`rusqlite_migration`](https://crates.io/crates/rusqlite_migration) without
changing anything else.

## Sources

- <https://crates.io/crates/rusqlite>
- <https://github.com/rusqlite/rusqlite/releases> and repo README
- <https://github.com/rusqlite/rusqlite/issues/697> (maintainer guidance on async/`spawn_blocking`)
- <https://crates.io/crates/sqlx> and <https://github.com/launchbadge/sqlx/discussions/4271> (0.9.0 release / org transfer)
- <https://emschwartz.me/psa-your-sqlite-connection-pool-might-be-ruining-your-write-performance/> (SQLite single-writer vs async pools)
- <https://crates.io/crates/diesel> and <https://diesel.rs/changelog/>
- <https://v2.tauri.app/plugin/sql/> (official plugin uses sqlx, frontend-facing)
- <https://prodsens.live/2026/06/13/sqlite-in-a-tauri-v2-app-simple-reliable-zero-regrets/> (community pattern)
