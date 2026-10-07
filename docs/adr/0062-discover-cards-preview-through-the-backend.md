# ADR 0062: Discover's cards preview through the backend

**Status:** Accepted
**Amends:** [ADR 0055](0055-discover-previews-the-full-file.md),
[ADR 0053](0053-discover-thumbnails-load-straight-from-wallhaven.md)
**Date:** 2026-10-08

## Context

At three columns and fewer a Discover card is drawn wider than Wallhaven's
432-pixel `lg`, so [ADR 0055](0055-discover-previews-the-full-file.md)'s
amendments had each card fetch the full file from `w.wallhaven.cc`. Wallhaven
serves nothing in between: `small` and `original` are 300 pixels wide, `lg` is
432, and the next size is the file.

What that cost, measured on three live searches of 24 Results: 84–100 MB a
page, 3.5–4.1 MB a file on average and 17 MB at most. On top of the network:

- **Decoded memory in the webview.** Each card decoded a 4K–8K file, 33–133 MB
  while it lasted. Kept as `<img>`s, a page ran WebKitGTK out of graphics
  memory, and the second amendment answered that with a canvas the card's size,
  drawn one card at a time (`SharpPicture`). So the last card on a page
  sharpened seconds after the first, and a wider card had to fetch the file
  again to draw it again.
- **Disk outside the app's control.** Every file sat in `WebKitCache/` for
  30 days, which Settings' Clear cache never touches: gigabytes after a few
  sessions of browsing.

## Decision

**A card's sharp picture is a preview the backend makes**: the Result's full
file at a `medium`'s 1920 pixels, the same JPEG a Library card lays over its
`small`. It is served over a second custom scheme,
`preview://localhost/result/<id>`, and `img-src` gains `preview:`.

**The webview names a Result by its Wallhaven id, and nothing else.** The
backend finds the full file's URL in what `Wallhaven` served, as a download
does, so the webview never chooses what the backend fetches
([ADR 0054](0054-the-backend-refuses-what-wallhaven-would-ignore.md)). The id is
checked as lowercase letters and digits before anything sees it, because it
also names a file in the cache. An id no search served is a 404, unless its
preview is already on disk.

**It reuses what the backend already has**:

- The image host's client and its size-checked transfer are the download
  queue's: no key, no redirects, a wait between reads.
- The decode is a library source's, so
  [ADR 0049](0049-a-source-decode-is-capped-and-large-ones-take-turns.md)'s
  cap and gate hold for a file off Wallhaven.
- Identical requests share one fetch through `serving`'s flight table, now
  keyed on whatever a request names.

**Previews have a pool of their own**: four threads, newest request first as in
[ADR 0040](0040-a-thumbnail-is-served-newest-first.md). A fetch blocks on the
network for seconds. On `serving`'s pool, that would hold up every Library
thumbnail behind it, which is why
[ADR 0053](0053-discover-thumbnails-load-straight-from-wallhaven.md) turned the
proxy down.

**The previews live in `previews/` beside `thumbnails/`, capped at 512 MiB.**
When a write takes the cache past the cap, the least recently used previews
go until it is under three quarters of it. A read counts as a use. Unlike the
thumbnail cache, nothing the curator owns bounds it: every page of every search
adds to it. So it needs an eviction rule, and the pre-generation pass that rule
would fight in the thumbnail cache ([ADR 0012](0012-thumbnail-pre-generation.md))
does not exist here.

**The card still draws onto a canvas at its own size**, as ADR 0055's second
amendment has it, but from the preview rather than the full file. A plain
`<img>` of the preview was tried first, as a Library card lays its `medium`,
and a page of 24 cards holding 8 MB each still flickered on hover. So the
`<img>` only fetches, the canvas holds the card's pixels, and the draws take
turns. A turn is now a 1920-pixel decode, not a 4K or 8K one, and a card that
grows draws again from the preview cache rather than from Wallhaven. At four
and five columns the card still shows only the `lg`, because every preview is
still a full file fetched.

**The lightbox is unchanged.** It still loads the full file from
`w.wallhaven.cc`, so `img-src` keeps that origin. ADR 0055's "Only the lightbox
loads it" holds again.

## Considered options

- **Keep fetching in the webview.** Nothing to build. But each turn stays a
  4K–8K decode, each redraw a refetch from Wallhaven, and the WebKit cache
  unbounded.
- **Drop the canvas and show the preview as an `<img>`.** Simpler, and what a
  Library card does. It flickered: see above.
- **Load the full file only for the card under the cursor.** It saves the
  network as well, which this decision does not. But the grid stays blurred,
  which is the problem ADR 0055's first amendment fixed.
- **Resize in the webview with `createImageBitmap`.** It needs `fetch`, so
  `connect-src` would have to allow `w.wallhaven.cc`. That is the one
  directive ADR 0055 relies on to keep a script from reading a full file.
- **Several preview widths, or one matched to the card.** 1920 covers a
  two-column card on a HiDPI screen, and it is the size the decode, the
  encode and the Library card already use. More widths are more cache keys
  for a sharpness nobody would see.

## Consequences

**The network costs what it did.** The backend still fetches each card's full
file once. What changes is that it happens once per Result for as long as its
preview stays cached, rather than whenever WebKit's cache misses.

**The webview decodes a 1920-pixel JPEG per card**, about 8 MB while it is
drawn, rather than 33–133 MB, and then holds only the canvas.

**The heavy decodes happen in the backend**, four at a time. The webview's
turns are short, so a page's cards sharpen about as fast as their files land.

**Settings doesn't show or clear the previews.** The Thumbnails line counts
the thumbnail cache, and its Clear rebuilds what the pass owes. Previews are
neither: they are bounded by their own cap. Showing them there is a follow-up,
should anyone want to read the number.

**A download still fetches the file a second time.** The preview keeps only
the 1920-pixel JPEG, not the file, so the download queue fetches it again, as
it did after ADR 0055.
