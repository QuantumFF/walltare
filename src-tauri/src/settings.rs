//! What the curator chose, and the only answer to what each key means.
//!
//! The table holds one row per key the user changed, so an absent row means the
//! default and the table answers "what did they actually change". Reads are
//! forgiving and writes are strict: a row this version cannot read costs the user
//! a preference, while a bad write is a bug in the caller. See
//! [ADR 0010](../../docs/adr/0010-settings-store.md), amended by
//! [ADR 0020](../../docs/adr/0020-settings-page.md).

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

const THEME: &str = "theme";
const LIBRARY_ROOT: &str = "library_root";
const REJECT_DESTINATION: &str = "reject_destination";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

impl Theme {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Settings {
    pub theme: Theme,
    /// A Written path, stored exactly as the user typed it, `~` and variables
    /// included, per [ADR 0011](../../docs/adr/0011-written-paths.md). Empty
    /// means nothing has been scanned.
    pub library_root: String,
    /// A Written path. Relative means one rejected folder beside each wallpaper.
    pub reject_destination: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            library_root: String::new(),
            reject_destination: "./rejected".to_string(),
        }
    }
}

/// Every setting, with the gaps filled from [`Settings::default`], so a caller
/// always receives a complete struct.
pub fn get(conn: &Connection) -> Result<Settings, AppError> {
    let mut settings = Settings::default();
    let mut stmt = conn.prepare_cached("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (key, value) = row?;
        apply(&mut settings, &key, &value);
    }
    Ok(settings)
}

/// Writes one setting and returns every setting, so a stale read cannot survive
/// a write.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<Settings, AppError> {
    if is_default(key, value)? {
        // The only reset the app has, and the reason it needs no control: typing
        // `./rejected` back into the field would otherwise write a row identical
        // to the default and break the property the store rests on. `get` fills
        // gaps from `Settings::default`, so absent and default-valued read the
        // same to every caller.
        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        )?;
    } else {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
    }
    get(conn)
}

/// Reads one stored row into `settings`, or leaves the default standing.
///
/// Nothing here fails. An unknown key is a row a newer version wrote and a
/// downgrade found, and a value that will not parse is a row someone edited by
/// hand, so boot never fails over a preference.
fn apply(settings: &mut Settings, key: &str, value: &str) {
    match key {
        THEME => match Theme::parse(value) {
            Some(theme) => settings.theme = theme,
            None => eprintln!(
                "settings: {THEME} holds {value:?}, which is not a theme; using the default"
            ),
        },
        LIBRARY_ROOT => settings.library_root = value.to_string(),
        REJECT_DESTINATION => settings.reject_destination = value.to_string(),
        _ => {}
    }
}

/// Whether `value` is what `key` already means with no row at all, refusing an
/// unknown key or an unreadable value on the way.
///
/// The comparison runs against [`Settings::default`] rather than a second table
/// of default strings, so the defaults are stated once.
fn is_default(key: &str, value: &str) -> Result<bool, AppError> {
    let default = Settings::default();
    match key {
        THEME => {
            let theme = Theme::parse(value).ok_or_else(|| {
                AppError::BadRequest(format!(
                    "{value:?} is not a theme; expected system, light or dark"
                ))
            })?;
            Ok(theme == default.theme)
        }
        // A Written path is stored as written and never checked against the
        // filesystem: an unmounted drive is not a bad setting.
        LIBRARY_ROOT => Ok(value == default.library_root),
        REJECT_DESTINATION => Ok(value == default.reject_destination),
        _ => Err(AppError::BadRequest(format!("unknown setting {key:?}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    /// Arranges a row that the commands themselves would never write: one a
    /// newer version left behind, or one edited by hand with `sqlite3`.
    fn write_raw_row(conn: &Connection, key: &str, value: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .unwrap();
    }

    fn stored_rows(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn an_empty_table_reads_as_every_default() {
        let conn = store();

        assert_eq!(get(&conn).unwrap(), Settings::default());
        assert_eq!(
            get(&conn).unwrap(),
            Settings {
                theme: Theme::System,
                library_root: String::new(),
                reject_destination: "./rejected".to_string(),
            }
        );
    }

    #[test]
    fn a_write_then_a_read_round_trips_and_leaves_the_other_keys_alone() {
        let conn = store();

        set(&conn, "library_root", "~/pics").unwrap();

        let settings = get(&conn).unwrap();
        assert_eq!(settings.library_root, "~/pics");
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.reject_destination, "./rejected");
    }

    #[test]
    fn a_written_path_is_stored_exactly_as_written() {
        // ADR 0011: expanding at write time would freeze whatever a variable
        // meant during one session, and would show the user a path they never
        // typed.
        let conn = store();

        for written in ["~/pics", "$XDG_PICTURES_DIR/walls", "./relative"] {
            assert_eq!(
                set(&conn, "library_root", written).unwrap().library_root,
                written
            );
        }
    }

    #[test]
    fn a_write_returns_the_whole_struct_with_the_new_value_in_it() {
        let conn = store();
        set(&conn, "library_root", "/pics").unwrap();

        let returned = set(&conn, "theme", "dark").unwrap();

        assert_eq!(returned.theme, Theme::Dark);
        assert_eq!(returned.library_root, "/pics");
        assert_eq!(returned, get(&conn).unwrap());
    }

    #[test]
    fn a_setting_survives_the_connection_that_wrote_it() {
        // The whole point of the store: a choice that resets on every launch is
        // worse than no choice at all.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            set(&conn, "reject_destination", "~/pics/rejected").unwrap();
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(get(&conn).unwrap().reject_destination, "~/pics/rejected");
    }

    #[test]
    fn an_unknown_key_on_write_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "theme", "light").unwrap();
        let before = get(&conn).unwrap();

        let err = set(&conn, "review_limit", "100").unwrap_err();

        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("review_limit")),
            "got {err:?}"
        );
        assert_eq!(get(&conn).unwrap(), before);
        assert_eq!(stored_rows(&conn), 1);
    }

    #[test]
    fn an_invalid_theme_on_write_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "theme", "dark").unwrap();

        let err = set(&conn, "theme", "solarized").unwrap_err();

        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");
        assert_eq!(get(&conn).unwrap().theme, Theme::Dark);
    }

    #[test]
    fn a_row_holding_garbage_reads_as_the_default_rather_than_failing() {
        // Boot never fails over a preference: a bad row must not lock the user
        // out of the app that would let them fix it.
        let conn = store();
        write_raw_row(&conn, "theme", "chartreuse");
        write_raw_row(&conn, "library_root", "/pics");

        let settings = get(&conn).unwrap();

        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.library_root, "/pics");
    }

    #[test]
    fn a_row_a_newer_version_wrote_is_ignored_on_read() {
        // What a downgrade leaves behind. Refusing it here would make the older
        // version unable to start.
        let conn = store();
        write_raw_row(&conn, "accent_colour", "teal");
        write_raw_row(&conn, "theme", "light");

        let settings = get(&conn).unwrap();

        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.library_root, Settings::default().library_root);
    }

    #[test]
    fn writing_a_value_equal_to_the_default_deletes_the_row() {
        let conn = store();
        set(&conn, "reject_destination", "/bin/walls").unwrap();
        set(&conn, "theme", "dark").unwrap();
        assert_eq!(stored_rows(&conn), 2);

        let returned = set(&conn, "reject_destination", "./rejected").unwrap();

        // The read is unchanged by the delete, which is why no reset command and
        // no reset control exists.
        assert_eq!(returned.reject_destination, "./rejected");
        assert_eq!(get(&conn).unwrap(), returned);
        assert_eq!(stored_rows(&conn), 1);
    }

    #[test]
    fn every_key_can_be_written_back_to_its_default() {
        let conn = store();
        set(&conn, "theme", "light").unwrap();
        set(&conn, "library_root", "/pics").unwrap();
        set(&conn, "reject_destination", "/bin").unwrap();

        set(&conn, "theme", "system").unwrap();
        set(&conn, "library_root", "").unwrap();
        let returned = set(&conn, "reject_destination", "./rejected").unwrap();

        assert_eq!(returned, Settings::default());
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn settings_cross_the_ipc_with_the_fields_client_ts_expects() {
        let conn = store();
        set(&conn, "theme", "dark").unwrap();
        set(&conn, "library_root", "~/pics").unwrap();

        let json = serde_json::to_value(get(&conn).unwrap()).unwrap();

        // The theme crosses as the same string a write accepts, so the frontend
        // can hand a read value straight back to `set_setting`.
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["library_root"], "~/pics");
        assert_eq!(json["reject_destination"], "./rejected");
    }
}
