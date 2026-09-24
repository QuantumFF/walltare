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

**The frontend spells the full file's URL itself**, from the result's id and
`file_type`: `w.wallhaven.cc/full/<first two>/wallhaven-<id>.<png or jpg>`.
The `path` stays off the wire, as ADR 0054 has it. A `file_type` that isn't
PNG is taken for a JPEG, and if that guess is wrong the full file fails to
load and the lightbox shows its "Couldn't load preview" panel.

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

> **Amended 2026-09-24.** Cards touch `w.` too now, at three columns and
> fewer. There a card is drawn wider than the `lg`'s 432 pixels on most
> screens, so the thumbnail is upscaled into a blur. The card lays the full
> file over its `lg` and shows it once it has loaded, the way a Library card
> lays its `medium` over its `small`. At four and five columns the grid stays
> on `lg` alone. Discover opens on three, so a page of 24 fetches up to
> 24 full files as its cards come into view (`loading="lazy"`), which is
> 1–10 MB each. That's accepted in exchange for cards that show the detail
> the page exists to judge. The "Only the lightbox loads it" decision and the
> first consequence above are superseded to that extent.

> **Amended 2026-09-24, again.** A card doesn't keep the full file as an
> `<img>`. Kept that way, each card held its file decoded at full size, 33 MB
> for 4K and 133 MB for 8K. A page of 24 ran WebKitGTK out of graphics memory.
> It showed at two and three columns as cards flickering, a card briefly
> drawing another card's picture, and pictures drawn between rows while the
> mouse moved. So the `<img>` now only fetches the file and is never painted.
> Once it has loaded, the file is decoded and drawn onto a canvas at the card's
> size in device pixels, cropped as `object-cover` would, and the `<img>`
> unmounts, as it also does when the fetch or the draw fails. Cards decode one
> at a time. A shown card that settles more than 10% wider than it was drawn
> at, from three columns to two, fetches the file and draws it again. That
> fetch usually comes from WebKit's cache, but nothing guarantees it. A card
> hidden at four and five columns never refetches.
