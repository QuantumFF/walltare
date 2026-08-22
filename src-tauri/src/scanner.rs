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
        Err(_) => return,
    };
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
