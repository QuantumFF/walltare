//! The simulated library and the pluggable parts of one run.
//!
//! A run is: a library of wallpapers with a hidden true quality, a starting
//! Rating for each (the `Prior`), then judgements until the budget runs out.
//! Each judgement, a `Selector` chooses what to show (two wallpapers for a
//! pair, more for best-of-N), a `Voter` picks the one it likes best from its
//! noisy perception of the true qualities, and an `Updater` turns that pick
//! into Rating changes. A `BarRule` places the Bar and says which side each
//! wallpaper truly belongs on; a `DecidedRule` says when the app is sure.

use crate::prng::Prng;
use crate::ranking::{self, Rating, WallpaperSummary};

/// σ below which the app calls a Score Evaluated (ADR 0046's default).
pub const EVALUATED_SIGMA: f64 = 4.0;

pub struct Library {
    /// Hidden true quality, standard normal. Never read by selectors that
    /// model the app; only the voter and the scoring see it.
    pub quality: Vec<f64>,
    pub ratings: Vec<Rating>,
    pub counts: Vec<u32>,
    /// What the Bar rule says is the truth: this wallpaper belongs below it.
    pub truly_below: Vec<bool>,
}

impl Library {
    pub fn len(&self) -> usize {
        self.quality.len()
    }

    /// The pool as `ranking::select_pair` sees it; `id` is the index.
    pub fn summaries(&self) -> Vec<WallpaperSummary> {
        self.ratings
            .iter()
            .zip(&self.counts)
            .enumerate()
            .map(|(i, (r, &c))| WallpaperSummary {
                id: i as i64,
                rating_mu: r.mu,
                rating_sigma: r.sigma,
                comparisons_count: c,
            })
            .collect()
    }
}

/// Where the Bar sits right now, and what it rests on.
#[derive(Clone, Copy, Debug)]
pub struct Bar {
    /// The Bar as a Score.
    pub score: f64,
    /// σ of the wallpapers sitting at the Bar position: the root mean square
    /// of the two whose μ straddle it.
    pub sigma: f64,
    /// How many Scores the Bar rests on: wallpapers with a Comparison.
    pub scored: usize,
}

/// Chooses what the curator is shown next. Two indices for a pair, more for
/// a best-of-N pick. `bar` is the current Bar, for selectors that aim at it.
pub trait Selector {
    fn name(&self) -> String;
    fn select(&mut self, lib: &Library, bar: &Bar, decided: &dyn DecidedRule, rng: &mut Prng)
        -> Vec<usize>;
}

/// The simulated curator: picks the best of what is shown.
pub trait Voter: Sync {
    fn name(&self) -> String;
    fn pick(&self, quality: &[f64], shown: &[usize], rng: &mut Prng) -> usize;
}

/// Turns one pick into Rating changes and Comparison counts.
pub trait Updater {
    fn name(&self) -> String;
    fn apply(&self, lib: &mut Library, shown: &[usize], winner: usize);
}

/// The starting Rating a wallpaper has before any judgement.
pub trait Prior: Sync {
    fn name(&self) -> String;
    fn initial(&self, quality: f64, rng: &mut Prng) -> Rating;
}

pub trait BarRule: Sync {
    fn name(&self) -> String;
    /// The Bar, given the current Ratings.
    fn bar(&self, lib: &Library, scratch: &mut Vec<Rating>) -> Bar;
    /// Which wallpapers truly belong below the Bar.
    fn truly_below(&self, quality: &[f64]) -> Vec<bool>;
}

pub trait DecidedRule: Sync {
    fn name(&self) -> String;
    /// `Some(true)` Decided below, `Some(false)` Decided above, `None` Undecided.
    fn side(&self, rating: Rating, bar: &Bar) -> Option<bool>;
}

// --- default parts ---------------------------------------------------------

/// Thurstone: each shown wallpaper is perceived as quality + N(0, noise²) and
/// the highest perception wins. For a pair, P(i beats j) = Φ((qᵢ − qⱼ) / (noise·√2)).
/// TrueSkill's own model is this with noise = β/σ₀ ≈ 0.5.
pub struct Thurstone {
    pub noise: f64,
}

impl Voter for Thurstone {
    fn name(&self) -> String {
        format!("thurstone(noise={})", self.noise)
    }
    fn pick(&self, quality: &[f64], shown: &[usize], rng: &mut Prng) -> usize {
        let mut best = shown[0];
        let mut best_seen = f64::NEG_INFINITY;
        for &i in shown {
            let seen = quality[i] + self.noise * rng.normal();
            if seen > best_seen {
                best_seen = seen;
                best = i;
            }
        }
        best
    }
}

/// Bradley–Terry (Plackett–Luce for groups): P(i wins) ∝ exp(qᵢ / scale), with
/// scale = noise·√2 / 1.702 so a pair agrees closely with `Thurstone` at the
/// same noise. Heavier tails: upsets between far-apart wallpapers are likelier.
pub struct BradleyTerry {
    pub noise: f64,
}

impl Voter for BradleyTerry {
    fn name(&self) -> String {
        format!("bradley-terry(noise={})", self.noise)
    }
    fn pick(&self, quality: &[f64], shown: &[usize], rng: &mut Prng) -> usize {
        let scale = self.noise * std::f64::consts::SQRT_2 / 1.702;
        let top = shown
            .iter()
            .map(|&i| quality[i])
            .fold(f64::NEG_INFINITY, f64::max);
        let weights: Vec<f64> = shown
            .iter()
            .map(|&i| ((quality[i] - top) / scale).exp())
            .collect();
        let mut r = rng.uniform() * weights.iter().sum::<f64>();
        for (k, w) in weights.iter().enumerate() {
            r -= w;
            if r < 0.0 {
                return shown[k];
            }
        }
        shown[shown.len() - 1]
    }
}

/// The winner beats each other shown wallpaper, one `rate_1vs1` at a time,
/// carrying the winner's updated Rating into the next. For a pair this is
/// exactly what the app records for one vote.
pub struct WinnerBeatsEach;

impl Updater for WinnerBeatsEach {
    fn name(&self) -> String {
        "winner-beats-each".into()
    }
    fn apply(&self, lib: &mut Library, shown: &[usize], winner: usize) {
        for &loser in shown.iter().filter(|&&i| i != winner) {
            let (w, l) = ranking::rate_1vs1(lib.ratings[winner], lib.ratings[loser]);
            lib.ratings[winner] = w;
            lib.ratings[loser] = l;
            lib.counts[winner] += 1;
            lib.counts[loser] += 1;
        }
    }
}

/// Every wallpaper starts at the same Score: the app's ignorance (today).
pub struct Uniform;

impl Prior for Uniform {
    fn name(&self) -> String {
        "uniform".into()
    }
    fn initial(&self, _quality: f64, _rng: &mut Prng) -> Rating {
        Rating::new(ranking::MU, ranking::SIGMA)
    }
}

/// The Bar as "How the Bar is set" (#367) settled it: the worst `share` of
/// every wallpaper with a Score. Unrated wallpapers (no Comparison yet) don't
/// count. The simulator never rejects, so "Rejected included" doesn't come
/// up. In Score space the Bar is that quantile of μ among the Scored; the
/// truth is the same quantile of true quality over the whole library, since
/// every wallpaper ends up with a Score.
pub struct QuantileBar {
    pub share: f64,
}

impl QuantileBar {
    fn rank(&self, n: usize) -> usize {
        ((self.share * n as f64).round() as usize).clamp(1, n - 1)
    }
}

impl BarRule for QuantileBar {
    fn name(&self) -> String {
        format!("worst {}% of the Scored", self.share * 100.0)
    }
    fn bar(&self, lib: &Library, scratch: &mut Vec<Rating>) -> Bar {
        // Midway between the last wallpaper below and the first above.
        scratch.clear();
        scratch.extend(
            lib.ratings
                .iter()
                .zip(&lib.counts)
                .filter(|(_, &c)| c > 0)
                .map(|(r, _)| *r),
        );
        let scored = scratch.len();
        if scored < 2 {
            return Bar {
                score: ranking::MU,
                sigma: ranking::SIGMA,
                scored,
            };
        }
        let k = self.rank(scored);
        let (_, &mut above, _) = scratch.select_nth_unstable_by(k, |a, b| a.mu.total_cmp(&b.mu));
        let below = scratch[..k]
            .iter()
            .copied()
            .max_by(|a, b| a.mu.total_cmp(&b.mu))
            .expect("k ≥ 1");
        Bar {
            score: (below.mu + above.mu) / 2.0,
            sigma: ((below.sigma.powi(2) + above.sigma.powi(2)) / 2.0).sqrt(),
            scored,
        }
    }
    fn truly_below(&self, quality: &[f64]) -> Vec<bool> {
        let mut sorted = quality.to_vec();
        sorted.sort_by(f64::total_cmp);
        let k = self.rank(sorted.len());
        let cut = (sorted[k - 1] + sorted[k]) / 2.0;
        quality.iter().map(|&q| q < cut).collect()
    }
}

/// Decided when the Score sits at least `z` σ from the Bar.
pub struct ZSigma {
    pub z: f64,
}

impl DecidedRule for ZSigma {
    fn name(&self) -> String {
        format!("|μ − Bar| ≥ {}σ", self.z)
    }
    fn side(&self, rating: Rating, bar: &Bar) -> Option<bool> {
        let gap = rating.mu - bar.score;
        (gap.abs() >= self.z * rating.sigma).then_some(gap < 0.0)
    }
}

/// `ZSigma`, but nothing is Decided until the Bar rests on `min_scored` Scores.
pub struct Warmup {
    pub z: f64,
    pub min_scored: usize,
}

impl DecidedRule for Warmup {
    fn name(&self) -> String {
        format!("|μ − Bar| ≥ {}σ once the Bar rests on {} Scores", self.z, self.min_scored)
    }
    fn side(&self, rating: Rating, bar: &Bar) -> Option<bool> {
        if bar.scored < self.min_scored {
            return None;
        }
        ZSigma { z: self.z }.side(rating, bar)
    }
}

/// Counts the Bar's own uncertainty too: |μ − Bar| ≥ z·√(σ² + σ_bar²).
pub struct BarSigma {
    pub z: f64,
}

impl DecidedRule for BarSigma {
    fn name(&self) -> String {
        format!("|μ − Bar| ≥ {}·√(σ² + σ_bar²)", self.z)
    }
    fn side(&self, rating: Rating, bar: &Bar) -> Option<bool> {
        let gap = rating.mu - bar.score;
        let spread = (rating.sigma.powi(2) + bar.sigma.powi(2)).sqrt();
        (gap.abs() >= self.z * spread).then_some(gap < 0.0)
    }
}

// --- one run ---------------------------------------------------------------

pub struct Parts<'a> {
    pub voter: &'a dyn Voter,
    pub updater: &'a dyn Updater,
    pub prior: &'a dyn Prior,
    pub bar: &'a dyn BarRule,
    pub decided: &'a dyn DecidedRule,
}

/// The state of the library after some number of judgements.
#[derive(Clone, Copy, Debug, Default)]
pub struct Checkpoint {
    pub judgements: usize,
    /// `rate_1vs1` calls so far: equals judgements for pairs.
    pub comparisons: usize,
    pub decided: usize,
    /// Decided on the side the truth says it does not belong on.
    pub decided_wrong: usize,
    pub decided_below: usize,
    pub truly_below: usize,
    pub evaluated: usize,
    pub sigma_sum: f64,
}

/// One judgement, as an `Observer` sees it after the Ratings have changed.
pub struct Vote<'a> {
    /// 1-based judgement number.
    pub index: usize,
    /// `rate_1vs1` calls so far, this one included.
    pub comparisons: usize,
    pub shown: &'a [usize],
    /// The Ratings of `shown`, in order, before this judgement.
    pub before: &'a [Rating],
    pub bar_before: &'a Bar,
    pub bar: &'a Bar,
}

/// Watches every judgement of a run, for measurements a `Checkpoint` can't
/// hold (what changed between two votes).
pub trait Observer {
    fn start(&mut self, lib: &Library, bar: &Bar);
    fn vote(&mut self, lib: &Library, vote: &Vote);
}

/// Runs one library to the budget. Returns its checkpoints and the library
/// as it ended.
pub fn run(
    n: usize,
    selector: &mut dyn Selector,
    parts: &Parts,
    max_judgements: usize,
    checkpoint_every: usize,
    observers: &mut [&mut dyn Observer],
    rng: &mut Prng,
) -> (Vec<Checkpoint>, Library) {
    let quality: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
    let ratings = quality.iter().map(|&q| parts.prior.initial(q, rng)).collect();
    let truly_below = parts.bar.truly_below(&quality);
    let mut lib = Library {
        quality,
        ratings,
        counts: vec![0; n],
        truly_below,
    };
    let mut scratch = Vec::with_capacity(n);
    let mut comparisons = 0;
    let mut out = Vec::new();
    let mut bar = parts.bar.bar(&lib, &mut scratch);
    out.push(measure(&lib, &bar, parts.decided, 0, 0));
    for o in observers.iter_mut() {
        o.start(&lib, &bar);
    }
    let mut before = Vec::new();
    for j in 1..=max_judgements {
        let shown = selector.select(&lib, &bar, parts.decided, rng);
        let winner = parts.voter.pick(&lib.quality, &shown, rng);
        before.clear();
        before.extend(shown.iter().map(|&i| lib.ratings[i]));
        parts.updater.apply(&mut lib, &shown, winner);
        comparisons += shown.len() - 1;
        let bar_before = bar;
        bar = parts.bar.bar(&lib, &mut scratch);
        let vote = Vote {
            index: j,
            comparisons,
            shown: &shown,
            before: &before,
            bar_before: &bar_before,
            bar: &bar,
        };
        for o in observers.iter_mut() {
            o.vote(&lib, &vote);
        }
        if j % checkpoint_every == 0 || j == max_judgements {
            out.push(measure(&lib, &bar, parts.decided, j, comparisons));
        }
    }
    (out, lib)
}

fn measure(lib: &Library, bar: &Bar, rule: &dyn DecidedRule, j: usize, c: usize) -> Checkpoint {
    let mut cp = Checkpoint {
        judgements: j,
        comparisons: c,
        ..Default::default()
    };
    for i in 0..lib.len() {
        let r = lib.ratings[i];
        if lib.truly_below[i] {
            cp.truly_below += 1;
        }
        cp.sigma_sum += r.sigma;
        if r.sigma < EVALUATED_SIGMA {
            cp.evaluated += 1;
        }
        if let Some(below) = rule.side(r, bar) {
            cp.decided += 1;
            if below {
                cp.decided_below += 1;
            }
            if below != lib.truly_below[i] {
                cp.decided_wrong += 1;
            }
        }
    }
    cp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thurstone_pair_win_rate_matches_phi() {
        // q gap 1, noise 0.5 → Φ(1 / (0.5·√2)) = Φ(1.414) ≈ 0.921.
        let voter = Thurstone { noise: 0.5 };
        let quality = [1.0, 0.0];
        let mut rng = Prng::new(7);
        let wins = (0..200_000)
            .filter(|_| voter.pick(&quality, &[0, 1], &mut rng) == 0)
            .count();
        let rate = wins as f64 / 200_000.0;
        assert!((rate - 0.921).abs() < 0.005, "{rate}");
    }

    #[test]
    fn bradley_terry_pair_agrees_with_thurstone() {
        let bt = BradleyTerry { noise: 0.5 };
        let quality = [1.0, 0.0];
        let mut rng = Prng::new(7);
        let wins = (0..200_000)
            .filter(|_| bt.pick(&quality, &[0, 1], &mut rng) == 0)
            .count();
        let rate = wins as f64 / 200_000.0;
        assert!((rate - 0.921).abs() < 0.01, "{rate}");
    }

    #[test]
    fn quantile_bar_splits_truth_at_the_share() {
        let q: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let below = QuantileBar { share: 0.25 }.truly_below(&q);
        assert_eq!(below.iter().filter(|&&b| b).count(), 25);
        assert!(below[24] && !below[25]);
    }

    #[test]
    fn z_sigma_needs_the_full_gap() {
        let rule = ZSigma { z: 2.0 };
        let bar = at(15.0, 0.0, 100);
        assert_eq!(rule.side(Rating::new(10.0, 2.0), &bar), Some(true));
        assert_eq!(rule.side(Rating::new(20.0, 2.0), &bar), Some(false));
        assert_eq!(rule.side(Rating::new(12.0, 2.0), &bar), None);
    }

    fn at(score: f64, sigma: f64, scored: usize) -> Bar {
        Bar { score, sigma, scored }
    }

    #[test]
    fn warmup_waits_for_enough_scores() {
        let rule = Warmup { z: 2.0, min_scored: 25 };
        let r = Rating::new(10.0, 2.0);
        assert_eq!(rule.side(r, &at(15.0, 0.0, 24)), None);
        assert_eq!(rule.side(r, &at(15.0, 0.0, 25)), Some(true));
    }

    #[test]
    fn bar_sigma_widens_the_gap() {
        // σ 3, σ_bar 4 → spread 5, so z 2 needs a gap of 10.
        let rule = BarSigma { z: 2.0 };
        assert_eq!(rule.side(Rating::new(6.0, 3.0), &at(15.0, 4.0, 100)), None);
        assert_eq!(rule.side(Rating::new(5.0, 3.0), &at(15.0, 4.0, 100)), Some(true));
    }

    #[test]
    fn quantile_bar_reports_the_straddling_sigma() {
        let lib = Library {
            quality: vec![0.0; 5],
            ratings: (0..5).map(|i| Rating::new(i as f64, 1.0 + i as f64)).collect(),
            counts: vec![1, 1, 1, 1, 0],
            truly_below: vec![false; 5],
        };
        // 4 Scored, worst 50% → between μ 1 (σ 2) and μ 2 (σ 3).
        let bar = QuantileBar { share: 0.5 }.bar(&lib, &mut Vec::new());
        assert_eq!(bar.scored, 4);
        assert_eq!(bar.score, 1.5);
        assert!((bar.sigma - (6.5f64).sqrt()).abs() < 1e-12);
    }
}
