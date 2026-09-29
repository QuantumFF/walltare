# ADR 0060: Pair selection draws the least-compared Undecided wallpaper

**Status:** Accepted
**Ticket:** [#370](https://github.com/QuantumFF/walltare/issues/370), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29

## Context

Today's `select_pair` draws the least-compared Eligible wallpaper first and
weights its opponent by μ proximity. Least-compared-first is uniform
allocation: it keeps spending votes on wallpapers already Decided
([ADR 0058](0058-decided-is-the-apps-rule-and-is-never-stored.md)), and more
than half of today's pairs show two of them. The research
([#364](https://github.com/QuantumFF/walltare/issues/364)) offered index rules
from the thresholding-bandit literature for the first pick (the LSE straddle,
APT, LSA) and BALD expected information gain for the opponent. The simulation
harness chose between them: `research/sim/results/pair-selection.md` on
`research/votes-until-decided`. The figures below are for n = 500, a curator
twice as noisy as TrueSkill assumes, and k = 2.5, given as Comparisons per
wallpaper to 50% / 70% Decided and the share of Decided wallpapers on the wrong
side of the Bar.

## Decision

**The first pick is the least-compared Undecided wallpaper**, random among
ties. It leaves out Kept wallpapers, Close calls, and any wallpaper in the last
10 pairs shown. The window shrinks when it would leave nothing to draw, the way
today's exclusion of the pair on screen gives way in a small library.

**The opponent is weighted by μ proximity, as today**, drawn from every
Eligible wallpaper except the first pick and the pair on screen. Decided and
Kept wallpapers are opponents like any other.

**Unrated wallpapers.** An Unrated wallpaper's opponent always has a Score
whenever one is available, so arrivals are never paired with each other. While
at least half the Eligible pool has a Score, arrivals appear in at most every
other pair: a pair that follows one with an Unrated wallpaper draws none.
Below half, as in a fresh library or after a scan that doubles one, an Unrated
wallpaper is always the first pick, Kept included.

**A Close call is an Undecided wallpaper with a Score and σ below 1.5.** Like
k, the threshold is the app's, not a setting. Once every Eligible wallpaper is
Decided or a Close call, Rank suggests Review and keeps offering pairs. Those
pairs draw the least-compared Eligible wallpaper first, the rest of the rule
unchanged.

**k stays at 2.5.** The new rule's wrong-side rate is 0.92–1.16%, against
0.75–1.07% for today's selection.

| Rule | 50% | 70% | Wrong |
|---|---:|---:|---:|
| Today's `select_pair` | 12.14 | 27.31 | 0.75–1.07% |
| **Least-compared Undecided + μ proximity** | **9.50** | **16.22** | **0.92–1.16%** |
| Least-compared Undecided + BALD, k = 3 | 10.85 | 17.90 | 1.0–1.4%, rising to 1.9% |
| Least-compared Undecided + BALD | 8.40 | 13.78 | 1.9–2.3%, rising to 2.9% |
| LSA index + lookahead | 13.78 | 21.84 | 1.10–1.27% |

## Alternatives rejected

**An index that aims at the Bar** (straddle, APT, LSA). Each fixes on the
wallpapers sitting on the Bar: 64–90% of pairs re-show a wallpaper from two
pairs back, in streaks of 52–149 pairs, and all but LSA were slower than today
to 50% Decided. Least-compared among the Undecided already aims at the Bar by
leaving the Decided out, while spreading votes evenly over what is left.

**BALD information gain for the opponent**, which is technique 3 of the map.
It is the fastest, but it trusts the rating's σ, and σ is overconfident when
the curator is noisier than the model assumes. So its wrong-side rate doubles
and grows the longer the curator ranks. At k = 3 it is still above 1%, and
slower than μ proximity at 2.5. With a curator as consistent as the model,
every rule stays under 0.15% wrong. Estimating the curator's own consistency
would change the rating model itself, which is beyond this decision.

**Opponents limited to the Undecided** (70% at 14.59, 1.29% wrong), or to the
Decided as anchors (slower for every rule).

**Unrated-first always.** After a scan it shows an arrival in every pair. Left
to the least-compared rule, an Unrated wallpaper is ranked first anyway, so
there is no separate "by index" option. The cap costs little: 2280 votes
instead of 2130 to get 70% of 200 arrivals Decided.

**Applying the cap in a young library.** With few Scores, pairs of two scored
wallpapers start Deciding wallpapers while the Bar rests on as few as 5
Scores, with up to 2.35% wrong early. Giving every wallpaper a Score takes
about 2n votes instead of n.

**No Close call.** Without one, Rank never runs out of Undecided wallpapers
within 40 Comparisons each, so the curator is never told they can stop. σ
below 1.5 is reached at about 19 each, and leaves about a quarter of the pool
as Close calls, within about ±0.45 SD of true quality of the Bar.

**Drawing the Close calls once nothing is left** (by smallest |μ − Bar|/σ).
46–65% of pairs re-show a wallpaper from two pairs back, and the wrong-side
rate is no better. Least-compared among every Eligible wallpaper halves it at
40 Comparisons each (1.02% → 0.58%).

## Consequences

**The least Comparison count no longer climbs evenly**, which is why Round was
retired ([ADR 0059](0059-the-headline-counts-undecided-and-round-is-retired.md)).

**The repeat window and the arrival cap read what was shown**: the last 10
Comparisons, and whether the last one was either wallpaper's first. Both are
derived from the Comparison record, not held as state.

**Selection needs the Bar on every pair**: about 25 µs at 10,000 wallpapers,
on top of a draw of about 150 µs, against 273 µs for today's rule.
