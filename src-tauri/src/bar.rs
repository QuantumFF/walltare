//! The Bar, Decided and Close call: pure, worked out on every read and never
//! stored (`CONTEXT.md`, [ADR 0056](../../docs/adr/0056-the-bar-is-a-position-over-every-scored-wallpaper.md),
//! [ADR 0058](../../docs/adr/0058-decided-is-the-apps-rule-and-is-never-stored.md),
//! [ADR 0060](../../docs/adr/0060-pair-selection-draws-the-least-compared-undecided-wallpaper.md)).
//!
//! No I/O and no Status. What counts as a Score is the caller's to say, and
//! every rule here reads only the rating, the Comparison count and the Bar.

use crate::ranking::Rating;

/// How many σ a Score has to sit from the Bar before the app is sure which side
/// it is on. The app's, not a setting (ADR 0058).
pub const DECIDED_K: f64 = 2.5;

/// The σ below which an Undecided Score is a Close call. The app's, not a
/// setting (ADR 0060).
pub const CLOSE_CALL_SIGMA: f64 = 1.5;

/// Which side of the Bar a Decided wallpaper's Score is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Below,
    Above,
}

/// The Score at the position `share` among `scores`: the worst `share` of them
/// fall below it.
///
/// Midway between the highest μ inside the share and the lowest one outside
/// it, the way the simulation harness computes it, so neighbouring Scores
/// never sit exactly on the Bar unless they tie. The share always leaves at
/// least one Score on each side. One Score is its own Bar, and none is no Bar.
///
/// `scores` is every wallpaper with a Score, whatever its Status: a Rejected
/// wallpaper's frozen μ is what keeps clearing out from lifting the Bar
/// (ADR 0056).
pub fn bar(scores: &[f64], share: f64) -> Option<f64> {
    let mut sorted = scores.to_vec();
    sorted.sort_by(f64::total_cmp);
    match sorted.len() {
        0 => None,
        1 => Some(sorted[0]),
        n => {
            let k = ((share * n as f64).round() as usize).clamp(1, n - 1);
            Some((sorted[k - 1] + sorted[k]) / 2.0)
        }
    }
}

/// Which side of the Bar a wallpaper is Decided on, or nothing while it is
/// Undecided.
///
/// Decided when |μ − Bar| ≥ 2.5σ, with no indifference zone (ADR 0058). An
/// Unrated wallpaper is never Decided, whatever its starting Score, and with no
/// Bar nothing is.
pub fn decided(rating: Rating, comparisons: u32, bar: Option<f64>) -> Option<Side> {
    let bar = bar?;
    if comparisons == 0 || (rating.mu - bar).abs() < DECIDED_K * rating.sigma {
        return None;
    }
    Some(if rating.mu < bar {
        Side::Below
    } else {
        Side::Above
    })
}

/// Whether a wallpaper is a Close call: Undecided, with a Score, and σ below
/// [`CLOSE_CALL_SIGMA`] (ADR 0060).
///
/// With no Bar nothing has a Score to be Undecided against, so nothing is one.
pub fn close_call(rating: Rating, comparisons: u32, bar: Option<f64>) -> bool {
    bar.is_some()
        && comparisons > 0
        && rating.sigma < CLOSE_CALL_SIGMA
        && decided(rating, comparisons, bar).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ten Scores, 1 through 10, shuffled so the sort is doing work.
    fn ten() -> Vec<f64> {
        vec![7.0, 2.0, 10.0, 4.0, 1.0, 9.0, 3.0, 6.0, 8.0, 5.0]
    }

    #[test]
    fn each_preset_puts_the_bar_midway_past_its_share() {
        for (share, expected) in [(0.1, 1.5), (0.2, 2.5), (0.3, 3.5), (0.5, 5.5)] {
            assert_eq!(bar(&ten(), share), Some(expected), "share {share}");
        }
    }

    #[test]
    fn no_scores_is_no_bar_and_one_score_is_its_own() {
        assert_eq!(bar(&[], 0.2), None);
        assert_eq!(bar(&[31.0], 0.2), Some(31.0));
    }

    #[test]
    fn the_share_always_leaves_a_score_on_each_side() {
        // Two Scores at 10% would round to none below; the Bar still falls
        // between them rather than under both.
        assert_eq!(bar(&[20.0, 30.0], 0.1), Some(25.0));
        assert_eq!(bar(&[20.0, 30.0], 0.5), Some(25.0));
        // And three at 50% rounds half away from zero, as the harness does.
        assert_eq!(bar(&[10.0, 20.0, 30.0], 0.5), Some(25.0));
    }

    fn rating(mu: f64, sigma: f64) -> Rating {
        Rating::new(mu, sigma)
    }

    #[test]
    fn decided_at_exactly_two_and_a_half_sigma_on_either_side() {
        let bar = Some(20.0);
        assert_eq!(decided(rating(25.0, 2.0), 3, bar), Some(Side::Above));
        assert_eq!(decided(rating(15.0, 2.0), 3, bar), Some(Side::Below));
    }

    #[test]
    fn undecided_just_inside_two_and_a_half_sigma() {
        let bar = Some(20.0);
        assert_eq!(decided(rating(24.9, 2.0), 3, bar), None);
        assert_eq!(decided(rating(15.1, 2.0), 3, bar), None);
    }

    #[test]
    fn an_unrated_wallpaper_is_never_decided_nor_a_close_call() {
        // A confident starting Score from a prediction still decides nothing.
        let far = rating(2.0, 0.5);
        assert_eq!(decided(far, 0, Some(20.0)), None);
        assert!(!close_call(rating(20.0, 0.5), 0, Some(20.0)));
    }

    #[test]
    fn with_no_bar_nothing_is_decided_or_a_close_call() {
        assert_eq!(decided(rating(2.0, 0.5), 9, None), None);
        assert!(!close_call(rating(20.0, 0.5), 9, None));
    }

    #[test]
    fn a_close_call_is_undecided_scored_and_sure() {
        let bar = Some(20.0);
        // Either side of the Bar, inside 2.5σ, σ under 1.5.
        assert!(close_call(rating(21.0, 1.4), 12, bar));
        assert!(close_call(rating(19.0, 1.4), 12, bar));
        // σ at the threshold is not under it.
        assert!(!close_call(rating(20.5, 1.5), 12, bar));
        // Decided, exactly 2.5σ away on either side, is not a Close call.
        assert!(!close_call(rating(22.5, 1.0), 12, bar));
        assert!(!close_call(rating(17.5, 1.0), 12, bar));
    }
}
