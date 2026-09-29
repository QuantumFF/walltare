//! Best-of-N studies for #373: `walltare-sim group <runs|arrival>`.
//! Results in `results/best-of-four.md`.
//!
//! A showing puts `members` wallpapers on screen: 2 for a pair, 4 for a group.
//! The first pick follows ADR 0060 (least-compared Undecided, Close calls and
//! the last `window` showings left out, the arrival cap); the other members
//! are drawn one at a time, without replacement, by the same μ-proximity
//! weighting relative to the first pick, from every wallpaper except the
//! showing on screen. The curator perceives every member once (one noisy
//! performance each) and picks the best, and for best+worst also the worst.
//!
//! A judgement becomes Rating changes either by one joint EP update over the
//! performances (one truncation per implied relation, as
//! `docs/research/best-of-n-judgements/bestofn.py` on
//! `research/best-of-n-judgements`) or by one `rate_1vs1` per implied
//! relation in turn. A pair always uses `rate_1vs1`, which the joint update
//! reproduces (see the tests).

use std::collections::VecDeque;

use crate::prng::Prng;
use crate::ranking::{self, Rating};
use crate::selectors::phi;
use crate::sim::{self, Bar, BarRule, DecidedRule, Library};
use crate::starting::par_map;

// --- the joint update --------------------------------------------------------

/// Posterior Ratings after the performances satisfy pᵢ > pⱼ for every
/// `(i, j)` in `relations`, with pᵢ ~ N(sᵢ, β²) and sᵢ ~ N(μᵢ, σᵢ² + τ²):
/// one performance per wallpaper, one truncation site per relation, EP on
/// the joint Gaussian of the performances iterated until the sites settle.
/// A port of `ep_skills` in the research script.
pub fn joint_update(r: &[Rating], relations: &[(usize, usize)]) -> Vec<Rating> {
    let n = r.len();
    let k = relations.len();
    let tau2 = ranking::TAU * ranking::TAU;
    let beta2 = ranking::BETA * ranking::BETA;
    let sp2: Vec<f64> = r.iter().map(|x| x.sigma * x.sigma + tau2).collect();
    let v0: Vec<f64> = sp2.iter().map(|s| s + beta2).collect();
    let mu: Vec<f64> = r.iter().map(|x| x.mu).collect();
    let (mut ts, mut ns) = (vec![0.0; k], vec![0.0; k]);
    let mut s = vec![0.0; n * n];
    let mut m = vec![0.0; n];
    let posterior = |ts: &[f64], ns: &[f64], s: &mut Vec<f64>, m: &mut Vec<f64>| {
        let mut p = vec![0.0; n * n];
        let mut h: Vec<f64> = (0..n).map(|i| mu[i] / v0[i]).collect();
        for i in 0..n {
            p[i * n + i] = 1.0 / v0[i];
        }
        for (site, &(a, b)) in relations.iter().enumerate() {
            let t = ts[site];
            p[a * n + a] += t;
            p[b * n + b] += t;
            p[a * n + b] -= t;
            p[b * n + a] -= t;
            h[a] += ns[site];
            h[b] -= ns[site];
        }
        invert(&mut p, s, n);
        for i in 0..n {
            m[i] = (0..n).map(|j| s[i * n + j] * h[j]).sum();
        }
    };
    for _ in 0..200 {
        let mut delta: f64 = 0.0;
        for site in 0..k {
            posterior(&ts, &ns, &mut s, &mut m);
            let (a, b) = relations[site];
            let mk = m[a] - m[b];
            let vk = s[a * n + a] + s[b * n + b] - 2.0 * s[a * n + b];
            let tc = 1.0 / vk - ts[site];
            let nc = mk / vk - ns[site];
            if !(tc > 0.0) {
                continue;
            }
            let (mc, vc) = (nc / tc, 1.0 / tc);
            let z = mc / vc.sqrt();
            let lam = v_trunc(z);
            let mh = mc + vc.sqrt() * lam;
            let vh = vc * (1.0 - lam * (lam + z));
            if !(vh > 0.0) || !vh.is_finite() {
                continue;
            }
            let tn = 1.0 / vh - tc;
            let nn = mh / vh - nc;
            delta = delta.max((tn - ts[site]).abs()).max((nn - ns[site]).abs());
            ts[site] = tn;
            ns[site] = nn;
        }
        if delta < 1e-10 {
            break;
        }
    }
    posterior(&ts, &ns, &mut s, &mut m);
    (0..n)
        .map(|i| {
            let kk = sp2[i] / v0[i];
            let var = sp2[i] - kk * sp2[i] + kk * kk * s[i * n + i];
            Rating::new(mu[i] + kk * (m[i] - mu[i]), var.sqrt())
        })
        .collect()
}

/// pdf(z)/cdf(z), the truncated-Gaussian mean shift.
fn v_trunc(z: f64) -> f64 {
    let c = phi(z);
    if c > 1e-300 {
        (-z * z / 2.0).exp() / (2.0 * std::f64::consts::PI).sqrt() / c
    } else {
        -z
    }
}

/// Gauss–Jordan inverse of the n×n matrix `a` (destroyed) into `out`.
fn invert(a: &mut [f64], out: &mut Vec<f64>, n: usize) {
    out.clear();
    out.resize(n * n, 0.0);
    for i in 0..n {
        out[i * n + i] = 1.0;
    }
    for c in 0..n {
        let piv = (c..n)
            .max_by(|&x, &y| a[x * n + c].abs().total_cmp(&a[y * n + c].abs()))
            .unwrap();
        if piv != c {
            for j in 0..n {
                a.swap(c * n + j, piv * n + j);
                out.swap(c * n + j, piv * n + j);
            }
        }
        let d = a[c * n + c];
        for j in 0..n {
            a[c * n + j] /= d;
            out[c * n + j] /= d;
        }
        for r in 0..n {
            if r != c {
                let f = a[r * n + c];
                if f != 0.0 {
                    for j in 0..n {
                        a[r * n + j] -= f * a[c * n + j];
                        out[r * n + j] -= f * out[c * n + j];
                    }
                }
            }
        }
    }
}

// --- variants ----------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Format {
    Pair,
    Best,
    BestWorst,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Update {
    Joint,
    /// One `rate_1vs1` per implied relation: best beats each other member in
    /// the order shown, then each middle member beats the worst.
    Sequential,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Count {
    /// Each member's Comparison count +1 per showing.
    Showing,
    /// + the number of implied relations it took part in.
    Relations,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Cap {
    /// ADR 0060 carried to groups: every other member has a Score whenever
    /// one is open (so at most one Unrated per showing), and while at least
    /// half the pool has a Score a showing that follows one with an Unrated
    /// wallpaper draws none.
    Adr,
    /// The every-other cap kept, but members may be Unrated freely.
    NoGroupLimit,
    /// Neither: members may be Unrated, and showings with Unrated may follow
    /// each other.
    Free,
}

#[derive(Clone, Debug)]
pub struct Variant {
    pub spec: String,
    pub members: usize,
    pub format: Format,
    pub update: Update,
    pub count: Count,
    pub cap: Cap,
    /// Groups until every wallpaper is Decided or a Close call, pairs after.
    pub mixed: bool,
    /// The first pick leaves out every wallpaper in the last `window` showings.
    pub window: usize,
    /// Close call: Undecided with a Score and σ below this.
    pub close: f64,
}

impl Variant {
    /// `pair`, `bw<N>` or `best<N>`, then any of `/seq`, `/count=show|rel`,
    /// `/u=adr|nolimit|free`, `/mixed`, `/m=<showings>`, `/cc=<σ>`.
    pub fn parse(spec: &str) -> Option<Self> {
        let mut parts = spec.split('/');
        let head = parts.next()?;
        let (format, members) = if head == "pair" {
            (Format::Pair, 2)
        } else if let Some(n) = head.strip_prefix("bw") {
            (Format::BestWorst, n.parse().ok().filter(|&n| n >= 3)?)
        } else if let Some(n) = head.strip_prefix("best") {
            (Format::Best, n.parse().ok().filter(|&n| n >= 2)?)
        } else {
            return None;
        };
        let mut v = Variant {
            spec: spec.into(),
            members,
            format,
            update: Update::Joint,
            count: Count::Relations,
            cap: Cap::Adr,
            mixed: false,
            window: 10,
            close: 1.5,
        };
        for opt in parts {
            if opt == "seq" {
                v.update = Update::Sequential;
                continue;
            }
            if opt == "mixed" {
                v.mixed = true;
                continue;
            }
            let (key, val) = opt.split_once('=')?;
            match key {
                "count" => {
                    v.count = match val {
                        "show" => Count::Showing,
                        "rel" => Count::Relations,
                        _ => return None,
                    }
                }
                "u" => {
                    v.cap = match val {
                        "adr" => Cap::Adr,
                        "nolimit" => Cap::NoGroupLimit,
                        "free" => Cap::Free,
                        _ => return None,
                    }
                }
                "m" => v.window = val.parse().ok().filter(|&m| m >= 1)?,
                "cc" => v.close = val.parse().ok()?,
                _ => return None,
            }
        }
        Some(v)
    }

    pub fn name(&self) -> String {
        let mut s = match self.format {
            Format::Pair => "pair".to_string(),
            Format::Best => format!("best of {}", self.members),
            Format::BestWorst => format!("best+worst of {}", self.members),
        };
        if self.format != Format::Pair {
            s += match self.update {
                Update::Joint => ", joint",
                Update::Sequential => ", sequential rate_1vs1",
            };
            if self.count == Count::Showing {
                s += ", count +1 per showing";
            }
        }
        match self.cap {
            Cap::Adr => {}
            Cap::NoGroupLimit => s += ", no per-group Unrated limit",
            Cap::Free => s += ", no Unrated limit or cap",
        }
        if self.mixed {
            s += ", then pairs";
        }
        if self.window != 10 {
            s += &format!(", window {}", self.window);
        }
        if self.close != 1.5 {
            s += &format!(", Close call σ<{}", self.close);
        }
        s
    }
}

// --- the curator -------------------------------------------------------------

/// One perceived performance per member. Thurstone: q + noise·N(0, 1).
/// Bradley–Terry: q/scale + Gumbel, so the order is a Plackett–Luce ranking
/// (the best is the harness's `BradleyTerry` pick, and the worst is the last
/// of that ranking); scale = noise·√2/1.702 as in `sim::BradleyTerry`.
fn perceive(voter: &str, noise: f64, quality: &[f64], shown: &[usize], rng: &mut Prng) -> Vec<f64> {
    match voter {
        "thurstone" => shown.iter().map(|&i| quality[i] + noise * rng.normal()).collect(),
        "bradley-terry" | "bt" => {
            let scale = noise * std::f64::consts::SQRT_2 / 1.702;
            shown
                .iter()
                .map(|&i| {
                    let u = rng.uniform().max(f64::MIN_POSITIVE);
                    quality[i] / scale - (-u.ln()).ln()
                })
                .collect()
        }
        _ => panic!("unknown voter {voter}"),
    }
}

fn voter_name(voter: &str, noise: f64) -> String {
    match voter {
        "thurstone" => format!("T(noise={noise})"),
        _ => format!("BT(noise={noise})"),
    }
}

// --- the selector ------------------------------------------------------------

struct GroupRule<'a> {
    v: &'a Variant,
    k: f64,
    recent: VecDeque<Vec<usize>>,
    last_had_unrated: bool,
    /// Mixed only: pairs from now on.
    switched: bool,
}

impl<'a> GroupRule<'a> {
    fn new(v: &'a Variant, k: f64) -> Self {
        Self {
            v,
            k,
            recent: VecDeque::new(),
            last_had_unrated: false,
            switched: false,
        }
    }

    fn members(&self) -> usize {
        if self.switched {
            2
        } else {
            self.v.members
        }
    }

    fn select(&mut self, lib: &Library, bar: &Bar, rng: &mut Prng) -> Vec<usize> {
        let n = lib.len();
        let size = self.members();
        let empty = Vec::new();
        let on_screen = self.recent.back().unwrap_or(&empty);
        let shown_last = |i: usize| on_screen.contains(&i);
        let scored = lib.counts.iter().filter(|&&c| c > 0).count();
        let block = self.v.cap != Cap::Free && self.last_had_unrated && 2 * scored >= n;
        let scored_ok = |i: usize| !block || lib.counts[i] > 0;
        let k = self.k;
        let close = self.v.close;
        let open = |i: usize| {
            let r = lib.ratings[i];
            let c = lib.counts[i];
            let undecided = c == 0 || (r.mu - bar.score).abs() < k * r.sigma;
            undecided && !(c > 0 && r.sigma < close)
        };

        let mut first = None;
        for m in [self.v.window, 1] {
            let in_window = |i: usize| self.recent.iter().rev().take(m).any(|s| s.contains(&i));
            first = least(
                (0..n).filter(|&i| !in_window(i) && scored_ok(i) && open(i)),
                &lib.counts,
                rng,
            );
            if first.is_some() {
                break;
            }
        }
        let first = first
            .or_else(|| least((0..n).filter(|&i| !shown_last(i) && scored_ok(i)), &lib.counts, rng))
            .or_else(|| least((0..n).filter(|&i| !shown_last(i)), &lib.counts, rng))
            .expect("a pool bigger than a showing");

        // Other members: a Score whenever one is open, if the rule asks.
        let need_score = block || (self.v.cap == Cap::Adr && lib.counts[first] == 0);
        let a = lib.ratings[first];
        let scale = a.sigma.abs().max(f64::MIN_POSITIVE);
        let weight = |j: usize| {
            let z = (lib.ratings[j].mu - a.mu) / scale;
            (-0.5 * z * z).exp()
        };
        let mut chosen = vec![first];
        let tiers: [&dyn Fn(usize) -> bool; 3] = [
            &|j| !shown_last(j) && (!need_score || lib.counts[j] > 0),
            &|j| !shown_last(j),
            &|_| true,
        ];
        for tier in tiers {
            if chosen.len() == size {
                break;
            }
            let mut pool: Vec<usize> = (0..n).filter(|&j| !chosen.contains(&j) && tier(j)).collect();
            let mut w: Vec<f64> = pool.iter().map(|&j| weight(j)).collect();
            while chosen.len() < size && !pool.is_empty() {
                let total: f64 = w.iter().sum();
                let pick = if total > 0.0 && total.is_finite() {
                    let mut r = rng.uniform() * total;
                    let mut c = pool.len() - 1;
                    for (x, wx) in w.iter().enumerate() {
                        r -= wx;
                        if r < 0.0 {
                            c = x;
                            break;
                        }
                    }
                    c
                } else {
                    rng.below(pool.len())
                };
                chosen.push(pool.swap_remove(pick));
                w.swap_remove(pick);
            }
        }
        self.last_had_unrated = chosen.iter().any(|&i| lib.counts[i] == 0);
        self.recent.push_back(chosen.clone());
        while self.recent.len() > self.v.window {
            self.recent.pop_front();
        }
        chosen
    }
}

/// Least-compared of `items`, uniform among ties.
fn least(items: impl Iterator<Item = usize>, counts: &[u32], rng: &mut Prng) -> Option<usize> {
    let mut best = u32::MAX;
    let mut pick = None;
    let mut ties = 0usize;
    for i in items {
        let c = counts[i];
        if c < best {
            best = c;
            pick = Some(i);
            ties = 1;
        } else if c == best {
            ties += 1;
            if rng.below(ties) == 0 {
                pick = Some(i);
            }
        }
    }
    pick
}

/// The implied relations of one judgement, as (better, worse) positions in
/// `shown`: best over each other member, then (best+worst) each middle
/// member over the worst.
fn relations(format: Format, perf: &[f64]) -> Vec<(usize, usize)> {
    let n = perf.len();
    let best = (0..n).max_by(|&a, &b| perf[a].total_cmp(&perf[b])).unwrap();
    let mut rel: Vec<(usize, usize)> = (0..n).filter(|&j| j != best).map(|j| (best, j)).collect();
    if format == Format::BestWorst && n >= 3 {
        let worst = (0..n).min_by(|&a, &b| perf[a].total_cmp(&perf[b])).unwrap();
        rel.extend((0..n).filter(|&j| j != best && j != worst).map(|j| (j, worst)));
    }
    rel
}

fn apply(v: &Variant, pair_now: bool, lib: &mut Library, shown: &[usize], perf: &[f64]) {
    let format = if pair_now { Format::Pair } else { v.format };
    let rel = relations(format, perf);
    let before: Vec<Rating> = shown.iter().map(|&i| lib.ratings[i]).collect();
    let after = if shown.len() == 2 || v.update == Update::Sequential {
        let mut r = before;
        for &(a, b) in &rel {
            let (w, l) = ranking::rate_1vs1(r[a], r[b]);
            r[a] = w;
            r[b] = l;
        }
        r
    } else {
        joint_update(&before, &rel)
    };
    for (x, &i) in shown.iter().enumerate() {
        lib.ratings[i] = after[x];
        lib.counts[i] += match v.count {
            Count::Showing => 1,
            Count::Relations => rel.iter().filter(|&&(a, b)| a == x || b == x).count() as u32,
        };
    }
}

// --- one run -----------------------------------------------------------------

const BAR: sim::QuantileBar = sim::QuantileBar { share: 0.2 };
const SHARES: [f64; 4] = [0.5, 0.6, 0.7, 0.8];
/// Showings at which the wrong-side rate is reported, as a pairwise Each
/// (2 × showings / n): at n = 500, showings 500, 1000, 2500, 5000, 10000.
const AT: [f64; 5] = [2.0, 4.0, 10.0, 20.0, 40.0];

fn at_showings(e: f64, n: usize) -> usize {
    (e * n as f64 / 2.0).round() as usize
}

#[derive(Clone, Copy, Default)]
struct Point {
    showings: usize,
    decided: usize,
    wrong: usize,
}

struct RunOut {
    /// First showing at which each of `SHARES` was Decided, with the point.
    hits: [Option<Point>; 4],
    /// First showing after which every wallpaper was Decided or a Close call.
    done: Option<usize>,
    /// Every `every` showings.
    points: Vec<Point>,
    /// At `done`: Decided, of them on the wrong side, and Close calls.
    done_state: Option<(usize, usize, usize)>,
    /// Calibration (inside the 95% interval, Scored) at 70% Decided and at the end.
    cover70: Option<(usize, usize)>,
    cover_end: (usize, usize),
}

/// How many Scored wallpapers have their true quality, put on the Score
/// scale by the least-squares fit μ ≈ a + b·q over the Scored, inside
/// μ ± 1.96σ. A calibrated σ gives about 95% (a little more, since the fit
/// soaks up some of the error); an overconfident one less.
fn coverage(lib: &Library) -> (usize, usize) {
    let scored: Vec<usize> = (0..lib.len()).filter(|&i| lib.counts[i] > 0).collect();
    if scored.len() < 3 {
        return (0, 0);
    }
    let (a, b, _) = sim::fit_mu_on_quality(lib, scored.iter().copied());
    let inside = scored
        .iter()
        .filter(|&&i| {
            let r = lib.ratings[i];
            (r.mu - (a + b * lib.quality[i])).abs() <= 1.96 * r.sigma
        })
        .count();
    (inside, scored.len())
}

struct Measure {
    decided: usize,
    wrong: usize,
    /// Undecided and not a Close call (Unrated included).
    open: usize,
}

fn measure(lib: &Library, bar: &Bar, rule: &sim::ZSigma, close: f64, range: std::ops::Range<usize>) -> Measure {
    let mut m = Measure { decided: 0, wrong: 0, open: 0 };
    for i in range {
        let r = lib.ratings[i];
        match rule.side(r, bar) {
            Some(below) if lib.counts[i] > 0 => {
                m.decided += 1;
                m.wrong += (below != lib.truly_below[i]) as usize;
            }
            _ => m.open += !(lib.counts[i] > 0 && r.sigma < close) as usize,
        }
    }
    m
}

struct Setup<'a> {
    voter: &'a str,
    noise: f64,
    k: f64,
}

fn fresh(n: usize, rng: &mut Prng) -> Library {
    let quality: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
    Library {
        truly_below: BAR.truly_below(&quality),
        ratings: vec![Rating::new(ranking::MU, ranking::SIGMA); n],
        counts: vec![0; n],
        quality,
    }
}

/// One showing: select, perceive, update. Returns the members shown.
fn step(sel: &mut GroupRule, lib: &mut Library, bar: &Bar, s: &Setup, rng: &mut Prng) -> Vec<usize> {
    let shown = sel.select(lib, bar, rng);
    let perf = perceive(s.voter, s.noise, &lib.quality, &shown, rng);
    let pair_now = shown.len() == 2;
    apply(sel.v, pair_now, lib, &shown, &perf);
    shown
}

fn one_run(n: usize, v: &Variant, s: &Setup, budget: usize, seed: u64, rep: usize) -> RunOut {
    let rule = sim::ZSigma { z: s.k };
    let mut rng = Prng::new(crate::job_seed(seed, n, rep));
    let mut lib = fresh(n, &mut rng);
    let mut scratch = Vec::with_capacity(n);
    let mut bar = BAR.bar(&lib, &mut scratch);
    let mut sel = GroupRule::new(v, s.k);
    let every = 50;
    let mut out = RunOut {
        hits: [None; 4],
        done: None,
        points: vec![Point::default()],
        done_state: None,
        cover70: None,
        cover_end: (0, 0),
    };
    for j in 1..=budget {
        step(&mut sel, &mut lib, &bar, s, &mut rng);
        bar = BAR.bar(&lib, &mut scratch);
        let m = measure(&lib, &bar, &rule, v.close, 0..n);
        let p = Point {
            showings: j,
            decided: m.decided,
            wrong: m.wrong,
        };
        for (x, &share) in SHARES.iter().enumerate() {
            if out.hits[x].is_none() && m.decided as f64 >= share * n as f64 {
                out.hits[x] = Some(p);
                if x == 2 {
                    out.cover70 = Some(coverage(&lib));
                }
            }
        }
        if m.open == 0 && out.done.is_none() {
            out.done = Some(j);
            out.done_state = Some((m.decided, m.wrong, n - m.decided));
            if v.mixed {
                sel.switched = true;
            }
        }
        if j % every == 0 || j == budget {
            out.points.push(p);
        }
    }
    out.cover_end = coverage(&lib);
    out
}

// --- arguments ---------------------------------------------------------------

struct Args {
    sizes: Vec<usize>,
    variants: Vec<String>,
    voters: Vec<String>,
    noises: Vec<f64>,
    ks: Vec<f64>,
    reps: usize,
    budget: f64,
    seed: u64,
    threads: usize,
    old: usize,
    new: usize,
    each_before: f64,
    after: usize,
}

const USAGE: &str = "\
usage: walltare-sim group <runs|arrival> [options]
  --sizes 500              library sizes (runs)
  --variant pair,bw4       comma list; see group::Variant::parse:
                           pair | bw<N> | best<N>, then /seq /count=show|rel
                           /u=adr|nolimit|free /mixed /m=<showings> /cc=<σ>
  --voter thurstone        comma list: thurstone, bradley-terry
  --noise 1.0              comma list
  --k 2.5                  comma list; Decided when |μ − Bar| ≥ k·σ, the selector reads the same k
  --reps 20
  --budget 40              showings per run as a pairwise Each: budget × n / 2
  --old 500 --new 200      arrival: the library before the scan, and what it adds
  --each-before 20         arrival: pairs (ADR 0060 rule) before the scan, as Each
  --after 5000             arrival: showings after the scan
  --seed 1
  --threads <cores>";

fn parse(argv: &[String]) -> Args {
    let mut a = Args {
        sizes: vec![500],
        variants: vec!["pair".into(), "bw4".into()],
        voters: vec!["thurstone".into()],
        noises: vec![1.0],
        ks: vec![2.5],
        reps: 20,
        budget: 40.0,
        seed: 1,
        threads: std::thread::available_parallelism().map_or(4, |n| n.get()),
        old: 500,
        new: 200,
        each_before: 20.0,
        after: 5000,
    };
    let mut it = argv.iter();
    while let Some(flag) = it.next() {
        if flag == "-h" || flag == "--help" {
            println!("{USAGE}");
            std::process::exit(0);
        }
        let val = it.next().unwrap_or_else(|| die(&format!("{flag} needs a value")));
        let list = || val.split(',').map(str::trim).filter(|s| !s.is_empty());
        match flag.as_str() {
            "--sizes" => a.sizes = list().map(num).collect(),
            "--variant" => a.variants = list().map(String::from).collect(),
            "--voter" => a.voters = list().map(String::from).collect(),
            "--noise" => a.noises = list().map(num).collect(),
            "--k" => a.ks = list().map(num).collect(),
            "--reps" => a.reps = num(val),
            "--budget" => a.budget = num(val),
            "--seed" => a.seed = num(val),
            "--threads" => a.threads = num(val),
            "--old" => a.old = num(val),
            "--new" => a.new = num(val),
            "--each-before" => a.each_before = num(val),
            "--after" => a.after = num(val),
            _ => die(&format!("unknown flag {flag}")),
        }
    }
    for v in &a.variants {
        if Variant::parse(v).is_none() {
            die(&format!("unknown variant {v}"));
        }
    }
    for v in &a.voters {
        if !["thurstone", "bradley-terry", "bt"].contains(&v.as_str()) {
            die(&format!("unknown voter {v}"));
        }
    }
    a
}

fn num<T: std::str::FromStr>(s: &str) -> T {
    s.parse().unwrap_or_else(|_| die(&format!("not a number: {s}")))
}

fn die(msg: &str) -> ! {
    eprintln!("{msg}\n\n{USAGE}");
    std::process::exit(2)
}

pub fn main(argv: &[String]) {
    let Some(study) = argv.first() else { die("which study?") };
    let args = parse(&argv[1..]);
    match study.as_str() {
        "runs" => runs(&args),
        "arrival" => arrival(&args),
        "-h" | "--help" => println!("{USAGE}"),
        _ => die(&format!("unknown study {study}")),
    }
}

// --- summaries ---------------------------------------------------------------

/// Lower median of per-run values; `None` (never reached) sorts last.
/// "(r/N)" when not every run got there.
fn median(mut v: Vec<Option<f64>>, fmt: impl Fn(f64) -> String) -> String {
    let runs = v.len();
    let reached = v.iter().filter(|x| x.is_some()).count();
    v.sort_by(|a, b| a.unwrap_or(f64::INFINITY).total_cmp(&b.unwrap_or(f64::INFINITY)));
    let tail = if reached < runs { format!(" ({reached}/{runs})") } else { String::new() };
    match v[(runs - 1) / 2] {
        Some(x) => format!("{}{tail}", fmt(x)),
        None => format!("—{tail}"),
    }
}

fn med_value(mut v: Vec<Option<f64>>) -> Option<f64> {
    v.sort_by(|a, b| a.unwrap_or(f64::INFINITY).total_cmp(&b.unwrap_or(f64::INFINITY)));
    v[(v.len() - 1) / 2]
}

fn pct(a: usize, b: usize) -> String {
    if b == 0 {
        "—".into()
    } else {
        format!("{:.2}%", 100.0 * a as f64 / b as f64)
    }
}

fn runs(args: &Args) {
    let variants: Vec<Variant> = args.variants.iter().map(|s| Variant::parse(s).unwrap()).collect();
    for &n in &args.sizes {
        for &k in &args.ks {
            for voter in &args.voters {
                for &noise in &args.noises {
                    let started = std::time::Instant::now();
                    let setup = Setup { voter, noise, k };
                    let jobs: Vec<(usize, usize)> = (0..variants.len())
                        .flat_map(|v| (0..args.reps).map(move |r| (v, r)))
                        .collect();
                    let outs = par_map(&jobs, args.threads, |&(v, rep)| {
                        one_run(n, &variants[v], &setup, at_showings(args.budget, n), args.seed, rep)
                    });
                    let by_v: Vec<&[RunOut]> = outs.chunks(args.reps).collect();
                    println!("## n = {n}, {}, k = {k}\n", voter_name(voter, noise));
                    println!(
                        "{} libraries per row (seed {}), {} showings each. {:.1}s.\n",
                        args.reps,
                        args.seed,
                        at_showings(args.budget, n),
                        started.elapsed().as_secs_f64()
                    );
                    print_runs(n, &variants, &by_v);
                }
            }
        }
    }
}

fn print_runs(n: usize, variants: &[Variant], by_v: &[&[RunOut]]) {
    let hit = |r: &RunOut, x: usize| r.hits[x].map(|p| p.showings as f64);
    let done = |r: &RunOut| r.done.map(|d| d as f64);
    let pair = variants.iter().position(|v| v.spec == "pair");
    let pair_med = |f: &dyn Fn(&RunOut) -> Option<f64>| pair.and_then(|p| med_value(by_v[p].iter().map(f).collect()));
    let (pair50, pair70, pair_done) = (pair_med(&|r| hit(r, 0)), pair_med(&|r| hit(r, 2)), pair_med(&done));
    let ratio = |p: Option<f64>, g: Option<f64>| match (p, g) {
        (Some(p), Some(g)) => format!("{:.2}", p / g),
        _ => "—".into(),
    };

    println!("Showings (median) until a share of the library is Decided, and until every wallpaper is Decided or a Close call (\"Done\"); the 50% / 70% ones × members shown (member-slots); break-even = pairwise showings ÷ these showings, at 50%, 70% and Done: how many times longer than a pairwise vote a showing may take and still be as fast.\n");
    println!("| Variant | 50% | 60% | 70% | 80% | Done | ×members 50% | ×members 70% | Break-even 50% | 70% | Done |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (v, runs) in variants.iter().zip(by_v) {
        print!("| {} |", v.name());
        for x in 0..4 {
            print!(" {} |", median(runs.iter().map(|r| hit(r, x)).collect(), |s| format!("{s:.0}")));
        }
        print!(" {} |", median(runs.iter().map(done).collect(), |s| format!("{s:.0}")));
        for x in [0, 2] {
            // Mixed switches to pairs only once nothing is left to decide.
            let slots = |r: &RunOut| r.hits[x].map(|p| (p.showings * v.members) as f64);
            print!(" {} |", median(runs.iter().map(slots).collect(), |s| format!("{s:.0}")));
        }
        let mine = |f: &dyn Fn(&RunOut) -> Option<f64>| med_value(runs.iter().map(f).collect());
        println!(
            " {} | {} | {} |",
            ratio(pair50, mine(&|r| hit(r, 0))),
            ratio(pair70, mine(&|r| hit(r, 2))),
            ratio(pair_done, mine(&done))
        );
    }
    println!();

    println!("Wrong side: share of Decided wallpapers on the side opposite their true side, pooled over runs — at the showing each run first reached 50% / 70% / 80% Decided, then at fixed showings. \"Run\" pools every 50th showing from showing 2n (pairwise Each 4) on; \"Peak\" is the worst such point with ≥ 2% Decided (from showing 50 on).\n");
    print!("| Variant | @50% | @70% | @80% |");
    for e in AT {
        print!(" @{} |", at_showings(e, n));
    }
    println!(" Run | Peak |");
    println!("|---|{}", "---:|".repeat(3 + AT.len() + 2));
    for (v, runs) in variants.iter().zip(by_v) {
        print!("| {} |", v.name());
        for x in [0, 2, 3] {
            let (w, d) = runs
                .iter()
                .filter_map(|r| r.hits[x])
                .fold((0, 0), |(w, d), p| (w + p.wrong, d + p.decided));
            print!(" {} |", pct(w, d));
        }
        for e in AT {
            let a = at_showings(e, n);
            let (w, d) = runs
                .iter()
                .filter_map(|r| r.points.iter().find(|p| p.showings == a))
                .fold((0, 0), |(w, d), p| (w + p.wrong, d + p.decided));
            print!(" {} |", pct(w, d));
        }
        let (w, d) = runs
            .iter()
            .flat_map(|r| r.points.iter().filter(|p| p.showings >= 2 * n))
            .fold((0, 0), |(w, d), p| (w + p.wrong, d + p.decided));
        let len = runs.iter().map(|r| r.points.len()).min().unwrap_or(0);
        let peak = (1..len)
            .filter_map(|x| {
                let d: usize = runs.iter().map(|r| r.points[x].decided).sum();
                let w: usize = runs.iter().map(|r| r.points[x].wrong).sum();
                (d * 50 >= n * runs.len()).then(|| 100.0 * w as f64 / d as f64)
            })
            .fold(0.0, f64::max);
        println!(" {} | {peak:.2}% |", pct(w, d));
    }
    println!();

    println!("When nothing is left to decide (every wallpaper Decided or a Close call, first time), pooled over the runs that got there: Decided and Close call shares of the library, wrong side among the Decided. Calibration: share of Scored wallpapers whose true quality (put on the Score scale by a least-squares fit of μ on it) lies inside μ ± 1.96σ, pooled, at 70% Decided and at the end of the budget; 95% or a little above is calibrated, less is overconfident.\n");
    println!("| Variant | Runs there | Decided | Close call | Wrong | Inside 95% @70% | @end |");
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for (v, runs) in variants.iter().zip(by_v) {
        let there: Vec<(usize, usize, usize)> = runs.iter().filter_map(|r| r.done_state).collect();
        let (d, w, c) = there.iter().fold((0, 0, 0), |(a, b, c), x| (a + x.0, b + x.1, c + x.2));
        let cells = there.len() * n;
        let (i70, s70) = runs.iter().filter_map(|r| r.cover70).fold((0, 0), |(a, b), x| (a + x.0, b + x.1));
        let (ie, se) = runs.iter().map(|r| r.cover_end).fold((0, 0), |(a, b), x| (a + x.0, b + x.1));
        println!(
            "| {} | {}/{} | {} | {} | {} | {} | {} |",
            v.name(),
            there.len(),
            runs.len(),
            pct(d, cells),
            pct(c, cells),
            pct(w, d),
            pct(i70, s70),
            pct(ie, se)
        );
    }
    println!();
}

// --- arrival -----------------------------------------------------------------

#[derive(Clone, Copy)]
struct ArrPoint {
    showings: usize,
    old: usize,
    new: usize,
    new_wrong: usize,
}

struct ArrOut {
    points: Vec<ArrPoint>,
    all_scored: Option<usize>,
    /// Showings with an Unrated arrival, and showings, while any was Unrated.
    with_unrated: usize,
    while_left: usize,
    /// Showings holding two or more Unrated arrivals.
    multi: usize,
}

/// `old` wallpapers ranked by pairs under ADR 0060 to Each `each_before`
/// (the same library and pre-scan votes for every variant), then `new`
/// Unrated arrive and the variant carries on over the whole library.
fn arrival_run(args: &Args, v: &Variant, s: &Setup, rep: usize) -> ArrOut {
    let n_old = args.old;
    let rule = sim::ZSigma { z: s.k };
    let mut rng = Prng::new(crate::job_seed(args.seed, n_old, rep));
    let mut lib = fresh(n_old, &mut rng);
    let mut scratch = Vec::new();
    let mut bar = BAR.bar(&lib, &mut scratch);
    let pair = Variant::parse("pair").unwrap();
    {
        let mut sel = GroupRule::new(&pair, s.k);
        let before = (args.each_before * n_old as f64 / 2.0).ceil() as usize;
        for _ in 0..before {
            step(&mut sel, &mut lib, &bar, s, &mut rng);
            bar = BAR.bar(&lib, &mut scratch);
        }
    }
    let q_new: Vec<f64> = (0..args.new).map(|_| rng.normal()).collect();
    lib.ratings.extend(q_new.iter().map(|_| Rating::new(ranking::MU, ranking::SIGMA)));
    lib.quality.extend(q_new);
    let n = n_old + args.new;
    lib.counts.resize(n, 0);
    lib.truly_below = BAR.truly_below(&lib.quality);
    bar = BAR.bar(&lib, &mut scratch);
    // From here each variant draws its own randomness from the same state.
    let mut rng = Prng::new(crate::job_seed(args.seed ^ 0xA11, n, rep));
    let at = |lib: &Library, bar: &Bar, j: usize| {
        let o = measure(lib, bar, &rule, v.close, 0..n_old);
        let x = measure(lib, bar, &rule, v.close, n_old..n);
        ArrPoint {
            showings: j,
            old: o.decided,
            new: x.decided,
            new_wrong: x.wrong,
        }
    };
    let mut out = ArrOut {
        points: vec![at(&lib, &bar, 0)],
        all_scored: None,
        with_unrated: 0,
        while_left: 0,
        multi: 0,
    };
    let mut sel = GroupRule::new(v, s.k);
    for j in 1..=args.after {
        let left = (n_old..n).any(|i| lib.counts[i] == 0);
        let shown = sel.select(&lib, &bar, &mut rng);
        let unrated = shown.iter().filter(|&&i| i >= n_old && lib.counts[i] == 0).count();
        if left {
            out.while_left += 1;
            out.with_unrated += (unrated > 0) as usize;
        }
        out.multi += (unrated >= 2) as usize;
        let perf = perceive(s.voter, s.noise, &lib.quality, &shown, &mut rng);
        apply(v, shown.len() == 2, &mut lib, &shown, &perf);
        bar = BAR.bar(&lib, &mut scratch);
        if out.all_scored.is_none() && (n_old..n).all(|i| lib.counts[i] > 0) {
            out.all_scored = Some(j);
        }
        out.points.push(at(&lib, &bar, j));
    }
    out
}

fn arrival(args: &Args) {
    let variants: Vec<Variant> = args.variants.iter().map(|s| Variant::parse(s).unwrap()).collect();
    let nn = args.new;
    for &k in &args.ks {
        for voter in &args.voters {
            for &noise in &args.noises {
                let started = std::time::Instant::now();
                let setup = Setup { voter, noise, k };
                let jobs: Vec<(usize, usize)> = (0..variants.len())
                    .flat_map(|v| (0..args.reps).map(move |r| (v, r)))
                    .collect();
                let outs = par_map(&jobs, args.threads, |&(v, rep)| arrival_run(args, &variants[v], &setup, rep));
                let by_v: Vec<&[ArrOut]> = outs.chunks(args.reps).collect();
                println!(
                    "## Arrival: {} ranked by pairs to Each {}, then {nn} Unrated; {}, k = {k}\n",
                    args.old,
                    args.each_before,
                    voter_name(voter, noise)
                );
                println!(
                    "Showings from the scan (median; (reached/runs) when not all), and the same × members. \"All Scored\": showings until every arrival has a Score. \"With an Unrated\": share of showings with an Unrated arrival while any is left. \"≥2 Unrated\": showings per run (mean) holding two or more Unrated arrivals. Wrong among the arrivals Decided when 70% of them first were, pooled. Old: the old wallpapers' Decided share at the scan and its lowest point before the arrivals reach 70% (mean over runs). {} libraries per row, {} showings after the scan. {:.1}s.\n",
                    args.reps,
                    args.after,
                    started.elapsed().as_secs_f64()
                );
                println!("| Variant | All Scored | With an Unrated | ≥2 Unrated | New 50% | 70% | 90% | ×members 70% | Wrong among new at 70% | Old at scan | Old lowest |");
                println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
                for (v, runs) in variants.iter().zip(&by_v) {
                    let hit = |t: &ArrOut, share: f64| {
                        let need = (share * nn as f64).ceil() as usize;
                        t.points.iter().position(|a| a.new >= need)
                    };
                    let med = |share: f64, mult: usize| {
                        median(
                            runs.iter().map(|t| hit(t, share).map(|i| (t.points[i].showings * mult) as f64)).collect(),
                            |s| format!("{s:.0}"),
                        )
                    };
                    let (mut w, mut d) = (0, 0);
                    let (mut scan, mut low) = (0.0, 0.0);
                    let (mut wu, mut wl, mut multi) = (0, 0, 0);
                    for t in runs.iter() {
                        let end = hit(t, 0.7);
                        let upto = end.unwrap_or(t.points.len() - 1);
                        if let Some(i) = end {
                            w += t.points[i].new_wrong;
                            d += t.points[i].new;
                        }
                        scan += t.points[0].old as f64 / args.old as f64;
                        low += t.points[..=upto].iter().map(|a| a.old).min().unwrap() as f64 / args.old as f64;
                        wu += t.with_unrated;
                        wl += t.while_left;
                        multi += t.multi;
                    }
                    let r = runs.len() as f64;
                    println!(
                        "| {} | {} | {} | {:.1} | {} | {} | {} | {} | {} | {:.1}% | {:.1}% |",
                        v.name(),
                        median(runs.iter().map(|t| t.all_scored.map(|x| x as f64)).collect(), |s| format!("{s:.0}")),
                        pct(wu, wl),
                        multi as f64 / r,
                        med(0.5, 1),
                        med(0.7, 1),
                        med(0.9, 1),
                        med(0.7, v.members),
                        pct(w, d),
                        100.0 * scan / r,
                        100.0 * low / r,
                    );
                }
                println!();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    #[test]
    fn joint_update_is_rate_1vs1_for_a_pair() {
        for (w, l) in [
            (Rating::new(25.0, 8.333), Rating::new(25.0, 8.333)),
            (Rating::new(22.0, 5.0), Rating::new(30.0, 3.0)),
            (Rating::new(35.0, 2.0), Rating::new(18.0, 6.0)),
            (Rating::new(10.0, 1.2), Rating::new(40.0, 1.5)),
        ] {
            let (rw, rl) = ranking::rate_1vs1(w, l);
            let j = joint_update(&[w, l], &[(0, 1)]);
            for (a, b) in [(j[0], rw), (j[1], rl)] {
                assert!(close(a.mu, b.mu, 1e-5) && close(a.sigma, b.sigma, 1e-5), "{a:?} vs {b:?}");
            }
        }
    }

    #[test]
    fn joint_update_matches_the_research_script() {
        // bestofn.py's ep_skills on the same inputs.
        let fresh = [Rating::new(25.0, 8.333); 4];
        let best = joint_update(&fresh, &relations(Format::Best, &[4.0, 3.0, 2.0, 1.0]));
        for (r, (m, s)) in best.iter().zip([(32.662931, 6.37491), (22.44569, 7.276666), (22.44569, 7.276666), (22.44569, 7.276666)]) {
            assert!(close(r.mu, m, 1e-4) && close(r.sigma, s, 1e-4), "{r:?}");
        }
        let bw = joint_update(&fresh, &relations(Format::BestWorst, &[4.0, 3.0, 2.0, 1.0]));
        for (r, (m, s)) in bw.iter().zip([(32.729954, 6.275157), (25.0, 6.305693), (25.0, 6.305693), (17.270046, 6.275157)]) {
            assert!(close(r.mu, m, 1e-4) && close(r.sigma, s, 1e-4), "{r:?}");
        }
        let mixed = [Rating::new(22.0, 3.0), Rating::new(25.0, 4.0), Rating::new(26.0, 2.5), Rating::new(28.0, 6.0)];
        let bw = joint_update(&mixed, &relations(Format::BestWorst, &[4.0, 3.0, 2.0, 1.0]));
        for (r, (m, s)) in bw.iter().zip([(24.398079, 2.69986), (24.589538, 3.40242), (25.617979, 2.333732), (21.534947, 4.422606)]) {
            assert!(close(r.mu, m, 1e-4) && close(r.sigma, s, 1e-4), "{r:?}");
        }
    }

    #[test]
    fn relations_of_best_and_worst() {
        // Member 2 best, member 0 worst.
        let r = relations(Format::BestWorst, &[0.0, 1.0, 3.0, 2.0]);
        assert_eq!(r, vec![(2, 0), (2, 1), (2, 3), (1, 0), (3, 0)]);
        assert_eq!(relations(Format::Best, &[0.0, 1.0, 3.0, 2.0]), vec![(2, 0), (2, 1), (2, 3)]);
        assert_eq!(relations(Format::Pair, &[0.0, 1.0]), vec![(1, 0)]);
    }

    fn lib(ratings: Vec<Rating>, counts: Vec<u32>) -> Library {
        let n = ratings.len();
        Library { quality: vec![0.0; n], ratings, counts, truly_below: vec![false; n] }
    }

    #[test]
    fn a_group_holds_one_unrated_and_the_next_none() {
        // 12 Scored, 2 Unrated: at least half Scored, so the cap is on.
        let mut ratings = vec![Rating::new(25.0, 3.0); 12];
        ratings.extend([Rating::new(25.0, 8.333); 2]);
        let mut counts = vec![3; 12];
        counts.extend([0, 0]);
        let mut l = lib(ratings, counts);
        let bar = Bar { score: 25.0, sigma: 3.0, scored: 12 };
        let v = Variant::parse("bw4/m=1").unwrap();
        let mut s = GroupRule::new(&v, 2.5);
        let mut rng = Prng::new(3);
        let g = s.select(&l, &bar, &mut rng);
        assert_eq!(g.len(), 4);
        assert!(g[0] >= 12, "Unrated first: {g:?}");
        assert!(g[1..].iter().all(|&i| i < 12), "the rest Scored: {g:?}");
        l.counts[g[0]] = 3;
        let h = s.select(&l, &bar, &mut rng);
        assert!(h.iter().all(|&i| l.counts[i] > 0), "cap: {h:?}");
        assert!(h.iter().all(|i| !g.contains(i)), "{g:?} then {h:?}");
    }

    #[test]
    fn close_calls_are_not_a_first_pick() {
        let l = lib(
            vec![Rating::new(25.0, 1.0), Rating::new(25.0, 3.0), Rating::new(40.0, 1.0), Rating::new(10.0, 1.0), Rating::new(45.0, 1.0)],
            vec![1, 9, 1, 1, 1],
        );
        let bar = Bar { score: 25.0, sigma: 1.0, scored: 5 };
        let v = Variant::parse("pair").unwrap();
        let mut s = GroupRule::new(&v, 2.5);
        assert_eq!(s.select(&l, &bar, &mut Prng::new(1))[0], 1);
    }
}
