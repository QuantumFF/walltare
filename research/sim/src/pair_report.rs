//! Pair-selection studies for #370: `walltare-sim pair <runs|arrival|timing>`.
//! Results in `results/pair-selection.md`.
//!
//! Every study uses the worst-20% Bar, Decided at |μ − Bar| ≥ k·σ (k 2.5 unless
//! `--k` says otherwise, and a `PairRule` selector is given the same k), the
//! uniform prior and one `rate_1vs1` per vote.

use std::collections::VecDeque;

use crate::prng::Prng;
use crate::selectors;
use crate::sim::{self, Bar, BarRule, DecidedRule, Library, Observer, Parts, SelectorStats, Vote, Voter};
use crate::starting::par_map;

struct Args {
    sizes: Vec<usize>,
    selectors: Vec<String>,
    voters: Vec<String>,
    noises: Vec<f64>,
    k: f64,
    reps: usize,
    budget: f64,
    seed: u64,
    threads: usize,
    old: usize,
    news: Vec<usize>,
    each_before: f64,
    after: usize,
    early: bool,
}

const USAGE: &str = "\
usage: walltare-sim pair <runs|arrival|timing> [options]
  --sizes 500              library sizes (arrival: ignored; timing: 2000,10000)
  --selector baseline,straddle+bald
                           comma list; see selectors::PairRule::parse
  --voter thurstone        comma list: thurstone, bradley-terry
  --noise 1.0              comma list
  --k 2.5                  Decided when |μ − Bar| ≥ k·σ; PairRule selectors get the same k
  --reps 20
  --budget 40              Comparisons per wallpaper on average
  --early                  runs: also print the young-library table
  --old 500                arrival: the library before the scan
  --new 200,50             arrival: wallpapers the scan adds
  --each-before 20         arrival: Each the old library is ranked to first
  --after 5000             arrival: votes after the scan
  --seed 1
  --threads <cores>";

fn parse(argv: &[String]) -> Args {
    let mut a = Args {
        sizes: vec![500],
        selectors: vec!["baseline".into()],
        voters: vec!["thurstone".into()],
        noises: vec![1.0],
        k: 2.5,
        reps: 20,
        budget: 40.0,
        seed: 1,
        threads: std::thread::available_parallelism().map_or(4, |n| n.get()),
        old: 500,
        news: vec![200, 50],
        each_before: 20.0,
        after: 5000,
        early: false,
    };
    let mut it = argv.iter();
    while let Some(flag) = it.next() {
        if flag == "-h" || flag == "--help" {
            println!("{USAGE}");
            std::process::exit(0);
        }
        if flag == "--early" {
            a.early = true;
            continue;
        }
        let val = it.next().unwrap_or_else(|| die(&format!("{flag} needs a value")));
        let list = || val.split(',').map(str::trim).filter(|s| !s.is_empty());
        match flag.as_str() {
            "--sizes" => a.sizes = list().map(num).collect(),
            "--selector" => a.selectors = list().map(String::from).collect(),
            "--voter" => a.voters = list().map(String::from).collect(),
            "--noise" => a.noises = list().map(num).collect(),
            "--k" => a.k = num(val),
            "--reps" => a.reps = num(val),
            "--budget" => a.budget = num(val),
            "--seed" => a.seed = num(val),
            "--threads" => a.threads = num(val),
            "--old" => a.old = num(val),
            "--new" => a.news = list().map(num).collect(),
            "--each-before" => a.each_before = num(val),
            "--after" => a.after = num(val),
            _ => die(&format!("unknown flag {flag}")),
        }
    }
    for s in &a.selectors {
        if selectors::by_name(s).is_none() {
            die(&format!("unknown selector {s}; have {:?}", selectors::NAMES));
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
        "timing" => timing(&args),
        "-h" | "--help" => println!("{USAGE}"),
        _ => die(&format!("unknown study {study}")),
    }
}

/// The selector for `name` at Decided k: a PairRule gets `/k=` unless it has one.
fn selector(name: &str, k: f64) -> Box<dyn sim::Selector> {
    let full = if name == "baseline" || name == "random" || name.contains("/k=") {
        name.to_string()
    } else {
        format!("{name}/k={k}")
    };
    selectors::by_name(&full).expect("checked in parse")
}

const BAR: sim::QuantileBar = sim::QuantileBar { share: 0.2 };
/// Half-widths of the fuzzy middle, in true-quality units (quality ~ N(0, 1)).
const DELTAS: [f64; 2] = [0.1, 0.25];
/// σ below which an Undecided wallpaper counts as stopped.
const STOPS: [f64; 3] = [1.0, 1.5, 2.0];

// --- the per-run observer ----------------------------------------------------

#[derive(Clone, Copy, Default)]
struct Point {
    comparisons: usize,
    decided: usize,
    wrong: usize,
    /// Truly below and Decided below.
    right_below: usize,
    truly_below: usize,
    /// Decided among those whose true quality is more than δ from the true Bar.
    out_decided: [usize; 2],
    /// Undecided with σ below each of `STOPS`.
    stopped: [usize; 3],
}

struct Watch {
    rule: sim::ZSigma,
    every: usize,
    /// |q − true Bar| ≤ δ: the fuzzy middle, per `DELTAS`.
    near: [Vec<bool>; 2],
    out_total: [usize; 2],
    points: Vec<Point>,
    recent: VecDeque<[usize; 2]>,
    votes: u64,
    /// Votes showing a wallpaper that was in the pair just before / exactly
    /// two pairs back / any of the previous five.
    rep_prev: u64,
    rep2: u64,
    rep5: u64,
    /// Votes showing a wallpaper that is in at least 3 of the last 10 pairs,
    /// this one included.
    crowded: u64,
    /// Per wallpaper: the vote it was last shown in, and how many appearances
    /// in a row came at most two pairs apart.
    last_seen: Vec<u64>,
    streak: Vec<u32>,
    /// Longest such streak of any wallpaper.
    max_streak: u32,
    /// The last vote; a point is always taken there.
    max: usize,
    /// Bar Scores when the first wallpaper was Decided.
    scored_at_first: Option<usize>,
    /// Unrated wallpapers left, and what the pairs did while any were.
    unrated: UnratedWatch,
}

/// Unrated-vs-Unrated pairs and how long Unrated wallpapers last. A shown
/// wallpaper was Unrated before the vote iff it has exactly one Comparison
/// after it (pairs only).
#[derive(Clone, Copy, Default)]
struct UnratedWatch {
    left: usize,
    /// Votes that paired two Unrated wallpapers, and the last such vote.
    uu: u64,
    last_uu: u64,
    /// Votes while at least one Unrated was left, and those showing one.
    while_left: u64,
    with_unrated: u64,
    /// The vote after which every wallpaper had a Score.
    all_scored: Option<u64>,
}

impl UnratedWatch {
    fn vote(&mut self, lib: &Library, shown: &[usize], index: u64, of: impl Fn(usize) -> bool) {
        if self.left == 0 {
            return;
        }
        let fresh = shown.iter().filter(|&&i| of(i) && lib.counts[i] == 1).count();
        let any_fresh = shown.iter().filter(|&&i| lib.counts[i] == 1).count();
        self.while_left += 1;
        self.with_unrated += (fresh > 0) as u64;
        if any_fresh == shown.len() {
            self.uu += 1;
            self.last_uu = index;
        }
        self.left -= fresh;
        if self.left == 0 {
            self.all_scored = Some(index);
        }
    }
}

impl Watch {
    fn new(k: f64, every: usize, max: usize) -> Self {
        Self {
            rule: sim::ZSigma { z: k },
            every,
            near: [Vec::new(), Vec::new()],
            out_total: [0; 2],
            points: Vec::new(),
            recent: VecDeque::new(),
            votes: 0,
            rep_prev: 0,
            rep2: 0,
            rep5: 0,
            crowded: 0,
            last_seen: Vec::new(),
            streak: Vec::new(),
            max_streak: 0,
            max,
            scored_at_first: None,
            unrated: UnratedWatch::default(),
        }
    }

    fn point(&self, lib: &Library, bar: &Bar, comparisons: usize) -> Point {
        let mut p = Point {
            comparisons,
            ..Default::default()
        };
        for i in 0..lib.len() {
            let r = lib.ratings[i];
            let tb = lib.truly_below[i];
            p.truly_below += tb as usize;
            match self.rule.side(r, bar) {
                Some(below) => {
                    p.decided += 1;
                    p.wrong += (below != tb) as usize;
                    p.right_below += (below && tb) as usize;
                    for d in 0..2 {
                        p.out_decided[d] += !self.near[d][i] as usize;
                    }
                }
                None => {
                    for (s, &stop) in STOPS.iter().enumerate() {
                        p.stopped[s] += (lib.counts[i] > 0 && r.sigma < stop) as usize;
                    }
                }
            }
        }
        p
    }
}

impl Observer for Watch {
    fn start(&mut self, lib: &Library, _: &Bar) {
        let mut sorted = lib.quality.clone();
        sorted.sort_by(f64::total_cmp);
        let n = sorted.len();
        let r = ((0.2 * n as f64).round() as usize).clamp(1, n - 1);
        let cut = (sorted[r - 1] + sorted[r]) / 2.0;
        self.near = DELTAS.map(|d| lib.quality.iter().map(|&q| (q - cut).abs() <= d).collect::<Vec<_>>());
        self.out_total = [0, 1].map(|k| self.near[k].iter().filter(|&&x| !x).count());
        self.last_seen = vec![0; n];
        self.streak = vec![0; n];
        self.unrated.left = lib.counts.iter().filter(|&&c| c == 0).count();
        // Before the first vote nothing is Scored and nothing is Decided.
        let mut p = Point::default();
        p.truly_below = lib.truly_below.iter().filter(|&&b| b).count();
        self.points.push(p);
    }

    fn vote(&mut self, lib: &Library, vote: &Vote) {
        self.votes += 1;
        let s = vote.shown;
        let has = |p: &[usize; 2]| s.iter().any(|i| p.contains(i));
        let back = |k: usize| self.recent.len() >= k && has(&self.recent[self.recent.len() - k]);
        self.rep_prev += back(1) as u64;
        self.rep2 += back(2) as u64;
        self.rep5 += self.recent.iter().rev().take(5).any(|p| has(p)) as u64;
        self.recent.push_back([s[0], s[1]]);
        if self.recent.len() > 10 {
            self.recent.pop_front();
        }
        let t = vote.index as u64;
        let mut crowded = false;
        for &i in s {
            crowded |= self.recent.iter().filter(|p| p.contains(&i)).count() >= 3;
            self.streak[i] = if self.last_seen[i] > 0 && t - self.last_seen[i] <= 2 {
                self.streak[i] + 1
            } else {
                1
            };
            self.last_seen[i] = t;
            self.max_streak = self.max_streak.max(self.streak[i]);
        }
        self.crowded += crowded as u64;
        self.unrated.vote(lib, s, t, |_| true);
        if self.scored_at_first.is_none()
            && lib.ratings.iter().any(|&r| self.rule.side(r, vote.bar).is_some())
        {
            self.scored_at_first = Some(vote.bar.scored);
        }
        if vote.index % self.every == 0 || vote.index == self.max {
            let p = self.point(lib, vote.bar, vote.comparisons);
            self.points.push(p);
        }
    }
}

struct RunOut {
    points: Vec<Point>,
    out_total: [usize; 2],
    votes: u64,
    rep: [u64; 3],
    crowded: u64,
    max_streak: u32,
    scored_at_first: Option<usize>,
    unrated: UnratedWatch,
    stats: SelectorStats,
}

fn voter(name: &str, noise: f64) -> Box<dyn Voter> {
    crate::voter(name, noise)
}

fn one_run(n: usize, sel: &str, voter: &dyn Voter, k: f64, budget: f64, seed: u64, rep: usize) -> RunOut {
    let decided = sim::ZSigma { z: k };
    let parts = Parts {
        voter,
        updater: &sim::WinnerBeatsEach,
        prior: &sim::Uniform,
        bar: &BAR,
        decided: &decided,
    };
    let mut s = selector(sel, k);
    let mut rng = Prng::new(crate::job_seed(seed, n, rep));
    let max = (budget * n as f64 / 2.0).ceil() as usize;
    let every = (n / 40).max(1);
    let mut watch = Watch::new(k, every, max);
    sim::run(n, s.as_mut(), &parts, max, max, &mut [&mut watch], &mut rng);
    RunOut {
        points: watch.points,
        out_total: watch.out_total,
        votes: watch.votes,
        rep: [watch.rep_prev, watch.rep2, watch.rep5],
        crowded: watch.crowded,
        max_streak: watch.max_streak,
        scored_at_first: watch.scored_at_first,
        unrated: watch.unrated,
        stats: s.stats(),
    }
}

// --- summaries --------------------------------------------------------------

fn each(c: usize, n: usize) -> f64 {
    2.0 * c as f64 / n as f64
}

/// Lower median over runs of the Each at the first point where `hit`; runs
/// that never got there sort last. Shows (reached/runs) when not all did.
fn median_each(runs: &[RunOut], n: usize, hit: impl Fn(&RunOut, &Point) -> bool) -> String {
    let mut v: Vec<Option<f64>> = runs
        .iter()
        .map(|r| r.points.iter().find(|p| hit(r, p)).map(|p| each(p.comparisons, n)))
        .collect();
    let reached = v.iter().filter(|x| x.is_some()).count();
    v.sort_by(|a, b| match (a, b) {
        (Some(a), Some(b)) => a.total_cmp(b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    let tail = if reached < runs.len() {
        format!(" ({reached}/{})", runs.len())
    } else {
        String::new()
    };
    match v[(v.len() - 1) / 2] {
        Some(e) => format!("{e:.2}{tail}"),
        None => format!("—{tail}"),
    }
}

/// The first point of a run at or past Each `e`.
fn at(r: &RunOut, n: usize, e: f64) -> Option<&Point> {
    let target = (e * n as f64 / 2.0).round() as usize;
    r.points.iter().find(|p| p.comparisons >= target)
}

fn pooled(runs: &[RunOut], n: usize, e: f64, f: impl Fn(&Point) -> (usize, usize)) -> String {
    let (a, b) = runs
        .iter()
        .filter_map(|r| at(r, n, e))
        .fold((0, 0), |(a, b), p| {
            let (x, y) = f(p);
            (a + x, b + y)
        });
    if b == 0 {
        "—".into()
    } else {
        format!("{:.2}%", 100.0 * a as f64 / b as f64)
    }
}

/// Highest pooled Wrong over the run's points, ignoring points where fewer
/// than 2% of the library is Decided.
fn peak_wrong(runs: &[RunOut], n: usize) -> String {
    let len = runs.iter().map(|r| r.points.len()).min().unwrap_or(0);
    let peak = (0..len)
        .filter_map(|k| {
            let d: usize = runs.iter().map(|r| r.points[k].decided).sum();
            let w: usize = runs.iter().map(|r| r.points[k].wrong).sum();
            (d * 50 >= n * runs.len()).then(|| 100.0 * w as f64 / d as f64)
        })
        .fold(0.0, f64::max);
    format!("{peak:.2}%")
}

/// Wrong pooled over every point of every run from Each 4 on: the
/// wrong-side rate a curator would meet on average.
fn run_wrong(runs: &[RunOut], n: usize) -> String {
    let (d, w) = runs
        .iter()
        .flat_map(|r| r.points.iter().filter(|p| each(p.comparisons, n) >= 4.0))
        .fold((0, 0), |(d, w), p| (d + p.decided, w + p.wrong));
    if d == 0 {
        "—".into()
    } else {
        format!("{:.2}%", 100.0 * w as f64 / d as f64)
    }
}

const SHARES: [f64; 5] = [0.5, 0.6, 0.7, 0.8, 0.9];

fn runs(args: &Args) {
    for &n in &args.sizes {
        for v in &args.voters {
            for &noise in &args.noises {
                let started = std::time::Instant::now();
                let jobs: Vec<(usize, usize)> = (0..args.selectors.len())
                    .flat_map(|s| (0..args.reps).map(move |r| (s, r)))
                    .collect();
                let outs = par_map(&jobs, args.threads, |&(s, rep)| {
                    let vt = voter(v, noise);
                    one_run(n, &args.selectors[s], vt.as_ref(), args.k, args.budget, args.seed, rep)
                });
                let by_sel: Vec<&[RunOut]> = outs.chunks(args.reps).collect();
                println!("## n = {n}, {}, k = {}\n", voter(v, noise).name(), args.k);
                println!(
                    "{} libraries per row, budget Each {}, seed {}. {:.1}s.\n",
                    args.reps,
                    args.budget,
                    args.seed,
                    started.elapsed().as_secs_f64()
                );
                print_runs(args, n, &by_sel);
            }
        }
    }
}

fn print_runs(args: &Args, n: usize, by_sel: &[&[RunOut]]) {
    let names: Vec<String> = args.selectors.iter().map(|s| selector(s, args.k).name()).collect();

    println!("Each (median) until a share of the library is Decided, and until 95% of the wallpapers more than δ (true quality) from the true Bar are Decided.\n");
    println!("| Selector | 50% | 60% | 70% | 80% | 90% | 95% outside δ 0.25 | 95% outside δ 0.1 |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (name, runs) in names.iter().zip(by_sel) {
        print!("| {name} |");
        for share in SHARES {
            let need = (share * n as f64).ceil() as usize;
            print!(" {} |", median_each(runs, n, |_, p| p.decided >= need));
        }
        for d in [1, 0] {
            print!(
                " {} |",
                median_each(runs, n, |r, p| p.out_decided[d] * 100 >= r.out_total[d] * 95)
            );
        }
        println!();
    }
    println!();

    println!("Clear-out side (truly below and Decided below, of the truly below), Decided share, and the wrong-side share of the Decided, pooled over runs at each Each. \"Run\" pools every point from Each 4 on; \"Peak\" is the worst point with ≥ 2% Decided.\n");
    println!("| Selector | Below @4 | @8 | @16 | Decided @4 | @8 | @16 | @40 | Wrong @4 | @8 | @16 | @40 | Run | Peak |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (name, runs) in names.iter().zip(by_sel) {
        print!("| {name} |");
        for e in [4.0, 8.0, 16.0] {
            print!(" {} |", pooled(runs, n, e, |p| (p.right_below, p.truly_below)));
        }
        for e in [4.0, 8.0, 16.0, 40.0] {
            print!(" {} |", pooled(runs, n, e, |p| (p.decided, n)));
        }
        for e in [4.0, 8.0, 16.0, 40.0] {
            print!(" {} |", pooled(runs, n, e, |p| (p.wrong, p.decided)));
        }
        println!(" {} | {} |", run_wrong(runs, n), peak_wrong(runs, n));
    }
    println!();

    println!("Repeats and stopping. Share of votes showing a wallpaper from the pair just before, from exactly two pairs back, or from any of the previous five; showing a wallpaper that is in at least 3 of the last 10 pairs (this one included); and the longest streak of one wallpaper's appearances each at most two pairs after the last (median of runs / worst run). Fallback: share of votes whose first pick came from the fallback (no Undecided left to pick) and the Each of the first such vote (median). \"Stuck σ<s @40\": Undecided wallpapers with σ below s at Each 40, as a share of the library. \"All Decided or σ<s\": Each (median) when every wallpaper first was Decided or had σ below s.\n");
    println!("| Selector | Prev | 2 back | Last 5 | ≥3 in 10 | Longest streak | Fallback votes | First fallback | Stuck σ<1 / 1.5 / 2 @40 | All Decided or σ<1 | σ<1.5 | σ<2 |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (name, runs) in names.iter().zip(by_sel) {
        let votes: u64 = runs.iter().map(|r| r.votes).sum();
        let rep = |k: usize| 100.0 * runs.iter().map(|r| r.rep[k]).sum::<u64>() as f64 / votes as f64;
        let mut streak: Vec<u32> = runs.iter().map(|r| r.max_streak).collect();
        streak.sort_unstable();
        let crowded = 100.0 * runs.iter().map(|r| r.crowded).sum::<u64>() as f64 / votes as f64;
        let fb: u64 = runs.iter().map(|r| r.stats.fallback_votes).sum();
        let mut first: Vec<Option<f64>> = runs
            .iter()
            .map(|r| r.stats.first_fallback.map(|v| each(v as usize, n)))
            .collect();
        first.sort_by(|a, b| a.unwrap_or(f64::INFINITY).total_cmp(&b.unwrap_or(f64::INFINITY)));
        let fired = first.iter().filter(|x| x.is_some()).count();
        let first_s = match first[(first.len() - 1) / 2] {
            Some(e) => format!("{e:.2} ({fired}/{})", runs.len()),
            None => format!("— ({fired}/{})", runs.len()),
        };
        let stuck: Vec<String> = (0..3)
            .map(|s| pooled(runs, n, args.budget, |p| (p.stopped[s], n)))
            .collect();
        print!(
            "| {name} | {:.2}% | {:.2}% | {:.2}% | {:.2}% | {} / {} | {:.2}% | {} | {} |",
            rep(0),
            rep(1),
            rep(2),
            crowded,
            streak[(streak.len() - 1) / 2],
            streak[streak.len() - 1],
            100.0 * fb as f64 / votes as f64,
            first_s,
            stuck.join(" / "),
        );
        for s in 0..3 {
            print!(" {} |", median_each(runs, n, |_, p| p.decided + p.stopped[s] >= n));
        }
        println!();
    }
    println!();

    if args.early {
        println!("Young library. Decided share and wrong-side share of the Decided at Each 1, 2 and 4, pooled; Scores the Bar rested on when the first wallpaper was Decided (min–max over runs).\n");
        println!("| Selector | Decided @1 | Wrong @1 | Decided @2 | Wrong @2 | Decided @4 | Wrong @4 | Bar Scores at first Decided |");
        println!("|---|---:|---:|---:|---:|---:|---:|---:|");
        for (name, runs) in names.iter().zip(by_sel) {
            print!("| {name} |");
            for e in [1.0, 2.0, 4.0] {
                print!(
                    " {} | {} |",
                    pooled(runs, n, e, |p| (p.decided, n)),
                    pooled(runs, n, e, |p| (p.wrong, p.decided))
                );
            }
            let mut f: Vec<usize> = runs.iter().filter_map(|r| r.scored_at_first).collect();
            f.sort_unstable();
            match (f.first(), f.last()) {
                (Some(a), Some(b)) => println!(" {a}–{b} |"),
                _ => println!(" — |"),
            }
        }
        println!();

        println!("Unrated wallpapers from a library with no Scores. Unrated-vs-Unrated votes per run (mean) and the last vote that was one (median / worst run); share of votes showing an Unrated while any is left; votes until every wallpaper has a Score (median / worst run).\n");
        println!("| Selector | U-vs-U votes | Last U-vs-U vote | Votes with an Unrated while any left | Votes until all Scored |");
        println!("|---|---:|---:|---:|---:|");
        for (name, runs) in names.iter().zip(by_sel) {
            let r = runs.len() as f64;
            let uu = runs.iter().map(|x| x.unrated.uu).sum::<u64>() as f64 / r;
            let mut last: Vec<u64> = runs.iter().map(|x| x.unrated.last_uu).collect();
            last.sort_unstable();
            let (w, a) = runs
                .iter()
                .fold((0, 0), |(w, a), x| (w + x.unrated.with_unrated, a + x.unrated.while_left));
            let mut all: Vec<u64> = runs.iter().map(|x| x.unrated.all_scored.unwrap_or(u64::MAX)).collect();
            all.sort_unstable();
            let show = |v: u64| if v == u64::MAX { "never".to_string() } else { v.to_string() };
            println!(
                "| {name} | {uu:.2} | {} / {} | {:.2}% | {} / {} |",
                last[(last.len() - 1) / 2],
                last[last.len() - 1],
                100.0 * w as f64 / a.max(1) as f64,
                show(all[(all.len() - 1) / 2]),
                show(all[all.len() - 1]),
            );
        }
        println!();
    }
}

// --- arrival ----------------------------------------------------------------

#[derive(Clone, Copy)]
struct ArrPoint {
    votes: usize,
    old: usize,
    new: usize,
    new_wrong: usize,
    new_comparisons: usize,
}

struct ArrOut {
    points: Vec<ArrPoint>,
    /// Per vote after the scan: did the pair show an arrival?
    featured: Vec<bool>,
    unrated: UnratedWatch,
}

/// `n_old` ranked under the rule to Each `each_before`, then `nn` Unrated
/// arrive (25 / 8.333). The same selector carries on over the whole library.
#[allow(clippy::too_many_arguments)]
fn arrival_run(
    n_old: usize,
    nn: usize,
    each_before: f64,
    sel: &mut dyn sim::Selector,
    parts: &Parts,
    k: f64,
    after: usize,
    rng: &mut Prng,
) -> ArrOut {
    let before = (each_before * n_old as f64 / 2.0).ceil() as usize;
    let (_, mut lib) = sim::run(n_old, sel, parts, before, before.max(1), &mut [], rng);
    let q_new: Vec<f64> = (0..nn).map(|_| rng.normal()).collect();
    lib.ratings
        .extend(q_new.iter().map(|_| crate::ranking::Rating::new(crate::ranking::MU, crate::ranking::SIGMA)));
    lib.quality.extend(q_new);
    lib.counts.resize(n_old + nn, 0);
    lib.truly_below = BAR.truly_below(&lib.quality);
    let rule = sim::ZSigma { z: k };
    let mut scratch = Vec::new();
    let mut bar = BAR.bar(&lib, &mut scratch);
    let measure = |lib: &Library, bar: &Bar, votes: usize| {
        let mut p = ArrPoint {
            votes,
            old: 0,
            new: 0,
            new_wrong: 0,
            new_comparisons: 0,
        };
        for i in 0..lib.len() {
            let side = rule.side(lib.ratings[i], bar);
            if i < n_old {
                p.old += side.is_some() as usize;
            } else {
                p.new_comparisons += lib.counts[i] as usize;
                if let Some(below) = side {
                    p.new += 1;
                    p.new_wrong += (below != lib.truly_below[i]) as usize;
                }
            }
        }
        p
    };
    let mut out = ArrOut {
        points: vec![measure(&lib, &bar, 0)],
        featured: Vec::with_capacity(after),
        unrated: UnratedWatch {
            left: nn,
            ..Default::default()
        },
    };
    for j in 1..=after {
        let shown = sel.select(&lib, &bar, parts.decided, rng);
        let winner = parts.voter.pick(&lib.quality, &shown, rng);
        parts.updater.apply(&mut lib, &shown, winner);
        bar = BAR.bar(&lib, &mut scratch);
        out.featured.push(shown.iter().any(|&i| i >= n_old));
        out.unrated.vote(&lib, &shown, j as u64, |i| i >= n_old);
        if j % 5 == 0 || j == after {
            out.points.push(measure(&lib, &bar, j));
        }
    }
    out
}

fn arrival(args: &Args) {
    let k = args.k;
    for v in &args.voters {
        for &noise in &args.noises {
            for &nn in &args.news {
                let started = std::time::Instant::now();
                let n_old = args.old;
                let jobs: Vec<(usize, usize)> = (0..args.selectors.len())
                    .flat_map(|s| (0..args.reps).map(move |r| (s, r)))
                    .collect();
                let traces = par_map(&jobs, args.threads, |&(s, rep)| {
                    let vt = voter(v, noise);
                    let decided = sim::ZSigma { z: k };
                    let parts = Parts {
                        voter: vt.as_ref(),
                        updater: &sim::WinnerBeatsEach,
                        prior: &sim::Uniform,
                        bar: &BAR,
                        decided: &decided,
                    };
                    let mut sel = selector(&args.selectors[s], k);
                    let mut rng = Prng::new(crate::job_seed(args.seed, n_old, rep));
                    arrival_run(n_old, nn, args.each_before, sel.as_mut(), &parts, k, args.after, &mut rng)
                });
                let by_sel: Vec<&[ArrOut]> = traces.chunks(args.reps).collect();
                println!(
                    "## Arrival: {n_old} ranked to Each {} under the rule, then {nn} Unrated; {}, k = {k}\n",
                    args.each_before,
                    voter(v, noise).name()
                );
                println!(
                    "Votes counted from the scan (median; (reached/runs) when not all). \"All Scored\": votes until every arrival has a Score. \"With an arrival\": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). \"U-vs-U\": votes pairing two Unrated arrivals, mean per run. \"New Each\" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of {} votes), and at that point, means over runs. {} libraries per row. {:.1}s.\n",
                    args.after,
                    args.reps,
                    started.elapsed().as_secs_f64()
                );
                println!("| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |");
                println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
                for (s, runs) in by_sel.iter().enumerate() {
                    let name = selector(&args.selectors[s], k).name();
                    let hit = |t: &ArrOut, share: f64| {
                        let need = (share * nn as f64).ceil() as usize;
                        t.points.iter().position(|a| a.new >= need)
                    };
                    let median = |mut v: Vec<Option<usize>>| {
                        let reached = v.iter().filter(|x| x.is_some()).count();
                        v.sort_by_key(|x| x.unwrap_or(usize::MAX));
                        let tail = if reached < runs.len() {
                            format!(" ({reached}/{})", runs.len())
                        } else {
                            String::new()
                        };
                        match v[(v.len() - 1) / 2] {
                            Some(j) => format!("{j}{tail}"),
                            None => format!("—{tail}"),
                        }
                    };
                    let med = |share: f64| median(runs.iter().map(|t| hit(t, share).map(|i| t.points[i].votes)).collect());
                    let scored = median(runs.iter().map(|t| t.unrated.all_scored.map(|v| v as usize)).collect());
                    let mut new_each = Vec::new();
                    let (mut dw, mut dd) = (0usize, 0usize);
                    let (mut scan, mut low, mut at90) = (0.0, 0.0, 0.0);
                    let (mut f_un, mut v_un, mut f_90, mut v_90) = (0usize, 0usize, 0usize, 0usize);
                    let mut uu = 0u64;
                    let (mut w_un, mut a_un) = (0u64, 0u64);
                    for t in runs.iter() {
                        w_un += t.unrated.with_unrated;
                        a_un += t.unrated.while_left;
                        let end = hit(t, 0.9);
                        let upto = end.unwrap_or(t.points.len() - 1);
                        let p = &t.points;
                        scan += p[0].old as f64 / n_old as f64;
                        low += p[..=upto].iter().map(|a| a.old).min().unwrap() as f64 / n_old as f64;
                        at90 += p[upto].old as f64 / n_old as f64;
                        if let Some(i) = end {
                            new_each.push(p[i].new_comparisons as f64 / nn as f64);
                            dw += p[i].new_wrong;
                            dd += p[i].new;
                        }
                        let until_scored = t.unrated.all_scored.map_or(t.featured.len(), |v| v as usize);
                        f_un += t.featured[..until_scored].iter().filter(|&&b| b).count();
                        v_un += until_scored;
                        let until_90 = p[upto].votes;
                        f_90 += t.featured[..until_90].iter().filter(|&&b| b).count();
                        v_90 += until_90;
                        uu += t.unrated.uu;
                    }
                    let r = runs.len() as f64;
                    new_each.sort_by(f64::total_cmp);
                    let pct = |a: usize, b: usize| if b > 0 { format!("{:.2}%", 100.0 * a as f64 / b as f64) } else { "—".into() };
                    println!(
                        "| {name} | {scored} | {} | {} | {} | {:.2} | {} | {} | {} | {} | {} | {:.1}% | {:.1}% | {:.1}% |",
                        pct(f_un, v_un),
                        pct(w_un as usize, a_un as usize),
                        pct(f_90, v_90),
                        uu as f64 / r,
                        med(0.5),
                        med(0.7),
                        med(0.9),
                        new_each.get(new_each.len().saturating_sub(1) / 2).map_or("—".into(), |e| format!("{e:.1}")),
                        pct(dw, dd),
                        100.0 * scan / r,
                        100.0 * low / r,
                        100.0 * at90 / r,
                    );
                }
                println!();
            }
        }
    }
}

// --- timing -----------------------------------------------------------------

fn timing(args: &Args) {
    let sizes = if args.sizes == [500] { vec![2000, 10000] } else { args.sizes.clone() };
    println!("## Per-pair selection time\n");
    println!("One thread, release build. A library with μ = 25 + 4q + N(0, 1.5²), σ uniform in [1.5, 4], 20 Comparisons each, then 300 votes (select, Thurstone noise 1.0 vote, `rate_1vs1`, Bar recomputed); only `select` is timed. The Bar recompute (O(n) `select_nth`) is timed separately, since the app would pay it too.\n");
    println!("| n | Selector | Median µs | Mean µs | p95 µs | Bar µs (median) |");
    println!("|---:|---|---:|---:|---:|---:|");
    for &n in &sizes {
        for name in &args.selectors {
            let mut rng = Prng::new(args.seed ^ n as u64);
            let quality: Vec<f64> = (0..n).map(|_| rng.normal()).collect();
            let ratings = quality
                .iter()
                .map(|&q| crate::ranking::Rating::new(25.0 + 4.0 * q + 1.5 * rng.normal(), 1.5 + 2.5 * rng.uniform()))
                .collect();
            let mut lib = Library {
                truly_below: BAR.truly_below(&quality),
                quality,
                ratings,
                counts: vec![20; n],
            };
            let decided = sim::ZSigma { z: args.k };
            let voter = sim::Thurstone { noise: 1.0 };
            let mut sel = selector(name, args.k);
            let mut scratch = Vec::new();
            let mut bar = BAR.bar(&lib, &mut scratch);
            let (mut sel_t, mut bar_t) = (Vec::new(), Vec::new());
            for j in 0..330 {
                let t0 = std::time::Instant::now();
                let shown = sel.select(&lib, &bar, &decided, &mut rng);
                let dt = t0.elapsed().as_secs_f64() * 1e6;
                let w = voter.pick(&lib.quality, &shown, &mut rng);
                sim::Updater::apply(&sim::WinnerBeatsEach, &mut lib, &shown, w);
                let t1 = std::time::Instant::now();
                bar = BAR.bar(&lib, &mut scratch);
                let bt = t1.elapsed().as_secs_f64() * 1e6;
                if j >= 30 {
                    sel_t.push(dt);
                    bar_t.push(bt);
                }
            }
            sel_t.sort_by(f64::total_cmp);
            bar_t.sort_by(f64::total_cmp);
            let mean = sel_t.iter().sum::<f64>() / sel_t.len() as f64;
            println!(
                "| {n} | {} | {:.1} | {:.1} | {:.1} | {:.1} |",
                sel.name(),
                sel_t[sel_t.len() / 2],
                mean,
                sel_t[sel_t.len() * 95 / 100],
                bar_t[bar_t.len() / 2]
            );
        }
    }
    println!();
}
