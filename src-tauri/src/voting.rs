//! Persistence seam for the voting loop: pair fetching, vote application,
//! and stats — all taking a plain connection handle so they are testable
//! against an initialized in-memory SQLite database.
//!
//! Eligibility: Status ∈ {Active, Kept}; Rejected sits out. Rating updates
//! and pair selection delegate to the pure `ranking` module. A vote applies
//! the TrueSkill update, increments both `comparisons_count`, and inserts the
//! permanent Comparison row in one transaction.

use rusqlite::Connection;

use crate::error::AppError;
use crate::ranking::{self, Rng};

/// A wallpaper as serialized over the IPC surface (locked in #4).
#[derive(Clone, Debug, serde::Serialize)]
pub struct Wallpaper {
    pub id: i64,
    pub filename: String,
    pub path: String,
    pub status: String,
    pub rating_mu: f64,
    pub rating_sigma: f64,
    pub comparisons_count: u32,
}

/// Progress snapshot, mirroring rate-wallpaper's `/progress` semantics:
/// totals count all rows regardless of Status; participated/evaluated only
/// count eligible wallpapers.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Stats {
    pub total_wallpapers: u32,
    pub total_comparisons: u32,
    pub evaluated_count: u32,
    pub participated_count: u32,
    pub percentage: f64,
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
/// The two are shuffled before returning. `select_pair` always yields the
/// least-compared wallpaper first, and the UI renders slot 0 on the left, so
/// without this the left side is systematically the newer wallpaper — feeding
/// the well-known left-position bias of pairwise comparison straight into the
/// ratings the app exists to measure.
///
/// `exclude` keeps the wallpapers the user is already looking at out of the
/// draw. Nothing in the selection rule stops a fresh pair reusing one of them,
/// and against a 120-wallpaper library that happened to 4% of successive
/// pairs: the pane does not appear to change, so the user re-picks the same
/// wallpaper and the Comparison is worthless. Ignored when honouring it would
/// leave fewer than two candidates, so a small library still ranks.
pub fn get_pair<R: Rng>(
    conn: &Connection,
    exclude: &[i64],
    rng: &mut R,
) -> Result<[Wallpaper; 2], AppError> {
    let all = eligible_summaries(conn)?;
    let narrowed: Vec<ranking::WallpaperSummary> = all
        .iter()
        .filter(|w| !exclude.contains(&w.id))
        .copied()
        .collect();
    let pool = if narrowed.len() >= 2 { narrowed } else { all };
    let (first, second) = ranking::select_pair(&pool, rng).ok_or_else(|| {
        AppError::NotEnoughWallpapers(format!(
            "pair selection needs at least two eligible wallpapers, found {}",
            pool.len()
        ))
    })?;
    let (first, second) = if rng.next_f64() < 0.5 {
        (first, second)
    } else {
        (second, first)
    };
    Ok([
        fetch_wallpaper(conn, first.id)?,
        fetch_wallpaper(conn, second.id)?,
    ])
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
        return Err(AppError::UnknownWallpaper(format!(
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
    // `get_stats` stays fatal: two `SELECT COUNT(*)`s only fail if the database
    // itself is gone, at which point an error is the honest answer.
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
    let participated_count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM wallpapers
         WHERE status IN ('active', 'kept') AND comparisons_count > 0",
        [],
        |r| r.get(0),
    )?;
    let evaluated_count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM wallpapers
         WHERE status IN ('active', 'kept') AND rating_sigma < 4.0",
        [],
        |r| r.get(0),
    )?;
    let percentage = if total_wallpapers > 0 {
        f64::from(participated_count) / f64::from(total_wallpapers) * 100.0
    } else {
        0.0
    };
    Ok(Stats {
        total_wallpapers,
        total_comparisons,
        evaluated_count,
        participated_count,
        percentage,
    })
}

fn eligible_summaries(conn: &Connection) -> Result<Vec<ranking::WallpaperSummary>, AppError> {
    // No ORDER BY: `select_pair` scans for a minimum and indexes by RNG draw,
    // so row order isn't load-bearing, and sorting the whole library costs a
    // temp B-tree on every pair fetch.
    let mut stmt = conn.prepare_cached(
        "SELECT id, rating_mu, rating_sigma, comparisons_count
         FROM wallpapers WHERE status IN ('active', 'kept')",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ranking::WallpaperSummary {
            id: row.get(0)?,
            rating_mu: row.get(1)?,
            rating_sigma: row.get(2)?,
            comparisons_count: count_u32(row.get::<_, i64>(3)?),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn fetch_summary(conn: &Connection, id: i64) -> Result<ranking::WallpaperSummary, AppError> {
    let (status, mu, sigma, count): (String, f64, f64, i64) = conn
        .query_row(
            "SELECT status, rating_mu, rating_sigma, comparisons_count
             FROM wallpapers WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::UnknownWallpaper(format!("wallpaper {id} does not exist"))
            }
            other => other.into(),
        })?;
    if status == "rejected" {
        return Err(AppError::UnknownWallpaper(format!(
            "wallpaper {id} is rejected and sits out of voting"
        )));
    }
    Ok(ranking::WallpaperSummary {
        id,
        rating_mu: mu,
        rating_sigma: sigma,
        comparisons_count: count_u32(count),
    })
}

fn fetch_wallpaper(conn: &Connection, id: i64) -> Result<Wallpaper, AppError> {
    conn.query_row(
        "SELECT id, filename, path, status, rating_mu, rating_sigma, comparisons_count
         FROM wallpapers WHERE id = ?1",
        [id],
        |row| {
            Ok(Wallpaper {
                id: row.get(0)?,
                filename: row.get(1)?,
                path: row.get(2)?,
                status: row.get(3)?,
                rating_mu: row.get(4)?,
                rating_sigma: row.get(5)?,
                comparisons_count: count_u32(row.get::<_, i64>(6)?),
            })
        },
    )
    .map_err(AppError::from)
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
    use crate::db;
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
        assert_eq!(outcome.stats.participated_count, 2);
        assert_eq!(outcome.stats.percentage, 100.0);

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
        let conn = test_conn();
        let a = seed_on(&conn, "active", MU, SIGMA, 0);
        let b = seed_on(&conn, "active", MU, SIGMA, 0);
        let r = seed_on(&conn, "rejected", MU, SIGMA, 2);

        for &(winner, loser) in &[(999, a), (a, 999), (r, a), (a, r), (a, a)] {
            match vote(&conn, winner, loser, &[], &mut rng()) {
                Err(AppError::UnknownWallpaper(_)) => {}
                other => panic!("expected UnknownWallpaper for ({winner}, {loser}), got {other:?}"),
            }
        }

        assert_eq!(ratings(&conn, a), (MU, SIGMA, 0));
        assert_eq!(ratings(&conn, b), (MU, SIGMA, 0));
        assert_eq!(ratings(&conn, r), (MU, SIGMA, 2));
        assert!(comparison_rows(&conn).is_empty());
    }

    #[test]
    fn stats_match_hand_computed_fixture_and_empty_library() {
        let empty = test_conn();
        let s = get_stats(&empty).unwrap();
        assert_eq!(
            (
                s.total_wallpapers,
                s.total_comparisons,
                s.evaluated_count,
                s.participated_count
            ),
            (0, 0, 0, 0)
        );
        assert_eq!(s.percentage, 0.0);

        let conn = test_conn();
        let _evaluated_participated = seed_on(&conn, "active", 25.0, 3.0, 2);
        let _participated_only = seed_on(&conn, "active", 27.0, 5.0, 1);
        let _evaluated_kept = seed_on(&conn, "kept", 22.0, 3.5, 0);
        let rejected = seed_on(&conn, "rejected", 30.0, 2.9, 7);
        let any_active = seed_on(&conn, "active", 26.0, 6.0, 0);
        for _ in 0..3 {
            add_comparison(&conn, any_active, rejected);
        }

        let s = get_stats(&conn).unwrap();
        // Totals count ALL rows regardless of Status; participated/evaluated
        // are eligibility-filtered.
        assert_eq!(s.total_wallpapers, 5);
        assert_eq!(s.total_comparisons, 3);
        assert_eq!(s.participated_count, 2);
        assert_eq!(s.evaluated_count, 2);
        assert!((s.percentage - 40.0).abs() < 1e-12);
    }
}
