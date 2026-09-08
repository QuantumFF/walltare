# Release checklist

Everything in this file is checked by a person, from a built artifact, because
none of it can be checked any other way. `cargo test`, `bun test` and CI cover
the rest; what is left here is what needs a display, a driver, a package
manager, or a pair of eyes.

Work top to bottom. Each item says what to do and what a pass looks like, so a
failure is a fact rather than a judgement.

## How to read this file

- **Build under test** — every section names the build it applies to. A `bun
  tauri dev` run does not exercise the content security policy or the bundle
  layout, so a pass from a dev run is not a pass.
- **Four views** — Library, Rank, Review and Settings, which is the whole app.
  Where a section says "all four views", visit each one and leave the console
  open the whole time.
- **Recording a run** — copy the checklist into the release issue and tick it
  there. This file stays unticked, as the template for the next release.

## Packaging and installation

**Build under test:** the Arch package, installed with `./install.sh` from a
clean clone. Nothing here is exercised by a dev run or by CI's push gate: the
one machine check is the `archlinux:base-devel` container job on a tag
([#207](https://github.com/QuantumFF/walltare/issues/207)), and it proves the
dependency list rather than the installed app. See
[ADR 0037](adr/0037-the-arch-install-builds-the-checkout.md).

- [ ] **A clean clone installs in one command.** `git clone` the repo somewhere
      new, `cd` into it, run `./install.sh`, answer sudo. It ends with pacman
      installing `walltare`, and no step in between asked for anything the
      script had not already named.
- [ ] **A missing prerequisite is named, not compiled into an error.** On a
      machine or container without `base-devel`, `./install.sh` stops before any
      build and names the missing tool and the group it comes from. A pass is a
      one-line message; a compiler or linker error anywhere in the output is a
      failure, however far down.
- [ ] **A dependency that does not exist is caught before the build.** Add a
      nonsense name to `depends` in `packaging/PKGBUILD`, run `./install.sh`,
      and read it back in the error. Revert the edit.
- [ ] **`pacman -Qi walltare` reports the version in
      `src-tauri/Cargo.toml`.** For this release, 1.0.0. If those two disagree,
      the PKGBUILD stopped reading the crate manifest and there are two version
      numbers again.
- [ ] **`pacman -Ql walltare` lists nothing surprising.** The binary at
      `/usr/lib/walltare/walltare`, the launcher at `/usr/bin/walltare`, the
      desktop entry, four icons under `/usr/share/icons/hicolor`, and the
      license. Nothing under `/etc`, nothing in a home directory.
- [ ] **`namcap` on the built package reports no missing dependency.** Run it
      against the `.pkg.tar.zst` left in `packaging/`. A "not included as a
      depend" line is the failure this whole section exists to catch; a
      "dependency included but already satisfied" line is not one — those
      entries are deliberate, per ADR 0037.
- [ ] **`pacman -R walltare` leaves the library alone.** Before removing, note
      the size of the database and the thumbnail cache under
      `~/.local/share/com.quantumff.walltare`. After removing: the binary, the
      launcher, the desktop entry and the icons are gone, the app data
      directory is untouched, and reinstalling brings back every Comparison,
      Status, the Library root, the reject destination and the theme.
- [ ] **The bundler produces an AppImage and nothing else.** `bun tauri build`
      ends with `Finished 1 bundle` and leaves one directory under
      `src-tauri/target/release/bundle/` — `appimage`, holding
      `walltare_<version>_amd64.AppImage` and the AppDir it was made from. No
      `deb` and no `rpm` beside it.

      On an up-to-date Arch host this needs `NO_STRIP=true` in front of it:
      linuxdeploy carries its own elderly `strip`, which cannot read the
      `.relr.dyn` sections in current system libraries and fails the bundle
      with `unknown type [0x13]`. That is a fact about the build host rather
      than about walltare, and the release workflow
      ([#207](https://github.com/QuantumFF/walltare/issues/207)) is where it
      belongs; it is written here because this is where somebody will meet it.

## Launch environment

**Build under test:** the installed package, from the application menu rather
than from a terminal. The menu is the path with no shell to inherit anything
from, which is the whole reason the launcher exists.

- [ ] **walltare is in the application menu, under its own icon.** Search the
      menu for "walltare". The entry appears, with the two-panel icon and not a
      generic placeholder, and clicking it starts the app.
- [ ] **It launches on NVIDIA under Wayland with nothing exported.** This needs
      the hardware; there is no substitute for it. A pass is a window that
      paints its content. A blank, black or flickering window is the failure the
      launcher's `__NV_DISABLE_EXPLICIT_SYNC=1` is there to prevent.
- [ ] **A user who sets the variable keeps their value.** Run
      `__NV_DISABLE_EXPLICIT_SYNC=0 walltare` from a terminal, then read it back
      out of the running process:
      `tr '\0' '\n' < /proc/$(pgrep -f /usr/lib/walltare/walltare)/environ | grep __NV`.
      It says `0`. Neither the launcher nor `main.rs` may overwrite it.
- [ ] **Nothing forces X11 on anybody.** With the app running on a Wayland
      session, the same `environ` read shows no `GDK_BACKEND` and no
      `WEBKIT_DISABLE_DMABUF_RENDERER`. Both were dropped in
      [#195](https://github.com/QuantumFF/walltare/issues/195); forcing X11
      would cost fractional scaling and per-monitor DPI.

## Content security policy

**Build under test:** a release build — `cargo tauri build`, or the AppImage
itself. The policy is not applied under `bun tauri dev` on desktop: Vite serves
the document, so Tauri attaches no `Content-Security-Policy` header and a dev
run cannot fail any of these. See
[ADR 0036](adr/0036-the-content-security-policy.md).

A wrong policy has no error message a user will ever see. A blocked thumbnail
paints the same **File is gone** panel as a wallpaper whose file really has
gone, so these checks are the only thing standing between a bad policy and a
release that looks like it has a broken thumbnail pipeline.

- [ ] **Thumbnails render in the Library grid.** Open Library against a library
      with wallpapers in it. Cards show pictures. No card shows **File is gone**
      for a file that is on disk.
- [ ] **Thumbnails render in Rank.** Both sides of the pair show a picture.
- [ ] **Thumbnails render in Review.** The list paints pictures, not panels.
- [ ] **Thumbnails render in the Lightbox.** Open a card from Library. The small
      thumbnail appears first and the medium one replaces it. Page through
      several wallpapers with the arrow keys.
- [ ] **Fonts render as Geist, not a fallback.** Geist is bundled, so this is a
      check that the bundled `.woff2` files loaded rather than a check that the
      network worked. Compare a heading against the specimen at
      <https://vercel.com/font>, or open the inspector on any text node and read
      the rendered font family. A fallback looks like your system sans-serif and
      is easiest to spot on digits and on the letter `g`.
- [ ] **The console reports no policy violations, across all four views.** Open
      the webview inspector, then walk Library → Lightbox → Rank → Review →
      Settings, vote once, reject once, restore it, and run a scan. Nothing in
      the console mentions Content Security Policy, `Refused to`, or a blocked
      URI.
- [ ] **No remote origin is reachable.** In the inspector console, run
      `fetch('https://example.com')`. It must fail with a policy error. This is
      the check that the policy is doing anything at all.

<!--
Sections below are added by the remaining release issues. Keep the shape: a
level-two heading, a **Build under test** line, then checkboxes that each say
what to do and what a pass looks like.

- The release artifact and its checksums — #207
- The release itself — #208
-->
