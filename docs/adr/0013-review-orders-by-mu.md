# ADR 0013: Review orders by μ, and the Score badge shows it

**Status:** Accepted
**Ticket:** [#43](https://github.com/QuantumFF/walltare/issues/43)
**Date:** 2026-08-24

## Context

`get_review` orders by `rating_mu ASC` (`db.rs:297`). The UI overhaul asked
whether it should order by the TrueSkill conservative score, `mu - 3 * sigma`,
which is what leaderboards publish and what the reference implementation's own
notes reach for.

It should not, and the reason is that the review list ranks worst-first.

`mu - 3σ` is the *lower* bound on a rating. A best-first leaderboard sorted by
it descending is conservative because it refuses to crown a player who has not
proved it. A worst-first list sorted by it ascending is the opposite: it
condemns the wallpaper that has not proved anything.

| | μ | σ | comparisons | μ − 3σ | μ + 3σ |
| --- | --- | --- | --- | --- | --- |
| A, consistently loses | 15.0 | 2.0 | ~20 | **9.0** | **21.0** |
| B, one unlucky loss | 18.0 | 7.0 | 1 | **−3.0** | **39.0** |

`mu ASC` heads the list with A. `mu - 3σ ASC` heads it with **B**, on the
strength of one bad night, which is the precise failure the change was proposed
to fix.

The correct mirror of a leaderboard's conservative score is the upper bound,
`mu + 3σ ASC`: even at its best, this one is bad. That ordering is defensible.
It is also close to unnecessary here, because `select_pair` draws the first of
each pair from the least-compared ties (`ranking.rs:59-64`), which holds
comparison counts within roughly one of each other and so pins σ to a narrow
band. Measured against the live 120-wallpaper library, σ spans 6.813 to 7.267
across every wallpaper at one comparison and 6.069 to 6.497 at two. A ±3σ term
reorders far less than the worked example suggests.

## Decision

`get_review` keeps `ORDER BY rating_mu ASC`. Nothing in the query changes.

**Score is μ.** The card badge shows it to one decimal, the number alone. The
word Score appears in the hover overlay, the lightbox caption, and the library
page's sort control, not on the badge itself. Because the ordering is μ, the
number on the badge and the card's position in the grid agree, and that
agreement is the property the display rests on.

**Confidence is Evaluated, unchanged.** σ < 4.0, the threshold `CONTEXT.md`
already names. The badge renders solid when the wallpaper is Evaluated and
dimmed or outlined when it is not. No second number, no new constant, no bands:
the app keeps one definition of confidence.

**A wallpaper with zero comparisons reads `Unrated`** in place of the number.
Every one of them holds exactly 25.0, which is the starting value, not a
measurement.

**`comparisons_count` appears in the hover overlay**, next to the filename. It
is how the user reads how much the Score is worth.

The badge is one component with identical rules wherever it renders: review
cards, library cards, and the lightbox caption. The library page offers a sort
by Score. Placement, card design, and the library page's *default* ordering
belong to [#44](https://github.com/QuantumFF/walltare/issues/44) and
[#46](https://github.com/QuantumFF/walltare/issues/46).

`rating_sigma` and `comparisons_count` are already on the `Wallpaper` DTO, so
none of this needs backend work.

## Alternatives rejected

**`mu - 3 * sigma ASC`.** The proposal, and inverted for this list, as above.
Recorded here so it is not proposed a third time.

**`mu + 3 * sigma ASC`.** The honest conservative ordering for a worst-first
list, and the shape to use if this is ever revisited. Rejected on cost, not on
correctness: it drops `idx_wallpapers_status_rating_mu` coverage in favour of a
computed sort, and it breaks badge/order agreement unless the badge changes to
match, so either both move or neither does. What it buys is a reshuffle of a
50-item list whose false positives cost the user one glance. `get_review`
measured at 0.3ms, so performance is not the argument; the argument is that a
reversal of a choice `get_review` was built around should return more than this.

**Three confidence bands.** Two of the three thresholds would have to be
invented. 4.0 is the only cut the domain already justifies, and a second
definition of confidence in the same app is worse than a coarse one.

**Showing `25.0` for an unrated wallpaper.** It is noise dressed as
information, and it sorts into the middle of the review list as though it had
been judged.

**Omitting the badge entirely for an unrated wallpaper.** Absence is
indistinguishable from a render failure. On the live library it would blank 45
of 120 cards.

**Normalising Score to 0-100.** μ is unbounded in both directions and a
rescale needs a floor and a ceiling that do not exist. It would also hide that
the number is only comparable within one library.

## Consequences

**Every badge is dimmed on a young library, and that is correct.** σ crosses
4.0 at about seven comparisons. Running `ranking.rs`'s `rate_1vs1` repeatedly
from the starting rating gives 8.333 → 6.28 at 2 comparisons, 4.95 at 4, 4.07
at 6, 3.46 at 8, 3.03 at 10, 1.98 at 20. The live library sits at 0 to 2
comparisons per wallpaper, so it contains no Evaluated wallpaper at all and the
solid state will not appear until roughly Round 8. Evaluated is a late signal
by construction; the badge reports that rather than softening it.

**45 of the live library's 120 wallpapers read `Unrated` today.** On the review
list this is invisible, since μ = 25.0 sorts nowhere near the bottom. On the
library page it is a third of the grid.

**A Rejected wallpaper's Score freezes.** It sits out of voting, so its μ stops
moving while the rest of the pool keeps going, and months later the number is a
standing in a distribution that no longer exists. It renders plainly anyway: any
caveat small enough for a card corner is too small to read, and the comparison
count beside it already says how much to trust it.

**`idx_wallpapers_status_rating_mu` keeps covering `get_review`**, which is the
one thing a computed ordering would have cost.

**`CONTEXT.md` gains Score**, so μ has a name that is not a column. Whether
σ < 4.0 is the right Evaluated threshold is still a ranking-quality question and
is still not settled, here or in [ADR 0008](0008-round-is-derived.md).
