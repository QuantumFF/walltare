## n = 500, thurstone(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 29.3s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 8.40 | 10.66 | 13.78 | 19.49 | 37.87 (13/20) | 34.37 (18/20) | — (0/20) |
| undecided-least + BALD, stop σ<1 | 8.40 | 10.66 | 13.78 | 19.49 | 38.11 (14/20) | 34.37 (17/20) | — (1/20) |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 8.40 | 10.66 | 13.78 | 19.49 | 38.11 (14/20) | 34.37 (17/20) | — (1/20) |
| undecided-least + BALD, stop σ<1.5 | 8.40 | 10.66 | 13.78 | 19.39 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 8.40 | 10.66 | 13.78 | 19.39 | — (3/20) | — (2/20) | — (0/20) |
| undecided-least + BALD, stop σ<2 | 8.40 | 10.66 | 13.68 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 8.40 | 10.66 | 13.68 | 29.47 (18/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | 39.60 (12/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1 | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 9.50 | 12.10 | 16.22 | 24.19 | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1.5 | 9.50 | 12.10 | 16.22 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 9.50 | 12.10 | 16.22 | — (2/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<2 | 9.50 | 12.10 | 28.90 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 9.50 | 12.10 | — (7/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead | 13.78 | 16.61 | 21.84 | 34.37 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1 | 13.78 | 16.61 | 21.84 | 29.09 (17/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 13.78 | 16.61 | 21.84 | 29.09 (18/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1.5 | 13.49 | 17.38 | 18.77 | — (5/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 13.49 | 17.38 | 18.77 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<2 | 13.44 | 13.92 | 26.98 (19/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 13.44 | 13.92 | 34.42 (17/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 89.83% | 0.92% | 1.09% | 1.29% | 2.32% | 1.66% | 2.32% |
| undecided-least + BALD, stop σ<1 | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 90.16% | 0.92% | 1.09% | 1.29% | 2.28% | 1.65% | 2.29% |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 89.05% | 0.92% | 1.09% | 1.29% | 2.20% | 1.65% | 2.24% |
| undecided-least + BALD, stop σ<1.5 | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 80.18% | 0.92% | 1.09% | 1.29% | 1.10% | 1.30% | 1.74% |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 0.00% | 13.70% | 44.15% | 20.55% | 47.72% | 74.43% | 79.14% | 0.92% | 1.09% | 1.29% | 2.27% | 1.52% | 2.38% |
| undecided-least + BALD, stop σ<2 | 0.00% | 13.70% | 36.85% | 20.55% | 47.72% | 70.58% | 78.51% | 0.92% | 1.09% | 1.25% | 0.96% | 1.07% | 1.74% |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 0.00% | 13.70% | 39.40% | 20.55% | 47.72% | 69.98% | 75.52% | 0.92% | 1.09% | 1.20% | 2.12% | 1.68% | 2.85% |
| undecided-least + μ-proximity | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 85.67% | 1.04% | 1.20% | 1.19% | 1.02% | 1.15% | 1.34% |
| undecided-least + μ-proximity, stop σ<1 | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 81.92% | 1.04% | 1.20% | 1.19% | 0.84% | 1.11% | 1.34% |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 81.92% | 1.04% | 1.20% | 1.19% | 0.94% | 1.13% | 1.34% |
| undecided-least + μ-proximity, stop σ<1.5 | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 74.68% | 1.04% | 1.20% | 1.19% | 0.58% | 0.96% | 1.34% |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 0.00% | 7.85% | 38.10% | 16.27% | 42.52% | 69.60% | 74.14% | 1.04% | 1.20% | 1.19% | 1.05% | 1.12% | 1.34% |
| undecided-least + μ-proximity, stop σ<2 | 0.00% | 7.85% | 31.75% | 16.27% | 42.52% | 64.93% | 74.74% | 1.04% | 1.20% | 1.11% | 0.66% | 0.87% | 1.34% |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 0.00% | 7.85% | 31.15% | 16.27% | 42.52% | 64.63% | 65.56% | 1.04% | 1.20% | 1.22% | 1.17% | 1.18% | 1.34% |
| lsa + lookahead | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 78.35% | 0.00% | 1.68% | 1.26% | 0.98% | 1.12% | 2.68% |
| lsa + lookahead, stop σ<1 | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 73.39% | 0.00% | 1.68% | 1.26% | 0.94% | 1.15% | 2.68% |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 0.00% | 2.75% | 24.55% | 0.03% | 6.54% | 45.25% | 76.21% | 0.00% | 1.68% | 1.26% | 0.79% | 1.14% | 2.68% |
| lsa + lookahead, stop σ<1.5 | 0.00% | 2.75% | 24.50% | 0.03% | 6.54% | 42.48% | 66.84% | 0.00% | 1.68% | 1.20% | 0.66% | 0.96% | 2.68% |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 0.00% | 2.75% | 24.50% | 0.03% | 6.54% | 42.48% | 68.35% | 0.00% | 1.68% | 1.20% | 0.45% | 0.87% | 2.68% |
| lsa + lookahead, stop σ<2 | 0.00% | 2.75% | 28.15% | 0.03% | 6.54% | 59.68% | 63.18% | 0.00% | 1.68% | 1.32% | 0.62% | 0.93% | 2.68% |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 0.00% | 2.75% | 25.65% | 0.03% | 6.54% | 50.46% | 70.20% | 0.00% | 1.68% | 1.13% | 0.50% | 0.76% | 2.68% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 28.11% | 35.32% | 23.09% | 39 / 60 | 0.00% | — (0/20) | 4.76% / 10.16% / 10.17% | — (0/20) | 21.79 | 14.50 |
| undecided-least + BALD, stop σ<1 | 0.00% | 27.56% | 34.67% | 22.48% | 38 / 60 | 1.33% | 39.72 (11/20) | 7.08% / 9.84% / 9.84% | 39.89 (11/20) | 21.79 | 14.50 |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 0.00% | 28.68% | 35.86% | 23.58% | 39 / 60 | 0.37% | 39.72 (11/20) | 7.22% / 10.93% / 10.93% | — (7/20) | 21.79 | 14.50 |
| undecided-least + BALD, stop σ<1.5 | 0.00% | 9.31% | 11.16% | 5.00% | 12 / 24 | 50.44% | 19.60 (20/20) | 0.00% / 19.82% / 19.82% | — (0/20) | 19.63 | 14.50 |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 0.00% | 53.58% | 57.39% | 45.42% | 89 / 220 | 41.19% | 19.60 (20/20) | 4.19% / 20.85% / 20.86% | — (0/20) | 19.68 | 14.50 |
| undecided-least + BALD, stop σ<2 | 0.00% | 6.11% | 6.77% | 2.36% | 8 / 15 | 65.40% | 13.79 (20/20) | 0.00% / 21.49% / 21.49% | — (0/20) | 33.26 | 13.82 |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 0.00% | 64.48% | 67.31% | 55.89% | 122 / 163 | 61.49% | 13.79 (20/20) | 4.07% / 24.11% / 24.47% | — (0/20) | 28.70 | 13.87 |
| undecided-least + μ-proximity | 0.00% | 6.61% | 10.82% | 4.29% | 39 / 81 | 0.00% | — (0/20) | 14.33% / 14.33% / 14.33% | 28.94 | 19.20 | 15.02 |
| undecided-least + μ-proximity, stop σ<1 | 0.00% | 6.52% | 9.49% | 4.45% | 58 / 71 | 25.50% | 28.63 (20/20) | 18.07% / 18.08% / 18.08% | 28.66 | 19.20 | 15.02 |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 0.00% | 26.52% | 31.56% | 25.26% | 64 / 108 | 25.23% | 28.63 (20/20) | 18.07% / 18.08% / 18.08% | 28.66 | 19.20 | 15.02 |
| undecided-least + μ-proximity, stop σ<1.5 | 0.00% | 3.72% | 5.83% | 2.10% | 24 / 28 | 51.67% | 18.46 (20/20) | 0.00% / 25.32% / 25.32% | — (0/20) | 18.53 | 15.02 |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 0.00% | 46.01% | 51.84% | 46.01% | 77 / 141 | 52.13% | 18.46 (20/20) | 11.79% / 25.86% / 25.86% | — (0/20) | 18.53 | 15.02 |
| undecided-least + μ-proximity, stop σ<2 | 0.00% | 2.26% | 4.02% | 1.04% | 13 / 16 | 63.48% | 14.10 (20/20) | 0.00% / 25.26% / 25.26% | — (0/20) | 36.38 | 14.11 |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 0.00% | 54.72% | 61.30% | 55.40% | 86 / 161 | 63.79% | 14.10 (20/20) | 10.53% / 17.02% / 34.44% | — (0/20) | — (0/20) | 14.16 |
| lsa + lookahead | 0.00% | 73.49% | 78.39% | 61.38% | 85 / 105 | 0.00% | — (0/20) | 18.38% / 19.00% / 19.45% | 33.89 | 23.71 | 23.66 |
| lsa + lookahead, stop σ<1 | 0.00% | 63.52% | 70.27% | 52.91% | 64 / 102 | 10.04% | 29.23 (20/20) | 19.86% / 22.69% / 24.10% | 29.28 | 24.38 | 22.66 |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 0.00% | 71.35% | 77.70% | 60.37% | 68 / 75 | 4.72% | 29.23 (20/20) | 20.16% / 22.54% / 23.33% | 31.10 | 24.38 | 22.66 |
| lsa + lookahead, stop σ<1.5 | 0.00% | 48.35% | 57.92% | 40.02% | 35 / 126 | 29.15% | 18.95 (20/20) | 0.03% / 31.07% / 32.33% | — (0/20) | 19.01 | 18.82 |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 0.00% | 70.75% | 77.87% | 61.65% | 73 / 111 | 23.72% | 18.95 (20/20) | 4.44% / 28.50% / 29.58% | — (0/20) | 19.87 | 18.82 |
| lsa + lookahead, stop σ<2 | 0.00% | 37.12% | 46.18% | 29.02% | 25 / 75 | 50.24% | 14.64 (20/20) | 0.00% / 21.73% / 36.81% | — (0/20) | — (0/20) | 14.64 |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 0.00% | 72.89% | 79.01% | 64.22% | 88 / 145 | 43.26% | 14.64 (20/20) | 6.01% / 28.95% / 29.73% | — (0/20) | 30.34 | 15.89 |

## n = 500, bradley-terry(noise=1), k = 2.5

20 libraries per row, budget Each 40, seed 1. 29.1s.

Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.

| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 8.26 | 10.51 | 13.73 | 19.25 | 38.78 (13/20) | 33.84 (18/20) | — (0/20) |
| undecided-least + BALD, stop σ<1 | 8.26 | 10.51 | 13.73 | 19.25 | 39.22 (12/20) | 33.84 (19/20) | — (0/20) |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 8.26 | 10.51 | 13.73 | 19.25 | 39.22 (14/20) | 33.84 (19/20) | — (0/20) |
| undecided-least + BALD, stop σ<1.5 | 8.26 | 10.51 | 13.73 | 19.25 (16/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 8.26 | 10.51 | 13.73 | 19.25 (19/20) | — (1/20) | — (2/20) | — (0/20) |
| undecided-least + BALD, stop σ<2 | 8.26 | 10.51 | 13.54 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 8.26 | 10.51 | 13.54 | 29.23 (18/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | 36.72 (12/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1 | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 9.60 | 12.19 | 16.27 | 24.19 | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1.5 | 9.60 | 12.19 | 16.27 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 9.60 | 12.19 | 16.27 | — (6/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<2 | 9.60 | 12.19 | 29.04 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 9.60 | 12.19 | 37.15 (13/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead | 12.91 | 16.27 | 20.83 | 32.78 (19/20) | — (0/20) | — (2/20) | — (0/20) |
| lsa + lookahead, stop σ<1 | 12.91 | 16.27 | 20.93 | 28.42 (19/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 12.91 | 16.27 | 20.93 | 28.42 (19/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1.5 | 12.86 | 17.09 | 18.38 | — (5/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 12.86 | 17.09 | 18.38 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<2 | 13.20 | 13.78 | 25.68 | — (0/20) | — (0/20) | — (0/20) | — (0/20) |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 13.20 | 13.78 | 31.39 (19/20) | — (0/20) | — (0/20) | — (0/20) | — (0/20) |

Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. "Run" pools every point from Each 4 on; "Peak" is the worst point with ≥ 2% Decided.

| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.79% | 0.95% | 1.12% | 1.46% | 2.58% | 1.88% | 3.08% |
| undecided-least + BALD, stop σ<1 | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.95% | 0.95% | 1.12% | 1.46% | 2.52% | 1.87% | 3.08% |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 89.56% | 0.95% | 1.12% | 1.46% | 2.42% | 1.87% | 3.08% |
| undecided-least + BALD, stop σ<1.5 | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 80.37% | 0.95% | 1.12% | 1.46% | 1.14% | 1.46% | 3.08% |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 0.00% | 13.35% | 43.75% | 20.99% | 48.09% | 74.46% | 79.40% | 0.95% | 1.12% | 1.46% | 1.93% | 1.69% | 3.08% |
| undecided-least + BALD, stop σ<2 | 0.00% | 13.35% | 37.50% | 20.99% | 48.09% | 70.56% | 78.48% | 0.95% | 1.12% | 1.50% | 1.04% | 1.22% | 3.08% |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 0.00% | 13.35% | 40.50% | 20.99% | 48.09% | 69.82% | 76.85% | 0.95% | 1.12% | 1.50% | 2.39% | 1.73% | 3.08% |
| undecided-least + μ-proximity | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 85.57% | 0.64% | 0.95% | 1.19% | 0.81% | 1.02% | 1.35% |
| undecided-least + μ-proximity, stop σ<1 | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 81.83% | 0.64% | 0.95% | 1.19% | 0.59% | 0.96% | 1.35% |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 81.83% | 0.64% | 0.95% | 1.19% | 0.79% | 1.00% | 1.35% |
| undecided-least + μ-proximity, stop σ<1.5 | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 74.07% | 0.64% | 0.95% | 1.19% | 0.35% | 0.86% | 1.35% |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 0.00% | 6.60% | 37.80% | 15.63% | 42.04% | 69.19% | 74.31% | 0.64% | 0.95% | 1.19% | 1.09% | 1.09% | 1.35% |
| undecided-least + μ-proximity, stop σ<2 | 0.00% | 6.60% | 31.85% | 15.63% | 42.04% | 65.35% | 74.55% | 0.64% | 0.95% | 1.10% | 0.52% | 0.80% | 1.35% |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 0.00% | 6.60% | 30.85% | 15.63% | 42.04% | 64.53% | 66.29% | 0.64% | 0.95% | 1.07% | 0.97% | 1.05% | 1.35% |
| lsa + lookahead | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 76.89% | 0.00% | 1.97% | 1.44% | 0.99% | 1.20% | 3.05% |
| lsa + lookahead, stop σ<1 | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 79.33% | 0.00% | 1.97% | 1.44% | 0.87% | 1.19% | 3.05% |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 0.00% | 1.95% | 24.15% | 0.11% | 10.65% | 50.77% | 77.00% | 0.00% | 1.97% | 1.44% | 0.83% | 1.19% | 3.05% |
| lsa + lookahead, stop σ<1.5 | 0.00% | 1.95% | 22.45% | 0.11% | 10.65% | 48.28% | 65.35% | 0.00% | 1.97% | 1.24% | 0.55% | 1.01% | 3.05% |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 0.00% | 1.95% | 22.45% | 0.11% | 10.65% | 48.28% | 73.95% | 0.00% | 1.97% | 1.24% | 0.64% | 0.93% | 3.05% |
| lsa + lookahead, stop σ<2 | 0.00% | 1.95% | 29.25% | 0.11% | 10.65% | 59.53% | 63.16% | 0.00% | 1.97% | 1.13% | 0.43% | 0.73% | 3.05% |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 0.00% | 1.95% | 28.00% | 0.11% | 10.65% | 54.77% | 72.19% | 0.00% | 1.97% | 0.91% | 0.53% | 0.69% | 3.05% |

Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). "Stuck σ<s @40": Undecided wallpapers with σ below s at Each 40, as a share of the library. "All Decided or σ<s": Each (median) when every wallpaper first was Decided or had σ below s.

| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| undecided-least + BALD | 0.00% | 28.59% | 35.78% | 23.59% | 40 / 64 | 0.00% | — (0/20) | 4.49% / 10.21% / 10.21% | — (0/20) | 21.74 | 14.69 |
| undecided-least + BALD, stop σ<1 | 0.00% | 28.20% | 35.31% | 23.20% | 40 / 64 | 1.15% | 39.78 (10/20) | 6.41% / 10.05% / 10.05% | — (9/20) | 21.74 | 14.69 |
| undecided-least + BALD, stop σ<1, fallback smallest gap/σ | 0.00% | 29.08% | 36.28% | 24.05% | 40 / 64 | 0.46% | 39.78 (10/20) | 6.51% / 10.44% / 10.44% | — (8/20) | 21.74 | 14.69 |
| undecided-least + BALD, stop σ<1.5 | 0.00% | 9.42% | 11.30% | 5.10% | 14 / 25 | 50.50% | 19.53 (20/20) | 0.00% / 19.63% / 19.63% | — (0/20) | 19.63 | 14.69 |
| undecided-least + BALD, stop σ<1.5, fallback smallest gap/σ | 0.00% | 53.84% | 57.66% | 45.71% | 116 / 175 | 41.71% | 19.53 (20/20) | 4.40% / 20.60% / 20.60% | — (0/20) | 19.63 | 14.69 |
| undecided-least + BALD, stop σ<2 | 0.00% | 6.10% | 6.79% | 2.34% | 7 / 11 | 65.53% | 13.72 (20/20) | 0.00% / 21.52% / 21.52% | — (0/20) | 33.26 | 13.73 |
| undecided-least + BALD, stop σ<2, fallback smallest gap/σ | 0.00% | 64.73% | 67.54% | 56.35% | 136 / 222 | 61.60% | 13.72 (20/20) | 3.71% / 23.02% / 23.14% | — (0/20) | 28.27 | 13.78 |
| undecided-least + μ-proximity | 0.00% | 7.04% | 11.12% | 4.63% | 41 / 107 | 0.00% | — (0/20) | 14.41% / 14.43% / 14.43% | 29.14 | 19.25 | 14.98 |
| undecided-least + μ-proximity, stop σ<1 | 0.00% | 7.25% | 10.17% | 5.07% | 58 / 66 | 24.35% | 28.72 (20/20) | 18.16% / 18.17% / 18.17% | 28.85 | 19.25 | 14.98 |
| undecided-least + μ-proximity, stop σ<1, fallback smallest gap/σ | 0.00% | 26.10% | 31.04% | 24.76% | 58 / 96 | 24.45% | 28.72 (20/20) | 18.13% / 18.17% / 18.17% | 28.75 | 19.25 | 14.98 |
| undecided-least + μ-proximity, stop σ<1.5 | 0.00% | 4.03% | 6.17% | 2.37% | 24 / 27 | 51.26% | 18.57 (20/20) | 0.00% / 25.93% / 25.93% | — (0/20) | 18.58 | 14.98 |
| undecided-least + μ-proximity, stop σ<1.5, fallback smallest gap/σ | 0.00% | 46.27% | 51.99% | 46.20% | 80 / 151 | 51.83% | 18.57 (20/20) | 10.86% / 25.69% / 25.69% | — (0/20) | 18.67 | 14.98 |
| undecided-least + μ-proximity, stop σ<2 | 0.00% | 2.23% | 4.04% | 1.01% | 13 / 17 | 63.47% | 14.13 (20/20) | 0.00% / 25.45% / 25.45% | — (0/20) | 36.82 | 14.16 |
| undecided-least + μ-proximity, stop σ<2, fallback smallest gap/σ | 0.00% | 55.11% | 61.33% | 55.62% | 91 / 145 | 63.54% | 14.13 (20/20) | 10.51% / 16.84% / 33.71% | — (0/20) | — (0/20) | 14.16 |
| lsa + lookahead | 0.00% | 73.93% | 78.79% | 61.87% | 89 / 162 | 0.00% | — (0/20) | 18.06% / 19.20% / 20.11% | 33.31 | 22.94 | 20.64 |
| lsa + lookahead, stop σ<1 | 0.00% | 60.84% | 67.40% | 50.07% | 66 / 71 | 14.09% | 28.57 (20/20) | 18.72% / 19.91% / 20.28% | 28.70 | 25.87 | 20.93 |
| lsa + lookahead, stop σ<1, fallback smallest gap/σ | 0.00% | 71.31% | 77.76% | 60.38% | 67 / 76 | 5.36% | 28.57 (20/20) | 20.07% / 21.60% / 22.25% | 30.00 | 25.87 | 20.93 |
| lsa + lookahead, stop σ<1.5 | 0.00% | 48.70% | 58.38% | 40.49% | 30 / 47 | 28.87% | 18.91 (20/20) | 0.03% / 32.62% / 33.95% | — (0/20) | 18.96 | 18.48 |
| lsa + lookahead, stop σ<1.5, fallback smallest gap/σ | 0.00% | 70.56% | 77.82% | 61.56% | 79 / 156 | 27.90% | 18.91 (20/20) | 5.52% / 25.62% / 25.97% | — (0/20) | 20.93 | 18.48 |
| lsa + lookahead, stop σ<2 | 0.00% | 37.41% | 46.40% | 29.26% | 25 / 69 | 50.78% | 14.48 (20/20) | 0.00% / 22.06% / 36.84% | — (0/20) | — (0/20) | 14.50 |
| lsa + lookahead, stop σ<2, fallback smallest gap/σ | 0.00% | 73.70% | 79.41% | 64.69% | 102 / 169 | 46.71% | 14.48 (20/20) | 6.66% / 26.13% / 26.63% | — (0/20) | 28.27 | 15.12 |

