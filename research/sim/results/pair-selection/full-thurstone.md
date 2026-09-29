## n = 120, thurstone(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.40 | 14.55 | 23.05 | — (6/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.70 | 14.75 | 24.85 | — (0/20) | 30.75 (18/20) | — (1/20) |
| undecided-least + μ-proximity | 8.35 | 10.30 | 13.30 | 19.60 | — (6/20) | 22.05 | — (8/20) |
| lsa + lookahead | 9.60 | 11.45 | 14.30 | 17.45 | 32.95 (16/20) | 21.65 | 30.95 (16/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.58% | 28.54% | 17.62% | 40.04% | 60.38% | 76.92% | 0.00% | 0.00% | 0.00% | 0.00% | 0.01% | 0.18% |
| undecided-least + BALD | 0.00% | 14.17% | 41.67% | 21.08% | 47.46% | 70.75% | 83.96% | 0.20% | 0.00% | 0.00% | 0.00% | 0.02% | 0.23% |
| undecided-least + μ-proximity | 0.00% | 8.96% | 46.46% | 19.50% | 46.67% | 74.83% | 88.12% | 0.00% | 0.09% | 0.06% | 0.05% | 0.07% | 0.38% |
| lsa + lookahead | 0.00% | 5.21% | 37.92% | 0.00% | 21.25% | 69.96% | 87.62% | — | 0.59% | 0.66% | 0.48% | 0.53% | 1.96% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 1.59% | 6.77% | 0.29% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 23.08% / 23.08% | — (0/20) | 36.00 | 23.25 |
| undecided-least + BALD | 0.00% | 16.07% | 24.48% | 12.18% | 15 / 32 | 0.00% | — (0/20) | 11.42% / 16.04% / 16.04% | — (1/20) | 21.15 | 14.45 |
| undecided-least + μ-proximity | 0.00% | 14.91% | 35.99% | 14.35% | 30 / 94 | 0.00% | — (0/20) | 11.83% / 11.88% / 11.88% | 26.25 | 17.85 | 13.95 |
| lsa + lookahead | 0.00% | 76.32% | 83.78% | 70.80% | 72 / 134 | 0.00% | — (0/20) | 9.71% / 9.88% / 10.29% | 25.25 | 18.30 | 17.05 |

## n = 120, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.20 | 16.40 | 26.55 (19/20) | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.20 | 10.50 | 14.10 | 19.35 | 36.15 (14/20) | 33.25 (17/20) | — (4/20) |
| undecided-least + μ-proximity | 9.60 | 12.20 | 16.65 | 23.40 (18/20) | — (1/20) | 35.55 (11/20) | — (0/20) |
| lsa + lookahead | 12.50 | 16.45 | 22.70 | 35.35 (14/20) | — (0/20) | — (3/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 2.71% | 18.12% | 15.29% | 35.54% | 57.46% | 74.88% | 0.54% | 0.94% | 1.16% | 0.67% | 0.79% | 5.77% |
| undecided-least + BALD | 0.00% | 14.58% | 41.46% | 20.33% | 48.12% | 74.04% | 88.92% | 1.43% | 1.21% | 1.74% | 2.67% | 2.03% | 2.67% |
| undecided-least + μ-proximity | 0.00% | 7.92% | 36.46% | 16.92% | 43.38% | 68.58% | 85.67% | 0.25% | 0.67% | 0.85% | 0.68% | 0.77% | 1.01% |
| lsa + lookahead | 0.00% | 2.29% | 23.54% | 0.00% | 10.21% | 48.58% | 78.46% | — | 3.67% | 1.46% | 1.22% | 1.37% | 4.98% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 1.64% | 6.79% | 0.28% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 25.12% / 25.12% | — (0/20) | 35.35 | 23.05 |
| undecided-least + BALD | 0.00% | 29.94% | 38.96% | 25.07% | 30 / 46 | 0.00% | — (0/20) | 3.62% / 11.08% / 11.08% | — (0/20) | 21.15 | 14.35 |
| undecided-least + μ-proximity | 0.00% | 12.72% | 29.95% | 10.47% | 27 / 47 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 29.70 | 19.30 | 14.70 |
| lsa + lookahead | 0.00% | 74.64% | 81.46% | 65.16% | 55 / 80 | 0.00% | — (0/20) | 18.75% / 20.38% / 21.21% | 35.10 (19/20) | 22.70 | 18.35 |

## n = 500, thurstone(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 4.6s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.70 | 15.55 | 24.05 | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.70 | 14.74 | 25.68 | — (0/20) | 34.85 (16/20) | — (0/20) |
| undecided-least + μ-proximity | 8.35 | 10.27 | 13.34 | 18.82 | 38.93 (11/20) | 22.37 | — (8/20) |
| lsa + lookahead | 9.65 | 11.18 | 13.78 | 17.57 | 35.71 (15/20) | 20.83 | 39.74 (11/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.50% | 27.25% | 18.32% | 39.72% | 60.77% | 77.64% | 0.11% | 0.10% | 0.02% | 0.00% | 0.02% | 0.72% |
| undecided-least + BALD | 0.00% | 14.30% | 42.60% | 21.45% | 48.56% | 71.70% | 83.87% | 0.05% | 0.04% | 0.06% | 0.00% | 0.03% | 0.44% |
| undecided-least + μ-proximity | 0.00% | 11.45% | 49.75% | 19.54% | 47.68% | 75.72% | 89.56% | 0.00% | 0.08% | 0.12% | 0.08% | 0.10% | 0.15% |
| lsa + lookahead | 0.00% | 4.05% | 42.45% | 0.10% | 20.14% | 71.66% | 86.57% | 0.00% | 0.40% | 0.32% | 0.22% | 0.28% | 0.51% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.57% | 0.02% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 22.36% / 22.36% | — (0/20) | 36.53 | 23.52 |
| undecided-least + BALD | 0.00% | 15.25% | 21.19% | 11.17% | 22 / 36 | 0.00% | — (0/20) | 11.47% / 16.13% / 16.13% | — (0/20) | 22.13 | 14.64 |
| undecided-least + μ-proximity | 0.00% | 7.13% | 12.52% | 4.70% | 37 / 108 | 0.00% | — (0/20) | 10.44% / 10.44% / 10.44% | 25.92 | 17.62 | 14.11 |
| lsa + lookahead | 0.00% | 74.87% | 79.43% | 64.62% | 115 / 211 | 0.00% | — (0/20) | 10.18% / 10.52% / 10.84% | 24.58 | 19.82 | 18.96 |

## n = 500, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 4.6s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.14 | 17.76 | 27.31 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| undecided-least + μ-proximity | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| lsa + lookahead | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.60% | 23.35% | 14.66% | 36.45% | 57.51% | 75.09% | 0.55% | 0.80% | 0.87% | 0.69% | 0.72% | 0.94% |
| undecided-least + BALD | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 89.83% | 0.92% | 1.09% | 1.29% | 2.32% | 1.66% | 2.32% |
| undecided-least + μ-proximity | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 85.67% | 1.04% | 1.20% | 1.19% | 1.02% | 1.15% | 1.34% |
| lsa + lookahead | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 78.35% | 0.00% | 1.68% | 1.26% | 0.98% | 1.12% | 2.68% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.63% | 0.02% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 24.91% / 24.91% | — (0/20) | 35.90 | 23.23 |
| undecided-least + BALD | 0.00% | 28.11% | 35.32% | 23.09% | 39 / 60 | 0.00% | — (0/20) | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| undecided-least + μ-proximity | 0.00% | 6.61% | 10.82% | 4.29% | 39 / 81 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| lsa + lookahead | 0.00% | 73.49% | 78.39% | 61.38% | 85 / 105 | 0.00% | — (0/20) | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |

## n = 2000, thurstone(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 73.1s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.95 | 15.60 | 24.80 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.80 | 15.15 | 26.45 | — (0/20) | 36.90 (18/20) | — (0/20) |
| undecided-least + μ-proximity | 8.35 | 10.40 | 13.40 | 18.95 | — (5/20) | 22.80 | — (7/20) |
| lsa + lookahead | 10.00 | 11.55 | 14.15 | 18.40 | 34.80 (16/20) | 21.15 | 36.70 (14/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.46% | 26.59% | 17.74% | 39.50% | 60.48% | 77.08% | 0.08% | 0.04% | 0.05% | 0.03% | 0.04% | 0.18% |
| undecided-least + BALD | 0.00% | 13.85% | 42.55% | 21.41% | 48.22% | 71.47% | 83.83% | 0.12% | 0.07% | 0.06% | 0.01% | 0.04% | 0.32% |
| undecided-least + μ-proximity | 0.00% | 11.30% | 48.71% | 18.95% | 47.85% | 75.50% | 89.59% | 0.15% | 0.14% | 0.12% | 0.08% | 0.10% | 0.16% |
| lsa + lookahead | 0.00% | 5.16% | 43.55% | 0.03% | 20.49% | 67.76% | 87.61% | 0.00% | 0.35% | 0.34% | 0.28% | 0.32% | 0.48% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.10% | 0.39% | 0.00% | 2 / 2 | 0.00% | — (0/20) | 0.00% / 22.92% / 22.92% | — (0/20) | 36.85 | 24.00 |
| undecided-least + BALD | 0.00% | 14.81% | 20.24% | 10.70% | 31 / 51 | 0.00% | — (0/20) | 11.48% / 16.17% / 16.17% | — (0/20) | 22.45 | 14.75 |
| undecided-least + μ-proximity | 0.00% | 5.54% | 6.95% | 3.89% | 68 / 113 | 0.00% | — (0/20) | 10.40% / 10.40% / 10.40% | 26.05 | 17.85 | 14.45 |
| lsa + lookahead | 0.00% | 74.44% | 78.22% | 63.23% | 146 / 221 | 0.00% | — (0/20) | 9.66% / 9.89% / 10.22% | 25.55 | 25.30 | 25.30 |

## n = 2000, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 73.9s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.50 | 17.85 | 28.75 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.50 | 13.70 | 19.60 | 38.75 (11/20) | 36.50 (18/20) | — (0/20) |
| undecided-least + μ-proximity | 9.65 | 12.10 | 16.25 | 24.80 | — (0/20) | 39.75 (10/20) | — (0/20) |
| lsa + lookahead | 13.35 | 17.00 | 21.80 | 32.85 | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.65% | 22.06% | 14.46% | 36.01% | 57.16% | 75.05% | 0.90% | 0.84% | 0.94% | 0.71% | 0.87% | 1.35% |
| undecided-least + BALD | 0.00% | 13.20% | 43.85% | 20.58% | 48.17% | 74.81% | 89.94% | 1.00% | 1.41% | 1.76% | 2.92% | 2.18% | 3.08% |
| undecided-least + μ-proximity | 0.00% | 7.70% | 37.48% | 15.19% | 42.19% | 69.20% | 85.70% | 0.71% | 1.03% | 1.24% | 1.06% | 1.16% | 1.30% |
| lsa + lookahead | 0.00% | 2.76% | 25.60% | 0.04% | 7.73% | 45.69% | 78.89% | 6.25% | 1.71% | 1.37% | 1.09% | 1.27% | 2.10% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.10% | 0.40% | 0.00% | 2 / 2 | 0.00% | — (0/20) | 0.00% / 24.95% / 24.95% | — (0/20) | 36.35 | 23.50 |
| undecided-least + BALD | 0.00% | 28.84% | 35.52% | 23.36% | 46 / 60 | 0.00% | — (0/20) | 4.83% / 10.06% / 10.06% | — (0/20) | 22.60 | 14.85 |
| undecided-least + μ-proximity | 0.00% | 5.67% | 6.80% | 3.97% | 59 / 110 | 0.00% | — (0/20) | 14.30% / 14.30% / 14.30% | 29.30 | 19.50 | 15.40 |
| lsa + lookahead | 0.00% | 73.01% | 77.34% | 60.08% | 101 / 149 | 0.00% | — (0/20) | 17.90% / 18.41% / 18.93% | 33.40 | 26.00 | 26.00 |

