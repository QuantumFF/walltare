//! The Bar, and where a wallpaper stands against it: Unrated, Undecided, a
//! Close call, or Decided on one side. Worked out on every read and never
//! stored (`CONTEXT.md`, [ADR 0056](../../docs/adr/0056-the-bar-is-a-position-over-every-scored-wallpaper.md),
//! [ADR 0058](../../docs/adr/0058-decided-is-the-apps-rule-and-is-never-stored.md),
//! [ADR 0060](../../docs/adr/0060-pair-selection-draws-the-least-compared-undecided-wallpaper.md)).
//!
//! The rules are pure and read only the rating, the Comparison count and the
//! Bar, never the Status. The one piece of I/O is [`Bar::read`] at the bottom,
//! the adapter that finds the Bar in the database. It sits here rather than
//! beside the voting pool because which wallpapers set the Bar (every one with
//! a Score, Rejected included) is the Bar's own rule, not the pool's.
//!
//! This module is also the one home of Unrated: [`UNRATED_SQL`] and
//! [`is_unrated`] are its two spellings, and a test holds them together the way
//! Eligible's are (ADR 0024).

use rusqlite::Connection;

use crate::error::AppError;
use crate::ranking::Rating;

/// How many σ a Score has to sit from the Bar before the app is sure which side
/// it is on. The app's, not a setting (ADR 0058).
pub const DECIDED_K: f64 = 2.5;

/// The σ below which an Undecided Score is a Close call. The app's, not a
/// setting (ADR 0060).
pub const CLOSE_CALL_SIGMA: f64 = 1.5;

/// Unrated as a `WHERE` fragment over `wallpapers`: in no Comparison, so no
/// Score, whatever starting Score a prediction gave it (ADR 0057).
///
/// One of Unrated's two forms. SQL asks it of rows it has not read, to set the
/// Bar and to tail Unrated wallpapers out of the Score orderings (ADR 0028);
/// [`is_unrated`] asks it of a count already in hand.
pub const UNRATED_SQL: &str = "comparisons_count = 0";

/// Whether a wallpaper with this many Comparisons is Unrated.
/// [`UNRATED_SQL`]'s in-memory half.
pub fn is_unrated(comparisons: u32) -> bool {
    comparisons == 0
}

/// Which side of the Bar a Decided wallpaper's Score is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Below,
    Above,
}

/// Where a wallpaper stands against the Bar: one answer for Unrated, Decided
/// and Close call together, so nothing has to combine them by hand.
///
/// Every variant but [`Self::Decided`] is Undecided in `CONTEXT.md`'s sense:
/// the app does not know which side of the Bar it falls on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    /// In no Comparison, so no Score to place, whatever its starting Score
    /// (ADR 0057, ADR 0058).
    Unrated,
    /// A Score whose side of the Bar the app is not sure of yet, and which
    /// another Comparison is still worth spending on.
    Undecided,
    /// Undecided, with a Score so sure that another Comparison is not worth
    /// its cost (ADR 0060).
    CloseCall,
    /// Sure which side of the Bar the Score falls on (ADR 0058).
    Decided(Side),
}

/// The Bar as it stands: the Score a wallpaper has to clear to stay, or no Bar
/// while no wallpaper has a Score.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bar(Option<f64>);

impl Bar {
    /// No Bar: nothing has a Score to set one.
    pub const NONE: Self = Self(None);

    /// The Score at the position `share` among `scores`: the worst `share` of
    /// them fall below it.
    ///
    /// Midway between the highest μ inside the share and the lowest one outside
    /// it, the way the simulation harness computes it, so neighbouring Scores
    /// never sit exactly on the Bar unless they tie. The share always leaves at
    /// least one Score on each side. One Score is its own Bar, and none is no
    /// Bar.
    ///
    /// `scores` is every wallpaper with a Score, whatever its Status: a Rejected
    /// wallpaper's frozen μ is what keeps clearing out from lifting the Bar
    /// (ADR 0056).
    pub fn over(scores: &[f64], share: f64) -> Self {
        let mut sorted = scores.to_vec();
        sorted.sort_by(f64::total_cmp);
        Self(match sorted.len() {
            0 => None,
            1 => Some(sorted[0]),
            n => {
                let k = ((share * n as f64).round() as usize).clamp(1, n - 1);
                Some((sorted[k - 1] + sorted[k]) / 2.0)
            }
        })
    }

    /// A Bar at `score`, for tests that state one rather than set it.
    #[cfg(test)]
    pub const fn at(score: f64) -> Self {
        Self(Some(score))
    }

    /// The Score the Bar sits at, or `None` when there is no Bar.
    pub fn score(self) -> Option<f64> {
        self.0
    }

    /// Where a wallpaper with this rating and this many Comparisons stands.
    ///
    /// Decided when |μ − Bar| ≥ 2.5σ, with no indifference zone (ADR 0058).
    /// Otherwise a Close call once σ is below [`CLOSE_CALL_SIGMA`], and
    /// Undecided until then. An Unrated wallpaper is Unrated whatever its
    /// starting Score, and with no Bar every Score is Undecided.
    pub fn standing(self, rating: Rating, comparisons: u32) -> Standing {
        if is_unrated(comparisons) {
            return Standing::Unrated;
        }
        let Some(bar) = self.0 else {
            return Standing::Undecided;
        };
        if (rating.mu - bar).abs() >= DECIDED_K * rating.sigma {
            Standing::Decided(if rating.mu < bar {
                Side::Below
            } else {
                Side::Above
            })
        } else if rating.sigma < CLOSE_CALL_SIGMA {
            Standing::CloseCall
        } else {
            Standing::Undecided
        }
    }

    /// The Bar in the database: the curator's share over every wallpaper with a
    /// Score, whatever its Status.
    ///
    /// Worked out on every call and never stored (ADR 0056). Rejected rows count
    /// on purpose: their frozen Scores are what keep a soft reject below the Bar
    /// from lifting it. The share is read here rather than passed in, so every
    /// reader of the Bar reads it against the same row.
    pub fn read(conn: &Connection) -> Result<Self, AppError> {
        let share = crate::settings::bar_share(conn)?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT rating_mu FROM wallpapers WHERE NOT ({UNRATED_SQL})"
        ))?;
        let scores = stmt
            .query_map([], |row| row.get::<_, f64>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self::over(&scores, share))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ranking::{MU, SIGMA};

    /// Ten Scores, 1 through 10, shuffled so the sort is doing work.
    fn ten() -> Vec<f64> {
        vec![7.0, 2.0, 10.0, 4.0, 1.0, 9.0, 3.0, 6.0, 8.0, 5.0]
    }

    #[test]
    fn each_preset_puts_the_bar_midway_past_its_share() {
        for (share, expected) in [(0.1, 1.5), (0.2, 2.5), (0.3, 3.5), (0.5, 5.5)] {
            assert_eq!(Bar::over(&ten(), share), Bar::at(expected), "share {share}");
        }
    }

    #[test]
    fn no_scores_is_no_bar_and_one_score_is_its_own() {
        assert_eq!(Bar::over(&[], 0.2), Bar::NONE);
        assert_eq!(Bar::over(&[31.0], 0.2), Bar::at(31.0));
    }

    #[test]
    fn the_share_always_leaves_a_score_on_each_side() {
        // Two Scores at 10% would round to none below; the Bar still falls
        // between them rather than under both.
        assert_eq!(Bar::over(&[20.0, 30.0], 0.1), Bar::at(25.0));
        assert_eq!(Bar::over(&[20.0, 30.0], 0.5), Bar::at(25.0));
        // And three at 50% rounds half away from zero, as the harness does.
        assert_eq!(Bar::over(&[10.0, 20.0, 30.0], 0.5), Bar::at(25.0));
    }

    fn rating(mu: f64, sigma: f64) -> Rating {
        Rating::new(mu, sigma)
    }

    #[test]
    fn decided_at_exactly_two_and_a_half_sigma_on_either_side() {
        let bar = Bar::at(20.0);
        assert_eq!(
            bar.standing(rating(25.0, 2.0), 3),
            Standing::Decided(Side::Above)
        );
        assert_eq!(
            bar.standing(rating(15.0, 2.0), 3),
            Standing::Decided(Side::Below)
        );
    }

    #[test]
    fn undecided_just_inside_two_and_a_half_sigma() {
        let bar = Bar::at(20.0);
        assert_eq!(bar.standing(rating(24.9, 2.0), 3), Standing::Undecided);
        assert_eq!(bar.standing(rating(15.1, 2.0), 3), Standing::Undecided);
    }

    #[test]
    fn an_unrated_wallpaper_is_unrated_whatever_its_starting_score() {
        // A confident starting Score from a prediction still decides nothing,
        // and is no Close call either.
        let bar = Bar::at(20.0);
        for r in [rating(2.0, 0.5), rating(40.0, 0.5), rating(20.0, 0.5)] {
            assert_eq!(bar.standing(r, 0), Standing::Unrated, "{r:?}");
        }
        assert_eq!(Bar::NONE.standing(rating(MU, SIGMA), 0), Standing::Unrated);
    }

    #[test]
    fn with_no_bar_every_score_is_undecided() {
        // Neither Decided however far it sits, nor a Close call however sure.
        for r in [rating(2.0, 0.5), rating(19.5, 0.5), rating(20.5, 0.5)] {
            assert_eq!(Bar::NONE.standing(r, 9), Standing::Undecided, "{r:?}");
        }
    }

    #[test]
    fn a_close_call_is_undecided_scored_and_sure() {
        let bar = Bar::at(20.0);
        // Either side of the Bar, inside 2.5σ, σ under 1.5.
        assert_eq!(bar.standing(rating(21.0, 1.4), 12), Standing::CloseCall);
        assert_eq!(bar.standing(rating(19.0, 1.4), 12), Standing::CloseCall);
        // σ at the threshold is not under it.
        assert_eq!(bar.standing(rating(20.5, 1.5), 12), Standing::Undecided);
        // Decided, exactly 2.5σ away on either side, is not a Close call.
        assert_eq!(
            bar.standing(rating(22.5, 1.0), 12),
            Standing::Decided(Side::Above)
        );
        assert_eq!(
            bar.standing(rating(17.5, 1.0), 12),
            Standing::Decided(Side::Below)
        );
    }

    // --- the read --------------------------------------------------------------

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    /// Inserts a wallpaper row directly, returning its id.
    fn seed(conn: &Connection, status: &str, mu: f64, count: u32) -> i64 {
        let id = crate::testing::seed_wallpaper(
            conn,
            &format!("/w/{}.jpg", crate::testing::count_wallpapers(conn)),
            status,
            mu,
        );
        conn.execute(
            "UPDATE wallpapers SET rating_sigma = 3.0, comparisons_count = ?2 WHERE id = ?1",
            rusqlite::params![id, count],
        )
        .unwrap();
        id
    }

    fn read(conn: &Connection) -> Option<f64> {
        Bar::read(conn).unwrap().score()
    }

    #[test]
    fn unrated_selects_exactly_the_rows_the_predicate_returns_true_for() {
        // `CONTEXT.md`'s Unrated entry, made checkable: the SQL and the
        // in-memory spelling hold together, the way Eligible's do (ADR 0024).
        let conn = test_conn();
        let counts = [0, 1, 2, 0, 40];
        let seeded: Vec<(i64, u32)> = counts
            .iter()
            .map(|&count| (seed(&conn, "active", MU, count), count))
            .collect();

        let mut stmt = conn
            .prepare(&format!(
                "SELECT id FROM wallpapers WHERE {UNRATED_SQL} ORDER BY id"
            ))
            .unwrap();
        let selected: Vec<i64> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        let by_predicate: Vec<i64> = seeded
            .iter()
            .filter(|(_, count)| is_unrated(*count))
            .map(|(id, _)| *id)
            .collect();

        assert_eq!(selected, by_predicate);
        assert_eq!(selected, vec![seeded[0].0, seeded[3].0]);
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
            seed(&conn, status, f64::from(mu), 4);
        }
        // Unrated rows with starting Scores that would drag the Bar down if they
        // counted.
        for _ in 0..10 {
            seed(&conn, "active", 0.5, 0);
        }

        assert_eq!(read(&conn), Some(2.5));
    }

    #[test]
    fn the_bar_follows_the_share_the_curator_set() {
        let conn = test_conn();
        for mu in 1..=10 {
            seed(&conn, "active", f64::from(mu), 4);
        }
        let detected = crate::settings::Detected::default();
        for (share, expected) in [("0.1", 1.5), ("0.3", 3.5), ("0.5", 5.5), ("0.2", 2.5)] {
            crate::settings::set(&conn, "bar_share", share, detected).unwrap();
            assert_eq!(read(&conn), Some(expected), "share {share}");
        }
    }

    #[test]
    fn an_empty_or_unrated_library_has_no_bar_and_one_score_is_its_own() {
        let conn = test_conn();
        assert_eq!(read(&conn), None);
        seed(&conn, "active", MU, 0);
        assert_eq!(read(&conn), None);
        seed(&conn, "active", 27.0, 1);
        assert_eq!(read(&conn), Some(27.0));
    }

    #[test]
    fn rejecting_a_wallpaper_below_the_bar_leaves_the_bar_where_it_was() {
        let conn = test_conn();
        let ids: Vec<i64> = (1..=10)
            .map(|mu| seed(&conn, "active", f64::from(mu), 4))
            .collect();
        let before = read(&conn);
        assert_eq!(before, Some(2.5));

        // The worst two are the worst fifth; clearing both out is where
        // clearing out ends, and the Bar has not moved to make a new worst fifth.
        for id in &ids[..2] {
            conn.execute(
                "UPDATE wallpapers SET status = 'rejected' WHERE id = ?1",
                [id],
            )
            .unwrap();
            assert_eq!(read(&conn), before);
        }
    }
}
