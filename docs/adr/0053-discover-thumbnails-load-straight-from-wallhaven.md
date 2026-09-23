# ADR 0053: Discover thumbnails load straight from Wallhaven

**Status:** Accepted
**Ticket:** [#323](https://github.com/QuantumFF/walltare/issues/323), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

Discover shows Wallhaven search results as a grid of thumbnails from
`th.wallhaven.cc`. [ADR 0036](0036-the-content-security-policy.md)'s policy
allows no remote origin, and its test fails on any source outside five local
spellings. That ADR said a remote wallpaper source "is a decision that has to
come back through this file". This is that decision.

The research for [#319](https://github.com/QuantumFF/walltare/issues/319) found
two routes that both work on WebKitGTK:

- **Widen the policy** so an `<img>` loads the thumbnail directly.
- **Proxy it through the backend** over a custom protocol, keeping the policy
  local.

Neither route leaks anything the other doesn't. A `tauri://` document sends no
`Referer`, no `Origin` and no cookies. Thumbnails need no key, NSFW included
([ADR 0052](0052-the-wallhaven-key-is-a-write-only-setting.md)). Either way,
Wallhaven sees the user's IP and which thumbnails were viewed.

## Decision

**`img-src` gains `https://th.wallhaven.cc`, and nothing else.** The policy
becomes `img-src 'self' wallpaper: https://th.wallhaven.cc`.
`the_policy_names_no_remote_origin` becomes an allowlist of five local sources
plus this one origin, still an exact match, so a seventh source still has to be
argued for in the test.

**`connect-src` stays local.** API calls and downloads go through the backend,
so the webview never talks to Wallhaven except through `<img>`. `th.` sends no
CORS headers anyway, so a script couldn't read a thumbnail's pixels even if it
fetched one.

**A card handles its own load failure.** A failed Wallhaven thumbnail is a
network fact, not a missing file, so Discover's cards must not reuse
[ADR 0032](0032-a-missing-file-reads-as-gone.md)'s "gone" panel for it. How the
failure looks is the Discover page's decision.

**A full-size preview is not covered.** If the Discover page decides to show
full files from `w.wallhaven.cc`, adding that origin is its own amendment to
this ADR.

**The release checklist gains a Discover line.** Thumbnails render on Discover
in a release build, and the console shows no violations there. The policy still
doesn't apply under `bun tauri dev`.

## Considered options

- **A backend proxy on a new scheme.** It keeps ADR 0036 intact. But the
  research found nothing to reuse: `serving.rs`'s keys, grammar and
  `ThumbnailCache` are all `(i64, Size)` over local files, and `ImageWorkers`'
  decode threads would be starved by blocking fetches. So it means a second
  protocol handler, an HTTP fetch inside it, and a cache. By the deletion test,
  the one thing it buys is control over caching, and privacy is the same either
  way.
- **Also allowing `w.wallhaven.cc` now.** Nothing needs it yet. A source in the
  policy that no build exercises is exactly what ADR 0036 refused to carry.

## Consequences

**WebKit caches Discover thumbnails, outside the app's control.** `th.` sends
`max-age=2592000`, so thumbnails sit in
`~/.local/share/com.quantumff.walltare/WebKitCache/` for up to 30 days, NSFW
ones included. Settings' Clear cache doesn't touch that directory. It is
accepted: the cache holds 300-pixel previews of public images the user chose to
look at.

**The webview can now reach the internet.** It can do so only through `<img>`,
and only to one host.

> **Amended by [ADR 0055](0055-discover-previews-the-full-file.md),
> 2026-09-24.** The full-size preview came back: `img-src` also gains
> `https://w.wallhaven.cc`, for Discover's lightbox only. Cards keep `th.`.
