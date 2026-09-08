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

## The venue, and the order to work in

A clean Arch virtual machine, one that has never had a compiler on it. A second
account on the maintainer's machine is not a substitute: it shares the system
libraries, so it proves almost nothing about what the build needs.

The VM has no NVIDIA driver, and that is the split. The VM is what proves no
system library is missing and that a first run makes sense. The host is the only
place the launcher's `__NV_DISABLE_EXPLICIT_SYNC=1` can be shown to do anything,
so the two items that need the driver are marked **host** and are run there,
after the VM is done.

Every section carries a **Where** line. Snapshot the VM before installing
anything, then work in this order.

1. **Arch pass, in the VM.** Packaging and installation, down to the uninstall.
   Then Launch environment, Content security policy, and the three app sections,
   against the installed package.
2. **Restore the snapshot.** The Arch pass leaves a compiler, the WebKitGTK
   headers and every other build dependency on the machine, and an AppImage that
   runs beside those has not been tested for the one thing it promises.
3. **AppImage pass, in the VM.** The release artifact and its checksums, then
   Content security policy and the three app sections again, against the AppImage
   downloaded from the releases page.
4. **Host pass.** The two **host** items in Launch environment, and nothing else.

One item wants a venue of its own: "The downloaded AppImage runs on a
distribution that is not the build host" needs Ubuntu or Fedora, so it takes a
second VM or a live USB. The restored Arch snapshot covers the half of that
about build dependencies and not the half about another distribution's
libraries.

## Packaging and installation

**Build under test:** the Arch package, installed with `./install.sh` from a
clean clone. Nothing here is exercised by a dev run or by CI's push gate: the
one machine check is the `archlinux:base-devel` container job on a tag
([#207](https://github.com/QuantumFF/walltare/issues/207)), and it proves the
dependency list rather than the installed app. See
[ADR 0037](adr/0037-the-arch-install-builds-the-checkout.md).

**Where:** the VM, Arch pass.

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

**Where:** the VM for the menu entry and the two `environ` reads, the host for
the two items marked **host**. Only the host has the driver the launcher's one
variable is there for.

- [ ] **walltare is in the application menu, under its own icon.** Search the
      menu for "walltare". The entry appears, with the two-panel icon and not a
      generic placeholder, and clicking it starts the app.
- [ ] **Host. It launches on NVIDIA under Wayland with nothing exported.** This
      needs the hardware; there is no substitute for it, and the VM has no
      NVIDIA driver. A pass is a window that paints its content. A blank, black
      or flickering window is the failure the launcher's
      `__NV_DISABLE_EXPLICIT_SYNC=1` is there to prevent.
- [ ] **Host. Whether the variable is still needed is written down, either
      way.** Run `__NV_DISABLE_EXPLICIT_SYNC=0 walltare` on the NVIDIA Wayland
      session and record what happened in the release issue, beside the driver
      version from
      `nvidia-smi --query-gpu=driver_version --format=csv,noheader`. A window
      that paints means the driver caught up and a later release can drop the
      launcher's default; a blank or flickering one means it is still holding
      the app up. Either answer is a pass. Not knowing is the failure, because
      then nobody can ever remove the workaround.
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

**Where:** the VM, both passes. The installed package and the AppImage are two
different bundles, and the policy travels with the bundle.

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

## The release artifact and its checksums

**Build under test:** the two files the release workflow attached to the tag,
downloaded from the releases page onto a machine that did not build them.
Downloaded, not copied out of `src-tauri/target/`: a checksum file that only
verifies in the build tree verifies nothing. See
[ADR 0038](adr/0038-the-release-is-one-tag-triggered-workflow.md).

**Where:** the VM, AppImage pass, on the restored snapshot. The last item wants
Ubuntu or Fedora instead.

The workflow already refuses a tag whose version disagrees with
`src-tauri/Cargo.toml`, refuses a bundle directory holding anything but one
AppImage, and checks its own checksum file before it uploads. What is left here
is everything that can only be seen from the far end: that the release page
carries what it should, and that the file a stranger downloads is the file that
was built.

- [ ] **The release carries two assets and nothing else.**
      `gh release view <tag> --json assets --jq '.assets[].name'` lists exactly
      `walltare_<version>_amd64.AppImage` and `sha256sums.txt`. One missing
      means the upload half-finished; a third one was attached by hand and
      nothing in the release notes accounts for it.
- [ ] **The AppImage filename carries the version in
      `src-tauri/Cargo.toml`.** For this release, `walltare_1.0.0_amd64.AppImage`.
      A name and a manifest that disagree mean the tag was built from a
      different commit than the one being shipped.
- [ ] **The checksums verify in the directory they were downloaded into.**
      In an empty directory: `gh release download <tag>`, then
      `sha256sum -c sha256sums.txt`. A pass is one `... AppImage: OK` line and
      exit status 0. Run it somewhere that is not the checkout — this is the
      check that the file holds a bare filename rather than a build path.
- [ ] **A prerelease is marked as one, and the release is not.**
      `gh release view <tag> --json isPrerelease` says `true` for an `-rcN` tag
      and `false` for `v1.0.0`. An rc that presents itself as the release is the
      failure this flag exists to prevent, and the releases page shows the
      latest non-prerelease as the download.
- [ ] **The downloaded AppImage runs on a distribution that is not the build
      host.** `chmod +x` it and run it on Ubuntu or Fedora, not on the Arch
      machine that has every build dependency installed. A window paints and all
      four views open. A missing shared library here means linuxdeploy did not
      bundle something the binary asks for, and the AppImage's whole promise is
      that there is nothing to install.
- [ ] **The Arch container job on the tag is green.**
      `gh run view <run-id>` for the tag's `release` run: the
      `install.sh on clean arch` job succeeded. It is the only thing in the
      project that proves `packaging/PKGBUILD` names every package the build
      needs, because the maintainer's machine already has them all. A red job
      here is a release that Arch users cannot build, whatever the AppImage
      does.

## A first run, and the scan behind it

**Build under test:** the installed package on the Arch pass, the downloaded
AppImage on the AppImage pass. Both, because this is where the app meets a real
filesystem and a real data directory, and a dev run has neither: Vite serves the
document and the checkout sits beside it.

**Where:** the VM, both passes.

Move any `~/.local/share/com.quantumff.walltare` aside before starting, or the
first item is not a first run.

- [ ] **A first run reads as an invitation.** The app opens on Settings under
      **Choose a Library root**, with one line saying walltare ranks the
      wallpapers you already have and one saying what a Library root is. The
      Library root section sits under that block and the other four sections are
      not there yet. Nothing on screen is a configuration field with a blank in
      it. See [ADR 0033](adr/0033-a-first-run-is-the-invitation.md).
- [ ] **A Written path is accepted with a `~` in it, and shown resolved.** Type
      `~/wallpapers` into the Library root and leave the field. The line under it
      prints the absolute path it resolved to. Point the field at a folder that
      does not exist and the same line appends `folder not found`, in the ordinary
      colour rather than red: a Library root is a stated preference, and an
      unmounted drive is the usual reason one goes missing. See
      [ADR 0011](adr/0011-written-paths.md).
- [ ] **A hostile folder does not stop the scan.** Build one, from a real JPEG
      and a real PNG:

      ```sh
      mkdir -p ~/hostile/deep ~/hostile/locked
      cp real.jpg ~/hostile/good.jpg
      cp real.png ~/hostile/deep/deeper.png
      cp real.jpg ~/hostile/locked/hidden.jpg
      touch ~/hostile/empty.jpg
      head -c 40 real.png > ~/hostile/half.png
      cp anything.avif ~/hostile/
      chmod 000 ~/hostile/locked
      ```

      Scan it. The scan finishes and says `4 wallpapers added`: `good.jpg`,
      `deep/deeper.png`, `empty.jpg` and `half.png`. The walk reads names and
      never bytes, so the two broken files become Wallpapers like any others. The
      AVIF is not among them, because a scan takes four extensions and that is
      not one of them, and neither is anything under `locked`. A scan that stops
      at the locked folder is the failure. See
      [ADR 0034](adr/0034-a-hostile-library-root.md).
- [ ] **The two undecodable files read as gone, and the good ones paint.** In
      Library, `empty.jpg` and `half.png` show **File is gone** while `good.jpg`
      and `deeper.png` show pictures. Scan again: nothing is added, and the two
      failures are not decoded a second time, because the first pass wrote them
      down against the file's mtime.
- [ ] **A reject destination that cannot take a file is refused before one
      moves.** Make one that refuses:
      `sudo mkdir /rejects && sudo chmod 555 /rejects`. Put it in the Settings
      field. The line under the field says the folder cannot be written to,
      before anything has been rejected. Then reject a wallpaper anyway: the
      toast says the same sentence, the card stays as it was, and `ls ~/hostile`
      shows the file still there. Point the destination back at something
      ordinary afterwards. See
      [ADR 0035](adr/0035-a-reject-destination-is-checked-first.md).

## Voting, Review, and the two transitions

**Build under test:** the same two builds, with the hostile library above scanned
and a handful of real wallpapers in it.

**Where:** the VM, both passes.

- [ ] **A vote lands by click and by arrow key.** On Rank, click a wallpaper: a
      new pair appears. Then vote with `←` and `→` for the left and the right
      one. Ten votes in, the progress headline has moved. Which side a wallpaper
      appears on carries no meaning and the order is random, so a pair that
      repeats itself mirrored is not a bug.
- [ ] **Review is ordered worst first.** Open Review after those votes. The bar
      says **Lowest Scores first**, and it is telling the truth: the Score badges
      on the cards do not go down as you read across the grid. Only Active
      wallpapers are here, so a Kept or Rejected one appearing is the failure.
      See [ADR 0013](adr/0013-review-orders-by-mu.md).
- [ ] **A Soft reject moves the file, and a Restore brings it back.** Reject a
      wallpaper from Review. The file is in the reject destination and gone from
      its own folder, both by `ls`, and the card reads Rejected. Restore it from
      Library, which is where a Rejected card offers it: the file is back at its
      Origin, and the wallpaper is Active rather than Kept,
      because changing your mind about a reject is not a judgement about a
      rating. See [ADR 0009](adr/0009-reject-is-reversible.md).
- [ ] **A Keep, and an un-keep.** Select the first card in Review and press `K`.
      It leaves the list, because a Kept wallpaper never appears in Review, and
      it is still in the voting pool. Press `K` again on it in Library and it is
      Active, and back in Review on the next fetch.
- [ ] **A file deleted outside the app reads as gone, and Settings counts it.**
      With the app running, `mv ~/hostile/good.jpg ~/elsewhere/`. Its card reads
      **File is gone**, and the lightbox adds that it was moved or deleted
      outside walltare and nothing here has changed. Settings, Missing files,
      press the button: `1 file missing`, against a count of the Active and Kept
      wallpapers it walked. Move the file back and press again: `No files
      missing`. Nothing on that section offers to delete the row, deliberately,
      because the row holds Comparisons. See
      [ADR 0032](adr/0032-a-missing-file-reads-as-gone.md).

## The library on disk

**Build under test:** the same two builds. Everything here is about what the app
leaves behind, so it runs after the sections above have put something in the
database.

**Where:** the VM, both passes.

- [ ] **The database and the thumbnail cache are where the README says.**
      `ls -a ~/.local/share/com.quantumff.walltare` holds `walltare.db` and
      `thumbnails/` and nothing else. The only other thing walltare writes is
      `.window-state.json` under `~/.config/com.quantumff.walltare`, which is the
      window geometry and holds nothing about the library. Nothing under
      `~/.cache`: map #1 recorded the thumbnails there and the README is the one
      that was right.
- [ ] **Everything survives a restart.** Note the progress headline, one Kept
      wallpaper, one Rejected one, the theme, the Library root and the reject
      destination. Quit and reopen. All six are as they were, and the window
      comes back the size and place you left it.
- [ ] **The thumbnail cache regenerates after you delete it.** Read the size off
      the Settings Thumbnails line. Quit, then
      `rm -rf ~/.local/share/com.quantumff.walltare/thumbnails`, then reopen:
      Library paints its cards, and the Thumbnails line climbs back up as they
      generate. The in-app route is the Clear cache button on that section, which
      leaves the line reading `Nothing cached yet` until the next card asks for a
      thumbnail. Deleting the cache must never cost a Comparison.
- [ ] **A database from the future is refused, legibly.** Back the database up
      first, because this writes to the file holding every Comparison. With the
      app closed, and `sqlite` installed if it is not there already:

      ```sh
      cd ~/.local/share/com.quantumff.walltare
      cp walltare.db walltare.db.bak
      sqlite3 walltare.db 'PRAGMA user_version = 99'
      ```

      Launch from the application menu, not from a terminal, since a log line is
      invisible to somebody who launched from a menu and that is the whole reason
      this is a dialog. A native error dialog appears, titled **walltare cannot
      open this library**, naming schema version 99 against the version this
      build understands, and saying nothing has been changed. There is no app
      window behind it, and dismissing it ends the process. The number it should
      name for this build is `SCHEMA_VERSION` in `src-tauri/src/db.rs`, which is
      3 for this release.

      Then `mv walltare.db.bak walltare.db` and launch again: the library opens
      with every Comparison in it. See
      [ADR 0005](adr/0005-schema-migrations.md).

<!--
A new section keeps the shape: a level-two heading, a **Build under test** line,
a **Where** line, then checkboxes that each say what to do and what a pass looks
like.
-->
