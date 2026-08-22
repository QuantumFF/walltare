# Research: TrueSkill implementation options in Rust

Resolves [QuantumFF/walltare#2](https://github.com/QuantumFF/walltare/issues/2).

## Question

The Python reference app (`/home/qdes/repos/rate-wallpaper/backend/ranking.py`) uses
`trueskill.TrueSkill(mu=25.0, sigma=8.333, beta=4.167, tau=0.083, draw_probability=0.0)`
and `env.rate_1vs1(winner, loser)`. What is the best way to get identical 1v1 update math in Rust?

## TL;DR recommendation

**Hand-roll the 1v1 update (~60 lines, `std` only — no dependency needed).**
It matches Python `trueskill` 0.4.5 output to **< 1e-7** on all tested cases,
while the only mature crate (`skillratings`) drifts by ~1e-4 because its
dynamics-factor (τ) semantics differ from python-trueskill. If exact parity with
ratings already accumulated by the Python app matters, hand-rolling is the only
option that achieves it. Keep `skillratings` as the fallback if we later need
teams / multi-player FFA support.

## Crate survey

Searched crates.io for "trueskill" (2026-08-22). There is **no crate named
`trueskill` or `trueskill-rs`** on crates.io. Relevant hits:

| Crate | Ver | Updated | License | Assessment |
|---|---|---|---|---|
| [`skillratings`](https://crates.io/crates/skillratings) | 0.29.0 | 2026-04 | MIT OR Apache-2.0 | The only serious option. 87k downloads, actively maintained, zero deps by default (optional `serde`), includes TrueSkill with configurable `beta`, `dynamics_factor` (= τ), `draw_probability`. Supports 1v1, two-team, multi-team, rating periods. |
| [`openskill`](https://crates.io/crates/openskill) | 0.0.1 | 2023-12 | — | OpenSkill (an approximation), not TrueSkill; v0.0.1, abandoned. Not equivalent math. |
| [`skillr`](https://crates.io/crates/skillr) | 0.1.2 | 2026-01 | — | "Inspired by TrueSkill/OpenSkill", v0.1.x toy. |
| [`multi-skill`](https://crates.io/crates/multi-skill) | 0.1.2 | 2021-02 | — | Unmaintained since 2021. |
| [`bbt`](https://crates.io/crates/bbt) | 1.0.0 | 2025-09 | — | Different (Bradley–Terry style), not TrueSkill. |

### skillratings vs Python semantics

Source inspected: `src/trueskill/mod.rs` and `src/trueskill/math.rs` of
skillratings 0.29.0. For a non-draw 1v1 it computes:

```
c = sqrt(2·β² + σ₁² + σ₂²)              // ← τ NOT folded into σ here
μ' = μ ± ((σ² + τ²)/c)·v(...)
σ' = sqrt((σ² + τ²)·(1 − ((σ² + τ²)/c²)·w(...)))
```

python-trueskill instead applies the dynamics factor first
(σ′₀ = sqrt(σ² + τ²)) and then uses σ′₀ everywhere, **including inside c**:

```
c = sqrt(2·β² + σ₁′₀² + σ₂′₀²)
```

This is a real semantic difference, not floating-point noise.

## Numerical verification

Ground truth generated with Python `trueskill==0.4.5` using the exact env from
`ranking.py` (`mu=25.0, sigma=8.333, beta=4.167, tau=0.083, draw_probability=0.0`),
via `env.rate_1vs1`.

Rust harness compared three implementations:

1. `skillratings = "0.29"` with `TrueSkillConfig { draw_probability: 0.0, beta: 4.167, dynamics_factor: 0.083 }`
2. Hand-rolled port (~60 lines): standard two-player Gaussian factor-graph
   update — `c`, `v(t) = N(t)/Φ(t)`, `w(t) = v(t)(v(t)+t)` — with τ added to each
   σ in quadrature *before* computing c. Only needs an `erf` (Abramowitz–Stegun
   7.1.26 approx, |ε| < 1.5e-7, is sufficient); no `statrs` required.
3. Same hand-rolled math cross-checked independently in pure Python/numpy —
   agreed with the library to ~1e-9, confirming the formula transcription.

Results (max abs error over winner μ/σ and loser μ/σ):

| Case (winner μ,σ vs loser μ,σ) | skillratings err | hand-rolled err |
|---|---|---|
| 25.0, 8.333 vs 25.0, 8.333 → W (29.2052019679, 7.1945851014) L (20.7947980321, 7.1945851014) | 1.67e-4 | **6.6e-8** |
| 32.0, 5.0 vs 18.0, 6.5 → W (32.4120419412, 4.8397039539) L (17.3037274420, 6.1427520439) | 5.42e-5 | **1.7e-8** |
| 40.0, 2.0 vs 30.0, 7.0 → W (40.1126098156, 1.9856441186) L (28.6227078575, 6.2783176007) | 6.60e-5 | **1.2e-8** |

(The residual hand-rolled error is just the 10-digit rounding of the recorded
Python ground truth.)

## Feasibility assessment of hand-rolling

- **Size**: ~60 lines including tests. The 1v1 no-draw case needs exactly one
  closed-form update step; no iterative message passing required.
- **Dependencies**: none beyond `std::f64` (`exp`, `sqrt`). An accurate-enough
  `erf` is ~10 lines; alternatively pull in `statrs`/`libm` if exact `erfc`
  tails ever matter (they don't at these rating magnitudes).
- **Parity**: verified above (< 1e-7).
- **Edge cases worth keeping from python-trueskill**: draw handling (we don't
  need it — `draw_probability=0`), and the low-probability guard
  `Φ(t) < 2.22e-162 → v ≈ −t` used by both libraries for extreme upsets.
- **Caveat**: TrueSkill™ is patented (Microsoft); the patent concerns
  commercial use of the system itself and applies equally whether we use a
  crate or hand-roll. skillratings carries this caution note too. For a
  non-commercial/hobby wallpaper-ranking app this is not a blocker.

## Decision

Hand-roll `rate_1vs1` in Rust following python-trueskill's exact ordering
(τ into σ before c). Rationale:

1. Exact numeric parity with existing ratings migrated from the Python app
   (crate drifts ~1e-4/match due to different τ placement — small but
   systematic and avoidable).
2. Smaller dependency footprint than even `skillratings`; zero transitive deps.
3. The algorithm surface we need (1v1, no draws) fits comfortably in one file
   that can be property-tested against recorded Python outputs as golden data.
