# ADR 0014: Library page ordering

**Status:** Accepted
**Ticket:** [#55](https://github.com/QuantumFF/walltare/issues/55)
**Date:** 2026-08-24

## Context

The library page shows all three statuses, filterable, and offers a sort by
Score ([ADR 0013](0013-review-orders-by-mu.md)). Review's ordering is settled
and frozen: `rating_mu ASC`, Active only, 50 rows. The library page is a
browsing surface rather than a worklist, so it needs its own answer, and ADR
0013 deliberately left the default here open.

Three measurements against the live 120-wallpaper library shaped every clause
below.

**`created_at` cannot order anything.** All 120 rows hold `1787496604`, one
distinct value. `insert_new_wallpapers` batches a whole scan into a single
transaction, so `unixepoch()` stamps every row in it identically. Insertion
order survives only in `id`, and nothing in the codebase deletes a `wallpapers`
row, so `id` is a monotonic counter that is never reused.

**101 of 120 rows sit in three exact μ ties**: 45 at 25.0, 29 at 20.7948, 27 at
29.2052. `rate_1vs1` from the starting rating lands a wallpaper on one of
exactly two values, so on a young library a Score sort is mostly ties, not
mostly ranking.

**The 45 rows at 25.0 are precisely the Unrated ones, and 25.0 sorts between
the two rated groups.** A plain `rating_mu DESC` wedges 45 unjudged cards into
the middle of the grid, which is the failure ADR 0013 refused for the badge and
then left open for the ordering.

## Decision

Four named orderings, each with its direction baked in:

| Name | `ORDER BY` |
| --- | --- |
| Score, high to low (default) | `comparisons_count = 0, rating_mu DESC, id ASC` |
| Score, low to high | `comparisons_count = 0, rating_mu ASC, id ASC` |
| Filename, A to Z | `filename COLLATE NOCASE ASC, id ASC` |
| Recently added | `id DESC` |

**The frontend picks a name, never a column or a direction.** The backend maps
each name to exactly one clause and owns every part of it. A frontend that
supplies a sort key concatenates it into SQL, and the pagination that #46 picks
needs the backend to know the key anyway.

> **[ADR 0016](0016-library-page-scale.md), 2026-08-25.** #46 picked no
> pagination. `list_wallpapers` returns every matching row, so the second half
> of that sentence no longer applies. The decision stands on the injection
> ground by itself. The `id` tiebreak below survives for a different reason than
> the one given: not to stop a card duplicating across pages, but to stop the
> 101-row tie reshuffling under the user after every vote.

**Unrated is a tail group in both Score directions.** The leading
`comparisons_count = 0` term evaluates to 0 for a rated wallpaper and 1 for an
unrated one, and it does not flip with the direction. A wallpaper with no Score
is not the best and not the worst, so it reads as a constant tail rather than
sorting into the middle on the strength of a starting value. This is ADR 0013's
`Unrated` rule applied to position instead of to the badge.

**Every ordering ends in `id`.** With 101 rows in three tie groups, a bare
`rating_mu DESC` leaves SQLite free to return tied rows in any order, and a plan
change can reorder them between two calls. Under pagination that duplicates
cards on one page and drops them from another. `id` costs nothing, it is the
primary key, and it is the difference between a grid that holds still and one
that reshuffles after a vote.

**Recently added orders by `id DESC`, not `created_at`**, per the measurement
above. `created_at` stays off the `Wallpaper` DTO.

**Filename collates `NOCASE`**, because SQLite's default BINARY collation puts
every capital ahead of every lowercase letter, so `Zebra.jpg` would precede
`abstract.jpg`. The key is the filename rather than the path, since that is what
the card shows; two files sharing a basename in different folders fall to the
`id` tiebreak.

**The default is Score, high to low.** It is the one view neither Rank nor
Review gives, and it is what the app exists to produce.

**The chosen ordering does not persist across relaunches.** It survives
navigating away and back within one run and resets to the default on launch.
[ADR 0010](0010-settings-store.md) closed the settings key set to `theme`,
`library_root` and `reject_destination`, and view state is not a preference the
user set.

The command signature, the pagination shape, and the indexes are
[#46](https://github.com/QuantumFF/walltare/issues/46)'s to design around these.

## Alternatives rejected

**A sort key plus a direction toggle.** Doubles four entries to eight, and half
of them ("Filename, Z to A", "Oldest added first") are entries nobody picks
while each costs #46 another pagination case. Four fixed orderings are four
sentences a user can read.

**Leaving Unrated at μ = 25.0.** It is the starting value, so it places 45 cards
by the app's ignorance and calls it a ranking. ADR 0013 already refused to print
that number for the same reason.

**Unrated first when sorting low to high.** Symmetrical and wrong: it says the
unjudged wallpapers are the worst ones, which is the inversion ADR 0013 spent
its length rejecting.

**Filename A to Z as the default.** The honest fallback while the ranking is
young, since it never reshuffles under a vote. Rejected because a default chosen
for a young library never becomes the right default later, and the tie at the top
of a Score sort is visible in the badges rather than hidden.

**A default status filter of Eligible (Active + Kept).** It would make the
frozen-Score problem below vanish by construction. Rejected because the library
page's promise is everything the app knows about, and a default that hides
rejects turns "where did that one go" into a hunt.

**Natural sort, so `pic2` precedes `pic10`.** Needs a computed sort column or
client-side ordering, and the live library's `wallhaven-*` names carry no
numbering for it to fix.

**Persisting the ordering in the `settings` table.** Reopens a key set ADR 0010
closed on purpose, for view state that costs one click to restore.

**`comparisons_count` and `status` as sort keys.** Status is what the filter is
for. Comparison count is a diagnostic, and it already appears in the hover
overlay per ADR 0013.

## Consequences

**The tail term drops `idx_wallpapers_status_rating_mu` coverage.** A leading
`comparisons_count = 0` cannot be served by an index on `(status, rating_mu)`,
so both Score orderings sort in memory. At the design target of a few thousand
rows this is not worth an index; if it becomes one, the index is on
`(status, comparisons_count, rating_mu, id)`.

> **[ADR 0028](0028-review-joins-the-listing-vocabulary.md), 2026-09-03.** That
> index is the wrong one and was never tested. Measured, it still plans `USE
> TEMP B-TREE FOR ORDER BY`, because the clause sorts the expression
> `comparisons_count = 0` while the index holds the column, and the two do not
> order rows the same way. The index that covers the query fully, with no sort,
> is the expression index `(status, comparisons_count = 0, rating_mu, id)`. The
> judgement above stands: it is still not worth adding, and ADR 0028 declined to
> add it for Review as well.

**A young library opens on a tie.** The first 27 cards all read 29.2 and sit in
`id` order. That is true, and the badges say so.

**The library's "Score, low to high" is not `get_review`.** It differs in two
ways: the Unrated tail, and the `id` tiebreak. ADR 0013 froze `get_review`
verbatim, so if #46 folds Review into this page it has to decide which of the
two orderings Review then gets. This ADR does not decide that.
([ADR 0016](0016-library-page-scale.md) declined to fold them, so the question
does not arise: Review keeps its own page and `get_review` is untouched.)

> **[ADR 0028](0028-review-joins-the-listing-vocabulary.md), 2026-09-03.** It
> arose anyway, from the other direction. The pages are still not folded, but
> the clause builder behind them is, so Review's ordering had to be settled
> before the two `ORDER BY` tables could become one. It takes both differences,
> the tail and the tiebreak, so this clause and Review's are now the same
> clause. `get_review` is gone; `list_wallpapers` grew an optional limit.

**ADR 0013's claim that Unrated is invisible on the review list is wrong**, and
is corrected there. Only 38 Active rows sit below μ = 25.0, so slots 39 to 50 of
today's review list are filled from the 45-row tie at exactly 25.0, in an order
nothing chose. 12 of 50 review cards read `Unrated`.

> **[ADR 0028](0028-review-joins-the-listing-vocabulary.md), 2026-09-03.**
> Re-measured: 40 rows below 25.0, a 43-row tie, and 10 of 50 cards. "In an
> order nothing chose" understates it, because the boundary cuts the tie, so
> which of the 43 appear is unspecified too. Fixed there.

**The default filter of All means a Score sort mixes live and frozen numbers.**
A Rejected wallpaper sits out of voting, so its Score is its standing at the
moment it was rejected, and months later it ranks against a distribution that no
longer exists. It renders without a caveat: a Rejected card is greyed and
carries its comparison count, so a high-ranking fossil is legible. This is the
clause most likely to need revisiting once a library has a year of rejects in it.

**`NOCASE` folds ASCII only.** `Ábstract.jpg` still sorts apart from
`ábstract.jpg`. SQLite's built-in collations do not do Unicode case folding
without ICU, and that is not worth a build dependency here.

**No new settings key, and no schema change.** Nothing in this ADR touches the
database beyond the `ORDER BY` clauses.
