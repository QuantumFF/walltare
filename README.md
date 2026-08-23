# walltare

Local wallpaper curation. Point it at a folder, compare wallpapers two at a
time, and let the ratings tell you which ones to throw out.

A Rust/Tauri port of rate-wallpaper, which was Python/FastAPI. Linux-first,
single user, no server. The port is tracked in
[#1](https://github.com/QuantumFF/walltare/issues/1).

## How it works

Scan a folder and every image under it becomes a wallpaper. The app then shows
you two at a time and you pick the one you prefer. Each pick is a comparison,
and comparisons feed a TrueSkill rating (μ=25, σ=8.333, β=4.167, τ=0.083, no
draws), ported to match python-trueskill 0.4.5 to under 1e-7.

Pairs are not random. The wallpaper with the fewest comparisons goes first, and
its opponent is drawn with a bias toward a similar rating, so votes land where
they tell you the most. The two are then shuffled before display, because a
consistent left-hand slot would bias the ratings.

When you have voted enough, the review screen lists the lowest-rated wallpapers
still in play. Keep one and it stays in the library and out of review. Reject
one and the app moves the file to a folder of your choosing while keeping every
comparison it took part in, so the record of why it lost survives the file
leaving.

Read [CONTEXT.md](CONTEXT.md) before touching anything that deals in
wallpapers, statuses, or comparisons. It defines the words the code uses.

## Running it

```sh
bun install
bun tauri dev
```

On native Wayland:

```sh
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 bun tauri dev
```

The database and the thumbnail cache live under the app data directory
(`~/.local/share/com.quantumff.walltare` on Linux). Deleting the thumbnail
cache is safe; it regenerates. Deleting the database throws away your votes.

## Tests

```sh
cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check
bun test && bun run typecheck && bun run lint
```

Run both. The frontend tests drive the real components against a mocked IPC
seam, so a backend DTO change the TypeScript types did not follow shows up
there instead of at runtime.

## Layout

```
src/                  React frontend
  lib/client.ts       the only module that talks to Tauri
src-tauri/src/
  lib.rs              commands, events, the wallpaper:// protocol
  db.rs               schema, migrations, review and status transitions
  voting.rs           pair fetching, vote application, stats
  ranking.rs          TrueSkill and pair selection, no I/O
  thumbnails.rs       generate, cache, invalidate
  scanner.rs          recursive image walk
tests/                frontend tests (bun + testing-library)
docs/adr/             decisions and why they went that way
docs/agents/          conventions for agents working in this repo
```

Rust tests live beside the code they cover, in `#[cfg(test)]` modules.

## Not in scope

Packaging (.deb, AppImage), multiple libraries, and importing data from the old
app. See [#1](https://github.com/QuantumFF/walltare/issues/1).
