use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppError;

/// Bumped whenever `DDL` changes in a way an existing database can't reach by
/// running the (idempotent) DDL again. See `migrate`.
///
/// Adding a whole table is not such a change: `init_schema` runs the DDL before
/// it branches, so `CREATE TABLE IF NOT EXISTS` reaches old files too. That is
/// why `settings` arrived without a bump.
const SCHEMA_VERSION: i64 = 3;

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
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    -- Where the file sat before its current soft reject, so a Restore can put
    -- it back. Last in the list because `ALTER TABLE ADD COLUMN` appends, and a
    -- migrated database should end up the same shape as a fresh one.
    origin_path       TEXT
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
    size         TEXT    NOT NULL CHECK (size IN ('small', 'medium', 'full')),
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    source_mtime INTEGER NOT NULL,
    PRIMARY KEY (wallpaper_id, size)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // The scan writes thousands of rows and every other command reads through
    // the same single connection; a rollback journal fsyncs per statement.
    // The result row is ignored on purpose: a filesystem that can't do WAL
    // reports the mode it kept instead of failing, and running slower beats
    // refusing to start.
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    let fresh = !table_exists(conn, "wallpapers")?;
    conn.execute_batch(DDL)?;
    if fresh {
        // The DDL always creates the current shape, so a new file starts current.
        set_schema_version(conn, SCHEMA_VERSION)
    } else {
        migrate(conn)
    }
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        rusqlite::params![name],
        |row| row.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

fn schema_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

fn set_schema_version(conn: &Connection, version: i64) -> Result<(), rusqlite::Error> {
    // PRAGMA user_version does not accept a bound parameter.
    conn.execute_batch(&format!("PRAGMA user_version = {version}"))
}

/// Brings a pre-existing database up to `SCHEMA_VERSION`.
///
/// `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists,
/// so any change to an existing table's shape needs an explicit step here.
fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut version = schema_version(conn)?;

    if version < 2 {
        // v2 widened the thumbnails CHECK to accept 'full'. The table is a pure
        // cache keyed by (wallpaper_id, size), so rebuilding it costs one lazy
        // regeneration per thumbnail rather than a data migration.
        conn.execute_batch(
            "DROP TABLE IF EXISTS thumbnails;
             CREATE TABLE thumbnails (
                 wallpaper_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE CASCADE,
                 size         TEXT    NOT NULL CHECK (size IN ('small', 'medium', 'full')),
                 width        INTEGER NOT NULL,
                 height       INTEGER NOT NULL,
                 source_mtime INTEGER NOT NULL,
                 PRIMARY KEY (wallpaper_id, size)
             );",
        )?;
        version = 2;
    }

    if version < 3 {
        // v3 added `wallpapers.origin_path`. Adding a column to a table that
        // already exists is exactly what the DDL cannot reach, and there is
        // nothing to backfill: a wallpaper rejected before this shipped has no
        // Origin, and NULL is what says so.
        conn.execute_batch("ALTER TABLE wallpapers ADD COLUMN origin_path TEXT;")?;
        version = 3;
    }

    set_schema_version(conn, version)
}

pub fn insert_new_wallpapers(
    conn: &Connection,
    paths: &[PathBuf],
) -> Result<usize, rusqlite::Error> {
    // One implicit transaction per row means one journal fsync per row; a whole
    // batch under a single transaction is orders of magnitude faster on disk.
    let tx = conn.unchecked_transaction()?;
    let mut added = 0;
    {
        let mut stmt =
            tx.prepare_cached("INSERT OR IGNORE INTO wallpapers (filename, path) VALUES (?1, ?2)")?;
        for path in paths {
            let Some(path_str) = path.to_str() else {
                // `scanner::walk` filters these out; skip rather than panic so a
                // caller that doesn't can't poison the connection mutex.
                continue;
            };
            added += stmt.execute(rusqlite::params![
                path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default(),
                path_str,
            ])?;
        }
    }
    tx.commit()?;
    Ok(added)
}

/// How many ` (n)` variants to try before giving up on a colliding destination.
const MAX_COLLISION_SUFFIXES: u32 = 1000;

/// Soft-rejects a wallpaper: moves its file to `destination_folder` and marks
/// the row Rejected, keeping every Comparison it took part in.
///
/// The database write happens first, inside a transaction, and the file move
/// last. That ordering matters: a `UNIQUE(path)` collision or any other DB
/// error then aborts before anything on disk has changed, instead of leaving a
/// moved file behind a row that still points at the old location.
pub fn move_wallpaper(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    let (path, filename, status): (String, String, String) = tx
        .query_row(
            "SELECT path, filename, status FROM wallpapers WHERE id = ?1",
            rusqlite::params![wallpaper_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no wallpaper with id {wallpaper_id}"))
            }
            other => other.into(),
        })?;

    if status == "rejected" {
        // Re-rejecting would move the file again, nesting the destination folder
        // inside itself (`rejected/rejected/x.jpg`).
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} is already rejected"
        )));
    }

    let source = PathBuf::from(&path);
    let dest_dir = resolve_destination_dir(&source, destination_folder)?;
    if dest_dir.join(&filename) == source {
        return Err(AppError::InvalidPath(format!(
            "destination {destination_folder:?} is the folder wallpaper {wallpaper_id} already lives in"
        )));
    }
    let dest_path = unique_destination(&dest_dir, &filename)?;

    let dest_str = dest_path
        .to_str()
        .ok_or_else(|| AppError::InvalidPath(dest_path.display().to_string()))?;
    let dest_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidPath(dest_path.display().to_string()))?;

    tx.execute(
        "UPDATE wallpapers SET status = 'rejected', path = ?1, filename = ?2 WHERE id = ?3",
        rusqlite::params![dest_str, dest_name, wallpaper_id],
    )?;

    // Anything below that fails drops `tx` unread, rolling the row back.
    move_file(&source, &dest_path)?;
    tx.commit()?;
    Ok(())
}

/// Expands `destination_folder`, resolves it against the wallpaper's own folder
/// when it is relative, creates it, and canonicalizes the result.
///
/// Expansion goes first so that the directory is created only after the Written
/// path has resolved: `~/rejected` used to produce a folder literally named `~`
/// beside the wallpaper, and `$HOEM/rejected` must not create anything at all.
/// Creating the destination on demand stays, because `./rejected` has to come
/// from somewhere on the first reject.
///
/// Canonicalizing is what keeps a rejected file rejected: the default `./rejected`
/// would otherwise be stored verbatim as `/lib/./rejected/x.jpg`, which is a
/// different string from the `/lib/rejected/x.jpg` a rescan produces, so
/// `UNIQUE(path)` wouldn't match and the file would come back as a new Active row.
/// It is also what stops `~/pics` and `$HOME/pics` becoming two spellings of one
/// folder.
fn resolve_destination_dir(source: &Path, destination_folder: &str) -> Result<PathBuf, AppError> {
    create_destination_dir(source, crate::paths::expand(destination_folder)?)
}

/// [`resolve_destination_dir`] with the environment passed in, for the tests.
///
/// Same reason as [`crate::paths::expand_with`]: the `~` case needs a known
/// `HOME`, and a test that read the real one would create its scratch directory
/// inside the developer's actual home folder, where a killed run would leave it.
/// The only difference from the real path is where the variable's value comes
/// from, so the ordering this function exists to guarantee is the ordering under
/// test.
#[cfg(test)]
fn resolve_destination_dir_with(
    source: &Path,
    destination_folder: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<PathBuf, AppError> {
    create_destination_dir(
        source,
        crate::paths::expand_with(destination_folder, lookup)?,
    )
}

/// Everything after expansion: resolve a relative destination against the
/// wallpaper's own folder, create it, canonicalize.
fn create_destination_dir(source: &Path, expanded: PathBuf) -> Result<PathBuf, AppError> {
    let raw = if expanded.is_absolute() {
        expanded
    } else {
        source
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(expanded)
    };
    std::fs::create_dir_all(&raw)?;
    raw.canonicalize().map_err(Into::into)
}

/// Picks a filename in `dir` that no file currently occupies.
///
/// `fs::rename` overwrites its destination silently, so without this two
/// wallpapers sharing a basename would destroy one another's file.
fn unique_destination(dir: &Path, filename: &str) -> Result<PathBuf, AppError> {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return Ok(candidate);
    }
    let as_path = Path::new(filename);
    let stem = as_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let extension = as_path.extension().and_then(|s| s.to_str());
    for n in 2..=MAX_COLLISION_SUFFIXES {
        let name = match extension {
            Some(extension) => format!("{stem} ({n}).{extension}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::Io(format!(
        "{} already holds {MAX_COLLISION_SUFFIXES} files named like {filename:?}",
        dir.display()
    )))
}

/// Moves a file, falling back to copy-then-delete across filesystems and
/// cleaning up after itself so a failure never leaves two copies.
fn move_file(source: &Path, dest: &Path) -> Result<(), AppError> {
    match std::fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
            if let Err(e) = std::fs::copy(source, dest) {
                let _ = std::fs::remove_file(dest);
                return Err(e.into());
            }
            if let Err(e) = std::fs::remove_file(source) {
                let _ = std::fs::remove_file(dest);
                return Err(e.into());
            }
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
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
    /// Where the file sat before its current soft reject, so a Restore can put
    /// it back. `None` for anything not currently rejected, and for a wallpaper
    /// rejected before the column existed — which is the cohort Rejected stays
    /// terminal for.
    pub origin_path: Option<String>,
}

pub fn get_review(conn: &Connection, limit: i64) -> Result<Vec<Wallpaper>, rusqlite::Error> {
    if limit <= 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(
        "SELECT id, filename, path, status, rating_mu, rating_sigma, comparisons_count, origin_path
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
            origin_path: row.get(7)?,
        })
    })?;
    rows.collect()
}

/// Transitions a wallpaper to Kept. Re-keeping a Kept one is a no-op success.
///
/// Keeping a Rejected wallpaper is refused: per CONTEXT.md a reject is a
/// transition, not a flag, so this would silently un-reject a file that no
/// longer sits where the row says it does.
pub fn keep_wallpaper(conn: &Connection, id: i64) -> Result<(), AppError> {
    let status: String = conn
        .query_row(
            "SELECT status FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no wallpaper with id {id}"))
            }
            other => other.into(),
        })?;

    if status == "rejected" {
        return Err(AppError::InvalidTransition(format!(
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

    /// The v1 schema, as shipped before the thumbnails CHECK was widened.
    const DDL_V1: &str = "
        CREATE TABLE wallpapers (
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
        CREATE TABLE comparisons (
            id        INTEGER PRIMARY KEY,
            winner_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
            loser_id  INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
            voted_at  INTEGER NOT NULL
        );
        CREATE TABLE thumbnails (
            wallpaper_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE CASCADE,
            size         TEXT    NOT NULL CHECK (size IN ('small', 'medium')),
            width        INTEGER NOT NULL,
            height       INTEGER NOT NULL,
            source_mtime INTEGER NOT NULL,
            PRIMARY KEY (wallpaper_id, size)
        );
    ";

    /// The v2 schema, as the release before `origin_path` shipped it. `settings`
    /// is in it because that table arrived without a version bump, so a v2 file
    /// that has been opened once has it.
    const DDL_V2: &str = "
        CREATE TABLE wallpapers (
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
        CREATE TABLE comparisons (
            id        INTEGER PRIMARY KEY,
            winner_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
            loser_id  INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
            voted_at  INTEGER NOT NULL
        );
        CREATE TABLE thumbnails (
            wallpaper_id INTEGER NOT NULL REFERENCES wallpapers(id) ON DELETE CASCADE,
            size         TEXT    NOT NULL CHECK (size IN ('small', 'medium', 'full')),
            width        INTEGER NOT NULL,
            height       INTEGER NOT NULL,
            source_mtime INTEGER NOT NULL,
            PRIMARY KEY (wallpaper_id, size)
        );
        CREATE TABLE settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        PRAGMA user_version = 2;
    ";

    fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
        conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            rusqlite::params![table, column],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
    }

    fn origin_path_of(conn: &Connection, id: i64) -> Option<String> {
        conn.query_row(
            "SELECT origin_path FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn count_comparisons(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
            .unwrap()
    }

    fn record_full_thumbnail(conn: &Connection, wallpaper_id: i64) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO thumbnails (wallpaper_id, size, width, height, source_mtime)
             VALUES (?1, 'full', 10, 10, 0)",
            rusqlite::params![wallpaper_id],
        )
    }

    #[test]
    fn a_fresh_database_opens_stamped_at_the_current_schema_version() {
        // `open` is only reachable in production, so nothing else exercises it.
        let tmp = tempfile::tempdir().unwrap();
        let conn = open(&tmp.path().join("walltare.db")).unwrap();
        init_schema(&conn).unwrap();

        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        assert_eq!(SCHEMA_VERSION, 3);
        assert!(column_exists(&conn, "wallpapers", "origin_path").unwrap());
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        record_full_thumbnail(&conn, id).unwrap();
        assert_eq!(origin_path_of(&conn, id), None);
    }

    #[test]
    fn a_v2_database_gains_the_origin_column_with_nothing_in_it() {
        // `origin_path` is a column on a table that already exists, which is the
        // one shape change `CREATE TABLE IF NOT EXISTS` cannot make. Without the
        // step, a database from the current release opens fine and then fails on
        // the first `SELECT origin_path`.
        //
        // The rows that matter most here are the ones a curator already
        // rejected: nothing recorded where their files came from, so they come
        // through with no Origin, and their Comparisons come through untouched.
        let tmp = tempfile::tempdir().unwrap();
        let conn = open(&tmp.path().join("walltare.db")).unwrap();
        conn.execute_batch(DDL_V2).unwrap();
        let rejected = seed_wallpaper(&conn, "/w/rejected/old.jpg", "rejected", 11.0);
        let active = seed_wallpaper(&conn, "/w/keeper.jpg", "active", 25.0);
        add_comparison(&conn, active, rejected);
        assert_eq!(schema_version(&conn).unwrap(), 2);
        assert!(!column_exists(&conn, "wallpapers", "origin_path").unwrap());

        init_schema(&conn).unwrap();

        assert!(column_exists(&conn, "wallpapers", "origin_path").unwrap());
        assert_eq!(schema_version(&conn).unwrap(), 3);
        assert_eq!(origin_path_of(&conn, rejected), None);
        assert_eq!(origin_path_of(&conn, active), None);
        assert_eq!(count_wallpapers(&conn), 2);
        assert_eq!(count_comparisons(&conn), 1);
    }

    #[test]
    fn a_v1_database_is_migrated_rather_than_left_on_the_old_shape() {
        // `CREATE TABLE IF NOT EXISTS` silently skips an existing table, so
        // without the migration step a v1 file keeps the narrow CHECK forever
        // and every 'full' thumbnail insert fails at runtime.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        let conn = open(&db_path).unwrap();
        conn.execute_batch(DDL_V1).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        assert_eq!(schema_version(&conn).unwrap(), 0);
        assert!(record_full_thumbnail(&conn, id).is_err());

        init_schema(&conn).unwrap();

        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        record_full_thumbnail(&conn, id).unwrap();
        // Every step runs, not just the first one below the target.
        assert!(column_exists(&conn, "wallpapers", "origin_path").unwrap());
        // Wallpapers and their history are untouched; only the cache table is
        // rebuilt.
        assert_eq!(count_wallpapers(&conn), 1);
    }

    #[test]
    fn a_database_created_before_the_settings_table_gains_it_without_a_version_bump() {
        // The property the settings table rests on: it needs no migration step
        // because the DDL runs before `init_schema` branches. Dropping it from a
        // current database is how an older file looks in the only respect this
        // is about; the version such a file carries is beside the point, which
        // is the claim.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        let conn = open(&db_path).unwrap();
        init_schema(&conn).unwrap();
        seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        let before = schema_version(&conn).unwrap();
        conn.execute_batch("DROP TABLE settings").unwrap();
        assert!(!table_exists(&conn, "settings").unwrap());

        init_schema(&conn).unwrap();

        assert!(table_exists(&conn, "settings").unwrap());
        // No step ran and no version moved: the table came back out of the DDL.
        assert_eq!(schema_version(&conn).unwrap(), before);
        assert_eq!(count_wallpapers(&conn), 1);
    }

    #[test]
    fn a_v1_database_gains_the_settings_table_alongside_its_migration() {
        // The oldest file anyone can be holding. The migration step and the new
        // table are independent, and this is what says so.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(DDL_V1).unwrap();

        init_schema(&conn).unwrap();

        assert!(table_exists(&conn, "settings").unwrap());
        assert_eq!(
            crate::settings::get(&conn).unwrap(),
            crate::settings::Settings::default()
        );
    }

    #[test]
    fn init_schema_is_idempotent_across_reopens() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = open(&db_path).unwrap();
            init_schema(&conn).unwrap();
            seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        }
        let conn = open(&db_path).unwrap();
        init_schema(&conn).unwrap();

        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        assert_eq!(count_wallpapers(&conn), 1);
    }

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

    fn filename_of(conn: &Connection, id: i64) -> String {
        conn.query_row(
            "SELECT filename FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn id_of(conn: &Connection, path: &str) -> i64 {
        conn.query_row(
            "SELECT id FROM wallpapers WHERE path = ?1",
            rusqlite::params![path],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn count_wallpapers(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM wallpapers", [], |row| row.get(0))
            .unwrap()
    }

    /// `move_wallpaper` stores canonical paths, so expectations built from a
    /// tempdir have to be canonicalized the same way to compare.
    fn path_string(path: PathBuf) -> String {
        let dir = path
            .parent()
            .expect("expectation paths always have a parent")
            .canonicalize()
            .expect("destination directory exists by the time this is called");
        dir.join(path.file_name().unwrap())
            .to_str()
            .unwrap()
            .to_string()
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
        let before = row_status_and_path(&conn, id);

        let err = keep_wallpaper(&conn, id).unwrap_err();

        assert!(matches!(
            err,
            crate::error::AppError::InvalidTransition(ref m) if m.contains(&id.to_string())
        ));
        assert_eq!(row_status_and_path(&conn, id), before);
    }

    #[test]
    fn colliding_basenames_are_suffixed_instead_of_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let a_dir = tmp.path().join("a");
        let b_dir = tmp.path().join("b");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::create_dir_all(&b_dir).unwrap();
        std::fs::write(a_dir.join("wall.jpg"), b"AAAA").unwrap();
        std::fs::write(b_dir.join("wall.jpg"), b"BBBB").unwrap();
        insert_new_wallpapers(&conn, &[a_dir.join("wall.jpg"), b_dir.join("wall.jpg")]).unwrap();
        let id_a = id_of(&conn, a_dir.join("wall.jpg").to_str().unwrap());
        let id_b = id_of(&conn, b_dir.join("wall.jpg").to_str().unwrap());

        let out = dest.path().to_str().unwrap();
        move_wallpaper(&conn, id_a, out).unwrap();
        move_wallpaper(&conn, id_b, out).unwrap();

        // Neither file was destroyed and both rows point at what they hold.
        assert_eq!(
            std::fs::read(dest.path().join("wall.jpg")).unwrap(),
            b"AAAA"
        );
        assert_eq!(
            std::fs::read(dest.path().join("wall (2).jpg")).unwrap(),
            b"BBBB"
        );
        assert_eq!(
            row_status_and_path(&conn, id_a),
            ("rejected".into(), path_string(dest.path().join("wall.jpg")))
        );
        assert_eq!(
            row_status_and_path(&conn, id_b),
            (
                "rejected".into(),
                path_string(dest.path().join("wall (2).jpg"))
            )
        );
        assert_eq!(filename_of(&conn, id_b), "wall (2).jpg");
    }

    #[test]
    fn default_relative_destination_survives_a_rescan() {
        // `./rejected` is the destination the review UI ships with. Stored
        // verbatim it would read `/lib/./rejected/x.jpg`, which UNIQUE(path)
        // can't match against the `/lib/rejected/x.jpg` a rescan produces.
        let tmp = tempfile::tempdir().unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "ugly.jpg");

        move_wallpaper(&conn, id, "./rejected").unwrap();

        let stored = row_status_and_path(&conn, id).1;
        assert_eq!(
            stored,
            path_string(library.join("rejected").join("ugly.jpg"))
        );

        let found = crate::scanner::collect_images(std::slice::from_ref(&library));
        assert_eq!(insert_new_wallpapers(&conn, &found).unwrap(), 0);
        assert_eq!(count_wallpapers(&conn), 1);
        assert_eq!(get_review(&conn, 50).unwrap(), Vec::new());
    }

    #[test]
    fn a_tilde_destination_is_expanded_before_the_directory_is_created() {
        // The bug this kills: `~/rejected` used to create a directory literally
        // named `~` inside the wallpaper's own folder, move the file into it,
        // and store that as the wallpaper's path, with nothing erroring.
        //
        // `HOME` is a stand-in home folder rather than the real one, so nothing
        // here reads or writes the process environment.
        let home = tempfile::tempdir().unwrap();
        let wallpaper_dir = tempfile::tempdir().unwrap();
        let source = wallpaper_dir.path().join("tilde.jpg");

        let home_value = home.path().to_str().unwrap().to_string();
        let resolved = resolve_destination_dir_with(&source, "~/rejected", |name| {
            (name == "HOME").then(|| home_value.clone())
        })
        .unwrap();

        assert_eq!(
            resolved,
            home.path().join("rejected").canonicalize().unwrap()
        );
        assert!(!wallpaper_dir.path().join("~").exists());
    }

    #[test]
    fn a_malformed_destination_creates_nothing_on_disk() {
        // An unset variable must not expand to empty either: `$X/rejected`
        // becoming `/rejected` would create a folder at the filesystem root and
        // start moving wallpapers into it.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "safe.jpg");
        let destination = "$WALLTARE_NO_SUCH_VARIABLE/rejected";

        let err = move_wallpaper(&conn, id, destination).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::InvalidPathSyntax(ref m)
                if m == "unknown environment variable WALLTARE_NO_SUCH_VARIABLE"),
            "got {err:?}"
        );
        assert!(!tmp.path().join("$WALLTARE_NO_SUCH_VARIABLE").exists());
        assert!(!tmp.path().join("rejected").exists());
        assert!(tmp.path().join("safe.jpg").is_file());
        assert_eq!(status_of(&conn, id), "active");
    }

    #[test]
    fn destination_resolving_to_the_current_folder_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "stay.jpg");

        for destination in ["", ".", "./"] {
            let err = move_wallpaper(&conn, id, destination).unwrap_err();
            assert!(
                matches!(err, crate::error::AppError::InvalidPath(_)),
                "destination {destination:?} gave {err:?}"
            );
        }

        assert!(tmp.path().join("stay.jpg").is_file());
        assert_eq!(status_of(&conn, id), "active");
    }

    #[test]
    fn re_rejecting_a_rejected_wallpaper_is_refused_and_does_not_nest_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "b.png");
        move_wallpaper(&conn, id, "rejected").unwrap();

        let err = move_wallpaper(&conn, id, "rejected").unwrap_err();

        assert!(matches!(err, crate::error::AppError::InvalidTransition(_)));
        assert!(library.join("rejected").join("b.png").is_file());
        assert!(!library.join("rejected").join("rejected").exists());
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
