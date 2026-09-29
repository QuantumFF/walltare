# ADR 0058: Decided is the app's rule, strict about the side of the Bar, and never stored

**Status:** Accepted
**Ticket:** [#368](https://github.com/QuantumFF/walltare/issues/368), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29

## Context

A wallpaper is **Decided** when the app is sure which side of the Bar its Score
falls on. Faster ranking stops spending votes on Decided wallpapers, so this
rule decides both when the curator can act and where votes go. The research
([#364](https://github.com/QuantumFF/walltare/issues/364)) points at the
level-set estimation literature (LSE, APT), whose rule has the shape
|μ − Bar| ≥ kσ − ε. Those papers also take for granted two things this app
cannot: that once something is classified it stays classified, and that the
indifference zone ε is part of the verdict. The simulation harness
([#363](https://github.com/QuantumFF/walltare/issues/363), results in
`research/sim/results/decided-rule.md` on `research/votes-until-decided`) was
used to choose k.

## Decision

**Decided means |μ − Bar| ≥ 2.5σ.** There is no ε. A wallpaper close to the
Bar stays Undecided, even once further Comparisons stop being worth their
cost. "The middle may stay fuzzy" is the pair-selection rule's reason to stop
spending votes there. It is not a kind of Decided, because a wallpaper within ε
of the Bar is exactly one whose side the app does not know.

**k is the app's, not a setting.** This departs from
[ADR 0046](0046-the-evaluated-threshold-is-the-curators.md), under which the
curator sets how sure Evaluated has to be. The difference is what the number
stands for. The Evaluated threshold is a matter of taste: how many Comparisons
make a Score trustworthy. k is an error rate for which side of the Bar a
wallpaper is on, and the right value depends on how consistent the curator's
votes are, which the curator has no way to observe. The curator already states
their taste through the Bar
([ADR 0056](0056-the-bar-is-a-position-over-every-scored-wallpaper.md)).

**Why 2.5.** TrueSkill's σ assumes a curator exactly as consistent as β says.
With a curator twice that noisy (noise 1.0, under both Thurstone and
Bradley–Terry voters, n = 500), the share of Decided wallpapers on the wrong
side of the true Bar was:

| k | Wrong among Decided | Comparisons per wallpaper to 50% / 70% Decided |
|---|---|---|
| 2 | 1.1–1.7%, not falling with more votes | 8.8 / ~20 |
| 2.5 | 0.6–0.9% (up to 1.15% at n = 120) | 12.2 / ~28 |
| 3 | 0.15–0.6% | 16.1 / ~39, and a third of libraries never reach 70% |

These costs are measured under today's `select_pair`. More than half its votes
at k = 2 go to pairs where both wallpapers are already Decided, and a
Bar-aware selection is expected to recover that. A wrong-side mistake is
cheap: a wallpaper wrongly Decided below the Bar still passes the curator in
Review before any soft reject, and a soft reject can be undone. So 2.5, the
lowest k that stays under about 1% for a noisy curator, beats 3.

**Decided is worked out from the rating and the Bar on every read, never
stored**, the way Round ([ADR 0008](0008-round-is-derived.md)) and Evaluated
are. It can go back to Undecided, and in principle it can change sides.

**Decided reads only the rating and the Bar.** Status plays no part in it. An
Unrated wallpaper has no Score, so it is never Decided, whatever its starting
Score from a prediction.

**A young library needs no rule of its own.** Nothing is Decided until the Bar
has a stable footing, and the harness never found a thin Bar. Today's
least-compared-first selection gives every wallpaper a Score by about one
Comparison each, so the first Decided wallpaper meets a Bar resting on 50–490
Scores. Early mistakes come from a σ built on two votes. Raising k fixes that;
a warm-up rule does not.

## Alternatives rejected

**k = 2**, the harness's placeholder. It is honest only for a curator as
consistent as TrueSkill assumes. For a noisier one it stays wrong 1–2% of the
time however many votes are cast.

**The LSE rule with ε, |μ − Bar| ≥ kσ − ε.** It counts a wallpaper as Decided
while its side of the Bar is still unknown. That contradicts what Decided means
and leaves the curator acting on a coin flip.

**Presets for k, or tying it to the Evaluated threshold's presets.** Either way
the curator would be asked to choose an error rate against noise they cannot
see. Tying k to Evaluated would also couple two questions the glossary keeps
apart: how sure the Score is, and whether it is sure enough to act on.

**Sticky Decided, as LSE assumes.** A wallpaper that stays Decided forever is a
claim the app has stopped checking, and the Bar moves without the curator
through scans, votes and a changed percentage. About half of the wallpapers
that are ever Decided go back to Undecided at some point. That is mostly
flicker at the threshold: 81–85% are back on the same side within two of their
own Comparisons. A real change of side happens to none of them at k ≥ 2.5.

**Hysteresis** (Decided at kσ, Undecided again only below a smaller multiple).
It damps the flicker, but it needs a stored flag, which brings back the sticky
state this ADR rejects.

**Folding the Bar's own uncertainty in, |μ − Bar| ≥ k·√(σ² + σ_bar²)**, or
**a warm-up that decides nothing until the Bar rests on 25 Scores.** The first
ends up on the same curve as a larger k (it behaves like k ≈ 2.75) and adds
flicker whenever the Bar moves. The second never came into play.

**Letting a prediction Decide an Unrated wallpaper.** A wallpaper Decided below
the Bar without a Comparison could not be cleared out, because Unrated
wallpapers are not in Review. The prediction pays off anyway, because a
confident starting Score can let the first Comparison Decide the wallpaper.

## Consequences

**A count of Decided wallpapers wobbles** by a few percent while voting goes on.
How to show it, if at all, belongs to the headline, not to this rule.

**k = 2.5 is measured only under today's selection.** A selection that samples
near the Bar could change the wrong-side rate. The pair-selection rule
([#370](https://github.com/QuantumFF/walltare/issues/370)) re-measures it and
moves k to 3 if it exceeds about 1%. That selection also has to keep giving
every Eligible wallpaper a Score early, or this ADR's young-library finding no
longer holds. The same goes for a large scan into a mostly-scored library,
which the harness does not model.
