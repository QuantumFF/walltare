# ADR 0002: The wallpaper:// URL keeps a localhost authority

**Status:** Accepted
**Ticket:** [#21](https://github.com/QuantumFF/walltare/issues/21)
**Date:** 2026-08-23

## Context

Images reach the webview through a custom protocol registered in `lib.rs`. The
handler reads the wallpaper id and the requested size out of the URL.

Issue #21 specified the URL as `wallpaper://image/{id}?size=`, and the port
built exactly that. It does not work. A URL parser reads
`scheme://authority/path`, so `wallpaper://image/7` puts `image` in the
authority and leaves `/7` as the entire path. The handler matches on the path
segments `["image", id]`, finds `["7"]`, and returns 400.

Nothing caught it. There were no tests for the handler's URL parsing, and the
one frontend test asserted that `wallpaperImageUrl` returned the same broken
string it produced. The bug reached `main` and every image in the app failed to
load on Linux and macOS.

The platform difference is why it is easy to miss. On Windows, Tauri rewrites
custom schemes to `http://wallpaper.localhost/image/7`, where `image` does land
in the path and the handler works. On Linux, wry passes WebKitGTK's URI to the
handler verbatim (`wry/src/webkitgtk/web_context.rs`, in the
`register_uri_scheme` callback), so the broken form arrives unchanged. walltare
is Linux-first.

## Decision

`wallpaperImageUrl` builds `wallpaper://localhost/image/{id}?size={size}`.

The `localhost` authority is a placeholder with no meaning of its own. Its job
is to occupy the authority slot so that `image` and the id both land in the
path. This matches Tauri's own `asset://localhost/...` convention.

`src/lib/client.ts` is the only place in the codebase that builds these URLs.

## Alternatives rejected

**Accept both shapes in the handler.** Reading the id out of the authority when
the path does not match would make the handler tolerate a URL the frontend
should never send, and would hide the next mistake of the same kind.

**Drop the path segment and use `wallpaper://{id}?size=`.** Shorter, and the id
would sit in the authority on every platform. It gives up the ability to add a
second kind of resource later, and it reads as a hostname to anyone debugging
network traffic.

## Consequences

The redundant-looking `localhost` invites cleanup. Both sides carry a comment
saying why it is there, and tests on both sides pin the exact string:
`the_url_the_frontend_builds_is_the_url_this_handler_accepts` in `lib.rs`, and
the `wallpaperImageUrl` test in `tests/client.test.ts`. A companion Rust test
asserts that the old authority-shaped URL is rejected.

The two tests share a literal rather than a running system. Nothing in CI
proves that a real WebKitGTK window renders an image, so this pairing is the
strongest guarantee available without a display.
