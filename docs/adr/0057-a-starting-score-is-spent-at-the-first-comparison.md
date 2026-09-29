# ADR 0057: A starting Score is where the rating begins, and it is spent at the first Comparison

**Status:** Accepted
**Ticket:** [#369](https://github.com/QuantumFF/walltare/issues/369), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29

## Context

Two of the faster-ranking techniques give a wallpaper a Score before it has been
in any Comparison: a triage mark from the curator, and a prediction from image
embeddings. Until now every wallpaper started at μ 25 / σ 8.333, a wallpaper in
no Comparison was `Unrated`, and `Unrated` meant `comparisons_count = 0`
(`copy.ts`'s `score`). [ADR 0028](0028-review-joins-the-listing-vocabulary.md)
tails Unrated wallpapers out of Review's ordering because they hold no
measurement.

The rating is folded state. μ and σ live on the wallpaper row and each vote
updates them in place; nothing rebuilds them from the Comparison log.

## Decision

**A starting Score is where the rating begins, not a number beside it.** A
triage mark or a prediction sets the μ₀ and σ₀ the rating starts from in place
of 25 / 8.333. The first Comparison updates from there as TrueSkill always does,
so later Comparisons wash it out and nothing has to replace it. Pair selection,
the Bar and Decided all read μ and σ, so they gain from a starting Score without
learning a second number.

**It is spent at the first Comparison.** A wallpaper still in no Comparison takes
a new starting Score when its mark or prediction changes. After the first
Comparison, changing either leaves the rating alone.

**A triage mark is a record; a prediction is not.** The mark is the curator's
judgement, like a Comparison, and is stored in its own right, so the app can say
why a wallpaper started where it did and the mark can be changed. A prediction
comes from the image and the model and can be worked out again, so a cache is
enough.

**σ₀ is always above the loosest Evaluated threshold (5.0) and below 8.333.** A
starting Score never makes a wallpaper Evaluated; that still takes votes. It may
be sure enough to make a wallpaper Decided, which asks only whether the app is
sure enough to act. The σ₀ each mark and prediction carries is set from the
simulation harness by the tickets that define them.

**Unrated means the app knows nothing:** no Comparison and no triage mark. A
marked wallpaper shows its μ and sorts into Review by it. A prediction alone
leaves a wallpaper Unrated: it steers Rank but does not put an image in front
of the curator as one of the worst before anyone has looked at it. ADR 0028's
tail keeps its shape and follows the new definition.

**Participated and Round still count Comparisons only.** A triage mark is not a
vote.

## Alternatives rejected

**A separate estimate beside μ**, dropped at the first Comparison. Cleaner to
undo, but every consumer of μ (selection, the Bar, Decided, Review's order)
would have to learn to read two numbers and agree on when each applies.

**Pseudo-Comparisons against an imaginary anchor wallpaper.** Breaks "a
Comparison is one real vote", which the log and every count built on it rely
on.

**Replaying the rating from the starting Score and every Comparison**, so a
changed mark rewrites history. Honest, but a changed start alters every update
its opponents took from it, so one re-marked wallpaper silently moves Scores
across the library. The mark and the Comparison log are both kept, so replay
stays possible if this is ever revisited.

**A source-blind σ₀**, letting a confident mark reach Evaluated with no votes.
Evaluated would stop meaning that votes made the app sure.

**Predictions leaving Unrated too.** Reasonable once predictions prove accurate;
that is for the embeddings ticket to reopen with harness numbers, not a default.

## Consequences

**`comparisons_count = 0` no longer means Unrated.** `score()` in `copy.ts`, the
listing tail (`ListOrdering::ScoreAsc`, Review) and the Bar's population
([ADR 0056](0056-the-bar-is-a-position-over-every-scored-wallpaper.md): every
wallpaper with a Score) all switch to "no Comparison and no triage mark". A
marked wallpaper therefore counts toward the Bar's position; a predicted one
does not.

**"No Comparisons implies not Evaluated" survives**, because σ₀ stays above every
offered threshold. The note in `wallpaper.ts`'s `isEvaluated` stays true for a
new reason.

**A mistaken mark outlives the first vote.** Comparisons correct it at the pace
σ₀ allows; the mark's own record stays as the curator left it.
