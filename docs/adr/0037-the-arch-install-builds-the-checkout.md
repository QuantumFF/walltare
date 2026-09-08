# ADR 0037: The Arch install builds the checkout and hands it to pacman

**Status:** Accepted
**Ticket:** [#206](https://github.com/QuantumFF/walltare/issues/206),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

The only way to start this app has been `bun tauri dev` from a checkout that
already has Rust, bun and the WebKitGTK development packages on it, which
describes one machine. The epic ships two answers: an AppImage for everyone,
and, for Arch, a package the user compiles themselves so nothing prebuilt has
to be trusted or maintained. This ADR is the second one.

The epic settled the shape — a `PKGBUILD` in the repo, an `install.sh` that
runs `makepkg -si` against it, pacman owning the result — and gave the reason:
the uninstall path is where hand-rolled installers rot, and on Arch there is no
reason to have one. What was left was everything that decides whether it works
on a machine that is not the maintainer's, and four facts shaped it. All four
were read rather than assumed.

- **The binary names fourteen libraries, out of nine packages.** `readelf -d` on
  `src-tauri/target/release/walltare` lists `libwebkit2gtk-4.1.so.0`,
  `libjavascriptcoregtk-4.1.so.0`, `libgtk-3.so.0`, `libgdk-3.so.0`,
  `libsoup-3.0.so.0`, `libglib-2.0.so.0`, `libgobject-2.0.so.0`,
  `libgio-2.0.so.0`, `libcairo.so.2`, `libgdk_pixbuf-2.0.so.0`,
  `libdbus-1.so.3`, `libgcc_s.so.1`, `libc.so.6` and `libm.so.6`, and nothing
  else. Tauri's Linux prerequisites page also lists an appindicator library and
  `librsvg`; this build links neither, because `tauri` is built with
  `features = []` so there is no tray icon, and nothing in the app renders an
  SVG.
- **makepkg builds in `$startdir/src` and packages in `$startdir/pkg`.** The
  repo root already has a `src/` — the frontend — so a `PKGBUILD` sitting there
  would put makepkg's scratch directory on top of the app, and `makepkg -C`
  would delete it.
- **`namcap PKGBUILD` sources a PKGBUILD in a restricted shell.** No external
  command runs and no file can be read, so no PKGBUILD that computes its
  version from another file can be linted by it. `makepkg --printsrcinfo`,
  which is the parser every build actually goes through, has no such limit.
- **`main.rs` already sets the NVIDIA variable, and overrode the user to do
  it.** `std::env::set_var` writes over whatever the environment said, which is
  the opposite of the epic's decision that the variable is set "only when it is
  not already set, so a user on a fixed driver can override it".

## Decision

### The PKGBUILD lives in `packaging/` and builds the checkout in place

`packaging/PKGBUILD`, not the repo root, for the `src/` collision above. Run
from there, makepkg's two working directories are `packaging/src` and
`packaging/pkg`, both gitignored, and no makepkg flag can reach the app's own
files.

There is no `source` array. The sources are the clone the user already has,
which is the whole point of the script: they compile what they cloned. `build()`
and `package()` both `cd` to the repo root, computed from makepkg's `startdir`.

The version comes out of `src-tauri/Cargo.toml` at parse time:

```bash
_version="$(awk -F'"' '/^version = /{print $2; exit}' "$_repo/src-tauri/Cargo.toml")"
pkgver="${_version:?the version could not be read from src-tauri/Cargo.toml — is this a walltare checkout?}"
```

[#196](https://github.com/QuantumFF/walltare/issues/196) made that file the one
place the version lives, and a package that carried its own copy would be the
second — the exact failure the epic named, a release shipping with three
different versions in it. The `:?` expansion is there so a checkout without
that file fails saying so, rather than with makepkg's complaint that `pkgver`
is empty.

The cost is `namcap PKGBUILD`, which now lints nothing. That is the smaller
loss: `namcap` on the *built package* is the run that finds a missing or
surplus dependency, and it is unaffected.

### The dependency list names what the binary asks for, transitive or not

```
depends=(webkit2gtk-4.1 gtk3 libsoup3 glib2 cairo gdk-pixbuf2 dbus libgcc glibc hicolor-icon-theme)
makedepends=(rust bun)
```

Every entry but the last is the package owning a library from the `readelf`
list, established with `pacman -Qo`. `hicolor-icon-theme` is there because the
package installs into `/usr/share/icons/hicolor`. `namcap` on the built package
names no dependency this list is missing, which is as far as a machine that has
everything installed can take it.

`libgcc` rather than the `gcc-libs` this list started with, which is what
`namcap` asked for: `gcc-libs` is now a metapackage that would pull in libasan,
libgfortran, libtsan and seven other runtimes for the sake of one
`libgcc_s.so.1`.

`webkit2gtk-4.1` pulls most of the others in today, and they are still listed.
An entry that is present only because something else happens to depend on it is
an entry that breaks on the day that stops being true, and this list is the one
part of the project that a stranger's machine tests and the maintainer's cannot:
the maintainer already has everything. Being explicit costs a line each.

`rust` is satisfied by the `rustup` package too, which provides it. `bun` is in
`extra`, so `makepkg --syncdeps` can install it and nothing here needs the AUR.
The C toolchain and `pkgconf` that rusqlite's bundled SQLite and
`webkit2gtk-sys` need come from `base-devel`, which makepkg already requires of
the user and which PKGBUILDs do not list.

`build()` runs `bun install --frozen-lockfile` and then
`bun run tauri build --no-bundle`. `--no-bundle` matters: the bundler would
download linuxdeploy mid-build to make an AppImage this package has no use for.

### Two of makepkg's own default options are turned off

`options=('!lto' '!debug')`, and the first one is not a preference. Arch's
stock `makepkg.conf` carries `lto` in `OPTIONS`, which puts `-flto=auto` into
the `CFLAGS` the `cc` crate compiles rusqlite's bundled SQLite with. That makes
`libsqlite3.a` a bundle of GCC bitcode, and the linker rustc reaches for here
is `lld`, which cannot read it. The build compiles everything and then dies at
the link, in a wall of `undefined symbol: sqlite3_open_v2` — and it dies for
everybody, because this is makepkg's default configuration, so the container
job in #207 would have hit it too. None of it shows up under `cargo build`,
which is the only build this project had ever run. Cargo's release profile does its own optimizing, so
there is nothing to miss.

`!debug` is a preference. Cargo hands the linker `--strip-debug` in release, so
the `walltare-debug` package makepkg builds by default has no symbols in it —
`gdb-add-index` says exactly that while it is being made — and one empty second
package is one more thing a person installing this has to reason about.

### The bundler makes an AppImage and nothing else

`bundle.targets` goes from the scaffold's `"all"` to `["appimage"]`. The epic's
reasoning, unchanged: `deb` and `rpm` cost nothing to produce and a lot to
support, because neither will ever be tested and a broken one is a bug report
nobody can reproduce. Arch users get this package; everybody else gets the
AppImage.

### `/usr/bin/walltare` is a launcher, and the launcher sets the variable

The binary is installed as `/usr/lib/walltare/walltare` and
`packaging/walltare.sh` becomes `/usr/bin/walltare`:

```sh
if [ -z "${__NV_DISABLE_EXPLICIT_SYNC+set}" ]; then
	__NV_DISABLE_EXPLICIT_SYNC=1
	export __NV_DISABLE_EXPLICIT_SYNC
fi

exec /usr/lib/walltare/walltare "$@"
```

`${VAR+set}` asks whether the variable exists at all, not whether it has a
value, so a user who exports `__NV_DISABLE_EXPLICIT_SYNC=0` — or an empty
value — keeps it. That is the whole requirement: the WebKitGTK-on-NVIDIA
workaround (tauri-apps/tauri#9394) is on by default so the app launches from a
menu like every other app on the system, and off for anybody whose driver no
longer needs it.

A wrapper rather than an `Exec=` line with the variable in it, for two reasons.
`Exec=env __NV_DISABLE_EXPLICIT_SYNC=1 walltare` cannot express "only when
unset" at all, and the `sh -c` spelling that can is a quoting trap that would
also leave a terminal launch — `walltare` from a shell — without the
workaround. The desktop entry stays a plain `Exec=walltare`, which
`desktop-file-validate` passes.

The launcher does not probe for an NVIDIA card first. The variable is read by
NVIDIA's driver and by nothing else, so on AMD and Intel it changes nothing,
and a copy of the driver probe in shell would be a second place to keep
correct. `main.rs` keeps its probe for the two paths that have no launcher —
the AppImage and `bun tauri dev` — and now checks `var_os(…).is_none()` before
setting anything, so the override is honoured whichever way the app was
started.

The desktop entry, `walltare.desktop`, carries `Categories=Graphics;Viewer;`
and `Icon=walltare`, and the package installs the icon at 32, 128, 256 and 512
pixels under that name. `StartupWMClass` is deliberately absent: the value would
be a guess about what WM class the window announces, and a wrong one is worse
than none.

### `install.sh` refuses before it builds, naming what is missing

Arch only, at the repo root, arguments passed through to makepkg so
`./install.sh --noconfirm` runs unattended. Everything before the makepkg call
exists to satisfy one acceptance criterion: a missing prerequisite is named in
one line, never found at the bottom of a compiler error.

| checked | why it is not left to makepkg |
| --- | --- |
| `pacman` exists | on Debian or Fedora the honest answer is the AppImage, not a build |
| not running as root | makepkg refuses to build as root, and says so in its own vocabulary |
| `makepkg fakeroot gcc make pkg-config sudo` | a missing `gcc` or `pkgconf` surfaces as a compiler or a linker error |
| the pacman sync database is not empty | otherwise every lookup below fails for a reason that has nothing to do with this package |
| every name in `depends` and `makedepends` resolves | a typo'd package name is exactly the failure this ticket exists to prevent |

The last one reads the names out of `makepkg --printsrcinfo` rather than
repeating them, so the script and the PKGBUILD cannot drift, and accepts a name
that `pacman -Si` does not know but `pacman -T` reports as already satisfied —
which is how `rust` passes on a machine that has `rustup`.

It calls `makepkg --syncdeps --install --force`. `--force` is there because
makepkg leaves the built package in `packaging/`, and without it a second
`./install.sh` stops to say a package has already been built.

### The uninstall is pacman's, and there is no `.install` script

`pacman -R walltare` removes the binary, the launcher, the desktop entry, four
icons and the license, because that is the whole list of what the package
installs. The database and the thumbnail cache live under the app data
directory, `$XDG_DATA_HOME/com.quantumff.walltare`, which pacman never owned
and therefore cannot take with it. Nothing in this package has a post-remove
hook, and that is the decision: a hook that tidied up after itself would be a
packaging script deleting every Comparison the user has ever cast.

### What cannot be tested here is written down instead

`docs/release-checklist.md` gains **Launch environment** and **Packaging and
installation** sections. Nothing in either can be checked by `cargo test`,
`bun test` or CI: they need a package manager, a display, and in one case an
NVIDIA card under Wayland. The epic already filed the NVIDIA launch path as one
of its two items with no automated test.

The one check that a machine can make is the container job in
[#207](https://github.com/QuantumFF/walltare/issues/207), which runs this
script in `archlinux:base-devel` from a clean checkout. That job is the only
thing that can catch a missing entry in `depends`, and it is worth noting for
whoever writes it that makepkg will not run as root, so the container needs an
ordinary user with sudo.

## Alternatives rejected

**An installer script that copies files into `/usr/local` itself.** The epic
rejected this and named the reason: the uninstall path is where hand-rolled
installers rot. It is also the path nobody tests, because the person who wrote
it never runs it.

**Publish to the AUR now.** Out of scope on the epic. The PKGBUILD is written
so that promoting it means adding a `source` array and a `pkgver()` and
changing nothing else, which is the extent of the commitment being made here.

**Put the PKGBUILD at the repo root.** It is where a user would look first, and
`install.sh` would need no `cd`. It puts makepkg's `src/` scratch directory on
top of the frontend, and one `makepkg -C` deletes the app. No comment survives
that.

**A literal `pkgver=1.0.0`.** namcap could then lint the file, and the AUR
would take it as-is. It is a second copy of the number that #196 spent a ticket
consolidating, and it goes stale silently: the package would install 1.0.0 from
a 1.1.0 checkout and `pacman -Qi` would agree with it.

**A `pkgver()` function, which is where makepkg wants a computed version.**
namcap tolerates it and the AUR expects it. makepkg *writes the result back
into the PKGBUILD* with `sed`, so every build would either dirty the git
checkout or need the placeholder to already be the right number, which is the
copy this was avoiding.

**Copy the checkout into `$srcdir` so the build is out-of-tree.** Correct
packaging practice, and this build is not an ordinary one: it would copy
`node_modules/` and `src-tauri/target/`, gigabytes of them, and throw away the
warm Cargo cache that makes a second install quick.

**List only `webkit2gtk-4.1` and let the rest arrive transitively.** Shorter,
and true on today's Arch. It makes this package's correctness depend on another
package's dependency list, which is a thing that changes without telling
anybody, and the symptom is a linker error on somebody else's machine.

**Bundle the AppImage into the package, or install it as `/usr/bin/walltare`.**
One build artifact for both paths. It would ship a second copy of every library
the AppImage carries, inside a package whose dependencies already provide them,
and pacman would own a file whose contents it cannot see into.

**A `.install` script that clears the thumbnail cache on remove.** Tidy, and it
is the one directory that is safe to delete. It puts file deletion in a
packaging hook, one edit away from the directory next to it that holds every
Comparison, for a folder Settings already has a button to clear.

## Consequences

**The build writes into the checkout.** `bun install` fills `node_modules/`,
the frontend build fills `dist/`, and Cargo fills `src-tauri/target/`, all
gitignored and all outside makepkg's control. The upside is that the second
`./install.sh` is a warm rebuild rather than a cold one.

**`namcap PKGBUILD` reports the file as invalid.** Not a warning to be fixed:
it is namcap's restricted parser meeting a computed `pkgver`. The checks that
still work are `makepkg --printsrcinfo` and `namcap` on the built package.

**The dependency list is unverified until #207.** Every name is confirmed to
exist with `pacman -Si`, and every library is confirmed to be needed with
`readelf`, but "complete" can only be proved by a machine that has nothing
installed. That is the container job, and it is why the epic ordered packaging
before the release.

**`pacman -Qi walltare` reports whatever `src-tauri/Cargo.toml` says.** Bumping
the crate version bumps the package, and `pkgrel` stays at 1 until a packaging
change ships against an unchanged app.

**Building the AppImage on a current Arch host needs `NO_STRIP=true`.** Not
this package's problem — `--no-bundle` means the PKGBUILD never touches
linuxdeploy — but it is the other half of the bundler change, and it fails
confusingly: linuxdeploy ships its own elderly `strip`, which cannot read the
`.relr.dyn` sections in today's system libraries and stops the bundle with
`unknown type [0x13]`. With `NO_STRIP=true` the build finishes one bundle,
`walltare_1.0.0_amd64.AppImage`, and nothing else. It is written down in
`docs/release-checklist.md` for #207.

**A machine with rustup and no stable toolchain fails.** `build()` exports
`RUSTUP_TOOLCHAIN=stable`, the Arch convention, so rustup's own error names the
toolchain. That is a message about a toolchain rather than a compiler error, so
it stays on the right side of the line the script is holding.
