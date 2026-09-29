# walltare-sim group runs --sizes 200 --voter thurstone,bradley-terry --noise 1.0,0.5 --k 2.5,3 --reps 40 --variant pair,bw4,best4,bw4/seq,bw4/count=show,best4/count=show,bw4/mixed,bw4/u=nolimit,bw4/u=free,bw4/m=2

## n = 200, T(noise=1), k = 2.5

40 libraries per row (seed 1), 4000 showings each. 3.6s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 947 | 1225 | 1627 (39/40) | — (0/40) | 1872 | 1894 | 3254 (39/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 377 | 470 | 656 | 2071 | 667 | 1508 | 2624 | 2.51 | 2.48 | 2.81 |
| best of 4, joint | 561 | 717 | 975 | 3013 (34/40) | 1043 | 2244 | 3900 | 1.69 | 1.67 | 1.79 |
| best+worst of 4, sequential rate_1vs1 | 280 | 349 | 445 | 1266 | 511 | 1120 | 1780 | 3.38 | 3.66 | 3.66 |
| best+worst of 4, joint, count +1 per showing | 385 | 484 | 640 | 2177 | 668 | 1540 | 2560 | 2.46 | 2.54 | 2.80 |
| best of 4, joint, count +1 per showing | 522 | 729 | 985 | 3349 (34/40) | 1044 | 2088 | 3940 | 1.81 | 1.65 | 1.79 |
| best+worst of 4, joint, then pairs | 377 | 470 | 656 (39/40) | — (3/40) | 667 | 1508 | 2624 (39/40) | 2.51 | 2.48 | 2.81 |
| best+worst of 4, joint, no per-group Unrated limit | 302 | 397 | 560 | 1877 | 602 | 1208 | 2240 | 3.14 | 2.91 | 3.11 |
| best+worst of 4, joint, no Unrated limit or cap | 294 | 391 | 541 | 2032 | 596 | 1176 | 2164 | 3.22 | 3.01 | 3.14 |
| best+worst of 4, joint, window 2 | 385 | 486 | 668 | 2416 (38/40) | 668 | 1540 | 2672 | 2.46 | 2.44 | 2.80 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1.40% | 1.32% | — | 0.93% | 0.84% | 1.31% | 1.18% | 0.69% | 1.00% | 1.42% |
| best+worst of 4, joint | 0.82% | 0.86% | 0.47% | 0.41% | 0.91% | 0.67% | 0.43% | 0.24% | 0.45% | 0.99% |
| best of 4, joint | 0.65% | 0.75% | 0.50% | 0.95% | 0.44% | 0.75% | 0.58% | 0.42% | 0.52% | 0.98% |
| best+worst of 4, sequential rate_1vs1 | 1.77% | 1.78% | 0.97% | 1.55% | 1.82% | 1.14% | 0.65% | 0.19% | 0.69% | 2.42% |
| best+worst of 4, joint, count +1 per showing | 0.92% | 0.82% | 0.44% | 0.69% | 0.88% | 0.66% | 0.38% | 0.14% | 0.40% | 0.97% |
| best of 4, joint, count +1 per showing | 0.87% | 0.70% | 0.46% | 0.64% | 0.82% | 0.64% | 0.48% | 0.31% | 0.49% | 1.29% |
| best+worst of 4, joint, then pairs | 0.82% | 0.77% | 0.42% | 0.41% | 0.91% | 0.84% | 0.62% | 0.43% | 0.64% | 0.99% |
| best+worst of 4, joint, no per-group Unrated limit | 0.92% | 0.79% | 0.45% | 0.81% | 0.88% | 0.55% | 0.42% | 0.27% | 0.43% | 1.32% |
| best+worst of 4, joint, no Unrated limit or cap | 1.10% | 0.73% | 0.36% | 1.10% | 0.98% | 0.52% | 0.32% | 0.09% | 0.35% | 1.21% |
| best+worst of 4, joint, window 2 | 0.80% | 0.71% | 0.46% | 0.69% | 0.80% | 0.63% | 0.40% | 0.17% | 0.43% | 1.20% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.10% | 26.90% | 1.25% | 84.21% | 76.09% |
| best+worst of 4, joint | 40/40 | 70.22% | 29.77% | 0.94% | 84.79% | 83.10% |
| best of 4, joint | 40/40 | 71.19% | 28.81% | 0.76% | 84.41% | 80.53% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 74.66% | 25.34% | 1.82% | 76.46% | 77.17% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 70.01% | 29.99% | 0.89% | 85.33% | 82.59% |
| best of 4, joint, count +1 per showing | 40/40 | 71.39% | 28.61% | 0.67% | 85.61% | 79.81% |
| best+worst of 4, joint, then pairs | 40/40 | 70.22% | 29.77% | 0.94% | 84.41% | 80.12% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 71.94% | 28.06% | 0.75% | 82.84% | 77.90% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 71.60% | 28.40% | 0.80% | 83.20% | 78.78% |
| best+worst of 4, joint, window 2 | 40/40 | 69.38% | 30.62% | 0.81% | 84.12% | 83.31% |

## n = 200, T(noise=0.5), k = 2.5

40 libraries per row (seed 1), 4000 showings each. 3.5s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 840 | 1040 | 1366 | — (9/40) | 1752 | 1680 | 2732 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 299 | 366 | 471 | 1266 | 603 | 1196 | 1884 | 2.81 | 2.90 | 2.91 |
| best of 4, joint | 478 | 599 | 787 | 2343 | 969 | 1912 | 3148 | 1.76 | 1.74 | 1.81 |
| best+worst of 4, sequential rate_1vs1 | 250 | 310 | 374 | 478 | 486 | 1000 | 1496 | 3.36 | 3.65 | 3.60 |
| best+worst of 4, joint, count +1 per showing | 297 | 366 | 473 | 1329 | 600 | 1188 | 1892 | 2.83 | 2.89 | 2.92 |
| best of 4, joint, count +1 per showing | 382 | 610 | 769 | 2365 | 976 | 1528 | 3076 | 2.20 | 1.78 | 1.80 |
| best+worst of 4, joint, then pairs | 299 | 366 | 471 | 3418 (30/40) | 603 | 1196 | 1884 | 2.81 | 2.90 | 2.91 |
| best+worst of 4, joint, no per-group Unrated limit | 253 | 322 | 416 | 1238 | 548 | 1012 | 1664 | 3.32 | 3.28 | 3.20 |
| best+worst of 4, joint, no Unrated limit or cap | 251 | 317 | 407 | 1246 | 543 | 1004 | 1628 | 3.35 | 3.36 | 3.23 |
| best+worst of 4, joint, window 2 | 294 | 364 | 458 | 1303 | 608 | 1176 | 1832 | 2.86 | 2.98 | 2.88 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.10% | 0.11% | 0.07% | 0.00% | 0.13% | 0.13% | 0.03% | 0.00% | 0.05% | 0.17% |
| best+worst of 4, joint | 0.00% | 0.04% | 0.00% | 0.04% | 0.02% | 0.05% | 0.01% | 0.00% | 0.02% | 0.14% |
| best of 4, joint | 0.07% | 0.05% | 0.02% | 0.15% | 0.08% | 0.05% | 0.02% | 0.01% | 0.03% | 0.17% |
| best+worst of 4, sequential rate_1vs1 | 0.32% | 0.30% | 0.23% | 0.15% | 0.29% | 0.09% | 0.12% | 0.03% | 0.08% | 0.39% |
| best+worst of 4, joint, count +1 per showing | 0.07% | 0.11% | 0.05% | 0.07% | 0.08% | 0.03% | 0.02% | 0.01% | 0.04% | 0.14% |
| best of 4, joint, count +1 per showing | 0.30% | 0.05% | 0.02% | 0.20% | 0.30% | 0.05% | 0.05% | 0.00% | 0.03% | 0.33% |
| best+worst of 4, joint, then pairs | 0.00% | 0.04% | 0.00% | 0.04% | 0.02% | 0.06% | 0.05% | 0.02% | 0.04% | 0.14% |
| best+worst of 4, joint, no per-group Unrated limit | 0.12% | 0.12% | 0.00% | 0.09% | 0.09% | 0.02% | 0.00% | 0.00% | 0.01% | 0.16% |
| best+worst of 4, joint, no Unrated limit or cap | 0.12% | 0.05% | 0.05% | 0.12% | 0.07% | 0.03% | 0.01% | 0.00% | 0.02% | 0.35% |
| best+worst of 4, joint, window 2 | 0.02% | 0.05% | 0.02% | 0.07% | 0.02% | 0.03% | 0.00% | 0.01% | 0.02% | 0.14% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 77.30% | 22.70% | 0.08% | 95.53% | 95.05% |
| best+worst of 4, joint | 40/40 | 77.62% | 22.38% | 0.08% | 94.97% | 94.22% |
| best of 4, joint | 40/40 | 76.09% | 23.91% | 0.05% | 94.80% | 92.81% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 80.17% | 19.82% | 0.34% | 89.34% | 89.17% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 77.14% | 22.86% | 0.10% | 95.40% | 94.44% |
| best of 4, joint, count +1 per showing | 40/40 | 76.99% | 23.01% | 0.05% | 95.10% | 93.03% |
| best+worst of 4, joint, then pairs | 40/40 | 77.62% | 22.38% | 0.08% | 94.97% | 94.17% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 77.47% | 22.52% | 0.10% | 95.64% | 94.89% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 77.45% | 22.55% | 0.06% | 95.36% | 94.71% |
| best+worst of 4, joint, window 2 | 40/40 | 77.15% | 22.85% | 0.06% | 94.96% | 94.16% |

## n = 200, BT(noise=1), k = 2.5

40 libraries per row (seed 1), 4000 showings each. 3.5s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 951 | 1225 | 1602 (39/40) | — (0/40) | 1867 | 1902 | 3204 (39/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 376 | 461 | 606 | 1924 | 662 | 1504 | 2424 | 2.53 | 2.64 | 2.82 |
| best of 4, joint | 577 | 764 | 1024 | 3254 (30/40) | 1053 | 2308 | 4096 | 1.65 | 1.56 | 1.77 |
| best+worst of 4, sequential rate_1vs1 | 273 | 334 | 414 | 1154 | 504 | 1092 | 1656 | 3.48 | 3.87 | 3.70 |
| best+worst of 4, joint, count +1 per showing | 376 | 473 | 636 | 2093 (39/40) | 659 | 1504 | 2544 | 2.53 | 2.52 | 2.83 |
| best of 4, joint, count +1 per showing | 585 | 756 | 1052 | 3603 (22/40) | 1067 | 2340 | 4208 | 1.63 | 1.52 | 1.75 |
| best+worst of 4, joint, then pairs | 376 | 461 | 606 | — (4/40) | 662 | 1504 | 2424 | 2.53 | 2.64 | 2.82 |
| best+worst of 4, joint, no per-group Unrated limit | 300 | 386 | 526 | 1825 | 593 | 1200 | 2104 | 3.17 | 3.05 | 3.15 |
| best+worst of 4, joint, no Unrated limit or cap | 294 | 378 | 521 | 1693 | 588 | 1176 | 2084 | 3.23 | 3.07 | 3.18 |
| best+worst of 4, joint, window 2 | 362 | 461 | 618 | 2034 | 659 | 1448 | 2472 | 2.63 | 2.59 | 2.83 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.95% | 1.06% | — | 0.00% | 0.67% | 0.97% | 1.01% | 0.47% | 0.77% | 1.15% |
| best+worst of 4, joint | 0.77% | 0.70% | 0.39% | 0.95% | 0.69% | 0.51% | 0.33% | 0.16% | 0.35% | 1.75% |
| best of 4, joint | 1.47% | 1.34% | 0.90% | 1.53% | 0.97% | 1.46% | 1.05% | 0.54% | 0.94% | 1.87% |
| best+worst of 4, sequential rate_1vs1 | 2.07% | 2.32% | 1.36% | 2.30% | 2.41% | 1.16% | 0.68% | 0.19% | 0.76% | 2.53% |
| best+worst of 4, joint, count +1 per showing | 1.22% | 0.78% | 0.29% | 1.34% | 0.98% | 0.39% | 0.32% | 0.09% | 0.29% | 1.75% |
| best of 4, joint, count +1 per showing | 1.32% | 1.34% | 1.02% | 1.81% | 1.28% | 1.37% | 1.02% | 0.69% | 1.07% | 1.82% |
| best+worst of 4, joint, then pairs | 0.77% | 0.64% | 0.00% | 0.95% | 0.69% | 0.58% | 0.41% | 0.23% | 0.44% | 1.75% |
| best+worst of 4, joint, no per-group Unrated limit | 1.05% | 0.95% | 0.47% | 0.91% | 0.91% | 0.60% | 0.42% | 0.22% | 0.38% | 3.51% |
| best+worst of 4, joint, no Unrated limit or cap | 1.10% | 0.80% | 0.37% | 1.13% | 0.92% | 0.41% | 0.30% | 0.16% | 0.33% | 3.28% |
| best+worst of 4, joint, window 2 | 0.80% | 0.75% | 0.37% | 0.87% | 0.80% | 0.51% | 0.33% | 0.15% | 0.33% | 1.73% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 73.31% | 26.69% | 1.06% | 85.35% | 77.42% |
| best+worst of 4, joint | 40/40 | 70.86% | 29.14% | 0.65% | 85.75% | 84.88% |
| best of 4, joint | 40/40 | 70.00% | 30.00% | 1.48% | 81.01% | 75.50% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.91% | 24.09% | 2.24% | 76.99% | 79.03% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 70.50% | 29.50% | 0.80% | 86.25% | 85.40% |
| best of 4, joint, count +1 per showing | 40/40 | 70.01% | 29.99% | 1.39% | 80.71% | 76.19% |
| best+worst of 4, joint, then pairs | 40/40 | 70.86% | 29.14% | 0.65% | 85.39% | 82.51% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.29% | 27.71% | 0.83% | 84.16% | 81.20% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.16% | 27.84% | 0.80% | 83.44% | 79.80% |
| best+worst of 4, joint, window 2 | 40/40 | 70.80% | 29.20% | 0.69% | 85.75% | 85.42% |

## n = 200, BT(noise=0.5), k = 2.5

40 libraries per row (seed 1), 4000 showings each. 3.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 829 | 1042 | 1341 | — (10/40) | 1741 | 1658 | 2682 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 298 | 368 | 457 | 1207 | 597 | 1192 | 1828 | 2.78 | 2.93 | 2.92 |
| best of 4, joint | 481 | 612 | 810 | 2484 | 978 | 1924 | 3240 | 1.72 | 1.66 | 1.78 |
| best+worst of 4, sequential rate_1vs1 | 252 | 310 | 377 | 474 | 489 | 1008 | 1508 | 3.29 | 3.56 | 3.56 |
| best+worst of 4, joint, count +1 per showing | 298 | 361 | 460 | 1344 | 593 | 1192 | 1840 | 2.78 | 2.92 | 2.94 |
| best of 4, joint, count +1 per showing | 390 | 633 | 817 | 2604 (38/40) | 996 | 1560 | 3268 | 2.13 | 1.64 | 1.75 |
| best+worst of 4, joint, then pairs | 298 | 368 | 457 | 3388 (31/40) | 597 | 1192 | 1828 | 2.78 | 2.93 | 2.92 |
| best+worst of 4, joint, no per-group Unrated limit | 244 | 312 | 394 | 1155 | 538 | 976 | 1576 | 3.40 | 3.40 | 3.24 |
| best+worst of 4, joint, no Unrated limit or cap | 241 | 314 | 408 | 1344 | 542 | 964 | 1632 | 3.44 | 3.29 | 3.21 |
| best+worst of 4, joint, window 2 | 294 | 367 | 458 | 1308 | 599 | 1176 | 1832 | 2.82 | 2.93 | 2.91 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.17% | 0.18% | 0.19% | 0.00% | 0.26% | 0.22% | 0.08% | 0.03% | 0.09% | 0.26% |
| best+worst of 4, joint | 0.12% | 0.14% | 0.09% | 0.07% | 0.10% | 0.06% | 0.03% | 0.01% | 0.04% | 0.26% |
| best of 4, joint | 0.32% | 0.23% | 0.09% | 0.20% | 0.37% | 0.18% | 0.07% | 0.06% | 0.11% | 0.48% |
| best+worst of 4, sequential rate_1vs1 | 0.40% | 0.29% | 0.27% | 0.31% | 0.27% | 0.08% | 0.04% | 0.00% | 0.07% | 0.74% |
| best+worst of 4, joint, count +1 per showing | 0.05% | 0.11% | 0.05% | 0.22% | 0.08% | 0.00% | 0.00% | 0.01% | 0.02% | 0.26% |
| best of 4, joint, count +1 per showing | 0.50% | 0.27% | 0.12% | 0.21% | 0.48% | 0.22% | 0.11% | 0.05% | 0.12% | 0.48% |
| best+worst of 4, joint, then pairs | 0.12% | 0.14% | 0.08% | 0.07% | 0.10% | 0.05% | 0.05% | 0.03% | 0.05% | 0.26% |
| best+worst of 4, joint, no per-group Unrated limit | 0.10% | 0.14% | 0.06% | 0.18% | 0.18% | 0.05% | 0.03% | 0.00% | 0.03% | 0.60% |
| best+worst of 4, joint, no Unrated limit or cap | 0.12% | 0.09% | 0.00% | 0.15% | 0.09% | 0.02% | 0.00% | 0.00% | 0.01% | 0.39% |
| best+worst of 4, joint, window 2 | 0.12% | 0.12% | 0.05% | 0.11% | 0.10% | 0.02% | 0.00% | 0.00% | 0.01% | 0.26% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 77.53% | 22.48% | 0.13% | 95.65% | 95.00% |
| best+worst of 4, joint | 40/40 | 77.96% | 22.04% | 0.10% | 94.91% | 94.38% |
| best of 4, joint | 40/40 | 75.49% | 24.51% | 0.20% | 93.55% | 91.33% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 80.31% | 19.69% | 0.28% | 89.21% | 89.60% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 77.78% | 22.23% | 0.05% | 94.59% | 94.81% |
| best of 4, joint, count +1 per showing | 40/40 | 75.70% | 24.30% | 0.23% | 93.03% | 90.66% |
| best+worst of 4, joint, then pairs | 40/40 | 77.96% | 22.04% | 0.10% | 94.91% | 94.40% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 77.59% | 22.41% | 0.11% | 94.69% | 95.22% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 77.42% | 22.57% | 0.11% | 95.44% | 95.67% |
| best+worst of 4, joint, window 2 | 40/40 | 77.90% | 22.10% | 0.06% | 95.19% | 94.59% |

## n = 200, T(noise=1), k = 3

40 libraries per row (seed 1), 4000 showings each. 3.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1273 | 1642 | 3911 (21/40) | — (0/40) | 2092 | 2546 | 7822 (21/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 476 | 619 | 1350 | 3256 (30/40) | 723 | 1904 | 5400 | 2.67 | 2.90 | 2.89 |
| best of 4, joint | 698 | 900 | 1904 | — (9/40) | 1125 | 2792 | 7616 | 1.82 | 2.05 | 1.86 |
| best+worst of 4, sequential rate_1vs1 | 347 | 428 | 563 | 1794 (39/40) | 559 | 1388 | 2252 | 3.67 | 6.95 | 3.74 |
| best+worst of 4, joint, count +1 per showing | 482 | 616 | 1412 | 3374 (25/40) | 718 | 1928 | 5648 | 2.64 | 2.77 | 2.91 |
| best of 4, joint, count +1 per showing | 696 | 889 | 1983 | — (13/40) | 1132 | 2784 | 7932 | 1.83 | 1.97 | 1.85 |
| best+worst of 4, joint, then pairs | 476 | 619 | 3327 (31/40) | — (0/40) | 723 | 1904 | 13308 (31/40) | 2.67 | 1.18 | 2.89 |
| best+worst of 4, joint, no per-group Unrated limit | 397 | 528 | 1236 | 2809 (32/40) | 660 | 1588 | 4944 | 3.21 | 3.16 | 3.17 |
| best+worst of 4, joint, no Unrated limit or cap | 402 | 501 | 1101 | 2534 (35/40) | 657 | 1608 | 4404 | 3.17 | 3.55 | 3.18 |
| best+worst of 4, joint, window 2 | 475 | 629 | 1402 | 3378 (26/40) | 723 | 1900 | 5608 | 2.68 | 2.79 | 2.89 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.55% | 0.51% | — | 0.00% | 0.59% | 0.52% | 0.66% | 0.36% | 0.57% | 0.95% |
| best+worst of 4, joint | 0.35% | 0.18% | 0.17% | 0.25% | 0.30% | 0.17% | 0.18% | 0.11% | 0.18% | 0.48% |
| best of 4, joint | 0.45% | 0.34% | 0.35% | 0.41% | 0.17% | 0.30% | 0.33% | 0.16% | 0.28% | 0.49% |
| best+worst of 4, sequential rate_1vs1 | 0.92% | 0.93% | 0.58% | 0.72% | 1.04% | 0.56% | 0.47% | 0.11% | 0.37% | 1.73% |
| best+worst of 4, joint, count +1 per showing | 0.30% | 0.16% | 0.20% | 0.19% | 0.33% | 0.27% | 0.15% | 0.09% | 0.17% | 0.50% |
| best of 4, joint, count +1 per showing | 0.32% | 0.37% | 0.38% | 0.15% | 0.36% | 0.36% | 0.42% | 0.18% | 0.29% | 0.47% |
| best+worst of 4, joint, then pairs | 0.35% | 0.28% | — | 0.25% | 0.30% | 0.29% | 0.23% | 0.21% | 0.26% | 0.48% |
| best+worst of 4, joint, no per-group Unrated limit | 0.50% | 0.32% | 0.27% | 0.54% | 0.48% | 0.43% | 0.23% | 0.12% | 0.24% | 0.83% |
| best+worst of 4, joint, no Unrated limit or cap | 0.45% | 0.50% | 0.18% | 0.40% | 0.40% | 0.48% | 0.23% | 0.17% | 0.26% | 0.61% |
| best+worst of 4, joint, window 2 | 0.15% | 0.18% | 0.10% | 0.30% | 0.24% | 0.19% | 0.08% | 0.02% | 0.09% | 0.48% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 67.55% | 32.45% | 0.72% | 78.90% | 75.45% |
| best+worst of 4, joint | 40/40 | 64.21% | 35.79% | 0.33% | 80.47% | 82.86% |
| best of 4, joint | 40/40 | 66.17% | 33.83% | 0.32% | 80.25% | 79.85% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 69.67% | 30.32% | 1.04% | 73.08% | 77.58% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 64.30% | 35.70% | 0.35% | 79.67% | 82.55% |
| best of 4, joint, count +1 per showing | 40/40 | 66.21% | 33.79% | 0.42% | 80.85% | 79.24% |
| best+worst of 4, joint, then pairs | 40/40 | 64.21% | 35.79% | 0.33% | 79.44% | 79.76% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 66.20% | 33.80% | 0.47% | 77.89% | 78.20% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 66.58% | 33.42% | 0.58% | 78.41% | 78.26% |
| best+worst of 4, joint, window 2 | 40/40 | 63.99% | 36.01% | 0.16% | 80.72% | 82.71% |

## n = 200, T(noise=0.5), k = 3

40 libraries per row (seed 1), 4000 showings each. 3.4s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1093 | 1380 | 1794 | — (0/40) | 1965 | 2186 | 3588 | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 364 | 458 | 592 | 1824 | 656 | 1456 | 2368 | 3.00 | 3.03 | 3.00 |
| best of 4, joint | 612 | 764 | 986 | 3327 (38/40) | 1059 | 2448 | 3944 | 1.79 | 1.82 | 1.86 |
| best+worst of 4, sequential rate_1vs1 | 296 | 360 | 443 | 1279 | 525 | 1184 | 1772 | 3.69 | 4.05 | 3.74 |
| best+worst of 4, joint, count +1 per showing | 376 | 467 | 604 | 1863 | 655 | 1504 | 2416 | 2.91 | 2.97 | 3.00 |
| best of 4, joint, count +1 per showing | 570 | 763 | 999 | 3378 (34/40) | 1065 | 2280 | 3996 | 1.92 | 1.80 | 1.85 |
| best+worst of 4, joint, then pairs | 364 | 458 | 592 | — (1/40) | 656 | 1456 | 2368 | 3.00 | 3.03 | 3.00 |
| best+worst of 4, joint, no per-group Unrated limit | 326 | 418 | 549 | 1860 | 606 | 1304 | 2196 | 3.35 | 3.27 | 3.24 |
| best+worst of 4, joint, no Unrated limit or cap | 324 | 414 | 561 | 1831 | 606 | 1296 | 2244 | 3.37 | 3.20 | 3.24 |
| best+worst of 4, joint, window 2 | 365 | 460 | 595 | 2005 | 659 | 1460 | 2380 | 2.99 | 3.02 | 2.98 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.00% | 0.00% | — | 0.00% | 0.15% | 0.00% | 0.00% | 0.00% | 0.01% | 0.22% |
| best+worst of 4, joint | 0.00% | 0.00% | 0.00% | 0.04% | 0.00% | 0.03% | 0.00% | 0.00% | 0.00% | 0.04% |
| best of 4, joint | 0.07% | 0.05% | 0.02% | 0.14% | 0.13% | 0.05% | 0.03% | 0.00% | 0.02% | 0.17% |
| best+worst of 4, sequential rate_1vs1 | 0.07% | 0.16% | 0.02% | 0.11% | 0.15% | 0.00% | 0.03% | 0.01% | 0.02% | 0.15% |
| best+worst of 4, joint, count +1 per showing | 0.00% | 0.02% | 0.02% | 0.05% | 0.00% | 0.00% | 0.00% | 0.00% | 0.01% | 0.05% |
| best of 4, joint, count +1 per showing | 0.07% | 0.00% | 0.00% | 0.07% | 0.03% | 0.00% | 0.00% | 0.00% | 0.00% | 0.17% |
| best+worst of 4, joint, then pairs | 0.00% | 0.00% | 0.00% | 0.04% | 0.00% | 0.03% | 0.03% | 0.00% | 0.02% | 0.04% |
| best+worst of 4, joint, no per-group Unrated limit | 0.00% | 0.02% | 0.02% | 0.00% | 0.00% | 0.00% | 0.02% | 0.00% | 0.00% | 0.02% |
| best+worst of 4, joint, no Unrated limit or cap | 0.02% | 0.02% | 0.00% | 0.04% | 0.04% | 0.02% | 0.00% | 0.00% | 0.00% | 0.13% |
| best+worst of 4, joint, window 2 | 0.00% | 0.02% | 0.00% | 0.00% | 0.00% | 0.02% | 0.02% | 0.00% | 0.01% | 0.06% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 72.21% | 27.79% | 0.02% | 94.76% | 93.95% |
| best+worst of 4, joint | 40/40 | 72.65% | 27.35% | 0.03% | 94.85% | 94.31% |
| best of 4, joint | 40/40 | 71.56% | 28.44% | 0.05% | 94.70% | 92.99% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.40% | 24.60% | 0.13% | 87.78% | 89.30% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 72.41% | 27.59% | 0.02% | 94.79% | 94.51% |
| best of 4, joint, count +1 per showing | 40/40 | 71.88% | 28.12% | 0.00% | 94.42% | 92.71% |
| best+worst of 4, joint, then pairs | 40/40 | 72.65% | 27.35% | 0.03% | 94.76% | 94.06% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.47% | 27.52% | 0.02% | 94.65% | 94.50% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.41% | 27.59% | 0.03% | 94.42% | 94.29% |
| best+worst of 4, joint, window 2 | 40/40 | 72.14% | 27.86% | 0.02% | 94.39% | 94.19% |

## n = 200, BT(noise=1), k = 3

40 libraries per row (seed 1), 4000 showings each. 3.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1245 | 1613 | 3971 (23/40) | — (0/40) | 2084 | 2490 | 7942 (23/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 472 | 598 | 1263 | 3160 (33/40) | 724 | 1888 | 5052 | 2.64 | 3.14 | 2.88 |
| best of 4, joint | 739 | 972 | 2103 | — (7/40) | 1133 | 2956 | 8412 | 1.68 | 1.89 | 1.84 |
| best+worst of 4, sequential rate_1vs1 | 333 | 413 | 531 | 1753 | 552 | 1332 | 2124 | 3.74 | 7.48 | 3.78 |
| best+worst of 4, joint, count +1 per showing | 480 | 599 | 1320 | 3279 (32/40) | 714 | 1920 | 5280 | 2.59 | 3.01 | 2.92 |
| best of 4, joint, count +1 per showing | 738 | 954 | 2221 | — (6/40) | 1157 | 2952 | 8884 | 1.69 | 1.79 | 1.80 |
| best+worst of 4, joint, then pairs | 472 | 598 | 3170 (34/40) | — (0/40) | 724 | 1888 | 12680 (34/40) | 2.64 | 1.25 | 2.88 |
| best+worst of 4, joint, no per-group Unrated limit | 394 | 538 | 1202 | 2791 (36/40) | 659 | 1576 | 4808 | 3.16 | 3.30 | 3.16 |
| best+worst of 4, joint, no Unrated limit or cap | 385 | 510 | 1118 | 2453 (35/40) | 651 | 1540 | 4472 | 3.23 | 3.55 | 3.20 |
| best+worst of 4, joint, window 2 | 460 | 598 | 1297 | 3094 (30/40) | 720 | 1840 | 5188 | 2.71 | 3.06 | 2.89 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.50% | 0.71% | — | 0.00% | 0.20% | 0.54% | 0.64% | 0.38% | 0.52% | 0.73% |
| best+worst of 4, joint | 0.25% | 0.25% | 0.09% | 0.45% | 0.24% | 0.15% | 0.12% | 0.03% | 0.11% | 0.55% |
| best of 4, joint | 0.90% | 0.61% | 0.45% | 0.68% | 0.73% | 0.81% | 0.74% | 0.38% | 0.63% | 1.01% |
| best+worst of 4, sequential rate_1vs1 | 1.07% | 1.25% | 0.55% | 1.06% | 1.10% | 0.79% | 0.48% | 0.17% | 0.46% | 1.52% |
| best+worst of 4, joint, count +1 per showing | 0.37% | 0.23% | 0.18% | 0.31% | 0.42% | 0.34% | 0.23% | 0.12% | 0.18% | 0.55% |
| best of 4, joint, count +1 per showing | 0.62% | 0.70% | 0.62% | 0.95% | 1.02% | 0.77% | 0.69% | 0.47% | 0.61% | 1.10% |
| best+worst of 4, joint, then pairs | 0.25% | 0.29% | — | 0.45% | 0.24% | 0.19% | 0.12% | 0.12% | 0.17% | 0.55% |
| best+worst of 4, joint, no per-group Unrated limit | 0.55% | 0.32% | 0.12% | 0.62% | 0.53% | 0.28% | 0.17% | 0.08% | 0.19% | 1.02% |
| best+worst of 4, joint, no Unrated limit or cap | 0.47% | 0.27% | 0.20% | 0.51% | 0.42% | 0.29% | 0.20% | 0.11% | 0.21% | 1.02% |
| best+worst of 4, joint, window 2 | 0.45% | 0.41% | 0.19% | 0.12% | 0.35% | 0.30% | 0.23% | 0.11% | 0.21% | 0.57% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 67.89% | 32.11% | 0.64% | 79.74% | 76.51% |
| best+worst of 4, joint | 40/40 | 65.00% | 35.00% | 0.23% | 83.76% | 85.66% |
| best of 4, joint | 40/40 | 64.38% | 35.62% | 1.01% | 75.62% | 74.66% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 70.84% | 29.16% | 1.20% | 73.31% | 79.50% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 65.24% | 34.76% | 0.36% | 83.10% | 84.96% |
| best of 4, joint, count +1 per showing | 40/40 | 64.28% | 35.73% | 0.68% | 76.72% | 75.65% |
| best+worst of 4, joint, then pairs | 40/40 | 65.00% | 35.00% | 0.23% | 82.88% | 82.24% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 66.44% | 33.56% | 0.51% | 79.88% | 81.81% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 66.90% | 33.10% | 0.45% | 79.56% | 81.30% |
| best+worst of 4, joint, window 2 | 40/40 | 65.31% | 34.69% | 0.48% | 82.47% | 85.16% |

## n = 200, BT(noise=0.5), k = 3

40 libraries per row (seed 1), 4000 showings each. 3.3s.

Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call ("Done"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.

| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 1108 | 1400 | 1836 (39/40) | — (0/40) | 1988 | 2216 | 3672 (39/40) | 1.00 | 1.00 | 1.00 |
| best+worst of 4, joint | 357 | 448 | 587 | 1887 | 656 | 1428 | 2348 | 3.10 | 3.13 | 3.03 |
| best of 4, joint | 612 | 772 | 1040 | 3452 (29/40) | 1069 | 2448 | 4160 | 1.81 | 1.77 | 1.86 |
| best+worst of 4, sequential rate_1vs1 | 295 | 353 | 441 | 1243 | 523 | 1180 | 1764 | 3.76 | 4.16 | 3.80 |
| best+worst of 4, joint, count +1 per showing | 362 | 457 | 579 | 1788 | 653 | 1448 | 2316 | 3.06 | 3.17 | 3.04 |
| best of 4, joint, count +1 per showing | 587 | 781 | 1039 | 3715 (29/40) | 1081 | 2348 | 4156 | 1.89 | 1.77 | 1.84 |
| best+worst of 4, joint, then pairs | 357 | 448 | 587 | — (1/40) | 656 | 1428 | 2348 | 3.10 | 3.13 | 3.03 |
| best+worst of 4, joint, no per-group Unrated limit | 319 | 402 | 534 | 1856 | 601 | 1276 | 2136 | 3.47 | 3.44 | 3.31 |
| best+worst of 4, joint, no Unrated limit or cap | 320 | 401 | 538 | 1812 | 604 | 1280 | 2152 | 3.46 | 3.41 | 3.29 |
| best+worst of 4, joint, window 2 | 366 | 460 | 598 | 1886 | 655 | 1464 | 2392 | 3.03 | 3.07 | 3.04 |

Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. "Run" pools every 50th showing from showing 2n (pairwise Each 4) on; "Peak" is the worst such point with ≥ 2% Decided (from showing 50 on).

| Variant | @50% | @70% | @80% | @200 | @400 | @1000 | @2000 | @4000 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pair | 0.00% | 0.04% | — | 0.00% | 0.00% | 0.00% | 0.03% | 0.02% | 0.02% | 0.06% |
| best+worst of 4, joint | 0.00% | 0.00% | 0.00% | 0.00% | 0.02% | 0.00% | 0.00% | 0.00% | 0.00% | 0.06% |
| best of 4, joint | 0.02% | 0.04% | 0.00% | 0.07% | 0.07% | 0.05% | 0.00% | 0.00% | 0.01% | 0.08% |
| best+worst of 4, sequential rate_1vs1 | 0.20% | 0.14% | 0.05% | 0.14% | 0.10% | 0.05% | 0.02% | 0.00% | 0.03% | 0.51% |
| best+worst of 4, joint, count +1 per showing | 0.05% | 0.04% | 0.02% | 0.00% | 0.07% | 0.02% | 0.02% | 0.00% | 0.01% | 0.07% |
| best of 4, joint, count +1 per showing | 0.07% | 0.02% | 0.02% | 0.20% | 0.21% | 0.02% | 0.02% | 0.03% | 0.04% | 0.21% |
| best+worst of 4, joint, then pairs | 0.00% | 0.00% | 0.00% | 0.00% | 0.02% | 0.00% | 0.00% | 0.00% | 0.00% | 0.06% |
| best+worst of 4, joint, no per-group Unrated limit | 0.02% | 0.04% | 0.00% | 0.04% | 0.02% | 0.00% | 0.00% | 0.00% | 0.00% | 0.11% |
| best+worst of 4, joint, no Unrated limit or cap | 0.02% | 0.09% | 0.02% | 0.12% | 0.06% | 0.03% | 0.03% | 0.00% | 0.02% | 0.12% |
| best+worst of 4, joint, window 2 | 0.05% | 0.02% | 0.00% | 0.00% | 0.02% | 0.02% | 0.00% | 0.00% | 0.00% | 0.09% |

When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.

| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |
|---|---:|---:|---:|---:|---:|---:|
| pair | 40/40 | 72.15% | 27.85% | 0.03% | 95.12% | 95.39% |
| best+worst of 4, joint | 40/40 | 72.97% | 27.02% | 0.00% | 94.55% | 94.31% |
| best of 4, joint | 40/40 | 70.79% | 29.21% | 0.04% | 92.15% | 90.94% |
| best+worst of 4, sequential rate_1vs1 | 40/40 | 75.81% | 24.19% | 0.13% | 88.16% | 90.05% |
| best+worst of 4, joint, count +1 per showing | 40/40 | 73.39% | 26.61% | 0.03% | 95.11% | 94.64% |
| best of 4, joint, count +1 per showing | 40/40 | 70.59% | 29.41% | 0.05% | 92.21% | 91.03% |
| best+worst of 4, joint, then pairs | 40/40 | 72.97% | 27.02% | 0.00% | 94.58% | 93.74% |
| best+worst of 4, joint, no per-group Unrated limit | 40/40 | 72.74% | 27.26% | 0.02% | 94.75% | 95.00% |
| best+worst of 4, joint, no Unrated limit or cap | 40/40 | 72.62% | 27.38% | 0.05% | 94.78% | 95.25% |
| best+worst of 4, joint, window 2 | 40/40 | 72.38% | 27.62% | 0.02% | 94.61% | 95.16% |

