//! Persistence seam for the voting loop: pair fetching, vote application,
//! and stats — all taking a plain connection handle so they are testable
//! against an initialized in-memory SQLite database.
//!
//! Eligibility: Status ∈ {Active, Kept}; Rejected sits out. Rating updates
//! and pair selection delegate to the pure `ranking` module. A vote applies
//! the TrueSkill update, increments both `comparisons_count`, and inserts the
//! permanent Comparison row in one transaction.

use rusqlite::Connection;

use crate::db;
use crate::error::AppError;
use crate::ranking::{self, Rng};

/// A pair holds two rows of the shape every listing already serves, so it uses
/// `db`'s type and `db`'s reader rather than a second copy of the column list.
/// `origin_path` is structurally `None` on both — only a Rejected wallpaper has
/// an Origin, and a pair only ever holds eligible ones.
pub use crate::db::Wallpaper;

/// Progress snapshot for the rank headline. Every fraction is measured against
/// the Eligible pool, so rejecting wallpapers cannot drag progress down.
///
/// `total_wallpapers` is the exception and counts every row: the boot gate reads
/// it to tell an empty library from a populated one, and narrowing it would
/// strand a user whose library is entirely Rejected.
///
/// The Round is derived here rather than stored (ADR 0008), so it moves
/// whichever way the counts do — forward when the least-compared wallpaper is
/// rejected, back when a scan brings in unseen files. No `percentage`: the
/// frontend divides `round_participated_count` by `eligible_count`, which is the
/// one part of this it holds the inputs for.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Stats {
    pub total_wallpapers: u32,
    pub eligible_count: u32,
    pub round: u32,
    pub round_participated_count: u32,
    pub evaluated_count: u32,
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
        db::get_wallpaper(conn, first.id)?,
        db::get_wallpaper(conn, second.id)?,
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
    // `get_stats` stays fatal: a handful of aggregate `SELECT`s only fail if the
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

    // Every fraction below is measured against the Eligible pool, and the
    // fragment that says which rows those are comes from `db::Status` rather
    // than being spelled here four times (ADR 0024).
    let eligible = db::Status::ELIGIBLE_SQL;

    // `MIN` over no rows is NULL, which is the empty-pool case and reports Round
    // 1: the app is always about to run Round 1, and a null would make every
    // consumer branch on a state that has nothing to say.
    let (eligible_count, floor): (u32, Option<i64>) = conn.query_row(
        &format!(
            "SELECT COUNT(*), MIN(comparisons_count) FROM wallpapers
             WHERE {eligible}"
        ),
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let round = floor.map_or(1, |f| count_u32(f).saturating_add(1));

    // `>= round`, not `>= round - 1`: the floor is `round - 1` and every
    // eligible wallpaper sits at or above it by construction, so the looser
    // comparison would read as a full Round forever.
    let round_participated_count: u32 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM wallpapers
             WHERE {eligible} AND comparisons_count >= ?1"
        ),
        [round],
        |r| r.get(0),
    )?;
    let evaluated_count: u32 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM wallpapers
             WHERE {eligible} AND rating_sigma < 4.0"
        ),
        [],
        |r| r.get(0),
    )?;
    Ok(Stats {
        total_wallpapers,
        eligible_count,
        round,
        round_participated_count,
        evaluated_count,
        total_comparisons,
    })
}

fn eligible_summaries(conn: &Connection) -> Result<Vec<ranking::WallpaperSummary>, AppError> {
    // No ORDER BY: `select_pair` scans for a minimum and indexes by RNG draw,
    // so row order isn't load-bearing, and sorting the whole library costs a
    // temp B-tree on every pair fetch.
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT id, rating_mu, rating_sigma, comparisons_count
         FROM wallpapers WHERE {}",
        db::Status::ELIGIBLE_SQL,
    ))?;
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
        // Both wallpapers are now at one comparison, so the floor rose with the
        // vote and Round 2 has nobody in it yet.
        assert_eq!(outcome.stats.round, 2);
        assert_eq!(outcome.stats.round_participated_count, 0);

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

    #[test]
    fn an_empty_library_reports_round_one_and_zero_counts() {
        let s = get_stats(&test_conn()).unwrap();
        assert_eq!(s.total_wallpapers, 0);
        assert_eq!(s.eligible_count, 0);
        assert_eq!(s.round, 1);
        assert_eq!(s.round_participated_count, 0);
        assert_eq!(s.evaluated_count, 0);
        assert_eq!(s.total_comparisons, 0);

        // A library that holds only Rejected rows has an empty Eligible pool and
        // reads the same way, while still counting towards the boot gate.
        let rejects_only = test_conn();
        seed_on(&rejects_only, "rejected", 30.0, 2.0, 9);
        let s = get_stats(&rejects_only).unwrap();
        assert_eq!(s.total_wallpapers, 1);
        assert_eq!(s.eligible_count, 0);
        assert_eq!(s.round, 1);
        assert_eq!(s.round_participated_count, 0);
    }

    #[test]
    fn a_uniform_library_at_three_comparisons_is_in_round_four() {
        let conn = test_conn();
        for _ in 0..4 {
            seed_on(&conn, "active", MU, SIGMA, 3);
        }

        // The floor is three, so nobody has had their fourth comparison yet.
        let s = get_stats(&conn).unwrap();
        assert_eq!(s.round, 4);
        assert_eq!(s.eligible_count, 4);
        assert_eq!(s.round_participated_count, 0);

        // One wallpaper reaching four counts towards the Round without moving
        // the floor that set it.
        let ahead = seed_on(&conn, "active", MU, SIGMA, 4);
        let s = get_stats(&conn).unwrap();
        assert_eq!(s.round, 4);
        assert_eq!(s.eligible_count, 5);
        assert_eq!(s.round_participated_count, 1);
        assert_eq!(ratings(&conn, ahead).2, 4);
    }

    #[test]
    fn a_single_laggard_pins_the_round_to_the_floor() {
        let conn = test_conn();
        seed_on(&conn, "active", MU, SIGMA, 0);
        for _ in 0..5 {
            seed_on(&conn, "active", MU, SIGMA, 5);
        }

        let s = get_stats(&conn).unwrap();
        assert_eq!(s.round, 1);
        assert_eq!(s.eligible_count, 6);
        // Everyone but the laggard is past Round 1.
        assert_eq!(s.round_participated_count, 5);
    }

    #[test]
    fn rejecting_the_least_compared_wallpaper_advances_the_round() {
        let conn = test_conn();
        let laggard = seed_on(&conn, "active", MU, SIGMA, 2);
        for _ in 0..3 {
            seed_on(&conn, "active", MU, SIGMA, 5);
        }

        let before = get_stats(&conn).unwrap();
        assert_eq!(before.round, 3);
        assert_eq!(before.eligible_count, 4);
        assert_eq!(before.round_participated_count, 3);

        conn.execute(
            "UPDATE wallpapers SET status = 'rejected' WHERE id = ?1",
            params![laggard],
        )
        .unwrap();

        // A stored Round would still say 3 here. Derived, it follows the new
        // floor of five.
        let after = get_stats(&conn).unwrap();
        assert_eq!(after.round, 6);
        assert_eq!(after.eligible_count, 3);
        assert_eq!(after.round_participated_count, 0);
        assert_eq!(after.total_wallpapers, 4);
    }

    #[test]
    fn rejected_rows_stay_in_the_total_and_out_of_the_eligible_fractions() {
        let conn = test_conn();
        let active = seed_on(&conn, "active", 25.0, 5.0, 4);
        // Rejected on both extremes: fewer comparisons than the floor, and a σ
        // that would otherwise count as Evaluated.
        let rejected_low = seed_on(&conn, "rejected", 20.0, 3.0, 0);
        let rejected_high = seed_on(&conn, "rejected", 30.0, 1.0, 40);
        add_comparison(&conn, active, rejected_high);
        add_comparison(&conn, rejected_low, active);

        let s = get_stats(&conn).unwrap();
        assert_eq!(s.total_wallpapers, 3);
        assert_eq!(s.eligible_count, 1);
        assert_eq!(s.round, 5);
        assert_eq!(s.round_participated_count, 0);
        assert_eq!(s.evaluated_count, 0);
        // Comparisons a Rejected wallpaper took part in remain part of the record.
        assert_eq!(s.total_comparisons, 2);
    }

    #[test]
    fn kept_rows_are_counted_everywhere_a_round_is_measured() {
        let conn = test_conn();
        seed_on(&conn, "active", 25.0, 3.0, 7);
        let kept_laggard = seed_on(&conn, "kept", 22.0, 3.5, 1);

        // The Kept row sets the floor, and its own count is what Round 2 needs.
        let s = get_stats(&conn).unwrap();
        assert_eq!(s.total_wallpapers, 2);
        assert_eq!(s.eligible_count, 2);
        assert_eq!(s.round, 2);
        assert_eq!(s.round_participated_count, 1);
        assert_eq!(s.evaluated_count, 2);

        conn.execute(
            "UPDATE wallpapers SET comparisons_count = 2 WHERE id = ?1",
            params![kept_laggard],
        )
        .unwrap();
        let s = get_stats(&conn).unwrap();
        assert_eq!(s.round, 3);
        assert_eq!(s.round_participated_count, 1);
    }

    #[test]
    fn evaluated_counts_only_eligible_rows_under_the_sigma_threshold() {
        let conn = test_conn();
        seed_on(&conn, "active", 25.0, 3.999, 6);
        seed_on(&conn, "kept", 25.0, 1.0, 6);
        // 4.0 is the threshold, not a member of it.
        seed_on(&conn, "active", 25.0, 4.0, 6);
        seed_on(&conn, "active", 25.0, 4.001, 6);
        seed_on(&conn, "rejected", 25.0, 0.5, 6);

        let s = get_stats(&conn).unwrap();
        assert_eq!(s.eligible_count, 4);
        assert_eq!(s.evaluated_count, 2);
    }
}
