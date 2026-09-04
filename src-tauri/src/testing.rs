//! Test helpers that more than one test module needs.
//!
//! The rule is deliberately narrow: a helper belongs here once a second test
//! module wants it, and not before. It is a place for shared helpers rather
//! than a place for helpers, so nothing arrives here on the grounds that it
//! might be shared later (ADR 0030).
//!
//! It exists because `db.rs`'s tests and `soft_reject.rs`'s tests seed and read
//! the same rows: the Soft reject is a transition on a wallpaper row, so the
//! module that performs it and the module that defines the row ask the database
//! the same questions. Duplicating these would be drift with a start date.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{self, ListOrdering, StatusFilter};

/// A wallpaper row with no file behind it, for the tests that never touch disk.
pub(crate) fn seed_wallpaper(conn: &Connection, path: &str, status: &str, mu: f64) -> i64 {
    conn.execute(
        "INSERT INTO wallpapers (filename, path, status, rating_mu) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![path.rsplit('/').next().unwrap(), path, status, mu],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// A wallpaper whose file exists, seeded through the same insert a scan uses.
/// The file is empty, which is enough for anything that only moves it.
pub(crate) fn seed_real_wallpaper(conn: &Connection, dir: &Path, name: &str) -> i64 {
    let path = dir.join(name);
    std::fs::File::create(&path).unwrap();
    db::insert_new_wallpapers(conn, &[path]).unwrap();
    conn.last_insert_rowid()
}

/// A library folder holding one wallpaper, and the Origin string a reject of it
/// records. Every restore test starts here, and so does the un-keep test that
/// has to get a wallpaper genuinely rejected first.
pub(crate) fn seed_for_restore(conn: &Connection, root: &Path, name: &str) -> (i64, PathBuf) {
    let library = root.join("library");
    std::fs::create_dir_all(&library).unwrap();
    let id = seed_real_wallpaper(conn, &library, name);
    (id, library.join(name))
}

pub(crate) fn add_comparison(conn: &Connection, winner_id: i64, loser_id: i64) {
    conn.execute(
        "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
        rusqlite::params![winner_id, loser_id],
    )
    .unwrap();
}

pub(crate) fn origin_path_of(conn: &Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT origin_path FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .unwrap()
}

pub(crate) fn status_of(conn: &Connection, id: i64) -> String {
    conn.query_row(
        "SELECT status FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )
    .unwrap()
}

pub(crate) fn row_status_and_path(conn: &Connection, id: i64) -> (String, String) {
    conn.query_row(
        "SELECT status, path FROM wallpapers WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

pub(crate) fn count_wallpapers(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
        .unwrap()
}

pub(crate) fn count_comparisons(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
        .unwrap()
}

/// The listing Review asks for, as ids: what the curator's worklist holds after
/// a transition has moved a wallpaper into or out of it.
pub(crate) fn review_ids(conn: &Connection) -> Vec<i64> {
    db::list_wallpapers(conn, StatusFilter::Active, ListOrdering::ScoreAsc, Some(50))
        .unwrap()
        .iter()
        .map(|w| w.id)
        .collect()
}
