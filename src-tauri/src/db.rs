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
    /// them, so [`keep_wallpaper`] and [`crate::soft_reject::reject`] read their
    /// whole guard off `may_become(Kept)` and `may_become(Rejected)`. Active has
    /// two — Rejected to Active is a Restore, Kept or Active to Active is an
    /// un-keep — and a pair says nothing about which command owns it, so
    /// [`unkeep_wallpaper`] and [`crate::soft_reject::restore`] test the one
    /// Status that
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
    // `soft_reject::restore`'s. Which door into Active applies is decided by the
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
        //
        // The one test here that reaches into `soft_reject`, and the dependency
        // ADR 0023 wants: only the reject can make a Rejected row with an
        // Origin, and this asserts that the row it answers with and the row the
        // listing returns are one account of the wallpaper.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let library = tmp.path().join("library");
        std::fs::create_dir_all(&library).unwrap();
        let id = seed_real_wallpaper(&conn, &library, "dawn.jpg");
        let origin = library.join("dawn.jpg").to_str().unwrap().to_string();

        let answered =
            crate::soft_reject::reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

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
        let rejected_at = crate::soft_reject::reject(&conn, id, dest.path().to_str().unwrap())
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
        // transition that moves the file with it.
        assert_eq!(
            PathBuf::from(crate::soft_reject::restore(&conn, id).unwrap().path),
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
}
