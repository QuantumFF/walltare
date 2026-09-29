//! Votes-until-Decided simulator. See `research/sim/README.md`.

#[path = "../../../src-tauri/src/ranking.rs"]
#[allow(dead_code)]
mod ranking;

mod prng;
mod selectors;
mod sim;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use prng::Prng;
use sim::{BarRule, Checkpoint, DecidedRule, Parts, Voter};

struct Args {
    sizes: Vec<usize>,
    selectors: Vec<String>,
    voter: String,
    noises: Vec<f64>,
    bar_share: f64,
    z: f64,
    reps: usize,
    budget: f64,
    seed: u64,
    threads: usize,
}

const USAGE: &str = "\
usage: walltare-sim [options]
  --sizes 120,500,2000     library sizes
  --selector baseline      comma list of: baseline, random
  --voter thurstone        thurstone | bradley-terry
  --noise 0.5              comma list; curator noise in units of the quality spread
  --bar-share 0.2          the Bar clears out the worst share of the Scored
  --z 2                    Decided when |μ − Bar| ≥ z·σ
  --reps 20                replicate libraries per configuration
  --budget 40              stop at this many Comparisons per wallpaper on average
  --seed 1
  --threads <cores>";

fn parse() -> Args {
    let mut a = Args {
        sizes: vec![120, 500, 2000],
        selectors: vec!["baseline".into()],
        voter: "thurstone".into(),
        noises: vec![0.5],
        bar_share: 0.2,
        z: 2.0,
        reps: 20,
        budget: 40.0,
        seed: 1,
        threads: std::thread::available_parallelism().map_or(4, |n| n.get()),
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut it = argv.iter();
    while let Some(flag) = it.next() {
        if flag == "-h" || flag == "--help" {
            println!("{USAGE}");
            std::process::exit(0);
        }
        let val = it.next().unwrap_or_else(|| die(&format!("{flag} needs a value")));
        let list = || val.split(',').map(str::trim).filter(|s| !s.is_empty());
        match flag.as_str() {
            "--sizes" => a.sizes = list().map(|s| num(s)).collect(),
            "--selector" => a.selectors = list().map(String::from).collect(),
            "--voter" => a.voter = val.clone(),
            "--noise" => a.noises = list().map(|s| num(s)).collect(),
            "--bar-share" => a.bar_share = num(val),
            "--z" => a.z = num(val),
            "--reps" => a.reps = num(val),
            "--budget" => a.budget = num(val),
            "--seed" => a.seed = num(val),
            "--threads" => a.threads = num(val),
            _ => die(&format!("unknown flag {flag}")),
        }
    }
    for s in &a.selectors {
        if selectors::by_name(s).is_none() {
            die(&format!("unknown selector {s}; have {:?}", selectors::NAMES));
        }
    }
    if a.sizes.iter().any(|&n| n < 4) {
        die("sizes must be at least 4");
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

fn voter(name: &str, noise: f64) -> Box<dyn Voter> {
    match name {
        "thurstone" => Box::new(sim::Thurstone { noise }),
        "bradley-terry" | "bt" => Box::new(sim::BradleyTerry { noise }),
        _ => die(&format!("unknown voter {name}")),
    }
}

/// Same library for every selector and noise at a given (size, rep), so the
/// comparison between strategies isn't swamped by which library was drawn.
fn job_seed(seed: u64, n: usize, rep: usize) -> u64 {
    seed.wrapping_mul(0x100_0000_01B3) ^ ((n as u64) << 32) ^ rep as u64
}

struct Config {
    n: usize,
    selector: String,
    noise: f64,
}

fn main() {
    let args = parse();
    let bar = sim::QuantileBar {
        share: args.bar_share,
    };
    let decided = sim::ZSigma { z: args.z };
    let updater = sim::WinnerBeatsEach;
    let prior = sim::Uniform;

    let mut configs = Vec::new();
    for &n in &args.sizes {
        for &noise in &args.noises {
            for s in &args.selectors {
                configs.push(Config {
                    n,
                    selector: s.clone(),
                    noise,
                });
            }
        }
    }
    let voters: Vec<Box<dyn Voter>> = args.noises.iter().map(|&s| voter(&args.voter, s)).collect();

    let jobs: Vec<(usize, usize)> = (0..configs.len())
        .flat_map(|c| (0..args.reps).map(move |r| (c, r)))
        .collect();
    let results: Mutex<Vec<Vec<Vec<Checkpoint>>>> =
        Mutex::new((0..configs.len()).map(|_| Vec::new()).collect());
    let next = AtomicUsize::new(0);
    let started = std::time::Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..args.threads.max(1) {
            scope.spawn(|| loop {
                let k = next.fetch_add(1, Ordering::Relaxed);
                let Some(&(c, rep)) = jobs.get(k) else { break };
                let cfg = &configs[c];
                let noise_idx = args.noises.iter().position(|&x| x == cfg.noise).unwrap();
                let parts = Parts {
                    voter: voters[noise_idx].as_ref(),
                    updater: &updater,
                    prior: &prior,
                    bar: &bar,
                    decided: &decided,
                };
                let mut selector = selectors::by_name(&cfg.selector).unwrap();
                let mut rng = Prng::new(job_seed(args.seed, cfg.n, rep));
                let max = (args.budget * cfg.n as f64 / 2.0).ceil() as usize;
                let every = (cfg.n / 20).max(1);
                let trace = sim::run(cfg.n, selector.as_mut(), &parts, max, every, &mut rng);
                results.lock().unwrap()[c].push(trace);
            });
        }
    });
    let results = results.into_inner().unwrap();

    println!("# Votes until Decided\n");
    println!(
        "Voter {}, Bar {}, Decided when {}, prior {}, update {}. {} libraries per row, budget {} Comparisons per wallpaper, seed {}. {:.1}s.\n",
        args.voter,
        bar.name(),
        decided.name(),
        sim::Prior::name(&prior),
        sim::Updater::name(&updater),
        args.reps,
        args.budget,
        args.seed,
        started.elapsed().as_secs_f64()
    );
    println!("\"Each\" is the mean number of Comparisons per wallpaper, which is roughly the Round.");
    println!("\"Wrong\" is the share of Decided wallpapers sitting on the side the truth says they don't belong on.\n");
    for (cfg, traces) in configs.iter().zip(&results) {
        report(cfg, traces, &args);
    }
}

const SHARES: &[f64] = &[0.25, 0.5, 0.6, 0.7, 0.8];
const EACH: &[f64] = &[1.0, 2.0, 4.0, 8.0, 12.0, 16.0, 24.0, 32.0, 40.0];

fn report(cfg: &Config, traces: &[Vec<Checkpoint>], args: &Args) {
    let name = selectors::by_name(&cfg.selector).unwrap().name();
    let n = cfg.n as f64;
    println!("## n = {}, {}, {}\n", cfg.n, name, voter(&args.voter, cfg.noise).name());

    println!("| Decided | Votes (median) | Each | Reached | Wrong |");
    println!("|---:|---:|---:|---:|---:|");
    for &share in SHARES {
        let need = (share * n).ceil() as usize;
        let mut hits: Vec<&Checkpoint> = traces
            .iter()
            .filter_map(|t| t.iter().find(|cp| cp.decided >= need))
            .collect();
        let reached = hits.len();
        hits.sort_by_key(|cp| cp.judgements);
        // Lower median, with runs that never got there counted as never.
        let median = hits.get((traces.len() - 1) / 2);
        let wrong = if reached > 0 {
            hits.iter()
                .map(|cp| cp.decided_wrong as f64 / cp.decided as f64)
                .sum::<f64>()
                / reached as f64
        } else {
            f64::NAN
        };
        match median {
            Some(cp) => println!(
                "| {:.0}% | {} | {:.1} | {}/{} | {:.2}% |",
                share * 100.0,
                cp.judgements,
                2.0 * cp.comparisons as f64 / n,
                reached,
                traces.len(),
                wrong * 100.0
            ),
            None => println!(
                "| {:.0}% | not within budget | — | {}/{} | {} |",
                share * 100.0,
                reached,
                traces.len(),
                if reached > 0 { format!("{:.2}%", wrong * 100.0) } else { "—".into() }
            ),
        }
    }
    println!();

    println!("| Each | Votes | Decided | Wrong | Decided below / truly below | Evaluated | Mean σ |");
    println!("|---:|---:|---:|---:|---:|---:|---:|");
    for &each in EACH.iter().filter(|&&e| e <= args.budget) {
        let target = (each * n / 2.0).round() as usize;
        let at: Vec<&Checkpoint> = traces
            .iter()
            .filter_map(|t| t.iter().find(|cp| cp.comparisons >= target))
            .collect();
        if at.is_empty() {
            continue;
        }
        let mean = |f: &dyn Fn(&Checkpoint) -> f64| at.iter().map(|cp| f(cp)).sum::<f64>() / at.len() as f64;
        println!(
            "| {} | {:.0} | {:.1}% | {:.2}% | {:.1}% | {:.1}% | {:.2} |",
            each,
            mean(&|cp| cp.judgements as f64),
            mean(&|cp| cp.decided as f64 / n) * 100.0,
            mean(&|cp| if cp.decided > 0 { cp.decided_wrong as f64 / cp.decided as f64 } else { 0.0 }) * 100.0,
            mean(&|cp| cp.decided_below as f64 / cp.truly_below as f64) * 100.0,
            mean(&|cp| cp.evaluated as f64 / n) * 100.0,
            mean(&|cp| cp.sigma_sum / n),
        );
    }
    println!();
}
