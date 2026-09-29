# Starting Score from a prediction: votes saved

For [#374](https://github.com/QuantumFF/walltare/issues/374) (map
[#362](https://github.com/QuantumFF/walltare/issues/362)). How many votes a
starting Score predicted from image embeddings would save, measured with the
harness from #363. Selector, Bar and Decided rule are the ones in `baseline.md`:
`select_pair`, the worst 20% of the Scored, Decided at |μ − Bar| ≥ 2σ.

## Model

A prediction of correlation r with true quality q is
p = r·q + √(1 − r²)·N(0, 1). A ridge regression of μ on embeddings returns
E[μ | p], which is shrunk towards the mean, so the starting Score is

    μ₀ = a + b·r·p,   σ₀ ∈ {5.5, 6.5, 7.5}

where μ ≈ a + b·q is the map from true quality onto the μ scale (`Predicted`
in `src/sim.rs`). r = 0 starts everyone at a ≈ 25 and changes only σ₀, which
isolates what σ₀ does on its own. A calibrated σ₀ would be b·√(1 − r²).

- **Cold library** (the upper bound, as if the model already existed): a, b
  come from long uniform-prior runs on other libraries (Each 100), the μ the
  ranking converges to. Before any vote nothing is Scored, so the app has no
  Bar and ADR 0057 keeps predicted wallpapers Unrated; "Decided at Each 0" is
  measured against the Bar the starting Scores would give if they counted
  (the 20% quantile of every μ₀). In the app that column is 0.
- **Arrival** (the realistic one): 500 wallpapers ranked from 25 / 8.333 to
  Each 8, then a scan adds 125. a, b are the least-squares fit of the old
  wallpapers' current μ on their true quality, the scale a ridge fit on this
  library's votes would predict onto. The old keep their Ratings; the new are
  Unrated and don't move the Bar until their first Comparison. The target is
  the new wallpapers reaching the old ones' Decided share at the scan (and, a
  moving target, the old ones' share at the time).

Reproduce: `cargo run --release -- starting calibrate|cold|arrival`, with the
flags in each section.

## The μ scale

`starting calibrate --sizes 500` (20 libraries) and `--sizes 2000` (10)
agree to within 0.05 on b, so it doesn't depend on n.

| n | noise | Each | a | b (± sd) | R² | mean μ in q bands <−2, −2…−1, −1…−.5, −.5…0, 0….5, .5…1, 1…2, ≥2 |
|---:|---:|---:|---:|---:|---:|---|
| 500 | 0.5 | 8 | 25.06 | 6.70 ± 0.18 | 0.810 | 10.5, 15.5, 19.9, 23.3, 26.9, 30.4, 34.6, 39.5 |
| 500 | 0.5 | 16 | 25.06 | 7.61 ± 0.19 | 0.919 | 7.6, 14.4, 19.3, 23.1, 27.1, 30.9, 35.7, 42.3 |
| 500 | 0.5 | 40 | 25.06 | 8.08 ± 0.19 | 0.974 | 6.3, 13.8, 19.0, 23.0, 27.1, 31.2, 36.3, 43.6 |
| 500 | 0.5 | 100 | 25.06 | 8.23 ± 0.20 | 0.989 | 5.8, 13.5, 18.9, 23.0, 27.1, 31.3, 36.5, 44.0 |
| 500 | 1 | 8 | 25.03 | 5.49 ± 0.15 | 0.635 | 12.9, 17.3, 20.7, 23.6, 26.5, 29.4, 32.6, 37.2 |
| 500 | 1 | 16 | 25.03 | 6.40 ± 0.16 | 0.790 | 10.4, 16.1, 20.2, 23.4, 26.7, 30.0, 33.9, 39.7 |
| 500 | 1 | 40 | 25.04 | 7.01 ± 0.18 | 0.908 | 8.7, 15.2, 19.8, 23.2, 26.8, 30.4, 34.8, 41.2 |
| 500 | 1 | 100 | 25.04 | 7.26 ± 0.18 | 0.961 | 8.1, 14.8, 19.7, 23.2, 26.9, 30.6, 35.1, 41.8 |

The map is close to straight (R² 0.99 at noise 0.5), stretched a little in the
tails. TrueSkill's own model would say b = β/noise: right at noise 0.5 (8.33),
far off at noise 1 (4.17 predicted, 7.26 measured), so TrueSkill spreads μ
wider than a noisy curator's votes warrant. The cold runs use the Each-100
slopes: **μ = 25.06 + 8.23·q at noise 0.5, 25.04 + 7.26·q at noise 1**
(8.28 / 7.29 at n = 2000). The arrival runs fit the Each-8 scale per library,
b ≈ 6.7 / 5.5.

## Findings

**A low σ₀ is a brake unless the prediction earns it.** σ₀ is how far the first
Comparisons can move μ. With r = 0 the cold library needs +10–19% more votes at
σ₀ 7.5, +19–47% at 6.5 and +43–84% (or never reaches 80%) at 5.5. The
prediction has to pay that back before it saves anything. In the arrival
scenario σ₀ alone is nearly free (−1 to −8% at r = 0), because the new
wallpapers' first opponents are already well rated.

**Break-even**, the smallest swept r saving at least 10% against today's
25 / 8.333 (n = 500; n = 2000 agrees):

| σ₀ | Cold, to 50 / 70 / 80% Decided (noise 0.5) | Cold (noise 1) | Arrival (noise 0.5) | Arrival (noise 1) |
|---:|---|---|---:|---:|
| 5.5 | 0.7 / 0.9 / 0.9 | 0.7 / 0.9 / 0.9 | 0.3 (−11%) | 0.5 (−12%) |
| 6.5 | 0.7 / 0.7 / 0.9 | 0.7 / 0.9 / 0.9 | 0.5 (−12%) | 0.7 (−17%) |
| 7.5 | 0.7 / 0.7 / 0.7 | 0.7 / 0.7 / 0.7 | 0.7 (−12%) | 0.7 (−12%) |

At r 0.9 the cold library saves 18–56% and the arrival 19–41%. At r 0.7 the
cold library ranges from +8% to −29% by target and σ₀; the arrival saves 12–29%.

**Harmful r:**

| σ₀ | Costs votes (cold) | Raises Wrong |
|---:|---|---|
| 5.5 | r ≤ 0.3 at every target; r 0.5 at 70 / 80% (+19 / +31%, noise 1 +28 / +52%); r 0.7 at 80% (+5 / +8%) | r ≤ 0.5 in the arrival: wallpapers Decided by the prediction at the scan are 1.9–4.4% wrong and the peak Wrong among the new doubles (≈2% vs 0.98%; n = 2000: 2.65% vs 0.70%). Cold n = 2000 r 0.5: peak 2.11% vs 0.82% |
| 6.5 | r ≤ 0.3 at every target; r 0.5 at 70 / 80% (+5 / +6%, noise 1 +13 / +16%) | none: Decided at scan ≤ 1.3% wrong, peaks within noise of baseline |
| 7.5 | r ≤ 0.3 (+2 to +19%) | none beyond noise |

Otherwise Wrong at the 50 / 70 / 80% points stays within 0.1 point of the
baseline at noise 0.5 (r 0.9 lifts 80% from 0.10 to 0.20%) and within
0.5 point at noise 1 (1.15 → 1.62% at r 0.9, σ₀ 7.5). The Decided side is
held by the 2σ margin: a prediction must put μ₀ 11–15 from the Bar before it
Decides anything.

**Recommended σ₀: 6.5**, for the arrival use the ticket actually has. It beats
or ties 7.5 at every r ≥ 0.5 (noise 0.5: −12 / −20 / −30% vs −8 / −12 / −23%), never
raises Wrong, and never costs votes in the arrival, even at r 0. 5.5 saves more at r ≥ 0.7
(−29 / −41%) but is the one setting that makes the new wallpapers wrong more
often when r is 0.5 or lower, and r will only be known with error. If the
starting Score ever has to work on a library with no votes, 7.5 is the safer
number: it loses least when the prediction is weak.

**What r a held-out test would show.** r here is against true quality. A
held-out correlation against the library's μ is lower, r·√R², if the
prediction's errors are independent of the votes': at Each 8 that is 0.90·r
at noise 0.5 and 0.79·r at noise 1 (R² from the calibration table), at
Each 40 0.99·r and 0.95·r. So true r 0.5 / 0.7 reads as about 0.45 / 0.63
(noise 0.5) or 0.40 / 0.55 (noise 1) against Each-8 μ.

## Caveats

- Prediction errors are independent Gaussian noise. Real embedding errors are
  structured: a style or subject the model misjudges is misjudged for every
  wallpaper in it, so the arrival of a batch of one kind (a single scan often
  is one kind) is worse than modelled.
- Predictions are perfectly calibrated (shrunk by r onto the true μ scale).
  An unshrunk or mis-scaled prediction spreads μ₀ too wide and would push the
  harmful range up.
- The cold runs use the converged μ scale, wider than μ at Each ≤ 16
  (b 8.2 vs 6.7 at Each 8). The arrival runs fit the scale on true quality,
  which a ridge on μ can only approximate.
- The selector is today's `select_pair`, which always shows the wallpaper
  with fewest Comparisons first. It cannot skip a wallpaper the prediction
  already Decided, so the savings come only from where μ starts and from
  better-matched opponents. A Bar-aware selector (#370) could take more.
- Wallpapers Decided by a prediction alone are Decided while Unrated (ADR
  0057 allows it). In the arrival that is up to 24% of the new ones at the
  scan, depending on r and σ₀.
- Cold rows use 20 libraries: medians move by about ±5% between neighbouring
  rows. Arrival uses 100 at n = 500.

## 1. Cold library

`starting cold --sizes 500` (20 libraries, budget Each 60). "Each → 50%" is
the lower-median Each at which 50% are Decided, with the change against no
prior. "Peak Wrong" is the highest pooled Wrong over the run once at least 2%
are Decided. The last column is Decided below / truly below.

### Cold library, n = 500, noise 0.5

μ scale: μ = 25.06 + 8.23·q (b sd 0.20, R² 0.989; Each 100 uniform runs), so μ₀ = 25.06 + 8.23·r·p. 20 libraries per row, budget Each 60. 7.5s.

| Prior | Each → 50% | 70% | 80% | Wrong at 50 / 70 / 80% | Peak Wrong | Decided at Each 0 (wrong) | Below/truly below at Each 8 / 16 |
|---|---:|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 7.9 | 17.2 | 31.5 | 0.28 / 0.17 / 0.10% | 1.19% | 0.0% (0.0%) | 14.4% / 36.9% |
| r 0, σ₀ 5.5 | 11.3 (+43%) | 27.4 (+59%) | 57.9 (+84%) | 0.06 / 0.03 / 0.00% | 0.41% | 0.0% (0.0%) | 5.2% / 25.8% |
| r 0.3, σ₀ 5.5 | 9.9 (+25%) | 23.9 (+39%) | 49.6 (+57%) | 0.08 / 0.01 / 0.00% | 0.49% | 0.0% (0.0%) | 9.2% / 26.9% |
| r 0.5, σ₀ 5.5 | 7.9 (+0%) | 20.4 (+19%) | 41.4 (+31%) | 0.20 / 0.06 / 0.07% | 1.29% | 3.3% (0.6%) | 16.1% / 34.1% |
| r 0.7, σ₀ 5.5 | 5.7 (-28%) | 15.8 (-8%) | 33.2 (+5%) | 0.24 / 0.16 / 0.09% | 0.69% | 14.5% (0.4%) | 23.6% / 40.3% |
| r 0.9, σ₀ 5.5 | 3.7 (-53%) | 11.6 (-33%) | 24.6 (-22%) | 0.08 / 0.20 / 0.19% | 0.25% | 27.2% (0.0%) | 32.5% / 48.5% |
| r 0, σ₀ 6.5 | 9.4 (+19%) | 22.4 (+30%) | 44.8 (+42%) | 0.16 / 0.03 / 0.04% | 1.04% | 0.0% (0.0%) | 8.3% / 29.8% |
| r 0.3, σ₀ 6.5 | 8.7 (+10%) | 20.3 (+18%) | 37.9 (+20%) | 0.12 / 0.10 / 0.07% | 0.58% | 0.0% (0.0%) | 11.9% / 32.9% |
| r 0.5, σ₀ 6.5 | 7.6 (-4%) | 18.1 (+5%) | 33.3 (+6%) | 0.14 / 0.10 / 0.05% | 1.11% | 0.9% (1.1%) | 17.8% / 37.0% |
| r 0.7, σ₀ 6.5 | 5.8 (-27%) | 15.1 (-12%) | 28.8 (-9%) | 0.16 / 0.14 / 0.11% | 0.38% | 7.8% (0.3%) | 26.1% / 42.9% |
| r 0.9, σ₀ 6.5 | 4.2 (-47%) | 11.6 (-33%) | 22.8 (-28%) | 0.20 / 0.19 / 0.20% | 0.26% | 19.0% (0.0%) | 31.8% / 50.0% |
| r 0, σ₀ 7.5 | 8.8 (+11%) | 19.0 (+10%) | 37.4 (+19%) | 0.18 / 0.07 / 0.05% | 0.73% | 0.0% (0.0%) | 12.3% / 34.5% |
| r 0.3, σ₀ 7.5 | 8.2 (+4%) | 17.9 (+4%) | 35.0 (+11%) | 0.24 / 0.13 / 0.11% | 0.53% | 0.0% (0.0%) | 15.2% / 37.0% |
| r 0.5, σ₀ 7.5 | 7.2 (-9%) | 16.0 (-7%) | 30.6 (-3%) | 0.22 / 0.14 / 0.05% | 0.42% | 0.2% (0.0%) | 19.4% / 39.3% |
| r 0.7, σ₀ 7.5 | 5.8 (-27%) | 13.6 (-21%) | 26.1 (-17%) | 0.26 / 0.16 / 0.14% | 0.52% | 3.9% (0.0%) | 24.4% / 44.2% |
| r 0.9, σ₀ 7.5 | 4.6 (-42%) | 11.7 (-32%) | 21.3 (-32%) | 0.08 / 0.23 / 0.21% | 0.34% | 12.2% (0.0%) | 30.6% / 49.1% |

### Cold library, n = 500, noise 1

μ scale: μ = 25.04 + 7.26·q (b sd 0.18, R² 0.961; Each 100 uniform runs), so μ₀ = 25.04 + 7.26·r·p. 20 libraries per row, budget Each 60. 10.8s.

| Prior | Each → 50% | 70% | 80% | Wrong at 50 / 70 / 80% | Peak Wrong | Decided at Each 0 (wrong) | Below/truly below at Each 8 / 16 |
|---|---:|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 8.6 | 19.2 | 38.0 | 1.63 / 1.51 / 1.15% | 2.12% | 0.0% (0.0%) | 12.6% / 34.5% |
| r 0, σ₀ 5.5 | 13.6 (+58%) | 34.6 (+80%) | — (0/20) | 0.81 / 0.66 / —% | 1.80% | 0.0% (0.0%) | 4.6% / 20.3% |
| r 0.3, σ₀ 5.5 | 11.8 (+37%) | 29.8 (+55%) | — (6/20) | 0.83 / 0.64 / 0.37% | 2.48% | 0.0% (0.0%) | 7.5% / 23.9% |
| r 0.5, σ₀ 5.5 | 9.6 (+12%) | 24.6 (+28%) | 57.7 (+52%) | 1.03 / 1.00 / 0.56% | 1.40% | 1.3% (0.8%) | 12.8% / 29.7% |
| r 0.7, σ₀ 5.5 | 7.1 (-17%) | 19.6 (+2%) | 41.2 (+8%) | 1.03 / 0.97 / 0.86% | 1.13% | 9.3% (0.2%) | 19.2% / 36.4% |
| r 0.9, σ₀ 5.5 | 5.1 (-41%) | 15.6 (-19%) | 31.2 (-18%) | 0.51 / 0.78 / 1.02% | 1.16% | 20.8% (0.0%) | 27.6% / 42.5% |
| r 0, σ₀ 6.5 | 11.2 (+30%) | 26.6 (+39%) | 55.7 (+47%) | 1.06 / 0.88 / 0.40% | 2.26% | 0.0% (0.0%) | 7.7% / 25.6% |
| r 0.3, σ₀ 6.5 | 10.0 (+16%) | 23.9 (+24%) | 54.9 (+44%) | 1.07 / 0.98 / 0.87% | 2.06% | 0.0% (0.0%) | 9.1% / 26.2% |
| r 0.5, σ₀ 6.5 | 8.6 (+0%) | 21.7 (+13%) | 44.1 (+16%) | 0.98 / 1.22 / 0.95% | 1.29% | 0.3% (0.0%) | 11.8% / 30.3% |
| r 0.7, σ₀ 6.5 | 6.9 (-20%) | 17.9 (-7%) | 35.3 (-7%) | 1.09 / 1.54 / 1.26% | 1.60% | 4.3% (0.0%) | 19.6% / 38.5% |
| r 0.9, σ₀ 6.5 | 5.4 (-37%) | 13.9 (-28%) | 28.4 (-25%) | 0.48 / 1.04 / 1.16% | 1.27% | 13.0% (0.0%) | 26.3% / 43.4% |
| r 0, σ₀ 7.5 | 9.8 (+14%) | 21.5 (+12%) | 45.1 (+19%) | 1.27 / 1.23 / 0.87% | 2.72% | 0.0% (0.0%) | 10.2% / 28.6% |
| r 0.3, σ₀ 7.5 | 8.8 (+2%) | 20.8 (+8%) | 41.0 (+8%) | 1.25 / 1.10 / 0.97% | 1.81% | 0.0% (0.0%) | 12.1% / 31.6% |
| r 0.5, σ₀ 7.5 | 8.0 (-7%) | 19.1 (-1%) | 37.4 (-2%) | 1.49 / 1.40 / 1.22% | 1.57% | 0.1% (0.0%) | 14.1% / 34.5% |
| r 0.7, σ₀ 7.5 | 6.9 (-20%) | 16.2 (-16%) | 32.1 (-16%) | 1.27 / 1.53 / 1.34% | 1.56% | 1.7% (0.0%) | 19.8% / 37.8% |
| r 0.9, σ₀ 7.5 | 5.5 (-36%) | 13.9 (-28%) | 28.0 (-26%) | 0.98 / 1.61 / 1.62% | 1.75% | 7.6% (0.0%) | 26.1% / 45.2% |

### Spot check, n = 2000

`starting cold --sizes 2000 --r 0,0.5,0.7,0.9 --sigma0 5.5,7.5`. Same picture
as n = 500 to within a few percent.

#### Cold library, n = 2000, noise 0.5

μ scale: μ = 25.05 + 8.28·q (b sd 0.11, R² 0.990; Each 100 uniform runs), so μ₀ = 25.05 + 8.28·r·p. 20 libraries per row, budget Each 60. 104.7s.

| Prior | Each → 50% | 70% | 80% | Wrong at 50 / 70 / 80% | Peak Wrong | Decided at Each 0 (wrong) | Below/truly below at Each 8 / 16 |
|---|---:|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 7.9 | 17.6 | 33.8 | 0.23 / 0.18 / 0.12% | 0.82% | 0.0% (0.0%) | 14.2% / 36.2% |
| r 0, σ₀ 5.5 | 11.3 (+43%) | 27.8 (+58%) | — (8/20) | 0.04 / 0.03 / 0.00% | 0.37% | 0.0% (0.0%) | 5.5% / 24.9% |
| r 0.5, σ₀ 5.5 | 7.9 (+0%) | 20.5 (+16%) | 43.5 (+29%) | 0.18 / 0.06 / 0.03% | 2.11% | 3.4% (2.1%) | 16.4% / 33.4% |
| r 0.7, σ₀ 5.5 | 5.6 (-29%) | 15.8 (-10%) | 32.6 (-4%) | 0.25 / 0.16 / 0.08% | 0.77% | 15.1% (0.8%) | 23.9% / 40.7% |
| r 0.9, σ₀ 5.5 | 3.5 (-56%) | 11.8 (-33%) | 25.5 (-25%) | 0.09 / 0.17 / 0.12% | 0.20% | 27.7% (0.0%) | 32.1% / 47.2% |
| r 0, σ₀ 7.5 | 8.6 (+9%) | 19.9 (+13%) | 38.8 (+15%) | 0.21 / 0.07 / 0.03% | 0.74% | 0.0% (0.0%) | 12.0% / 34.0% |
| r 0.5, σ₀ 7.5 | 7.0 (-11%) | 16.3 (-7%) | 31.5 (-7%) | 0.29 / 0.16 / 0.12% | 0.63% | 0.2% (1.1%) | 19.3% / 39.3% |
| r 0.7, σ₀ 7.5 | 5.9 (-25%) | 13.9 (-21%) | 26.8 (-21%) | 0.30 / 0.19 / 0.20% | 0.30% | 4.0% (0.1%) | 24.9% / 44.2% |
| r 0.9, σ₀ 7.5 | 4.5 (-43%) | 11.6 (-34%) | 22.6 (-33%) | 0.13 / 0.26 / 0.26% | 0.31% | 12.6% (0.0%) | 30.6% / 49.9% |

#### Cold library, n = 2000, noise 1

μ scale: μ = 25.04 + 7.29·q (b sd 0.10, R² 0.961; Each 100 uniform runs), so μ₀ = 25.04 + 7.29·r·p. 20 libraries per row, budget Each 60. 54.9s.

| Prior | Each → 50% | 70% | 80% | Wrong at 50 / 70 / 80% | Peak Wrong | Decided at Each 0 (wrong) | Below/truly below at Each 8 / 16 |
|---|---:|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 8.9 | 19.8 | 39.6 | 1.87 / 1.82 / 1.38% | 2.68% | 0.0% (0.0%) | 11.7% / 32.5% |
| r 0, σ₀ 5.5 | 13.3 (+49%) | 34.3 (+73%) | — (0/20) | 0.62 / 0.50 / —% | 1.33% | 0.0% (0.0%) | 4.3% / 20.6% |
| r 0.5, σ₀ 5.5 | 9.6 (+8%) | 26.3 (+33%) | 58.9 (+49%) | 1.04 / 0.85 / 0.65% | 1.72% | 1.4% (1.0%) | 12.2% / 28.4% |
| r 0.7, σ₀ 5.5 | 7.0 (-21%) | 19.5 (-2%) | 43.8 (+11%) | 1.21 / 1.11 / 0.84% | 1.27% | 9.7% (0.3%) | 19.1% / 34.8% |
| r 0.9, σ₀ 5.5 | 4.9 (-45%) | 14.8 (-25%) | 31.7 (-20%) | 0.52 / 0.90 / 1.03% | 1.02% | 21.2% (0.0%) | 27.3% / 41.9% |
| r 0, σ₀ 7.5 | 9.7 (+9%) | 23.1 (+17%) | 47.5 (+20%) | 1.44 / 1.23 / 0.97% | 2.34% | 0.0% (0.0%) | 9.8% / 28.7% |
| r 0.5, σ₀ 7.5 | 8.0 (-10%) | 19.2 (-3%) | 39.0 (-2%) | 1.48 / 1.48 / 1.30% | 1.60% | 0.0% (0.0%) | 16.0% / 35.8% |
| r 0.7, σ₀ 7.5 | 6.8 (-24%) | 16.4 (-17%) | 33.1 (-16%) | 1.54 / 1.73 / 1.51% | 1.73% | 1.7% (0.0%) | 19.8% / 39.5% |
| r 0.9, σ₀ 7.5 | 5.6 (-37%) | 13.8 (-30%) | 27.4 (-31%) | 1.00 / 1.54 / 1.67% | 1.72% | 7.6% (0.0%) | 25.4% / 44.5% |

## 2. Arrival

`starting arrival --sizes 500 --reps 100`. 100 libraries rather than 20
because at 20 the medians moved by ±10% between neighbouring rows (the r = 0
rows showed savings of 14–26% that vanished at 100). "vs r 0 at same σ₀" is
what the prediction itself buys, with the σ₀ effect taken out. "Decided at
scan" is real here, because the old wallpapers set a Bar: those wallpapers
are Decided while still Unrated.

### Arrival, 500 ranked to Each 8 then 125 new, noise 0.5

The old wallpapers are 50.1% Decided at the scan. Votes are counted from the scan; "new Each" is the new wallpapers' mean Comparisons. 100 libraries per row. 8.2s.

| New ones' prior | Decided at scan (wrong) | Votes → old's share at scan (new Each) | vs r 0 at same σ₀ | Votes → old's share now | Wrong among new then | Peak Wrong among new |
|---|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 0.0% (0.0%) | 690 (6.8) |  | 790 (7.6) | 0.24% | 0.98% |
| r 0, σ₀ 5.5 | 0.0% (0.0%) | 635 -8% (6.3) |  | 725 -8% (7.1) | 0.36% | 0.84% |
| r 0.3, σ₀ 5.5 | 1.6% (4.4%) | 615 -11% (6.2) | -3% | 665 -16% (6.6) | 0.46% | 2.19% |
| r 0.5, σ₀ 5.5 | 9.6% (1.9%) | 550 -20% (5.4) | -13% | 595 -25% (5.9) | 0.55% | 1.91% |
| r 0.7, σ₀ 5.5 | 17.1% (0.6%) | 490 -29% (4.8) | -23% | 530 -33% (5.2) | 0.22% | 0.74% |
| r 0.9, σ₀ 5.5 | 23.6% (0.0%) | 410 -41% (3.9) | -35% | 450 -43% (4.3) | 0.16% | 0.19% |
| r 0, σ₀ 6.5 | 0.0% (0.0%) | 665 -4% (6.6) |  | 715 -9% (7.1) | 0.22% | 0.66% |
| r 0.3, σ₀ 6.5 | 0.1% (0.0%) | 650 -6% (6.2) | -2% | 680 -14% (6.6) | 0.17% | 0.54% |
| r 0.5, σ₀ 6.5 | 3.0% (1.3%) | 605 -12% (5.9) | -9% | 675 -15% (6.6) | 0.24% | 0.89% |
| r 0.7, σ₀ 6.5 | 8.7% (0.3%) | 555 -20% (5.4) | -17% | 610 -23% (5.9) | 0.24% | 0.28% |
| r 0.9, σ₀ 6.5 | 14.2% (0.0%) | 480 -30% (4.6) | -28% | 550 -30% (5.3) | 0.10% | 0.22% |
| r 0, σ₀ 7.5 | 0.0% (0.0%) | 660 -4% (6.3) |  | 745 -6% (7.4) | 0.22% | 0.60% |
| r 0.3, σ₀ 7.5 | 0.0% (0.0%) | 655 -5% (6.5) | -1% | 725 -8% (7.2) | 0.32% | 1.02% |
| r 0.5, σ₀ 7.5 | 0.7% (0.0%) | 635 -8% (6.1) | -4% | 720 -9% (7.0) | 0.32% | 0.48% |
| r 0.7, σ₀ 7.5 | 3.7% (0.0%) | 605 -12% (5.9) | -8% | 690 -13% (6.5) | 0.16% | 0.32% |
| r 0.9, σ₀ 7.5 | 7.9% (0.0%) | 530 -23% (5.0) | -20% | 625 -21% (6.0) | 0.24% | 0.30% |

### Arrival, 500 ranked to Each 8 then 125 new, noise 1

The old wallpapers are 46.8% Decided at the scan. Votes are counted from the scan; "new Each" is the new wallpapers' mean Comparisons. 100 libraries per row. 8.0s.

| New ones' prior | Decided at scan (wrong) | Votes → old's share at scan (new Each) | vs r 0 at same σ₀ | Votes → old's share now | Wrong among new then | Peak Wrong among new |
|---|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 0.0% (0.0%) | 690 (6.5) |  | 795 (7.5) | 1.94% | 3.57% |
| r 0, σ₀ 5.5 | 0.0% (0.0%) | 670 -3% (6.9) |  | 725 -9% (7.1) | 1.62% | 2.35% |
| r 0.3, σ₀ 5.5 | 0.2% (5.0%) | 645 -7% (6.4) | -4% | 695 -13% (6.8) | 1.57% | 4.19% |
| r 0.5, σ₀ 5.5 | 3.8% (1.3%) | 610 -12% (5.9) | -9% | 635 -20% (6.3) | 1.64% | 2.19% |
| r 0.7, σ₀ 5.5 | 9.9% (0.3%) | 555 -20% (5.5) | -17% | 590 -26% (5.8) | 1.32% | 1.46% |
| r 0.9, σ₀ 5.5 | 15.5% (0.0%) | 470 -32% (4.4) | -30% | 515 -35% (5.0) | 0.71% | 1.18% |
| r 0, σ₀ 6.5 | 0.0% (0.0%) | 655 -5% (6.4) |  | 695 -13% (6.8) | 2.08% | 3.98% |
| r 0.3, σ₀ 6.5 | 0.0% (0.0%) | 655 -5% (6.5) | +0% | 745 -6% (7.2) | 2.01% | 3.39% |
| r 0.5, σ₀ 6.5 | 0.6% (0.0%) | 640 -7% (6.3) | -2% | 705 -11% (6.8) | 1.61% | 2.27% |
| r 0.7, σ₀ 6.5 | 3.5% (0.0%) | 575 -17% (5.6) | -12% | 635 -20% (6.4) | 1.23% | 1.44% |
| r 0.9, σ₀ 6.5 | 7.7% (0.0%) | 520 -25% (4.9) | -21% | 585 -26% (5.7) | 0.63% | 1.20% |
| r 0, σ₀ 7.5 | 0.0% (0.0%) | 680 -1% (6.7) |  | 755 -5% (7.2) | 1.99% | 4.53% |
| r 0.3, σ₀ 7.5 | 0.0% (0.0%) | 690 +0% (6.8) | +1% | 760 -4% (7.5) | 2.20% | 4.13% |
| r 0.5, σ₀ 7.5 | 0.1% (0.0%) | 635 -8% (6.1) | -7% | 705 -11% (6.8) | 2.03% | 2.91% |
| r 0.7, σ₀ 7.5 | 1.0% (0.0%) | 605 -12% (5.8) | -11% | 690 -13% (6.7) | 1.52% | 1.73% |
| r 0.9, σ₀ 7.5 | 3.5% (0.0%) | 560 -19% (5.3) | -18% | 610 -23% (6.0) | 1.10% | 1.52% |

### Spot check, n = 2000 + 500 new

`starting arrival --sizes 2000 --new 500 --r 0,0.5,0.7,0.9 --sigma0 5.5,7.5`
(20 libraries).

#### Arrival, 2000 ranked to Each 8 then 500 new, noise 0.5

The old wallpapers are 50.1% Decided at the scan. Votes are counted from the scan; "new Each" is the new wallpapers' mean Comparisons. 20 libraries per row. 42.1s.

| New ones' prior | Decided at scan (wrong) | Votes → old's share at scan (new Each) | vs r 0 at same σ₀ | Votes → old's share now | Wrong among new then | Peak Wrong among new |
|---|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 0.0% (0.0%) | 2670 (6.5) |  | 3165 (7.6) | 0.26% | 0.70% |
| r 0, σ₀ 5.5 | 0.0% (0.0%) | 2545 -5% (6.4) |  | 2775 -12% (6.9) | 0.36% | 0.78% |
| r 0.5, σ₀ 5.5 | 9.8% (2.7%) | 2210 -17% (5.4) | -13% | 2480 -22% (6.0) | 0.14% | 2.65% |
| r 0.7, σ₀ 5.5 | 18.1% (0.8%) | 2065 -23% (5.0) | -19% | 2235 -29% (5.3) | 0.16% | 0.83% |
| r 0.9, σ₀ 5.5 | 23.9% (0.0%) | 1610 -40% (3.9) | -37% | 1855 -41% (4.5) | 0.14% | 0.18% |
| r 0, σ₀ 7.5 | 0.0% (0.0%) | 2760 +3% (6.8) |  | 3215 +2% (7.7) | 0.12% | 0.37% |
| r 0.5, σ₀ 7.5 | 0.6% (3.3%) | 2450 -8% (6.0) | -11% | 2835 -10% (6.9) | 0.24% | 0.93% |
| r 0.7, σ₀ 7.5 | 3.7% (0.5%) | 2305 -14% (5.5) | -16% | 2690 -15% (6.5) | 0.22% | 0.89% |
| r 0.9, σ₀ 7.5 | 8.5% (0.0%) | 2210 -17% (5.3) | -20% | 2545 -20% (6.1) | 0.18% | 0.28% |

#### Arrival, 2000 ranked to Each 8 then 500 new, noise 1

The old wallpapers are 46.7% Decided at the scan. Votes are counted from the scan; "new Each" is the new wallpapers' mean Comparisons. 20 libraries per row. 26.5s.

| New ones' prior | Decided at scan (wrong) | Votes → old's share at scan (new Each) | vs r 0 at same σ₀ | Votes → old's share now | Wrong among new then | Peak Wrong among new |
|---|---:|---:|---:|---:|---:|---:|
| none (25 / 8.333) | 0.0% (0.0%) | 2780 (6.7) |  | 3405 (7.9) | 1.84% | 4.03% |
| r 0, σ₀ 5.5 | 0.0% (0.0%) | 2740 -1% (6.7) |  | 3185 -6% (7.7) | 1.84% | 5.61% |
| r 0.5, σ₀ 5.5 | 3.5% (1.7%) | 2370 -15% (5.9) | -14% | 2535 -26% (6.3) | 1.56% | 2.07% |
| r 0.7, σ₀ 5.5 | 9.7% (0.5%) | 2140 -23% (5.2) | -22% | 2280 -33% (5.5) | 1.37% | 1.58% |
| r 0.9, σ₀ 5.5 | 15.9% (0.0%) | 1875 -33% (4.5) | -32% | 2220 -35% (5.4) | 0.73% | 1.01% |
| r 0, σ₀ 7.5 | 0.0% (0.0%) | 2760 -1% (6.7) |  | 3295 -3% (7.8) | 1.88% | 4.57% |
| r 0.5, σ₀ 7.5 | 0.1% (0.0%) | 2650 -5% (6.4) | -4% | 2955 -13% (7.2) | 1.84% | 2.31% |
| r 0.7, σ₀ 7.5 | 0.9% (0.0%) | 2320 -17% (5.6) | -16% | 2855 -16% (6.9) | 1.47% | 1.73% |
| r 0.9, σ₀ 7.5 | 3.4% (0.0%) | 2265 -19% (5.4) | -18% | 2620 -23% (6.2) | 1.37% | 1.64% |

