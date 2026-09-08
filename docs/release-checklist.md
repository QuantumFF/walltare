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

- Launch environment — #206, which writes the launcher that sets
  `__NV_DISABLE_EXPLICIT_SYNC=1`. The NVIDIA-under-Wayland path is the epic's
  other item with no automated test, and it needs the driver.
- Packaging and installation — #206
- The release artifact and its checksums — #207
- The release itself — #208
-->
