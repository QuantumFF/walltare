# walltare

walltare decides which of your wallpapers are worth keeping. Point it at a
folder, pick between two images at a time, and it ranks the whole collection
from your picks so you can move the bottom of the pile out. **It does not set
your wallpaper.** Nothing in it touches your desktop background; that stays
your desktop's job.

Linux, x86_64, single user, no server. A Rust/Tauri port of [rate-wallpaper](https://github.com/QuantumFF/rate-wallpaper), which was Python/FastAPI.

## Install

Two paths. Take the AppImage unless you are on Arch and would rather have
pacman own the result.

### Any Linux: the AppImage

Download the `.AppImage` from the
[releases page](https://github.com/QuantumFF/walltare/releases) and run it:

```sh
chmod +x walltare_*.AppImage
./walltare_*.AppImage
```

Nothing is installed: the AppImage is the whole app, and deleting the file is
the uninstall. Your database and thumbnail cache live elsewhere and survive it,
as do your wallpapers.

Every release also carries a `sha256sums.txt`. If a download looks wrong,
fetch that too and run `sha256sum -c sha256sums.txt` beside the AppImage to
find out whether the file arrived intact. It says nothing about where the file
came from — the checksums sit on the same page as the binary — so it is a check
against a bad download, not against a bad actor.

### Arch: the install script

```sh
git clone https://github.com/QuantumFF/walltare.git
cd walltare
./install.sh
```

`install.sh` runs `makepkg -si` against the `PKGBUILD` in this repo, so you
compile the app yourself and pacman owns the result: `pacman -Qi walltare`
finds it, and `pacman -R walltare` removes the binary, the desktop entry and
the icons while leaving your database and thumbnail cache alone. If a build
prerequisite is missing, the script names it rather than letting you read it
out of a compiler error. Afterwards walltare is in your application menu with
its own icon.

The script is Arch only. On anything else, use the AppImage.

On Wayland with an NVIDIA card the app sets `__NV_DISABLE_EXPLICIT_SYNC=1` for
itself, which is the WebKitGTK workaround for that combination
([tauri-apps/tauri#9394](https://github.com/tauri-apps/tauri/issues/9394)).
There is nothing to set by hand, and no X11 fallback is forced on anyone, so
fractional scaling and per-monitor DPI keep working.

## How it works

The first launch lands on Settings and asks for a **Library root**: one folder,
written how you like to write it. It is a Written path, so `~` and environment
variables are accepted and shown to you resolved. Scan it and every supported
image under it, at any depth, becomes a **Wallpaper**.

Rank shows two Wallpapers and you pick the one you prefer. Each pick is a
**Comparison**, and Comparisons feed a TrueSkill rating (μ=25, σ=8.333,
β=4.167, τ=0.083, no draws), ported to match python-trueskill 0.4.5 to under
1e-7. A Wallpaper's **Score** is the μ of that rating: its standing among the
others in this library and nothing more.

Pairs are not random. The Wallpaper with the fewest Comparisons goes first, and
its opponent is drawn with a bias toward a similar Score, so votes land where
they tell you the most. The two are then shuffled before display, because a
consistent left-hand slot would become part of the ratings. Progress reads as a
**Round** — one pass over the Eligible pool — alongside how many Wallpapers are
**Evaluated**, meaning the app is confident enough in their Score to trust it.

Review lists the lowest Scores still in play, and each one gets one of two
answers. Keep it and its **Status** becomes **Kept**: it stays in the library
and keeps voting, but never comes back to Review. Reject it and the Status
becomes **Rejected** by a **Soft reject**: the file moves to the reject
destination, which is another Written path, and every Comparison it took part
in survives, so the record of why it lost outlives the file leaving the folder.
A **Restore** moves the file back to its **Origin** and the Wallpaper becomes
**Active** again.

Library is the whole collection as a grid, filtered by Status, with a lightbox
for looking closely. A Wallpaper whose file has gone missing outside the app
says so on its card, and Settings will count them for you.

[CONTEXT.md](CONTEXT.md) defines these words exactly. Read it before touching
anything that deals in Wallpapers, Statuses or Comparisons.

## Known limitations

Every one of these is a decision rather than a bug.

- **A Comparison cannot be taken back.** Comparisons are permanent and are
  never deleted. Clicking the wrong image is fixed by voting more, not by
  undoing the vote.
- **There is no permanent delete.** Rejecting is always a Soft reject: the file
  moves to the reject destination and waits there for you. walltare never
  erases an image. The other side of that is Restore, which moves the file back
  from the reject destination to its Origin, so if you empty that folder by
  hand there is nothing left to move: the Restore fails, saying the file is
  gone, and the Wallpaper stays Rejected.
- **Four image extensions.** A scan picks up `.jpg`, `.jpeg`, `.png` and
  `.webp`, and ignores everything else under the Library root. No AVIF, no JXL,
  no GIF, no BMP, no TIFF.
- **The app does not set your wallpaper.** It decides which wallpapers to keep.
  Setting one is left to your desktop environment.

## Where your data lives

The database and the thumbnail cache both sit under the app data directory,
`$XDG_DATA_HOME/com.quantumff.walltare`, which is
`~/.local/share/com.quantumff.walltare` unless you have moved it.

- `walltare.db` — every Wallpaper, its Status, its Score, its Origin and every
  Comparison you have ever cast, plus your Library root, reject destination and
  theme. **Deleting it throws away every Comparison**, and nothing can
  reconstruct them: the ranking starts from zero.
- `thumbnails/` — generated JPEGs. Safe to delete; it regenerates. Settings
  reports how much disk it is holding and has a button that clears it.

Neither one holds your wallpapers. The images stay where they are on disk, and
walltare moves one only when you Soft reject it or Restore it.

## Building from source

You need Rust, bun and the WebKitGTK development packages; the `PKGBUILD` is
the authoritative list of what the build and the app need.

```sh
bun install
bun tauri dev      # dev run; needs a graphical session, an SSH shell has no display
bun tauri build    # the AppImage, under src-tauri/target/release/bundle/
```

The version number lives in `src-tauri/Cargo.toml` and everything else reads it
from there.

## Tests

```sh
cd src-tauri && cargo test && cargo clippy --all-targets && cargo fmt --check
bun test && bun run typecheck && bun run lint
```

Run both. The frontend tests drive the real components against a mocked IPC
seam, so a backend DTO change the TypeScript types did not follow shows up
there instead of at runtime. CI runs the same six commands on every push and
pull request.

## Layout

```
src/                  React frontend
  lib/client.ts       the only module that talks to Tauri
src-tauri/src/
  lib.rs              commands, events, the wallpaper:// protocol
  db.rs               schema, migrations, review and status transitions
  voting.rs           pair fetching, vote application, stats
  ranking.rs          TrueSkill and pair selection, no I/O
  soft_reject.rs      the reject and the Restore, and their write ordering
  settings.rs         the settings store and its defaults
  paths.rs            Written path expansion
  thumbnails.rs       generate, cache, invalidate
  pregen.rs           the pre-generation pass: its thread, cancel and events
  scanner.rs          recursive image walk
  missing.rs          the count of Wallpapers whose files have gone
tests/                frontend tests (bun + testing-library)
docs/adr/             decisions and why they went that way
docs/agents/          conventions for agents working in this repo
```

Rust tests live beside the code they cover, in `#[cfg(test)]` modules.

## Not in scope

Multiple libraries, and importing data from rate-wallpaper. Both were out of
scope on [#1](https://github.com/QuantumFF/walltare/issues/1) and stay there.
Setting the desktop wallpaper is not planned either: every desktop environment
does it differently, and that is a project rather than a feature.

## License

MIT. See [LICENSE](LICENSE).
