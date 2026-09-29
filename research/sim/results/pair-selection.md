# Choosing the pair-selection rule

Fact-finding for [#370](https://github.com/QuantumFF/walltare/issues/370)
("The pair-selection rule"). It measures candidate rules for which two
wallpapers Rank shows next, against today's `select_pair`. Nothing here picks
a rule; the numbers are for the grilling.

## Setup

- Library of n wallpapers, true quality N(0, 1). Prior 25 / 8.333 for all,
  one `rate_1vs1` per vote, nothing rejected during a run. Same libraries for
  every rule at a given (n, rep).
- Bar: worst 20% of every wallpaper with a Score (Unrated excluded),
  recomputed after every vote. Truth: the same 20% of true quality.
- Decided: |μ − Bar| ≥ k·σ with **k = 2.5** unless a table says otherwise.
  Unrated is never Decided. Every rule below reads the same k.
- Voters `thurstone` (T) and `bradley-terry` (BT), noise 0.5 (as consistent
  as TrueSkill assumes) and 1.0 (twice as noisy). Budget: Each 40.
- "Each" is Comparisons per wallpaper = 2 × votes / n. Medians are lower
  medians over runs, with runs that never got there counted as never;
  "(r/N)" shows how many of N runs got there when not all did. "—" means the
  median run never got there within the budget.
- "Wrong" is the share of Decided wallpapers on the side opposite their true
  side, pooled over runs. "Run" pools every checkpoint from Each 4 to 40
  (what a curator meets on average); "Peak" is the worst checkpoint with
  ≥ 2% of the library Decided.
- "95% outside δ": Each until 95% of the wallpapers whose true quality is
  more than δ from the true Bar are Decided (δ in true-quality units; the μ
  scale is roughly 4.2 Score per unit at noise 1.0, see `starting-score.md`).
- "Below @e": truly below the Bar and Decided below, as a share of the truly
  below, at Each e.

### The rules

A rule is `<first pick> + <opponent>` (`PairRule` in `src/selectors.rs`).
Every rule keeps today's exclusion: neither wallpaper of the pair just shown
is in the next pair.

First pick, among Undecided wallpapers with a Score:

| Name | Picks |
|---|---|
| `straddle` | argmax kσ − \|μ − Bar\| (LSE straddle) |
| `apt ε` | argmin (\|μ − Bar\| + ε)/σ, ε in Score units (APT) |
| `lsa` | argmin (α/4)·z² + ½·ln T, z = \|μ − Bar\|/σ, T its Comparisons, α = 1.35 (LSA; the /4 maps LSA's [0, 1]-reward T·Δ² onto z²) |
| `uleast` | least-compared Undecided, random among ties (the minimal change from today) |

Opponent, from every wallpaper except the first pick and the pair just shown:

| Name | Picks |
|---|---|
| `μ` | today's: weighted by exp(−½((μⱼ − μᵢ)/σᵢ)²) |
| `BALD` | argmax BALD expected information gain of the pair (closed form, checked against the research note's table in a test) |
| `look` | argmax expected drop in Σ max(0, kσ − \|μ − Bar\|) over both wallpapers, from `rate_1vs1` on each outcome weighted by TrueSkill's P(win); the Bar is held where it is |

Unrated handling (changed mid-study at the curator's request; every table
here uses the rule below):

- **U-forced** (the default): an Unrated wallpaper goes first whenever one
  exists, random among them.
- **U-index**: no priority; an Unrated wallpaper (25 / 8.333, 0 Comparisons)
  is ranked by the same first-pick index as everyone else.
- **U-share**: Unrated first, but no two pairs running may show an Unrated
  wallpaper.
- In all three, an Unrated first pick's opponent has a Score whenever one is
  open. "U-vs-U allowed" drops that for reference; it is what the rules did
  before the change and what `BALD` would choose by itself.

Variants: opponent pool Undecided only or Decided only ("anchors", all when
none is Decided); variety `m` (the first pick may not be in any of the last m
pairs; m = 1 is today's exclusion); `top-8` (first pick uniform among the 8
best by index); stop σ < s (an Undecided wallpaper with σ < s is left out of
the first pick); fallback when no Undecided first pick is left: `least`
(least-compared among all, the default) or `gap/σ` (smallest |μ − Bar|/σ
among all).

Baseline is today's `select_pair` unchanged (least-compared first,
μ-proximity opponent, pair just shown excluded).

### Commands

From `research/sim`; the full output of every run is in
[`pair-selection/`](pair-selection/). Each file's header gives its wall time.

```sh
SIM="cargo run --release --"
S=baseline; for f in straddle apt0 apt0.5 apt1 apt2 apt4 lsa uleast; do
  for o in mu bald look; do S="$S,$f+$o"; done; done
$SIM pair runs --sizes 500 --noise 1.0 --voter thurstone --reps 10 --selector $S            # screen.md
TOP=baseline,uleast+bald,uleast+mu,lsa+look
for v in thurstone bradley-terry; do                                                         # full-*.md
  $SIM pair runs --sizes 120,500,2000 --noise 0.5,1.0 --voter $v --reps 20 --selector $TOP; done
for k in 2 2.5 3; do                                                                         # k*.md
  $SIM pair runs --sizes 120,500 --noise 1.0 --voter thurstone,bradley-terry --reps 50 --k $k --selector $TOP
  $SIM pair runs --sizes 2000 --noise 1.0 --voter thurstone,bradley-terry --reps 20 --k $k --selector $TOP; done
R="pair runs --sizes 500 --noise 1.0 --voter thurstone,bradley-terry --reps 20"
$SIM $R --selector <each of s/pool=all|und|anchor>                                           # pools.md
$SIM $R --selector <each of s/m=1|m=3|m=10|top=8, s also straddle+look, apt1+look>            # variety.md
$SIM $R --selector <each of s, s/stop=1.0|1.5|2.0/fb=least|ratio>                            # stop.md
U=baseline,<each of s/u=forced|index|share>,uleast+bald/uu=allow
$SIM pair arrival --old 500 --new 200,50 --each-before 20 --after 5000 --noise 0.5,1.0 \
  --voter thurstone,bradley-terry --reps 20 --selector $U                                    # arrival.md
$SIM pair runs --sizes 30,60 --noise 0.5,1.0 --voter thurstone,bradley-terry --reps 100 --early --selector $U  # young.md
$SIM pair runs --sizes 500 --noise 0.5,1.0 --voter thurstone,bradley-terry --reps 20 --early --selector $U     # young-500.md
$SIM pair timing --selector baseline,uleast+mu,uleast+bald,uleast+look,lsa+look,straddle+bald,straddle+look    # timing.md
```

where s runs over `uleast+bald`, `uleast+mu`, `lsa+look`. The whole set takes
about 25 minutes on 12 threads; the n = 2000 lookahead runs are most of it.

## Findings

1. **Screening (n = 500, T, noise 1.0, 10 libraries): every argmax index
   first pick is slower than Baseline to 50% Decided; only `uleast` is
   faster.** To 50% / 70% Decided: Baseline 11.90 / 26.98; `uleast+BALD`
   8.45 / 13.78; `uleast+μ` 9.70 / 16.32; `lsa+look` 13.15 / 21.60;
   `straddle+look` 14.40 / 23.42; `straddle+μ` 28.56 / — (1/10); `apt ε=0+μ`
   never reaches 50% (4.20% Decided at Each 16). The index rules show the same
   wallpaper again two pairs later in 64.49–90.32% of votes (column "2 back"
   in the screening table), and their longest streak of one wallpaper shown
   at least every other pair is 52–149 pairs in the median run: a Bar-sitter
   soaks up the budget. Baseline: 0.39% and 2. Among the lookahead
   rules the 50%/70% times fall as APT's ε grows (ε 0: 18.53 / 34.56 (9/10),
   ε 4: 15.50 / 24.05). The three carried forward: `uleast+BALD`, `uleast+μ`,
   `lsa+look`.
2. **Headline (k = 2.5, 20 libraries, n = 500, T, noise 1.0).** Each to
   50/60/70/80/90% Decided: Baseline 12.14 / 17.76 / 27.31 / — (0/20) / —;
   `uleast+BALD` 8.40 / 10.66 / 13.78 / 19.49 / 37.87 (13/20); `uleast+μ`
   9.50 / 12.10 / 16.22 / 24.19 / — (0/20); `lsa+look` 13.78 / 16.61 / 21.84 /
   34.37 (17/20) / —. At noise 1.0 the order (`uleast+BALD`, `uleast+μ`,
   `lsa+look`, Baseline at 70%) is the same at n = 120 and 2000 and with BT;
   `lsa+look` is slower than Baseline to 50% in all six (12.50–13.78 against
   11.80–12.50). At noise 0.5 `lsa+look` is the fastest to 80–90% (n = 500 T:
   17.57 / 35.71 (15/20) against `uleast+μ` 18.82 / 38.93 (11/20)) and to
   95% outside δ 0.25 (20.83 against 22.37; Baseline never), and
   `uleast+μ` the fastest to 70% (13.34 against 13.78).
3. **Outside the fuzzy middle.** 95% of wallpapers more than δ = 0.25 from
   the true Bar Decided, n = 500 noise 1.0 T: `uleast+BALD` 34.37 (18/20),
   `uleast+μ` 39.60 (12/20), `lsa+look` and Baseline — (0/20). At noise 0.5:
   `lsa+look` 20.83, `uleast+μ` 22.37, `uleast+BALD` 34.85 (16/20), Baseline
   never. δ = 0.1 in the median run: at noise 1.0 only `uleast+BALD` with
   opponents limited to the Undecided (36.86 (12/20) T, 37.78 (16/20) BT); at
   noise 0.5 `lsa+look` in all six configurations (30.53–39.74) and
   `uleast+μ` in two of six.
4. **Clear-out side.** Truly-below Decided below at Each 4 is 0% for every
   rule (nothing is Decided below that early at k = 2.5). At Each 8 / 16
   (n = 500 T noise 1.0): Baseline 4.60% / 23.35%, `uleast+BALD` 13.70% /
   44.15%, `uleast+μ` 7.85% / 38.10%, `lsa+look` 2.75% / 24.55%.
5. **Wrong side at noise 1.0 (50 libraries at n = 120, 500; 20 at 2000).**
   At k = 2.5 the pooled rate over the run ("Run") is: Baseline 0.75–1.07%;
   `uleast+μ` 0.92–1.16%; `lsa+look` 1.10–1.27%; `uleast+BALD` 1.89–2.30%.
   **Flagged > 1%: `uleast+BALD` everywhere; `lsa+look` everywhere; `uleast+μ`
   at n = 120 T (1.05%), n = 2000 (1.16%, 1.14%).** Peaks reach 2.54–3.08%
   (`uleast+BALD`), 1.89–4.51% (`lsa+look`), 1.17–1.50% (`uleast+μ`),
   against 1.09–2.43% for Baseline.
   `uleast+BALD` is the only rule whose rate rises with Each (n = 500 T: 1.02%
   at Each 4, 2.53% at Each 40; Baseline 0.68% → 0.73%). At k = 3 the Run rates
   are Baseline 0.38–0.61%, `uleast+μ` 0.50–0.66%, `lsa+look` 0.28–0.38%,
   `uleast+BALD` 1.00–1.40% (1.31–1.90% at Each 40). k = 3 costs (n = 500 T,
   Each to 50% / 70%): Baseline 16.18 / 38.11 (34/50), `uleast+BALD` 10.85 /
   17.90, `uleast+μ` 12.82 / 22.27, `lsa+look` 23.33 / — (23/50). At k = 2
   every rule is above 1% (Baseline 1.41–1.75%, candidates 1.72–3.54%).
6. **Opponent pool.** Limiting opponents to the Undecided speeds `uleast+BALD`
   up (n = 500 T noise 1.0: 50/70/80/90% at 7.54 / 11.66 / 15.94 / 29.57, 95%
   outside δ 0.25 at 24.58) and cuts its two-back repeats from 28.11% to 7.07%,
   at Run wrong 1.96% (2.14% BT). `uleast+μ` Undecided-only: 70% at 14.59
   (from 16.22), wrong 1.29%. Decided-only opponents ("anchors") make every
   rule slower (`uleast+BALD` 50% at 19.34, `uleast+μ` 29.76, `lsa+look`
   never) and lower Run wrong to 0.13–0.82%; `lsa+look` with anchors shows the
   same wallpaper every other pair for a median 2935 pairs.
7. **Repeats and the variety constraint (n = 500 noise 1.0).** With today's
   m = 1 the share of votes re-showing a wallpaper from two pairs back is
   Baseline 0.39%, `uleast+μ` 6.61%, `uleast+BALD` 28.11%, `lsa+look` 73.49%,
   `straddle+look` 78.25%, `apt ε=1+look` 80.94%. m = 10 brings the argmax
   rules to 17.78–20.10% (their opponent, which m does not cover, keeps
   repeating) and `uleast+μ` to 1.39%. Cost of m = 10 in Each to 70% / 80%
   (T): `uleast+BALD` 13.78 → 13.87 / 19.49 → 19.68, `uleast+μ` 16.22 →
   16.18 / 24.19 → 24.38, `lsa+look` 21.84 → 20.98 / 34.37 (17/20) → 29.52,
   `straddle+look` 23.33 → 21.79 / — (9/20) → 33.22 (18/20), `apt ε=1+look`
   32.64 (19/20) → 25.63 / — → 39.36 (12/20). So for the argmax rules the
   variety constraint is a speed-up, not a cost; for the `uleast` rules m = 3, m = 10
   and top-8 change the Decided times by ≤ 0.34 Each to 70% and ≤ 0.91 to 80%
   (T and BT), and move 95% outside δ 0.25 by up to 4.22 either way (in two
   cases the median run no longer gets there). `top-8` gives
   27.10–27.38% two back for the lookahead rules (20.06% `uleast+BALD`,
   2.22% `uleast+μ`), between m = 3 and m = 10 on the last-5 share.
8. **Stopping near the Bar (n = 500 T noise 1.0).** Without a stop no rule
   ever runs out of Undecided first picks within Each 40 (0.00% fallback
   votes everywhere). "Votes saved" as Each until every wallpaper is Decided
   or has σ < s, stop rule vs the same rule without it:
   `lsa+look` σ<1.5: 23.71 → 19.01, σ<2: 23.66 → 14.64, σ<1: 33.89 → 29.28;
   `uleast+BALD` σ<1.5: 21.79 → 19.63, σ<2: 14.50 → 13.82; `uleast+μ` σ<1.5:
   19.20 → 18.53, σ<2: 15.02 → 14.11, σ<1: 28.94 → 28.66. Stopped rather than
   Decided at Each 40 (Undecided with σ < s): σ<1.5 19.82% (`uleast+BALD`),
   25.32% (`uleast+μ`), 31.07% (`lsa+look`); σ<2 21.49%, 25.26%, 36.81%.
   Decided at Each 40 falls accordingly: `uleast+BALD` 89.83% → 80.18%
   (σ<1.5), `uleast+μ` 85.67% → 74.68%, `lsa+look` 78.35% → 66.84%.
9. **Fallback once nothing is left (with a stop).** It fires from Each
   ≈ 19 (σ<1.5) or ≈ 14 (σ<2) and then takes 24–65% of all votes (σ<1:
   0.4–25.5%, from Each ≈ 29 or later). `least`
   (least-compared among all) lowers wrong at Each 40 against no stop:
   `uleast+BALD` σ<1.5 2.32% → 1.10%, `uleast+μ` 1.02% → 0.58%. `gap/σ`
   (smallest |μ − Bar|/σ among all) goes back to the stopped Bar-sitters:
   wrong at Each 40 2.27% and 1.05% for the same two, two-back repeats 46–65%
   (against 2.3–9.3% with `least`). For `lsa+look` both fallbacks give
   0.45–0.66% wrong at Each 40.
10. **Arrival (500 ranked to Each 20 under the rule, then 200 or 50 Unrated;
    5000 votes after the scan).** With 200 arrivals no rule gets them to 90%
    Decided in the median run within 5000 votes. With 50, some do: fastest
    `lsa+look` 1725 (18/20) at T noise 0.5 and `uleast+BALD` U-share 3470
    (13/20) at T noise 1.0; Baseline never. Votes to 70% of 200 arrivals Decided (T noise
    1.0): Baseline 4495 (13/20), `uleast+BALD` 1350 / 1395 / 1415 (forced /
    index / share), `uleast+μ` 2200 / 2130 / 2280, `lsa+look` 3535 / 3040 /
    2960 (19/20). Every arrival has a Score after 200 votes (U-forced,
    U-index for `uleast`), 399 (U-share), 229–237 (`lsa+look` U-index),
    169–171 for Baseline, which pairs two Unrated arrivals in 28.15–30.35
    votes per run;
    the new rules pair none. U-share shows an Unrated arrival in 50.13% of
    votes while any is left (100% forced). Old wallpapers' Decided share
    (scan → lowest before the arrivals reach 90%): Baseline 62.6% → 60.4%,
    `uleast+BALD` 79.8% → 70.9% (forced), 71.3% (index), 75.2% (share), 59.0%
    with U-vs-U allowed; `uleast+μ` 76.0% → 69.4% / 68.4% / 70.9%;
    `lsa+look` 58.1% → 26.5% / 27.9% / 28.4%. With 50 arrivals the dips are
    smaller (`uleast+BALD` 79.8% → 76.7%; `lsa+look` 58.1% → 34.0%).
11. **Young library.** Unrated-vs-Unrated lasts exactly the first 2 votes for
    every new rule (with the pair just shown excluded, vote 2 has no open
    Score) at n = 30, 60 and a fresh 500. Baseline pairs two Unrated in
    9.96 / 19.36 / 160.10 votes per run, the last at vote 15 / 33 / 311
    (median). Votes until every wallpaper has a Score: U-forced and U-index
    n − 2 (28 / 58 / 498; `lsa+look` U-index 29 / 62 / 540), U-share 2n − 6
    (54 / 114 / 994), Baseline 20 / 41 / 340, U-vs-U allowed n/2. The Bar runs
    thin mostly under U-share: its scored-vs-scored pairs Decide wallpapers
    while the Bar rests on as few as 5 Scores (`uleast+BALD`: 3.83% Decided
    at Each 1 at n = 30, 4.66% at n = 500; wrong at Each 1–2 among U-share
    rows up to 2.35%). U-forced `uleast+BALD` Decides nothing before every
    wallpaper has a Score; `uleast+μ` first Decides with 10–157 Scores and
    shows 4.26% wrong at Each 2 at n = 30 (on 1.57% Decided). Nothing broke at n = 30: to 50% /
    70% Decided (T noise 1.0) Baseline 11.33 / 24.13 (96/100), `uleast+BALD`
    7.87 / 12.93, `uleast+μ` 9.07 / 15.13, `lsa+look` 12.87 / 23.40 (90/100).
12. **Per-pair selection time (one thread, median µs).** n = 2000: Baseline
    33.1, `uleast+μ` 29.7, `uleast+BALD` 103.7, `straddle+BALD` 100.3, any
    lookahead 557.2–560.6. n = 10000: 272.8, 148.7, 523.5, 502.6,
    2791.9–2838.5. Recomputing the Bar is 5.4 µs (2000) and 25.3 µs (10000).

## Screening

n = 500, T, noise 1.0, k = 2.5, 10 libraries, pool all, m = 1, no stop,
U-forced. An earlier screening pass, before the Unrated rule changed, ranked
the same three first; it is superseded by this one.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 11.90 | 17.62 | 26.98 | — (0/10) | — (0/10) | — (0/10) |
| straddle + μ | 28.56 | 38.35 (5/10) | — (1/10) | — (0/10) | — (0/10) | — (0/10) |
| straddle + BALD | 15.79 | 23.52 | 36.00 (8/10) | — (2/10) | — (0/10) | — (0/10) |
| straddle + look | 14.40 | 17.47 | 23.42 | — (4/10) | — (0/10) | — (0/10) |
| apt ε=0 + μ | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=0 + BALD | 17.28 | 25.54 | 34.80 (8/10) | 38.35 (6/10) | — (0/10) | — (0/10) |
| apt ε=0 + look | 18.53 | 24.19 | 34.56 (9/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=0.5 + μ | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=0.5 + BALD | 19.01 | 24.72 | 33.41 | 39.02 (6/10) | — (0/10) | — (0/10) |
| apt ε=0.5 + look | 19.01 | 25.01 | 34.13 (8/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=1 + μ | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=1 + BALD | 18.19 | 26.78 | 35.62 (7/10) | 38.98 (5/10) | — (0/10) | — (0/10) |
| apt ε=1 + look | 16.90 | 22.51 | 32.30 (9/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=2 + μ | 23.28 | 28.13 | 37.68 (8/10) | — (0/10) | — (0/10) | — (0/10) |
| apt ε=2 + BALD | 17.62 | 27.41 | 38.35 (5/10) | — (2/10) | — (0/10) | — (0/10) |
| apt ε=2 + look | 17.76 | 21.07 | 25.58 | — (3/10) | — (0/10) | — (0/10) |
| apt ε=4 + μ | 15.98 | 18.72 | 23.81 | — (2/10) | — (0/10) | — (0/10) |
| apt ε=4 + BALD | 17.76 | 23.52 | 30.24 | — (2/10) | — (0/10) | — (0/10) |
| apt ε=4 + look | 15.50 | 19.44 | 24.05 | — (3/10) | — (0/10) | — (0/10) |
| lsa + μ | 26.98 | 33.02 | — (3/10) | — (0/10) | — (0/10) | — (0/10) |
| lsa + BALD | 14.88 | 23.18 | 36.29 (7/10) | — (0/10) | — (0/10) | — (0/10) |
| lsa + look | 13.15 | 16.51 | 21.60 | 31.15 (8/10) | — (0/10) | — (0/10) |
| uleast + μ | 9.70 | 12.05 | 16.32 | 25.49 | — (0/10) | — (3/10) |
| uleast + BALD | 8.45 | 10.66 | 13.78 | 19.49 | 36.43 (8/10) | 33.70 |
| uleast + look | 13.20 | 17.76 | 26.45 | — (4/10) | — (0/10) | — (0/10) |

| Selector | @8 | @16 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 4.70% | 23.40% | 36.00% | 58.14% | 75.28% | 0.62% | 0.97% |
| straddle + μ | 0.40% | 3.20% | 11.12% | 29.78% | 46.76% | 1.17% | 1.49% |
| straddle + BALD | 0.60% | 25.70% | 3.12% | 45.38% | 67.40% | 0.67% | 2.75% |
| straddle + look | 2.20% | 23.90% | 5.80% | 43.02% | 78.48% | 0.74% | 3.33% |
| apt ε=0 + μ | 0.00% | 0.00% | 2.80% | 4.20% | 6.00% | 2.97% | 8.78% |
| apt ε=0 + BALD | 1.40% | 21.30% | 1.48% | 35.48% | 61.98% | 0.91% | 5.66% |
| apt ε=0 + look | 0.00% | 15.80% | 1.08% | 36.10% | 70.62% | 0.67% | 2.42% |
| apt ε=0.5 + μ | 0.00% | 0.10% | 3.26% | 4.48% | 7.80% | 1.22% | 4.41% |
| apt ε=0.5 + BALD | 0.50% | 22.80% | 0.10% | 35.24% | 62.94% | 0.90% | 5.41% |
| apt ε=0.5 + look | 0.00% | 12.20% | 1.70% | 35.78% | 71.42% | 0.49% | 3.65% |
| apt ε=1 + μ | 0.10% | 0.50% | 2.96% | 6.84% | 21.54% | 0.99% | 2.16% |
| apt ε=1 + BALD | 1.50% | 24.90% | 0.32% | 35.72% | 61.40% | 0.75% | 4.35% |
| apt ε=1 + look | 1.10% | 19.00% | 1.10% | 36.80% | 71.86% | 0.49% | 2.79% |
| apt ε=2 + μ | 0.10% | 2.10% | 4.68% | 22.48% | 66.66% | 1.43% | 1.96% |
| apt ε=2 + BALD | 2.60% | 18.30% | 0.58% | 43.04% | 66.28% | 0.57% | 2.65% |
| apt ε=2 + look | 0.00% | 18.70% | 0.26% | 37.08% | 75.52% | 0.56% | 2.11% |
| apt ε=4 + μ | 0.10% | 12.60% | 8.30% | 50.40% | 77.98% | 1.02% | 1.45% |
| apt ε=4 + BALD | 0.40% | 23.10% | 0.74% | 45.88% | 73.00% | 0.50% | 4.14% |
| apt ε=4 + look | 1.30% | 21.00% | 2.18% | 41.76% | 73.12% | 0.83% | 2.14% |
| lsa + μ | 0.10% | 2.50% | 13.62% | 31.96% | 62.98% | 1.24% | 1.59% |
| lsa + BALD | 1.10% | 26.10% | 9.44% | 48.94% | 67.02% | 0.69% | 2.80% |
| lsa + look | 2.80% | 22.20% | 5.70% | 46.86% | 78.86% | 1.10% | 2.34% |
| uleast + μ | 8.50% | 38.30% | 41.90% | 69.06% | 85.18% | 1.14% | 2.06% |
| uleast + BALD | 13.80% | 44.30% | 47.32% | 74.48% | 90.36% | 1.51% | 2.29% |
| uleast + look | 7.60% | 26.10% | 28.70% | 55.30% | 78.52% | 0.53% | 2.42% |

| Selector | 2 back | Last 5 | ≥3 in 10 | Longest streak |
|---|---:|---:|---:|---:|
| Baseline | 0.39% | 1.60% | 0.01% | 2 / 3 |
| straddle + μ | 70.56% | 76.57% | 62.93% | 108 / 184 |
| straddle + BALD | 88.37% | 90.78% | 70.69% | 129 / 156 |
| straddle + look | 78.08% | 82.62% | 65.69% | 85 / 151 |
| apt ε=0 + μ | 81.65% | 89.11% | 82.30% | 149 / 201 |
| apt ε=0 + BALD | 89.58% | 92.96% | 80.22% | 136 / 213 |
| apt ε=0 + look | 84.25% | 89.28% | 79.42% | 133 / 251 |
| apt ε=0.5 + μ | 78.67% | 86.55% | 77.88% | 102 / 205 |
| apt ε=0.5 + BALD | 90.12% | 92.90% | 78.86% | 110 / 242 |
| apt ε=0.5 + look | 81.92% | 87.09% | 75.50% | 113 / 178 |
| apt ε=1 + μ | 76.26% | 83.64% | 72.57% | 109 / 187 |
| apt ε=1 + BALD | 90.32% | 92.64% | 77.32% | 114 / 150 |
| apt ε=1 + look | 81.01% | 86.03% | 73.54% | 96 / 128 |
| apt ε=2 + μ | 72.06% | 78.56% | 64.14% | 93 / 128 |
| apt ε=2 + BALD | 89.33% | 91.81% | 73.38% | 101 / 152 |
| apt ε=2 + look | 78.27% | 83.49% | 68.86% | 90 / 115 |
| apt ε=4 + μ | 66.36% | 72.07% | 53.72% | 69 / 96 |
| apt ε=4 + BALD | 87.08% | 89.68% | 65.35% | 71 / 119 |
| apt ε=4 + look | 71.85% | 78.09% | 59.59% | 52 / 77 |
| lsa + μ | 64.49% | 70.19% | 55.31% | 120 / 181 |
| lsa + BALD | 82.35% | 85.30% | 65.93% | 107 / 143 |
| lsa + look | 73.41% | 78.27% | 61.21% | 89 / 105 |
| uleast + μ | 6.36% | 10.50% | 4.12% | 38 / 81 |
| uleast + BALD | 27.73% | 35.09% | 22.82% | 37 / 45 |
| uleast + look | 19.84% | 26.90% | 16.05% | 24 / 40 |

## Full runs, k = 2.5

Each to a Decided share, and to 95% of those outside the fuzzy middle:

| Case | Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 120, T(noise=0.5), k = 2.5 | Baseline | 10.40 | 14.55 | 23.05 | — (6/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 120, T(noise=0.5), k = 2.5 | uleast + BALD | 8.30 | 10.70 | 14.75 | 24.85 | — (0/20) | 30.75 (18/20) | — (1/20) |
| n = 120, T(noise=0.5), k = 2.5 | uleast + μ | 8.35 | 10.30 | 13.30 | 19.60 | — (6/20) | 22.05 | — (8/20) |
| n = 120, T(noise=0.5), k = 2.5 | lsa + look | 9.60 | 11.45 | 14.30 | 17.45 | 32.95 (16/20) | 21.65 | 30.95 (16/20) |
| n = 120, T(noise=1), k = 2.5 | Baseline | 12.20 | 16.40 | 26.55 (19/20) | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 120, T(noise=1), k = 2.5 | uleast + BALD | 8.20 | 10.50 | 14.10 | 19.35 | 36.15 (14/20) | 33.25 (17/20) | — (4/20) |
| n = 120, T(noise=1), k = 2.5 | uleast + μ | 9.60 | 12.20 | 16.65 | 23.40 (18/20) | — (1/20) | 35.55 (11/20) | — (0/20) |
| n = 120, T(noise=1), k = 2.5 | lsa + look | 12.50 | 16.45 | 22.70 | 35.35 (14/20) | — (0/20) | — (3/20) | — (0/20) |
| n = 500, T(noise=0.5), k = 2.5 | Baseline | 10.70 | 15.55 | 24.05 | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=0.5), k = 2.5 | uleast + BALD | 8.30 | 10.70 | 14.74 | 25.68 | — (0/20) | 34.85 (16/20) | — (0/20) |
| n = 500, T(noise=0.5), k = 2.5 | uleast + μ | 8.35 | 10.27 | 13.34 | 18.82 | 38.93 (11/20) | 22.37 | — (8/20) |
| n = 500, T(noise=0.5), k = 2.5 | lsa + look | 9.65 | 11.18 | 13.78 | 17.57 | 35.71 (15/20) | 20.83 | 39.74 (11/20) |
| n = 500, T(noise=1), k = 2.5 | Baseline | 12.14 | 17.76 | 27.31 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 2000, T(noise=0.5), k = 2.5 | Baseline | 10.95 | 15.60 | 24.80 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + BALD | 8.30 | 10.80 | 15.15 | 26.45 | — (0/20) | 36.90 (18/20) | — (0/20) |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + μ | 8.35 | 10.40 | 13.40 | 18.95 | — (5/20) | 22.80 | — (7/20) |
| n = 2000, T(noise=0.5), k = 2.5 | lsa + look | 10.00 | 11.55 | 14.15 | 18.40 | 34.80 (16/20) | 21.15 | 36.70 (14/20) |
| n = 2000, T(noise=1), k = 2.5 | Baseline | 12.50 | 17.85 | 28.75 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 2000, T(noise=1), k = 2.5 | uleast + BALD | 8.30 | 10.50 | 13.70 | 19.60 | 38.75 (11/20) | 36.50 (18/20) | — (0/20) |
| n = 2000, T(noise=1), k = 2.5 | uleast + μ | 9.65 | 12.10 | 16.25 | 24.80 | — (0/20) | 39.75 (10/20) | — (0/20) |
| n = 2000, T(noise=1), k = 2.5 | lsa + look | 13.35 | 17.00 | 21.80 | 32.85 | — (0/20) | — (0/20) | — (0/20) |
| n = 120, BT(noise=0.5), k = 2.5 | Baseline | 10.85 | 15.00 | 23.55 | — (5/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + BALD | 8.20 | 10.90 | 15.10 | 25.05 | — (1/20) | 33.70 (15/20) | — (1/20) |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + μ | 8.15 | 10.30 | 13.10 | 18.80 | 34.90 (12/20) | 22.35 | 35.45 (12/20) |
| n = 120, BT(noise=0.5), k = 2.5 | lsa + look | 9.80 | 10.90 | 13.60 | 17.65 | 35.45 (13/20) | 20.65 | 36.30 (11/20) |
| n = 120, BT(noise=1), k = 2.5 | Baseline | 11.80 | 15.95 | 26.20 | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 120, BT(noise=1), k = 2.5 | uleast + BALD | 8.35 | 10.40 | 14.00 | 19.05 | 37.40 (12/20) | 35.30 (14/20) | — (4/20) |
| n = 120, BT(noise=1), k = 2.5 | uleast + μ | 9.05 | 11.55 | 15.05 | 22.15 | — (4/20) | 30.10 (14/20) | — (1/20) |
| n = 120, BT(noise=1), k = 2.5 | lsa + look | 13.25 | 16.55 | 20.95 | 34.15 (17/20) | — (0/20) | — (2/20) | — (0/20) |
| n = 500, BT(noise=0.5), k = 2.5 | Baseline | 11.04 | 15.65 | 24.38 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + BALD | 8.21 | 10.90 | 14.88 | 25.82 | — (0/20) | 36.86 (14/20) | — (0/20) |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + μ | 8.40 | 10.37 | 13.44 | 18.62 | — (8/20) | 22.51 | — (7/20) |
| n = 500, BT(noise=0.5), k = 2.5 | lsa + look | 10.03 | 11.42 | 13.87 | 17.33 | 30.34 (19/20) | 20.59 | 30.53 (17/20) |
| n = 500, BT(noise=1), k = 2.5 | Baseline | 12.19 | 17.76 | 28.66 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |
| n = 2000, BT(noise=0.5), k = 2.5 | Baseline | 10.95 | 15.55 | 24.50 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + BALD | 8.35 | 10.80 | 15.05 | 26.00 | — (0/20) | 35.20 (17/20) | — (0/20) |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + μ | 8.35 | 10.45 | 13.50 | 18.90 | — (5/20) | 22.45 | 38.80 (12/20) |
| n = 2000, BT(noise=0.5), k = 2.5 | lsa + look | 10.05 | 11.60 | 14.35 | 18.35 | 33.40 (17/20) | 21.50 | 32.25 (18/20) |
| n = 2000, BT(noise=1), k = 2.5 | Baseline | 12.25 | 17.75 | 28.75 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | uleast + BALD | 8.30 | 10.50 | 13.80 | 19.80 | 39.30 (10/20) | 35.15 (19/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.05 | 16.05 | 23.75 | — (0/20) | 38.90 (13/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | lsa + look | 12.85 | 16.65 | 21.75 | 31.35 | — (0/20) | — (0/20) | — (0/20) |

Clear-out side, Decided share and wrong side:

| Case | Selector | Below @4 | @8 | @16 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 120, T(noise=0.5), k = 2.5 | Baseline | 0.00% | 4.58% | 28.54% | 40.04% | 60.38% | 76.92% | 0.00% | 0.00% | 0.00% | 0.00% | 0.01% | 0.18% |
| n = 120, T(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 14.17% | 41.67% | 47.46% | 70.75% | 83.96% | 0.20% | 0.00% | 0.00% | 0.00% | 0.02% | 0.23% |
| n = 120, T(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 8.96% | 46.46% | 46.67% | 74.83% | 88.12% | 0.00% | 0.09% | 0.06% | 0.05% | 0.07% | 0.38% |
| n = 120, T(noise=0.5), k = 2.5 | lsa + look | 0.00% | 5.21% | 37.92% | 21.25% | 69.96% | 87.62% | — | 0.59% | 0.66% | 0.48% | 0.53% | 1.96% |
| n = 120, T(noise=1), k = 2.5 | Baseline | 0.00% | 2.71% | 18.12% | 35.54% | 57.46% | 74.88% | 0.54% | 0.94% | 1.16% | 0.67% | 0.79% | 5.77% |
| n = 120, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | 14.58% | 41.46% | 48.12% | 74.04% | 88.92% | 1.43% | 1.21% | 1.74% | 2.67% | 2.03% | 2.67% |
| n = 120, T(noise=1), k = 2.5 | uleast + μ | 0.00% | 7.92% | 36.46% | 43.38% | 68.58% | 85.67% | 0.25% | 0.67% | 0.85% | 0.68% | 0.77% | 1.01% |
| n = 120, T(noise=1), k = 2.5 | lsa + look | 0.00% | 2.29% | 23.54% | 10.21% | 48.58% | 78.46% | — | 3.67% | 1.46% | 1.22% | 1.37% | 4.98% |
| n = 500, T(noise=0.5), k = 2.5 | Baseline | 0.00% | 5.50% | 27.25% | 39.72% | 60.77% | 77.64% | 0.11% | 0.10% | 0.02% | 0.00% | 0.02% | 0.72% |
| n = 500, T(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 14.30% | 42.60% | 48.56% | 71.70% | 83.87% | 0.05% | 0.04% | 0.06% | 0.00% | 0.03% | 0.44% |
| n = 500, T(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 11.45% | 49.75% | 47.68% | 75.72% | 89.56% | 0.00% | 0.08% | 0.12% | 0.08% | 0.10% | 0.15% |
| n = 500, T(noise=0.5), k = 2.5 | lsa + look | 0.00% | 4.05% | 42.45% | 20.14% | 71.66% | 86.57% | 0.00% | 0.40% | 0.32% | 0.22% | 0.28% | 0.51% |
| n = 500, T(noise=1), k = 2.5 | Baseline | 0.00% | 4.60% | 23.35% | 36.45% | 57.51% | 75.09% | 0.55% | 0.80% | 0.87% | 0.69% | 0.72% | 0.94% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | 13.70% | 44.15% | 47.72% | 74.43% | 89.83% | 0.92% | 1.09% | 1.29% | 2.32% | 1.66% | 2.32% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 0.00% | 7.85% | 38.10% | 42.52% | 69.60% | 85.67% | 1.04% | 1.20% | 1.19% | 1.02% | 1.15% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 0.00% | 2.75% | 24.55% | 6.54% | 45.25% | 78.35% | 0.00% | 1.68% | 1.26% | 0.98% | 1.12% | 2.68% |
| n = 2000, T(noise=0.5), k = 2.5 | Baseline | 0.00% | 5.46% | 26.59% | 39.50% | 60.48% | 77.08% | 0.08% | 0.04% | 0.05% | 0.03% | 0.04% | 0.18% |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 13.85% | 42.55% | 48.22% | 71.47% | 83.83% | 0.12% | 0.07% | 0.06% | 0.01% | 0.04% | 0.32% |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 11.30% | 48.71% | 47.85% | 75.50% | 89.59% | 0.15% | 0.14% | 0.12% | 0.08% | 0.10% | 0.16% |
| n = 2000, T(noise=0.5), k = 2.5 | lsa + look | 0.00% | 5.16% | 43.55% | 20.49% | 67.76% | 87.61% | 0.00% | 0.35% | 0.34% | 0.28% | 0.32% | 0.48% |
| n = 2000, T(noise=1), k = 2.5 | Baseline | 0.00% | 4.65% | 22.06% | 36.01% | 57.16% | 75.05% | 0.90% | 0.84% | 0.94% | 0.71% | 0.87% | 1.35% |
| n = 2000, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | 13.20% | 43.85% | 48.17% | 74.81% | 89.94% | 1.00% | 1.41% | 1.76% | 2.92% | 2.18% | 3.08% |
| n = 2000, T(noise=1), k = 2.5 | uleast + μ | 0.00% | 7.70% | 37.48% | 42.19% | 69.20% | 85.70% | 0.71% | 1.03% | 1.24% | 1.06% | 1.16% | 1.30% |
| n = 2000, T(noise=1), k = 2.5 | lsa + look | 0.00% | 2.76% | 25.60% | 7.73% | 45.69% | 78.89% | 6.25% | 1.71% | 1.37% | 1.09% | 1.27% | 2.10% |
| n = 120, BT(noise=0.5), k = 2.5 | Baseline | 0.00% | 5.83% | 24.17% | 39.58% | 61.29% | 77.62% | 0.25% | 0.32% | 0.07% | 0.00% | 0.04% | 1.13% |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 14.38% | 40.83% | 48.29% | 71.08% | 84.00% | 0.39% | 0.17% | 0.06% | 0.00% | 0.06% | 0.88% |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 9.58% | 45.83% | 47.25% | 74.96% | 89.50% | 0.22% | 0.09% | 0.17% | 0.14% | 0.16% | 1.96% |
| n = 120, BT(noise=0.5), k = 2.5 | lsa + look | 0.00% | 3.75% | 40.21% | 24.04% | 68.42% | 87.25% | 0.00% | 0.69% | 0.55% | 0.48% | 0.54% | 1.23% |
| n = 120, BT(noise=1), k = 2.5 | Baseline | 0.00% | 4.79% | 25.62% | 35.21% | 57.08% | 75.17% | 0.59% | 1.30% | 1.02% | 0.83% | 1.00% | 1.53% |
| n = 120, BT(noise=1), k = 2.5 | uleast + BALD | 0.00% | 15.21% | 44.79% | 47.75% | 73.62% | 87.79% | 1.02% | 1.31% | 1.64% | 2.23% | 1.74% | 2.28% |
| n = 120, BT(noise=1), k = 2.5 | uleast + μ | 0.00% | 9.58% | 37.92% | 42.58% | 69.88% | 86.50% | 0.86% | 0.59% | 0.66% | 0.63% | 0.69% | 1.72% |
| n = 120, BT(noise=1), k = 2.5 | lsa + look | 0.00% | 2.08% | 21.67% | 9.79% | 50.17% | 77.79% | 0.00% | 0.43% | 1.25% | 0.91% | 1.01% | 3.08% |
| n = 500, BT(noise=0.5), k = 2.5 | Baseline | 0.00% | 6.05% | 27.65% | 38.97% | 60.49% | 77.42% | 0.00% | 0.03% | 0.07% | 0.03% | 0.03% | 0.44% |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 13.65% | 42.70% | 48.43% | 71.64% | 83.55% | 0.09% | 0.08% | 0.04% | 0.01% | 0.04% | 0.15% |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 11.15% | 48.35% | 47.49% | 75.56% | 89.39% | 0.10% | 0.13% | 0.13% | 0.06% | 0.09% | 0.17% |
| n = 500, BT(noise=0.5), k = 2.5 | lsa + look | 0.00% | 6.00% | 38.95% | 15.45% | 74.16% | 86.25% | 0.00% | 0.32% | 0.31% | 0.29% | 0.32% | 0.72% |
| n = 500, BT(noise=1), k = 2.5 | Baseline | 0.00% | 4.45% | 23.40% | 35.97% | 57.42% | 75.01% | 0.67% | 0.78% | 0.75% | 0.57% | 0.68% | 1.94% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 0.00% | 13.35% | 43.75% | 48.09% | 74.46% | 89.79% | 0.95% | 1.12% | 1.46% | 2.58% | 1.88% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 0.00% | 6.60% | 37.80% | 42.04% | 69.19% | 85.57% | 0.64% | 0.95% | 1.19% | 0.81% | 1.02% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 0.00% | 1.95% | 24.15% | 10.65% | 50.77% | 76.89% | 0.00% | 1.97% | 1.44% | 0.99% | 1.20% | 3.05% |
| n = 2000, BT(noise=0.5), k = 2.5 | Baseline | 0.00% | 5.30% | 27.00% | 39.53% | 60.63% | 77.39% | 0.09% | 0.07% | 0.03% | 0.01% | 0.03% | 0.30% |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + BALD | 0.00% | 14.12% | 42.20% | 48.15% | 71.63% | 84.10% | 0.13% | 0.08% | 0.07% | 0.03% | 0.05% | 0.81% |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + μ | 0.00% | 11.10% | 48.42% | 47.81% | 75.55% | 89.67% | 0.13% | 0.13% | 0.10% | 0.08% | 0.09% | 0.25% |
| n = 2000, BT(noise=0.5), k = 2.5 | lsa + look | 0.00% | 4.49% | 45.65% | 21.27% | 66.05% | 87.71% | 0.00% | 0.34% | 0.34% | 0.23% | 0.30% | 0.59% |
| n = 2000, BT(noise=1), k = 2.5 | Baseline | 0.00% | 4.34% | 22.44% | 36.10% | 57.30% | 74.89% | 0.72% | 0.80% | 0.84% | 0.68% | 0.80% | 1.09% |
| n = 2000, BT(noise=1), k = 2.5 | uleast + BALD | 0.00% | 13.46% | 43.89% | 48.05% | 74.41% | 90.10% | 1.16% | 1.09% | 1.53% | 2.56% | 1.93% | 2.56% |
| n = 2000, BT(noise=1), k = 2.5 | uleast + μ | 0.00% | 7.35% | 37.91% | 42.03% | 69.78% | 86.13% | 0.80% | 1.06% | 1.25% | 1.02% | 1.14% | 1.26% |
| n = 2000, BT(noise=1), k = 2.5 | lsa + look | 0.00% | 2.58% | 23.91% | 10.08% | 48.06% | 79.82% | 5.26% | 1.46% | 1.31% | 1.03% | 1.17% | 1.89% |

Repeats and stops (no rule here has a stop, so the fallback never fires):

| Case | Selector | 2 back | Last 5 | ≥3 in 10 | Longest streak | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 120, T(noise=0.5), k = 2.5 | Baseline | 1.59% | 6.77% | 0.29% | 2 / 3 | 0.00% / 23.08% / 23.08% | — (0/20) | 36.00 | 23.25 |
| n = 120, T(noise=0.5), k = 2.5 | uleast + BALD | 16.07% | 24.48% | 12.18% | 15 / 32 | 11.42% / 16.04% / 16.04% | — (1/20) | 21.15 | 14.45 |
| n = 120, T(noise=0.5), k = 2.5 | uleast + μ | 14.91% | 35.99% | 14.35% | 30 / 94 | 11.83% / 11.88% / 11.88% | 26.25 | 17.85 | 13.95 |
| n = 120, T(noise=0.5), k = 2.5 | lsa + look | 76.32% | 83.78% | 70.80% | 72 / 134 | 9.71% / 9.88% / 10.29% | 25.25 | 18.30 | 17.05 |
| n = 120, T(noise=1), k = 2.5 | Baseline | 1.64% | 6.79% | 0.28% | 2 / 3 | 0.00% / 25.12% / 25.12% | — (0/20) | 35.35 | 23.05 |
| n = 120, T(noise=1), k = 2.5 | uleast + BALD | 29.94% | 38.96% | 25.07% | 30 / 46 | 3.62% / 11.08% / 11.08% | — (0/20) | 21.15 | 14.35 |
| n = 120, T(noise=1), k = 2.5 | uleast + μ | 12.72% | 29.95% | 10.47% | 27 / 47 | 14.33% / 14.33% / 14.33% | 29.70 | 19.30 | 14.70 |
| n = 120, T(noise=1), k = 2.5 | lsa + look | 74.64% | 81.46% | 65.16% | 55 / 80 | 18.75% / 20.38% / 21.21% | 35.10 (19/20) | 22.70 | 18.35 |
| n = 500, T(noise=0.5), k = 2.5 | Baseline | 0.39% | 1.57% | 0.02% | 2 / 3 | 0.00% / 22.36% / 22.36% | — (0/20) | 36.53 | 23.52 |
| n = 500, T(noise=0.5), k = 2.5 | uleast + BALD | 15.25% | 21.19% | 11.17% | 22 / 36 | 11.47% / 16.13% / 16.13% | — (0/20) | 22.13 | 14.64 |
| n = 500, T(noise=0.5), k = 2.5 | uleast + μ | 7.13% | 12.52% | 4.70% | 37 / 108 | 10.44% / 10.44% / 10.44% | 25.92 | 17.62 | 14.11 |
| n = 500, T(noise=0.5), k = 2.5 | lsa + look | 74.87% | 79.43% | 64.62% | 115 / 211 | 10.18% / 10.52% / 10.84% | 24.58 | 19.82 | 18.96 |
| n = 500, T(noise=1), k = 2.5 | Baseline | 0.39% | 1.63% | 0.02% | 2 / 3 | 0.00% / 24.91% / 24.91% | — (0/20) | 35.90 | 23.23 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 28.11% | 35.32% | 23.09% | 39 / 60 | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 6.61% | 10.82% | 4.29% | 39 / 81 | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 73.49% | 78.39% | 61.38% | 85 / 105 | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |
| n = 2000, T(noise=0.5), k = 2.5 | Baseline | 0.10% | 0.39% | 0.00% | 2 / 2 | 0.00% / 22.92% / 22.92% | — (0/20) | 36.85 | 24.00 |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + BALD | 14.81% | 20.24% | 10.70% | 31 / 51 | 11.48% / 16.17% / 16.17% | — (0/20) | 22.45 | 14.75 |
| n = 2000, T(noise=0.5), k = 2.5 | uleast + μ | 5.54% | 6.95% | 3.89% | 68 / 113 | 10.40% / 10.40% / 10.40% | 26.05 | 17.85 | 14.45 |
| n = 2000, T(noise=0.5), k = 2.5 | lsa + look | 74.44% | 78.22% | 63.23% | 146 / 221 | 9.66% / 9.89% / 10.22% | 25.55 | 25.30 | 25.30 |
| n = 2000, T(noise=1), k = 2.5 | Baseline | 0.10% | 0.40% | 0.00% | 2 / 2 | 0.00% / 24.95% / 24.95% | — (0/20) | 36.35 | 23.50 |
| n = 2000, T(noise=1), k = 2.5 | uleast + BALD | 28.84% | 35.52% | 23.36% | 46 / 60 | 4.83% / 10.06% / 10.06% | — (0/20) | 22.60 | 14.85 |
| n = 2000, T(noise=1), k = 2.5 | uleast + μ | 5.67% | 6.80% | 3.97% | 59 / 110 | 14.30% / 14.30% / 14.30% | 29.30 | 19.50 | 15.40 |
| n = 2000, T(noise=1), k = 2.5 | lsa + look | 73.01% | 77.34% | 60.08% | 101 / 149 | 17.90% / 18.41% / 18.93% | 33.40 | 26.00 | 26.00 |
| n = 120, BT(noise=0.5), k = 2.5 | Baseline | 1.70% | 6.75% | 0.27% | 2 / 3 | 0.00% / 22.38% / 22.38% | — (0/20) | 36.30 | 23.20 |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + BALD | 15.86% | 24.23% | 12.12% | 16 / 41 | 11.29% / 16.00% / 16.00% | — (2/20) | 21.15 | 14.30 |
| n = 120, BT(noise=0.5), k = 2.5 | uleast + μ | 15.32% | 36.49% | 15.15% | 26 / 71 | 10.50% / 10.50% / 10.50% | 26.20 | 17.65 | 14.10 |
| n = 120, BT(noise=0.5), k = 2.5 | lsa + look | 76.44% | 83.61% | 70.81% | 81 / 128 | 10.25% / 10.79% / 11.17% | 25.35 | 18.40 | 17.00 |
| n = 120, BT(noise=1), k = 2.5 | Baseline | 1.63% | 6.61% | 0.28% | 2 / 3 | 0.00% / 24.83% / 24.83% | — (0/20) | 35.45 | 22.75 |
| n = 120, BT(noise=1), k = 2.5 | uleast + BALD | 29.84% | 38.59% | 24.83% | 24 / 44 | 2.88% / 12.21% / 12.21% | — (2/20) | 21.10 | 14.45 |
| n = 120, BT(noise=1), k = 2.5 | uleast + μ | 13.48% | 31.66% | 11.41% | 21 / 119 | 13.50% / 13.50% / 13.50% | 28.15 | 18.95 | 14.70 |
| n = 120, BT(noise=1), k = 2.5 | lsa + look | 74.74% | 81.76% | 65.47% | 60 / 91 | 18.79% / 20.75% / 21.75% | 33.60 | 22.65 | 18.70 |
| n = 500, BT(noise=0.5), k = 2.5 | Baseline | 0.42% | 1.66% | 0.01% | 2 / 2 | 0.00% / 22.58% / 22.58% | — (0/20) | 36.43 | 23.42 |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + BALD | 15.23% | 21.09% | 11.25% | 22 / 78 | 11.35% / 16.45% / 16.45% | — (0/20) | 21.94 | 14.50 |
| n = 500, BT(noise=0.5), k = 2.5 | uleast + μ | 7.21% | 12.48% | 4.83% | 44 / 101 | 10.61% / 10.61% / 10.61% | 25.97 | 17.76 | 14.16 |
| n = 500, BT(noise=0.5), k = 2.5 | lsa + look | 74.79% | 79.56% | 64.79% | 99 / 227 | 9.57% / 10.21% / 10.73% | 24.67 | 19.58 | 18.58 |
| n = 500, BT(noise=1), k = 2.5 | Baseline | 0.39% | 1.55% | 0.01% | 2 / 3 | 0.00% / 24.99% / 24.99% | — (0/20) | 36.05 | 23.38 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 28.59% | 35.78% | 23.59% | 40 / 64 | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 7.04% | 11.12% | 4.63% | 41 / 107 | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 73.93% | 78.79% | 61.87% | 89 / 162 | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |
| n = 2000, BT(noise=0.5), k = 2.5 | Baseline | 0.10% | 0.40% | 0.00% | 2 / 2 | 0.00% / 22.61% / 22.61% | — (0/20) | 36.95 | 24.10 |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + BALD | 14.62% | 20.10% | 10.61% | 30 / 80 | 11.82% / 15.90% / 15.90% | — (0/20) | 22.40 | 14.75 |
| n = 2000, BT(noise=0.5), k = 2.5 | uleast + μ | 5.56% | 7.00% | 3.91% | 57 / 95 | 10.33% / 10.33% / 10.33% | 26.05 | 17.80 | 14.40 |
| n = 2000, BT(noise=0.5), k = 2.5 | lsa + look | 74.30% | 78.12% | 63.11% | 155 / 278 | 9.50% / 9.70% / 9.96% | 25.45 | 24.30 | 24.30 |
| n = 2000, BT(noise=1), k = 2.5 | Baseline | 0.10% | 0.40% | 0.00% | 2 / 3 | 0.00% / 25.11% / 25.11% | — (0/20) | 36.40 | 23.45 |
| n = 2000, BT(noise=1), k = 2.5 | uleast + BALD | 28.39% | 34.97% | 23.06% | 47 / 81 | 5.29% / 9.90% / 9.90% | — (0/20) | 22.85 | 14.85 |
| n = 2000, BT(noise=1), k = 2.5 | uleast + μ | 5.71% | 6.87% | 4.01% | 62 / 96 | 13.87% / 13.87% / 13.87% | 28.90 | 19.30 | 15.20 |
| n = 2000, BT(noise=1), k = 2.5 | lsa + look | 73.14% | 77.43% | 60.22% | 100 / 161 | 17.15% / 17.78% / 18.17% | 32.90 | 26.95 | 26.95 |

## Wrong side against k (noise 1.0)

Each selector reads the same k as the Decided rule.

| Case | Selector | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| n = 120, T(noise=1), k = 2 | Baseline | 1.49% | 1.94% | 1.76% | 1.24% | 1.58% | 3.24% |
| n = 120, T(noise=1), k = 2 | uleast + BALD, k=2 | 2.49% | 2.69% | 2.66% | 3.43% | 3.08% | 5.65% |
| n = 120, T(noise=1), k = 2 | uleast + μ, k=2 | 2.39% | 2.53% | 2.59% | 1.99% | 2.32% | 2.86% |
| n = 120, T(noise=1), k = 2 | lsa + look, k=2 | 4.56% | 4.30% | 3.14% | 2.56% | 3.02% | 5.18% |
| n = 120, BT(noise=1), k = 2 | Baseline | 1.62% | 2.29% | 2.00% | 1.33% | 1.75% | 2.89% |
| n = 120, BT(noise=1), k = 2 | uleast + BALD, k=2 | 1.94% | 2.79% | 2.71% | 3.42% | 3.08% | 5.73% |
| n = 120, BT(noise=1), k = 2 | uleast + μ, k=2 | 1.07% | 2.09% | 2.00% | 1.36% | 1.72% | 2.28% |
| n = 120, BT(noise=1), k = 2 | lsa + look, k=2 | 4.45% | 4.46% | 3.22% | 2.60% | 3.09% | 5.42% |
| n = 500, T(noise=1), k = 2 | Baseline | 1.43% | 1.72% | 1.52% | 1.27% | 1.46% | 2.50% |
| n = 500, T(noise=1), k = 2 | uleast + BALD, k=2 | 2.33% | 2.71% | 3.03% | 3.77% | 3.31% | 3.78% |
| n = 500, T(noise=1), k = 2 | uleast + μ, k=2 | 1.82% | 2.53% | 2.34% | 1.97% | 2.19% | 2.62% |
| n = 500, T(noise=1), k = 2 | lsa + look, k=2 | 3.32% | 4.14% | 3.52% | 2.90% | 3.28% | 4.18% |
| n = 500, BT(noise=1), k = 2 | Baseline | 1.40% | 1.59% | 1.53% | 1.11% | 1.41% | 2.30% |
| n = 500, BT(noise=1), k = 2 | uleast + BALD, k=2 | 2.49% | 2.68% | 2.82% | 3.32% | 3.05% | 3.39% |
| n = 500, BT(noise=1), k = 2 | uleast + μ, k=2 | 1.73% | 2.22% | 2.23% | 1.82% | 2.03% | 2.37% |
| n = 500, BT(noise=1), k = 2 | lsa + look, k=2 | 4.62% | 4.16% | 3.48% | 3.01% | 3.39% | 4.62% |
| n = 2000, T(noise=1), k = 2 | Baseline | 1.61% | 1.82% | 1.82% | 1.33% | 1.62% | 2.72% |
| n = 2000, T(noise=1), k = 2 | uleast + BALD, k=2 | 2.55% | 2.81% | 3.04% | 4.04% | 3.54% | 4.10% |
| n = 2000, T(noise=1), k = 2 | uleast + μ, k=2 | 1.93% | 2.44% | 2.33% | 1.90% | 2.16% | 2.51% |
| n = 2000, T(noise=1), k = 2 | lsa + look, k=2 | 3.93% | 4.24% | 3.64% | 3.20% | 3.47% | 4.30% |
| n = 2000, BT(noise=1), k = 2 | Baseline | 1.51% | 1.72% | 1.57% | 1.22% | 1.48% | 2.46% |
| n = 2000, BT(noise=1), k = 2 | uleast + BALD, k=2 | 2.27% | 2.54% | 2.78% | 3.61% | 3.15% | 3.64% |
| n = 2000, BT(noise=1), k = 2 | uleast + μ, k=2 | 1.83% | 2.42% | 2.22% | 1.90% | 2.12% | 2.42% |
| n = 2000, BT(noise=1), k = 2 | lsa + look, k=2 | 3.67% | 3.83% | 3.66% | 3.15% | 3.44% | 4.12% |
| n = 120, T(noise=1), k = 2.5 | Baseline | 0.89% | 1.16% | 1.22% | 0.91% | 0.94% | 2.43% |
| n = 120, T(noise=1), k = 2.5 | uleast + BALD | 1.21% | 1.69% | 2.03% | 2.73% | 2.30% | 2.90% |
| n = 120, T(noise=1), k = 2.5 | uleast + μ | 0.51% | 1.14% | 1.17% | 0.90% | 1.05% | 1.50% |
| n = 120, T(noise=1), k = 2.5 | lsa + look | — | 1.97% | 1.50% | 1.05% | 1.23% | 4.51% |
| n = 120, BT(noise=1), k = 2.5 | Baseline | 1.02% | 1.35% | 1.19% | 0.91% | 1.07% | 2.31% |
| n = 120, BT(noise=1), k = 2.5 | uleast + BALD | 1.56% | 1.49% | 1.97% | 2.67% | 2.06% | 2.75% |
| n = 120, BT(noise=1), k = 2.5 | uleast + μ | 0.56% | 0.80% | 1.11% | 0.78% | 0.92% | 1.17% |
| n = 120, BT(noise=1), k = 2.5 | lsa + look | 0.00% | 1.08% | 1.28% | 1.03% | 1.18% | 2.39% |
| n = 500, T(noise=1), k = 2.5 | Baseline | 0.68% | 0.65% | 0.79% | 0.73% | 0.76% | 1.29% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 1.02% | 1.28% | 1.58% | 2.53% | 1.89% | 2.54% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 0.95% | 0.97% | 1.08% | 0.89% | 1.00% | 1.47% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 0.00% | 1.67% | 1.14% | 0.95% | 1.10% | 2.57% |
| n = 500, BT(noise=1), k = 2.5 | Baseline | 0.70% | 0.79% | 0.84% | 0.61% | 0.75% | 1.23% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 0.87% | 1.26% | 1.75% | 2.66% | 2.02% | 2.89% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 0.79% | 1.04% | 1.13% | 0.83% | 0.99% | 1.21% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 0.00% | 1.94% | 1.39% | 1.05% | 1.22% | 2.51% |
| n = 2000, T(noise=1), k = 2.5 | Baseline | 0.90% | 0.84% | 0.94% | 0.71% | 0.87% | 1.35% |
| n = 2000, T(noise=1), k = 2.5 | uleast + BALD | 1.00% | 1.41% | 1.76% | 2.92% | 2.18% | 3.08% |
| n = 2000, T(noise=1), k = 2.5 | uleast + μ | 0.71% | 1.03% | 1.24% | 1.06% | 1.16% | 1.30% |
| n = 2000, T(noise=1), k = 2.5 | lsa + look | 6.25% | 1.71% | 1.37% | 1.09% | 1.27% | 2.10% |
| n = 2000, BT(noise=1), k = 2.5 | Baseline | 0.72% | 0.80% | 0.84% | 0.68% | 0.80% | 1.09% |
| n = 2000, BT(noise=1), k = 2.5 | uleast + BALD | 1.16% | 1.09% | 1.53% | 2.56% | 1.93% | 2.56% |
| n = 2000, BT(noise=1), k = 2.5 | uleast + μ | 0.80% | 1.06% | 1.25% | 1.02% | 1.14% | 1.26% |
| n = 2000, BT(noise=1), k = 2.5 | lsa + look | 5.26% | 1.46% | 1.31% | 1.03% | 1.17% | 1.89% |
| n = 120, T(noise=1), k = 3 | Baseline | 0.26% | 0.37% | 0.68% | 0.64% | 0.58% | 1.25% |
| n = 120, T(noise=1), k = 3 | uleast + BALD, k=3 | 0.17% | 0.74% | 1.12% | 1.90% | 1.40% | 2.00% |
| n = 120, T(noise=1), k = 3 | uleast + μ, k=3 | 0.00% | 0.63% | 0.60% | 0.46% | 0.53% | 0.68% |
| n = 120, T(noise=1), k = 3 | lsa + look, k=3 | — | — | 0.46% | 0.36% | 0.38% | 1.67% |
| n = 120, BT(noise=1), k = 3 | Baseline | 0.28% | 0.64% | 0.70% | 0.52% | 0.61% | 0.77% |
| n = 120, BT(noise=1), k = 3 | uleast + BALD, k=3 | 0.17% | 0.84% | 1.13% | 1.43% | 1.09% | 1.47% |
| n = 120, BT(noise=1), k = 3 | uleast + μ, k=3 | 0.29% | 0.29% | 0.48% | 0.58% | 0.61% | 0.75% |
| n = 120, BT(noise=1), k = 3 | lsa + look, k=3 | — | — | 0.42% | 0.24% | 0.38% | 1.05% |
| n = 500, T(noise=1), k = 3 | Baseline | 0.24% | 0.21% | 0.35% | 0.43% | 0.39% | 0.45% |
| n = 500, T(noise=1), k = 3 | uleast + BALD, k=3 | 0.46% | 0.53% | 0.92% | 1.59% | 1.17% | 1.59% |
| n = 500, T(noise=1), k = 3 | uleast + μ, k=3 | 0.31% | 0.57% | 0.67% | 0.58% | 0.63% | 0.74% |
| n = 500, T(noise=1), k = 3 | lsa + look, k=3 | 0.00% | 0.00% | 0.43% | 0.32% | 0.34% | 0.97% |
| n = 500, BT(noise=1), k = 3 | Baseline | 0.39% | 0.33% | 0.46% | 0.36% | 0.38% | 0.79% |
| n = 500, BT(noise=1), k = 3 | uleast + BALD, k=3 | 0.65% | 0.54% | 0.85% | 1.31% | 1.00% | 1.33% |
| n = 500, BT(noise=1), k = 3 | uleast + μ, k=3 | 0.37% | 0.30% | 0.57% | 0.44% | 0.50% | 0.66% |
| n = 500, BT(noise=1), k = 3 | lsa + look, k=3 | 0.00% | 0.00% | 0.43% | 0.22% | 0.28% | 0.51% |
| n = 2000, T(noise=1), k = 3 | Baseline | 0.36% | 0.42% | 0.43% | 0.39% | 0.45% | 0.61% |
| n = 2000, T(noise=1), k = 3 | uleast + BALD, k=3 | 0.51% | 0.59% | 0.99% | 1.71% | 1.23% | 1.72% |
| n = 2000, T(noise=1), k = 3 | uleast + μ, k=3 | 0.67% | 0.50% | 0.67% | 0.62% | 0.66% | 0.79% |
| n = 2000, T(noise=1), k = 3 | lsa + look, k=3 | 0.00% | 0.00% | 0.39% | 0.21% | 0.30% | 0.53% |
| n = 2000, BT(noise=1), k = 3 | Baseline | 0.39% | 0.38% | 0.42% | 0.39% | 0.41% | 0.62% |
| n = 2000, BT(noise=1), k = 3 | uleast + BALD, k=3 | 0.76% | 0.65% | 0.80% | 1.46% | 1.03% | 1.46% |
| n = 2000, BT(noise=1), k = 3 | uleast + μ, k=3 | 0.41% | 0.56% | 0.65% | 0.54% | 0.60% | 0.68% |
| n = 2000, BT(noise=1), k = 3 | lsa + look, k=3 | 0.00% | 0.00% | 0.51% | 0.26% | 0.31% | 0.57% |

What each k costs:

| Case | Selector | 50% | 60% | 70% | 80% | 90% |
|---|---:|---:|---:|---:|---:|---:|
| n = 120, T(noise=1), k = 2 | Baseline | 8.65 | 12.20 | 18.45 | 36.85 (35/50) | — (0/50) |
| n = 120, T(noise=1), k = 2 | uleast + BALD, k=2 | 5.80 | 7.55 | 9.80 | 14.00 | 26.50 (48/50) |
| n = 120, T(noise=1), k = 2 | uleast + μ, k=2 | 6.50 | 8.45 | 11.05 | 16.15 | 32.85 (34/50) |
| n = 120, T(noise=1), k = 2 | lsa + look, k=2 | 6.90 | 8.70 | 12.75 | 17.05 | 33.05 (37/50) |
| n = 120, BT(noise=1), k = 2 | Baseline | 8.30 | 12.15 | 17.55 | 35.55 (36/50) | — (0/50) |
| n = 120, BT(noise=1), k = 2 | uleast + BALD, k=2 | 5.80 | 7.45 | 9.75 | 13.95 | 26.25 (44/50) |
| n = 120, BT(noise=1), k = 2 | uleast + μ, k=2 | 6.75 | 8.65 | 11.50 | 16.25 | 32.35 (36/50) |
| n = 120, BT(noise=1), k = 2 | lsa + look, k=2 | 6.95 | 8.85 | 12.25 | 17.15 | 31.40 (35/50) |
| n = 500, T(noise=1), k = 2 | Baseline | 8.74 | 12.77 | 19.68 | 38.45 (29/50) | — (0/50) |
| n = 500, T(noise=1), k = 2 | uleast + BALD, k=2 | 5.86 | 7.58 | 9.94 | 14.06 | 25.30 |
| n = 500, T(noise=1), k = 2 | uleast + μ, k=2 | 6.67 | 8.54 | 11.23 | 16.18 | 33.26 (42/50) |
| n = 500, T(noise=1), k = 2 | lsa + look, k=2 | 6.91 | 8.78 | 12.43 | 16.75 | 30.24 (42/50) |
| n = 500, BT(noise=1), k = 2 | Baseline | 8.83 | 12.62 | 19.82 | 38.11 (32/50) | — (0/50) |
| n = 500, BT(noise=1), k = 2 | uleast + BALD, k=2 | 5.81 | 7.54 | 9.94 | 14.30 | 26.30 |
| n = 500, BT(noise=1), k = 2 | uleast + μ, k=2 | 6.72 | 8.50 | 10.99 | 15.70 | 32.83 (46/50) |
| n = 500, BT(noise=1), k = 2 | lsa + look, k=2 | 6.82 | 8.50 | 12.19 | 16.22 | 29.23 (46/50) |
| n = 2000, T(noise=1), k = 2 | Baseline | 8.90 | 12.70 | 19.80 | 39.60 (13/20) | — (0/20) |
| n = 2000, T(noise=1), k = 2 | uleast + BALD, k=2 | 5.85 | 7.55 | 9.95 | 14.25 | 25.55 |
| n = 2000, T(noise=1), k = 2 | uleast + μ, k=2 | 6.75 | 8.50 | 11.15 | 15.95 | 34.30 |
| n = 2000, T(noise=1), k = 2 | lsa + look, k=2 | 6.75 | 8.35 | 12.20 | 16.90 | 28.35 |
| n = 2000, BT(noise=1), k = 2 | Baseline | 8.85 | 12.80 | 20.15 | 39.70 (11/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 2 | uleast + BALD, k=2 | 5.85 | 7.50 | 9.95 | 14.05 | 26.70 |
| n = 2000, BT(noise=1), k = 2 | uleast + μ, k=2 | 6.70 | 8.40 | 11.05 | 15.85 | 32.15 |
| n = 2000, BT(noise=1), k = 2 | lsa + look, k=2 | 6.80 | 8.55 | 12.50 | 16.50 | 26.90 |
| n = 120, T(noise=1), k = 2.5 | Baseline | 12.00 | 16.95 | 27.15 (48/50) | — (4/50) | — (0/50) |
| n = 120, T(noise=1), k = 2.5 | uleast + BALD | 8.25 | 10.40 | 13.70 | 19.35 | 37.65 (28/50) |
| n = 120, T(noise=1), k = 2.5 | uleast + μ | 9.55 | 12.10 | 16.50 | 23.60 (48/50) | — (2/50) |
| n = 120, T(noise=1), k = 2.5 | lsa + look | 13.45 | 17.40 | 24.20 | 36.75 (32/50) | — (0/50) |
| n = 120, BT(noise=1), k = 2.5 | Baseline | 11.80 | 16.65 | 26.20 | — (4/50) | — (0/50) |
| n = 120, BT(noise=1), k = 2.5 | uleast + BALD | 8.25 | 10.40 | 13.90 | 19.65 | 38.85 (28/50) |
| n = 120, BT(noise=1), k = 2.5 | uleast + μ | 9.60 | 11.95 | 16.00 | 23.15 | — (6/50) |
| n = 120, BT(noise=1), k = 2.5 | lsa + look | 13.40 | 16.70 | 22.15 | 35.80 (38/50) | — (0/50) |
| n = 500, T(noise=1), k = 2.5 | Baseline | 12.24 | 17.76 | 27.22 | — (0/50) | — (0/50) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.56 | 13.82 | 19.49 | 38.45 (32/50) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.55 | 12.24 | 16.32 | 25.06 | — (0/50) |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 17.04 | 22.03 | 35.09 (44/50) | — (0/50) |
| n = 500, BT(noise=1), k = 2.5 | Baseline | 12.10 | 17.62 | 28.22 | — (0/50) | — (0/50) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 8.30 | 10.46 | 13.78 | 19.49 | 38.78 (30/50) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 9.55 | 12.19 | 16.27 | 24.14 | — (0/50) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 12.96 | 16.42 | 21.26 | 32.50 (46/50) | — (0/50) |
| n = 2000, T(noise=1), k = 2.5 | Baseline | 12.50 | 17.85 | 28.75 | — (0/20) | — (0/20) |
| n = 2000, T(noise=1), k = 2.5 | uleast + BALD | 8.30 | 10.50 | 13.70 | 19.60 | 38.75 (11/20) |
| n = 2000, T(noise=1), k = 2.5 | uleast + μ | 9.65 | 12.10 | 16.25 | 24.80 | — (0/20) |
| n = 2000, T(noise=1), k = 2.5 | lsa + look | 13.35 | 17.00 | 21.80 | 32.85 | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | Baseline | 12.25 | 17.75 | 28.75 | — (0/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | uleast + BALD | 8.30 | 10.50 | 13.80 | 19.80 | 39.30 (10/20) |
| n = 2000, BT(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.05 | 16.05 | 23.75 | — (0/20) |
| n = 2000, BT(noise=1), k = 2.5 | lsa + look | 12.85 | 16.65 | 21.75 | 31.35 | — (0/20) |
| n = 120, T(noise=1), k = 3 | Baseline | 15.70 | 22.15 | 36.30 (39/50) | — (0/50) | — (0/50) |
| n = 120, T(noise=1), k = 3 | uleast + BALD, k=3 | 10.75 | 13.70 | 17.60 | 24.65 | — (8/50) |
| n = 120, T(noise=1), k = 3 | uleast + μ, k=3 | 12.75 | 16.45 | 22.55 | 36.55 (34/50) | — (0/50) |
| n = 120, T(noise=1), k = 3 | lsa + look, k=3 | 24.70 | 31.80 (44/50) | — (12/50) | — (1/50) | — (0/50) |
| n = 120, BT(noise=1), k = 3 | Baseline | 15.10 | 22.50 | 36.35 (35/50) | — (0/50) | — (0/50) |
| n = 120, BT(noise=1), k = 3 | uleast + BALD, k=3 | 10.75 | 13.70 | 17.85 | 25.25 | — (10/50) |
| n = 120, BT(noise=1), k = 3 | uleast + μ, k=3 | 12.85 | 16.30 | 21.90 | 34.95 (33/50) | — (0/50) |
| n = 120, BT(noise=1), k = 3 | lsa + look, k=3 | 24.60 | 30.90 (48/50) | — (17/50) | — (0/50) | — (0/50) |
| n = 500, T(noise=1), k = 3 | Baseline | 16.18 | 23.52 | 38.11 (34/50) | — (0/50) | — (0/50) |
| n = 500, T(noise=1), k = 3 | uleast + BALD, k=3 | 10.85 | 13.73 | 17.90 | 25.97 | — (0/50) |
| n = 500, T(noise=1), k = 3 | uleast + μ, k=3 | 12.82 | 16.32 | 22.27 | 35.47 (41/50) | — (0/50) |
| n = 500, T(noise=1), k = 3 | lsa + look, k=3 | 23.33 | 29.62 (49/50) | — (23/50) | — (0/50) | — (0/50) |
| n = 500, BT(noise=1), k = 3 | Baseline | 16.18 | 23.38 | 38.59 (34/50) | — (0/50) | — (0/50) |
| n = 500, BT(noise=1), k = 3 | uleast + BALD, k=3 | 10.85 | 13.73 | 18.14 | 26.11 | — (0/50) |
| n = 500, BT(noise=1), k = 3 | uleast + μ, k=3 | 12.72 | 16.18 | 21.84 | 34.66 (43/50) | — (0/50) |
| n = 500, BT(noise=1), k = 3 | lsa + look, k=3 | 23.09 | 28.56 | — (22/50) | — (0/50) | — (0/50) |
| n = 2000, T(noise=1), k = 3 | Baseline | 16.25 | 23.65 | 39.30 (13/20) | — (0/20) | — (0/20) |
| n = 2000, T(noise=1), k = 3 | uleast + BALD, k=3 | 10.90 | 13.70 | 17.95 | 26.10 | — (0/20) |
| n = 2000, T(noise=1), k = 3 | uleast + μ, k=3 | 12.80 | 16.35 | 22.05 | 35.40 (19/20) | — (0/20) |
| n = 2000, T(noise=1), k = 3 | lsa + look, k=3 | 23.00 | 29.15 | — (6/20) | — (0/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 3 | Baseline | 16.15 | 23.50 | 39.15 (15/20) | — (0/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 3 | uleast + BALD, k=3 | 10.85 | 13.80 | 18.05 | 26.30 | — (0/20) |
| n = 2000, BT(noise=1), k = 3 | uleast + μ, k=3 | 12.70 | 16.40 | 22.05 | 35.75 (19/20) | — (0/20) |
| n = 2000, BT(noise=1), k = 3 | lsa + look, k=3 | 22.60 | 28.00 | 37.45 (14/20) | — (0/20) | — (0/20) |

The 5–6% wrong at Each 4 for `lsa+look` at n = 2000 rests on 0.03–0.04% of
the library Decided (one or two wallpapers per run).

## Opponent pool (n = 500, noise 1.0)

| Case | Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 7.54 | 9.17 | 11.66 | 15.94 | 29.57 | 24.58 | 36.86 (12/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Decided | 19.34 | 24.86 | 31.73 (18/20) | 39.70 (11/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Undecided | 8.83 | 11.04 | 14.59 | 21.22 | — (1/20) | 36.43 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Decided | 29.76 | 38.26 (13/20) | — (1/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Undecided | 13.78 | 16.61 | 21.84 | 34.80 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Decided | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 7.44 | 9.12 | 11.57 | 15.89 | 29.42 | 24.29 | 37.78 (16/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Decided | 19.44 | 24.43 | 31.87 (19/20) | — (9/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Undecided | 8.69 | 11.04 | 14.45 | 21.17 | — (0/20) | 31.44 (18/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Decided | 28.70 | 38.54 (12/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Undecided | 12.91 | 16.27 | 20.83 | 32.78 (18/20) | — (0/20) | — (3/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Decided | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |

| Case | Selector | @8 | @16 | @8 | @16 | @40 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 13.70% | 44.15% | 47.72% | 74.43% | 89.83% | 2.32% | 1.66% | 2.32% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 18.40% | 53.15% | 53.51% | 79.96% | 92.40% | 2.01% | 1.96% | 2.12% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Decided | 0.00% | 1.20% | 26.86% | 42.46% | 78.01% | 0.87% | 0.38% | 0.98% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 7.85% | 38.10% | 42.52% | 69.60% | 85.67% | 1.02% | 1.15% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Undecided | 10.05% | 41.90% | 45.57% | 72.50% | 87.32% | 1.24% | 1.29% | 1.40% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Decided | 0.00% | 0.00% | 27.89% | 33.96% | 60.94% | 0.07% | 0.15% | 0.95% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 2.75% | 24.55% | 6.54% | 45.25% | 78.35% | 0.98% | 1.12% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Undecided | 2.75% | 24.55% | 6.54% | 45.25% | 76.44% | 0.95% | 1.11% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Decided | 0.00% | 0.00% | 1.84% | 9.34% | 20.60% | 0.39% | 0.69% | 1.85% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 13.35% | 43.75% | 48.09% | 74.46% | 89.79% | 2.58% | 1.88% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 17.75% | 53.55% | 53.88% | 80.11% | 92.47% | 2.18% | 2.14% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Decided | 0.00% | 3.05% | 27.94% | 42.98% | 78.39% | 0.88% | 0.29% | 0.90% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 6.60% | 37.80% | 42.04% | 69.19% | 85.57% | 0.81% | 1.02% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Undecided | 9.35% | 43.20% | 45.92% | 72.76% | 87.59% | 1.14% | 1.19% | 1.31% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Decided | 0.00% | 0.00% | 28.92% | 33.86% | 60.45% | 0.12% | 0.13% | 0.83% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 1.95% | 24.15% | 10.65% | 50.77% | 76.89% | 0.99% | 1.20% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Undecided | 1.95% | 24.15% | 10.65% | 50.77% | 81.20% | 1.06% | 1.21% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Decided | 0.00% | 0.00% | 1.50% | 8.92% | 21.54% | 0.70% | 0.82% | 2.43% |

| Case | Selector | 2 back | Last 5 | ≥3 in 10 | Longest streak |
|---|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 28.11% | 35.32% | 23.09% | 39 / 60 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 7.07% | 9.47% | 3.13% | 30 / 138 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, pool Decided | 27.81% | 52.72% | 35.00% | 21 / 40 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 6.61% | 10.82% | 4.29% | 39 / 81 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Undecided | 5.47% | 11.10% | 3.71% | 47 / 111 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, pool Decided | 5.67% | 12.59% | 5.58% | 145 / 252 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 73.49% | 78.39% | 61.38% | 85 / 105 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Undecided | 73.58% | 78.51% | 61.48% | 82 / 137 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, pool Decided | 93.01% | 94.53% | 90.40% | 2935 / 4438 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 28.59% | 35.78% | 23.59% | 40 / 64 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Undecided | 7.58% | 10.02% | 3.58% | 51 / 212 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, pool Decided | 27.11% | 51.73% | 33.97% | 15 / 45 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 7.04% | 11.12% | 4.63% | 41 / 107 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Undecided | 5.57% | 11.40% | 3.83% | 43 / 89 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, pool Decided | 5.52% | 12.88% | 5.64% | 107 / 228 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 73.93% | 78.79% | 61.87% | 89 / 162 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Undecided | 73.93% | 78.80% | 61.85% | 83 / 109 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, pool Decided | 93.17% | 94.73% | 90.71% | 3051 / 4356 |

## Repeats and the variety constraint (n = 500, noise 1.0)

| Case | Selector | 50% | 60% | 70% | 80% | 95% outside δ 0.25 |
|---|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 34.37 (18/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=3 | 8.30 | 10.56 | 13.73 | 19.58 | 32.11 (17/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=10 | 8.30 | 10.51 | 13.87 | 19.68 | 38.59 (12/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, top-8 | 8.45 | 10.56 | 13.78 | 19.92 | 38.16 (13/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.10 | 16.22 | 24.19 | 39.60 (12/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=3 | 9.31 | 12.10 | 16.18 | 24.53 | — (9/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=10 | 9.46 | 12.24 | 16.18 | 24.38 | 37.68 (11/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, top-8 | 9.65 | 12.10 | 16.27 | 24.34 | 38.11 (16/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=3 | 13.54 | 16.51 | 22.08 | 32.69 (19/20) | — (1/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=10 | 12.86 | 15.98 | 20.98 | 29.52 | — (1/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, top-8 | 13.44 | 17.09 | 21.84 | 30.34 (19/20) | — (1/20) |
| n = 500, T(noise=1), k = 2.5 | straddle + look | 14.16 | 17.47 | 23.33 | — (9/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=3 | 14.26 | 17.71 | 23.14 | 37.39 (13/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=10 | 14.21 | 17.09 | 21.79 | 33.22 (18/20) | — (1/20) |
| n = 500, T(noise=1), k = 2.5 | straddle + look, top-8 | 14.06 | 17.33 | 22.56 | 33.65 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look | 18.53 | 23.09 | 32.64 (19/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 17.14 | 21.55 | 28.94 (19/20) | — (6/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 16.46 | 19.73 | 25.63 | 39.36 (12/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 16.42 | 20.35 | 27.50 | 37.87 (11/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 33.84 (18/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=3 | 8.30 | 10.56 | 13.92 | 20.16 | 36.43 (17/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=10 | 8.30 | 10.56 | 13.68 | 20.11 | 35.76 (16/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, top-8 | 8.35 | 10.46 | 13.73 | 19.63 | 36.86 (15/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 9.60 | 12.19 | 16.27 | 24.19 | 36.72 (12/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=3 | 9.55 | 12.29 | 16.13 | 24.38 | 36.48 (15/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=10 | 9.65 | 12.34 | 16.61 | 25.20 | — (9/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, top-8 | 9.36 | 12.19 | 16.08 | 23.71 | 36.48 (12/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=3 | 13.10 | 17.33 | 21.84 | 30.86 (19/20) | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=10 | 12.62 | 16.46 | 21.79 | 29.28 (19/20) | — (4/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, top-8 | 13.39 | 16.75 | 21.46 | 30.82 (19/20) | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | straddle + look | 14.35 | 17.71 | 23.23 | 37.01 (13/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=3 | 13.58 | 17.18 | 22.56 | 33.46 (16/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=10 | 13.25 | 16.51 | 20.64 | 29.57 | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, top-8 | 13.97 | 17.09 | 22.70 | 32.88 (16/20) | — (1/20) |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look | 18.53 | 22.85 | 30.19 | — (1/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 17.14 | 21.02 | 26.40 | — (8/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 16.46 | 19.78 | 25.30 | 35.90 (13/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 16.22 | 20.21 | 25.15 | 37.20 (13/20) | — (0/20) |

| Case | Selector | @16 | @40 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 74.43% | 89.83% | 2.32% | 1.66% | 2.32% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=3 | 74.42% | 89.21% | 2.37% | 1.83% | 3.15% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=10 | 74.53% | 88.58% | 2.48% | 1.85% | 2.51% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, top-8 | 74.54% | 89.31% | 2.45% | 1.97% | 2.49% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 69.60% | 85.67% | 1.02% | 1.15% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=3 | 69.36% | 85.47% | 1.13% | 1.28% | 1.61% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=10 | 68.83% | 85.69% | 0.88% | 1.00% | 1.19% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, top-8 | 69.13% | 85.73% | 0.93% | 1.03% | 1.15% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 45.25% | 78.35% | 0.98% | 1.12% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=3 | 43.78% | 77.41% | 0.99% | 1.12% | 2.35% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=10 | 44.66% | 76.55% | 0.89% | 1.03% | 2.06% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, top-8 | 47.50% | 80.19% | 0.97% | 1.11% | 2.56% |
| n = 500, T(noise=1), k = 2.5 | straddle + look | 43.94% | 74.15% | 0.70% | 0.98% | 2.53% |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=3 | 44.39% | 77.59% | 0.73% | 0.85% | 1.64% |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=10 | 46.95% | 78.40% | 0.94% | 1.03% | 3.50% |
| n = 500, T(noise=1), k = 2.5 | straddle + look, top-8 | 43.90% | 79.80% | 1.03% | 1.13% | 2.52% |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look | 37.48% | 71.45% | 0.50% | 0.55% | 2.08% |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 39.32% | 75.58% | 0.65% | 0.79% | 1.82% |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 37.08% | 76.42% | 0.88% | 1.03% | 1.43% |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 38.60% | 78.56% | 0.73% | 0.83% | 2.34% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 74.46% | 89.79% | 2.58% | 1.88% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=3 | 74.55% | 89.41% | 2.15% | 1.72% | 2.15% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=10 | 74.81% | 88.88% | 2.12% | 1.63% | 2.83% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, top-8 | 74.27% | 89.54% | 2.38% | 1.79% | 2.42% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 69.19% | 85.57% | 0.81% | 1.02% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=3 | 69.14% | 85.85% | 0.89% | 0.99% | 1.66% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=10 | 69.00% | 85.25% | 0.93% | 1.05% | 1.23% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, top-8 | 69.83% | 85.69% | 0.77% | 0.90% | 1.17% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 50.77% | 76.89% | 0.99% | 1.20% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=3 | 48.45% | 80.49% | 0.82% | 0.98% | 2.80% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=10 | 47.70% | 82.79% | 0.88% | 1.01% | 1.59% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, top-8 | 48.76% | 79.76% | 0.93% | 1.10% | 3.92% |
| n = 500, BT(noise=1), k = 2.5 | straddle + look | 46.76% | 75.96% | 0.70% | 0.88% | 3.86% |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=3 | 46.46% | 78.33% | 0.82% | 1.11% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=10 | 49.10% | 79.56% | 0.92% | 1.02% | 2.28% |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, top-8 | 48.13% | 79.39% | 0.89% | 1.02% | 2.39% |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look | 40.52% | 71.51% | 0.46% | 0.61% | 1.50% |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 41.85% | 77.87% | 0.53% | 0.65% | 1.14% |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 39.81% | 79.24% | 0.61% | 0.72% | 1.79% |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 42.51% | 76.18% | 0.71% | 0.73% | 2.43% |

| Case | Selector | 2 back | Last 5 | ≥3 in 10 | Longest streak |
|---|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 28.11% | 35.32% | 23.09% | 39 / 60 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=3 | 18.20% | 35.58% | 23.70% | 24 / 33 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, m=10 | 18.21% | 26.23% | 15.36% | 25 / 30 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, top-8 | 20.06% | 30.89% | 18.13% | 24 / 36 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 6.61% | 10.82% | 4.29% | 39 / 81 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=3 | 1.38% | 11.22% | 4.66% | 3 / 4 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, m=10 | 1.39% | 5.20% | 0.26% | 3 / 4 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, top-8 | 2.22% | 7.94% | 1.40% | 4 / 4 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 73.49% | 78.39% | 61.38% | 85 / 105 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=3 | 20.82% | 76.91% | 59.56% | 31 / 89 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, m=10 | 20.10% | 26.34% | 14.64% | 28 / 48 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, top-8 | 27.38% | 48.55% | 27.70% | 24 / 72 |
| n = 500, T(noise=1), k = 2.5 | straddle + look | 78.25% | 82.75% | 65.97% | 87 / 151 |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=3 | 20.21% | 80.61% | 63.49% | 25 / 44 |
| n = 500, T(noise=1), k = 2.5 | straddle + look, m=10 | 18.80% | 25.30% | 13.61% | 26 / 51 |
| n = 500, T(noise=1), k = 2.5 | straddle + look, top-8 | 27.10% | 50.05% | 28.88% | 17 / 41 |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look | 80.94% | 85.96% | 73.39% | 106 / 128 |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 18.47% | 83.55% | 70.05% | 17 / 42 |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 17.78% | 23.45% | 12.00% | 19 / 34 |
| n = 500, T(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 27.29% | 51.18% | 29.82% | 24 / 39 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 28.59% | 35.78% | 23.59% | 40 / 64 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=3 | 18.40% | 35.59% | 23.86% | 23 / 31 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, m=10 | 17.99% | 26.00% | 15.08% | 23 / 34 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, top-8 | 18.91% | 29.62% | 17.18% | 24 / 29 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 7.04% | 11.12% | 4.63% | 41 / 107 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=3 | 1.34% | 10.66% | 4.12% | 3 / 4 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, m=10 | 1.39% | 5.23% | 0.26% | 3 / 4 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, top-8 | 2.21% | 8.00% | 1.40% | 4 / 5 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 73.93% | 78.79% | 61.87% | 89 / 162 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=3 | 20.09% | 76.56% | 59.08% | 28 / 65 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, m=10 | 20.03% | 26.25% | 14.44% | 25 / 54 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, top-8 | 27.89% | 49.14% | 28.38% | 32 / 59 |
| n = 500, BT(noise=1), k = 2.5 | straddle + look | 78.15% | 82.55% | 65.85% | 106 / 174 |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=3 | 20.54% | 80.82% | 64.08% | 22 / 53 |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, m=10 | 19.23% | 25.81% | 14.19% | 23 / 57 |
| n = 500, BT(noise=1), k = 2.5 | straddle + look, top-8 | 28.20% | 50.98% | 30.04% | 25 / 44 |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look | 81.02% | 86.05% | 73.59% | 105 / 143 |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=3 | 18.46% | 83.73% | 70.27% | 15 / 44 |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, m=10 | 17.79% | 23.52% | 12.03% | 18 / 31 |
| n = 500, BT(noise=1), k = 2.5 | apt ε=1 + look, top-8 | 27.30% | 51.26% | 30.07% | 21 / 51 |

## Stopping near the Bar, and the fallback (n = 500, noise 1.0)

| Case | Selector | 50% | 60% | 70% | 80% | 95% outside δ 0.25 |
|---|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 34.37 (18/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 8.40 | 10.66 | 13.78 | 19.49 | 34.37 (17/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 8.40 | 10.66 | 13.78 | 19.49 | 34.37 (17/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 8.40 | 10.66 | 13.78 | 19.39 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 8.40 | 10.66 | 13.78 | 19.39 | — (2/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 8.40 | 10.66 | 13.68 | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 8.40 | 10.66 | 13.68 | 29.47 (18/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.10 | 16.22 | 24.19 | 39.60 (12/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 9.50 | 12.10 | 16.22 | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 9.50 | 12.10 | 16.22 | — (2/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 9.50 | 12.10 | 28.90 | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 9.50 | 12.10 | — (7/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1 | 13.78 | 16.61 | 21.84 | 29.09 (17/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 13.78 | 16.61 | 21.84 | 29.09 (18/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 13.49 | 17.38 | 18.77 | — (5/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 13.49 | 17.38 | 18.77 | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2 | 13.44 | 13.92 | 26.98 (19/20) | — (0/20) | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 13.44 | 13.92 | 34.42 (17/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 33.84 (18/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 8.26 | 10.51 | 13.73 | 19.25 | 33.84 (19/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 8.26 | 10.51 | 13.73 | 19.25 | 33.84 (19/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 8.26 | 10.51 | 13.73 | 19.25 (16/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 8.26 | 10.51 | 13.73 | 19.25 (19/20) | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 8.26 | 10.51 | 13.54 | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 8.26 | 10.51 | 13.54 | 29.23 (18/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 9.60 | 12.19 | 16.27 | 24.19 | 36.72 (12/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 9.60 | 12.19 | 16.27 | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 9.60 | 12.19 | 16.27 | — (6/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 9.60 | 12.19 | 29.04 | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 9.60 | 12.19 | 37.15 (13/20) | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (2/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1 | 12.91 | 16.27 | 20.93 | 28.42 (19/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 12.91 | 16.27 | 20.93 | 28.42 (19/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 12.86 | 17.09 | 18.38 | — (5/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 12.86 | 17.09 | 18.38 | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2 | 13.20 | 13.78 | 25.68 | — (0/20) | — (0/20) |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 13.20 | 13.78 | 31.39 (19/20) | — (0/20) | — (0/20) |

| Case | Selector | @16 | @40 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 74.43% | 89.83% | 1.29% | 2.32% | 1.66% | 2.32% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 74.43% | 90.16% | 1.29% | 2.28% | 1.65% | 2.29% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 74.43% | 89.05% | 1.29% | 2.20% | 1.65% | 2.24% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 74.43% | 80.18% | 1.29% | 1.10% | 1.30% | 1.74% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 74.43% | 79.14% | 1.29% | 2.27% | 1.52% | 2.38% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 70.58% | 78.51% | 1.25% | 0.96% | 1.07% | 1.74% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 69.98% | 75.52% | 1.20% | 2.12% | 1.68% | 2.85% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 69.60% | 85.67% | 1.19% | 1.02% | 1.15% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 69.60% | 81.92% | 1.19% | 0.84% | 1.11% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 69.60% | 81.92% | 1.19% | 0.94% | 1.13% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 69.60% | 74.68% | 1.19% | 0.58% | 0.96% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 69.60% | 74.14% | 1.19% | 1.05% | 1.12% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 64.93% | 74.74% | 1.11% | 0.66% | 0.87% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 64.63% | 65.56% | 1.22% | 1.17% | 1.18% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 45.25% | 78.35% | 1.26% | 0.98% | 1.12% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1 | 45.25% | 73.39% | 1.26% | 0.94% | 1.15% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 45.25% | 76.21% | 1.26% | 0.79% | 1.14% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 42.48% | 66.84% | 1.20% | 0.66% | 0.96% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 42.48% | 68.35% | 1.20% | 0.45% | 0.87% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2 | 59.68% | 63.18% | 1.32% | 0.62% | 0.93% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 50.46% | 70.20% | 1.13% | 0.50% | 0.76% | 2.68% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 74.46% | 89.79% | 1.46% | 2.58% | 1.88% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 74.46% | 89.95% | 1.46% | 2.52% | 1.87% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 74.46% | 89.56% | 1.46% | 2.42% | 1.87% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 74.46% | 80.37% | 1.46% | 1.14% | 1.46% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 74.46% | 79.40% | 1.46% | 1.93% | 1.69% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 70.56% | 78.48% | 1.50% | 1.04% | 1.22% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 69.82% | 76.85% | 1.50% | 2.39% | 1.73% | 3.08% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 69.19% | 85.57% | 1.19% | 0.81% | 1.02% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 69.19% | 81.83% | 1.19% | 0.59% | 0.96% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 69.19% | 81.83% | 1.19% | 0.79% | 1.00% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 69.19% | 74.07% | 1.19% | 0.35% | 0.86% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 69.19% | 74.31% | 1.19% | 1.09% | 1.09% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 65.35% | 74.55% | 1.10% | 0.52% | 0.80% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 64.53% | 66.29% | 1.07% | 0.97% | 1.05% | 1.35% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 50.77% | 76.89% | 1.44% | 0.99% | 1.20% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1 | 50.77% | 79.33% | 1.44% | 0.87% | 1.19% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 50.77% | 77.00% | 1.44% | 0.83% | 1.19% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 48.28% | 65.35% | 1.24% | 0.55% | 1.01% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 48.28% | 73.95% | 1.24% | 0.64% | 0.93% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2 | 59.53% | 63.16% | 1.13% | 0.43% | 0.73% | 3.05% |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 54.77% | 72.19% | 0.91% | 0.53% | 0.69% | 3.05% |

| Case | Selector | 2 back | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 28.11% | 0.00% | — (0/20) | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 27.56% | 1.33% | 39.72 (11/20) | 7.08% / 9.84% / 9.84% | 39.89 (11/20) | 21.79 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 28.68% | 0.37% | 39.72 (11/20) | 7.22% / 10.93% / 10.93% | — (7/20) | 21.79 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 9.31% | 50.44% | 19.60 (20/20) | 0.00% / 19.82% / 19.82% | — (0/20) | 19.63 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 53.58% | 41.19% | 19.60 (20/20) | 4.19% / 20.85% / 20.86% | — (0/20) | 19.68 | 14.50 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 6.11% | 65.40% | 13.79 (20/20) | 0.00% / 21.49% / 21.49% | — (0/20) | 33.26 | 13.82 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 64.48% | 61.49% | 13.79 (20/20) | 4.07% / 24.11% / 24.47% | — (0/20) | 28.70 | 13.87 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 6.61% | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 6.52% | 25.50% | 28.63 (20/20) | 18.07% / 18.08% / 18.08% | 28.66 | 19.20 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 26.52% | 25.23% | 28.63 (20/20) | 18.07% / 18.08% / 18.08% | 28.66 | 19.20 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 3.72% | 51.67% | 18.46 (20/20) | 0.00% / 25.32% / 25.32% | — (0/20) | 18.53 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 46.01% | 52.13% | 18.46 (20/20) | 11.79% / 25.86% / 25.86% | — (0/20) | 18.53 | 15.02 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 2.26% | 63.48% | 14.10 (20/20) | 0.00% / 25.26% / 25.26% | — (0/20) | 36.38 | 14.11 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 54.72% | 63.79% | 14.10 (20/20) | 10.53% / 17.02% / 34.44% | — (0/20) | — (0/20) | 14.16 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 73.49% | 0.00% | — (0/20) | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1 | 63.52% | 10.04% | 29.23 (20/20) | 19.86% / 22.69% / 24.10% | 29.28 | 24.38 | 22.66 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 71.35% | 4.72% | 29.23 (20/20) | 20.16% / 22.54% / 23.33% | 31.10 | 24.38 | 22.66 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 48.35% | 29.15% | 18.95 (20/20) | 0.03% / 31.07% / 32.33% | — (0/20) | 19.01 | 18.82 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 70.75% | 23.72% | 18.95 (20/20) | 4.44% / 28.50% / 29.58% | — (0/20) | 19.87 | 18.82 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2 | 37.12% | 50.24% | 14.64 (20/20) | 0.00% / 21.73% / 36.81% | — (0/20) | — (0/20) | 14.64 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 72.89% | 43.26% | 14.64 (20/20) | 6.01% / 28.95% / 29.73% | — (0/20) | 30.34 | 15.89 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD | 28.59% | 0.00% | — (0/20) | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1 | 28.20% | 1.15% | 39.78 (10/20) | 6.41% / 10.05% / 10.05% | — (9/20) | 21.74 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1, fb gap/σ | 29.08% | 0.46% | 39.78 (10/20) | 6.51% / 10.44% / 10.44% | — (8/20) | 21.74 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5 | 9.42% | 50.50% | 19.53 (20/20) | 0.00% / 19.63% / 19.63% | — (0/20) | 19.63 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<1.5, fb gap/σ | 53.84% | 41.71% | 19.53 (20/20) | 4.40% / 20.60% / 20.60% | — (0/20) | 19.63 | 14.69 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2 | 6.10% | 65.53% | 13.72 (20/20) | 0.00% / 21.52% / 21.52% | — (0/20) | 33.26 | 13.73 |
| n = 500, BT(noise=1), k = 2.5 | uleast + BALD, stop σ<2, fb gap/σ | 64.73% | 61.60% | 13.72 (20/20) | 3.71% / 23.02% / 23.14% | — (0/20) | 28.27 | 13.78 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ | 7.04% | 0.00% | — (0/20) | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1 | 7.25% | 24.35% | 28.72 (20/20) | 18.16% / 18.17% / 18.17% | 28.85 | 19.25 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1, fb gap/σ | 26.10% | 24.45% | 28.72 (20/20) | 18.13% / 18.17% / 18.17% | 28.75 | 19.25 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5 | 4.03% | 51.26% | 18.57 (20/20) | 0.00% / 25.93% / 25.93% | — (0/20) | 18.58 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<1.5, fb gap/σ | 46.27% | 51.83% | 18.57 (20/20) | 10.86% / 25.69% / 25.69% | — (0/20) | 18.67 | 14.98 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2 | 2.23% | 63.47% | 14.13 (20/20) | 0.00% / 25.45% / 25.45% | — (0/20) | 36.82 | 14.16 |
| n = 500, BT(noise=1), k = 2.5 | uleast + μ, stop σ<2, fb gap/σ | 55.11% | 63.54% | 14.13 (20/20) | 10.51% / 16.84% / 33.71% | — (0/20) | — (0/20) | 14.16 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look | 73.93% | 0.00% | — (0/20) | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1 | 60.84% | 14.09% | 28.57 (20/20) | 18.72% / 19.91% / 20.28% | 28.70 | 25.87 | 20.93 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1, fb gap/σ | 71.31% | 5.36% | 28.57 (20/20) | 20.07% / 21.60% / 22.25% | 30.00 | 25.87 | 20.93 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5 | 48.70% | 28.87% | 18.91 (20/20) | 0.03% / 32.62% / 33.95% | — (0/20) | 18.96 | 18.48 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<1.5, fb gap/σ | 70.56% | 27.90% | 18.91 (20/20) | 5.52% / 25.62% / 25.97% | — (0/20) | 20.93 | 18.48 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2 | 37.41% | 50.78% | 14.48 (20/20) | 0.00% / 22.06% / 36.84% | — (0/20) | — (0/20) | 14.50 |
| n = 500, BT(noise=1), k = 2.5 | lsa + look, stop σ<2, fb gap/σ | 73.70% | 46.71% | 14.48 (20/20) | 6.66% / 26.13% / 26.63% | — (0/20) | 28.27 | 15.12 |

## Arrival

500 wallpapers ranked to Each 20 under the rule (the same rule, Unrated
variant included), then a scan adds 200 or 50 Unrated at 25 / 8.333; 5000
votes after the scan. Votes are counted from the scan. "With an arrival,
any Unrated": votes showing any arrival while at least one arrival is
Unrated. "With an Unrated arrival": the same, for an arrival that is still
Unrated. "until 90%": votes showing an arrival from the scan until 90% of the
arrivals are Decided (or the end). "U-vs-U": votes pairing two Unrated
arrivals, per run. Old: the old wallpapers' Decided share at the scan, its
lowest point until the arrivals reach 90% (or the end), and at that point.

| Case | Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| +200; T(noise=0.5), k = 2.5 | Baseline | 169 | 100.00% | 100.00% | 88.19% | 30.35 | 1355 | 3415 (17/20) | — (0/20) | 65.9% | 63.1% | 72.4% |
| +200; T(noise=0.5), k = 2.5 | uleast + BALD | 200 | 100.00% | 100.00% | 70.33% | 0.00 | 795 | 1450 | — (0/20) | 75.7% | 71.2% | 80.9% |
| +200; T(noise=0.5), k = 2.5 | uleast + BALD, U-index | 200 | 100.00% | 100.00% | 70.20% | 0.00 | 795 | 1490 | — (0/20) | 75.6% | 71.4% | 80.5% |
| +200; T(noise=0.5), k = 2.5 | uleast + BALD, U-share | 399 | 99.50% | 50.13% | 70.56% | 0.00 | 800 | 1470 | — (0/20) | 76.0% | 74.4% | 81.2% |
| +200; T(noise=0.5), k = 2.5 | uleast + μ | 200 | 100.00% | 100.00% | 80.19% | 0.00 | 965 | 1610 | — (2/20) | 81.3% | 69.8% | 86.2% |
| +200; T(noise=0.5), k = 2.5 | uleast + μ, U-index | 200 | 100.00% | 100.00% | 79.75% | 0.00 | 955 | 1615 | — (2/20) | 81.2% | 69.7% | 86.2% |
| +200; T(noise=0.5), k = 2.5 | uleast + μ, U-share | 399 | 99.75% | 50.13% | 82.12% | 0.00 | 990 | 1670 | — (5/20) | 81.5% | 76.9% | 85.8% |
| +200; T(noise=0.5), k = 2.5 | lsa + look | 200 | 100.00% | 100.00% | 73.63% | 0.00 | 1235 | 1585 | — (6/20) | 77.0% | 25.9% | 87.4% |
| +200; T(noise=0.5), k = 2.5 | lsa + look, U-index | 232 | 100.00% | 85.60% | 74.51% | 0.00 | 1170 | 1645 | — (4/20) | 77.3% | 33.5% | 85.4% |
| +200; T(noise=0.5), k = 2.5 | lsa + look, U-share | 399 | 99.57% | 50.13% | 73.73% | 0.00 | 1155 | 1625 | — (3/20) | 76.5% | 33.3% | 83.9% |
| +200; T(noise=0.5), k = 2.5 | uleast + BALD, U-vs-U allowed | 100 | 100.00% | 100.00% | 70.02% | 100.00 | 790 | 1480 | — (0/20) | 75.9% | 67.0% | 81.0% |
| +50; T(noise=0.5), k = 2.5 | Baseline | 46 | 100.00% | 100.00% | 33.82% | 3.25 | 330 | 955 (19/20) | — (0/20) | 65.9% | 64.8% | 76.6% |
| +50; T(noise=0.5), k = 2.5 | uleast + BALD | 50 | 100.00% | 100.00% | 26.67% | 0.00 | 190 | 340 | — (3/20) | 75.7% | 74.1% | 82.7% |
| +50; T(noise=0.5), k = 2.5 | uleast + BALD, U-index | 50 | 100.00% | 100.00% | 26.84% | 0.00 | 190 | 365 | — (0/20) | 75.6% | 74.2% | 83.2% |
| +50; T(noise=0.5), k = 2.5 | uleast + BALD, U-share | 99 | 97.98% | 50.51% | 26.88% | 0.00 | 200 | 370 | — (0/20) | 76.0% | 75.5% | 83.3% |
| +50; T(noise=0.5), k = 2.5 | uleast + μ | 50 | 100.00% | 100.00% | 37.08% | 0.00 | 230 | 390 | 3350 (12/20) | 81.3% | 78.4% | 85.8% |
| +50; T(noise=0.5), k = 2.5 | uleast + μ, U-index | 50 | 100.00% | 100.00% | 37.21% | 0.00 | 245 | 395 | 3175 (13/20) | 81.2% | 77.9% | 86.1% |
| +50; T(noise=0.5), k = 2.5 | uleast + μ, U-share | 99 | 98.99% | 50.51% | 37.91% | 0.00 | 285 | 470 | 3790 (10/20) | 81.5% | 79.6% | 86.6% |
| +50; T(noise=0.5), k = 2.5 | lsa + look | 50 | 100.00% | 100.00% | 36.96% | 0.00 | 330 | 465 | 1725 (18/20) | 77.0% | 41.7% | 86.6% |
| +50; T(noise=0.5), k = 2.5 | lsa + look, U-index | 60 | 100.00% | 81.97% | 35.29% | 0.00 | 320 | 490 | 3140 (13/20) | 77.3% | 45.9% | 86.1% |
| +50; T(noise=0.5), k = 2.5 | lsa + look, U-share | 99 | 98.28% | 50.51% | 35.55% | 0.00 | 340 | 440 | 3980 (11/20) | 76.5% | 47.8% | 86.2% |
| +50; T(noise=0.5), k = 2.5 | uleast + BALD, U-vs-U allowed | 25 | 100.00% | 100.00% | 27.13% | 25.00 | 195 | 345 | — (3/20) | 75.9% | 73.3% | 83.0% |
| +200; T(noise=1), k = 2.5 | Baseline | 170 | 100.00% | 100.00% | 88.18% | 30.15 | 1610 | 4495 (13/20) | — (0/20) | 62.6% | 60.4% | 69.1% |
| +200; T(noise=1), k = 2.5 | uleast + BALD | 200 | 100.00% | 100.00% | 70.77% | 0.00 | 800 | 1350 | — (0/20) | 79.8% | 70.9% | 86.3% |
| +200; T(noise=1), k = 2.5 | uleast + BALD, U-index | 200 | 100.00% | 100.00% | 70.31% | 0.00 | 810 | 1395 | — (1/20) | 80.4% | 71.3% | 86.6% |
| +200; T(noise=1), k = 2.5 | uleast + BALD, U-share | 399 | 99.50% | 50.13% | 70.38% | 0.00 | 810 | 1415 | — (1/20) | 79.9% | 75.2% | 86.0% |
| +200; T(noise=1), k = 2.5 | uleast + μ | 200 | 100.00% | 100.00% | 81.31% | 0.00 | 1210 | 2200 | — (0/20) | 76.0% | 69.4% | 81.0% |
| +200; T(noise=1), k = 2.5 | uleast + μ, U-index | 200 | 100.00% | 100.00% | 80.55% | 0.00 | 1175 | 2130 | — (0/20) | 74.9% | 68.4% | 80.9% |
| +200; T(noise=1), k = 2.5 | uleast + μ, U-share | 399 | 99.75% | 50.13% | 81.15% | 0.00 | 1180 | 2280 | — (0/20) | 75.4% | 70.9% | 80.9% |
| +200; T(noise=1), k = 2.5 | lsa + look | 200 | 100.00% | 100.00% | 73.56% | 0.00 | 1650 | 3535 | — (0/20) | 58.1% | 26.5% | 74.3% |
| +200; T(noise=1), k = 2.5 | lsa + look, U-index | 234 | 100.00% | 85.84% | 73.48% | 0.00 | 1595 | 3040 | — (0/20) | 60.0% | 27.9% | 72.0% |
| +200; T(noise=1), k = 2.5 | lsa + look, U-share | 399 | 99.59% | 50.13% | 73.37% | 0.00 | 1440 | 2960 (19/20) | — (0/20) | 58.0% | 28.4% | 74.3% |
| +200; T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 100 | 100.00% | 100.00% | 70.26% | 100.00 | 795 | 1340 | — (1/20) | 80.7% | 59.0% | 87.0% |
| +50; T(noise=1), k = 2.5 | Baseline | 47 | 100.00% | 100.00% | 33.85% | 2.85 | 425 | 2160 (17/20) | — (0/20) | 62.6% | 61.6% | 73.4% |
| +50; T(noise=1), k = 2.5 | uleast + BALD | 50 | 100.00% | 100.00% | 29.71% | 0.00 | 200 | 330 | — (9/20) | 79.8% | 76.7% | 87.4% |
| +50; T(noise=1), k = 2.5 | uleast + BALD, U-index | 50 | 100.00% | 100.00% | 30.09% | 0.00 | 205 | 330 | 3865 (12/20) | 80.4% | 76.9% | 87.2% |
| +50; T(noise=1), k = 2.5 | uleast + BALD, U-share | 99 | 97.98% | 50.51% | 30.23% | 0.00 | 205 | 345 | 3470 (13/20) | 79.9% | 78.2% | 86.7% |
| +50; T(noise=1), k = 2.5 | uleast + μ | 50 | 100.00% | 100.00% | 32.05% | 0.00 | 290 | 515 | — (6/20) | 76.0% | 73.6% | 84.2% |
| +50; T(noise=1), k = 2.5 | uleast + μ, U-index | 50 | 100.00% | 100.00% | 33.21% | 0.00 | 315 | 665 | — (5/20) | 74.9% | 72.8% | 83.4% |
| +50; T(noise=1), k = 2.5 | uleast + μ, U-share | 99 | 98.99% | 50.51% | 33.31% | 0.00 | 335 | 615 | — (5/20) | 75.4% | 73.2% | 84.1% |
| +50; T(noise=1), k = 2.5 | lsa + look | 50 | 100.00% | 100.00% | 29.17% | 0.00 | 470 | 1230 | — (2/20) | 58.1% | 34.0% | 75.2% |
| +50; T(noise=1), k = 2.5 | lsa + look, U-index | 57 | 100.00% | 86.28% | 28.22% | 0.00 | 425 | 1165 | — (1/20) | 60.0% | 35.0% | 74.3% |
| +50; T(noise=1), k = 2.5 | lsa + look, U-share | 99 | 98.48% | 50.51% | 29.34% | 0.00 | 425 | 1095 | — (1/20) | 58.0% | 33.1% | 76.6% |
| +50; T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 25 | 100.00% | 100.00% | 28.83% | 25.00 | 200 | 330 | 3740 (11/20) | 80.7% | 71.9% | 88.4% |
| +200; BT(noise=0.5), k = 2.5 | Baseline | 169 | 100.00% | 100.00% | 88.33% | 30.20 | 1390 | 3795 (18/20) | — (0/20) | 65.7% | 62.5% | 72.4% |
| +200; BT(noise=0.5), k = 2.5 | uleast + BALD | 200 | 100.00% | 100.00% | 70.25% | 0.00 | 800 | 1475 | — (0/20) | 75.7% | 71.4% | 80.8% |
| +200; BT(noise=0.5), k = 2.5 | uleast + BALD, U-index | 200 | 100.00% | 100.00% | 70.57% | 0.00 | 795 | 1475 | — (0/20) | 76.0% | 71.5% | 81.1% |
| +200; BT(noise=0.5), k = 2.5 | uleast + BALD, U-share | 399 | 99.50% | 50.13% | 70.22% | 0.00 | 795 | 1430 | — (0/20) | 76.1% | 74.2% | 80.9% |
| +200; BT(noise=0.5), k = 2.5 | uleast + μ | 200 | 100.00% | 100.00% | 80.28% | 0.00 | 1005 | 1760 | — (1/20) | 81.1% | 69.1% | 86.0% |
| +200; BT(noise=0.5), k = 2.5 | uleast + μ, U-index | 200 | 100.00% | 100.00% | 80.84% | 0.00 | 1005 | 1670 | — (0/20) | 80.7% | 69.1% | 86.2% |
| +200; BT(noise=0.5), k = 2.5 | uleast + μ, U-share | 399 | 99.75% | 50.13% | 79.84% | 0.00 | 985 | 1655 | — (3/20) | 81.3% | 76.2% | 86.2% |
| +200; BT(noise=0.5), k = 2.5 | lsa + look | 200 | 100.00% | 100.00% | 74.03% | 0.00 | 1175 | 1545 | — (7/20) | 79.2% | 27.9% | 86.9% |
| +200; BT(noise=0.5), k = 2.5 | lsa + look, U-index | 237 | 100.00% | 84.00% | 73.71% | 0.00 | 1245 | 1700 | — (8/20) | 76.9% | 30.0% | 86.8% |
| +200; BT(noise=0.5), k = 2.5 | lsa + look, U-share | 399 | 99.55% | 50.13% | 74.41% | 0.00 | 1195 | 1640 | — (7/20) | 79.1% | 33.6% | 85.4% |
| +200; BT(noise=0.5), k = 2.5 | uleast + BALD, U-vs-U allowed | 100 | 100.00% | 100.00% | 70.32% | 100.00 | 790 | 1445 | — (0/20) | 75.8% | 67.5% | 81.0% |
| +50; BT(noise=0.5), k = 2.5 | Baseline | 47 | 100.00% | 100.00% | 33.96% | 2.90 | 360 | 1080 (19/20) | — (0/20) | 65.7% | 64.5% | 76.1% |
| +50; BT(noise=0.5), k = 2.5 | uleast + BALD | 50 | 100.00% | 100.00% | 27.07% | 0.00 | 190 | 350 | — (4/20) | 75.7% | 74.2% | 82.7% |
| +50; BT(noise=0.5), k = 2.5 | uleast + BALD, U-index | 50 | 100.00% | 100.00% | 27.17% | 0.00 | 195 | 355 | — (3/20) | 76.0% | 74.6% | 83.2% |
| +50; BT(noise=0.5), k = 2.5 | uleast + BALD, U-share | 99 | 97.98% | 50.51% | 27.26% | 0.00 | 195 | 350 | — (3/20) | 76.1% | 75.5% | 83.0% |
| +50; BT(noise=0.5), k = 2.5 | uleast + μ | 50 | 100.00% | 100.00% | 39.71% | 0.00 | 270 | 410 | 2975 (13/20) | 81.1% | 77.9% | 85.9% |
| +50; BT(noise=0.5), k = 2.5 | uleast + μ, U-index | 50 | 100.00% | 100.00% | 38.55% | 0.00 | 260 | 430 | 4025 (11/20) | 80.7% | 78.3% | 86.7% |
| +50; BT(noise=0.5), k = 2.5 | uleast + μ, U-share | 99 | 98.99% | 50.51% | 37.36% | 0.00 | 285 | 490 | 3860 (12/20) | 81.3% | 79.0% | 86.7% |
| +50; BT(noise=0.5), k = 2.5 | lsa + look | 50 | 100.00% | 100.00% | 36.13% | 0.00 | 355 | 470 | 2545 (14/20) | 79.2% | 44.5% | 86.8% |
| +50; BT(noise=0.5), k = 2.5 | lsa + look, U-index | 61 | 100.00% | 81.30% | 36.81% | 0.00 | 320 | 530 | 1820 (15/20) | 76.9% | 47.0% | 86.2% |
| +50; BT(noise=0.5), k = 2.5 | lsa + look, U-share | 99 | 98.23% | 50.51% | 36.56% | 0.00 | 345 | 515 | 2205 (14/20) | 79.1% | 47.0% | 87.2% |
| +50; BT(noise=0.5), k = 2.5 | uleast + BALD, U-vs-U allowed | 25 | 100.00% | 100.00% | 26.87% | 25.00 | 190 | 325 | — (0/20) | 75.8% | 73.6% | 83.1% |
| +200; BT(noise=1), k = 2.5 | Baseline | 171 | 100.00% | 100.00% | 88.28% | 28.15 | 1710 | 4835 (13/20) | — (0/20) | 63.0% | 60.0% | 69.0% |
| +200; BT(noise=1), k = 2.5 | uleast + BALD | 200 | 100.00% | 100.00% | 70.84% | 0.00 | 820 | 1370 | — (0/20) | 80.4% | 70.9% | 86.1% |
| +200; BT(noise=1), k = 2.5 | uleast + BALD, U-index | 200 | 100.00% | 100.00% | 70.64% | 0.00 | 805 | 1375 | — (1/20) | 80.2% | 71.1% | 86.3% |
| +200; BT(noise=1), k = 2.5 | uleast + BALD, U-share | 399 | 99.50% | 50.13% | 70.35% | 0.00 | 815 | 1360 | — (1/20) | 80.0% | 76.4% | 86.1% |
| +200; BT(noise=1), k = 2.5 | uleast + μ | 200 | 100.00% | 100.00% | 80.35% | 0.00 | 1235 | 2180 | — (0/20) | 75.3% | 69.3% | 81.4% |
| +200; BT(noise=1), k = 2.5 | uleast + μ, U-index | 200 | 100.00% | 100.00% | 80.91% | 0.00 | 1185 | 2155 | — (0/20) | 75.4% | 68.1% | 81.2% |
| +200; BT(noise=1), k = 2.5 | uleast + μ, U-share | 399 | 99.75% | 50.13% | 80.29% | 0.00 | 1195 | 2075 | — (0/20) | 75.6% | 71.3% | 80.9% |
| +200; BT(noise=1), k = 2.5 | lsa + look | 200 | 100.00% | 100.00% | 74.55% | 0.00 | 1595 | 3300 | — (0/20) | 59.2% | 27.2% | 74.4% |
| +200; BT(noise=1), k = 2.5 | lsa + look, U-index | 229 | 100.00% | 86.30% | 73.43% | 0.00 | 1580 | 2670 | — (0/20) | 59.2% | 27.4% | 74.2% |
| +200; BT(noise=1), k = 2.5 | lsa + look, U-share | 399 | 99.60% | 50.13% | 73.87% | 0.00 | 1495 | 2795 | — (0/20) | 54.1% | 27.5% | 71.2% |
| +200; BT(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 100 | 100.00% | 100.00% | 70.46% | 100.00 | 805 | 1355 | — (1/20) | 80.2% | 59.3% | 86.4% |
| +50; BT(noise=1), k = 2.5 | Baseline | 47 | 100.00% | 100.00% | 33.92% | 2.90 | 375 | 935 (18/20) | — (0/20) | 63.0% | 61.9% | 73.6% |
| +50; BT(noise=1), k = 2.5 | uleast + BALD | 50 | 100.00% | 100.00% | 30.18% | 0.00 | 210 | 330 | 3590 (13/20) | 80.4% | 76.9% | 87.5% |
| +50; BT(noise=1), k = 2.5 | uleast + BALD, U-index | 50 | 100.00% | 100.00% | 30.16% | 0.00 | 200 | 340 | 3760 (13/20) | 80.2% | 76.0% | 86.6% |
| +50; BT(noise=1), k = 2.5 | uleast + BALD, U-share | 99 | 97.98% | 50.51% | 29.40% | 0.00 | 205 | 330 | 4050 (11/20) | 80.0% | 78.8% | 87.2% |
| +50; BT(noise=1), k = 2.5 | uleast + μ | 50 | 100.00% | 100.00% | 33.73% | 0.00 | 340 | 570 | — (6/20) | 75.3% | 73.2% | 83.7% |
| +50; BT(noise=1), k = 2.5 | uleast + μ, U-index | 50 | 100.00% | 100.00% | 33.19% | 0.00 | 290 | 565 | — (6/20) | 75.4% | 72.4% | 83.1% |
| +50; BT(noise=1), k = 2.5 | uleast + μ, U-share | 99 | 98.99% | 50.51% | 30.77% | 0.00 | 275 | 470 | — (4/20) | 75.6% | 73.4% | 84.4% |
| +50; BT(noise=1), k = 2.5 | lsa + look | 50 | 100.00% | 100.00% | 29.35% | 0.00 | 435 | 1325 (19/20) | — (1/20) | 59.2% | 36.0% | 79.8% |
| +50; BT(noise=1), k = 2.5 | lsa + look, U-index | 60 | 100.00% | 83.68% | 29.74% | 0.00 | 455 | 1530 (19/20) | — (1/20) | 59.2% | 35.3% | 77.6% |
| +50; BT(noise=1), k = 2.5 | lsa + look, U-share | 99 | 98.54% | 50.51% | 27.32% | 0.00 | 400 | 805 | — (0/20) | 54.1% | 32.3% | 78.8% |
| +50; BT(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 25 | 100.00% | 100.00% | 28.50% | 25.00 | 195 | 330 | 4770 (11/20) | 80.2% | 72.7% | 87.6% |

## Young library

n = 30 and 60 (100 libraries) and a fresh 500 (20), all starting with no
Scores. Shown here for T noise 1.0; every voter and noise is in
[`young.md`](pair-selection/young.md) and
[`young-500.md`](pair-selection/young-500.md).

| Case | Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|---:|
| n = 30, T(noise=1), k = 2.5 | Baseline | 9.96 | 15 / 23 | 100.00% | 20 / 23 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-share | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| n = 30, T(noise=1), k = 2.5 | lsa + look | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-index | 2.00 | 2 / 2 | 93.49% | 29 / 34 |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-share | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 15.00 | 15 / 15 | 100.00% | 15 / 15 |
| n = 60, T(noise=1), k = 2.5 | Baseline | 19.36 | 33 / 40 | 100.00% | 41 / 45 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-share | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| n = 60, T(noise=1), k = 2.5 | lsa + look | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-index | 2.00 | 2 / 2 | 92.52% | 62 / 75 |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-share | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 30.00 | 30 / 30 | 100.00% | 30 / 30 |
| n = 500, T(noise=1), k = 2.5 | Baseline | 160.10 | 311 / 343 | 100.00% | 340 / 347 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-share | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-index | 2.00 | 2 / 2 | 91.86% | 540 / 583 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-share | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 250.00 | 250 / 250 | 100.00% | 250 / 250 |

| Case | Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| n = 30, T(noise=1), k = 2.5 | Baseline | 0.00% | — | 0.93% | 0.00% | 14.73% | 0.45% | 30–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | — | 0.10% | 0.00% | 20.87% | 1.12% | 30–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-index | 0.00% | — | 0.10% | 0.00% | 21.07% | 1.11% | 30–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-share | 3.83% | 0.87% | 7.43% | 1.35% | 19.10% | 1.05% | 5–15 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ | 0.50% | 0.00% | 1.57% | 4.26% | 15.37% | 1.30% | 10–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-index | 0.33% | 0.00% | 1.40% | 4.76% | 14.40% | 1.16% | 10–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-share | 2.97% | 0.00% | 5.67% | 2.35% | 16.13% | 1.03% | 5–22 |
| n = 30, T(noise=1), k = 2.5 | lsa + look | 0.00% | — | 0.00% | — | 0.10% | 0.00% | 30–30 |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-index | 0.00% | — | 0.00% | — | 0.13% | 0.00% | 30–30 |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-share | 0.27% | 0.00% | 0.13% | 0.00% | 2.33% | 1.43% | 7–30 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 0.00% | — | 0.80% | 0.00% | 25.00% | 1.47% | 30–30 |
| n = 60, T(noise=1), k = 2.5 | Baseline | 0.02% | 0.00% | 1.32% | 0.00% | 14.52% | 1.95% | 45–60 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | — | 0.08% | 0.00% | 20.55% | 1.38% | 60–60 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-index | 0.00% | — | 0.05% | 0.00% | 20.38% | 1.55% | 60–60 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-share | 3.42% | 1.46% | 8.03% | 0.83% | 19.08% | 0.96% | 5–13 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ | 0.68% | 0.00% | 1.77% | 0.94% | 15.73% | 0.85% | 10–60 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-index | 0.57% | 0.00% | 1.60% | 1.04% | 14.50% | 1.03% | 11–60 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-share | 2.73% | 0.61% | 6.82% | 0.49% | 15.80% | 0.95% | 5–21 |
| n = 60, T(noise=1), k = 2.5 | lsa + look | 0.00% | — | 0.00% | — | 0.07% | 0.00% | 60–60 |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-index | 0.00% | — | 0.00% | — | 0.05% | 0.00% | 60–60 |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-share | 0.07% | 0.00% | 0.18% | 0.00% | 2.82% | 0.59% | 7–57 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 0.00% | — | 0.00% | — | 21.85% | 0.92% | 60–60 |
| n = 500, T(noise=1), k = 2.5 | Baseline | 0.00% | — | 1.48% | 0.00% | 14.66% | 0.55% | 500–500 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 0.00% | — | 0.00% | — | 20.55% | 0.92% | 500–500 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-index | 0.00% | — | 0.00% | — | 20.61% | 1.16% | 500–500 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-share | 4.66% | 0.21% | 9.86% | 0.51% | 19.79% | 0.66% | 5–13 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 0.90% | 0.00% | 1.93% | 0.00% | 16.27% | 1.04% | 11–157 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-index | 0.86% | 0.00% | 1.97% | 0.51% | 15.24% | 1.38% | 10–164 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-share | 4.10% | 1.22% | 8.00% | 1.12% | 16.89% | 0.59% | 5–29 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 0.00% | — | 0.01% | 0.00% | 0.03% | 0.00% | 68–500 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-index | 0.00% | — | 0.02% | 0.00% | 0.04% | 0.00% | 127–500 |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-share | 0.47% | 0.00% | 1.77% | 0.56% | 3.27% | 0.92% | 9–42 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 0.00% | — | 0.14% | 0.00% | 19.87% | 0.81% | 500–500 |

| Case | Selector | 50% | 60% | 70% | 80% |
|---|---:|---:|---:|---:|---:|
| n = 30, T(noise=1), k = 2.5 | Baseline | 11.33 | 15.93 | 24.13 (96/100) | — (39/100) |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD | 7.87 | 10.13 | 12.93 | 17.53 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-index | 7.93 | 10.00 | 12.87 | 18.07 |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-share | 7.87 | 10.20 | 12.87 | 18.20 |
| n = 30, T(noise=1), k = 2.5 | uleast + μ | 9.07 | 11.73 | 15.13 | 25.13 (91/100) |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-index | 9.07 | 11.93 | 15.67 | 23.07 (86/100) |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-share | 9.20 | 12.13 | 15.53 (99/100) | 23.93 (91/100) |
| n = 30, T(noise=1), k = 2.5 | lsa + look | 12.87 | 16.80 (99/100) | 23.40 (90/100) | 33.87 (60/100) |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-index | 13.00 (99/100) | 16.40 (98/100) | 21.93 (89/100) | 31.93 (65/100) |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-share | 13.47 | 16.13 | 23.00 (87/100) | 36.13 (58/100) |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 7.67 | 9.80 | 12.53 | 17.87 |
| n = 60, T(noise=1), k = 2.5 | Baseline | 11.57 | 16.63 | 25.50 (95/100) | — (16/100) |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD | 8.07 | 10.27 | 13.10 | 19.10 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-index | 8.13 | 10.37 | 13.27 | 18.67 |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-share | 8.13 | 10.40 | 13.50 | 19.07 |
| n = 60, T(noise=1), k = 2.5 | uleast + μ | 9.30 | 12.40 | 16.23 | 23.87 (97/100) |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-index | 9.47 | 12.13 | 15.97 | 24.03 (93/100) |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-share | 9.20 | 11.67 | 16.10 | 24.37 (95/100) |
| n = 60, T(noise=1), k = 2.5 | lsa + look | 13.23 | 17.10 | 23.20 (96/100) | 36.87 (61/100) |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-index | 13.63 | 16.67 | 22.13 (98/100) | 36.57 (56/100) |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-share | 13.00 | 16.33 | 21.93 (97/100) | 36.43 (57/100) |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 7.97 | 10.07 | 13.23 | 18.50 |
| n = 500, T(noise=1), k = 2.5 | Baseline | 12.14 | 17.76 | 27.31 | — (0/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 8.40 | 10.66 | 13.78 | 19.49 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-index | 8.40 | 10.42 | 13.63 | 19.58 |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-share | 8.21 | 10.51 | 13.73 | 19.68 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 9.50 | 12.10 | 16.22 | 24.19 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-index | 9.60 | 12.14 | 16.37 | 24.72 |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-share | 9.50 | 12.24 | 16.13 | 24.24 |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 13.78 | 16.61 | 21.84 | 34.37 (17/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-index | 13.58 | 16.94 | 21.65 | 33.60 (19/20) |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-share | 12.86 | 16.51 | 21.02 | 31.01 (19/20) |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 8.16 | 10.42 | 13.54 | 18.82 |

| Case | Selector | @40 | Run | Peak |
|---|---:|---:|---:|---:|
| n = 30, T(noise=1), k = 2.5 | Baseline | 1.15% | 1.07% | 1.36% |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD | 2.29% | 2.04% | 2.37% |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.59% | 2.30% | 3.85% |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.73% | 2.30% | 2.77% |
| n = 30, T(noise=1), k = 2.5 | uleast + μ | 1.17% | 1.26% | 3.23% |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-index | 1.29% | 1.32% | 5.33% |
| n = 30, T(noise=1), k = 2.5 | uleast + μ, U-share | 1.56% | 1.83% | 2.35% |
| n = 30, T(noise=1), k = 2.5 | lsa + look | 0.69% | 0.83% | 1.98% |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-index | 0.89% | 0.89% | 2.44% |
| n = 30, T(noise=1), k = 2.5 | lsa + look, U-share | 0.73% | 0.88% | 3.45% |
| n = 30, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 2.62% | 2.18% | 2.67% |
| n = 60, T(noise=1), k = 2.5 | Baseline | 0.92% | 1.03% | 2.23% |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD | 2.85% | 2.27% | 3.29% |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.44% | 2.05% | 2.61% |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.72% | 2.25% | 2.73% |
| n = 60, T(noise=1), k = 2.5 | uleast + μ | 0.77% | 0.93% | 1.84% |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-index | 1.03% | 1.20% | 2.05% |
| n = 60, T(noise=1), k = 2.5 | uleast + μ, U-share | 1.21% | 1.25% | 1.55% |
| n = 60, T(noise=1), k = 2.5 | lsa + look | 0.95% | 1.14% | 2.42% |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-index | 0.91% | 0.95% | 1.63% |
| n = 60, T(noise=1), k = 2.5 | lsa + look, U-share | 1.08% | 1.23% | 2.70% |
| n = 60, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 2.81% | 2.30% | 2.90% |
| n = 500, T(noise=1), k = 2.5 | Baseline | 0.69% | 0.72% | 0.94% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD | 2.32% | 1.66% | 2.32% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-index | 2.74% | 2.18% | 2.80% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-share | 2.53% | 1.94% | 2.62% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ | 1.02% | 1.15% | 1.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-index | 1.00% | 1.21% | 1.52% |
| n = 500, T(noise=1), k = 2.5 | uleast + μ, U-share | 1.13% | 1.19% | 2.01% |
| n = 500, T(noise=1), k = 2.5 | lsa + look | 0.98% | 1.12% | 2.68% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-index | 1.01% | 1.20% | 2.17% |
| n = 500, T(noise=1), k = 2.5 | lsa + look, U-share | 1.17% | 1.37% | 2.34% |
| n = 500, T(noise=1), k = 2.5 | uleast + BALD, U-vs-U allowed | 2.66% | 1.88% | 2.73% |

## Per-pair selection time

A library with μ = 25 + 4q + N(0, 1.5²), σ uniform in [1.5, 4], 20
Comparisons each, then 300 votes; only `select` is timed. The Bar recompute
is timed separately since the app would pay it too.

| n | Selector | Median µs | Mean µs | p95 µs | Bar µs (median) |
|---|---:|---:|---:|---:|---:|
| 2000 | Baseline | 33.1 | 34.8 | 42.9 | 5.4 |
| 2000 | uleast + μ | 29.7 | 30.2 | 33.5 | 5.2 |
| 2000 | uleast + BALD | 103.7 | 104.9 | 110.5 | 5.4 |
| 2000 | uleast + look | 557.2 | 560.1 | 576.1 | 5.3 |
| 2000 | lsa + look | 560.6 | 565.2 | 588.4 | 5.1 |
| 2000 | straddle + BALD | 100.3 | 103.5 | 118.6 | 5.2 |
| 2000 | straddle + look | 558.3 | 571.9 | 627.6 | 5.2 |
| 10000 | Baseline | 272.8 | 276.6 | 294.5 | 25.3 |
| 10000 | uleast + μ | 148.7 | 150.7 | 172.2 | 26.7 |
| 10000 | uleast + BALD | 523.5 | 538.4 | 626.3 | 26.1 |
| 10000 | uleast + look | 2812.1 | 2851.8 | 3034.5 | 25.6 |
| 10000 | lsa + look | 2838.5 | 2886.5 | 3175.0 | 26.0 |
| 10000 | straddle + BALD | 502.6 | 522.2 | 648.0 | 25.4 |
| 10000 | straddle + look | 2791.9 | 2804.5 | 2857.7 | 25.7 |

## Caveats

- The lookahead holds the Bar fixed while it scores an opponent; the Bar
  moves after every vote.
- `stop σ < s` leaves a wallpaper out of the first pick only; it can still be
  drawn as an opponent.
- APT's ε and LSA's α were not tuned beyond the values listed (ε 2 and 4 are
  extra probes).
- Arrivals start at 25 / 8.333; a predicted starting Score
  (`starting-score.md`) was not combined with these rules.
