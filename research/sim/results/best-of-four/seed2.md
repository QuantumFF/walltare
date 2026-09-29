# walltare-sim group runs --sizes 500 --voter thurstone,bradley-terry --noise 1.0 --k 2.5,3 --reps 40 --seed 2 --variant pair,bw4,best4,bw4/seq,bw4/count=show

## n = 500, T(noise=1), k = 2.5

40 libraries per row (seed 2), 10000 showings each. 7.4s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2395 | 3039 | 4074 | — (0/40) | 4632 | 4790 | 8148 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 948 | 1218 | 1621 | 5445 | 1665 | 3792 | 6484 | 2.53 | 2.51 | 2.78 |
| best of 4, joint | 1390 | 1770 | 2386 | 8074 (37/40) | 2557 | 5560 | 9544 | 1.72 | 1.71 | 1.81 |
| best+worst of 4, sequential rate_1vs1 | 705 | 875 | 1090 | 3164 | 1284 | 2820 | 4360 | 3.40 | 3.74 | 3.61 |
| best+worst of 4, joint, count +1 per showing | 942 | 1182 | 1627 | 5598 | 1655 | 3768 | 6508 | 2.54 | 2.50 | 2.80 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.15% | 1.26% | — | 0.77% | 0.74% | 1.13% | 1.20% | 0.58% | 0.97% | 1.34% |
| best+worst of 4, joint | 0.75% | 0.61% | 0.34% | 0.62% | 0.78% | 0.41% | 0.35% | 0.17% | 0.32% | 0.91% |
| best of 4, joint | 0.94% | 0.83% | 0.48% | 1.37% | 0.71% | 0.82% | 0.61% | 0.29% | 0.58% | 1.37% |
| best+worst of 4, sequential rate_1vs1 | 1.64% | 1.93% | 0.99% | 1.63% | 1.96% | 1.15% | 0.71% | 0.24% | 0.69% | 2.11% |
| best+worst of 4, joint, count +1 per showing | 0.76% | 0.61% | 0.31% | 0.57% | 0.73% | 0.47% | 0.38% | 0.21% | 0.35% | 0.91% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.25% | 26.75% | 1.26% | 85.19% | 76.48% |
| best+worst of 4, joint | 40/40 | 70.12% | 29.88% | 0.68% | 84.66% | 84.67% |
| best of 4, joint | 40/40 | 71.81% | 28.20% | 0.81% | 85.25% | 80.42% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.69% | 24.31% | 1.84% | 76.64% | 78.17% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 70.59% | 29.41% | 0.69% | 85.03% | 83.72% |

## n = 500, BT(noise=1), k = 2.5

40 libraries per row (seed 2), 10000 showings each. 7.5s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2400 | 3072 | 4081 | — (0/40) | 4618 | 4800 | 8162 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 951 | 1206 | 1598 | 5450 | 1655 | 3804 | 6392 | 2.52 | 2.55 | 2.79 |
| best of 4, joint | 1441 | 1899 | 2548 | 8803 (29/40) | 2623 | 5764 | 10192 | 1.67 | 1.60 | 1.76 |
| best+worst of 4, sequential rate_1vs1 | 704 | 864 | 1089 | 3168 | 1279 | 2816 | 4356 | 3.41 | 3.75 | 3.61 |
| best+worst of 4, joint, count +1 per showing | 922 | 1167 | 1583 | 5150 | 1646 | 3688 | 6332 | 2.60 | 2.58 | 2.81 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.17% | 1.22% | — | 1.15% | 0.91% | 1.16% | 1.11% | 0.44% | 0.87% | 1.27% |
| best+worst of 4, joint | 0.76% | 0.69% | 0.23% | 1.00% | 0.83% | 0.43% | 0.28% | 0.14% | 0.28% | 1.39% |
| best of 4, joint | 1.15% | 1.24% | 0.86% | 1.89% | 1.07% | 1.36% | 0.96% | 0.62% | 0.95% | 1.96% |
| best+worst of 4, sequential rate_1vs1 | 1.81% | 2.30% | 1.06% | 1.61% | 2.30% | 1.14% | 0.67% | 0.19% | 0.68% | 3.09% |
| best+worst of 4, joint, count +1 per showing | 0.71% | 0.68% | 0.28% | 0.73% | 0.63% | 0.52% | 0.27% | 0.13% | 0.29% | 1.39% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.72% | 26.27% | 1.23% | 85.27% | 77.98% |
| best+worst of 4, joint | 40/40 | 70.67% | 29.34% | 0.71% | 85.92% | 86.25% |
| best of 4, joint | 40/40 | 70.23% | 29.77% | 1.33% | 80.80% | 76.09% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.84% | 24.16% | 2.14% | 77.28% | 80.73% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 70.88% | 29.12% | 0.66% | 86.00% | 86.14% |

## n = 500, T(noise=1), k = 3

40 libraries per row (seed 2), 10000 showings each. 7.5s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 3159 | 4099 | — (18/40) | — (0/40) | 5209 | 6318 | — (18/40) | 1.00 | — | 1.00 |
| best+worst of 4, joint | 1195 | 1563 | 3418 | 8625 (30/40) | 1798 | 4780 | 13672 | 2.64 | — | 2.90 |
| best of 4, joint | 1748 | 2241 | 5011 | — (4/40) | 2786 | 6992 | 20044 | 1.81 | — | 1.87 |
| best+worst of 4, sequential rate_1vs1 | 859 | 1064 | 1349 | 4706 | 1379 | 3436 | 5396 | 3.68 | — | 3.78 |
| best+worst of 4, joint, count +1 per showing | 1182 | 1536 | 3421 | 8318 (33/40) | 1790 | 4728 | 13684 | 2.67 | — | 2.91 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.57% | 0.49% | — | 0.00% | 0.48% | 0.45% | 0.56% | 0.33% | 0.45% | 0.57% |
| best+worst of 4, joint | 0.32% | 0.27% | 0.06% | 0.07% | 0.29% | 0.23% | 0.16% | 0.05% | 0.15% | 0.33% |
| best of 4, joint | 0.42% | 0.31% | 0.31% | 0.55% | 0.31% | 0.47% | 0.30% | 0.13% | 0.29% | 0.76% |
| best+worst of 4, sequential rate_1vs1 | 1.15% | 1.01% | 0.49% | 1.02% | 1.20% | 0.75% | 0.39% | 0.08% | 0.43% | 1.20% |
| best+worst of 4, joint, count +1 per showing | 0.41% | 0.24% | 0.16% | 0.26% | 0.31% | 0.34% | 0.20% | 0.11% | 0.21% | 0.45% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 67.63% | 32.37% | 0.57% | 78.24% | 76.75% |
| best+worst of 4, joint | 40/40 | 64.74% | 35.26% | 0.30% | 81.28% | 84.09% |
| best of 4, joint | 40/40 | 66.29% | 33.71% | 0.44% | 80.17% | 80.07% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 70.28% | 29.72% | 1.12% | 72.36% | 78.31% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 64.63% | 35.37% | 0.41% | 81.14% | 84.17% |

## n = 500, BT(noise=1), k = 3

40 libraries per row (seed 2), 10000 showings each. 7.5s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 3201 | 4140 | 9976 (21/40) | — (0/40) | 5229 | 6402 | 19952 (21/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 1188 | 1534 | 3502 | 8417 (33/40) | 1793 | 4752 | 14008 | 2.69 | 2.85 | 2.92 |
| best of 4, joint | 1887 | 2429 | 5392 | — (0/40) | 2860 | 7548 | 21568 | 1.70 | 1.85 | 1.83 |
| best+worst of 4, sequential rate_1vs1 | 842 | 1036 | 1324 | 4425 | 1372 | 3368 | 5296 | 3.80 | 7.53 | 3.81 |
| best+worst of 4, joint, count +1 per showing | 1198 | 1522 | 3471 | 8188 (35/40) | 1797 | 4792 | 13884 | 2.67 | 2.87 | 2.91 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.58% | 0.34% | — | 0.00% | 0.48% | 0.60% | 0.58% | 0.37% | 0.49% | 0.74% |
| best+worst of 4, joint | 0.28% | 0.18% | 0.11% | 0.22% | 0.26% | 0.23% | 0.16% | 0.04% | 0.12% | 0.74% |
| best of 4, joint | 0.82% | 0.67% | — | 0.79% | 0.66% | 0.80% | 0.59% | 0.35% | 0.58% | 1.22% |
| best+worst of 4, sequential rate_1vs1 | 1.27% | 1.13% | 0.46% | 1.21% | 1.36% | 0.60% | 0.37% | 0.08% | 0.39% | 1.73% |
| best+worst of 4, joint, count +1 per showing | 0.36% | 0.20% | 0.12% | 0.20% | 0.35% | 0.22% | 0.14% | 0.04% | 0.15% | 0.74% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 67.88% | 32.12% | 0.62% | 79.72% | 78.19% |
| best+worst of 4, joint | 40/40 | 64.91% | 35.09% | 0.31% | 82.78% | 85.95% |
| best of 4, joint | 40/40 | 64.75% | 35.24% | 0.78% | 76.47% | 76.53% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 70.89% | 29.11% | 1.28% | 73.29% | 80.70% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 64.82% | 35.18% | 0.35% | 82.44% | 86.25% |

