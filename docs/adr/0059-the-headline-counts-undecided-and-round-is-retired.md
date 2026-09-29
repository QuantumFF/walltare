# ADR 0059: The Rank headline counts Undecided wallpapers, and Round is retired

**Status:** Accepted
**Ticket:** [#371](https://github.com/QuantumFF/walltare/issues/371), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29
**Supersedes:** [ADR 0008](0008-round-is-derived.md)

## Context

The Rank headline reads `Round 4 · 82%` with a progress bar, then
`61 / 120 Evaluated` and `487 Comparisons`. Round
([ADR 0008](0008-round-is-derived.md)) is `min(comparisons_count) + 1` over the
Eligible pool. It meant something only because `select_pair` picks the
least-compared wallpaper first, so the app swept the pool in passes.

Faster ranking ends that sweep. Selection stops spending votes on Decided
wallpapers ([ADR 0058](0058-decided-is-the-apps-rule-and-is-never-stored.md)),
so the least-compared wallpaper stops rising once the first wallpapers are
Decided with two or three Comparisons each. Round would sit at 3 for good, and
the within-Round percentage with it. The number would still be true, but it
would stop answering anything the curator asks.

What the curator asks is the destination of
[#362](https://github.com/QuantumFF/walltare/issues/362): how much voting is
left before they can act, that is, before every wallpaper is Decided except the
ones near the Bar.

## Decision

**The headline leads with an Undecided count**, over the Eligible pool:

```
31 / 420 Undecided                              487 Comparisons
```

An Unrated wallpaper has no Score, so it is never Decided and counts as
Undecided. Rejected wallpapers still set the Bar
([ADR 0056](0056-the-bar-is-a-position-over-every-scored-wallpaper.md)) but are
not the curator's work, so they are not in the count. Kept wallpapers still
take part in voting, so they are.

The count is focusable and carries a hover and focus explanation that splits it
by the Bar and says it can rise: "31 of 420 wallpapers are Undecided: the app
isn't sure yet which side of the Bar they fall on. 84 are Decided below it and
305 above. It can go up as well as down: a surprising vote can make the app
unsure again." It keeps `aria-live="polite"`.

**The count is shown raw.** Decided is worked out on every read, so the count
wobbles by a few percent while voting goes on, and a vote can raise it by one or
two. The hover says so. Nothing smooths it.

**There is no progress bar.** The fuzzy middle near the Bar stays Undecided for
good, so a bar of the Decided share would never fill. A count that falls does
not promise to reach zero the way a bar promises to fill.

**The Evaluated count leaves the headline**, and nothing else counts Evaluated.
Evaluated still answers how sure a Score is, through the Score badge on every
card, and the Evaluated threshold
([ADR 0046](0046-the-evaluated-threshold-is-the-curators.md)) still sets it.

**Round is retired.** It leaves the headline, the hover, the glossary and
`Stats`. So does **Participated**, whose only remaining use was Round progress.

**The scan and download endings drop their Round line.** `412 wallpapers added`
stands alone. New wallpapers are Unrated, so they are Undecided by definition,
and the headline count rising says so without the toast having to.

`Stats` becomes:

| field | meaning |
| --- | --- |
| `total_wallpapers` | all rows, any Status |
| `eligible_count` | Active + Kept; the denominator for the headline |
| `undecided_count` | Eligible and not Decided, Unrated included |
| `decided_below_count` | Eligible and Decided below the Bar |
| `decided_above_count` | Eligible and Decided above the Bar |
| `total_comparisons` | all comparison rows |

`round`, `round_participated_count` and `evaluated_count` are gone. The three
Decided fields sum to `eligible_count`. They come from the backend because
Decided needs the Bar, an aggregate over every scored wallpaper that the
frontend never receives.

What carries over from ADR 0008: every fraction is measured against the
Eligible pool, and the headline is derived on every read with nothing stored.

## Alternatives rejected

**A Decided share with a progress bar**, `72% Decided`. It has ADR 0008's
never-100% problem, but permanently this time: the fuzzy middle is meant to
stay Undecided, so the bar would stop short of full by design, and the curator
would read that as work left undone.

**The Bar split as the headline**, `84 below · 31 Undecided · 305 above`. It
says what the curator can act on, but three numbers that each wobble make a
noisy headline. The split goes in the hover, where it answers the curator's
follow-up question.

**Keeping Round as a secondary figure.** Under a selection that leaves Decided
wallpapers alone, it stalls at 2 or 3 and never moves again. A number that
never moves still takes up space and attention.

**Keeping Evaluated beside the Undecided count.** Two confidence counts side by
side invite the reading that they measure the same thing, and the glossary
keeps them apart. Decided is what the curator acts on, and the badges already
show Evaluated where a single Score is in question.

**Smoothing the wobble**, by hysteresis or a moving average. Either needs stored
state, which ADR 0058 rejected for Decided itself. The headline would be
claiming a steadiness the rule doesn't have.

**Replacing the toasts' Round line with "They start Undecided."** It is true of
every new wallpaper, so it says nothing the title doesn't.

## Consequences

**This lands with the Bar, not with the new selection.** The Undecided count
needs the Bar and the Decided rule in code. It does not need the new pair
selection: shown beside today's `select_pair` it is still honest, just slower
to fall.

**The Round bookkeeping goes.** `ScanRunContext` and `DownloadRunContext` held
the Round from before a scan or download only to judge "back to Round N". Both
refs go, along with `backToRound` in the toast copy. The notes in
[ADR 0021](0021-background-work-is-a-pinned-toast.md) and
[ADR 0051](0051-a-download-lands-as-a-scan-of-one-file.md) are superseded.

**The Evaluated threshold loses its only count.** It still decides the badges.
Whether it still earns a place in Settings is left open.

**The count can rise with nothing new in the library.** A vote that upsets a
Decided wallpaper, a vote that moves the Bar, and a change to the Bar's
percentage in Settings can all raise it. The hover's last sentence is the whole
mitigation, as the hover was for Round.
