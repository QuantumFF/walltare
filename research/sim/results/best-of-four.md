# Best and worst of four against the Bar

Fact-finding for [#373](https://github.com/QuantumFF/walltare/issues/373)
("Best-of-N picks", map [#362](https://github.com/QuantumFF/walltare/issues/362)).
It measures showing four wallpapers and asking for the best and the worst,
against today's pairwise vote under the rule of
[ADR 0060](https://github.com/QuantumFF/walltare/blob/main/docs/adr/0060-pair-selection-draws-the-least-compared-undecided-wallpaper.md).
Nothing here picks a format; the numbers are for the grilling.

## Summary

- **Best+worst of 4, joint update, reaches the same point in about 2.4–2.9×
  fewer showings than a pair.** With the headline curator (twice as noisy as
  TrueSkill assumes), n = 500, k = 2.5, 70% of the library is Decided after
  1702 showings of four against 4080 pairs (Thurstone curator), or 1588
  against 4092 (Bradley–Terry). A judgement of four may take up to **2.40–2.60
  times as long as a pairwise vote to 70% Decided** (2.77–2.84 to the point
  where nothing is left to decide) and still be as fast. With a consistent
  curator the figure is 2.86–2.90. This is a little below the research note's
  "about 3×".
- **Best-only of 4 is worth 1.6–1.8 pairwise votes** per showing, in every
  setting.
- **Its wrong-side rate is lower than pairs', not higher.** Among Decided
  wallpapers at 70% Decided: 0.64% (T) / 0.81% (BT) for best+worst joint,
  against 1.39% / 1.13% for pairs. Over the run it is 0.30–0.33% against
  0.87–1.04%. It *falls* the longer the curator ranks (0.65% → 0.17% from
  showing 1000 to 10000, T), where BALD's rose. No k above 2.5 is needed to
  hold about 1%. At k = 2.25 best+worst has about the wrong-side rate pairs have at
  2.5 (1.04% / 1.34% at 70% Decided) and gets there in 1401 / 1342 showings.
- **Recording best+worst as five sequential `rate_1vs1` calls looks 3.3–3.9×
  faster, but the speed comes from overconfidence.** Its wrong-side rate
  at 70% Decided is 2.01% / 2.22%, about three times the joint update's and
  above pairs'. With a consistent curator it is 0.34–0.39%, where pairs and
  the joint updates are at or below 0.14%. Only 89% of its 95% intervals hold the truth
  even then, against 95% for joint and for pairs.
- **Counting a showing as +1 or as the relations a wallpaper took part in
  makes no measurable difference.** For best+worst the gap is about 5% or less in
  showings, in either direction across settings, and the wrong-side rates
  overlap.
- **Arrivals (500 scored, then 200 Unrated).** 70% of the arrivals are Decided
  after 1099 / 1040 showings of four under the ADR 0060 cap (one Unrated per
  group, none in the group after), against 1980 / 2229 pairs. Dropping the
  one-per-group limit saves 13% / 7% (953 / 970). Its wrong side among the
  arrivals is 1.36% / 1.23%, against 1.25% / 1.57% with the limit, and it puts
  two or more Unrated wallpapers in 52 showings per run. Counted in
  member-slots, groups spend about as many as pairs on arrivals (3812–4396
  against 3960–4458).
- **Groups first and pairs once nothing is left to decide is no better than
  groups throughout.** It is the same up to that point by construction. After
  it, pairs Decide more slowly than groups do (70% at 2516 against 1702, T;
  80% never against 5951), and the wrong side is not lower (Run 0.47% against
  0.33%).
- **Groups hit "nothing left to decide" with more Close calls:** 29–30% of the
  library against 27% for pairs at noise 1.0. With a consistent curator both
  leave 22%.

## Headline table

n = 500, noise 1.0 (twice as noisy as TrueSkill assumes), k = 2.5, Close call
σ < 1.5, 40 libraries per row, seed 1. Showings are medians. "Done" means
every wallpaper is Decided or a Close call. Break-even is pairwise showings
divided by these showings: how many times longer than a pairwise vote one
judgement may take and still be as fast. Wrong side is pooled over runs.

| Curator | Variant | 50% | 70% | Done | Slots to 70% | Break-even 50% / 70% / Done | Wrong @70% | Wrong over the run | Wrong peak | Inside 95% @70% |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
| T | 1. pair (ADR 0060) | 2378 | 4080 | 4631 | 8160 | 1 / 1 / 1 | 1.39% | 1.04% | 1.66% | 84.6% |
| T | 2. best+worst of 4, joint | 966 | 1702 | 1674 | 6808 | 2.46 / **2.40** / 2.77 | **0.64%** | 0.33% | 1.20% | 84.5% |
| T | 3. best of 4, joint | 1398 | 2351 | 2576 | 9404 | 1.70 / 1.74 / 1.80 | 0.95% | 0.63% | 1.32% | 85.7% |
| T | 4. best+worst of 4, sequential | 717 | 1092 | 1283 | 4368 | 3.32 / 3.74 / 3.61 | 2.01% | 0.78% | 2.10% | 77.3% |
| BT | 1. pair (ADR 0060) | 2414 | 4092 | 4673 | 8184 | 1 / 1 / 1 | 1.13% | 0.87% | 1.55% | 85.5% |
| BT | 2. best+worst of 4, joint | 930 | 1588 | 1647 | 6352 | 2.60 / **2.58** / 2.84 | **0.81%** | 0.30% | 1.48% | 85.9% |
| BT | 3. best of 4, joint | 1425 | 2553 | 2621 | 10212 | 1.69 / 1.60 / 1.78 | 1.31% | 0.91% | 2.23% | 81.4% |
| BT | 4. best+worst of 4, sequential | 689 | 1049 | 1265 | 4196 | 3.50 / 3.90 / 3.69 | 2.22% | 0.70% | 2.54% | 76.8% |

"Slots" is showings × members. "Inside 95%" is a calibration check: the share
of Scored wallpapers whose true quality, put on the Score scale, lies within
μ ± 1.96σ. It is about 95% when σ is honest and lower when σ is overconfident.
Every rating model is overconfident with this curator, pairs included.

## Results

### Speed

Showings (median) to a share of the library Decided, and to Done. Break-even
at 50% / 70% / Done. Full tables: [`best-of-four/`](best-of-four/).

| Case | Variant | 50% | 60% | 70% | 80% | Done | Break-even 50% / 70% / Done |
|---|---|---:|---:|---:|---:|---:|---|
| n 500, T 1.0 | pair | 2378 | 3068 | 4080 | — (0/40) | 4631 | 1 |
| | best+worst, joint | 966 | 1241 | 1702 | 5951 | 1674 | 2.46 / 2.40 / 2.77 |
| | best, joint | 1398 | 1797 | 2351 | 7693 (37/40) | 2576 | 1.70 / 1.74 / 1.80 |
| | best+worst, sequential | 717 | 881 | 1092 | 3170 | 1283 | 3.32 / 3.74 / 3.61 |
| n 500, BT 1.0 | pair | 2414 | 3028 | 4092 | — (0/40) | 4673 | 1 |
| | best+worst, joint | 930 | 1182 | 1588 | 5244 | 1647 | 2.60 / 2.58 / 2.84 |
| | best, joint | 1425 | 1870 | 2553 | 8893 (27/40) | 2621 | 1.69 / 1.60 / 1.78 |
| | best+worst, sequential | 689 | 859 | 1049 | 3103 | 1265 | 3.50 / 3.90 / 3.69 |
| n 500, T 0.5 | pair | 2101 | 2615 | 3332 | — (2/40) | 4314 | 1 |
| | best+worst, joint | 749 | 922 | 1159 | 3366 | 1489 | 2.81 / 2.87 / 2.90 |
| | best, joint | 1201 | 1498 | 1921 | 5857 | 2399 | 1.75 / 1.73 / 1.80 |
| | best+worst, sequential | 636 | 784 | 941 | 1187 | 1218 | 3.30 / 3.54 / 3.54 |
| n 500, BT 0.5 | pair | 2096 | 2597 | 3361 | — (1/40) | 4331 | 1 |
| | best+worst, joint | 745 | 931 | 1174 | 3314 | 1491 | 2.81 / 2.86 / 2.90 |
| | best, joint | 1263 | 1549 | 2002 | 6042 | 2425 | 1.66 / 1.68 / 1.79 |
| | best+worst, sequential | 631 | 777 | 935 | 1182 | 1222 | 3.32 / 3.59 / 3.54 |
| n 200, T 1.0 | pair | 947 | 1225 | 1627 (39/40) | — (0/40) | 1872 | 1 |
| | best+worst, joint | 377 | 470 | 656 | 2071 | 667 | 2.51 / 2.48 / 2.81 |
| | best, joint | 561 | 717 | 975 | 3013 (34/40) | 1043 | 1.69 / 1.67 / 1.79 |
| | best+worst, sequential | 280 | 349 | 445 | 1266 | 511 | 3.38 / 3.66 / 3.66 |
| n 200, BT 1.0 | pair | 951 | 1225 | 1602 (39/40) | — (0/40) | 1867 | 1 |
| | best+worst, joint | 376 | 461 | 606 | 1924 | 662 | 2.53 / 2.64 / 2.82 |
| | best, joint | 577 | 764 | 1024 | 3254 (30/40) | 1053 | 1.65 / 1.56 / 1.77 |
| | best+worst, sequential | 273 | 334 | 414 | 1154 | 504 | 3.48 / 3.87 / 3.70 |
| n 500, T 1.0, seed 2 | pair | 2395 | 3039 | 4074 | — (0/40) | 4632 | 1 |
| | best+worst, joint | 948 | 1218 | 1621 | 5445 | 1665 | 2.53 / 2.51 / 2.78 |
| | best, joint | 1390 | 1770 | 2386 | 8074 (37/40) | 2557 | 1.72 / 1.71 / 1.81 |
| | best+worst, sequential | 705 | 875 | 1090 | 3164 | 1284 | 3.40 / 3.74 / 3.61 |
| n 500, BT 1.0, seed 2 | pair | 2400 | 3072 | 4081 | — (0/40) | 4618 | 1 |
| | best+worst, joint | 951 | 1206 | 1598 | 5450 | 1655 | 2.52 / 2.55 / 2.79 |
| | best, joint | 1441 | 1899 | 2548 | 8803 (29/40) | 2623 | 1.67 / 1.60 / 1.76 |
| | best+worst, sequential | 704 | 864 | 1089 | 3168 | 1279 | 3.41 / 3.75 / 3.61 |

The n = 200 figures match n = 500 to within 0.1 on every break-even ratio.
Seed 2 (40 more libraries) matches seed 1 to within 0.15.

Pairs never reach 80% Decided within the budget, because the Close calls take
more than 20% of the library. For groups at noise 1.0, 70% sits right at Done:
the runs are Done at 69.8–71.1% Decided (pooled), and anything Decided past that comes
from the fallback, which keeps drawing the least-compared Eligible wallpaper.
That is why the break-even at Done is a little higher than at 70%, and why
groups keep reaching 80%.

### Wrong side, and how it evolves

Share of Decided wallpapers on the wrong side of the Bar, pooled over runs:
at the showing each run first reached 50% / 70% Decided, then at fixed
showings (1000 = pairwise Each 4, 10000 = Each 40), over the run (every 50th
showing from 1000 on) and at the worst point with at least 2% Decided. n =
500, noise 1.0, k = 2.5.

| Curator | Variant | @50% | @70% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T | pair | 1.18% | 1.39% | 1.47% | 0.85% | 1.15% | 1.23% | 0.68% | 1.04% | 1.66% |
| T | best+worst, joint | 0.65% | 0.64% | 0.51% | 0.65% | 0.44% | 0.32% | 0.17% | 0.33% | 1.20% |
| T | best, joint | 0.99% | 0.95% | 1.11% | 0.87% | 0.97% | 0.60% | 0.37% | 0.63% | 1.32% |
| T | best+worst, sequential | 1.54% | 2.01% | 1.57% | 2.10% | 1.21% | 0.72% | 0.26% | 0.78% | 2.10% |
| BT | pair | 1.04% | 1.13% | 0.87% | 0.84% | 1.06% | 1.05% | 0.54% | 0.87% | 1.55% |
| BT | best+worst, joint | 1.03% | 0.81% | 1.06% | 1.06% | 0.48% | 0.23% | 0.10% | 0.30% | 1.48% |
| BT | best, joint | 1.26% | 1.31% | 1.86% | 1.14% | 1.36% | 0.94% | 0.57% | 0.91% | 2.23% |
| BT | best+worst, sequential | 1.97% | 2.22% | 2.09% | 2.28% | 1.18% | 0.61% | 0.21% | 0.70% | 2.54% |

- Nothing rises with ranking time. Every variant is lowest at the end of the
  budget, groups included (once Done, the fallback spreads Comparisons over
  every Eligible wallpaper). Sequential starts highest (about 2% while the library is being
  Decided) and falls with the rest.
- With a consistent curator (noise 0.5), pairs, best+worst joint and best
  joint stay at or below 0.21% at every reported point (peaks 0.14–0.31%). Sequential is at 0.29–0.41% around 50–70%
  Decided.
- At k = 3 (noise 1.0, n = 500): pair 0.38% / 0.43% at 70% (T / BT; the
  median pair run never reaches 70% under T), best+worst joint 0.19% / 0.14%,
  best joint 0.36% / 0.54%, sequential 1.08% / 1.27%. Sequential needs k = 3
  to come down to what pairs show at 2.5.
- At k = 2.5 the variant-2 rate stays at or below 1.06% at 50% and 70%
  Decided and at every fixed showing in every setting, and at 0.30–0.45%
  over the run at noise 1.0. Only its peak, the worst single checkpoint with at least 2%
  Decided, goes past 1.2% (1.48% BT at n = 500, 1.75% BT at n = 200). So the
  k and Close call sweep the ticket asks for past 1.2% is not triggered. It
  was run anyway, below.

### When nothing is left to decide

At the first showing after which every wallpaper is Decided or a Close call,
pooled over runs (all 40 got there in every row). n = 500, k = 2.5.

| Case | Variant | Showings | Decided | Close call | Wrong among Decided | Inside 95% at the end |
|---|---|---:|---:|---:|---:|---:|
| T 1.0 | pair | 4631 | 73.24% | 26.76% | 1.30% | 75.8% |
| | best+worst, joint | 1674 | 69.83% | 30.17% | 0.72% | 83.3% |
| | best, joint | 2576 | 71.97% | 28.02% | 0.96% | 81.0% |
| | best+worst, sequential | 1283 | 75.58% | 24.42% | 1.96% | 78.2% |
| BT 1.0 | pair | 4673 | 73.28% | 26.71% | 1.13% | 78.1% |
| | best+worst, joint | 1647 | 71.14% | 28.86% | 0.82% | 86.3% |
| | best, joint | 2621 | 70.63% | 29.37% | 1.36% | 76.1% |
| | best+worst, sequential | 1265 | 76.06% | 23.95% | 2.29% | 80.4% |
| T 0.5 | pair | 4314 | 77.65% | 22.35% | 0.08% | 95.1% |
| | best+worst, joint | 1489 | 77.59% | 22.41% | 0.10% | 95.5% |
| | best, joint | 2399 | 76.80% | 23.20% | 0.03% | 94.5% |
| | best+worst, sequential | 1218 | 80.29% | 19.71% | 0.31% | 90.6% |

Sequential leaves the fewest Close calls because its σ shrinks fastest, not
because it knows more: it has the most wallpapers on the wrong side.

### 5. Counting for least-compared-first

A member's Comparison count, which the first pick reads, grows by 1 per
showing or by the relations it took part in (best and worst +3, middle +2;
best-only: best +3, others +1). Every other row in this file uses relations.

| Case | Variant | Count | 50% | 70% | Done | Wrong @70% | Run |
|---|---|---|---:|---:|---:|---:|---:|
| n 500, T 1.0 | best+worst | relations | 966 | 1702 | 1674 | 0.64% | 0.33% |
| | | +1 per showing | 950 | 1612 | 1659 | 0.68% | 0.29% |
| n 500, BT 1.0 | best+worst | relations | 930 | 1588 | 1647 | 0.81% | 0.30% |
| | | +1 per showing | 919 | 1545 | 1629 | 0.81% | 0.36% |
| n 500, T 1.0, seed 2 | best+worst | relations | 948 | 1621 | 1665 | 0.61% | 0.32% |
| | | +1 per showing | 942 | 1627 | 1655 | 0.61% | 0.35% |
| n 500, BT 1.0, seed 2 | best+worst | relations | 951 | 1598 | 1655 | 0.69% | 0.28% |
| | | +1 per showing | 922 | 1583 | 1646 | 0.68% | 0.29% |
| n 500, T 0.5 | best+worst | relations | 749 | 1159 | 1489 | 0.11% | 0.03% |
| | | +1 per showing | 760 | 1169 | 1485 | 0.04% | 0.02% |
| n 200, T 1.0 | best+worst | relations | 377 | 656 | 667 | 0.86% | 0.45% |
| | | +1 per showing | 385 | 640 | 668 | 0.82% | 0.40% |
| n 500, T 1.0 | best | relations | 1398 | 2351 | 2576 | 0.95% | 0.63% |
| | | +1 per showing | 1339 | 2383 | 2586 | 0.78% | 0.52% |
| n 500, BT 1.0 | best | relations | 1425 | 2553 | 2621 | 1.31% | 0.91% |
| | | +1 per showing | 1415 | 2572 | 2640 | 1.42% | 1.08% |

+1 per showing is faster to 70% in 4 of the 6 best+worst rows, by at most 5.3%
(1612 against 1702), and slower in the other 2. Done differs by about 1% at
most.
The wrong-side rates overlap. The difference is within what another 40
libraries moves.

### 6. Arrivals

500 wallpapers ranked by pairs under ADR 0060 to Each 20, the same 5000 votes
for every row. Then a scan adds 200 Unrated (25 / 8.333), and each variant
runs 5000 showings over all 700. Showings are counted from the scan; wrong
side is among the arrivals Decided when 70% of them first were. 40 libraries
per row.

- **ADR**: every other member has a Score whenever one is open, so there is
  at most one Unrated per showing. While at least half the pool has a Score,
  a showing that follows one with an Unrated draws none.
- **No per-group limit**: the every-other cap kept, members drawn freely.
- **No limit or cap**: neither.

| Curator | Variant | All Scored | ≥2 Unrated per run | New 50% | New 70% | Slots to 70% | Wrong among new @70% | Old Decided at scan → lowest |
|---|---|---:|---:|---:|---:|---:|---:|---|
| T 1.0 | pair, ADR | 399 | 0 | 1149 | 1980 | 3960 | 2.04% | 73.1% → 68.6% |
| | pair, no limit or cap | 171 | 29.8 | 1099 | 2075 (36/40) | 4150 | 1.84% | 73.1% → 63.7% |
| | best+worst, ADR | 399 | 0 | 598 | 1099 | 4396 | 1.25% | 73.1% → 68.6% |
| | best+worst, no per-group limit | 271 | 52.6 | 505 | 953 | 3812 | 1.36% | 73.1% → 68.7% |
| | best+worst, no limit or cap | 136 | 51.0 | 484 | 964 | 3856 | 1.68% | 73.1% → 68.2% |
| | best, ADR | 399 | 0 | 975 | 1752 (35/40) | 7008 | 1.33% | 73.1% → 68.8% |
| BT 1.0 | pair, ADR | 399 | 0 | 1175 | 2229 (39/40) | 4458 | 1.58% | 73.2% → 68.7% |
| | pair, no limit or cap | 170 | 29.9 | 1155 | 2254 | 4508 | 1.54% | 73.2% → 63.8% |
| | best+worst, ADR | 399 | 0 | 583 | 1040 | 4160 | 1.57% | 73.2% → 68.7% |
| | best+worst, no per-group limit | 269 | 51.9 | 526 | 970 | 3880 | 1.23% | 73.2% → 69.1% |
| | best+worst, no limit or cap | 137 | 50.9 | 485 | 935 | 3740 | 1.59% | 73.2% → 69.0% |
| | best, ADR | 399 | 0 | 1007 | 1869 (30/40) | 7476 | 1.69% | 73.2% → 68.5% |
| T 0.5 | pair, ADR | 399 | 0 | 953 | 1651 | 3302 | 0.23% | 77.5% → 73.3% |
| | best+worst, ADR | 399 | 0 | 487 | 751 | 3004 | 0.11% | 77.5% → 74.4% |
| | best+worst, no per-group limit | 265 | 53.4 | 423 | 720 | 2880 | 0.23% | 77.5% → 74.6% |
| | best+worst, no limit or cap | 132 | 52.5 | 384 | 677 | 2708 | 0.14% | 77.5% → 74.2% |
| BT 0.5 | pair, ADR | 399 | 0 | 990 | 1658 | 3316 | 0.14% | 77.4% → 73.7% |
| | best+worst, ADR | 399 | 0 | 472 | 751 | 3004 | 0.23% | 77.4% → 75.0% |
| | best+worst, no per-group limit | 269 | 52.2 | 417 | 710 | 2840 | 0.21% | 77.4% → 74.5% |
| | best+worst, no limit or cap | 134 | 51.5 | 384 | 670 | 2680 | 0.36% | 77.4% → 74.3% |

- Under the ADR rule, a group Scores arrivals no faster than a pair: one per
  showing, every other showing, 399 showings for 200. Groups get the Scored
  arrivals Decided faster because every showing also has three Scored
  members.
- Dropping the per-group limit saves 4–13% of the showings to 70% and
  Scores every arrival in 265–271 showings. The wrong-side rate among the
  arrivals moves by −0.34 to +0.12 points, depending on the curator. None of
  the rows is consistently worse.
- Dropping the cap too shows an Unrated arrival in every showing until all
  have a Score (132–137 showings). It saves up to 6% more, though one row is
  1% slower. The old wallpapers' Decided share dips about the same under
  every group variant, within 0.7 points of each other. Pairs without the cap
  dip about 5 points further (63.7% against 68.6%).
- The same caps in a fresh 500-wallpaper library (no scan; T / BT noise 1.0,
  k 2.5). No per-group limit reaches 70% Decided in 1401 / 1332 showings
  against 1702 / 1588, and is Done in 1493 / 1476 against 1674 / 1647. It is
  wrong on 0.77% / 0.99% at 70% against 0.64% / 0.81%, and its peak is 1.47% /
  2.48% against 1.20% / 1.48%. No limit or cap: 1342 / 1314 showings, 1.01% /
  1.04% wrong, peaks 1.76% / 2.49%. At n = 200 the speed pattern is the same,
  and the wrong-side differences go either way (T: 0.86% ADR, 0.79% and
  0.73% without the limits).

### 7. Mixed: groups until Done, then pairs

Identical to best+worst joint up to Done, which is 1674 / 1647 showings
(T / BT, n = 500, noise 1.0, k = 2.5); pairs throughout reach Done at 4631 /
4673. After Done:

| Curator | Variant | 70% | 80% | Wrong @2500 | @5000 | @10000 | Run | Inside 95% at the end |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| T | pairs throughout | 4080 | — (0/40) | 1.15% | 1.23% | 0.68% | 1.04% | 75.8% |
| T | groups throughout | 1702 | 5951 | 0.44% | 0.32% | 0.17% | 0.33% | 83.3% |
| T | groups, then pairs | 2516 | — (0/40) | 0.61% | 0.49% | 0.31% | 0.47% | 80.9% |
| BT | pairs throughout | 4092 | — (0/40) | 1.06% | 1.05% | 0.54% | 0.87% | 78.1% |
| BT | groups throughout | 1588 | 5244 | 0.48% | 0.23% | 0.10% | 0.30% | 86.3% |
| BT | groups, then pairs | 1588 | — (0/40) | 0.66% | 0.43% | 0.29% | 0.48% | 82.9% |

The switch changes nothing before Done. After it, the pairs Decide more
slowly and are wrong more often than groups carrying on.

### k and Close call sweep

The ticket asks for this only if variant 2 went past about 1.2% at k = 2.5.
It did not, but the sweep was cheap. n = 500, noise 1.0, 40 libraries. Wrong
is at 70% Decided (Run in brackets).

| k | Curator | pair 70% / Done | pair wrong | best+worst 70% / Done | best+worst wrong | best 70% / Done | best wrong |
|---:|---|---|---:|---|---:|---|---:|
| 2 | T | 2822 / 4008 | 2.46% (1.84%) | 1165 / 1489 | 1.48% (0.66%) | 1724 / 2308 | 1.91% (1.06%) |
| 2 | BT | 2722 / 3954 | 2.71% (1.87%) | 1128 / 1473 | 1.87% (0.65%) | 1800 / 2343 | 2.85% (1.60%) |
| 2.25 | T | 3433 / 4329 | 1.78% (1.34%) | 1401 / 1580 | 1.04% (0.44%) | 2004 / 2431 | 1.44% (0.82%) |
| 2.25 | BT | 3421 / 4332 | 1.79% (1.27%) | 1342 / 1567 | 1.34% (0.53%) | 2144 / 2477 | 2.02% (1.22%) |
| 2.5 | T | 4080 / 4631 | 1.39% (1.04%) | 1702 / 1674 | 0.64% (0.33%) | 2351 / 2576 | 0.95% (0.63%) |
| 2.5 | BT | 4092 / 4673 | 1.13% (0.87%) | 1588 / 1647 | 0.81% (0.30%) | 2553 / 2621 | 1.31% (0.91%) |
| 2.75 | T | 4753 (38/40) / 4935 | 0.81% (0.67%) | 2971 / 1741 | 0.31% (0.19%) | 3376 / 2694 | 0.53% (0.37%) |
| 2.75 | BT | 4730 / 4920 | 0.79% (0.66%) | 2705 / 1730 | 0.43% (0.26%) | 4646 / 2733 | 0.83% (0.75%) |
| 3 | T | — (18/40) / 5196 | 0.38% (0.51%) | 3544 / 1791 | 0.19% (0.17%) | 5065 / 2796 | 0.36% (0.35%) |
| 3 | BT | 9860 (23/40) / 5195 | 0.43% (0.44%) | 3405 / 1787 | 0.14% (0.13%) | 5344 / 2825 | 0.54% (0.52%) |

For best+worst, k = 2.25 is the lowest k whose rate at 70% Decided stays near
1% (1.04% / 1.34%). k = 2.5 holds at or below 1.06% at every reported point;
only the peak checkpoint goes past it. From k = 2.75 the 70% point falls after Done, so 70% is reached only
through the fallback.

Close call threshold for best+worst joint, T / BT (Done in showings, Decided
share at Done, wrong at Done):

| k | Close call | Done | Decided at Done | Wrong at Done |
|---:|---|---|---|---|
| 2.25 | σ < 1 | 2351 / 2286 | 81.6% / 82.2% | 0.94% / 1.17% |
| 2.25 | σ < 1.5 | 1580 / 1567 | 73.1% / 74.1% | 1.01% / 1.32% |
| 2.25 | σ < 2 | 1244 / 1237 | 65.9% / 66.9% | 1.17% / 1.47% |
| 2.75 | σ < 1 | 2610 / 2590 | 77.1% / 77.8% | 0.40% / 0.53% |
| 2.75 | σ < 1.5 | 1741 / 1730 | 67.1% / 67.9% | 0.49% / 0.66% |
| 2.75 | σ < 2 | 1345 / 1338 | 58.1% / 59.1% | 0.45% / 0.61% |

The Close call threshold moves Done and how much is left as Close calls. It
barely moves the wrong-side rate.

### Other variants

- **Repeat window.** The first pick leaves out the last 10 showings. For
  groups that can be up to 40 wallpapers, or 50 implied Comparisons. A window
  of 2 showings (10 Comparisons, as for pairs) gives 1650 / 1586 showings to
  70% (T / BT) against 1702 / 1588, Done 1668 / 1655, and wrong 0.63% / 0.70%.
  That is no measurable difference.
- **Baseline reproduction.** `pair runs --sizes 500 --noise 1.0 --voter
  thurstone,bradley-terry --reps 20 --selector uleast+mu` with the same seeds
  reproduces `pair-selection.md` exactly: Each 9.50 / 16.22 (T), 9.60 / 16.27
  (BT) to 50% / 70%. The ADR 0060-shaped `uleast+mu/m=10/stop=1.5/u=share`
  gives 9.84 / 16.27 and 9.65 / 16.13. This study's own pair (the same rule
  in `src/group.rs`, with the half-Scored condition on the arrival cap) gives
  2378 / 4080 showings, which is Each 9.51 / 16.32, and Done at Each 18.5
  (ADR 0060: "σ below 1.5 is reached at about 19 each").

## Method

### The showing

One engine (`src/group.rs`) runs both pairs and groups, so every row shares
the selection code and the libraries. A given `(seed, n, rep)` is the same
library for every variant and curator, and the same one `pair-selection.md`
used.

- **First pick**, exactly ADR 0060: the least-compared Undecided wallpaper,
  random among ties. It leaves out Close calls (Scored, Undecided, σ < 1.5)
  and every wallpaper in the last 10 showings; the window shrinks to the
  showing on screen when that leaves nothing. Once nothing is open, the
  fallback is the least-compared Eligible wallpaper not on screen. There are
  no Kept wallpapers in the simulation.
- **Other members**: drawn one at a time without replacement, each weighted
  by exp(−½((μⱼ − μ₁)/σ₁)²) relative to the first pick. They come from every
  wallpaper except the first pick and the showing on screen, Decided and
  Close calls included. Under the ADR arrival rule, a member must have a
  Score whenever one is open, if the first pick is Unrated or the cap is on.
  The cap is on while at least half the pool has a Score and the previous
  showing had an Unrated wallpaper. If the pool runs short, the draw falls
  back first to anything not on screen, then to anything.
- **The curator** perceives every member once. Thurstone (T): quality +
  noise·N(0, 1). Bradley–Terry (BT): quality/scale + Gumbel, scale =
  noise·√2/1.702, so the order is a Plackett–Luce ranking. The best is the
  highest perception and the worst the lowest. For a pair this is the same
  distribution as `sim::Thurstone` and `sim::BradleyTerry`. Noise 1.0 is the
  pair-selection report's headline, a curator twice as noisy as TrueSkill
  assumes (β/σ₀ ≈ 0.5). "Noise 1.0 with both voters" in the ticket means T
  and BT at 1.0. Noise 0.5 is the consistent curator.
- **Implied relations**: best over each other member (3). For best+worst,
  also each middle member over the worst (2 more, 5 of 6).
- **Joint update** (`group::joint_update`): a port of `ep_skills` in
  `docs/research/best-of-n-judgements/bestofn.py` (branch
  `research/best-of-n-judgements`). Each member has one performance
  pᵢ ~ N(sᵢ, β²), with sᵢ ~ N(μᵢ, σᵢ² + τ²), β = 4.167, τ = 0.083, and no
  draws. There is one truncation site pᵢ > pⱼ per relation. EP on the joint
  Gaussian of the performances iterates until the sites move less than
  1e-10. Tests check that it equals `ranking::rate_1vs1` for a pair (four
  cases, within 1e-5) and that it reproduces the script's best-of-4 and
  best+worst-of-4 output (fresh and mixed Ratings) within 1e-4. A pair always
  uses `rate_1vs1` itself.
- **Sequential** (variant 4): `rate_1vs1` for best over each other member in
  the order shown, then each middle member over the worst, carrying each
  updated Rating into the next call.
- **Bar and Decided**: the worst 20% of the Scored, recomputed after every
  showing; truth is the same 20% of true quality. Decided is |μ − Bar| ≥ kσ,
  and an Unrated wallpaper is never Decided. The selector reads the same k.
- **Budget**: n × 20 showings (pairwise Each 40) for every variant, so groups
  run well past Done. Showings "to X%" are exact (checked after every
  showing), as medians over runs. Runs that never get there sort last, and
  "(r/N)" shows how many did.
- **Calibration**: a least-squares fit μ ≈ a + b·q over the Scored puts true
  quality on the Score scale. It counts the share of Scored wallpapers with
  |μ − (a + b·q)| ≤ 1.96σ. The fit soaks up part of the error, so it reads a
  little high. With the consistent curator, pairs and joint land on 94–96%,
  which checks the measure.

### Reproduce

From `research/sim`. Every run is under 20 s on 12 threads, and the whole set
takes about 3 minutes. The full output is in
[`best-of-four/`](best-of-four/); each file starts with its command.

```sh
SIM="cargo run --release --"
V=pair,bw4,best4,bw4/seq,bw4/count=show,best4/count=show,bw4/mixed,bw4/u=nolimit,bw4/u=free,bw4/m=2
for n in 500 200; do                                                                    # runs-500.md, runs-200.md
  $SIM group runs --sizes $n --voter thurstone,bradley-terry --noise 1.0,0.5 --k 2.5,3 --reps 40 --variant $V
done
$SIM group runs --sizes 500 --voter thurstone,bradley-terry --noise 1.0 --k 2.5,3 --reps 40 --seed 2 \
  --variant pair,bw4,best4,bw4/seq,bw4/count=show                                     # seed2.md
$SIM group runs --sizes 500 --voter thurstone,bradley-terry --noise 1.0 --k 2,2.25,2.75 --reps 40 \
  --variant pair,bw4,best4,bw4/cc=1,bw4/cc=2,bw4/count=show                           # k-sweep.md
$SIM group arrival --old 500 --new 200 --each-before 20 --after 5000 --voter thurstone,bradley-terry \
  --noise 1.0,0.5 --k 2.5 --reps 40 --variant pair,pair/u=free,bw4,bw4/u=nolimit,bw4/u=free,best4  # arrival.md
$SIM pair runs --sizes 500 --noise 1.0 --voter thurstone,bradley-terry --reps 20 \
  --selector uleast+mu,uleast+mu/m=10/stop=1.5/u=share                                # baseline reproduction
cargo test --release                                                                  # joint update checks
```

Variant names: `pair`, `bw<N>` (best+worst of N), `best<N>`, then `/seq`
(sequential `rate_1vs1`), `/count=show|rel`, `/u=adr|nolimit|free`, `/mixed`
(pairs once Done), `/m=<showings>` (repeat window) and `/cc=<σ>` (Close call
threshold).

### Caveats

- The curator's noise is per wallpaper per showing and does not grow with N.
  Real error and time per judgement grow with N, and this study measures only
  showings. The break-even ratio is the time budget such growth would have to
  stay under.
- Both curator models agree with TrueSkill's own Gaussian on pairs. For
  groups, BT's worst pick is the last of a Plackett–Luce ranking, one
  modelling choice among several.
- Nothing is rejected during a run, and there are no Kept wallpapers.
