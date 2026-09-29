//! Near-duplicate pairs: which ones are waiting, and the keep-one answer.
//!
//! A pair is a standing and never a record, so nothing here writes one down:
//! the waiting pairs are worked out from the stored perceptual hashes each time
//! somebody asks. A scan over a few thousand 64-bit hashes is cheap, and a
//! stored list would have to be kept in step with every reject, Restore and
//! newly hashed wallpaper (CONTEXT.md, #393).
//!
//! Answering never writes a Comparison. Keeping one is the ordinary soft
//! reject of the other, so a Restore undoes it and the pair is waiting again.

use std::collections::HashMap;

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
/// no pair, rather than in a pair with something it might not resemble. Three
/// wallpapers of one image are three pairs, so answering one leaves the others.
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
            if (a_hash ^ b_hash).count_ones() <= HAMMING_LIMIT {
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
    let waiting = db.read(waiting_pairs)?.iter().any(|pair| {
        let [a, b] = &pair.wallpapers;
        (a.id, b.id) == (kept, other) || (a.id, b.id) == (other, kept)
    });
    if !waiting {
        return Err(AppError::InvalidTransition(format!(
            "wallpapers {kept} and {other} are not a waiting Near-duplicate pair"
        )));
    }
    soft_reject::reject_in(db, other, destination_folder)
}

/// A waiting Near-duplicate pair and how it is offered.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NearDuplicatePair {
    pub kind: PairKind,
    pub wallpapers: [Wallpaper; 2],
}

/// How a pair is offered, which decides the answers it is given.
///
/// One kind so far: two Active or Kept wallpapers, answered by keeping one. A
/// pair against a Rejected wallpaper is offered differently (#402), and is a
/// second kind rather than a flag on this one.
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
