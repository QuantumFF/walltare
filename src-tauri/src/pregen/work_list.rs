//! The pre-generation pass's work list: what the thumbnail cache says the pass
//! owes, in the order the pass reaches it.
//!
//! Which wallpapers are owed something, and what, is [`ThumbnailCache::owed`]'s
//! to say, because the freshness rule and the failure notes are the cache's
//! (#422). The order is the pass's, because it is about which pair Rank draws
//! next and the cache has no view on that (ADR 0012, ADR 0016).

use crate::db::Status;
use crate::error::AppError;
use crate::thumbnails::{Pending, ThumbnailCache};
use crate::Db;

/// Every wallpaper the pre-generation pass would warm, in the order it would
/// reach them.
///
/// The length is the honest total for the pass's progress, because a wallpaper
/// the cache owes nothing never enters the list.
pub fn work_list(db: &Db, cache: &ThumbnailCache) -> Result<Vec<Pending>, AppError> {
    let mut work = cache.owed(db)?;
    order(&mut work);
    Ok(work)
}

/// Puts the list in the order the pass reaches it: Rejected last, then least
/// compared first, then by id.
///
/// Rejected is a tail group behind the Eligible pool, so warming rejects costs
/// the voting pool nothing (ADR 0016), and least compared first targets the
/// half of a pair `select_pair` picks by least-compared ties, which is the half
/// anything can aim at. A scan inserts rows at count 0, so freshly scanned
/// files land at the head.
///
/// Each entry keeps the Status it was listed under, because the pass compares
/// the row against that rather than against Eligible: a Rejected entry is the
/// tail group and gets generated, one rejected after the fact does not.
fn order(work: &mut [Pending]) {
    work.sort_by_key(|p| {
        (
            p.status == Status::Rejected,
            p.comparisons_count,
            p.wallpaper_id,
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thumbnails::Missing;
    use std::path::PathBuf;

    fn owed(wallpaper_id: i64, status: Status, comparisons_count: i64) -> Pending {
        Pending {
            wallpaper_id,
            source: PathBuf::from(format!("/w/{wallpaper_id}.png")),
            status,
            comparisons_count,
            missing: Some(Missing::Both),
        }
    }

    #[test]
    fn the_work_list_puts_rejected_last_and_least_compared_first() {
        let voted = owed(1, Status::Active, 9);
        let rejected_fresh = owed(2, Status::Rejected, 0);
        let scanned = owed(3, Status::Active, 0);
        let rejected_voted = owed(4, Status::Rejected, 9);
        let kept = owed(5, Status::Kept, 3);
        let tied = owed(6, Status::Active, 0);
        let mut work = vec![
            voted.clone(),
            rejected_fresh.clone(),
            tied.clone(),
            scanned.clone(),
            rejected_voted.clone(),
            kept.clone(),
        ];

        order(&mut work);

        // Kept is Eligible, so it sits in the head group with Active; a scan
        // inserts at count 0, which is where the next pair is drawn from, and
        // a tie goes to the lower id.
        assert_eq!(
            work,
            vec![scanned, tied, kept, voted, rejected_fresh, rejected_voted]
        );
    }
}
