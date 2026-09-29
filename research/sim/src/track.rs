//! Follows one Decided rule through a run, vote by vote: how many wallpapers
//! are Decided and how many on the wrong side, how often a Decided wallpaper
//! goes back to Undecided and what moved it there, and how much attention a
//! wallpaper still gets once it is Decided.
//!
//! A Decided rule never changes what a `Baseline` run shows, so one run can
//! carry a `Tracker` per rule and compare them all on the same votes.

use crate::sim::{Bar, DecidedRule, Library, Observer, Vote};

/// What made a Decided wallpaper Undecided again.
#[derive(Clone, Copy)]
pub enum Cause {
    /// Only the Bar moved it: the wallpaper wasn't shown, or its own new
    /// Rating against the old Bar would still be Decided.
    Bar,
    /// Only its own Rating moved it: the old Rating against the new Bar would
    /// still be Decided.
    Own,
    /// Neither alone would have.
    Both,
}

#[derive(Default)]
pub struct Trace {
    /// After each vote (index 0: before the first): Comparisons so far,
    /// Decided, Decided on the wrong side.
    pub series: Vec<[u32; 3]>,
    pub ever_decided: u32,
    /// Wallpapers that were Decided and later Undecided at least once.
    pub reverted: u32,
    /// Decided → Undecided events, by `Cause` (Bar, Own, Both).
    pub reverts: [u32; 3],
    /// Decided on one side, later Decided on the other.
    pub flips: u32,
    /// For each flip, the wallpaper's own Comparisons while Undecided between
    /// the two sides (0 if it jumped straight across).
    pub flip_gaps: Vec<u32>,
    /// Back to Decided on the same side after a revert: the wallpaper's own
    /// Comparisons while Undecided (0 if only the Bar moved it back).
    pub return_gaps: Vec<u32>,
    /// Ever-Decided wallpapers that end the run Undecided.
    pub undecided_at_end: u32,
    /// How many Scores the Bar rested on when the first wallpaper was Decided.
    pub scored_at_first: Option<usize>,
    /// Wallpapers Decided on the wrong side at some vote while Each ≤ 2.
    pub wrong_early: u32,
    /// Wallpapers Decided on the wrong side at some vote.
    pub wrong_ever: u32,
    /// For each ever-Decided wallpaper: Comparisons it received after it was
    /// first Decided, and that as a share of its fair share (2 per n votes).
    pub after_first: Vec<u32>,
    pub after_ratio: Vec<f64>,
    pub votes: u32,
    /// Votes that showed at least one / two wallpapers Decided at the time.
    pub votes_one_decided: u32,
    pub votes_both_decided: u32,
}

pub struct Tracker {
    pub rule: Box<dyn DecidedRule>,
    side: Vec<Option<bool>>,
    last_side: Vec<Option<bool>>,
    /// (vote, own Comparisons) when first Decided.
    first: Vec<Option<(usize, u32)>>,
    /// Own Comparisons when it last left Decided.
    left_at: Vec<u32>,
    reverted: Vec<bool>,
    wrong_early: Vec<bool>,
    wrong_ever: Vec<bool>,
    pub trace: Trace,
}

impl Tracker {
    pub fn new(rule: Box<dyn DecidedRule>, n: usize) -> Self {
        Self {
            rule,
            side: vec![None; n],
            last_side: vec![None; n],
            first: vec![None; n],
            left_at: vec![0; n],
            reverted: vec![false; n],
            wrong_early: vec![false; n],
            wrong_ever: vec![false; n],
            trace: Trace::default(),
        }
    }

    /// Closes the run and hands back what was measured.
    pub fn finish(mut self, lib: &Library) -> Trace {
        let n = lib.len() as f64;
        let t = &mut self.trace;
        let last = t.votes as usize;
        for (i, first) in self.first.iter().enumerate() {
            let Some((vote, count)) = *first else {
                continue;
            };
            let after = lib.counts[i] - count;
            t.after_first.push(after);
            let fair = 2.0 * (last - vote) as f64 / n;
            if fair >= 1.0 {
                t.after_ratio.push(after as f64 / fair);
            }
        }
        let count = |v: &[bool]| v.iter().filter(|&&b| b).count() as u32;
        t.ever_decided = self.first.iter().filter(|f| f.is_some()).count() as u32;
        t.reverted = count(&self.reverted);
        t.undecided_at_end = self
            .first
            .iter()
            .zip(&self.side)
            .filter(|(f, s)| f.is_some() && s.is_none())
            .count() as u32;
        t.wrong_early = count(&self.wrong_early);
        t.wrong_ever = count(&self.wrong_ever);
        self.trace
    }

    fn cause(&self, lib: &Library, i: usize, vote: &Vote) -> Cause {
        let Some(pos) = vote.shown.iter().position(|&s| s == i) else {
            return Cause::Bar;
        };
        let own_alone = self.rule.side(lib.ratings[i], vote.bar_before).is_none();
        let bar_alone = self.rule.side(vote.before[pos], vote.bar).is_none();
        match (own_alone, bar_alone) {
            (false, true) => Cause::Bar,
            (true, false) => Cause::Own,
            _ => Cause::Both,
        }
    }

    fn sweep(&mut self, lib: &Library, bar: &Bar, vote: Option<&Vote>) {
        let early = vote.map_or(true, |v| v.comparisons <= lib.len());
        let (mut decided, mut wrong) = (0, 0);
        for i in 0..lib.len() {
            let old = self.side[i];
            let new = self.rule.side(lib.ratings[i], bar);
            match (old, new) {
                (Some(_), None) => {
                    let cause = self.cause(lib, i, vote.expect("nothing to revert before a vote"));
                    self.trace.reverts[cause as usize] += 1;
                    self.reverted[i] = true;
                    self.left_at[i] = lib.counts[i];
                }
                (None, Some(s)) => {
                    if self.first[i].is_none() {
                        self.first[i] = Some((vote.map_or(0, |v| v.index), lib.counts[i]));
                    }
                    let gap = lib.counts[i] - self.left_at[i];
                    match self.last_side[i] {
                        Some(last) if last == s => self.trace.return_gaps.push(gap),
                        Some(_) => {
                            self.trace.flips += 1;
                            self.trace.flip_gaps.push(gap);
                        }
                        None => {}
                    }
                }
                (Some(a), Some(b)) if a != b => {
                    self.trace.flips += 1;
                    self.trace.flip_gaps.push(0);
                }
                _ => {}
            }
            if let Some(s) = new {
                self.last_side[i] = Some(s);
                decided += 1;
                if s != lib.truly_below[i] {
                    wrong += 1;
                    self.wrong_ever[i] = true;
                    if early {
                        self.wrong_early[i] = true;
                    }
                }
            }
            self.side[i] = new;
        }
        if decided > 0 && self.trace.scored_at_first.is_none() {
            self.trace.scored_at_first = Some(bar.scored);
        }
        let comparisons = vote.map_or(0, |v| v.comparisons) as u32;
        self.trace.series.push([comparisons, decided, wrong]);
    }
}

impl Observer for Tracker {
    fn start(&mut self, lib: &Library, bar: &Bar) {
        self.sweep(lib, bar, None);
    }

    fn vote(&mut self, lib: &Library, vote: &Vote) {
        // What was Decided when the pair was chosen, before this vote.
        let shown_decided = vote
            .shown
            .iter()
            .filter(|&&i| self.side[i].is_some())
            .count();
        self.trace.votes += 1;
        if shown_decided >= 1 {
            self.trace.votes_one_decided += 1;
        }
        if shown_decided >= 2 {
            self.trace.votes_both_decided += 1;
        }
        self.sweep(lib, vote.bar, Some(vote));
    }
}
