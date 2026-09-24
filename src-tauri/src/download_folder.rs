//! Where a Discover download lands, and whether it can land there.
//!
//! The Download folder is a Written path with a third relativity rule beside
//! ADR 0011's two: a relative one means the Library root, as the root stands at
//! each use. The root has to exist. Only the Download folder and what is below
//! it may be created, so with no root, or one that is not there, the folder
//! cannot be used and nothing is created — that is the typo-becomes-a-folder
//! hazard ADR 0011 refused, on an empty mount point. An absolute Download folder
//! may sit outside the root, and is created on demand behind ADR 0035's write
//! probe. See [ADR 0051](../../docs/adr/0051-a-download-lands-as-a-scan-of-one-file.md).
//!
//! The question is asked at the same two moments a reject destination's is:
//! [`check`] while the curator writes the path in Settings, and [`prepare`] when
//! a download is clicked and again for each file, because the answer expires.
//! Both say the same sentences, which is the reason they share a module
//! (ADR 0035).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;
use crate::reject_destination::{inspect, prepare_folder, Found};

/// The noun the folder refusals name.
const DOWNLOADS: &str = "downloads";

/// What can be said about a written Download folder against a Library root,
/// which is the Settings field's whole answer.
///
/// Five states, and the syntax error makes the field's sixth line. The two root
/// states carry the sentence a download would refuse with, for the reason
/// `Refused` does: the curator reading it under the field and the curator
/// reading it when a click is refused are being told one thing.
#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Check {
    /// No Library root is set, so nothing can be downloaded.
    NoRoot { reason: String },
    /// The Library root is set and is not there, so nothing can be downloaded.
    RootMissing { reason: String },
    /// There, and it takes a file.
    Ready { resolved: String },
    /// Nothing there yet. The first download creates it.
    Absent { resolved: String },
    /// There, and it will not take a file.
    Refused { resolved: String, reason: String },
}

/// What can be said about `written` against `library_root`, in the real
/// environment.
///
/// Both strings are Written paths as the curator has them, so the Settings field
/// can follow the Library root field while it is still being typed.
pub fn check(written: &str, library_root: &str) -> Result<Check, AppError> {
    check_with(written, library_root, |name| std::env::var(name).ok())
}

/// The body of [`check`], with the environment passed in, for the reason
/// [`crate::paths::expand_with`] takes one.
pub(crate) fn check_with(
    written: &str,
    library_root: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<Check, AppError> {
    Ok(match locate(written, library_root, lookup)? {
        Located::NoRoot => Check::NoRoot { reason: no_root() },
        Located::RootMissing(reason) => Check::RootMissing { reason },
        Located::Folder(folder) => {
            let resolved = folder.display().to_string();
            // Creating nothing: the curator is still typing, and only a download
            // creates the folder.
            match inspect(&folder, DOWNLOADS) {
                Found::Absent => Check::Absent { resolved },
                Found::Ready => Check::Ready { resolved },
                Found::Refused(reason) => Check::Refused { resolved, reason },
            }
        }
    })
}

/// The folder a download lands in: resolved against the root as it stands now,
/// created if it was not there, canonical, and proven able to take a file.
///
/// The download calls this when it is clicked and again for each file. Every
/// way the folder cannot be used refuses with `InvalidPath`, carrying the
/// sentence the Settings field prints, and a malformed path with
/// `InvalidPathSyntax`.
pub fn prepare(written: &str, library_root: &str) -> Result<PathBuf, AppError> {
    prepare_with(written, library_root, |name| std::env::var(name).ok())
}

/// The body of [`prepare`], with the environment passed in.
pub(crate) fn prepare_with(
    written: &str,
    library_root: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<PathBuf, AppError> {
    match locate(written, library_root, lookup)? {
        Located::NoRoot => Err(AppError::InvalidPath(no_root())),
        Located::RootMissing(reason) => Err(AppError::InvalidPath(reason)),
        Located::Folder(folder) => prepare_folder(&folder, DOWNLOADS),
    }
}

/// Where the written folder is, or which of the two root states stops it being
/// anywhere.
enum Located {
    NoRoot,
    /// The root is set and unusable, with the sentence saying why.
    RootMissing(String),
    Folder(PathBuf),
}

/// Resolve `written` by the third relativity rule.
///
/// The folder's own syntax error comes first and propagates: it is the field's
/// own mistake, and the message names the variable the curator mistyped. An
/// empty folder is one of those, because it would mean the Library root
/// itself, and downloads landing loose among the curator's wallpapers is not
/// what anybody clearing the field meant.
///
/// The root is required whatever the folder is. A download becomes a wallpaper
/// in the library at once, so with no library there is nothing for it to join,
/// and an absolute folder outside the root does not change that (ADR 0051).
fn locate(
    written: &str,
    library_root: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<Located, AppError> {
    if written.is_empty() {
        return Err(AppError::InvalidPathSyntax(empty()));
    }
    let folder = crate::paths::expand_with(written, &lookup)?;

    if library_root.is_empty() {
        return Ok(Located::NoRoot);
    }
    // A root that will not expand is a root that is not there, as far as this
    // field is concerned. Its own field, directly above, prints the syntax
    // error, and printing it here as well would blame the Download folder for
    // it.
    let root = match crate::paths::expand_with(library_root, &lookup) {
        Ok(root) => root,
        Err(AppError::InvalidPathSyntax(message)) => {
            return Ok(Located::RootMissing(format!(
                "The library root cannot be resolved ({message}), so nothing can be downloaded"
            )));
        }
        Err(other) => return Err(other),
    };
    // The root is never created, and a file standing where it should be is no
    // more a library than nothing at all. Canonical, so a relative folder joins
    // the root the way a scan spells its paths.
    let canonical = match root.canonicalize() {
        Ok(canonical) if canonical.is_dir() => canonical,
        _ => return Ok(Located::RootMissing(root_missing(&root))),
    };

    Ok(Located::Folder(if folder.is_absolute() {
        folder
    } else {
        canonical.join(folder)
    }))
}

// The field's own sentence and the two root ones. The folder ones are
// `reject_destination`'s, with `downloads` as their noun.

/// Also written in `SettingsView.tsx`, which says it under an emptied field
/// without asking, since the resolution hooks never ask about an empty string.
fn empty() -> String {
    "The download folder is empty; name a folder, such as wallhaven".to_string()
}

fn no_root() -> String {
    "No library root is set, so nothing can be downloaded".to_string()
}

fn root_missing(root: &Path) -> String {
    format!(
        "The library root {} is not there, so nothing can be downloaded",
        root.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nothing_set(_: &str) -> Option<String> {
        None
    }

    fn home_at(dir: &Path) -> impl Fn(&str) -> Option<String> {
        let home = dir.to_str().unwrap().to_string();
        move |name| (name == "HOME").then(|| home.clone())
    }

    /// A Library root that exists, canonical, since a relative folder resolves
    /// under the canonical root.
    fn library() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let canonical = dir.path().canonicalize().unwrap();
        (dir, canonical)
    }

    fn text(path: &Path) -> &str {
        path.to_str().unwrap()
    }

    #[test]
    fn a_relative_folder_resolves_under_the_library_root_and_is_not_created() {
        let (_dir, root) = library();

        let check = check_with("wallhaven", text(&root), nothing_set).unwrap();

        match check {
            Check::Absent { resolved } => {
                assert_eq!(resolved, root.join("wallhaven").display().to_string())
            }
            other => panic!("expected Absent, got {other:?}"),
        }
        assert!(!root.join("wallhaven").exists());
    }

    #[test]
    fn a_relative_folder_that_is_there_and_takes_a_file_is_ready() {
        let (_dir, root) = library();
        std::fs::create_dir_all(root.join("walls/wallhaven")).unwrap();

        let check = check_with("walls/wallhaven", text(&root), nothing_set).unwrap();

        match check {
            Check::Ready { resolved } => {
                assert_eq!(resolved, root.join("walls/wallhaven").display().to_string())
            }
            other => panic!("expected Ready, got {other:?}"),
        }
        // The probe is taken away again.
        assert_eq!(
            std::fs::read_dir(root.join("walls/wallhaven"))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn a_relative_folder_follows_a_written_root() {
        // Resolved against the root as written, `~` and all, and as it stands
        // at the time of asking rather than frozen when the setting was stored.
        let home = tempfile::tempdir().unwrap();
        let pics = home.path().canonicalize().unwrap().join("pics");
        std::fs::create_dir(&pics).unwrap();

        let check = check_with("wallhaven", "~/pics", home_at(home.path())).unwrap();

        match check {
            Check::Absent { resolved } => {
                assert_eq!(resolved, pics.join("wallhaven").display().to_string())
            }
            other => panic!("expected Absent, got {other:?}"),
        }
    }

    #[test]
    fn an_absolute_folder_resolves_as_itself_even_outside_the_root() {
        let (_dir, root) = library();
        let elsewhere = tempfile::tempdir().unwrap();
        let absent = elsewhere.path().join("downloads");

        let check = check_with(text(&absent), text(&root), nothing_set).unwrap();

        match check {
            Check::Absent { resolved } => assert_eq!(resolved, absent.display().to_string()),
            other => panic!("expected Absent, got {other:?}"),
        }
        let ready = check_with(text(elsewhere.path()), text(&root), nothing_set).unwrap();
        assert!(matches!(ready, Check::Ready { .. }), "got {ready:?}");
    }

    #[test]
    fn with_no_root_nothing_can_be_downloaded_and_nothing_is_created() {
        let elsewhere = tempfile::tempdir().unwrap();
        let absolute = elsewhere.path().join("downloads");

        for written in ["wallhaven", text(&absolute)] {
            let check = check_with(written, "", nothing_set).unwrap();
            match check {
                Check::NoRoot { reason } => assert_eq!(
                    reason,
                    "No library root is set, so nothing can be downloaded"
                ),
                other => panic!("{written}: expected NoRoot, got {other:?}"),
            }

            let err = prepare_with(written, "", nothing_set).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPath(ref m) if m == "No library root is set, so nothing can be downloaded"),
                "{written}: got {err:?}"
            );
        }
        assert!(!absolute.exists());
    }

    #[test]
    fn with_a_missing_root_nothing_can_be_downloaded_and_the_root_is_not_created() {
        // The empty mount point: creating the root here would put a library on
        // the disk underneath a drive that is only unplugged (ADR 0051).
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("unmounted");

        let check = check_with("wallhaven", text(&root), nothing_set).unwrap();
        let expected = format!(
            "The library root {} is not there, so nothing can be downloaded",
            root.display()
        );
        match check {
            Check::RootMissing { reason } => assert_eq!(reason, expected),
            other => panic!("expected RootMissing, got {other:?}"),
        }

        let err = prepare_with("wallhaven", text(&root), nothing_set).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPath(ref m) if *m == expected),
            "got {err:?}"
        );
        assert!(!root.exists());
    }

    #[test]
    fn a_file_where_the_root_should_be_is_a_missing_root() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("root.jpg");
        std::fs::write(&file, b"x").unwrap();

        let check = check_with("wallhaven", text(&file), nothing_set).unwrap();

        assert!(matches!(check, Check::RootMissing { .. }), "got {check:?}");
    }

    #[test]
    fn a_root_that_will_not_expand_is_a_missing_root_rather_than_this_fields_error() {
        let check = check_with("wallhaven", "$HOEM/pics", nothing_set).unwrap();

        match check {
            Check::RootMissing { reason } => {
                assert!(
                    reason.contains("unknown environment variable HOEM"),
                    "{reason}"
                );
            }
            other => panic!("expected RootMissing, got {other:?}"),
        }
    }

    #[test]
    fn a_folder_naming_an_unset_variable_is_a_syntax_error_that_names_it() {
        let (_dir, root) = library();

        // Before the root is looked at, even when there is none: it is this
        // field's own mistake.
        for library_root in [text(&root), ""] {
            let err = check_with("$HOEM/wallhaven", library_root, nothing_set).unwrap_err();
            assert!(
                matches!(err, AppError::InvalidPathSyntax(ref m) if m == "unknown environment variable HOEM"),
                "got {err:?}"
            );
            let err = prepare_with("$HOEM/wallhaven", library_root, nothing_set).unwrap_err();
            assert!(matches!(err, AppError::InvalidPathSyntax(_)), "got {err:?}");
        }
    }

    #[test]
    fn an_empty_folder_is_refused_rather_than_meaning_the_library_root() {
        // Empty would join to the root itself, so downloads would land loose
        // among the curator's wallpapers. Refused at both moments, and nothing
        // is created.
        let (_dir, root) = library();
        let before = std::fs::read_dir(&root).unwrap().count();

        let expected = "The download folder is empty; name a folder, such as wallhaven";
        let err = check_with("", text(&root), nothing_set).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPathSyntax(ref m) if m == expected),
            "got {err:?}"
        );
        let err = prepare_with("", text(&root), nothing_set).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPathSyntax(ref m) if m == expected),
            "got {err:?}"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), before);
    }

    #[test]
    fn a_file_where_the_folder_should_be_is_refused() {
        let (_dir, root) = library();
        std::fs::write(root.join("wallhaven"), b"not a folder").unwrap();

        let check = check_with("wallhaven", text(&root), nothing_set).unwrap();

        match check {
            Check::Refused { reason, .. } => assert_eq!(
                reason,
                format!(
                    "{} is not a folder, so downloads cannot go there",
                    root.join("wallhaven").display()
                )
            ),
            other => panic!("expected Refused, got {other:?}"),
        }
        let err = prepare_with("wallhaven", text(&root), nothing_set).unwrap_err();
        assert!(
            matches!(err, AppError::InvalidPath(ref m) if m.contains("is not a folder, so downloads")),
            "got {err:?}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_folder_that_will_not_take_a_file_is_refused_with_the_cause() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, root) = library();
        let folder = root.join("wallhaven");
        std::fs::create_dir(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root ignores the mode bits, so there is no refusal to assert there
        // (ADR 0035's consequences).
        let probe = folder.join(".root-check");
        let as_root = std::fs::File::create(&probe).is_ok();
        let _ = std::fs::remove_file(&probe);

        let check = check_with("wallhaven", text(&root), nothing_set).unwrap();

        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        if as_root {
            assert!(matches!(check, Check::Ready { .. }), "got {check:?}");
            return;
        }
        match check {
            Check::Refused { reason, .. } => {
                assert!(reason.contains("cannot be written to"), "{reason}")
            }
            other => panic!("expected Refused, got {other:?}"),
        }
    }

    #[test]
    fn preparing_creates_only_the_folder_and_answers_with_the_canonical_path() {
        let (_dir, root) = library();

        let prepared = prepare_with("./walls/wallhaven", text(&root), nothing_set).unwrap();

        assert_eq!(prepared, root.join("walls/wallhaven"));
        assert!(prepared.is_dir());
        assert_eq!(std::fs::read_dir(&prepared).unwrap().count(), 0);
    }

    #[test]
    fn preparing_an_absolute_folder_outside_the_root_creates_it() {
        let (_dir, root) = library();
        let elsewhere = tempfile::tempdir().unwrap();
        let folder = elsewhere.path().join("a/downloads");

        let prepared = prepare_with(text(&folder), text(&root), nothing_set).unwrap();

        assert_eq!(prepared, folder.canonicalize().unwrap());
        assert!(folder.is_dir());
    }

    #[test]
    fn the_check_crosses_the_ipc_tagged_by_state() {
        // `client.ts`'s `DownloadFolderCheck` is this union.
        let (_dir, root) = library();

        let absent = serde_json::to_value(check("wallhaven", text(&root)).unwrap()).unwrap();
        assert_eq!(absent["state"], "absent");
        assert_eq!(
            absent["resolved"],
            root.join("wallhaven").display().to_string()
        );

        let no_root = serde_json::to_value(check("wallhaven", "").unwrap()).unwrap();
        assert_eq!(no_root["state"], "no_root");
        assert!(no_root["reason"].is_string());

        let missing =
            serde_json::to_value(check("wallhaven", text(&root.join("gone"))).unwrap()).unwrap();
        assert_eq!(missing["state"], "root_missing");
        assert!(missing["reason"].is_string());

        std::fs::create_dir(root.join("wallhaven")).unwrap();
        let ready = serde_json::to_value(check("wallhaven", text(&root)).unwrap()).unwrap();
        assert_eq!(ready["state"], "ready");

        std::fs::write(root.join("file"), b"x").unwrap();
        let refused = serde_json::to_value(check("file", text(&root)).unwrap()).unwrap();
        assert_eq!(refused["state"], "refused");
        assert!(refused["reason"].is_string());
    }
}
