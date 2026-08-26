//! Turning a Written path into a real one.
//!
//! A Written path is how the user writes a folder for the app to use: the
//! Library root, and a soft reject's destination. It may use `~` for the home
//! folder and environment variables, and the app stores it as written, so it
//! keeps meaning whatever those mean on the machine reading it.
//!
//! Nothing here touches the filesystem or creates anything. See
//! [ADR 0011](../../docs/adr/0011-written-paths.md).

use std::path::PathBuf;

use crate::error::AppError;

/// Expands `~` and environment variables in a Written path.
pub fn expand(input: &str) -> Result<PathBuf, AppError> {
    expand_with(input, |name| std::env::var(name).ok())
}

/// The body of [`expand`], with the environment passed in.
///
/// The split exists for the tests: the expansion table needs `HOME` set to a
/// known value for some rows and unset for another, and cargo runs tests as
/// threads in one process, so mutating the environment would race every other
/// test in the crate. It also stops `~` being a special case, since it becomes
/// a lookup of `HOME` like any other variable. `db`'s tests reach it through
/// `resolve_destination_dir_with` for the same reason.
///
/// A variable set to an empty string counts as absent, because expanding it to
/// nothing is what produces the path this whole module exists to refuse: `~` on
/// an empty `HOME` would leave `/rejected`, which is absolute, so the reject
/// path would create it at the root of the disk.
pub(crate) fn expand_with(
    input: &str,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<PathBuf, AppError> {
    let set = |name: &str| lookup(name).filter(|value| !value.is_empty());
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    // Only a leading `~` is the home folder. Past the first character it is an
    // ordinary filename character, as in `backup~1`.
    if rest == "~" || rest.starts_with("~/") {
        let home = set("HOME").ok_or_else(|| {
            AppError::InvalidPathSyntax("cannot expand ~ because HOME is not set".to_string())
        })?;
        out.push_str(&home);
        rest = &rest[1..];
    }

    while let Some(dollar) = rest.find('$') {
        out.push_str(&rest[..dollar]);
        let after = &rest[dollar + 1..];
        match variable_reference(after) {
            Some((name, consumed)) => {
                // Naming a variable that is not set is an error, not an empty
                // string: `$HOEM/rejected` must not become `/rejected` and get
                // created at the root of the filesystem.
                let value = set(name).ok_or_else(|| {
                    AppError::InvalidPathSyntax(format!("unknown environment variable {name}"))
                })?;
                out.push_str(&value);
                rest = &after[consumed..];
            }
            // A `$` with no valid name after it is a literal character, which is
            // what leaves `paid$`, `a$-b`, and `$(whoami)` as written.
            None => {
                out.push('$');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(PathBuf::from(out))
}

/// Reads a variable reference off the front of `after`, which is whatever
/// followed a `$`.
///
/// Returns the name and how many bytes it spans, braces included, or `None`
/// when what follows is not a `[A-Za-z_][A-Za-z0-9_]*` name.
fn variable_reference(after: &str) -> Option<(&str, usize)> {
    let (body, braced) = match after.strip_prefix('{') {
        Some(body) => (body, true),
        None => (after, false),
    };
    let first = body.chars().next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let end = body
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .unwrap_or(body.len());
    if !braced {
        return Some((&body[..end], end));
    }
    // An unterminated `${` is not a reference, so it stays literal rather than
    // guessing where the user meant the name to end.
    body[end..]
        .starts_with('}')
        .then(|| (&body[..end], end + 2))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The environment the table's rows are read against. No test sets or reads
    /// a real process variable.
    fn env(name: &str) -> Option<String> {
        match name {
            "HOME" => Some("/home/tester".to_string()),
            "PICS" => Some("pictures".to_string()),
            _ => None,
        }
    }

    fn nothing_set(_: &str) -> Option<String> {
        None
    }

    /// Everything is set, and set to nothing. A shell would expand these to an
    /// empty string; this module refuses them instead.
    fn set_but_empty(_: &str) -> Option<String> {
        Some(String::new())
    }

    fn expanded(input: &str) -> PathBuf {
        expand_with(input, env).unwrap()
    }

    fn syntax_error(input: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
        match expand_with(input, lookup).unwrap_err() {
            AppError::InvalidPathSyntax(message) => message,
            other => panic!("expected InvalidPathSyntax, got {other:?}"),
        }
    }

    #[test]
    fn a_leading_tilde_becomes_the_home_folder() {
        assert_eq!(expanded("~"), PathBuf::from("/home/tester"));
        assert_eq!(expanded("~/pics"), PathBuf::from("/home/tester/pics"));
    }

    #[test]
    fn a_tilde_past_the_first_character_is_literal() {
        assert_eq!(expanded("/pics/backup~1"), PathBuf::from("/pics/backup~1"));
    }

    #[test]
    fn named_variables_expand_in_both_spellings_and_anywhere_in_the_string() {
        assert_eq!(expanded("$HOME/pics"), PathBuf::from("/home/tester/pics"));
        assert_eq!(expanded("${HOME}/pics"), PathBuf::from("/home/tester/pics"));
        assert_eq!(expanded("/srv/$PICS/x"), PathBuf::from("/srv/pictures/x"));
        assert_eq!(expanded("/srv/${PICS}x"), PathBuf::from("/srv/picturesx"));
    }

    #[test]
    fn a_dollar_with_no_valid_name_after_it_is_literal() {
        assert_eq!(expanded("/pics/paid$"), PathBuf::from("/pics/paid$"));
        assert_eq!(expanded("/pics/a$-b"), PathBuf::from("/pics/a$-b"));
    }

    #[test]
    fn other_shell_syntax_is_left_alone_so_it_fails_later_as_a_missing_directory() {
        assert_eq!(expanded("~otheruser"), PathBuf::from("~otheruser"));
        assert_eq!(expanded("*.jpg"), PathBuf::from("*.jpg"));
        assert_eq!(expanded("{a,b}"), PathBuf::from("{a,b}"));
    }

    #[test]
    fn an_unterminated_brace_is_not_a_reference_either() {
        // Not a row of the table. Guessing where the user meant the name to end
        // would be a third syntax to learn, so it fails later as a missing
        // directory like everything else the table leaves alone.
        assert_eq!(expanded("${HOME/pics"), PathBuf::from("${HOME/pics"));
    }

    #[test]
    fn a_dollar_before_a_parenthesis_is_not_a_name_so_it_stays_literal() {
        assert_eq!(expanded("$(whoami)"), PathBuf::from("$(whoami)"));
    }

    // The two messages below are user-facing copy: the frontend renders them
    // verbatim, because naming the variable is the whole point of the error.

    #[test]
    fn an_unset_named_variable_is_an_error_that_names_it() {
        assert_eq!(
            syntax_error("$HOEM/rejected", env),
            "unknown environment variable HOEM"
        );
        assert_eq!(
            syntax_error("${HOEM}/rejected", env),
            "unknown environment variable HOEM"
        );
    }

    #[test]
    fn a_tilde_with_no_home_set_is_an_error_that_says_so() {
        assert_eq!(
            syntax_error("~/rejected", nothing_set),
            "cannot expand ~ because HOME is not set"
        );
        assert_eq!(
            syntax_error("~", nothing_set),
            "cannot expand ~ because HOME is not set"
        );
    }

    #[test]
    fn a_variable_set_to_an_empty_string_is_refused_like_an_unset_one() {
        // The dangerous case, and the reason this is an error rather than a
        // shell-style empty expansion. `~/rejected` on an empty `HOME` leaves
        // `/rejected`, which is absolute, so the reject path would create it at
        // the root of the disk and move wallpapers into it. A variable that
        // resolves to nothing gives the app nothing to work with either way, so
        // it reads as absent and gets the same copy.
        assert_eq!(
            syntax_error("~/rejected", set_but_empty),
            "cannot expand ~ because HOME is not set"
        );
        assert_eq!(
            syntax_error("$PICS/rejected", set_but_empty),
            "unknown environment variable PICS"
        );
        assert_eq!(
            syntax_error("${PICS}/rejected", set_but_empty),
            "unknown environment variable PICS"
        );
    }

    #[test]
    fn the_syntax_error_crosses_the_ipc_as_its_own_kind() {
        let err = expand_with("~", nothing_set).unwrap_err();

        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "invalid_path_syntax");
    }

    #[test]
    fn an_empty_written_path_expands_to_an_empty_path() {
        // `db::resolve_destination_dir` reads a relative result against the
        // wallpaper's own folder, and "" is how it already spells "this folder".
        assert_eq!(expanded(""), PathBuf::from(""));
    }
}
