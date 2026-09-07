use std::collections::HashSet;
use std::path::{Path, PathBuf};

const SUPPORTED_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

pub fn is_supported(path: &Path) -> bool {
    path.extension().is_some_and(|ext| {
        let ext = ext.to_string_lossy().to_lowercase();
        SUPPORTED_EXTENSIONS.contains(&ext.as_str())
    })
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // A folder the curator cannot read is skipped and the walk carries on
        // beside it. Returning here rather than propagating is the decision: a
        // permissions quirk somewhere below the Library root must not cost the
        // whole library, and a scan that stops at the first such folder looks
        // to the curator exactly like a broken app (ADR 0034).
        //
        // Logged and not reported. It is one line per unreadable folder, and
        // the scan's own ending already says how many files it found, which is
        // the number a curator can act on.
        Err(e) => {
            eprintln!("scan skipped {}: {e}", dir.display());
            return;
        }
    };
    // `flatten` drops an entry that cannot be read for the same reason: a
    // directory that lists but will not hand over one of its entries leaves the
    // rest of itself perfectly scannable.
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            walk(&path, out, seen);
            continue;
        }
        // metadata() follows symlinks, so symlinked image files are listed
        // like os.walk does; symlinked dirs are never recursed into.
        let Ok(md) = std::fs::metadata(&path) else {
            continue;
        };
        if md.is_file()
            && is_supported(&path)
            && path.to_str().is_some()
            && seen.insert(path.clone())
        {
            out.push(path);
        }
    }
}

pub fn collect_images(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        walk(root, &mut out, &mut seen);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn extension_filter_is_case_insensitive() {
        assert!(is_supported(Path::new("a.jpg")));
        assert!(is_supported(Path::new("a.JPG")));
        assert!(is_supported(Path::new("a.Jpeg")));
        assert!(is_supported(Path::new("dir/a.png")));
        assert!(is_supported(Path::new("a.WEBP")));
        assert!(!is_supported(Path::new("a.gif")));
        assert!(!is_supported(Path::new("a.jpgx")));
        assert!(!is_supported(Path::new("jpg")));
        assert!(!is_supported(Path::new("")));
    }

    #[test]
    fn collect_images_walks_recursively_and_dedups_by_exact_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let sub = root.join("nested").join("deeper");
        std::fs::create_dir_all(&sub).unwrap();
        for name in ["b.jpg", "A.PNG", "c.webp", "skip.gif", "notes.txt"] {
            File::create(root.join(name)).unwrap();
        }
        File::create(sub.join("d.jpeg")).unwrap();

        let mut found = collect_images(&[root.clone(), sub.clone(), root.clone()]);
        found.sort();
        let mut expected = vec![
            root.join("A.PNG"),
            root.join("b.jpg"),
            root.join("c.webp"),
            sub.join("d.jpeg"),
        ];
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn a_zero_byte_and_a_truncated_image_are_still_collected() {
        // The walk reads names, never bytes. A folder of years of accumulated
        // downloads holds both of these, and neither is the scan's problem to
        // solve: they become wallpapers like any other, and the pre-generation
        // pass is where an undecodable one is counted and reported (ADR 0034).
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        std::fs::write(root.join("empty.jpg"), b"").unwrap();
        // A PNG that starts decoding and stops: the signature and the header
        // chunk, and then nothing.
        std::fs::write(
            root.join("half.png"),
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x04\x00\x00\x00\x02\x40\x08\x06",
        )
        .unwrap();
        std::fs::write(root.join("fine.png"), b"whatever").unwrap();

        let mut found = collect_images(std::slice::from_ref(&root));
        found.sort();
        let mut expected = vec![
            root.join("empty.jpg"),
            root.join("fine.png"),
            root.join("half.png"),
        ];
        expected.sort();
        assert_eq!(found, expected);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_subdirectory_is_skipped_and_the_walk_carries_on() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        // One folder that cannot be read, with a file inside it and a file
        // below it, and two ordinary images: one beside the locked folder and
        // one further down the tree, so the walk has to carry on in both
        // directions rather than stopping at the first refusal.
        let locked = root.join("locked");
        let under_locked = locked.join("deeper");
        std::fs::create_dir_all(&under_locked).unwrap();
        File::create(locked.join("hidden.jpg")).unwrap();
        File::create(under_locked.join("deeper.jpg")).unwrap();
        let beside = root.join("beside.jpg");
        let below = root.join("open").join("below.png");
        std::fs::create_dir_all(below.parent().unwrap()).unwrap();
        File::create(&beside).unwrap();
        File::create(&below).unwrap();

        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        // Root ignores the mode bits, so on such a run the folder is readable
        // after all and there is no skip to assert. The half that holds either
        // way — the walk finishes and finds everything outside it — is asserted
        // unconditionally below.
        let denied = std::fs::read_dir(&locked).is_err();
        let mut found = collect_images(std::slice::from_ref(&root));
        // Before any assertion, so a failure still leaves a removable tempdir.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        found.sort();

        assert!(found.contains(&beside), "{found:?}");
        assert!(found.contains(&below), "{found:?}");
        if denied {
            assert_eq!(found, vec![beside, below]);
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_paths_are_skipped() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join(OsStr::from_bytes(b"bad\xff.jpg"));
        File::create(&bad).unwrap();
        File::create(tmp.path().join("good.jpg")).unwrap();

        let found = collect_images(&[tmp.path().to_path_buf()]);
        assert_eq!(found, vec![tmp.path().join("good.jpg")]);
    }
}
