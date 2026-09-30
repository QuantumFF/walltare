//! Near-duplicate pairs: which ones are waiting, and the answers to them.
//!
//! A pair is a standing and never a record, so nothing here writes one down:
//! the waiting pairs are worked out from the stored perceptual hashes each time
//! somebody asks. A scan over a few thousand 64-bit hashes is cheap, and a
//! stored list would have to be kept in step with every reject, Restore and
//! newly hashed wallpaper (CONTEXT.md, #393). What is recorded is the curator's
//! judgement that a pair is Distinct, which keeps it out of the listing for
//! good.
//!
//! Answering never writes a Comparison. Keeping one is the ordinary soft
//! reject of the other, so a Restore undoes it and the pair is waiting again,
//! unless it is Distinct. Keeping both makes it Distinct.
//!
//! A wallpaper that arrives after a Near-duplicate of it was rejected is
//! offered as one the curator rejected before. Keeping it makes the pair
//! Distinct, as keeping both does, and rejecting it is keeping the Rejected
//! one. A wallpaper that was already there when the other was rejected is no
//! arrival, which is what keeps a keep-one answer from being asked again.

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::db::{self, Status, Wallpaper};
use crate::error::AppError;
use crate::soft_reject;

/// How many bits two perceptual hashes may differ by and still be one image.
///
/// Measured on the curator's library with the shipped hasher (#400): every
/// re-encode, resize and colour edit landed within 2 bits and a 95% crop within
/// 12, while the closest two unrelated wallpapers were 16 apart.
pub const HAMMING_LIMIT: u32 = 10;

/// Every Near-duplicate pair waiting for an answer, in order of each pair's
/// lower id, whichever side the kind shows it on.
///
/// Two wallpapers whose hashes are within [`HAMMING_LIMIT`], offered by
/// [`offering`]'s Status matrix. A wallpaper pre-generation has not hashed yet
/// is in no pair, rather than in a pair with something it might not resemble. A
/// Distinct pair is never waiting. Three wallpapers of one image are three
/// pairs, so answering one leaves the others.
pub fn waiting_pairs(conn: &Connection) -> Result<Vec<NearDuplicatePair>, AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, perceptual_hash, status, created_at, rejected_at FROM wallpapers
         WHERE perceptual_hash IS NOT NULL
         ORDER BY id",
    )?;
    // SQLite's integers are signed, so the hash went in as the same bits read
    // as an `i64` (`db::record_perceptual_hash`) and comes back out the same way.
    let hashed = stmt
        .query_map([], |row| {
            Ok(Candidate {
                id: row.get(0)?,
                hash: row.get::<_, i64>(1)? as u64,
                status: row.get(2)?,
                created_at: row.get(3)?,
                rejected_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let distinct = distinct_pairs(conn)?;

    // Each row read once, however many pairs it is in.
    let mut rows: HashMap<i64, Wallpaper> = HashMap::new();
    let mut row = |id: i64| -> Result<Wallpaper, AppError> {
        if let Some(row) = rows.get(&id) {
            return Ok(row.clone());
        }
        let read = db::get_wallpaper(conn, id)?;
        rows.insert(id, read.clone());
        Ok(read)
    };

    let mut pairs = Vec::new();
    for (i, a) in hashed.iter().enumerate() {
        for b in &hashed[i + 1..] {
            // `a` is below `b`, the order a Distinct record is keyed in.
            if !within_limit(a.hash, b.hash) || distinct.contains(&(a.id, b.id)) {
                continue;
            }
            if let Some((kind, [first, second])) = offering(a, b) {
                pairs.push(NearDuplicatePair {
                    kind,
                    wallpapers: [row(first)?, row(second)?],
                });
            }
        }
    }
    Ok(pairs)
}

/// How two Near-duplicates are offered, with the ids in the order the kind
/// shows them, or `None` when they are not.
///
/// - Active or Kept against Active or Kept: keep one, lower id first.
/// - Active or Kept against Rejected: rejected before, the arrival first, but
///   only if it arrived after the reject. One already there was in the library
///   beside the other when the curator rejected it.
/// - Two Rejected wallpapers: never offered, since both are gone already.
fn offering(a: &Candidate, b: &Candidate) -> Option<(PairKind, [i64; 2])> {
    match (a.status.is_eligible(), b.status.is_eligible()) {
        (true, true) => Some((PairKind::KeepOne, [a.id, b.id])),
        (true, false) => arrived_after(a, b).then_some((PairKind::RejectedBefore, [a.id, b.id])),
        (false, true) => arrived_after(b, a).then_some((PairKind::RejectedBefore, [b.id, a.id])),
        (false, false) => None,
    }
}

/// Whether `arrival` came into the library after `rejected`'s reject.
///
/// Strictly after: both are whole seconds, and the wallpaper a keep-one answer
/// kept may share the second the answer rejected the other in.
fn arrived_after(arrival: &Candidate, rejected: &Candidate) -> bool {
    rejected
        .rejected_at
        .is_some_and(|at| arrival.created_at > at)
}

/// A hashed wallpaper as [`waiting_pairs`] reads it: enough to pair it and to
/// say how the pair is offered.
struct Candidate {
    id: i64,
    hash: u64,
    status: Status,
    /// When the wallpaper arrived, in Unix seconds.
    created_at: i64,
    /// When its current soft reject happened, `None` unless it is Rejected.
    rejected_at: Option<i64>,
}

/// The unanswered Near-duplicate pairs among the Eligible wallpapers, which
/// pair selection keeps apart (#403).
///
/// These are the pairs [`waiting_pairs`] offers as keep-one. A rejected-before
/// pair is not among them, since its Rejected wallpaper is never drawn. An
/// answer either soft-rejects one of the two or makes the pair Distinct, and
/// both take it out, so a Distinct pair can be drawn together. Reading it costs one pass
/// over the hashes, and each pair asked about is worked out then, so a draw
/// never pays for every pair in the library.
pub fn unanswered_pairs(conn: &Connection) -> Result<UnansweredPairs, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT id, perceptual_hash FROM wallpapers
         WHERE perceptual_hash IS NOT NULL AND {}",
        Status::ELIGIBLE_SQL
    ))?;
    let hashes = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?
        .collect::<Result<_, _>>()?;
    Ok(UnansweredPairs {
        hashes,
        distinct: distinct_pairs(conn)?,
    })
}

/// What [`unanswered_pairs`] read: the Eligible wallpapers' hashes and the
/// Distinct pairs.
pub struct UnansweredPairs {
    hashes: HashMap<i64, u64>,
    distinct: HashSet<(i64, i64)>,
}

impl UnansweredPairs {
    /// Whether `a` and `b`, in either order, are an unanswered Near-duplicate
    /// pair. A wallpaper that is not Eligible or not hashed yet is in none.
    pub fn contains(&self, a: i64, b: i64) -> bool {
        match (self.hashes.get(&a), self.hashes.get(&b)) {
            (Some(&a_hash), Some(&b_hash)) => {
                a != b
                    && within_limit(a_hash, b_hash)
                    && !self.distinct.contains(&(a.min(b), a.max(b)))
            }
            _ => false,
        }
    }
}

/// Whether two perceptual hashes are close enough to be one image.
fn within_limit(a: u64, b: u64) -> bool {
    (a ^ b).count_ones() <= HAMMING_LIMIT
}

/// Keeps `kept` and soft-rejects `other` into `destination_folder`, answering
/// with the row the reject wrote.
///
/// A rejected-before pair is answered this way too when the curator rejects
/// the arrival: `kept` is the Rejected wallpaper, which stays as it is.
///
/// Refused with [`AppError::InvalidTransition`], rejecting nothing, unless the
/// two are still a waiting pair and `other` is one this pair may reject. The
/// listing the curator answered from may be out of date: had `kept` been
/// rejected since, keeping it would take the pair's last wallpaper out of the
/// library.
///
/// The check reads with the connection released and the reject takes it again,
/// because [`soft_reject::reject_in`] stages a cross-device copy between its
/// own read and write (ADR 0039). A Status change landing in between is still
/// caught for `other` by the reject's own guard.
pub fn keep_one(
    db: &crate::Db,
    kept: i64,
    other: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError> {
    db.read(|conn| {
        let pair = refuse_unless_waiting(conn, kept, other)?;
        if pair.kind == PairKind::RejectedBefore && pair.wallpapers[0].id != other {
            return Err(AppError::InvalidTransition(format!(
                "wallpaper {other} is the Rejected one of its pair, so only the other can be rejected"
            )));
        }
        Ok(())
    })?;
    soft_reject::reject_in(db, other, destination_folder)
}

/// Keeps both `a` and `b`, recording the pair as Distinct so it is never
/// offered again, across scans and restarts.
///
/// A rejected-before pair is answered this way when the curator keeps the
/// arrival: the Rejected wallpaper stays Rejected, and the two are no longer
/// one image as far as the listing goes, even once both are Active.
///
/// Refused with [`AppError::InvalidTransition`], recording nothing, unless the
/// two are still a waiting pair, for [`keep_one`]'s reason. The check and the
/// record share the one connection, so nothing lands between them. Neither
/// wallpaper's Status changes and no Comparison is written.
pub fn keep_both(conn: &Connection, a: i64, b: i64) -> Result<(), AppError> {
    refuse_unless_waiting(conn, a, b)?;
    conn.execute(
        "INSERT INTO distinct_pairs (low_id, high_id) VALUES (?1, ?2)",
        [a.min(b), a.max(b)],
    )?;
    Ok(())
}

/// The waiting pair `a` and `b` are, in either order, refusing an answer to
/// them if they are not one.
fn refuse_unless_waiting(conn: &Connection, a: i64, b: i64) -> Result<NearDuplicatePair, AppError> {
    waiting_pairs(conn)?
        .into_iter()
        .find(|pair| {
            let ids = (pair.wallpapers[0].id, pair.wallpapers[1].id);
            ids == (a, b) || ids == (b, a)
        })
        .ok_or_else(|| {
            AppError::InvalidTransition(format!(
                "wallpapers {a} and {b} are not a waiting Near-duplicate pair"
            ))
        })
}

/// Every Distinct pair, lowest id first in each.
fn distinct_pairs(conn: &Connection) -> Result<HashSet<(i64, i64)>, AppError> {
    let mut stmt = conn.prepare_cached("SELECT low_id, high_id FROM distinct_pairs")?;
    let pairs = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(pairs)
}

/// A waiting Near-duplicate pair and how it is offered.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NearDuplicatePair {
    pub kind: PairKind,
    pub wallpapers: [Wallpaper; 2],
}

/// How a pair is offered, which decides the answers it is given.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairKind {
    /// Two Active or Kept wallpapers, answered by keeping one or keeping both.
    KeepOne,
    /// An Active or Kept arrival first and the Rejected wallpaper it arrived
    /// after second, answered by keeping the arrival or rejecting it.
    RejectedBefore,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{get_wallpaper, init_schema, record_perceptual_hash};
    use crate::testing::*;
    use std::path::Path;

    fn library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn hashed(conn: &Connection, path: &str, status: &str, hash: u64) -> i64 {
        let id = seed_wallpaper(conn, path, status, 25.0);
        record_perceptual_hash(conn, id, hash).unwrap();
        id
    }

    fn pair_ids(conn: &Connection) -> Vec<(i64, i64)> {
        waiting_pairs(conn)
            .unwrap()
            .iter()
            .map(|p| (p.wallpapers[0].id, p.wallpapers[1].id))
            .collect()
    }

    /// Every Distinct record, as the ids it is keyed by.
    fn distinct_rows(conn: &Connection) -> Vec<(i64, i64)> {
        let mut stmt = conn
            .prepare("SELECT low_id, high_id FROM distinct_pairs ORDER BY low_id, high_id")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn two_eligible_wallpapers_within_ten_bits_are_a_keep_one_pair() {
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        let b = hashed(&conn, "/w/b.jpg", "kept", 0b11_1111_1111);

        let pairs = waiting_pairs(&conn).unwrap();

        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].kind, PairKind::KeepOne);
        assert_eq!(pair_ids(&conn), vec![(a, b)]);
        assert_eq!(pairs[0].wallpapers[1].filename, "b.jpg");
    }

    #[test]
    fn wallpapers_eleven_bits_apart_are_no_pair() {
        let conn = library();
        hashed(&conn, "/w/a.jpg", "active", 0);
        hashed(&conn, "/w/b.jpg", "active", 0b111_1111_1111);

        assert!(pair_ids(&conn).is_empty());
    }

    #[test]
    fn a_wallpaper_with_no_hash_yet_is_in_no_pair() {
        // Pre-generation hashes in the background, so an unhashed wallpaper is
        // one nothing has looked at yet rather than one like no other.
        let conn = library();
        hashed(&conn, "/w/a.jpg", "active", 0);
        seed_wallpaper(&conn, "/w/b.jpg", "active", 25.0);

        assert!(pair_ids(&conn).is_empty());
    }

    #[test]
    fn a_rejected_wallpaper_is_in_no_keep_one_pair() {
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        hashed(&conn, "/w/b.jpg", "rejected", 0);
        let c = hashed(&conn, "/w/c.jpg", "kept", 1);

        assert_eq!(pair_ids(&conn), vec![(a, c)]);
    }

    #[test]
    fn a_pair_crosses_the_ipc_with_the_fields_client_ts_expects() {
        let conn = library();
        hashed(&conn, "/w/a.jpg", "active", 0);
        hashed(&conn, "/w/b.jpg", "active", 0);

        let json = serde_json::to_value(&waiting_pairs(&conn).unwrap()[0]).unwrap();

        assert_eq!(json["kind"], "keep_one");
        assert_eq!(json["wallpapers"][0]["filename"], "a.jpg");
        assert_eq!(json["wallpapers"][1]["filename"], "b.jpg");
    }

    /// Two real files carrying one hash, behind a `Db` the way the command
    /// holds it.
    fn real_pair(dir: &Path) -> (crate::Db, i64, i64) {
        let conn = library();
        let a = seed_real_wallpaper(&conn, dir, "a.jpg");
        let b = seed_real_wallpaper(&conn, dir, "b.jpg");
        record_perceptual_hash(&conn, a, 7).unwrap();
        record_perceptual_hash(&conn, b, 7).unwrap();
        (crate::Db::new(conn), a, b)
    }

    #[test]
    fn keep_one_soft_rejects_the_other_and_the_pair_is_no_longer_waiting() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());

        let rejected = keep_one(&db, a, b, "rejected").unwrap();

        assert_eq!(rejected.id, b);
        assert_eq!(rejected.status, Status::Rejected);
        assert!(tmp.path().join("rejected").join("b.jpg").is_file());
        db.read(|conn| {
            assert_eq!(status_of(conn, a), "active");
            assert!(pair_ids(conn).is_empty());
        });
    }

    #[test]
    fn restoring_the_rejected_wallpaper_brings_the_pair_back() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());
        keep_one(&db, a, b, "rejected").unwrap();

        crate::soft_reject::restore_in(&db, b).unwrap();

        db.read(|conn| assert_eq!(pair_ids(conn), vec![(a, b)]));
    }

    #[test]
    fn keep_one_writes_no_comparison() {
        // Choosing between two wallpapers of one image says nothing about
        // where either stands among the others (CONTEXT.md).
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());

        keep_one(&db, a, b, "rejected").unwrap();

        db.read(|conn| {
            assert_eq!(count_comparisons(conn), 0);
            assert_eq!(get_wallpaper(conn, a).unwrap().comparisons_count, 0);
            assert_eq!(get_wallpaper(conn, b).unwrap().comparisons_count, 0);
        });
    }

    #[test]
    fn keep_one_of_a_pair_no_longer_waiting_is_refused_and_rejects_nothing() {
        // One of the pair was rejected elsewhere after the listing, so keeping
        // it now would take the pair's last wallpaper out of the library.
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());
        crate::soft_reject::reject_in(&db, a, "rejected").unwrap();

        let err = keep_one(&db, a, b, "rejected").unwrap_err();

        assert!(matches!(err, AppError::InvalidTransition(_)));
        db.read(|conn| assert_eq!(status_of(conn, b), "active"));
        assert!(tmp.path().join("b.jpg").is_file());
    }

    #[test]
    fn keep_both_makes_the_pair_distinct_and_it_is_no_longer_waiting() {
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        let b = hashed(&conn, "/w/b.jpg", "kept", 0);

        keep_both(&conn, a, b).unwrap();

        assert!(pair_ids(&conn).is_empty());
        assert_eq!(distinct_rows(&conn), vec![(a, b)]);
    }

    #[test]
    fn keep_both_names_the_pair_whichever_way_round_it_is_given() {
        // One pair, one record: answered highest id first, it is the same
        // Distinct as the lowest first, and the listing leaves it out.
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        let b = hashed(&conn, "/w/b.jpg", "active", 0);

        keep_both(&conn, b, a).unwrap();

        assert!(pair_ids(&conn).is_empty());
        assert_eq!(distinct_rows(&conn), vec![(a, b)]);
        let err = keep_both(&conn, a, b).unwrap_err();
        assert!(matches!(err, AppError::InvalidTransition(_)));
        assert_eq!(distinct_rows(&conn), vec![(a, b)]);
    }

    #[test]
    fn a_distinct_pair_stays_out_across_a_reopen() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        let (a, b) = {
            let conn = db::open(&db_path).unwrap();
            init_schema(&conn).unwrap();
            let a = hashed(&conn, "/w/a.jpg", "active", 0);
            let b = hashed(&conn, "/w/b.jpg", "active", 0);
            keep_both(&conn, a, b).unwrap();
            (a, b)
        };

        let conn = db::open(&db_path).unwrap();
        init_schema(&conn).unwrap();

        assert!(pair_ids(&conn).is_empty());
        assert_eq!(distinct_rows(&conn), vec![(a, b)]);
    }

    #[test]
    fn a_distinct_pair_stays_out_after_a_keep_one_and_a_restore() {
        // Three wallpapers of one image are three pairs. Keeping c over b
        // rejects b, and its Restore brings back the pairs b is in, except the
        // one the curator already made Distinct.
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());
        let c = db.write(|conn| {
            let c = seed_real_wallpaper(conn, tmp.path(), "c.jpg");
            record_perceptual_hash(conn, c, 7).unwrap();
            c
        });
        db.write(|conn| keep_both(conn, a, b)).unwrap();
        db.read(|conn| assert_eq!(pair_ids(conn), vec![(a, c), (b, c)]));

        keep_one(&db, c, b, "rejected").unwrap();
        db.read(|conn| assert_eq!(pair_ids(conn), vec![(a, c)]));
        crate::soft_reject::restore_in(&db, b).unwrap();

        db.read(|conn| assert_eq!(pair_ids(conn), vec![(a, c), (b, c)]));
    }

    #[test]
    fn keep_both_writes_no_comparison() {
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        let b = hashed(&conn, "/w/b.jpg", "active", 0);

        keep_both(&conn, a, b).unwrap();

        assert_eq!(count_comparisons(&conn), 0);
        assert_eq!(get_wallpaper(&conn, a).unwrap().comparisons_count, 0);
        assert_eq!(get_wallpaper(&conn, b).unwrap().comparisons_count, 0);
    }

    #[test]
    fn keep_both_of_a_pair_no_longer_waiting_is_refused_and_records_nothing() {
        // One of the two was rejected after the listing the curator answered
        // from, so the pair is no longer theirs to judge.
        let conn = library();
        let a = hashed(&conn, "/w/a.jpg", "active", 0);
        let b = hashed(&conn, "/w/b.jpg", "active", 0);
        conn.execute(
            "UPDATE wallpapers SET status = 'rejected' WHERE id = ?1",
            [b],
        )
        .unwrap();

        let err = keep_both(&conn, a, b).unwrap_err();

        assert!(matches!(err, AppError::InvalidTransition(_)));
        assert!(distinct_rows(&conn).is_empty());
    }

    /// Sets when `id` arrived, in Unix seconds, the way a scan at that time
    /// would have.
    fn arrived_at(conn: &Connection, id: i64, at: i64) {
        conn.execute(
            "UPDATE wallpapers SET created_at = ?2 WHERE id = ?1",
            [id, at],
        )
        .unwrap();
    }

    /// Sets when `id`'s soft reject happened, the way a reject at that time
    /// would have.
    fn rejected_at(conn: &Connection, id: i64, at: i64) {
        conn.execute(
            "UPDATE wallpapers SET rejected_at = ?2 WHERE id = ?1",
            [id, at],
        )
        .unwrap();
    }

    fn pairs_of_kind(conn: &Connection, kind: PairKind) -> Vec<(i64, i64)> {
        waiting_pairs(conn)
            .unwrap()
            .iter()
            .filter(|p| p.kind == kind)
            .map(|p| (p.wallpapers[0].id, p.wallpapers[1].id))
            .collect()
    }

    #[test]
    fn an_active_or_kept_wallpaper_arriving_after_a_rejected_one_is_a_rejected_before_pair() {
        // Arrival first and the Rejected wallpaper second, whichever id is
        // lower, since the two sides are answered differently.
        let conn = library();
        let arrival = hashed(&conn, "/w/new.jpg", "active", 0b11_1111_1111);
        let rejected = hashed(&conn, "/w/rejected/old.jpg", "rejected", 0);
        let kept = hashed(&conn, "/w/kept.jpg", "kept", 1);
        rejected_at(&conn, rejected, 100);
        arrived_at(&conn, arrival, 200);
        arrived_at(&conn, kept, 101);

        assert_eq!(
            pairs_of_kind(&conn, PairKind::RejectedBefore),
            vec![(arrival, rejected), (kept, rejected)]
        );
        assert_eq!(
            pairs_of_kind(&conn, PairKind::KeepOne),
            vec![(arrival, kept)]
        );
    }

    #[test]
    fn a_wallpaper_already_there_when_the_other_was_rejected_is_no_pair() {
        // The curator saw both and rejected one, so asking again would be
        // asking about a pair they already answered.
        let conn = library();
        let earlier = hashed(&conn, "/w/a.jpg", "active", 0);
        let same_second = hashed(&conn, "/w/b.jpg", "kept", 0);
        let rejected = hashed(&conn, "/w/rejected/old.jpg", "rejected", 0);
        rejected_at(&conn, rejected, 100);
        arrived_at(&conn, earlier, 99);
        arrived_at(&conn, same_second, 100);

        assert!(pairs_of_kind(&conn, PairKind::RejectedBefore).is_empty());
    }

    #[test]
    fn a_rejected_before_pair_still_needs_to_be_within_ten_bits() {
        let conn = library();
        let arrival = hashed(&conn, "/w/new.jpg", "active", 0b111_1111_1111);
        let rejected = hashed(&conn, "/w/rejected/old.jpg", "rejected", 0);
        rejected_at(&conn, rejected, 100);
        arrived_at(&conn, arrival, 200);

        assert!(pair_ids(&conn).is_empty());
    }

    #[test]
    fn a_rejection_from_before_its_time_was_recorded_is_offered_against_everything_there() {
        // The migration backfills those at the earliest time there is, so
        // every Near-duplicate already in the library counts as arriving
        // after it and is offered once.
        let conn = library();
        let there = hashed(&conn, "/w/a.jpg", "active", 0);
        let rejected = hashed(&conn, "/w/rejected/old.jpg", "rejected", 0);
        rejected_at(&conn, rejected, 0);

        assert_eq!(
            pairs_of_kind(&conn, PairKind::RejectedBefore),
            vec![(there, rejected)]
        );
    }

    #[test]
    fn two_rejected_wallpapers_are_never_offered() {
        let conn = library();
        let a = hashed(&conn, "/w/rejected/a.jpg", "rejected", 0);
        let b = hashed(&conn, "/w/rejected/b.jpg", "rejected", 0);
        rejected_at(&conn, a, 0);
        rejected_at(&conn, b, 100);
        arrived_at(&conn, b, 50);

        assert!(pair_ids(&conn).is_empty());
    }

    #[test]
    fn a_rejected_before_pair_crosses_the_ipc_as_its_own_kind() {
        let conn = library();
        hashed(&conn, "/w/new.jpg", "active", 0);
        let rejected = hashed(&conn, "/w/rejected/old.jpg", "rejected", 0);
        rejected_at(&conn, rejected, 0);

        let json = serde_json::to_value(&waiting_pairs(&conn).unwrap()[0]).unwrap();

        assert_eq!(json["kind"], "rejected_before");
        assert_eq!(json["wallpapers"][0]["filename"], "new.jpg");
        assert_eq!(json["wallpapers"][1]["filename"], "old.jpg");
    }

    #[test]
    fn a_keep_one_answer_is_not_asked_again_as_rejected_before() {
        // Keeping one rejects the other, which leaves an Active wallpaper
        // beside a Rejected one of the same image. It was there first, so it
        // is no arrival.
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());

        keep_one(&db, b, a, "rejected").unwrap();

        db.read(|conn| assert!(pair_ids(conn).is_empty()));
    }

    /// A real Rejected file and a real arrival carrying its hash, behind a
    /// `Db`: the rejected wallpaper went through the ordinary soft reject, and
    /// the arrival came in after it.
    fn real_rejected_before(dir: &Path) -> (crate::Db, i64, i64) {
        let (db, rejected, arrival) = real_pair(dir);
        crate::soft_reject::reject_in(&db, rejected, "rejected").unwrap();
        db.write(|conn| {
            let at = rejected_at_of(conn, rejected).unwrap();
            arrived_at(conn, arrival, at + 1);
        });
        db.read(|conn| {
            assert_eq!(
                pairs_of_kind(conn, PairKind::RejectedBefore),
                vec![(arrival, rejected)]
            )
        });
        (db, arrival, rejected)
    }

    #[test]
    fn keeping_a_rejected_before_arrival_leaves_it_as_it_is_and_makes_the_pair_distinct() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, arrival, rejected) = real_rejected_before(tmp.path());

        db.write(|conn| keep_both(conn, arrival, rejected)).unwrap();

        db.read(|conn| {
            assert_eq!(status_of(conn, arrival), "active");
            assert_eq!(status_of(conn, rejected), "rejected");
            assert!(pair_ids(conn).is_empty());
            assert_eq!(distinct_rows(conn), vec![(rejected, arrival)]);
        });
        assert!(tmp.path().join("b.jpg").is_file());
    }

    #[test]
    fn a_kept_rejected_before_pair_never_returns_even_once_both_are_active() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, arrival, rejected) = real_rejected_before(tmp.path());
        db.write(|conn| keep_both(conn, arrival, rejected)).unwrap();

        crate::soft_reject::restore_in(&db, rejected).unwrap();

        db.read(|conn| assert!(pair_ids(conn).is_empty()));
    }

    #[test]
    fn rejecting_a_rejected_before_arrival_soft_rejects_it_and_the_pair_goes() {
        // The answer is keep one with the Rejected wallpaper as the one kept:
        // the arrival goes through the ordinary soft reject, so its Undo is a
        // Restore, which brings the pair back.
        let tmp = tempfile::tempdir().unwrap();
        let (db, arrival, rejected) = real_rejected_before(tmp.path());

        let wrote = keep_one(&db, rejected, arrival, "rejected").unwrap();

        assert_eq!(wrote.id, arrival);
        assert_eq!(wrote.status, Status::Rejected);
        assert!(tmp.path().join("rejected").join("b.jpg").is_file());
        db.read(|conn| {
            assert!(pair_ids(conn).is_empty());
            assert!(distinct_rows(conn).is_empty());
        });

        crate::soft_reject::restore_in(&db, arrival).unwrap();
        db.read(|conn| {
            assert_eq!(
                pairs_of_kind(conn, PairKind::RejectedBefore),
                vec![(arrival, rejected)]
            )
        });
    }

    #[test]
    fn keep_one_of_a_rejected_before_pair_that_would_reject_the_rejected_one_is_refused() {
        // Its only keep-one answer is rejecting the arrival.
        let tmp = tempfile::tempdir().unwrap();
        let (db, arrival, rejected) = real_rejected_before(tmp.path());

        let err = keep_one(&db, arrival, rejected, "rejected").unwrap_err();

        assert!(matches!(err, AppError::InvalidTransition(_)));
        db.read(|conn| assert_eq!(status_of(conn, arrival), "active"));
    }

    #[test]
    fn neither_answer_to_a_rejected_before_pair_writes_a_comparison() {
        for reject in [false, true] {
            let tmp = tempfile::tempdir().unwrap();
            let (db, arrival, rejected) = real_rejected_before(tmp.path());

            if reject {
                keep_one(&db, rejected, arrival, "rejected").unwrap();
            } else {
                db.write(|conn| keep_both(conn, arrival, rejected)).unwrap();
            }

            db.read(|conn| {
                assert_eq!(count_comparisons(conn), 0);
                assert_eq!(get_wallpaper(conn, arrival).unwrap().comparisons_count, 0);
                assert_eq!(get_wallpaper(conn, rejected).unwrap().comparisons_count, 0);
            });
        }
    }

    #[test]
    fn keep_one_of_two_wallpapers_that_are_no_pair_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let (db, a, b) = real_pair(tmp.path());
        db.write(|conn| record_perceptual_hash(conn, b, !7))
            .unwrap();

        let err = keep_one(&db, a, b, "rejected").unwrap_err();

        assert!(matches!(err, AppError::InvalidTransition(_)));
        db.read(|conn| assert_eq!(status_of(conn, b), "active"));
    }
}
