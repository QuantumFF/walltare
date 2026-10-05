//! Persistence seam for the voting loop: fetching a showing of two or four,
//! vote application, and stats — all taking a plain connection handle so they
//! are testable against an initialized in-memory SQLite database.
//!
//! Eligibility: Status ∈ {Active, Kept}; Rejected sits out. Rating updates
//! and selection delegate to the pure `ranking` module, and where a wallpaper
//! stands against the Bar to `bar`. A vote applies the TrueSkill update, adds
//! one to every member's `comparisons_count`, and inserts the permanent
//! Comparison row in one transaction.

use rusqlite::Connection;

use crate::bar::{Bar, Side, Standing};
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

/// What a vote on a pair answers with.
#[derive(Clone, Debug, serde::Serialize)]
pub struct VoteOutcome {
    /// `None` when the vote was recorded but the follow-up draw failed; the
    /// client re-fetches rather than treating a committed vote as an error.
    pub next_pair: Option<[Wallpaper; 2]>,
    pub stats: Stats,
}

/// What a vote on a showing of four answers with: [`VoteOutcome`]'s contract,
/// for the showing that follows one of four.
#[derive(Clone, Debug, serde::Serialize)]
pub struct FourOutcome {
    /// Four wallpapers, or two once fewer than four are Eligible. `None` when
    /// the vote was recorded but the follow-up draw failed.
    pub next_showing: Option<Vec<Wallpaper>>,
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
pub fn get_pair<R: Rng>(
    conn: &Connection,
    exclude: &[i64],
    rng: &mut R,
) -> Result<[Wallpaper; 2], AppError> {
    Draw::read(conn)?.pair(conn, exclude, rng)
}

/// Picks a showing of four Eligible wallpapers, or a pair once fewer than four
/// are Eligible, so a small library still ranks (ADR 0061).
///
/// Shuffled for the reason a pair is: `select_four` yields its first pick
/// first, and where a wallpaper sits on screen must mean nothing. `exclude` is
/// the showing on screen, and gives way as `select_four` says.
pub fn get_four<R: Rng>(
    conn: &Connection,
    exclude: &[i64],
    rng: &mut R,
) -> Result<Vec<Wallpaper>, AppError> {
    Draw::read(conn)?.four(conn, exclude, rng)
}

/// The Eligible pool and the Bar, read together: what the headline counts and
/// what every draw starts from.
struct Pool {
    wallpapers: Vec<ranking::WallpaperSummary>,
    bar: Bar,
}

impl Pool {
    fn read(conn: &Connection) -> Result<Self, AppError> {
        Ok(Self {
            wallpapers: eligible_summaries(conn)?,
            bar: Bar::read(conn)?,
        })
    }
}

/// What a draw reads, all of it on every draw and none of it held as state
/// (ADR 0060): the pool and the Bar, the latest Comparisons, and the
/// unanswered Near-duplicate pairs. Read once, it answers a showing of four
/// and the pair that stands in for one.
struct Draw {
    pool: Pool,
    showings: Vec<Vec<i64>>,
    last_was_a_first: bool,
    unanswered: near_duplicates::UnansweredPairs,
}

impl Draw {
    fn read(conn: &Connection) -> Result<Self, AppError> {
        let (showings, last_was_a_first) = recent_comparisons(conn)?;
        Ok(Self {
            pool: Pool::read(conn)?,
            showings,
            last_was_a_first,
            unanswered: near_duplicates::unanswered_pairs(conn)?,
        })
    }

    fn recent(&self) -> ranking::Recent<'_> {
        ranking::Recent {
            showings: &self.showings,
            last_was_a_first: self.last_was_a_first,
        }
    }

    /// [`get_pair`] from this snapshot.
    fn pair<R: Rng>(
        &self,
        conn: &Connection,
        exclude: &[i64],
        rng: &mut R,
    ) -> Result<[Wallpaper; 2], AppError> {
        let apart = |a, b| self.unanswered.contains(a, b);
        let pool = &self.pool;
        let (first, second) = ranking::select_pair(
            &pool.wallpapers,
            pool.bar,
            self.recent(),
            exclude,
            &apart,
            rng,
        )
        .ok_or_else(|| {
            AppError::NotEnoughWallpapers(format!(
                "pair selection needs two eligible wallpapers that are not an unanswered \
                 Near-duplicate pair, found {} eligible",
                pool.wallpapers.len()
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

    /// [`get_four`] from this snapshot, and a pair from the same snapshot when
    /// four cannot be drawn.
    fn four<R: Rng>(
        &self,
        conn: &Connection,
        exclude: &[i64],
        rng: &mut R,
    ) -> Result<Vec<Wallpaper>, AppError> {
        let apart = |a, b| self.unanswered.contains(a, b);
        let pool = &self.pool;
        let Some(four) = ranking::select_four(
            &pool.wallpapers,
            pool.bar,
            self.recent(),
            exclude,
            &apart,
            rng,
        ) else {
            return Ok(self.pair(conn, exclude, rng)?.into());
        };
        let mut ids = four.map(|w| w.id);
        // Fisher–Yates, every order equally likely.
        for i in (1..ids.len()).rev() {
            let j = ((rng.next_f64() * (i + 1) as f64) as usize).min(i);
            ids.swap(i, j);
        }
        ids.iter().map(|&id| db::get_wallpaper(conn, id)).collect()
    }
}

/// The latest [`ranking::REPEAT_WINDOW`] Comparisons, newest first, each as
/// every wallpaper in its showing, and whether the latest was the first for
/// any of its wallpapers.
///
/// "Its first" reads `comparisons_count`, which the vote that inserted the row
/// raised in the same transaction: a count of one means that row is the only
/// Comparison the wallpaper has. `comparisons` has no index on its two ids, so
/// looking for an earlier row would scan the whole record on every pair.
fn recent_comparisons(conn: &Connection) -> Result<(Vec<Vec<i64>>, bool), AppError> {
    // The window first, then its members, which the primary key finds by
    // Comparison. A pair has none, hence the outer join.
    let mut stmt = conn.prepare_cached(
        "WITH recent AS (
             SELECT id, winner_id, loser_id FROM comparisons ORDER BY id DESC LIMIT ?1
         )
         SELECT r.id, r.winner_id, r.loser_id, m.wallpaper_id
         FROM recent r LEFT JOIN comparison_members m ON m.comparison_id = r.id
         ORDER BY r.id DESC",
    )?;
    let rows = stmt.query_map([ranking::REPEAT_WINDOW as i64], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, Option<i64>>(3)?,
        ))
    })?;
    let mut showings: Vec<(i64, Vec<i64>)> = Vec::new();
    for row in rows {
        let (id, winner, loser, member) = row?;
        match showings.last_mut() {
            Some((last, members)) if *last == id => members.extend(member),
            _ => showings.push((id, [winner, loser].into_iter().chain(member).collect())),
        }
    }
    let showings: Vec<Vec<i64>> = showings.into_iter().map(|(_, members)| members).collect();
    let last_was_a_first = match showings.first() {
        Some(latest) => {
            let slots = vec!["?"; latest.len()].join(", ");
            conn.prepare_cached(&format!(
                "SELECT EXISTS (
                     SELECT 1 FROM wallpapers WHERE id IN ({slots}) AND comparisons_count = 1
                 )"
            ))?
            .query_row(rusqlite::params_from_iter(latest), |r| r.get(0))?
        }
        None => false,
    };
    Ok((showings, last_was_a_first))
}

/// Applies a vote on a pair atomically, then returns the next pair with fresh
/// stats. [`vote_on`] says how; the next showing is always a pair.
pub fn vote<R: Rng>(
    conn: &Connection,
    winner_id: i64,
    loser_id: i64,
    exclude: &[i64],
    rng: &mut R,
) -> Result<VoteOutcome, AppError> {
    let voted = vote_on(conn, winner_id, loser_id, None, exclude)?;
    Ok(VoteOutcome {
        next_pair: voted.draw.pair(conn, &voted.skip, rng).ok(),
        stats: voted.stats,
    })
}

/// Applies a vote on a showing of four atomically, then returns the next
/// showing with fresh stats (ADR 0061). [`vote_on`] says how; the next showing
/// is four, or a pair once four cannot be drawn.
///
/// `others` are the two the curator named neither best nor worst, in no order.
pub fn vote_four<R: Rng>(
    conn: &Connection,
    best_id: i64,
    worst_id: i64,
    others: [i64; 2],
    exclude: &[i64],
    rng: &mut R,
) -> Result<FourOutcome, AppError> {
    let voted = vote_on(conn, best_id, worst_id, Some(others), exclude)?;
    Ok(FourOutcome {
        next_showing: voted.draw.four(conn, &voted.skip, rng).ok(),
        stats: voted.stats,
    })
}

/// What a committed vote answers from: one read of the pool, the Bar and the
/// record, taken after the commit, which both the next showing and the stats
/// come from.
struct Voted {
    draw: Draw,
    /// What the next showing leaves out: the showing just voted on, always,
    /// and whatever else the caller asked.
    skip: Vec<i64>,
    stats: Stats,
}

/// One vote on one showing, the one implementation behind [`vote`] and
/// [`vote_four`]: the best, the worst, and for a showing of four the two named
/// neither.
///
/// In one transaction: validates that the showing is distinct and Eligible,
/// applies one rating update (`ranking::rate_1vs1` for a pair, one joint
/// `ranking::rate_four` for four, never the pairwise updates it implies),
/// adds one to each member's count, and inserts the one permanent Comparison
/// with its members. Any failure rolls everything back, and a refusal writes
/// nothing.
///
/// The Comparison is durable from the commit on, so the follow-up draw must
/// not surface as a failed vote: it has a genuine logical failure mode
/// (`NotEnoughWallpapers`) that says nothing about whether the vote counted,
/// and the callers turn it into `None`. The read after the commit stays fatal:
/// a handful of `SELECT`s only fail if the database itself is gone, at which
/// point an error is the honest answer. The wallpapers just voted on are
/// always skipped: showing one again straight away is the case the curator
/// reads as "nothing happened".
fn vote_on(
    conn: &Connection,
    best_id: i64,
    worst_id: i64,
    others: Option<[i64; 2]>,
    exclude: &[i64],
) -> Result<Voted, AppError> {
    let showing: Vec<i64> = [best_id, worst_id]
        .into_iter()
        .chain(others.into_iter().flatten())
        .collect();
    let tx = conn.unchecked_transaction()?;
    let ratings = showing
        .iter()
        .map(|&id| Ok(fetch_summary(&tx, id)?.rating()))
        .collect::<Result<Vec<_>, AppError>>()?;
    if (1..showing.len()).any(|i| showing[..i].contains(&showing[i])) {
        // A caller's mistake rather than a fact about a wallpaper: nothing
        // about it is unknown, and it is not a Status transition either
        // (ADR 0025).
        return Err(AppError::BadRequest(format!(
            "a showing needs distinct wallpapers, got {showing:?}"
        )));
    }

    // In `showing`'s order: the best, the worst, then the two named neither.
    let rated = match others {
        Some(_) => {
            let (best, [a, b], worst) =
                ranking::rate_four(ratings[0], [ratings[2], ratings[3]], ratings[1]);
            vec![best, worst, a, b]
        }
        None => {
            let (winner, loser) = ranking::rate_1vs1(ratings[0], ratings[1]);
            vec![winner, loser]
        }
    };
    record(&tx, &showing, &rated)?;
    tx.commit()?;

    let draw = Draw::read(conn)?;
    let stats = stats(conn, &draw.pool)?;
    let mut skip = showing;
    skip.extend_from_slice(exclude);
    Ok(Voted { draw, skip, stats })
}

/// Writes one Comparison inside the caller's transaction: every member's new
/// rating and one more Comparison each, then the permanent row.
///
/// `showing` holds the best first and the worst second, which become the row's
/// winner and loser, then the two of a showing of four named neither, which
/// become its members; `rated` is their new ratings in the same order. A
/// showing counts once for each wallpaper in it, however many relations the
/// vote implies (ADR 0061).
fn record(tx: &Connection, showing: &[i64], rated: &[ranking::Rating]) -> Result<(), AppError> {
    for (id, rating) in showing.iter().zip(rated) {
        tx.execute(
            "UPDATE wallpapers
             SET rating_mu = ?1, rating_sigma = ?2, comparisons_count = comparisons_count + 1
             WHERE id = ?3",
            rusqlite::params![rating.mu, rating.sigma, id],
        )?;
    }
    tx.execute(
        "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
        rusqlite::params![showing[0], showing[1]],
    )?;
    let comparison = tx.last_insert_rowid();
    for member in &showing[2..] {
        tx.execute(
            "INSERT INTO comparison_members (comparison_id, wallpaper_id) VALUES (?1, ?2)",
            rusqlite::params![comparison, member],
        )?;
    }
    Ok(())
}

pub fn get_stats(conn: &Connection) -> Result<Stats, AppError> {
    stats(conn, &Pool::read(conn)?)
}

/// The headline over `pool`, with the two totals read beside it.
///
/// Decided reads the Bar, which SQL cannot work out, so the split counts in
/// Rust over the pool pair selection reads. The Eligible count is that pool's
/// size, so the three sides add up to it by construction.
fn stats(conn: &Connection, pool: &Pool) -> Result<Stats, AppError> {
    let total_wallpapers: u32 =
        conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |r| r.get(0))?;
    let total_comparisons: u32 =
        conn.query_row("SELECT COUNT(*) FROM comparisons", [], |r| r.get(0))?;

    let eligible_count = u32::try_from(pool.wallpapers.len()).unwrap_or(u32::MAX);
    let (mut undecided_count, mut decided_below_count, mut decided_above_count) = (0u32, 0, 0);
    let mut close_call_count = 0u32;
    // Kept wallpapers count like any other here (ADR 0059), though selection
    // never aims at one (ADR 0060).
    for w in &pool.wallpapers {
        match w.standing(pool.bar) {
            Standing::Unrated | Standing::Undecided => undecided_count += 1,
            Standing::CloseCall => {
                undecided_count += 1;
                close_call_count += 1;
            }
            Standing::Decided(Side::Below) => decided_below_count += 1,
            Standing::Decided(Side::Above) => decided_above_count += 1,
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
        assert!((Bar::read(&conn).unwrap().score().unwrap() - 12.45).abs() < 1e-9);
        assert_eq!(s.undecided_count, 3);
        assert_eq!(s.close_call_count, 1);
    }

    // --- showings of four (ADR 0061) ------------------------------------------

    use crate::testing::add_comparison_of_four;

    /// The members of every Comparison of four, sorted, oldest Comparison first.
    fn members(conn: &Connection) -> Vec<Vec<i64>> {
        let mut stmt = conn
            .prepare(
                "SELECT comparison_id, wallpaper_id FROM comparison_members
                 ORDER BY comparison_id, wallpaper_id",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let mut out: Vec<(i64, Vec<i64>)> = Vec::new();
        for (comparison, member) in rows {
            match out.last_mut() {
                Some((last, ids)) if *last == comparison => ids.push(member),
                _ => out.push((comparison, vec![member])),
            }
        }
        out.into_iter().map(|(_, ids)| ids).collect()
    }

    fn ids(showing: &[Wallpaper]) -> Vec<i64> {
        showing.iter().map(|w| w.id).collect()
    }

    fn distinct(ids: &[i64]) -> bool {
        (1..ids.len()).all(|i| !ids[..i].contains(&ids[i]))
    }

    /// Every draw a test sweeps, as a constant sequence.
    const DRAWS: [f64; 6] = [0.0, 0.2, 0.4, 0.6, 0.8, 0.99];

    #[test]
    fn a_vote_on_four_writes_one_comparison_moves_all_four_and_counts_each_once() {
        let conn = test_conn();
        let [best, a, b, worst] = [0; 4].map(|_| seed_on(&conn, "active", MU, SIGMA, 0));

        let outcome = vote_four(&conn, best, worst, [a, b], &[], &mut rng()).unwrap();

        // One row, the best and the worst where the winner and the loser are.
        assert_eq!(comparison_rows(&conn), vec![(best, worst)]);
        assert_eq!(members(&conn), vec![vec![a.min(b), a.max(b)]]);

        // The research script's vector for four fresh ratings.
        let close = |(mu, sigma, count): (f64, f64, i64), m: f64, s: f64| {
            (mu - m).abs() < 1e-4 && (sigma - s).abs() < 1e-4 && count == 1
        };
        assert!(close(ratings(&conn, best), 32.729954, 6.275157));
        assert!(close(ratings(&conn, a), 25.0, 6.305693));
        assert!(close(ratings(&conn, b), 25.0, 6.305693));
        assert!(close(ratings(&conn, worst), 17.270046, 6.275157));

        // One Comparison in the headline total, not the five it implies.
        assert_eq!(outcome.stats.total_comparisons, 1);
        // Four Eligible, so the next showing is the same four again.
        let mut next = ids(&outcome.next_showing.expect("four remain"));
        next.sort_unstable();
        let mut all = vec![best, a, b, worst];
        all.sort_unstable();
        assert_eq!(next, all);
    }

    #[test]
    fn a_vote_on_four_refuses_unknown_ineligible_and_repeated_ids_without_mutating() {
        // The kinds `vote` answers with, for the same reasons (ADR 0025).
        let conn = test_conn();
        let [a, b, c, d] = [0; 4].map(|_| seed_on(&conn, "active", MU, SIGMA, 0));
        let r = seed_on(&conn, "rejected", MU, SIGMA, 2);

        for (best, worst, others) in [(999, a, [b, c]), (a, b, [c, 999])] {
            match vote_four(&conn, best, worst, others, &[], &mut rng()) {
                Err(AppError::NotFound(_)) => {}
                other => panic!("expected NotFound, got {other:?}"),
            }
        }
        for (best, worst, others) in [(r, a, [b, c]), (a, r, [b, c]), (a, b, [r, c])] {
            match vote_four(&conn, best, worst, others, &[], &mut rng()) {
                Err(AppError::UnknownWallpaper(_)) => {}
                other => panic!("expected UnknownWallpaper, got {other:?}"),
            }
        }
        for (best, worst, others) in [
            (a, a, [b, c]),
            (a, b, [c, c]),
            (a, b, [a, c]),
            (a, b, [c, b]),
        ] {
            match vote_four(&conn, best, worst, others, &[], &mut rng()) {
                Err(AppError::BadRequest(_)) => {}
                other => panic!("expected BadRequest, got {other:?}"),
            }
        }

        for id in [a, b, c, d] {
            assert_eq!(ratings(&conn, id), (MU, SIGMA, 0));
        }
        assert_eq!(ratings(&conn, r), (MU, SIGMA, 2));
        assert!(comparison_rows(&conn).is_empty());
        assert!(members(&conn).is_empty());
    }

    #[test]
    fn a_failed_vote_on_four_rolls_back_ratings_counts_and_history() {
        let conn = test_conn();
        let [best, a, b, worst] = [0; 4].map(|_| seed_on(&conn, "active", MU, SIGMA, 0));
        // The last write the vote makes, so everything before it has to undo.
        conn.execute_batch(
            "CREATE TRIGGER fail_member BEFORE INSERT ON comparison_members
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
        )
        .unwrap();

        assert!(matches!(
            vote_four(&conn, best, worst, [a, b], &[], &mut rng()),
            Err(AppError::Db(_))
        ));

        for id in [best, a, b, worst] {
            assert_eq!(ratings(&conn, id), (MU, SIGMA, 0));
        }
        assert!(comparison_rows(&conn).is_empty());
    }

    #[test]
    fn a_showing_of_four_is_four_distinct_eligible_wallpapers_off_the_screen() {
        let conn = test_conn();
        let scored: Vec<i64> = (0..8)
            .map(|i| seed_on(&conn, "active", 20.0 + f64::from(i), 4.0, 3))
            .collect();
        let kept = seed_on(&conn, "kept", 24.0, 4.0, 3);
        let rejected: Vec<i64> = (0..3)
            .map(|_| seed_on(&conn, "rejected", 24.0, 4.0, 0))
            .collect();
        let on_screen = &scored[..4];

        let mut seen_kept = false;
        for draw in DRAWS {
            let showing = ids(&get_four(&conn, on_screen, &mut SeqRng::new(&[draw])).unwrap());
            assert_eq!(showing.len(), 4, "{showing:?}");
            assert!(distinct(&showing), "{showing:?}");
            assert!(
                !showing.iter().any(|id| rejected.contains(id)),
                "{showing:?}"
            );
            assert!(
                !showing.iter().any(|id| on_screen.contains(id)),
                "{showing:?}"
            );
            seen_kept |= showing.contains(&kept);
        }
        assert!(seen_kept, "a Kept wallpaper is Eligible");
    }

    #[test]
    fn a_showing_of_four_never_holds_an_unanswered_near_duplicate_pair() {
        let conn = test_conn();
        let a = seed_hashed(&conn, 0);
        let b = seed_hashed(&conn, 0b11);
        for hash in [u64::MAX, 0xFFFF_0000_FFFF_0000, 0x0F0F_0F0F_0F0F_0F0F] {
            seed_hashed(&conn, hash);
        }
        seed_on(&conn, "active", MU, SIGMA, 0);

        let (mut seen_a, mut seen_b) = (false, false);
        for x in DRAWS {
            for y in DRAWS {
                for z in DRAWS {
                    let showing = ids(&get_four(&conn, &[], &mut SeqRng::new(&[x, y, z])).unwrap());
                    assert_eq!(showing.len(), 4, "{showing:?}");
                    assert!(
                        !(showing.contains(&a) && showing.contains(&b)),
                        "Near-duplicates shown together in {showing:?}"
                    );
                    seen_a |= showing.contains(&a);
                    seen_b |= showing.contains(&b);
                }
            }
        }
        // Each of the two still meets the others.
        assert!(seen_a && seen_b);
    }

    #[test]
    fn four_that_would_hold_an_unanswered_near_duplicate_pair_show_a_pair() {
        let conn = test_conn();
        let a = seed_hashed(&conn, 0);
        let b = seed_hashed(&conn, 0b11);
        seed_hashed(&conn, u64::MAX);
        seed_on(&conn, "active", MU, SIGMA, 0);

        let showing = ids(&get_four(&conn, &[], &mut rng()).unwrap());
        assert_eq!(showing.len(), 2, "{showing:?}");
        assert!(!(showing.contains(&a) && showing.contains(&b)));
    }

    #[test]
    fn the_showing_on_screen_gives_way_one_member_at_a_time() {
        // Five Eligible and four on screen: the fifth is in every showing, so
        // the next one never repeats the one just answered.
        let conn = test_conn();
        let all: Vec<i64> = (0..5)
            .map(|i| seed_on(&conn, "active", 20.0 + f64::from(i), 4.0, 3))
            .collect();
        for draw in DRAWS {
            let showing = ids(&get_four(&conn, &all[..4], &mut SeqRng::new(&[draw])).unwrap());
            assert!(distinct(&showing) && showing.len() == 4, "{showing:?}");
            assert!(showing.contains(&all[4]), "{showing:?}");
        }
    }

    #[test]
    fn fewer_than_four_eligible_show_a_pair() {
        let conn = test_conn();
        let active: Vec<i64> = (0..3)
            .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
            .collect();
        seed_on(&conn, "rejected", MU, SIGMA, 4);

        let showing = ids(&get_four(&conn, &[], &mut rng()).unwrap());
        assert_eq!(showing.len(), 2);
        assert!(distinct(&showing) && showing.iter().all(|id| active.contains(id)));

        // And a vote on four in a library that has since shrunk to three is
        // followed by a pair.
        let conn = test_conn();
        let four: Vec<i64> = (0..4)
            .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
            .collect();
        let extra = seed_on(&conn, "active", MU, SIGMA, 0);
        set_status(&conn, extra, "rejected");
        set_status(&conn, four[3], "kept");
        let outcome =
            vote_four(&conn, four[0], four[1], [four[2], four[3]], &[], &mut rng()).unwrap();
        assert_eq!(outcome.next_showing.unwrap().len(), 4);
        set_status(&conn, four[3], "rejected");
        assert_eq!(get_four(&conn, &[], &mut rng()).unwrap().len(), 2);
    }

    #[test]
    fn where_a_wallpaper_sits_in_a_showing_of_four_is_random() {
        // `fresh` is always the first pick: the one Undecided wallpaper with
        // the fewest Comparisons. Where it lands follows the shuffle alone.
        let conn = test_conn();
        let fresh = seed_on(&conn, "active", 25.0, 5.0, 1);
        for _ in 0..3 {
            seed_on(&conn, "active", 25.0, 5.0, 40);
        }
        let mut positions = Vec::new();
        for draw in DRAWS {
            let showing = ids(&get_four(&conn, &[], &mut SeqRng::new(&[draw])).unwrap());
            positions.push(showing.iter().position(|&id| id == fresh).unwrap());
        }
        positions.sort_unstable();
        positions.dedup();
        assert!(positions.len() > 1, "always at {positions:?}");
    }

    #[test]
    fn a_showing_of_four_holds_at_most_one_unrated() {
        // Fewer than half have a Score, so an arrival is always the first pick,
        // and the rest have a Score because some are available.
        let conn = test_conn();
        for i in 0..4 {
            seed_on(&conn, "active", 20.0 + f64::from(i), 4.0, 3);
        }
        let unrated: Vec<i64> = (0..6)
            .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
            .collect();
        for draw in DRAWS {
            let showing = ids(&get_four(&conn, &[], &mut SeqRng::new(&[draw])).unwrap());
            let arrivals = showing.iter().filter(|id| unrated.contains(id)).count();
            assert_eq!(arrivals, 1, "{showing:?}");
        }
    }

    #[test]
    fn a_showing_of_four_that_was_an_arrivals_first_is_followed_by_none() {
        // Eight of eleven have a Score before the vote: past half, so the cap
        // is on, and enough of them are off the screen to fill a showing. The
        // arrival is a member named neither best nor worst, and the cap reads
        // it as it reads a winner or a loser.
        let library = || {
            let conn = test_conn();
            let scored: Vec<i64> = (0..8)
                .map(|i| seed_on(&conn, "active", 20.0 + f64::from(i), 4.0, 3))
                .collect();
            let arrival = seed_on(&conn, "active", MU, SIGMA, 0);
            let unrated: Vec<i64> = (0..2)
                .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
                .collect();
            (conn, scored, arrival, unrated)
        };

        for draw in DRAWS {
            let (conn, scored, arrival, unrated) = library();
            let outcome = vote_four(
                &conn,
                scored[0],
                scored[1],
                [arrival, scored[2]],
                &[],
                &mut SeqRng::new(&[draw]),
            )
            .unwrap();
            let next = ids(&outcome.next_showing.unwrap());
            assert!(
                !next.iter().any(|id| unrated.contains(id)),
                "an arrival came straight back: {next:?}"
            );
        }

        // One showing later the cap has had its step, and an arrival goes
        // first again.
        let (conn, scored, arrival, unrated) = library();
        vote_four(
            &conn,
            scored[0],
            scored[1],
            [arrival, scored[2]],
            &[],
            &mut rng(),
        )
        .unwrap();
        let outcome = vote_four(
            &conn,
            scored[3],
            scored[4],
            [scored[5], arrival],
            &[],
            &mut rng(),
        )
        .unwrap();
        let next = ids(&outcome.next_showing.unwrap());
        assert_eq!(
            next.iter().filter(|id| unrated.contains(id)).count(),
            1,
            "{next:?}"
        );
    }

    #[test]
    fn a_showing_of_four_is_one_entry_in_the_last_ten() {
        // `m` has the fewest Comparisons of the two Undecided, and sat in a
        // showing of four as a member named neither. It stays out of the first
        // pick for exactly ten Comparisons: the four counts as one of them.
        let conn = test_conn();
        let m = seed_on(&conn, "active", 25.0, 5.0, 1);
        let n = seed_on(&conn, "active", 25.0, 5.0, 2);
        // Far above the Bar and sure of it, so Decided and never a first pick.
        let decided: Vec<i64> = (0..4)
            .map(|_| seed_on(&conn, "active", 60.0, 0.5, 50))
            .collect();
        add_comparison_of_four(&conn, decided[0], decided[1], [m, decided[2]]);
        // A draw of 0.0 keeps selection order, so slot 0 is the first pick.
        let first =
            |conn: &Connection| get_pair(conn, &[], &mut SeqRng::new(&[0.0])).unwrap()[0].id;
        for _ in 0..9 {
            add_comparison(&conn, decided[0], decided[3]);
            assert_eq!(first(&conn), n);
        }
        add_comparison(&conn, decided[0], decided[3]);
        assert_eq!(first(&conn), m);
    }

    #[test]
    fn a_votes_next_showing_of_four_never_holds_a_wallpaper_just_voted_on() {
        let conn = test_conn();
        let four: Vec<i64> = (0..4)
            .map(|_| seed_on(&conn, "active", MU, SIGMA, 0))
            .collect();
        for _ in 0..5 {
            seed_on(&conn, "active", MU, SIGMA, 0);
        }
        for draw in DRAWS {
            let outcome = vote_four(
                &conn,
                four[0],
                four[1],
                [four[2], four[3]],
                &[],
                &mut SeqRng::new(&[draw]),
            )
            .unwrap();
            let next = ids(&outcome.next_showing.expect("five others remain"));
            assert_eq!(next.len(), 4);
            assert!(!next.iter().any(|id| four.contains(id)), "{next:?}");
        }
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
        assert!((Bar::read(&conn).unwrap().score().unwrap() - 12.5).abs() < 1e-9);
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
        assert!((Bar::read(&conn).unwrap().score().unwrap() - 11.5).abs() < 1e-9);
        assert_eq!(s.eligible_count, 12);
        assert_eq!(split(&s), (1, 2, 9));
    }
}
