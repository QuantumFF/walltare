use std::path::{Path, PathBuf};

use rusqlite::Connection;

const DDL: &str = "
CREATE TABLE IF NOT EXISTS wallpapers (
    id                INTEGER PRIMARY KEY,
    filename          TEXT    NOT NULL,
    path              TEXT    NOT NULL UNIQUE,
    status            TEXT    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'kept', 'rejected')),
    rating_mu         REAL    NOT NULL DEFAULT 25.0,
    rating_sigma      REAL    NOT NULL DEFAULT 8.333,
    comparisons_count INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_wallpapers_status_comparisons ON wallpapers (status, comparisons_count);
CREATE INDEX IF NOT EXISTS idx_wallpapers_status_rating_mu   ON wallpapers (status, rating_mu);

CREATE TABLE IF NOT EXISTS comparisons (
    id        INTEGER PRIMARY KEY,
    winner_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
    loser_id  INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
    voted_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS thumbnails (
    wallpaper_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE CASCADE,
    size         TEXT    NOT NULL CHECK (size IN ('small', 'medium')),
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    source_mtime INTEGER NOT NULL,
    PRIMARY KEY (wallpaper_id, size)
);
";

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(DDL)
}

pub fn insert_new_wallpapers(
    conn: &Connection,
    paths: &[PathBuf],
) -> Result<usize, rusqlite::Error> {
    let mut stmt =
        conn.prepare_cached("INSERT OR IGNORE INTO wallpapers (filename, path) VALUES (?1, ?2)")?;
    let mut added = 0;
    for path in paths {
        added += stmt.execute(rusqlite::params![
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default(),
            path.to_str().expect("walk only yields UTF-8 paths"),
        ])?;
    }
    Ok(added)
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Wallpaper {
    pub id: i64,
    pub filename: String,
    pub path: String,
    pub status: String,
    pub rating_mu: f64,
    pub rating_sigma: f64,
    pub comparisons_count: i64,
}

pub fn get_review(conn: &Connection, limit: i64) -> Result<Vec<Wallpaper>, rusqlite::Error> {
    if limit <= 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(
        "SELECT id, filename, path, status, rating_mu, rating_sigma, comparisons_count
         FROM wallpapers
         WHERE status = 'active'
         ORDER BY rating_mu ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(Wallpaper {
            id: row.get(0)?,
            filename: row.get(1)?,
            path: row.get(2)?,
            status: row.get(3)?,
            rating_mu: row.get(4)?,
            rating_sigma: row.get(5)?,
            comparisons_count: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn keep_wallpaper(conn: &Connection, id: i64) -> Result<(), crate::error::AppError> {
    let updated = conn.execute(
        "UPDATE wallpapers SET status = 'kept' WHERE id = ?1",
        rusqlite::params![id],
    )?;
    if updated == 0 {
        return Err(crate::error::AppError::NotFound(format!(
            "no wallpaper with id {id}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_new_skips_existing_paths_and_counts_additions() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let paths = vec![PathBuf::from("/w/a.jpg"), PathBuf::from("/w/b.png")];
        assert_eq!(insert_new_wallpapers(&conn, &paths).unwrap(), 2);
        assert_eq!(insert_new_wallpapers(&conn, &paths).unwrap(), 0);

        let mixed = vec![PathBuf::from("/w/b.png"), PathBuf::from("/w/c.webp")];
        assert_eq!(insert_new_wallpapers(&conn, &mixed).unwrap(), 1);
    }

    fn seed_wallpaper(conn: &Connection, path: &str, status: &str, mu: f64) -> i64 {
        conn.execute(
            "INSERT INTO wallpapers (filename, path, status, rating_mu) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![path.rsplit('/').next().unwrap(), path, status, mu],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn get_review_returns_active_ordered_by_mu_ascending() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let hi = seed_wallpaper(&conn, "/w/hi.jpg", "active", 30.0);
        let lo = seed_wallpaper(&conn, "/w/lo.jpg", "active", 10.0);
        let mid = seed_wallpaper(&conn, "/w/mid.png", "active", 20.0);
        seed_wallpaper(&conn, "/w/kept.jpg", "kept", 5.0);
        seed_wallpaper(&conn, "/w/rej.jpg", "rejected", 1.0);

        let review = get_review(&conn, 50).unwrap();
        let ids: Vec<i64> = review.iter().map(|w| w.id).collect();
        assert_eq!(ids, vec![lo, mid, hi]);

        assert_eq!(review[0].status, "active");
        assert_eq!(review[0].rating_mu, 10.0);
    }

    #[test]
    fn get_review_respects_limit() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        for (i, mu) in [30.0, 10.0, 20.0].iter().enumerate() {
            seed_wallpaper(&conn, &format!("/w/{i}.jpg"), "active", *mu);
        }

        assert_eq!(get_review(&conn, 2).unwrap().len(), 2);
        assert_eq!(get_review(&conn, 10).unwrap().len(), 3);
    }

    #[test]
    fn get_review_limit_at_most_one_returns_empty() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        assert_eq!(get_review(&conn, 0).unwrap(), Vec::new());
        assert_eq!(get_review(&conn, -5).unwrap(), Vec::new());
    }

    #[test]
    fn get_review_empty_library_returns_empty_list() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        assert_eq!(get_review(&conn, 50).unwrap(), Vec::new());
    }

    fn status_of(conn: &Connection, id: i64) -> String {
        conn.query_row(
            "SELECT status FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn keep_wallpaper_transitions_active_to_kept() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        keep_wallpaper(&conn, id).unwrap();
        assert_eq!(status_of(&conn, id), "kept");
    }

    #[test]
    fn keep_wallpaper_removes_it_from_review() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let a = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        let b = seed_wallpaper(&conn, "/w/b.jpg", "active", 15.0);

        keep_wallpaper(&conn, b).unwrap();
        let ids: Vec<i64> = get_review(&conn, 50)
            .unwrap()
            .iter()
            .map(|w| w.id)
            .collect();
        assert_eq!(ids, vec![a]);
    }

    #[test]
    fn rekeeping_a_kept_wallpaper_is_a_no_op_success() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        keep_wallpaper(&conn, id).unwrap();

        keep_wallpaper(&conn, id).unwrap();
        assert_eq!(status_of(&conn, id), "kept");
    }

    #[test]
    fn keeping_unknown_id_returns_not_found_and_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        let err = keep_wallpaper(&conn, 9999).unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound(_)));
        assert_eq!(status_of(&conn, id), "active");
    }
}
