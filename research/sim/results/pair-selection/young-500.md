## n = 500, thurstone(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 12.7s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.70 | 15.55 | 24.05 | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.70 | 14.74 | 25.68 | — (0/20) | 34.85 (16/20) | — (0/20) |
| undecided-least + BALD, Unrated by index | 8.21 | 10.70 | 14.98 | 26.98 | — (0/20) | 36.86 (13/20) | — (0/20) |
| undecided-least + BALD, Unrated every other pair | 8.21 | 10.56 | 14.64 | 25.10 | — (0/20) | 32.35 (16/20) | — (0/20) |
| undecided-least + μ-proximity | 8.35 | 10.27 | 13.34 | 18.82 | 38.93 (11/20) | 22.37 | — (8/20) |
| undecided-least + μ-proximity, Unrated by index | 8.35 | 10.37 | 13.34 | 18.72 | — (5/20) | 22.46 | — (4/20) |
| undecided-least + μ-proximity, Unrated every other pair | 8.54 | 10.46 | 13.34 | 18.43 | — (8/20) | 22.32 | — (6/20) |
| lsa + lookahead | 9.65 | 11.18 | 13.78 | 17.57 | 35.71 (15/20) | 20.83 | 39.74 (11/20) |
| lsa + lookahead, Unrated by index | 9.89 | 11.47 | 13.97 | 17.62 | 33.26 (14/20) | 21.07 | 37.25 (10/20) |
| lsa + lookahead, Unrated every other pair | 9.65 | 11.14 | 14.16 | 18.00 | 33.89 (13/20) | 21.26 | 34.22 (14/20) |
| undecided-least + BALD, Unrated may meet Unrated | 8.30 | 10.56 | 14.74 | 24.53 | — (0/20) | 33.22 (15/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.50% | 27.25% | 18.32% | 39.72% | 60.77% | 77.64% | 0.11% | 0.10% | 0.02% | 0.00% | 0.02% | 0.72% |
| undecided-least + BALD | 0.00% | 14.30% | 42.60% | 21.45% | 48.56% | 71.70% | 83.87% | 0.05% | 0.04% | 0.06% | 0.00% | 0.03% | 0.44% |
| undecided-least + BALD, Unrated by index | 0.00% | 14.45% | 42.45% | 21.49% | 48.33% | 71.43% | 83.46% | 0.19% | 0.14% | 0.04% | 0.01% | 0.04% | 0.20% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 15.25% | 42.70% | 20.74% | 48.60% | 71.45% | 84.06% | 0.14% | 0.12% | 0.07% | 0.01% | 0.05% | 0.58% |
| undecided-least + μ-proximity | 0.00% | 11.45% | 49.75% | 19.54% | 47.68% | 75.72% | 89.56% | 0.00% | 0.08% | 0.12% | 0.08% | 0.10% | 0.15% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 11.10% | 48.70% | 19.27% | 48.17% | 75.74% | 89.16% | 0.05% | 0.10% | 0.11% | 0.08% | 0.12% | 0.18% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 9.85% | 48.55% | 20.17% | 47.47% | 75.61% | 89.43% | 0.15% | 0.13% | 0.11% | 0.09% | 0.10% | 0.49% |
| lsa + lookahead | 0.00% | 4.05% | 42.45% | 0.10% | 20.14% | 71.66% | 86.57% | 0.00% | 0.40% | 0.32% | 0.22% | 0.28% | 0.51% |
| lsa + lookahead, Unrated by index | 0.00% | 4.65% | 45.35% | 0.07% | 17.87% | 63.43% | 83.78% | 0.00% | 0.22% | 0.35% | 0.29% | 0.33% | 0.90% |
| lsa + lookahead, Unrated every other pair | 0.00% | 6.35% | 41.60% | 4.11% | 24.58% | 71.02% | 87.77% | 0.24% | 0.45% | 0.38% | 0.27% | 0.33% | 0.79% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.55% | 43.15% | 20.45% | 48.40% | 71.24% | 83.77% | 0.00% | 0.02% | 0.04% | 0.02% | 0.04% | 0.09% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.57% | 0.02% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 22.36% / 22.36% | — (0/20) | 36.53 | 23.52 |
| undecided-least + BALD | 0.00% | 15.25% | 21.19% | 11.17% | 22 / 36 | 0.00% | — (0/20) | 11.47% / 16.13% / 16.13% | — (0/20) | 22.13 | 14.64 |
| undecided-least + BALD, Unrated by index | 0.00% | 15.09% | 21.09% | 11.17% | 23 / 36 | 0.00% | — (0/20) | 11.57% / 16.53% / 16.53% | — (0/20) | 21.94 | 14.64 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 16.28% | 25.77% | 15.04% | 25 / 57 | 0.00% | — (0/20) | 12.00% / 15.94% / 15.94% | — (0/20) | 21.84 | 14.64 |
| undecided-least + μ-proximity | 0.00% | 7.13% | 12.52% | 4.70% | 37 / 108 | 0.00% | — (0/20) | 10.44% / 10.44% / 10.44% | 25.92 | 17.62 | 14.11 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 7.18% | 12.42% | 4.72% | 42 / 87 | 0.00% | — (0/20) | 10.84% / 10.84% / 10.84% | 25.97 | 17.76 | 14.11 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 7.18% | 17.19% | 4.91% | 45 / 90 | 0.00% | — (0/20) | 10.57% / 10.57% / 10.57% | 26.16 | 18.24 | 14.74 |
| lsa + lookahead | 0.00% | 74.87% | 79.43% | 64.62% | 115 / 211 | 0.00% | — (0/20) | 10.18% / 10.52% / 10.84% | 24.58 | 19.82 | 18.96 |
| lsa + lookahead, Unrated by index | 0.00% | 74.95% | 79.70% | 65.19% | 109 / 158 | 0.00% | — (0/20) | 10.29% / 11.05% / 11.77% | 25.25 | 20.50 | 19.82 |
| lsa + lookahead, Unrated every other pair | 0.00% | 76.46% | 83.48% | 67.90% | 109 / 199 | 0.00% | — (0/20) | 9.90% / 10.13% / 10.47% | 24.72 | 19.82 | 18.77 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 10.58% | 16.48% | 10.00% | 25 / 46 | 0.00% | — (0/20) | 11.22% / 16.23% / 16.23% | — (0/20) | 22.13 | 14.45 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.98% | 1.01% | 18.32% | 0.11% | 500–500 |
| undecided-least + BALD | 0.00% | — | 0.00% | — | 21.45% | 0.05% | 500–500 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.02% | 0.00% | 21.49% | 0.19% | 500–500 |
| undecided-least + BALD, Unrated every other pair | 4.95% | 0.00% | 10.15% | 0.30% | 20.74% | 0.14% | 5–10 |
| undecided-least + μ-proximity | 1.11% | 0.00% | 2.34% | 0.00% | 19.54% | 0.00% | 11–130 |
| undecided-least + μ-proximity, Unrated by index | 1.07% | 0.00% | 2.27% | 0.00% | 19.27% | 0.05% | 10–124 |
| undecided-least + μ-proximity, Unrated every other pair | 4.55% | 0.44% | 9.65% | 0.10% | 20.17% | 0.15% | 5–15 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.10% | 0.00% | 58–500 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.03% | 0.00% | 0.07% | 0.00% | 223–500 |
| lsa + lookahead, Unrated every other pair | 0.56% | 0.00% | 1.89% | 0.00% | 4.11% | 0.24% | 7–30 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.30% | 0.00% | 20.45% | 0.00% | 500–500 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 160.75 | 315 / 339 | 100.00% | 339 / 348 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 91.40% | 548 / 568 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + BALD, Unrated may meet Unrated | 250.00 | 250 / 250 | 100.00% | 250 / 250 |

## n = 500, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 12.9s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.14 | 17.76 | 27.31 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| undecided-least + BALD, Unrated by index | 8.40 | 10.42 | 13.63 | 19.58 | 38.78 (11/20) | 33.36 (18/20) | — (1/20) |
| undecided-least + BALD, Unrated every other pair | 8.21 | 10.51 | 13.73 | 19.68 | 39.94 (10/20) | 34.66 (16/20) | — (1/20) |
| undecided-least + μ-proximity | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| undecided-least + μ-proximity, Unrated by index | 9.60 | 12.14 | 16.37 | 24.72 | — (0/20) | 38.02 (13/20) | — (0/20) |
| undecided-least + μ-proximity, Unrated every other pair | 9.50 | 12.24 | 16.13 | 24.24 | — (0/20) | 38.59 (12/20) | — (0/20) |
| lsa + lookahead | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, Unrated by index | 13.58 | 16.94 | 21.65 | 33.60 (19/20) | — (0/20) | — (1/20) | — (0/20) |
| lsa + lookahead, Unrated every other pair | 12.86 | 16.51 | 21.02 | 31.01 (19/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD, Unrated may meet Unrated | 8.16 | 10.42 | 13.54 | 18.82 | 35.86 (18/20) | 32.64 (17/20) | — (2/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.60% | 23.35% | 14.66% | 36.45% | 57.51% | 75.09% | 0.55% | 0.80% | 0.87% | 0.69% | 0.72% | 0.94% |
| undecided-least + BALD | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 89.83% | 0.92% | 1.09% | 1.29% | 2.32% | 1.66% | 2.32% |
| undecided-least + BALD, Unrated by index | 0.00% | 13.15% | 44.05% | 20.61% | 47.97% | 74.52% | 89.86% | 1.16% | 1.56% | 1.61% | 2.74% | 2.18% | 2.80% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 13.80% | 43.45% | 19.79% | 48.43% | 74.51% | 89.59% | 0.66% | 1.26% | 1.66% | 2.53% | 1.94% | 2.62% |
| undecided-least + μ-proximity | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 85.67% | 1.04% | 1.20% | 1.19% | 1.02% | 1.15% | 1.34% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 7.70% | 36.40% | 15.24% | 42.03% | 68.86% | 85.64% | 1.38% | 1.09% | 1.44% | 1.00% | 1.21% | 1.52% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 6.65% | 37.45% | 16.89% | 42.41% | 69.02% | 85.67% | 0.59% | 1.01% | 1.20% | 1.13% | 1.19% | 2.01% |
| lsa + lookahead | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 78.35% | 0.00% | 1.68% | 1.26% | 0.98% | 1.12% | 2.68% |
| lsa + lookahead, Unrated by index | 0.00% | 1.65% | 25.80% | 0.04% | 10.77% | 49.40% | 78.86% | 0.00% | 1.58% | 1.52% | 1.01% | 1.20% | 2.17% |
| lsa + lookahead, Unrated every other pair | 0.00% | 2.70% | 26.55% | 3.27% | 17.37% | 50.45% | 80.48% | 0.92% | 1.61% | 1.59% | 1.17% | 1.37% | 2.34% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.40% | 45.75% | 19.87% | 48.80% | 75.21% | 90.32% | 0.81% | 1.11% | 1.38% | 2.66% | 1.88% | 2.73% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.63% | 0.02% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 24.91% / 24.91% | — (0/20) | 35.90 | 23.23 |
| undecided-least + BALD | 0.00% | 28.11% | 35.32% | 23.09% | 39 / 60 | 0.00% | — (0/20) | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| undecided-least + BALD, Unrated by index | 0.00% | 28.71% | 35.95% | 23.65% | 41 / 83 | 0.00% | — (0/20) | 4.30% / 10.14% / 10.14% | — (1/20) | 21.70 | 14.74 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 30.60% | 41.20% | 27.78% | 38 / 71 | 0.00% | — (0/20) | 3.78% / 10.38% / 10.39% | — (0/20) | 22.08 | 14.74 |
| undecided-least + μ-proximity | 0.00% | 6.61% | 10.82% | 4.29% | 39 / 81 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 6.92% | 10.96% | 4.51% | 42 / 84 | 0.00% | — (0/20) | 14.36% / 14.36% / 14.36% | 29.33 | 19.25 | 14.83 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 7.10% | 15.95% | 4.93% | 46 / 74 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 29.66 | 19.78 | 15.65 |
| lsa + lookahead | 0.00% | 73.49% | 78.39% | 61.38% | 85 / 105 | 0.00% | — (0/20) | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |
| lsa + lookahead, Unrated by index | 0.00% | 74.10% | 78.94% | 62.23% | 92 / 137 | 0.00% | — (0/20) | 18.15% / 18.76% / 19.16% | 34.42 | 22.90 | 21.07 |
| lsa + lookahead, Unrated every other pair | 0.00% | 75.07% | 82.10% | 64.54% | 85 / 167 | 0.00% | — (0/20) | 18.22% / 18.67% / 18.86% | 32.45 | 22.66 | 19.92 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 24.71% | 31.83% | 22.77% | 40 / 69 | 0.00% | — (0/20) | 4.96% / 9.68% / 9.68% | — (0/20) | 21.89 | 14.21 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.48% | 0.00% | 14.66% | 0.55% | 500–500 |
| undecided-least + BALD | 0.00% | — | 0.00% | — | 20.55% | 0.92% | 500–500 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.00% | — | 20.61% | 1.16% | 500–500 |
| undecided-least + BALD, Unrated every other pair | 4.66% | 0.21% | 9.86% | 0.51% | 19.79% | 0.66% | 5–13 |
| undecided-least + μ-proximity | 0.90% | 0.00% | 1.93% | 0.00% | 16.27% | 1.04% | 11–157 |
| undecided-least + μ-proximity, Unrated by index | 0.86% | 0.00% | 1.97% | 0.51% | 15.24% | 1.38% | 10–164 |
| undecided-least + μ-proximity, Unrated every other pair | 4.10% | 1.22% | 8.00% | 1.12% | 16.89% | 0.59% | 5–29 |
| lsa + lookahead | 0.00% | — | 0.01% | 0.00% | 0.03% | 0.00% | 68–500 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.02% | 0.00% | 0.04% | 0.00% | 127–500 |
| lsa + lookahead, Unrated every other pair | 0.47% | 0.00% | 1.77% | 0.56% | 3.27% | 0.92% | 9–42 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.14% | 0.00% | 19.87% | 0.81% | 500–500 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 160.10 | 311 / 343 | 100.00% | 340 / 347 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 91.86% | 540 / 583 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + BALD, Unrated may meet Unrated | 250.00 | 250 / 250 | 100.00% | 250 / 250 |

## n = 500, bradley-terry(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 12.8s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.04 | 15.65 | 24.38 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.21 | 10.90 | 14.88 | 25.82 | — (0/20) | 36.86 (14/20) | — (0/20) |
| undecided-least + BALD, Unrated by index | 8.30 | 10.80 | 14.88 | 26.06 | — (0/20) | 36.00 (17/20) | — (0/20) |
| undecided-least + BALD, Unrated every other pair | 8.30 | 10.70 | 14.93 | 25.34 | — (0/20) | 34.42 (14/20) | — (0/20) |
| undecided-least + μ-proximity | 8.40 | 10.37 | 13.44 | 18.62 | — (8/20) | 22.51 | — (7/20) |
| undecided-least + μ-proximity, Unrated by index | 8.35 | 10.37 | 13.44 | 18.96 | — (6/20) | 23.14 | — (7/20) |
| undecided-least + μ-proximity, Unrated every other pair | 8.40 | 10.51 | 13.54 | 18.53 | 39.22 (10/20) | 22.27 | — (7/20) |
| lsa + lookahead | 10.03 | 11.42 | 13.87 | 17.33 | 30.34 (19/20) | 20.59 | 30.53 (17/20) |
| lsa + lookahead, Unrated by index | 9.74 | 11.62 | 14.02 | 17.52 | 34.13 (15/20) | 20.64 | 36.82 (14/20) |
| lsa + lookahead, Unrated every other pair | 9.98 | 11.52 | 14.02 | 17.86 | 30.10 (17/20) | 20.74 | 33.70 (16/20) |
| undecided-least + BALD, Unrated may meet Unrated | 8.16 | 10.70 | 14.64 | 26.69 | — (0/20) | 34.32 (17/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 6.05% | 27.65% | 17.20% | 38.97% | 60.49% | 77.42% | 0.00% | 0.03% | 0.07% | 0.03% | 0.03% | 0.44% |
| undecided-least + BALD | 0.00% | 13.65% | 42.70% | 21.32% | 48.43% | 71.64% | 83.55% | 0.09% | 0.08% | 0.04% | 0.01% | 0.04% | 0.15% |
| undecided-least + BALD, Unrated by index | 0.00% | 14.55% | 42.80% | 20.99% | 48.16% | 71.43% | 84.08% | 0.14% | 0.08% | 0.06% | 0.00% | 0.05% | 0.81% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 14.65% | 42.45% | 20.42% | 48.45% | 71.57% | 83.92% | 0.05% | 0.06% | 0.04% | 0.01% | 0.04% | 0.30% |
| undecided-least + μ-proximity | 0.00% | 11.15% | 48.35% | 19.39% | 47.49% | 75.56% | 89.39% | 0.10% | 0.13% | 0.13% | 0.06% | 0.09% | 0.17% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 11.35% | 49.05% | 19.51% | 47.86% | 75.39% | 89.33% | 0.26% | 0.08% | 0.09% | 0.08% | 0.09% | 0.62% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 9.00% | 48.55% | 19.73% | 47.45% | 75.90% | 89.41% | 0.15% | 0.19% | 0.12% | 0.09% | 0.12% | 0.47% |
| lsa + lookahead | 0.00% | 6.00% | 38.95% | 0.02% | 15.45% | 74.16% | 86.25% | 0.00% | 0.32% | 0.31% | 0.29% | 0.32% | 0.72% |
| lsa + lookahead, Unrated by index | 0.00% | 5.15% | 48.40% | 0.14% | 20.75% | 65.43% | 89.02% | 0.00% | 0.29% | 0.38% | 0.24% | 0.30% | 1.02% |
| lsa + lookahead, Unrated every other pair | 0.00% | 4.35% | 43.90% | 4.33% | 26.60% | 72.89% | 84.63% | 0.92% | 0.30% | 0.32% | 0.27% | 0.31% | 2.05% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.45% | 43.15% | 20.26% | 48.58% | 71.39% | 84.00% | 0.05% | 0.04% | 0.10% | 0.00% | 0.05% | 0.13% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.42% | 1.66% | 0.01% | 2 / 2 | 0.00% | — (0/20) | 0.00% / 22.58% / 22.58% | — (0/20) | 36.43 | 23.42 |
| undecided-least + BALD | 0.00% | 15.23% | 21.09% | 11.25% | 22 / 78 | 0.00% | — (0/20) | 11.35% / 16.45% / 16.45% | — (0/20) | 21.94 | 14.50 |
| undecided-least + BALD, Unrated by index | 0.00% | 14.66% | 20.62% | 10.78% | 24 / 43 | 0.00% | — (0/20) | 12.06% / 15.92% / 15.92% | — (0/20) | 21.94 | 14.59 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 16.17% | 25.63% | 15.10% | 20 / 31 | 0.00% | — (0/20) | 11.84% / 16.08% / 16.08% | — (0/20) | 21.98 | 14.74 |
| undecided-least + μ-proximity | 0.00% | 7.21% | 12.48% | 4.83% | 44 / 101 | 0.00% | — (0/20) | 10.61% / 10.61% / 10.61% | 25.97 | 17.76 | 14.16 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 6.81% | 12.02% | 4.55% | 42 / 125 | 0.00% | — (0/20) | 10.66% / 10.67% / 10.67% | 26.21 | 17.76 | 14.06 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 7.08% | 17.17% | 4.89% | 44 / 91 | 0.00% | — (0/20) | 10.59% / 10.59% / 10.59% | 25.92 | 18.05 | 14.83 |
| lsa + lookahead | 0.00% | 74.79% | 79.56% | 64.79% | 99 / 227 | 0.00% | — (0/20) | 9.57% / 10.21% / 10.73% | 24.67 | 19.58 | 18.58 |
| lsa + lookahead, Unrated by index | 0.00% | 75.17% | 79.98% | 65.44% | 130 / 190 | 0.00% | — (0/20) | 9.72% / 9.95% / 10.08% | 25.68 | 19.54 | 19.15 |
| lsa + lookahead, Unrated every other pair | 0.00% | 76.47% | 83.45% | 67.82% | 113 / 212 | 0.00% | — (0/20) | 9.97% / 10.79% / 11.38% | 24.77 | 20.40 | 19.92 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 10.20% | 16.09% | 9.70% | 23 / 38 | 0.00% | — (0/20) | 11.56% / 16.00% / 16.00% | — (0/20) | 22.03 | 14.30 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.01% | 0.00% | 2.12% | 0.00% | 17.20% | 0.00% | 335–500 |
| undecided-least + BALD | 0.00% | — | 0.02% | 0.00% | 21.32% | 0.09% | 500–500 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.04% | 0.00% | 20.99% | 0.14% | 500–500 |
| undecided-least + BALD, Unrated every other pair | 4.85% | 0.21% | 10.02% | 0.10% | 20.42% | 0.05% | 5–11 |
| undecided-least + μ-proximity | 1.12% | 0.00% | 2.29% | 0.00% | 19.39% | 0.10% | 13–88 |
| undecided-least + μ-proximity, Unrated by index | 1.03% | 0.97% | 2.48% | 0.40% | 19.51% | 0.26% | 16–205 |
| undecided-least + μ-proximity, Unrated every other pair | 4.88% | 0.20% | 9.14% | 0.33% | 19.73% | 0.15% | 5–14 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.02% | 0.00% | 317–500 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.03% | 0.00% | 0.14% | 0.00% | 245–500 |
| lsa + lookahead, Unrated every other pair | 0.73% | 0.00% | 1.59% | 1.26% | 4.33% | 0.92% | 7–20 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.17% | 0.00% | 20.26% | 0.05% | 500–500 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 158.80 | 315 / 348 | 100.00% | 340 / 354 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 90.01% | 554 / 588 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + BALD, Unrated may meet Unrated | 250.00 | 250 / 250 | 100.00% | 250 / 250 |

## n = 500, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 12.8s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.19 | 17.76 | 28.66 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| undecided-least + BALD, Unrated by index | 8.35 | 10.46 | 13.73 | 19.20 | 38.74 (13/20) | 35.71 (18/20) | — (1/20) |
| undecided-least + BALD, Unrated every other pair | 8.30 | 10.46 | 13.87 | 19.58 | 39.22 (11/20) | 35.66 (16/20) | — (1/20) |
| undecided-least + μ-proximity | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| undecided-least + μ-proximity, Unrated by index | 9.46 | 12.34 | 16.32 | 24.38 | — (0/20) | 36.96 (13/20) | — (0/20) |
| undecided-least + μ-proximity, Unrated every other pair | 9.60 | 12.24 | 16.27 | 24.05 | — (0/20) | 37.30 (14/20) | — (0/20) |
| lsa + lookahead | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |
| lsa + lookahead, Unrated by index | 12.91 | 16.56 | 21.26 | 32.11 (18/20) | — (0/20) | — (1/20) | — (0/20) |
| lsa + lookahead, Unrated every other pair | 12.53 | 16.13 | 21.26 | 32.78 (19/20) | — (0/20) | — (1/20) | — (0/20) |
| undecided-least + BALD, Unrated may meet Unrated | 8.21 | 10.32 | 13.34 | 19.49 | 37.44 (10/20) | 36.38 (17/20) | — (1/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.45% | 23.40% | 14.87% | 35.97% | 57.42% | 75.01% | 0.67% | 0.78% | 0.75% | 0.57% | 0.68% | 1.94% |
| undecided-least + BALD | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.79% | 0.95% | 1.12% | 1.46% | 2.58% | 1.88% | 3.08% |
| undecided-least + BALD, Unrated by index | 0.00% | 13.30% | 44.90% | 20.51% | 47.82% | 74.80% | 89.87% | 0.98% | 1.28% | 1.66% | 2.34% | 1.96% | 2.38% |
| undecided-least + BALD, Unrated every other pair | 0.00% | 12.85% | 43.15% | 20.57% | 48.19% | 74.27% | 89.72% | 1.02% | 1.33% | 1.82% | 2.28% | 1.90% | 2.31% |
| undecided-least + μ-proximity | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 85.57% | 0.64% | 0.95% | 1.19% | 0.81% | 1.02% | 1.35% |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 7.95% | 37.00% | 15.71% | 41.95% | 69.26% | 85.80% | 0.83% | 0.95% | 1.14% | 0.78% | 0.93% | 1.65% |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 7.05% | 35.80% | 16.84% | 41.81% | 69.24% | 85.71% | 0.95% | 1.17% | 1.27% | 0.95% | 1.11% | 1.42% |
| lsa + lookahead | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 76.89% | 0.00% | 1.97% | 1.44% | 0.99% | 1.20% | 3.05% |
| lsa + lookahead, Unrated by index | 0.00% | 1.80% | 26.25% | 0.07% | 9.65% | 47.64% | 77.19% | 0.00% | 1.04% | 0.90% | 0.70% | 0.83% | 2.06% |
| lsa + lookahead, Unrated every other pair | 0.00% | 2.20% | 27.10% | 3.76% | 18.64% | 48.68% | 79.82% | 1.33% | 1.45% | 1.27% | 1.09% | 1.22% | 3.50% |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 14.25% | 44.55% | 20.06% | 48.78% | 74.87% | 89.56% | 1.15% | 1.64% | 1.58% | 2.40% | 1.89% | 2.42% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.55% | 0.01% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 24.99% / 24.99% | — (0/20) | 36.05 | 23.38 |
| undecided-least + BALD | 0.00% | 28.59% | 35.78% | 23.59% | 40 / 64 | 0.00% | — (0/20) | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| undecided-least + BALD, Unrated by index | 0.00% | 28.33% | 35.35% | 23.22% | 37 / 65 | 0.00% | — (0/20) | 4.77% / 10.12% / 10.12% | — (0/20) | 21.84 | 14.69 |
| undecided-least + BALD, Unrated every other pair | 0.00% | 30.31% | 40.86% | 27.58% | 35 / 58 | 0.00% | — (0/20) | 3.78% / 10.24% / 10.25% | — (0/20) | 22.32 | 14.69 |
| undecided-least + μ-proximity | 0.00% | 7.04% | 11.12% | 4.63% | 41 / 107 | 0.00% | — (0/20) | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| undecided-least + μ-proximity, Unrated by index | 0.00% | 6.54% | 10.72% | 4.21% | 40 / 78 | 0.00% | — (0/20) | 14.20% / 14.20% / 14.20% | 29.23 | 19.15 | 14.98 |
| undecided-least + μ-proximity, Unrated every other pair | 0.00% | 7.29% | 16.05% | 5.13% | 38 / 96 | 0.00% | — (0/20) | 14.28% / 14.29% / 14.29% | 29.52 | 19.68 | 15.84 |
| lsa + lookahead | 0.00% | 73.93% | 78.79% | 61.87% | 89 / 162 | 0.00% | — (0/20) | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |
| lsa + lookahead, Unrated by index | 0.00% | 74.00% | 78.89% | 61.99% | 82 / 153 | 0.00% | — (0/20) | 17.99% / 18.98% / 19.62% | 33.26 | 23.42 | 21.02 |
| lsa + lookahead, Unrated every other pair | 0.00% | 75.17% | 82.16% | 64.51% | 87 / 127 | 0.00% | — (0/20) | 17.89% / 18.41% / 18.70% | 32.54 | 22.80 | 21.02 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | 23.86% | 30.98% | 21.89% | 39 / 64 | 0.00% | — (0/20) | 4.29% / 10.44% / 10.44% | — (1/20) | 22.27 | 14.21 |

Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).

| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | — | 1.48% | 0.68% | 14.87% | 0.67% | 500–500 |
| undecided-least + BALD | 0.00% | — | 0.00% | — | 20.99% | 0.95% | 500–500 |
| undecided-least + BALD, Unrated by index | 0.00% | — | 0.02% | 0.00% | 20.51% | 0.98% | 500–500 |
| undecided-least + BALD, Unrated every other pair | 4.94% | 1.21% | 10.10% | 1.19% | 20.57% | 1.02% | 5–12 |
| undecided-least + μ-proximity | 0.73% | 1.37% | 1.72% | 0.58% | 15.63% | 0.64% | 16–162 |
| undecided-least + μ-proximity, Unrated by index | 0.73% | 0.00% | 1.75% | 1.14% | 15.71% | 0.83% | 16–197 |
| undecided-least + μ-proximity, Unrated every other pair | 3.93% | 0.76% | 8.40% | 0.83% | 16.84% | 0.95% | 5–16 |
| lsa + lookahead | 0.00% | — | 0.00% | — | 0.11% | 0.00% | 227–500 |
| lsa + lookahead, Unrated by index | 0.00% | — | 0.00% | — | 0.07% | 0.00% | 277–500 |
| lsa + lookahead, Unrated every other pair | 0.68% | 1.47% | 2.30% | 2.17% | 3.76% | 1.33% | 7–26 |
| undecided-least + BALD, Unrated may meet Unrated | 0.00% | — | 0.23% | 0.00% | 20.06% | 1.15% | 500–500 |

Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).

| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |
|---|---:|---:|---:|---:|
| baseline (select_pair) | 158.45 | 314 / 340 | 100.00% | 342 / 357 |
| undecided-least + BALD | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + BALD, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + μ-proximity | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated by index | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| undecided-least + μ-proximity, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| lsa + lookahead | 2.00 | 2 / 2 | 100.00% | 498 / 498 |
| lsa + lookahead, Unrated by index | 2.00 | 2 / 2 | 91.59% | 544 / 564 |
| lsa + lookahead, Unrated every other pair | 2.00 | 2 / 2 | 50.10% | 994 / 994 |
| undecided-least + BALD, Unrated may meet Unrated | 250.00 | 250 / 250 | 100.00% | 250 / 250 |

