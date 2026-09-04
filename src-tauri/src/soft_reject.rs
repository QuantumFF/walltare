//! The Soft reject and the Restore: the two transitions that move a wallpaper's
//! file and rewrite the row to say where it went.
//!
//! **The row is written first, inside a transaction, and the file moves last.**
//! That ordering is why this module exists, and it is the one rule anything
//! added here has to obey. Every database error, `UNIQUE(path)` included, then
//! fires while the disk is still untouched, and dropping the transaction rolls
//! the row back; a failed move leaves the file and the row exactly where they
//! started, because rolling a row back is reliable and undoing a move is
//! another filesystem operation that can fail. ADR 0003 decided it outbound and
//! ADR 0009 mirrors it inbound, step for step.
//!
//! What that forbids is a line below the move. Anything that can fail belongs
//! above [`move_file`], where a failure is still free; a fallible line after it
//! — a second write, a log that touches disk, another `UPDATE` — is a failure
//! with the file already gone and the transaction already spent. The move and
//! the commit are the last two statements of both functions for that reason.
//!
//! Owning the ordering is what makes this a module rather than a bag of
//! filesystem helpers: the rule is a relationship between the `UPDATE` and the
//! move, so a seam with only one end of it inside would be a place the rule
//! crosses rather than a place it is kept (ADR 0030). Hence the interface is
//! [`reject`] and [`restore`], and the transaction, the guard, the `UPDATE` and
//! the choreography are all behind them.
//!
//! Rows come from [`db::get_wallpaper`] and go back through it after the commit.
//! `db.rs` still owns the row: its shape, its Status, its listings, and the two
//! transitions that only write a Status.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{self, Status, Wallpaper};
use crate::error::AppError;

/// How many ` (n)` variants to try before giving up on a colliding destination.
const MAX_COLLISION_SUFFIXES: u32 = 1000;

/// Soft-rejects a wallpaper: moves its file to `destination_folder`, marks the
/// row Rejected, records the Origin, and answers with the row it wrote.
///
/// The row rather than the path, so the caller predicts nothing: a collision
/// suffixes the basename, so `wall.jpg` can land as `wall (2).jpg`, and the
/// `path`, the `filename` and the `origin_path` this reports are the three
/// columns the move rewrote (ADR 0023). It is read after the commit, through the
/// same [`db::get_wallpaper`] the guard above used, for the reason
/// `WALLPAPER_COLUMNS` is one copy.
pub fn reject(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError> {
    let tx = conn.unchecked_transaction()?;
    let row = db::get_wallpaper(&tx, wallpaper_id)?;

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

    move_file(&source, &dest_path)?;
    tx.commit()?;
    db::get_wallpaper(conn, wallpaper_id)
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
pub fn restore(conn: &Connection, wallpaper_id: i64) -> Result<Wallpaper, AppError> {
    let tx = conn.unchecked_transaction()?;
    let row = db::get_wallpaper(&tx, wallpaper_id)?;

    // The mirror of `db::unkeep_wallpaper`'s guard, and for the same reason: Kept
    // to Active and Active to Active are legal pairs too, and they are the
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
        // Not what makes this safe — the write ordering does that. It is here so
        // a curator who emptied the reject folder by hand reads a sentence about
        // the reject folder instead of whatever `rename` says.
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

    move_file(&source, &dest_path)?;
    tx.commit()?;
    db::get_wallpaper(conn, wallpaper_id)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_schema, insert_new_wallpapers, keep_wallpaper};
    use crate::testing::*;

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

    fn rating_of(conn: &Connection, id: i64) -> (f64, i64) {
        conn.query_row(
            "SELECT rating_mu, comparisons_count FROM wallpapers WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    /// A reject stores canonical paths, so expectations built from a tempdir
    /// have to be canonicalized the same way to compare.
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
        let landed_a = reject(&conn, id_a, out).unwrap().path;
        let landed_b = reject(&conn, id_b, out).unwrap().path;

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

        reject(&conn, id, "./rejected").unwrap();

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

        let err = reject(&conn, id, destination).unwrap_err();

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
            let err = reject(&conn, id, destination).unwrap_err();
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
        reject(&conn, id, "rejected").unwrap();

        let err = reject(&conn, id, "rejected").unwrap_err();

        assert!(matches!(err, crate::error::AppError::InvalidTransition(_)));
        assert!(library.join("rejected").join("b.png").is_file());
        assert!(!library.join("rejected").join("rejected").exists());
        // The refusal left the first reject's Origin alone. A second one would
        // have overwritten it with the reject folder, which is the one place a
        // Restore must never send a file back to.
        assert_eq!(origin_path_of(&conn, id), Some(origin));
    }

    #[test]
    fn a_reject_moves_the_file_and_marks_the_row_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "a.jpg");

        let dest_dir = dest.path().join("out");
        let landed = reject(&conn, id, dest_dir.to_str().unwrap()).unwrap().path;

        assert_eq!(PathBuf::from(&landed), dest_dir.join("a.jpg"));
        assert!(dest_dir.join("a.jpg").is_file());
        assert!(!tmp.path().join("a.jpg").exists());
        let (status, path) = row_status_and_path(&conn, id);
        assert_eq!(status, "rejected");
        assert_eq!(PathBuf::from(&path), dest_dir.join("a.jpg"));

        assert!(review_ids(&conn).is_empty());
    }

    #[test]
    fn a_reject_takes_a_kept_wallpaper_the_same_way_it_takes_an_active_one() {
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

        let landed = reject(&conn, id, dest.path().to_str().unwrap())
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

        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

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

        let landed = reject(&conn, id, dest.path().to_str().unwrap())
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

        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

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

        reject(&conn, id, "rejects").unwrap();

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
        reject(&conn, id, nested.to_str().unwrap()).unwrap();

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

        reject(&conn, moved, dest.path().to_str().unwrap()).unwrap();

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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

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
        let err = reject(&conn, id, dest.path().to_str().unwrap()).unwrap_err();
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
    #[cfg(unix)]
    fn a_destination_the_process_cannot_write_to_leaves_the_row_untouched() {
        // The arm most likely to reach a real curator: a reject folder on a
        // read-only mount, or one owned by another user. Its neighbour above
        // fails the move by deleting the source, so it only exercises `rename`'s
        // missing-source arm; this one fails the move with the source right
        // where it belongs and the destination refusing the write.
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "locked-out.jpg");
        let before = row_status_and_path(&conn, id);

        let readonly = dest.path().join("readonly");
        std::fs::create_dir(&readonly).unwrap();
        std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = reject(&conn, id, readonly.to_str().unwrap());

        // Restored before the assertions rather than after, so a failing one
        // still leaves `tempfile` a directory it can clean up.
        std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o755)).unwrap();

        // Permission denied rather than any other `Io`: the destination exists
        // and canonicalizes, and `create_dir_all` is a no-op on a directory that
        // is already there, so the only step left to refuse is the move itself.
        let err = result.unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::Io(ref m) if m.contains("Permission denied")),
            "got {err:?}"
        );
        assert_eq!(row_status_and_path(&conn, id), before);
        // The rollback takes the Origin with it: a wallpaper that is not
        // Rejected must not read as one a Restore could move.
        assert_eq!(origin_path_of(&conn, id), None);
        // And the file never left, so the reject is one the curator can retry
        // once they have fixed the folder.
        assert!(tmp.path().join("locked-out.jpg").is_file());
        assert_eq!(std::fs::read_dir(&readonly).unwrap().count(), 0);
    }

    #[test]
    fn unknown_id_returns_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let err = reject(&conn, 1234, tmp.path().to_str().unwrap()).unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound(_)));
    }

    #[test]
    fn a_restore_puts_the_file_back_where_the_reject_took_it_from() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "dawn.jpg");
        let rejected_at = reject(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;
        assert!(PathBuf::from(&rejected_at).is_file());

        let landed = restore(&conn, id).unwrap().path;

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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

        restore(&conn, id).unwrap();

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

        reject(&conn, id, first.path().to_str().unwrap()).unwrap();
        assert_eq!(origin_path_of(&conn, id), Some(origin_string.clone()));
        restore(&conn, id).unwrap();
        let landed = reject(&conn, id, second.path().to_str().unwrap())
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
        assert_eq!(PathBuf::from(restore(&conn, id).unwrap().path), origin);
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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();

        restore(&conn, id).unwrap();

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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();
        let origin_dir = origin.parent().unwrap().to_path_buf();
        std::fs::remove_dir_all(&origin_dir).unwrap();
        assert!(!origin_dir.exists());

        let landed = restore(&conn, id).unwrap().path;

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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();
        std::fs::write(&origin, b"SQUATTER").unwrap();

        let landed = restore(&conn, id).unwrap().path;

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
        let rejected_at = reject(&conn, id, dest.path().to_str().unwrap())
            .unwrap()
            .path;
        let before = row_status_and_path(&conn, id);
        std::fs::remove_file(&rejected_at).unwrap();

        let err = restore(&conn, id).unwrap_err();

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

        let err = restore(&conn, id).unwrap_err();

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
            let err = restore(&conn, id).unwrap_err();
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

        let err = restore(&conn, 4321).unwrap_err();
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
        reject(&conn, id, dest.path().to_str().unwrap()).unwrap();
        restore(&conn, id).unwrap();

        let found = crate::scanner::collect_images(std::slice::from_ref(&library));
        assert_eq!(found.len(), 1);
        assert_eq!(insert_new_wallpapers(&conn, &found).unwrap(), 0);
        assert_eq!(count_wallpapers(&conn), 1);
    }
}
