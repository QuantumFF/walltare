## n = 500, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 7.9s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| undecided-least + BALD, opponents Undecided | 7.54 | 9.17 | 11.66 | 15.94 | 29.57 | 24.58 | 36.86 (12/20) |
| undecided-least + BALD, opponents Decided | 19.34 | 24.86 | 31.73 (18/20) | 39.70 (11/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| undecided-least + μ-proximity, opponents Undecided | 8.83 | 11.04 | 14.59 | 21.22 | — (1/20) | 36.43 (17/20) | — (0/20) |
| undecided-least + μ-proximity, opponents Decided | 29.76 | 38.26 (13/20) | — (1/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, opponents Undecided | 13.78 | 16.61 | 21.84 | 34.80 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, opponents Decided | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 89.83% | 0.92% | 1.09% | 1.29% | 2.32% | 1.66% | 2.32% |
| undecided-least + BALD, opponents Undecided | 0.00% | 18.40% | 53.15% | 21.30% | 53.51% | 79.96% | 92.40% | 0.80% | 1.36% | 2.10% | 2.01% | 1.96% | 2.12% |
| undecided-least + BALD, opponents Decided | 0.00% | 0.00% | 1.20% | 15.31% | 26.86% | 42.46% | 78.01% | 0.33% | 0.19% | 0.16% | 0.87% | 0.38% | 0.98% |
| undecided-least + μ-proximity | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 85.67% | 1.04% | 1.20% | 1.19% | 1.02% | 1.15% | 1.34% |
| undecided-least + μ-proximity, opponents Undecided | 0.00% | 10.05% | 41.90% | 16.97% | 45.57% | 72.50% | 87.32% | 0.65% | 1.23% | 1.39% | 1.24% | 1.29% | 1.40% |
| undecided-least + μ-proximity, opponents Decided | 0.00% | 0.00% | 0.00% | 8.50% | 27.89% | 33.96% | 60.94% | 0.24% | 0.75% | 0.12% | 0.07% | 0.15% | 0.95% |
| lsa + lookahead | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 78.35% | 0.00% | 1.68% | 1.26% | 0.98% | 1.12% | 2.68% |
| lsa + lookahead, opponents Undecided | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 76.44% | 0.00% | 1.68% | 1.26% | 0.95% | 1.11% | 2.68% |
| lsa + lookahead, opponents Decided | 0.00% | 0.00% | 0.00% | 0.03% | 1.84% | 9.34% | 20.60% | 0.00% | 0.54% | 1.18% | 0.39% | 0.69% | 1.85% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 28.11% | 35.32% | 23.09% | 39 / 60 | 0.00% | — (0/20) | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| undecided-least + BALD, opponents Undecided | 0.00% | 7.07% | 9.47% | 3.13% | 30 / 138 | 0.00% | — (0/20) | 7.59% / 7.59% / 7.60% | 22.18 | 15.07 | 11.81 |
| undecided-least + BALD, opponents Decided | 0.00% | 27.81% | 52.72% | 35.00% | 21 / 40 | 0.00% | — (0/20) | 0.19% / 21.97% / 21.98% | — (0/20) | 34.94 (19/20) | 26.83 |
| undecided-least + μ-proximity | 0.00% | 6.61% | 10.82% | 4.29% | 39 / 81 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| undecided-least + μ-proximity, opponents Undecided | 0.00% | 5.47% | 11.10% | 3.71% | 47 / 111 | 0.00% | — (0/20) | 12.65% / 12.68% / 12.68% | 26.26 | 17.57 | 13.82 |
| undecided-least + μ-proximity, opponents Decided | 0.00% | 5.67% | 12.59% | 5.58% | 145 / 252 | 0.00% | — (0/20) | 0.27% / 26.83% / 39.06% | — (0/20) | — (1/20) | 34.90 |
| lsa + lookahead | 0.00% | 73.49% | 78.39% | 61.38% | 85 / 105 | 0.00% | — (0/20) | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |
| lsa + lookahead, opponents Undecided | 0.00% | 73.58% | 78.51% | 61.48% | 82 / 137 | 0.00% | — (0/20) | 18.51% / 19.97% / 20.84% | 34.85 | 23.71 | 23.66 |
| lsa + lookahead, opponents Decided | 0.00% | 93.01% | 94.53% | 90.40% | 2935 / 4438 | 0.00% | — (0/20) | 1.61% / 15.70% / 28.66% | — (0/20) | — (0/20) | — (0/20) |

## n = 500, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 7.8s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| undecided-least + BALD, opponents Undecided | 7.44 | 9.12 | 11.57 | 15.89 | 29.42 | 24.29 | 37.78 (16/20) |
| undecided-least + BALD, opponents Decided | 19.44 | 24.43 | 31.87 (19/20) | — (9/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| undecided-least + μ-proximity, opponents Undecided | 8.69 | 11.04 | 14.45 | 21.17 | — (0/20) | 31.44 (18/20) | — (0/20) |
| undecided-least + μ-proximity, opponents Decided | 28.70 | 38.54 (12/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |
| lsa + lookahead, opponents Undecided | 12.91 | 16.27 | 20.83 | 32.78 (18/20) | — (0/20) | — (3/20) | — (0/20) |
| lsa + lookahead, opponents Decided | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.79% | 0.95% | 1.12% | 1.46% | 2.58% | 1.88% | 3.08% |
| undecided-least + BALD, opponents Undecided | 0.00% | 17.75% | 53.55% | 21.83% | 53.88% | 80.11% | 92.47% | 0.92% | 1.80% | 2.21% | 2.18% | 2.14% | 3.08% |
| undecided-least + BALD, opponents Decided | 0.00% | 0.00% | 3.05% | 16.62% | 27.94% | 42.98% | 78.39% | 0.42% | 0.14% | 0.07% | 0.88% | 0.29% | 0.90% |
| undecided-least + μ-proximity | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 85.57% | 0.64% | 0.95% | 1.19% | 0.81% | 1.02% | 1.35% |
| undecided-least + μ-proximity, opponents Undecided | 0.00% | 9.35% | 43.20% | 17.35% | 45.92% | 72.76% | 87.59% | 0.75% | 1.07% | 1.26% | 1.14% | 1.19% | 1.31% |
| undecided-least + μ-proximity, opponents Decided | 0.00% | 0.00% | 0.00% | 8.34% | 28.92% | 33.86% | 60.45% | 0.48% | 0.48% | 0.03% | 0.12% | 0.13% | 0.83% |
| lsa + lookahead | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 76.89% | 0.00% | 1.97% | 1.44% | 0.99% | 1.20% | 3.05% |
| lsa + lookahead, opponents Undecided | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 81.20% | 0.00% | 1.97% | 1.44% | 1.06% | 1.21% | 3.05% |
| lsa + lookahead, opponents Decided | 0.00% | 0.00% | 0.00% | 0.06% | 1.50% | 8.92% | 21.54% | 0.00% | 1.33% | 1.01% | 0.70% | 0.82% | 2.43% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 28.59% | 35.78% | 23.59% | 40 / 64 | 0.00% | — (0/20) | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| undecided-least + BALD, opponents Undecided | 0.00% | 7.58% | 10.02% | 3.58% | 51 / 212 | 0.00% | — (0/20) | 7.53% / 7.53% / 7.53% | 22.08 | 15.07 | 11.76 |
| undecided-least + BALD, opponents Decided | 0.00% | 27.11% | 51.73% | 33.97% | 15 / 45 | 0.00% | — (0/20) | 0.29% / 21.58% / 21.61% | — (0/20) | 35.14 (17/20) | 27.07 |
| undecided-least + μ-proximity | 0.00% | 7.04% | 11.12% | 4.63% | 41 / 107 | 0.00% | — (0/20) | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| undecided-least + μ-proximity, opponents Undecided | 0.00% | 5.57% | 11.40% | 3.83% | 43 / 89 | 0.00% | — (0/20) | 12.41% / 12.41% / 12.41% | 26.16 | 17.42 | 13.82 |
| undecided-least + μ-proximity, opponents Decided | 0.00% | 5.52% | 12.88% | 5.64% | 107 / 228 | 0.00% | — (0/20) | 0.21% / 26.14% / 39.55% | — (0/20) | — (0/20) | 34.85 |
| lsa + lookahead | 0.00% | 73.93% | 78.79% | 61.87% | 89 / 162 | 0.00% | — (0/20) | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |
| lsa + lookahead, opponents Undecided | 0.00% | 73.93% | 78.80% | 61.85% | 83 / 109 | 0.00% | — (0/20) | 18.06% / 18.16% / 18.28% | 33.31 | 22.94 | 20.64 |
| lsa + lookahead, opponents Decided | 0.00% | 93.17% | 94.73% | 90.71% | 3051 / 4356 | 0.00% | — (0/20) | 0.62% / 15.01% / 28.06% | — (0/20) | — (0/20) | — (0/20) |

