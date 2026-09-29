//! Selectors. Add a new strategy here and name it in `by_name`.

use crate::prng::Prng;
use crate::ranking;
use crate::sim::{DecidedRule, Library, Selector};

pub fn by_name(name: &str) -> Option<Box<dyn Selector>> {
    match name {
        "baseline" => Some(Box::new(Baseline::default())),
        "random" => Some(Box::new(RandomPair)),
        _ => None,
    }
}

pub const NAMES: &[&str] = &["baseline", "random"];

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
    fn select(&mut self, lib: &Library, _bar: f64, _: &dyn DecidedRule, rng: &mut Prng) -> Vec<usize> {
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
    fn select(&mut self, lib: &Library, _bar: f64, _: &dyn DecidedRule, rng: &mut Prng) -> Vec<usize> {
        let n = lib.len();
        let a = rng.below(n);
        let mut b = rng.below(n - 1);
        if b >= a {
            b += 1;
        }
        vec![a, b]
    }
}
