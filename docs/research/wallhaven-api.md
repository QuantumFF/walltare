# Research: Wallhaven API (v1) surface and terms

Resolves [QuantumFF/walltare#318](https://github.com/QuantumFF/walltare/issues/318)
(part of the Discover map, [#317](https://github.com/QuantumFF/walltare/issues/317)).

## Question

What does the Wallhaven API v1 actually offer and demand? That covers search
parameters and `q` syntax, the response and pagination shape, the single-wallpaper
endpoint, thumbnail and full-file URLs, rate limits, the API key, terms and
attribution, and the `wallhaven-<id>.<ext>` filename convention.

## Sources and method

- **[API doc]**: https://wallhaven.cc/help/api, fetched 2026-09-23.
- **[FAQ]**: https://wallhaven.cc/faq. **[ToS]**: https://wallhaven.cc/terms
  ("Last updated: August 03, 2016"). **[About]**: https://wallhaven.cc/about.
  Also checked https://wallhaven.cc/rules and https://wallhaven.cc/privacy-policy
  (upload and privacy rules only, nothing about API clients).
- **[Live]**: first-party probes of `wallhaven.cc/api/v1`, `w.wallhaven.cc` and
  `th.wallhaven.cc` with `curl`, run anonymously (no API key) on 2026-09-23
  (UTC), about 110 requests. "[Live]" marks behaviour I observed that the doc
  does not state, or that contradicts it. Behaviour behind a key (NSFW, user
  settings, private collections) was **not** verified live because no key was
  available.

## TL;DR

- **Endpoints**: `GET /api/v1/search`, `/w/<id>`, `/tag/<id>`, `/settings` (key),
  `/collections` (key), `/collections/<user>` and `/collections/<user>/<id>`.
  All are GET only and return JSON `{ "data": … }` (plus `meta` on listings).
  The doc warns that the API can change without notice and is "provided for free
  and as-is with no warranty" [API doc].
- **Pages have 24 results**, with `meta.{current_page,last_page,per_page,total,query,seed}`.
- **Rate limit is 45 calls/min.** A 429 comes back with **an HTML body, not JSON**,
  plus `Retry-After` (seconds) and `X-RateLimit-Reset` (epoch). Every API response
  carries `X-RateLimit-Limit` and `X-RateLimit-Remaining` [Live]. The image hosts
  are not rate-limited [Live].
- **The key** goes in `?apikey=` or the `X-API-Key` header. It unlocks NSFW,
  applies the account's browsing settings and default filters to searches, and
  gives access to `/settings` and the user's private collections [API doc].
- **`ratios` matches on `width/height` rounded to 2 decimals**, and comma lists
  are OR'd. `21x9` is special-cased as an ultrawide bucket. `landscape` and
  `portrait` work. Malformed values are silently ignored [Live]. See below.
- **`like:<id>` is blocked by Cloudflare** when the query string *starts with*
  `q=like` [Live]. See below.
- **Anonymous NSFW fails silently in search**: `purity=001` gives 200 with 0
  results, not a 401. Sketchy works anonymously [Live].
- **Full file**: `https://w.wallhaven.cc/full/<id[0..2]>/wallhaven-<id>.<jpg|png>`.
  **Thumbnails** are always `.jpg`, at `https://th.wallhaven.cc/{small|lg|orig}/<id[0..2]>/<id>.jpg`.
  Use the URLs the API returns rather than building them, because the doc's own
  search example has a path that 404s.
- **Terms**: nothing restricts third-party apps, and no attribution or User-Agent
  is required. The FAQ asks people **not to run scrapers or mass-download
  scripts** and says your "API key should be sufficient": never ask for a login
  [FAQ]. Images "remain property of their original owners" (site footer).

## Endpoints

| Endpoint | Auth | Notes |
|---|---|---|
| `GET https://wallhaven.cc/api/v1/w/<id>` | NSFW needs key | Full wallpaper info, including `uploader` and `tags` [API doc] |
| `GET https://wallhaven.cc/api/v1/search` | optional | Listing, 24 per page [API doc] |
| `GET https://wallhaven.cc/api/v1/tag/<id>` | none | `{id,name,alias,category_id,category,purity,created_at}` [API doc] |
| `GET https://wallhaven.cc/api/v1/settings` | key required | The user's browsing settings (see below) [API doc] |
| `GET https://wallhaven.cc/api/v1/collections` | key required | Your own collections, including private ones [API doc] |
| `GET https://wallhaven.cc/api/v1/collections/<username>` | none | Another user's **public** collections [API doc] |
| `GET https://wallhaven.cc/api/v1/collections/<username>/<id>` | key for private | A listing shaped like search. **Only the `purity` filter applies** [API doc] |

Collection list item: `{id, label, views, public (0|1), count}` [API doc].

## Search parameters

From the [API doc] table, with [Live] observations added. `*` marks the documented default.

| Param | Values | Notes |
|---|---|---|
| `q` | see `q` syntax below | |
| `categories` | 3-bit string general/anime/people, e.g. `100`, `101`, `111`* | |
| `purity` | 3-bit string sfw/sketchy/nsfw, e.g. `100`*, `110`, `111` | "NSFW requires a valid API key". [Live] Anonymously, sketchy (`010`) works. The NSFW bit is silently dropped: `001` gives 200 with `total: 0`, and `111` gives only sfw and sketchy. |
| `sorting` | `date_added`*, `relevance`, `random`, `views`, `favorites`, `toplist` | (The web UI also has "Hot". The API doc doesn't list it.) |
| `order` | `desc`*, `asc` | |
| `topRange` | `1d`, `3d`, `1w`, `1M`*, `3M`, `6M`, `1y` | Only when `sorting=toplist`. [Live] It's silently ignored otherwise. |
| `atleast` | `WxH`, e.g. `1920x1080` | Minimum resolution. [Live] `atleast=7680x4320` returned only ≥ 8K. |
| `resolutions` | `WxH[,WxH…]` | Exact resolutions. [Live] Comma lists are OR'd. |
| `ratios` | `WxH[,WxH…]`, plus `landscape` and `portrait` | See **Ratio semantics** below |
| `colors` | one of 29 hex values with no `#` (`660000` … `424153`) | [Live] `colors=0066cc` works |
| `page` | `1`… | "Not actually infinite". [Live] Past the end (`page=999999`) gives **400** `{"error":"Bad Request"}` |
| `seed` | `[a-zA-Z0-9]{6}` | For `sorting=random`. The response's `meta.seed` (e.g. `"6z0qQS"`) is passed back on the next page so results don't repeat [API doc, Live] |

The doc's wording "List of … Single resolution allowed" and "List of aspect
ratios Single ratio allowed" reads as "a single value is also allowed", not
"only one". [Live] `ratios=16x9,21x9` returned 859 results, exactly the 820 + 39
of the two separately.

### `q` syntax [API doc]

- `tagname` searches fuzzily for a tag or keyword. `-tagname` excludes it.
- `+tag1 +tag2` requires both. `+tag1 -tag2` requires one and excludes the other.
- `@username` finds that user's uploads.
- `id:123` is an exact tag search and "can not be combined". [Live] `meta.query`
  becomes `{"id":1,"tag":"anime"}` instead of a string.
- `type:png` / `type:jpg` filters by file type (jpg = jpeg). [Live] This works, and
  `meta.query` comes back as `""`.
- `like:<wallpaper id>` finds "wallpapers with similar tags".
  - [Live] It **can't be combined** either: `anime like:2169oy` and `+like:2169oy`
    both return 0 results.
  - [Live] The results **include the seed wallpaper itself** (`2169oy` was first
    of 211).
  - [Live] **A Cloudflare managed challenge blocks it** (HTTP 403, HTML
    "Just a moment…", `cf-mitigated: challenge`) whenever the raw query string
    begins with `q=like`, case-insensitively. Even a bare `?q=like` gets the
    challenge, and a browser User-Agent makes no difference. The same query with
    another parameter first (`?categories=111&q=like:2169oy`) or a leading space
    (`?q=%20like:2169oy`) returns 200 with results. This looks like an
    anti-scraping WAF rule and could change at any time. A client that wants
    `like:` should put `q` after at least one other parameter, and should treat
    an HTML 403 as "blocked" rather than a parse error.

### Ratio semantics [Live]

Tested with `sorting=random&seed=abc123` over two pages (48 results) per value,
and by comparing `meta.total`:

- **The match is on `dimension_x / dimension_y` rounded to 2 decimals (the
  response's `ratio` field), not on a reduced fraction.** Equal values give
  identical totals: `16x9` ≡ `32x18` ≡ `1366x768` (1.78, total 203 476),
  `16x10` ≡ `8x5` (1.6, 65 194), and `43x18` ≡ `3440x1440` (2.39). So **any
  `WxH` pair works, including the Screen's raw pixels.** `3840x2161` (1.777…)
  counts as 16:9.
- **There's no tolerance beyond that rounding.** Every result's `ratio` equalled
  the requested rounded value, e.g. `12x5` gives only 2.4 and `64x27` only 2.37.
- **`21x9` (and `7x3`, which rounds to the same 2.33) is special-cased** as an
  ultrawide bucket: it returned `ratio` values 2.33, 2.37 and 2.39 (5 456 total,
  against 3 175 for `43x18` alone). So a 3440×1440 Screen that sends its exact
  ratio gets **fewer** results than one that sends `21x9`. No other named value
  behaves like a bucket: `32x9` gives only 3.56, `48x9` only 5.33, and `9x16`
  only 0.56.
- **`landscape` and `portrait`** are accepted. They're the "All Wide" and "All
  Portrait" checkboxes in the site's own search bar (`name="ratio"
  value="landscape|portrait"` in the page HTML).
- **Malformed values are silently ignored, and the search becomes unfiltered.**
  `16:9`, `1.78`, `abc` and `16x9x1` all returned the full unfiltered total with
  mixed ratios. A client should validate its own `WxH` before sending, because
  the API won't complain.

## Response shape

Search [API doc, Live]:

```json
{
  "data": [
    {
      "id": "2169oy",
      "url": "https://wallhaven.cc/w/2169oy",
      "short_url": "https://whvn.cc/2169oy",
      "views": 0, "favorites": 0, "source": "",
      "purity": "sfw|sketchy|nsfw",
      "category": "general|anime|people",
      "dimension_x": 1920, "dimension_y": 1080,
      "resolution": "1920x1080",
      "ratio": "1.78",
      "file_size": 2809677,
      "file_type": "image/jpeg|image/png",
      "created_at": "2026-09-23 17:27:56",
      "colors": ["#ffffff", "..."],
      "path": "https://w.wallhaven.cc/full/21/wallhaven-2169oy.png",
      "thumbs": {
        "large":    "https://th.wallhaven.cc/lg/21/2169oy.jpg",
        "original": "https://th.wallhaven.cc/orig/21/2169oy.jpg",
        "small":    "https://th.wallhaven.cc/small/21/2169oy.jpg"
      }
    }
  ],
  "meta": {
    "current_page": 1, "last_page": 20866, "per_page": 24, "total": 500777,
    "query": null,
    "seed": null
  }
}
```

- `ratio` is a **string**. `created_at` is `YYYY-MM-DD HH:MM:SS` with no time zone.
- `meta.query` is `null` with no `q`, the query **string** otherwise, and an
  **object** `{id, tag}` for `id:` searches. `meta.seed` is `null` unless
  `sorting=random`. [Live] `per_page` came back as the number `24`. Notice that
  `/settings` returns `"per_page": "24"` as a string [API doc].
- Search items **lack** `uploader` and `tags`. Only `/w/<id>` has them: `uploader
  {username, group, avatar{200px,128px,32px,20px}}` and `tags[] {id, name, alias,
  category_id, category, purity, created_at}` [API doc, Live].
- Errors are JSON `{"error": "..."}` with the status code, e.g. `404 {"error":"Nothing here"}`
  for an unknown id, `401 {"error":"Unauthorized"}`, and `400 {"error":"Bad Request"}`
  [Live]. The exceptions are **429** and the **Cloudflare 403**, which both return
  HTML.

## File and thumbnail URLs

- **Full file**: `https://w.wallhaven.cc/full/<first 2 chars of id>/wallhaven-<id>.<ext>`,
  where `<ext>` is `jpg` for `image/jpeg` or `png` for `image/png` [API doc `/w`
  example, Live]. Only those two types turned up (and `type:` only offers png/jpg).
  - The doc's **search** example shows `https://w.wallhaven.cc/94/wallhaven-94x38z.jpg`
    with no `full/`. [Live] That form **404s**, and the live search returns `full/`
    paths. Use `path` as given.
  - [Live] The file host sends `access-control-allow-origin: *`,
    `cache-control: public, max-age=2592000`, an `etag` and a correct
    `content-type`, with **no** `Content-Disposition` header, so the filename is
    the URL's basename.
- **Thumbnails**: `https://th.wallhaven.cc/<size>/<first 2 chars>/<id>.jpg`. They're
  **always JPEG, even when the original is PNG** [Live]. Measured sizes:
  - `small` is **300×200**, cropped to that fixed box.
  - `lg` (the `large` key) is **432×243**, cropped to a fixed 16:9 box.
  - `orig` (the `original` key) keeps the **original aspect ratio**, with the long
    side at 300: 300×169 for 16:9, 195×300 for a portrait, 300×129 for a 2.32 image.
    Despite the name, this is **not** the full-resolution image.
  For a grid that shows how a wallpaper would crop, `orig` is the only thumb that
  keeps the real shape. `lg` is the sharpest but it's cropped.
- **The CDN isn't rate-limited**: while the API was returning 429, both
  `th.wallhaven.cc` and `w.wallhaven.cc` still returned 200, and neither sends
  `X-RateLimit-*` headers [Live]. Downloads and thumbnails don't count against the
  45/min.
- **Whether NSFW thumbnails and files need auth was not verified.** No NSFW id
  was reachable without a key. What's observable is that the URLs returned carry
  no token and the hosts are static, CORS-open CDNs. The API key only works on
  `wallhaven.cc/api`, so if NSFW images were gated, it would have to be by
  something other than the key. Verify with a key before the thumbnail route is
  decided.

## Rate limits and errors

- The doc says "API calls are currently limited to 45 per minute. If you do hit this limit, you
  will receive a 429 - Too many requests error" [API doc].
- [Live] Every API response carries `x-ratelimit-limit: 45` and
  `x-ratelimit-remaining: N`. On a 429 it adds `retry-after: 28` (seconds) and
  `x-ratelimit-reset: 1790193113` (Unix epoch, the end of the window). The body is
  an HTML page titled "Too many requests - wallhaven.cc", **not JSON**. The
  window looked like a fixed 60 s window keyed per client, anonymous in this
  test.
- The doc says NSFW without a key, or with an invalid one, gives 401, and
  "any other attempts to use an invalid API key will result in a 401" [API doc].
  [Live] That held for `search` and `collections`, with the key in either the query
  or the header. **`/settings` with an invalid key returned `404 {"error":"Nothing
  here"}`** (with no key it's 401). So an invalid key can show up as either 401 or
  404 depending on the endpoint.
- The API sits behind Cloudflare (`server: cloudflare`). Besides the `like:` rule
  above, a client should expect an occasional HTML challenge page.

## API key

- A user gets the key from their account settings and "can be regenerated at anytime by the
  user" [API doc].
- It can be passed as `?apikey=<KEY>` or as the `X-API-Key: <KEY>` header [API doc].
  The header keeps the key out of URLs and logs. [Live] Both forms were
  recognised: an invalid key sent either way gave 401.
- What it unlocks [API doc]:
  - **NSFW** purity, in search and on `/w/<id>`.
  - **"Searches will be preformed with that user's browsing settings and default
    filters."** In other words, *sending a key changes what an unparameterised
    search returns*, which the account-features ticket needs to know. Explicit
    parameters presumably override them (not verified).
  - **`/settings`**: `{thumb_size, per_page, purity[], categories[], resolutions[],
    aspect_ratios[], toplist_range, tag_blacklist[], user_blacklist[]}`.
    `aspect_ratios` uses the same `16x9` form as `ratios`.
  - **Collections**: your own, private ones included, via `/collections`. The
    wallpapers in any collection come from `/collections/<username>/<id>` (the
    username is needed even for your own).

## Terms of use, attribution and User-Agent

- **ToS** [ToS]: this is generic website boilerplate from 2016 about user
  content, accounts (18+), DMCA, and termination "for any reason whatsoever".
  **It says nothing about the API, third-party apps, caching or redistribution.**
- **FAQ** [FAQ]:
  - "Am I allowed to run scrapper/mass download scripts? **We ask that you
    don't.** … we don't run any ads … we don't pay for the big boxes that can
    absorb huge requests."
  - "We don't have any official app at this time. **Be very careful of any apps
    that ask for your login information. Your API key should be sufficient** to
    access your settings."
- **API doc**: it's "provided for free and as-is with no warranty", and "there may be
  issues that arise that will call for changes to be made without warning.
  Please keep this in mind as you create apps" [API doc]. So apps are expected.
- **Attribution and User-Agent**: **no page asks for either.** [Live] An empty
  User-Agent got 200, and so did a custom one. The site footer says "All images
  remain property of their original owners". The About page asks copyright owners
  to request takedowns, or to edit a wallpaper's `source` to be credited [About].
  Recording the Wallhaven id (already planned as provenance) keeps the
  `url` and `source` recoverable. Sending an honest User-Agent such as
  `walltare/<version>` costs nothing and is polite, but nothing requires it.
- **Implication for Discover**: v1 is user-driven browsing with individual and
  multi-select downloads and no "download all", which fits the FAQ's request.
  A bulk "download page / top N" action (already out of scope) would be exactly
  what the FAQ asks people not to build.

## Filename convention

- A downloaded file is named **`wallhaven-<id>.<ext>`**, which is the basename of
  `path` [API doc, Live]. Browser downloads from the site produce the same name,
  since the host sends no `Content-Disposition`. The live library is already
  mostly `wallhaven-*` files (see `docs/adr/0014-library-page-ordering.md`).
- `<id>` is lowercase alphanumeric. Every id seen was 6 characters (`[a-z0-9]{6}`),
  but the doc publishes no id grammar, so a matcher should accept
  `^wallhaven-([a-z0-9]+)\.(jpg|png)$` rather than hard-coding the length. `<ext>`
  follows `file_type`: `jpg` rather than `jpeg`.
- **Matching an existing file to a search result** is a pure string check (`id`
  against the filename) with no API call. Discover can mark search results that
  are "already in the library" from filenames alone, including Wallpapers that
  predate Discover. The match holds only if the user never renamed the file.

## Open points for later tickets

1. **NSFW thumbnails and files**: are they reachable without a key? This decides
   whether the webview can load thumbnails straight from `th.wallhaven.cc` or
   they have to go through the Rust backend. It needs a keyed test.
2. **Key plus explicit parameters**: when a key is sent, do explicit
   `purity`, `categories` or `ratios` override the account's defaults? This
   matters if the Screen-ratio default is meant to win over the account's
   `aspect_ratios`.
3. **The `like:` WAF rule** is observed behaviour, not documented. Taste-driven
   discovery that relies on `like:` should expect it to break.
