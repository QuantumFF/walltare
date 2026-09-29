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

/// Every Near-duplicate pair waiting for an answer, lowest ids first.
///
/// Two Active or Kept wallpapers, Kept treated as Active is, whose hashes are
/// within [`HAMMING_LIMIT`]. A wallpaper pre-generation has not hashed yet is in
/// no pair, rather than in a pair with something it might not resemble. A
/// Distinct pair is never waiting. Three wallpapers of one image are three
/// pairs, so answering one leaves the others.
pub fn waiting_pairs(conn: &Connection) -> Result<Vec<NearDuplicatePair>, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT id, perceptual_hash FROM wallpapers
         WHERE perceptual_hash IS NOT NULL AND {}
         ORDER BY id",
        Status::ELIGIBLE_SQL
    ))?;
    // SQLite's integers are signed, so the hash went in as the same bits read
    // as an `i64` (`db::record_perceptual_hash`) and comes back out the same way.
    let hashes = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? as u64)))?
        .collect::<Result<Vec<(i64, u64)>, _>>()?;
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
    for (i, &(a, a_hash)) in hashes.iter().enumerate() {
        for &(b, b_hash) in &hashes[i + 1..] {
            // `a` is below `b`, the order a Distinct record is keyed in.
            if (a_hash ^ b_hash).count_ones() <= HAMMING_LIMIT && !distinct.contains(&(a, b)) {
                pairs.push(NearDuplicatePair {
                    kind: PairKind::KeepOne,
                    wallpapers: [row(a)?, row(b)?],
                });
            }
        }
    }
    Ok(pairs)
}

/// Keeps `kept` and soft-rejects `other` into `destination_folder`, answering
/// with the row the reject wrote.
///
/// Refused with [`AppError::InvalidTransition`], rejecting nothing, unless the
/// two are still a waiting pair. The listing the curator answered from may be
/// out of date: had `kept` been rejected since, keeping it would take the
/// pair's last wallpaper out of the library.
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
    db.read(|conn| refuse_unless_waiting(conn, kept, other))?;
    soft_reject::reject_in(db, other, destination_folder)
}

/// Keeps both `a` and `b`, recording the pair as Distinct so it is never
/// offered again, across scans and restarts.
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

/// Refuses an answer to `a` and `b` unless they are a waiting pair, in either
/// order.
fn refuse_unless_waiting(conn: &Connection, a: i64, b: i64) -> Result<(), AppError> {
    let waiting = waiting_pairs(conn)?.iter().any(|pair| {
        let ids = (pair.wallpapers[0].id, pair.wallpapers[1].id);
        ids == (a, b) || ids == (b, a)
    });
    if !waiting {
        return Err(AppError::InvalidTransition(format!(
            "wallpapers {a} and {b} are not a waiting Near-duplicate pair"
        )));
    }
    Ok(())
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
///
/// One kind so far: two Active or Kept wallpapers, answered by keeping one or
/// keeping both. A pair against a Rejected wallpaper is offered differently
/// (#402), and is a second kind rather than a flag on this one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairKind {
    KeepOne,
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
