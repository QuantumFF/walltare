# ADR 0028: Review joins the listing vocabulary, tail and tiebreak included

**Status:** Accepted
**Ticket:** [#156](https://github.com/QuantumFF/walltare/issues/156)
**Date:** 2026-09-03

## Context

The app has two listing commands and only one listing vocabulary.

`get_review` (`db.rs:487-500`) is `WHERE status = 'active' ORDER BY rating_mu
ASC LIMIT ?1`. Its `WHERE` is the exact string `StatusFilter::Active`'s
`where_clause` already returns (`db.rs:525`). Its `ORDER BY` is not
`ListOrdering::ScoreAsc` (`db.rs:572`), which is `comparisons_count = 0,
rating_mu ASC, id ASC`. Review has neither the Unrated tail nor the `id`
tiebreak, and the `LIMIT` is the only thing it contributes that
`list_wallpapers` cannot express.

Three ADRs walked up to this and stopped. [ADR
0013](0013-review-orders-by-mu.md) froze the query verbatim, on a question about
which statistic orders the list rather than about ties underneath it. [ADR
0014](0014-library-page-ordering.md) named the divergence in its own
consequences and wrote "This ADR does not decide that." [ADR
0016](0016-library-page-scale.md) declined to fold the two pages, and concluded
the ordering question therefore does not arise. It arises now because this is a
fold of the builder rather than of the pages.

**Re-measured against the live library, 2026-09-03.** 120 rows, all 120 Active,
no Kept and no Rejected. 43 Unrated, all at exactly 25.0. 40 Active rows sit
below 25.0. So `LIMIT 50` takes those 40 and then reaches into the 43-row tie at
the starting value for ten more, and **10 of the 50 review cards read
`Unrated`**. This corrects the numbers in ADRs 0013 and 0014, which measured 45
Unrated, 38 rows below 25.0 and 12 cards, all against a library that has taken
votes since.

The measurement sharpens the question the two earlier ADRs asked. They both
described this as an ordering defect: the last twelve cards are "picked by
nothing at all". It is worse than that. The `LIMIT` boundary lands *inside* a
tie group, and no clause breaks the tie, so what is unspecified is **which ten
cards Review shows at all**, not the order they come in.

## Decision

### Review takes the Unrated tail

The decisive argument is not symmetry with the library page. It is that
**Unrated belongs to Rank, not to Review.** `select_pair` draws the first of each
pair from the least-compared ties (`ranking.rs:59-64`), so a wallpaper with no
comparisons is already queued by the surface built to give it one. Review is
worst-first triage of what the ranking has judged. A card whose position asserts
"one of the fifty worst" while its badge admits it holds no measurement is the
contradiction ADR 0013 refused for the badge, and ADR 0014 then fixed for the
library by moving it from the badge to the position. Review gets the same fix
for the same reason.

**This changes behaviour, and it is one of the two exceptions this map allows.**
On today's library the new top 50 is 50 rated cards and zero `Unrated` ones,
overlapping the current 50 by exactly 40. The ten replacements are 3 rows at
μ 25.039, 1 at 26.385, 1 at 28.537, and 5 out of the 25-row tie at 29.2052.

The cost is honest and worth stating: those ten slots hold above-average
wallpapers, which is weak material for a worst-first worklist. But Review's
fifty is larger than this library's supply of genuinely condemned wallpapers, so
slots 41 to 50 are filler either way. The tail picks filler by measurement.
Today picks it by nothing.

### Review takes the `id` tiebreak

Load-bearing rather than cosmetic, for the reason above: because the limit
boundary cuts a tie group, the tiebreak decides membership. Today it cuts the
43-row tie at 25.0. With the tail adopted it cuts the 25-row tie at 29.2052,
taking 5 of 25. Without a tiebreak SQLite may return tied rows in any order and
a plan change can reorder them between two calls, so Review's last cards appear
and disappear across fetches.

Review fetches on mount, on Refresh, and on `library-scanned` with `added > 0`
(`useRefetchWhenShown`, `AppEventsContext.tsx:206-240`). Not on every view
switch, so this bites less often than on the library page, and it bites harder
when it does: an ordering wobble on the library page reshuffles cards, and on
Review it swaps them out.

### One builder, with an optional limit

```rust
list_wallpapers(conn, filter, ordering, limit: Option<i64>) -> Vec<Wallpaper>
```

`get_review` goes from `db.rs`, from the command surface in `lib.rs`, and from
`client.ts`. Review calls `client.listWallpapers("active", "score_asc",
REVIEW_LIMIT)`, and `REVIEW_LIMIT` stays where it already is, in
`ReviewView.tsx`.

Two clause builders become one, one `ORDER BY` table owns every ordering in the
app, and a fix to a tie clause lands once. Delete the module and the complexity
concentrates in `list_wallpapers` rather than redistributing to callers, which is
the test this passes and a wrapper would not. The limit has two real callers,
Library's `None` and Review's `Some(50)`, so the parameter is a variation that
exists rather than one that might.

**An optional limit is not the pagination ADR 0016 refused.** No offset, no
cursor, no page token, and one caller passing one constant. That ADR fetched
everything to delete the keyset-versus-offset question, the index question and
every page-boundary bug, and a single bounded worklist reopens none of them.

**One property does narrow.** ADR 0016 has it that the row count is the size of
the library, so nothing asks a second question to find that out. That now holds
only when the caller passes no limit. Library passes none and prints
`rows.length` (`LibraryView.tsx:643`); Review passes 50 and prints no count. The
`client.ts` docstring says so.

`get_review`'s `limit <= 0` guard returns an empty list and survives with its
three tests. The SQL emits `LIMIT ?1` unconditionally and passes
`limit.unwrap_or(-1)`, because SQLite reads a negative limit as unlimited. That
keeps one SQL string, one `prepare_cached` entry and one code path, and costs one
comment naming the -1.

### The lost index coverage is recorded, not indexed

Today's `mu ASC` runs as `SEARCH wallpapers USING COVERING INDEX
idx_wallpapers_status_rating_mu (status=?)`, with no sort at all. `ScoreAsc` adds
`USE TEMP B-TREE FOR ORDER BY`, because a leading `comparisons_count = 0` cannot
be served by an index on `(status, rating_mu)`. So ADR 0013's "
`idx_wallpapers_status_rating_mu` keeps covering `get_review`" stops being true
with this decision, and the `LIMIT` stops saving query work: SQLite sorts every
Active row with or without it, and the `LIMIT` trims JSON bytes only.

**ADR 0014's named remedy for this does not work.** It names an index on
`(status, comparisons_count, rating_mu, id)`. Measured: still `USE TEMP B-TREE
FOR ORDER BY`, because the clause sorts an expression and the index holds the
column. An expression index on `(status, comparisons_count = 0, rating_mu, id)`
covers the query fully and drops the sort. Recorded here so the remedy is the
right one when somebody reaches for it.

It is not added. Nobody has timed the temp B-tree, ADR 0016 accepts an in-memory
sort for both Score orderings at the 5,000-row ceiling, and the library page has
paid this exact cost since #46 with no complaint. A schema change wants a
measurement first.

### Review's bar keeps its sentence

"Lowest Scores first" stays. After the tail it describes all fifty cards
correctly for the first time, because the ten it currently mislabels are gone.

## Alternatives rejected

**No backend limit; Review slices fifty in the frontend.** Tempting, since the
`LIMIT` buys no query time and Review fetches rarely. Rejected because a
client-side slice over the live list **backfills**: keep three cards today and
Review shows 47 until a refetch, and a slice slides position 51 up to fill.
That is a second behaviour change arriving free as a side effect of where a
slice sits, which is what this map's charting round ruled out. Slicing once at
fetch time instead preserves the behaviour and pays 1MB at the ceiling for a
list it discards. Whether the worklist should refill is a real question and it
belongs to whoever asks it on purpose.

**`get_review` kept as a wrapper over the unified builder.** Keeps the command
name and pays with a module whose interface is as large as its implementation,
which is the shape to avoid.

**A fifth `ListOrdering` for `mu ASC` with no tail.** What a no on the tail
would have needed, and the reason the ordering had to be settled before the
builder. Four fixed orderings are four sentences a user can read (ADR 0014); a
fifth that no control offers and one caller passes is a clause hiding in an
enum.

**Drop the fixed fifty and show the Active rows below μ = 25.0** (40 today), the
ones the ranking actually condemns. It reads well and it invents 25.0 as a
threshold constant, which ADR 0013 refused three separate times, and ADR 0016
defines Review as "a fifty-row worklist that exists to be swept".

**`Option<NonZeroU32>` for the limit.** The stricter type, and it makes zero and
negatives unrepresentable rather than guarded. Rejected because it changes what
the wire does with `0` from an empty list to a deserialization error, and no
caller can reach that case: the frontend passes the constant 50. A wire-contract
change for an unreachable input is not worth three tests.

**Reopening ADR 0013's freeze on μ against μ − 3σ.** Not reopened, and nothing
here touches it. That decision was about which statistic orders the list. This
one is about ties and unrated rows underneath it.

## Consequences

**Review keeps its own page.** The UI fold ADR 0016 refused is still refused.
What unified is the clause builder behind both pages, and the ordering question
that fold would have forced is answered here on its own terms rather than
absorbed into a merge, which is what that ADR was protecting.

**Three ADRs need amending.** ADR 0013's freeze is lifted and its "Nothing in
the query changes" no longer holds, its claim about index coverage no longer
holds, and its measurement is corrected. ADR 0014's open question is answered
and its index expression is corrected. ADR 0016's "Review keeps its own page and
its own command" keeps the page and loses the command.

**Ten of fifty cards change today, and that number shrinks on its own.** The
tail is only visible while Review's fifty exceeds the rated Active rows. Once
every Active wallpaper has one comparison the tail is empty and the term costs
nothing.

**A freshly scanned library with no votes is the degenerate case.** Every row is
Unrated, the tail is the whole list, and Review's fifty come out of one enormous
tie in `id` order. The tiebreak makes that deterministic rather than meaningful,
and Rank is where that library wants the curator anyway.

**`get_review`'s four `db.rs` tests move to the unified builder**, and the four
frontend `beforeEach` blocks that register the command by its Rust name string
have to follow. Those fixtures are what catches a missed rename, since the
frontend tests drive the real components against a mocked IPC seam.

**`CONTEXT.md` gains nothing.** Score, Status and Round already carry every term
this decision needed, and nothing here is a new domain concept.
