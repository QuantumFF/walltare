//! Whether a Soft reject's destination can take a file, and the one sentence
//! the app says when it cannot.
//!
//! The question is asked twice. Settings asks it while the curator writes the
//! Written path, so a folder that is not there or will not take a file is read
//! before anything moves. The reject asks it again, because the folder can go
//! between the two: a drive unmounts, a tidy-up deletes it, a file lands on the
//! name. Both ask this module, so what the curator reads under the field and
//! what a refused reject says are one sentence with one author.
//!
//! What the two moments cannot share is how much there is to find out.
//! [ADR 0011](../../docs/adr/0011-written-paths.md) resolves a relative
//! destination against the wallpaper's own folder, and Settings does not know
//! which wallpaper, so a relative destination is accepted there with nothing
//! checked and everything left to [`prepare`].
//!
//! **The check is a write, not a permission bit.** [`takes_a_file`] puts a file
//! in the folder and takes it away again. `std` has no `access(2)`, and the mode
//! bits would be the wrong question anyway: a read-only mount, a POSIX ACL and a
//! folder owned by somebody else all refuse a write that `0o755` promises, and
//! those are how a reject folder actually goes wrong.
//!
//! Nothing here changes ADR 0003's write ordering. [`prepare`] is called from
//! where the reject already resolved its destination, above the `UPDATE` and
//! above the move, which is where a failure is still free. See
//! [ADR 0035](../../docs/adr/0035-a-reject-destination-is-checked-first.md).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;

/// What can be said about a written destination with no wallpaper in hand,
/// which is the Settings field's whole answer.
///
/// Four states and no `exists` flag, because the interesting cases are not
/// "there" and "not there": a folder that is there and will not take a file is
/// the one that costs a curator a reject, and a folder that is not there yet is
/// not a problem at all, since the first reject creates it (ADR 0003).
///
/// `Relative` carries no path. A relative destination resolves per wallpaper, so
/// there is no one place to name — and naming the one this process happens to be
/// running from would be a different folder than any reject will use.
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Check {
    /// Resolves per wallpaper, so nothing else can be said here.
    Relative,
    /// There, and it takes a file.
    Ready { resolved: String },
    /// Nothing there yet. The first reject creates it (ADR 0003).
    Absent { resolved: String },
    /// There, and it will not take a file.
    ///
    /// `reason` is the sentence to print: it names the folder and what refused,
    /// and it is the same string a refused reject carries, because the curator
    /// reading it under the field and the curator reading it in a toast are
    /// being told one thing.
    Refused { resolved: String, reason: String },
}

/// What can be said about `written` in Settings, against the real environment.
pub fn check(written: &str) -> Result<Check, AppError> {
    check_with(written, |name| std::env::var(name).ok())
}

/// The body of [`check`], with the environment passed in.
///
/// Same split and same reason as [`crate::paths::expand_with`]: the `~` case
/// needs a known `HOME`, and a test that read the real one would probe the
/// developer's actual home folder.
pub(crate) fn check_with(
    written: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<Check, AppError> {
    // First, and by propagating rather than by reporting: an unset variable
    // means there is no path here to have an opinion about, and ADR 0011's
    // message names the variable the curator mistyped, which no state of this
    // enum could.
    let expanded = crate::paths::expand_with(written, lookup)?;

    if !expanded.is_absolute() {
        return Ok(Check::Relative);
    }
    let resolved = expanded.display().to_string();

    match std::fs::metadata(&expanded) {
        // Creating nothing is the whole difference between this and a reject.
        // The curator is still typing.
        Err(_) => Ok(Check::Absent { resolved }),
        Ok(found) if !found.is_dir() => Ok(Check::Refused {
            reason: not_a_folder(&expanded),
            resolved,
        }),
        Ok(_) => match takes_a_file(&expanded) {
            Ok(()) => Ok(Check::Ready { resolved }),
            Err(cause) => Ok(Check::Refused {
                reason: cannot_write(&expanded, &cause),
                resolved,
            }),
        },
    }
}

/// The folder this reject will move into: created if it was not there,
/// canonical, and proven able to take a file.
///
/// Everything fallible about a destination happens here, which is above the
/// `UPDATE` and above the move at the one call site. A destination that has gone
/// bad since it was set therefore costs the curator an error and nothing else:
/// no row written, no file moved, nothing to put back (ADR 0003, ADR 0035).
///
/// Creating it on demand stays, because `./rejected` has to come from somewhere
/// on the first reject (ADR 0011). Canonicalizing is what keeps a rejected file
/// rejected: the default `./rejected` would otherwise be stored verbatim as
/// `/lib/./rejected/x.jpg`, a different string from the `/lib/rejected/x.jpg` a
/// rescan produces, so `UNIQUE(path)` would not match and the file would come
/// back as a new Active row. It is also what stops `~/pics` and `$HOME/pics`
/// becoming two spellings of one folder.
pub fn prepare(dir: &Path) -> Result<PathBuf, AppError> {
    // Before `create_dir_all`, which would report a file in the way as an
    // `AlreadyExists` errno and leave the curator to work out what already
    // exists.
    if let Ok(found) = std::fs::metadata(dir) {
        if !found.is_dir() {
            return Err(AppError::InvalidPath(not_a_folder(dir)));
        }
    }
    std::fs::create_dir_all(dir)
        .map_err(|cause| AppError::InvalidPath(cannot_create(dir, &cause)))?;
    let canonical = dir.canonicalize()?;
    // Last, so the answer is about the folder the file is actually going into
    // rather than about a symlink or a `..` on the way to it.
    takes_a_file(&canonical)
        .map_err(|cause| AppError::InvalidPath(cannot_write(&canonical, &cause)))?;
    Ok(canonical)
}

/// Whether this process can put a file in `dir`, answered by putting one there.
///
/// The name carries the process id so two walltares checking at once cannot
/// answer each other's question, and it is a dotfile so a probe that outlives
/// its check — the process is killed between the create and the remove — is
/// invisible in a file manager. The removal is best effort: the answer is
/// already known by then, and a probe nobody could delete is not a reason to
/// refuse a reject that would otherwise work.
fn takes_a_file(dir: &Path) -> std::io::Result<()> {
    let probe = dir.join(format!(".walltare-write-check-{}", std::process::id()));
    std::fs::File::create(&probe)?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

// The three sentences, written once each because both moments say them. They
// name the folder, because at reject time a relative destination resolves per
// wallpaper and the curator cannot otherwise tell which folder refused.

fn not_a_folder(dir: &Path) -> String {
    format!(
        "{} is not a folder, so rejects cannot go there",
        dir.display()
    )
}

fn cannot_create(dir: &Path, cause: &std::io::Error) -> String {
    format!("{} cannot be created: {cause}", dir.display())
}

fn cannot_write(dir: &Path, cause: &std::io::Error) -> String {
    format!("{} cannot be written to: {cause}", dir.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The environment every check below is read against. No test here sets or
    /// reads a real process variable.
    fn nothing_set(_: &str) -> Option<String> {
        None
    }

    /// A `HOME` pointing at a scratch directory, so `~` resolves somewhere a
    /// killed run can leave nothing behind.
    fn home_at(dir: &Path) -> impl Fn(&str) -> Option<String> {
        let home = dir.to_str().unwrap().to_string();
        move |name| (name == "HOME").then(|| home.clone())
    }

    /// Whether this run can write into a `0o555` directory anyway, which is what
    /// root does: it ignores the mode bits, so there is no refusal to assert.
    ///
    /// Asked by writing, the same way the module asks it, and answered before
    /// the assertions so a test can say which half of its claim holds on this
    /// machine. ADR 0034's unreadable-subdirectory test took the same shape for
    /// the same reason, and CI runs as a non-root user, so the refusal half is
    /// the half that is normally exercised.
    #[cfg(unix)]
    fn mode_bits_are_ignored(dir: &Path) -> bool {
        let probe = dir.join(".root-check");
        let written = std::fs::File::create(&probe).is_ok();
        let _ = std::fs::remove_file(&probe);
        written
    }

    #[cfg(unix)]
    fn locked(dir: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    }

    #[cfg(unix)]
    fn unlocked(dir: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn refusal(check: Check) -> String {
        match check {
            Check::Refused { reason, .. } => reason,
            other => panic!("expected Refused, got {other:?}"),
        }
    }

    #[test]
    fn a_destination_naming_an_unset_variable_is_a_syntax_error_that_names_it() {
        // Not an empty string, and not a state of `Check`: `$HOEM/rejected`
        // would expand to `/rejected` in a shell, which is absolute, so the
        // reject path would create it at the root of the disk (ADR 0011).
        let err = check_with("$HOEM/rejected", nothing_set).unwrap_err();

        assert!(
            matches!(err, AppError::InvalidPathSyntax(ref m) if m == "unknown environment variable HOEM"),
            "got {err:?}"
        );
    }

    #[test]
    fn a_tilde_with_no_home_behind_it_is_a_syntax_error_too() {
        let err = check_with("~/rejected", nothing_set).unwrap_err();

        assert!(
            matches!(err, AppError::InvalidPathSyntax(ref m) if m == "cannot expand ~ because HOME is not set"),
            "got {err:?}"
        );
    }

    #[test]
    fn a_relative_destination_is_accepted_with_nothing_checked() {
        // It resolves against each wallpaper's own folder, so Settings has no
        // one place to stat and says so with a rule instead (ADR 0011).
        for written in ["./rejected", "rejected", "../rejected", ""] {
            assert!(
                matches!(check_with(written, nothing_set).unwrap(), Check::Relative),
                "{written:?} did not read as relative"
            );
        }
    }

    #[test]
    fn a_destination_that_takes_a_file_is_ready_and_keeps_nothing_of_the_check() {
        let dir = tempfile::tempdir().unwrap();
        let written = dir.path().to_str().unwrap();

        let check = check_with(written, nothing_set).unwrap();

        match check {
            Check::Ready { resolved } => assert_eq!(resolved, written),
            other => panic!("expected Ready, got {other:?}"),
        }
        // The probe is put there and taken away again, so a curator who opens
        // the folder finds their rejects and nothing of walltare's.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_destination_that_is_not_there_reads_as_absent_and_is_not_created() {
        let dir = tempfile::tempdir().unwrap();
        let absent = dir.path().join("not-yet");

        let check = check_with(absent.to_str().unwrap(), nothing_set).unwrap();

        match check {
            Check::Absent { resolved } => assert_eq!(resolved, absent.display().to_string()),
            other => panic!("expected Absent, got {other:?}"),
        }
        // The curator is still typing. Only a reject creates the destination
        // (ADR 0003), so a field that created a folder per keystroke would leave
        // one behind for every path on the way to the one they meant.
        assert!(!absent.exists());
    }

    #[test]
    fn a_written_destination_expands_before_it_is_checked() {
        // `~/rejected` is a template rather than a path, so a check of the
        // unexpanded string would report a relative destination.
        let home = tempfile::tempdir().unwrap();
        let rejected = home.path().join("rejected");
        std::fs::create_dir(&rejected).unwrap();

        let check = check_with("~/rejected", home_at(home.path())).unwrap();

        match check {
            Check::Ready { resolved } => assert_eq!(resolved, rejected.display().to_string()),
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn a_file_where_the_destination_should_be_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let in_the_way = dir.path().join("rejected");
        std::fs::write(&in_the_way, b"not a folder").unwrap();

        let reason = refusal(check_with(in_the_way.to_str().unwrap(), nothing_set).unwrap());

        assert_eq!(
            reason,
            format!(
                "{} is not a folder, so rejects cannot go there",
                in_the_way.display()
            )
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_destination_that_will_not_take_a_file_is_refused_with_the_cause() {
        // The arm most likely to reach a real curator: a reject folder on a
        // read-only mount, or one owned by another user.
        let dir = tempfile::tempdir().unwrap();
        let readonly = dir.path().join("readonly");
        std::fs::create_dir(&readonly).unwrap();
        locked(&readonly);
        let root = mode_bits_are_ignored(&readonly);

        let check = check_with(readonly.to_str().unwrap(), nothing_set).unwrap();

        // Before the assertions, so a failing one still leaves `tempfile` a
        // directory it can remove.
        unlocked(&readonly);

        if root {
            // Running as root, so the folder does take a file and Ready is the
            // honest answer. Asserting a refusal here would be asserting that
            // root cannot write to a directory, which is false.
            assert!(matches!(check, Check::Ready { .. }), "got {check:?}");
            return;
        }
        let reason = refusal(check);
        assert!(
            reason.starts_with(&readonly.display().to_string()),
            "{reason}"
        );
        assert!(reason.contains("cannot be written to"), "{reason}");
        // The cause, so the sentence separates a permission from a full disk.
        assert!(reason.contains("Permission denied"), "{reason}");
    }

    #[test]
    fn the_check_crosses_the_ipc_tagged_by_state() {
        // `client.ts`'s `DestinationCheck` is this union, and the Settings line
        // switches on the tag.
        let dir = tempfile::tempdir().unwrap();
        let ready = serde_json::to_value(check(dir.path().to_str().unwrap()).unwrap()).unwrap();
        assert_eq!(ready["state"], "ready");
        assert_eq!(ready["resolved"], dir.path().display().to_string());

        let relative = serde_json::to_value(check("./rejected").unwrap()).unwrap();
        assert_eq!(relative["state"], "relative");

        let absent =
            serde_json::to_value(check(dir.path().join("no").to_str().unwrap()).unwrap()).unwrap();
        assert_eq!(absent["state"], "absent");

        let file = dir.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        let refused = serde_json::to_value(check(file.to_str().unwrap()).unwrap()).unwrap();
        assert_eq!(refused["state"], "refused");
        assert!(refused["reason"].as_str().unwrap().contains("not a folder"));
    }

    #[test]
    fn preparing_a_destination_creates_it_and_answers_with_the_canonical_folder() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("rejected");

        let prepared = prepare(&dir.path().join("a").join(".").join("rejected")).unwrap();

        assert_eq!(prepared, nested.canonicalize().unwrap());
        assert!(nested.is_dir());
        // The probe again: preparing a destination leaves the folder as empty as
        // it found it.
        assert_eq!(std::fs::read_dir(&nested).unwrap().count(), 0);
    }

    #[test]
    fn preparing_a_file_is_refused_before_anything_is_created() {
        let dir = tempfile::tempdir().unwrap();
        let in_the_way = dir.path().join("rejected");
        std::fs::write(&in_the_way, b"not a folder").unwrap();

        let err = prepare(&in_the_way).unwrap_err();

        assert!(
            matches!(err, AppError::InvalidPath(ref m) if m.contains("is not a folder")),
            "got {err:?}"
        );
        // Still the file it was: nothing replaced it and nothing was written
        // into it.
        assert_eq!(std::fs::read(&in_the_way).unwrap(), b"not a folder");
    }

    #[test]
    #[cfg(unix)]
    fn preparing_a_destination_that_cannot_be_created_says_which_folder_refused() {
        let dir = tempfile::tempdir().unwrap();
        let readonly = dir.path().join("readonly");
        std::fs::create_dir(&readonly).unwrap();
        locked(&readonly);
        let root = mode_bits_are_ignored(&readonly);
        let under_it = readonly.join("rejected");

        let result = prepare(&under_it);

        unlocked(&readonly);

        if root {
            // Root creates it, which is the correct outcome for a process that
            // can. The folder is real and canonical, so the reject may proceed.
            assert_eq!(result.unwrap(), under_it.canonicalize().unwrap());
            return;
        }
        let err = result.unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPath(ref m) if m.contains("cannot be created")),
            "got {err:?}"
        );
        assert!(!under_it.exists());
    }
}
