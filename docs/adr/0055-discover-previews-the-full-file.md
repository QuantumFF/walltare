# ADR 0055: Discover's lightbox previews the full file from Wallhaven

**Status:** Accepted
**Ticket:** [#324](https://github.com/QuantumFF/walltare/issues/324), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

The Discover page opens a result in a lightbox shaped like Library's
([ADR 0022](0022-lightbox-shares-the-selection.md)): the picture with a button
row under it. Wallhaven's thumbnails top out at 432×243 (`lg`). The other two
are 300 pixels wide. A lightbox that fills the window with a 432-pixel image
upscaled shows nothing the card didn't. The page exists to decide whether a
4K wallpaper is worth downloading, and that's a question about detail.

[ADR 0053](0053-discover-thumbnails-load-straight-from-wallhaven.md) allowed
`th.wallhaven.cc` and nothing else, and it said a full-size preview from
`w.wallhaven.cc` would be its own amendment. The prototype on the
`prototype/discover-page` branch tried both options: loading the full file on
open, and loading it only when asked (`F`).

## Decision

**`img-src` gains `https://w.wallhaven.cc`.** The policy becomes
`img-src 'self' wallpaper: https://th.wallhaven.cc https://w.wallhaven.cc`.
The allowlist test gains this origin as an exact match, as it did for `th.`.
`connect-src` stays local. That matters more here than it did for `th.`:
`w.` answers `Access-Control-Allow-Origin: *`, so the local `connect-src` is
the only thing stopping a script from reading a full file.

**The lightbox loads the full file as soon as a result is opened.** The card's
`lg` thumbnail is drawn underneath, scaled to the file's own Dimensions, until
the full file has loaded. This is ADR 0022's never-blank rule, with Wallhaven's
two sizes in place of `small` and `medium`. Nothing is prefetched. Stepping
with `←/→` loads only the result stepped to.

**Only the lightbox loads it.** Cards keep `lg`, and the grid never touches
`w.`.

**It carries no key.** Full files load without auth, NSFW included
([ADR 0052](0052-the-wallhaven-key-is-a-write-only-setting.md)).

## Considered options

- **Load the full file only on request.** Nothing loads that nobody asked for.
  But the one screen whose job is showing detail would open on a blur, and
  nearly everyone who opens it wants the detail.
- **Proxy the full file through the backend.** It has the same privacy cost as
  loading it directly, which is what ADR 0053 found for thumbnails. It would
  also pull a 1–10 MB transfer through IPC for a picture the webview can
  fetch itself.
- **No full-size preview.** The lightbox would then add nothing over the card,
  and the page might as well have none.

## Consequences

**Opening a result costs 1–10 MB.** A curator walking the lightbox with `→`
downloads every file they step past, in full. That's accepted: it happens
only in the lightbox, and only for results the curator opened.

**WebKit caches full files outside the app's control.** This is ADR 0053's
consequence, at full size. `w.` sends `max-age=2592000` too, so full files sit in
`~/.local/share/com.quantumff.walltare/WebKitCache/` for up to 30 days, and
that is megabytes per result opened, not kilobytes. Settings' Clear cache doesn't touch that
directory.

**A download is a second transfer of a file the lightbox already showed.**
The backend downloads it over its own client (ADR 0054), and never from the
webview's cache.

**The release checklist's Discover line covers the lightbox too.** Full files
render in a release build, and the console shows no violations.
