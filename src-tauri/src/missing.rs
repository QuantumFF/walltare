//! How many wallpapers the library still points at have no file behind them.
//!
//! A library on a stranger's machine changes underneath the app constantly: a
//! file is deleted, a folder is renamed, an external drive is unplugged. The
//! row survives — nothing deletes a `wallpapers` row, because `comparisons`
//! references it with `RESTRICT` and Comparisons are never deleted — and the
//! only symptom is a card that will not paint.
//!
//! **This is not a Status.** A missing file is a fact about the filesystem at
//! the moment somebody asked, not a fourth thing a wallpaper can be: it becomes
//! true and false again without the curator doing anything, while every Status
//! in `CONTEXT.md` moves only through a transition the curator asked for. So
//! nothing here writes to the database, ADR 0001's three Statuses stand, and
//! ADR 0025's transition guard is untouched.
//!
//! **Nothing here runs on a listing.** The count is what the Settings page asks
//! for when the curator presses a button, and it is the only filesystem pass in
//! the app that is about missing files at all. The card's own answer costs
//! nothing and is not here: the `wallpaper://` request it already makes either
//! paints or fails, and the card reads that (ADR 0032).
//!
//! ## Two halves, because one of them must not hold the lock
//!
//! [`eligible_paths`] is the database half and [`count_missing`] is the
//! filesystem half, split for the reason ADR 0004 split thumbnail resolution:
//! at ADR 0016's 5,000-wallpaper ceiling this is 5,000 `stat` calls, and doing
//! them under the connection mutex would queue every command and every
//! `wallpaper://` request behind a walk of somebody's external drive. The
//! command in `lib.rs` calls the two in order and holds the lock across only
//! the first.
//!
//! The split is also what makes each half testable on its own: the query needs
//! a `&Connection` and no disk, the count needs a temp directory and no
//! database.
//!
//! ADR 0039 generalises this pair into the rule for the whole crate — the
//! connection is reachable only through a closure that returns owned data, so
//! the ordering above is what the types allow rather than what this comment
//! asks for. `thumbnails::candidates` and `thumbnails::work_list` are the same
//! two halves for the pre-generation pass.

use std::path::Path;

use rusqlite::Connection;

use crate::db;
use crate::error::AppError;

/// What a check found, for the Settings read-out.
///
/// `eligible` rides along with `missing` rather than being fetched separately,
/// because a bare count answers nothing: three missing out of five is a broken
/// library and three out of five thousand is a Tuesday, and the two numbers have
/// to come from one pass or the line can report a ratio that was never true.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct MissingFiles {
    /// Eligible wallpapers whose file is not where their row says it is.
    pub missing: i64,
    /// The Eligible pool the check walked: Active plus Kept (`CONTEXT.md`).
    pub eligible: i64,
}

/// Where every Eligible wallpaper's file is supposed to be.
///
/// Eligible and not every row, which is the whole of what a Rejected wallpaper
/// is excluded by: its file was deliberately moved to the reject destination and
/// the row's `path` follows it there, so it is exactly where the library says it
/// is. A Rejected wallpaper whose file the curator has since emptied out of that
/// folder is not missing either — `CONTEXT.md` calls the reject destination a
/// folder the user owns, and ADR 0009 already answers a Restore of one with
/// `FileMissing`.
///
/// The fragment naming the pool comes from [`db::Status::ELIGIBLE_SQL`] rather
/// than being spelled here, so this count and `voting.rs`'s four aggregates
/// cannot come to disagree about which wallpapers Eligible means (ADR 0024).
pub fn eligible_paths(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT path FROM wallpapers WHERE {}",
        db::Status::ELIGIBLE_SQL,
    ))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// How many of `paths` have nothing behind them.
///
/// One `stat` per path and no reads, so this is the cheapest question that can
/// be answered honestly. `exists()` follows symlinks and reads a broken one, an
/// unreadable parent folder and a deleted file all as nothing there, which is
/// the same answer the curator gets from the card: all three make the
/// `wallpaper://` request fail.
///
/// It says nothing about a file that is present and will not decode. That one
/// paints as gone on the card, because the card reacts to the request failing
/// rather than to a filesystem check, and it is not counted here. The line this
/// feeds says `files missing` for that reason, rather than claiming to count
/// every wallpaper the grid cannot paint.
pub fn count_missing(paths: &[String]) -> MissingFiles {
    MissingFiles {
        missing: paths.iter().filter(|p| !Path::new(p).exists()).count() as i64,
        eligible: paths.len() as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::seed_wallpaper;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        conn
    }

    /// A path that names a file which is really there.
    fn real(dir: &Path, name: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, b"").unwrap();
        path.display().to_string()
    }

    #[test]
    fn the_check_walks_active_and_kept_and_leaves_rejected_alone() {
        let conn = conn();
        seed_wallpaper(&conn, "/library/a.jpg", "active", 25.0);
        seed_wallpaper(&conn, "/library/b.jpg", "kept", 25.0);
        // Its file moved on purpose and the row followed it, so it is where the
        // library says it is. Counting it would report every reject the curator
        // ever made as a problem.
        seed_wallpaper(&conn, "/library/rejected/c.jpg", "rejected", 25.0);

        let paths = eligible_paths(&conn).unwrap();

        assert_eq!(
            paths,
            vec!["/library/a.jpg".to_string(), "/library/b.jpg".to_string()]
        );
    }

    #[test]
    fn an_empty_library_has_nothing_missing_and_nothing_eligible() {
        let conn = conn();
        // Not zero-of-zero by accident: a library with only Rejected rows in it
        // reaches the same answer, and the line reads `No files missing` for
        // both, which is true of both.
        seed_wallpaper(&conn, "/library/rejected/c.jpg", "rejected", 25.0);

        let found = count_missing(&eligible_paths(&conn).unwrap());

        assert_eq!(
            found,
            MissingFiles {
                missing: 0,
                eligible: 0
            }
        );
    }

    #[test]
    fn a_file_that_is_not_on_disk_is_counted_and_one_that_is_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let there = real(dir.path(), "there.jpg");
        let gone = dir.path().join("gone.jpg").display().to_string();

        assert_eq!(
            count_missing(&[there, gone]),
            MissingFiles {
                missing: 1,
                eligible: 2
            }
        );
    }

    #[test]
    fn a_broken_symlink_reads_as_missing() {
        // The card reads it that way too: `fulfill` opens the source, and
        // following a link to nothing fails exactly as a deleted file does. An
        // `exists()` that did not follow the link would report a library the
        // grid cannot paint as healthy.
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("link.jpg");
        std::os::unix::fs::symlink(dir.path().join("nowhere.jpg"), &link).unwrap();

        assert_eq!(
            count_missing(&[link.display().to_string()]).missing,
            1,
            "a link to nothing has nothing behind it"
        );
    }

    #[test]
    fn the_two_halves_agree_over_a_real_library() {
        // The whole command, in the order `lib.rs` calls it: the pool comes off
        // the database and the files are checked with the connection already
        // released.
        let dir = tempfile::tempdir().unwrap();
        let conn = conn();
        seed_wallpaper(&conn, &real(dir.path(), "kept.jpg"), "kept", 25.0);
        seed_wallpaper(&conn, &real(dir.path(), "here.jpg"), "active", 25.0);
        let deleted = dir.path().join("deleted.jpg");
        std::fs::write(&deleted, b"").unwrap();
        seed_wallpaper(&conn, &deleted.display().to_string(), "active", 25.0);

        std::fs::remove_file(&deleted).unwrap();

        assert_eq!(
            count_missing(&eligible_paths(&conn).unwrap()),
            MissingFiles {
                missing: 1,
                eligible: 3
            }
        );
    }

    #[test]
    fn the_count_crosses_the_ipc_with_the_fields_client_ts_expects() {
        let json = serde_json::to_value(MissingFiles {
            missing: 3,
            eligible: 120,
        })
        .unwrap();

        assert_eq!(json["missing"], 3);
        assert_eq!(json["eligible"], 120);
    }
}
