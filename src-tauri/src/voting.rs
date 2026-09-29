//! Persistence seam for the voting loop: pair fetching, vote application,
//! and stats — all taking a plain connection handle so they are testable
//! against an initialized in-memory SQLite database.
//!
//! Eligibility: Status ∈ {Active, Kept}; Rejected sits out. Rating updates
//! and pair selection delegate to the pure `ranking` module. A vote applies
//! the TrueSkill update, increments both `comparisons_count`, and inserts the
//! permanent Comparison row in one transaction.

use rusqlite::Connection;

use crate::bar::Side;
use crate::db;
use crate::error::AppError;
use crate::near_duplicates;
use crate::ranking::{self, Rng};

/// A pair holds two rows of the shape every listing already serves, so it uses
/// `db`'s type and `db`'s reader rather than a second copy of the column list.
/// `origin_path` is structurally `None` on both — only a Rejected wallpaper has
/// an Origin, and a pair only ever holds eligible ones.
pub use crate::db::Wallpaper;

/// Progress snapshot for the rank headline. Every count is measured against
/// the Eligible pool, so rejecting wallpapers cannot drag progress down.
///
/// `total_wallpapers` is the exception and counts every row: the boot gate reads
/// it to tell an empty library from a populated one, and narrowing it would
/// strand a user whose library is entirely Rejected.
///
/// Worked out on every call and never stored (ADR 0059), so the Undecided count
/// moves whichever way the Bar and the Scores do.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Stats {
    pub total_wallpapers: u32,
    pub eligible_count: u32,
    /// Eligible wallpapers the app is not yet sure which side of the Bar they
    /// fall on, Unrated included (ADR 0058).
    pub undecided_count: u32,
    /// The Undecided ones that are Close calls. Once it matches
    /// `undecided_count`, nothing is left to decide and Rank suggests Review
    /// (ADR 0060).
    pub close_call_count: u32,
    /// Eligible wallpapers Decided below and above the Bar. With
    /// `undecided_count` they add up to `eligible_count` (ADR 0059).
    pub decided_below_count: u32,
    pub decided_above_count: u32,
    pub total_comparisons: u32,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct VoteOutcome {
    /// `None` when the vote was recorded but the follow-up fetch failed; the
    /// client re-fetches rather than treating a committed vote as an error.
    pub next_pair: Option<[Wallpaper; 2]>,
    pub stats: Stats,
}

/// Picks two eligible wallpapers via the pure pair-selection module.
///
/// The two are shuffled before returning. `select_pair` always yields its
/// first pick first, and the UI renders slot 0 on the left, so without this the
/// left side is systematically the newer or less-compared wallpaper — feeding
/// the well-known left-position bias of pairwise comparison straight into the
/// ratings the app exists to measure.
///
/// `exclude` keeps the wallpapers the user is already looking at out of the
/// draw. Without it, against a 120-wallpaper library, 4% of successive pairs
/// reused one of them: the pane does not appear to change, so the user re-picks
/// the same wallpaper and the Comparison is worthless. `select_pair` ignores it
/// when honouring it would leave fewer than two candidates, so a small library
/// still ranks.
///
/// An unanswered Near-duplicate pair is never drawn together, since a vote
/// between two Near-duplicates says nothing about where either stands.
///
/// The Bar, the latest Comparisons and the unanswered Near-duplicate pairs are
/// read here on every draw, never held as state (ADR 0060).
pub fn get_pair<R: Rng>(
    conn: &Connection,
    exclude: &[i64],
    rng: &mut R,
) -> Result<[Wallpaper; 2], AppError> {
    let pool = eligible_summaries(conn)?;
    let bar = bar(conn)?;
    let (pairs, last_was_a_first) = recent_comparisons(conn)?;
    let recent = ranking::Recent {
        pairs: &pairs,
        last_was_a_first,
    };
    let unanswered = near_duplicates::unanswered_pairs(conn)?;
    let apart = |a, b| unanswered.contains(a, b);
    let (first, second) = ranking::select_pair(&pool, bar, recent, exclude, &apart, rng)
        .ok_or_else(|| {
            AppError::NotEnoughWallpapers(format!(
                "pair selection needs two eligible wallpapers that are not an unanswered \
                 Near-duplicate pair, found {} eligible",
                pool.len()
            ))
        })?;
    let (first, second) = if rng.next_f64() < 0.5 {
        (first, second)
    } else {
        (second, first)
    };
    Ok([
        db::get_wallpaper(conn, first.id)?,
        db::get_wallpaper(conn, second.id)?,
    ])
}

/// The latest [`ranking::REPEAT_WINDOW`] Comparisons, newest first, and
/// whether the latest was the first for either of its wallpapers.
///
/// "Its first" reads `comparisons_count`, which the vote that inserted the row
/// raised in the same transaction: a count of one means that row is the only
/// Comparison the wallpaper has. `comparisons` has no index on its two ids, so
/// looking for an earlier row would scan the whole record on every pair.
fn recent_comparisons(conn: &Connection) -> Result<(Vec<[i64; 2]>, bool), AppError> {
    let mut stmt = conn
        .prepare_cached("SELECT winner_id, loser_id FROM comparisons ORDER BY id DESC LIMIT ?1")?;
    let pairs = stmt
        .query_map([ranking::REPEAT_WINDOW as i64], |r| {
            Ok([r.get(0)?, r.get(1)?])
        })?
        .collect::<Result<Vec<[i64; 2]>, _>>()?;
    let last_was_a_first = match pairs.first() {
        Some(&[a, b]) => conn.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM wallpapers WHERE id IN (?1, ?2) AND comparisons_count = 1
             )",
            [a, b],
            |r| r.get(0),
        )?,
        None => false,
    };
    Ok((pairs, last_was_a_first))
}

/// Applies a vote atomically, then returns the next pair with fresh stats.
///
/// In one transaction: validates both ids are eligible, updates μ/σ via
/// `ranking::rate_1vs1`, increments both `comparisons_count`, and inserts
/// the permanent Comparison row. Any failure rolls everything back.
pub fn vote<R: Rng>(
    conn: &Connection,
    winner_id: i64,
    loser_id: i64,
    exclude: &[i64],
    rng: &mut R,
) -> Result<VoteOutcome, AppError> {
    let tx = conn.unchecked_transaction()?;
    let winner = fetch_summary(&tx, winner_id)?;
    let loser = fetch_summary(&tx, loser_id)?;
    if winner.id == loser.id {
        // A caller's mistake rather than a fact about the wallpaper: nothing
        // about it is unknown, and it is not a Status transition either
        // (ADR 0025).
        return Err(AppError::BadRequest(format!(
            "winner and loser must be distinct, got {winner_id} twice"
        )));
    }

    let (new_winner, new_loser) = ranking::rate_1vs1(
        ranking::Rating::new(winner.rating_mu, winner.rating_sigma),
        ranking::Rating::new(loser.rating_mu, loser.rating_sigma),
    );

    for (rating, id) in [(new_winner, winner_id), (new_loser, loser_id)] {
        tx.execute(
            "UPDATE wallpapers
             SET rating_mu = ?1, rating_sigma = ?2, comparisons_count = comparisons_count + 1
             WHERE id = ?3",
            rusqlite::params![rating.mu, rating.sigma, id],
        )?;
    }
    tx.execute(
        "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
        rusqlite::params![winner_id, loser_id],
    )?;
    tx.commit()?;

    // The Comparison is durable from here on, so the follow-up pair fetch must
    // not surface as a failed vote — it has a genuine logical failure mode
    // (`NotEnoughWallpapers`) that says nothing about whether the vote counted.
    // `get_stats` stays fatal: a handful of `SELECT`s only fail if the
    // database itself is gone, at which point an error is the honest answer.
    //
    // The two just voted on are always excluded: showing either of them again
    // straight away is the case the user reads as "nothing happened".
    let mut skip = vec![winner_id, loser_id];
    skip.extend_from_slice(exclude);
    let next_pair = get_pair(conn, &skip, rng).ok();
    let stats = get_stats(conn)?;
    Ok(VoteOutcome { next_pair, stats })
}

pub fn get_stats(conn: &Connection) -> Result<Stats, AppError> {
    let total_wallpapers: u32 =
        conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |r| r.get(0))?;
    let total_comparisons: u32 =
        conn.query_row("SELECT COUNT(*) FROM comparisons", [], |r| r.get(0))?;

    // Decided reads the Bar, which SQL cannot work out, so these count in
    // Rust over the pool pair selection reads. The Eligible count is that pool's
    // size, so the three sides add up to it by construction.
    let bar = bar(conn)?;
    let pool = eligible_summaries(conn)?;
    let eligible_count = u32::try_from(pool.len()).unwrap_or(u32::MAX);
    let (mut undecided_count, mut decided_below_count, mut decided_above_count) = (0u32, 0, 0);
    let mut close_call_count = 0u32;
    for w in &pool {
        match w.decided(bar) {
            None => undecided_count += 1,
            Some(Side::Below) => decided_below_count += 1,
            Some(Side::Above) => decided_above_count += 1,
        }
        if w.is_close_call(bar) {
            close_call_count += 1;
        }
    }
    Ok(Stats {
        total_wallpapers,
        eligible_count,
        undecided_count,
        close_call_count,
        decided_below_count,
        decided_above_count,
        total_comparisons,
    })
}

/// The Bar as it stands: the Score at the curator's share among every wallpaper
/// with a Score, whatever its Status, or nothing when no wallpaper has one.
///
/// Worked out on every call and never stored (ADR 0056). Rejected rows count on
/// purpose: their frozen Scores are what keep a soft reject below the Bar from
/// lifting it. The share is read here rather than passed in, so every reader
/// of the Bar reads it against the same row.
pub fn bar(conn: &Connection) -> Result<Option<f64>, AppError> {
    let share = crate::settings::bar_share(conn)?;
    let mut stmt =
        conn.prepare_cached("SELECT rating_mu FROM wallpapers WHERE comparisons_count > 0")?;
    let scores = stmt
        .query_map([], |row| row.get::<_, f64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(crate::bar::bar(&scores, share))
}

fn eligible_summaries(conn: &Connection) -> Result<Vec<ranking::WallpaperSummary>, AppError> {
    // No ORDER BY: `select_pair` scans for a minimum and indexes by RNG draw,
    // so row order isn't load-bearing, and sorting the whole library costs a
    // temp B-tree on every pair fetch.
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT id, rating_mu, rating_sigma, comparisons_count, status
         FROM wallpapers WHERE {}",
        db::Status::ELIGIBLE_SQL,
    ))?;
    let rows = stmt.query_map([], |row| {
        Ok(ranking::WallpaperSummary {
            id: row.get(0)?,
            rating_mu: row.get(1)?,
            rating_sigma: row.get(2)?,
            comparisons_count: count_u32(row.get::<_, i64>(3)?),
            kept: db::Status::read(&row.get::<_, String>(4)?) == db::Status::Kept,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One wallpaper's rating, refused unless it is in the pool voting draws from.
///
/// It builds the summary from the shared row read rather than from a query of
/// its own, which is what lets `Status::is_eligible` apply to a typed column
/// instead of to a string this selected itself (ADR 0024, ADR 0025). A missing
/// id therefore answers `NotFound`, the one answer for a row that is not there.
///
/// `UnknownWallpaper` survives for the refusal below alone: a wallpaper that
/// exists, is Rejected, and sits out of voting. That is a refusal about a real
/// row, so `NotFound` would hide a state — and it is the frontend's signal to
/// fetch a new pair rather than to correct a row.
fn fetch_summary(conn: &Connection, id: i64) -> Result<ranking::WallpaperSummary, AppError> {
    let row = db::get_wallpaper(conn, id)?;
    if !row.status.is_eligible() {
        return Err(AppError::UnknownWallpaper(format!(
            "wallpaper {id} is rejected and sits out of voting"
        )));
    }
    Ok(ranking::WallpaperSummary {
        id: row.id,
        rating_mu: row.rating_mu,
        rating_sigma: row.rating_sigma,
        comparisons_count: count_u32(row.comparisons_count),
        kept: row.status == db::Status::Kept,
    })
}

fn count_u32(v: i64) -> u32 {
    v.try_into().unwrap_or(u32::MAX)
}

/// Std-only PRNG (splitmix64) seeded from clock and process id, implementing
/// `ranking::Rng` for production use.
pub struct SystemRng(u64);

impl SystemRng {
    pub fn new() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos() as u64);
        Self(nanos ^ u64::from(std::process::id()).rotate_left(32))
    }
}

impl Default for SystemRng {
    fn default() -> Self {
        Self::new()
    }
}

impl Rng for SystemRng {
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        // Top 53 bits into the f64 mantissa: uniform in [0, 1).
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ranking::{MU, SIGMA};
    use rusqlite::params;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEED_SEQ: AtomicU64 = AtomicU64::new(0);

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::init_schema(&conn).unwrap();
        conn
    }

    /// Inserts a wallpaper row directly, returning its id.
    fn seed_on(conn: &Connection, status: &str, mu: f64, sigma: f64, count: i64) -> i64 {
        let n = SEED_SEQ.fetch_add(1, Ordering::SeqCst);
        conn.execute(
            "INSERT INTO wallpapers (filename, path, status, rating_mu, rating_sigma, comparisons_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                format!("w{n}.jpg"),
                format!("/w/w{n}.jpg"),
                status,
                mu,
                sigma,
                count
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_comparison(conn: &Connection, winner_id: i64, loser_id: i64) {
        conn.execute(
            "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
            params![winner_id, loser_id],
        )
        .unwrap();
    }

    /// Returns a predetermined sequence so pair selection is deterministic.
    struct SeqRng(Vec<f64>, usize);

    impl SeqRng {
        fn new(values: &[f64]) -> Self {
            Self(values.to_vec(), 0)
        }
    }

    impl Rng for SeqRng {
        fn next_f64(&mut self) -> f64 {
            let v = self.0[self.1 % self.0.len()];
            self.1 += 1;
            v
        }
    }

    fn rng() -> SeqRng {
        SeqRng::new(&[0.5])
    }

    fn ratings(conn: &Connection, id: i64) -> (f64, f64, i64) {
        conn.query_row(
            "SELECT rating_mu, rating_sigma, comparisons_count FROM wallpapers WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
    }

    fn comparison_rows(conn: &Connection) -> Vec<(i64, i64)> {
        let mut stmt = conn
            .prepare("SELECT winner_id, loser_id FROM comparisons ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn get_pair_excludes_rejected_and_errors_when_fewer_than_two_eligible() {
        let conn = test_conn();
        let active = seed_on(&conn, "active", MU, SIGMA, 0);
        let _rejected1 = seed_on(&conn, "rejected", MU, SIGMA, 3);
        let _rejected2 = seed_on(&conn, "rejected", MU, SIGMA, 5);

        match get_pair(&conn, &[], &mut rng()) {
            Err(AppError::NotEnoughWallpapers(_)) => {}
            other => panic!("expected NotEnoughWallpapers, got {other:?}"),
        }
        // An empty library errors too, rather than hanging or panicking.
        match get_pair(&test_conn(), &[], &mut rng()) {
            Err(AppError::NotEnoughWallpapers(_)) => {}
            other => panic!("expected NotEnoughWallpapers, got {other:?}"),
        }

        // A Kept wallpaper participates alongside Active ones.
        let kept = seed_on(&conn, "kept", MU, SIGMA, 0);
        for draw in [[0.0], [0.9], [0.4]] {
            let pair = get_pair(&conn, &[], &mut SeqRng::new(&draw)).unwrap();
            assert_ne!(pair[0].id, pair[1].id);
            assert!(
                (pair[0].id == active || pair[0].id == kept)
                    && (pair[1].id == active || pair[1].id == kept),
                "rejected wallpaper appeared in pair {pair:?}"
            );
        }
    }

    #[test]
    fn an_excluded_wallpaper_stays_out_of_the_draw() {
        let conn = test_conn();
        let a = seed_on(&conn, "active", MU, SIGMA, 0);
        let b = seed_on(&conn, "active", MU, SIGMA, 0);
        let c = seed_on(&conn, "active", MU, SIGMA, 0);
        let d = seed_on(&conn, "active", MU, SIGMA, 0);

        // Whatever the draws, neither excluded id can appear.
        for draw in [[0.0], [0.3], [0.5], [0.7], [0.99]] {
            let pair = get_pair(&conn, &[a, b], &mut SeqRng::new(&draw)).unwrap();
            let ids = pair.map(|p| p.id);
            assert!(
                !ids.contains(&a) && !ids.contains(&b),
                "excluded wallpaper appeared in {ids:?}"
            );
            assert!(ids.contains(&c) && ids.contains(&d));
        }
    }

    /// An Active wallpaper carrying `hash`, the way pre-generation leaves it.
    fn seed_hashed(conn: &Connection, hash: u64) -> i64 {
        let id = seed_on(conn, "active", MU, SIGMA, 0);
        db::record_perceptual_hash(conn, id, hash).unwrap();
        id
    }

    /// Every pair drawn over many draws, as its two ids lowest first.
    fn pairs_drawn(conn: &Connection) -> Vec<(i64, i64)> {
        let draws = [0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 0.999];
        let mut out = Vec::new();
        for a in draws {
            for b in draws {
                for c in draws {
                    let pair = get_pair(conn, &[], &mut SeqRng::new(&[a, b, c])).unwrap();
                    out.push((pair[0].id.min(pair[1].id), pair[0].id.max(pair[1].id)));
                }
            }
        }
        out
    }

    #[test]
    fn an_unanswered_near_duplicate_pair_is_never_drawn_together() {
        let conn = test_conn();
        let a = seed_hashed(&conn, 0);
        let b = seed_hashed(&conn, 0b11);
        let c = seed_hashed(&conn, u64::MAX);
        let d = seed_on(&conn, "active", MU, SIGMA, 0);

        let drawn = pairs_drawn(&conn);

        assert!(!drawn.contains(&(a, b)), "Near-duplicates drawn together");
        // Each of the two still meets the others.
        for pair in [(a, c), (a, d), (b, c), (b, d)] {
            assert!(drawn.contains(&pair), "{pair:?} never drawn");
        }
    }

    #[test]
    fn a_distinct_pair_can_be_drawn_together() {
        let conn = test_conn();
        let a = seed_hashed(&conn, 0);
        let b = seed_hashed(&conn, 0);
        seed_hashed(&conn, u64::MAX);
        near_duplicates::keep_both(&conn, a, b).unwrap();

        assert!(pairs_drawn(&conn).contains(&(a, b)));
    }

    #[test]
    fn a_library_that_is_only_an_unanswered_near_duplicate_pair_draws_nothing() {
        // Rank has nothing it may show, and Review has the pair to answer.
        let conn = test_conn();
        seed_hashed(&conn, 0);
        seed_hashed(&conn, 0);

        match get_pair(&conn, &[], &mut rng()) {
            Err(AppError::NotEnoughWallpapers(_)) => {}
            other => panic!("expected NotEnoughWallpapers, got {other:?}"),
        }
    }

    #[test]
    fn an_exclusion_that_would_empty_the_pool_is_ignored_rather_than_erroring() {
        // A three-wallpaper library must keep ranking: honouring the exclusion
        // would leave one candidate, and refusing to draw would strand the user
        // on the pair they just voted on with no way forward.
        let conn = test_conn();
        let a = seed_on(&conn, "active", MU, SIGMA, 0);
        let b = seed_on(&conn, "active", MU, SIGMA, 0);
        let c = seed_on(&conn, "active", MU, SIGMA, 0);

        let pair = get_pair(&conn, &[a, b], &mut rng()).unwrap();
        let ids = pair.map(|p| p.id);
        assert_ne!(ids[0], ids[1]);
        assert!(ids.contains(&c));

        // Excluding everything falls all the way back to the full pool.
        let pair = get_pair(&conn, &[a, b, c], &mut rng()).unwrap();
        assert_ne!(pair[0].id, pair[1].id);
    }

    #[test]
    fn a_votes_next_pair_never_holds_either_wallpaper_just_voted_on() {
        // The symptom this prevents: the panes appear not to change, so the
        // user votes on the same wallpaper again and the Comparison is noise.
        let conn = test_conn();
        let w = seed_on(&conn, "active", MU, SIGMA, 0);
        let l = seed_on(&conn, "active", MU, SIGMA, 0);
        let _rest: Vec<i64> = (0..4)
            .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
            .collect();

        for draw in [[0.0], [0.25], [0.5], [0.75], [0.99]] {
            let outcome = vote(&conn, w, l, &[], &mut SeqRng::new(&draw)).unwrap();
            let ids = outcome
                .next_pair
                .expect("four other wallpapers remain")
                .map(|p| p.id);
            assert!(
                !ids.contains(&w) && !ids.contains(&l),
                "the pair just voted on came back as {ids:?}"
            );
        }
    }

    #[test]
    fn vote_updates_ratings_bumps_counts_and_inserts_comparison() {
        let conn = test_conn();
        let w = seed_on(&conn, "active", MU, SIGMA, 0);
        let l = seed_on(&conn, "active", MU, SIGMA, 0);

        let outcome = vote(&conn, w, l, &[], &mut rng()).unwrap();

        // python-trueskill vector for (25, 8.333) vs (25, 8.333).
        let (wm, ws, wc) = ratings(&conn, w);
        assert!((wm - 29.20520196791777).abs() < 1e-7);
        assert!((ws - 7.194585101429668).abs() < 1e-7);
        assert_eq!(wc, 1);
        let (lm, ls, lc) = ratings(&conn, l);
        assert!((lm - 20.79479803208222).abs() < 1e-7);
        assert!((ls - 7.194585101429668).abs() < 1e-7);
        assert_eq!(lc, 1);

        assert_eq!(comparison_rows(&conn), vec![(w, l)]);
        assert_eq!(outcome.stats.total_comparisons, 1);
        assert_eq!(outcome.stats.eligible_count, 2);

        // With only two eligible wallpapers, the next pair is the same two
        // (in either order).
        let mut next_ids = outcome
            .next_pair
            .expect("two eligible wallpapers remain after the vote")
            .map(|p| p.id);
        next_ids.sort_unstable();
        assert_eq!(next_ids, [l.min(w), l.max(w)]);
    }

    #[test]
    fn pair_slot_order_is_randomized_rather_than_least_compared_first() {
        let conn = test_conn();
        // `select_pair` always picks `fresh` first: it has the fewest comparisons.
        let fresh = seed_on(&conn, "active", MU, SIGMA, 0);
        let seasoned = seed_on(&conn, "active", MU, SIGMA, 40);

        // The shuffle draw is the last value `get_pair` takes from the RNG.
        let low = get_pair(&conn, &[], &mut SeqRng::new(&[0.0])).unwrap();
        let high = get_pair(&conn, &[], &mut SeqRng::new(&[0.0, 0.0, 0.99])).unwrap();

        assert_eq!(low[0].id, fresh, "a low draw keeps selection order");
        assert_eq!(high[0].id, seasoned, "a high draw swaps the slots");
        assert_eq!(low[1].id, seasoned);
        assert_eq!(high[1].id, fresh);
    }

    #[test]
    fn failed_vote_rolls_back_ratings_counts_and_history() {
        let conn = test_conn();
        let w = seed_on(&conn, "active", MU, SIGMA, 0);
        let l = seed_on(&conn, "active", MU, SIGMA, 0);
        conn.execute_batch(&format!(
            "CREATE TRIGGER fail_comparison BEFORE INSERT ON comparisons
             WHEN NEW.winner_id = {w}
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END"
        ))
        .unwrap();

        assert!(matches!(
            vote(&conn, w, l, &[], &mut rng()),
            Err(AppError::Db(_))
        ));

        assert_eq!(ratings(&conn, w), (MU, SIGMA, 0));
        assert_eq!(ratings(&conn, l), (MU, SIGMA, 0));
        assert!(comparison_rows(&conn).is_empty());
    }

    #[test]
    fn vote_rejects_unknown_and_ineligible_ids_without_mutating() {
        // Three refusals and three kinds, and which is which is the whole of
        // ADR 0025's answer for a bad vote. A row that is not there is
        // `NotFound`, everywhere in the crate. A row that exists and sits out of
        // voting keeps `UnknownWallpaper`, which is the one surviving use of it:
        // `NotFound` there would hide a state, and the kind is the frontend's
        // signal to fetch a new pair rather than to correct a row. The same id
        // twice is a caller's mistake, so it is a `BadRequest` — nothing about
        // the wallpaper is unknown.
        let conn = test_conn();
        let a = seed_on(&conn, "active", MU, SIGMA, 0);
        let b = seed_on(&conn, "active", MU, SIGMA, 0);
        let r = seed_on(&conn, "rejected", MU, SIGMA, 2);

        for &(winner, loser) in &[(999, a), (a, 999)] {
            match vote(&conn, winner, loser, &[], &mut rng()) {
                Err(AppError::NotFound(_)) => {}
                other => panic!("expected NotFound for ({winner}, {loser}), got {other:?}"),
            }
        }

        for &(winner, loser) in &[(r, a), (a, r)] {
            match vote(&conn, winner, loser, &[], &mut rng()) {
                Err(AppError::UnknownWallpaper(_)) => {}
                other => panic!("expected UnknownWallpaper for ({winner}, {loser}), got {other:?}"),
            }
        }

        match vote(&conn, a, a, &[], &mut rng()) {
            Err(AppError::BadRequest(_)) => {}
            other => panic!("expected BadRequest for one id twice, got {other:?}"),
        }

        assert_eq!(ratings(&conn, a), (MU, SIGMA, 0));
        assert_eq!(ratings(&conn, b), (MU, SIGMA, 0));
        assert_eq!(ratings(&conn, r), (MU, SIGMA, 2));
        assert!(comparison_rows(&conn).is_empty());
    }

    #[test]
    fn get_pair_answers_a_missing_id_with_not_found_rather_than_a_bare_db_error() {
        // Unreachable in production — both ids come from `eligible_summaries` on
        // the same connection moments earlier, and nothing deletes a
        // `wallpapers` row — so this pins the kind rather than a live defect. It
        // used to be a bare `Db` from `?` running `From<rusqlite::Error>`, and
        // it closed with no line written here once `get_wallpaper` mapped the
        // variant itself (ADR 0025).
        let conn = test_conn();
        let err = db::get_wallpaper(&conn, 999).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// Sets a wallpaper's Status the way a soft reject leaves the row: the rating
    /// and the Comparison count untouched.
    fn set_status(conn: &Connection, id: i64, status: &str) {
        conn.execute(
            "UPDATE wallpapers SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .unwrap();
    }

    #[test]
    fn the_bar_counts_every_status_and_leaves_the_unrated_out() {
        let conn = test_conn();
        // Ten Scores, 1 through 10, spread across all three Statuses.
        for mu in 1..=10 {
            let status = match mu % 3 {
                0 => "rejected",
                1 => "active",
                _ => "kept",
            };
            seed_on(&conn, status, f64::from(mu), 3.0, 4);
        }
        // Unrated rows with starting Scores that would drag the Bar down if they
        // counted.
        for _ in 0..10 {
            seed_on(&conn, "active", 0.5, SIGMA, 0);
        }

        assert_eq!(bar(&conn).unwrap(), Some(2.5));
    }

    #[test]
    fn the_bar_follows_the_share_the_curator_set() {
        let conn = test_conn();
        for mu in 1..=10 {
            seed_on(&conn, "active", f64::from(mu), 3.0, 4);
        }
        let detected = crate::settings::Detected::default();
        for (share, expected) in [("0.1", 1.5), ("0.3", 3.5), ("0.5", 5.5), ("0.2", 2.5)] {
            crate::settings::set(&conn, "bar_share", share, detected).unwrap();
            assert_eq!(bar(&conn).unwrap(), Some(expected), "share {share}");
        }
    }

    #[test]
    fn an_empty_or_unrated_library_has_no_bar_and_one_score_is_its_own() {
        let conn = test_conn();
        assert_eq!(bar(&conn).unwrap(), None);
        seed_on(&conn, "active", MU, SIGMA, 0);
        assert_eq!(bar(&conn).unwrap(), None);
        seed_on(&conn, "active", 27.0, 6.0, 1);
        assert_eq!(bar(&conn).unwrap(), Some(27.0));
    }

    #[test]
    fn rejecting_a_wallpaper_below_the_bar_leaves_the_bar_where_it_was() {
        let conn = test_conn();
        let ids: Vec<i64> = (1..=10)
            .map(|mu| seed_on(&conn, "active", f64::from(mu), 3.0, 4))
            .collect();
        let before = bar(&conn).unwrap();
        assert_eq!(before, Some(2.5));

        // The worst two are the worst fifth; clearing both out is where
        // clearing out ends, and the Bar has not moved to make a new worst fifth.
        set_status(&conn, ids[0], "rejected");
        assert_eq!(bar(&conn).unwrap(), before);
        set_status(&conn, ids[1], "rejected");
        assert_eq!(bar(&conn).unwrap(), before);
    }

    #[test]
    fn an_empty_library_reports_zero_counts() {
        let s = get_stats(&test_conn()).unwrap();
        assert_eq!(s.total_wallpapers, 0);
        assert_eq!(s.eligible_count, 0);
        assert_eq!(split(&s), (0, 0, 0));
        assert_eq!(s.close_call_count, 0);
        assert_eq!(s.total_comparisons, 0);

        // A library that holds only Rejected rows has an empty Eligible pool and
        // reads the same way, while still counting towards the boot gate.
        let rejects_only = test_conn();
        seed_on(&rejects_only, "rejected", 30.0, 2.0, 9);
        let s = get_stats(&rejects_only).unwrap();
        assert_eq!(s.total_wallpapers, 1);
        assert_eq!(s.eligible_count, 0);
        assert_eq!(split(&s), (0, 0, 0));
    }

    #[test]
    fn rejected_rows_stay_in_the_total_and_out_of_the_eligible_counts() {
        let conn = test_conn();
        let active = seed_on(&conn, "active", 25.0, 5.0, 4);
        // Rejected on both extremes: Scores far enough either side of the Bar,
        // and sure enough, that they would be Decided if they were the curator's.
        let rejected_low = seed_on(&conn, "rejected", 1.0, 0.1, 9);
        let rejected_high = seed_on(&conn, "rejected", 50.0, 0.1, 40);
        add_comparison(&conn, active, rejected_high);
        add_comparison(&conn, rejected_low, active);

        let s = get_stats(&conn).unwrap();
        assert_eq!(s.total_wallpapers, 3);
        assert_eq!(s.eligible_count, 1);
        assert_eq!(split(&s), (0, 1, 0));
        // Comparisons a Rejected wallpaper took part in remain part of the record.
        assert_eq!(s.total_comparisons, 2);
    }

    #[test]
    fn kept_rows_are_counted_in_the_eligible_pool_and_its_split() {
        let conn = test_conn();
        for mu in 11..=20 {
            seed_on(&conn, "active", f64::from(mu), 0.1, 9);
        }
        // Kept on both sides of the Bar and on it: the Kept ones are still the
        // curator's, and the three Scores leave the Bar between 12 and 13.
        seed_on(&conn, "kept", 1.0, 0.1, 9);
        seed_on(&conn, "kept", 12.5, 3.0, 2);
        seed_on(&conn, "kept", 40.0, 0.1, 9);

        let s = get_stats(&conn).unwrap();
        assert_eq!(s.total_wallpapers, 13);
        assert_eq!(s.eligible_count, 13);
        assert_eq!(split(&s), (3, 1, 9));
    }

    #[test]
    fn get_pair_keeps_the_last_ten_comparisons_out_of_the_first_pick() {
        let conn = test_conn();
        // The least-compared wallpaper sits in the latest Comparison, so the
        // next-least goes first.
        let shown = seed_on(&conn, "active", 25.0, 5.0, 1);
        let other = seed_on(&conn, "active", 25.0, 5.0, 4);
        let next = seed_on(&conn, "active", 25.0, 5.0, 2);
        add_comparison(&conn, shown, other);

        for draw in [[0.0], [0.5], [0.99]] {
            let ids = get_pair(&conn, &[], &mut SeqRng::new(&draw))
                .unwrap()
                .map(|p| p.id);
            assert!(ids.contains(&next), "{ids:?}");
        }
    }

    #[test]
    fn a_vote_that_was_an_arrivals_first_is_followed_by_a_pair_with_no_unrated() {
        // Four of seven have a Score before the vote, five after: past half.
        let library = || {
            let conn = test_conn();
            let scored: Vec<i64> = (0..4)
                .map(|i| seed_on(&conn, "active", 20.0 + f64::from(i), 5.0, 3))
                .collect();
            let arrival = seed_on(&conn, "active", MU, SIGMA, 0);
            let unrated: Vec<i64> = (0..2)
                .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
                .collect();
            (conn, scored, arrival, unrated)
        };

        for draw in [[0.0], [0.3], [0.6], [0.99]] {
            let (conn, scored, arrival, unrated) = library();
            let outcome = vote(&conn, arrival, scored[0], &[], &mut SeqRng::new(&draw)).unwrap();
            let ids = outcome.next_pair.unwrap().map(|p| p.id);
            assert!(
                !ids.iter().any(|id| unrated.contains(id)),
                "an arrival came straight back: {ids:?}"
            );
        }

        // After a vote between two Scores, an arrival goes first again.
        let (conn, scored, arrival, unrated) = library();
        vote(&conn, arrival, scored[0], &[], &mut rng()).unwrap();
        let outcome = vote(&conn, scored[1], scored[2], &[], &mut rng()).unwrap();
        let ids = outcome.next_pair.unwrap().map(|p| p.id);
        assert!(ids.iter().any(|id| unrated.contains(id)), "{ids:?}");
    }

    #[test]
    fn stats_count_the_undecided_and_the_close_calls_against_the_bar() {
        let conn = test_conn();
        // Ten Scores 11 through 20 put the Bar at 12.5; with σ 0.1 every one
        // sits more than 2.5σ from it and is Decided.
        for mu in 11..=20 {
            seed_on(&conn, "active", f64::from(mu), 0.1, 9);
        }
        let s = get_stats(&conn).unwrap();
        assert_eq!((s.undecided_count, s.close_call_count), (0, 0));

        // Undecided on the Bar, a Close call beside it (Kept counts), an
        // Unrated arrival, and a Rejected Close call that is not the curator's.
        // The three with Scores move the Bar to 12.45, still between 12 and 13.
        seed_on(&conn, "active", 12.5, 3.0, 2);
        seed_on(&conn, "kept", 12.6, 1.0, 12);
        seed_on(&conn, "active", MU, SIGMA, 0);
        seed_on(&conn, "rejected", 12.4, 1.0, 12);
        let s = get_stats(&conn).unwrap();
        assert!((bar(&conn).unwrap().unwrap() - 12.45).abs() < 1e-9);
        assert_eq!(s.undecided_count, 3);
        assert_eq!(s.close_call_count, 1);
    }

    /// The Undecided count with the two Decided sides, the way the headline
    /// splits the Eligible pool.
    fn split(s: &Stats) -> (u32, u32, u32) {
        (
            s.decided_below_count,
            s.undecided_count,
            s.decided_above_count,
        )
    }

    #[test]
    fn a_library_with_no_scores_is_all_undecided() {
        let conn = test_conn();
        for _ in 0..3 {
            seed_on(&conn, "active", MU, SIGMA, 0);
        }
        seed_on(&conn, "kept", MU, SIGMA, 0);
        let s = get_stats(&conn).unwrap();
        assert_eq!(s.eligible_count, 4);
        assert_eq!(split(&s), (0, 4, 0));
    }

    #[test]
    fn decided_below_undecided_and_decided_above_add_up_to_the_eligible_pool() {
        let conn = test_conn();
        // Ten Scores 11 through 20 put the Bar at 12.5; with σ 0.1 every one
        // sits more than 2.5σ from it, two below and eight above.
        for mu in 11..=20 {
            seed_on(&conn, "active", f64::from(mu), 0.1, 9);
        }
        // Two more Scores, high but too unsure to be Decided (Kept counts).
        // Both land above the share, so they leave the Bar at 12.5.
        seed_on(&conn, "active", 30.0, 10.0, 2);
        seed_on(&conn, "kept", 31.0, 10.0, 2);
        let s = get_stats(&conn).unwrap();
        assert!((bar(&conn).unwrap().unwrap() - 12.5).abs() < 1e-9);
        assert_eq!(split(&s), (2, 2, 8));
        assert_eq!(
            s.decided_below_count + s.undecided_count + s.decided_above_count,
            s.eligible_count
        );
    }

    #[test]
    fn rejected_wallpapers_are_left_out_and_unrated_ones_are_undecided() {
        let conn = test_conn();
        for mu in 11..=20 {
            seed_on(&conn, "active", f64::from(mu), 0.1, 9);
        }
        // Rejected Scores far either side of the Bar would be Decided if they
        // were the curator's. With them the twelve Scores put the Bar at 11.5,
        // which leaves 11 below it and 12 through 20 above.
        seed_on(&conn, "rejected", 1.0, 0.1, 9);
        seed_on(&conn, "rejected", 40.0, 0.1, 9);
        // An Unrated arrival whose confident starting Score sits far above the
        // Bar is still Undecided: no Comparison, no Score.
        seed_on(&conn, "active", 40.0, 0.1, 0);
        seed_on(&conn, "active", MU, SIGMA, 0);
        let s = get_stats(&conn).unwrap();
        assert!((bar(&conn).unwrap().unwrap() - 11.5).abs() < 1e-9);
        assert_eq!(s.eligible_count, 12);
        assert_eq!(split(&s), (1, 2, 9));
    }
}
