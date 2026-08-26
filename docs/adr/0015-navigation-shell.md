# ADR 0015: Navigation is a union, and views stay mounted

**Status:** Accepted
**Ticket:** [#45](https://github.com/QuantumFF/walltare/issues/45)
**Date:** 2026-08-24

## Context

`Layout.tsx` is a three-way switch on a `View` union held in `AppContext`, and
`AppProvider` bootstraps away from `scan` whenever `total_wallpapers > 0`
(`AppContext.tsx:27`). So there is no route back to the scan screen at all
today, and the only navigation in the app is two `setView` calls buried in
Review's header. The overhaul adds Library and Settings, and folds scan into
Settings as the Library folder field, which breaks that pattern rather than
extending it.

The switch itself is not what costs anything. What a switch costs is.

`wallpaper://` responses carry `max-age=0, must-revalidate`, and `resolve_image`
has no conditional-request path: every request runs plan, fulfill and record and
returns a full 200 with the whole body (`lib.rs:279-297`). Revalidation was
deliberately made cheap rather than free, because the URL is keyed on id and
size only and the invalidation is mtime-based. The consequence for navigation is
that remounting Review is 50 complete IPC round trips and 50 cache-file reads.
That is the ~25 dropped frames [ADR 0006](0006-first-view-thumbnail-latency.md)
measured on entering Review, paid again every time the user glances at Library
and comes back. `get_review` itself costs 0.3ms.

So the thing worth carrying across a view switch is rendered DOM and fetched
images. It is not JSON, which is what a cache would have saved.

Two decisions were handed here explicitly.
[ADR 0008](0008-round-is-derived.md) leaves "a library that is entirely Rejected
still passes the boot gate and lands on the rank view, where pair selection
fails" to the navigation shell. [ADR 0010](0010-settings-store.md) leaves
whether a configured `library_root` changes the boot view here too.

## Decision

### The union stays, and there is no router

`View` widens to `"rank" | "review" | "library" | "settings"`. `scan` is
deleted, and `ScanView` dissolves into the Settings page.

A router buys URL synchronisation, nested routes, a history stack and code
splitting. This app has no URL bar to synchronise, no window-chrome back button,
one level of nesting, and a bundle too small to split. What it would cost is a
dependency, a rewrite of `Layout`, and a wrapper in four test files.

### Settings is a peer view that remembers where you came from

The prototype ([#44](https://github.com/QuantumFF/walltare/issues/44)) settled
page over sheet, and a page has no back. So the gear records the current view as
a `returnTo` and Settings closes to it. While Settings is up no tab is
underlined and the gear takes the active treatment.

> **Amended by [ADR 0020](0020-settings-page.md), 2026-08-26.** The navigation
> call carries an optional field key beside `returnTo`, typed as
> `keyof Settings`, which focuses that input on arrival. ADR 0018's
> `change in Settings` control needed it. Three things close the page: Escape,
> the gear again, or clicking a tab. Escape belongs to the Settings page rather
> than to the shell handler below, which is suppressed while focus is in a text
> field, and this page is mostly text fields. With no `returnTo`, meaning boot
> landed the user here, Escape does nothing and the tabs are the way out.

One rule covers the other layered surface: changing destination closes the
lightbox, so a preview never outlives the list it was walking.

### Rank, Review and Library stay mounted; Settings does not

Each of the three mounts on first visit and is hidden with `display: none`
thereafter. Data, DOM, scroll position and the browser's image work all survive
a switch, which is the whole point given what a remount costs. Rank earns it
twice over, because its prefetched pair is state rather than pixels and a
remount throws it away.

Settings unmounts, so its fields re-read the store rather than holding a stale
copy of it.

Returning to Library puts the user back where they were, for the lifetime of the
app run and not across relaunches. The position resets when the filter or the
ordering changes, because a position means something different in a reordered
list, and [ADR 0014](0014-library-page-ordering.md) already refused to persist
the ordering itself.

### Freshness is four events, not a cache

Mounted views have to hear about mutations that happened somewhere else: a
reject in Review changes a row in Library. The shell publishes a discriminated
union in `CONTEXT.md`'s vocabulary:

| event | payload | who cares |
| --- | --- | --- |
| `status-changed` | wallpaper id, new Status | Review, Library |
| `score-changed` | the two ids in a Comparison | Library |
| `stats-changed` | the new `Stats` | Rank's headline |
| `library-scanned` | added count | Review, Library |

Three of the four are **patches**. A reject tells Library that wallpaper 7 is
now Rejected and Library edits that row in place: no query, no thumbnail
request, and the card is already rendered. Only `library-scanned` changes which
rows exist, and only it forces a refetch.

Patches apply immediately whether the view is showing or not, because they cost
nothing. A refetch defers until the view is next shown.
[ADR 0012](0012-thumbnail-pre-generation.md) gave pre-generation one dedicated
thread precisely so background image work never queues ahead of the rank view's
next pair, and a hidden Library pulling its first page mid-vote walks straight
back into that. A deferred refetch that changes the row set resets scroll to the
top, the same rule a reorder gets.

None of this reaches `CONTEXT.md`. It is UI plumbing, and the glossary stays
free of implementation.

### Boot reads the library, not the preference

One `get_stats`, four outcomes:

| state | opens on |
| --- | --- |
| `eligible_count >= 2` | Rank |
| wallpapers exist, fewer than two Eligible | Library |
| empty library | Settings, dressed as a first run |
| `get_stats` failed | Settings, showing the error |

`get_pair` needs two eligible wallpapers (`voting.rs:74`), and
[ADR 0008](0008-round-is-derived.md) already adds `eligible_count` to `Stats`,
so the gate can tell an empty library from a wholly rejected one without
touching the DTO again. That is the answer to what ADR 0008 handed over.

The last two rows both open Settings and must not look alike. "You have not
scanned yet" and "the database is locked" are different problems, and today they
produce the same screen.

`library_root` plays no part. `CONTEXT.md` calls it a stated preference that can
point somewhere that no longer exists, so the boot rule reads what the library
contains. That is the answer to what ADR 0010 handed over.

Nothing is persisted, and the rule reruns exactly once after boot: on
scan-complete where the library was empty before the scan and is not after.

### No tab is ever disabled

Every destination is always reachable, and each owns an empty state that names
the reason with the counts and offers the route out. Rank with fewer than two
Eligible wallpapers reads "120 wallpapers, all Rejected. Restore some from
Library" rather than surfacing `NotEnoughWallpapers` as an error string.

A disabled tab is a dead end that explains nothing, and the states this app can
reach all have an explanation worth reading.

### Keyboard

Bare arrows are spoken for twice: Rank votes with them and the lightbox walks
with them. So `Ctrl+1`, `Ctrl+2` and `Ctrl+3` reach Rank, Review and Library,
and `Ctrl+,` reaches Settings. `?` opens a shortcuts dialog mounted in the shell.

One handler lives in the shell, suppressed while focus is in a text field and
while the lightbox is open. The tab bar is an ARIA tablist with roving tabindex,
so arrow keys work inside the bar and nowhere else.

**Amended by [ADR 0019](0019-library-card-affordance.md).** Two corrections to
the paragraphs above.

"Arrow keys work inside the bar and nowhere else" was already false and is now
deliberately false: Rank votes with them and the lightbox walks with them, and
ADR 0019 gives the library and review grids a roving selection of their own. The
rule that holds is that the shell handler owns global shortcuts while bare arrows
belong to whichever element has focus, or to the view when nothing in it does.

Keeping a view mounted under `display: none` keeps its `window` listeners live,
which this ADR did not follow through on. `RankView.tsx:254` binds `ArrowLeft`
and `ArrowRight` on `window`, so arrows pressed anywhere in Library or Review
were voting in a hidden view. Rank's handler gates on the current view. Any
future view-scoped global listener owes the same gate.

### The scan subscription moves into the shell

`ScanView` subscribes to the scan events and calls `setView("rank")` on any
completion (`ScanView.tsx:52`). Once a scan starts from inside Settings it
finishes while the user is on some other page, and three things hang off the
event: [ADR 0012](0012-thumbnail-pre-generation.md)'s pre-generation trigger,
ADR 0008's "back to Round 1" message, and `library-scanned`.

So the subscription lives in the shell, above the view swap, and scan-complete
no longer navigates. The one exception is the boot rule's single rerun above: an
empty library that now has wallpapers lands on Rank. A rescan of an existing
library reports and leaves the user where they are.

The Toaster mounts in the shell for the same reason, which is what
[#49](https://github.com/QuantumFF/walltare/issues/49) was waiting on.

## Alternatives rejected

**A router.** `react-router` or TanStack Router would give history, deep links
and nested layouts. There is nothing here to deep-link into, no back button in
the window chrome, and one level of nesting. Adding one also does not touch the
expensive problem, because a router unmounts routes by default and would make
the 50-request remount the norm rather than the exception.

**TanStack Query.** The standard answer to cross-view freshness, and it solves
the wrong half. It caches JSON worth 0.3ms and does nothing for DOM, scroll, or
the 50 image requests that are the actual cost. With views kept mounted there is
no cache left to manage: each view already holds its list in state and needs
only to be told what changed.

**Unmount views and cache the DTOs in the shell.** Same mistake without the
dependency. The images refetch regardless.

**One "something changed" ping.** Simple, and it makes a vote invalidate
Library, which then refetches thousands of rows because two Scores moved. That
blunt shape is exactly what sends people reaching for a query library, and the
typed events avoid needing one.

**Refetching a hidden view eagerly, so it is fresh when shown.** It puts dozens
of thumbnail requests in flight during the one activity ADR 0012 built a
dedicated thread to protect.

**Persisting the last view as a settings key.** ADR 0010's key set stays closed
and ADR 0014 already refused to persist the library ordering for the same
reason. The boot rule is computed from the library's state, which is more useful
than where the user happened to be last: a returning user whose library is now
fully rejected wants Library, not the Rank view they left.

**Booting from `library_root`.** A configured root proves the user typed
something, not that a scan ever succeeded. ADR 0010 is explicit that the field
records what was configured rather than what was last scanned.

**Disabling a tab whose destination is empty.** Cheap to build and it removes
the one place where the reason could have been written down.

## Consequences

**The hide-and-show claim is unmeasured, and
[#46](https://github.com/QuantumFF/walltare/issues/46) measures it.**
[ADR 0007](0007-review-card-layer-promotion.md) documents a 50-95ms stall per
card the first time WebKit promotes its layers, and `display: none` may well
drop those layers and re-promote them on show. #46 is already relaunching the
frame-timing harness against a virtualised grid for that same ADR, and the map's
harness needs a binary relaunch per variant, so a second standalone run buys one
number at full price. Pass condition: showing a previously-hidden Library or
Review drops no more frames than remounting it does. Fallback if it fails: Rank
stays mounted regardless, and whichever image-heavy view fails is unmounted,
falling back to the events above with the refetch cost accepted.

**Three views' DOM stays alive at once.** Review is bounded by `REVIEW_LIMIT`
and Library is bounded by whatever virtualisation #46 settles on, so the ceiling
is a few dozen cards each rather than the low thousands.

**The first visit to each destination still pays in full.** Nothing here
prefetches; pre-generation under ADR 0012 is what makes that first visit
survivable, and it is unchanged.

**`tests/AppContext.test.tsx` is rewritten.** All three of its tests assert the
`total_wallpapers > 0` bootstrap and the scan screen it lands away from, and
both halves are gone.

**`ScanView.tsx` stops being a view.** Its `scanStartError` switch, its progress
state and its event subscriptions split between the Settings page
([#58](https://github.com/QuantumFF/walltare/issues/58)) and the shell.

[ADR 0020](0020-settings-page.md) deletes the file rather than emptying it, and
splits the switch by reading what each kind carries: `InvalidPath`'s message is a
bare path, so its frontend sentence survives, while `SCAN_IN_PROGRESS_ERROR`
dies because the backend already says that sentence and `NO_IMAGES_ERROR` moves
to [#59](https://github.com/QuantumFF/walltare/issues/59) with the event it
arrives on.
