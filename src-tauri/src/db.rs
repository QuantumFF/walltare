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
}
