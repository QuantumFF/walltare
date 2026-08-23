# ADR 0008: Round is derived, and progress is measured within the round

**Status:** Accepted
**Ticket:** [#38](https://github.com/QuantumFF/walltare/issues/38)
**Date:** 2026-08-24

## Context

`CONTEXT.md` left an open question under Evaluated / Participated: the progress
headline uses Participated only, and which of the two should headline was
undecided.

`get_stats` reports `percentage` as `participated_count / total_wallpapers`.
Both halves of that fraction are wrong.

The denominator counts every row regardless of Status, Rejected included.
Today the scan view is the only entry point and nothing shows rejects, so the
error is invisible. A library page that lists all three statuses makes it
visible: reject a third of a library and the progress bar drops by a third
while the voting pool it claims to describe has not changed.

The numerator is worse, because it is provably constant. Participated means
`comparisons_count > 0`. The moment `min(comparisons_count)` reaches 1, every
eligible wallpaper has participated, so `participated_count == eligible_count`
and stays there. The headline's most prominent number is pinned to the pool
size for the entire life of a warm library, which is why it reads as static.

There is already a round-like behaviour to name. `select_pair` picks the
least-compared wallpaper first, random among ties (`ranking.rs:59-64`), so the
app has been sweeping the library in passes since it shipped. It picks the
*opponent* by μ-similarity across the whole pool with no regard for comparison
count (`ranking.rs:66-93`). Counts therefore do not advance in lockstep: each
vote advances one guaranteed laggard and one arbitrary wallpaper, so a wallpaper
in a crowded μ-band runs well ahead of the floor.

## Decision

A Round is derived. Nothing about it is stored.

```
round    = min(comparisons_count) + 1   over status IN ('active', 'kept')
progress = |{ w : w.comparisons_count >= round }| / eligible_count
```

An empty eligible pool reports round 1 and 0%: the app is always about to run
round 1, and a null forces every consumer to branch on a state that has nothing
to say.

`Stats` becomes:

| field | meaning |
| --- | --- |
| `total_wallpapers` | all rows, any Status |
| `eligible_count` | Active + Kept; the denominator for every fraction below |
| `round` | as above |
| `round_participated_count` | eligible with `comparisons_count >= round` |
| `evaluated_count` | eligible with `rating_sigma < 4.0` |
| `total_comparisons` | all comparison rows |

`participated_count` and `percentage` are gone. The frontend divides
`round_participated_count / eligible_count` for the bar, which is the one part
of this it can derive.

The headline reads Round, within-round percentage, and evaluated count:

```
Round 4 · 82%          61 / 120 Evaluated
                          487 Comparisons
```

The Round element carries a hover and focus explanation that states the rule
and grounds the percentage in real counts: "Round 4: 98 of 120 wallpapers have
been compared at least 4 times." Round appears in the rank view only.

## Alternatives rejected

**Progress as the share at or above the round's comparison count.** The first
phrasing of this decision, and it is degenerate. Round 4 means the floor is 3,
and every eligible wallpaper is at or above the floor by construction, so the
measure reads 100% permanently. The comparison has to be against `round`, not
against `round - 1`.

**A monotonic Round that never decreases.** Rejecting the single least-compared
wallpaper removes the floor and jumps the Round forward, so "Round 3 · 99%" can
become "Round 4 · 15%" from one click on a library page. A mid-session scan runs
the other way: 400 unseen files drop the Round back to 1. Both look like
regressions.

A ratchet fixes the look by lying. After a scan, "still Round 4" asserts that
every wallpaper has been compared three times when 400 of them have never been
seen, and that is the exact claim the number exists to make. It also needs a
stored high-water mark, which is the state this decision exists to avoid.

**Keeping `participated_count` for continuity.** It ships a field that is
identically equal to `eligible_count` in every state where the round is past
its first pass, and during round 1 it equals `round_participated_count`. Someone
would eventually build on it.

**Correcting `percentage`'s denominator in place.** `AppContext.tsx:27` gates
the whole app on `total_wallpapers > 0`; it is what stops a returning user being
stranded on the scan view. Narrowing that field to eligible rows would strand
anyone whose library is entirely rejected. The two counts are different
questions and get different fields.

**Deriving the round in TypeScript.** It needs `|{w : count >= round}|`, an
aggregate over per-wallpaper counts. The frontend only ever receives aggregates,
so it cannot compute this from what `get_stats` returns. Not a trade-off, just
not possible.

## Consequences

The bar never visibly reaches 100%. Filling it is the same event as the floor
rising, so the last vote of a round takes the percentage to 100 and recomputes
it against the new round in the same update. It lands somewhere above zero,
because μ-weighted opponent picks have already pushed part of the pool ahead.

The Round moves in both directions for good reasons. The hover string is the
whole mitigation: there are no round-transition events, no toast, and no
completion state. For the scan case the honest place to say it is the
scan-complete path, not the headline.

The denominator on screen changes from `total_wallpapers` to `eligible_count`,
so once rejects exist the totals the user is used to seeing get smaller. That is
the correction, and it will read as a regression to anyone who does not know.

`CONTEXT.md` now names the σ < 4.0 threshold as part of Evaluated instead of
leaving it as a bare literal in SQL. Whether 4.0 is the right threshold is a
ranking-quality question and is not settled here.

A library that is entirely Rejected still passes the boot gate and lands on the
rank view, where pair selection fails. That is untouched by this ADR and belongs
to the navigation shell.

The removals are mechanical but wide: `voting.rs:31-37` and its tests at `:475`,
`:556` and `:577`; `client.ts:21-27`; `RankView.tsx:311`, `:317` and `:329`;
`fixtures.tsx:24-25`; `RankView.test.tsx:141` and `:177-179`. Both round queries
are covered by the existing `idx_wallpapers_status_comparisons` index.
