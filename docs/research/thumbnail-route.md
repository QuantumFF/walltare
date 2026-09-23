# Research: Thumbnail route, CSP versus backend proxy

**Ticket:** [QuantumFF/walltare#319](https://github.com/QuantumFF/walltare/issues/319)
(part of map [#317](https://github.com/QuantumFF/walltare/issues/317))
**Date:** 2026-09-24

## Question

How should Discover's search-result thumbnails reach the webview? There are two
routes:

- **CSP route.** Widen `img-src` to `https://th.wallhaven.cc`, and let `<img>`
  load the URLs the API returns.
- **Proxy route.** The Rust backend fetches the thumbnail and answers it over a
  custom protocol, either `wallpaper://` through `serving.rs` or a sibling
  scheme.

This file lays out facts and trade-offs. It doesn't make the decision.

Evidence tags:

- **[Source]**: read from code, meaning this repo, `tauri` 2.11.5,
  `tauri-runtime-wry` 2.11.4, `wry` 0.55.1 (the versions in `Cargo.lock`) or
  WebKit `main`.
- **[Doc]**: official documentation.
- **[Live]**: `curl` against Wallhaven, 2026-09-23/24.
- **[Probe]**: an offscreen WebKitGTK 2.52.6 harness, described in
  [Appendix](#appendix-the-webkitgtk-probe).

## Findings (TL;DR)

1. **ADR 0036 forbids the CSP route as written, and says so on purpose.** The
   policy is `img-src 'self' wallpaper:`. `the_policy_names_no_remote_origin`
   fails on any source outside five local spellings. The ADR says a "remote
   wallpaper source" is "a decision that has to come back through this file".
   The CSP route therefore means a superseding ADR plus an edit to that test.
   The proxy route leaves the policy and both tests untouched if it rides
   `wallpaper:`. A new scheme would add one local source, such as `wallhaven:`,
   to `img-src` and to the test's allowlist.
2. **WebKitGTK loads the remote image once the CSP names the host, and blocks it
   with a console violation otherwise [Probe].** The `tauri://` document is a
   secure context, because wry registers the scheme as secure, so an `https:`
   thumbnail isn't mixed content. There is no Tauri-side obstacle beyond the
   policy string.
3. **The CSP route sends no `Referer` and no `Origin`, with no configuration
   needed [Probe, Source].** WebKit's `generateReferrerHeader` returns nothing
   when the referrer isn't http(s), and `tauri://localhost` isn't. Wallhaven
   doesn't check the referrer anyway [Live]. The request carries WebKit's
   Safari-style User-Agent, `Accept` and `Sec-Fetch-*: image / no-cors /
   cross-site`, and no cookies. Either route exposes the user's IP and which
   thumbnails they viewed to Wallhaven and Cloudflare. **Privacy differs by
   headers, not by who learns what.**
4. **The CSP route caches thumbnails to disk in WebKit's HTTP cache.**
   `th.wallhaven.cc` sends `cache-control: public, max-age=2592000` (30 days)
   [Live]. Tauri points WebKit's cache at
   `~/.local/share/com.quantumff.walltare/` on Linux [Source], and that
   directory already holds a `WebKitCache/`. Everything browsed in Discover,
   including anything NSFW, would persist there for up to 30 days, outside the
   app's own "clear cache". The proxy route decides its own caching.
5. **The proxy's cost is mostly engineering, not latency.** A thumbnail is
   about 20 KB and takes a median of about 50 ms from here (10 ms RTT, Cloudflare
   HIT) [Live]. The local hop is small next to that. What `serving.rs` offers is
   the pattern: an async responder, `InFlight` dedup, newest-first ordering and
   an in-memory cache. The types don't fit as they are. The URL grammar,
   `InFlight`'s key and `ThumbnailCache` are all keyed on an `i64` wallpaper id
   plus a `Size`, and a Wallhaven id is a six-character string. `ImageWorkers` is
   2–8 CPU threads, sized for decodes. A blocking network fetch parked on them
   would delay local thumbnails. The proxy route also needs an HTTP client crate,
   but #317 already routes API calls and downloads through Rust, so that client
   arrives either way.
6. **Failure reads differently.** Under the proxy route, a network error comes
   back as a `wallpaper://` error. The frontend paints it with the same "gone"
   panel ADR 0032 built for a missing file, which is the misdiagnosis ADR 0036
   warned about, unless Discover's cards handle errors their own way. Under the
   CSP route, a forgotten or wrong policy entry is invisible in `bun tauri dev`,
   because the CSP isn't applied there. It only shows in a release build, so it
   needs a release-checklist item.
7. **The API key breaks neither route as far as can be verified, but NSFW
   thumbnail auth is unverified.** Thumbnail URLs are keyless static paths
   (`th.wallhaven.cc/{small|lg|orig}/<id[0..2]>/<id>.jpg`) for every purity
   seen. The key is documented only for `wallhaven.cc/api` [Doc]. No NSFW id is
   reachable without a key. Anonymous `purity=001` returns `total: 0` [Live].
   One suggestive data point: id `6le2y7` answers "Nothing here" to a guest on
   both the API and the web page, yet its thumbnail is served anonymously
   [Live]. Its purity is unknown. **One `curl -I` of an NSFW thumbnail, with the
   id found using a key, settles it.** If NSFW thumbs turned out to be gated,
   it would be by a cookie or session, not the API key, and neither route has
   one. The proxy route could add `X-API-Key`, but nothing says the CDN honours
   it.
8. **`th.wallhaven.cc` isn't CORS-open [Live].** It sends no
   `access-control-allow-origin`, and `OPTIONS` returns 405. `w.wallhaven.cc`
   does send `*`. That doesn't matter for a plain `<img>`. It does matter for
   anything that reads pixels or bytes in JS under the CSP route: a `fetch()`
   of the image, a `<canvas>` read, or `<img crossorigin>`. That corrects the
   "static, CORS-open CDNs" line in
   [`wallhaven-api.md`](https://github.com/QuantumFF/walltare/blob/research/wallhaven-api/docs/research/wallhaven-api.md),
   which holds for the file host only.

## 1. What ADR 0036 and the current policy permit

- The policy [Source: `src-tauri/tauri.conf.json`]: `default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self';
  img-src 'self' wallpaper:; connect-src 'self' ipc:; object-src 'none';
  base-uri 'self'; form-action 'none'; frame-src 'none'`.
- `img-src 'self' wallpaper:`. A bare `wallpaper:` source matches any authority,
  which is why `wallpaper://localhost/...` passes (ADR 0036).
- Two tests read the shipped config [Source: `src-tauri/src/lib.rs`]:
  - `the_policy_lets_the_wallpaper_protocol_through` asserts `img-src` carries
    `wallpaper:`.
  - `the_policy_names_no_remote_origin` is an allowlist of `'self'`, `'none'`,
    `'unsafe-inline'`, `ipc:` and `wallpaper:`. Its comment says widening "has
    to be argued for here as well as in the config".
- The ADR's closing consequence: "a feature that needs the network — an update
  check, telemetry, a remote wallpaper source — is a decision that has to come
  back through this file. The epic rules all three out for 1.0.0." Discover is
  that decision arriving.
- What each route changes:

  | | CSP route | Proxy via `wallpaper:` | Proxy via new scheme |
  |---|---|---|---|
  | `tauri.conf.json` | `img-src` gains `https://th.wallhaven.cc` | unchanged | `img-src` gains e.g. `wallhaven:` |
  | `the_policy_names_no_remote_origin` | must admit a remote origin | unchanged | allowlist gains one local scheme |
  | ADR 0036 | superseded or amended | untouched | amended (new local source) |
  | Release checklist CSP section | needs a Discover item | unchanged | needs a Discover item |
  | `connect-src` | unchanged (`<img>` is governed by `img-src`) | unchanged | unchanged |

- Tauri contributes no origins of its own. `manager::set_csp` only merges nonces
  and hashes (ADR 0036, read from `tauri` 2.11.5). Whatever goes in
  `tauri.conf.json` is the whole list. Tauri's CSP guide says: "Avoid loading
  remote content such as scripts served over a CDN as they introduce an attack
  vector" [Doc: <https://v2.tauri.app/security/csp/>]. It addresses scripts,
  not images.
- **Dev versus release.** On desktop the CSP isn't delivered under
  `bun tauri dev`, because the document comes from Vite at
  `http://localhost:1420` (ADR 0036, `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`).
  Under the CSP route, Discover's thumbnails would load in dev whether or not
  the policy lists the host. The first build that can fail is a release build.
  The proxy route behaves the same in both.

## 2. How Tauri 2 on WebKitGTK treats a remote `img-src`

- **The document is a secure context.** wry's `register_uri_scheme` calls
  `security_manager().register_uri_scheme_as_secure(name)` for every custom
  protocol, including `tauri` [Source: `wry-0.55.1/src/webkitgtk/web_context.rs`
  ~L136–142]. In the probe, `window.isSecureContext === true` and
  `location.origin === "tauri://localhost"` [Probe]. An `https:` image is
  therefore not mixed content, and an `http:` one would be.
- **The CSP arrives as a response header** on the `tauri://` document
  [Source: `tauri-2.11.5/src/protocol/tauri.rs` L182–183]. The probe served its
  document the same way.
- **Results under the shipped policy** (probe, WebKitGTK 2.52.6; the only change
  was `'unsafe-inline'` in `script-src` so the probe could report):
  - Current policy: `https://th.wallhaven.cc/small/qr/qrow67.jpg` fires `error`.
    `securitypolicyviolation` reports `img-src https://th.wallhaven.cc/...`, and
    the request never reaches the network.
  - `img-src 'self' wallpaper: https://th.wallhaven.cc`: the image loads at
    300×200 with no violation.
- **Thumbnail formats** are always JPEG. `small` is a 300×200 crop, `lg` a
  432×243 crop, and `orig` keeps the aspect ratio with the long side at 300
  ([`wallhaven-api.md`](https://github.com/QuantumFF/walltare/blob/research/wallhaven-api/docs/research/wallhaven-api.md),
  [#318](https://github.com/QuantumFF/walltare/issues/318)). WebKitGTK decodes
  JPEG natively. The Rust `image` crate is built with `jpeg` too
  [Source: `src-tauri/Cargo.toml`].
- **Decoder exposure is the same either way unless the proxy transcodes.** A
  proxy that passes bytes through still has WebKit decode the remote JPEG. Only
  a proxy that re-encodes through `image`, as the local thumbnail pipeline does,
  keeps remote bytes away from WebKit's decoders. That costs a decode and encode
  per thumbnail on the CPU pool.

## 3. What the proxy route costs

### Latency and bandwidth

| Measurement [Live, from this machine] | Value |
|---|---|
| RTT to `th.wallhaven.cc` (Cloudflare, SIN) | ~10.7 ms |
| One cold connection (DNS+TCP+TLS+TTFB) | ~53 ms |
| 24 `small` thumbs (one results page), sequential, fresh connection each | mean 54 ms, median 51 ms, max 81 ms |
| Mean `small` size | ~20.6 KB |
| CDN cache | `cf-cache-status: HIT` on toplist items |
| Rate limit | none on `th.` (#318: no `X-RateLimit-*`, served during API 429s) |

Either route pays the network round trip. The proxy adds a custom-protocol hop
inside the process: WebKit → wry → the handler → `responder.respond`, which is
marshalled back to the GTK main context through `MainContext::invoke`
[Source: wry `web_context.rs` ~L215]. That hop is what every Library thumbnail
already pays. Nothing here measured it in isolation. ADR 0040 and #224 counted
its parts (channel hop, locks) as costs that matter only for warm local hits.
Next to a 50 ms network fetch, it is small.

With one HTTP client and connection reuse (HTTP/2 to one host), the proxy can
amortise TLS across a page of 24. WebKit does the same on its side.

### Caching

- **CSP route.** WebKit's HTTP cache honours `public, max-age=2592000` and an
  `etag` [Live]. On Linux, Tauri forces the webview's `data_directory` to the
  app's LocalData dir when none is configured
  [Source: `tauri-2.11.5/src/manager/webview.rs` L534–545]. wry uses that
  directory as both `base_cache_directory` and `base_data_directory`
  [Source: wry `web_context.rs` L36–39]. The running app already has
  `~/.local/share/com.quantumff.walltare/WebKitCache/` (5.5 MB today), so
  thumbnails would land there for up to 30 days. It is free. It is also outside
  the app's control: Settings' cache size and clear don't see it, and it
  persists a record of what was browsed.
- **Proxy route.** The backend picks its own policy: memory-only, a disk
  directory beside `thumbnails/`, or none. The `Cache-Control` the backend sets
  on the `wallpaper://` response governs WebKit's side. `serving.rs` uses
  `max-age=300` for success and `max-age=30` for errors. Nothing here checked
  whether WebKit disk-caches custom-scheme responses. The in-app evidence
  (ADR 0016's five minutes, ADR 0040's memory cache) concerns memory reuse.

### Reuse of `serving.rs`

What reuses cleanly [Source: `src-tauri/src/serving.rs`, `lib.rs` L608]:

- `register_asynchronous_uri_scheme_protocol` hands a `UriSchemeResponder` that
  can be answered from any thread later. That fits an async network fetch, and
  Tauri's own docs show it answered from a spawned thread
  [Doc: docs.rs `tauri::Builder::register_asynchronous_uri_scheme_protocol`].
- The **shape** of `InFlight`: two cards asking for the same thumb share one
  fetch. The **ordering idea** of `ImageWorkers` (ADR 0040, newest first): a
  scrolled-past card shouldn't be served ahead of a visible one. The
  memory-hit-on-UI-thread shortcut. The status mapping in `error_response`.

What doesn't reuse as it stands:

- **The grammar.** `parse_image_request` accepts exactly
  `wallpaper://localhost/image/{i64}?size={small|medium|full}`. Anything else is
  a 400. A Wallhaven thumbnail needs a new path, for example
  `/wallhaven/{id}?size=small|lg|orig`, and the grammar is this module's single
  point of truth.
- **The keys.** `Key` is `(i64, Size)`. `ThumbnailCache::remembered`,
  `answer` and the on-disk cache are keyed on a Library wallpaper id and read
  the source file through `Db`. A Wallhaven result isn't a Wallpaper until it's
  downloaded (#317: no staging area), so none of these apply to it directly.
- **The pool.** `ImageWorkers` is `available_parallelism()` clamped to 2–8
  threads (`IMAGE_WORKER_FLOOR` and `IMAGE_WORKER_CEILING`), shared with the
  pre-generation pass. A blocking network read on those threads would hold a
  decode slot for ~50 ms or more, and far longer on a slow link. The natural
  split is async I/O on `tauri::async_runtime`, with the pool used only if the
  proxy transcodes.
- **The error vocabulary.** A network failure has no `AppError` variant today,
  and `_ => 500` would catch it.

### Dependencies

`[dependencies]` has no HTTP client [Source: `src-tauri/Cargo.toml`]. #317
already settles that "API calls and downloads go through the Rust backend", so
a client is coming for the API regardless. The proxy route reuses it rather
than justifying it.

## 4. Privacy and referrer

What a thumbnail request carries under the CSP route [Probe]. These are the
headers the harness's local HTTPS endpoint received from a `tauri://localhost`
document with the widened policy:

```
Accept: image/webp,image/avif,image/jxl,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15
Accept-Encoding: gzip, deflate, br
Accept-Language: en-US
Sec-Fetch-Dest: image
Sec-Fetch-Mode: no-cors
Sec-Fetch-Site: cross-site
```

- **No `Referer`**, under the default policy, `<meta name="referrer"
  content="no-referrer">` and `referrerpolicy="no-referrer"` alike. The cause is
  WebKit's
  [`SecurityPolicy::generateReferrerHeader`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/SecurityPolicy.cpp),
  which starts `if (!referrer.protocolIsInHTTPFamily()) return String();`. A
  `tauri://` document can't leak its URL. The exception is a **dev run**, whose
  document is `http://localhost:1420`. There a cross-origin `https` image would
  carry that origin under WebKit's default policy. That was not probed, and it
  only happens in dev.
- **No `Origin`.** It is a `no-cors` image request.
- **No cookies.** `th.wallhaven.cc` sets none [Live], and Tauri/wry keep
  cookies in the app's own data directory, isolated from any browser.
- **Wallhaven doesn't gate on the referrer [Live].** A sketchy thumbnail
  returned the same 200 and bytes with no `Referer`, with
  `Referer: tauri://localhost/`, and with `Referer: https://example.com/`.
- **The same under both routes.** Wallhaven and Cloudflare see the user's IP,
  the thumbnail ids requested and when. The proxy doesn't anonymise anything. It
  only changes the header set: whatever the Rust client sends, with no Safari
  UA or `Sec-Fetch-*` unless added. #318 found no User-Agent requirement.
- **Where a record is left.** Under the CSP route it lands in WebKit's disk
  cache for up to 30 days (§3). Under the proxy route it goes wherever the
  backend chooses, and possibly nowhere.
- **What the webview can reach.** Under the CSP route, a script-injection bug
  in the webview could make GET requests to `th.wallhaven.cc` only, which is
  one fixed host, and only through image loads. `connect-src` stays closed.
  Under the proxy route, nothing new is reachable from the webview.
- **The API key.** Neither route puts it in the webview. Thumbnail URLs carry no
  key (§5), so the CSP route hands the webview only key-free URLs that came from
  a backend search. This agrees with #317's "the key never reaches the webview".

## 5. Does either route break with an API key set?

- **URL shape.** Every `thumbs` object inspected has the form
  `https://th.wallhaven.cc/{small|lg|orig}/<id[0..2]>/<id>.jpg`, with no query
  string and no token [Live]. That was 24 toplist results (sfw) and the sketchy
  results of the anonymous `sorting=date_added` listing. The docs' own example is the same shape
  [Doc: <https://wallhaven.cc/help/api>].
- **Where the key works.** The key is documented as `?apikey=` or `X-API-Key` on
  `wallhaven.cc/api/v1/...`. NSFW "blocked to guests" and the 401 on NSFW
  without a key are both stated for API endpoints only. The docs say nothing
  about the image hosts [Doc].
- **What a guest sees of NSFW.** A guest can't get an NSFW id from the API:
  `purity=001` returns 200 with `total: 0`, and `111` drops the NSFW bit
  [Live; #318].
- **Suggestive, not conclusive.** `6le2y7`, a neighbour of a freshly uploaded
  id, returns `{"error":"Nothing here"}` on `/api/v1/w/6le2y7` and "Wallpaper
  not found" on `wallhaven.cc/w/6le2y7` to a guest. Yet
  `th.wallhaven.cc/small/6l/6le2y7.jpg` is a 200 `image/jpeg` of 21,639 bytes
  (a missing id gives 404, 146 bytes) [Live]. If this is an NSFW wallpaper, NSFW
  thumbs are served to guests and the docs' "401" is really a 404. It could
  equally be an upload that is pending, removed or unlisted. The image wasn't
  looked at.
- **What each outcome means for each route:**

  | NSFW thumbs on `th.` are… | CSP route | Proxy route |
  |---|---|---|
  | public (likely, not verified) | works | works |
  | gated by a cookie or session | broken; the webview has no Wallhaven session | broken unless the backend logs in, which #318's FAQ reading says apps shouldn't do |
  | gated by the API key | broken; the key must not reach the webview | works if the proxy adds `X-API-Key` |

  Only the last row separates the routes, and nothing documents it.
- **How to settle it.** With a key, run
  `curl -s "https://wallhaven.cc/api/v1/search?purity=001&apikey=$KEY"`, take any
  `thumbs.small`, then `curl -sI` it with no key and no cookie. It's one command
  and needs the key the maintainer has and this research didn't.
- **Full files.** Downloads go through the backend in both designs (#317), so
  whether `w.wallhaven.cc` gates NSFW files affects the download path, not this
  question. It's the same one-command check.

## 6. Trade-offs side by side

| | CSP route | Proxy route |
|---|---|---|
| Code | one policy line, a test edit, an ADR | a new URL grammar, a fetch path, a cache decision and error handling in `serving.rs` or a sibling module |
| ADR 0036 | reopened: first remote origin in the policy | intact (via `wallpaper:`) or one local scheme added |
| Latency | network only | network + an in-process protocol hop (small next to ~50 ms) |
| Caching | free, WebKit disk cache, 30 days, outside app control | whatever the backend implements; ADR 0040's memory cache is a model to copy, not reuse |
| Referrer | none sent (non-HTTP document) | none sent |
| Headers seen by Wallhaven | WebKit/Safari UA, `Sec-Fetch-*` | whatever the Rust client sends |
| On-disk record of browsing | yes, `WebKitCache/` | backend's choice |
| Key exposure | none; URLs are keyless | none |
| NSFW gated by key (undocumented) | would break | would work with `X-API-Key` |
| Failure visibility | CSP mistakes invisible in dev, only in release | network errors surface as `wallpaper://` errors; risk of ADR 0032's "gone" panel unless Discover handles errors separately |
| Webview network surface | `img-src` to one host | unchanged |
| Pixel or byte access from JS | blocked (`th.` isn't CORS-open) | allowed (same-scheme bytes) |

## Open questions left for the decision

- Is NSFW on `th.wallhaven.cc` public (§5)? It's one `curl` with a key.
- Does WebKitGTK disk-cache `wallpaper://` responses? It only matters if the
  proxy relies on WebKit rather than its own cache.
- If the proxy is chosen, does it ride `wallpaper://` (one grammar, one file) or
  get its own scheme (a cleaner key space, one more `img-src` source)? That
  belongs to the Discover backend seam, #323.

## Appendix: the WebKitGTK probe

A throwaway Python/PyGObject harness against the system WebKitGTK 2.52.6
(`webkit2gtk-4.1`, the same library the AppImage links). It ran in a
`Gtk.OffscreenWindow` with `WEBKIT_DISABLE_DMABUF_RENDERER=1
WEBKIT_DISABLE_COMPOSITING_MODE=1`, and was not committed. It mimics wry:

1. It registers a `tauri` URI scheme on a `WebContext` and calls
   `security_manager.register_uri_scheme_as_secure("tauri")`, as wry does.
2. It serves `tauri://localhost/<scenario>` as `text/html` with a
   `Content-Security-Policy` response header: the shipped policy, then the
   policy with `img-src` widened to `https://th.wallhaven.cc` plus a local
   HTTPS endpoint.
3. Each page has two `<img>` elements, one pointing at the real
   `th.wallhaven.cc` thumbnail and one at a local self-signed HTTPS server that
   logs request headers. It reports `load`/`error`, `isSecureContext`,
   `location.origin` and `securitypolicyviolation` events through
   `document.title`.
4. Four scenarios ran: the current policy; widened; widened plus
   `<meta name="referrer" content="no-referrer">`; and widened plus
   `referrerpolicy="no-referrer"`.

The results are quoted in §2 and §4. The Wallhaven endpoint and the local
endpoint behaved identically in every scenario.
