# Choosing the Decided rule

What k should "Decided when |μ − Bar| ≥ kσ" use, and do two variants help:
holding everything Undecided while the Bar is young, or counting the Bar's own
uncertainty? Measured on today's selector, so these numbers describe the rule,
not a Bar-aware selector.

## Setup

- Selector `baseline` (today's `select_pair`), prior uniform, one
  `rate_1vs1` per vote, nothing rejected during a run.
- Bar: worst 20% of the Scored (Unrated excluded), recomputed after every
  vote. Truth: the same 20% of true quality over the whole library.
- Voters `thurstone` and `bradley-terry`, noise 0.5 (as consistent as
  TrueSkill assumes) and 1.0 (twice as noisy). n = 500 and n = 120, 20
  libraries per row, budget 40 Comparisons per wallpaper. The k decision at
  noise 1.0 is rechecked on 100 libraries.
- Rules, all followed through the same runs (the baseline selector never reads
  the rule, so every rule sees identical votes):
  - `plain`: |μ − Bar| ≥ kσ, today's placeholder at k = 2.
  - `warmup 25`: `plain`, but nothing is Decided until the Bar rests on 25 Scores.
  - `participated`: `plain`, but nothing is Decided until every wallpaper has a Comparison.
  - `bar-sigma`: |μ − Bar| ≥ k·√(σ² + σ_bar²), σ_bar the root mean square σ of
    the two wallpapers whose μ straddle the Bar.
- "Each" is Comparisons per wallpaper = 2 × votes / n for pairs.
- "Wrong" is the share of Decided wallpapers sitting on the side opposite
  their true side of the true Bar, pooled over libraries.

Commands (from `research/sim`):

```sh
for v in thurstone bradley-terry; do
  cargo run --release -- --report decided --sizes 120,500 --noise 0.5,1.0 --reps 20 \
    --ks 1.5,2,2.5,3 --rules plain,warmup,participated,bar-sigma --voter $v
  cargo run --release -- --report decided --sizes 120,500 --noise 1.0 --reps 100 \
    --ks 1.5,2,2.5,3 --rules plain,bar-sigma --voter $v
done
```

The four runs take about 2 s each on 12 threads. Their full output is below
the findings.

## Findings

1. **k = 2 misses ~1% wrong at noise 1.0, and more votes don't fix it.**
   Wrong holds at 1.0–2.1% from Each 4 through Each 40. TrueSkill's σ assumes
   a curator at noise 0.5; a noisier curator makes σ overconfident, so kσ
   covers less than k suggests at every stage. At noise 0.5, k = 2 already
   stays at or under 0.3%.
2. **k = 2.5 is borderline and k = 3 is safe.** Over 100 libraries at noise
   1.0, k = 2.5 gives 0.6–0.9% at n = 500 and 0.7–1.15% at n = 120. k = 3 gives
   0.15–0.6% everywhere.
3. **Cost against k = 2 (n = 500, noise 1.0).** 50% Decided moves from Each 8.8
   to 12.2 at k = 2.5 (+39%) and 16.1 at k = 3 (+83%). 70% Decided moves from
   Each ~20 to ~28 (+42%) and ~38.6 (+95%). At k = 3 only about two libraries in
   three reach 70% within 40 Each.
4. **`bar-sigma` sits on the same curve as raising k.** `bar-sigma` k = 2 costs
   what `plain` k ≈ 2.75 costs (50% at Each 14.5, ~0.45% wrong against ~0.5%
   interpolated). It also adds Bar-driven flicker at n = 500: 10 Decided →
   Undecided events per 100 votes against 6.7 for `plain`, 74% of them from the
   Bar moving, because σ_bar changes whenever a different pair straddles the Bar.
5. **The Bar is never young when the first wallpaper is Decided.**
   `select_pair` takes the least-compared wallpaper first, so every wallpaper
   has a Score by about Each 1. Reaching kσ takes about two Comparisons at k = 2.
   When the first wallpaper is Decided, the Bar rests on 50–120 Scores (n = 120)
   and 119–492 (n = 500). `warmup 25` therefore never binds except at k = 1.5,
   and even there the numbers match `plain`. `participated` only removes the
   few Decided before Each 1 at k = 1.5. The early wrong-side rate (1–3% at
   k = 2, noise 1.0, on the ~10% Decided by Each 2) comes from a two-result σ
   being too small for a noisy curator, not from a thin Bar. Raising k fixes
   it: at k ≥ 2.5 almost nothing is Decided by Each 2.
6. **Reversion is mostly flicker at the threshold.** Roughly half of all
   ever-Decided wallpapers are Undecided again at least once. About 80% of
   those events return to Decided on the same side within 2 of the wallpaper's
   own Comparisons, and about 45% return with no Comparison of their own,
   because the Bar moved back. Causes split roughly 55% Bar, 45% own Rating (52–62% Bar).
   Real flips (Decided above, later Decided below or the reverse) affect ≤ 0.4%
   of ever-Decided at k ≥ 2 and 1.7–2.1% at k = 1.5. None is quick: a flip
   spends a median 12–32 of its own Comparisons Undecided in between. Between
   3% and 11% of ever-Decided wallpapers end the run Undecided.
7. **Under baseline, Decided wallpapers are not left alone.** After first
   becoming Decided, a wallpaper still gets 0.98–0.99 of its fair share of
   Comparisons (median 34 more at k = 2 over the 40-Each budget). Only 0.1–0.7%
   get none. At k = 2, 54% of all votes show two wallpapers that are both
   already Decided. The votes the rule could save only come back with a
   selector that reads it.
8. **"Ever wrong" is the number to watch if Decided triggers anything.** Over
   a whole run at noise 1.0, n = 500, the share of wallpapers Decided on the
   wrong side at some vote is 3.6–3.7 per 100 at k = 2, 1.7 at k = 2.5, and
   0.7 at k = 3, even though the instantaneous rate is far lower.

## 1–2. Votes to 50% / 70% Decided, and wrong-side rate

n = 500, `plain`, 20 libraries. Votes are medians. "(r/20)" means only r
libraries got there within budget.

| Voter | Noise | k | 50%: votes | Each | 70%: votes | Each | Wrong @4 | @8 | @16 | @40 | Ever wrong /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| thurstone | 0.5 | 1.5 | 1274 | 5.1 | 2798 | 11.2 | 1.04% | 0.88% | 0.54% | 0.30% | 2.99 |
| thurstone | 0.5 | 2 | 1962 | 7.8 | 4286 | 17.1 | 0.27% | 0.32% | 0.13% | 0.05% | 0.99 |
| thurstone | 0.5 | 2.5 | 2671 | 10.7 | 5959 | 23.8 | 0.11% | 0.10% | 0.03% | 0.00% | 0.26 |
| thurstone | 0.5 | 3 | 3530 | 14.1 | 7993 | 32.0 | 0.00% | 0.00% | 0.00% | 0.00% | 0.00 |
| thurstone | 1.0 | 1.5 | 1333 | 5.3 | 3087 | 12.3 | 2.64% | 3.26% | 2.79% | 1.97% | 7.42 |
| thurstone | 1.0 | 2 | 2135 | 8.5 | 4762 | 19.0 | 1.13% | 1.62% | 1.51% | 1.19% | 3.67 |
| thurstone | 1.0 | 2.5 | 3025 | 12.1 | 6826 | 27.3 | 0.55% | 0.77% | 0.87% | 0.69% | 1.72 |
| thurstone | 1.0 | 3 | 3953 | 15.8 | 9503 (14/20) | 38.0 | 0.15% | 0.18% | 0.40% | 0.34% | 0.74 |
| bradley-terry | 0.5 | 1.5 | 1296 | 5.2 | 2826 | 11.3 | 1.07% | 0.97% | 0.58% | 0.37% | 3.51 |
| bradley-terry | 0.5 | 2 | 1958 | 7.8 | 4292 | 17.2 | 0.25% | 0.30% | 0.22% | 0.10% | 1.14 |
| bradley-terry | 0.5 | 2.5 | 2749 | 11.0 | 6056 | 24.2 | 0.00% | 0.03% | 0.07% | 0.03% | 0.24 |
| bradley-terry | 0.5 | 3 | 3480 | 13.9 | 7947 | 31.8 | 0.00% | 0.00% | 0.02% | 0.00% | 0.03 |
| bradley-terry | 1.0 | 1.5 | 1355 | 5.4 | 3140 | 12.6 | 2.78% | 3.01% | 2.79% | 1.80% | 7.12 |
| bradley-terry | 1.0 | 2 | 2155 | 8.6 | 5090 | 20.4 | 1.53% | 1.65% | 1.38% | 1.05% | 3.62 |
| bradley-terry | 1.0 | 2.5 | 3007 | 12.0 | 7159 | 28.6 | 0.68% | 0.78% | 0.70% | 0.57% | 1.72 |
| bradley-terry | 1.0 | 3 | 4073 | 16.3 | 9771 (13/20) | 39.1 | 0.16% | 0.26% | 0.37% | 0.29% | 0.70 |

The k decision at noise 1.0, rechecked on 100 libraries (Each to 50% / 70%, then Wrong @4 / 8 / 16 / 40):

| n | Rule | k | thurstone | | bradley-terry | |
|---:|---|---:|---|---|---|---|
| 120 | plain | 2 | 8.7 / 18.7 | 1.59 1.91 1.85 1.44% | 8.3 / 18.4 | 1.57 2.05 1.85 1.43% |
| 120 | plain | 2.5 | 12.0 / 27.1 (98) | 0.74 1.04 1.15 0.89% | 11.8 / 27.0 | 0.85 1.04 1.05 0.96% |
| 120 | plain | 3 | 15.7 / 37.0 (75) | 0.39 0.37 0.56 0.59% | 15.6 / 37.2 (68) | 0.14 0.53 0.59 0.50% |
| 120 | bar-sigma | 2 | 14.3 / 33.8 (84) | 0.54 0.45 0.71 0.65% | 14.1 / 32.5 (85) | 0.27 0.62 0.75 0.65% |
| 500 | plain | 2 | 8.8 / 19.7 | 1.57 1.68 1.62 1.35% | 8.8 / 20.0 | 1.63 1.65 1.61 1.13% |
| 500 | plain | 2.5 | 12.2 / 28.1 | 0.76 0.63 0.85 0.76% | 12.1 / 28.4 | 0.80 0.85 0.82 0.64% |
| 500 | plain | 3 | 16.1 / 38.5 (67) | 0.28 0.24 0.37 0.43% | 16.1 / 38.7 (65) | 0.39 0.34 0.42 0.35% |
| 500 | bar-sigma | 1.5 | 9.4 / 21.4 | 1.29 1.31 1.41 1.17% | 9.4 / 21.8 | 1.22 1.43 1.41 0.98% |
| 500 | bar-sigma | 2 | 14.5 / 34.3 (94) | 0.32 0.40 0.52 0.54% | 14.4 / 35.3 (96) | 0.58 0.50 0.53 0.43% |

A number in parentheses is how many of the 100 libraries reached 70% within 40 Each.

## 3. Reversion

n = 500, noise 1.0, 20 libraries, whole run (40 Each). Events are Decided →
Undecided. Cause is split into Bar only, own Rating only, and both. "Back ≤2"
is the share of events that were Decided again on the same side within 2 of
the wallpaper's own Comparisons; "by Bar" means it got there with none.

| Voter | Rule | k | Ever Decided | Reverted (of ever) | Undecided at end | Events /100 votes | Bar / Own / Both | Back ≤2 | Back by Bar | Flips (of ever) | Median flip gap |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| thurstone | plain | 1.5 | 94.8% | 53.1% | 10.5% | 7.78 | 52 / 48 / 0.2% | 79.1% | 44.0% | 1.7% | 18 |
| thurstone | plain | 2 | 87.4% | 53.7% | 8.5% | 6.69 | 56 / 44 / 0.1% | 81.7% | 45.7% | 0.2% | 23 |
| thurstone | plain | 2.5 | 80.8% | 51.1% | 7.1% | 5.69 | 59 / 41 / 0% | 83.1% | 48.9% | 0.0% | 28 |
| thurstone | plain | 3 | 74.4% | 47.1% | 5.3% | 4.62 | 60 / 40 / 0% | 84.8% | 50.2% | 0.0% | — |
| thurstone | bar-sigma | 2 | 76.6% | 65.0% | 6.2% | 10.07 | 74 / 26 / 0% | 91.5% | 72.9% | 0.0% | — |
| bradley-terry | plain | 1.5 | 95.0% | 54.0% | 10.4% | 8.13 | 54 / 46 / 0.2% | 79.3% | 45.8% | 1.9% | 17 |
| bradley-terry | plain | 2 | 88.3% | 55.2% | 9.3% | 6.81 | 57 / 43 / 0.1% | 80.5% | 46.2% | 0.4% | 25 |
| bradley-terry | plain | 2.5 | 80.9% | 51.6% | 7.3% | 5.78 | 58 / 42 / 0% | 83.5% | 48.6% | 0.0% | 26 |
| bradley-terry | plain | 3 | 74.5% | 48.0% | 5.8% | 4.77 | 62 / 38 / 0% | 84.6% | 50.4% | 0.0% | — |
| bradley-terry | bar-sigma | 2 | 76.9% | 65.5% | 6.8% | 10.59 | 74 / 26 / 0% | 91.6% | 73.4% | 0.0% | — |

No flip anywhere was quick: none spent ≤ 2 of its own Comparisons Undecided
between the two sides. Noise 0.5 and n = 120 look the same, with slightly
fewer events (tables below).

## 4. Young library

Each ≤ 2, noise 1.0, 20 libraries. "Wrong ≤2" pools every vote up to Each 2.
"Ever wrong ≤2" counts wallpapers Decided on the wrong side at any vote up to
Each 2, per 100 wallpapers. The last column is the range, across libraries, of
Scores the Bar rested on when the first wallpaper was Decided.

| n | Voter | Rule | k | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Scores under Bar at first Decided | 50% Each | 70% Each |
|---:|---|---|---:|---:|---:|---:|---:|---|---:|---:|
| 120 | thurstone | plain | 1.5 | 24.6% | 3.38% | 4.13% | 1.08 | 11–69 | 5.4 | 12.2 |
| 120 | thurstone | plain | 2 | 9.3% | 2.69% | 2.92% | 0.25 | 76–120 | 8.8 | 18.2 |
| 120 | thurstone | plain | 2.5 | 1.2% | 6.90% | 7.84% | 0.08 | 120 | 12.2 | 25.6 (19/20) |
| 120 | thurstone | warmup 25 | 1.5 | 24.6% | 3.38% | 4.13% | 1.08 | 25–69 | 5.4 | 12.2 |
| 120 | thurstone | warmup 25 | 2 | 9.3% | 2.69% | 2.92% | 0.25 | 76–120 | 8.8 | 18.2 |
| 120 | thurstone | participated | 2 | 9.3% | 2.69% | 2.65% | 0.25 | 120 | 8.8 | 18.2 |
| 120 | thurstone | bar-sigma | 1.5 | 5.1% | 3.25% | 4.31% | 0.17 | 114–120 | 9.4 | 19.5 |
| 120 | thurstone | bar-sigma | 2 | 0.0% | — | — | 0.00 | 120 | 14.0 | 31.9 (18/20) |
| 120 | bradley-terry | plain | 2 | 9.3% | 2.69% | 1.63% | 0.25 | 50–120 | 8.3 | 16.7 |
| 120 | bradley-terry | participated | 2 | 9.3% | 2.69% | 1.78% | 0.25 | 120 | 8.3 | 16.7 |
| 120 | bradley-terry | bar-sigma | 2 | 0.0% | — | — | 0.00 | 120 | 13.8 | 31.8 (18/20) |
| 500 | thurstone | plain | 2 | 10.2% | 1.47% | 0.98% | 0.16 | 157–457 | 8.5 | 19.0 |
| 500 | thurstone | warmup 25 | 2 | 10.2% | 1.47% | 0.98% | 0.16 | 157–457 | 8.5 | 19.0 |
| 500 | thurstone | participated | 2 | 10.2% | 1.47% | 1.09% | 0.16 | 500 | 8.5 | 19.0 |
| 500 | thurstone | bar-sigma | 2 | 0.0% | — | — | 0.00 | 500 | 14.5 | 33.3 (19/20) |
| 500 | bradley-terry | plain | 2 | 9.5% | 1.89% | 1.75% | 0.20 | 119–492 | 8.6 | 20.4 |
| 500 | bradley-terry | participated | 2 | 9.5% | 1.89% | 1.95% | 0.20 | 500 | 8.6 | 20.4 |
| 500 | bradley-terry | bar-sigma | 2 | 0.0% | — | — | 0.00 | 500 | 14.8 | 35.7 (19/20) |

At k = 2.5 about 1% of wallpapers are Decided by Each 2, which is roughly one
wallpaper per library at n = 120, so its 6.9% there is a handful of events.
`warmup 25` matches `plain` in every row at k ≥ 2, and its votes-to-50/70%
match to the vote.

Caveat: the simulated library exists in full from the first vote. A library
that grows while being voted on would put new, Unrated wallpapers next to
settled ones. `select_pair` would compare the newcomers first, but that case
is not measured here.

## 5. Attention after Decided

Whole run, `plain`, n = 500, noise 1.0. "vs fair" compares a wallpaper's
Comparisons after it was first Decided with 2 × (votes left) / n; 1.0 means it
got as much as anyone.

| Voter | k | Median Comparisons after first Decided | None after | Median vs fair | Votes with ≥ 1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| thurstone | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.6% |
| thurstone | 2 | 34 | 0.2% | 0.99 | 66.4% | 54.2% |
| thurstone | 2.5 | 32 | 0.4% | 0.99 | 58.4% | 47.5% |
| thurstone | 3 | 30 | 0.6% | 0.98 | 51.5% | 41.8% |
| bradley-terry | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.5% |
| bradley-terry | 2 | 34 | 0.3% | 0.99 | 66.2% | 54.0% |
| bradley-terry | 2.5 | 32 | 0.5% | 0.99 | 58.3% | 47.4% |
| bradley-terry | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.4% |

No: under baseline, Decided wallpapers are almost never left uncompared. They
keep getting their full share, since `select_pair` looks only at Comparison
counts and μ closeness, never at the Bar.

## Full output

### Decided rules: thurstone, 20 libraries

Voter thurstone, Bar worst 20% of the Scored, prior uniform, update winner-beats-each. 20 libraries per row, budget 40 Comparisons per wallpaper, seed 1. Every rule is followed through the same runs.

#### n = 120, baseline (select_pair), thurstone(noise=0.5)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 295 | 4.9 | 633 | 10.6 | 0.88% | 1.14% | 0.83% | 0.10% |
| plain | 2 | 446 | 7.4 | 992 | 16.5 | 0.29% | 0.24% | 0.12% | 0.00% |
| plain | 2.5 | 624 | 10.4 | 1383 | 23.1 | 0.00% | 0.00% | 0.00% | 0.00% |
| plain | 3 | 814 | 13.6 | 1903 | 31.7 | 0.00% | 0.00% | 0.00% | 0.00% |
| warmup 25 | 1.5 | 295 | 4.9 | 633 | 10.6 | 0.88% | 1.14% | 0.83% | 0.10% |
| warmup 25 | 2 | 446 | 7.4 | 992 | 16.5 | 0.29% | 0.24% | 0.12% | 0.00% |
| warmup 25 | 2.5 | 624 | 10.4 | 1383 | 23.1 | 0.00% | 0.00% | 0.00% | 0.00% |
| warmup 25 | 3 | 814 | 13.6 | 1903 | 31.7 | 0.00% | 0.00% | 0.00% | 0.00% |
| participated | 1.5 | 295 | 4.9 | 633 | 10.6 | 0.88% | 1.14% | 0.83% | 0.10% |
| participated | 2 | 446 | 7.4 | 992 | 16.5 | 0.29% | 0.24% | 0.12% | 0.00% |
| participated | 2.5 | 624 | 10.4 | 1383 | 23.1 | 0.00% | 0.00% | 0.00% | 0.00% |
| participated | 3 | 814 | 13.6 | 1903 | 31.7 | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 1.5 | 475 | 7.9 | 1114 | 18.6 | 0.00% | 0.17% | 0.06% | 0.00% |
| bar-sigma | 2 | 763 | 12.7 | 1711 | 28.5 | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 2.5 | 1064 | 17.7 | — | — (6/20) | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 3 | 1369 | 22.8 | — | — (0/20) | 0.00% | 0.00% | 0.00% | 0.00% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.0% | 2.52% | 26.5% | 0.94% | 1.42% | 0.29 | 3.42 | 11–70 |
| plain | 2 | 0.3% | 0.00% | 10.7% | 0.39% | 0.18% | 0.04 | 1.33 | 76–120 |
| plain | 2.5 | 0.0% | — | 1.7% | 0.00% | 0.00% | 0.00 | 0.21 | 120–120 |
| plain | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.00 | 120–120 |
| warmup 25 | 1.5 | 5.0% | 2.52% | 26.5% | 0.94% | 1.42% | 0.29 | 3.42 | 25–70 |
| warmup 25 | 2 | 0.3% | 0.00% | 10.7% | 0.39% | 0.18% | 0.04 | 1.33 | 76–120 |
| warmup 25 | 2.5 | 0.0% | — | 1.7% | 0.00% | 0.00% | 0.00 | 0.21 | 120–120 |
| warmup 25 | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.00 | 120–120 |
| participated | 1.5 | 0.0% | — | 26.5% | 0.94% | 1.14% | 0.29 | 3.42 | 120–120 |
| participated | 2 | 0.0% | — | 10.7% | 0.39% | 0.20% | 0.04 | 1.33 | 120–120 |
| participated | 2.5 | 0.0% | — | 1.7% | 0.00% | 0.00% | 0.00 | 0.21 | 120–120 |
| participated | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.00 | 120–120 |
| bar-sigma | 1.5 | 0.0% | — | 6.8% | 0.00% | 0.00% | 0.00 | 0.88 | 98–120 |
| bar-sigma | 2 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.04 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.7% | 51.8% | 9.4% | 6.70 | 51.3% | 47.8% | 0.9% | 77.7% | 38.0% | 0.7% | 0.0% | 22 |
| plain | 2 | 88.7% | 53.5% | 7.4% | 5.84 | 55.7% | 44.0% | 0.2% | 80.1% | 39.0% | 0.1% | 0.0% | 21 |
| plain | 2.5 | 82.2% | 51.9% | 6.4% | 5.12 | 57.8% | 42.2% | 0.1% | 82.2% | 42.6% | 0.0% | — | — |
| plain | 3 | 76.8% | 49.7% | 5.3% | 4.17 | 61.3% | 38.6% | 0.0% | 82.2% | 41.0% | 0.0% | — | — |
| warmup 25 | 1.5 | 94.7% | 51.8% | 9.4% | 6.70 | 51.3% | 47.8% | 0.9% | 77.7% | 38.0% | 0.7% | 0.0% | 22 |
| warmup 25 | 2 | 88.7% | 53.5% | 7.4% | 5.84 | 55.7% | 44.0% | 0.2% | 80.1% | 39.0% | 0.1% | 0.0% | 21 |
| warmup 25 | 2.5 | 82.2% | 51.9% | 6.4% | 5.12 | 57.8% | 42.2% | 0.1% | 82.2% | 42.6% | 0.0% | — | — |
| warmup 25 | 3 | 76.8% | 49.7% | 5.3% | 4.17 | 61.3% | 38.6% | 0.0% | 82.2% | 41.0% | 0.0% | — | — |
| participated | 1.5 | 94.7% | 51.6% | 9.4% | 6.67 | 51.5% | 47.6% | 0.9% | 77.6% | 38.0% | 0.7% | 0.0% | 22 |
| participated | 2 | 88.7% | 53.5% | 7.4% | 5.84 | 55.7% | 44.0% | 0.2% | 80.1% | 39.0% | 0.1% | 0.0% | 21 |
| participated | 2.5 | 82.2% | 51.9% | 6.4% | 5.12 | 57.8% | 42.2% | 0.1% | 82.2% | 42.6% | 0.0% | — | — |
| participated | 3 | 76.8% | 49.7% | 5.3% | 4.17 | 61.3% | 38.6% | 0.0% | 82.2% | 41.0% | 0.0% | — | — |
| bar-sigma | 1.5 | 87.0% | 57.5% | 7.4% | 6.44 | 50.2% | 49.6% | 0.2% | 83.0% | 47.5% | 0.1% | 0.0% | 21 |
| bar-sigma | 2 | 78.4% | 56.5% | 5.7% | 5.38 | 52.5% | 47.5% | 0.0% | 84.9% | 52.8% | 0.0% | — | — |
| bar-sigma | 2.5 | 70.6% | 52.7% | 4.2% | 3.91 | 54.7% | 45.3% | 0.0% | 85.3% | 52.2% | 0.0% | — | — |
| bar-sigma | 3 | 64.2% | 54.4% | 3.0% | 3.54 | 54.9% | 45.1% | 0.0% | 89.2% | 53.9% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.1% | 0.99 | 76.4% | 63.7% |
| plain | 2 | 34 | 0.3% | 0.99 | 68.4% | 56.7% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.3% |
| plain | 3 | 30 | 0.6% | 0.99 | 54.3% | 44.6% |
| warmup 25 | 1.5 | 36 | 0.1% | 0.99 | 76.4% | 63.7% |
| warmup 25 | 2 | 34 | 0.3% | 0.99 | 68.4% | 56.7% |
| warmup 25 | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.3% |
| warmup 25 | 3 | 30 | 0.6% | 0.99 | 54.3% | 44.6% |
| participated | 1.5 | 36 | 0.1% | 0.99 | 76.3% | 63.7% |
| participated | 2 | 34 | 0.3% | 0.99 | 68.4% | 56.7% |
| participated | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.3% |
| participated | 3 | 30 | 0.6% | 0.99 | 54.3% | 44.6% |
| bar-sigma | 1.5 | 34 | 0.4% | 0.99 | 66.7% | 55.4% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 56.8% | 46.9% |
| bar-sigma | 2.5 | 29 | 0.7% | 0.99 | 48.2% | 39.6% |
| bar-sigma | 3 | 27 | 0.5% | 0.99 | 41.1% | 33.8% |

#### n = 120, baseline (select_pair), thurstone(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 323 | 5.4 | 733 | 12.2 | 2.53% | 3.53% | 2.76% | 1.74% |
| plain | 2 | 525 | 8.8 | 1095 | 18.2 | 1.13% | 1.54% | 1.53% | 1.00% |
| plain | 2.5 | 730 | 12.2 | 1533 | 25.6 (19/20) | 0.54% | 0.94% | 1.16% | 0.67% |
| plain | 3 | 955 | 15.9 | 2152 | 35.9 (15/20) | 0.61% | 0.15% | 0.51% | 0.47% |
| warmup 25 | 1.5 | 323 | 5.4 | 733 | 12.2 | 2.53% | 3.53% | 2.76% | 1.74% |
| warmup 25 | 2 | 525 | 8.8 | 1095 | 18.2 | 1.13% | 1.54% | 1.53% | 1.00% |
| warmup 25 | 2.5 | 730 | 12.2 | 1533 | 25.6 (19/20) | 0.54% | 0.94% | 1.16% | 0.67% |
| warmup 25 | 3 | 955 | 15.9 | 2152 | 35.9 (15/20) | 0.61% | 0.15% | 0.51% | 0.47% |
| participated | 1.5 | 323 | 5.4 | 733 | 12.2 | 2.53% | 3.53% | 2.76% | 1.74% |
| participated | 2 | 525 | 8.8 | 1095 | 18.2 | 1.13% | 1.54% | 1.53% | 1.00% |
| participated | 2.5 | 730 | 12.2 | 1533 | 25.6 (19/20) | 0.54% | 0.94% | 1.16% | 0.67% |
| participated | 3 | 955 | 15.9 | 2152 | 35.9 (15/20) | 0.61% | 0.15% | 0.51% | 0.47% |
| bar-sigma | 1.5 | 565 | 9.4 | 1172 | 19.5 | 1.25% | 1.34% | 1.31% | 0.96% |
| bar-sigma | 2 | 842 | 14.0 | 1915 | 31.9 (18/20) | 0.41% | 0.28% | 0.80% | 0.47% |
| bar-sigma | 2.5 | 1172 | 19.5 | — | — (2/20) | 0.00% | 0.00% | 0.10% | 0.38% |
| bar-sigma | 3 | 1571 | 26.2 | — | — (0/20) | 0.00% | 0.00% | 0.12% | 0.35% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 4.7% | 5.36% | 24.6% | 3.38% | 4.13% | 1.08 | 8.50 | 11–69 |
| plain | 2 | 0.2% | 0.00% | 9.3% | 2.69% | 2.92% | 0.25 | 3.67 | 76–120 |
| plain | 2.5 | 0.0% | — | 1.2% | 6.90% | 7.84% | 0.08 | 1.71 | 120–120 |
| plain | 3 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 0.75 | 120–120 |
| warmup 25 | 1.5 | 4.7% | 5.36% | 24.6% | 3.38% | 4.13% | 1.08 | 8.50 | 25–69 |
| warmup 25 | 2 | 0.2% | 0.00% | 9.3% | 2.69% | 2.92% | 0.25 | 3.67 | 76–120 |
| warmup 25 | 2.5 | 0.0% | — | 1.2% | 6.90% | 7.84% | 0.08 | 1.71 | 120–120 |
| warmup 25 | 3 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 0.75 | 120–120 |
| participated | 1.5 | 0.0% | — | 24.6% | 3.38% | 4.05% | 1.04 | 8.50 | 120–120 |
| participated | 2 | 0.0% | — | 9.3% | 2.69% | 2.65% | 0.25 | 3.67 | 120–120 |
| participated | 2.5 | 0.0% | — | 1.2% | 6.90% | 7.84% | 0.08 | 1.71 | 120–120 |
| participated | 3 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 0.75 | 120–120 |
| bar-sigma | 1.5 | 0.0% | — | 5.1% | 3.25% | 4.31% | 0.17 | 3.33 | 114–120 |
| bar-sigma | 2 | 0.0% | — | 0.0% | — | — | 0.00 | 1.12 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.50 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.21 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.7% | 56.6% | 11.2% | 7.73 | 51.8% | 47.4% | 0.8% | 77.1% | 38.5% | 2.1% | 0.0% | 19 |
| plain | 2 | 87.0% | 57.5% | 8.6% | 6.36 | 55.2% | 44.4% | 0.3% | 79.0% | 38.3% | 0.2% | 0.0% | 21 |
| plain | 2.5 | 80.7% | 54.5% | 7.2% | 5.58 | 58.2% | 41.8% | 0.0% | 81.9% | 42.3% | 0.1% | 0.0% | 22 |
| plain | 3 | 74.6% | 52.0% | 5.8% | 4.57 | 61.5% | 38.5% | 0.0% | 82.2% | 42.2% | 0.0% | — | — |
| warmup 25 | 1.5 | 94.7% | 56.6% | 11.2% | 7.73 | 51.8% | 47.4% | 0.8% | 77.1% | 38.5% | 2.1% | 0.0% | 19 |
| warmup 25 | 2 | 87.0% | 57.5% | 8.6% | 6.36 | 55.2% | 44.4% | 0.3% | 79.0% | 38.3% | 0.2% | 0.0% | 21 |
| warmup 25 | 2.5 | 80.7% | 54.5% | 7.2% | 5.58 | 58.2% | 41.8% | 0.0% | 81.9% | 42.3% | 0.1% | 0.0% | 22 |
| warmup 25 | 3 | 74.6% | 52.0% | 5.8% | 4.57 | 61.5% | 38.5% | 0.0% | 82.2% | 42.2% | 0.0% | — | — |
| participated | 1.5 | 94.7% | 56.3% | 11.2% | 7.69 | 52.1% | 47.2% | 0.8% | 77.0% | 38.4% | 2.1% | 0.0% | 19 |
| participated | 2 | 87.0% | 57.5% | 8.6% | 6.36 | 55.3% | 44.4% | 0.3% | 79.0% | 38.3% | 0.2% | 0.0% | 21 |
| participated | 2.5 | 80.7% | 54.5% | 7.2% | 5.58 | 58.2% | 41.8% | 0.0% | 81.9% | 42.3% | 0.1% | 0.0% | 22 |
| participated | 3 | 74.6% | 52.0% | 5.8% | 4.57 | 61.5% | 38.5% | 0.0% | 82.2% | 42.2% | 0.0% | — | — |
| bar-sigma | 1.5 | 85.9% | 61.4% | 8.8% | 7.10 | 53.1% | 46.7% | 0.3% | 82.3% | 49.8% | 0.1% | 0.0% | 21 |
| bar-sigma | 2 | 76.3% | 60.6% | 6.2% | 5.98 | 54.5% | 45.5% | 0.0% | 85.0% | 54.6% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.7% | 56.4% | 5.2% | 4.64 | 56.5% | 43.5% | 0.0% | 86.9% | 53.9% | 0.0% | — | — |
| bar-sigma | 3 | 61.2% | 56.4% | 3.9% | 3.92 | 56.1% | 43.9% | 0.0% | 88.0% | 54.4% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.1% | 0.99 | 74.6% | 61.1% |
| plain | 2 | 34 | 0.2% | 0.99 | 66.0% | 53.9% |
| plain | 2.5 | 32 | 0.6% | 0.99 | 58.3% | 47.5% |
| plain | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.7% |
| warmup 25 | 1.5 | 36 | 0.1% | 0.99 | 74.6% | 61.1% |
| warmup 25 | 2 | 34 | 0.2% | 0.99 | 66.0% | 53.9% |
| warmup 25 | 2.5 | 32 | 0.6% | 0.99 | 58.3% | 47.5% |
| warmup 25 | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.7% |
| participated | 1.5 | 36 | 0.1% | 0.99 | 74.5% | 61.1% |
| participated | 2 | 34 | 0.2% | 0.99 | 66.0% | 53.9% |
| participated | 2.5 | 32 | 0.6% | 0.99 | 58.3% | 47.5% |
| participated | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.7% |
| bar-sigma | 1.5 | 33 | 0.3% | 0.99 | 64.5% | 52.6% |
| bar-sigma | 2 | 31 | 0.3% | 0.99 | 54.0% | 44.0% |
| bar-sigma | 2.5 | 28 | 0.5% | 0.99 | 45.2% | 36.7% |
| bar-sigma | 3 | 26 | 1.0% | 0.99 | 37.6% | 30.2% |

#### n = 500, baseline (select_pair), thurstone(noise=0.5)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1274 | 5.1 | 2798 | 11.2 | 1.04% | 0.88% | 0.54% | 0.30% |
| plain | 2 | 1962 | 7.8 | 4286 | 17.1 | 0.27% | 0.32% | 0.13% | 0.05% |
| plain | 2.5 | 2671 | 10.7 | 5959 | 23.8 | 0.11% | 0.10% | 0.03% | 0.00% |
| plain | 3 | 3530 | 14.1 | 7993 | 32.0 | 0.00% | 0.00% | 0.00% | 0.00% |
| warmup 25 | 1.5 | 1274 | 5.1 | 2798 | 11.2 | 1.04% | 0.88% | 0.54% | 0.30% |
| warmup 25 | 2 | 1962 | 7.8 | 4286 | 17.1 | 0.27% | 0.32% | 0.13% | 0.05% |
| warmup 25 | 2.5 | 2671 | 10.7 | 5959 | 23.8 | 0.11% | 0.10% | 0.03% | 0.00% |
| warmup 25 | 3 | 3530 | 14.1 | 7993 | 32.0 | 0.00% | 0.00% | 0.00% | 0.00% |
| participated | 1.5 | 1274 | 5.1 | 2798 | 11.2 | 1.04% | 0.88% | 0.54% | 0.30% |
| participated | 2 | 1962 | 7.8 | 4286 | 17.1 | 0.27% | 0.32% | 0.13% | 0.05% |
| participated | 2.5 | 2671 | 10.7 | 5959 | 23.8 | 0.11% | 0.10% | 0.03% | 0.00% |
| participated | 3 | 3530 | 14.1 | 7993 | 32.0 | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 1.5 | 2070 | 8.3 | 4529 | 18.1 | 0.30% | 0.19% | 0.09% | 0.02% |
| bar-sigma | 2 | 3213 | 12.9 | 7174 | 28.7 | 0.08% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 2.5 | 4485 | 17.9 | — | — (2/20) | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 3 | 5898 | 23.6 | — | — (0/20) | 0.00% | 0.00% | 0.00% | 0.00% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.7% | 1.57% | 26.2% | 1.45% | 1.50% | 0.44 | 2.99 | 23–147 |
| plain | 2 | 0.4% | 0.00% | 11.3% | 0.88% | 0.91% | 0.11 | 0.99 | 122–488 |
| plain | 2.5 | 0.0% | — | 1.9% | 1.05% | 0.92% | 0.02 | 0.26 | 500–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.00 | 500–500 |
| warmup 25 | 1.5 | 5.7% | 1.57% | 26.2% | 1.45% | 1.50% | 0.44 | 2.99 | 26–147 |
| warmup 25 | 2 | 0.4% | 0.00% | 11.3% | 0.88% | 0.91% | 0.11 | 0.99 | 122–488 |
| warmup 25 | 2.5 | 0.0% | — | 1.9% | 1.05% | 0.92% | 0.02 | 0.26 | 500–500 |
| warmup 25 | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.00 | 500–500 |
| participated | 1.5 | 0.0% | — | 26.2% | 1.45% | 1.44% | 0.43 | 2.99 | 500–500 |
| participated | 2 | 0.0% | — | 11.3% | 0.88% | 0.99% | 0.11 | 0.99 | 500–500 |
| participated | 2.5 | 0.0% | — | 1.9% | 1.05% | 0.92% | 0.02 | 0.26 | 500–500 |
| participated | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.00 | 500–500 |
| bar-sigma | 1.5 | 0.1% | 0.00% | 6.6% | 1.06% | 0.89% | 0.08 | 0.81 | 292–500 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 0.11 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.2% | 48.7% | 8.5% | 6.91 | 53.3% | 46.5% | 0.2% | 79.9% | 45.2% | 0.8% | 0.0% | 17 |
| plain | 2 | 87.7% | 50.4% | 6.7% | 6.11 | 55.8% | 44.1% | 0.1% | 81.9% | 45.9% | 0.1% | 0.0% | 26 |
| plain | 2.5 | 81.8% | 47.8% | 5.1% | 5.27 | 60.1% | 39.8% | 0.0% | 84.5% | 49.8% | 0.0% | — | — |
| plain | 3 | 76.4% | 43.9% | 4.0% | 4.27 | 62.3% | 37.7% | 0.0% | 86.6% | 52.0% | 0.0% | — | — |
| warmup 25 | 1.5 | 94.2% | 48.7% | 8.5% | 6.91 | 53.3% | 46.5% | 0.2% | 79.9% | 45.2% | 0.8% | 0.0% | 17 |
| warmup 25 | 2 | 87.7% | 50.4% | 6.7% | 6.11 | 55.8% | 44.1% | 0.1% | 81.9% | 45.9% | 0.1% | 0.0% | 26 |
| warmup 25 | 2.5 | 81.8% | 47.8% | 5.1% | 5.27 | 60.1% | 39.8% | 0.0% | 84.5% | 49.8% | 0.0% | — | — |
| warmup 25 | 3 | 76.4% | 43.9% | 4.0% | 4.27 | 62.3% | 37.7% | 0.0% | 86.6% | 52.0% | 0.0% | — | — |
| participated | 1.5 | 94.2% | 48.5% | 8.5% | 6.89 | 53.5% | 46.3% | 0.2% | 79.9% | 45.2% | 0.8% | 0.0% | 17 |
| participated | 2 | 87.7% | 50.4% | 6.7% | 6.11 | 55.8% | 44.1% | 0.1% | 81.9% | 45.9% | 0.1% | 0.0% | 26 |
| participated | 2.5 | 81.8% | 47.8% | 5.1% | 5.27 | 60.1% | 39.8% | 0.0% | 84.5% | 49.8% | 0.0% | — | — |
| participated | 3 | 76.4% | 43.9% | 4.0% | 4.27 | 62.3% | 37.7% | 0.0% | 86.6% | 52.0% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.4% | 63.3% | 6.6% | 10.69 | 70.1% | 29.9% | 0.0% | 89.7% | 68.7% | 0.1% | 0.0% | 26 |
| bar-sigma | 2 | 78.4% | 63.0% | 4.6% | 9.21 | 73.7% | 26.3% | 0.0% | 92.1% | 73.0% | 0.0% | — | — |
| bar-sigma | 2.5 | 71.2% | 61.6% | 3.7% | 7.83 | 75.1% | 24.9% | 0.0% | 93.1% | 75.1% | 0.0% | — | — |
| bar-sigma | 3 | 64.9% | 62.2% | 3.2% | 6.73 | 75.5% | 24.5% | 0.0% | 93.8% | 75.1% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 76.6% | 64.0% |
| plain | 2 | 34 | 0.3% | 0.99 | 68.5% | 57.0% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.6% |
| plain | 3 | 30 | 0.5% | 0.99 | 54.4% | 45.1% |
| warmup 25 | 1.5 | 36 | 0.2% | 0.99 | 76.6% | 64.0% |
| warmup 25 | 2 | 34 | 0.3% | 0.99 | 68.5% | 57.0% |
| warmup 25 | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.6% |
| warmup 25 | 3 | 30 | 0.5% | 0.99 | 54.4% | 45.1% |
| participated | 1.5 | 36 | 0.2% | 0.99 | 76.5% | 64.0% |
| participated | 2 | 34 | 0.3% | 0.99 | 68.5% | 57.0% |
| participated | 2.5 | 32 | 0.4% | 0.99 | 61.0% | 50.6% |
| participated | 3 | 30 | 0.5% | 0.99 | 54.4% | 45.1% |
| bar-sigma | 1.5 | 34 | 0.2% | 0.99 | 66.9% | 55.7% |
| bar-sigma | 2 | 31 | 0.5% | 0.99 | 56.9% | 47.2% |
| bar-sigma | 2.5 | 29 | 0.6% | 0.99 | 48.4% | 40.0% |
| bar-sigma | 3 | 26 | 0.7% | 0.99 | 40.9% | 33.5% |

#### n = 500, baseline (select_pair), thurstone(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1333 | 5.3 | 3087 | 12.3 | 2.64% | 3.26% | 2.79% | 1.97% |
| plain | 2 | 2135 | 8.5 | 4762 | 19.0 | 1.13% | 1.62% | 1.51% | 1.19% |
| plain | 2.5 | 3025 | 12.1 | 6826 | 27.3 | 0.55% | 0.77% | 0.87% | 0.69% |
| plain | 3 | 3953 | 15.8 | 9503 | 38.0 (14/20) | 0.15% | 0.18% | 0.40% | 0.34% |
| warmup 25 | 1.5 | 1333 | 5.3 | 3087 | 12.3 | 2.64% | 3.26% | 2.79% | 1.97% |
| warmup 25 | 2 | 2135 | 8.5 | 4762 | 19.0 | 1.13% | 1.62% | 1.51% | 1.19% |
| warmup 25 | 2.5 | 3025 | 12.1 | 6826 | 27.3 | 0.55% | 0.77% | 0.87% | 0.69% |
| warmup 25 | 3 | 3953 | 15.8 | 9503 | 38.0 (14/20) | 0.15% | 0.18% | 0.40% | 0.34% |
| participated | 1.5 | 1333 | 5.3 | 3087 | 12.3 | 2.64% | 3.26% | 2.79% | 1.97% |
| participated | 2 | 2135 | 8.5 | 4762 | 19.0 | 1.13% | 1.62% | 1.51% | 1.19% |
| participated | 2.5 | 3025 | 12.1 | 6826 | 27.3 | 0.55% | 0.77% | 0.87% | 0.69% |
| participated | 3 | 3953 | 15.8 | 9503 | 38.0 (14/20) | 0.15% | 0.18% | 0.40% | 0.34% |
| bar-sigma | 1.5 | 2373 | 9.5 | 5236 | 20.9 | 1.01% | 1.44% | 1.17% | 1.01% |
| bar-sigma | 2 | 3624 | 14.5 | 8326 | 33.3 (19/20) | 0.10% | 0.36% | 0.50% | 0.45% |
| bar-sigma | 2.5 | 4968 | 19.9 | — | — (0/20) | 0.00% | 0.16% | 0.24% | 0.20% |
| bar-sigma | 3 | 6788 | 27.2 | — | — (0/20) | 0.00% | 0.10% | 0.06% | 0.09% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 4.8% | 4.33% | 24.1% | 3.28% | 3.97% | 0.99 | 7.42 | 23–148 |
| plain | 2 | 0.3% | 0.00% | 10.2% | 1.47% | 0.98% | 0.16 | 3.67 | 157–457 |
| plain | 2.5 | 0.0% | — | 1.4% | 0.00% | 0.00% | 0.00 | 1.72 | 500–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.74 | 500–500 |
| warmup 25 | 1.5 | 4.8% | 4.33% | 24.1% | 3.28% | 3.97% | 0.99 | 7.42 | 26–148 |
| warmup 25 | 2 | 0.3% | 0.00% | 10.2% | 1.47% | 0.98% | 0.16 | 3.67 | 157–457 |
| warmup 25 | 2.5 | 0.0% | — | 1.4% | 0.00% | 0.00% | 0.00 | 1.72 | 500–500 |
| warmup 25 | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.74 | 500–500 |
| participated | 1.5 | 0.0% | — | 24.1% | 3.28% | 3.68% | 0.95 | 7.42 | 500–500 |
| participated | 2 | 0.0% | — | 10.2% | 1.47% | 1.09% | 0.16 | 3.67 | 500–500 |
| participated | 2.5 | 0.0% | — | 1.4% | 0.00% | 0.00% | 0.00 | 1.72 | 500–500 |
| participated | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.74 | 500–500 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 5.2% | 0.77% | 0.76% | 0.11 | 3.34 | 352–500 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.11 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.32 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.13 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.8% | 53.1% | 10.5% | 7.78 | 52.2% | 47.6% | 0.2% | 79.1% | 44.0% | 1.7% | 0.0% | 18 |
| plain | 2 | 87.4% | 53.7% | 8.5% | 6.69 | 55.5% | 44.4% | 0.1% | 81.7% | 45.7% | 0.2% | 0.0% | 23 |
| plain | 2.5 | 80.8% | 51.1% | 7.1% | 5.69 | 59.4% | 40.6% | 0.0% | 83.1% | 48.9% | 0.0% | 0.0% | 28 |
| plain | 3 | 74.4% | 47.1% | 5.3% | 4.62 | 60.1% | 39.8% | 0.0% | 84.8% | 50.2% | 0.0% | — | — |
| warmup 25 | 1.5 | 94.8% | 53.1% | 10.5% | 7.78 | 52.2% | 47.6% | 0.2% | 79.1% | 44.0% | 1.7% | 0.0% | 18 |
| warmup 25 | 2 | 87.4% | 53.7% | 8.5% | 6.69 | 55.5% | 44.4% | 0.1% | 81.7% | 45.7% | 0.2% | 0.0% | 23 |
| warmup 25 | 2.5 | 80.8% | 51.1% | 7.1% | 5.69 | 59.4% | 40.6% | 0.0% | 83.1% | 48.9% | 0.0% | 0.0% | 28 |
| warmup 25 | 3 | 74.4% | 47.1% | 5.3% | 4.62 | 60.1% | 39.8% | 0.0% | 84.8% | 50.2% | 0.0% | — | — |
| participated | 1.5 | 94.8% | 52.9% | 10.5% | 7.75 | 52.4% | 47.4% | 0.2% | 79.1% | 44.0% | 1.7% | 0.0% | 18 |
| participated | 2 | 87.4% | 53.7% | 8.5% | 6.68 | 55.5% | 44.4% | 0.1% | 81.7% | 45.7% | 0.2% | 0.0% | 23 |
| participated | 2.5 | 80.8% | 51.1% | 7.1% | 5.69 | 59.4% | 40.6% | 0.0% | 83.1% | 48.9% | 0.0% | 0.0% | 28 |
| participated | 3 | 74.4% | 47.1% | 5.3% | 4.62 | 60.1% | 39.8% | 0.0% | 84.8% | 50.2% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.3% | 66.8% | 8.6% | 12.04 | 70.8% | 29.2% | 0.0% | 89.4% | 69.0% | 0.2% | 0.0% | 24 |
| bar-sigma | 2 | 76.6% | 65.0% | 6.2% | 10.07 | 73.7% | 26.2% | 0.0% | 91.5% | 72.9% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.8% | 63.9% | 5.1% | 8.28 | 74.9% | 25.1% | 0.0% | 92.6% | 74.0% | 0.0% | — | — |
| bar-sigma | 3 | 61.3% | 63.7% | 4.3% | 6.86 | 76.0% | 24.0% | 0.0% | 93.2% | 74.8% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.6% |
| plain | 2 | 34 | 0.2% | 0.99 | 66.4% | 54.2% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 58.4% | 47.5% |
| plain | 3 | 30 | 0.6% | 0.98 | 51.5% | 41.8% |
| warmup 25 | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.6% |
| warmup 25 | 2 | 34 | 0.2% | 0.99 | 66.4% | 54.2% |
| warmup 25 | 2.5 | 32 | 0.4% | 0.99 | 58.4% | 47.5% |
| warmup 25 | 3 | 30 | 0.6% | 0.98 | 51.5% | 41.8% |
| participated | 1.5 | 36 | 0.2% | 0.99 | 74.9% | 61.6% |
| participated | 2 | 34 | 0.2% | 0.99 | 66.4% | 54.2% |
| participated | 2.5 | 32 | 0.4% | 0.99 | 58.4% | 47.5% |
| participated | 3 | 30 | 0.6% | 0.98 | 51.5% | 41.8% |
| bar-sigma | 1.5 | 34 | 0.2% | 0.99 | 64.7% | 52.7% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 54.1% | 44.0% |
| bar-sigma | 2.5 | 28 | 0.5% | 0.99 | 45.1% | 36.4% |
| bar-sigma | 3 | 26 | 1.0% | 0.99 | 37.4% | 30.0% |

### Decided rules: bradley-terry, 20 libraries

Voter bradley-terry, Bar worst 20% of the Scored, prior uniform, update winner-beats-each. 20 libraries per row, budget 40 Comparisons per wallpaper, seed 1. Every rule is followed through the same runs.

#### n = 120, baseline (select_pair), bradley-terry(noise=0.5)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 301 | 5.0 | 627 | 10.4 | 2.20% | 1.17% | 0.82% | 0.15% |
| plain | 2 | 476 | 7.9 | 977 | 16.3 | 0.30% | 0.77% | 0.49% | 0.00% |
| plain | 2.5 | 650 | 10.8 | 1411 | 23.5 | 0.25% | 0.32% | 0.07% | 0.00% |
| plain | 3 | 800 | 13.3 | 1811 | 30.2 | 0.00% | 0.00% | 0.00% | 0.00% |
| warmup 25 | 1.5 | 301 | 5.0 | 627 | 10.4 | 2.20% | 1.17% | 0.82% | 0.15% |
| warmup 25 | 2 | 476 | 7.9 | 977 | 16.3 | 0.30% | 0.77% | 0.49% | 0.00% |
| warmup 25 | 2.5 | 650 | 10.8 | 1411 | 23.5 | 0.25% | 0.32% | 0.07% | 0.00% |
| warmup 25 | 3 | 800 | 13.3 | 1811 | 30.2 | 0.00% | 0.00% | 0.00% | 0.00% |
| participated | 1.5 | 301 | 5.0 | 627 | 10.4 | 2.20% | 1.17% | 0.82% | 0.15% |
| participated | 2 | 476 | 7.9 | 977 | 16.3 | 0.30% | 0.77% | 0.49% | 0.00% |
| participated | 2.5 | 650 | 10.8 | 1411 | 23.5 | 0.25% | 0.32% | 0.07% | 0.00% |
| participated | 3 | 800 | 13.3 | 1811 | 30.2 | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 1.5 | 511 | 8.5 | 1035 | 17.2 | 0.32% | 0.63% | 0.37% | 0.00% |
| bar-sigma | 2 | 742 | 12.4 | 1631 | 27.2 | 0.37% | 0.13% | 0.07% | 0.00% |
| bar-sigma | 2.5 | 1062 | 17.7 | — | — (9/20) | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 3 | 1352 | 22.5 | — | — (0/20) | 0.00% | 0.00% | 0.00% | 0.00% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.1% | 2.46% | 26.2% | 2.07% | 1.98% | 0.58 | 4.58 | 13–68 |
| plain | 2 | 0.5% | 0.00% | 11.3% | 1.47% | 1.38% | 0.17 | 1.54 | 50–120 |
| plain | 2.5 | 0.0% | — | 2.1% | 0.00% | 0.00% | 0.00 | 0.46 | 120–120 |
| plain | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.04 | 120–120 |
| warmup 25 | 1.5 | 5.1% | 2.46% | 26.2% | 2.07% | 1.98% | 0.58 | 4.58 | 25–68 |
| warmup 25 | 2 | 0.5% | 0.00% | 11.3% | 1.47% | 1.38% | 0.17 | 1.54 | 50–120 |
| warmup 25 | 2.5 | 0.0% | — | 2.1% | 0.00% | 0.00% | 0.00 | 0.46 | 120–120 |
| warmup 25 | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.04 | 120–120 |
| participated | 1.5 | 0.0% | — | 26.2% | 2.07% | 2.01% | 0.54 | 4.58 | 120–120 |
| participated | 2 | 0.0% | — | 11.3% | 1.47% | 1.52% | 0.17 | 1.54 | 120–120 |
| participated | 2.5 | 0.0% | — | 2.1% | 0.00% | 0.00% | 0.00 | 0.46 | 120–120 |
| participated | 3 | 0.0% | — | 0.2% | 0.00% | 0.00% | 0.00 | 0.04 | 120–120 |
| bar-sigma | 1.5 | 0.0% | — | 6.3% | 1.32% | 0.27% | 0.08 | 1.17 | 92–120 |
| bar-sigma | 2 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.17 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 95.1% | 53.5% | 9.5% | 6.88 | 51.8% | 47.4% | 0.8% | 77.6% | 38.1% | 1.7% | 0.0% | 19 |
| plain | 2 | 88.9% | 54.8% | 8.3% | 6.03 | 55.1% | 44.5% | 0.4% | 79.3% | 39.3% | 0.2% | 0.0% | 12 |
| plain | 2.5 | 82.2% | 50.4% | 5.5% | 4.61 | 60.3% | 39.7% | 0.0% | 82.5% | 40.8% | 0.0% | — | — |
| plain | 3 | 76.5% | 48.2% | 4.2% | 4.15 | 62.8% | 37.1% | 0.1% | 83.9% | 42.2% | 0.0% | — | — |
| warmup 25 | 1.5 | 95.1% | 53.5% | 9.5% | 6.88 | 51.8% | 47.4% | 0.8% | 77.6% | 38.1% | 1.7% | 0.0% | 19 |
| warmup 25 | 2 | 88.9% | 54.8% | 8.3% | 6.03 | 55.1% | 44.5% | 0.4% | 79.3% | 39.3% | 0.2% | 0.0% | 12 |
| warmup 25 | 2.5 | 82.2% | 50.4% | 5.5% | 4.61 | 60.3% | 39.7% | 0.0% | 82.5% | 40.8% | 0.0% | — | — |
| warmup 25 | 3 | 76.5% | 48.2% | 4.2% | 4.15 | 62.8% | 37.1% | 0.1% | 83.9% | 42.2% | 0.0% | — | — |
| participated | 1.5 | 95.1% | 53.5% | 9.5% | 6.86 | 51.9% | 47.3% | 0.8% | 77.6% | 38.1% | 1.7% | 0.0% | 19 |
| participated | 2 | 88.9% | 54.8% | 8.3% | 6.03 | 55.1% | 44.5% | 0.4% | 79.3% | 39.2% | 0.2% | 0.0% | 12 |
| participated | 2.5 | 82.2% | 50.4% | 5.5% | 4.61 | 60.3% | 39.7% | 0.0% | 82.5% | 40.8% | 0.0% | — | — |
| participated | 3 | 76.5% | 48.2% | 4.2% | 4.15 | 62.8% | 37.1% | 0.1% | 83.9% | 42.2% | 0.0% | — | — |
| bar-sigma | 1.5 | 87.0% | 59.1% | 7.0% | 6.40 | 53.6% | 46.1% | 0.2% | 83.2% | 49.3% | 0.1% | 0.0% | 13 |
| bar-sigma | 2 | 78.5% | 57.6% | 4.9% | 5.27 | 55.2% | 44.8% | 0.0% | 86.2% | 50.4% | 0.0% | — | — |
| bar-sigma | 2.5 | 71.1% | 54.3% | 3.9% | 4.35 | 55.1% | 44.9% | 0.0% | 87.2% | 53.0% | 0.0% | — | — |
| bar-sigma | 3 | 64.9% | 52.2% | 4.0% | 3.48 | 55.1% | 44.9% | 0.0% | 88.2% | 51.8% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.1% | 0.99 | 76.5% | 63.7% |
| plain | 2 | 34 | 0.2% | 0.99 | 68.1% | 56.6% |
| plain | 2.5 | 32 | 0.3% | 0.99 | 60.9% | 50.5% |
| plain | 3 | 30 | 0.7% | 0.99 | 54.3% | 45.0% |
| warmup 25 | 1.5 | 36 | 0.1% | 0.99 | 76.5% | 63.7% |
| warmup 25 | 2 | 34 | 0.2% | 0.99 | 68.1% | 56.6% |
| warmup 25 | 2.5 | 32 | 0.3% | 0.99 | 60.9% | 50.5% |
| warmup 25 | 3 | 30 | 0.7% | 0.99 | 54.3% | 45.0% |
| participated | 1.5 | 36 | 0.1% | 0.99 | 76.4% | 63.7% |
| participated | 2 | 34 | 0.2% | 0.99 | 68.1% | 56.6% |
| participated | 2.5 | 32 | 0.3% | 0.99 | 60.9% | 50.5% |
| participated | 3 | 30 | 0.7% | 0.99 | 54.3% | 45.0% |
| bar-sigma | 1.5 | 34 | 0.1% | 0.99 | 66.5% | 55.3% |
| bar-sigma | 2 | 31 | 0.5% | 0.99 | 56.9% | 47.1% |
| bar-sigma | 2.5 | 29 | 0.1% | 0.99 | 48.4% | 40.0% |
| bar-sigma | 3 | 27 | 0.8% | 0.99 | 41.0% | 33.7% |

#### n = 120, baseline (select_pair), bradley-terry(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 316 | 5.3 | 722 | 12.0 | 3.49% | 3.61% | 2.72% | 1.72% |
| plain | 2 | 497 | 8.3 | 1003 | 16.7 | 1.67% | 2.26% | 1.70% | 1.14% |
| plain | 2.5 | 708 | 11.8 | 1571 | 26.2 | 0.59% | 1.30% | 1.02% | 0.83% |
| plain | 3 | 907 | 15.1 | 2181 | 36.4 (16/20) | 0.00% | 0.63% | 0.59% | 0.36% |
| warmup 25 | 1.5 | 316 | 5.3 | 722 | 12.0 | 3.49% | 3.61% | 2.72% | 1.72% |
| warmup 25 | 2 | 497 | 8.3 | 1003 | 16.7 | 1.67% | 2.26% | 1.70% | 1.14% |
| warmup 25 | 2.5 | 708 | 11.8 | 1571 | 26.2 | 0.59% | 1.30% | 1.02% | 0.83% |
| warmup 25 | 3 | 907 | 15.1 | 2181 | 36.4 (16/20) | 0.00% | 0.63% | 0.59% | 0.36% |
| participated | 1.5 | 316 | 5.3 | 722 | 12.0 | 3.49% | 3.61% | 2.72% | 1.72% |
| participated | 2 | 497 | 8.3 | 1003 | 16.7 | 1.67% | 2.26% | 1.70% | 1.14% |
| participated | 2.5 | 708 | 11.8 | 1571 | 26.2 | 0.59% | 1.30% | 1.02% | 0.83% |
| participated | 3 | 907 | 15.1 | 2181 | 36.4 (16/20) | 0.00% | 0.63% | 0.59% | 0.36% |
| bar-sigma | 1.5 | 533 | 8.9 | 1141 | 19.0 | 0.97% | 1.75% | 1.44% | 1.00% |
| bar-sigma | 2 | 829 | 13.8 | 1908 | 31.8 (18/20) | 0.48% | 0.58% | 0.87% | 0.46% |
| bar-sigma | 2.5 | 1154 | 19.2 | — | — (1/20) | 0.00% | 0.00% | 0.41% | 0.13% |
| bar-sigma | 3 | 1550 | 25.8 | — | — (0/20) | — | 0.00% | 0.00% | 0.00% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 4.8% | 4.35% | 24.9% | 4.36% | 4.39% | 1.21 | 6.96 | 13–85 |
| plain | 2 | 0.3% | 0.00% | 9.3% | 2.69% | 1.63% | 0.25 | 3.38 | 50–120 |
| plain | 2.5 | 0.0% | — | 1.3% | 0.00% | 0.00% | 0.00 | 1.75 | 120–120 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 1.04 | 120–120 |
| warmup 25 | 1.5 | 4.8% | 4.35% | 24.9% | 4.36% | 4.40% | 1.21 | 6.96 | 25–85 |
| warmup 25 | 2 | 0.3% | 0.00% | 9.3% | 2.69% | 1.63% | 0.25 | 3.38 | 50–120 |
| warmup 25 | 2.5 | 0.0% | — | 1.3% | 0.00% | 0.00% | 0.00 | 1.75 | 120–120 |
| warmup 25 | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 1.04 | 120–120 |
| participated | 1.5 | 0.0% | — | 24.9% | 4.36% | 4.29% | 1.17 | 6.96 | 120–120 |
| participated | 2 | 0.0% | — | 9.3% | 2.69% | 1.78% | 0.25 | 3.38 | 120–120 |
| participated | 2.5 | 0.0% | — | 1.3% | 0.00% | 0.00% | 0.00 | 1.75 | 120–120 |
| participated | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 1.04 | 120–120 |
| bar-sigma | 1.5 | 0.0% | — | 5.4% | 1.55% | 0.73% | 0.08 | 2.83 | 120–120 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.29 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.50 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.12 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 95.0% | 57.3% | 10.9% | 7.39 | 51.2% | 48.1% | 0.7% | 77.4% | 38.4% | 1.6% | 0.0% | 19 |
| plain | 2 | 87.2% | 58.7% | 7.9% | 6.47 | 54.4% | 45.3% | 0.3% | 79.6% | 38.1% | 0.2% | 0.0% | 24 |
| plain | 2.5 | 80.6% | 54.7% | 6.8% | 5.61 | 57.0% | 42.9% | 0.1% | 81.7% | 40.8% | 0.0% | — | — |
| plain | 3 | 75.0% | 53.6% | 6.2% | 4.73 | 60.7% | 39.3% | 0.0% | 82.3% | 43.1% | 0.0% | — | — |
| warmup 25 | 1.5 | 95.0% | 57.3% | 10.9% | 7.39 | 51.2% | 48.1% | 0.7% | 77.4% | 38.4% | 1.6% | 0.0% | 19 |
| warmup 25 | 2 | 87.2% | 58.7% | 7.9% | 6.47 | 54.4% | 45.3% | 0.3% | 79.6% | 38.1% | 0.2% | 0.0% | 24 |
| warmup 25 | 2.5 | 80.6% | 54.7% | 6.8% | 5.61 | 57.0% | 42.9% | 0.1% | 81.7% | 40.8% | 0.0% | — | — |
| warmup 25 | 3 | 75.0% | 53.6% | 6.2% | 4.73 | 60.7% | 39.3% | 0.0% | 82.3% | 43.1% | 0.0% | — | — |
| participated | 1.5 | 94.9% | 57.1% | 10.9% | 7.36 | 51.4% | 47.9% | 0.7% | 77.4% | 38.3% | 1.6% | 0.0% | 19 |
| participated | 2 | 87.2% | 58.7% | 7.9% | 6.47 | 54.4% | 45.3% | 0.3% | 79.6% | 38.1% | 0.2% | 0.0% | 24 |
| participated | 2.5 | 80.6% | 54.7% | 6.8% | 5.61 | 57.0% | 42.9% | 0.1% | 81.7% | 40.8% | 0.0% | — | — |
| participated | 3 | 75.0% | 53.6% | 6.2% | 4.73 | 60.7% | 39.3% | 0.0% | 82.3% | 43.1% | 0.0% | — | — |
| bar-sigma | 1.5 | 85.8% | 62.1% | 8.0% | 7.16 | 50.9% | 48.9% | 0.2% | 82.4% | 48.4% | 0.0% | 0.0% | 25 |
| bar-sigma | 2 | 77.4% | 59.3% | 6.8% | 6.10 | 55.1% | 44.8% | 0.0% | 84.2% | 50.8% | 0.0% | — | — |
| bar-sigma | 2.5 | 69.2% | 57.9% | 6.1% | 4.62 | 56.0% | 44.0% | 0.0% | 85.9% | 52.3% | 0.0% | — | — |
| bar-sigma | 3 | 61.7% | 56.9% | 4.7% | 3.92 | 55.2% | 44.8% | 0.0% | 88.2% | 55.9% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 74.8% | 61.6% |
| plain | 2 | 34 | 0.1% | 0.99 | 66.2% | 54.3% |
| plain | 2.5 | 32 | 0.3% | 0.99 | 58.6% | 47.6% |
| plain | 3 | 29 | 0.3% | 0.98 | 51.4% | 41.5% |
| warmup 25 | 1.5 | 36 | 0.2% | 0.99 | 74.8% | 61.6% |
| warmup 25 | 2 | 34 | 0.1% | 0.99 | 66.2% | 54.3% |
| warmup 25 | 2.5 | 32 | 0.3% | 0.99 | 58.6% | 47.6% |
| warmup 25 | 3 | 29 | 0.3% | 0.98 | 51.4% | 41.5% |
| participated | 1.5 | 36 | 0.2% | 0.99 | 74.7% | 61.6% |
| participated | 2 | 34 | 0.1% | 0.99 | 66.2% | 54.3% |
| participated | 2.5 | 32 | 0.3% | 0.99 | 58.6% | 47.6% |
| participated | 3 | 29 | 0.3% | 0.98 | 51.4% | 41.5% |
| bar-sigma | 1.5 | 34 | 0.2% | 0.99 | 64.6% | 53.0% |
| bar-sigma | 2 | 30 | 0.4% | 0.99 | 54.1% | 43.8% |
| bar-sigma | 2.5 | 28 | 0.5% | 0.99 | 45.1% | 36.2% |
| bar-sigma | 3 | 25 | 0.9% | 0.99 | 37.7% | 30.0% |

#### n = 500, baseline (select_pair), bradley-terry(noise=0.5)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1296 | 5.2 | 2826 | 11.3 | 1.07% | 0.97% | 0.58% | 0.37% |
| plain | 2 | 1958 | 7.8 | 4292 | 17.2 | 0.25% | 0.30% | 0.22% | 0.10% |
| plain | 2.5 | 2749 | 11.0 | 6056 | 24.2 | 0.00% | 0.03% | 0.07% | 0.03% |
| plain | 3 | 3480 | 13.9 | 7947 | 31.8 | 0.00% | 0.00% | 0.02% | 0.00% |
| warmup 25 | 1.5 | 1296 | 5.2 | 2826 | 11.3 | 1.07% | 0.97% | 0.58% | 0.37% |
| warmup 25 | 2 | 1958 | 7.8 | 4292 | 17.2 | 0.25% | 0.30% | 0.22% | 0.10% |
| warmup 25 | 2.5 | 2749 | 11.0 | 6056 | 24.2 | 0.00% | 0.03% | 0.07% | 0.03% |
| warmup 25 | 3 | 3480 | 13.9 | 7947 | 31.8 | 0.00% | 0.00% | 0.02% | 0.00% |
| participated | 1.5 | 1296 | 5.2 | 2826 | 11.3 | 1.07% | 0.97% | 0.58% | 0.37% |
| participated | 2 | 1958 | 7.8 | 4292 | 17.2 | 0.25% | 0.30% | 0.22% | 0.10% |
| participated | 2.5 | 2749 | 11.0 | 6056 | 24.2 | 0.00% | 0.03% | 0.07% | 0.03% |
| participated | 3 | 3480 | 13.9 | 7947 | 31.8 | 0.00% | 0.00% | 0.02% | 0.00% |
| bar-sigma | 1.5 | 2150 | 8.6 | 4686 | 18.7 | 0.12% | 0.19% | 0.12% | 0.07% |
| bar-sigma | 2 | 3168 | 12.7 | 7131 | 28.5 | 0.00% | 0.00% | 0.05% | 0.01% |
| bar-sigma | 2.5 | 4489 | 18.0 | — | — (2/20) | 0.00% | 0.00% | 0.00% | 0.00% |
| bar-sigma | 3 | 6006 | 24.0 | — | — (0/20) | 0.00% | 0.00% | 0.00% | 0.00% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.7% | 1.23% | 25.8% | 1.55% | 1.41% | 0.56 | 3.51 | 25–150 |
| plain | 2 | 0.5% | 0.00% | 11.2% | 0.72% | 0.37% | 0.08 | 1.14 | 119–429 |
| plain | 2.5 | 0.0% | 0.00% | 2.1% | 0.00% | 0.00% | 0.00 | 0.24 | 335–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.03 | 500–500 |
| warmup 25 | 1.5 | 5.7% | 1.23% | 25.8% | 1.55% | 1.41% | 0.56 | 3.51 | 25–150 |
| warmup 25 | 2 | 0.5% | 0.00% | 11.2% | 0.72% | 0.37% | 0.08 | 1.14 | 119–429 |
| warmup 25 | 2.5 | 0.0% | 0.00% | 2.1% | 0.00% | 0.00% | 0.00 | 0.24 | 335–500 |
| warmup 25 | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.03 | 500–500 |
| participated | 1.5 | 0.0% | — | 25.8% | 1.55% | 1.38% | 0.52 | 3.50 | 500–500 |
| participated | 2 | 0.0% | — | 11.2% | 0.72% | 0.42% | 0.08 | 1.14 | 500–500 |
| participated | 2.5 | 0.0% | — | 2.1% | 0.00% | 0.00% | 0.00 | 0.24 | 500–500 |
| participated | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.03 | 500–500 |
| bar-sigma | 1.5 | 0.1% | 0.00% | 6.5% | 0.46% | 0.34% | 0.05 | 0.88 | 292–500 |
| bar-sigma | 2 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.08 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.00 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.5% | 48.8% | 8.3% | 6.72 | 51.6% | 48.2% | 0.2% | 79.4% | 43.6% | 1.0% | 0.0% | 18 |
| plain | 2 | 88.0% | 51.1% | 6.9% | 6.23 | 56.4% | 43.5% | 0.1% | 82.0% | 46.2% | 0.1% | 0.0% | 22 |
| plain | 2.5 | 81.8% | 47.1% | 5.4% | 4.99 | 59.0% | 40.9% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 22 |
| plain | 3 | 76.3% | 43.8% | 4.1% | 4.16 | 61.0% | 39.0% | 0.0% | 86.1% | 50.5% | 0.0% | — | — |
| warmup 25 | 1.5 | 94.5% | 48.8% | 8.3% | 6.72 | 51.6% | 48.2% | 0.2% | 79.4% | 43.6% | 1.0% | 0.0% | 18 |
| warmup 25 | 2 | 88.0% | 51.1% | 6.9% | 6.23 | 56.4% | 43.5% | 0.1% | 82.0% | 46.2% | 0.1% | 0.0% | 22 |
| warmup 25 | 2.5 | 81.8% | 47.1% | 5.4% | 4.99 | 59.0% | 40.9% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 22 |
| warmup 25 | 3 | 76.3% | 43.8% | 4.1% | 4.16 | 61.0% | 39.0% | 0.0% | 86.1% | 50.5% | 0.0% | — | — |
| participated | 1.5 | 94.5% | 48.5% | 8.3% | 6.70 | 51.8% | 48.0% | 0.2% | 79.4% | 43.6% | 1.0% | 0.0% | 18 |
| participated | 2 | 88.0% | 51.1% | 6.9% | 6.23 | 56.4% | 43.5% | 0.1% | 82.0% | 46.2% | 0.1% | 0.0% | 22 |
| participated | 2.5 | 81.8% | 47.1% | 5.4% | 4.99 | 59.0% | 40.9% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 22 |
| participated | 3 | 76.3% | 43.8% | 4.1% | 4.16 | 61.0% | 39.0% | 0.0% | 86.1% | 50.5% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.6% | 64.0% | 6.6% | 10.90 | 70.5% | 29.5% | 0.0% | 90.0% | 69.2% | 0.1% | 0.0% | 25 |
| bar-sigma | 2 | 78.4% | 62.7% | 4.8% | 9.28 | 74.3% | 25.7% | 0.0% | 92.3% | 73.8% | 0.0% | 0.0% | 32 |
| bar-sigma | 2.5 | 71.1% | 61.0% | 3.8% | 7.66 | 74.0% | 26.0% | 0.0% | 93.0% | 74.3% | 0.0% | — | — |
| bar-sigma | 3 | 64.4% | 60.5% | 3.2% | 6.40 | 76.0% | 24.0% | 0.0% | 94.1% | 75.1% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.1% | 0.99 | 76.5% | 63.9% |
| plain | 2 | 34 | 0.2% | 0.99 | 68.3% | 56.8% |
| plain | 2.5 | 32 | 0.3% | 0.99 | 60.8% | 50.5% |
| plain | 3 | 30 | 0.5% | 0.99 | 54.2% | 44.8% |
| warmup 25 | 1.5 | 36 | 0.1% | 0.99 | 76.5% | 63.9% |
| warmup 25 | 2 | 34 | 0.2% | 0.99 | 68.3% | 56.8% |
| warmup 25 | 2.5 | 32 | 0.3% | 0.99 | 60.8% | 50.5% |
| warmup 25 | 3 | 30 | 0.5% | 0.99 | 54.2% | 44.8% |
| participated | 1.5 | 36 | 0.1% | 0.99 | 76.4% | 63.9% |
| participated | 2 | 34 | 0.2% | 0.99 | 68.3% | 56.8% |
| participated | 2.5 | 32 | 0.3% | 0.99 | 60.8% | 50.5% |
| participated | 3 | 30 | 0.5% | 0.99 | 54.2% | 44.8% |
| bar-sigma | 1.5 | 34 | 0.2% | 0.99 | 66.8% | 55.5% |
| bar-sigma | 2 | 31 | 0.5% | 0.99 | 56.7% | 47.0% |
| bar-sigma | 2.5 | 29 | 0.6% | 0.99 | 48.1% | 39.6% |
| bar-sigma | 3 | 26 | 0.8% | 0.99 | 40.6% | 33.3% |

#### n = 500, baseline (select_pair), bradley-terry(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1355 | 5.4 | 3140 | 12.6 | 2.78% | 3.01% | 2.79% | 1.80% |
| plain | 2 | 2155 | 8.6 | 5090 | 20.4 | 1.53% | 1.65% | 1.38% | 1.05% |
| plain | 2.5 | 3007 | 12.0 | 7159 | 28.6 | 0.68% | 0.78% | 0.70% | 0.57% |
| plain | 3 | 4073 | 16.3 | 9771 | 39.1 (13/20) | 0.16% | 0.26% | 0.37% | 0.29% |
| warmup 25 | 1.5 | 1355 | 5.4 | 3140 | 12.6 | 2.78% | 3.01% | 2.79% | 1.80% |
| warmup 25 | 2 | 2155 | 8.6 | 5090 | 20.4 | 1.53% | 1.65% | 1.38% | 1.05% |
| warmup 25 | 2.5 | 3007 | 12.0 | 7159 | 28.6 | 0.68% | 0.78% | 0.70% | 0.57% |
| warmup 25 | 3 | 4073 | 16.3 | 9771 | 39.1 (13/20) | 0.16% | 0.26% | 0.37% | 0.29% |
| participated | 1.5 | 1355 | 5.4 | 3140 | 12.6 | 2.78% | 3.01% | 2.79% | 1.80% |
| participated | 2 | 2155 | 8.6 | 5090 | 20.4 | 1.53% | 1.65% | 1.38% | 1.05% |
| participated | 2.5 | 3007 | 12.0 | 7159 | 28.6 | 0.68% | 0.78% | 0.70% | 0.57% |
| participated | 3 | 4073 | 16.3 | 9771 | 39.1 (13/20) | 0.16% | 0.26% | 0.37% | 0.29% |
| bar-sigma | 1.5 | 2341 | 9.4 | 5386 | 21.5 | 1.18% | 1.42% | 1.15% | 0.89% |
| bar-sigma | 2 | 3704 | 14.8 | 8915 | 35.7 (19/20) | 0.62% | 0.41% | 0.50% | 0.35% |
| bar-sigma | 2.5 | 5109 | 20.4 | — | — (0/20) | 0.00% | 0.00% | 0.10% | 0.19% |
| bar-sigma | 3 | 6857 | 27.4 | — | — (0/20) | 0.00% | 0.00% | 0.00% | 0.05% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.5% | 3.10% | 24.1% | 3.37% | 3.30% | 1.07 | 7.12 | 25–151 |
| plain | 2 | 0.4% | 0.00% | 9.5% | 1.89% | 1.75% | 0.20 | 3.62 | 119–492 |
| plain | 2.5 | 0.0% | — | 1.4% | 0.74% | 1.02% | 0.01 | 1.72 | 500–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.70 | 500–500 |
| warmup 25 | 1.5 | 5.5% | 3.10% | 24.1% | 3.37% | 3.30% | 1.07 | 7.12 | 25–151 |
| warmup 25 | 2 | 0.4% | 0.00% | 9.5% | 1.89% | 1.75% | 0.20 | 3.62 | 119–492 |
| warmup 25 | 2.5 | 0.0% | — | 1.4% | 0.74% | 1.02% | 0.01 | 1.72 | 500–500 |
| warmup 25 | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.70 | 500–500 |
| participated | 1.5 | 0.0% | — | 24.1% | 3.37% | 3.31% | 1.03 | 7.12 | 500–500 |
| participated | 2 | 0.0% | — | 9.5% | 1.89% | 1.95% | 0.20 | 3.62 | 500–500 |
| participated | 2.5 | 0.0% | — | 1.4% | 0.74% | 1.02% | 0.01 | 1.72 | 500–500 |
| participated | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.70 | 500–500 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 5.0% | 0.80% | 1.13% | 0.11 | 3.18 | 291–500 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.08 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.31 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.07 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 95.0% | 54.0% | 10.4% | 8.13 | 53.9% | 45.9% | 0.2% | 79.3% | 45.8% | 1.9% | 0.0% | 17 |
| plain | 2 | 88.3% | 55.2% | 9.3% | 6.81 | 56.6% | 43.3% | 0.1% | 80.5% | 46.2% | 0.4% | 0.0% | 25 |
| plain | 2.5 | 80.9% | 51.6% | 7.3% | 5.78 | 58.2% | 41.7% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 26 |
| plain | 3 | 74.5% | 48.0% | 5.8% | 4.77 | 61.9% | 38.1% | 0.0% | 84.6% | 50.4% | 0.0% | — | — |
| warmup 25 | 1.5 | 95.0% | 54.0% | 10.4% | 8.13 | 53.9% | 45.9% | 0.2% | 79.3% | 45.8% | 1.9% | 0.0% | 17 |
| warmup 25 | 2 | 88.3% | 55.2% | 9.3% | 6.81 | 56.6% | 43.3% | 0.1% | 80.5% | 46.2% | 0.4% | 0.0% | 25 |
| warmup 25 | 2.5 | 80.9% | 51.6% | 7.3% | 5.78 | 58.2% | 41.7% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 26 |
| warmup 25 | 3 | 74.5% | 48.0% | 5.8% | 4.77 | 61.9% | 38.1% | 0.0% | 84.6% | 50.4% | 0.0% | — | — |
| participated | 1.5 | 95.0% | 53.7% | 10.4% | 8.10 | 54.1% | 45.7% | 0.2% | 79.3% | 45.9% | 1.9% | 0.0% | 17 |
| participated | 2 | 88.3% | 55.2% | 9.3% | 6.80 | 56.7% | 43.2% | 0.1% | 80.5% | 46.2% | 0.4% | 0.0% | 25 |
| participated | 2.5 | 80.9% | 51.6% | 7.3% | 5.78 | 58.2% | 41.7% | 0.0% | 83.5% | 48.6% | 0.0% | 0.0% | 26 |
| participated | 3 | 74.5% | 48.0% | 5.8% | 4.77 | 61.9% | 38.1% | 0.0% | 84.6% | 50.4% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.9% | 67.5% | 9.2% | 12.51 | 72.2% | 27.8% | 0.0% | 89.8% | 70.7% | 0.2% | 0.0% | 26 |
| bar-sigma | 2 | 76.9% | 65.5% | 6.8% | 10.59 | 74.4% | 25.6% | 0.0% | 91.6% | 73.4% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.3% | 63.5% | 5.1% | 8.51 | 75.2% | 24.8% | 0.0% | 92.6% | 74.3% | 0.0% | — | — |
| bar-sigma | 3 | 60.8% | 63.0% | 3.8% | 6.83 | 76.7% | 23.3% | 0.0% | 94.1% | 75.8% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.5% |
| plain | 2 | 34 | 0.3% | 0.99 | 66.2% | 54.0% |
| plain | 2.5 | 32 | 0.5% | 0.99 | 58.3% | 47.4% |
| plain | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.4% |
| warmup 25 | 1.5 | 36 | 0.2% | 0.99 | 75.0% | 61.5% |
| warmup 25 | 2 | 34 | 0.3% | 0.99 | 66.2% | 54.0% |
| warmup 25 | 2.5 | 32 | 0.5% | 0.99 | 58.3% | 47.4% |
| warmup 25 | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.4% |
| participated | 1.5 | 36 | 0.2% | 0.99 | 74.9% | 61.5% |
| participated | 2 | 34 | 0.3% | 0.99 | 66.2% | 54.0% |
| participated | 2.5 | 32 | 0.5% | 0.99 | 58.3% | 47.4% |
| participated | 3 | 30 | 0.6% | 0.98 | 51.2% | 41.4% |
| bar-sigma | 1.5 | 34 | 0.4% | 0.99 | 64.5% | 52.6% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 53.9% | 43.7% |
| bar-sigma | 2.5 | 28 | 0.7% | 0.99 | 44.8% | 36.2% |
| bar-sigma | 3 | 26 | 0.7% | 0.99 | 37.3% | 29.8% |

### Decided rules: thurstone, 100 libraries

Voter thurstone, Bar worst 20% of the Scored, prior uniform, update winner-beats-each. 100 libraries per row, budget 40 Comparisons per wallpaper, seed 1. Every rule is followed through the same runs.

#### n = 120, baseline (select_pair), thurstone(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 320 | 5.3 | 741 | 12.3 | 3.11% | 3.57% | 3.23% | 2.33% |
| plain | 2 | 519 | 8.7 | 1121 | 18.7 | 1.59% | 1.91% | 1.85% | 1.44% |
| plain | 2.5 | 719 | 12.0 | 1626 | 27.1 (98/100) | 0.74% | 1.04% | 1.15% | 0.89% |
| plain | 3 | 943 | 15.7 | 2218 | 37.0 (75/100) | 0.39% | 0.37% | 0.56% | 0.59% |
| bar-sigma | 1.5 | 563 | 9.4 | 1226 | 20.4 | 1.45% | 1.56% | 1.64% | 1.23% |
| bar-sigma | 2 | 859 | 14.3 | 2029 | 33.8 (84/100) | 0.54% | 0.45% | 0.71% | 0.65% |
| bar-sigma | 2.5 | 1215 | 20.2 | — | — (11/100) | 0.00% | 0.05% | 0.24% | 0.31% |
| bar-sigma | 3 | 1645 | 27.4 (99/100) | — | — (0/100) | 0.00% | 0.00% | 0.08% | 0.20% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.2% | 3.53% | 24.1% | 3.60% | 3.53% | 1.04 | 8.31 | 5–77 |
| plain | 2 | 0.4% | 0.00% | 9.2% | 2.62% | 2.47% | 0.24 | 4.42 | 32–120 |
| plain | 2.5 | 0.0% | — | 1.2% | 2.72% | 4.35% | 0.03 | 2.21 | 120–120 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 1.02 | 120–120 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 5.1% | 2.97% | 3.17% | 0.16 | 3.82 | 86–120 |
| bar-sigma | 2 | 0.0% | — | 0.0% | — | 0.00% | 0.00 | 1.38 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.47 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.17 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 95.0% | 57.5% | 11.0% | 7.78 | 52.0% | 47.2% | 0.9% | 76.5% | 37.0% | 2.1% | 0.0% | 18 |
| plain | 2 | 88.0% | 59.2% | 9.7% | 6.71 | 55.5% | 44.2% | 0.3% | 78.6% | 38.5% | 0.3% | 0.0% | 23 |
| plain | 2.5 | 81.0% | 56.4% | 7.6% | 5.63 | 58.3% | 41.7% | 0.1% | 80.9% | 41.4% | 0.1% | 0.0% | 23 |
| plain | 3 | 74.5% | 52.7% | 5.8% | 4.59 | 60.8% | 39.2% | 0.0% | 82.4% | 41.9% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.4% | 62.1% | 9.3% | 7.23 | 51.6% | 48.2% | 0.2% | 81.6% | 47.9% | 0.2% | 0.0% | 22 |
| bar-sigma | 2 | 76.7% | 60.2% | 6.4% | 5.82 | 53.9% | 46.1% | 0.0% | 84.0% | 50.7% | 0.0% | 0.0% | 25 |
| bar-sigma | 2.5 | 68.3% | 57.4% | 5.4% | 4.65 | 54.9% | 45.1% | 0.0% | 86.4% | 52.1% | 0.0% | — | — |
| bar-sigma | 3 | 60.9% | 55.3% | 4.5% | 3.74 | 55.7% | 44.3% | 0.0% | 87.0% | 53.1% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.1% | 0.99 | 74.7% | 61.1% |
| plain | 2 | 34 | 0.4% | 0.99 | 66.0% | 53.7% |
| plain | 2.5 | 32 | 0.5% | 0.99 | 58.1% | 47.2% |
| plain | 3 | 30 | 0.6% | 0.98 | 51.1% | 41.3% |
| bar-sigma | 1.5 | 33 | 0.3% | 0.99 | 64.4% | 52.4% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 53.7% | 43.5% |
| bar-sigma | 2.5 | 28 | 0.5% | 0.99 | 44.8% | 36.1% |
| bar-sigma | 3 | 26 | 0.8% | 0.99 | 37.2% | 29.7% |

#### n = 500, baseline (select_pair), thurstone(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1379 | 5.5 | 3239 | 13.0 | 3.21% | 3.34% | 2.88% | 2.15% |
| plain | 2 | 2188 | 8.8 | 4917 | 19.7 | 1.57% | 1.68% | 1.62% | 1.35% |
| plain | 2.5 | 3058 | 12.2 | 7022 | 28.1 | 0.76% | 0.63% | 0.85% | 0.76% |
| plain | 3 | 4021 | 16.1 | 9636 | 38.5 (67/100) | 0.28% | 0.24% | 0.37% | 0.43% |
| bar-sigma | 1.5 | 2362 | 9.4 | 5346 | 21.4 | 1.29% | 1.31% | 1.41% | 1.17% |
| bar-sigma | 2 | 3637 | 14.5 | 8581 | 34.3 (94/100) | 0.32% | 0.40% | 0.52% | 0.54% |
| bar-sigma | 2.5 | 5104 | 20.4 | — | — (0/100) | 0.12% | 0.05% | 0.21% | 0.22% |
| bar-sigma | 3 | 6897 | 27.6 | — | — (0/100) | 0.00% | 0.02% | 0.05% | 0.08% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.2% | 3.40% | 24.4% | 3.56% | 3.45% | 1.03 | 7.75 | 7–192 |
| plain | 2 | 0.4% | 0.53% | 10.0% | 2.44% | 1.88% | 0.26 | 3.95 | 55–500 |
| plain | 2.5 | 0.0% | 0.00% | 1.5% | 0.96% | 1.02% | 0.01 | 1.92 | 380–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.88 | 500–500 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 5.1% | 1.53% | 1.48% | 0.14 | 3.55 | 213–500 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.25 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.39 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.13 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.8% | 54.3% | 10.6% | 7.76 | 52.0% | 47.8% | 0.2% | 78.6% | 43.3% | 1.8% | 0.0% | 18 |
| plain | 2 | 87.6% | 54.8% | 8.8% | 6.70 | 55.6% | 44.3% | 0.1% | 80.9% | 45.0% | 0.2% | 0.0% | 22 |
| plain | 2.5 | 80.6% | 51.3% | 7.0% | 5.64 | 58.5% | 41.5% | 0.0% | 83.2% | 48.1% | 0.0% | 0.0% | 29 |
| plain | 3 | 74.3% | 47.6% | 5.7% | 4.63 | 60.7% | 39.3% | 0.0% | 84.4% | 49.8% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.2% | 67.1% | 8.7% | 12.13 | 71.1% | 28.8% | 0.1% | 89.5% | 69.1% | 0.2% | 0.0% | 22 |
| bar-sigma | 2 | 76.6% | 64.8% | 6.4% | 10.03 | 73.5% | 26.5% | 0.0% | 91.4% | 72.6% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.5% | 63.5% | 5.1% | 8.26 | 74.8% | 25.2% | 0.0% | 92.5% | 73.9% | 0.0% | — | — |
| bar-sigma | 3 | 61.1% | 63.4% | 4.3% | 6.87 | 75.6% | 24.4% | 0.0% | 93.3% | 74.8% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 74.9% | 61.4% |
| plain | 2 | 34 | 0.3% | 0.99 | 66.2% | 54.0% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 58.3% | 47.4% |
| plain | 3 | 30 | 0.5% | 0.99 | 51.3% | 41.6% |
| bar-sigma | 1.5 | 34 | 0.3% | 0.99 | 64.5% | 52.6% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 53.9% | 43.8% |
| bar-sigma | 2.5 | 28 | 0.6% | 0.99 | 45.0% | 36.3% |
| bar-sigma | 3 | 26 | 0.9% | 0.99 | 37.3% | 29.9% |

### Decided rules: bradley-terry, 100 libraries

Voter bradley-terry, Bar worst 20% of the Scored, prior uniform, update winner-beats-each. 100 libraries per row, budget 40 Comparisons per wallpaper, seed 1. Every rule is followed through the same runs.

#### n = 120, baseline (select_pair), bradley-terry(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 317 | 5.3 | 733 | 12.2 | 3.83% | 3.78% | 2.99% | 2.15% |
| plain | 2 | 500 | 8.3 | 1105 | 18.4 | 1.57% | 2.05% | 1.85% | 1.43% |
| plain | 2.5 | 710 | 11.8 | 1621 | 27.0 | 0.85% | 1.04% | 1.05% | 0.96% |
| plain | 3 | 935 | 15.6 | 2235 | 37.2 (68/100) | 0.14% | 0.53% | 0.59% | 0.50% |
| bar-sigma | 1.5 | 552 | 9.2 | 1236 | 20.6 | 1.21% | 1.83% | 1.61% | 1.27% |
| bar-sigma | 2 | 843 | 14.1 | 1951 | 32.5 (85/100) | 0.27% | 0.62% | 0.75% | 0.65% |
| bar-sigma | 2.5 | 1204 | 20.1 | — | — (6/100) | 0.00% | 0.09% | 0.24% | 0.21% |
| bar-sigma | 3 | 1605 | 26.8 | — | — (0/100) | 0.00% | 0.08% | 0.03% | 0.10% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.1% | 3.92% | 24.2% | 4.37% | 4.00% | 1.23 | 8.07 | 7–85 |
| plain | 2 | 0.3% | 0.00% | 9.3% | 2.50% | 1.58% | 0.27 | 4.25 | 18–120 |
| plain | 2.5 | 0.0% | — | 1.4% | 1.75% | 2.01% | 0.03 | 2.06 | 109–120 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 1.07 | 120–120 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 5.3% | 2.06% | 1.88% | 0.12 | 3.61 | 76–120 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.33 | 120–120 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.53 | 120–120 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.16 | 120–120 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 95.0% | 57.1% | 11.1% | 7.63 | 51.3% | 47.8% | 0.9% | 76.9% | 37.8% | 2.0% | 0.0% | 18 |
| plain | 2 | 88.0% | 58.8% | 9.3% | 6.71 | 55.4% | 44.2% | 0.4% | 79.4% | 39.1% | 0.3% | 0.0% | 24 |
| plain | 2.5 | 81.0% | 55.9% | 7.6% | 5.60 | 58.0% | 41.9% | 0.1% | 80.9% | 40.7% | 0.0% | 0.0% | 34 |
| plain | 3 | 74.7% | 53.4% | 6.5% | 4.64 | 60.5% | 39.5% | 0.0% | 82.2% | 41.6% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.3% | 61.8% | 8.9% | 7.31 | 52.2% | 47.6% | 0.2% | 81.9% | 48.0% | 0.2% | 0.0% | 25 |
| bar-sigma | 2 | 76.9% | 59.4% | 7.1% | 5.94 | 54.3% | 45.6% | 0.1% | 84.4% | 51.6% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.7% | 57.6% | 5.3% | 4.67 | 56.1% | 43.9% | 0.0% | 85.9% | 52.2% | 0.0% | — | — |
| bar-sigma | 3 | 61.5% | 56.0% | 4.6% | 3.79 | 55.9% | 44.1% | 0.0% | 86.9% | 53.5% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 74.8% | 61.4% |
| plain | 2 | 34 | 0.2% | 0.99 | 66.2% | 54.0% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 58.3% | 47.4% |
| plain | 3 | 30 | 0.5% | 0.99 | 51.3% | 41.6% |
| bar-sigma | 1.5 | 34 | 0.3% | 0.99 | 64.5% | 52.7% |
| bar-sigma | 2 | 31 | 0.4% | 0.99 | 54.0% | 43.8% |
| bar-sigma | 2.5 | 28 | 0.6% | 0.99 | 45.0% | 36.3% |
| bar-sigma | 3 | 26 | 0.9% | 0.99 | 37.5% | 29.9% |

#### n = 500, baseline (select_pair), bradley-terry(noise=1)

Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.

| Rule | k | 50% votes | Each | 70% votes | Each | Wrong @4 | Wrong @8 | Wrong @16 | Wrong @40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 1364 | 5.5 | 3207 | 12.8 | 3.20% | 3.27% | 2.82% | 1.88% |
| plain | 2 | 2197 | 8.8 | 4989 | 20.0 | 1.63% | 1.65% | 1.61% | 1.13% |
| plain | 2.5 | 3028 | 12.1 | 7092 | 28.4 | 0.80% | 0.85% | 0.82% | 0.64% |
| plain | 3 | 4025 | 16.1 | 9685 | 38.7 (65/100) | 0.39% | 0.34% | 0.42% | 0.35% |
| bar-sigma | 1.5 | 2345 | 9.4 | 5439 | 21.8 | 1.22% | 1.43% | 1.41% | 0.98% |
| bar-sigma | 2 | 3607 | 14.4 | 8815 | 35.3 (96/100) | 0.58% | 0.50% | 0.53% | 0.43% |
| bar-sigma | 2.5 | 5109 | 20.4 | — | — (0/100) | 0.00% | 0.16% | 0.18% | 0.18% |
| bar-sigma | 3 | 6826 | 27.3 | — | — (0/100) | 0.00% | 0.04% | 0.05% | 0.06% |

Young library (Each ≤ 2). "Wrong ≤2" pools every vote up to Each 2. "Ever wrong" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.

| Rule | k | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 5.4% | 4.03% | 24.1% | 3.83% | 3.72% | 1.13 | 7.47 | 5–151 |
| plain | 2 | 0.4% | 0.52% | 9.5% | 2.16% | 1.76% | 0.23 | 3.79 | 45–492 |
| plain | 2.5 | 0.0% | 0.00% | 1.4% | 0.42% | 0.40% | 0.01 | 1.81 | 238–500 |
| plain | 3 | 0.0% | — | 0.1% | 0.00% | 0.00% | 0.00 | 0.81 | 500–500 |
| bar-sigma | 1.5 | 0.0% | 0.00% | 4.9% | 1.31% | 1.28% | 0.14 | 3.37 | 182–500 |
| bar-sigma | 2 | 0.0% | — | 0.0% | 0.00% | 0.00% | 0.00 | 1.15 | 500–500 |
| bar-sigma | 2.5 | 0.0% | — | 0.0% | — | — | 0.00 | 0.35 | 500–500 |
| bar-sigma | 3 | 0.0% | — | 0.0% | — | — | 0.00 | 0.10 | 500–500 |

Reversion over the whole run. "Reverted" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). "Back ≤2" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons ("by Bar": with none, the Bar moved back). A flip is Decided on one side, later on the other; "quick" flips spent ≤ 2 of their own Comparisons Undecided in between.

| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 94.8% | 54.1% | 10.5% | 7.82 | 52.5% | 47.2% | 0.2% | 78.6% | 43.8% | 2.0% | 0.0% | 17 |
| plain | 2 | 87.8% | 54.9% | 9.0% | 6.75 | 56.0% | 43.9% | 0.1% | 80.8% | 45.7% | 0.3% | 0.0% | 23 |
| plain | 2.5 | 80.7% | 51.2% | 7.2% | 5.61 | 57.7% | 42.2% | 0.0% | 82.9% | 47.7% | 0.0% | 0.0% | 26 |
| plain | 3 | 74.3% | 47.5% | 5.7% | 4.66 | 61.0% | 38.9% | 0.0% | 84.5% | 50.1% | 0.0% | — | — |
| bar-sigma | 1.5 | 86.3% | 66.9% | 8.8% | 12.19 | 71.5% | 28.4% | 0.0% | 89.5% | 69.9% | 0.2% | 0.0% | 24 |
| bar-sigma | 2 | 76.6% | 65.2% | 6.4% | 10.32 | 74.1% | 25.9% | 0.0% | 91.6% | 73.1% | 0.0% | — | — |
| bar-sigma | 2.5 | 68.4% | 63.9% | 5.0% | 8.45 | 75.5% | 24.5% | 0.0% | 92.8% | 74.2% | 0.0% | — | — |
| bar-sigma | 3 | 61.0% | 63.3% | 3.9% | 6.92 | 76.2% | 23.8% | 0.0% | 93.6% | 75.1% | 0.0% | — | — |

Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.

| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1.5 | 36 | 0.2% | 0.99 | 74.9% | 61.4% |
| plain | 2 | 34 | 0.3% | 0.99 | 66.1% | 54.0% |
| plain | 2.5 | 32 | 0.4% | 0.99 | 58.3% | 47.4% |
| plain | 3 | 30 | 0.5% | 0.99 | 51.2% | 41.6% |
| bar-sigma | 1.5 | 34 | 0.4% | 0.99 | 64.5% | 52.6% |
| bar-sigma | 2 | 31 | 0.5% | 0.99 | 53.9% | 43.8% |
| bar-sigma | 2.5 | 28 | 0.7% | 0.99 | 45.0% | 36.3% |
| bar-sigma | 3 | 26 | 0.8% | 0.99 | 37.3% | 30.0% |

