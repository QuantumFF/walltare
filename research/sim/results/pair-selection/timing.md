## Per-pair selection time

One thread, release build. A library with μ = 25 + 4q + N(0, 1.5²), σ uniform in [1.5, 4], 20 Comparisons each, then 300 votes (select, Thurstone noise 1.0 vote, `rate_1vs1`, Bar recomputed); only `select` is timed. The Bar recompute (O(n) `select_nth`) is timed separately, since the app would pay it too.

| n | Selector | Median µs | Mean µs | p95 µs | Bar µs (median) |
|---:|---|---:|---:|---:|---:|
| 2000 | baseline (select_pair) | 33.1 | 34.8 | 42.9 | 5.4 |
| 2000 | undecided-least + μ-proximity | 29.7 | 30.2 | 33.5 | 5.2 |
| 2000 | undecided-least + BALD | 103.7 | 104.9 | 110.5 | 5.4 |
| 2000 | undecided-least + lookahead | 557.2 | 560.1 | 576.1 | 5.3 |
| 2000 | lsa + lookahead | 560.6 | 565.2 | 588.4 | 5.1 |
| 2000 | straddle + BALD | 100.3 | 103.5 | 118.6 | 5.2 |
| 2000 | straddle + lookahead | 558.3 | 571.9 | 627.6 | 5.2 |
| 10000 | baseline (select_pair) | 272.8 | 276.6 | 294.5 | 25.3 |
| 10000 | undecided-least + μ-proximity | 148.7 | 150.7 | 172.2 | 26.7 |
| 10000 | undecided-least + BALD | 523.5 | 538.4 | 626.3 | 26.1 |
| 10000 | undecided-least + lookahead | 2812.1 | 2851.8 | 3034.5 | 25.6 |
| 10000 | lsa + lookahead | 2838.5 | 2886.5 | 3175.0 | 26.0 |
| 10000 | straddle + BALD | 502.6 | 522.2 | 648.0 | 25.4 |
| 10000 | straddle + lookahead | 2791.9 | 2804.5 | 2857.7 | 25.7 |

