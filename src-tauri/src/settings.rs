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
const CROP_PREVIEW: &str = "crop_preview";
const REVIEW_WORKLIST_SIZE: &str = "review_worklist_size";
const STARTUP_VIEW: &str = "startup_view";
const REVIEW_ORDERING: &str = "review_ordering";
const EVALUATED_THRESHOLD: &str = "evaluated_threshold";

/// The σ a wallpaper's rating has to fall below to count as Evaluated, unless
/// the curator says otherwise.
///
/// The number Evaluated meant when it was a constant, so a curator who never
/// opens the control sees the same count and the same badges they always did
/// (`CONTEXT.md`, [ADR 0046](../../docs/adr/0046-the-evaluated-threshold-is-the-curators.md)).
pub const DEFAULT_EVALUATED_THRESHOLD: f64 = 4.0;

/// The three thresholds Settings offers, loosest first.
///
/// A preset list and not a free number, which is the rule the epic already set
/// for the Review worklist size: σ is the app's own uncertainty scale, and a
/// curator typing `6.5` into it is guessing at a unit nothing on the page can
/// explain. Three named confidences bracket the starting σ of 8.333 — half of
/// it, and a step either side.
pub const EVALUATED_THRESHOLDS: [f64; 3] = [5.0, DEFAULT_EVALUATED_THRESHOLD, 3.0];
/// The screen to assume when the platform will not name one.
///
/// Detection failing is not an error state: the curator gets a working app with
/// a common screen behind it and a field in Settings to correct it.
pub const FALLBACK_SCREEN: Resolution = Resolution {
    width: 1920,
    height: 1080,
};

/// A key whose legal values are a closed list, and the one place that list is
/// written down.
///
/// Both halves of a strict write come out of it: [`Vocabulary::parse`] takes
/// exactly the spellings of [`Vocabulary::values`], and the refusal
/// [`Vocabulary::written`] returns names exactly those spellings. They used to
/// be two lists per key — a hand-written parse, and a sentence beside it naming
/// the values again — with nothing checking one against the other.
///
/// The spelling is the only text a value has, in the column and on the way in
/// alike: exactly what `String(value)` in `client.ts` produces for the value a
/// read handed it. Anything else is a row someone edited by hand, and a
/// forgiving parse would have to decide what `TRUE`, `+10` and `4.0` were each
/// meant to be.
trait Vocabulary: Copy {
    /// What a refusal calls a value of this key, article included.
    const NOUN: &'static str;

    /// Every value the key can hold, in the order a refusal names them.
    fn values() -> impl Iterator<Item = Self>;

    /// The text `self` is stored as.
    fn spelling(self) -> String;

    /// The value `text` spells, or nothing when it spells none of them.
    fn parse(text: &str) -> Option<Self> {
        Self::values().find(|value| value.spelling() == text)
    }

    /// A value on its way into the table, or the refusal naming every value it
    /// could have been.
    fn written(text: &str) -> Result<Self, AppError> {
        Self::parse(text).ok_or_else(|| {
            let spellings: Vec<String> = Self::values().map(Self::spelling).collect();
            AppError::BadRequest(format!(
                "{text:?} is not {}; expected {}",
                Self::NOUN,
                listed(&spellings)
            ))
        })
    }
}

/// `a`, `a or b`, `a, b or c`: a list the way the refusals say one.
fn listed(words: &[String]) -> String {
    match words.split_last() {
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
        None => String::new(),
    }
}

/// Declares an enum-valued key's type and its [`Vocabulary`] together, each
/// variant written once beside the spelling it is stored as.
///
/// `Serialize` comes from the same spellings rather than from a derive with
/// `rename_all`. The frontend hands a value it read straight back to
/// `set_setting`, so the spelling a read sends has to be one the parse takes,
/// and a second declaration of it is a second place for the two to part.
macro_rules! vocabulary {
    (
        $(#[$attr:meta])*
        pub enum $name:ident: $noun:literal {
            $( $(#[$variant_attr:meta])* $variant:ident => $spelling:literal, )+
        }
    ) => {
        $(#[$attr])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name {
            $( $(#[$variant_attr])* $variant, )+
        }

        impl Vocabulary for $name {
            const NOUN: &'static str = $noun;

            fn values() -> impl Iterator<Item = Self> {
                [$(Self::$variant),+].into_iter()
            }

            fn spelling(self) -> String {
                match self {
                    $(Self::$variant => $spelling,)+
                }
                .to_string()
            }
        }

        impl Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.spelling())
            }
        }
    };
}

vocabulary! {
    pub enum Theme: "a theme" {
        System => "system",
        Light => "light",
        Dark => "dark",
    }
}

vocabulary! {
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
    #[derive(Default)]
    pub enum ReviewLayout: "a Review layout" {
        /// One wallpaper at the size it would be hung, with the worklist beneath it.
        Strip => "strip",
        /// The uniform grid of cards Review has always drawn.
        #[default]
        Grid => "grid",
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

vocabulary! {
    /// How the Library draws its wallpapers: cropped to one shape, or each at its
    /// own — packed into columns, or lined up in rows.
    ///
    /// A choice per tab rather than one for the app, so a browse surface and a
    /// decision queue are not obliged to look alike. This key is the Library tab's;
    /// Review's is its own, and neither is offered in the Settings view — the
    /// control sits on the page bar of the tab it changes, because a control in two
    /// places is two places to look.
    pub enum LibraryLayout: "a layout" {
        /// The uniform grid: every wallpaper cropped to fill a box of one shape.
        Grid => "grid",
        /// Columns packed shortest-first, every wallpaper at its own aspect ratio.
        Masonry => "masonry",
        /// Rows scaled to a shared height, uncropped, with the rank drawn large
        /// behind each image.
        Justified => "justified",
    }
}

/// The worklist lengths Review offers, shortest first.
///
/// Four presets rather than a number the curator types, because the question is
/// how long a session to sit down to and not how many rows a query returns —
/// and the four answers to that are a short sweep, a normal one, the fifty the
/// app has always shown, and a long one.
pub const WORKLIST_SIZES: [u32; 4] = [10, 25, 50, 100];

/// How many wallpapers Review puts in front of the curator at once.
///
/// A count that is one of [`WORKLIST_SIZES`] and cannot be anything else, the
/// way a [`Resolution`] cannot have a zero axis: the presets are the setting
/// rather than a list the UI happens to offer, so a size off the list is
/// refused here and not only in the control that writes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct WorklistSize(u32);

impl WorklistSize {
    /// A worklist size, or nothing when `count` is not one of the presets.
    ///
    /// Only the tests build one from a bare count. The app gets its sizes from
    /// the stored spelling, through the same [`Vocabulary`] the refusal names.
    #[cfg(test)]
    pub fn new(count: u32) -> Option<Self> {
        WORKLIST_SIZES.contains(&count).then_some(Self(count))
    }
}

impl Vocabulary for WorklistSize {
    const NOUN: &'static str = "a worklist size";

    fn values() -> impl Iterator<Item = Self> {
        WORKLIST_SIZES.into_iter().map(Self)
    }

    fn spelling(self) -> String {
        self.to_string()
    }
}

impl fmt::Display for WorklistSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// The fifty Review has shown since it was a hardcoded `LIMIT`, so a curator who
/// never opens the section sees the worklist they already had (ADR 0028).
pub const DEFAULT_WORKLIST_SIZE: WorklistSize = WorklistSize(50);

vocabulary! {
    /// Which view the app opens on.
    ///
    /// A fixed choice and not wherever the curator was last, because an app that
    /// opens somewhere different every launch is disorienting — which is also
    /// [ADR 0015](../../docs/adr/0015-navigation-shell.md)'s reason for persisting
    /// nothing about navigation, and this is the stated preference that decision
    /// left room for rather than the session memory it refused.
    ///
    /// Settings is not one of them. The other three are where a curator works; the
    /// Settings page is where they go to stop working, and boot still opens it on
    /// its own when there is nothing else to show.
    pub enum StartupView: "a startup view" {
        Rank => "rank",
        Review => "review",
        Library => "library",
    }
}

vocabulary! {
    /// Which end of the ranking Review works from.
    ///
    /// Two orderings and not the library page's four: Review is a decision queue,
    /// and filename order in one means nothing. They are spelled as the two
    /// [`crate::db::ListOrdering`] variants they stand for rather than as a second
    /// vocabulary for the same fact, so the value the frontend reads is the value it
    /// hands back to `list_wallpapers` (ADR 0028).
    pub enum ReviewOrdering: "a review ordering" {
        /// Lowest Scores first: culling the worst, which is what Review has always
        /// done (ADR 0013).
        ScoreAsc => "score_asc",
        /// Highest Scores first: confirming favourites.
        ScoreDesc => "score_desc",
    }
}

/// A flag: the two spellings `String(boolean)` produces, and no others.
impl Vocabulary for bool {
    const NOUN: &'static str = "a flag";

    fn values() -> impl Iterator<Item = Self> {
        [true, false].into_iter()
    }

    fn spelling(self) -> String {
        self.to_string()
    }
}

/// One of the [`EVALUATED_THRESHOLDS`], on its way in or out of the table.
///
/// Private and unwrapped at every edge, because [`Settings`] carries the bare σ
/// and so does [`evaluated_threshold`] (ADR 0046). It exists so the vocabulary
/// hangs on something narrower than every float.
///
/// Strict for the same reason [`Resolution::parse`] is: a row holding `4.2` is
/// one someone edited by hand, and honouring it would put the curator on a
/// confidence no control can show them or change back. Reading it as the default
/// is the rule the whole module already follows.
#[derive(Clone, Copy)]
struct Threshold(f64);

impl Vocabulary for Threshold {
    const NOUN: &'static str = "an Evaluated threshold";

    fn values() -> impl Iterator<Item = Self> {
        EVALUATED_THRESHOLDS.into_iter().map(Self)
    }

    fn spelling(self) -> String {
        // Every offered threshold is a short decimal that binary floating point
        // holds exactly, and `f64::to_string` writes each one the way
        // `String(number)` does: `4`, never `4.0`.
        self.0.to_string()
    }
}

/// Every setting, with the gaps filled from the defaults.
///
/// `Eq` is deliberately absent: [`Settings::evaluated_threshold`] is a float, and
/// the three values it can hold compare exactly, but the trait would be claiming
/// more than a float can keep.
#[derive(Clone, Debug, PartialEq, Serialize)]
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
    /// How many wallpapers Review puts in front of the curator at once.
    pub review_worklist_size: WorklistSize,
    /// Which view the app opens on.
    pub startup_view: StartupView,
    /// Which end of the ranking Review works from.
    pub review_ordering: ReviewOrdering,
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
    /// Whether the crop preview is up: the bars showing what the Screen would
    /// discard, in the Review strip and the Lightbox.
    ///
    /// A toggle rather than a hold, and so a thing to remember: the bars stay up
    /// while the curator works through a run, and a curator who always wants
    /// them should not turn them on every session
    /// ([#266](https://github.com/QuantumFF/walltare/issues/266)).
    ///
    /// Stored here for the reason the two layouts are — the store is what
    /// survives a restart — and offered nowhere in the Settings view for the
    /// same reason either: the control is the `C` key on the surface it draws
    /// on, and a control in two places is two places to look.
    ///
    /// Off by default, so a curator who never presses `C` sees the app they
    /// already had.
    pub crop_preview: bool,
    /// The σ below which a wallpaper's rating counts as Evaluated.
    ///
    /// The curator's answer to how many Comparisons make a Score trustworthy,
    /// rather than a fact about the wallpaper: it moves the count in the Rank
    /// headline and the badge on every card together, because both read this one
    /// number (`CONTEXT.md`,
    /// [ADR 0046](../../docs/adr/0046-the-evaluated-threshold-is-the-curators.md)).
    pub evaluated_threshold: f64,
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
            // The fifty Review has always shown, the view the boot rule has
            // always preferred, and the lowest-Scores-first it has always
            // listed: three defaults that leave the app behaving exactly as it
            // did before any of them could be stated.
            review_worklist_size: DEFAULT_WORKLIST_SIZE,
            startup_view: StartupView::Rank,
            review_ordering: ReviewOrdering::ScoreAsc,
            screen: detected.screen,
            minimum_resolution: detected.screen,
            review_layout: ReviewLayout::default(),
            crop_preview: false,
            // What Evaluated meant while it was a constant, so nothing moves for
            // a curator who ignores the control.
            evaluated_threshold: DEFAULT_EVALUATED_THRESHOLD,
            detected_screen: detected.screen,
        }
    }
}

/// The Evaluated threshold alone, for the one caller that wants it without the
/// rest of the struct.
///
/// `voting::get_stats` counts the Evaluated wallpapers against it and has no
/// [`Detected`] to hand, which every other reader of this module arrives with.
/// It goes through the same [`stored`], the same [`read`] and the same default as
/// [`resolve`], so the count and the struct the card reads cannot disagree about
/// what the row says.
pub fn evaluated_threshold(conn: &Connection) -> Result<f64, AppError> {
    Ok(read(&stored(conn)?, EVALUATED_THRESHOLD, Threshold::parse)
        .map_or(DEFAULT_EVALUATED_THRESHOLD, |threshold| threshold.0))
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
        review_worklist_size: read(stored, REVIEW_WORKLIST_SIZE, WorklistSize::parse)
            .unwrap_or(defaults.review_worklist_size),
        startup_view: read(stored, STARTUP_VIEW, StartupView::parse)
            .unwrap_or(defaults.startup_view),
        review_ordering: read(stored, REVIEW_ORDERING, ReviewOrdering::parse)
            .unwrap_or(defaults.review_ordering),
        screen,
        // The one default that is another setting rather than a constant, which
        // is why it is resolved after the screen rather than beside it.
        minimum_resolution: read(stored, MINIMUM_RESOLUTION, Resolution::parse).unwrap_or(screen),
        review_layout: read(stored, REVIEW_LAYOUT, ReviewLayout::parse)
            .unwrap_or(defaults.review_layout),
        crop_preview: read(stored, CROP_PREVIEW, bool::parse).unwrap_or(defaults.crop_preview),
        evaluated_threshold: read(stored, EVALUATED_THRESHOLD, Threshold::parse)
            .map_or(defaults.evaluated_threshold, |threshold| threshold.0),
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
///
/// An enumerated key is refused by its own [`Vocabulary`], so its arm is the one
/// line saying which field it is compared against. The arms stay a `match`
/// rather than a walk over the vocabularies because each key holds a different
/// type, and a list able to hold all of them would read worse than the lines it
/// replaced.
fn is_default(key: &str, value: &str, without: &Settings) -> Result<bool, AppError> {
    match key {
        THEME => Ok(Theme::written(value)? == without.theme),
        // A Written path is stored as written and never checked against the
        // filesystem: an unmounted drive is not a bad setting.
        LIBRARY_ROOT => Ok(value == without.library_root),
        REJECT_DESTINATION => Ok(value == without.reject_destination),
        LIBRARY_LAYOUT => Ok(LibraryLayout::written(value)? == without.library_layout),
        REVIEW_WORKLIST_SIZE => Ok(WorklistSize::written(value)? == without.review_worklist_size),
        STARTUP_VIEW => Ok(StartupView::written(value)? == without.startup_view),
        REVIEW_ORDERING => Ok(ReviewOrdering::written(value)? == without.review_ordering),
        SCREEN => Ok(resolution(value)? == without.screen),
        MINIMUM_RESOLUTION => Ok(resolution(value)? == without.minimum_resolution),
        REVIEW_LAYOUT => Ok(ReviewLayout::written(value)? == without.review_layout),
        CROP_PREVIEW => Ok(bool::written(value)? == without.crop_preview),
        EVALUATED_THRESHOLD => Ok(Threshold::written(value)?.0 == without.evaluated_threshold),
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

    fn worklist(count: u32) -> WorklistSize {
        WorklistSize::new(count).expect("test worklist sizes are presets")
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

    /// The spellings a refusal names after its `expected`, in the order it
    /// names them.
    fn named_in(refusal: &str) -> Vec<String> {
        let (_, list) = refusal
            .split_once("; expected ")
            .unwrap_or_else(|| panic!("{refusal:?} names no values"));
        list.replace(" or ", ", ")
            .split(", ")
            .map(str::to_string)
            .collect()
    }

    /// A setting as it crossed the IPC, spelled the way `encodeSetting` in
    /// `client.ts` hands it back: `String(value)`, which writes a whole number
    /// with no decimal point.
    fn as_client_writes_it(json: &serde_json::Value) -> String {
        match json {
            serde_json::Value::String(text) => text.clone(),
            serde_json::Value::Bool(flag) => flag.to_string(),
            serde_json::Value::Number(number) => match number.as_u64() {
                Some(whole) => whole.to_string(),
                None => number.as_f64().expect("a number").to_string(),
            },
            other => panic!("{other} is not an enumerated setting"),
        }
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
                review_worklist_size: worklist(50),
                startup_view: StartupView::Rank,
                review_ordering: ReviewOrdering::ScoreAsc,
                screen: size(3840, 2160),
                minimum_resolution: size(3840, 2160),
                review_layout: ReviewLayout::Grid,
                crop_preview: false,
                evaluated_threshold: 4.0,
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
    fn the_crop_preview_is_off_until_the_curator_presses_c() {
        let conn = store();

        assert!(!get(&conn, detected()).unwrap().crop_preview);
        // Nothing was written to reach that answer, so a curator who never
        // presses the key sees the app they already had.
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn the_crop_preview_survives_the_connection_that_turned_it_on() {
        // The whole point of storing it: a curator who always wants the bars
        // should not turn them on every session (#266).
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            let written = set(&conn, "crop_preview", "true", detected()).unwrap();
            assert!(written.crop_preview);
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert!(get(&conn, detected()).unwrap().crop_preview);

        // And turning it off again is the write that clears the row, which is
        // the same reset every other key has (ADR 0010).
        let off = set(&conn, "crop_preview", "false", detected()).unwrap();
        assert!(!off.crop_preview);
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn a_crop_preview_write_leaves_the_other_keys_alone() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();

        let settings = set(&conn, "crop_preview", "true", detected()).unwrap();

        assert!(settings.crop_preview);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.screen, size(2560, 1440));
        assert_eq!(settings.review_layout, ReviewLayout::Grid);
    }

    #[test]
    fn a_crop_preview_value_that_is_not_a_flag_is_a_bad_request_and_changes_nothing() {
        let conn = store();
        set(&conn, "crop_preview", "true", detected()).unwrap();
        let before = get(&conn, detected()).unwrap();

        for refused in ["1", "0", "yes", "TRUE", "on", ""] {
            let err = set(&conn, "crop_preview", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), before);
    }

    #[test]
    fn a_crop_preview_row_that_will_not_read_falls_back_to_off() {
        // Boot never fails over a preference, and a flag is one more row someone
        // can edit by hand.
        let conn = store();
        write_raw_row(&conn, "crop_preview", "maybe");

        assert!(!get(&conn, detected()).unwrap().crop_preview);
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
        set(&conn, "crop_preview", "true", detected()).unwrap();
        set(&conn, "review_worklist_size", "10", detected()).unwrap();
        set(&conn, "startup_view", "library", detected()).unwrap();
        set(&conn, "review_ordering", "score_desc", detected()).unwrap();
        set(&conn, "evaluated_threshold", "3", detected()).unwrap();
        set(&conn, "theme", "system", detected()).unwrap();
        set(&conn, "library_root", "", detected()).unwrap();
        set(&conn, "reject_destination", "./rejected", detected()).unwrap();
        set(&conn, "review_layout", "grid", detected()).unwrap();
        set(&conn, "library_layout", "grid", detected()).unwrap();
        set(&conn, "crop_preview", "false", detected()).unwrap();
        set(&conn, "review_worklist_size", "50", detected()).unwrap();
        set(&conn, "startup_view", "rank", detected()).unwrap();
        set(&conn, "review_ordering", "score_asc", detected()).unwrap();
        set(&conn, "evaluated_threshold", "4", detected()).unwrap(); // The minimum resolution goes back first, against the overridden screen
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
    fn the_three_preferences_round_trip_and_survive_the_connection_that_wrote_them() {
        // The whole of what the three sections promise: a choice made once and
        // still there on the next launch, each one alone.
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            set(&conn, "review_worklist_size", "25", detected()).unwrap();
            set(&conn, "startup_view", "review", detected()).unwrap();
            let returned = set(&conn, "review_ordering", "score_desc", detected()).unwrap();
            assert_eq!(returned.review_worklist_size, worklist(25));
            assert_eq!(returned.startup_view, StartupView::Review);
            assert_eq!(returned.review_ordering, ReviewOrdering::ScoreDesc);
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let settings = get(&conn, detected()).unwrap();

        assert_eq!(settings.review_worklist_size, worklist(25));
        assert_eq!(settings.startup_view, StartupView::Review);
        assert_eq!(settings.review_ordering, ReviewOrdering::ScoreDesc);
        // None of the three interacts with anything else, which is the other
        // half of what a round trip has to say.
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.reject_destination, "./rejected");
        assert_eq!(settings.library_layout, LibraryLayout::Grid);
        assert_eq!(settings.screen, size(3840, 2160));
    }

    #[test]
    fn every_worklist_preset_stores_and_nothing_else_does() {
        let conn = store();

        for preset in WORKLIST_SIZES {
            assert_eq!(
                set(
                    &conn,
                    "review_worklist_size",
                    &preset.to_string(),
                    detected()
                )
                .unwrap()
                .review_worklist_size,
                worklist(preset),
                "{preset}"
            );
        }
        // The last preset written is the one standing, so the refusals below
        // have something to fail to change.
        let before = get(&conn, detected()).unwrap();

        // A count off the list, a count that is not one, and the empty string a
        // control with nothing selected would send. The presets are the setting
        // (#259), so 37 is refused here rather than only by the control.
        for refused in ["37", "0", "-10", "fifty", "", "50 "] {
            let err = set(&conn, "review_worklist_size", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), before);
    }

    #[test]
    fn a_worklist_row_that_will_not_read_is_the_fifty_review_has_always_shown() {
        // Boot never fails over a preference, and a worklist length nothing can
        // fetch is the length the app has always had rather than an empty page.
        let conn = store();
        write_raw_row(&conn, "review_worklist_size", "37");

        assert_eq!(
            get(&conn, detected()).unwrap().review_worklist_size,
            worklist(50)
        );
    }

    #[test]
    fn the_startup_view_is_one_of_the_three_a_curator_works_in() {
        let conn = store();

        for (written, expected) in [
            ("review", StartupView::Review),
            ("library", StartupView::Library),
            ("rank", StartupView::Rank),
        ] {
            assert_eq!(
                set(&conn, "startup_view", written, detected())
                    .unwrap()
                    .startup_view,
                expected
            );
        }
        // Rank is the default, so the loop above ended by deleting the row.
        assert_eq!(stored_rows(&conn), 0);

        // Settings is not a startup view: boot opens it on its own when there is
        // nothing else to show, and it is not somewhere a curator works.
        let err = set(&conn, "startup_view", "settings", detected()).unwrap_err();
        assert!(
            matches!(err, AppError::BadRequest(ref m) if m.contains("settings")),
            "got {err:?}"
        );
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn review_is_ordered_by_score_and_by_nothing_else() {
        let conn = store();

        let highest = set(&conn, "review_ordering", "score_desc", detected()).unwrap();
        assert_eq!(highest.review_ordering, ReviewOrdering::ScoreDesc);

        // The library page's other two orderings are not Review's: filename
        // order in a decision queue means nothing (#259).
        for refused in ["filename_asc", "recently_added", "lowest"] {
            let err = set(&conn, "review_ordering", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), highest);
    }

    #[test]
    fn a_startup_view_or_ordering_row_that_will_not_read_is_the_default() {
        let conn = store();
        write_raw_row(&conn, "startup_view", "settings");
        write_raw_row(&conn, "review_ordering", "filename_asc");

        let settings = get(&conn, detected()).unwrap();

        assert_eq!(settings.startup_view, StartupView::Rank);
        assert_eq!(settings.review_ordering, ReviewOrdering::ScoreAsc);
    }

    #[test]
    fn every_enumerated_key_refuses_by_naming_exactly_the_values_it_accepts() {
        // Each key beside spellings near enough to a legal one that a forgiving
        // parse would take them, which is the other half of "exactly": the
        // refusal may not name a value the parse refuses, and the parse may not
        // take a spelling the refusal did not name.
        let table: [(&str, &[&str]); 8] = [
            ("theme", &["System", " dark", "solarized"]),
            ("library_layout", &["Grid", "masonry ", "mosaic"]),
            ("review_layout", &["Strip", "grid\n", "masonry"]),
            ("startup_view", &["Rank", "settings", ""]),
            (
                "review_ordering",
                &["score-asc", "SCORE_DESC", "filename_asc"],
            ),
            ("crop_preview", &["True", "1", "yes"]),
            ("review_worklist_size", &["+10", "050", "37"]),
            ("evaluated_threshold", &["4.0", "+3", "5e0"]),
        ];

        for (key, near_misses) in table {
            let conn = store();
            let default = serde_json::to_value(get(&conn, detected()).unwrap()).unwrap();

            let err = set(&conn, key, "nothing like it", detected()).unwrap_err();
            let AppError::BadRequest(refusal) = err else {
                panic!("{key}: {err:?}");
            };
            assert!(refusal.contains("\"nothing like it\""), "{key}: {refusal}");
            let named = named_in(&refusal);

            // The value the key holds with no row at all is one the refusal
            // names, so a curator told what to write is told the default too.
            assert!(
                named.contains(&as_client_writes_it(&default[key])),
                "{key}: {refusal} leaves out the default"
            );

            // Every value named is one the key takes, and it comes back over
            // the IPC as the spelling that was written, so the frontend can hand
            // a read value straight back to `set_setting`. Distinct spellings
            // reading back as themselves are distinct values, so the refusal
            // names no value twice.
            for spelling in &named {
                let written = set(&conn, key, spelling, detected())
                    .unwrap_or_else(|err| panic!("{key}: {refusal} names {spelling:?}: {err:?}"));
                let json = serde_json::to_value(written).unwrap();
                assert_eq!(&as_client_writes_it(&json[key]), spelling, "{key}");
            }

            for near_miss in near_misses {
                let err = set(&conn, key, near_miss, detected()).unwrap_err();
                assert!(
                    matches!(err, AppError::BadRequest(_)),
                    "{key}: {near_miss:?}: {err:?}"
                );
            }
        }
    }

    #[test]
    fn settings_cross_the_ipc_with_the_fields_client_ts_expects() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "library_root", "~/pics", detected()).unwrap();
        set(&conn, "library_layout", "masonry", detected()).unwrap();
        set(&conn, "review_worklist_size", "100", detected()).unwrap();
        set(&conn, "startup_view", "library", detected()).unwrap();
        set(&conn, "review_ordering", "score_desc", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        set(&conn, "review_layout", "strip", detected()).unwrap();
        set(&conn, "crop_preview", "true", detected()).unwrap();

        let json = serde_json::to_value(get(&conn, detected()).unwrap()).unwrap();

        // The theme crosses as the same string a write accepts, so the frontend
        // can hand a read value straight back to `set_setting`.
        assert_eq!(json["theme"], "dark");
        assert_eq!(json["library_root"], "~/pics");
        assert_eq!(json["reject_destination"], "./rejected");
        // A layout crosses as the same string a write accepts, the way the theme
        // does, so the frontend can hand a read value straight back.
        assert_eq!(json["library_layout"], "masonry");
        // A worklist size crosses as the number, because `list_wallpapers` takes
        // one: the presets are a rule about which numbers, not a shape of their
        // own. A startup view and a review ordering cross as the strings a write
        // accepts back, the way the theme and the layout do — and the ordering's
        // two are the `ListOrdering` spellings, so Review hands the value it read
        // straight to the listing (ADR 0028).
        assert_eq!(json["review_worklist_size"], 100);
        assert_eq!(json["startup_view"], "library");
        assert_eq!(json["review_ordering"], "score_desc");
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
        // A flag crosses as JSON's own `true` and not as the `"true"` the column
        // holds, because the frontend reads it as a boolean and `String(value)`
        // in `encodeSetting` is what writes the stored spelling back.
        assert_eq!(json["crop_preview"], true);
        // The threshold crosses as the number itself, because the card compares a
        // wallpaper's σ against it directly: a name here would need the same
        // three numbers on both sides of the IPC, which is the duplication this
        // epic already refused over the Screen (ADR 0046).
        assert_eq!(json["evaluated_threshold"], 4.0);
    }

    #[test]
    fn the_evaluated_threshold_defaults_to_what_it_meant_as_a_constant() {
        let conn = store();

        assert_eq!(
            get(&conn, detected()).unwrap().evaluated_threshold,
            DEFAULT_EVALUATED_THRESHOLD
        );
        assert_eq!(DEFAULT_EVALUATED_THRESHOLD, 4.0);
        // Nothing was written to reach it, so a curator who never opens the
        // control has the count and the badges they always had.
        assert_eq!(stored_rows(&conn), 0);
        assert_eq!(evaluated_threshold(&conn).unwrap(), 4.0);
    }

    #[test]
    fn the_evaluated_threshold_round_trips_and_survives_the_connection_that_wrote_it() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("walltare.db");
        {
            let conn = crate::db::open(&db_path).unwrap();
            crate::db::init_schema(&conn).unwrap();
            let written = set(&conn, "evaluated_threshold", "3", detected()).unwrap();
            assert_eq!(written.evaluated_threshold, 3.0);
        }

        let conn = crate::db::open(&db_path).unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(get(&conn, detected()).unwrap().evaluated_threshold, 3.0);
        // The count reads the same row through the same default, which is what
        // keeps the headline and the badges saying one thing (ADR 0046).
        assert_eq!(evaluated_threshold(&conn).unwrap(), 3.0);
    }

    #[test]
    fn an_evaluated_threshold_write_leaves_the_other_keys_alone() {
        let conn = store();
        set(&conn, "theme", "dark", detected()).unwrap();
        set(&conn, "screen", "2560x1440", detected()).unwrap();
        set(&conn, "review_layout", "strip", detected()).unwrap();

        let settings = set(&conn, "evaluated_threshold", "5", detected()).unwrap();

        assert_eq!(settings.evaluated_threshold, 5.0);
        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.screen, size(2560, 1440));
        assert_eq!(settings.minimum_resolution, size(2560, 1440));
        assert_eq!(settings.review_layout, ReviewLayout::Strip);
        assert_eq!(settings.reject_destination, "./rejected");
    }

    #[test]
    fn the_evaluated_threshold_goes_back_to_its_default_by_being_written_it() {
        let conn = store();
        set(&conn, "evaluated_threshold", "3", detected()).unwrap();
        assert_eq!(stored_rows(&conn), 1);

        let returned = set(&conn, "evaluated_threshold", "4", detected()).unwrap();

        assert_eq!(returned.evaluated_threshold, DEFAULT_EVALUATED_THRESHOLD);
        assert_eq!(get(&conn, detected()).unwrap(), returned);
        assert_eq!(stored_rows(&conn), 0);
    }

    #[test]
    fn an_evaluated_threshold_the_page_does_not_offer_is_a_bad_request_and_changes_nothing() {
        // Strict on the way in, for the reason a size is: a confidence no control
        // can show the curator is one they cannot change back.
        let conn = store();
        set(&conn, "evaluated_threshold", "3", detected()).unwrap();
        let before = get(&conn, detected()).unwrap();

        for refused in ["4.2", "0", "-4", "", "balanced", "8.333", "NaN"] {
            let err = set(&conn, "evaluated_threshold", refused, detected()).unwrap_err();
            assert!(
                matches!(err, AppError::BadRequest(_)),
                "{refused:?}: {err:?}"
            );
        }

        assert_eq!(get(&conn, detected()).unwrap(), before);
    }

    #[test]
    fn the_three_offered_thresholds_are_all_writable_and_read_back_exactly() {
        // Written the way `client.ts` writes a number, which is `String(value)`.
        let conn = store();

        for offered in EVALUATED_THRESHOLDS {
            let written = set(
                &conn,
                "evaluated_threshold",
                &offered.to_string(),
                detected(),
            )
            .unwrap();
            assert_eq!(written.evaluated_threshold, offered);
            assert_eq!(evaluated_threshold(&conn).unwrap(), offered);
        }
    }

    #[test]
    fn an_evaluated_threshold_row_that_will_not_read_falls_back_to_the_default() {
        // Boot never fails over a preference, and a threshold is one more row
        // someone can edit by hand.
        let conn = store();
        write_raw_row(&conn, "evaluated_threshold", "very sure");

        assert_eq!(
            get(&conn, detected()).unwrap().evaluated_threshold,
            DEFAULT_EVALUATED_THRESHOLD
        );
        assert_eq!(
            evaluated_threshold(&conn).unwrap(),
            DEFAULT_EVALUATED_THRESHOLD
        );
    }
}
