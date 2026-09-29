# walltare-sim group runs --sizes 500 --voter thurstone,bradley-terry --noise 1.0 --k 2,2.25,2.75 --reps 40 --variant pair,bw4,best4,bw4/cc=1,bw4/cc=2,bw4/count=show

## n = 500, T(noise=1), k = 2

40 libraries per row (seed 1), 10000 showings each. 10.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1697 | 2151 | 2822 | 9743 (21/40) | 4008 | 3394 | 5644 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 727 | 903 | 1165 | 3499 | 1489 | 2908 | 4660 | 2.33 | 2.42 | 2.69 |
| best of 4, joint | 798 | 1298 | 1724 | 5147 | 2308 | 3192 | 6896 | 2.13 | 1.64 | 1.74 |
| best+worst of 4, joint, Close call σ<1 | 727 | 903 | 1165 | 1694 | 2168 | 2908 | 4660 | 2.33 | 2.42 | 1.85 |
| best+worst of 4, joint, Close call σ<2 | 727 | 903 | 1179 | 3609 | 1188 | 2908 | 4716 | 2.33 | 2.39 | 3.37 |
| best+worst of 4, joint, count +1 per showing | 726 | 916 | 1181 | 3597 | 1489 | 2904 | 4724 | 2.34 | 2.39 | 2.69 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2.37% | 2.46% | 2.56% | 2.45% | 2.20% | 2.51% | 2.00% | 1.16% | 1.84% | 2.82% |
| best+worst of 4, joint | 1.41% | 1.48% | 0.82% | 1.48% | 1.54% | 0.87% | 0.59% | 0.35% | 0.66% | 2.11% |
| best of 4, joint | 2.39% | 1.91% | 1.20% | 2.03% | 1.55% | 1.65% | 1.07% | 0.52% | 1.06% | 2.51% |
| best+worst of 4, joint, Close call σ<1 | 1.41% | 1.48% | 1.37% | 1.48% | 1.54% | 0.97% | 0.59% | 0.23% | 0.63% | 2.11% |
| best+worst of 4, joint, Close call σ<2 | 1.41% | 1.43% | 0.72% | 1.48% | 1.54% | 0.86% | 0.53% | 0.37% | 0.63% | 2.11% |
| best+worst of 4, joint, count +1 per showing | 1.51% | 1.54% | 0.76% | 1.52% | 1.42% | 0.90% | 0.63% | 0.27% | 0.63% | 2.11% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 79.38% | 20.62% | 2.42% | 88.03% | 76.34% |
| best+worst of 4, joint | 40/40 | 76.78% | 23.23% | 1.40% | 88.58% | 83.72% |
| best of 4, joint | 40/40 | 77.97% | 22.02% | 1.81% | 87.74% | 79.98% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 83.76% | 16.24% | 1.20% | 88.58% | 84.14% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 69.84% | 30.16% | 1.53% | 87.25% | 84.38% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 76.33% | 23.66% | 1.42% | 88.11% | 84.25% |

## n = 500, BT(noise=1), k = 2

40 libraries per row (seed 1), 10000 showings each. 10.2s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1680 | 2105 | 2722 | 3921 (27/40) | 3954 | 3360 | 5444 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 706 | 883 | 1128 | 3463 | 1473 | 2824 | 4512 | 2.38 | 2.41 | 2.68 |
| best of 4, joint | 798 | 1333 | 1800 | 5769 | 2343 | 3192 | 7200 | 2.11 | 1.51 | 1.69 |
| best+worst of 4, joint, Close call σ<1 | 706 | 883 | 1128 | 1602 | 2129 | 2824 | 4512 | 2.38 | 2.41 | 1.86 |
| best+worst of 4, joint, Close call σ<2 | 706 | 883 | 1140 | 3468 | 1178 | 2824 | 4560 | 2.38 | 2.39 | 3.36 |
| best+worst of 4, joint, count +1 per showing | 704 | 888 | 1164 | 3572 | 1486 | 2816 | 4656 | 2.39 | 2.34 | 2.66 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2.38% | 2.71% | 2.60% | 1.61% | 2.05% | 2.57% | 2.07% | 1.16% | 1.87% | 2.68% |
| best+worst of 4, joint | 1.73% | 1.87% | 0.76% | 1.62% | 1.90% | 0.93% | 0.58% | 0.28% | 0.65% | 2.39% |
| best of 4, joint | 3.27% | 2.85% | 1.54% | 3.15% | 2.17% | 2.40% | 1.43% | 1.01% | 1.60% | 3.39% |
| best+worst of 4, joint, Close call σ<1 | 1.73% | 1.87% | 1.66% | 1.62% | 1.90% | 1.11% | 0.56% | 0.31% | 0.69% | 2.39% |
| best+worst of 4, joint, Close call σ<2 | 1.73% | 1.69% | 0.89% | 1.62% | 1.90% | 0.96% | 0.69% | 0.32% | 0.65% | 2.39% |
| best+worst of 4, joint, count +1 per showing | 1.98% | 1.69% | 0.83% | 2.01% | 1.76% | 0.95% | 0.61% | 0.33% | 0.67% | 2.39% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 79.81% | 20.20% | 2.50% | 88.32% | 77.35% |
| best+worst of 4, joint | 40/40 | 77.28% | 22.73% | 1.66% | 88.28% | 85.75% |
| best of 4, joint | 40/40 | 76.41% | 23.59% | 2.53% | 85.33% | 76.36% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 84.55% | 15.46% | 1.41% | 88.28% | 85.88% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 70.86% | 29.14% | 1.79% | 87.64% | 86.22% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 76.95% | 23.05% | 1.65% | 88.22% | 86.46% |

## n = 500, T(noise=1), k = 2.25

40 libraries per row (seed 1), 10000 showings each. 9.9s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2043 | 2587 | 3433 | — (0/40) | 4329 | 4086 | 6866 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 834 | 1058 | 1401 | 4517 | 1580 | 3336 | 5604 | 2.45 | 2.45 | 2.74 |
| best of 4, joint | 1196 | 1505 | 2004 | 6694 | 2431 | 4784 | 8016 | 1.71 | 1.71 | 1.78 |
| best+worst of 4, joint, Close call σ<1 | 834 | 1058 | 1401 | 2087 | 2351 | 3336 | 5604 | 2.45 | 2.45 | 1.84 |
| best+worst of 4, joint, Close call σ<2 | 834 | 1058 | 2137 | 4527 | 1244 | 3336 | 8548 | 2.45 | 1.61 | 3.48 |
| best+worst of 4, joint, count +1 per showing | 837 | 1059 | 1383 | 4437 | 1574 | 3348 | 5532 | 2.44 | 2.48 | 2.75 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.74% | 1.78% | — | 1.48% | 1.09% | 1.87% | 1.51% | 0.87% | 1.34% | 1.87% |
| best+worst of 4, joint | 1.12% | 1.04% | 0.49% | 0.87% | 1.15% | 0.65% | 0.40% | 0.17% | 0.44% | 1.58% |
| best of 4, joint | 1.35% | 1.44% | 0.74% | 1.53% | 1.00% | 1.29% | 0.73% | 0.48% | 0.82% | 1.88% |
| best+worst of 4, joint, Close call σ<1 | 1.12% | 1.04% | 1.00% | 0.87% | 1.15% | 0.84% | 0.39% | 0.15% | 0.46% | 1.58% |
| best+worst of 4, joint, Close call σ<2 | 1.12% | 0.76% | 0.54% | 0.87% | 1.15% | 0.70% | 0.48% | 0.22% | 0.48% | 1.58% |
| best+worst of 4, joint, count +1 per showing | 1.19% | 1.24% | 0.54% | 1.13% | 1.25% | 0.72% | 0.43% | 0.26% | 0.52% | 1.58% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 76.19% | 23.80% | 1.73% | 85.98% | 75.62% |
| best+worst of 4, joint | 40/40 | 73.12% | 26.88% | 1.01% | 87.18% | 84.39% |
| best of 4, joint | 40/40 | 74.62% | 25.38% | 1.32% | 86.72% | 80.70% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 81.62% | 18.38% | 0.94% | 87.17% | 84.50% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 65.89% | 34.12% | 1.17% | 83.73% | 84.14% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 73.41% | 26.59% | 1.12% | 86.94% | 84.05% |

## n = 500, BT(noise=1), k = 2.25

40 libraries per row (seed 1), 10000 showings each. 10.1s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2022 | 2566 | 3421 | — (0/40) | 4332 | 4044 | 6842 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 815 | 1018 | 1342 | 4300 | 1567 | 3260 | 5368 | 2.48 | 2.55 | 2.76 |
| best of 4, joint | 1246 | 1595 | 2144 | 6938 (38/40) | 2477 | 4984 | 8576 | 1.62 | 1.60 | 1.75 |
| best+worst of 4, joint, Close call σ<1 | 815 | 1018 | 1342 | 1964 | 2286 | 3260 | 5368 | 2.48 | 2.55 | 1.90 |
| best+worst of 4, joint, Close call σ<2 | 815 | 1018 | 2016 | 4212 | 1237 | 3260 | 8064 | 2.48 | 1.70 | 3.50 |
| best+worst of 4, joint, count +1 per showing | 809 | 1014 | 1333 | 4187 | 1548 | 3236 | 5332 | 2.50 | 2.57 | 2.80 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.69% | 1.79% | — | 1.55% | 1.29% | 1.71% | 1.46% | 0.79% | 1.27% | 1.81% |
| best+worst of 4, joint | 1.29% | 1.34% | 0.61% | 1.55% | 1.49% | 0.79% | 0.52% | 0.21% | 0.53% | 2.11% |
| best of 4, joint | 2.02% | 2.02% | 1.07% | 2.65% | 1.75% | 1.83% | 1.17% | 0.75% | 1.22% | 2.65% |
| best+worst of 4, joint, Close call σ<1 | 1.29% | 1.36% | 1.17% | 1.55% | 1.49% | 0.97% | 0.47% | 0.19% | 0.55% | 2.11% |
| best+worst of 4, joint, Close call σ<2 | 1.29% | 0.84% | 0.60% | 1.55% | 1.49% | 0.75% | 0.44% | 0.27% | 0.51% | 2.11% |
| best+worst of 4, joint, count +1 per showing | 1.05% | 0.99% | 0.56% | 1.20% | 1.13% | 0.59% | 0.46% | 0.24% | 0.48% | 2.11% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 76.28% | 23.73% | 1.72% | 86.59% | 77.52% |
| best+worst of 4, joint | 40/40 | 74.08% | 25.93% | 1.32% | 87.67% | 85.79% |
| best of 4, joint | 40/40 | 73.35% | 26.65% | 1.85% | 83.31% | 76.39% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 82.17% | 17.84% | 1.17% | 87.69% | 86.20% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 66.88% | 33.12% | 1.47% | 84.61% | 86.25% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 74.33% | 25.66% | 0.94% | 87.55% | 86.17% |

## n = 500, T(noise=1), k = 2.75

40 libraries per row (seed 1), 10000 showings each. 10.4s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2784 | 3572 | 4753 (38/40) | — (0/40) | 4935 | 5568 | 9506 (38/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 1090 | 1381 | 2971 | 6996 (39/40) | 1741 | 4360 | 11884 | 2.55 | 1.60 | 2.83 |
| best of 4, joint | 1565 | 2022 | 3376 | 9664 (23/40) | 2694 | 6260 | 13504 | 1.78 | 1.41 | 1.83 |
| best+worst of 4, joint, Close call σ<1 | 1090 | 1381 | 1874 | 7361 (38/40) | 2610 | 4360 | 7496 | 2.55 | 2.54 | 1.89 |
| best+worst of 4, joint, Close call σ<2 | 1092 | 1754 | 3009 | 6934 (39/40) | 1345 | 4368 | 12036 | 2.55 | 1.58 | 3.67 |
| best+worst of 4, joint, count +1 per showing | 1060 | 1360 | 2911 | 6978 | 1721 | 4240 | 11644 | 2.63 | 1.63 | 2.87 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.82% | 0.81% | — | 1.97% | 0.75% | 0.82% | 0.82% | 0.41% | 0.67% | 1.97% |
| best+worst of 4, joint | 0.36% | 0.31% | 0.14% | 0.36% | 0.36% | 0.37% | 0.12% | 0.05% | 0.19% | 0.94% |
| best of 4, joint | 0.50% | 0.53% | 0.23% | 0.77% | 0.47% | 0.62% | 0.38% | 0.25% | 0.37% | 0.95% |
| best+worst of 4, joint, Close call σ<1 | 0.36% | 0.49% | 0.17% | 0.36% | 0.36% | 0.44% | 0.23% | 0.06% | 0.23% | 0.94% |
| best+worst of 4, joint, Close call σ<2 | 0.37% | 0.30% | 0.22% | 0.36% | 0.36% | 0.34% | 0.22% | 0.09% | 0.20% | 0.94% |
| best+worst of 4, joint, count +1 per showing | 0.49% | 0.28% | 0.17% | 0.55% | 0.47% | 0.25% | 0.18% | 0.11% | 0.20% | 0.94% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 70.69% | 29.30% | 0.84% | 82.97% | 76.44% |
| best+worst of 4, joint | 40/40 | 67.07% | 32.93% | 0.49% | 81.81% | 84.21% |
| best of 4, joint | 40/40 | 68.96% | 31.04% | 0.61% | 82.53% | 80.28% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 77.06% | 22.94% | 0.40% | 85.44% | 84.59% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 58.12% | 41.88% | 0.45% | 81.43% | 84.00% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 67.42% | 32.58% | 0.46% | 81.83% | 83.41% |

## n = 500, BT(noise=1), k = 2.75

40 libraries per row (seed 1), 10000 showings each. 9.9s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2759 | 3524 | 4730 | — (0/40) | 4920 | 5518 | 9460 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 1063 | 1356 | 2705 | 6613 (37/40) | 1730 | 4252 | 10820 | 2.60 | 1.75 | 2.84 |
| best of 4, joint | 1673 | 2162 | 4646 | — (12/40) | 2733 | 6692 | 18584 | 1.65 | 1.02 | 1.80 |
| best+worst of 4, joint, Close call σ<1 | 1063 | 1356 | 1827 | 6925 (39/40) | 2590 | 4252 | 7308 | 2.60 | 2.59 | 1.90 |
| best+worst of 4, joint, Close call σ<2 | 1063 | 1523 | 2894 | 6459 (39/40) | 1338 | 4252 | 11576 | 2.60 | 1.63 | 3.68 |
| best+worst of 4, joint, count +1 per showing | 1047 | 1340 | 2743 | 6476 (39/40) | 1716 | 4188 | 10972 | 2.64 | 1.72 | 2.87 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.75% | 0.79% | — | 0.57% | 0.41% | 0.72% | 0.81% | 0.39% | 0.66% | 0.91% |
| best+worst of 4, joint | 0.61% | 0.43% | 0.22% | 0.58% | 0.50% | 0.48% | 0.24% | 0.10% | 0.26% | 0.96% |
| best of 4, joint | 1.07% | 0.83% | 0.71% | 1.42% | 0.89% | 1.05% | 0.69% | 0.53% | 0.75% | 1.42% |
| best+worst of 4, joint, Close call σ<1 | 0.61% | 0.60% | 0.24% | 0.58% | 0.50% | 0.52% | 0.20% | 0.05% | 0.26% | 0.96% |
| best+worst of 4, joint, Close call σ<2 | 0.61% | 0.31% | 0.19% | 0.58% | 0.50% | 0.33% | 0.21% | 0.09% | 0.22% | 0.96% |
| best+worst of 4, joint, count +1 per showing | 0.53% | 0.40% | 0.17% | 0.46% | 0.52% | 0.33% | 0.26% | 0.12% | 0.24% | 0.96% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 70.72% | 29.29% | 0.81% | 83.36% | 77.77% |
| best+worst of 4, joint | 40/40 | 67.92% | 32.08% | 0.66% | 84.03% | 86.19% |
| best of 4, joint | 40/40 | 67.61% | 32.39% | 1.02% | 76.94% | 75.83% |
| best+worst of 4, joint, Close call σ<1 | 40/40 | 77.75% | 22.25% | 0.53% | 85.98% | 86.15% |
| best+worst of 4, joint, Close call σ<2 | 40/40 | 59.13% | 40.87% | 0.61% | 82.10% | 85.92% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 68.20% | 31.80% | 0.55% | 83.64% | 85.64% |

