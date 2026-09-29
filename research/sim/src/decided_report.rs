//! `--report decided`: every Decided rule in `--rules` at every k in `--ks`,
//! followed through the same runs, so the rules differ only in the rule.

use crate::sim::{self, Checkpoint, DecidedRule};
use crate::track::Trace;
use crate::{selectors, voter, Args, Config};

pub const RULES: &[&str] = &["plain", "warmup", "participated", "bar-sigma"];

/// One rule per (rule, k), rules outermost, in the order `labels` gives.
pub fn rules(args: &Args, n: usize) -> Vec<Box<dyn DecidedRule>> {
    let mut out: Vec<Box<dyn DecidedRule>> = Vec::new();
    for rule in &args.rules {
        for &z in &args.ks {
            out.push(match rule.as_str() {
                "plain" => Box::new(sim::ZSigma { z }),
                "warmup" => Box::new(sim::Warmup {
                    z,
                    min_scored: args.warmup,
                }),
                "participated" => Box::new(sim::Warmup { z, min_scored: n }),
                "bar-sigma" => Box::new(sim::BarSigma { z }),
                _ => unreachable!("checked in parse"),
            });
        }
    }
    out
}

fn labels(args: &Args) -> Vec<(String, f64)> {
    let mut out = Vec::new();
    for rule in &args.rules {
        let name = match rule.as_str() {
            "warmup" => format!("warmup {}", args.warmup),
            r => r.to_string(),
        };
        for &z in &args.ks {
            out.push((name.clone(), z));
        }
    }
    out
}

const EACH: &[f64] = &[4.0, 8.0, 16.0, 40.0];
const YOUNG_EACH: &[f64] = &[1.0, 2.0];

pub fn print(
    args: &Args,
    configs: &[Config],
    results: &[Vec<(Vec<Checkpoint>, Vec<Trace>)>],
    bar: String,
    elapsed: f64,
) {
    println!("# Decided rules\n");
    println!(
        "Voter {}, Bar {}, prior uniform, update winner-beats-each. {} libraries per row, budget {} Comparisons per wallpaper, seed {}. Every rule is followed through the same runs. {:.1}s.\n",
        args.voter, bar, args.reps, args.budget, args.seed, elapsed
    );
    let labels = labels(args);
    for (cfg, runs) in configs.iter().zip(results) {
        let name = selectors::by_name(&cfg.selector).unwrap().name();
        println!(
            "## n = {}, {}, {}\n",
            cfg.n,
            name,
            voter(&args.voter, cfg.noise).name()
        );
        let per_rule: Vec<Vec<&Trace>> = (0..labels.len())
            .map(|r| runs.iter().map(|(_, traces)| &traces[r]).collect())
            .collect();
        speed(cfg.n, &labels, &per_rule);
        young(cfg.n, &labels, &per_rule);
        reversion(cfg.n, &labels, &per_rule);
        attention(&labels, &per_rule);
    }
}

/// The first point in a run's series at or past `each` Comparisons per wallpaper.
fn at_each(t: &Trace, n: usize, each: f64) -> Option<&[u32; 3]> {
    let target = (each * n as f64 / 2.0).round() as u32;
    t.series.iter().find(|p| p[0] >= target)
}

/// Pooled wrong-side rate: wrong over Decided, summed across runs.
fn pooled_wrong<'a>(points: impl Iterator<Item = &'a [u32; 3]>) -> String {
    let (d, w) = points.fold((0u64, 0u64), |(d, w), p| (d + p[1] as u64, w + p[2] as u64));
    if d == 0 {
        "—".into()
    } else {
        format!("{:.2}%", 100.0 * w as f64 / d as f64)
    }
}

/// Lower median over runs of the vote at which `share` of the library was
/// first Decided; runs that never got there sort last.
fn votes_to(traces: &[&Trace], n: usize, share: f64) -> String {
    let need = (share * n as f64).ceil() as u32;
    let mut hits: Vec<Option<(usize, u32)>> = traces
        .iter()
        .map(|t| {
            t.series
                .iter()
                .enumerate()
                .find(|(_, p)| p[1] >= need)
                .map(|(v, p)| (v, p[0]))
        })
        .collect();
    let reached = hits.iter().filter(|h| h.is_some()).count();
    hits.sort_by_key(|h| h.map_or(usize::MAX, |(v, _)| v));
    let tail = if reached < traces.len() {
        format!(" ({}/{})", reached, traces.len())
    } else {
        String::new()
    };
    match hits[(hits.len() - 1) / 2] {
        Some((v, c)) => format!("{} | {:.1}{}", v, 2.0 * c as f64 / n as f64, tail),
        None => format!("— | —{tail}"),
    }
}

fn speed(n: usize, labels: &[(String, f64)], per_rule: &[Vec<&Trace>]) {
    println!("Votes (median) and Each until 50% and 70% Decided; wrong-side share of the Decided at each Each, pooled over runs.\n");
    print!("| Rule | k | 50% votes | Each | 70% votes | Each |");
    for e in EACH {
        print!(" Wrong @{e} |");
    }
    println!(
        "\n|---|---:|---:|---:|---:|---:|{}",
        "---:|".repeat(EACH.len())
    );
    for ((rule, k), traces) in labels.iter().zip(per_rule) {
        print!(
            "| {rule} | {k} | {} | {} |",
            votes_to(traces, n, 0.5),
            votes_to(traces, n, 0.7)
        );
        for &e in EACH {
            print!(
                " {} |",
                pooled_wrong(traces.iter().filter_map(|t| at_each(t, n, e)))
            );
        }
        println!();
    }
    println!();
}

fn young(n: usize, labels: &[(String, f64)], per_rule: &[Vec<&Trace>]) {
    println!("Young library (Each ≤ 2). \"Wrong ≤2\" pools every vote up to Each 2. \"Ever wrong\" counts wallpapers Decided on the wrong side at any vote, per 100 wallpapers.\n");
    print!("| Rule | k |");
    for e in YOUNG_EACH {
        print!(" Decided @{e} | Wrong @{e} |");
    }
    println!(" Wrong ≤2 | Ever wrong ≤2 | Ever wrong, whole run | Scores under the Bar at first Decided |");
    println!("|---|---:|{}", "---:|".repeat(2 * YOUNG_EACH.len() + 4));
    let runs = |traces: &[&Trace]| traces.len() as f64;
    for ((rule, k), traces) in labels.iter().zip(per_rule) {
        print!("| {rule} | {k} |");
        for &e in YOUNG_EACH {
            let pts: Vec<_> = traces.iter().filter_map(|t| at_each(t, n, e)).collect();
            let decided = pts.iter().map(|p| p[1] as f64).sum::<f64>() / pts.len() as f64;
            print!(
                " {:.1}% | {} |",
                100.0 * decided / n as f64,
                pooled_wrong(pts.into_iter())
            );
        }
        let early = traces
            .iter()
            .flat_map(|t| t.series.iter().take_while(|p| p[0] as usize <= n));
        let per_100 = |f: &dyn Fn(&Trace) -> u32| {
            100.0 * traces.iter().map(|t| f(t) as f64).sum::<f64>() / runs(traces) / n as f64
        };
        let mut first: Vec<usize> = traces.iter().filter_map(|t| t.scored_at_first).collect();
        first.sort_unstable();
        println!(
            " {} | {:.2} | {:.2} | {} |",
            pooled_wrong(early),
            per_100(&|t| t.wrong_early),
            per_100(&|t| t.wrong_ever),
            match (first.first(), first.last()) {
                (Some(lo), Some(hi)) => format!("{lo}–{hi}"),
                _ => "—".into(),
            }
        );
    }
    println!();
}

fn reversion(n: usize, labels: &[(String, f64)], per_rule: &[Vec<&Trace>]) {
    println!("Reversion over the whole run. \"Reverted\" is the share of ever-Decided wallpapers that were later Undecided at least once; events are Decided → Undecided, split by what moved (Bar only, own Rating only, both). \"Back ≤2\" is the share of reverts that were Decided again on the same side within 2 of their own Comparisons (\"by Bar\": with none, the Bar moved back). A flip is Decided on one side, later on the other; \"quick\" flips spent ≤ 2 of their own Comparisons Undecided in between.\n");
    println!("| Rule | k | Ever Decided | Reverted | Undecided at end | Events /100 votes | Bar | Own | Both | Back ≤2 | Back by Bar | Flips (of ever-Decided) | Quick flips | Median flip gap |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for ((rule, k), traces) in labels.iter().zip(per_rule) {
        let sum = |f: &dyn Fn(&Trace) -> u32| traces.iter().map(|t| f(t) as f64).sum::<f64>();
        let ever = sum(&|t| t.ever_decided);
        let votes = sum(&|t| t.votes);
        let events: [f64; 3] = std::array::from_fn(|c| sum(&|t| t.reverts[c]));
        let total = events.iter().sum::<f64>();
        let mut gaps: Vec<u32> = traces
            .iter()
            .flat_map(|t| t.flip_gaps.iter().copied())
            .collect();
        gaps.sort_unstable();
        let quick = gaps.iter().filter(|&&g| g <= 2).count();
        let back: Vec<u32> = traces
            .iter()
            .flat_map(|t| t.return_gaps.iter().copied())
            .collect();
        let back_quick = back.iter().filter(|&&g| g <= 2).count() as f64;
        let back_bar = back.iter().filter(|&&g| g == 0).count() as f64;
        let pct = |x: f64, of: f64| {
            if of > 0.0 {
                format!("{:.1}%", 100.0 * x / of)
            } else {
                "—".into()
            }
        };
        println!(
            "| {rule} | {k} | {:.1}% | {} | {} | {:.2} | {} | {} | {} | {} | {} | {} | {} | {} |",
            100.0 * ever / (traces.len() * n) as f64,
            pct(sum(&|t| t.reverted), ever),
            pct(sum(&|t| t.undecided_at_end), ever),
            100.0 * total / votes,
            pct(events[0], total),
            pct(events[1], total),
            pct(events[2], total),
            pct(back_quick, total),
            pct(back_bar, total),
            pct(gaps.len() as f64, ever),
            pct(quick as f64, gaps.len() as f64),
            gaps.get(gaps.len().saturating_sub(1) / 2)
                .map_or("—".into(), |g| g.to_string()),
        );
    }
    println!();
}

fn attention(labels: &[(String, f64)], per_rule: &[Vec<&Trace>]) {
    println!("Attention after Decided. Comparisons a wallpaper received after it was first Decided (median, and share with none), and that against its fair share of the votes left (1.0 = as much as anyone; only wallpapers with at least one fair Comparison left). Also the share of votes that showed a wallpaper already Decided.\n");
    println!("| Rule | k | Median after | None after | Median vs fair | Votes with ≥1 Decided | Votes with both Decided |");
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for ((rule, k), traces) in labels.iter().zip(per_rule) {
        let mut after: Vec<u32> = traces
            .iter()
            .flat_map(|t| t.after_first.iter().copied())
            .collect();
        after.sort_unstable();
        let mut ratio: Vec<f64> = traces
            .iter()
            .flat_map(|t| t.after_ratio.iter().copied())
            .collect();
        ratio.sort_by(f64::total_cmp);
        let votes: f64 = traces.iter().map(|t| t.votes as f64).sum();
        let share = |f: &dyn Fn(&Trace) -> u32| {
            format!(
                "{:.1}%",
                100.0 * traces.iter().map(|t| f(t) as f64).sum::<f64>() / votes
            )
        };
        let none = after.iter().filter(|&&a| a == 0).count();
        println!(
            "| {rule} | {k} | {} | {} | {} | {} | {} |",
            after
                .get(after.len().saturating_sub(1) / 2)
                .map_or("—".into(), |a| a.to_string()),
            if after.is_empty() {
                "—".into()
            } else {
                format!("{:.1}%", 100.0 * none as f64 / after.len() as f64)
            },
            ratio
                .get(ratio.len().saturating_sub(1) / 2)
                .map_or("—".into(), |r| format!("{r:.2}")),
            share(&|t| t.votes_one_decided),
            share(&|t| t.votes_both_decided),
        );
    }
    println!();
}
