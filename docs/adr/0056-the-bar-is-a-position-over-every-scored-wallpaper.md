# ADR 0056: The Bar is a position over every scored wallpaper, Rejected included

**Status:** Accepted
**Ticket:** [#367](https://github.com/QuantumFF/walltare/issues/367), part of
[#362](https://github.com/QuantumFF/walltare/issues/362)
**Date:** 2026-09-29

## Context

Faster ranking stops spending votes on wallpapers the app is already sure about,
and "sure" means sure of which side of the **Bar** a Score falls on. That makes
the Bar the thing every vote is aimed at, so what sets it decides what "faster"
means. Three questions: what the curator states, how many Bars there are, and
which wallpapers a position is measured against.

## Decision

**The curator states a position, not a Score.** The Bar is "the worst X%",
chosen from presets of 10, 20, 30 and 50 percent, defaulting to 20. It is a
setting in the sense of [ADR 0046](0046-the-evaluated-threshold-is-the-curators.md):
the stored value is the fraction, and a value off the list is refused. The
percentage is printed, because unlike a σ it is a number a curator can picture.

**The position is taken over every wallpaper with a Score**: Active, Kept and
Rejected. Unrated wallpapers have no Score to place and do not count. The Bar
is the Score at that position, recomputed as Scores move.

**There is one Bar, at the bottom.** Confirming favourites is Review worked from
the highest Score. No curator action depends on the app being sure a wallpaper
sits above some upper line, since Keep is a judgement made despite the rating.

The curator sets it in Settings beside Review ordering. Review, working from the
lowest Score, draws a rule across the worklist where the Bar falls.

## Alternatives rejected

**A fixed Score.** Nobody can picture a μ, which is ADR 0046's argument against
a typed σ. Worse, the spread of Scores widens as Comparisons accumulate: on a
young library every Score sits near 25, so a Bar of 20 catches nothing, and
later the same 20 catches a third of the pool.

**A position over the Eligible pool.** The obvious reading, and it ratchets.
Each wallpaper cleared out lifts the Bar, so there is always a fresh worst fifth
and clearing out never ends. Counting Rejected wallpapers, whose Scores freeze
where they stood, is what gives clearing out a fixed point: once the worst X%
are gone, nothing left sits below the Bar.

**Snapshotting the position into a Score when the curator sets it.** Stable
under rejects, but it inherits the fixed Score's drift. A snapshot taken at 20%
on a young library catches around 40% once the Scores have spread.

**An anchor wallpaper** ("anything worse than this one"). Concrete, but it hangs
the Bar on one noisy Score, and the anchor itself can be cleared out.

**Two lines, one per end of Review.** Doubles the wallpapers that need votes to
resolve, for no action that needs the upper line.

## Consequences

**A Rejected wallpaper's frozen Score now shapes a live number.** ADR 0013 calls
it a standing in a distribution that no longer exists. That staleness is the
price of the fixed point, and it is small in practice because TrueSkill does not
recentre the pool when low wallpapers leave it.

**A young library's Bar rests on few Scores.** Whether anything can be Decided
against it that early is the Decided rule's question, not this one.

**The Bar moves without the curator.** A scan and a vote can each shift it, so
Decided has to survive the Bar moving, as Evaluated survives its threshold
moving.
