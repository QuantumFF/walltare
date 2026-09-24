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
//! The destination is *proven* above the `UPDATE` as well, by
//! [`reject_destination::prepare`]: a folder that will not take a file refuses
//! the transition there rather than being found out by the `rename` afterwards.
//! That is one more fallible line in the free half rather than a change to the
//! ordering, which is exactly where the rule below says it belongs (ADR 0035).
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
//! **A copy across filesystems is staged before the lock is taken.** A
//! `rename` cannot cross a device, so a reject onto another drive used to
//! `fs::copy` the whole file under the connection mutex, queuing every command
//! and every `wallpaper://` request behind it. [`reject_in`] and [`restore_in`]
//! now read the row, and when the source and the destination folder are on
//! different devices, copy the file to a dotfile beside where it will land
//! ([`Staged`]) with the connection released. Inside the lock the ordering is
//! unchanged — the row is still written first and the file still moves last —
//! and the move is a same-device `rename` of the staged copy plus the unlink
//! of the source. A staged copy the transition did not spend is removed when
//! it drops, so a refusal or a failed move leaves nothing behind (ADR 0039).
//!
//! **A file that is already gone moves nothing.** A reject of a wallpaper with
//! nothing at its path writes the row and stops: Rejected, the path unchanged,
//! and the Origin recorded as that same path. A Restore of a wallpaper whose
//! path is its Origin is the same thing backwards. Neither touches the disk, so
//! the ordering above holds trivially, and neither resolves the reject
//! destination, which beside an unplugged drive's mount point would create a
//! folder on whatever filesystem is underneath (ADR 0050).
//!
//! Rows come from [`db::get_wallpaper`] and go back through it after the commit.
//! `db.rs` still owns the row: its shape, its Status, its listings, and the two
//! transitions that only write a Status.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{self, Status, Wallpaper};
use crate::error::AppError;
use crate::{missing, reject_destination};

/// How many ` (n)` variants to try before giving up on a colliding destination.
const MAX_COLLISION_SUFFIXES: u32 = 1000;

/// Soft-rejects a wallpaper: moves its file to `destination_folder`, marks the
/// row Rejected, records the Origin, and answers with the row it wrote.
///
/// A wallpaper whose file is gone is rejected in place: nothing moves, the
/// `path` stays, the Origin is that same path, and `destination_folder` is not
/// looked at (ADR 0050).
///
/// The row rather than the path, so the caller predicts nothing: a collision
/// suffixes the basename, so `wall.jpg` can land as `wall (2).jpg`, and the
/// `path`, the `filename` and the `origin_path` this reports are the three
/// columns the move rewrote (ADR 0023). It is read after the commit, through the
/// same [`db::get_wallpaper`] the guard above used, for the reason
/// `WALLPAPER_COLUMNS` is one copy.
pub fn reject_in(
    db: &crate::Db,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError> {
    let row = db.read(|conn| db::get_wallpaper(conn, wallpaper_id))?;
    let source = PathBuf::from(&row.path);
    let staged = if row.status.may_become(Status::Rejected) && !missing::is_missing(&source) {
        resolve_destination_dir(&source, destination_folder)
            .ok()
            .and_then(|dir| Staged::if_cross_device(&source, &dir))
            .transpose()?
    } else {
        None
    };
    db.write(|conn| reject_with(conn, wallpaper_id, destination_folder, staged.as_ref()))
}

/// [`reject_in`] without the staging, for tests that hold a bare connection.
#[cfg(test)]
pub fn reject(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
) -> Result<Wallpaper, AppError> {
    reject_with(conn, wallpaper_id, destination_folder, None)
}

/// The locked half of a reject: the guard, the `UPDATE`, the move, the commit.
fn reject_with(
    conn: &Connection,
    wallpaper_id: i64,
    destination_folder: &str,
    staged: Option<&Staged>,
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
    if missing::is_missing(&source) {
        reject_in_place(&tx, wallpaper_id)?;
        tx.commit()?;
        return db::get_wallpaper(conn, wallpaper_id);
    }

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

    finish_move(&source, &dest_path, staged)?;
    tx.commit()?;
    db::get_wallpaper(conn, wallpaper_id)
}

/// Soft-rejects every wallpaper in `ids` whose file is still gone, in one
/// transaction, and answers with the rows it wrote.
///
/// The ids are the ones a Settings check counted ([`missing::count_missing`]),
/// so the button rejects what the line said and nothing that went missing
/// since. That check ran a while ago with the connection released, so each one
/// is asked again here under the lock: a file that came back in between (a
/// drive plugged in again) is left alone rather than being rejected in place
/// beside a file that is there, and so is a wallpaper some other transition
/// already took out of the Eligible pool. Only the counted ids get a `stat`
/// here, and a missing local path answers one at once.
pub fn reject_missing(conn: &Connection, ids: &[i64]) -> Result<Vec<Wallpaper>, AppError> {
    let tx = conn.unchecked_transaction()?;
    let mut rejected = Vec::new();
    for &id in ids {
        let row = db::get_wallpaper(&tx, id)?;
        if row.status.may_become(Status::Rejected) && missing::is_missing(Path::new(&row.path)) {
            reject_in_place(&tx, id)?;
            rejected.push(id);
        }
    }
    tx.commit()?;
    rejected
        .into_iter()
        .map(|id| db::get_wallpaper(conn, id))
        .collect()
}

/// The reject of a gone file: the Status and the Origin, and nothing on disk.
///
/// `origin_path = path` for the reason the moving reject's `UPDATE` gives, and
/// here the two end up equal, which is what tells a Restore it has nothing to
/// move back.
fn reject_in_place(tx: &Connection, wallpaper_id: i64) -> Result<(), AppError> {
    tx.execute(
        "UPDATE wallpapers SET status = ?1, origin_path = path WHERE id = ?2",
        rusqlite::params![Status::Rejected, wallpaper_id],
    )?;
    Ok(())
}

/// Restores a soft-rejected wallpaper: moves its file back to the Origin the
/// reject recorded, lands the row on Active with the Origin cleared, and answers
/// with the row it wrote.
///
/// A Restore always lands on Active, never on whatever Status the wallpaper held
/// before the reject. Kept is the curator's judgement about a rating, and
/// changing their mind about a reject is not that judgement (ADR 0009).
///
/// A wallpaper whose path is its Origin was rejected in place because its file
/// was gone, so there is nothing to move back: the row lands on Active and the
/// file, back or still missing, is left where it is (ADR 0050).
///
/// A wallpaper that is not Rejected is refused rather than treated as a no-op:
/// there is no file to move and no Origin to read, so succeeding quietly would
/// hide either a stale id or a control the UI left enabled. So is one rejected
/// before the Origin was recorded — nothing can say where its file came from,
/// which is the cohort Rejected stays terminal for.
pub fn restore_in(db: &crate::Db, wallpaper_id: i64) -> Result<Wallpaper, AppError> {
    let row = db.read(|conn| db::get_wallpaper(conn, wallpaper_id))?;
    let staged = match (row.status, &row.origin_path) {
        (Status::Rejected, Some(origin)) if *origin != row.path => {
            let source = PathBuf::from(&row.path);
            match Path::new(origin).parent() {
                Some(dir) if source.is_file() && std::fs::create_dir_all(dir).is_ok() => {
                    Staged::if_cross_device(&source, dir).transpose()?
                }
                _ => None,
            }
        }
        _ => None,
    };
    db.write(|conn| restore_with(conn, wallpaper_id, staged.as_ref()))
}

/// [`restore_in`] without the staging, for tests that hold a bare connection.
#[cfg(test)]
pub fn restore(conn: &Connection, wallpaper_id: i64) -> Result<Wallpaper, AppError> {
    restore_with(conn, wallpaper_id, None)
}

/// The locked half of a Restore: the guard, the `UPDATE`, the move, the commit.
fn restore_with(
    conn: &Connection,
    wallpaper_id: i64,
    staged: Option<&Staged>,
) -> Result<Wallpaper, AppError> {
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

    if origin == row.path {
        restore_in_place(&tx, wallpaper_id)?;
        tx.commit()?;
        return db::get_wallpaper(conn, wallpaper_id);
    }

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

    finish_move(&source, &dest_path, staged)?;
    tx.commit()?;
    db::get_wallpaper(conn, wallpaper_id)
}

/// The Restore of a wallpaper rejected in place: the Status and the Origin,
/// and nothing on disk. The mirror of [`reject_in_place`].
fn restore_in_place(tx: &Connection, wallpaper_id: i64) -> Result<(), AppError> {
    tx.execute(
        "UPDATE wallpapers SET status = ?1, origin_path = NULL WHERE id = ?2",
        rusqlite::params![Status::Active, wallpaper_id],
    )?;
    Ok(())
}

/// Expands `destination_folder`, resolves it against the wallpaper's own folder
/// when it is relative, and hands it to [`reject_destination::prepare`], which
/// creates it, canonicalizes it and proves it can take a file.
///
/// Expansion goes first so that the directory is created only after the Written
/// path has resolved: `~/rejected` used to produce a folder literally named `~`
/// beside the wallpaper, and `$HOEM/rejected` must not create anything at all.
///
/// Called from [`reject`] above the `UPDATE`, which is what makes a destination
/// that has gone bad since it was set cost an error and nothing else. The
/// destination was always resolved here; what is new is that it is now *proven*
/// here, rather than found out by a `rename` with the row already written
/// (ADR 0035).
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
/// wallpaper's own folder, then prepare it.
///
/// A relative destination is relative to the wallpaper's own folder, so a nested
/// library gets one reject folder per source folder (ADR 0011). That is also why
/// Settings can only say so much about one: it does not know which wallpaper.
fn create_destination_dir(source: &Path, expanded: PathBuf) -> Result<PathBuf, AppError> {
    let raw = if expanded.is_absolute() {
        expanded
    } else {
        source
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(expanded)
    };
    reject_destination::prepare(&raw)
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

/// A copy of a wallpaper's file, made with the connection released, sitting in
/// the folder it is about to be moved into under a name nothing else uses.
///
/// Dropping it removes the copy. After a successful [`finish_move`] the copy
/// has been renamed away and the removal finds nothing, so every path that did
/// not spend it — a refused transition, a failed `UPDATE`, a failed move —
/// cleans up by leaving scope.
struct Staged {
    source: PathBuf,
    temp: PathBuf,
}

impl Staged {
    /// Stages `source` into `dir` when a `rename` between them would cross a
    /// device, and answers `None` when a plain `rename` will do.
    fn if_cross_device(source: &Path, dir: &Path) -> Option<Result<Self, AppError>> {
        (!same_device(source, dir)).then(|| Self::copy(source, dir))
    }

    /// Copies `source` into `dir` under a dotfile name with no image extension,
    /// so neither a scan nor a file manager takes it for a wallpaper.
    fn copy(source: &Path, dir: &Path) -> Result<Self, AppError> {
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AppError::InvalidPath(source.display().to_string()))?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let temp = dir.join(format!(
            ".{name}.walltare-staging-{}-{nanos}",
            std::process::id()
        ));
        let staged = Self {
            source: source.to_path_buf(),
            temp,
        };
        // On failure `staged` drops here and removes whatever part was written.
        std::fs::copy(source, &staged.temp)?;
        Ok(staged)
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.temp);
    }
}

#[cfg(unix)]
fn same_device(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev(),
        // Unknowable here; the locked move's own fallback still copes.
        _ => true,
    }
}

#[cfg(not(unix))]
fn same_device(_: &Path, _: &Path) -> bool {
    true
}

/// The move at the bottom of both transitions. With a staged copy of this very
/// source in this very folder, it is a same-device `rename` of the copy and the
/// unlink of the source; otherwise — nothing staged, or the row moved between
/// the staging read and the lock — it is [`move_file`].
fn finish_move(source: &Path, dest: &Path, staged: Option<&Staged>) -> Result<(), AppError> {
    let Some(staged) = staged.filter(|s| s.source == source && s.temp.parent() == dest.parent())
    else {
        return move_file(source, dest);
    };
    std::fs::rename(&staged.temp, dest)?;
    match std::fs::remove_file(source) {
        // The source went on its own after the guard saw it. The landed copy
        // is then the only one, so it stays, and the row about to commit
        // names it; removing it here would lose the wallpaper outright.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(dest);
            Err(e.into())
        }
        Ok(()) => Ok(()),
    }
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
    fn a_reject_and_a_restore_leave_the_wallhaven_id_alone_through_a_collision() {
        // ADR 0050: the id is what the file was when it arrived. A colliding
        // reject renames it `wallhaven-abc123 (2).jpg`, and a Restore puts it
        // back, and neither is a reason for its mark to change.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (first, _) = seed_for_restore(&conn, tmp.path(), "wallhaven-abc123.jpg");
        let other_dir = tmp.path().join("other");
        std::fs::create_dir_all(&other_dir).unwrap();
        let second = seed_real_wallpaper(&conn, &other_dir, "wallhaven-abc123.jpg");
        let out = dest.path().to_str().unwrap();

        reject(&conn, first, out).unwrap();
        let collided = reject(&conn, second, out).unwrap();

        assert_eq!(collided.filename, "wallhaven-abc123 (2).jpg");
        for id in [first, second] {
            assert_eq!(wallhaven_id_of(&conn, id).as_deref(), Some("abc123"));
        }

        restore(&conn, second).unwrap();

        assert_eq!(wallhaven_id_of(&conn, second).as_deref(), Some("abc123"));
    }

    #[test]
    fn a_reject_and_a_restore_of_a_missing_file_leave_the_wallhaven_id_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "wallhaven-gone01.png");
        std::fs::remove_file(&origin).unwrap();

        reject(&conn, id, "rejected").unwrap();
        assert_eq!(wallhaven_id_of(&conn, id).as_deref(), Some("gone01"));
        restore(&conn, id).unwrap();

        assert_eq!(wallhaven_id_of(&conn, id).as_deref(), Some("gone01"));
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
        assert!(insert_new_wallpapers(&conn, &found).unwrap().is_empty());
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
        let db = crate::Db::new(conn);
        let small = crate::thumbnails::Size::Small;
        crate::thumbnails::ThumbnailCache::new(cache.path().to_path_buf())
            .answer(&db, id, small)
            .unwrap();
        let cache_file = cache.path().join(format!("{id}_small.jpg"));
        assert!(cache_file.is_file());

        db.write(|conn| reject(conn, id, dest.path().to_str().unwrap()))
            .unwrap();

        assert_eq!(db.read(|conn| count_thumbnails(conn, id)), 1);
        assert!(cache_file.is_file());

        // And the moved row still answers with that same file rather than a
        // decode. The file is tampered with, so its bytes coming back is the
        // cache hit and can be nothing else, and the answer comes from a fresh
        // cache — a relaunch — so memory cannot be what answered.
        std::fs::write(&cache_file, b"the cache said so").unwrap();
        let relaunched = crate::thumbnails::ThumbnailCache::new(cache.path().to_path_buf());
        assert_eq!(
            relaunched.answer(&db, id, small).unwrap().as_slice(),
            b"the cache said so"
        );
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
    #[cfg(unix)]
    fn failed_move_leaves_db_untouched_and_propagates_io_error() {
        // The move fails with the row already written: the source sits in a
        // folder the process cannot unlink from, so `rename` refuses after the
        // `UPDATE`. This used to delete the source instead, which is now the
        // reject in place of ADR 0050 and not a failure at all.
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let locked = tmp.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        let id = seed_real_wallpaper(&conn, &locked, "e.jpg");
        add_comparison(&conn, id, id);

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root ignores the mode bits, so there the move succeeds and there is no
        // failure to assert; see the destination test below for the same shape.
        let probe = locked.join(".root-check");
        let mode_bits_ignored = std::fs::File::create(&probe).is_ok();
        let _ = std::fs::remove_file(&probe);

        let result = reject(&conn, id, dest.path().to_str().unwrap());
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if mode_bits_ignored {
            assert_eq!(result.unwrap().status, Status::Rejected);
            return;
        }

        let err = result.unwrap_err();
        assert!(matches!(err, crate::error::AppError::Io(_)), "got {err:?}");
        assert_eq!(row_status_and_path(&conn, id).0, "active");
        // The rollback takes the Origin with it: a wallpaper that is not
        // Rejected must not read as one a Restore could move.
        assert_eq!(origin_path_of(&conn, id), None);
        assert!(locked.join("e.jpg").is_file());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    #[cfg(unix)]
    fn a_destination_the_process_cannot_write_to_is_refused_before_the_move() {
        // The arm most likely to reach a real curator: a reject folder on a
        // read-only mount, or one owned by another user. Its neighbour above
        // fails the move from the source's side; this one has the source right
        // where it belongs and the destination refusing the write.
        //
        // Refused rather than attempted: `reject_destination::prepare` proves
        // the folder before the `UPDATE`, so nothing is written and nothing is
        // rolled back (ADR 0035). What the row and the file do is what this test
        // held before that change, and holds unaltered.
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
        // Root ignores the mode bits, so on such a run the folder takes a file
        // after all and there is no refusal to assert. Asked the way the module
        // asks it, and asked before the reject so the test knows which half of
        // its claim holds here. CI runs as a non-root user, so the refusal is
        // the half normally exercised (ADR 0034 took the same shape).
        let probe = readonly.join(".root-check");
        let mode_bits_ignored = std::fs::File::create(&probe).is_ok();
        let _ = std::fs::remove_file(&probe);

        let result = reject(&conn, id, readonly.to_str().unwrap());

        // Restored before the assertions rather than after, so a failing one
        // still leaves `tempfile` a directory it can clean up.
        std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o755)).unwrap();

        if mode_bits_ignored {
            // Running as root, so the reject is one that can finish. The half
            // that holds either way is that the row and the disk agree: the file
            // is where the row says it is, and nowhere else.
            let row = result.unwrap();
            assert_eq!(row.status, Status::Rejected);
            assert!(PathBuf::from(&row.path).is_file());
            assert!(!tmp.path().join("locked-out.jpg").exists());
            return;
        }

        // A sentence naming the folder, not an errno: the toast prints this
        // verbatim under `Couldn't reject locked-out.jpg`.
        let err = result.unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::InvalidPath(ref m)
                if m.contains("cannot be written to") && m.contains("Permission denied")),
            "got {err:?}"
        );
        assert_eq!(row_status_and_path(&conn, id), before);
        // No Origin either: a wallpaper that is not Rejected must not read as
        // one a Restore could move.
        assert_eq!(origin_path_of(&conn, id), None);
        // And the file never left, so the reject is one the curator can retry
        // once they have fixed the folder.
        assert!(tmp.path().join("locked-out.jpg").is_file());
        assert_eq!(std::fs::read_dir(&readonly).unwrap().count(), 0);
    }

    #[test]
    fn a_destination_that_went_bad_after_it_was_set_refuses_the_second_reject() {
        // The whole reason the check runs twice. The curator sets a destination
        // that works, rejects into it, and then the folder goes: unmounted,
        // tidied up, or — as here — replaced by a file of the same name. The
        // second reject refuses, and neither wallpaper is left half moved
        // (ADR 0035).
        let tmp = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let first = seed_real_wallpaper(&conn, tmp.path(), "one.jpg");
        let second = seed_real_wallpaper(&conn, tmp.path(), "two.jpg");
        let destination = dest.path().join("rejected");
        let written = destination.to_str().unwrap();

        let landed = reject(&conn, first, written).unwrap().path;
        assert!(PathBuf::from(&landed).is_file());

        // The folder goes, and something else takes its name.
        std::fs::remove_dir_all(&destination).unwrap();
        std::fs::write(&destination, b"in the way").unwrap();

        let err = reject(&conn, second, written).unwrap_err();

        assert!(
            matches!(err, crate::error::AppError::InvalidPath(ref m)
                if m.contains("is not a folder")),
            "got {err:?}"
        );
        // The refused wallpaper is exactly as it was, file included.
        assert_eq!(status_of(&conn, second), "active");
        assert_eq!(origin_path_of(&conn, second), None);
        assert!(tmp.path().join("two.jpg").is_file());
        // And the one that was already rejected is untouched: the row still
        // points where its file went, and nothing overwrote the file in the way.
        assert_eq!(status_of(&conn, first), "rejected");
        assert_eq!(std::fs::read(&destination).unwrap(), b"in the way");
    }

    #[test]
    fn a_row_rejected_by_an_older_version_still_restores() {
        // The destination check is in front of a reject, and a Restore does not
        // go through it, so every wallpaper rejected before it existed must
        // still come back. This row is seeded the way an older version left one
        // — Rejected, path in the reject folder, Origin recorded — rather than
        // by calling `reject`, so nothing about the new check is in its history.
        let tmp = tempfile::tempdir().unwrap();
        let library = tmp.path().join("library");
        let rejected = tmp.path().join("rejected");
        std::fs::create_dir_all(&library).unwrap();
        std::fs::create_dir_all(&rejected).unwrap();
        let moved = rejected.join("old.jpg");
        std::fs::File::create(&moved).unwrap();
        let origin = library.join("old.jpg");

        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_wallpaper(&conn, moved.to_str().unwrap(), "rejected", 9.0);
        conn.execute(
            "UPDATE wallpapers SET origin_path = ?1 WHERE id = ?2",
            rusqlite::params![origin.to_str().unwrap(), id],
        )
        .unwrap();

        let row = restore(&conn, id).unwrap();

        assert_eq!(row.status, Status::Active);
        assert_eq!(row.path, origin.display().to_string());
        assert_eq!(row.origin_path, None);
        assert!(origin.is_file());
        assert!(!moved.exists());
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
        assert!(insert_new_wallpapers(&conn, &found).unwrap().is_empty());
        assert_eq!(count_wallpapers(&conn), 1);
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_str().unwrap().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_staged_copy_is_renamed_into_place_and_the_source_unlinked() {
        // The cross-device path, minus the second device: the copy is made
        // before the lock, and the locked move is a rename of it.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        std::fs::write(tmp.path().join("far.jpg"), b"FAR").unwrap();
        insert_new_wallpapers(&conn, &[tmp.path().join("far.jpg")]).unwrap();
        let id = conn.last_insert_rowid();
        let source = tmp.path().join("far.jpg");
        let dest_dir = resolve_destination_dir(&source, "rejected").unwrap();

        let staged = Staged::copy(&source, &dest_dir).unwrap();
        assert_eq!(entries(&dest_dir).len(), 1, "the staged copy is there");
        let landed = reject_with(&conn, id, "rejected", Some(&staged)).unwrap();
        drop(staged);

        assert_eq!(std::fs::read(&landed.path).unwrap(), b"FAR");
        assert!(!source.exists());
        assert_eq!(entries(&dest_dir), vec!["far.jpg".to_string()]);
        assert_eq!(status_of(&conn, id), "rejected");
    }

    #[test]
    fn a_staged_copy_the_transition_refused_is_cleaned_up() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "stay.jpg");
        let source = tmp.path().join("stay.jpg");
        let dest_dir = resolve_destination_dir(&source, "rejected").unwrap();
        // A row already claims the path the UPDATE would write, so
        // UNIQUE(path) refuses the transition with the copy staged.
        insert_new_wallpapers(&conn, &[dest_dir.join("stay.jpg")]).unwrap();

        let staged = Staged::copy(&source, &dest_dir).unwrap();
        assert!(reject_with(&conn, id, "rejected", Some(&staged)).is_err());
        drop(staged);

        assert!(source.is_file());
        assert!(
            entries(&dest_dir).is_empty(),
            "got {:?}",
            entries(&dest_dir)
        );
        assert_eq!(status_of(&conn, id), "active");
    }

    #[test]
    fn a_source_gone_before_the_unlink_keeps_the_landed_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let src_dir = tmp.path().join("src");
        let dest_dir = tmp.path().join("dest");
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        let source = src_dir.join("a.jpg");
        std::fs::write(&source, b"A").unwrap();
        let staged = Staged::copy(&source, &dest_dir).unwrap();
        // The source goes before the move reaches it, so there is nothing to unlink.
        std::fs::remove_file(&source).unwrap();

        finish_move(&source, &dest_dir.join("a.jpg"), Some(&staged)).unwrap();
        drop(staged);

        assert_eq!(entries(&dest_dir), vec!["a.jpg".to_string()]);
    }

    #[test]
    fn a_staged_restore_lands_on_the_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        std::fs::write(tmp.path().join("back.jpg"), b"BACK").unwrap();
        insert_new_wallpapers(&conn, &[tmp.path().join("back.jpg")]).unwrap();
        let id = conn.last_insert_rowid();
        let rejected = PathBuf::from(reject(&conn, id, "rejected").unwrap().path);

        let origin_dir = PathBuf::from(origin_path_of(&conn, id).unwrap())
            .parent()
            .unwrap()
            .to_path_buf();
        let staged = Staged::copy(&rejected, &origin_dir).unwrap();
        let back = restore_with(&conn, id, Some(&staged)).unwrap();
        drop(staged);

        assert_eq!(std::fs::read(&back.path).unwrap(), b"BACK");
        assert!(!rejected.exists());
        assert_eq!(
            entries(tmp.path()),
            vec!["back.jpg".to_string(), "rejected".to_string()]
        );
    }

    #[test]
    fn the_db_entry_points_reject_and_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let id = seed_real_wallpaper(&conn, tmp.path(), "x.jpg");
        let db = crate::Db::new(conn);

        let out = reject_in(&db, id, "rejected").unwrap();
        assert!(PathBuf::from(&out.path).is_file());
        let back = restore_in(&db, id).unwrap();
        assert!(PathBuf::from(&back.path).is_file());
        assert!(entries(&tmp.path().join("rejected")).is_empty());
    }

    #[test]
    fn a_reject_of_a_gone_file_moves_nothing_and_leaves_the_pool() {
        // The case ADR 0050 exists for: the file went outside the app, and a
        // reject is the one thing that takes the wallpaper out of voting and
        // review. There is nothing to move, so the row changes and the disk
        // does not.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "gone.jpg");
        let other = seed_real_wallpaper(&conn, tmp.path(), "other.jpg");
        add_comparison(&conn, other, id);
        std::fs::remove_file(&origin).unwrap();
        let path = origin.to_str().unwrap().to_string();

        let wrote = reject(&conn, id, "rejected").unwrap();

        assert_eq!(wrote.status, Status::Rejected);
        assert_eq!(wrote.path, path);
        assert_eq!(wrote.filename, "gone.jpg");
        assert_eq!(wrote.origin_path, Some(path));
        // No reject folder beside a file that is not there.
        assert!(!tmp.path().join("library").join("rejected").exists());
        assert_eq!(review_ids(&conn), vec![other]);
        assert_eq!(count_comparisons(&conn), 1);
    }

    #[test]
    fn a_gone_file_under_a_vanished_folder_creates_nothing_through_the_db_entry_point() {
        // An unplugged drive: the file's folder is gone too, so a relative
        // destination would resolve under a mount point that is no longer
        // mounted, and creating it would write onto the filesystem underneath.
        // `reject_in` stages before the lock, so it is the one to check.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let drive = tmp.path().join("drive");
        let id = seed_wallpaper(
            &conn,
            drive.join("wall.jpg").to_str().unwrap(),
            "kept",
            25.0,
        );
        let db = crate::Db::new(conn);

        let wrote = reject_in(&db, id, "rejected").unwrap();

        assert_eq!(wrote.status, Status::Rejected);
        assert!(!drive.exists());
    }

    #[test]
    fn undoing_a_reject_of_a_gone_file_puts_it_back_as_it_was() {
        // The toast's Undo is a Restore. The file is still missing, and the
        // Restore must not answer `FileMissing` for a move it has no need to
        // make: the path is already the Origin.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "gone.jpg");
        std::fs::remove_file(&origin).unwrap();
        reject(&conn, id, "rejected").unwrap();

        let wrote = restore(&conn, id).unwrap();

        assert_eq!(wrote.status, Status::Active);
        assert_eq!(wrote.path, origin.to_str().unwrap());
        assert_eq!(wrote.origin_path, None);
        assert!(!origin.exists());
        assert_eq!(review_ids(&conn), vec![id]);
    }

    #[test]
    fn a_file_that_came_back_is_restored_where_it_is() {
        // A drive plugged in again. The file is at the Origin already, and a
        // Restore that moved it would find its own file in the way and land it
        // as `back (2).jpg`.
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let (id, origin) = seed_for_restore(&conn, tmp.path(), "back.jpg");
        std::fs::remove_file(&origin).unwrap();
        reject(&conn, id, "rejected").unwrap();
        std::fs::write(&origin, b"BACK").unwrap();
        let db = crate::Db::new(conn);

        let wrote = restore_in(&db, id).unwrap();

        assert_eq!(wrote.status, Status::Active);
        assert_eq!(wrote.path, origin.to_str().unwrap());
        assert_eq!(std::fs::read(&origin).unwrap(), b"BACK");
        assert_eq!(
            entries(&tmp.path().join("library")),
            vec!["back.jpg".to_string()]
        );
    }

    #[test]
    fn rejecting_the_gone_rejects_only_what_is_still_gone_and_still_eligible() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let gone_active = seed_real_wallpaper(&conn, tmp.path(), "a.jpg");
        let gone_kept = seed_real_wallpaper(&conn, tmp.path(), "k.jpg");
        keep_wallpaper(&conn, gone_kept).unwrap();
        // Gone when the check ran, back by the time of the press.
        let came_back = seed_real_wallpaper(&conn, tmp.path(), "back.jpg");
        // Rejected by something else in between.
        let already = seed_wallpaper(&conn, "/elsewhere/r.jpg", "rejected", 25.0);
        std::fs::remove_file(tmp.path().join("a.jpg")).unwrap();
        std::fs::remove_file(tmp.path().join("k.jpg")).unwrap();

        let wrote = reject_missing(&conn, &[gone_active, gone_kept, came_back, already]).unwrap();

        let ids: Vec<i64> = wrote.iter().map(|w| w.id).collect();
        assert_eq!(ids, vec![gone_active, gone_kept]);
        assert!(wrote
            .iter()
            .all(|w| w.status == Status::Rejected && w.origin_path.as_deref() == Some(&w.path)));
        assert_eq!(status_of(&conn, came_back), "active");
        assert!(tmp.path().join("back.jpg").is_file());
        assert_eq!(origin_path_of(&conn, already), None);
        assert_eq!(review_ids(&conn), vec![came_back]);
    }
}
