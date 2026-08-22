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

/// Picks a comparison pair from the eligible pool.
///
/// First pick: least `comparisons_count`, random among ties. Second pick:
/// opponent weighted toward a μ similar to the first pick's (Gaussian
/// weighting on |μ₁ − μ₂| / σ₁), falling back to uniform random when all
/// weights underflow. Returns `None` for pools with fewer than two entries.
pub fn select_pair<'a, R: Rng>(
    pool: &'a [WallpaperSummary],
    rng: &mut R,
) -> Option<(&'a WallpaperSummary, &'a WallpaperSummary)> {
    if pool.len() < 2 {
        return None;
    }
    let least = pool.iter().map(|w| w.comparisons_count).min()?;
    let ties: Vec<&WallpaperSummary> = pool
        .iter()
        .filter(|w| w.comparisons_count == least)
        .collect();
    let first = pick_random(&ties, rng);

    let others: Vec<&WallpaperSummary> = pool.iter().filter(|w| w.id != first.id).collect();
    let scale = first.rating_sigma.abs().max(f64::MIN_POSITIVE);
    let weights: Vec<f64> = others
        .iter()
        .map(|w| {
            let z = (w.rating_mu - first.rating_mu) / scale;
            (-0.5 * z * z).exp()
        })
        .collect();
    let total: f64 = weights.iter().sum();

    let second = if total > 0.0 && total.is_finite() {
        let mut r = rng.next_f64() * total;
        let mut chosen = others.len() - 1;
        for (i, weight) in weights.iter().enumerate() {
            r -= weight;
            if r <= 0.0 {
                chosen = i;
                break;
            }
        }
        others[chosen]
    } else {
        // Weights underflowed entirely: uniform random within the pool.
        pick_random(&others, rng)
    };
    Some((first, second))
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
        }
    }

    #[test]
    fn empty_and_single_candidate_pools_return_none() {
        let mut rng = SeqRng::new(&[0.5]);
        assert_eq!(select_pair(&[], &mut rng), None);
        let pool = [summary(1, MU, SIGMA, 0)];
        assert_eq!(select_pair(&pool, &mut rng), None);
    }

    #[test]
    fn first_pick_is_least_compared_random_among_ties() {
        let pool = [
            summary(1, MU, SIGMA, 5),
            summary(2, MU, SIGMA, 3),
            summary(3, MU, SIGMA, 3),
        ];
        // 0.0 * 2 -> first tie member; 0.999 * 2 -> second tie member.
        let (first, _) = select_pair(&pool, &mut SeqRng::new(&[0.0, 0.5])).unwrap();
        assert_eq!(first.id, 2);
        let (first, _) = select_pair(&pool, &mut SeqRng::new(&[0.999, 0.5])).unwrap();
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
        let (first, second) = select_pair(&pool, &mut rng).unwrap();
        assert_eq!(first.id, 2);
        assert_eq!(second.id, 1);

        // Same inputs, same RNG values -> identical result.
        let mut rng = SeqRng::new(&[0.0, 0.0]);
        let again = select_pair(&pool, &mut rng).unwrap();
        assert_eq!((first.id, second.id), (again.0.id, again.1.id));
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
        let (first, second) = select_pair(&pool, &mut rng).unwrap();
        assert_eq!(first.id, 2);
        assert_eq!(second.id, 3);

        // Draw 0.1 picks the other one; determinism holds either way.
        let mut rng = SeqRng::new(&[0.0, 0.1]);
        let (_, second) = select_pair(&pool, &mut rng).unwrap();
        assert_eq!(second.id, 1);
    }
}
