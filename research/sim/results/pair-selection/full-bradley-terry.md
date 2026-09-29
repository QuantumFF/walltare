## n = 120, bradley-terry(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.85 | 15.00 | 23.55 | — (5/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.20 | 10.90 | 15.10 | 25.05 | — (1/20) | 33.70 (15/20) | — (1/20) |
| undecided-least + μ-proximity | 8.15 | 10.30 | 13.10 | 18.80 | 34.90 (12/20) | 22.35 | 35.45 (12/20) |
| lsa + lookahead | 9.80 | 10.90 | 13.60 | 17.65 | 35.45 (13/20) | 20.65 | 36.30 (11/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.83% | 24.17% | 16.58% | 39.58% | 61.29% | 77.62% | 0.25% | 0.32% | 0.07% | 0.00% | 0.04% | 1.13% |
| undecided-least + BALD | 0.00% | 14.38% | 40.83% | 21.12% | 48.29% | 71.08% | 84.00% | 0.39% | 0.17% | 0.06% | 0.00% | 0.06% | 0.88% |
| undecided-least + μ-proximity | 0.00% | 9.58% | 45.83% | 19.38% | 47.25% | 74.96% | 89.50% | 0.22% | 0.09% | 0.17% | 0.14% | 0.16% | 1.96% |
| lsa + lookahead | 0.00% | 3.75% | 40.21% | 0.04% | 24.04% | 68.42% | 87.25% | 0.00% | 0.69% | 0.55% | 0.48% | 0.54% | 1.23% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 1.70% | 6.75% | 0.27% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 22.38% / 22.38% | — (0/20) | 36.30 | 23.20 |
| undecided-least + BALD | 0.00% | 15.86% | 24.23% | 12.12% | 16 / 41 | 0.00% | — (0/20) | 11.29% / 16.00% / 16.00% | — (2/20) | 21.15 | 14.30 |
| undecided-least + μ-proximity | 0.00% | 15.32% | 36.49% | 15.15% | 26 / 71 | 0.00% | — (0/20) | 10.50% / 10.50% / 10.50% | 26.20 | 17.65 | 14.10 |
| lsa + lookahead | 0.00% | 76.44% | 83.61% | 70.81% | 81 / 128 | 0.00% | — (0/20) | 10.25% / 10.79% / 11.17% | 25.35 | 18.40 | 17.00 |

## n = 120, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 0.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.80 | 15.95 | 26.20 | — (1/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.35 | 10.40 | 14.00 | 19.05 | 37.40 (12/20) | 35.30 (14/20) | — (4/20) |
| undecided-least + μ-proximity | 9.05 | 11.55 | 15.05 | 22.15 | — (4/20) | 30.10 (14/20) | — (1/20) |
| lsa + lookahead | 13.25 | 16.55 | 20.95 | 34.15 (17/20) | — (0/20) | — (2/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.79% | 25.62% | 14.04% | 35.21% | 57.08% | 75.17% | 0.59% | 1.30% | 1.02% | 0.83% | 1.00% | 1.53% |
| undecided-least + BALD | 0.00% | 15.21% | 44.79% | 20.46% | 47.75% | 73.62% | 87.79% | 1.02% | 1.31% | 1.64% | 2.23% | 1.74% | 2.28% |
| undecided-least + μ-proximity | 0.00% | 9.58% | 37.92% | 14.54% | 42.58% | 69.88% | 86.50% | 0.86% | 0.59% | 0.66% | 0.63% | 0.69% | 1.72% |
| lsa + lookahead | 0.00% | 2.08% | 21.67% | 0.08% | 9.79% | 50.17% | 77.79% | 0.00% | 0.43% | 1.25% | 0.91% | 1.01% | 3.08% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 1.63% | 6.61% | 0.28% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 24.83% / 24.83% | — (0/20) | 35.45 | 22.75 |
| undecided-least + BALD | 0.00% | 29.84% | 38.59% | 24.83% | 24 / 44 | 0.00% | — (0/20) | 2.88% / 12.21% / 12.21% | — (2/20) | 21.10 | 14.45 |
| undecided-least + μ-proximity | 0.00% | 13.48% | 31.66% | 11.41% | 21 / 119 | 0.00% | — (0/20) | 13.50% / 13.50% / 13.50% | 28.15 | 18.95 | 14.70 |
| lsa + lookahead | 0.00% | 74.74% | 81.76% | 65.47% | 60 / 91 | 0.00% | — (0/20) | 18.79% / 20.75% / 21.75% | 33.60 | 22.65 | 18.70 |

## n = 500, bradley-terry(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 4.6s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 11.04 | 15.65 | 24.38 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.21 | 10.90 | 14.88 | 25.82 | — (0/20) | 36.86 (14/20) | — (0/20) |
| undecided-least + μ-proximity | 8.40 | 10.37 | 13.44 | 18.62 | — (8/20) | 22.51 | — (7/20) |
| lsa + lookahead | 10.03 | 11.42 | 13.87 | 17.33 | 30.34 (19/20) | 20.59 | 30.53 (17/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 6.05% | 27.65% | 17.20% | 38.97% | 60.49% | 77.42% | 0.00% | 0.03% | 0.07% | 0.03% | 0.03% | 0.44% |
| undecided-least + BALD | 0.00% | 13.65% | 42.70% | 21.32% | 48.43% | 71.64% | 83.55% | 0.09% | 0.08% | 0.04% | 0.01% | 0.04% | 0.15% |
| undecided-least + μ-proximity | 0.00% | 11.15% | 48.35% | 19.39% | 47.49% | 75.56% | 89.39% | 0.10% | 0.13% | 0.13% | 0.06% | 0.09% | 0.17% |
| lsa + lookahead | 0.00% | 6.00% | 38.95% | 0.02% | 15.45% | 74.16% | 86.25% | 0.00% | 0.32% | 0.31% | 0.29% | 0.32% | 0.72% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.42% | 1.66% | 0.01% | 2 / 2 | 0.00% | — (0/20) | 0.00% / 22.58% / 22.58% | — (0/20) | 36.43 | 23.42 |
| undecided-least + BALD | 0.00% | 15.23% | 21.09% | 11.25% | 22 / 78 | 0.00% | — (0/20) | 11.35% / 16.45% / 16.45% | — (0/20) | 21.94 | 14.50 |
| undecided-least + μ-proximity | 0.00% | 7.21% | 12.48% | 4.83% | 44 / 101 | 0.00% | — (0/20) | 10.61% / 10.61% / 10.61% | 25.97 | 17.76 | 14.16 |
| lsa + lookahead | 0.00% | 74.79% | 79.56% | 64.79% | 99 / 227 | 0.00% | — (0/20) | 9.57% / 10.21% / 10.73% | 24.67 | 19.58 | 18.58 |

## n = 500, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 4.6s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.19 | 17.76 | 28.66 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| undecided-least + μ-proximity | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| lsa + lookahead | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.45% | 23.40% | 14.87% | 35.97% | 57.42% | 75.01% | 0.67% | 0.78% | 0.75% | 0.57% | 0.68% | 1.94% |
| undecided-least + BALD | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.79% | 0.95% | 1.12% | 1.46% | 2.58% | 1.88% | 3.08% |
| undecided-least + μ-proximity | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 85.57% | 0.64% | 0.95% | 1.19% | 0.81% | 1.02% | 1.35% |
| lsa + lookahead | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 76.89% | 0.00% | 1.97% | 1.44% | 0.99% | 1.20% | 3.05% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.39% | 1.55% | 0.01% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 24.99% / 24.99% | — (0/20) | 36.05 | 23.38 |
| undecided-least + BALD | 0.00% | 28.59% | 35.78% | 23.59% | 40 / 64 | 0.00% | — (0/20) | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| undecided-least + μ-proximity | 0.00% | 7.04% | 11.12% | 4.63% | 41 / 107 | 0.00% | — (0/20) | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| lsa + lookahead | 0.00% | 73.93% | 78.79% | 61.87% | 89 / 162 | 0.00% | — (0/20) | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |

## n = 2000, bradley-terry(noise=0.5), k = 2.5

20 libraries per row, budget Each 40, seed 1. 73.8s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 10.95 | 15.55 | 24.50 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.35 | 10.80 | 15.05 | 26.00 | — (0/20) | 35.20 (17/20) | — (0/20) |
| undecided-least + μ-proximity | 8.35 | 10.45 | 13.50 | 18.90 | — (5/20) | 22.45 | 38.80 (12/20) |
| lsa + lookahead | 10.05 | 11.60 | 14.35 | 18.35 | 33.40 (17/20) | 21.50 | 32.25 (18/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 5.30% | 27.00% | 17.62% | 39.53% | 60.63% | 77.39% | 0.09% | 0.07% | 0.03% | 0.01% | 0.03% | 0.30% |
| undecided-least + BALD | 0.00% | 14.12% | 42.20% | 21.55% | 48.15% | 71.63% | 84.10% | 0.13% | 0.08% | 0.07% | 0.03% | 0.05% | 0.81% |
| undecided-least + μ-proximity | 0.00% | 11.10% | 48.42% | 19.25% | 47.81% | 75.55% | 89.67% | 0.13% | 0.13% | 0.10% | 0.08% | 0.09% | 0.25% |
| lsa + lookahead | 0.00% | 4.49% | 45.65% | 0.04% | 21.27% | 66.05% | 87.71% | 0.00% | 0.34% | 0.34% | 0.23% | 0.30% | 0.59% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.10% | 0.40% | 0.00% | 2 / 2 | 0.00% | — (0/20) | 0.00% / 22.61% / 22.61% | — (0/20) | 36.95 | 24.10 |
| undecided-least + BALD | 0.00% | 14.62% | 20.10% | 10.61% | 30 / 80 | 0.00% | — (0/20) | 11.82% / 15.90% / 15.90% | — (0/20) | 22.40 | 14.75 |
| undecided-least + μ-proximity | 0.00% | 5.56% | 7.00% | 3.91% | 57 / 95 | 0.00% | — (0/20) | 10.33% / 10.33% / 10.33% | 26.05 | 17.80 | 14.40 |
| lsa + lookahead | 0.00% | 74.30% | 78.12% | 63.11% | 155 / 278 | 0.00% | — (0/20) | 9.50% / 9.70% / 9.96% | 25.45 | 24.30 | 24.30 |

## n = 2000, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 73.7s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 12.25 | 17.75 | 28.75 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD | 8.30 | 10.50 | 13.80 | 19.80 | 39.30 (10/20) | 35.15 (19/20) | — (0/20) |
| undecided-least + μ-proximity | 9.50 | 12.05 | 16.05 | 23.75 | — (0/20) | 38.90 (13/20) | — (0/20) |
| lsa + lookahead | 12.85 | 16.65 | 21.75 | 31.35 | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 4.34% | 22.44% | 14.63% | 36.10% | 57.30% | 74.89% | 0.72% | 0.80% | 0.84% | 0.68% | 0.80% | 1.09% |
| undecided-least + BALD | 0.00% | 13.46% | 43.89% | 20.47% | 48.05% | 74.41% | 90.10% | 1.16% | 1.09% | 1.53% | 2.56% | 1.93% | 2.56% |
| undecided-least + μ-proximity | 0.00% | 7.35% | 37.91% | 15.57% | 42.03% | 69.78% | 86.13% | 0.80% | 1.06% | 1.25% | 1.02% | 1.14% | 1.26% |
| lsa + lookahead | 0.00% | 2.58% | 23.91% | 0.05% | 10.08% | 48.06% | 79.82% | 5.26% | 1.46% | 1.31% | 1.03% | 1.17% | 1.89% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 0.00% | 0.10% | 0.40% | 0.00% | 2 / 3 | 0.00% | — (0/20) | 0.00% / 25.11% / 25.11% | — (0/20) | 36.40 | 23.45 |
| undecided-least + BALD | 0.00% | 28.39% | 34.97% | 23.06% | 47 / 81 | 0.00% | — (0/20) | 5.29% / 9.90% / 9.90% | — (0/20) | 22.85 | 14.85 |
| undecided-least + μ-proximity | 0.00% | 5.71% | 6.87% | 4.01% | 62 / 96 | 0.00% | — (0/20) | 13.87% / 13.87% / 13.87% | 28.90 | 19.30 | 15.20 |
| lsa + lookahead | 0.00% | 73.14% | 77.43% | 60.22% | 100 / 161 | 0.00% | — (0/20) | 17.15% / 17.78% / 18.17% | 32.90 | 26.95 | 26.95 |

