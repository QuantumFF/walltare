//! Starting Score studies for #374: how many votes a prediction from image
//! embeddings would save. `walltare-sim starting <calibrate|cold|arrival>`.
//! Results in `results/starting-score.md`.
//!
//! Every study keeps the baseline selector (`select_pair`), the worst-20% Bar
//! and Decided at |μ − Bar| ≥ 2σ, so it lines up with `results/baseline.md`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use crate::prng::Prng;
use crate::selectors;
use crate::sim::{self, Checkpoint, Parts, Predicted, Prior, Uniform};

struct Args {
    sizes: Vec<usize>,
    noises: Vec<f64>,
    rs: Vec<f64>,
    sigma0s: Vec<f64>,
    reps: usize,
    budget: f64,
    long: f64,
    n_new: usize,
    each_before: f64,
    seed: u64,
    threads: usize,
}

const USAGE: &str = "\
usage: walltare-sim starting <calibrate|cold|arrival> [options]
  --sizes 500              library sizes (arrival: the library before the scan)
  --noise 0.5,1.0          curator noise
  --r 0,0.3,0.5,0.7,0.9    prediction's correlation with true quality
  --sigma0 5.5,6.5,7.5     σ₀ of a predicted starting Score
  --reps 20
  --budget 60              cold: Comparisons per wallpaper on average
  --long 100               calibrate / cold: Each of the run μ is fit on
  --new 125                arrival: wallpapers the scan adds
  --each-before 8          arrival: Each the library is ranked to first
  --seed 1
  --threads <cores>";

fn parse(argv: &[String]) -> Args {
    let mut a = Args {
        sizes: vec![500],
        noises: vec![0.5, 1.0],
        rs: vec![0.0, 0.3, 0.5, 0.7, 0.9],
        sigma0s: vec![5.5, 6.5, 7.5],
        reps: 20,
        budget: 60.0,
        long: 100.0,
        n_new: 125,
        each_before: 8.0,
        seed: 1,
        threads: std::thread::available_parallelism().map_or(4, |n| n.get()),
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
            "--noise" => a.noises = list().map(num).collect(),
            "--r" => a.rs = list().map(num).collect(),
            "--sigma0" => a.sigma0s = list().map(num).collect(),
            "--reps" => a.reps = num(val),
            "--budget" => a.budget = num(val),
            "--long" => a.long = num(val),
            "--new" => a.n_new = num(val),
            "--each-before" => a.each_before = num(val),
            "--seed" => a.seed = num(val),
            "--threads" => a.threads = num(val),
            _ => die(&format!("unknown flag {flag}")),
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
        "calibrate" => calibrate(&args),
        "cold" => cold(&args),
        "arrival" => arrival(&args),
        "-h" | "--help" => println!("{USAGE}"),
        _ => die(&format!("unknown study {study}")),
    }
}

/// Runs `f` over `jobs` on `threads` threads, keeping the order.
fn par_map<J: Sync, T: Send>(jobs: &[J], threads: usize, f: impl Fn(&J) -> T + Sync) -> Vec<T> {
    let out: Mutex<Vec<Option<T>>> = Mutex::new((0..jobs.len()).map(|_| None).collect());
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| loop {
                let k = next.fetch_add(1, Ordering::Relaxed);
                let Some(job) = jobs.get(k) else { break };
                let t = f(job);
                out.lock().unwrap()[k] = Some(t);
            });
        }
    });
    out.into_inner().unwrap().into_iter().map(Option::unwrap).collect()
}

/// Same library per (seed, n, rep) for every prior and noise.
fn job_seed(seed: u64, n: usize, rep: usize) -> u64 {
    seed.wrapping_mul(0x100_0000_01B3) ^ ((n as u64) << 32) ^ rep as u64
}

const BAR: sim::QuantileBar = sim::QuantileBar { share: 0.2 };
const DECIDED: sim::ZSigma = sim::ZSigma { z: 2.0 };

fn parts<'a>(voter: &'a sim::Thurstone, prior: &'a dyn Prior) -> Parts<'a> {
    Parts {
        voter,
        updater: &sim::WinnerBeatsEach,
        prior,
        bar: &BAR,
        decided: &DECIDED,
    }
}

// --- calibrate -------------------------------------------------------------

/// The μ scale: fit μ = a + b·q at several points of long uniform-prior runs.
struct Fit {
    a: f64,
    b: f64,
    r2: f64,
    /// Mean μ per true-quality band, to see whether the map is straight.
    bands: Vec<f64>,
}

const BAND_EDGES: &[f64] = &[-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];

fn fit_at(n: usize, noise: f64, each: f64, reps: usize, seed: u64, threads: usize) -> Vec<Fit> {
    let jobs: Vec<usize> = (0..reps).collect();
    par_map(&jobs, threads, |&rep| {
        let voter = sim::Thurstone { noise };
        let p = parts(&voter, &Uniform);
        let mut sel = selectors::by_name("baseline").unwrap();
        let mut rng = Prng::new(job_seed(seed ^ 0xCA11, n, rep));
        let max = (each * n as f64 / 2.0).ceil() as usize;
        let (_, lib) = sim::run(n, sel.as_mut(), &p, max, max, &mut [], &mut rng);
        let (a, b, r2) = sim::fit_mu_on_quality(&lib, 0..n);
        let mut sums = vec![(0.0, 0usize); BAND_EDGES.len() + 1];
        for i in 0..n {
            let band = BAND_EDGES.iter().filter(|&&e| lib.quality[i] >= e).count();
            sums[band].0 += lib.ratings[i].mu;
            sums[band].1 += 1;
        }
        let bands = sums.iter().map(|&(s, c)| if c > 0 { s / c as f64 } else { f64::NAN }).collect();
        Fit { a, b, r2, bands }
    })
}

fn mean_fit(fits: &[Fit]) -> (f64, f64, f64, f64) {
    let m = fits.len() as f64;
    let a = fits.iter().map(|f| f.a).sum::<f64>() / m;
    let b = fits.iter().map(|f| f.b).sum::<f64>() / m;
    let sd_b = (fits.iter().map(|f| (f.b - b).powi(2)).sum::<f64>() / (m - 1.0).max(1.0)).sqrt();
    let r2 = fits.iter().map(|f| f.r2).sum::<f64>() / m;
    (a, b, sd_b, r2)
}

fn calibrate(args: &Args) {
    println!("## Calibration: μ against true quality q, uniform prior, baseline selector\n");
    println!("Least-squares μ = a + b·q over every wallpaper, averaged over {} libraries. TrueSkill's own model predicts b = β/noise = 4.167/noise.\n", args.reps);
    println!("| n | noise | Each | a | b (± sd) | R² | mean μ in q bands <−2, −2…−1, −1…−.5, −.5…0, 0….5, .5…1, 1…2, ≥2 |");
    println!("|---:|---:|---:|---:|---:|---:|---|");
    for &n in &args.sizes {
        for &noise in &args.noises {
            for each in [8.0, 16.0, 40.0, args.long] {
                let fits = fit_at(n, noise, each, args.reps, args.seed, args.threads);
                let (a, b, sd, r2) = mean_fit(&fits);
                let bands: Vec<String> = (0..=BAND_EDGES.len())
                    .map(|k| {
                        let v: Vec<f64> = fits.iter().map(|f| f.bands[k]).filter(|x| x.is_finite()).collect();
                        format!("{:.1}", v.iter().sum::<f64>() / v.len() as f64)
                    })
                    .collect();
                println!(
                    "| {n} | {noise} | {each} | {a:.2} | {b:.2} ± {sd:.2} | {r2:.3} | {} |",
                    bands.join(", ")
                );
            }
        }
    }
    println!();
}

// --- cold ------------------------------------------------------------------

#[derive(Clone, Copy)]
struct PriorCfg {
    /// None: the uniform 25 / 8.333 of today.
    pred: Option<(f64, f64)>,
}

impl PriorCfg {
    fn label(&self) -> String {
        match self.pred {
            None => "none (25 / 8.333)".into(),
            Some((r, s)) => format!("r {r}, σ₀ {s}"),
        }
    }
}

const SHARES: &[f64] = &[0.5, 0.7, 0.8];

/// Lower median of the first checkpoint reaching `need` Decided, as Each;
/// None when the median run never got there. Also the mean Wrong at that
/// point over the runs that did, and how many did.
fn each_until(
    traces: &[Vec<Checkpoint>],
    n: f64,
    need: usize,
    get: impl Fn(&Checkpoint) -> usize,
) -> (Option<f64>, f64, usize) {
    let mut hits: Vec<&Checkpoint> = traces
        .iter()
        .filter_map(|t| t.iter().find(|cp| get(cp) >= need))
        .collect();
    hits.sort_by_key(|cp| cp.judgements);
    let reached = hits.len();
    let wrong = hits.iter().map(|cp| cp.decided_wrong as f64 / cp.decided.max(1) as f64).sum::<f64>()
        / reached.max(1) as f64;
    let median = hits.get((traces.len() - 1) / 2).map(|cp| 2.0 * cp.comparisons as f64 / n);
    (median, wrong, reached)
}

/// Pooled over runs, at the first checkpoint with at least `each` Comparisons
/// per wallpaper.
fn at_each(traces: &[Vec<Checkpoint>], n: f64, each: f64) -> Checkpoint {
    let target = (each * n / 2.0).round() as usize;
    let mut sum = Checkpoint::default();
    for t in traces {
        if let Some(cp) = t.iter().find(|cp| cp.comparisons >= target) {
            sum.decided += cp.decided;
            sum.decided_wrong += cp.decided_wrong;
            sum.decided_below += cp.decided_below;
            sum.truly_below += cp.truly_below;
        }
    }
    sum
}

fn pct(a: usize, b: usize) -> f64 {
    if b == 0 {
        0.0
    } else {
        100.0 * a as f64 / b as f64
    }
}

/// Highest pooled Wrong over the run, ignoring checkpoints where fewer than
/// 2% of the library is Decided (a handful of Decided makes the rate noise).
fn peak_wrong(traces: &[Vec<Checkpoint>], n: usize) -> f64 {
    let len = traces.iter().map(Vec::len).min().unwrap_or(0);
    (0..len)
        .filter_map(|k| {
            let d: usize = traces.iter().map(|t| t[k].decided).sum();
            let w: usize = traces.iter().map(|t| t[k].decided_wrong).sum();
            (d * 50 >= n * traces.len()).then(|| pct(w, d))
        })
        .fold(0.0, f64::max)
}

fn cold(args: &Args) {
    let mut cfgs = vec![PriorCfg { pred: None }];
    for &s in &args.sigma0s {
        for &r in &args.rs {
            cfgs.push(PriorCfg { pred: Some((r, s)) });
        }
    }
    for &n in &args.sizes {
        for &noise in &args.noises {
            let started = std::time::Instant::now();
            // The μ the ranking converges to, from long uniform runs on other libraries.
            let (a, b, sd, r2) = mean_fit(&fit_at(n, noise, args.long, args.reps, args.seed, args.threads));
            let jobs: Vec<(usize, usize)> =
                (0..cfgs.len()).flat_map(|c| (0..args.reps).map(move |r| (c, r))).collect();
            let traces = par_map(&jobs, args.threads, |&(c, rep)| {
                let voter = sim::Thurstone { noise };
                let prior: Box<dyn Prior> = match cfgs[c].pred {
                    None => Box::new(Uniform),
                    Some((r, sigma0)) => Box::new(Predicted { r, sigma0, mu: a, slope: b }),
                };
                let p = parts(&voter, prior.as_ref());
                let mut sel = selectors::by_name("baseline").unwrap();
                let mut rng = Prng::new(job_seed(args.seed, n, rep));
                let max = (args.budget * n as f64 / 2.0).ceil() as usize;
                sim::run(n, sel.as_mut(), &p, max, (n / 20).max(1), &mut [], &mut rng).0
            });
            let by_cfg: Vec<&[Vec<Checkpoint>]> = traces.chunks(args.reps).collect();

            println!("## Cold library, n = {n}, noise {noise}\n");
            println!(
                "μ scale: μ = {a:.2} + {b:.2}·q (b sd {sd:.2}, R² {r2:.3}; Each {} uniform runs), so μ₀ = {a:.2} + {b:.2}·r·p. {} libraries per row, budget Each {}. {:.1}s.\n",
                args.long,
                args.reps,
                args.budget,
                started.elapsed().as_secs_f64()
            );
            println!("| Prior | Each → 50% | 70% | 80% | Wrong at 50 / 70 / 80% | Peak Wrong | Decided at Each 0 (wrong) | Below/truly below at Each 8 / 16 |");
            println!("|---|---:|---:|---:|---:|---:|---:|---:|");
            let nf = n as f64;
            let base: Vec<Option<f64>> = SHARES
                .iter()
                .map(|&s| each_until(by_cfg[0], nf, (s * nf).ceil() as usize, |cp| cp.decided).0)
                .collect();
            for (c, cfg) in cfgs.iter().enumerate() {
                let t = by_cfg[c];
                let mut eachs = Vec::new();
                let mut wrongs = Vec::new();
                for (k, &s) in SHARES.iter().enumerate() {
                    let (m, w, reached) = each_until(t, nf, (s * nf).ceil() as usize, |cp| cp.decided);
                    eachs.push(match (m, base[k]) {
                        (Some(m), Some(b)) if c > 0 => format!("{m:.1} ({:+.0}%)", 100.0 * (m - b) / b),
                        (Some(m), _) => format!("{m:.1}"),
                        (None, _) => format!("— ({reached}/{})", t.len()),
                    });
                    wrongs.push(if reached > 0 { format!("{:.2}", w * 100.0) } else { "—".into() });
                }
                let e0 = at_each(t, nf, 0.0);
                let e8 = at_each(t, nf, 8.0);
                let e16 = at_each(t, nf, 16.0);
                println!(
                    "| {} | {} | {} | {} | {}% | {:.2}% | {:.1}% ({:.1}%) | {:.1}% / {:.1}% |",
                    cfg.label(),
                    eachs[0],
                    eachs[1],
                    eachs[2],
                    wrongs.join(" / "),
                    peak_wrong(t, n),
                    pct(e0.decided, n * t.len()),
                    pct(e0.decided_wrong, e0.decided),
                    pct(e8.decided_below, e8.truly_below),
                    pct(e16.decided_below, e16.truly_below),
                );
            }
            println!();
        }
    }
}

// --- arrival ---------------------------------------------------------------

fn arrival(args: &Args) {
    let mut cfgs = vec![PriorCfg { pred: None }];
    for &s in &args.sigma0s {
        for &r in &args.rs {
            cfgs.push(PriorCfg { pred: Some((r, s)) });
        }
    }
    let nn = args.n_new;
    for &n in &args.sizes {
        for &noise in &args.noises {
            let started = std::time::Instant::now();
            let jobs: Vec<(usize, usize)> =
                (0..cfgs.len()).flat_map(|c| (0..args.reps).map(move |r| (c, r))).collect();
            let traces = par_map(&jobs, args.threads, |&(c, rep)| {
                let voter = sim::Thurstone { noise };
                let p = parts(&voter, &Uniform);
                let pred = cfgs[c].pred;
                let new_prior = move |a: f64, b: f64| -> Box<dyn Prior> {
                    match pred {
                        None => Box::new(Uniform),
                        Some((r, sigma0)) => Box::new(Predicted { r, sigma0, mu: a, slope: b }),
                    }
                };
                let mut sel = selectors::by_name("baseline").unwrap();
                let mut rng = Prng::new(job_seed(args.seed, n, rep));
                // Enough for the new ones to reach Each 40 if every vote had one.
                let max_after = nn * 20;
                sim::run_arrival(n, nn, args.each_before, sel.as_mut(), &p, &new_prior, max_after, 5, &mut rng)
            });
            let by_cfg: Vec<&[Vec<sim::Arrival>]> = traces.chunks(args.reps).collect();

            // The target: the old wallpapers' Decided share at the scan.
            let old0: Vec<f64> = by_cfg[0].iter().map(|t| t[0].old.decided as f64 / n as f64).collect();
            let target = old0.iter().sum::<f64>() / old0.len() as f64;

            println!("## Arrival, {n} ranked to Each {} then {nn} new, noise {noise}\n", args.each_before);
            println!(
                "The old wallpapers are {:.1}% Decided at the scan. Votes are counted from the scan; \"new Each\" is the new wallpapers' mean Comparisons. {} libraries per row. {:.1}s.\n",
                100.0 * target,
                args.reps,
                started.elapsed().as_secs_f64()
            );
            println!("| New ones' prior | Decided at scan (wrong) | Votes → old's share at scan (new Each) | vs r 0 at same σ₀ | Votes → old's share now | Wrong among new then | Peak Wrong among new |");
            println!("|---|---:|---:|---:|---:|---:|---:|");
            let fixed = |a: &sim::Arrival| a.new.decided as f64 / nn as f64 >= target;
            let moving = |a: &sim::Arrival| a.new.decided as f64 / nn as f64 >= a.old.decided as f64 / n as f64;
            // Per config: the lower-median run's checkpoint reaching each target,
            // how many reached it, and the pooled Wrong among new at that point.
            let summary: Vec<_> = by_cfg
                .iter()
                .map(|t| {
                    [&fixed as &dyn Fn(&sim::Arrival) -> bool, &moving].map(|hit| {
                        let mut hits: Vec<&sim::Arrival> =
                            t.iter().filter_map(|tr| tr.iter().find(|a| hit(a))).collect();
                        hits.sort_by_key(|a| a.judgements);
                        let d: usize = hits.iter().map(|a| a.new.decided).sum();
                        let w: usize = hits.iter().map(|a| a.new.decided_wrong).sum();
                        (hits.get((t.len() - 1) / 2).copied(), hits.len(), pct(w, d))
                    })
                })
                .collect();
            let votes = |c: usize, k: usize| summary[c][k].0.map(|a| a.judgements as f64);
            let rel = |v: Option<f64>, b: Option<f64>| match (v, b) {
                (Some(v), Some(b)) if b > 0.0 => format!("{:+.0}%", 100.0 * (v - b) / b),
                _ => "—".into(),
            };
            for (c, cfg) in cfgs.iter().enumerate() {
                let t = by_cfg[c];
                let cell = |k: usize| match summary[c][k].0 {
                    Some(a) => {
                        let d = if c > 0 { format!(" {}", rel(votes(c, k), votes(0, k))) } else { String::new() };
                        format!("{}{d} ({:.1})", a.judgements, a.new.comparisons_in as f64 / nn as f64)
                    }
                    None => format!("— ({}/{})", summary[c][k].1, t.len()),
                };
                let vs_r0 = match cfg.pred {
                    Some((r, s)) if r != 0.0 => cfgs
                        .iter()
                        .position(|o| o.pred == Some((0.0, s)))
                        .map_or("—".into(), |z| rel(votes(c, 0), votes(z, 0))),
                    _ => "".into(),
                };
                let len = t.iter().map(Vec::len).min().unwrap_or(0);
                let peak = (0..len)
                    .filter_map(|k| {
                        let d: usize = t.iter().map(|tr| tr[k].new.decided).sum();
                        let w: usize = t.iter().map(|tr| tr[k].new.decided_wrong).sum();
                        (d * 20 >= nn * t.len()).then(|| pct(w, d))
                    })
                    .fold(0.0, f64::max);
                let d0: usize = t.iter().map(|tr| tr[0].new.decided).sum();
                let w0: usize = t.iter().map(|tr| tr[0].new.decided_wrong).sum();
                println!(
                    "| {} | {:.1}% ({:.1}%) | {} | {} | {} | {:.2}% | {:.2}% |",
                    cfg.label(),
                    pct(d0, nn * t.len()),
                    pct(w0, d0),
                    cell(0),
                    vs_r0,
                    cell(1),
                    summary[c][0].2,
                    peak,
                );
            }
            println!();
        }
    }
}
