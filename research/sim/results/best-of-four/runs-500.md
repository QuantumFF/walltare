# walltare-sim group runs --sizes 500 --voter thurstone,bradley-terry --noise 1.0,0.5 --k 2.5,3 --reps 40 --variant pair,bw4,best4,bw4/seq,bw4/count=show,best4/count=show,bw4/mixed,bw4/u=nolimit,bw4/u=free,bw4/m=2

## n = 500, T(noise=1), k = 2.5

40 libraries per row (seed 1), 10000 showings each. 15.4s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2378 | 3068 | 4080 | — (0/40) | 4631 | 4756 | 8160 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 966 | 1241 | 1702 | 5951 | 1674 | 3864 | 6808 | 2.46 | 2.40 | 2.77 |
| best of 4, joint | 1398 | 1797 | 2351 | 7693 (37/40) | 2576 | 5592 | 9404 | 1.70 | 1.74 | 1.80 |
| best+worst of 4, sequential rate_1vs1 | 717 | 881 | 1092 | 3170 | 1283 | 2868 | 4368 | 3.32 | 3.74 | 3.61 |
| best+worst of 4, joint, count +1 per showing | 950 | 1204 | 1612 | 5744 | 1659 | 3800 | 6448 | 2.50 | 2.53 | 2.79 |
| best of 4, joint, count +1 per showing | 1339 | 1745 | 2383 | 8220 (37/40) | 2586 | 5356 | 9532 | 1.78 | 1.71 | 1.79 |
| best+worst of 4, joint, then pairs | 966 | 1241 | 2516 | — (0/40) | 1674 | 3864 | 10064 | 2.46 | 1.62 | 2.77 |
| best+worst of 4, joint, no per-group Unrated limit | 770 | 998 | 1401 | 5000 | 1493 | 3080 | 5604 | 3.09 | 2.91 | 3.10 |
| best+worst of 4, joint, no Unrated limit or cap | 737 | 963 | 1342 | 4897 | 1470 | 2948 | 5368 | 3.23 | 3.04 | 3.15 |
| best+worst of 4, joint, window 2 | 967 | 1229 | 1650 | 5636 | 1668 | 3868 | 6600 | 2.46 | 2.47 | 2.78 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.18% | 1.39% | — | 1.47% | 0.85% | 1.15% | 1.23% | 0.68% | 1.04% | 1.66% |
| best+worst of 4, joint | 0.65% | 0.64% | 0.30% | 0.51% | 0.65% | 0.44% | 0.32% | 0.17% | 0.33% | 1.20% |
| best of 4, joint | 0.99% | 0.95% | 0.56% | 1.11% | 0.87% | 0.97% | 0.60% | 0.37% | 0.63% | 1.32% |
| best+worst of 4, sequential rate_1vs1 | 1.54% | 2.01% | 1.09% | 1.57% | 2.10% | 1.21% | 0.72% | 0.26% | 0.78% | 2.10% |
| best+worst of 4, joint, count +1 per showing | 0.66% | 0.68% | 0.28% | 0.50% | 0.65% | 0.47% | 0.23% | 0.09% | 0.29% | 1.20% |
| best of 4, joint, count +1 per showing | 0.72% | 0.78% | 0.37% | 0.86% | 0.80% | 0.80% | 0.48% | 0.30% | 0.52% | 1.12% |
| best+worst of 4, joint, then pairs | 0.65% | 0.57% | — | 0.51% | 0.65% | 0.61% | 0.49% | 0.31% | 0.47% | 1.20% |
| best+worst of 4, joint, no per-group Unrated limit | 0.90% | 0.77% | 0.39% | 0.85% | 0.93% | 0.55% | 0.38% | 0.17% | 0.38% | 1.47% |
| best+worst of 4, joint, no Unrated limit or cap | 1.14% | 1.01% | 0.52% | 0.93% | 1.05% | 0.69% | 0.46% | 0.22% | 0.45% | 1.76% |
| best+worst of 4, joint, window 2 | 0.76% | 0.63% | 0.32% | 0.62% | 0.75% | 0.45% | 0.31% | 0.16% | 0.32% | 1.20% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.24% | 26.76% | 1.30% | 84.58% | 75.77% |
| best+worst of 4, joint | 40/40 | 69.83% | 30.17% | 0.72% | 84.45% | 83.33% |
| best of 4, joint | 40/40 | 71.97% | 28.02% | 0.96% | 85.69% | 80.95% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.58% | 24.42% | 1.96% | 77.33% | 78.23% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 70.49% | 29.51% | 0.68% | 85.02% | 84.09% |
| best of 4, joint, count +1 per showing | 40/40 | 72.05% | 27.95% | 0.80% | 85.30% | 80.28% |
| best+worst of 4, joint, then pairs | 40/40 | 69.83% | 30.17% | 0.72% | 83.89% | 80.92% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 71.47% | 28.53% | 0.83% | 83.94% | 80.18% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.09% | 27.91% | 0.97% | 83.31% | 79.41% |
| best+worst of 4, joint, window 2 | 40/40 | 69.94% | 30.05% | 0.75% | 84.53% | 83.86% |

## n = 500, T(noise=0.5), k = 2.5

40 libraries per row (seed 1), 10000 showings each. 15.7s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2101 | 2615 | 3332 | — (2/40) | 4314 | 4202 | 6664 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 749 | 922 | 1159 | 3366 | 1489 | 2996 | 4636 | 2.81 | 2.87 | 2.90 |
| best of 4, joint | 1201 | 1498 | 1921 | 5857 | 2399 | 4804 | 7684 | 1.75 | 1.73 | 1.80 |
| best+worst of 4, sequential rate_1vs1 | 636 | 784 | 941 | 1187 | 1218 | 2544 | 3764 | 3.30 | 3.54 | 3.54 |
| best+worst of 4, joint, count +1 per showing | 760 | 928 | 1169 | 3334 | 1485 | 3040 | 4676 | 2.76 | 2.85 | 2.91 |
| best of 4, joint, count +1 per showing | 985 | 1547 | 1931 | 6184 | 2417 | 3940 | 7724 | 2.13 | 1.73 | 1.78 |
| best+worst of 4, joint, then pairs | 749 | 922 | 1159 | 9503 (28/40) | 1489 | 2996 | 4636 | 2.81 | 2.87 | 2.90 |
| best+worst of 4, joint, no per-group Unrated limit | 609 | 783 | 1027 | 3293 | 1339 | 2436 | 4108 | 3.45 | 3.24 | 3.22 |
| best+worst of 4, joint, no Unrated limit or cap | 617 | 796 | 1034 | 3461 | 1349 | 2468 | 4136 | 3.41 | 3.22 | 3.20 |
| best+worst of 4, joint, window 2 | 752 | 948 | 1181 | 3289 | 1501 | 3008 | 4724 | 2.79 | 2.82 | 2.87 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.08% | 0.09% | 0.00% | 0.09% | 0.05% | 0.08% | 0.07% | 0.03% | 0.06% | 0.14% |
| best+worst of 4, joint | 0.03% | 0.11% | 0.06% | 0.07% | 0.09% | 0.06% | 0.02% | 0.00% | 0.03% | 0.14% |
| best of 4, joint | 0.06% | 0.04% | 0.02% | 0.04% | 0.08% | 0.02% | 0.01% | 0.01% | 0.01% | 0.14% |
| best+worst of 4, sequential rate_1vs1 | 0.29% | 0.34% | 0.25% | 0.27% | 0.34% | 0.10% | 0.08% | 0.02% | 0.06% | 0.36% |
| best+worst of 4, joint, count +1 per showing | 0.04% | 0.04% | 0.03% | 0.03% | 0.06% | 0.05% | 0.01% | 0.01% | 0.02% | 0.14% |
| best of 4, joint, count +1 per showing | 0.16% | 0.11% | 0.06% | 0.06% | 0.15% | 0.06% | 0.03% | 0.01% | 0.04% | 0.16% |
| best+worst of 4, joint, then pairs | 0.03% | 0.11% | 0.04% | 0.07% | 0.09% | 0.08% | 0.06% | 0.02% | 0.06% | 0.14% |
| best+worst of 4, joint, no per-group Unrated limit | 0.10% | 0.10% | 0.02% | 0.12% | 0.10% | 0.03% | 0.01% | 0.00% | 0.02% | 0.27% |
| best+worst of 4, joint, no Unrated limit or cap | 0.08% | 0.06% | 0.01% | 0.11% | 0.05% | 0.03% | 0.01% | 0.00% | 0.01% | 0.26% |
| best+worst of 4, joint, window 2 | 0.15% | 0.08% | 0.03% | 0.13% | 0.11% | 0.04% | 0.02% | 0.01% | 0.02% | 0.16% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 77.65% | 22.35% | 0.08% | 95.69% | 95.11% |
| best+worst of 4, joint | 40/40 | 77.59% | 22.41% | 0.10% | 95.36% | 95.47% |
| best of 4, joint | 40/40 | 76.80% | 23.20% | 0.03% | 95.36% | 94.49% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 80.29% | 19.71% | 0.31% | 89.11% | 90.55% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 77.71% | 22.29% | 0.06% | 95.28% | 95.69% |
| best of 4, joint, count +1 per showing | 40/40 | 76.72% | 23.28% | 0.06% | 94.73% | 94.05% |
| best+worst of 4, joint, then pairs | 40/40 | 77.59% | 22.41% | 0.10% | 95.36% | 94.75% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 77.56% | 22.43% | 0.09% | 95.28% | 95.67% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 77.38% | 22.62% | 0.06% | 95.27% | 95.85% |
| best+worst of 4, joint, window 2 | 40/40 | 77.84% | 22.16% | 0.07% | 95.16% | 96.03% |

## n = 500, BT(noise=1), k = 2.5

40 libraries per row (seed 1), 10000 showings each. 16.2s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2414 | 3028 | 4092 | — (0/40) | 4673 | 4828 | 8184 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 930 | 1182 | 1588 | 5244 | 1647 | 3720 | 6352 | 2.60 | 2.58 | 2.84 |
| best of 4, joint | 1425 | 1870 | 2553 | 8893 (27/40) | 2621 | 5700 | 10212 | 1.69 | 1.60 | 1.78 |
| best+worst of 4, sequential rate_1vs1 | 689 | 859 | 1049 | 3103 | 1265 | 2756 | 4196 | 3.50 | 3.90 | 3.69 |
| best+worst of 4, joint, count +1 per showing | 919 | 1169 | 1545 | 5603 | 1629 | 3676 | 6180 | 2.63 | 2.65 | 2.87 |
| best of 4, joint, count +1 per showing | 1415 | 1867 | 2572 | 9175 (28/40) | 2640 | 5660 | 10288 | 1.71 | 1.59 | 1.77 |
| best+worst of 4, joint, then pairs | 930 | 1182 | 1588 | — (0/40) | 1647 | 3720 | 6352 | 2.60 | 2.58 | 2.84 |
| best+worst of 4, joint, no per-group Unrated limit | 754 | 974 | 1332 | 4642 | 1476 | 3016 | 5328 | 3.20 | 3.07 | 3.17 |
| best+worst of 4, joint, no Unrated limit or cap | 732 | 966 | 1314 | 4633 | 1468 | 2928 | 5256 | 3.30 | 3.11 | 3.18 |
| best+worst of 4, joint, window 2 | 948 | 1186 | 1586 | 5488 | 1655 | 3792 | 6344 | 2.55 | 2.58 | 2.82 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.04% | 1.13% | — | 0.87% | 0.84% | 1.06% | 1.05% | 0.54% | 0.87% | 1.55% |
| best+worst of 4, joint | 1.03% | 0.81% | 0.27% | 1.06% | 1.06% | 0.48% | 0.23% | 0.10% | 0.30% | 1.48% |
| best of 4, joint | 1.26% | 1.31% | 0.69% | 1.86% | 1.14% | 1.36% | 0.94% | 0.57% | 0.91% | 2.23% |
| best+worst of 4, sequential rate_1vs1 | 1.97% | 2.22% | 1.19% | 2.09% | 2.28% | 1.18% | 0.61% | 0.21% | 0.70% | 2.54% |
| best+worst of 4, joint, count +1 per showing | 0.90% | 0.81% | 0.33% | 0.93% | 0.91% | 0.52% | 0.32% | 0.14% | 0.36% | 1.43% |
| best of 4, joint, count +1 per showing | 1.47% | 1.42% | 0.89% | 1.66% | 1.55% | 1.44% | 1.09% | 0.73% | 1.08% | 2.11% |
| best+worst of 4, joint, then pairs | 1.03% | 0.79% | — | 1.06% | 1.06% | 0.66% | 0.43% | 0.29% | 0.48% | 1.48% |
| best+worst of 4, joint, no per-group Unrated limit | 1.14% | 0.99% | 0.42% | 1.05% | 1.06% | 0.55% | 0.35% | 0.14% | 0.38% | 2.48% |
| best+worst of 4, joint, no Unrated limit or cap | 1.15% | 1.04% | 0.43% | 0.94% | 1.06% | 0.62% | 0.39% | 0.19% | 0.43% | 2.49% |
| best+worst of 4, joint, window 2 | 0.89% | 0.70% | 0.26% | 1.04% | 0.84% | 0.44% | 0.25% | 0.10% | 0.29% | 1.43% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.28% | 26.71% | 1.13% | 85.53% | 78.08% |
| best+worst of 4, joint | 40/40 | 71.14% | 28.86% | 0.82% | 85.88% | 86.27% |
| best of 4, joint | 40/40 | 70.63% | 29.37% | 1.36% | 81.39% | 76.09% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 76.06% | 23.95% | 2.29% | 76.83% | 80.42% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 71.17% | 28.84% | 0.83% | 86.14% | 85.67% |
| best of 4, joint, count +1 per showing | 40/40 | 70.38% | 29.62% | 1.53% | 81.16% | 75.84% |
| best+worst of 4, joint, then pairs | 40/40 | 71.14% | 28.86% | 0.82% | 85.72% | 82.88% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.67% | 27.33% | 0.97% | 84.70% | 81.95% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.66% | 27.34% | 1.04% | 83.94% | 81.45% |
| best+worst of 4, joint, window 2 | 40/40 | 70.86% | 29.14% | 0.83% | 85.82% | 86.70% |

## n = 500, BT(noise=0.5), k = 2.5

40 libraries per row (seed 1), 10000 showings each. 16.4s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2096 | 2597 | 3361 | — (1/40) | 4331 | 4192 | 6722 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 745 | 931 | 1174 | 3314 | 1491 | 2980 | 4696 | 2.81 | 2.86 | 2.90 |
| best of 4, joint | 1263 | 1549 | 2002 | 6042 | 2425 | 5052 | 8008 | 1.66 | 1.68 | 1.79 |
| best+worst of 4, sequential rate_1vs1 | 631 | 777 | 935 | 1182 | 1222 | 2524 | 3740 | 3.32 | 3.59 | 3.54 |
| best+worst of 4, joint, count +1 per showing | 759 | 927 | 1169 | 3408 | 1490 | 3036 | 4676 | 2.76 | 2.88 | 2.91 |
| best of 4, joint, count +1 per showing | 1013 | 1573 | 1989 | 6559 | 2440 | 4052 | 7956 | 2.07 | 1.69 | 1.77 |
| best+worst of 4, joint, then pairs | 745 | 931 | 1174 | 9582 (26/40) | 1491 | 2980 | 4696 | 2.81 | 2.86 | 2.90 |
| best+worst of 4, joint, no per-group Unrated limit | 619 | 792 | 1024 | 3296 | 1346 | 2476 | 4096 | 3.39 | 3.28 | 3.22 |
| best+worst of 4, joint, no Unrated limit or cap | 617 | 781 | 1007 | 3226 | 1339 | 2468 | 4028 | 3.40 | 3.34 | 3.23 |
| best+worst of 4, joint, window 2 | 754 | 928 | 1164 | 3318 | 1489 | 3016 | 4656 | 2.78 | 2.89 | 2.91 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.08% | 0.13% | 0.00% | 0.10% | 0.13% | 0.11% | 0.08% | 0.03% | 0.08% | 0.18% |
| best+worst of 4, joint | 0.11% | 0.09% | 0.03% | 0.12% | 0.08% | 0.04% | 0.02% | 0.01% | 0.02% | 0.28% |
| best of 4, joint | 0.18% | 0.14% | 0.03% | 0.20% | 0.21% | 0.11% | 0.05% | 0.02% | 0.06% | 0.31% |
| best+worst of 4, sequential rate_1vs1 | 0.41% | 0.39% | 0.25% | 0.39% | 0.33% | 0.09% | 0.03% | 0.01% | 0.06% | 0.48% |
| best+worst of 4, joint, count +1 per showing | 0.17% | 0.12% | 0.03% | 0.10% | 0.12% | 0.03% | 0.01% | 0.00% | 0.02% | 0.25% |
| best of 4, joint, count +1 per showing | 0.34% | 0.16% | 0.04% | 0.14% | 0.29% | 0.14% | 0.06% | 0.02% | 0.08% | 0.35% |
| best+worst of 4, joint, then pairs | 0.11% | 0.09% | 0.03% | 0.12% | 0.08% | 0.04% | 0.03% | 0.02% | 0.03% | 0.28% |
| best+worst of 4, joint, no per-group Unrated limit | 0.18% | 0.11% | 0.02% | 0.19% | 0.12% | 0.02% | 0.02% | 0.01% | 0.02% | 0.70% |
| best+worst of 4, joint, no Unrated limit or cap | 0.11% | 0.13% | 0.01% | 0.12% | 0.10% | 0.03% | 0.02% | 0.01% | 0.02% | 1.04% |
| best+worst of 4, joint, window 2 | 0.08% | 0.06% | 0.03% | 0.09% | 0.08% | 0.06% | 0.01% | 0.00% | 0.02% | 0.28% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 77.54% | 22.46% | 0.11% | 95.77% | 95.47% |
| best+worst of 4, joint | 40/40 | 77.92% | 22.08% | 0.06% | 95.14% | 96.20% |
| best of 4, joint | 40/40 | 75.58% | 24.42% | 0.12% | 94.02% | 92.26% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 80.58% | 19.43% | 0.30% | 89.08% | 92.09% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 77.64% | 22.36% | 0.10% | 94.92% | 96.38% |
| best of 4, joint, count +1 per showing | 40/40 | 75.91% | 24.09% | 0.14% | 93.76% | 92.36% |
| best+worst of 4, joint, then pairs | 40/40 | 77.92% | 22.08% | 0.06% | 95.14% | 95.47% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 77.96% | 22.04% | 0.11% | 95.11% | 96.39% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 77.94% | 22.05% | 0.11% | 95.31% | 96.72% |
| best+worst of 4, joint, window 2 | 40/40 | 78.08% | 21.91% | 0.08% | 95.20% | 96.08% |

## n = 500, T(noise=1), k = 3

40 libraries per row (seed 1), 10000 showings each. 16.7s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 3191 | 4096 | — (18/40) | — (0/40) | 5196 | 6382 | — (18/40) | 1.00 | — | 1.00 |
| best+worst of 4, joint | 1204 | 1549 | 3544 | 8633 (32/40) | 1791 | 4816 | 14176 | 2.65 | — | 2.90 |
| best of 4, joint | 1770 | 2248 | 5065 | — (4/40) | 2796 | 7080 | 20260 | 1.80 | — | 1.86 |
| best+worst of 4, sequential rate_1vs1 | 866 | 1064 | 1370 | 5104 | 1381 | 3464 | 5480 | 3.68 | — | 3.76 |
| best+worst of 4, joint, count +1 per showing | 1211 | 1549 | 3542 | 8259 (30/40) | 1789 | 4844 | 14168 | 2.64 | — | 2.90 |
| best of 4, joint, count +1 per showing | 1770 | 2307 | 5318 | — (2/40) | 2834 | 7080 | 21272 | 1.80 | — | 1.83 |
| best+worst of 4, joint, then pairs | 1204 | 1549 | 8797 (31/40) | — (0/40) | 1791 | 4816 | 35188 (31/40) | 2.65 | — | 2.90 |
| best+worst of 4, joint, no per-group Unrated limit | 1032 | 1340 | 3101 | 7611 (39/40) | 1643 | 4128 | 12404 | 3.09 | — | 3.16 |
| best+worst of 4, joint, no Unrated limit or cap | 997 | 1307 | 3116 | 7246 (38/40) | 1633 | 3988 | 12464 | 3.20 | — | 3.18 |
| best+worst of 4, joint, window 2 | 1218 | 1573 | 3522 | 8385 (30/40) | 1806 | 4872 | 14088 | 2.62 | — | 2.88 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.67% | 0.38% | — | 0.66% | 0.48% | 0.70% | 0.69% | 0.34% | 0.51% | 0.74% |
| best+worst of 4, joint | 0.32% | 0.19% | 0.13% | 0.17% | 0.31% | 0.28% | 0.20% | 0.06% | 0.17% | 0.62% |
| best of 4, joint | 0.51% | 0.36% | 0.19% | 0.42% | 0.39% | 0.47% | 0.35% | 0.25% | 0.35% | 0.67% |
| best+worst of 4, sequential rate_1vs1 | 1.00% | 1.08% | 0.55% | 0.89% | 1.14% | 0.84% | 0.53% | 0.15% | 0.49% | 1.29% |
| best+worst of 4, joint, count +1 per showing | 0.47% | 0.23% | 0.19% | 0.15% | 0.37% | 0.28% | 0.21% | 0.09% | 0.21% | 0.62% |
| best of 4, joint, count +1 per showing | 0.38% | 0.30% | 0.00% | 0.35% | 0.48% | 0.35% | 0.30% | 0.17% | 0.28% | 0.58% |
| best+worst of 4, joint, then pairs | 0.32% | 0.24% | — | 0.17% | 0.31% | 0.32% | 0.25% | 0.19% | 0.25% | 0.62% |
| best+worst of 4, joint, no per-group Unrated limit | 0.49% | 0.37% | 0.24% | 0.45% | 0.47% | 0.36% | 0.24% | 0.13% | 0.27% | 0.53% |
| best+worst of 4, joint, no Unrated limit or cap | 0.45% | 0.25% | 0.24% | 0.37% | 0.46% | 0.32% | 0.26% | 0.12% | 0.26% | 0.72% |
| best+worst of 4, joint, window 2 | 0.35% | 0.21% | 0.06% | 0.22% | 0.27% | 0.21% | 0.17% | 0.07% | 0.14% | 0.62% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 67.73% | 32.27% | 0.64% | 76.47% | 75.69% |
| best+worst of 4, joint | 40/40 | 64.44% | 35.56% | 0.34% | 80.92% | 83.52% |
| best of 4, joint | 40/40 | 66.16% | 33.84% | 0.55% | 79.89% | 79.94% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 69.92% | 30.07% | 1.26% | 71.92% | 77.75% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 64.67% | 35.34% | 0.44% | 80.81% | 83.89% |
| best of 4, joint, count +1 per showing | 40/40 | 66.41% | 33.59% | 0.41% | 79.78% | 80.53% |
| best+worst of 4, joint, then pairs | 40/40 | 64.44% | 35.56% | 0.34% | 80.31% | 80.57% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 66.17% | 33.83% | 0.51% | 77.80% | 80.02% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 66.51% | 33.49% | 0.53% | 78.34% | 79.89% |
| best+worst of 4, joint, window 2 | 40/40 | 64.11% | 35.90% | 0.30% | 80.94% | 83.88% |

## n = 500, T(noise=0.5), k = 3

40 libraries per row (seed 1), 10000 showings each. 16.2s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2741 | 3462 | 4564 | — (0/40) | 4893 | 5482 | 9128 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 926 | 1144 | 1489 | 4923 | 1637 | 3704 | 5956 | 2.96 | 3.07 | 2.99 |
| best of 4, joint | 1531 | 1911 | 2488 | 8553 (36/40) | 2633 | 6124 | 9952 | 1.79 | 1.83 | 1.86 |
| best+worst of 4, sequential rate_1vs1 | 738 | 914 | 1132 | 3196 | 1320 | 2952 | 4528 | 3.71 | 4.03 | 3.71 |
| best+worst of 4, joint, count +1 per showing | 940 | 1160 | 1501 | 4870 | 1632 | 3760 | 6004 | 2.92 | 3.04 | 3.00 |
| best of 4, joint, count +1 per showing | 1405 | 1887 | 2454 | 9013 (36/40) | 2624 | 5620 | 9816 | 1.95 | 1.86 | 1.86 |
| best+worst of 4, joint, then pairs | 926 | 1144 | 1489 | — (1/40) | 1637 | 3704 | 5956 | 2.96 | 3.07 | 2.99 |
| best+worst of 4, joint, no per-group Unrated limit | 806 | 1023 | 1361 | 4702 | 1506 | 3224 | 5444 | 3.40 | 3.35 | 3.25 |
| best+worst of 4, joint, no Unrated limit or cap | 798 | 1025 | 1368 | 4786 | 1501 | 3192 | 5472 | 3.43 | 3.34 | 3.26 |
| best+worst of 4, joint, window 2 | 929 | 1163 | 1493 | 4809 | 1637 | 3716 | 5972 | 2.95 | 3.06 | 2.99 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.02% | 0.01% | — | 0.00% | 0.00% | 0.02% | 0.01% | 0.01% | 0.01% | 0.05% |
| best+worst of 4, joint | 0.02% | 0.03% | 0.00% | 0.02% | 0.02% | 0.01% | 0.00% | 0.00% | 0.00% | 0.03% |
| best of 4, joint | 0.01% | 0.01% | 0.00% | 0.03% | 0.03% | 0.01% | 0.01% | 0.01% | 0.01% | 0.05% |
| best+worst of 4, sequential rate_1vs1 | 0.11% | 0.08% | 0.05% | 0.09% | 0.08% | 0.06% | 0.01% | 0.01% | 0.02% | 0.18% |
| best+worst of 4, joint, count +1 per showing | 0.01% | 0.02% | 0.00% | 0.00% | 0.01% | 0.01% | 0.00% | 0.00% | 0.00% | 0.02% |
| best of 4, joint, count +1 per showing | 0.08% | 0.04% | 0.01% | 0.00% | 0.08% | 0.04% | 0.01% | 0.01% | 0.02% | 0.09% |
| best+worst of 4, joint, then pairs | 0.02% | 0.03% | 0.00% | 0.02% | 0.02% | 0.02% | 0.01% | 0.01% | 0.01% | 0.03% |
| best+worst of 4, joint, no per-group Unrated limit | 0.04% | 0.01% | 0.02% | 0.02% | 0.02% | 0.01% | 0.02% | 0.01% | 0.01% | 0.04% |
| best+worst of 4, joint, no Unrated limit or cap | 0.02% | 0.03% | 0.00% | 0.00% | 0.03% | 0.00% | 0.00% | 0.00% | 0.00% | 0.03% |
| best+worst of 4, joint, window 2 | 0.02% | 0.02% | 0.01% | 0.02% | 0.02% | 0.01% | 0.01% | 0.00% | 0.01% | 0.04% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 72.00% | 28.00% | 0.01% | 95.19% | 94.92% |
| best+worst of 4, joint | 40/40 | 72.83% | 27.17% | 0.03% | 94.71% | 95.50% |
| best of 4, joint | 40/40 | 71.76% | 28.24% | 0.01% | 94.64% | 94.39% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.78% | 24.23% | 0.09% | 88.05% | 91.19% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 72.48% | 27.52% | 0.02% | 95.24% | 95.42% |
| best of 4, joint, count +1 per showing | 40/40 | 72.09% | 27.91% | 0.03% | 94.22% | 93.83% |
| best+worst of 4, joint, then pairs | 40/40 | 72.83% | 27.17% | 0.03% | 94.71% | 94.78% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.62% | 27.38% | 0.01% | 95.09% | 96.00% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.45% | 27.55% | 0.02% | 95.07% | 95.91% |
| best+worst of 4, joint, window 2 | 40/40 | 72.69% | 27.30% | 0.02% | 95.11% | 95.85% |

## n = 500, BT(noise=1), k = 3

40 libraries per row (seed 1), 10000 showings each. 16.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 3174 | 4093 | 9860 (23/40) | — (0/40) | 5195 | 6348 | 19720 (23/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 1168 | 1514 | 3405 | 8170 (32/40) | 1787 | 4672 | 13620 | 2.72 | 2.90 | 2.91 |
| best of 4, joint | 1885 | 2458 | 5344 | — (1/40) | 2825 | 7540 | 21376 | 1.68 | 1.85 | 1.84 |
| best+worst of 4, sequential rate_1vs1 | 841 | 1037 | 1313 | 4654 | 1368 | 3364 | 5252 | 3.77 | 7.51 | 3.80 |
| best+worst of 4, joint, count +1 per showing | 1163 | 1508 | 3257 | 7478 (36/40) | 1774 | 4652 | 13028 | 2.73 | 3.03 | 2.93 |
| best of 4, joint, count +1 per showing | 1850 | 2411 | 5803 | — (0/40) | 2862 | 7400 | 23212 | 1.72 | 1.70 | 1.82 |
| best+worst of 4, joint, then pairs | 1168 | 1514 | 8326 (37/40) | — (0/40) | 1787 | 4672 | 33304 (37/40) | 2.72 | 1.18 | 2.91 |
| best+worst of 4, joint, no per-group Unrated limit | 985 | 1319 | 3064 | 6908 (39/40) | 1634 | 3940 | 12256 | 3.22 | 3.22 | 3.18 |
| best+worst of 4, joint, no Unrated limit or cap | 960 | 1264 | 2876 | 6945 | 1611 | 3840 | 11504 | 3.31 | 3.43 | 3.22 |
| best+worst of 4, joint, window 2 | 1164 | 1505 | 3349 | 7829 (31/40) | 1786 | 4656 | 13396 | 2.73 | 2.94 | 2.91 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.58% | 0.43% | — | 0.71% | 0.25% | 0.42% | 0.56% | 0.32% | 0.44% | 0.57% |
| best+worst of 4, joint | 0.37% | 0.14% | 0.09% | 0.35% | 0.34% | 0.19% | 0.14% | 0.04% | 0.13% | 0.59% |
| best of 4, joint | 0.81% | 0.54% | 0.75% | 0.91% | 0.61% | 0.77% | 0.56% | 0.32% | 0.52% | 1.00% |
| best+worst of 4, sequential rate_1vs1 | 1.23% | 1.27% | 0.52% | 1.20% | 1.35% | 0.75% | 0.42% | 0.10% | 0.43% | 1.92% |
| best+worst of 4, joint, count +1 per showing | 0.40% | 0.24% | 0.10% | 0.37% | 0.30% | 0.25% | 0.16% | 0.06% | 0.15% | 0.61% |
| best of 4, joint, count +1 per showing | 0.63% | 0.51% | — | 0.77% | 0.78% | 0.72% | 0.55% | 0.31% | 0.48% | 1.12% |
| best+worst of 4, joint, then pairs | 0.37% | 0.19% | — | 0.35% | 0.34% | 0.31% | 0.21% | 0.18% | 0.25% | 0.59% |
| best+worst of 4, joint, no per-group Unrated limit | 0.45% | 0.31% | 0.12% | 0.50% | 0.44% | 0.32% | 0.16% | 0.05% | 0.17% | 0.96% |
| best+worst of 4, joint, no Unrated limit or cap | 0.58% | 0.33% | 0.17% | 0.51% | 0.52% | 0.35% | 0.27% | 0.09% | 0.24% | 0.72% |
| best+worst of 4, joint, window 2 | 0.50% | 0.23% | 0.14% | 0.73% | 0.43% | 0.28% | 0.19% | 0.05% | 0.18% | 0.73% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 68.00% | 32.00% | 0.56% | 79.18% | 77.47% |
| best+worst of 4, joint | 40/40 | 65.06% | 34.94% | 0.35% | 82.41% | 85.60% |
| best of 4, joint | 40/40 | 64.44% | 35.56% | 0.70% | 76.00% | 76.19% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 71.14% | 28.86% | 1.36% | 73.39% | 79.70% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 65.43% | 34.57% | 0.34% | 82.05% | 85.33% |
| best of 4, joint, count +1 per showing | 40/40 | 64.61% | 35.40% | 0.66% | 75.11% | 75.64% |
| best+worst of 4, joint, then pairs | 40/40 | 65.06% | 34.94% | 0.35% | 82.61% | 82.43% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 66.62% | 33.38% | 0.43% | 79.89% | 82.62% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 67.50% | 32.51% | 0.56% | 78.33% | 81.44% |
| best+worst of 4, joint, window 2 | 40/40 | 65.83% | 34.17% | 0.49% | 81.69% | 85.64% |

## n = 500, BT(noise=0.5), k = 3

40 libraries per row (seed 1), 10000 showings each. 15.9s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 2757 | 3498 | 4614 | — (0/40) | 4912 | 5514 | 9228 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 923 | 1144 | 1481 | 4707 | 1641 | 3692 | 5924 | 2.99 | 3.12 | 2.99 |
| best of 4, joint | 1556 | 1945 | 2531 | 9478 (25/40) | 2650 | 6224 | 10124 | 1.77 | 1.82 | 1.85 |
| best+worst of 4, sequential rate_1vs1 | 739 | 904 | 1115 | 3177 | 1305 | 2956 | 4460 | 3.73 | 4.14 | 3.76 |
| best+worst of 4, joint, count +1 per showing | 935 | 1154 | 1477 | 4713 | 1624 | 3740 | 5908 | 2.95 | 3.12 | 3.02 |
| best of 4, joint, count +1 per showing | 1490 | 1955 | 2575 | 9210 (29/40) | 2669 | 5960 | 10300 | 1.85 | 1.79 | 1.84 |
| best+worst of 4, joint, then pairs | 923 | 1144 | 1481 | — (0/40) | 1641 | 3692 | 5924 | 2.99 | 3.12 | 2.99 |
| best+worst of 4, joint, no per-group Unrated limit | 801 | 1037 | 1353 | 4767 | 1500 | 3204 | 5412 | 3.44 | 3.41 | 3.27 |
| best+worst of 4, joint, no Unrated limit or cap | 791 | 1019 | 1340 | 4638 | 1493 | 3164 | 5360 | 3.49 | 3.44 | 3.29 |
| best+worst of 4, joint, window 2 | 913 | 1139 | 1461 | 4713 | 1632 | 3652 | 5844 | 3.02 | 3.16 | 3.01 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @500 | @1000 | @2500 | @5000 | @10000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.01% | 0.01% | — | 0.00% | 0.06% | 0.01% | 0.01% | 0.01% | 0.01% | 0.06% |
| best+worst of 4, joint | 0.05% | 0.01% | 0.01% | 0.04% | 0.03% | 0.00% | 0.00% | 0.00% | 0.00% | 0.13% |
| best of 4, joint | 0.05% | 0.05% | 0.01% | 0.09% | 0.03% | 0.05% | 0.03% | 0.00% | 0.02% | 0.11% |
| best+worst of 4, sequential rate_1vs1 | 0.10% | 0.11% | 0.03% | 0.11% | 0.09% | 0.05% | 0.01% | 0.00% | 0.02% | 0.34% |
| best+worst of 4, joint, count +1 per showing | 0.04% | 0.03% | 0.00% | 0.02% | 0.03% | 0.01% | 0.00% | 0.00% | 0.00% | 0.13% |
| best of 4, joint, count +1 per showing | 0.06% | 0.05% | 0.02% | 0.05% | 0.14% | 0.05% | 0.02% | 0.02% | 0.03% | 0.14% |
| best+worst of 4, joint, then pairs | 0.05% | 0.01% | — | 0.04% | 0.03% | 0.01% | 0.01% | 0.00% | 0.01% | 0.13% |
| best+worst of 4, joint, no per-group Unrated limit | 0.05% | 0.01% | 0.00% | 0.02% | 0.02% | 0.01% | 0.00% | 0.00% | 0.00% | 0.14% |
| best+worst of 4, joint, no Unrated limit or cap | 0.02% | 0.01% | 0.01% | 0.02% | 0.03% | 0.01% | 0.00% | 0.00% | 0.00% | 0.05% |
| best+worst of 4, joint, window 2 | 0.01% | 0.03% | 0.00% | 0.07% | 0.02% | 0.01% | 0.00% | 0.00% | 0.00% | 0.13% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 72.06% | 27.93% | 0.01% | 95.17% | 95.23% |
| best+worst of 4, joint | 40/40 | 72.91% | 27.09% | 0.01% | 95.08% | 96.47% |
| best of 4, joint | 40/40 | 70.52% | 29.48% | 0.06% | 92.97% | 92.26% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.73% | 24.27% | 0.15% | 88.23% | 92.17% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 73.03% | 26.96% | 0.02% | 94.72% | 96.05% |
| best of 4, joint, count +1 per showing | 40/40 | 70.93% | 29.07% | 0.06% | 92.95% | 92.34% |
| best+worst of 4, joint, then pairs | 40/40 | 72.91% | 27.09% | 0.01% | 95.08% | 95.67% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.88% | 27.12% | 0.01% | 94.78% | 96.42% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.67% | 27.33% | 0.01% | 94.81% | 96.38% |
| best+worst of 4, joint, window 2 | 40/40 | 72.90% | 27.10% | 0.03% | 94.78% | 96.53% |

