//! Selectors. Add a new strategy here and name it in `by_name`.

use crate::prng::Prng;
use crate::ranking::{self, Rating};
use crate::sim::{Bar, DecidedRule, Library, Selector, SelectorStats};

pub fn by_name(name: &str) -> Option<Box<dyn Selector>> {
    match name {
        "baseline" => Some(Box::new(Baseline::default())),
        "random" => Some(Box::new(RandomPair)),
        _ => PairRule::parse(name).map(|r| Box::new(r) as Box<dyn Selector>),
    }
}

pub const NAMES: &[&str] = &[
    "baseline",
    "random",
    "<first>+<opponent>[/option...], e.g. straddle+bald/m=3 (see PairRule::parse)",
];

/// What the app does today: `voting::get_pair`. It runs `ranking::select_pair`
/// on the pool with the pair the curator just saw left out, unless that leaves
/// fewer than two.
#[derive(Default)]
pub struct Baseline {
    last: Vec<usize>,
}

impl Selector for Baseline {
    fn name(&self) -> String {
        "baseline (select_pair)".into()
    }
    fn select(&mut self, lib: &Library, _bar: &Bar, _: &dyn DecidedRule, rng: &mut Prng) -> Vec<usize> {
        let all = lib.summaries();
        let narrowed: Vec<_> = all
            .iter()
            .filter(|w| !self.last.contains(&(w.id as usize)))
            .copied()
            .collect();
        let pool = if narrowed.len() >= 2 { narrowed } else { all };
        let (a, b) = ranking::select_pair(&pool, rng).expect("pool of at least two");
        self.last = vec![a.id as usize, b.id as usize];
        self.last.clone()
    }
}

/// Two wallpapers uniformly at random: a reference point, not a proposal.
pub struct RandomPair;

impl Selector for RandomPair {
    fn name(&self) -> String {
        "random pair".into()
    }
    fn select(&mut self, lib: &Library, _bar: &Bar, _: &dyn DecidedRule, rng: &mut Prng) -> Vec<usize> {
        let n = lib.len();
        let a = rng.below(n);
        let mut b = rng.below(n - 1);
        if b >= a {
            b += 1;
        }
        vec![a, b]
    }
}

// --- Bar-aware pair rules (#370) --------------------------------------------

/// How the first wallpaper of a pair is chosen once every wallpaper has a
/// Score. Each is an index over the Undecided; the highest index goes first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum First {
    /// LSE straddle: kσ − |μ − Bar|.
    Straddle,
    /// APT: lowest (|μ − Bar| + ε)/σ.
    Apt(f64),
    /// LSA: lowest (α/4)·z² + ½·ln T, z = |μ − Bar|/σ, T its Comparisons,
    /// α = 1.35. LSA's T·Δ² is in [0, 1]-reward units, whose variance bound
    /// 1/4 makes σ ≈ 1/(2√T), so T·Δ² ≈ z²/4.
    Lsa,
    /// Least-compared among the Undecided.
    UndecidedLeast,
}

/// How the opponent is chosen for the first pick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Opp {
    /// Today's: weighted by exp(−½((μⱼ − μᵢ)/σᵢ)²).
    Mu,
    /// Highest BALD expected information gain of the pair.
    Bald,
    /// Highest expected drop in Σ max(0, kσ − |μ − Bar|) over both, one
    /// `rate_1vs1` per outcome, weighted by the predicted win probability.
    /// The Bar is held where it is.
    Lookahead,
}

/// Which wallpapers the opponent may come from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Pool {
    All,
    Undecided,
    /// Decided only ("anchors"), falling back to all when none is Decided.
    Anchors,
}

/// What the first pick is once no Undecided wallpaper is left to pick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fallback {
    /// Least-compared among all, random among ties.
    Least,
    /// Smallest |μ − Bar|/σ among all.
    Ratio,
}

/// How Unrated wallpapers (no Comparison yet) get their first Comparison.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum UnratedRule {
    /// Unrated first whenever one exists, random among them.
    Forced,
    /// No priority: an Unrated wallpaper (μ 25, σ 8.333, 0 Comparisons) is
    /// ranked by the same first-pick index as everyone else.
    Index,
    /// Unrated first, but no two pairs in a row may show an Unrated wallpaper.
    Share,
}

/// A Bar-aware pair rule. Unrated wallpapers are handled by `unrated`;
/// otherwise the `First` index among the Undecided goes first. An Unrated
/// first pick meets a wallpaper with a Score whenever one is open. The pair
/// just shown is never shown again straight away.
pub struct PairRule {
    pub first: First,
    pub opp: Opp,
    pub pool: Pool,
    pub unrated: UnratedRule,
    /// Let an Unrated first pick meet another Unrated even when a Scored
    /// wallpaper is open (off by default; for measuring what the rule costs).
    pub allow_uu: bool,
    /// Undecided is |μ − Bar| < kσ; straddle and lookahead use the same k.
    pub k: f64,
    /// The first pick may not be in any of the last `variety` pairs (1 = the
    /// pair just shown, as today).
    pub variety: usize,
    /// Sample the first pick uniformly from the `top` best by index (1 = argmax).
    pub top: usize,
    /// Leave out of the first pick any Undecided wallpaper with σ below this.
    pub stop: Option<f64>,
    pub fallback: Fallback,
    recent: std::collections::VecDeque<[usize; 2]>,
    last_had_unrated: bool,
    stats: SelectorStats,
    votes: u64,
}

impl PairRule {
    pub fn new(first: First, opp: Opp) -> Self {
        Self {
            first,
            opp,
            pool: Pool::All,
            unrated: UnratedRule::Forced,
            allow_uu: false,
            last_had_unrated: false,
            k: 2.5,
            variety: 1,
            top: 1,
            stop: None,
            fallback: Fallback::Least,
            recent: Default::default(),
            stats: Default::default(),
            votes: 0,
        }
    }

    /// `<first>+<opponent>` then any of `/pool=all|und|anchor`, `/m=<pairs>`,
    /// `/top=<n>`, `/stop=<σ>`, `/fb=least|ratio`, `/k=<k>`,
    /// `/u=forced|index|share`, `/uu=allow`.
    /// First: `straddle`, `apt<ε>` (e.g. `apt0.5`), `lsa`, `uleast`.
    /// Opponent: `mu`, `bald`, `look`.
    pub fn parse(name: &str) -> Option<Self> {
        let mut parts = name.split('/');
        let (f, o) = parts.next()?.split_once('+')?;
        let first = match f {
            "straddle" => First::Straddle,
            "lsa" => First::Lsa,
            "uleast" => First::UndecidedLeast,
            _ => First::Apt(f.strip_prefix("apt")?.parse().ok()?),
        };
        let opp = match o {
            "mu" => Opp::Mu,
            "bald" => Opp::Bald,
            "look" => Opp::Lookahead,
            _ => return None,
        };
        let mut r = Self::new(first, opp);
        for opt in parts {
            let (key, val) = opt.split_once('=')?;
            match key {
                "pool" => {
                    r.pool = match val {
                        "all" => Pool::All,
                        "und" => Pool::Undecided,
                        "anchor" => Pool::Anchors,
                        _ => return None,
                    }
                }
                "m" => r.variety = val.parse().ok().filter(|&m| m >= 1)?,
                "top" => r.top = val.parse().ok().filter(|&t| t >= 1)?,
                "stop" => r.stop = Some(val.parse().ok()?),
                "fb" => {
                    r.fallback = match val {
                        "least" => Fallback::Least,
                        "ratio" => Fallback::Ratio,
                        _ => return None,
                    }
                }
                "k" => r.k = val.parse().ok()?,
                "u" => {
                    r.unrated = match val {
                        "forced" => UnratedRule::Forced,
                        "index" => UnratedRule::Index,
                        "share" => UnratedRule::Share,
                        _ => return None,
                    }
                }
                "uu" if val == "allow" => r.allow_uu = true,
                _ => return None,
            }
        }
        Some(r)
    }

    fn undecided(&self, r: Rating, count: u32, bar: &Bar) -> bool {
        count == 0 || (r.mu - bar.score).abs() < self.k * r.sigma
    }

    /// Higher goes first.
    fn index(&self, r: Rating, count: u32, bar: &Bar) -> f64 {
        let gap = (r.mu - bar.score).abs();
        match self.first {
            First::Straddle => self.k * r.sigma - gap,
            First::Apt(eps) => -(gap + eps) / r.sigma,
            First::Lsa => {
                let z = gap / r.sigma;
                -(1.35 / 4.0 * z * z + 0.5 * (count.max(1) as f64).ln())
            }
            First::UndecidedLeast => -(count as f64),
        }
    }

    /// max(0, kσ − |μ − Bar|): how far a wallpaper is from Decided.
    fn ambiguity(&self, r: Rating, bar: &Bar) -> f64 {
        (self.k * r.sigma - (r.mu - bar.score).abs()).max(0.0)
    }

    fn opponent_score(&self, a: Rating, b: Rating, bar: &Bar) -> f64 {
        match self.opp {
            Opp::Mu => unreachable!("a weighted draw, not a score"),
            Opp::Bald => bald_bits(a, b),
            Opp::Lookahead => {
                let before = self.ambiguity(a, bar) + self.ambiguity(b, bar);
                let p = p_win(a, b);
                let (aw, bl) = ranking::rate_1vs1(a, b);
                let (bw, al) = ranking::rate_1vs1(b, a);
                let after = p * (self.ambiguity(aw, bar) + self.ambiguity(bl, bar))
                    + (1.0 - p) * (self.ambiguity(al, bar) + self.ambiguity(bw, bar));
                before - after
            }
        }
    }
}

/// Argmax over `(score, index)` with uniform tie-breaking.
fn argmax(items: impl Iterator<Item = (f64, usize)>, rng: &mut Prng) -> Option<usize> {
    let mut best = f64::NEG_INFINITY;
    let mut pick = None;
    let mut ties = 0usize;
    for (s, i) in items {
        if s > best || pick.is_none() {
            best = s;
            pick = Some(i);
            ties = 1;
        } else if s == best {
            ties += 1;
            if rng.below(ties) == 0 {
                pick = Some(i);
            }
        }
    }
    pick
}

impl Selector for PairRule {
    fn name(&self) -> String {
        let first = match self.first {
            First::Straddle => "straddle".to_string(),
            First::Apt(e) => format!("apt ε={e}"),
            First::Lsa => "lsa".into(),
            First::UndecidedLeast => "undecided-least".into(),
        };
        let opp = match self.opp {
            Opp::Mu => "μ-proximity",
            Opp::Bald => "BALD",
            Opp::Lookahead => "lookahead",
        };
        let mut s = format!("{first} + {opp}");
        match self.pool {
            Pool::All => {}
            Pool::Undecided => s += ", opponents Undecided",
            Pool::Anchors => s += ", opponents Decided",
        }
        if self.variety != 1 {
            s += &format!(", m={}", self.variety);
        }
        if self.top != 1 {
            s += &format!(", top-{}", self.top);
        }
        if let Some(st) = self.stop {
            s += &format!(", stop σ<{st}");
        }
        if self.fallback == Fallback::Ratio {
            s += ", fallback smallest gap/σ";
        }
        match self.unrated {
            UnratedRule::Forced => {}
            UnratedRule::Index => s += ", Unrated by index",
            UnratedRule::Share => s += ", Unrated every other pair",
        }
        if self.allow_uu {
            s += ", Unrated may meet Unrated";
        }
        if self.k != 2.5 {
            s += &format!(", k={}", self.k);
        }
        s
    }

    fn stats(&self) -> SelectorStats {
        self.stats
    }

    fn select(&mut self, lib: &Library, bar: &Bar, _: &dyn DecidedRule, rng: &mut Prng) -> Vec<usize> {
        self.votes += 1;
        let n = lib.len();
        let last: [usize; 2] = self.recent.back().copied().unwrap_or([usize::MAX; 2]);
        let shown_last = |i: usize| last.contains(&i);
        let recent = &self.recent;
        let recent_m = |i: usize, m: usize| recent.iter().rev().take(m).any(|p| p.contains(&i));

        let unrated: Vec<usize> = (0..n).filter(|&i| lib.counts[i] == 0 && !shown_last(i)).collect();
        // Share: no Unrated wallpaper in two pairs running.
        let block = self.unrated == UnratedRule::Share && self.last_had_unrated;
        let scored_ok = |i: usize| !block || lib.counts[i] > 0;
        let unrated_first = match self.unrated {
            UnratedRule::Forced => !unrated.is_empty(),
            UnratedRule::Share => !block && !unrated.is_empty(),
            UnratedRule::Index => false,
        };
        let mut fell_back = false;
        let first = if unrated_first {
            unrated[rng.below(unrated.len())]
        } else {
            let mut pick = None;
            // Relax the variety rule to the pair just shown if it leaves nothing.
            for m in [self.variety, 1] {
                let mut cands: Vec<(f64, usize)> = (0..n)
                    .filter(|&i| !recent_m(i, m) && scored_ok(i))
                    .filter(|&i| self.undecided(lib.ratings[i], lib.counts[i], bar))
                    .filter(|&i| self.stop.map_or(true, |s| lib.ratings[i].sigma >= s))
                    .map(|i| (self.index(lib.ratings[i], lib.counts[i], bar), i))
                    .collect();
                if cands.is_empty() {
                    continue;
                }
                pick = if self.top <= 1 {
                    argmax(cands.into_iter(), rng)
                } else if cands.len() <= self.top {
                    Some(cands[rng.below(cands.len())].1)
                } else {
                    let t = self.top;
                    cands.select_nth_unstable_by(t - 1, |a, b| b.0.total_cmp(&a.0));
                    Some(cands[rng.below(t)].1)
                };
                break;
            }
            match pick {
                Some(p) => p,
                None if block && !(0..n).any(|i| !shown_last(i) && lib.counts[i] > 0) => {
                    // Nothing with a Score is open: Share has to show an Unrated.
                    unrated[rng.below(unrated.len())]
                }
                None => {
                    fell_back = true;
                    let pool = (0..n).filter(|&i| !shown_last(i) && scored_ok(i));
                    match self.fallback {
                        Fallback::Least => argmax(pool.map(|i| (-(lib.counts[i] as f64), i)), rng),
                        Fallback::Ratio => argmax(
                            pool.map(|i| {
                                let r = lib.ratings[i];
                                (-(r.mu - bar.score).abs() / r.sigma, i)
                            }),
                            rng,
                        ),
                    }
                    .expect("a pool of at least four")
                }
            }
        };
        if fell_back {
            self.stats.fallback_votes += 1;
            self.stats.first_fallback.get_or_insert(self.votes);
        }

        // An Unrated first pick meets a Score whenever one is open, and Share
        // keeps Unrated out of a pair that follows one with an Unrated.
        let scored_only = block || (lib.counts[first] == 0 && !self.allow_uu);
        let has_scored = (0..n).any(|j| j != first && !shown_last(j) && lib.counts[j] > 0);
        let need_score = scored_only && has_scored;
        let open = |j: usize| j != first && !shown_last(j) && (!need_score || lib.counts[j] > 0);
        let filtered: Vec<usize> = (0..n)
            .filter(|&j| open(j))
            .filter(|&j| match self.pool {
                Pool::All => true,
                Pool::Undecided => self.undecided(lib.ratings[j], lib.counts[j], bar),
                Pool::Anchors => !self.undecided(lib.ratings[j], lib.counts[j], bar),
            })
            .collect();
        let others = if filtered.is_empty() {
            (0..n).filter(|&j| open(j)).collect()
        } else {
            filtered
        };
        let a = lib.ratings[first];
        let second = match self.opp {
            Opp::Mu => {
                let scale = a.sigma.abs().max(f64::MIN_POSITIVE);
                let w: Vec<f64> = others
                    .iter()
                    .map(|&j| {
                        let z = (lib.ratings[j].mu - a.mu) / scale;
                        (-0.5 * z * z).exp()
                    })
                    .collect();
                let total: f64 = w.iter().sum();
                if total > 0.0 && total.is_finite() {
                    let mut r = rng.uniform() * total;
                    let mut chosen = others.len() - 1;
                    for (k, wk) in w.iter().enumerate() {
                        r -= wk;
                        if r < 0.0 {
                            chosen = k;
                            break;
                        }
                    }
                    others[chosen]
                } else {
                    others[rng.below(others.len())]
                }
            }
            _ => argmax(
                others.iter().map(|&j| (self.opponent_score(a, lib.ratings[j], bar), j)),
                rng,
            )
            .expect("an opponent"),
        };
        let pair = [first, second];
        self.last_had_unrated = lib.counts[first] == 0 || lib.counts[second] == 0;
        self.recent.push_back(pair);
        while self.recent.len() > self.variety {
            self.recent.pop_front();
        }
        pair.to_vec()
    }
}

/// P(a beats b) as TrueSkill predicts it: Φ((μa − μb)/c), c² = 2β² + σa² + σb².
pub fn p_win(a: Rating, b: Rating) -> f64 {
    let c = (2.0 * ranking::BETA * ranking::BETA + a.sigma * a.sigma + b.sigma * b.sigma).sqrt();
    phi((a.mu - b.mu) / c)
}

/// BALD's closed-form expected information gain (bits) of one Comparison,
/// from the probit model P(a beats b | s) = Φ((sa − sb)/(√2β)):
/// h(Φ(m/√(v+1))) − C/√(v+C²)·exp(−m²/(2(v+C²))), C² = π ln 2 / 2,
/// m = (μa − μb)/(√2β), v = (σa² + σb²)/(2β²).
pub fn bald_bits(a: Rating, b: Rating) -> f64 {
    let two_b2 = 2.0 * ranking::BETA * ranking::BETA;
    let m = (a.mu - b.mu) / two_b2.sqrt();
    let v = (a.sigma * a.sigma + b.sigma * b.sigma) / two_b2;
    let p = phi(m / (v + 1.0).sqrt());
    let h = |p: f64| {
        if p <= 0.0 || p >= 1.0 {
            0.0
        } else {
            -(p * p.log2() + (1.0 - p) * (1.0 - p).log2())
        }
    };
    let c2 = std::f64::consts::PI * std::f64::consts::LN_2 / 2.0;
    h(p) - (c2 / (v + c2)).sqrt() * (-m * m / (2.0 * (v + c2))).exp()
}

/// Standard normal CDF.
pub fn phi(x: f64) -> f64 {
    0.5 * erfc(-x / std::f64::consts::SQRT_2)
}

/// Complementary error function (Numerical Recipes' erfcc, |rel err| < 1.2e-7).
fn erfc(x: f64) -> f64 {
    let z = x.abs();
    let t = 1.0 / (1.0 + 0.5 * z);
    let poly = -z * z - 1.265_512_23
        + t * (1.000_023_68
            + t * (0.374_091_96
                + t * (0.096_784_18
                    + t * (-0.186_288_06
                        + t * (0.278_868_07
                            + t * (-1.135_203_98
                                + t * (1.488_515_87 + t * (-0.822_152_23 + t * 0.170_872_77))))))));
    let r = t * poly.exp();
    if x >= 0.0 {
        r
    } else {
        2.0 - r
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::ZSigma;

    #[test]
    fn bald_matches_the_research_table() {
        let r = |mu: f64, s: f64| Rating::new(mu, s);
        // (Δμ, σᵢ, σⱼ, BALD EIG) from docs/research/active-threshold-ranking.md.
        for (d, si, sj, want) in [
            (0.0, 8.333, 8.333, 0.5374),
            (0.0, 8.333, 1.0, 0.4090),
            (0.0, 2.0, 2.0, 0.0915),
            (5.0, 8.333, 8.333, 0.5050),
            (10.0, 4.0, 4.0, 0.1417),
        ] {
            let got = bald_bits(r(25.0 + d, si), r(25.0, sj));
            assert!((got - want).abs() < 0.001, "{d} {si} {sj}: {got}");
        }
    }

    #[test]
    fn phi_is_the_normal_cdf() {
        assert!((phi(0.0) - 0.5).abs() < 1e-7);
        assert!((phi(1.959964) - 0.975).abs() < 1e-6);
        assert!((phi(-1.0) - 0.158_655_25).abs() < 1e-6);
    }

    #[test]
    fn parse_names() {
        let r = PairRule::parse("apt0.5+look/pool=anchor/m=3/stop=1.5/fb=ratio/top=8").unwrap();
        assert_eq!(r.first, First::Apt(0.5));
        assert_eq!(r.opp, Opp::Lookahead);
        assert_eq!(r.pool, Pool::Anchors);
        assert_eq!((r.variety, r.top, r.stop, r.fallback), (3, 8, Some(1.5), Fallback::Ratio));
        assert!(PairRule::parse("straddle+nope").is_none());
        assert!(PairRule::parse("straddle+mu/m=0").is_none());
    }

    fn lib(ratings: Vec<Rating>, counts: Vec<u32>) -> Library {
        let n = ratings.len();
        Library {
            quality: vec![0.0; n],
            ratings,
            counts,
            truly_below: vec![false; n],
        }
    }

    #[test]
    fn unrated_goes_first_and_the_last_pair_is_left_out() {
        let bar = Bar { score: 25.0, sigma: 1.0, scored: 4 };
        let mut l = lib(
            vec![
                Rating::new(25.0, 3.0),
                Rating::new(24.0, 3.0),
                Rating::new(30.0, 1.0),
                Rating::new(25.0, 8.333),
                Rating::new(26.0, 3.0),
            ],
            vec![5, 5, 5, 0, 5],
        );
        let mut s = PairRule::parse("straddle+bald").unwrap();
        let mut rng = Prng::new(1);
        let rule = ZSigma { z: 2.5 };
        let p = s.select(&l, &bar, &rule, &mut rng);
        assert_eq!(p[0], 3);
        l.counts[3] = 1;
        let q = s.select(&l, &bar, &rule, &mut rng);
        assert!(!q.contains(&3) && !q.contains(&p[1]), "{p:?} then {q:?}");
    }

    #[test]
    fn an_unrated_first_pick_meets_a_score_and_share_skips_a_pair() {
        let bar = Bar { score: 25.0, sigma: 1.0, scored: 3 };
        // Three Scored, three Unrated; BALD alone would pair two Unrated.
        let mut ratings = vec![Rating::new(25.0, 2.0), Rating::new(30.0, 2.0), Rating::new(20.0, 2.0)];
        ratings.extend([Rating::new(25.0, 8.333); 3]);
        let mut l = lib(ratings, vec![4, 4, 4, 0, 0, 0]);
        let rule = ZSigma { z: 2.5 };
        let mut rng = Prng::new(5);
        let mut s = PairRule::parse("uleast+bald/u=share").unwrap();
        let p = s.select(&l, &bar, &rule, &mut rng);
        assert!(p[0] >= 3 && p[1] < 3, "{p:?}");
        for &i in &p {
            l.counts[i] += 1;
        }
        let q = s.select(&l, &bar, &rule, &mut rng);
        assert!(q.iter().all(|&i| l.counts[i] > 0), "share let an Unrated in: {q:?}");
        l.counts = vec![4, 4, 4, 0, 0, 0];
        let mut u = PairRule::parse("uleast+bald/uu=allow").unwrap();
        let r = u.select(&l, &bar, &rule, &mut rng);
        assert!(r.iter().all(|&i| l.counts[i] == 0), "BALD prefers two Unrated: {r:?}");
    }

    #[test]
    fn straddle_takes_the_widest_undecided_and_falls_back_when_none() {
        let bar = Bar { score: 25.0, sigma: 1.0, scored: 5 };
        let l = lib(
            vec![
                Rating::new(25.0, 1.0), // straddle 2.5
                Rating::new(26.0, 3.0), // straddle 6.5
                Rating::new(40.0, 1.0), // Decided
                Rating::new(10.0, 1.0), // Decided
                Rating::new(45.0, 1.0), // Decided
            ],
            vec![5; 5],
        );
        let rule = ZSigma { z: 2.5 };
        let mut s = PairRule::parse("straddle+mu").unwrap();
        assert_eq!(s.select(&l, &bar, &rule, &mut Prng::new(1))[0], 1);
        let mut s = PairRule::parse("straddle+mu/stop=5").unwrap();
        s.select(&l, &bar, &rule, &mut Prng::new(1));
        assert_eq!(s.stats().fallback_votes, 1);
    }

    #[test]
    fn lookahead_prefers_an_opponent_that_helps_both_sides_of_the_bar() {
        // First pick sits on the Bar; opponents: a Decided anchor far above,
        // and an Undecided one near the Bar. Both should score above zero and
        // the scores must be finite.
        let bar = Bar { score: 25.0, sigma: 1.0, scored: 5 };
        let s = PairRule::parse("straddle+look").unwrap();
        let a = Rating::new(25.0, 3.0);
        for b in [Rating::new(45.0, 1.5), Rating::new(26.0, 3.0)] {
            let v = s.opponent_score(a, b, &bar);
            assert!(v.is_finite() && v > 0.0, "{v}");
        }
    }
}
