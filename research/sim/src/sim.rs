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

/// Chooses what the curator is shown next. Two indices for a pair, more for
/// a best-of-N pick. `bar` is the current Bar, for selectors that aim at it.
pub trait Selector {
    fn name(&self) -> String;
    fn select(&mut self, lib: &Library, bar: f64, decided: &dyn DecidedRule, rng: &mut Prng)
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
    /// The Bar, as a Score, given the current Ratings.
    fn bar(&self, lib: &Library, scratch: &mut Vec<f64>) -> f64;
    /// Which wallpapers truly belong below the Bar.
    fn truly_below(&self, quality: &[f64]) -> Vec<bool>;
}

pub trait DecidedRule: Sync {
    fn name(&self) -> String;
    /// `Some(true)` Decided below, `Some(false)` Decided above, `None` Undecided.
    fn side(&self, rating: Rating, bar: f64) -> Option<bool>;
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

/// The Bar sits at a fixed share of the pool: the curator would clear out the
/// bottom `share`. In Score space it is that quantile of current μ; the truth
/// is the same quantile of true quality.
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
        format!("bottom {}%", self.share * 100.0)
    }
    fn bar(&self, lib: &Library, scratch: &mut Vec<f64>) -> f64 {
        // Midway between the last wallpaper below and the first above.
        scratch.clear();
        scratch.extend(lib.ratings.iter().map(|r| r.mu));
        let k = self.rank(scratch.len());
        let (_, &mut above, _) = scratch.select_nth_unstable_by(k, f64::total_cmp);
        let below = scratch[..k]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        (below + above) / 2.0
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
    fn side(&self, rating: Rating, bar: f64) -> Option<bool> {
        let gap = rating.mu - bar;
        if gap.abs() >= self.z * rating.sigma {
            Some(gap < 0.0)
        } else {
            None
        }
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

pub fn run(
    n: usize,
    selector: &mut dyn Selector,
    parts: &Parts,
    max_judgements: usize,
    checkpoint_every: usize,
    rng: &mut Prng,
) -> Vec<Checkpoint> {
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
    out.push(measure(&lib, bar, parts.decided, 0, 0));
    for j in 1..=max_judgements {
        let shown = selector.select(&lib, bar, parts.decided, rng);
        let winner = parts.voter.pick(&lib.quality, &shown, rng);
        parts.updater.apply(&mut lib, &shown, winner);
        comparisons += shown.len() - 1;
        bar = parts.bar.bar(&lib, &mut scratch);
        if j % checkpoint_every == 0 || j == max_judgements {
            out.push(measure(&lib, bar, parts.decided, j, comparisons));
        }
    }
    out
}

fn measure(lib: &Library, bar: f64, rule: &dyn DecidedRule, j: usize, c: usize) -> Checkpoint {
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
        assert_eq!(rule.side(Rating::new(10.0, 2.0), 15.0), Some(true));
        assert_eq!(rule.side(Rating::new(20.0, 2.0), 15.0), Some(false));
        assert_eq!(rule.side(Rating::new(12.0, 2.0), 15.0), None);
    }
}
