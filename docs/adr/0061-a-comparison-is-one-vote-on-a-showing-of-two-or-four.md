# ADR 0061: A Comparison is one vote on a showing of two or four

**Status:** Accepted
**Ticket:** [#373](https://github.com/QuantumFF/walltare/issues/373), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29

## Context

A Comparison has been one pairwise vote: a winner, a loser and a time. The
rating is updated in place and never replayed, so the Comparison record is the
only history of how it got there. Showing four wallpapers and asking for the
best and the worst is worth about 3.4 pairwise Comparisons per vote
([#365](https://github.com/QuantumFF/walltare/issues/365)), but only as one
joint TrueSkill update. Applying it as the five pairwise updates it implies is
overconfident: each gives the winner a fresh performance, and the error
compounds until 95% intervals cover the truth about half the time.

The simulation harness measured it under the pair-selection rule of
[ADR 0060](0060-pair-selection-draws-the-least-compared-undecided-wallpaper.md):
`research/sim/results/best-of-four.md` on `research/votes-until-decided`.
Figures are for n = 500, a curator twice as noisy as TrueSkill assumes, and
k = 2.5, for both voter models (Thurstone / Bradley–Terry).

| Showing | To 70% Decided | Break-even vs a pair | Wrong @ 70% | Peak |
|---|---:|---:|---:|---:|
| Pair (ADR 0060) | 4080 / 4092 | 1 | 1.39% / 1.13% | 1.66% / 1.55% |
| **Best and worst of 4, one joint update** | **1702 / 1588** | **2.40 / 2.58** | **0.64% / 0.81%** | **1.20% / 1.48%** |
| Best of 4, one joint update | 2351 / 2553 | 1.74 / 1.60 | 0.95% / 1.31% | 1.32% / 2.23% |
| Best and worst of 4, five pairwise updates | 1092 / 1049 | 3.74 / 3.90 | 2.01% / 2.22% | 2.10% / 2.54% |

Break-even is how many times longer than a pairwise vote a showing of four may
take and still reach 70% Decided as soon.

## Decision

**A Comparison is one vote on one showing of two or four wallpapers**, naming
the best and the worst. With two, those are the winner and the loser, so every
existing Comparison already has this shape. With four, the other two are
recorded as members and neither is ranked above the other. It is written only
once both are named; a showing left half-answered records nothing.

**A Comparison of four is one joint rating update**, one performance per
wallpaper, never the pairwise updates it implies. **It counts once** wherever
Comparisons are counted: each member's count of Comparisons, the last 10
showings the first pick avoids, and the every-other cap on arrivals. Counting
each member by the pairwise relations it implies instead made no measurable
difference to speed or accuracy.

**Four is a mode beside pairs, not a replacement.** The curator switches
between them in Rank and the choice is remembered. Both feed the same rating
and draw by the same rule. With fewer than four Eligible wallpapers Rank shows
pairs. Once nothing is left to decide, a curator in the four mode keeps getting
fours: switching to pairs there was slower (70% at 2516 against 1702) and no
more accurate.

**A showing of four is drawn by the ADR 0060 rule.** The first pick is the
same; the other three are drawn one after another by μ proximity over every
Eligible wallpaper, leaving out the showing on screen. A Near-duplicate pair is
never in one showing. At most one member is Unrated, and the others have a
Score whenever one is available.

**k stays at 2.5 in both modes.** Decided reads only the rating and the Bar
([ADR 0058](0058-decided-is-the-apps-rule-and-is-never-stored.md)), and most
wallpapers will have been in both kinds of showing.

## Alternatives rejected

**Five implied pairwise Comparisons tagged with a vote id.** Comparison would
keep its old meaning, but the rows invite exactly the replay that is
overconfident: the harness puts 2.0–2.2% of Decided wallpapers on the wrong
side that way. Every reader that counts showings would also have to group rows
by the tag.

**A separate record for a vote on four, beside the Comparison.** Two kinds of
vote means every reader of the record (the repeat window, the arrival cap, the
counts, the history a Rejected wallpaper keeps) reads both. A pair is already
the two-wallpaper case of best and worst.

**Best only, or a full ranking of four.** Best only is worth 1.6–1.8 pairwise
votes per showing. A full ranking takes a third choice for about 10% more than
best and worst ([#365](https://github.com/QuantumFF/walltare/issues/365)).

**Four in place of pairs.** Whether four is faster depends on how long the
curator takes over one, and no Comparison has been timed. A small library
cannot show four.

**A lower k for fours.** k = 2.25 would bring their wrong-side rate back to
pairs' at 2.5 (1.04% / 1.34%), but would make Decided depend on how the votes
were collected.

**No limit on arrivals per showing**, the every-other cap kept. It reaches 70%
Decided 4–13% sooner after a scan and 18% sooner in a fresh library, but in a
fresh library its wrong-side rate peaks at 1.47% / 2.48% against 1.20% / 1.48%:
the early error ADR 0060 declined in young libraries.

## Consequences

**The Comparison record changes shape**: the best and the worst stay where the
winner and the loser were, and a showing of four adds its two other members.
Anything reading the record for a wallpaper's history reads the members too.

**Rank ends with more Close calls in the four mode**: 29–30% of the library
against 27% for pairs, at the curator noise the harness assumes.
