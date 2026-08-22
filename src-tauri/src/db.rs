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

pub fn move_wallpaper(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<(), crate::error::AppError> {
    let (path, filename): (String, String) = conn
        .query_row(
            "SELECT path, filename FROM wallpapers WHERE id = ?1",
            rusqlite::params![wallpaper_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                crate::error::AppError::NotFound(format!("no wallpaper with id {wallpaper_id}"))
            }
            other => other.into(),
        })?;

    let source = PathBuf::from(&path);
    let dest_dir = if Path::new(destination_folder).is_absolute() {
        PathBuf::from(destination_folder)
    } else {
        source
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(destination_folder)
    };
    let dest_path = dest_dir.join(&filename);

    std::fs::create_dir_all(&dest_dir)?;
    match std::fs::rename(&source, &dest_path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
            std::fs::copy(&source, &dest_path)?;
            std::fs::remove_file(&source)?;
        }
        Err(e) => return Err(e.into()),
    }

    conn.execute(
        "UPDATE wallpapers SET status = 'rejected', path = ?1, filename = ?2 WHERE id = ?3",
        rusqlite::params![
            dest_path
                .to_str()
                .ok_or_else(|| crate::error::AppError::InvalidPath(
                    dest_path.display().to_string()
                ))?,
            &filename,
            wallpaper_id
        ],
    )?;
    Ok(())
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
    let status: String = conn
        .query_row(
            "SELECT status FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                crate::error::AppError::NotFound(format!("no wallpaper with id {id}"))
            }
            other => other.into(),
        })?;

    if status == "rejected" {
        return Err(crate::error::AppError::InvalidTransition(format!(
            "cannot keep rejected wallpaper with id {id}"
        )));
    }

    conn.execute(
        "UPDATE wallpapers SET status = 'kept' WHERE id = ?1",
        rusqlite::params![id],
    )?;
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

    fn seed_real_wallpaper(conn: &Connection, dir: &Path, name: &str) -> i64 {
        let path = dir.join(name);
        std::fs::File::create(&path).unwrap();
        insert_new_wallpapers(conn, &[path]).unwrap();
        conn.last_insert_rowid()
    }

    fn add_comparison(conn: &Connection, winner_id: i64, loser_id: i64) {
        conn.execute(
            "INSERT INTO comparisons (winner_id, loser_id, voted_at) VALUES (?1, ?2, unixepoch())",
            rusqlite::params![winner_id, loser_id],
        )
        .unwrap();
    }

    fn row_status_and_path(conn: &Connection, id: i64) -> (String, String) {
        conn.query_row(
            "SELECT status, path FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
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

    #[test]
    fn keeping_a_rejected_wallpaper_returns_invalid_transition_and_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "rejected", 25.0);
        let (_, original_path) = row_status_and_path(&conn, id);

        let err = keep_wallpaper(&conn, id).unwrap_err();
        assert!(matches!(
            err,
            crate::error::AppError::InvalidTransition(ref m) if m.contains(&id.to_string())
        ));

        assert_eq!(
            row_status_and_path(&conn, id),
            ("rejected".into(), original_path)
        );
    }

    #[test]
    fn move_wallpaper_moves_file_and_marks_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "a.jpg");

        let dest_dir = dest.path().join("out");
        move_wallpaper(&conn, id, dest_dir.to_str().unwrap()).unwrap();

        assert!(dest_dir.join("a.jpg").is_file());
        assert!(!tmp.path().join("a.jpg").exists());
        let (status, path) = row_status_and_path(&conn, id);
        assert_eq!(status, "rejected");
        assert_eq!(PathBuf::from(&path), dest_dir.join("a.jpg"));

        assert!(get_review(&conn, 50).unwrap().is_empty());
    }

    #[test]
    fn relative_destination_resolves_against_wallpaper_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let sub = tmp.path().join("library");
        std::fs::create_dir_all(&sub).unwrap();
        let id = seed_real_wallpaper(&conn, &sub, "b.png");

        move_wallpaper(&conn, id, "rejects").unwrap();

        assert!(sub.join("rejects").join("b.png").is_file());
        let (_, path) = row_status_and_path(&conn, id);
        assert_eq!(PathBuf::from(path), sub.join("rejects").join("b.png"));
    }

    #[test]
    fn missing_destination_directories_are_created() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "c.webp");

        let nested = dest.path().join("x").join("y").join("z");
        move_wallpaper(&conn, id, nested.to_str().unwrap()).unwrap();

        assert!(nested.join("c.webp").is_file());
        assert_eq!(row_status_and_path(&conn, id).0, "rejected");
    }

    #[test]
    fn rejected_row_keeps_comparison_history() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let moved = seed_real_wallpaper(&conn, tmp.path(), "moved.jpg");
        let other = seed_real_wallpaper(&conn, tmp.path(), "other.jpg");
        add_comparison(&conn, other, moved);

        move_wallpaper(&conn, moved, dest.path().to_str().unwrap()).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM comparisons WHERE winner_id = ?1 OR loser_id = ?1",
                rusqlite::params![moved],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn rescan_after_move_does_not_readd_as_active() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "d.jpg");
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        let found = crate::scanner::collect_images(&[tmp.path().to_path_buf()]);
        assert!(found.is_empty());
        insert_new_wallpapers(&conn, &found).unwrap();

        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(get_review(&conn, 50).unwrap(), Vec::new());

        let found2 = crate::scanner::collect_images(&[dest.path().to_path_buf()]);
        insert_new_wallpapers(&conn, &found2).unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(
            row_status_and_path(&conn, id),
            (
                "rejected".into(),
                dest.path().join("d.jpg").display().to_string()
            )
        );
        assert_eq!(get_review(&conn, 50).unwrap(), Vec::new());
    }

    #[test]
    fn failed_move_leaves_db_untouched_and_propagates_io_error() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "e.jpg");
        add_comparison(&conn, id, id);

        std::fs::remove_file(tmp.path().join("e.jpg")).unwrap();
        let err = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap_err();
        assert!(matches!(err, crate::error::AppError::Io(_)));

        assert_eq!(row_status_and_path(&conn, id).0, "active");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn unknown_id_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let err = move_wallpaper(&conn, 1234, tmp.path().to_str().unwrap()).unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound(_)));
    }
}
