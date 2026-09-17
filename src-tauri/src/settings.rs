//! What the curator chose, and the only answer to what each key means.
//!
//! The table holds one row per key the user changed, so an absent row means the
//! default and the table answers "what did they actually change". Reads are
//! forgiving and writes are strict: a row this version cannot read costs the user
//! a preference, while a bad write is a bug in the caller. See
//! [ADR 0010](../../docs/adr/0010-settings-store.md), amended by
//! [ADR 0020](../../docs/adr/0020-settings-page.md).

use std::collections::HashMap;
use std::fmt;

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

const THEME: &str = "theme";
const LIBRARY_ROOT: &str = "library_root";
const REJECT_DESTINATION: &str = "reject_destination";
const SCREEN: &str = "screen";
const MINIMUM_RESOLUTION: &str = "minimum_resolution";
const REVIEW_LAYOUT: &str = "review_layout";
const LIBRARY_LAYOUT: &str = "library_layout";

/// The screen to assume when the platform will not name one.
///
/// Detection failing is not an error state: the curator gets a working app with
/// a common screen behind it and a field in Settings to correct it.
pub const FALLBACK_SCREEN: Resolution = Resolution {
    width: 1920,
    height: 1080,
};

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

/// Which layout Review draws its worklist in.
///
/// Stored per tab rather than once for the app: browsing a library and judging a
/// queue are different jobs, so a choice made on one page must not decide the
/// other. Library's own key arrives with the layouts it chooses between
/// ([#262](https://github.com/QuantumFF/walltare/issues/262)); the two never
/// share a row.
///
/// `Grid` is the default, so a curator who never touches the control sees the
/// page they already had. The strip is one press away on Review's own bar and
/// the choice is remembered, so saying it once is the whole cost.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewLayout {
    /// One wallpaper at the size it would be hung, with the worklist beneath it.
    Strip,
    /// The uniform grid of cards Review has always drawn.
    #[default]
    Grid,
}

impl ReviewLayout {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "strip" => Some(Self::Strip),
            "grid" => Some(Self::Grid),
            _ => None,
        }
    }
}

/// A size in pixels, width by height.
///
/// What the Screen and the Minimum resolution hold. Not a wallpaper's
/// Dimensions, which are the same two numbers about a different thing — a fact
/// about a file rather than a stated preference — and live as nullable columns
/// on the row (`CONTEXT.md`, [ADR 0044](../../docs/adr/0044-pixel-dimensions-live-on-the-wallpaper-row.md)).
///
/// Stored as `WIDTHxHEIGHT` and crossing the IPC as the two numbers, because the
/// callers want different halves of it: the crop preview takes the ratio and the
/// undersized check takes the pixels. Zero in either axis is not a size, so it
/// cannot be constructed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

impl Resolution {
    /// A size, or nothing when either axis is zero — which is what a monitor the
    /// platform could not measure reports.
    pub fn new(width: u32, height: u32) -> Option<Self> {
        (width > 0 && height > 0).then_some(Self { width, height })
    }

    /// The stored form, `WIDTHxHEIGHT`, as strictly as it is written.
    ///
    /// Anything else is a row someone edited by hand, and a forgiving parse
    /// would have to guess which of `1920 x 1080` and `1920X1080` the curator
    /// meant by the other one. Reading it as the default instead is the rule the
    /// whole module already follows.
    fn parse(value: &str) -> Option<Self> {
        let (width, height) = value.split_once('x')?;
        Self::new(width.parse().ok()?, height.parse().ok()?)
    }
}

impl fmt::Display for Resolution {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}x{}", self.width, self.height)
    }
}

/// What the machine, rather than the curator, contributes to the defaults.
///
/// It arrives from `lib.rs`, which is the only place that can ask a monitor its
/// size. A named type rather than a bare [`Resolution`] parameter so that every
/// signature it threads through says which of the two sizes in this module it
/// is, and so that "detection found nothing" has a spelling —
/// [`Detected::default`] — rather than being a constant each caller reaches for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Detected {
    pub screen: Resolution,
}

impl Detected {
    /// What detection amounts to, given whatever the platform said the primary
    /// monitor measures.
    ///
    /// The decision `lib.rs` cannot test, split from the Tauri call that cannot
    /// run without an app handle: `None` is a platform with no monitor to name
    /// or an error reading it, and a zero axis is a monitor it would not
    /// measure. Both leave [`FALLBACK_SCREEN`] standing, because a curator with
    /// an undescribable monitor gets a working app and a field to correct rather
    /// than a launch that failed over a default.
    pub fn from_monitor(measured: Option<(u32, u32)>) -> Self {
        match measured.and_then(|(width, height)| Resolution::new(width, height)) {
            Some(screen) => Self { screen },
            None => Self::default(),
        }
    }
}

impl Default for Detected {
    fn default() -> Self {
        Self {
            screen: FALLBACK_SCREEN,
        }
    }
}

/// How the Library draws its wallpapers: cropped to one shape, or each at its
/// own — packed into columns, or lined up in rows.
///
/// A choice per tab rather than one for the app, so a browse surface and a
/// decision queue are not obliged to look alike. This key is the Library tab's;
/// Review's is its own, and neither is offered in the Settings view — the
/// control sits on the page bar of the tab it changes, because a control in two
/// places is two places to look.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryLayout {
    /// The uniform grid: every wallpaper cropped to fill a box of one shape.
    Grid,
    /// Columns packed shortest-first, every wallpaper at its own aspect ratio.
    Masonry,
    /// Rows scaled to a shared height, uncropped, with the rank drawn large
    /// behind each image.
    Justified,
}

impl LibraryLayout {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "grid" => Some(Self::Grid),
            "masonry" => Some(Self::Masonry),
            "justified" => Some(Self::Justified),
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
    /// Which layout the Library tab draws, remembered across restarts.
    pub library_layout: LibraryLayout,
    /// The screen the curator is curating for, defaulting to the monitor.
    ///
    /// One screen and not two: the crop preview reads its ratio and the
    /// undersized check reads its pixels, and two settings holding the same fact
    /// can disagree.
    pub screen: Resolution,
    /// The smallest a wallpaper may be before it reads as undersized,
    /// defaulting to [`Settings::screen`] rather than to a constant.
    ///
    /// Separate from the screen so that a curator can be stricter or looser than
    /// their exact pixels without lying to the crop preview about what they are
    /// looking at.
    pub minimum_resolution: Resolution,
    /// Which layout Review draws its worklist in, remembered across launches
    /// and held apart from whatever Library is drawing.
    pub review_layout: ReviewLayout,
    /// What the monitor said, which is what [`Settings::screen`] reads as until
    /// the curator overrides it.
    ///
    /// Not a setting: no row can change it and [`set`] refuses the key like any
    /// other unknown one. It rides along on the settings answer because the
    /// Settings page needs it to name the value an override is overriding and to
    /// offer it back — the one default on that page a curator could not
    /// otherwise recover.
    pub detected_screen: Resolution,
}

impl Settings {
    /// What every key means with no row in the table at all.
    ///
    /// `minimum_resolution` reads as the detected screen here because with no
    /// rows that is what the screen reads as. Its default is the screen rather
    /// than a constant, so [`resolve`] works it out again once the screen's own
    /// row has been read.
    pub fn defaults(detected: Detected) -> Self {
        Self {
            theme: Theme::System,
            library_root: String::new(),
            reject_destination: "./rejected".to_string(),
            // The layout the app has always had, so a curator who ignores the
            // control sees exactly what they saw before it existed.
            library_layout: LibraryLayout::Grid,
            screen: detected.screen,
            minimum_resolution: detected.screen,
            review_layout: ReviewLayout::default(),
            detected_screen: detected.screen,
        }
    }
}

/// Every setting, with the gaps filled from the defaults, so a caller always
/// receives a complete struct.
pub fn get(conn: &Connection, detected: Detected) -> Result<Settings, AppError> {
    Ok(resolve(&stored(conn)?, detected))
}

/// Writes one setting and returns every setting, so a stale read cannot survive
/// a write.
pub fn set(
    conn: &Connection,
    key: &str,
    value: &str,
    detected: Detected,
) -> Result<Settings, AppError> {
    // What this key would read as with its row gone, which is the one question
    // "is this the default" asks. Reading it off the table rather than off
    // `Settings::defaults` is what lets a default *be* another setting:
    // `minimum_resolution` has to be compared against the stored screen, not
    // against the detected one.
    let mut without = stored(conn)?;
    without.remove(key);
    let without = resolve(&without, detected);

    if is_default(key, value, &without)? {
        // The only reset the app has, and the reason most keys need no control:
        // typing `./rejected` back into the field would otherwise write a row
        // identical to the default and break the property the store rests on.
        // `get` fills gaps from the defaults, so absent and default-valued read
        // the same to every caller.
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
    get(conn, detected)
}

/// Every row in the table, under the key it was written with.
fn stored(conn: &Connection) -> Result<HashMap<String, String>, AppError> {
    let mut stmt = conn.prepare_cached("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut table = HashMap::new();
    for row in rows {
        let (key, value) = row?;
        table.insert(key, value);
    }
    Ok(table)
}

/// The stored rows as a complete struct, each key falling back to its default
/// where there is no row and where the row will not read.
///
/// Nothing here fails. An unknown key is a row a newer version wrote and a
/// downgrade found, and a value that will not parse is a row someone edited by
/// hand, so boot never fails over a preference.
fn resolve(stored: &HashMap<String, String>, detected: Detected) -> Settings {
    let defaults = Settings::defaults(detected);
    let text = |key: &str| stored.get(key).cloned();

    let screen = read(stored, SCREEN, Resolution::parse).unwrap_or(defaults.screen);

    Settings {
        theme: read(stored, THEME, Theme::parse).unwrap_or(defaults.theme),
        library_root: text(LIBRARY_ROOT).unwrap_or(defaults.library_root),
        reject_destination: text(REJECT_DESTINATION).unwrap_or(defaults.reject_destination),
        library_layout: read(stored, LIBRARY_LAYOUT, LibraryLayout::parse)
            .unwrap_or(defaults.library_layout),
        screen,
        // The one default that is another setting rather than a constant, which
        // is why it is resolved after the screen rather than beside it.
        minimum_resolution: read(stored, MINIMUM_RESOLUTION, Resolution::parse).unwrap_or(screen),
        review_layout: read(stored, REVIEW_LAYOUT, ReviewLayout::parse)
            .unwrap_or(defaults.review_layout),
        // Never read off the table: it is what the monitor said, and the table
        // holds what the curator said.
        detected_screen: detected.screen,
    }
}

/// One stored row, read through `parse`, or nothing when there is no row or the
/// row will not read.
fn read<T>(
    stored: &HashMap<String, String>,
    key: &str,
    parse: impl Fn(&str) -> Option<T>,
) -> Option<T> {
    let raw = stored.get(key)?;
    match parse(raw) {
        Some(value) => Some(value),
        None => {
            eprintln!("settings: {key} holds {raw:?}, which it cannot read; using the default");
            None
        }
    }
}

/// Whether `value` is what `key` already means with no row at all, refusing an
/// unknown key or an unreadable value on the way.
///
/// The comparison runs against a resolved `Settings` rather than a second table
/// of default strings, so the defaults are stated once.
fn is_default(key: &str, value: &str, without: &Settings) -> Result<bool, AppError> {
    match key {
        THEME => {
            let theme = Theme::parse(value).ok_or_else(|| {
                AppError::BadRequest(format!(
                    "{value:?} is not a theme; expected system, light or dark"
                ))
            })?;
            Ok(theme == without.theme)
        }
        // A Written path is stored as written and never checked against the
        // filesystem: an unmounted drive is not a bad setting.
        LIBRARY_ROOT => Ok(value == without.library_root),
        REJECT_DESTINATION => Ok(value == without.reject_destination),
        LIBRARY_LAYOUT => {
            let layout = LibraryLayout::parse(value).ok_or_else(|| {
                AppError::BadRequest(format!(
                    "{value:?} is not a layout; expected grid, masonry or justified"
                ))
            })?;
            Ok(layout == without.library_layout)
        }
        SCREEN => Ok(resolution(value)? == without.screen),
        MINIMUM_RESOLUTION => Ok(resolution(value)? == without.minimum_resolution),
        REVIEW_LAYOUT => {
            let layout = ReviewLayout::parse(value).ok_or_else(|| {
                AppError::BadRequest(format!(
                    "{value:?} is not a Review layout; expected strip or grid"
                ))
            })?;
            Ok(layout == without.review_layout)
        }
        _ => Err(AppError::BadRequest(format!("unknown setting {key:?}"))),
    }
}

/// A size on the way in, or the sentence that says why it is not one.
fn resolution(value: &str) -> Result<Resolution, AppError> {
    Resolution::parse(value).ok_or_else(|| {
        AppError::BadRequest(format!(
            "{value:?} is not a size; expected width by height, as in 1920x1080"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    /// What detection answered with on the machine these tests stand in for.
    ///
    /// Deliberately neither [`FALLBACK_SCREEN`] nor any size a test writes, so a
    /// default that came from the wrong place is a failure rather than a
    /// coincidence.
    fn detected() -> Detected {
        Detected {
            screen: size(3840, 2160),
        }
    }

    fn size(width: u32, height: u32) -> Resolution {
        Resolution::new(width, height).expect("test sizes are sizes")
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

        assert_eq!(
            get(&conn, detected()).unwrap(),
            Settings::defaults(detected())
        );
        assert_eq!(
            get(&conn, detected()).unwrap(),
            Settings {
                theme: Theme::System,
                library_root: String::new(),
                reject_destination: "./rejected".to_string(),
                library_layout: LibraryLayout::Grid,
                screen: size(3840, 2160),
                minimum_resolution: size(3840, 2160),
                review_layout: ReviewLayout::Grid,
                detected_screen: size(3840, 2160),
            }
        );
    }

    #[test]
    fn a_write_then_a_read_round_trips_and_leaves_the_other_keys_alone() {
        let conn = store();

        set(&conn, "library_root", "~/pics", detected()).unwrap();

        let settings = get(&conn, detected()).unwrap();
        assert_eq!(settings.library_root, "~/pics");
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.reject_destination, "./rejected");
        assert_eq!(settings.screen, size(3840, 2160));
        assert_eq!(settings.minimum_resolution, size(3840, 2160));
    }

    #[test]
    fn the_screen_defaults_to_the_monitor_detection_found() {
        let conn = store();

        assert_eq!(get(&conn, detected()).unwrap().screen, size(3840, 2160));
        assert_eq!(
            get(
                &conn,
                Detected {
                    screen: size(2560, 1440)
                }
            )
            .unwrap()
            .screen,
            size(2560, 1440)
        );
        // Nothing was written to reach either answer: the detected screen is a
        // default, so a curator who swaps monitors gets the new one rather than
        // the one that happened to be plugged in on their first launch.
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn a_detection_that_failed_leaves_a_usable_screen_rather_than_an_error() {
        let conn = store();

        let settings = get(&conn, Detected::default()).unwrap();

        assert_eq!(settings.screen, FALLBACK_SCREEN);
        assert_eq!(settings.minimum_resolution, FALLBACK_SCREEN);
    }

    #[test]
    fn every_way_the_platform_can_fail_to_name_a_monitor_lands_on_the_fallback() {
        // The three answers `lib.rs` can get out of `primary_monitor`, which it
        // hands straight to this function: a size, no monitor at all or an error
        // reading one, and a monitor it would not measure.
        assert_eq!(
            Detected::from_monitor(Some((2560, 1440))).screen,
            size(2560, 1440)
        );

        for unusable in [None, Some((0, 1080)), Some((1920, 0)), Some((0, 0))] {
            assert_eq!(
                Detected::from_monitor(unusable).screen,
                FALLBACK_SCREEN,
                "{unusable:?}"
            );
        }
    }

    #[test]
    fn the_screen_can_be_overridden_and_changed_back() {
        let conn = store();

        let overridden = set(&conn, "screen", "2560x1440", detected()).unwrap();
        assert_eq!(overridden.screen, size(2560, 1440));
        assert_eq!(get(&conn, detected()).unwrap(), overridden);
        assert_eq!(stored_rows(&conn), 1);

        // Writing the detected screen back is what clears the override, which is
        // the same reset every other key on the page has (ADR 0010).
        let back = set(&conn, "screen", "3840x2160", detected()).unwrap();
        assert_eq!(back.screen, size(3840, 2160));
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn a_screen_write_leaves_the_other_keys_alone() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "library_root", "~/pics", detected()).unwrap();

        let settings = set(&conn, "screen", "2560x1440", detected()).unwrap();

        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.library_root, "~/pics");
        assert_eq!(settings.reject_destination, "./rejected");
    }

    #[test]
    fn the_minimum_resolution_follows_the_screen_until_it_is_set() {
        let conn = store();
        assert_eq!(
            get(&conn, detected()).unwrap().minimum_resolution,
            size(3840, 2160)
        );

        // The override moves it, because the default is the screen the curator
        // says they have rather than the one the platform reported.
        let overridden = set(&conn, "screen", "2560x1440", detected()).unwrap();
        assert_eq!(overridden.minimum_resolution, size(2560, 1440));

        // And it stops following the moment the curator states one.
        let stricter = set(&conn, "minimum_resolution", "1920x1080", detected()).unwrap();
        assert_eq!(stricter.minimum_resolution, size(1920, 1080));
        assert_eq!(stricter.screen, size(2560, 1440));
        assert_eq!(
            set(&conn, "screen", "3840x2160", detected())
                .unwrap()
                .minimum_resolution,
            size(1920, 1080)
        );
    }

    #[test]
    fn the_minimum_resolution_goes_back_to_the_default_by_being_written_the_screen() {
        let conn = store();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        set(&conn, "minimum_resolution", "1280x720", detected()).unwrap();
        assert_eq!(stored_rows(&conn), 2);

        // The screen as it currently reads, not the detected one: a default that
        // is another setting is compared against that setting.
        let returned = set(&conn, "minimum_resolution", "2560x1440", detected()).unwrap();

        assert_eq!(returned.minimum_resolution, size(2560, 1440));
        assert_eq!(get(&conn, detected()).unwrap(), returned);
        assert_eq!(stored_rows(&conn), 1);
    }

    #[test]
    fn a_size_that_is_not_one_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        let before = get(&conn, detected()).unwrap();

        for refused in [
            "1920",
            "1920x",
            "wide x tall",
            "0x1080",
            "1920x0",
            "-1x1080",
        ] {
            let err = set(&conn, "screen", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), before);
    }

    #[test]
    fn the_detected_screen_rides_along_and_is_not_a_key_anyone_can_write() {
        let conn = store();
        set(&conn, "screen", "2560x1440", detected()).unwrap();

        let settings = get(&conn, detected()).unwrap();

        // The override moved the screen and left the readout the Settings page
        // offers back alone.
        assert_eq!(settings.screen, size(2560, 1440));
        assert_eq!(settings.detected_screen, size(3840, 2160));

        let err = set(&conn, "detected_screen", "1280x720", detected()).unwrap_err();
        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("detected_screen")),
            "got {err:?}"
        );
        assert_eq!(get(&conn, detected()).unwrap(), settings);
    }

    #[test]
    fn a_screen_row_that_will_not_read_falls_back_to_the_detected_monitor() {
        // Boot never fails over a preference, and a size is one more row someone
        // can edit by hand.
        let conn = store();
        write_raw_row(&conn, "screen", "enormous");
        write_raw_row(&conn, "minimum_resolution", "0x0");

        let settings = get(&conn, detected()).unwrap();

        assert_eq!(settings.screen, size(3840, 2160));
        assert_eq!(settings.minimum_resolution, size(3840, 2160));
    }

    #[test]
    fn review_starts_on_the_grid_it_has_always_drawn() {
        let conn = store();

        assert_eq!(
            get(&conn, detected()).unwrap().review_layout,
            ReviewLayout::Grid
        );
        // Nothing was written to reach that answer, so a curator who never opens
        // the control has no row and sees the page they already had.
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn the_review_layout_survives_the_connection_that_wrote_it() {
        // The whole point of storing it: a layout that resets on every launch is
        // a control the curator presses every session.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            let written = set(&conn, "review_layout", "strip", detected()).unwrap();
            assert_eq!(written.review_layout, ReviewLayout::Strip);
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(
            get(&conn, detected()).unwrap().review_layout,
            ReviewLayout::Strip
        );
    }

    #[test]
    fn a_review_layout_write_leaves_the_other_keys_alone() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();

        let settings = set(&conn, "review_layout", "strip", detected()).unwrap();

        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.screen, size(2560, 1440));
        assert_eq!(settings.minimum_resolution, size(2560, 1440));
        assert_eq!(settings.review_layout, ReviewLayout::Strip);
    }

    #[test]
    fn a_review_layout_that_is_not_one_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "review_layout", "strip", detected()).unwrap();
        let before = get(&conn, detected()).unwrap();

        for refused in ["masonry", "Strip", "", "justified"] {
            let err = set(&conn, "review_layout", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), before);
    }

    #[test]
    fn a_review_layout_row_that_will_not_read_falls_back_to_the_grid() {
        // Boot never fails over a preference, and a layout is one more row
        // someone can edit by hand.
        let conn = store();
        write_raw_row(&conn, "review_layout", "filmstrip");

        assert_eq!(
            get(&conn, detected()).unwrap().review_layout,
            ReviewLayout::Grid
        );
    }

    #[test]
    fn a_written_path_is_stored_exactly_as_written() {
        // ADR 0011: expanding at write time would freeze whatever a variable
        // meant during one session, and would show the user a path they never
        // typed.
        let conn = store();

        for written in ["~/pics", "$XDG_PICTURES_DIR/walls", "./relative"] {
            assert_eq!(
                set(&conn, "library_root", written, detected())
                    .unwrap()
                    .library_root,
                written
            );
        }
    }

    #[test]
    fn a_write_returns_the_whole_struct_with_the_new_value_in_it() {
        let conn = store();
        set(&conn, "library_root", "/pics", detected()).unwrap();

        let returned = set(&conn, "theme", "dark", detected()).unwrap();

        assert_eq!(returned.theme, Theme::Dark);
        assert_eq!(returned.library_root, "/pics");
        assert_eq!(returned, get(&conn, detected()).unwrap());
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
            set(&conn, "reject_destination", "~/pics/rejected", detected()).unwrap();
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(
            get(&conn, detected()).unwrap().reject_destination,
            "~/pics/rejected"
        );
    }

    #[test]
    fn an_unknown_key_on_write_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "theme", "light", detected()).unwrap();
        let before = get(&conn, detected()).unwrap();

        let err = set(&conn, "review_limit", "100", detected()).unwrap_err();

        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("review_limit")),
            "got {err:?}"
        );
        assert_eq!(get(&conn, detected()).unwrap(), before);
        assert_eq!(stored_rows(&conn), 1);
    }

    #[test]
    fn an_invalid_theme_on_write_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();

        let err = set(&conn, "theme", "solarized", detected()).unwrap_err();

        assert!(matches!(err, AppError::BadRequest(_)), "got {err:?}");
        assert_eq!(get(&conn, detected()).unwrap().theme, Theme::Dark);
    }

    #[test]
    fn a_row_holding_garbage_reads_as_the_default_rather_than_failing() {
        // Boot never fails over a preference: a bad row must not lock the user
        // out of the app that would let them fix it.
        let conn = store();
        write_raw_row(&conn, "theme", "chartreuse");
        write_raw_row(&conn, "library_root", "/pics");

        let settings = get(&conn, detected()).unwrap();

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

        let settings = get(&conn, detected()).unwrap();

        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(
            settings.library_root,
            Settings::defaults(detected()).library_root
        );
    }

    #[test]
    fn writing_a_value_equal_to_the_default_deletes_the_row() {
        let conn = store();
        set(&conn, "reject_destination", "/bin/walls", detected()).unwrap();
        set(&conn, "theme", "dark", detected()).unwrap();
        assert_eq!(stored_rows(&conn), 2);

        let returned = set(&conn, "reject_destination", "./rejected", detected()).unwrap();

        // The read is unchanged by the delete, which is why no reset command and
        // no reset control exists.
        assert_eq!(returned.reject_destination, "./rejected");
        assert_eq!(get(&conn, detected()).unwrap(), returned);
        assert_eq!(stored_rows(&conn), 1);
    }

    #[test]
    fn every_key_can_be_written_back_to_its_default() {
        let conn = store();
        set(&conn, "theme", "light", detected()).unwrap();
        set(&conn, "library_root", "/pics", detected()).unwrap();
        set(&conn, "reject_destination", "/bin", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        set(&conn, "minimum_resolution", "1280x720", detected()).unwrap();
        set(&conn, "review_layout", "strip", detected()).unwrap();
        set(&conn, "library_layout", "masonry", detected()).unwrap();

        set(&conn, "theme", "system", detected()).unwrap();
        set(&conn, "library_root", "", detected()).unwrap();
        set(&conn, "reject_destination", "./rejected", detected()).unwrap();
        set(&conn, "review_layout", "grid", detected()).unwrap();
        set(&conn, "library_layout", "grid", detected()).unwrap();
        // The minimum resolution goes back first, against the overridden screen
        // it currently defaults to. Doing it the other way round would mean
        // writing 3840x2160 into a key whose default had already moved there,
        // which is the same reset arriving by a different route.
        set(&conn, "minimum_resolution", "2560x1440", detected()).unwrap();
        let returned = set(&conn, "screen", "3840x2160", detected()).unwrap();

        assert_eq!(returned, Settings::defaults(detected()));
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn the_library_layout_round_trips_and_survives_the_connection_that_wrote_it() {
        // The whole of what the control on the Library bar promises: a layout
        // picked once and still there on the next launch.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            assert_eq!(
                get(&conn, detected()).unwrap().library_layout,
                LibraryLayout::Grid
            );
            let returned = set(&conn, "library_layout", "masonry", detected()).unwrap();
            assert_eq!(returned.library_layout, LibraryLayout::Masonry);
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(
            get(&conn, detected()).unwrap().library_layout,
            LibraryLayout::Masonry
        );
        // And it is the Library's alone: nothing else moved with it.
        assert_eq!(get(&conn, detected()).unwrap().theme, Theme::System);
    }

    #[test]
    fn an_invalid_library_layout_on_write_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "library_layout", "masonry", detected()).unwrap();

        let err = set(&conn, "library_layout", "mosaic", detected()).unwrap_err();

        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("mosaic")),
            "got {err:?}"
        );
        assert_eq!(
            get(&conn, detected()).unwrap().library_layout,
            LibraryLayout::Masonry
        );
    }

    #[test]
    fn justified_rows_are_a_layout_the_store_takes_and_gives_back() {
        // The third layout (#263), which the key has to carry as readily as the
        // two before it: one column of storage, three names in it.
        let conn = store();

        let returned = set(&conn, "library_layout", "justified", detected()).unwrap();

        assert_eq!(returned.library_layout, LibraryLayout::Justified);
        assert_eq!(
            get(&conn, detected()).unwrap().library_layout,
            LibraryLayout::Justified
        );
        // And back to the grid leaves no row behind, the way every other default
        // does.
        set(&conn, "library_layout", "grid", detected()).unwrap();
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn a_library_layout_row_holding_garbage_reads_as_the_grid() {
        // Boot never fails over a preference, and a layout nothing can draw is
        // the layout the app has always had rather than a blank page.
        let conn = store();
        write_raw_row(&conn, "library_layout", "mosaic");

        assert_eq!(
            get(&conn, detected()).unwrap().library_layout,
            LibraryLayout::Grid
        );
    }

    #[test]
    fn settings_cross_the_ipc_with_the_fields_client_ts_expects() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "library_root", "~/pics", detected()).unwrap();
        set(&conn, "library_layout", "masonry", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        set(&conn, "review_layout", "strip", detected()).unwrap();

        let json = serde_json::to_value(get(&conn, detected()).unwrap()).unwrap();

        // The theme crosses as the same string a write accepts, so the frontend
        // can hand a read value straight back to `set_setting`.
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["library_root"], "~/pics");
        assert_eq!(json["reject_destination"], "./rejected");
        // A layout crosses as the same string a write accepts, the way the theme
        // does, so the frontend can hand a read value straight back.
        assert_eq!(json["library_layout"], "masonry");
        // A size crosses as the two numbers rather than as the `2560x1440` the
        // column holds, because its readers want different halves of it.
        // `encodeSetting` in `client.ts` writes the stored form back.
        assert_eq!(json["screen"]["width"], 2560);
        assert_eq!(json["screen"]["height"], 1440);
        assert_eq!(json["minimum_resolution"]["width"], 2560);
        assert_eq!(json["detected_screen"]["width"], 3840);
        assert_eq!(json["detected_screen"]["height"], 2160);
        // A layout crosses as the same string a write accepts, so the frontend
        // can hand a read value straight back to `set_setting`.
        assert_eq!(json["review_layout"], "strip");
    }
}
