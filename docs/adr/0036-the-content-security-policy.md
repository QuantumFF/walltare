# ADR 0036: The content security policy names every local source and no remote one

**Status:** Accepted
**Ticket:** [#204](https://github.com/QuantumFF/walltare/issues/204),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

`app.security.csp` has been `null` since the scaffold generated it, which means
the webview runs with no content security policy at all. Nothing in the app
loads anything from the network today, so nothing is currently wrong. What is
wrong is that nothing says so, and the first `fetch` anybody adds — a font from
a CDN, an update check, a crash reporter — reaches the internet from a process
holding the user's whole library and their database.

Setting a policy is cheap and the risk of setting it badly is not. Every asset
this app renders arrives over a custom protocol or out of the bundle, so a
policy that names one source wrong does not error anywhere a user will see. A
blocked `wallpaper://` request paints the same panel that [ADR 0032](0032-a-missing-file-reads-as-gone.md)
built for a file that is genuinely gone, so a mistake here reads as a broken
thumbnail pipeline, which is where anyone diagnosing it later would start
looking. That is the reason this ADR writes down not just the policy but why
each source is in it.

Four facts about how Tauri v2 delivers a policy shaped the decision, and all
four were read out of `tauri` 2.11.5 rather than assumed.

- **A custom protocol is served over `<scheme>://localhost/…` on Linux.**
  `scripts/core.js` builds `${protocolScheme}://${protocol}.localhost/${path}`
  only when `osName` is `windows` or `android`, and `${protocol}://localhost/${path}`
  otherwise. So the origin the webview sees for a thumbnail is
  `wallpaper://localhost`, exactly as [ADR 0002](0002-wallpaper-url-shape.md)
  worked out empirically, and the `http://wallpaper.localhost` form is a Windows
  artefact.
- **The IPC is a `fetch`, not a `postMessage`.** `scripts/ipc-protocol.js` posts
  every command to `convertFileSrc(cmd, 'ipc')` — `ipc://localhost/<command>`
  on Linux — and falls back to `window.ipc.postMessage` only after the first
  request fails. A policy with no `connect-src` for it would leave the app
  working, on the fallback, having logged a violation for the first command of
  every launch.
- **Tauri adds nothing to the policy on its own account.** `manager::set_csp`
  only merges nonces and the hashes of inline scripts and styles found in
  `index.html`; it never contributes an origin. There is no `ipc:` added for us.
- **The policy does not apply under `bun tauri dev` on desktop.**
  `PROXY_DEV_SERVER` is `cfg!(all(dev, mobile))`, so a desktop dev run loads
  `http://localhost:1420` from Vite directly and Tauri, not being the one
  serving the document, attaches no header. In a release build the frontend is
  served by the `tauri://` protocol handler and the policy arrives as a
  `Content-Security-Policy` response header (`protocol/tauri.rs`). This is why
  the epic files the check under "no automated test" and why it lands in
  `docs/release-checklist.md`: a dev run cannot exercise this, and neither can
  `cargo test`.

## Decision

### The policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' wallpaper:;
connect-src 'self' ipc:;
object-src 'none';
base-uri 'self';
form-action 'none';
frame-src 'none'
```

One line each, because the reason a source is there is the only thing that
stops it being widened later by someone who cannot tell which ones are
load-bearing.

- **`default-src 'self'`** — the floor. `'self'` is `tauri://localhost` in a
  release build, which is the app's own bundle and nothing else. Every directive
  not named below inherits this, so `media-src`, `worker-src` and
  `manifest-src` are covered without being spelled out.
- **`script-src 'self'`** — the one bundle Vite emits. `index.html` carries no
  inline script, so Tauri's codegen finds no hash to add and no nonce token to
  fill in. Tauri's own initialization scripts are WebKit user scripts, which the
  policy does not govern.
- **`style-src 'self' 'unsafe-inline'`** — the compromise, and the only one.
  Tailwind's utilities are in the bundled stylesheet, but two things reach for
  inline styles at runtime: React `style` props, which the Lightbox uses for the
  painted row width and `ui/progress` for its transform, and the `<style>`
  element the Radix scroll-lock creates in `<head>` when a dialog opens. The
  first would be covered by `style-src-attr`; the second would not. Hashing is
  not available for either, because both are composed at runtime from values
  that change.
- **`font-src 'self'`** — Geist is a dependency, not a download.
  `@fontsource-variable/geist` resolves at build time and Vite emits five
  `.woff2` files into `dist/assets/`, which the bundled stylesheet asks for by
  relative path. Nothing reaches `fonts.googleapis.com`, and the checklist
  proves it by looking at the rendered glyphs rather than at the network.
- **`img-src 'self' wallpaper:`** — every thumbnail in the app. `'self'` is for
  the favicon; `wallpaper:` is the protocol registered in `lib.rs` and the one
  source in this policy whose absence has no visible symptom. A bare scheme
  source matches any authority, so it covers the `localhost` placeholder
  ADR 0002 requires without restating it.
- **`connect-src 'self' ipc:`** — the IPC `fetch`. Without `ipc:` every command
  in the app takes the postMessage fallback after logging a violation. `'self'`
  is there because `connect-src` replaces `default-src` outright rather than
  extending it, and a directive that silently narrowed the app's own origin
  would be a trap.
- **`object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
  `frame-src 'none'`** — four things this app does not do, said out loud. There
  are no plugins, no `<base>`, no forms that submit and no frames, so each is
  free to close and each closes a way of getting around the rest of the policy.

### Nothing is added for Windows or macOS

The policy names `wallpaper:` and `ipc:` and not `http://wallpaper.localhost`
or `http://ipc.localhost`. The epic ships Linux x86_64 only, and ADR 0002
already decided that `wallpaperImageUrl` builds the Linux form unconditionally —
so on Windows the URLs would be wrong before the policy got a chance to block
them. Naming the Windows origins here would suggest a platform this app does
not run on. The `http://wallpaper.localhost` case in
`the_url_the_frontend_builds_is_the_url_this_handler_accepts` stays: that test
is about what the handler tolerates, which is not the same question.

Both hostnames are loopback names reserved by RFC 6761 rather than remote
origins, so this is a clarity decision and not a security one.

### Two tests hold the half that is testable

`the_policy_lets_the_wallpaper_protocol_through` reads the real
`tauri.conf.json` and asserts `img-src` carries `wallpaper:`. It is the
companion to ADR 0002's pairing: that pair proves the handler answers the URL
the frontend builds, and this one proves the webview is allowed to ask. Neither
proves a window renders an image, and this one is the cheaper half of what is
left.

`the_policy_names_no_remote_origin` walks every directive and checks each source
against an allowlist of five spellings — `'self'`, `'none'`, `'unsafe-inline'`,
`ipc:` and `wallpaper:`. An allowlist rather than a pattern match on `http`,
because the acceptance criterion is that the policy allows no remote origin, and
the way to hold that is to make adding any source at all fail until somebody
edits the test and says why.

### The rest is a release checklist item

`docs/release-checklist.md` is new here and gains a Content security policy
section: thumbnails in the Library grid, in Rank, in Review and in the Lightbox;
Geist rather than a fallback; and a clean console across all four views. It is
written to be extended, because issues #207 and #208 add the packaging and
release passes to the same file.

The checklist says which build to check it from, because that is the part that
is easy to get wrong: a dev run cannot fail these, for the reason above.

### The opener plugin goes

Nothing calls it. `tauri-plugin-opener` was in the scaffold, `@tauri-apps/plugin-opener`
was in `package.json`, `opener:default` was in `capabilities/default.json`, and
no line of Rust or TypeScript ever asked any of them for anything — no
`openUrl`, no `openPath`, no `revealItemInDir`, no `plugin:opener` invoke. The
app has no external links: the two folder paths it takes are typed or picked
with the dialog plugin, and nothing in the UI offers to open a file manager.

So the plugin, its npm package and its permission are all removed, taking 457
lines of `Cargo.lock` with them. `tauri-plugin-dialog` keeps the note beside it
in `lib.rs` explaining what calls it, which is what a kept plugin owes; opener
had no such note to write.

## Alternatives rejected

**Leave `csp` as `null` until something actually loads remote content.** It
costs nothing today and the policy is only ever tested by hand, so there is an
argument that it is ceremony. The argument fails on when it would be noticed:
the day a remote load appears is the day it works, silently, and nobody reviews
a `fetch` for a policy that does not exist. A policy set now turns that into a
console error in front of the person adding it.

**`img-src 'self' wallpaper: http://wallpaper.localhost`, and the same for
`ipc:`, as insurance against getting the platform wrong.** Both extra origins
are loopback and allow nothing remote, so this is nearly free, and the failure
it insures against is the expensive one. It was rejected because it insures
against a misreading rather than a risk: `core.js` is unambiguous about which
form Linux gets, and ADR 0002 already established the same fact from the other
end. Carrying the Windows spelling would leave two sources in the policy that
can never be exercised by any build this project ships, which is precisely the
kind of line that survives review because nobody can prove it is dead.

**`style-src-attr 'unsafe-inline'` and no inline `<style>` allowance.** Tighter,
and it would cover the React `style` props. The Radix scroll-lock inserts a
`<style>` element into `<head>` when a dialog opens, so this breaks the
Lightbox — and breaks it as a layout glitch under a console error, which is the
same class of misdiagnosable failure this ADR is trying to avoid.

**Hash the inline styles instead of allowing them.** The honest version of the
compromise, and unavailable: both sources of inline style compose their content
at runtime, so there is nothing to hash at build time.

**Set `devCsp` as well, so a dev run exercises something.** Attractive, because
the policy's whole problem is that it cannot be checked without a build. It does
not deliver: on desktop the dev document is served by Vite over
`http://localhost:1420`, so a `devCsp` would have to allow that origin, the HMR
websocket and Vite's own inline scripts — a policy different enough from the
real one that passing under it would prove nothing about the real one, while
looking like it had.

**Give the policy a `report-uri`.** There is nowhere for a desktop app to report
to that is not a server this project has decided not to run, and violations
already land in the webview console, which is where the checklist reads them.

## Consequences

**An inline `<style>` in `index.html` would silently break every inline style in
the app.** `tauri-codegen`'s `inject_nonce_token` stamps a nonce token onto
every `<style>` element in the HTML it embeds, and a nonce in `style-src` makes
the browser ignore `'unsafe-inline'`. `index.html` has no `<style>` today. If
one is ever added, the Lightbox and the progress bar stop being styled and the
console explains why in terms that point at the policy rather than at the tag
that caused it. The same applies to an inline `<script>` and `script-src`, which
is harmless there because `'self'` is not doing any work a hash would undo.

**The header arrives with its directives in an arbitrary order.** Tauri parses
the configured string into a `HashMap<String, CspDirectiveSources>` and
serializes it back out, so the ten directives above reach the webview in
whatever order the map iterates. The sources survive intact — checked by
round-tripping this exact policy through `tauri_utils::config::Csp` — and order
carries no meaning in a policy, but anybody comparing the config against a
header read out of the inspector should expect them to be shuffled rather than
assume something rewrote the policy.

**Anything the app is later asked to load from the network fails loudly.** That
is the point, and it means a feature that needs the network — an update check,
telemetry, a remote wallpaper source — is a decision that has to come back
through this file. The epic rules all three out for 1.0.0.

**The crate manifest drops to seven direct dependencies.** The epic's phrasing
is "six to five"; `[dependencies]` in `src-tauri/Cargo.toml` actually listed
eight, and now lists seven: `tauri`, `tauri-plugin-window-state`,
`tauri-plugin-dialog`, `serde`, `serde_json`, `rusqlite` and `image`. The
direction is what the epic asked for. The count in ADR 0011's closing line is
stale either way.

**Thumbnails, fonts and a clean console are now checked by a human or not at
all.** Two Rust tests read the config; nothing reads a rendered window. The
first release built from this branch is the first time the policy runs.
