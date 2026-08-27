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

/// Soft-rejects a wallpaper: moves its file to `destination_folder`, marks the
/// row Rejected, records the Origin, and answers with the absolute path the
/// file ended up at.
///
/// The returned path is not the destination folder joined with the old
/// filename: a collision suffixes the basename, so `wall.jpg` can land as
/// `wall (2).jpg`, and only the caller that is told so can say where the file
/// went.
///
/// The database write happens first, inside a transaction, and the file move
/// last. That ordering matters: a `UNIQUE(path)` collision or any other DB
/// error then aborts before anything on disk has changed, instead of leaving a
/// moved file behind a row that still points at the old location.
pub fn move_wallpaper(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<String, AppError> {
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

    // `origin_path = path` records where the file is coming from. SQLite
    // evaluates every right-hand side against the pre-update row, so this reads
    // the old path in the same statement that overwrites it — no second read,
    // and no window where the Origin is half written.
    tx.execute(
        "UPDATE wallpapers
         SET status = 'rejected', path = ?1, filename = ?2, origin_path = path
         WHERE id = ?3",
        rusqlite::params![dest_str, dest_name, wallpaper_id],
    )?;

    // Anything below that fails drops `tx` unread, rolling the row back.
    move_file(&source, &dest_path)?;
    tx.commit()?;
    Ok(dest_str.to_string())
}

/// Restores a soft-rejected wallpaper: moves its file back to the Origin the
/// reject recorded, lands the row on Active with the Origin cleared, and answers
/// with the absolute path the file ended up at.
///
/// A Restore always lands on Active, never on whatever Status the wallpaper held
/// before the reject. Kept is the curator's judgement about a rating, and
/// changing their mind about a reject is not that judgement (ADR 0009).
///
/// A wallpaper that is not Rejected is refused rather than treated as a no-op:
/// there is no file to move and no Origin to read, so succeeding quietly would
/// hide either a stale id or a control the UI left enabled. So is one rejected
/// before the Origin was recorded — nothing can say where its file came from,
/// which is the cohort Rejected stays terminal for.
///
/// The ordering is [`move_wallpaper`]'s, run backwards: the row is written
/// inside a transaction and the file moves last, so a `UNIQUE(path)` collision
/// or any other database error aborts while the disk is still untouched, and
/// dropping the transaction rolls the row back.
pub fn restore_wallpaper(conn: &Connection, wallpaper_id: i64) -> Result<String, AppError> {
    let tx = conn.unchecked_transaction()?;
    let (path, status, origin_path): (String, String, Option<String>) = tx
        .query_row(
            "SELECT path, status, origin_path FROM wallpapers WHERE id = ?1",
            rusqlite::params![wallpaper_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no wallpaper with id {wallpaper_id}"))
            }
            other => other.into(),
        })?;

    if status != "rejected" {
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} is {status}, so there is no reject to undo"
        )));
    }
    let Some(origin) = origin_path else {
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} was rejected before its Origin was recorded, so there is nowhere to put it back"
        )));
    };

    let source = PathBuf::from(&path);
    if !source.is_file() {
        // Not what makes this safe — the write ordering below does that. It is
        // here so a curator who emptied the reject folder by hand reads a
        // sentence about the reject folder instead of whatever `rename` says.
        return Err(AppError::FileMissing(path));
    }

    // The Origin is the file's own pre-reject path, so the folder to put it back
    // in is that path's parent and the name to put it back under is its
    // basename. Neither is re-canonicalized: the Origin is the string the row
    // itself held before the reject, so it has already survived a rescan
    // comparison, and resolving it again could only move it.
    let origin = PathBuf::from(origin);
    let origin_dir = origin
        .parent()
        .ok_or_else(|| AppError::InvalidPath(origin.display().to_string()))?;
    let origin_name = origin
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidPath(origin.display().to_string()))?;

    // The Origin folder may be gone: the rejected file may have been the last
    // thing in it, or the curator may have tidied up since.
    std::fs::create_dir_all(origin_dir)?;
    let dest_path = unique_destination(origin_dir, origin_name)?;

    let dest_str = dest_path
        .to_str()
        .ok_or_else(|| AppError::InvalidPath(dest_path.display().to_string()))?;
    let dest_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::InvalidPath(dest_path.display().to_string()))?;

    // Clearing the Origin is part of the same statement that spends it, so no
    // row ever claims Active and an Origin at once, and the next reject records
    // a fresh one.
    tx.execute(
        "UPDATE wallpapers
         SET status = 'active', path = ?1, filename = ?2, origin_path = NULL
         WHERE id = ?3",
        rusqlite::params![dest_str, dest_name, wallpaper_id],
    )?;

    // Anything below that fails drops `tx` unread, rolling the row back.
    move_file(&source, &dest_path)?;
    tx.commit()?;
    Ok(dest_str.to_string())
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

/// Transitions a wallpaper to Active, undoing a Keep. Un-keeping an Active one
/// is a no-op success, for the same reason re-keeping a Kept one is: a double
/// click on a button is not an error.
///
/// [`keep_wallpaper`] stays a one-way transition rather than becoming a toggle,
/// which is what makes that idempotence worth having: a toggle would turn the
/// same double click into a keep followed by an un-keep (ADR 0009).
///
/// Un-keeping a Rejected wallpaper is refused. Its file sits in the reject
/// folder, and moving it back is what a Restore does; succeeding here would
/// leave an Active row pointing inside the reject folder, still carrying the
/// Origin the Restore was going to spend.
pub fn unkeep_wallpaper(conn: &Connection, id: i64) -> Result<(), AppError> {
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
            "wallpaper {id} is rejected, so a Restore is what brings it back"
        )));
    }

    conn.execute(
        "UPDATE wallpapers SET status = 'active' WHERE id = ?1",
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

    /// A wallpaper whose file is a real image, for the tests that put a
    /// thumbnail behind it. `seed_real_wallpaper`'s empty file has an mtime,
    /// which is all a move cares about, but nothing can decode it.
    fn seed_image_wallpaper(conn: &Connection, dir: &Path, name: &str) -> i64 {
        let path = dir.join(name);
        image::RgbImage::from_pixel(8, 4, image::Rgb([7, 90, 200]))
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        insert_new_wallpapers(conn, &[path]).unwrap();
        conn.last_insert_rowid()
    }

    fn count_thumbnails(conn: &Connection, wallpaper_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM thumbnails WHERE wallpaper_id = ?1",
            rusqlite::params![wallpaper_id],
            |row| row.get(0),
        )
        .unwrap()
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
    fn unkeep_wallpaper_transitions_kept_to_active_and_hands_it_back_to_review() {
        // The mis-click this exists for: Keep takes a wallpaper out of review,
        // and until now nothing put it back.
        //
        // Only review changes. A Kept wallpaper is Eligible already, so it never
        // left the voting pool and there is no return to it to assert.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let kept = seed_wallpaper(&conn, "/w/kept.jpg", "active", 15.0);
        let other = seed_wallpaper(&conn, "/w/other.jpg", "active", 25.0);
        keep_wallpaper(&conn, kept).unwrap();
        assert_eq!(review_ids(&conn), vec![other]);

        unkeep_wallpaper(&conn, kept).unwrap();

        assert_eq!(status_of(&conn, kept), "active");
        // Back in review, and in its place by Score rather than appended.
        assert_eq!(review_ids(&conn), vec![kept, other]);
    }

    fn review_ids(conn: &Connection) -> Vec<i64> {
        get_review(conn, 50).unwrap().iter().map(|w| w.id).collect()
    }

    #[test]
    fn unkeeping_an_active_wallpaper_is_a_no_op_success() {
        // Same reason re-keeping a Kept one succeeds: a double click on a button
        // is not an error. It is also why `keep_wallpaper` is not a toggle — that
        // would read the second click as an un-keep (ADR 0009).
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        unkeep_wallpaper(&conn, id).unwrap();
        assert_eq!(status_of(&conn, id), "active");

        // And twice over, from Kept, which is the double click itself.
        keep_wallpaper(&conn, id).unwrap();
        unkeep_wallpaper(&conn, id).unwrap();
        unkeep_wallpaper(&conn, id).unwrap();
        assert_eq!(status_of(&conn, id), "active");
    }

    #[test]
    fn unkeeping_a_rejected_wallpaper_returns_invalid_transition_and_changes_nothing() {
        // Not a no-op success either: the file is in the reject folder, so an
        // Active row would point at a path outside the library, and the Origin
        // that a Restore needs would still be sitting on it. Kept, then
        // Rejected, is the route a curator actually gets here by.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "regretted.jpg");
        keep_wallpaper(&conn, id).unwrap();
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        let before = row_status_and_path(&conn, id);

        let err = unkeep_wallpaper(&conn, id).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::InvalidTransition(ref m)
                if m.contains(&id.to_string())),
            "got {err:?}"
        );
        assert_eq!(row_status_and_path(&conn, id), before);
        assert_eq!(
            origin_path_of(&conn, id),
            Some(origin.to_str().unwrap().to_string())
        );
        assert!(PathBuf::from(&rejected_at).is_file());
        assert!(!origin.exists());

        // And the transition it was asking for is still available under the
        // command that moves the file with it.
        assert_eq!(PathBuf::from(restore_wallpaper(&conn, id).unwrap()), origin);
    }

    #[test]
    fn unkeeping_an_unknown_id_returns_not_found_and_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);
        keep_wallpaper(&conn, id).unwrap();

        let err = unkeep_wallpaper(&conn, 9999).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::NotFound(_)),
            "{err:?}"
        );
        assert_eq!(status_of(&conn, id), "kept");
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
        let landed_a = move_wallpaper(&conn, id_a, out).unwrap();
        let landed_b = move_wallpaper(&conn, id_b, out).unwrap();

        // Each reject answers with the path its file is actually at, suffix and
        // all, which is the only way a caller can tell the curator that their
        // `wall.jpg` is now `wall (2).jpg`.
        assert_eq!(landed_a, path_string(dest.path().join("wall.jpg")));
        assert_eq!(landed_b, path_string(dest.path().join("wall (2).jpg")));
        assert!(PathBuf::from(&landed_b).is_file());

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
        let origin = library.join("b.png").to_str().unwrap().to_string();
        move_wallpaper(&conn, id, "rejected").unwrap();

        let err = move_wallpaper(&conn, id, "rejected").unwrap_err();

        assert!(matches!(err, crate::error::AppError::InvalidTransition(_)));
        assert!(library.join("rejected").join("b.png").is_file());
        assert!(!library.join("rejected").join("rejected").exists());
        // The refusal left the first reject's Origin alone. A second one would
        // have overwritten it with the reject folder, which is the one place a
        // Restore must never send a file back to.
        assert_eq!(origin_path_of(&conn, id), Some(origin));
    }

    #[test]
    fn move_wallpaper_moves_file_and_marks_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "a.jpg");

        let dest_dir = dest.path().join("out");
        let landed = move_wallpaper(&conn, id, dest_dir.to_str().unwrap()).unwrap();

        assert_eq!(PathBuf::from(&landed), dest_dir.join("a.jpg"));
        assert!(dest_dir.join("a.jpg").is_file());
        assert!(!tmp.path().join("a.jpg").exists());
        let (status, path) = row_status_and_path(&conn, id);
        assert_eq!(status, "rejected");
        assert_eq!(PathBuf::from(&path), dest_dir.join("a.jpg"));

        assert!(get_review(&conn, 50).unwrap().is_empty());
    }

    #[test]
    fn move_wallpaper_rejects_a_kept_wallpaper_the_same_way_it_rejects_an_active_one() {
        // Kept to Rejected is a legal transition in its own right, and the only
        // one that has to reach past the guard that refuses a Rejected wallpaper.
        // A curator who kept a wallpaper and later changed their mind gets the
        // file moved and the Origin recorded, exactly as from Active.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "kept-then-cut.jpg");
        keep_wallpaper(&conn, id).unwrap();

        let landed = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        assert_eq!(landed, path_string(dest.path().join("kept-then-cut.jpg")));
        assert!(PathBuf::from(&landed).is_file());
        assert!(!origin.exists());
        assert_eq!(row_status_and_path(&conn, id), ("rejected".into(), landed));
        assert_eq!(
            origin_path_of(&conn, id),
            Some(origin.to_str().unwrap().to_string())
        );
    }

    #[test]
    fn a_reject_records_where_the_file_came_from() {
        // The Origin is the file's own pre-reject path, not the folder it sat
        // in: a Restore has to put `wall.jpg` back as `wall.jpg`, and the row's
        // own `filename` has moved on to whatever the destination gave it.
        //
        // Nothing reads `origin_path` back through a DTO yet, so the row is
        // queried directly.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "dawn.jpg");
        let origin = library.join("dawn.jpg").to_str().unwrap().to_string();

        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        assert_eq!(origin_path_of(&conn, id), Some(origin));
        // And the row still describes where the file went.
        assert_eq!(
            row_status_and_path(&conn, id),
            ("rejected".into(), path_string(dest.path().join("dawn.jpg")))
        );
        assert_eq!(filename_of(&conn, id), "dawn.jpg");
    }

    #[test]
    fn a_colliding_reject_records_the_origin_the_file_actually_left() {
        // The reject writes `path` and `origin_path` in one statement. If the
        // Origin were read back after the write instead of alongside it, this
        // is the case that would record the suffixed destination as the place
        // the file came from.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        std::fs::write(dest.path().join("wall.jpg"), b"OCCUPIED").unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "wall.jpg");
        let origin = tmp.path().join("wall.jpg").to_str().unwrap().to_string();

        let landed = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        assert_eq!(landed, path_string(dest.path().join("wall (2).jpg")));
        assert_eq!(origin_path_of(&conn, id), Some(origin));
    }

    #[test]
    fn a_reject_keeps_the_thumbnails_the_wallpaper_already_had() {
        // The reject used to purge them, which was right while Rejected was
        // terminal and absent from every view. It is not any more: the library
        // page lists Rejected wallpapers and a Restore brings them back, and
        // the row's `path` follows the file while the move preserves its mtime,
        // so the cache stays valid and resolves exactly as before (ADR 0012).
        // Purging would spend a decode per rejected card to reproduce bytes it
        // had just deleted, so restoring the symmetry with the purge is the
        // change this test exists to stop.
        let tmp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_image_wallpaper(&conn, tmp.path(), "cached.png");
        crate::thumbnails::resolve(&conn, cache.path(), id, crate::thumbnails::Size::Small)
            .unwrap();
        let cache_file = cache.path().join(format!("{id}_small.jpg"));
        assert!(cache_file.is_file());

        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        assert_eq!(count_thumbnails(&conn, id), 1);
        assert!(cache_file.is_file());

        // And the moved row still resolves to that same file: `record_mtime` is
        // `None` only on a cache hit, so this is a decode that did not happen.
        let plan = crate::thumbnails::plan(&conn, id, crate::thumbnails::Size::Small).unwrap();
        let resolved = crate::thumbnails::fulfill(&plan, cache.path()).unwrap();
        assert!(resolved.record_mtime.is_none());
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
        // The rollback takes the Origin with it: a wallpaper that is not
        // Rejected must not read as one a Restore could move.
        assert_eq!(origin_path_of(&conn, id), None);
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

    fn rating_of(conn: &Connection, id: i64) -> (f64, i64) {
        conn.query_row(
            "SELECT rating_mu, comparisons_count FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    /// A library folder holding one wallpaper, and the Origin string a reject of
    /// it records. Every restore test starts here.
    fn seed_for_restore(conn: &Connection, root: &Path, name: &str) -> (i64, PathBuf) {
        let library = root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        let id = seed_real_wallpaper(conn, &library, name);
        (id, library.join(name))
    }

    #[test]
    fn a_restore_puts_the_file_back_where_the_reject_took_it_from() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "dawn.jpg");
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        assert!(PathBuf::from(&rejected_at).is_file());

        let landed = restore_wallpaper(&conn, id).unwrap();

        // The filesystem first: the row saying Active means nothing if the file
        // is still sitting in the reject folder.
        assert_eq!(PathBuf::from(&landed), origin);
        assert!(origin.is_file());
        assert!(!PathBuf::from(&rejected_at).exists());
        assert_eq!(
            row_status_and_path(&conn, id),
            ("active".into(), origin.to_str().unwrap().to_string())
        );
        assert_eq!(filename_of(&conn, id), "dawn.jpg");
        // The Origin is spent, so nothing reads the restored wallpaper as one a
        // Restore could move again.
        assert_eq!(origin_path_of(&conn, id), None);
        // And it is back in the pool the curator draws from.
        assert_eq!(
            get_review(&conn, 50)
                .unwrap()
                .iter()
                .map(|w| w.id)
                .collect::<Vec<_>>(),
            vec![id]
        );
    }

    #[test]
    fn a_restore_lands_on_active_even_when_the_wallpaper_was_kept() {
        // Kept is the curator's judgement about a rating; changing their mind
        // about a reject is not that judgement, so a Restore hands the wallpaper
        // back to Review rather than to Kept (ADR 0009).
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "keeper.jpg");
        keep_wallpaper(&conn, id).unwrap();
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        restore_wallpaper(&conn, id).unwrap();

        assert_eq!(status_of(&conn, id), "active");
        assert!(origin.is_file());
    }

    #[test]
    fn rejecting_again_after_a_restore_records_a_fresh_origin() {
        // The cycle the whole feature is for: a curator may change their mind as
        // often as they like, and each reject records where the file left from
        // this time rather than reusing a spent Origin.
        let tmp = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "twice.jpg");
        let origin_string = origin.to_str().unwrap().to_string();

        move_wallpaper(&conn, id, first.path().to_str().unwrap()).unwrap();
        assert_eq!(origin_path_of(&conn, id), Some(origin_string.clone()));
        restore_wallpaper(&conn, id).unwrap();
        let landed = move_wallpaper(&conn, id, second.path().to_str().unwrap()).unwrap();

        assert_eq!(landed, path_string(second.path().join("twice.jpg")));
        assert!(PathBuf::from(&landed).is_file());
        assert!(!origin.exists());
        // Recorded afresh from where the file actually was, which is the library
        // folder the Restore put it back in.
        assert_eq!(origin_path_of(&conn, id), Some(origin_string));
        assert_eq!(status_of(&conn, id), "rejected");

        // And the second reject reverses as readily as the first.
        assert_eq!(PathBuf::from(restore_wallpaper(&conn, id).unwrap()), origin);
        assert!(origin.is_file());
        assert_eq!(count_wallpapers(&conn), 1);
    }

    #[test]
    fn a_restored_wallpaper_keeps_its_comparisons_and_its_score() {
        // A change of mind about a reject is not a reason to forget how the
        // wallpaper did in the comparisons it took part in.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, _) = seed_for_restore(&conn, tmp.path(), "rated.jpg");
        let other = seed_real_wallpaper(&conn, tmp.path(), "other.jpg");
        add_comparison(&conn, other, id);
        conn.execute(
            "UPDATE wallpapers SET rating_mu = 11.5, comparisons_count = 1 WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        restore_wallpaper(&conn, id).unwrap();

        assert_eq!(rating_of(&conn, id), (11.5, 1));
        assert_eq!(count_comparisons(&conn), 1);
    }

    #[test]
    fn a_restore_recreates_an_origin_folder_that_is_gone() {
        // The rejected file may have been the last thing in its folder, or the
        // curator may have tidied up since.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "lonely.jpg");
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        let origin_dir = origin.parent().unwrap().to_path_buf();
        std::fs::remove_dir_all(&origin_dir).unwrap();
        assert!(!origin_dir.exists());

        let landed = restore_wallpaper(&conn, id).unwrap();

        assert_eq!(PathBuf::from(&landed), origin);
        assert!(origin.is_file());
        assert_eq!(status_of(&conn, id), "active");
    }

    #[test]
    fn a_restore_into_an_occupied_origin_lands_beside_what_is_there() {
        // Something else took the name while the wallpaper was away: a bare file
        // the curator dropped in, or a rescan that picked one up as its own row.
        // Overwriting it would destroy a file to undo a click, and refusing
        // would make the curator rename files by hand to finish the operation.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "wall.jpg");
        std::fs::write(&origin, b"REJECTED").unwrap();
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        std::fs::write(&origin, b"SQUATTER").unwrap();

        let landed = restore_wallpaper(&conn, id).unwrap();

        let suffixed = origin.parent().unwrap().join("wall (2).jpg");
        assert_eq!(PathBuf::from(&landed), suffixed);
        // The returned path is the one the file is actually at, and the file
        // that was already there kept its name and its bytes.
        assert_eq!(std::fs::read(&suffixed).unwrap(), b"REJECTED");
        assert_eq!(std::fs::read(&origin).unwrap(), b"SQUATTER");
        assert_eq!(
            row_status_and_path(&conn, id),
            ("active".into(), suffixed.to_str().unwrap().to_string())
        );
        assert_eq!(filename_of(&conn, id), "wall (2).jpg");
    }

    #[test]
    fn restoring_a_wallpaper_whose_file_is_gone_says_so_and_leaves_it_rejected() {
        // Emptying the reject folder by hand is the point of having one, so this
        // is ordinary rather than exceptional, and it reads as its own kind
        // instead of as whatever `rename` would have said.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "vanished.jpg");
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        let before = row_status_and_path(&conn, id);
        std::fs::remove_file(&rejected_at).unwrap();

        let err = restore_wallpaper(&conn, id).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::FileMissing(ref m) if m == &rejected_at),
            "got {err:?}"
        );
        assert_eq!(row_status_and_path(&conn, id), before);
        assert_eq!(
            origin_path_of(&conn, id),
            Some(origin.to_str().unwrap().to_string())
        );
        // Nothing was created at the Origin on the way to refusing.
        assert!(!origin.exists());
    }

    #[test]
    fn restoring_a_row_with_no_origin_is_refused_and_changes_nothing() {
        // The cohort rejected before the Origin column existed. There is nothing
        // to backfill it from, so Rejected stays terminal for exactly these
        // rows, and they refuse with a reason rather than guessing a folder.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/rejected/legacy.jpg", "rejected", 9.0);
        let before = row_status_and_path(&conn, id);

        let err = restore_wallpaper(&conn, id).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::InvalidTransition(ref m)
                if m.contains(&id.to_string())),
            "got {err:?}"
        );
        assert_eq!(row_status_and_path(&conn, id), before);
        assert_eq!(origin_path_of(&conn, id), None);
    }

    #[test]
    fn restoring_a_wallpaper_that_is_not_rejected_is_refused_and_changes_nothing() {
        // Not a no-op success: there is no file to move and no Origin to read,
        // so succeeding quietly would hide a stale id or a control the UI left
        // enabled.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let active = seed_real_wallpaper(&conn, tmp.path(), "active.jpg");
        let kept = seed_real_wallpaper(&conn, tmp.path(), "kept.jpg");
        keep_wallpaper(&conn, kept).unwrap();

        for (id, status) in [(active, "active"), (kept, "kept")] {
            let before = row_status_and_path(&conn, id);
            let err = restore_wallpaper(&conn, id).unwrap_err();
            assert!(
                matches!(err, crate::error::AppError::InvalidTransition(_)),
                "a {status} wallpaper gave {err:?}"
            );
            assert_eq!(row_status_and_path(&conn, id), before);
            assert_eq!(status_of(&conn, id), status);
        }

        assert!(tmp.path().join("active.jpg").is_file());
        assert!(tmp.path().join("kept.jpg").is_file());
    }

    #[test]
    fn restoring_an_unknown_id_returns_not_found() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let err = restore_wallpaper(&conn, 4321).unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::NotFound(_)),
            "{err:?}"
        );
    }

    #[test]
    fn a_restored_file_is_where_a_rescan_expects_to_find_it() {
        // The path a Restore writes has to be the string a scan of the library
        // produces, or `UNIQUE(path)` misses and the restored file comes back a
        // second time as its own Active row. The reject's own destination is
        // canonicalized for this reason (ADR 0003); the Origin needs no second
        // pass, because it is the string the row already held.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "rescanned.jpg");
        move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();
        restore_wallpaper(&conn, id).unwrap();

        let found = crate::scanner::collect_images(std::slice::from_ref(&library));
        assert_eq!(found.len(), 1);
        assert_eq!(insert_new_wallpapers(&conn, &found).unwrap(), 0);
        assert_eq!(count_wallpapers(&conn), 1);
    }
}
