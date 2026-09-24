import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

// Types mirroring the Rust DTOs locked in #4. Do not use these types or any
// invoke/listen call outside this module — everything goes through `client`.
//
// `@tauri-apps/plugin-dialog` lives under the same rule. Opening a folder
// picker is a call into the backend like any other, and `pickFolder` below is
// the only thing in the app that imports the plugin.

export type ThumbnailSize = "small" | "medium" | "full";

/**
 * The width a `small` is capped at, mirroring `SMALL_MAX_WIDTH` in
 * `thumbnails.rs`. A card drawn wider than this in device pixels is a `small`
 * stretched, which is the blur a zoomed-in grid shows.
 */
export const SMALL_THUMBNAIL_WIDTH = 400;

/**
 * The smallest thumbnail that stays sharp at `cssWidth` CSS pixels on a screen
 * of `pixelRatio`: a `small` until it would be upscaled, then a `medium`.
 * Never `full` — a `medium` is 1920px wide, which no grid card outgrows.
 */
export function thumbnailSizeFor(
  cssWidth: number,
  pixelRatio: number,
): "small" | "medium" {
  return cssWidth * pixelRatio > SMALL_THUMBNAIL_WIDTH ? "medium" : "small";
}

/**
 * CONTEXT.md's Status, spelled the way the column holds it (the `db.rs` CHECK
 * constraint): Active, Kept, Rejected, lowercased. Named so that what a Status
 * travels in — a row, an event payload — says which of the three it is.
 */
export type Status = "active" | "kept" | "rejected";

/**
 * Mirrors db::Wallpaper, the one row shape the backend hands out — listings and
 * voting pairs alike. Status is the lowercase DB value (db.rs CHECK constraint).
 */
export interface Wallpaper {
  id: number;
  filename: string;
  path: string;
  status: Status;
  rating_mu: number;
  rating_sigma: number;
  comparisons_count: number;
  /**
   * Where the file sat before its current soft reject, so a Restore can put it
   * back. `null` for anything not currently rejected, and for a wallpaper
   * rejected before the column existed, which is the cohort that cannot be
   * restored at all (ADR 0009).
   */
  origin_path: string | null;
  /**
   * The source file's own pixel width, or `null` while nothing has read it.
   *
   * Not the thumbnail's width. A wallpaper's cached sizes say what shape it is;
   * only these say whether the file is large enough for the screen it is meant
   * for (ADR 0044).
   *
   * `null` is the ordinary state of a library still being backfilled, so a
   * reader answers for it rather than waiting: no badge, out of the undersized
   * filter, and 16:9 for layout.
   */
  width: number | null;
  /**
   * The source file's own pixel height. `null` exactly when `width` is: the two
   * are written in one statement and read off one file.
   */
  height: number | null;
}

/**
 * Mirrors voting::Stats. Every fraction is measured against `eligible_count`,
 * not `total_wallpapers`, so rejecting a wallpaper does not drop the progress
 * it describes (ADR 0008).
 */
export interface Stats {
  /** All rows, any status. The boot gate reads this one. */
  total_wallpapers: number;
  /** Active + Kept: the voting pool, and the denominator for everything below. */
  eligible_count: number;
  /** `min(comparisons_count) + 1` over the pool; 1 when the pool is empty. */
  round: number;
  /** Eligible wallpapers with `comparisons_count >= round`. */
  round_participated_count: number;
  evaluated_count: number;
  total_comparisons: number;
}

/**
 * Mirrors db::StatusFilter: which Statuses `listWallpapers` returns.
 *
 * No `eligible`. It is a voting-pool term, and on a browsing surface it would
 * read as "everything I haven't thrown out", which is what `all` already shows
 * with the rejects greyed (ADR 0016).
 */
export type StatusFilter = "all" | "active" | "kept" | "rejected";

/**
 * Mirrors db::ListOrdering. A caller picks a name; the backend owns every part
 * of the clause behind it, direction included (ADR 0014). There is no separate
 * direction toggle, which is why `score` appears twice.
 *
 * `recently_added` is insertion order, which lives in the row id: a scan stamps
 * every row it adds with the same `created_at`, so that column orders nothing
 * and stays off the DTO.
 */
export type ListOrdering =
  "score_desc" | "score_asc" | "filename_asc" | "recently_added";

/** Mirrors settings::Theme; each string is what `set_setting` accepts back. */
export type Theme = "system" | "light" | "dark";

/**
 * Mirrors settings::ReviewLayout: which layout Review draws its worklist in.
 *
 * `strip` is one wallpaper at the size it would be hung with the worklist as a
 * filmstrip beneath it; `grid` is the uniform grid of cards Review has always
 * drawn. Stored per tab rather than once for the app, so a choice made while
 * browsing the library cannot decide how a decision queue is judged (#265).
 */
export type ReviewLayout = "strip" | "grid";

/**
 * Mirrors settings::LibraryLayout: how the Library draws its wallpapers.
 *
 * `grid` crops every wallpaper to one shape; `masonry` packs columns
 * shortest-first and draws each at its own aspect ratio; `justified` scales
 * uncropped wallpapers to a shared height per row, with the rank set large
 * behind each image. The choice belongs to the Library tab, which is why the key
 * names it: Review's layout is its own key, so masonry in Library and something
 * else in Review is a valid pair.
 */
export type LibraryLayout = "grid" | "masonry" | "justified";

/**
 * Mirrors settings::ReviewOrdering: which end of the ranking Review works from.
 *
 * A subset of `ListOrdering` rather than a vocabulary of its own, because the
 * value is handed straight to `listWallpapers` — Review is a decision queue, so
 * it takes the two Score orderings and not the library page's four: filename
 * order in a queue of judgements means nothing (ADR 0028, #259).
 */
export type ReviewOrdering = Extract<ListOrdering, "score_asc" | "score_desc">;

/**
 * Mirrors settings::StartupView: which view the app opens on.
 *
 * `View` in `AppContext` is this plus `settings`, which is the one destination
 * boot reaches on its own — with nothing scanned, or with a library that would
 * not read — and not somewhere a curator would choose to be dropped every
 * launch (ADR 0015).
 */
export type StartupView = "rank" | "review" | "library";

/**
 * Mirrors settings::WORKLIST_SIZES: the worklist lengths Review offers.
 *
 * Presets rather than a number the curator types, because the question is how
 * long a session to sit down to. The backend refuses anything else, so this list
 * is what a control offers and not what makes the value valid.
 */
export const WORKLIST_SIZES = [10, 25, 50, 100] as const;

/**
 * Mirrors settings::WorklistSize: a worklist length, which is one of the presets
 * and cannot be anything else.
 *
 * Derived from the list above rather than written out, so the presets and the
 * type cannot drift apart. The restriction is the Rust newtype's, and stating it
 * here too is what keeps this setting as typed as the three unions beside it —
 * `review_worklist_size: number` would have let a caller name a length the
 * backend refuses and learn about it from a runtime rejection.
 */
export type WorklistSize = (typeof WORKLIST_SIZES)[number];

/**
 * Mirrors settings::Resolution: a size in pixels, width by height.
 *
 * What the Screen and the Minimum resolution settings hold. Not a wallpaper's
 * Dimensions, which are the same two numbers about a different thing — a fact
 * about a file rather than a stated preference — and live on `Wallpaper` as
 * nullable `width` and `height` (CONTEXT.md, ADR 0044).
 *
 * The two numbers rather than the `1920x1080` string the column holds, because
 * the readers want different halves of it — the crop preview the ratio, the
 * undersized check the pixels — and a string every one of them parses again is
 * a parse in every reader. `encodeSetting` writes it back in the stored form.
 */
export interface Resolution {
  width: number;
  height: number;
}

/**
 * Mirrors settings::Sorting: all seven of Wallhaven's sort orders, spelled the
 * way its `sorting` parameter takes them.
 */
export type Sorting =
  | "date_added"
  | "relevance"
  | "random"
  | "views"
  | "favorites"
  | "toplist"
  | "hot";

/** Mirrors settings::Order: which way a Wallhaven sort runs. */
export type Order = "desc" | "asc";

/**
 * Mirrors settings::TopRange: how far back a toplist reaches. Only a toplist
 * reads one, and the backend refuses it with any other sort (ADR 0054).
 */
export type TopRange = "1d" | "3d" | "1w" | "1M" | "3M" | "6M" | "1y";

/**
 * Mirrors wallhaven::COLOURS: Wallhaven's 29 colours, the only values its
 * `colors` parameter takes, in its own palette's order and without the `#`.
 * The backend refuses anything else (ADR 0054), and a test holds the two lists
 * equal.
 */
// prettier-ignore
export const WALLHAVEN_COLOURS = [
  "660000", "990000", "cc0000", "cc3333", "ea4c88", "993399", "663399",
  "333399", "0066cc", "0099cc", "66cccc", "77cc33", "669900", "336600",
  "666600", "999900", "cccc33", "ffff00", "ffcc33", "ff9900", "ff6600",
  "cc6633", "996633", "663300", "000000", "999999", "cccccc", "ffffff",
  "424153",
] as const;

/**
 * Mirrors settings::Categories: which of Wallhaven's categories a search takes.
 * At least one is on, or the backend refuses the search.
 */
export interface Categories {
  general: boolean;
  anime: boolean;
  people: boolean;
}

/**
 * Mirrors settings::Purity. NSFW needs an API key, and without one the backend
 * refuses a search asking for it.
 */
export interface Purity {
  sfw: boolean;
  sketchy: boolean;
  nsfw: boolean;
}

/**
 * Mirrors settings::DiscoverFilters: the five filters a successful search
 * remembers, which Discover opens with. The ratio is not one of them — it goes
 * back to the Screen's — and nothing here is written through `setSetting`: the
 * backend records them when a search with them works (ADR 0054).
 */
export interface DiscoverFilters {
  purity: Purity;
  categories: Categories;
  sorting: Sorting;
  order: Order;
  top_range: TopRange;
}

/** The filters with no row in the table, mirroring `DiscoverFilters::default`. */
export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = {
  purity: { sfw: true, sketchy: false, nsfw: false },
  categories: { general: true, anime: true, people: true },
  sorting: "date_added",
  order: "desc",
  top_range: "1M",
};

/**
 * Mirrors wallhaven::SearchParams: every parameter Wallhaven's `/search` takes.
 *
 * `q` goes through verbatim, Wallhaven's own syntax included. The backend
 * refuses with `bad_request` anything Wallhaven would silently drop: a ratio or
 * resolution not shaped `WxH` (or `landscape`/`portrait` for a ratio), a colour
 * outside its 29, and a `top_range` without the toplist sort (ADR 0054).
 */
export interface SearchParams {
  q: string;
  categories: Categories;
  purity: Purity;
  sorting: Sorting;
  order: Order;
  top_range?: TopRange;
  atleast?: string;
  resolutions?: string[];
  ratios?: string[];
  colors?: string;
  page?: number;
  seed?: string;
}

/**
 * Mirrors wallhaven::Mark: what the library already says about a Result
 * (ADR 0050). `in_library` when some Active or Kept wallpaper carries its
 * Wallhaven id, `rejected` when only Rejected ones do, and `unmarked` otherwise.
 */
export type Mark = "unmarked" | "in_library" | "rejected";

/**
 * Mirrors wallhaven::MarkedResult: one Result, as Wallhaven's search record has it,
 * less the full file's `path` — which the backend keeps for the download that
 * names it by id (ADR 0054) — and with its mark beside it.
 */
export interface MarkedResult {
  id: string;
  url: string;
  short_url: string;
  views: number;
  favorites: number;
  source: string;
  purity: string;
  category: string;
  dimension_x: number;
  dimension_y: number;
  resolution: string;
  ratio: string;
  file_size: number;
  file_type: string;
  created_at: string;
  colors: string[];
  /** Read off the library's rows alone, so a missing file still marks it. */
  mark: Mark;
  /** On `th.wallhaven.cc`, the one remote origin the policy allows (ADR 0053). */
  thumbs: { large: string; original: string; small: string };
}

/** Mirrors wallhaven::Page: one page of Results, and where it sits. */
export interface SearchPage {
  results: MarkedResult[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    /** The shuffle a random sort used, for its next page. */
    seed: string | null;
  };
}

/** Mirrors settings::Settings, which fills every gap in the table from its own defaults. */
export interface Settings {
  theme: Theme;
  /**
   * A Written path, stored exactly as the user typed it, `~` and variables
   * included (ADR 0011). Empty means nothing has been scanned.
   */
  library_root: string;
  /** A Written path. Relative means one rejected folder beside each wallpaper. */
  reject_destination: string;
  /**
   * A Written path: where a Discover download lands. Relative means under the
   * Library root as it stands at each download (ADR 0051).
   */
  download_folder: string;
  /**
   * Which layout the Library tab draws, remembered across restarts.
   *
   * Stored here because the store is what survives a restart, and offered
   * nowhere in the Settings view: the control sits on the Library bar, where
   * the curator is when they want it changed, and a control in two places is
   * two places to look.
   */
  library_layout: LibraryLayout;
  /**
   * How many wallpapers Review puts in front of the curator at once, which is
   * the `limit` its listing asks for.
   *
   * One of `WORKLIST_SIZES`, which the backend enforces and the type says: a
   * length crosses as the number rather than as a preset index, because the
   * `limit` is what the value is for.
   */
  review_worklist_size: WorklistSize;
  /**
   * Which view the app opens on, as a fixed choice rather than wherever the
   * curator was last (ADR 0015).
   *
   * It picks between the landings the boot rule would otherwise call Rank. A
   * library boot cannot draw a pair from, or cannot read at all, still decides
   * for itself.
   */
  startup_view: StartupView;
  /**
   * Which end of the ranking Review works from: lowest Scores to cull the
   * worst, highest to confirm favourites.
   */
  review_ordering: ReviewOrdering;
  /**
   * The screen the curator is curating for, defaulting to the monitor the
   * backend detected. One screen and not two: the crop preview reads its ratio
   * and the undersized check reads its pixels, and two settings holding the same
   * fact can disagree.
   */
  screen: Resolution;
  /**
   * The smallest a wallpaper may be before it reads as undersized. Defaults to
   * `screen` rather than to a constant, so a curator who wants exactly their own
   * pixels has nothing to set.
   */
  minimum_resolution: Resolution;
  /**
   * Which layout Review draws its worklist in, remembered across launches and
   * held apart from whatever Library is drawing.
   *
   * `grid` by default, so a curator who never opens the control on Review's bar
   * gets the page they already had.
   */
  review_layout: ReviewLayout;
  /**
   * Whether the crop preview is up: the bars showing what the Screen would
   * discard, in the Review strip and the Lightbox.
   *
   * A toggle rather than a hold, and so a thing to remember — the bars stay up
   * while the curator arrows through a run, and a key held down is a key that
   * cannot arrow (#266). Stored for the reason the two layouts are, the store
   * being what survives a restart, and offered nowhere in the Settings view for
   * the same reason either: the control is `C` on the surface it draws on.
   *
   * `false` by default, so a curator who never presses it sees the app they
   * already had.
   */
  crop_preview: boolean;
  /**
   * The σ below which a wallpaper's rating counts as Evaluated.
   *
   * The curator's answer to how many Comparisons make a Score trustworthy
   * (CONTEXT.md, ADR 0046). The number itself rather than a name for it, because
   * the card compares a wallpaper's σ against it directly and the backend counts
   * `evaluated_count` against the same row — a name would need the same three
   * numbers written out on both sides of the IPC, which is exactly how the
   * headline and the badges would come to disagree.
   *
   * Only the values `EVALUATED_THRESHOLDS` offers are writable; the backend
   * refuses the rest.
   */
  evaluated_threshold: number;
  /**
   * The filters Discover opens with, as the last successful search left them.
   * Not a `SettingKey`: a search writes them, and nothing else can.
   */
  discover_filters: DiscoverFilters;
  /**
   * Whether a Wallhaven API key is saved. The key itself never crosses into
   * the webview: it is typed into Settings once and nothing sends it back, so
   * this flag is all a read carries (ADR 0052). Not a `SettingKey`:
   * `setWallhavenKey` writes the key, after checking it.
   */
  wallhaven_key_set: boolean;
  /**
   * What the monitor said, which is what `screen` reads as until the curator
   * overrides it.
   *
   * Not a setting — it is not a `SettingKey` and the backend refuses the key —
   * but it rides along on the settings answer because Settings is the only
   * reader and needs it in the same breath as the value it is comparing.
   */
  detected_screen: Resolution;
}

/**
 * The keys `set_setting` takes, which is every setting and nothing else.
 *
 * `Settings` is what a read answers with, and two fields on it are not the
 * frontend's to write: the detected screen is a readout, and Discover's
 * filters are remembered by the search that used them (ADR 0054). Excluding
 * them here is what stops a caller writing to either and learning from a
 * backend refusal at runtime.
 */
export type SettingKey = Exclude<
  keyof Settings,
  "detected_screen" | "discover_filters" | "wallhaven_key_set"
>;

/**
 * The Screen to assume when nothing has said what the monitor is, mirroring
 * `settings::FALLBACK_SCREEN`.
 *
 * Only reachable through `DEFAULT_SETTINGS` below: the backend does its own
 * falling back, so the frontend lands here when the settings read itself failed.
 */
const FALLBACK_SCREEN: Resolution = { width: 1920, height: 1080 };

/**
 * The Evaluated threshold with no row in the table, mirroring
 * `settings::DEFAULT_EVALUATED_THRESHOLD`.
 *
 * What Evaluated meant while it was a constant — σ below 4.0, roughly half the
 * starting uncertainty — so a curator who never opens the control sees the count
 * and the badges they always did (CONTEXT.md, ADR 0046).
 *
 * The one place the frontend may fall back to it is a card mounted outside the
 * app's settings. Every surface inside them reads `settings.evaluated_threshold`,
 * because that is the row the backend counted against.
 */
export const DEFAULT_EVALUATED_THRESHOLD = 4.0;

/**
 * The three thresholds Settings offers, loosest first, mirroring
 * `settings::EVALUATED_THRESHOLDS`.
 *
 * A preset list and not a free number: σ is the app's own uncertainty scale, and
 * a curator typing `6.5` into it is guessing at a unit nothing on the page can
 * explain. The backend refuses anything else, so this list and its refusal are
 * the same rule (ADR 0046).
 */
export const EVALUATED_THRESHOLDS = [5.0, DEFAULT_EVALUATED_THRESHOLD, 3.0];

/**
 * What every key means with no row in the table, mirroring `Settings::defaults`.
 *
 * settings.rs owns the answer; this copy exists only for the boot path, which
 * has to render something when `get_settings` fails. The Screen here is the
 * fallback and not a detected monitor: a boot that could not read the settings
 * could not have been told what the monitor is either.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  library_root: "",
  reject_destination: "./rejected",
  download_folder: "wallhaven",
  library_layout: "grid",
  review_worklist_size: 50,
  startup_view: "rank",
  review_ordering: "score_asc",
  screen: FALLBACK_SCREEN,
  minimum_resolution: FALLBACK_SCREEN,
  review_layout: "grid",
  crop_preview: false,
  evaluated_threshold: DEFAULT_EVALUATED_THRESHOLD,
  discover_filters: DEFAULT_DISCOVER_FILTERS,
  wallhaven_key_set: false,
  detected_screen: FALLBACK_SCREEN,
};

/**
 * One setting as the column holds it, which is the one place in the app a
 * setting becomes a string.
 *
 * Keyed on the setting rather than on the shape of the value, so a later key
 * that happens to hold an object cannot fall through to the size encoding by
 * accident. Everything else is what the column already holds: a theme is one of
 * three strings, a Written path is the string the curator typed, a worklist size
 * is its own digits, a flag is `true` or `false`, and turning any of them into
 * anything but itself would make
 * the empty Library root — the write that deletes the row — unreachable.
 *
 * `setSetting` is the only caller, which is what stops any other part of the app
 * building a settings payload for itself (ADR 0031).
 */
function encodeSetting(key: SettingKey, value: Settings[SettingKey]): string {
  switch (key) {
    case "screen":
    case "minimum_resolution": {
      const { width, height } = value as Resolution;
      return `${width}x${height}`;
    }
    default:
      return String(value);
  }
}

/** Mirrors voting::VoteOutcome */
export interface VoteOutcome {
  /**
   * `null` when the vote was recorded but the follow-up pair fetch failed. The
   * Comparison still counted, so this is a cue to re-fetch, not an error.
   */
  next_pair: [Wallpaper, Wallpaper] | null;
  stats: Stats;
}

/** Payload of the `scan-progress` event (scan.rs Progress) */
export interface ScanProgress {
  scanned: number;
  added: number;
}

/** Payload of the `scan-complete` event (scan.rs Complete) */
export interface ScanComplete {
  added_count: number;
  /** Images the walk found, new or already known. See scan.rs Complete. */
  scanned_count: number;
}

/** Payload of the `scan-failed` event (scan.rs Failed) */
export interface ScanFailed {
  message: string;
}

/**
 * Payload of the `pregen-progress` event (pregen.rs Progress).
 *
 * `total` rides along on every emission rather than arriving once in a start
 * event, so a listener needs no start event and survives a missed one. The
 * first emission carries `done: 0`, before the first wallpaper is decoded.
 */
export interface PregenProgress {
  done: number;
  total: number;
}

/** Payload of the `pregen-complete` event (pregen.rs Complete) */
export interface PregenComplete {
  generated: number;
  /** Wallpapers whose source was gone or would not decode; one bad file stops nothing. */
  failed: number;
  cancelled: boolean;
}

/**
 * Every event the backend emits, under the name it emits it with, mapped to
 * what rides on it.
 *
 * The names are the wire names — `emit` in `lib.rs` and `pregen.rs` — so this
 * is the one place in the frontend where a hyphenated string has to match Rust,
 * and `subscribe` below is the one call that reads it. Adding a backend event
 * means a line here and a handler name in `useBackendEvents`.
 */
export interface BackendEvents {
  "scan-progress": ScanProgress;
  "scan-complete": ScanComplete;
  "scan-failed": ScanFailed;
  "pregen-progress": PregenProgress;
  "pregen-complete": PregenComplete;
}

/**
 * Every command the backend exposes, under the name `invoke` reaches it by.
 *
 * The wire names, `generate_handler!` in `lib.rs`, and the same job
 * `BackendEvents` does above for the five event names: the one place in the
 * frontend where these 19 strings are written down. `client`'s methods below
 * reach them through `call`, the only caller in the app; the test suite's
 * `mockCommand` is the other reader, which is why the names are exported rather
 * than inlined (ADR 0031).
 *
 * A Rust rename is still not a compilation failure — nothing short of generated
 * bindings makes it one, and ADR 0031 refused those. What this buys is that
 * once a rename reaches this file, every registration lights up at once.
 */
export type Command =
  | "start_scan"
  | "start_pregen"
  | "cancel_pregen"
  | "get_cache_size"
  | "clear_cache"
  | "count_missing_files"
  | "reject_missing_files"
  | "expand_path"
  | "check_reject_destination"
  | "check_download_folder"
  | "get_pair"
  | "vote"
  | "get_stats"
  | "list_wallpapers"
  | "keep_wallpaper"
  | "unkeep_wallpaper"
  | "move_wallpaper"
  | "restore_wallpaper"
  | "get_settings"
  | "set_setting"
  | "wallhaven_search"
  | "set_wallhaven_key";

/**
 * What each command takes and what it answers with.
 *
 * `args` is the payload as it crosses, camelCase keys included, and it is
 * `undefined` for the seven commands that take none. An answer of `null` is a
 * command that answers with nothing.
 *
 * This is the only declaration of either. `client`'s methods do not state a
 * payload or an answer of their own: they hand `call` a name and an object, and
 * their types are read off this table. So the table is the port, with Tauri's
 * `invoke` and the test suite's `mockCommand` as its two adapters, and an entry
 * here that drifts from the method using it is a type error there rather than a
 * second opinion nobody compares (ADR 0031 as amended by #282).
 */
export interface BackendCommands {
  start_scan: { args: { path: string }; answer: null };
  start_pregen: { args: undefined; answer: null };
  cancel_pregen: { args: undefined; answer: null };
  get_cache_size: { args: undefined; answer: CacheSize };
  clear_cache: { args: undefined; answer: null };
  count_missing_files: { args: undefined; answer: MissingFiles };
  reject_missing_files: { args: { ids: number[] }; answer: Wallpaper[] };
  expand_path: { args: { input: string }; answer: Expanded };
  check_reject_destination: {
    args: { written: string };
    answer: DestinationCheck;
  };
  check_download_folder: {
    args: { written: string; libraryRoot: string };
    answer: DownloadFolderCheck;
  };
  get_pair: {
    args: { exclude?: number[] };
    answer: [Wallpaper, Wallpaper];
  };
  vote: {
    args: { winnerId: number; loserId: number; exclude?: number[] };
    answer: VoteOutcome;
  };
  get_stats: { args: undefined; answer: Stats };
  list_wallpapers: {
    args: { filter: StatusFilter; ordering: ListOrdering; limit?: number };
    answer: Wallpaper[];
  };
  keep_wallpaper: { args: { id: number }; answer: Wallpaper };
  unkeep_wallpaper: { args: { id: number }; answer: Wallpaper };
  move_wallpaper: {
    args: { id: number; destinationFolder: string };
    answer: Wallpaper;
  };
  restore_wallpaper: { args: { id: number }; answer: Wallpaper };
  get_settings: { args: undefined; answer: Settings };
  /** The value crosses as a string, which is what the column holds (`setSetting`). */
  set_setting: {
    args: { key: SettingKey; value: string };
    answer: Settings;
  };
  wallhaven_search: { args: { params: SearchParams }; answer: SearchPage };
  set_wallhaven_key: { args: { key: string }; answer: KeySaved };
}

/**
 * Mirrors wallhaven::KeySaved: every setting after a key was saved or removed,
 * and whether Wallhaven could be asked about the key first. `verified` is
 * `false` when the check could not reach Wallhaven or was rate-limited, and the
 * key was stored anyway (ADR 0052).
 */
export interface KeySaved {
  settings: Settings;
  verified: boolean;
}

/**
 * Mirrors thumbnails::CacheSize: what a walk of the cache directory found.
 *
 * Both are zero for a cache with nothing in it, which is also the answer for a
 * cache directory that has not been created yet.
 */
export interface CacheSize {
  bytes: number;
  files: number;
}

/**
 * Mirrors missing::MissingFiles: what one check of the library found.
 *
 * `eligible` is the pool the check walked — Active plus Kept, which is
 * CONTEXT.md's Eligible — so the line can say what the `missing` count is out
 * of. A Rejected wallpaper is not in either number: its file moved to the
 * reject destination on purpose and its row followed it there.
 *
 * Both numbers come from one pass, so the line cannot print a ratio that was
 * never true.
 */
export interface MissingFiles {
  missing: number;
  eligible: number;
  /** Which wallpapers the `missing` are, for `rejectMissingFiles`. */
  ids: number[];
}

/**
 * Mirrors lib.rs Expanded: where a Written path points, and whether a folder is
 * there. `exists` is `is_dir()`, so a file at that path reads as `false`.
 */
export interface Expanded {
  resolved: string;
  exists: boolean;
}

/**
 * Mirrors reject_destination::Check: whether the Soft reject destination the
 * curator is writing can take a file.
 *
 * A different question from `Expanded`'s, which is why it is a different command
 * and a different shape (ADR 0035). There is no `exists` flag, because "there"
 * and "not there" are not the interesting cases: a folder that is there and will
 * not take a file is the one that costs a curator a reject, and one that is not
 * there yet is no problem at all, since the first reject creates it (ADR 0003).
 *
 * `relative` carries no path. A relative destination resolves against each
 * wallpaper's own folder (ADR 0011), so there is no one place to name.
 *
 * `reason` on `refused` is the backend's own sentence, naming the folder and
 * what refused it, and it is the same string a refused reject carries — so the
 * curator reading it under the field and the curator reading it in a toast are
 * being told one thing.
 */
export type DestinationCheck =
  | { state: "relative" }
  | { state: "ready"; resolved: string }
  | { state: "absent"; resolved: string }
  | { state: "refused"; resolved: string; reason: string };

/**
 * Mirrors download_folder::Check: whether the Download folder the curator is
 * writing could take a download, against the Library root as its own field has
 * it (ADR 0051).
 *
 * A relative Download folder means the Library root, and the root has to exist,
 * so the two root states come before any answer about the folder. Each `reason`
 * is the backend's own sentence, and the same one a refused download carries.
 */
export type DownloadFolderCheck =
  | { state: "no_root"; reason: string }
  | { state: "root_missing"; reason: string }
  | { state: "ready"; resolved: string }
  | { state: "absent"; resolved: string }
  | { state: "refused"; resolved: string; reason: string };

/** Tagged `{ kind, message }` union mirroring error::AppError (serde snake_case) */
export type AppErrorKind =
  | "not_found"
  | "invalid_transition"
  | "invalid_path"
  /**
   * A malformed Written path: an unset variable, or a `~` with no `HOME` behind
   * it. The one kind whose `message` is rendered verbatim, because it names the
   * variable the user mistyped and no canned string can.
   */
  | "invalid_path_syntax"
  /**
   * A file the library still points at is not on disk any more, so the move
   * that was asked for has nothing to move. Ordinary rather than exceptional:
   * emptying the reject folder by hand is the point of having one, and this is
   * the kind that lets a caller say so instead of showing an errno string.
   */
  | "file_missing"
  | "bad_request"
  | "not_enough_wallpapers"
  | "unknown_wallpaper"
  /**
   * Wallhaven could not be reached, timed out, or answered with something other
   * than its JSON: a 5xx, a Cloudflare challenge. The message says which and is
   * rendered verbatim, where the Results would be (ADR 0054).
   */
  | "network"
  /** Wallhaven's rate limit. The message is the sentence, seconds included. */
  | "rate_limited"
  /**
   * Wallhaven answered a search made with the saved API key with a 401.
   * Discover says so and links to Settings; nothing falls back to anonymous.
   */
  | "key_rejected"
  | "io"
  | "db"
  | "image";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as AppError).message === "string"
  );
}

/**
 * Whether a refused transition means the row the caller acted on had already
 * changed underneath it.
 *
 * Two kinds say that, and they say it about the same situation.
 * `invalid_transition` is a row that is present and refusing; `not_found` is a
 * row that is gone. Neither can be corrected by a patch — nothing in the answer
 * says what the row should be instead — and leaving it on screen means the
 * curator's next click reproduces it. So the page that acted refetches, and one
 * sentence covers both: `<filename> has already changed` is true of a row that
 * refused and of a row that is not there (ADR 0017 as amended by ADR 0025).
 *
 * One predicate rather than two readings of the same condition: the module that
 * acts asks it to decide on the refetch, and the toast surface asks it to pick
 * the copy.
 */
export function isStaleRow(error: unknown): boolean {
  return (
    isAppError(error) &&
    (error.kind === "invalid_transition" || error.kind === "not_found")
  );
}

/**
 * Builds a `wallpaper://` URL for the custom protocol handler in lib.rs.
 *
 * The `localhost` authority is load-bearing. A custom-scheme URL is parsed as
 * `scheme://authority/path`, so `wallpaper://image/7` puts `image` in the
 * authority and leaves the path as `/7` — the handler, which matches on the
 * path segments `["image", id]`, would reject every request. WebKitGTK (Linux)
 * and WKWebView (macOS) hand the URL to the handler verbatim, so the authority
 * has to be a placeholder and `image` has to sit in the path.
 */
export function wallpaperImageUrl(
  id: number,
  size: ThumbnailSize = "full",
): string {
  return `wallpaper://localhost/image/${id}?size=${size}`;
}

/** What `C` takes and what it answers with, read off `BackendCommands`. */
type ArgsOf<C extends Command> = BackendCommands[C]["args"];
type AnswerOf<C extends Command> = BackendCommands[C]["answer"];

/**
 * The arguments after the name: none for a command whose `args` is
 * `undefined`, so `call("get_stats")` does not have to spell one out.
 */
type Payload<C extends Command> =
  ArgsOf<C> extends undefined ? [] : [args: ArgsOf<C>];

/** The commands that answer with nothing. */
type SilentCommand = {
  [C in Command]: AnswerOf<C> extends null ? C : never;
}[Command];

/**
 * The one `invoke` in the app, typed against `BackendCommands`. Every method on
 * `client` goes through here, which is what makes that table the only
 * declaration of a payload or an answer.
 *
 * The cast is one the table vouches for: every `args` it lists is an object or
 * `undefined`, which is what `invoke` takes.
 */
function call<C extends Command>(
  name: C,
  ...payload: Payload<C>
): Promise<AnswerOf<C>> {
  return invoke<AnswerOf<C>>(name, payload[0] as InvokeArgs | undefined);
}

/**
 * `call` for a command that answers with nothing, resolving with nothing so a
 * caller never holds the `null` the wire carries. Only a command whose answer
 * the table says is `null` fits, so giving one an answer there is a type error
 * here.
 */
async function callSilent<C extends SilentCommand>(
  name: C,
  ...payload: Payload<C>
): Promise<void> {
  await call(name, ...payload);
}

/**
 * Every call the frontend makes into the backend, named the way the frontend
 * reads best and holding the few decisions that are not the backend's.
 *
 * A plain object with no interface over it, because nothing substitutes for it:
 * the tests swap `@tauri-apps/api` one level down (`tests/preload.ts`), which is
 * where the real seam is. Calling this module the seam invited a second
 * implementation that never arrived.
 */
export const client = {
  /** `path` is a Written path; the backend expands it. */
  startScan: (path: string) => callSilent("start_scan", { path }),

  /**
   * Resolves a Written path without touching it: no folder is created, and
   * nothing is stored. Rejects with `invalid_path_syntax` when the input is
   * malformed, so there is no resolved path to show.
   */
  expandPath: (input: string) => call("expand_path", { input }),

  /**
   * Answers whether a Written path can serve as the Soft reject destination:
   * relative and so resolved per wallpaper, there and able to take a file, not
   * there yet, or refused with the backend's own sentence.
   *
   * Creates nothing and stores nothing, but it is not free of the filesystem the
   * way `expandPath` is: proving a folder can take a file means writing one into
   * it and removing it again, which is why this is its own call and the Library
   * root's field keeps the read-only one (ADR 0035).
   *
   * Rejects with `invalid_path_syntax` for a malformed path, exactly as
   * `expandPath` does, because there is no destination to have an opinion about
   * until the string resolves.
   */
  checkRejectDestination: (written: string) =>
    call("check_reject_destination", { written }),

  /**
   * Answers whether a Written path can serve as the Download folder, against
   * `libraryRoot` as the curator has it written: no root, a root that is not
   * there, there and able to take a file, not there yet, or refused with the
   * backend's own sentence.
   *
   * The root is passed rather than read from the store, so the Download folder
   * field follows the Library root field before it commits. Creates nothing,
   * and probes a folder that is there the way `checkRejectDestination` does
   * (ADR 0035, ADR 0051). Rejects with `invalid_path_syntax` for a malformed
   * Download folder.
   */
  checkDownloadFolder: (written: string, libraryRoot: string) =>
    call("check_download_folder", { written, libraryRoot }),

  /**
   * Opens the desktop's folder picker and resolves with the folder the curator
   * chose, or with `null` when they dismissed the dialog. A dismissal is an
   * answer rather than a failure, so nothing rejects and a Browse button that
   * was opened by accident costs the field nothing.
   *
   * What comes back is an absolute canonical path, which is the cost ADR 0020
   * accepted for having a Browse button at all: browsing after typing
   * `~/Wallpapers` overwrites it with `/home/qdes/Wallpapers` and discards the
   * portability the `~` was there for. Nothing warns about that, because the
   * curator has just pointed at the folder they meant.
   *
   * `multiple` is spelled out rather than left to the plugin's default, because
   * it is what decides between one path and a list of them, and a path field
   * holds exactly one folder.
   */
  pickFolder: (): Promise<string | null> =>
    open({ directory: true, multiple: false }),

  /**
   * `exclude` names wallpapers that must stay out of the draw — the ones
   * already on screen or queued in the prefetch slot. Honoured only while at
   * least two candidates remain, so a small library still ranks.
   */
  getPair: (exclude?: number[]) => call("get_pair", { exclude }),

  /** `exclude` applies to the returned `next_pair`; the two voted on are always excluded. */
  vote: (winnerId: number, loserId: number, exclude?: number[]) =>
    call("vote", { winnerId, loserId, exclude }),

  getStats: () => call("get_stats"),

  getSettings: () => call("get_settings"),

  /**
   * Writes one setting and answers with all of them, so a stale read cannot
   * survive a write. Keyed on `SettingKey` so a caller cannot invent a key the
   * backend would refuse, name the readout that is not one, or pair a key with
   * the wrong kind of value.
   *
   * A value crosses as a string because a string is what the column holds.
   * `encodeSetting` is the only stringify of a setting in the app: callers hand
   * over a typed value and never build the IPC payload themselves.
   */
  setSetting<K extends SettingKey>(key: K, value: Settings[K]) {
    return call("set_setting", {
      key,
      value: encodeSetting(key, value),
    });
  },

  /**
   * Every wallpaper matching `filter`, in `ordering`, at most `limit` of them.
   * One call and no paging: no offset, no cursor and no page token (ADR 0028).
   *
   * Without a `limit` the row count is the size of the library, so nothing asks
   * a second question to find that out (ADR 0016). With one it is a bounded
   * worklist and says nothing about how many rows exist behind it.
   *
   * Unrated wallpapers tail both Score orderings rather than sorting into the
   * middle on their starting Score, and every ordering breaks its ties by id,
   * so a vote does not reshuffle the list under the user (ADR 0014).
   */
  listWallpapers: (
    filter: StatusFilter = "all",
    ordering: ListOrdering = "score_desc",
    limit?: number,
  ) => call("list_wallpapers", { filter, ordering, limit }),

  /**
   * Keeps a wallpaper and resolves with the row it wrote.
   *
   * All four transitions answer with the row, so a caller edits the row it was
   * told about rather than predicting one: `origin_path = path` on a reject and
   * `origin_path = NULL` on a Restore are the backend's rules, and restating
   * them here would be a prediction however few copies of it there were
   * (ADR 0023).
   */
  keepWallpaper: (id: number) => call("keep_wallpaper", { id }),

  /**
   * Undoes a Keep: the wallpaper lands on Active and comes back into review.
   * Nothing on disk moves, so the `status` column is the whole of what the row
   * it resolves with has changed. Calling it on an Active wallpaper succeeds and
   * leaves it Active, so a double click is not an error — which is also why
   * `keepWallpaper` is not a toggle (ADR 0009).
   *
   * Rejects with `invalid_transition` for a Rejected wallpaper: its file is in
   * the reject folder, and `restoreWallpaper` is what moves it back.
   */
  unkeepWallpaper: (id: number) => call("unkeep_wallpaper", { id }),

  /**
   * Soft-rejects a wallpaper into `destinationFolder`, a Written path the
   * backend expands. Resolves with the row it wrote: a collision suffixes the
   * basename, so the row's `path` is where the file actually is, its `filename`
   * is what the file is called there, and its `origin_path` is where the file
   * came from. Comparing the new `filename` against the one the caller was
   * holding is how it tells a rename from a plain move.
   */
  moveWallpaper: (id: number, destinationFolder: string) =>
    call("move_wallpaper", { id, destinationFolder }),

  /**
   * Undoes a soft reject: the file goes back to its Origin and the wallpaper
   * lands on Active, whatever Status it held before the reject. Resolves with
   * the row it wrote, whose `path` is where the file landed back — a collision
   * at the Origin may have suffixed it — and whose `origin_path` is now `null`,
   * the Origin being spent.
   *
   * Rejects with `invalid_transition` for a wallpaper that is not Rejected and
   * for one rejected before its Origin was recorded — `origin_path` is `null`
   * on the row, so a caller can tell that second case before it asks — and with
   * `file_missing` when the file has left the reject folder.
   */
  restoreWallpaper: (id: number) => call("restore_wallpaper", { id }),

  /**
   * Starts the thumbnail pre-generation pass and resolves as soon as it is
   * spawned, so a launch pass costs the boot nothing. A second call cancels and
   * joins the first, so calling it again is a restart rather than a race.
   *
   * A warm library is silent: the work list comes back empty and neither
   * pregen event is ever emitted (ADR 0012).
   */
  startPregen: () => callSilent("start_pregen"),

  /**
   * Stands the running pass down and resolves without waiting for it, so a
   * cancel lands up to one wallpaper's decode late. Everything already
   * generated stays; the pass runs again next launch.
   */
  cancelPregen: () => callSilent("cancel_pregen"),

  /**
   * Counts the thumbnail cache: one directory read and a `metadata` per entry,
   * about 10,000 stats on the largest library. So read it on mount, on
   * `pregen-complete` and after a clear, never per progress event (ADR 0020).
   */
  getCacheSize: () => call("get_cache_size"),

  /**
   * Cancels any running pass, empties the cache directory and forgets every
   * thumbnail row. Nothing restarts: clearing is a rebuild the next launch pays
   * for rather than a way to reclaim disk, so a caller wanting the cache back
   * calls `startPregen` itself (ADR 0012).
   */
  clearCache: () => callSilent("clear_cache"),

  /**
   * Walks the Eligible pool and answers how many of those wallpapers have no
   * file behind them: one `stat` per Active or Kept row, and no reads.
   *
   * Only ever on the curator's own press. Nothing about a missing file is on a
   * listing, because a filesystem check per row would tax every visit to the
   * library grid to serve the rare case, and the card already learns the same
   * thing for free from the `wallpaper://` request it makes anyway (ADR 0032).
   *
   * It counts files that are not there, not every wallpaper the grid cannot
   * paint: a file that is present and will not decode reads as gone on its card
   * and is not in this number.
   */
  countMissingFiles: () => call("count_missing_files"),

  /**
   * Soft-rejects the wallpapers a `countMissingFiles` counted, by the `ids` it
   * answered with, and resolves with the rows it wrote: Rejected, each `path`
   * unchanged, and each `origin_path` equal to that `path`, because nothing
   * moved (ADR 0050).
   *
   * The backend asks each file again and leaves alone one that came back or a
   * wallpaper already rejected since, so the answer can be shorter than `ids`.
   * The reject destination is not read.
   */
  rejectMissingFiles: (ids: number[]) => call("reject_missing_files", { ids }),

  /**
   * One page of a Wallhaven search, through the backend: the webview never
   * talks to Wallhaven's API itself (ADR 0053). A search that answers is what
   * remembers its filters, so a failed one leaves `discover_filters` as it was.
   *
   * Rejects with `bad_request` for a value Wallhaven would drop, `network` when
   * it could not be reached or answered oddly, and `rate_limited` with the wait.
   * Nothing is retried or cached.
   */
  searchWallhaven: (params: SearchParams) =>
    call("wallhaven_search", { params }),

  /**
   * Saves a Wallhaven API key once one keyed search has not refused it, or
   * removes the saved one when `key` is empty, and answers every setting and
   * whether the check reached Wallhaven. The key goes one way: nothing ever
   * sends it back (ADR 0052).
   *
   * Rejects with `bad_request` when Wallhaven answered the check with a 401,
   * and the key is not stored. Offline or rate-limited, it is stored anyway and
   * answers `verified: false`.
   */
  setWallhavenKey: (key: string) => call("set_wallhaven_key", { key }),

  /**
   * Hands `handler` every emission of one backend event, resolving with the
   * unsubscribe once the listener is actually registered.
   *
   * Resolving late is the whole difficulty: an effect that unmounts before this
   * settles has to unsubscribe anyway, and forgetting to leaks a listener that
   * fires into a dead component for the life of the window. No component calls
   * this — `useBackendEvents` does, once, and it is what holds that rule.
   *
   * One event name, one cast: `listen` returns Promise<UnlistenFn>, not
   * Promise<() => void>, and UnlistenFn is a branded type that isn't nominally
   * assignable, so it becomes the plain function type callers get. The event
   * map is what keeps the payload type tied to the name.
   */
  subscribe<E extends keyof BackendEvents>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ) {
    return listen<BackendEvents[E]>(event, (received) =>
      handler(received.payload),
    ) as Promise<() => void>;
  },
};
