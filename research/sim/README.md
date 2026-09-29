# walltare-sim

A throwaway simulator for the "faster ranking" wayfinder map
([#362](https://github.com/QuantumFF/walltare/issues/362)), built for
[#363](https://github.com/QuantumFF/walltare/issues/363). It lives only on
`research/votes-until-decided` and never ships.

It measures how many votes a selection strategy needs before the wallpapers on
each side of a Bar are Decided, and how often a Decided wallpaper sits on the
wrong side.

## Run

```sh
cd research/sim
cargo run --release -- --help
cargo run --release -- --selector baseline,random --noise 0.5,1.0 --reps 20   # results/baseline.md
cargo test --release   # the voter, Bar and Decided checks, plus ranking.rs's own tests
```

No dependencies and no Tauri build. `src/main.rs` compiles the app's
`src-tauri/src/ranking.rs` by `#[path]`, so every run uses the real
`rate_1vs1` and `select_pair` as they stand on this branch.

## Model

- **Library**: `n` wallpapers with a hidden true quality drawn from N(0, 1).
  A given `(seed, n, rep)` gives the same library to every selector and noise,
  so strategies are compared on the same libraries.
- **Voter** (`--voter`): `thurstone` sees each shown wallpaper as quality +
  N(0, noise²) and picks the highest. For a pair that is
  P(i beats j) = Φ((qᵢ − qⱼ) / (noise·√2)). TrueSkill assumes noise = β/σ₀ ≈ 0.5,
  so `--noise 0.5` is a curator exactly as consistent as the rating model
  expects and `1.0` is one twice as noisy. `bradley-terry` is the logistic
  (Plackett–Luce for groups) equivalent, with heavier tails.
- **Bar**: `QuantileBar`. The curator would clear out the bottom `--bar-share`
  (default 25%). In Score space the Bar is midway between the μ ranked just
  below that share and the one just above it, recomputed after every vote.
  The truth is the same share of true quality.
- **Decided**: `ZSigma`. Decided when |μ − Bar| ≥ `--z`·σ (default 2).
- **Update**: `WinnerBeatsEach`: one `rate_1vs1` per loser shown. For a pair
  this is exactly what the app records.
- **Prior**: `Uniform`: every wallpaper starts at μ = 25, σ = 8.333.
- **Budget**: `--budget` Comparisons per wallpaper on average (default 40),
  so `budget × n / 2` pair votes.

"Each" in the output is the mean number of Comparisons per wallpaper, which is
roughly the Round.

## Plugging in a new strategy

Every part is a trait in `src/sim.rs`:

| Trait | Decides | Default |
|---|---|---|
| `Selector` | which wallpapers are shown: two for a pair, more for best-of-N. Sees the current Bar and the Decided rule | `Baseline` = `voting::get_pair` |
| `Voter` | which shown wallpaper the curator picks | `Thurstone` |
| `Updater` | how a pick becomes Rating changes | `WinnerBeatsEach` |
| `Prior` | a wallpaper's starting Rating, given its true quality (a triage pass or embedding prediction is a noisy function of it) | `Uniform` |
| `BarRule` | where the Bar is and which side is true | `QuantileBar` |
| `DecidedRule` | when a wallpaper is Decided | `ZSigma` |

A new selector goes in `src/selectors.rs` and gets a name in `by_name`. A new
prior, updater, Bar or Decided rule needs a flag in `main.rs`. Group selectors
are counted per judgement ("Votes"), while "Each" counts the `rate_1vs1` calls
behind them, so a best-of-4 pick costs one vote and three Comparisons.
