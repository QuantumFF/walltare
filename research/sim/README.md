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
cargo run --release -- --report decided --sizes 120,500 --noise 0.5,1.0 \
  --rules plain,warmup,participated,bar-sigma --voter bradley-terry          # results/decided-rule.md
cargo test --release   # the voter, Bar and Decided checks, plus ranking.rs's own tests
cargo run --release -- starting calibrate   # starting Score studies for #374:
cargo run --release -- starting cold        #   results/starting-score.md
cargo run --release -- starting arrival --reps 100
```

Pair-selection studies for [#370](https://github.com/QuantumFF/walltare/issues/370),
`results/pair-selection.md` (`pair --help` for every flag):

```sh
S=baseline; for f in straddle apt0 apt0.5 apt1 apt2 apt4 lsa uleast; do
  for o in mu bald look; do S="$S,$f+$o"; done; done
cargo run --release -- pair runs --sizes 500 --noise 1.0 --reps 10 --selector $S   # screening
TOP=baseline,uleast+bald,uleast+mu,lsa+look
for v in thurstone bradley-terry; do                                               # full runs
  cargo run --release -- pair runs --sizes 120,500,2000 --noise 0.5,1.0 --voter $v --selector $TOP
done
for k in 2 2.5 3; do                                                               # wrong side vs k
  cargo run --release -- pair runs --sizes 120,500 --noise 1.0 --voter thurstone,bradley-terry \
    --reps 50 --k $k --selector $TOP
  cargo run --release -- pair runs --sizes 2000 --noise 1.0 --voter thurstone,bradley-terry \
    --k $k --selector $TOP
done
# Opponent pools, variety, stop and fallback: the same `pair runs --sizes 500 --noise 1.0
# --voter thurstone,bradley-terry` with selectors such as uleast+bald/pool=und,
# lsa+look/m=10, straddle+look/top=8, uleast+mu/stop=1.5/fb=ratio.
U=baseline,uleast+bald/u=forced,uleast+bald/u=index,uleast+bald/u=share,uleast+bald/uu=allow  # etc.
cargo run --release -- pair arrival --new 200,50 --noise 0.5,1.0 --voter thurstone,bradley-terry --selector $U
cargo run --release -- pair runs --sizes 30,60 --noise 0.5,1.0 --voter thurstone,bradley-terry \
  --reps 100 --early --selector $U                                                 # young library
cargo run --release -- pair runs --sizes 500 --noise 0.5,1.0 --voter thurstone,bradley-terry \
  --early --selector $U                                                            # fresh 500
cargo run --release -- pair timing --selector $TOP,straddle+look
```

The exact selector lists of every table are in the results file.

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
- **Bar**: `QuantileBar`, as "How the Bar is set" (#367) settled it: the
  worst `--bar-share` (default 20%) of every wallpaper with a Score, so
  wallpapers with no Comparison yet don't count. In Score space the Bar is
  midway between the μ ranked just below that share and the one just above
  it, recomputed after every vote. The truth is the same share of true
  quality over the whole library. Nothing is rejected during a run.
  The Bar also carries σ_bar, the root mean square σ of the two wallpapers
  whose μ straddle it, and how many Scores it rests on.
- **Decided**: `ZSigma`. Decided when |μ − Bar| ≥ `--z`·σ (default 2).
  `--report decided` compares rules instead (`src/decided_report.rs`): each
  of `--rules` at each of `--ks`, all followed through the same runs by one
  `Tracker` apiece (`src/track.rs`), since no current selector reads the
  Decided rule. `plain` is `ZSigma`, `warmup` holds everything Undecided
  until the Bar rests on `--warmup` Scores, `participated` until every
  wallpaper has a Comparison, and `bar-sigma` is |μ − Bar| ≥ k·√(σ² + σ_bar²).
- **Update**: `WinnerBeatsEach`: one `rate_1vs1` per loser shown. For a pair
  this is exactly what the app records.
- **Prior**: `Uniform`: every wallpaper starts at μ = 25, σ = 8.333.
  `Predicted` (the `starting` studies) gives a starting Score from a
  prediction that correlates r with true quality; see `src/starting.rs`.
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

`Observer` is not a strategy: it sees every vote with the Ratings and Bar
from just before it, for measurements that need what changed between votes.

A new selector goes in `src/selectors.rs` and gets a name in `by_name`.
The Bar-aware pair rules of #370 are one parametric selector, `PairRule`,
named `<first>+<opponent>[/option...]`: first pick `straddle`, `apt<ε>`,
`lsa` or `uleast` (least-compared Undecided); opponent `mu`, `bald` or
`look`; options `/pool=und|anchor`, `/m=<pairs>`, `/top=<n>`, `/stop=<σ>`,
`/fb=least|ratio`, `/u=forced|index|share`, `/uu=allow`, `/k=<k>`. A new
prior, updater, Bar or Decided rule needs a flag in `main.rs`. Group selectors
are counted per judgement ("Votes"), while "Each" counts the `rate_1vs1` calls
behind them, so a best-of-4 pick costs one vote and three Comparisons.
