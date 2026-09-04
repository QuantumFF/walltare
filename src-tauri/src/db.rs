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
/// row Rejected, records the Origin, and answers with the row it wrote.
///
/// The row rather than the path, so the caller predicts nothing: a collision
/// suffixes the basename, so `wall.jpg` can land as `wall (2).jpg`, and the
/// `path`, the `filename` and the `origin_path` this reports are the three
/// columns the move rewrote (ADR 0023). It is read after the commit, through the
/// same [`get_wallpaper`] the guard above used, for the reason
/// [`WALLPAPER_COLUMNS`] is one copy.
///
/// The database write happens first, inside a transaction, and the file move
/// last. That ordering matters: a `UNIQUE(path)` collision or any other DB
/// error then aborts before anything on disk has changed, instead of leaving a
/// moved file behind a row that still points at the old location.
pub fn move_wallpaper(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError> {
    let tx = conn.unchecked_transaction()?;
    let row = get_wallpaper(&tx, wallpaper_id)?;

    if !row.status.may_become(Status::Rejected) {
        // Re-rejecting would move the file again, nesting the destination folder
        // inside itself (`rejected/rejected/x.jpg`).
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} is already rejected"
        )));
    }

    let source = PathBuf::from(&row.path);
    let dest_dir = resolve_destination_dir(&source, destination_folder)?;
    if dest_dir.join(&row.filename) == source {
        return Err(AppError::InvalidPath(format!(
            "destination {destination_folder:?} is the folder wallpaper {wallpaper_id} already lives in"
        )));
    }
    let dest_path = unique_destination(&dest_dir, &row.filename)?;

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
         SET status = ?1, path = ?2, filename = ?3, origin_path = path
         WHERE id = ?4",
        rusqlite::params![Status::Rejected, dest_str, dest_name, wallpaper_id],
    )?;

    // Anything below that fails drops `tx` unread, rolling the row back.
    move_file(&source, &dest_path)?;
    tx.commit()?;
    get_wallpaper(conn, wallpaper_id)
}

/// Restores a soft-rejected wallpaper: moves its file back to the Origin the
/// reject recorded, lands the row on Active with the Origin cleared, and answers
/// with the row it wrote.
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
pub fn restore_wallpaper(conn: &Connection, wallpaper_id: i64) -> Result<Wallpaper, AppError> {
    let tx = conn.unchecked_transaction()?;
    let row = get_wallpaper(&tx, wallpaper_id)?;

    // The mirror of `unkeep_wallpaper`'s guard, and for the same reason: Kept to
    // Active and Active to Active are legal pairs too, and they are the
    // un-keep's, so `may_become(Active)` is true of a wallpaper a Restore has
    // nothing to put back (see [`Status::may_become`]).
    if row.status != Status::Rejected {
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} is {}, so there is no reject to undo",
            row.status.as_str()
        )));
    }
    let Some(origin) = row.origin_path else {
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {wallpaper_id} was rejected before its Origin was recorded, so there is nowhere to put it back"
        )));
    };

    let source = PathBuf::from(&row.path);
    if !source.is_file() {
        // Not what makes this safe — the write ordering below does that. It is
        // here so a curator who emptied the reject folder by hand reads a
        // sentence about the reject folder instead of whatever `rename` says.
        return Err(AppError::FileMissing(row.path));
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
         SET status = ?1, path = ?2, filename = ?3, origin_path = NULL
         WHERE id = ?4",
        rusqlite::params![Status::Active, dest_str, dest_name, wallpaper_id],
    )?;

    // Anything below that fails drops `tx` unread, rolling the row back.
    move_file(&source, &dest_path)?;
    tx.commit()?;
    get_wallpaper(conn, wallpaper_id)
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

/// A wallpaper's Status, the three of `CONTEXT.md`: Active, Kept, Rejected.
///
/// It lives here because [`wallpaper_from_row`] is the only place in the crate
/// that reads the `status` column into the row shape, and the `CHECK` constraint
/// fixing the three legal spellings is at the top of [`DDL`]. [`StatusFilter`]
/// is the same vocabulary and sits below (ADR 0024).
///
/// The wire stays `"active" | "kept" | "rejected"`, which is what
/// `rename_all` is doing and what one test asserts directly: the frontend suite
/// drives the real components against a mocked IPC seam whose fixtures are
/// TypeScript, so an edit to this attribute would change the wire and break
/// nothing that runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Kept,
    Rejected,
}

impl Status {
    /// Eligible as a `WHERE` fragment: the voting pool, which is Active or Kept
    /// (`CONTEXT.md`).
    ///
    /// One of Eligible's two forms, because the code asks the question in two
    /// places that cannot share one answer. The four aggregate queries in
    /// `voting.rs` take this; `fetch_summary` asks [`Self::is_eligible`] of a row
    /// it already holds. A test seeds all three Statuses and asserts the two
    /// agree (ADR 0024).
    pub const ELIGIBLE_SQL: &'static str = "status IN ('active', 'kept')";

    /// Reads the `status` column.
    ///
    /// The schema's `CHECK` constraint allows only these three spellings, so
    /// anything else is a database this app never wrote. Such a row reads as
    /// Active, which is the leniency this has always had.
    pub fn read(column: &str) -> Self {
        match column {
            "rejected" => Self::Rejected,
            "kept" => Self::Kept,
            _ => Self::Active,
        }
    }

    /// The spelling the column holds, for the `WHERE` fragments
    /// [`StatusFilter::where_clause`] builds and for the sentence a refusal
    /// prints.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Kept => "kept",
            Self::Rejected => "rejected",
        }
    }

    /// Whether a wallpaper of this Status is in the pool voting draws from.
    ///
    /// [`Self::ELIGIBLE_SQL`]'s in-memory half. Not a fourth variant: `CONTEXT.md`
    /// is explicit that the three are mutually exclusive and that Eligible
    /// describes two of them, so a fourth arm would make a `match` on a Status
    /// ambiguous about whether a row is Active or Kept.
    pub fn is_eligible(self) -> bool {
        matches!(self, Self::Active | Self::Kept)
    }

    /// ADR 0009's transition table, as one object.
    ///
    /// An exhaustive `match` on the pair, so a fourth Status breaks the build in
    /// both positions — which is the property typing the column paid for, and
    /// this is the first thing to spend it on. One test walks all nine pairs
    /// against ADR 0009's seven rows (ADR 0025).
    ///
    /// The identity pairs are legal because a double click on a button is not an
    /// error: re-keeping a Kept wallpaper and un-keeping an Active one are both
    /// no-op successes, which is also why [`keep_wallpaper`] is not a toggle.
    ///
    /// **It answers for the table and not for a command**, which is what limits
    /// it to two of the four guards. Kept and Rejected each have one door into
    /// them, so [`keep_wallpaper`] and [`move_wallpaper`] read their whole guard
    /// off `may_become(Kept)` and `may_become(Rejected)`. Active has two —
    /// Rejected to Active is a Restore, Kept or Active to Active is an un-keep —
    /// and a pair says nothing about which command owns it, so
    /// [`unkeep_wallpaper`] and [`restore_wallpaper`] test the one Status that
    /// tells those two doors apart. Asking `may_become(Active)` there would
    /// un-keep a Rejected wallpaper without moving its file.
    pub fn may_become(self, to: Status) -> bool {
        match (self, to) {
            (Self::Active, Self::Active) => true,
            (Self::Active, Self::Kept) => true,
            (Self::Active, Self::Rejected) => true,
            (Self::Kept, Self::Active) => true,
            (Self::Kept, Self::Kept) => true,
            (Self::Kept, Self::Rejected) => true,
            (Self::Rejected, Self::Active) => true,
            (Self::Rejected, Self::Kept) => false,
            (Self::Rejected, Self::Rejected) => false,
        }
    }
}

/// Makes `row.get(3)?` in [`wallpaper_from_row`] answer with a `Status`, with no
/// change at the call site.
impl rusqlite::types::FromSql for Status {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        value.as_str().map(Status::read)
    }
}

/// Makes `params![Status::Rejected]` work for the `SET status = ?` writes in the
/// four transitions, so no transition spells a Status as a literal.
impl rusqlite::ToSql for Status {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(self.as_str().into())
    }
}

/// The one wallpaper row shape the backend hands out, listings and voting pairs
/// alike, mirrored by the single `Wallpaper` interface in `client.ts`.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Wallpaper {
    pub id: i64,
    pub filename: String,
    pub path: String,
    pub status: Status,
    pub rating_mu: f64,
    pub rating_sigma: f64,
    pub comparisons_count: i64,
    /// Where the file sat before its current soft reject, so a Restore can put
    /// it back. `None` for anything not currently rejected, and for a wallpaper
    /// rejected before the column existed — which is the cohort Rejected stays
    /// terminal for.
    pub origin_path: Option<String>,
}

/// The columns every query returning a [`Wallpaper`] selects, in the order
/// [`wallpaper_from_row`] reads them. One copy, because a query that selects its
/// own list and a mapper that indexes by position drift apart silently.
const WALLPAPER_COLUMNS: &str =
    "id, filename, path, status, rating_mu, rating_sigma, comparisons_count, origin_path";

fn wallpaper_from_row(row: &rusqlite::Row) -> Result<Wallpaper, rusqlite::Error> {
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
}

/// One wallpaper by id, and [`AppError::NotFound`] when there is no such row.
///
/// The one read six sites share: the four transitions' guards, the row each of
/// them answers with after its commit, and `get_pair`. `voting::fetch_summary`
/// joins them, which is what leaves one `QueryReturnedNoRows` closure in the
/// crate where there were five (ADR 0025).
///
/// It maps the missing row itself because no caller has anything better to say
/// about a missing id: `NotFound` already meant that at five of the six sites,
/// `error_response` maps it to 404, and ADR 0001's distinction survives —
/// `NotFound` for a row that is absent, `InvalidTransition` for one that is
/// present and refusing.
///
/// `get_wallpaper(&tx, id)` works unchanged inside the two transactional
/// commands, because `Transaction` derefs to `Connection`.
pub fn get_wallpaper(conn: &Connection, id: i64) -> Result<Wallpaper, AppError> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {WALLPAPER_COLUMNS} FROM wallpapers WHERE id = ?1"
    ))?;
    stmt.query_row(rusqlite::params![id], wallpaper_from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no wallpaper with id {id}"))
            }
            other => other.into(),
        })
}

/// Which Statuses a listing returns.
///
/// Eligible is deliberately absent. It is a voting-pool term, and on a browsing
/// surface it would read as "everything I haven't thrown out", which is what
/// [`Self::All`] already shows with the rejects greyed (ADR 0016).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusFilter {
    /// Every row, Rejected included: the library page's promise is everything
    /// the app knows about.
    #[default]
    All,
    Active,
    Kept,
    Rejected,
}

impl StatusFilter {
    /// The one `WHERE` fragment this variant stands for.
    ///
    /// Built from [`Status::as_str`] rather than spelling the three values a
    /// fifth time (ADR 0024). Still no caller-supplied string in the SQL: a
    /// variant is the only thing that can reach here, and the deserialization
    /// boundary is what keeps an unknown name out.
    fn where_clause(self) -> String {
        let status = match self {
            Self::All => return String::new(),
            Self::Active => Status::Active,
            Self::Kept => Status::Kept,
            Self::Rejected => Status::Rejected,
        };
        format!("WHERE status = '{}'", status.as_str())
    }
}

/// How a listing is ordered. The caller picks a name; every part of the clause
/// belongs to the backend (ADR 0014).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListOrdering {
    /// The one view neither Rank nor Review gives, and what the app exists to
    /// produce.
    #[default]
    ScoreDesc,
    ScoreAsc,
    FilenameAsc,
    RecentlyAdded,
}

impl ListOrdering {
    /// The one `ORDER BY` clause this variant stands for.
    ///
    /// Three terms here are load-bearing:
    ///
    /// - `comparisons_count = 0` leads both Score clauses. It is 0 for a rated
    ///   wallpaper and 1 for an Unrated one and does not flip with the
    ///   direction, so Unrated is a constant tail in both directions rather
    ///   than a block of cards placed in the middle by the starting Score,
    ///   which is the app's ignorance and not a judgement.
    /// - Every clause ends in `id`. Most of a young library sits in a handful
    ///   of exact μ ties, and without the tiebreak SQLite may return tied rows
    ///   in any order, so the grid reshuffles under the user after a vote.
    /// - `recently_added` is `id DESC`, not `created_at`.
    ///   `insert_new_wallpapers` batches a whole scan into one transaction, so
    ///   every row it adds carries the same `created_at`. Insertion order
    ///   survives only in `id`, nothing deletes a `wallpapers` row, and
    ///   `created_at` stays off the DTO.
    ///
    /// `NOCASE` because SQLite's default BINARY collation puts every capital
    /// ahead of every lowercase letter, so `Zebra.jpg` would precede
    /// `abstract.jpg`. The key is the filename rather than the path, since that
    /// is what the card shows.
    fn order_by(self) -> &'static str {
        match self {
            Self::ScoreDesc => "comparisons_count = 0, rating_mu DESC, id ASC",
            Self::ScoreAsc => "comparisons_count = 0, rating_mu ASC, id ASC",
            Self::FilenameAsc => "filename COLLATE NOCASE ASC, id ASC",
            Self::RecentlyAdded => "id DESC",
        }
    }
}

/// Every wallpaper matching `filter`, in `ordering`, at most `limit` of them.
///
/// `limit` is a count and nothing else: no offset, no cursor and no page token,
/// so none of the pagination questions ADR 0016 deleted come back (ADR 0028). It
/// has two callers, the library page's `None` and Review's `Some(50)`. `Some(n)`
/// with `n <= 0` returns an empty list. At the 5,000-row ceiling an unlimited
/// list is about 1MB of JSON and one scan, which is what makes fetching
/// everything cheaper than a pagination design.
///
/// Both Score orderings sort in memory, because a leading `comparisons_count =
/// 0` cannot be served by the index on `(status, rating_mu)`; ADR 0028 names the
/// expression index that would cover it, and why it is not added.
pub fn list_wallpapers(
    conn: &Connection,
    filter: StatusFilter,
    ordering: ListOrdering,
    limit: Option<i64>,
) -> Result<Vec<Wallpaper>, rusqlite::Error> {
    // A limit that asks for nothing gets nothing. Guarded rather than passed
    // through, because SQLite reads a negative limit as unlimited and a caller
    // asking for -5 rows means the same thing as one asking for 0.
    if limit.is_some_and(|n| n <= 0) {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {WALLPAPER_COLUMNS}
         FROM wallpapers
         {}
         ORDER BY {}
         LIMIT ?1",
        filter.where_clause(),
        ordering.order_by(),
    ))?;
    // -1 because SQLite reads a negative limit as unlimited, so `None` and
    // `Some(n)` share one SQL string, one `prepare_cached` entry and one path.
    let rows = stmt.query_map(rusqlite::params![limit.unwrap_or(-1)], wallpaper_from_row)?;
    rows.collect()
}

/// Transitions a wallpaper to Kept and answers with the row it wrote.
/// Re-keeping a Kept one is a no-op success.
///
/// Keeping a Rejected wallpaper is refused: per CONTEXT.md a reject is a
/// transition, not a flag, so this would silently un-reject a file that no
/// longer sits where the row says it does.
///
/// Nothing on disk moves, so the row it answers with differs from the one it
/// read in the `status` column alone. It answers with the row anyway, because a
/// transition that reports what it wrote leaves the caller nothing to predict
/// (ADR 0023).
pub fn keep_wallpaper(conn: &Connection, id: i64) -> Result<Wallpaper, AppError> {
    let row = get_wallpaper(conn, id)?;

    if !row.status.may_become(Status::Kept) {
        return Err(AppError::InvalidTransition(format!(
            "cannot keep rejected wallpaper with id {id}"
        )));
    }

    conn.execute(
        "UPDATE wallpapers SET status = ?1 WHERE id = ?2",
        rusqlite::params![Status::Kept, id],
    )?;
    get_wallpaper(conn, id)
}

/// Transitions a wallpaper to Active, undoing a Keep, and answers with the row
/// it wrote. Un-keeping an Active one is a no-op success, for the same reason
/// re-keeping a Kept one is: a double click on a button is not an error.
///
/// [`keep_wallpaper`] stays a one-way transition rather than becoming a toggle,
/// which is what makes that idempotence worth having: a toggle would turn the
/// same double click into a keep followed by an un-keep (ADR 0009).
///
/// Un-keeping a Rejected wallpaper is refused. Its file sits in the reject
/// folder, and moving it back is what a Restore does; succeeding here would
/// leave an Active row pointing inside the reject folder, still carrying the
/// Origin the Restore was going to spend.
pub fn unkeep_wallpaper(conn: &Connection, id: i64) -> Result<Wallpaper, AppError> {
    let row = get_wallpaper(conn, id)?;

    // Not `may_become(Active)`: Rejected to Active is a legal pair, and it is
    // `restore_wallpaper`'s. Which door into Active applies is decided by the
    // one Status the table cannot discriminate on, so this is where the un-keep
    // says so (see [`Status::may_become`]).
    if row.status == Status::Rejected {
        return Err(AppError::InvalidTransition(format!(
            "wallpaper {id} is rejected, so a Restore is what brings it back"
        )));
    }

    conn.execute(
        "UPDATE wallpapers SET status = ?1 WHERE id = ?2",
        rusqlite::params![Status::Active, id],
    )?;
    get_wallpaper(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;

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

    #[test]
    fn get_wallpaper_reads_one_row_and_answers_a_missing_id_with_not_found() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        // The same reader the listings use, so a column added to one of them
        // reaches every caller including the voting pair.
        let w = get_wallpaper(&conn, id).unwrap();
        assert_eq!(w.id, id);
        assert_eq!(w.filename, "a.jpg");
        assert_eq!(w.path, "/w/a.jpg");
        assert_eq!(w.status, Status::Active);
        assert_eq!(w.comparisons_count, 0);
        assert_eq!(w.origin_path, None);

        // The one answer for a missing row, mapped here rather than by six
        // callers, and the reason none of them carries a
        // `QueryReturnedNoRows` closure any more (ADR 0025).
        let err = get_wallpaper(&conn, 999).unwrap_err();
        assert!(
            matches!(err, AppError::NotFound(ref m) if m.contains("999")),
            "{err:?}"
        );
    }

    #[test]
    fn a_status_crosses_the_ipc_as_the_three_strings_the_column_holds() {
        // The `rename_all` attribute is the only thing keeping four IPC
        // payloads stable, and this is the only thing watching it. The frontend
        // suite cannot stand in for it: it drives the real components against a
        // mocked IPC seam whose fixtures are written in TypeScript, so an edit
        // here would change the wire and break nothing that runs (ADR 0024).
        for (status, wire) in [
            (Status::Active, "active"),
            (Status::Kept, "kept"),
            (Status::Rejected, "rejected"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), wire);
            // And the column spelling is the same string, so a row read back
            // and a row serialized out agree.
            assert_eq!(status.as_str(), wire);
        }

        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, "/w/a.jpg", "kept", 25.0);
        let json = serde_json::to_value(get_wallpaper(&conn, id).unwrap()).unwrap();
        assert_eq!(json["status"], "kept");
    }

    #[test]
    fn eligible_selects_exactly_the_rows_the_predicate_returns_true_for() {
        // `CONTEXT.md`'s Eligible entry, made checkable. The two forms exist
        // because the code asks the question in SQL four times and in memory
        // once, and this is what holds them together (ADR 0024).
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let active = seed_wallpaper(&conn, "/w/active.jpg", "active", 25.0);
        let kept = seed_wallpaper(&conn, "/w/kept.jpg", "kept", 25.0);
        let rejected = seed_wallpaper(&conn, "/w/rejected.jpg", "rejected", 25.0);

        let mut stmt = conn
            .prepare(&format!(
                "SELECT id FROM wallpapers WHERE {} ORDER BY id",
                Status::ELIGIBLE_SQL
            ))
            .unwrap();
        let selected: Vec<i64> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        let by_predicate: Vec<i64> = [
            (active, Status::Active),
            (kept, Status::Kept),
            (rejected, Status::Rejected),
        ]
        .into_iter()
        .filter(|(_, status)| status.is_eligible())
        .map(|(id, _)| id)
        .collect();

        assert_eq!(selected, by_predicate);
        assert_eq!(selected, vec![active, kept]);
    }

    #[test]
    fn may_become_answers_adr_0009s_table_and_nothing_else() {
        // All nine pairs against the seven rows ADR 0009 lists, so the table
        // stops being prose that four functions each implement a slice of. The
        // two false pairs are Rejected as a one-way door: only a Restore leads
        // back out, and it leads to Active.
        let legal = [
            (Status::Active, Status::Kept),
            (Status::Kept, Status::Kept),
            (Status::Active, Status::Rejected),
            (Status::Kept, Status::Rejected),
            (Status::Rejected, Status::Active),
            (Status::Kept, Status::Active),
            (Status::Active, Status::Active),
        ];

        for from in [Status::Active, Status::Kept, Status::Rejected] {
            for to in [Status::Active, Status::Kept, Status::Rejected] {
                let expected = legal.contains(&(from, to));
                assert_eq!(
                    from.may_become(to),
                    expected,
                    "{} may become {}",
                    from.as_str(),
                    to.as_str()
                );
            }
        }
    }

    /// A wallpaper with Comparisons behind its Score. `comparisons_count` is
    /// what separates a rated row from an Unrated one, and it leads both Score
    /// orderings, so a listing test that never sets it tests half the clause.
    fn seed_rated_wallpaper(
        conn: &Connection,
        path: &str,
        status: &str,
        mu: f64,
        comparisons: i64,
    ) -> i64 {
        let id = seed_wallpaper(conn, path, status, mu);
        conn.execute(
            "UPDATE wallpapers SET comparisons_count = ?2 WHERE id = ?1",
            rusqlite::params![id, comparisons],
        )
        .unwrap();
        id
    }

    fn list_ids(conn: &Connection, filter: StatusFilter, ordering: ListOrdering) -> Vec<i64> {
        limited_ids(conn, filter, ordering, None)
    }

    fn limited_ids(
        conn: &Connection,
        filter: StatusFilter,
        ordering: ListOrdering,
        limit: Option<i64>,
    ) -> Vec<i64> {
        list_wallpapers(conn, filter, ordering, limit)
            .unwrap()
            .iter()
            .map(|w| w.id)
            .collect()
    }

    /// A library seeded so that `id` order agrees with no ordering under test,
    /// with one Unrated row at exactly the starting Score. 25.0 sorts between
    /// the two rated groups, so a clause without the tail term wedges it into
    /// the middle.
    fn seed_scored_library(conn: &Connection) -> (i64, i64, i64, i64) {
        let mid = seed_rated_wallpaper(conn, "/w/mid.jpg", "active", 20.0, 3);
        let unrated = seed_wallpaper(conn, "/w/unrated.jpg", "active", 25.0);
        let top = seed_rated_wallpaper(conn, "/w/top.jpg", "active", 30.0, 5);
        let low = seed_rated_wallpaper(conn, "/w/low.jpg", "active", 10.0, 2);
        (top, mid, low, unrated)
    }

    #[test]
    fn list_wallpapers_score_desc_ranks_high_to_low_with_the_unrated_tail() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (top, mid, low, unrated) = seed_scored_library(&conn);

        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::ScoreDesc),
            vec![top, mid, low, unrated]
        );
    }

    #[test]
    fn list_wallpapers_score_asc_ranks_low_to_high_with_the_same_unrated_tail() {
        // The tail does not flip with the direction. Mirroring it would say the
        // unjudged wallpapers are the worst ones, which is the inversion ADR
        // 0013 rejected; leaving it at 25.0 would place it above `low` here and
        // below `top` in the other direction, on the strength of a starting
        // value.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (top, mid, low, unrated) = seed_scored_library(&conn);

        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::ScoreAsc),
            vec![low, mid, top, unrated]
        );
    }

    #[test]
    fn list_wallpapers_breaks_a_score_tie_by_id_and_holds_still_across_calls() {
        // Most of a young library sits in a handful of exact μ ties, so this is
        // the ordinary case rather than an edge one. Without the tiebreak
        // SQLite may return tied rows in any order, and the grid reshuffles
        // under the user after every vote.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let top = seed_rated_wallpaper(&conn, "/w/top.jpg", "active", 30.0, 4);
        let tied_c = seed_rated_wallpaper(&conn, "/w/c.jpg", "active", 20.7948, 1);
        let tied_a = seed_rated_wallpaper(&conn, "/w/a.jpg", "active", 20.7948, 1);
        let tied_b = seed_rated_wallpaper(&conn, "/w/b.jpg", "active", 20.7948, 1);

        let expected = vec![top, tied_c, tied_a, tied_b];
        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::ScoreDesc),
            expected
        );
        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::ScoreDesc),
            expected
        );
    }

    #[test]
    fn list_wallpapers_filename_asc_collates_case_insensitively() {
        // SQLite's default BINARY collation puts every capital ahead of every
        // lowercase letter, so without NOCASE `Zebra.jpg` leads.
        //
        // `abstract.jpg` is the Unrated one, which is also what says the Score
        // tail term is not in this clause.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let zebra = seed_rated_wallpaper(&conn, "/w/Zebra.jpg", "active", 30.0, 4);
        let abstract_jpg = seed_wallpaper(&conn, "/w/abstract.jpg", "active", 25.0);
        let mid = seed_rated_wallpaper(&conn, "/w/mid.jpg", "active", 20.0, 2);

        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::FilenameAsc),
            vec![abstract_jpg, mid, zebra]
        );
    }

    #[test]
    fn list_wallpapers_recently_added_orders_by_descending_id() {
        // Every row carries one `created_at` here, which is what a real scan
        // produces: `insert_new_wallpapers` batches the whole walk into one
        // transaction. Insertion order survives only in `id`.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let first = seed_rated_wallpaper(&conn, "/w/first.jpg", "active", 10.0, 2);
        let second = seed_wallpaper(&conn, "/w/second.jpg", "active", 25.0);
        let third = seed_rated_wallpaper(&conn, "/w/third.jpg", "active", 30.0, 5);
        conn.execute_batch("UPDATE wallpapers SET created_at = 1787496604")
            .unwrap();

        assert_eq!(
            list_ids(&conn, StatusFilter::All, ListOrdering::RecentlyAdded),
            vec![third, second, first]
        );
    }

    #[test]
    fn list_wallpapers_filters_to_exactly_the_status_named() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let active = seed_rated_wallpaper(&conn, "/w/active.jpg", "active", 20.0, 2);
        let kept = seed_rated_wallpaper(&conn, "/w/kept.jpg", "kept", 30.0, 3);
        let rejected = seed_rated_wallpaper(&conn, "/w/rejected.jpg", "rejected", 10.0, 4);

        let by = |filter| list_ids(&conn, filter, ListOrdering::ScoreDesc);
        // All means everything the app knows about, rejects included: a default
        // that hid them would turn "where did that one go" into a hunt.
        assert_eq!(by(StatusFilter::All), vec![kept, active, rejected]);
        assert_eq!(by(StatusFilter::Active), vec![active]);
        assert_eq!(by(StatusFilter::Kept), vec![kept]);
        assert_eq!(by(StatusFilter::Rejected), vec![rejected]);
    }

    #[test]
    fn the_review_listing_is_active_lowest_score_first_with_the_unrated_tail() {
        // What Review asks for, spelled the way `ReviewView` spells it. The
        // Unrated row sits at the end rather than between `mid` and `top` where
        // its starting Score would put it: Unrated belongs to Rank, and a card
        // whose position claims "one of the worst" while its badge admits no
        // measurement is the contradiction ADR 0028 removed.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (top, mid, low, unrated) = seed_scored_library(&conn);
        seed_rated_wallpaper(&conn, "/w/kept.jpg", "kept", 5.0, 2);
        seed_rated_wallpaper(&conn, "/w/rej.jpg", "rejected", 1.0, 2);

        let review = list_wallpapers(
            &conn,
            StatusFilter::Active,
            ListOrdering::ScoreAsc,
            Some(50),
        )
        .unwrap();

        let ids: Vec<i64> = review.iter().map(|w| w.id).collect();
        assert_eq!(ids, vec![low, mid, top, unrated]);
        assert_eq!(review[0].status, Status::Active);
        assert_eq!(review[0].rating_mu, 10.0);
    }

    #[test]
    fn list_wallpapers_returns_at_most_the_limit_and_everything_without_one() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (top, mid, low, unrated) = seed_scored_library(&conn);

        let asc = |limit| limited_ids(&conn, StatusFilter::Active, ListOrdering::ScoreAsc, limit);
        assert_eq!(asc(Some(2)), vec![low, mid]);
        assert_eq!(asc(Some(10)), vec![low, mid, top, unrated]);
        // No limit is unlimited rather than a default count.
        assert_eq!(asc(None), vec![low, mid, top, unrated]);
    }

    #[test]
    fn list_wallpapers_limit_of_at_most_zero_returns_empty() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        seed_wallpaper(&conn, "/w/a.jpg", "active", 25.0);

        let asc = |limit| list_wallpapers(&conn, StatusFilter::All, ListOrdering::ScoreAsc, limit);
        assert_eq!(asc(Some(0)).unwrap(), Vec::new());
        assert_eq!(asc(Some(-5)).unwrap(), Vec::new());
    }

    #[test]
    fn list_wallpapers_empty_library_returns_empty_list() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        assert_eq!(
            list_wallpapers(
                &conn,
                StatusFilter::Active,
                ListOrdering::ScoreAsc,
                Some(50)
            )
            .unwrap(),
            Vec::new()
        );
    }

    #[test]
    fn a_limit_cutting_a_score_tie_takes_the_same_rows_across_calls() {
        // The property the tiebreak exists for on a limited listing. Review's
        // fifty is larger than a young library's supply of rated rows, so the
        // boundary lands inside a tie group, and there the tiebreak decides
        // membership rather than order: without it SQLite may return tied rows
        // in any order and a plan change can swap which of them Review shows at
        // all (ADR 0028).
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let worst = seed_rated_wallpaper(&conn, "/w/worst.jpg", "active", 10.0, 3);
        let tied_c = seed_rated_wallpaper(&conn, "/w/c.jpg", "active", 29.2052, 1);
        let tied_a = seed_rated_wallpaper(&conn, "/w/a.jpg", "active", 29.2052, 1);
        let tied_b = seed_rated_wallpaper(&conn, "/w/b.jpg", "active", 29.2052, 1);

        let take_three =
            || limited_ids(&conn, StatusFilter::Active, ListOrdering::ScoreAsc, Some(3));

        // Three of the four rows, so the boundary sits between `tied_a` and
        // `tied_b`: lowest `id` first inside the tie group.
        assert_eq!(take_three(), vec![worst, tied_c, tied_a]);
        assert_eq!(take_three(), vec![worst, tied_c, tied_a]);
        assert!(!take_three().contains(&tied_b));
    }

    #[test]
    fn list_wallpapers_carries_a_rejected_rows_origin() {
        // So the page can say where the file came from without a second call,
        // and can tell a restorable reject from one that predates the column.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "dawn.jpg");
        let origin = library.join("dawn.jpg").to_str().unwrap().to_string();

        let answered = move_wallpaper(&conn, id, dest.path().to_str().unwrap()).unwrap();

        let rejected =
            list_wallpapers(&conn, StatusFilter::Rejected, ListOrdering::default(), None)
                .unwrap()
                .pop()
                .expect("the rejected wallpaper is the one row this filter returns");
        assert_eq!(rejected.id, id);
        assert_eq!(rejected.status, Status::Rejected);
        assert_eq!(rejected.origin_path, Some(origin));
        // And `path` follows the file, so the two are different answers.
        assert_ne!(rejected.path, rejected.origin_path.clone().unwrap());
        // The reject answered with this row and not with a path, so the listing
        // and the transition are one account of the wallpaper rather than two
        // (ADR 0023).
        assert_eq!(answered, rejected);
    }

    #[test]
    fn the_listing_defaults_are_all_and_score_desc() {
        // What a caller omitting both arguments gets.
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (top, mid, low, unrated) = seed_scored_library(&conn);
        let rejected = seed_rated_wallpaper(&conn, "/w/rejected.jpg", "rejected", 15.0, 2);

        assert_eq!(StatusFilter::default(), StatusFilter::All);
        assert_eq!(ListOrdering::default(), ListOrdering::ScoreDesc);
        assert_eq!(
            list_ids(&conn, StatusFilter::default(), ListOrdering::default()),
            vec![top, mid, rejected, low, unrated]
        );
    }

    #[test]
    fn a_status_filter_arrives_as_one_of_its_four_names_and_nothing_else() {
        // The deserialization boundary is what keeps a caller-supplied string
        // out of the SQL: an unknown name never reaches `where_clause`.
        for (wire, expected) in [
            (r#""all""#, StatusFilter::All),
            (r#""active""#, StatusFilter::Active),
            (r#""kept""#, StatusFilter::Kept),
            (r#""rejected""#, StatusFilter::Rejected),
        ] {
            assert_eq!(
                serde_json::from_str::<StatusFilter>(wire).unwrap(),
                expected
            );
        }

        for wire in [
            r#""eligible""#,
            r#""Active""#,
            r#""""#,
            r#""active'; DROP TABLE wallpapers; --""#,
        ] {
            assert!(
                serde_json::from_str::<StatusFilter>(wire).is_err(),
                "{wire} deserialized"
            );
        }
    }

    #[test]
    fn an_ordering_arrives_as_one_of_its_four_names_and_nothing_else() {
        for (wire, expected) in [
            (r#""score_desc""#, ListOrdering::ScoreDesc),
            (r#""score_asc""#, ListOrdering::ScoreAsc),
            (r#""filename_asc""#, ListOrdering::FilenameAsc),
            (r#""recently_added""#, ListOrdering::RecentlyAdded),
        ] {
            assert_eq!(
                serde_json::from_str::<ListOrdering>(wire).unwrap(),
                expected
            );
        }

        for wire in [
            r#""scoreDesc""#,
            r#""rating_mu DESC""#,
            r#""created_at""#,
            r#""id ASC; DROP TABLE wallpapers""#,
        ] {
            assert!(
                serde_json::from_str::<ListOrdering>(wire).is_err(),
                "{wire} deserialized"
            );
        }
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
        assert_eq!(review_ids(&conn), vec![a]);
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
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;
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
        assert_eq!(
            PathBuf::from(restore_wallpaper(&conn, id).unwrap().path),
            origin
        );
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
        let landed_a = move_wallpaper(&conn, id_a, out).unwrap().path;
        let landed_b = move_wallpaper(&conn, id_b, out).unwrap().path;

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
        assert_eq!(review_ids(&conn), Vec::<i64>::new());
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
        let landed = move_wallpaper(&conn, id, dest_dir.to_str().unwrap())
            .unwrap()
            .path;

        assert_eq!(PathBuf::from(&landed), dest_dir.join("a.jpg"));
        assert!(dest_dir.join("a.jpg").is_file());
        assert!(!tmp.path().join("a.jpg").exists());
        let (status, path) = row_status_and_path(&conn, id);
        assert_eq!(status, "rejected");
        assert_eq!(PathBuf::from(&path), dest_dir.join("a.jpg"));

        assert!(review_ids(&conn).is_empty());
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

        let landed = move_wallpaper(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;

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

        let landed = move_wallpaper(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;

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
        assert_eq!(review_ids(&conn), Vec::<i64>::new());

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
        assert_eq!(review_ids(&conn), Vec::<i64>::new());
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

    #[test]
    fn a_restore_puts_the_file_back_where_the_reject_took_it_from() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "dawn.jpg");
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;
        assert!(PathBuf::from(&rejected_at).is_file());

        let landed = restore_wallpaper(&conn, id).unwrap().path;

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
        assert_eq!(review_ids(&conn), vec![id]);
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
        let landed = move_wallpaper(&conn, id, second.path().to_str().unwrap())
            .unwrap()
            .path;

        assert_eq!(landed, path_string(second.path().join("twice.jpg")));
        assert!(PathBuf::from(&landed).is_file());
        assert!(!origin.exists());
        // Recorded afresh from where the file actually was, which is the library
        // folder the Restore put it back in.
        assert_eq!(origin_path_of(&conn, id), Some(origin_string));
        assert_eq!(status_of(&conn, id), "rejected");

        // And the second reject reverses as readily as the first.
        assert_eq!(
            PathBuf::from(restore_wallpaper(&conn, id).unwrap().path),
            origin
        );
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

        let landed = restore_wallpaper(&conn, id).unwrap().path;

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

        let landed = restore_wallpaper(&conn, id).unwrap().path;

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
        let rejected_at = move_wallpaper(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;
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
