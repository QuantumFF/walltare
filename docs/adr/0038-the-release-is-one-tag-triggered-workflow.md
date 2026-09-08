# ADR 0038: The release is one tag-triggered workflow, and the tag is the only input

**Status:** Accepted
**Ticket:** [#207](https://github.com/QuantumFF/walltare/issues/207),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

[ADR 0037](0037-the-arch-install-builds-the-checkout.md) gave Arch users a
package they compile themselves. This one is the other half of the epic's
answer: an AppImage on the releases page for everybody else, its checksums
beside it, and a machine that proves the Arch dependency list is complete.

The epic settled what ships — AppImage only, `sha256sums.txt` generated in CI,
no auto-updater, no GPG — and left the mechanics. Four facts decided them, and
each was measured rather than assumed.

- **`bun tauri build` on ubuntu-24.04 bundles without `NO_STRIP`.** linuxdeploy
  runs its own bundled `strip`, whose binutils is old enough not to know
  `SHT_RELR` (section type `0x13`), which is why the bundle fails on a current
  Arch host: `readelf -S` finds a `.relr.dyn` in every library it would copy
  there — `libwebkit2gtk-4.1`, `libjavascriptcoregtk-4.1`, `libgtk-3`,
  `libglib-2.0`, `libcairo`, `libgdk_pixbuf-2.0`, `libsoup-3.0`, `libc`. On the
  runner, only `libc.so.6` has one, and linuxdeploy never copies libc into an
  AppDir. All 162 shared objects it did copy were checked, and none carries the
  section. The plain bundle was run first, on purpose, to see it succeed rather
  than to guess.
- **The Tauri CLI already handles the FUSE problem.** The bundler sets
  `APPIMAGE_EXTRACT_AND_RUN` and passes `--appimage-extract-and-run` to
  linuxdeploy, so nothing here needs `libfuse2` on a runner that has not
  shipped it since 22.04.
- **The AppImage is named from the crate manifest, and the release from the
  tag.** The bundler writes `walltare_1.0.0_amd64.AppImage` out of
  `src-tauri/Cargo.toml`, which [#196](https://github.com/QuantumFF/walltare/issues/196)
  made the single source of the version. The tag is a second copy of that
  number, written by hand, at the one moment nobody can take it back.
- **makepkg will not run as root, and `archlinux:base-devel` has only root.**
  The container job needs an ordinary user with passwordless sudo, because
  `makepkg --syncdeps --install` shells out to pacman twice in a job with no
  terminal.

## Decision

### One workflow, on `v*`, with two jobs that do not wait for each other

`.github/workflows/release.yml`, triggered by nothing but a pushed tag matching
`v*`. `permissions: contents: write`, which is what creating a release and
uploading assets needs and the only write the workflow makes.

`appimage` builds and publishes. `arch-install` runs `./install.sh` in
`archlinux:base-devel`. Neither is `needs:` the other, and that is a decision
rather than an oversight: an AppImage user does not care whether the Arch
dependency list is complete, and holding a published artifact behind a
from-source build in another distribution would couple two things that fail for
unrelated reasons. A red container job is read off the run, and
`docs/release-checklist.md` has a box for exactly that.

The Arch job is tag-only, as the epic decided. It is a full from-source build of
the whole app; on the push gate it would turn every commit into a coffee break.

### The tag is checked against the crate manifest before anything is built

```bash
version="${tag#v}"
crate="$(awk -F'"' '/^version = /{print $2; exit}' src-tauri/Cargo.toml)"
[[ "${version%%-*}" == "$crate" ]]
```

`v1.1.0` against a `1.0.0` manifest fails in the first step, rather than
publishing a release called 1.1.0 whose asset is named
`walltare_1.0.0_amd64.AppImage`. #196 spent a ticket making the manifest the
only place the number lives; this is what keeps the tag honest about it.

A tag with a suffix is a prerelease and its version is the part in front of the
suffix, so `v1.0.0-rc1` is walltare 1.0.0, marked prerelease. There is no list
of accepted suffixes and no separate rc trigger. The rule is only that an rc
must not present itself as the release, and GitHub's releases page shows the
latest non-prerelease as the download.

The AppImage keeps the name the bundler gave it. Renaming it to carry the tag
would put `1.0.0-rc1` on a file built from a `1.0.0` manifest, and the version
in the filename would stop being the version in the binary.

### `sha256sums.txt` holds a bare filename and is verified before it is uploaded

Written next to the AppImage, over the AppImage:

```
sha256sum "$appimage" >sha256sums.txt
sha256sum -c sha256sums.txt
```

The bare filename is the whole point. A checksum file carrying
`src-tauri/target/release/bundle/appimage/…` verifies in the build tree and
nowhere else, which is every directory a stranger might download into. It does
not cover itself, because a file cannot, and the checklist verifies it from a
`gh release download` into an empty directory rather than from the build.

The same step refuses a bundle directory that holds anything but one
`*.AppImage`, and refuses an AppImage whose name does not contain the crate
version. Both are one line each and both catch a release that is wrong in a way
nobody would look at twice.

### The release is created by `gh release create`, and the notes are replaced afterwards

```bash
gh release create "$TAG" --verify-tag --generate-notes \
  --prerelease="$PRERELEASE" "$DIR/$APPIMAGE" "$DIR/sha256sums.txt"
```

`--verify-tag` so the workflow cannot invent a tag. `--generate-notes` so the
release is never published empty. The epic wants hand-written notes for a
release that matters, and the way to get them is
`gh release edit <tag> --notes-file <file>` after the run, which
[#208](https://github.com/QuantumFF/walltare/issues/208) does. The workflow has
no second path that reads notes out of the repo or fills in a draft the
maintainer prepared: that path would run on one tag in the project's history and
be untested on every other one.

### The container job installs one package by hand, and it is not a dependency

```yaml
container:
  image: archlinux:base-devel
```

`pacman -Syu --noconfirm git` — `-Syu` rather than `-Sy` because a partial
upgrade of an Arch image is its own class of failure and has nothing to do with
walltare, and `git` because `actions/checkout` wants it. That is the only
package installed by hand. Everything the app needs has to arrive through
`makepkg --syncdeps` reading `packaging/PKGBUILD`, which is the entire point of
the job: the maintainer's machine has all of it and can never reproduce the
failure.

Then `useradd --create-home builder`, a `NOPASSWD` line in `/etc/sudoers.d`, the
checkout `chown`ed to that user, and `sudo -H -u builder ./install.sh
--noconfirm`. `-H` matters: cargo, bun and makepkg all write under `$HOME`, and
sudo would otherwise leave them pointing at `/root`.

It ends with `pacman -Qi walltare`. The criterion is that the script installs
the app, and pacman is the only thing that can say so.

### What the workflow does not do

No auto-updater and no GPG signing, both settled in the epic: the updater needs
a key that must not be lost and an endpoint that must keep serving, and GPG for
a single-maintainer desktop app buys a signature nobody verifies.

No Rust cache in the `appimage` job. It runs once per tag, in the release
profile, which shares nothing with the debug artifacts `verify.yml` caches, so a
cache here would only ever be written.

## Alternatives rejected

**Set `NO_STRIP=true` on the runner anyway, to match the Arch instructions.** It
would work, and it would be a workaround for a failure this runner does not
have, sitting in the file where the next person reads what the build needs. The
measurement is in the comment beside the build step instead, and the symptom if
Ubuntu ever catches up with Arch is the same `unknown type [0x13]` with the same
one-variable fix.

**Build the artifact in one job, upload it, publish from another.** The usual
shape when several platforms are involved. There is one platform, so it buys an
artifact upload, an artifact download and a second job for nothing.

**`softprops/action-gh-release` instead of `gh`.** A third-party action with a
write token, to run a command the runner already has. `gh release create` is one
line and the failure modes are its own documented ones.

**Make the release depend on the container job passing.** Tempting: nothing gets
published until Arch is proved. It stops an AppImage over a `PKGBUILD` problem
that has nothing to do with it, and adds twenty minutes to every release for a
check the checklist reads off the run anyway.

**Run the Arch container job on every push.** It is the only thing that verifies
the dependency list, so running it more often is not obviously wrong. It is a
full from-source build of Rust, the frontend and WebKitGTK's bindings, and the
push gate is the thing people wait for. The dependency list changes when the
PKGBUILD changes, which is rarely, and a tag is the moment it matters.

**A `workflow_dispatch` trigger so the workflow can be tested without a tag.**
It cannot: GitHub only offers `workflow_dispatch` for workflows on the default
branch, so it would have to be merged before it could be run, which is the
problem it was meant to solve. The rc tags did the proving instead, exactly as
the epic said to.

**Attach the built Arch package to the release too.** The container job builds a
`.pkg.tar.zst` and throwing it away looks wasteful. ADR 0037 rejected shipping a
prebuilt package on purpose: nobody is expected to trust or maintain one, and
the install path being verified is `./install.sh` from a checkout.

## Consequences

**A tag is irreversible in practice.** Deleting a tag and its release works —
`gh release delete <tag> --cleanup-tag`, which is how the throwaway rc came off
the releases page — but only before anybody has downloaded anything. The rc tags
exist for that reason, and the checklist is worked from an rc.

**A release is published with generated notes and then edited.** For a minute or
so, `v1.0.0` will carry a list of merged pull requests instead of the
hand-written notes. The alternative was a draft release, which would mean the
release does not exist until somebody remembers to publish it.

**`pacman -Syu` in the container prints an error and carries on.** The
`archlinux-keyring` hook runs `pacman-key --populate`, the image has no local
signing key, and pacman reports `There is no secret key available to sign with`
followed by `error: command failed to execute correctly`. It is not fatal:
package signature verification uses the trust database the image ships with, and
every later `pacman -S` in the job works. `pacman-key --init` would silence it
at the cost of hand-tuning the container this job exists to keep untouched.

**The container job's failure is a compiler error, and that is correct here.**
`install.sh` names a missing prerequisite before it builds, but a package that is
merely absent from `depends` is not missing from the user's machine in a way the
script can see — it is missing from the list makepkg installs. Removing
`webkit2gtk-4.1` from `depends` fails in `javascriptcore-rs-sys`'s build script
with `Package javascriptcoregtk-4.1 was not found in the pkg-config search
path`, which is the failure the whole job exists to produce, on a machine that
is not the maintainer's.
