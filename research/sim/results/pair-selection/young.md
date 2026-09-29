## n = 30, thurstone(noise=0.5), k = 2.5

100 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 9.73 | 13.60 | 21.20 (99/100) | 35.93 (62/100) | — (2/100) | — (39/100) | — (4/100) |
| undecided-least + BALD | 7.80 | 10.07 | 13.00 | 21.20 (97/100) | — (21/100) | 24.47 (77/100) | — (41/100) |
| undecided-least + BALD, Unrated by index | 7.80 | 10.20 | 13.40 | 20.87 | — (28/100) | 25.67 (82/100) | — (33/100) |
| undecided-least + BALD, Unrated every other pair | 7.80 | 10.00 | 13.47 | 20.13 (97/100) | — (40/100) | 24.00 (81/100) | — (42/100) |
| undecided-least + μ-proximity | 8.27 | 10.33 | 12.93 | 17.93 (99/100) | 37.87 (57/100) | 21.40 (97/100) | 35.53 (61/100) |
| undecided-least + μ-proximity, Unrated by index | 8.13 | 10.47 | 13.20 | 18.53 (96/100) | 38.13 (55/100) | 20.93 (96/100) | 37.27 (54/100) |
| undecided-least + μ-proximity, Unrated every other pair | 8.33 | 10.13 | 12.87 | 18.07 (98/100) | 33.07 (62/100) | 21.40 (98/100) | 33.07 (59/100) |
| lsa + lookahead | 9.87 | 10.87 | 13.27 | 16.73 (95/100) | 29.73 (66/100) | 19.80 (96/100) | 31.73 (58/100) |
| lsa + lookahead, Unrated by index | 9.53 | 10.80 | 13.60 | 17.27 (95/100) | 35.40 (61/100) | 19.60 (98/100) | 39.60 (54/100) |
| lsa + lookahead, Unrated every other pair | 9.40 | 11.00 | 13.33 (98/100) | 16.80 (96/100) | 31.33 (64/100) | 19.73 (99/100) | 33.93 (59/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.80 | 9.93 | 13.40 | 21.07 (99/100) | — (27/100) | 25.20 (81/100) | — (36/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.00% | 24.83% | 17.13% | 39.37% | 60.40% | 77.53% | 0.00% | 0.17% | 0.11% | 0.09% | 0.07% | 0.24% |
| undecided-least + BALD | 0.00% | 15.83% | 42.17% | 21.03% | 48.77% | 71.10% | 83.10% | 0.16% | 0.00% | 0.23% | 0.20% | 0.14% | 0.51% |
| undecided-least + BALD, Unrated by index | 0.00% | 15.33% | 42.17% | 21.60% | 48.73% | 71.30% | 83.17% | 0.31% | 0.21% | 0.37% | 0.24% | 0.28% | 0.50% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 14.83% | 45.50% | 19.57% | 48.10% | 72.43% | 84.17% | 0.00% | 0.21% | 0.46% | 0.24% | 0.35% | 0.66% |
| undecided-least + μ-proximity | 0.00% | 11.17% | 44.00% | 19.60% | 45.63% | 73.23% | 86.50% | 0.00% | 0.07% | 0.18% | 0.08% | 0.11% | 0.23% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 10.33% | 44.33% | 18.17% | 45.83% | 72.87% | 86.73% | 0.18% | 0.15% | 0.23% | 0.23% | 0.22% | 0.52% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 9.83% | 44.83% | 19.83% | 45.57% | 73.27% | 86.80% | 0.00% | 0.00% | 0.23% | 0.12% | 0.15% | 0.71% |
| lsa + lookahead | 0.00% | 3.50% | 44.17% | 0.10% | 22.10% | 65.10% | 84.67% | 0.00% | 0.75% | 0.20% | 0.20% | 0.22% | 0.86% |
| lsa + lookahead, Unrated by index | 0.00% | 5.50% | 43.67% | 0.10% | 24.83% | 65.10% | 84.70% | 0.00% | 0.54% | 0.31% | 0.35% | 0.37% | 1.17% |
| lsa + lookahead, Unrated every other pair | 0.00% | 4.83% | 39.83% | 3.20% | 24.23% | 67.67% | 84.97% | 0.00% | 0.55% | 0.15% | 0.16% | 0.22% | 0.57% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.67% | 45.50% | 24.97% | 48.97% | 71.23% | 83.13% | 0.13% | 0.14% | 0.28% | 0.40% | 0.25% | 0.45% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 7.20% | 28.25% | 4.94% | 3 / 4 | 0.00% | — (0/100) | 0.00% / 22.23% / 22.47% | — (0/100) | 35.93 (94/100) | 22.80 |
| undecided-least + BALD | 0.00% | 27.62% | 61.53% | 39.83% | 14 / 36 | 0.00% | — (0/100) | 9.77% / 16.90% / 16.90% | — (41/100) | 20.20 | 14.00 |
| undecided-least + BALD, Unrated by index | 0.00% | 29.22% | 62.16% | 40.13% | 15 / 37 | 0.01% | — (1/100) | 9.33% / 16.83% / 16.83% | — (41/100) | 20.33 | 14.00 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 31.40% | 67.71% | 46.36% | 16 / 44 | 0.04% | — (3/100) | 9.17% / 15.83% / 15.83% | — (41/100) | 20.27 | 14.07 |
| undecided-least + μ-proximity | 0.00% | 49.89% | 79.60% | 66.42% | 30 / 102 | 0.51% | — (16/100) | 13.37% / 13.47% / 13.47% | 27.60 | 18.13 | 14.13 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 49.69% | 79.37% | 66.15% | 27 / 147 | 0.84% | — (16/100) | 13.27% / 13.27% / 13.27% | 27.80 | 18.13 | 14.20 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 52.74% | 82.62% | 69.17% | 31 / 140 | 0.42% | — (18/100) | 13.17% / 13.20% / 13.20% | 27.53 | 18.20 | 14.27 |
| lsa + lookahead | 0.00% | 86.23% | 93.03% | 85.95% | 98 / 215 | 0.45% | — (5/100) | 12.73% / 13.47% / 13.90% | 25.47 (99/100) | 17.27 | 14.67 |
| lsa + lookahead, Unrated by index | 0.00% | 85.58% | 92.69% | 85.71% | 94 / 215 | 1.15% | — (14/100) | 13.00% / 13.87% / 14.30% | 24.93 | 17.87 | 15.00 |
| lsa + lookahead, Unrated every other pair | 0.00% | 87.59% | 95.56% | 88.09% | 99 / 224 | 0.84% | — (11/100) | 12.77% / 13.53% / 14.10% | 25.07 (97/100) | 17.13 | 14.47 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 24.87% | 58.73% | 39.63% | 16 / 43 | 0.10% | — (1/100) | 9.33% / 16.87% / 16.87% | — (37/100) | 20.13 | 13.93 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.60% | 0.00% | 17.13% | 0.00% | 30–30 |
| undecided-least + BALD | 0.00% | — | 0.00% | — | 21.03% | 0.16% | 30–30 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.10% | 0.00% | 21.60% | 0.31% | 30–30 |
| undecided-least + BALD, Unrated every other pair | 4.10% | 0.00% | 6.93% | 0.00% | 19.57% | 0.00% | 5–11 |
| undecided-least + μ-proximity | 0.63% | 0.00% | 1.80% | 0.00% | 19.60% | 0.00% | 10–30 |
| undecided-least + μ-proximity, Unrated by index | 0.27% | 0.00% | 1.93% | 0.00% | 18.17% | 0.18% | 10–30 |
| undecided-least + μ-proximity, Unrated every other pair | 3.67% | 0.00% | 6.77% | 0.00% | 19.83% | 0.00% | 5–22 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.10% | 0.00% | 30–30 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.10% | 0.00% | 30–30 |
| lsa + lookahead, Unrated every other pair | 0.53% | 0.00% | 0.17% | 0.00% | 3.20% | 0.00% | 7–30 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.90% | 0.00% | 24.97% | 0.13% | 30–30 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 10.00 | 15 / 23 | 100.00% | 20 / 23 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 93.27% | 30 / 37 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + BALD, Unrated may meet Unrated | 15.00 | 15 / 15 | 100.00% | 15 / 15 |

## n = 30, thurstone(noise=1), k = 2.5

100 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.33 | 15.93 | 24.13 (96/100) | — (39/100) | — (1/100) | — (11/100) | — (0/100) |
| undecided-least + BALD | 7.87 | 10.13 | 12.93 | 17.53 | 30.80 (70/100) | 27.60 (76/100) | — (38/100) |
| undecided-least + BALD, Unrated by index | 7.93 | 10.00 | 12.87 | 18.07 | 31.20 (73/100) | 28.80 (76/100) | — (44/100) |
| undecided-least + BALD, Unrated every other pair | 7.87 | 10.20 | 12.87 | 18.20 | 31.13 (76/100) | 26.40 (82/100) | — (44/100) |
| undecided-least + μ-proximity | 9.07 | 11.73 | 15.13 | 25.13 (91/100) | — (28/100) | 34.93 (59/100) | — (22/100) |
| undecided-least + μ-proximity, Unrated by index | 9.07 | 11.93 | 15.67 | 23.07 (86/100) | — (30/100) | 32.93 (67/100) | — (29/100) |
| undecided-least + μ-proximity, Unrated every other pair | 9.20 | 12.13 | 15.53 (99/100) | 23.93 (91/100) | — (30/100) | 33.87 (64/100) | — (24/100) |
| lsa + lookahead | 12.87 | 16.80 (99/100) | 23.40 (90/100) | 33.87 (60/100) | — (11/100) | — (31/100) | — (8/100) |
| lsa + lookahead, Unrated by index | 13.00 (99/100) | 16.40 (98/100) | 21.93 (89/100) | 31.93 (65/100) | — (15/100) | — (48/100) | — (7/100) |
| lsa + lookahead, Unrated every other pair | 13.47 | 16.13 | 23.00 (87/100) | 36.13 (58/100) | — (16/100) | — (32/100) | — (9/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.67 | 9.80 | 12.53 | 17.87 | 30.20 (71/100) | 26.27 (79/100) | — (47/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.00% | 25.00% | 14.73% | 36.10% | 56.87% | 75.20% | 0.45% | 1.02% | 1.00% | 1.15% | 1.07% | 1.36% |
| undecided-least + BALD | 0.00% | 14.17% | 43.67% | 20.87% | 48.03% | 73.60% | 86.03% | 1.12% | 1.87% | 1.99% | 2.29% | 2.04% | 2.37% |
| undecided-least + BALD, Unrated by index | 0.00% | 13.17% | 41.67% | 21.07% | 48.00% | 73.93% | 87.40% | 1.11% | 1.46% | 2.52% | 2.59% | 2.30% | 3.85% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 11.67% | 41.17% | 19.10% | 47.73% | 73.03% | 86.73% | 1.05% | 1.54% | 2.05% | 2.73% | 2.30% | 2.77% |
| undecided-least + μ-proximity | 0.00% | 8.17% | 32.67% | 15.37% | 40.63% | 67.33% | 82.30% | 1.30% | 0.98% | 1.09% | 1.17% | 1.26% | 3.23% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 6.83% | 32.67% | 14.40% | 41.40% | 66.60% | 82.87% | 1.16% | 1.37% | 1.45% | 1.29% | 1.32% | 5.33% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 4.67% | 33.17% | 16.13% | 40.70% | 66.70% | 83.27% | 1.03% | 1.64% | 1.95% | 1.56% | 1.83% | 2.35% |
| lsa + lookahead | 0.00% | 2.17% | 23.50% | 0.10% | 13.03% | 46.53% | 72.40% | 0.00% | 0.51% | 1.00% | 0.69% | 0.83% | 1.98% |
| lsa + lookahead, Unrated by index | 0.00% | 2.67% | 27.83% | 0.13% | 12.77% | 46.07% | 74.67% | 0.00% | 0.78% | 1.09% | 0.89% | 0.89% | 2.44% |
| lsa + lookahead, Unrated every other pair | 0.00% | 2.50% | 25.17% | 2.33% | 14.53% | 49.43% | 73.30% | 1.43% | 2.52% | 1.08% | 0.73% | 0.88% | 3.45% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 13.67% | 43.67% | 25.00% | 49.13% | 73.80% | 86.37% | 1.47% | 1.76% | 1.85% | 2.62% | 2.18% | 2.67% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 7.33% | 28.55% | 4.94% | 3 / 4 | 0.00% | — (0/100) | 0.00% / 24.80% / 24.80% | — (0/100) | 35.07 | 22.27 |
| undecided-least + BALD | 0.00% | 38.79% | 65.81% | 45.13% | 20 / 45 | 1.17% | — (13/100) | 3.37% / 13.93% / 13.93% | — (29/100) | 20.20 | 14.00 |
| undecided-least + BALD, Unrated by index | 0.00% | 38.34% | 65.51% | 44.64% | 20 / 75 | 2.32% | — (14/100) | 3.10% / 12.57% / 12.57% | — (30/100) | 20.40 | 14.13 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 40.57% | 70.84% | 50.25% | 18 / 73 | 1.35% | — (10/100) | 3.80% / 13.13% / 13.20% | — (34/100) | 20.07 | 14.07 |
| undecided-least + μ-proximity | 0.00% | 40.58% | 76.14% | 59.78% | 14 / 105 | 0.04% | — (4/100) | 17.57% / 17.70% / 17.70% | 30.87 | 19.27 | 14.67 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 41.30% | 75.92% | 59.87% | 17 / 104 | 0.21% | — (3/100) | 16.90% / 17.07% / 17.13% | 30.33 | 19.53 | 14.73 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 42.32% | 78.72% | 61.87% | 19 / 163 | 0.07% | — (5/100) | 16.23% / 16.67% / 16.70% | 30.93 (99/100) | 19.60 | 14.87 |
| lsa + lookahead | 0.00% | 82.20% | 91.11% | 80.63% | 43 / 215 | 0.00% | — (0/100) | 19.33% / 24.63% / 25.43% | 34.40 (77/100) | 22.20 | 17.87 |
| lsa + lookahead, Unrated by index | 0.00% | 82.24% | 91.36% | 81.30% | 42 / 175 | 0.03% | — (1/100) | 17.97% / 23.40% / 24.13% | 34.00 (81/100) | 22.33 | 17.47 |
| lsa + lookahead, Unrated every other pair | 0.00% | 83.21% | 93.51% | 83.30% | 43 / 160 | 0.03% | — (2/100) | 18.57% / 24.27% / 25.03% | 35.27 (77/100) | 22.07 | 17.80 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 35.56% | 63.01% | 44.46% | 19 / 50 | 0.77% | — (9/100) | 3.43% / 13.57% / 13.60% | — (28/100) | 20.53 | 13.80 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 0.93% | 0.00% | 14.73% | 0.45% | 30–30 |
| undecided-least + BALD | 0.00% | — | 0.10% | 0.00% | 20.87% | 1.12% | 30–30 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.10% | 0.00% | 21.07% | 1.11% | 30–30 |
| undecided-least + BALD, Unrated every other pair | 3.83% | 0.87% | 7.43% | 1.35% | 19.10% | 1.05% | 5–15 |
| undecided-least + μ-proximity | 0.50% | 0.00% | 1.57% | 4.26% | 15.37% | 1.30% | 10–30 |
| undecided-least + μ-proximity, Unrated by index | 0.33% | 0.00% | 1.40% | 4.76% | 14.40% | 1.16% | 10–30 |
| undecided-least + μ-proximity, Unrated every other pair | 2.97% | 0.00% | 5.67% | 2.35% | 16.13% | 1.03% | 5–22 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.10% | 0.00% | 30–30 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.13% | 0.00% | 30–30 |
| lsa + lookahead, Unrated every other pair | 0.27% | 0.00% | 0.13% | 0.00% | 2.33% | 1.43% | 7–30 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.80% | 0.00% | 25.00% | 1.47% | 30–30 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 9.96 | 15 / 23 | 100.00% | 20 / 23 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 93.49% | 29 / 34 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + BALD, Unrated may meet Unrated | 15.00 | 15 / 15 | 100.00% | 15 / 15 |

## n = 30, bradley-terry(noise=0.5), k = 2.5

100 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.00 | 13.60 | 21.20 (96/100) | 37.60 (59/100) | — (1/100) | — (38/100) | — (2/100) |
| undecided-least + BALD | 7.73 | 10.07 | 13.67 | 21.07 (96/100) | — (29/100) | 25.00 (79/100) | — (35/100) |
| undecided-least + BALD, Unrated by index | 7.80 | 9.87 | 13.53 | 20.87 (98/100) | — (27/100) | 23.93 (84/100) | — (35/100) |
| undecided-least + BALD, Unrated every other pair | 7.73 | 10.07 | 13.27 | 20.73 (98/100) | — (25/100) | 22.80 (77/100) | — (44/100) |
| undecided-least + μ-proximity | 8.07 | 10.40 | 13.20 | 18.73 | 34.87 (58/100) | 21.80 (97/100) | 35.07 (59/100) |
| undecided-least + μ-proximity, Unrated by index | 8.13 | 10.40 | 12.87 | 17.73 (98/100) | 32.40 (66/100) | 19.93 (99/100) | 33.13 (61/100) |
| undecided-least + μ-proximity, Unrated every other pair | 8.07 | 9.73 | 12.67 | 18.13 | 33.87 (61/100) | 19.20 (98/100) | 30.73 (61/100) |
| lsa + lookahead | 10.13 | 11.73 | 13.53 (99/100) | 16.93 (98/100) | 29.87 (65/100) | 19.00 (97/100) | 33.00 (63/100) |
| lsa + lookahead, Unrated by index | 9.73 | 11.07 | 13.40 (99/100) | 17.73 (94/100) | 30.00 (67/100) | 20.27 | 31.47 (59/100) |
| lsa + lookahead, Unrated every other pair | 9.73 | 11.20 | 13.40 (99/100) | 16.80 (97/100) | 32.00 (65/100) | 18.33 (99/100) | 32.67 (62/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.73 | 10.00 | 13.47 | 20.33 (95/100) | — (25/100) | 25.33 (79/100) | — (34/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 7.33% | 24.83% | 16.77% | 39.53% | 59.93% | 76.87% | 0.00% | 0.00% | 0.06% | 0.13% | 0.16% | 0.32% |
| undecided-least + BALD | 0.00% | 15.67% | 41.67% | 21.73% | 48.83% | 70.80% | 83.27% | 0.00% | 0.27% | 0.19% | 0.32% | 0.22% | 0.36% |
| undecided-least + BALD, Unrated by index | 0.00% | 15.17% | 43.83% | 22.27% | 48.50% | 71.83% | 83.00% | 0.15% | 0.21% | 0.19% | 0.12% | 0.16% | 0.49% |
| undecided-least + BALD, Unrated every other pair | 0.17% | 15.17% | 44.00% | 20.53% | 49.00% | 71.93% | 83.27% | 0.16% | 0.34% | 0.28% | 0.28% | 0.26% | 0.43% |
| undecided-least + μ-proximity | 0.00% | 10.33% | 44.67% | 19.83% | 46.70% | 72.60% | 86.80% | 0.00% | 0.14% | 0.09% | 0.08% | 0.09% | 0.36% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 11.33% | 42.83% | 19.07% | 46.27% | 73.33% | 87.47% | 0.00% | 0.22% | 0.05% | 0.04% | 0.06% | 0.39% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 10.33% | 45.83% | 19.57% | 46.80% | 74.33% | 87.00% | 0.34% | 0.07% | 0.04% | 0.08% | 0.08% | 2.44% |
| lsa + lookahead | 0.00% | 4.00% | 40.17% | 0.20% | 21.80% | 68.00% | 85.10% | 0.00% | 0.31% | 0.15% | 0.16% | 0.19% | 1.47% |
| lsa + lookahead, Unrated by index | 0.00% | 4.83% | 42.33% | 0.17% | 20.70% | 65.87% | 84.83% | 0.00% | 0.16% | 0.25% | 0.16% | 0.21% | 0.39% |
| lsa + lookahead, Unrated every other pair | 0.00% | 5.17% | 42.83% | 3.47% | 25.30% | 66.93% | 85.63% | 0.00% | 0.26% | 0.30% | 0.27% | 0.29% | 1.08% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 15.33% | 43.50% | 24.47% | 48.47% | 71.70% | 83.27% | 0.14% | 0.14% | 0.28% | 0.16% | 0.22% | 0.39% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 7.07% | 28.19% | 4.94% | 3 / 4 | 0.00% | — (0/100) | 0.00% / 23.03% / 23.13% | — (0/100) | 35.87 (97/100) | 22.93 |
| undecided-least + BALD | 0.00% | 28.43% | 62.24% | 40.28% | 15 / 66 | 0.00% | — (1/100) | 9.50% / 16.70% / 16.70% | — (41/100) | 20.40 | 14.07 |
| undecided-least + BALD, Unrated by index | 0.00% | 28.43% | 62.28% | 40.58% | 14 / 41 | 0.02% | — (2/100) | 9.70% / 17.00% / 17.00% | — (32/100) | 20.40 | 14.07 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 30.76% | 67.58% | 46.02% | 14 / 48 | 0.01% | — (2/100) | 9.47% / 16.70% / 16.70% | — (36/100) | 20.00 | 13.93 |
| undecided-least + μ-proximity | 0.00% | 50.86% | 79.53% | 66.33% | 28 / 169 | 0.55% | — (16/100) | 13.00% / 13.10% / 13.10% | 27.60 | 18.13 | 14.07 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 51.72% | 79.94% | 66.98% | 34 / 153 | 0.43% | — (17/100) | 12.40% / 12.50% / 12.53% | 27.13 | 17.93 | 14.13 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 55.15% | 83.74% | 71.01% | 40 / 158 | 0.56% | — (18/100) | 12.93% / 13.00% / 13.00% | 26.47 | 17.87 | 14.13 |
| lsa + lookahead | 0.00% | 85.55% | 92.36% | 84.85% | 104 / 218 | 1.13% | — (9/100) | 12.30% / 12.97% / 13.33% | 25.40 (99/100) | 17.47 | 14.73 |
| lsa + lookahead, Unrated by index | 0.00% | 85.39% | 92.42% | 85.35% | 86 / 228 | 1.59% | — (18/100) | 12.60% / 13.73% / 14.30% | 25.87 (98/100) | 17.87 | 14.87 |
| lsa + lookahead, Unrated every other pair | 0.00% | 87.28% | 95.01% | 87.56% | 103 / 231 | 1.61% | — (14/100) | 12.20% / 12.93% / 13.37% | 24.33 (98/100) | 17.53 | 14.80 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 24.55% | 58.82% | 39.21% | 13 / 44 | 0.19% | — (3/100) | 9.70% / 16.70% / 16.70% | — (38/100) | 20.00 | 13.93 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.80% | 0.00% | 16.77% | 0.00% | 30–30 |
| undecided-least + BALD | 0.00% | — | 0.13% | 0.00% | 21.73% | 0.00% | 30–30 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.07% | 0.00% | 22.27% | 0.15% | 30–30 |
| undecided-least + BALD, Unrated every other pair | 4.23% | 0.00% | 7.33% | 0.00% | 20.53% | 0.16% | 5–13 |
| undecided-least + μ-proximity | 0.63% | 0.00% | 1.97% | 0.00% | 19.83% | 0.00% | 10–30 |
| undecided-least + μ-proximity, Unrated by index | 0.37% | 0.00% | 1.40% | 0.00% | 19.07% | 0.00% | 10–30 |
| undecided-least + μ-proximity, Unrated every other pair | 3.60% | 1.85% | 6.57% | 0.51% | 19.57% | 0.34% | 5–17 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.20% | 0.00% | 30–30 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.17% | 0.00% | 30–30 |
| lsa + lookahead, Unrated every other pair | 0.40% | 0.00% | 0.03% | 0.00% | 3.47% | 0.00% | 7–30 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.73% | 0.00% | 24.47% | 0.14% | 30–30 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 9.94 | 15 / 20 | 100.00% | 20 / 23 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 93.43% | 30 / 37 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + BALD, Unrated may meet Unrated | 15.00 | 15 / 15 | 100.00% | 15 / 15 |

## n = 30, bradley-terry(noise=1), k = 2.5

100 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.00 | 15.87 (99/100) | 24.47 (88/100) | — (31/100) | — (0/100) | — (5/100) | — (0/100) |
| undecided-least + BALD | 7.93 | 10.13 | 13.20 | 18.40 (99/100) | 32.80 (68/100) | 27.40 (77/100) | 37.93 (52/100) |
| undecided-least + BALD, Unrated by index | 7.80 | 10.07 | 12.67 | 18.00 | 29.40 (74/100) | 24.13 (79/100) | 39.40 (50/100) |
| undecided-least + BALD, Unrated every other pair | 8.07 | 10.07 | 12.87 | 18.13 (99/100) | 32.27 (73/100) | 26.07 (83/100) | — (48/100) |
| undecided-least + μ-proximity | 9.07 | 12.13 | 16.27 (98/100) | 24.20 (87/100) | — (31/100) | 33.60 (65/100) | — (28/100) |
| undecided-least + μ-proximity, Unrated by index | 8.93 | 11.73 | 16.13 | 23.67 (92/100) | — (33/100) | 32.40 (67/100) | — (22/100) |
| undecided-least + μ-proximity, Unrated every other pair | 9.27 | 12.07 | 15.87 (99/100) | 23.80 (90/100) | — (26/100) | 33.20 (64/100) | — (22/100) |
| lsa + lookahead | 12.93 | 16.33 (98/100) | 21.13 (88/100) | 32.47 (61/100) | — (11/100) | — (45/100) | — (11/100) |
| lsa + lookahead, Unrated by index | 13.33 | 16.07 (98/100) | 22.20 (92/100) | 31.60 (69/100) | — (17/100) | — (47/100) | — (10/100) |
| lsa + lookahead, Unrated every other pair | 12.80 | 15.93 (99/100) | 21.53 (91/100) | 33.07 (62/100) | — (12/100) | — (36/100) | — (11/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.67 | 9.93 | 13.13 | 17.80 | 33.33 (65/100) | 25.40 (78/100) | — (42/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 3.83% | 20.00% | 14.47% | 36.10% | 55.77% | 73.37% | 0.46% | 0.55% | 1.14% | 1.09% | 0.97% | 2.20% |
| undecided-least + BALD | 0.00% | 13.17% | 39.17% | 20.27% | 47.60% | 72.90% | 86.47% | 1.48% | 1.68% | 2.01% | 2.43% | 2.25% | 2.80% |
| undecided-least + BALD, Unrated by index | 0.00% | 14.50% | 44.83% | 21.10% | 48.43% | 73.37% | 87.63% | 1.11% | 1.38% | 1.86% | 2.43% | 2.10% | 3.00% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 14.00% | 41.33% | 18.67% | 47.73% | 73.47% | 87.20% | 0.89% | 1.26% | 1.77% | 2.33% | 1.80% | 2.37% |
| undecided-least + μ-proximity | 0.00% | 6.50% | 34.67% | 15.37% | 40.47% | 66.43% | 82.90% | 1.08% | 1.32% | 1.10% | 0.88% | 1.11% | 2.06% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 6.83% | 33.50% | 16.10% | 40.77% | 66.33% | 83.20% | 1.04% | 1.14% | 1.46% | 1.16% | 1.31% | 2.07% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 5.17% | 29.83% | 16.37% | 40.87% | 65.63% | 82.77% | 1.83% | 0.98% | 1.32% | 1.01% | 1.11% | 5.97% |
| lsa + lookahead | 0.00% | 2.17% | 23.00% | 0.13% | 12.90% | 47.97% | 74.47% | 0.00% | 2.07% | 0.49% | 0.63% | 0.80% | 3.33% |
| lsa + lookahead, Unrated by index | 0.00% | 4.00% | 28.00% | 0.17% | 11.83% | 47.10% | 75.37% | 0.00% | 1.13% | 1.49% | 0.80% | 1.09% | 5.33% |
| lsa + lookahead, Unrated every other pair | 0.00% | 1.83% | 23.00% | 2.17% | 13.93% | 46.77% | 74.17% | 0.00% | 0.72% | 1.00% | 0.76% | 0.90% | 1.94% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.67% | 43.50% | 24.90% | 48.67% | 73.70% | 86.37% | 0.80% | 1.23% | 1.58% | 1.74% | 1.56% | 1.90% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 7.08% | 28.25% | 4.79% | 3 / 4 | 0.00% | — (0/100) | 0.00% / 26.63% / 26.63% | — (0/100) | 35.20 | 22.27 |
| undecided-least + BALD | 0.00% | 37.68% | 65.33% | 44.68% | 18 / 54 | 1.43% | — (12/100) | 3.80% / 13.50% / 13.53% | — (33/100) | 20.40 | 14.13 |
| undecided-least + BALD, Unrated by index | 0.00% | 39.14% | 65.76% | 45.32% | 20 / 65 | 1.88% | — (15/100) | 3.63% / 12.33% / 12.33% | — (39/100) | 20.53 | 14.07 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 39.64% | 70.27% | 49.95% | 20 / 54 | 1.43% | — (10/100) | 4.23% / 12.67% / 12.67% | — (38/100) | 20.33 | 14.07 |
| undecided-least + μ-proximity | 0.00% | 41.51% | 75.89% | 59.81% | 18 / 136 | 0.02% | — (5/100) | 16.87% / 17.07% / 17.10% | 30.93 | 19.40 | 14.80 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 41.34% | 75.91% | 60.19% | 15 / 86 | 0.14% | — (7/100) | 16.60% / 16.80% / 16.80% | 30.33 | 19.33 | 14.80 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 41.30% | 78.97% | 62.28% | 18 / 123 | 0.01% | — (4/100) | 16.67% / 17.20% / 17.20% | 30.93 (99/100) | 19.67 | 15.07 |
| lsa + lookahead | 0.00% | 81.95% | 90.98% | 80.83% | 43 / 152 | 0.03% | — (1/100) | 18.10% / 23.37% / 23.97% | 33.13 (79/100) | 21.73 | 17.47 |
| lsa + lookahead, Unrated by index | 0.00% | 82.77% | 91.57% | 81.98% | 50 / 178 | 0.00% | — (0/100) | 17.13% / 22.30% / 23.13% | 32.87 (78/100) | 22.40 | 17.47 |
| lsa + lookahead, Unrated every other pair | 0.00% | 83.31% | 93.55% | 83.45% | 43 / 144 | 0.00% | — (0/100) | 19.53% / 23.37% / 24.03% | 33.60 (83/100) | 21.80 | 17.40 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 34.59% | 62.33% | 43.90% | 19 / 66 | 1.13% | — (11/100) | 3.83% / 13.60% / 13.60% | — (28/100) | 20.60 | 14.00 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.60% | 0.00% | 14.47% | 0.46% | 30–30 |
| undecided-least + BALD | 0.00% | — | 0.17% | 0.00% | 20.27% | 1.48% | 30–30 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.10% | 33.33% | 21.10% | 1.11% | 30–30 |
| undecided-least + BALD, Unrated every other pair | 4.17% | 0.00% | 7.37% | 0.45% | 18.67% | 0.89% | 5–16 |
| undecided-least + μ-proximity | 0.43% | 0.00% | 1.40% | 0.00% | 15.37% | 1.08% | 10–30 |
| undecided-least + μ-proximity, Unrated by index | 0.30% | 0.00% | 1.23% | 0.00% | 16.10% | 1.04% | 9–30 |
| undecided-least + μ-proximity, Unrated every other pair | 2.70% | 3.70% | 5.37% | 1.86% | 16.37% | 1.83% | 5–17 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.13% | 0.00% | 30–30 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.17% | 0.00% | 30–30 |
| lsa + lookahead, Unrated every other pair | 0.10% | 0.00% | 0.07% | 0.00% | 2.17% | 0.00% | 7–30 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.67% | 5.00% | 24.90% | 0.80% | 30–30 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 9.94 | 15 / 21 | 100.00% | 20 / 23 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 28 / 28 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 93.61% | 30 / 33 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 51.85% | 54 / 54 |
| undecided-least + BALD, Unrated may meet Unrated | 15.00 | 15 / 15 | 100.00% | 15 / 15 |

## n = 60, thurstone(noise=0.5), k = 2.5

100 libraries per row, budget Each 40, seed 1. 1.0s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.23 | 14.40 | 22.50 | — (31/100) | — (0/100) | — (9/100) | — (0/100) |
| undecided-least + BALD | 8.00 | 10.23 | 14.10 | 22.60 (99/100) | — (7/100) | 29.20 (79/100) | — (9/100) |
| undecided-least + BALD, Unrated by index | 8.07 | 10.23 | 14.07 | 23.10 (99/100) | — (17/100) | 29.13 (79/100) | — (14/100) |
| undecided-least + BALD, Unrated every other pair | 8.00 | 10.20 | 13.80 | 22.87 | — (11/100) | 29.37 (74/100) | — (11/100) |
| undecided-least + μ-proximity | 8.37 | 10.23 | 13.50 | 19.03 | — (49/100) | 22.63 (99/100) | — (45/100) |
| undecided-least + μ-proximity, Unrated by index | 8.17 | 10.40 | 13.37 | 18.70 | 37.13 (58/100) | 22.70 (99/100) | 39.80 (51/100) |
| undecided-least + μ-proximity, Unrated every other pair | 8.23 | 10.47 | 13.50 | 18.40 | 35.80 (55/100) | 21.97 (98/100) | 38.73 (50/100) |
| lsa + lookahead | 9.57 | 11.40 | 13.50 | 17.57 | 31.90 (63/100) | 21.07 (97/100) | 34.87 (62/100) |
| lsa + lookahead, Unrated by index | 9.97 | 11.47 | 13.40 | 17.87 | 32.63 (61/100) | 20.97 | 33.30 (61/100) |
| lsa + lookahead, Unrated every other pair | 9.53 | 11.50 | 13.83 | 17.67 | 32.43 (61/100) | 19.87 (99/100) | 35.07 (56/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.93 | 10.33 | 13.83 | 22.47 | — (11/100) | 30.57 (77/100) | — (9/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.00% | 26.08% | 18.67% | 39.98% | 60.42% | 77.07% | 0.18% | 0.08% | 0.03% | 0.04% | 0.05% | 0.56% |
| undecided-least + BALD | 0.00% | 14.33% | 42.83% | 21.07% | 48.17% | 71.67% | 83.83% | 0.08% | 0.24% | 0.14% | 0.04% | 0.11% | 1.17% |
| undecided-least + BALD, Unrated by index | 0.00% | 14.25% | 41.58% | 21.30% | 48.10% | 71.05% | 84.02% | 0.00% | 0.10% | 0.12% | 0.08% | 0.09% | 0.48% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 15.75% | 43.25% | 19.90% | 48.70% | 71.90% | 83.83% | 0.00% | 0.03% | 0.12% | 0.06% | 0.07% | 0.74% |
| undecided-least + μ-proximity | 0.00% | 12.00% | 45.33% | 18.40% | 46.07% | 74.03% | 88.03% | 0.00% | 0.11% | 0.16% | 0.08% | 0.11% | 0.21% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 10.50% | 46.83% | 19.38% | 46.88% | 74.63% | 88.32% | 0.17% | 0.07% | 0.18% | 0.15% | 0.16% | 0.75% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 10.50% | 45.75% | 18.87% | 45.95% | 73.92% | 88.20% | 0.09% | 0.11% | 0.07% | 0.04% | 0.06% | 1.13% |
| lsa + lookahead | 0.00% | 5.08% | 41.50% | 0.15% | 20.53% | 67.15% | 87.28% | 0.00% | 0.41% | 0.25% | 0.27% | 0.26% | 0.60% |
| lsa + lookahead, Unrated by index | 0.00% | 5.00% | 39.67% | 0.05% | 17.48% | 67.48% | 86.92% | 0.00% | 0.10% | 0.25% | 0.13% | 0.18% | 0.39% |
| lsa + lookahead, Unrated every other pair | 0.00% | 5.67% | 42.67% | 3.22% | 24.07% | 69.40% | 85.68% | 0.00% | 0.42% | 0.17% | 0.14% | 0.18% | 1.38% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 15.17% | 42.75% | 21.43% | 48.70% | 71.12% | 83.93% | 0.00% | 0.00% | 0.05% | 0.02% | 0.03% | 0.13% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 3.52% | 13.88% | 1.13% | 3 / 4 | 0.00% | — (0/100) | 0.00% / 22.93% / 22.93% | — (0/100) | 35.70 | 23.07 |
| undecided-least + BALD | 0.00% | 18.98% | 35.04% | 15.61% | 16 / 36 | 0.00% | — (0/100) | 10.42% / 16.17% / 16.17% | — (32/100) | 20.80 | 14.17 |
| undecided-least + BALD, Unrated by index | 0.00% | 19.08% | 34.98% | 15.54% | 16 / 51 | 0.00% | — (0/100) | 10.77% / 15.97% / 15.97% | — (23/100) | 20.90 | 14.17 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 21.23% | 40.23% | 20.18% | 16 / 52 | 0.00% | — (0/100) | 10.35% / 16.17% / 16.17% | — (24/100) | 20.63 | 14.13 |
| undecided-least + μ-proximity | 0.00% | 26.43% | 59.36% | 39.38% | 23 / 111 | 0.00% | — (1/100) | 11.93% / 11.97% / 11.97% | 27.23 | 17.97 | 14.07 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 27.12% | 60.19% | 40.76% | 21 / 110 | 0.01% | — (1/100) | 11.67% / 11.68% / 11.68% | 26.87 | 17.87 | 13.90 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 27.67% | 63.81% | 42.12% | 19 / 95 | 0.00% | — (0/100) | 11.75% / 11.78% / 11.78% | 27.13 | 18.33 | 14.30 |
| lsa + lookahead | 0.00% | 79.86% | 88.44% | 78.16% | 68 / 269 | 0.02% | — (1/100) | 11.08% / 11.73% / 12.03% | 24.93 | 18.13 | 15.27 |
| lsa + lookahead, Unrated by index | 0.00% | 80.25% | 88.51% | 78.48% | 74 / 209 | 0.11% | — (1/100) | 10.90% / 11.50% / 11.88% | 25.47 | 17.70 | 15.47 |
| lsa + lookahead, Unrated every other pair | 0.00% | 81.87% | 91.80% | 81.45% | 66 / 219 | 0.00% | — (0/100) | 11.20% / 11.97% / 12.48% | 24.70 | 18.00 | 15.07 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.97% | 30.82% | 14.37% | 16 / 40 | 0.00% | — (0/100) | 10.48% / 16.07% / 16.07% | — (26/100) | 20.83 | 13.93 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.02% | 0.00% | 1.65% | 0.00% | 18.67% | 0.18% | 45–60 |
| undecided-least + BALD | 0.00% | — | 0.10% | 0.00% | 21.07% | 0.08% | 60–60 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.00% | — | 21.30% | 0.00% | 60–60 |
| undecided-least + BALD, Unrated every other pair | 3.85% | 0.00% | 8.65% | 0.00% | 19.90% | 0.00% | 5–12 |
| undecided-least + μ-proximity | 0.93% | 0.00% | 2.18% | 0.00% | 18.40% | 0.00% | 10–60 |
| undecided-least + μ-proximity, Unrated by index | 0.70% | 0.00% | 1.88% | 0.00% | 19.38% | 0.17% | 10–60 |
| undecided-least + μ-proximity, Unrated every other pair | 3.28% | 0.00% | 7.87% | 0.42% | 18.87% | 0.09% | 5–15 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.15% | 0.00% | 60–60 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.05% | 0.00% | 60–60 |
| lsa + lookahead, Unrated every other pair | 0.03% | 0.00% | 0.18% | 0.00% | 3.22% | 0.00% | 7–32 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.00% | — | 21.43% | 0.00% | 60–60 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 19.42 | 34 / 41 | 100.00% | 40 / 44 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 92.65% | 62 / 75 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + BALD, Unrated may meet Unrated | 30.00 | 30 / 30 | 100.00% | 30 / 30 |

## n = 60, thurstone(noise=1), k = 2.5

100 libraries per row, budget Each 40, seed 1. 1.0s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.57 | 16.63 | 25.50 (95/100) | — (16/100) | — (0/100) | — (0/100) | — (0/100) |
| undecided-least + BALD | 8.07 | 10.27 | 13.10 | 19.10 | 35.20 (67/100) | 33.37 (78/100) | — (30/100) |
| undecided-least + BALD, Unrated by index | 8.13 | 10.37 | 13.27 | 18.67 | 34.40 (67/100) | 31.83 (69/100) | — (24/100) |
| undecided-least + BALD, Unrated every other pair | 8.13 | 10.40 | 13.50 | 19.07 | 34.60 (68/100) | 32.97 (65/100) | — (22/100) |
| undecided-least + μ-proximity | 9.30 | 12.40 | 16.23 | 23.87 (97/100) | — (16/100) | 36.63 (58/100) | — (8/100) |
| undecided-least + μ-proximity, Unrated by index | 9.47 | 12.13 | 15.97 | 24.03 (93/100) | — (16/100) | 35.03 (61/100) | — (9/100) |
| undecided-least + μ-proximity, Unrated every other pair | 9.20 | 11.67 | 16.10 | 24.37 (95/100) | — (11/100) | — (49/100) | — (4/100) |
| lsa + lookahead | 13.23 | 17.10 | 23.20 (96/100) | 36.87 (61/100) | — (5/100) | — (23/100) | — (1/100) |
| lsa + lookahead, Unrated by index | 13.63 | 16.67 | 22.13 (98/100) | 36.57 (56/100) | — (3/100) | — (25/100) | — (2/100) |
| lsa + lookahead, Unrated every other pair | 13.00 | 16.33 | 21.93 (97/100) | 36.43 (57/100) | — (7/100) | — (22/100) | — (3/100) |
| undecided-least + BALD, Unrated may meet Unrated | 7.97 | 10.07 | 13.23 | 18.50 | 34.87 (68/100) | 31.90 (71/100) | — (23/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 2.92% | 21.00% | 14.52% | 35.78% | 56.02% | 74.52% | 1.95% | 1.40% | 0.92% | 0.92% | 1.03% | 2.23% |
| undecided-least + BALD | 0.00% | 13.42% | 42.50% | 20.55% | 48.18% | 73.47% | 87.82% | 1.38% | 1.45% | 1.95% | 2.85% | 2.27% | 3.29% |
| undecided-least + BALD, Unrated by index | 0.00% | 13.50% | 41.50% | 20.38% | 47.68% | 73.98% | 88.25% | 1.55% | 1.47% | 1.71% | 2.44% | 2.05% | 2.61% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 13.75% | 42.33% | 19.08% | 47.75% | 73.17% | 87.77% | 0.96% | 1.50% | 1.98% | 2.72% | 2.25% | 2.73% |
| undecided-least + μ-proximity | 0.00% | 7.08% | 36.42% | 15.73% | 41.17% | 67.80% | 84.18% | 0.85% | 1.13% | 1.01% | 0.77% | 0.93% | 1.84% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 8.08% | 36.42% | 14.50% | 41.23% | 67.58% | 84.35% | 1.03% | 1.13% | 1.28% | 1.03% | 1.20% | 2.05% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 6.33% | 33.42% | 15.80% | 41.40% | 67.37% | 83.87% | 0.95% | 1.21% | 1.41% | 1.21% | 1.25% | 1.55% |
| lsa + lookahead | 0.00% | 2.08% | 22.92% | 0.07% | 9.60% | 45.80% | 75.58% | 0.00% | 1.04% | 1.09% | 0.95% | 1.14% | 2.42% |
| lsa + lookahead, Unrated by index | 0.00% | 2.33% | 25.67% | 0.05% | 13.20% | 46.58% | 76.52% | 0.00% | 1.01% | 1.11% | 0.91% | 0.95% | 1.63% |
| lsa + lookahead, Unrated every other pair | 0.00% | 2.25% | 23.50% | 2.82% | 12.02% | 47.75% | 75.57% | 0.59% | 1.66% | 1.36% | 1.08% | 1.23% | 2.70% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.00% | 43.17% | 21.85% | 48.85% | 74.13% | 87.85% | 0.92% | 1.64% | 2.02% | 2.81% | 2.30% | 2.90% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 3.48% | 13.96% | 1.19% | 2 / 4 | 0.00% | — (0/100) | 0.00% / 25.48% / 25.48% | — (0/100) | 35.13 | 22.37 |
| undecided-least + BALD | 0.00% | 31.18% | 45.83% | 27.42% | 22 / 59 | 0.09% | — (1/100) | 3.77% / 12.15% / 12.15% | — (24/100) | 20.77 | 14.17 |
| undecided-least + BALD, Unrated by index | 0.00% | 32.13% | 46.40% | 28.07% | 23 / 62 | 0.14% | — (2/100) | 3.30% / 11.70% / 11.73% | — (20/100) | 20.73 | 14.17 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 33.94% | 51.35% | 32.59% | 23 / 44 | 0.08% | — (1/100) | 3.40% / 12.18% / 12.20% | — (18/100) | 20.93 | 14.30 |
| undecided-least + μ-proximity | 0.00% | 20.91% | 51.45% | 27.89% | 17 / 60 | 0.00% | — (0/100) | 15.62% / 15.78% / 15.82% | 30.03 | 19.27 | 14.87 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 21.36% | 51.88% | 28.95% | 19 / 92 | 0.00% | — (0/100) | 15.47% / 15.65% / 15.65% | 29.93 | 19.33 | 14.87 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 21.43% | 55.47% | 29.89% | 18 / 76 | 0.00% | — (0/100) | 16.07% / 16.10% / 16.10% | 30.23 | 19.40 | 15.07 |
| lsa + lookahead | 0.00% | 76.96% | 85.69% | 71.22% | 47 / 142 | 0.00% | — (0/100) | 19.60% / 22.25% / 23.02% | 35.23 (85/100) | 23.03 | 18.43 |
| lsa + lookahead, Unrated by index | 0.00% | 77.21% | 86.19% | 72.32% | 49 / 121 | 0.00% | — (0/100) | 19.22% / 21.75% / 22.33% | 35.27 (87/100) | 22.53 | 18.03 |
| lsa + lookahead, Unrated every other pair | 0.00% | 78.31% | 89.00% | 74.84% | 53 / 138 | 0.00% | — (0/100) | 19.10% / 21.80% / 22.52% | 34.60 (86/100) | 22.37 | 17.90 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 27.68% | 42.27% | 26.42% | 22 / 54 | 0.00% | — (0/100) | 3.55% / 12.15% / 12.15% | — (19/100) | 20.53 | 14.00 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.02% | 0.00% | 1.32% | 0.00% | 14.52% | 1.95% | 45–60 |
| undecided-least + BALD | 0.00% | — | 0.08% | 0.00% | 20.55% | 1.38% | 60–60 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.05% | 0.00% | 20.38% | 1.55% | 60–60 |
| undecided-least + BALD, Unrated every other pair | 3.42% | 1.46% | 8.03% | 0.83% | 19.08% | 0.96% | 5–13 |
| undecided-least + μ-proximity | 0.68% | 0.00% | 1.77% | 0.94% | 15.73% | 0.85% | 10–60 |
| undecided-least + μ-proximity, Unrated by index | 0.57% | 0.00% | 1.60% | 1.04% | 14.50% | 1.03% | 11–60 |
| undecided-least + μ-proximity, Unrated every other pair | 2.73% | 0.61% | 6.82% | 0.49% | 15.80% | 0.95% | 5–21 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.07% | 0.00% | 60–60 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.05% | 0.00% | 60–60 |
| lsa + lookahead, Unrated every other pair | 0.07% | 0.00% | 0.18% | 0.00% | 2.82% | 0.59% | 7–57 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.00% | — | 21.85% | 0.92% | 60–60 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 19.36 | 33 / 40 | 100.00% | 41 / 45 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 92.52% | 62 / 75 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + BALD, Unrated may meet Unrated | 30.00 | 30 / 30 | 100.00% | 30 / 30 |

## n = 60, bradley-terry(noise=0.5), k = 2.5

100 libraries per row, budget Each 40, seed 1. 1.0s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.33 | 14.70 | 22.20 | — (48/100) | — (0/100) | — (15/100) | — (0/100) |
| undecided-least + BALD | 8.03 | 10.40 | 14.33 | 22.67 (98/100) | — (8/100) | 30.07 (73/100) | — (12/100) |
| undecided-least + BALD, Unrated by index | 8.00 | 10.33 | 14.03 | 22.90 (98/100) | — (6/100) | 30.40 (75/100) | — (8/100) |
| undecided-least + BALD, Unrated every other pair | 8.17 | 10.23 | 14.40 | 22.53 (98/100) | — (5/100) | 28.60 (81/100) | — (7/100) |
| undecided-least + μ-proximity | 8.17 | 10.40 | 13.37 | 19.23 | 37.23 (57/100) | 22.50 (99/100) | — (48/100) |
| undecided-least + μ-proximity, Unrated by index | 8.20 | 10.37 | 13.43 | 18.67 | 35.20 (61/100) | 22.30 (99/100) | 39.20 (52/100) |
| undecided-least + μ-proximity, Unrated every other pair | 8.43 | 10.50 | 13.57 | 18.60 | 38.23 (52/100) | 22.30 (99/100) | 38.57 (51/100) |
| lsa + lookahead | 9.73 | 11.47 | 13.67 | 17.27 (99/100) | 29.73 (66/100) | 19.70 | 31.47 (69/100) |
| lsa + lookahead, Unrated by index | 9.57 | 11.27 | 13.83 | 17.30 | 31.03 (68/100) | 21.27 | 32.77 (61/100) |
| lsa + lookahead, Unrated every other pair | 9.97 | 11.50 | 13.93 | 17.53 | 30.30 (66/100) | 20.60 (99/100) | 34.00 (67/100) |
| undecided-least + BALD, Unrated may meet Unrated | 8.07 | 10.20 | 14.17 | 23.53 (96/100) | — (9/100) | 31.70 (67/100) | — (6/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.08% | 26.67% | 17.98% | 39.55% | 60.40% | 77.55% | 0.00% | 0.04% | 0.00% | 0.04% | 0.05% | 0.33% |
| undecided-least + BALD | 0.00% | 14.58% | 42.42% | 21.13% | 48.23% | 71.57% | 83.65% | 0.24% | 0.17% | 0.12% | 0.02% | 0.08% | 1.22% |
| undecided-least + BALD, Unrated by index | 0.00% | 14.50% | 43.33% | 21.47% | 48.58% | 71.65% | 83.62% | 0.08% | 0.07% | 0.02% | 0.14% | 0.07% | 0.24% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 14.33% | 41.92% | 19.40% | 47.77% | 71.37% | 83.63% | 0.00% | 0.14% | 0.09% | 0.10% | 0.11% | 0.53% |
| undecided-least + μ-proximity | 0.00% | 10.67% | 46.25% | 18.37% | 47.10% | 73.78% | 88.27% | 0.36% | 0.14% | 0.11% | 0.09% | 0.14% | 0.88% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 10.25% | 44.42% | 19.05% | 47.15% | 73.85% | 88.45% | 0.26% | 0.35% | 0.20% | 0.13% | 0.17% | 1.28% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 9.58% | 43.75% | 19.38% | 46.72% | 73.57% | 88.10% | 0.00% | 0.14% | 0.09% | 0.08% | 0.11% | 0.17% |
| lsa + lookahead | 0.00% | 4.75% | 43.75% | 0.03% | 21.97% | 69.62% | 86.43% | 0.00% | 0.23% | 0.17% | 0.15% | 0.19% | 0.53% |
| lsa + lookahead, Unrated by index | 0.00% | 6.17% | 41.33% | 0.08% | 21.67% | 67.63% | 85.70% | 0.00% | 0.15% | 0.22% | 0.12% | 0.18% | 0.47% |
| lsa + lookahead, Unrated every other pair | 0.00% | 3.83% | 44.50% | 3.08% | 22.27% | 68.33% | 86.83% | 1.08% | 0.52% | 0.27% | 0.17% | 0.24% | 2.72% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.33% | 42.67% | 21.68% | 48.37% | 71.15% | 83.45% | 0.00% | 0.10% | 0.07% | 0.08% | 0.09% | 0.18% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 3.39% | 13.81% | 1.24% | 2 / 4 | 0.00% | — (0/100) | 0.00% / 22.45% / 22.45% | — (0/100) | 35.83 | 22.87 |
| undecided-least + BALD | 0.00% | 19.05% | 35.00% | 15.45% | 17 / 48 | 0.00% | — (0/100) | 10.82% / 16.35% / 16.35% | — (23/100) | 20.57 | 14.23 |
| undecided-least + BALD, Unrated by index | 0.00% | 18.69% | 34.75% | 14.96% | 16 / 49 | 0.00% | — (0/100) | 10.62% / 16.38% / 16.38% | — (25/100) | 20.83 | 14.17 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 20.54% | 39.62% | 19.55% | 16 / 47 | 0.00% | — (0/100) | 10.73% / 16.37% / 16.37% | — (23/100) | 20.73 | 14.23 |
| undecided-least + μ-proximity | 0.00% | 26.48% | 59.70% | 40.00% | 19 / 90 | 0.00% | — (0/100) | 11.73% / 11.73% / 11.73% | 26.93 | 17.97 | 14.00 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 26.41% | 59.64% | 40.33% | 19 / 82 | 0.00% | — (0/100) | 11.48% / 11.52% / 11.53% | 27.00 | 17.93 | 14.00 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 27.07% | 63.39% | 41.49% | 19 / 100 | 0.00% | — (0/100) | 11.88% / 11.90% / 11.90% | 27.27 | 18.27 | 14.47 |
| lsa + lookahead | 0.00% | 80.68% | 88.73% | 78.68% | 70 / 335 | 0.00% | — (0/100) | 10.43% / 11.32% / 11.67% | 24.80 | 18.10 | 15.30 |
| lsa + lookahead, Unrated by index | 0.00% | 80.41% | 88.68% | 78.92% | 72 / 234 | 0.01% | — (1/100) | 11.15% / 11.70% / 12.17% | 25.30 (99/100) | 17.67 | 15.13 |
| lsa + lookahead, Unrated every other pair | 0.00% | 82.30% | 91.88% | 81.61% | 86 / 322 | 0.00% | — (1/100) | 11.23% / 11.80% / 12.13% | 25.40 | 17.57 | 15.33 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.43% | 30.10% | 13.66% | 17 / 51 | 0.00% | — (0/100) | 10.50% / 16.55% / 16.55% | — (21/100) | 20.77 | 14.00 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.97% | 0.00% | 17.98% | 0.00% | 52–60 |
| undecided-least + BALD | 0.00% | — | 0.05% | 0.00% | 21.13% | 0.24% | 60–60 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.02% | 0.00% | 21.47% | 0.08% | 60–60 |
| undecided-least + BALD, Unrated every other pair | 3.97% | 0.00% | 8.87% | 0.00% | 19.40% | 0.00% | 5–11 |
| undecided-least + μ-proximity | 0.95% | 0.00% | 2.18% | 0.00% | 18.37% | 0.36% | 12–60 |
| undecided-least + μ-proximity, Unrated by index | 1.00% | 0.00% | 2.03% | 0.82% | 19.05% | 0.26% | 11–60 |
| undecided-least + μ-proximity, Unrated every other pair | 3.35% | 0.00% | 7.72% | 0.00% | 19.38% | 0.00% | 5–18 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.03% | 0.00% | 33–60 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.08% | 0.00% | 60–60 |
| lsa + lookahead, Unrated every other pair | 0.02% | 0.00% | 0.17% | 0.00% | 3.08% | 1.08% | 7–57 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.00% | — | 21.68% | 0.00% | 60–60 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 19.36 | 32 / 43 | 100.00% | 41 / 45 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 92.21% | 62 / 75 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + BALD, Unrated may meet Unrated | 30.00 | 30 / 30 | 100.00% | 30 / 30 |

## n = 60, bradley-terry(noise=1), k = 2.5

100 libraries per row, budget Each 40, seed 1. 1.0s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.77 | 16.40 | 25.00 (95/100) | — (23/100) | — (0/100) | — (0/100) | — (0/100) |
| undecided-least + BALD | 8.20 | 10.13 | 13.50 | 18.33 | 36.60 (62/100) | 30.90 (73/100) | — (27/100) |
| undecided-least + BALD, Unrated by index | 8.10 | 10.33 | 13.40 | 18.83 | 35.53 (63/100) | 31.13 (68/100) | — (24/100) |
| undecided-least + BALD, Unrated every other pair | 8.20 | 10.20 | 13.63 | 18.87 | 36.60 (58/100) | 33.10 (64/100) | — (22/100) |
| undecided-least + μ-proximity | 9.07 | 11.43 | 15.87 | 24.13 (97/100) | — (10/100) | 35.87 (59/100) | — (9/100) |
| undecided-least + μ-proximity, Unrated by index | 9.30 | 11.83 | 15.73 | 23.53 (99/100) | — (19/100) | 35.00 (66/100) | — (7/100) |
| undecided-least + μ-proximity, Unrated every other pair | 9.60 | 12.00 | 16.03 | 24.60 (96/100) | — (14/100) | 36.23 (60/100) | — (10/100) |
| lsa + lookahead | 13.40 | 16.53 | 22.67 (99/100) | 35.23 (62/100) | — (8/100) | — (24/100) | — (1/100) |
| lsa + lookahead, Unrated by index | 13.23 | 16.03 | 21.80 (97/100) | 30.80 (63/100) | — (11/100) | — (30/100) | — (4/100) |
| lsa + lookahead, Unrated every other pair | 12.70 | 17.00 | 22.33 (96/100) | 32.97 (69/100) | — (10/100) | — (27/100) | — (5/100) |
| undecided-least + BALD, Unrated may meet Unrated | 8.00 | 10.17 | 13.07 | 19.00 | 32.93 (72/100) | 32.57 (72/100) | — (36/100) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.33% | 21.75% | 14.47% | 35.80% | 56.93% | 74.55% | 1.27% | 0.51% | 0.85% | 0.89% | 0.90% | 3.74% |
| undecided-least + BALD | 0.00% | 14.00% | 43.75% | 20.37% | 47.92% | 73.58% | 87.00% | 0.98% | 1.11% | 1.72% | 2.41% | 1.92% | 2.45% |
| undecided-least + BALD, Unrated by index | 0.00% | 13.08% | 42.83% | 20.85% | 48.05% | 73.27% | 87.33% | 1.20% | 1.56% | 1.73% | 2.39% | 2.08% | 2.56% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 13.17% | 41.75% | 19.08% | 47.78% | 73.82% | 87.33% | 0.79% | 1.50% | 2.03% | 2.21% | 2.00% | 2.45% |
| undecided-least + μ-proximity | 0.00% | 8.83% | 34.75% | 16.43% | 41.95% | 68.30% | 84.40% | 0.91% | 1.23% | 1.37% | 1.15% | 1.27% | 2.18% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 7.08% | 34.92% | 15.70% | 41.48% | 68.47% | 84.83% | 0.96% | 1.21% | 1.27% | 1.06% | 1.21% | 4.10% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 6.00% | 33.42% | 16.73% | 40.97% | 68.17% | 84.32% | 0.90% | 0.98% | 1.08% | 0.85% | 0.97% | 1.94% |
| lsa + lookahead | 0.00% | 2.67% | 24.17% | 0.02% | 10.23% | 46.60% | 76.65% | 0.00% | 1.63% | 1.22% | 0.91% | 1.03% | 2.13% |
| lsa + lookahead, Unrated by index | 0.00% | 2.75% | 22.58% | 0.07% | 11.80% | 48.60% | 76.25% | 0.00% | 1.84% | 1.20% | 0.94% | 1.11% | 2.96% |
| lsa + lookahead, Unrated every other pair | 0.00% | 2.50% | 23.42% | 2.53% | 13.80% | 47.80% | 77.33% | 3.95% | 2.05% | 1.46% | 1.12% | 1.33% | 5.00% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.08% | 43.25% | 21.98% | 48.57% | 73.80% | 87.90% | 2.05% | 1.85% | 2.01% | 2.54% | 2.15% | 2.60% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 3.39% | 14.02% | 1.23% | 2 / 3 | 0.00% | — (0/100) | 0.00% / 25.45% / 25.45% | — (0/100) | 35.23 | 22.43 |
| undecided-least + BALD | 0.00% | 31.70% | 46.01% | 27.67% | 23 / 70 | 0.00% | — (0/100) | 3.82% / 12.97% / 12.98% | — (24/100) | 20.50 | 14.10 |
| undecided-least + BALD, Unrated by index | 0.00% | 31.58% | 45.89% | 27.55% | 23 / 79 | 0.01% | — (1/100) | 3.60% / 12.63% / 12.67% | — (14/100) | 20.67 | 14.13 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 33.15% | 50.41% | 31.37% | 22 / 58 | 0.00% | — (1/100) | 3.42% / 12.62% / 12.63% | — (12/100) | 21.00 | 14.20 |
| undecided-least + μ-proximity | 0.00% | 21.56% | 52.21% | 28.62% | 20 / 94 | 0.00% | — (0/100) | 15.53% / 15.60% / 15.60% | 29.60 | 19.27 | 14.70 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 21.72% | 52.68% | 30.01% | 19 / 70 | 0.00% | — (0/100) | 15.13% / 15.17% / 15.17% | 29.70 | 19.13 | 14.70 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 21.66% | 55.59% | 29.86% | 17 / 76 | 0.00% | — (0/100) | 15.65% / 15.68% / 15.68% | 30.13 | 19.50 | 15.20 |
| lsa + lookahead | 0.00% | 76.63% | 85.71% | 71.49% | 49 / 106 | 0.00% | — (0/100) | 19.45% / 21.27% / 21.87% | 34.53 (90/100) | 23.10 | 18.73 |
| lsa + lookahead, Unrated by index | 0.00% | 77.62% | 86.47% | 72.93% | 51 / 121 | 0.00% | — (0/100) | 18.75% / 21.45% / 21.98% | 33.20 (89/100) | 22.37 | 18.10 |
| lsa + lookahead, Unrated every other pair | 0.00% | 78.35% | 88.86% | 74.67% | 49 / 131 | 0.00% | — (0/100) | 18.52% / 20.67% / 21.32% | 33.37 (86/100) | 22.60 | 18.10 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 27.84% | 42.52% | 26.86% | 22 / 56 | 0.00% | — (0/100) | 3.53% / 12.07% / 12.10% | — (27/100) | 20.70 | 13.93 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.43% | 3.49% | 14.47% | 1.27% | 52–60 |
| undecided-least + BALD | 0.00% | — | 0.02% | 0.00% | 20.37% | 0.98% | 60–60 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.02% | 0.00% | 20.85% | 1.20% | 60–60 |
| undecided-least + BALD, Unrated every other pair | 3.77% | 0.88% | 8.08% | 0.62% | 19.08% | 0.79% | 5–16 |
| undecided-least + μ-proximity | 0.80% | 0.00% | 1.57% | 0.00% | 16.43% | 0.91% | 12–60 |
| undecided-least + μ-proximity, Unrated by index | 0.55% | 6.06% | 1.62% | 5.15% | 15.70% | 0.96% | 12–60 |
| undecided-least + μ-proximity, Unrated every other pair | 2.68% | 0.00% | 6.83% | 1.22% | 16.73% | 0.90% | 5–22 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.02% | 0.00% | 60–60 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.07% | 0.00% | 60–60 |
| lsa + lookahead, Unrated every other pair | 0.02% | 0.00% | 0.17% | 0.00% | 2.53% | 3.95% | 7–51 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.00% | — | 21.98% | 2.05% | 60–60 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 19.29 | 32 / 43 | 100.00% | 41 / 44 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 58 / 58 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 92.49% | 62 / 74 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.88% | 114 / 114 |
| undecided-least + BALD, Unrated may meet Unrated | 30.00 | 30 / 30 | 100.00% | 30 / 30 |

