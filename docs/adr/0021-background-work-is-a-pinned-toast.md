# ADR 0021: Background work is a pinned toast that yields

**Status:** Accepted
**Ticket:** [#59](https://github.com/QuantumFF/walltare/issues/59)
**Date:** 2026-08-26

## Context

Three things need reporting and none of them belongs to a page.
[ADR 0012](0012-thumbnail-pre-generation.md) emits `pregen-progress` and
`pregen-complete` for a pass that runs on every first launch and after every
scan, for minutes. `scan-progress` and `scan-complete` report a scan that now
starts from inside Settings and finishes wherever the user has wandered to.
[ADR 0008](0008-round-is-derived.md) puts its "back to Round 1" message on the
scan-complete path, because a scan that adds 400 unseen files legitimately
sends the Round backwards and the headline must not lie about it.

The prototype ([#44](https://github.com/QuantumFF/walltare/issues/44)) answered
this badly and said so: a 2px seam across the full width of the chrome, which
at 34% of a 1500px window reads as a stray rule under the brand. It was the
weakest thing in the variant that won.

[ADR 0017](0017-one-toast-at-a-time.md) declined to claim the surface either
way. It ruled background work off the toast, on the grounds that progress
belongs in a bar, while explicitly leaving scan-complete open: "genuinely
toast-shaped and #59 may take this surface for it."

Round three of the prototype put five housings on a `progress=` axis, over four
timelines built from the real event payloads, on
[`prototype/shell-library-lightbox`](https://github.com/QuantumFF/walltare/tree/prototype/shell-library-lightbox):
the seam as the baseline, a chip beside the gear, a transient row under the
chrome, a pinned toast, and nothing at all. Reacted to live. **The toast won.**

Three facts read out of `lib.rs` while building the timelines shaped the rest
of this ADR more than the housing did.

- **The directory walk is silent.** `scanner::collect_images` runs to
  completion before the first event (`lib.rs:179`), so a slow or networked tree
  emits nothing for however long it takes.
- **The scan has no denominator on the wire.** `scan-progress` carries
  `{scanned, added}` and no total (`lib.rs:196`).
- **And it is over in one event anyway.** The loop that emits is chunked at
  `SCAN_CHUNK_SIZE = 256` inserts (`lib.rs:16`, `:184`), so the live
  120-wallpaper library fires exactly one `scan-progress`, at 100%, and
  [ADR 0016](0016-library-page-scale.md)'s 5,000-wallpaper ceiling fires twenty.

So ADR 0012's "one bar with two phases" asks for a bar whose first phase cannot
have a percentage, cannot start when the work starts, and is over before it can
be read.

## Decision

### The viewport gets a second, lower layer

The shell holds two slots instead of one:

```ts
transient: { key: string, ... } | null   // ADR 0017's four transitions and errors
background: { ... } | null               // this ADR
```

and renders `transient ?? background`. Exactly one `<Toast>` is ever mounted,
so ADR 0017's one-at-a-time rule survives literally rather than by exception.

The precedence is what makes a single slot work for two lifetimes. A keep
during a fourteen-minute pass covers the report for eight seconds and then the
report comes back. Background work never replaces a transition toast, because
the user's own click outranks a machine's progress, and a transition toast
never destroys the report, because it did not replace anything.

This is the shape ADR 0017 rejected as "a second pinned slot" and it is the
same shape for a different reason. That alternative wanted an unread *error*
exempted from replacement, which breaks the one rule every caller is written
against. This layer holds something with no end state and no user action behind
it, and it is invisible whenever anything else has something to say.

### Pinned, and the key is the run rather than the payload

`duration={Infinity}`, which `startTimer` short-circuits outright
(`index.js:374`), so the report holds no close timer at all and the pause
machinery ADR 0017 catalogued is inert for it.

The key is the pass, not the progress event. Content mutates inside a mounted
toast twice a second and the toast never remounts. ADR 0017 made the key
load-bearing in the opposite direction, because swapping content under a stable
key leaves the previous countdown running. There is no countdown here, so the
rule inverts: a stable key is required rather than forbidden, and a fresh key
per event would be 1,204 remounts.

### It announces once, and politely

`announceTextContent` is memoised on the toast's DOM node rather than its
children (`index.js:414`), and the announce region removes itself one second
after mount (`index.js:534`). A screen reader therefore hears
`Preparing thumbnails… 0 of 1,204` once, and the 1,204 updates that follow are
silent. That is the property that makes a pinned progress toast tolerable at
all, and it is Radix's, not something to build.

Every toast this ADR owns is `type="background"`, so even that one
announcement is polite rather than assertive. ADR 0017's four transitions stay
`foreground` for the reason it gave: each follows the user's own click. Nothing
here does. A launch pass follows no click at all, and a scan follows one made
minutes ago on a page the user has since left.

### Two phases, and only one of them draws a bar

| phase | line | bar |
| --- | --- | --- |
| walk | `Scanning…` | none |
| insert | `Scanning… 1,536 files, 212 new` | none |
| pre-generation | `Preparing thumbnails… 240 of 1,204` | determinate |

The scan gets no bar. It has no total, its visible half is one event on a real
library, and the half that can take minutes emits nothing, so any bar drawn for
it would be an animation standing in for information the frontend does not
have. A line that counts up is the honest version of what `scan-progress`
actually carries.

This amends ADR 0012's "one bar with two phases" rather than following it. The
two phases stay joined, as one report that changes what it says, which was the
point of refusing two bars for one click.

The count stays. `240 of 1,204` rather than "the app is busy", because the
toast has room for a sentence and because
[ADR 0020](0020-settings-page.md) already prints those exact words in the
Thumbnails section. One fact, one phrasing, in both places.

### Cancel is not on it; Settings is

ADR 0020 put cancellation on the Generate now button, which becomes Cancel
while a pass runs, and said this ticket owns only the reporting. So the
report's one `ToastAction` is **Settings**, which navigates with
[ADR 0015](0015-navigation-shell.md)'s `returnTo` and lands on the page holding
Cancel, Generate now and the cache size. `altText` is `"Settings"`. The close
button beside it means "stop telling me"; the action means "let me do something
about it".

That exposes a small gap in ADR 0020, recorded rather than filled: its
navigation focus key is typed `keyof Settings`, and Thumbnails is not a
settings key, so this call carries no focus key and simply opens the page.
Thumbnails is the fourth of four sections in a `max-w-2xl` column.

### Dismissal lasts for the run

The close button hides the report for the rest of that pass. A later scan
reports again, since it is a different run and the user asked for it.

Dismissing progress does not suppress the ending, when the ending is news about
the library rather than news about the work.

### The endings, and silence where there is nothing to say

The endings are transient, so they land in the upper slot and the report keeps
running underneath. On a rescan that is the handover: `scan-complete` says
`412 wallpapers added` for eight seconds while pre-generation starts, and when
it clears, `Preparing thumbnails… 12 of 412` is already sitting there. Two
phases as two layers, which is what a single bar could never show.

| event | title | description | lifetime |
| --- | --- | --- | --- |
| `scan-complete`, added > 0 | `412 wallpapers added` | `Back to Round 1. The new wallpapers have no comparisons yet.` | 8s |
| `scan-complete`, scanned > 0, added = 0 | `No new wallpapers` | `2,000 files scanned, all already in your library.` | 8s |
| `scan-complete`, scanned = 0 | `No supported images found` | the folder, as written | pinned |
| `scan-failed` | `Couldn't finish the scan` | the backend message | pinned |
| `pregen-complete`, failed > 0 | `1,201 thumbnails ready, 3 failed` | none | 8s |
| `pregen-complete`, otherwise | nothing | | |
| `pregen-complete`, cancelled | nothing | | |

The Round line appears only when the Round actually moved backwards, which the
frontend can tell by comparing the `Stats` it holds against the one it
refetches on `library-scanned`. This is the home ADR 0008 asked for and could
not name.

The two empty rows are the decision, not an omission. A pass that finishes
cleanly has nothing to report: nobody acts on "1,204 thumbnails ready", the
pass runs on essentially every first launch, and a notification whose only
content is that a background task stopped is the thing that trains people to
dismiss notifications unread. The report appearing and then being gone says it.
A cancel says it more directly, since the user pressed the button.

`No supported images found` is `ScanView`'s `NO_IMAGES_ERROR`, which
ADR 0015 handed here with the event it arrives on. It pins because ADR 0017
pins errors, and it keeps the distinction `ScanView.tsx:47-55` already draws:
only a walk that turned up nothing at all is an empty folder, while a rescan
that adds nothing is the common case and must not be reported as one.

### Everywhere except the two places that already say it

The report is shell-level and shows on every view, with two exceptions where it
is suppressed outright rather than merely covered.

**While the lightbox is open.** Its backdrop is opaque, and a full-screen
preview is the one place the app asks for the whole window. ADR 0017 gave the
toast the highest z-index in the app so that a keep or reject fired from inside
the lightbox is visible, and that reasoning is about confirming the user's own
click. It does not extend to a report about work they did not start.
Transitions still toast over the lightbox, unchanged.

**On the Settings view.** ADR 0020 puts the scan's counter on the Scan button
and the pass's counter in the Thumbnails line, and calls the duplication
deliberate because "#59 exists for the case where they have moved on". On
Settings they have not moved on, and three copies of one number on one screen
is not emphasis.

That is the answer to whether this is visible everywhere or only where it is
relevant. Everywhere, minus the two surfaces that already carry it.

## Alternatives rejected

**The seam.** Round one's, and the reason this ticket exists. A 2px line has no
room for the phase, the counts, an action or a close, so every question above
would have been answered by leaving it unanswered. The prototype also turned up
a second problem: the seam and the active tab's underline sit on the same
horizontal rule, so at some widths the seam reads as the underline growing.

**A chip beside the gear.** The smallest thing that can be present and then
absent, and it survives the whole pass without ever being covered, which is the
one thing the toast cannot claim. It loses on the ending: there is no room in a
chip for "Back to Round 1", so ADR 0008's message would have gone to a tooltip,
and a tooltip is not where you put the explanation for a number that just moved
backwards on screen.

**A transient row under the chrome.** The most legible of the five, with room
for the sentence, a bar, Cancel and a dismiss. It costs the one thing variant A
promised never to do: the height above the page changes, so the grid jumps down
when a pass starts and back up when it ends, twice on every launch that has
work to do. It also duplicates ADR 0020's Cancel in a second place.

**Nothing at all, with the numbers only in Settings.** Genuinely defensible:
ADR 0012 gave pre-generation its own thread precisely so the tail would not
matter, and a report nobody needs to act on may not need to exist. It was
rejected on the scan rather than the pass. A scan changes what the library
contains, can send the Round backwards, and finishes on a page the user has
moved on to, and none of that can wait for someone to open Settings.

**A bar during the scan phase, indeterminate or synthetic.** An indeterminate
sweep for a phase that produces one event at 100% is an animation pretending to
be a measurement. Sending `files.len()` from Rust so the bar could be
determinate is possible and was not done: it would put a real bar on the
cheapest 200ms of the operation while the walk before it stays silent, which
moves the lie rather than removing it.

**Exempting the report from replacement, so a keep cannot cover it.** That is
the stacking ADR 0009 refused, arriving by a side door. Covering it costs eight
seconds of a fourteen-minute report.

## Consequences

**The report re-announces when it comes back.** A transient toast unmounts it
and its expiry remounts it, so the polite one-second announcement runs again,
once per covering transition. During a fast review pass that is one polite
announcement per keep or reject. Accepted: the alternative is keeping a hidden
toast mounted and mutating a live region behind it, which is worse in every
direction.

**The shell owns two slots and one `show()` per lifetime.** No view holds toast
state, unchanged from ADR 0017.

**ADR 0017's "background work is not on this surface" is overturned**, and its
reasoning half survives: progress does belong in a bar, and the bar is now
inside a toast rather than in the chrome. What that ADR could not have known is
that the phase without a bar is the one that needed the words.

**The seam leaves variant A**, along with the prototype's chip and strip
housings. The branch keeps all five as the primary source.

**A warm library still shows nothing.** ADR 0012 emits no event for an empty
work list, so the report appears on a first launch, after a scan that adds
files, and after Generate now, and never otherwise.

Nothing reaches `CONTEXT.md`. Toasts are UI plumbing, the same call ADR 0015
made about the freshness events and ADR 0017 made about the toast itself.
