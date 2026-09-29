//! Pure ranking core: hand-rolled 1v1 TrueSkill and pair selection.
//!
//! The rating update is a port of python-trueskill 0.4.5's `rate_1vs1`
//! (including its default `erfc`/`erfcinv` backend, the τ-dynamics handling,
//! and its message-passing schedule) so results agree to well under 1e-7.
//! No I/O, no database, no Tauri types.

use std::f64::consts::{PI, SQRT_2};

pub const MU: f64 = 25.0;
pub const SIGMA: f64 = 8.333;
pub const BETA: f64 = 4.167;
pub const TAU: f64 = 0.083;

/// Convergence threshold of python-trueskill's factor-graph loop (`DELTA`).
const DELTA: f64 = 0.0001;

/// A wallpaper as the ranking seam sees it: identity plus current state.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WallpaperSummary {
    pub id: i64,
    pub rating_mu: f64,
    pub rating_sigma: f64,
    pub comparisons_count: u32,
    /// Kept rather than Active. Pair selection never draws a Kept wallpaper
    /// first once it has a Score (ADR 0060).
    pub kept: bool,
}

impl WallpaperSummary {
    pub(crate) fn rating(&self) -> Rating {
        Rating::new(self.rating_mu, self.rating_sigma)
    }

    /// At least one Comparison, which is what having a Score means.
    fn is_scored(&self) -> bool {
        self.comparisons_count > 0
    }

    pub(crate) fn decided(&self, bar: Option<f64>) -> Option<crate::bar::Side> {
        crate::bar::decided(self.rating(), self.comparisons_count, bar)
    }

    pub(crate) fn is_decided(&self, bar: Option<f64>) -> bool {
        self.decided(bar).is_some()
    }

    pub(crate) fn is_close_call(&self, bar: Option<f64>) -> bool {
        crate::bar::close_call(self.rating(), self.comparisons_count, bar)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rating {
    pub mu: f64,
    pub sigma: f64,
}

impl Rating {
    pub fn new(mu: f64, sigma: f64) -> Self {
        Self { mu, sigma }
    }
}

/// Injectable randomness so pair selection is deterministic under test.
///
/// Implementations must return uniformly distributed values in `[0, 1)`.
pub trait Rng {
    fn next_f64(&mut self) -> f64;
}

/// How many of the latest Comparisons keep their wallpapers from being drawn
/// first (ADR 0060).
pub const REPEAT_WINDOW: usize = 10;

/// What pair selection reads of the Comparison record. Derived from it on every
/// draw, never held as state (ADR 0060).
#[derive(Clone, Copy, Debug, Default)]
pub struct Recent<'a> {
    /// The latest Comparisons, newest first, at most [`REPEAT_WINDOW`] of them.
    pub pairs: &'a [[i64; 2]],
    /// Whether the latest Comparison was the first for either of its
    /// wallpapers.
    pub last_was_a_first: bool,
}

/// Picks a comparison pair from the Eligible pool (ADR 0060).
///
/// `exclude` is the pair on screen, kept out of both picks unless that leaves
/// fewer than two wallpapers, so a small library still ranks.
///
/// `apart` says whether two wallpapers are an unanswered Near-duplicate pair,
/// and no pair drawn is one. A wallpaper that could meet nothing else is
/// never drawn, and `exclude` also gives way when honouring it would leave no
/// pair that may meet.
///
/// First pick, in order:
/// 1. While fewer than half the pool has a Score, a random Unrated wallpaper,
///    Kept included.
/// 2. Past half, the same, unless the latest Comparison was the first for
///    either of its wallpapers. Then the pair holds no Unrated wallpaper, so
///    arrivals appear in at most every other pair.
/// 3. The least-compared Undecided wallpaper with a Score, random among ties,
///    leaving out Kept wallpapers and Close calls.
/// 4. When none is left, the least-compared wallpaper with a Score.
///
/// Steps 3 and 4 leave out the wallpapers in the last [`REPEAT_WINDOW`]
/// Comparisons, and the window shrinks one Comparison at a time until it
/// leaves something to draw.
///
/// The opponent is weighted toward a μ similar to the first pick's (Gaussian
/// weighting on |μ₁ − μ₂| / σ₁), falling back to uniform random when all
/// weights underflow. Decided and Kept wallpapers are opponents like any other,
/// but an Unrated first pick, or any pick under step 2, is given an opponent
/// with a Score whenever one is available. Returns `None` when the pool holds no
/// two wallpapers that may meet.
pub fn select_pair<'a, R: Rng>(
    pool: &'a [WallpaperSummary],
    bar: Option<f64>,
    recent: Recent<'_>,
    exclude: &[i64],
    apart: &dyn Fn(i64, i64) -> bool,
    rng: &mut R,
) -> Option<(&'a WallpaperSummary, &'a WallpaperSummary)> {
    let narrowed: Vec<&WallpaperSummary> =
        pool.iter().filter(|w| !exclude.contains(&w.id)).collect();
    let mut base = drawable(&narrowed, apart);
    if base.is_empty() {
        base = drawable(&pool.iter().collect::<Vec<_>>(), apart);
    }
    if base.is_empty() {
        return None;
    }

    let scored_count = pool.iter().filter(|w| w.is_scored()).count();
    let young = scored_count * 2 < pool.len();
    let capped = !young && recent.last_was_a_first;

    let (scored, unrated): (Vec<&WallpaperSummary>, Vec<&WallpaperSummary>) =
        base.iter().copied().partition(|w| w.is_scored());
    let first = if !unrated.is_empty() && !capped {
        pick_random(&unrated, rng)
    } else {
        let undecided: Vec<&WallpaperSummary> = scored
            .iter()
            .copied()
            .filter(|w| !w.kept && !w.is_decided(bar) && !w.is_close_call(bar))
            .collect();
        match least_compared_outside(&undecided, recent.pairs, rng)
            .or_else(|| least_compared_outside(&scored, recent.pairs, rng))
        {
            Some(first) => first,
            // Capped with nothing scored left to draw: an arrival after all,
            // rather than no pair.
            None => pick_random(&unrated, rng),
        }
    };

    let others: Vec<&WallpaperSummary> = base
        .iter()
        .copied()
        .filter(|w| w.id != first.id && !apart(first.id, w.id))
        .collect();
    let scored_others: Vec<&WallpaperSummary> =
        others.iter().copied().filter(|w| w.is_scored()).collect();
    let opponents = if (capped || !first.is_scored()) && !scored_others.is_empty() {
        scored_others
    } else {
        others
    };
    Some((first, weighted_by_mu(first, &opponents, rng)))
}

/// Those of `candidates` that may meet at least one of the others, so a pick
/// among them always leaves an opponent. Empty when no two of them may meet.
fn drawable<'a>(
    candidates: &[&'a WallpaperSummary],
    apart: &dyn Fn(i64, i64) -> bool,
) -> Vec<&'a WallpaperSummary> {
    candidates
        .iter()
        .copied()
        .filter(|w| {
            candidates
                .iter()
                .any(|o| o.id != w.id && !apart(w.id, o.id))
        })
        .collect()
}

/// The least-compared of `candidates`, random among ties, leaving out any in
/// the latest `pairs`. The window is the widest that still leaves one, so it
/// shrinks down to nothing rather than draw nothing. `None` only when
/// `candidates` is empty.
fn least_compared_outside<'a, R: Rng>(
    candidates: &[&'a WallpaperSummary],
    pairs: &[[i64; 2]],
    rng: &mut R,
) -> Option<&'a WallpaperSummary> {
    // How many Comparisons back each candidate was last shown, or the whole
    // window when it was not.
    let ages: Vec<usize> = candidates
        .iter()
        .map(|w| {
            pairs
                .iter()
                .take(REPEAT_WINDOW)
                .position(|p| p.contains(&w.id))
                .unwrap_or(REPEAT_WINDOW)
        })
        .collect();
    let window = *ages.iter().max()?;
    let outside = || {
        candidates
            .iter()
            .zip(&ages)
            .filter(move |(_, &age)| age >= window)
            .map(|(w, _)| *w)
    };
    let least = outside().map(|w| w.comparisons_count).min()?;
    let ties: Vec<&WallpaperSummary> = outside().filter(|w| w.comparisons_count == least).collect();
    Some(pick_random(&ties, rng))
}

fn weighted_by_mu<'a, R: Rng>(
    first: &WallpaperSummary,
    others: &[&'a WallpaperSummary],
    rng: &mut R,
) -> &'a WallpaperSummary {
    let scale = first.rating_sigma.abs().max(f64::MIN_POSITIVE);
    let weights: Vec<f64> = others
        .iter()
        .map(|w| {
            let z = (w.rating_mu - first.rating_mu) / scale;
            (-0.5 * z * z).exp()
        })
        .collect();
    let total: f64 = weights.iter().sum();

    if total > 0.0 && total.is_finite() {
        let mut r = rng.next_f64() * total;
        let mut chosen = others.len() - 1;
        for (i, weight) in weights.iter().enumerate() {
            r -= weight;
            // Strictly less-than: `r <= 0.0` would hand a draw of exactly 0.0 to
            // candidate 0 even when its weight underflowed to 0.
            if r < 0.0 {
                chosen = i;
                break;
            }
        }
        others[chosen]
    } else {
        // Weights underflowed entirely: uniform random within the pool.
        pick_random(others, rng)
    }
}

fn pick_random<'a, R: Rng>(items: &[&'a WallpaperSummary], rng: &mut R) -> &'a WallpaperSummary {
    let idx = (rng.next_f64() * items.len() as f64) as usize;
    items[idx.min(items.len() - 1)]
}

/// Applies a 1v1 win (no draws) exactly like python-trueskill's `rate_1vs1`
/// with μ=25, σ=8.333, β=4.167, τ=0.083.
pub fn rate_1vs1(winner: Rating, loser: Rating) -> (Rating, Rating) {
    let mut s_w = Var::default();
    let mut s_l = Var::default();
    let mut p_w = Var::default();
    let mut p_l = Var::default();
    let mut t_w = Var::default();
    let mut t_l = Var::default();
    let mut d = Var::default();

    prior_down(&mut s_w, winner.mu, winner.sigma);
    prior_down(&mut s_l, loser.mu, loser.sigma);
    lik_down(&mut s_w, &mut p_w);
    lik_down(&mut s_l, &mut p_l);
    team_perf_down(&mut t_w, &p_w);
    team_perf_down(&mut t_l, &p_l);

    for _ in 0..10 {
        diff_down(&mut d, &t_w, &t_l);
        if trunc_up(&mut d) <= DELTA {
            break;
        }
    }

    diff_up(0, &mut t_w, &mut t_l, &d);
    diff_up(1, &mut t_w, &mut t_l, &d);

    team_perf_up(&mut p_w, &t_w);
    team_perf_up(&mut p_l, &t_l);

    lik_up(&mut s_w, &p_w);
    lik_up(&mut s_l, &p_l);

    (s_w.value.rating(), s_l.value.rating())
}

// --- factor-graph schedule (mirrors trueskill/factorgraph.py) --------------

fn prior_down(v: &mut Var, mu: f64, sigma: f64) {
    // PriorFactor.down folds the dynamics factor (τ) into σ permanently.
    let pi = 1.0 / (sigma * sigma + TAU * TAU);
    update_value(v, Slot::Prior, G { pi, tau: pi * mu });
}

fn lik_down(mean: &mut Var, value: &mut Var) {
    let msg = mean.value.sub(mean.msg(Slot::Lik));
    let a = 1.0 / (1.0 + BETA * BETA * msg.pi);
    update_message(
        value,
        Slot::Lik,
        G {
            pi: a * msg.pi,
            tau: a * msg.tau,
        },
    );
}

fn team_perf_down(sum: &mut Var, term: &Var) {
    let div = term.value.sub(term.msg(Slot::Sum));
    send_sum_message(sum, Slot::Sum, &[div], &[1.0]);
}

fn lik_up(mean: &mut Var, value: &Var) {
    let msg = value.value.sub(value.msg(Slot::Lik));
    let a = 1.0 / (1.0 + BETA * BETA * msg.pi);
    update_message(
        mean,
        Slot::Lik,
        G {
            pi: a * msg.pi,
            tau: a * msg.tau,
        },
    );
}

fn team_perf_up(term: &mut Var, sum: &Var) {
    let div = sum.value.sub(sum.msg(Slot::Sum));
    send_sum_message(term, Slot::Sum, &[div], &[1.0]);
}

fn diff_down(diff: &mut Var, t_w: &Var, t_l: &Var) {
    let div_w = t_w.value.sub(t_w.msg(Slot::Diff));
    let div_l = t_l.value.sub(t_l.msg(Slot::Diff));
    send_sum_message(diff, Slot::Diff, &[div_w, div_l], &[1.0, -1.0]);
}

/// `SumFactor.up(index)` for the single diff factor (`coeffs [+1, -1]`).
///
/// Index 0 sends a message to the winner's team-perf variable, index 1 to the
/// loser's; both read back through the truncated diff distribution.
fn diff_up(index: usize, t_w: &mut Var, t_l: &mut Var, d: &Var) {
    if index == 0 {
        let div_d = d.value.sub(d.msg(Slot::Diff));
        let div_l = t_l.value.sub(t_l.msg(Slot::Diff));
        send_sum_message(t_w, Slot::Diff, &[div_d, div_l], &[1.0, 1.0]);
    } else {
        let div_w = t_w.value.sub(t_w.msg(Slot::Diff));
        let div_d = d.value.sub(d.msg(Slot::Diff));
        send_sum_message(t_l, Slot::Diff, &[div_w, div_d], &[1.0, -1.0]);
    }
}

fn trunc_up(d: &mut Var) -> f64 {
    let div = d.value.sub(d.msg(Slot::Trunc));
    let sqrt_pi = div.pi.sqrt();
    let margin = draw_margin() * sqrt_pi;
    let v = v_win(div.tau / sqrt_pi, margin);
    let w = w_win(div.tau / sqrt_pi, margin);
    let denom = 1.0 - w;
    update_value(
        d,
        Slot::Trunc,
        G {
            pi: div.pi / denom,
            tau: (div.tau + sqrt_pi * v) / denom,
        },
    )
}

fn send_sum_message(target: &mut Var, slot: Slot, divs: &[G], coeffs: &[f64]) {
    let mut mu_acc = 0.0;
    let mut pi_inv = 0.0;
    for (div, coeff) in divs.iter().zip(coeffs) {
        mu_acc += coeff * div.mu();
        pi_inv += coeff * coeff / div.pi;
    }
    let pi = 1.0 / pi_inv;
    update_message(
        target,
        slot,
        G {
            pi,
            tau: pi * mu_acc,
        },
    );
}

// --- Gaussian in precision form --------------------------------------------

#[derive(Clone, Copy, Default)]
struct G {
    pi: f64,
    tau: f64,
}

impl G {
    fn mu(self) -> f64 {
        if self.pi != 0.0 {
            self.tau / self.pi
        } else {
            0.0
        }
    }

    fn add(self, other: Self) -> Self {
        Self {
            pi: self.pi + other.pi,
            tau: self.tau + other.tau,
        }
    }

    fn sub(self, other: Self) -> Self {
        Self {
            pi: self.pi - other.pi,
            tau: self.tau - other.tau,
        }
    }

    fn delta(self, other: Self) -> f64 {
        let pi_delta = (self.pi - other.pi).abs();
        if pi_delta == f64::INFINITY {
            return 0.0;
        }
        ((self.tau - other.tau).abs()).max(pi_delta.sqrt())
    }

    fn rating(self) -> Rating {
        Rating {
            mu: self.mu(),
            sigma: 1.0 / self.pi.sqrt(),
        }
    }
}

#[derive(Clone, Copy)]
enum Slot {
    Prior,
    Lik,
    Sum,
    Diff,
    Trunc,
}

#[derive(Default)]
struct Var {
    value: G,
    msg_prior: G,
    msg_lik: G,
    msg_sum: G,
    msg_diff: G,
    msg_trunc: G,
}

impl Var {
    fn msg(&self, slot: Slot) -> G {
        match slot {
            Slot::Prior => self.msg_prior,
            Slot::Lik => self.msg_lik,
            Slot::Sum => self.msg_sum,
            Slot::Diff => self.msg_diff,
            Slot::Trunc => self.msg_trunc,
        }
    }

    fn set_msg(&mut self, slot: Slot, m: G) {
        match slot {
            Slot::Prior => self.msg_prior = m,
            Slot::Lik => self.msg_lik = m,
            Slot::Sum => self.msg_sum = m,
            Slot::Diff => self.msg_diff = m,
            Slot::Trunc => self.msg_trunc = m,
        }
    }
}

fn update_message(var: &mut Var, slot: Slot, m: G) {
    let old = var.msg(slot);
    var.set_msg(slot, m);
    var.value = var.value.sub(old).add(m);
}

fn update_value(var: &mut Var, slot: Slot, value: G) -> f64 {
    let old = var.msg(slot);
    var.set_msg(slot, value.add(old).sub(var.value));
    let delta = var.value.delta(value);
    var.value = value;
    delta
}

// --- python-trueskill default backend (backends.py) ------------------------

/// Draw margin for two players at draw_probability 0 — not exactly zero
/// because python-trueskill derives it through its own inverse-CDF.
fn draw_margin() -> f64 {
    ppf(0.5) * SQRT_2 * BETA
}

fn ppf(q: f64) -> f64 {
    -SQRT_2 * erfcinv(2.0 * q)
}

fn cdf(x: f64) -> f64 {
    0.5 * erfc(-x / SQRT_2)
}

fn pdf(x: f64) -> f64 {
    (-x * x / 2.0).exp() / (2.0 * PI).sqrt()
}

fn v_win(diff: f64, draw_margin: f64) -> f64 {
    let x = diff - draw_margin;
    let denom = cdf(x);
    if denom != 0.0 {
        pdf(x) / denom
    } else {
        -x
    }
}

fn w_win(diff: f64, draw_margin: f64) -> f64 {
    let x = diff - draw_margin;
    let v = v_win(diff, draw_margin);
    v * (v + x)
}

/// Complementary error function (Abramowitz & Stegun 7.1.26), matching
/// python-trueskill's default backend coefficient-for-coefficient.
#[allow(clippy::approx_constant)]
fn erfc(x: f64) -> f64 {
    let z = x.abs();
    let t = 1.0 / (1.0 + z / 2.0);
    let poly = -z * z - 1.26551223
        + t * (1.00002368
            + t * (0.37409196
                + t * (0.09678418
                    + t * (-0.18628806
                        + t * (0.27886807
                            + t * (-1.13520398
                                + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
    let r = t * poly.exp();
    if x < 0.0 {
        2.0 - r
    } else {
        r
    }
}

#[allow(clippy::approx_constant)]
fn erfcinv(y: f64) -> f64 {
    if y >= 2.0 {
        return -100.0;
    }
    if y <= 0.0 {
        return 100.0;
    }
    let zero_point = y < 1.0;
    let y = if zero_point { y } else { 2.0 - y };
    let t = (-2.0 * (y / 2.0).ln()).sqrt();
    let mut x = -0.70711 * ((2.30753 + t * 0.27061) / (1.0 + t * (0.99229 + t * 0.04481)) - t);
    for _ in 0..2 {
        let err = erfc(x) - y;
        x += err / (1.128_379_167_095_512_6 * (-(x * x)).exp() - x * err);
    }
    if zero_point {
        x
    } else {
        -x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rating(mu: f64, sigma: f64) -> Rating {
        Rating::new(mu, sigma)
    }

    /// Captured from python-trueskill 0.4.5 with the exact environment from
    /// rate-wallpaper's ranking.py (mu=25, sigma=8.333, beta=4.167, tau=0.083).
    #[test]
    fn rate_1vs1_matches_python_trueskill_vectors() {
        const TOL: f64 = 1e-7;
        type VectorCase = ((f64, f64), (f64, f64), (f64, f64), (f64, f64));
        let cases: &[VectorCase] = &[
            // (winner mu, sigma), (loser mu, sigma), new winner, new loser
            (
                (25.0, 8.333),
                (25.0, 8.333),
                (29.20520196791777, 7.194585101429668),
                (20.79479803208222, 7.194585101429668),
            ),
            (
                (30.0, 6.0),
                (20.0, 6.0),
                (31.044273787423258, 5.603013122943388),
                (18.955726212576746, 5.603013122943388),
            ),
            (
                (40.0, 3.0),
                (15.0, 9.0),
                (40.02660722977326, 2.99301722018304),
                (14.760697738271302, 8.778642523191143),
            ),
            (
                (10.0, 5.0),
                (35.0, 4.0),
                (19.094053525393033, 4.167441499215641),
                (29.178903847614755, 3.5884333002707085),
            ),
            (
                (27.12345, 7.777),
                (22.98765, 5.555),
                (30.24323989918895, 6.6757235177910665),
                (21.395746430033572, 5.16904567758889),
            ),
            (
                (50.0, 2.5),
                (48.0, 2.5),
                (50.56652765238239, 2.405383208306192),
                (47.43347234761761, 2.405383208306192),
            ),
            (
                (0.0, 12.0),
                (60.0, 1.0),
                (50.276309059387145, 5.757433649935688),
                (59.64847054954088, 1.0007344316886186),
            ),
            (
                (33.0, 8.333),
                (33.0, 3.0),
                (38.208350524435566, 6.505295037329737),
                (32.3244940672033, 2.924137607341263),
            ),
            (
                (25.0, 1.0),
                (24.0, 1.0),
                (25.115599474971397, 0.9951672223576333),
                (23.884400525028607, 0.9951672223576333),
            ),
        ];
        for &((wm, ws), (lm, ls), (ewm, ews), (elm, els)) in cases {
            let (w, l) = rate_1vs1(rating(wm, ws), rating(lm, ls));
            assert!((w.mu - ewm).abs() < TOL, "winner mu {} vs {ewm}", w.mu);
            assert!(
                (w.sigma - ews).abs() < TOL,
                "winner sigma {} vs {ews}",
                w.sigma
            );
            assert!((l.mu - elm).abs() < TOL, "loser mu {} vs {elm}", l.mu);
            assert!(
                (l.sigma - els).abs() < TOL,
                "loser sigma {} vs {els}",
                l.sigma
            );
        }
    }

    #[test]
    fn update_is_symmetric_and_shrinks_sigma() {
        let (w, l) = rate_1vs1(rating(25.0, SIGMA), rating(25.0, SIGMA));
        assert!((w.mu - (MU + 4.205)).abs() < 0.001);
        assert!((l.mu - (MU - 4.205)).abs() < 0.001);
        assert!(w.sigma < SIGMA && l.sigma < SIGMA);
        // A win must always raise the winner's μ and lower the loser's.
        let (w2, l2) = rate_1vs1(rating(10.0, 5.0), rating(35.0, 4.0));
        assert!(w2.mu > 10.0 && l2.mu < 35.0);
    }

    /// Returns a predetermined sequence so pair selection is fully
    /// deterministic under test.
    struct SeqRng {
        values: Vec<f64>,
        i: usize,
    }

    impl SeqRng {
        fn new(values: &[f64]) -> Self {
            Self {
                values: values.to_vec(),
                i: 0,
            }
        }
    }

    impl Rng for SeqRng {
        fn next_f64(&mut self) -> f64 {
            let v = self.values[self.i % self.values.len()];
            self.i += 1;
            v
        }
    }

    fn summary(id: i64, mu: f64, sigma: f64, count: u32) -> WallpaperSummary {
        WallpaperSummary {
            id,
            rating_mu: mu,
            rating_sigma: sigma,
            comparisons_count: count,
            kept: false,
        }
    }

    #[test]
    fn empty_and_single_candidate_pools_return_none() {
        let mut rng = SeqRng::new(&[0.5]);
        assert_eq!(
            select_pair(&[], None, Recent::default(), &[], &nothing_apart, &mut rng),
            None
        );
        let pool = [summary(1, MU, SIGMA, 0)];
        assert_eq!(
            select_pair(
                &pool,
                None,
                Recent::default(),
                &[],
                &nothing_apart,
                &mut rng
            ),
            None
        );
    }

    #[test]
    fn first_pick_is_least_compared_random_among_ties() {
        let pool = [
            summary(1, MU, SIGMA, 5),
            summary(2, MU, SIGMA, 3),
            summary(3, MU, SIGMA, 3),
        ];
        // 0.0 * 2 -> first tie member; 0.999 * 2 -> second tie member.
        let (first, _) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut SeqRng::new(&[0.0, 0.5]),
        )
        .unwrap();
        assert_eq!(first.id, 2);
        let (first, _) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut SeqRng::new(&[0.999, 0.5]),
        )
        .unwrap();
        assert_eq!(first.id, 3);
    }

    #[test]
    fn opponent_is_weighted_toward_similar_mu() {
        // Candidate 1 is by far the closest in μ to the least-compared pick.
        let pool = [
            summary(1, 25.01, SIGMA, 9),
            summary(2, MU, SIGMA, 3),
            summary(3, 90.0, SIGMA, 9),
        ];
        let mut rng = SeqRng::new(&[0.0, 0.0]);
        let (first, second) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut rng,
        )
        .unwrap();
        assert_eq!(first.id, 2);
        assert_eq!(second.id, 1);

        // Same inputs, same RNG values -> identical result.
        let mut rng = SeqRng::new(&[0.0, 0.0]);
        let again = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut rng,
        )
        .unwrap();
        assert_eq!((first.id, second.id), (again.0.id, again.1.id));
    }

    #[test]
    fn a_zero_weight_opponent_is_never_drawn_while_a_positive_one_exists() {
        // Candidate 1's weight underflows to exactly 0; candidate 3's is ~1.
        let pool = [
            summary(1, 100_000.0, SIGMA, 9),
            summary(2, MU, SIGMA, 3),
            summary(3, MU, SIGMA, 9),
        ];
        // A draw of exactly 0.0 is the boundary case: it must still skip the
        // zero-weight candidate rather than land on index 0.
        let (first, second) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut SeqRng::new(&[0.0]),
        )
        .unwrap();
        assert_eq!(first.id, 2);
        assert_eq!(second.id, 3);
    }

    #[test]
    fn opponent_falls_back_to_uniform_when_weights_underflow() {
        // |Δμ|/σ is enormous for every candidate: all weights underflow to 0.
        let pool = [
            summary(1, 10_000.0, 0.1, 9),
            summary(2, MU, 0.1, 3),
            summary(3, -10_000.0, 0.1, 9),
        ];
        // Uniform draw 0.9 over candidates [1, 3]: floor(0.9 * 2) = 1 -> id 3.
        let mut rng = SeqRng::new(&[0.0, 0.9]);
        let (first, second) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut rng,
        )
        .unwrap();
        assert_eq!(first.id, 2);
        assert_eq!(second.id, 3);

        // Draw 0.1 picks the other one; determinism holds either way.
        let mut rng = SeqRng::new(&[0.0, 0.1]);
        let (_, second) = select_pair(
            &pool,
            None,
            Recent::default(),
            &[],
            &nothing_apart,
            &mut rng,
        )
        .unwrap();
        assert_eq!(second.id, 1);
    }

    fn kept(id: i64, mu: f64, sigma: f64, count: u32) -> WallpaperSummary {
        WallpaperSummary {
            kept: true,
            ..summary(id, mu, sigma, count)
        }
    }

    /// Every draw a test sweeps: enough to land on each member of a small pool.
    const DRAWS: [f64; 7] = [0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 0.999];

    /// The pair for each draw in [`DRAWS`], as `(first, second)` ids.
    fn pairs_over_draws(
        pool: &[WallpaperSummary],
        bar: Option<f64>,
        recent: Recent<'_>,
        exclude: &[i64],
    ) -> Vec<(i64, i64)> {
        let mut out = Vec::new();
        for a in DRAWS {
            for b in DRAWS {
                let (first, second) = select_pair(
                    pool,
                    bar,
                    recent,
                    exclude,
                    &nothing_apart,
                    &mut SeqRng::new(&[a, b]),
                )
                .unwrap();
                out.push((first.id, second.id));
            }
        }
        out
    }

    const BAR: Option<f64> = Some(20.0);

    // Relative to a Bar of 20: far off it with σ 2 is Decided, near it with σ 1
    // is a Close call, near it with σ 5 is Undecided.
    fn decided(id: i64, count: u32) -> WallpaperSummary {
        summary(id, 40.0, 2.0, count)
    }
    fn close_call(id: i64, count: u32) -> WallpaperSummary {
        summary(id, 20.5, 1.0, count)
    }
    fn undecided(id: i64, count: u32) -> WallpaperSummary {
        summary(id, 22.0, 5.0, count)
    }

    #[test]
    fn a_decided_wallpaper_is_never_drawn_first_while_undecided_ones_remain() {
        let pool = [
            decided(1, 1),
            decided(2, 1),
            undecided(3, 8),
            undecided(4, 9),
        ];
        for (first, _) in pairs_over_draws(&pool, BAR, Recent::default(), &[]) {
            assert_eq!(first, 3, "the least-compared Undecided one");
        }
    }

    #[test]
    fn kept_wallpapers_and_close_calls_are_not_drawn_first_but_are_opponents() {
        let pool = [
            WallpaperSummary {
                kept: true,
                ..undecided(1, 1)
            },
            close_call(2, 1),
            undecided(3, 9),
        ];
        let pairs = pairs_over_draws(&pool, BAR, Recent::default(), &[]);
        assert!(pairs.iter().all(|&(first, _)| first == 3));
        let opponents: Vec<i64> = pairs.iter().map(|&(_, second)| second).collect();
        assert!(opponents.contains(&1) && opponents.contains(&2));
    }

    #[test]
    fn decided_wallpapers_are_opponents_too() {
        // Only one wallpaper to decide, so its opponent has to be a Decided one.
        let pool = [undecided(1, 3), decided(2, 40), decided(3, 5)];
        let opponents: Vec<i64> = pairs_over_draws(&pool, BAR, Recent::default(), &[])
            .into_iter()
            .map(|(first, second)| {
                assert_eq!(first, 1);
                second
            })
            .collect();
        assert!(opponents.contains(&3));
    }

    #[test]
    fn nothing_in_the_last_ten_comparisons_is_drawn_first() {
        // The least-compared Undecided wallpaper was in the tenth Comparison
        // back, so the next-least goes first.
        let pool = [undecided(1, 1), undecided(2, 2), undecided(3, 5)];
        let mut history = vec![[90, 91]; REPEAT_WINDOW];
        history[REPEAT_WINDOW - 1] = [1, 90];
        let recent = Recent {
            pairs: &history,
            last_was_a_first: false,
        };
        for (first, _) in pairs_over_draws(&pool, BAR, recent, &[]) {
            assert_eq!(first, 2);
        }

        // An eleventh Comparison back is outside the window.
        history.insert(0, [90, 91]);
        let recent = Recent {
            pairs: &history,
            last_was_a_first: false,
        };
        for (first, _) in pairs_over_draws(&pool, BAR, recent, &[]) {
            assert_eq!(first, 1);
        }
    }

    #[test]
    fn the_window_shrinks_in_a_three_wallpaper_library() {
        // Every wallpaper was in the last three Comparisons, so the window gives
        // way to the one shown longest ago.
        let pool = [undecided(1, 1), undecided(2, 5), undecided(3, 6)];
        let history = [[1, 2], [2, 1], [3, 1]];
        let recent = Recent {
            pairs: &history,
            last_was_a_first: false,
        };
        for (first, second) in pairs_over_draws(&pool, BAR, recent, &[]) {
            assert_eq!(first, 3);
            assert_ne!(second, 3);
        }

        // The pair on screen is the rest of the window, and gives way as well
        // rather than leave one wallpaper.
        for (first, second) in pairs_over_draws(&pool, BAR, recent, &[1, 2]) {
            assert_ne!(first, second);
        }
    }

    #[test]
    fn the_pair_on_screen_stays_out_of_both_picks() {
        let pool = [
            undecided(1, 1),
            undecided(2, 1),
            undecided(3, 4),
            undecided(4, 4),
        ];
        for (first, second) in pairs_over_draws(&pool, BAR, Recent::default(), &[1, 2]) {
            assert!(![first, second].contains(&1) && ![first, second].contains(&2));
        }
    }

    #[test]
    fn unrated_first_while_fewer_than_half_have_a_score_kept_included() {
        let pool = [
            undecided(1, 1),
            undecided(2, 1),
            kept(3, MU, SIGMA, 0),
            summary(4, MU, SIGMA, 0),
            summary(5, MU, SIGMA, 0),
        ];
        // Even straight after a first Comparison.
        let recent = Recent {
            pairs: &[[1, 2]],
            last_was_a_first: true,
        };
        let firsts: Vec<i64> = pairs_over_draws(&pool, BAR, recent, &[])
            .into_iter()
            .map(|(first, _)| first)
            .collect();
        assert!(firsts.iter().all(|id| [3, 4, 5].contains(id)));
        assert!(firsts.contains(&3), "a Kept arrival is drawn too");
    }

    #[test]
    fn two_unrated_are_never_paired_once_one_score_exists() {
        let pool = [
            summary(1, MU, SIGMA, 0),
            summary(2, MU, SIGMA, 0),
            summary(3, MU, SIGMA, 0),
            summary(4, 29.2, 7.2, 1),
        ];
        for (first, second) in pairs_over_draws(&pool, BAR, Recent::default(), &[]) {
            assert!(first == 4 || second == 4, "({first}, {second})");
        }
    }

    #[test]
    fn past_half_a_first_comparison_is_followed_by_a_pair_with_no_unrated() {
        let pool = [
            undecided(1, 1),
            undecided(2, 3),
            summary(3, MU, SIGMA, 0),
            summary(4, MU, SIGMA, 0),
        ];
        let after_a_first = Recent {
            pairs: &[[3, 9]],
            last_was_a_first: true,
        };
        for (first, second) in pairs_over_draws(&pool, BAR, after_a_first, &[]) {
            assert!([1, 2].contains(&first) && [1, 2].contains(&second));
        }

        // And the pair after that goes back to an arrival first.
        let after_that = Recent {
            pairs: &[[1, 2], [3, 9]],
            last_was_a_first: false,
        };
        for (first, second) in pairs_over_draws(&pool, BAR, after_that, &[]) {
            assert!([3, 4].contains(&first));
            assert!([1, 2].contains(&second));
        }
    }

    #[test]
    fn once_nothing_is_left_to_decide_the_least_compared_goes_first() {
        let pool = [
            decided(1, 6),
            close_call(2, 20),
            kept(3, 40.0, 2.0, 4),
            decided(4, 5),
        ];
        for (first, _) in pairs_over_draws(&pool, BAR, Recent::default(), &[]) {
            assert_eq!(first, 3);
        }
        // Under the same window.
        let recent = Recent {
            pairs: &[[3, 1]],
            last_was_a_first: false,
        };
        for (first, _) in pairs_over_draws(&pool, BAR, recent, &[]) {
            assert_eq!(first, 4);
        }
    }

    #[test]
    fn selection_stays_under_a_millisecond_at_ten_thousand() {
        // Deterministic spread of Scores, counts and Statuses.
        let pool: Vec<WallpaperSummary> = (0..10_000)
            .map(|i| WallpaperSummary {
                id: i,
                rating_mu: 10.0 + (i % 997) as f64 * 0.03,
                rating_sigma: 0.8 + (i % 13) as f64 * 0.5,
                comparisons_count: 1 + (i % 29) as u32,
                kept: i % 17 == 0,
            })
            .collect();
        let history: Vec<[i64; 2]> = (0..REPEAT_WINDOW as i64).map(|i| [i, i + 5000]).collect();
        let recent = Recent {
            pairs: &history,
            last_was_a_first: false,
        };
        let mut rng = SeqRng::new(&[0.1, 0.4, 0.7, 0.9]);
        let runs = 50;
        let start = std::time::Instant::now();
        for _ in 0..runs {
            std::hint::black_box(select_pair(
                &pool,
                Some(20.0),
                recent,
                &[1, 2],
                &nothing_apart,
                &mut rng,
            ));
        }
        let each = start.elapsed() / runs;
        // A debug build is several times slower than what ships, and a shared CI
        // runner slower again (10-11ms measured); the bound is for the release
        // build.
        let limit = if cfg!(debug_assertions) {
            std::time::Duration::from_millis(50)
        } else {
            std::time::Duration::from_millis(1)
        };
        assert!(each < limit, "{each:?} per selection");
    }

    /// No two wallpapers are an unanswered Near-duplicate pair.
    fn nothing_apart(_: i64, _: i64) -> bool {
        false
    }

    /// The `pairs` are the unanswered Near-duplicate pairs, each in either order.
    fn kept_apart(pairs: &[[i64; 2]]) -> impl Fn(i64, i64) -> bool + '_ {
        |a, b| pairs.contains(&[a, b]) || pairs.contains(&[b, a])
    }

    /// The pair for each draw in [`DRAWS`] when the `apart` pairs may not meet,
    /// every pair as its two ids lowest first.
    fn pairs_kept_apart(pool: &[WallpaperSummary], apart: &[[i64; 2]]) -> Vec<(i64, i64)> {
        let mut out = Vec::new();
        for a in DRAWS {
            for b in DRAWS {
                for c in DRAWS {
                    let (first, second) = select_pair(
                        pool,
                        None,
                        Recent::default(),
                        &[],
                        &kept_apart(apart),
                        &mut SeqRng::new(&[a, b, c]),
                    )
                    .unwrap();
                    out.push((first.id.min(second.id), first.id.max(second.id)));
                }
            }
        }
        out
    }

    #[test]
    fn a_pair_kept_apart_is_never_drawn_together() {
        let pool = [
            summary(1, MU, SIGMA, 0),
            summary(2, MU, SIGMA, 0),
            summary(3, MU, SIGMA, 0),
            summary(4, MU, SIGMA, 0),
        ];
        // Given highest id first, the same as lowest first.
        for apart in [[1, 2], [2, 1]] {
            for pair in pairs_kept_apart(&pool, &[apart]) {
                assert_ne!(pair, (1, 2));
            }
        }
    }

    #[test]
    fn each_wallpaper_of_a_pair_kept_apart_still_meets_the_others() {
        let pool = [
            summary(1, MU, SIGMA, 2),
            summary(2, MU, SIGMA, 2),
            summary(3, MU, SIGMA, 2),
            summary(4, MU, SIGMA, 2),
        ];
        let drawn = pairs_kept_apart(&pool, &[[1, 2]]);
        for pair in [(1, 3), (1, 4), (2, 3), (2, 4)] {
            assert!(drawn.contains(&pair), "{pair:?} never drawn in {drawn:?}");
        }
    }

    #[test]
    fn a_wallpaper_kept_apart_from_every_other_is_never_drawn() {
        // 1 may meet neither 2 nor 3, so drawing it first would leave it no
        // opponent: the pair is the one left, 2 and 3.
        let pool = [
            summary(1, MU, SIGMA, 0),
            summary(2, MU, SIGMA, 0),
            summary(3, MU, SIGMA, 0),
        ];
        for pair in pairs_kept_apart(&pool, &[[1, 2], [3, 1]]) {
            assert_eq!(pair, (2, 3));
        }
    }

    #[test]
    fn the_pair_on_screen_gives_way_rather_than_leave_only_a_pair_kept_apart() {
        // Leaving out 3 leaves 1 and 2, which may not meet, so the pair on
        // screen is drawn from again, the way it is in a two-wallpaper library.
        let pool = [
            summary(1, MU, SIGMA, 0),
            summary(2, MU, SIGMA, 0),
            summary(3, MU, SIGMA, 0),
        ];
        for a in DRAWS {
            for b in DRAWS {
                let (first, second) = select_pair(
                    &pool,
                    None,
                    Recent::default(),
                    &[3],
                    &kept_apart(&[[1, 2]]),
                    &mut SeqRng::new(&[a, b]),
                )
                .unwrap();
                assert!([first.id, second.id].contains(&3));
            }
        }
    }

    #[test]
    fn a_pool_that_is_only_a_pair_kept_apart_draws_nothing() {
        let pool = [summary(1, MU, SIGMA, 0), summary(2, MU, SIGMA, 0)];
        assert_eq!(
            select_pair(
                &pool,
                None,
                Recent::default(),
                &[],
                &kept_apart(&[[1, 2]]),
                &mut SeqRng::new(&[0.5])
            ),
            None
        );
    }

    #[test]
    fn a_capped_pair_with_nothing_scored_to_draw_still_draws_a_pair() {
        // Past half, straight after a first Comparison, but the only wallpaper
        // with a Score is on screen: an Unrated one goes first rather than none.
        let pool = [
            undecided(1, 1),
            undecided(2, 1),
            summary(3, MU, SIGMA, 0),
            summary(4, MU, SIGMA, 0),
        ];
        let recent = Recent {
            pairs: &[[1, 2]],
            last_was_a_first: true,
        };
        for (first, second) in pairs_over_draws(&pool, BAR, recent, &[1, 2]) {
            assert!([3, 4].contains(&first) && [3, 4].contains(&second));
        }
    }

    #[test]
    fn with_only_kept_wallpapers_undecided_the_least_compared_goes_first() {
        // Nothing is drawable under step 3, so step 4 draws, Kept included.
        let pool = [kept(1, 22.0, 5.0, 7), decided(2, 3), decided(3, 9)];
        for (first, _) in pairs_over_draws(&pool, BAR, Recent::default(), &[]) {
            assert_eq!(first, 2);
        }
    }
}
