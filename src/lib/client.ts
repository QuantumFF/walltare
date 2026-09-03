import { invoke } from "@tauri-apps/api/core";
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
  | "score_desc"
  | "score_asc"
  | "filename_asc"
  | "recently_added";

/** Mirrors settings::Theme; each string is what `set_setting` accepts back. */
export type Theme = "system" | "light" | "dark";

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
}

/**
 * What every key means with no row in the table, mirroring `Settings::default`.
 *
 * settings.rs owns the answer; this copy exists only for the boot path, which
 * has to render something when `get_settings` fails.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  library_root: "",
  reject_destination: "./rejected",
};

/** Mirrors voting::VoteOutcome */
export interface VoteOutcome {
  /**
   * `null` when the vote was recorded but the follow-up pair fetch failed. The
   * Comparison still counted, so this is a cue to re-fetch, not an error.
   */
  next_pair: [Wallpaper, Wallpaper] | null;
  stats: Stats;
}

/** Payload of the `scan-progress` event (lib.rs ScanProgress) */
export interface ScanProgress {
  scanned: number;
  added: number;
}

/** Payload of the `scan-complete` event (lib.rs ScanComplete) */
export interface ScanComplete {
  added_count: number;
  /** Images the walk found, new or already known. See lib.rs ScanComplete. */
  scanned_count: number;
}

/** Payload of the `scan-failed` event (lib.rs ScanFailed) */
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
 * Mirrors lib.rs Expanded: where a Written path points, and whether a folder is
 * there. `exists` is `is_dir()`, so a file at that path reads as `false`.
 */
export interface Expanded {
  resolved: string;
  exists: boolean;
}

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

export interface Client {
  /** `path` is a Written path; the backend expands it. */
  startScan(path: string): Promise<void>;
  /**
   * Resolves a Written path without touching it: no folder is created, and
   * nothing is stored. Rejects with `invalid_path_syntax` when the input is
   * malformed, so there is no resolved path to show.
   */
  expandPath(input: string): Promise<Expanded>;
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
   */
  pickFolder(): Promise<string | null>;
  /**
   * `exclude` names wallpapers that must stay out of the draw — the ones
   * already on screen or queued in the prefetch slot. Honoured only while at
   * least two candidates remain, so a small library still ranks.
   */
  getPair(exclude?: number[]): Promise<[Wallpaper, Wallpaper]>;
  /** `exclude` applies to the returned `next_pair`; the two voted on are always excluded. */
  vote(
    winnerId: number,
    loserId: number,
    exclude?: number[],
  ): Promise<VoteOutcome>;
  getStats(): Promise<Stats>;
  getSettings(): Promise<Settings>;
  /**
   * Writes one setting and answers with all of them, so a stale read cannot
   * survive a write. Keyed on `keyof Settings` so a caller cannot invent a key
   * the backend would refuse, or pair a key with the wrong kind of value.
   */
  setSetting<K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ): Promise<Settings>;
  getReview(limit?: number): Promise<Wallpaper[]>;
  /**
   * Every wallpaper matching `filter`, in `ordering`. One call, no paging: the
   * row count is the size of the library, so nothing asks a second question to
   * find that out (ADR 0016).
   *
   * Unrated wallpapers tail both Score orderings rather than sorting into the
   * middle on their starting Score, and every ordering breaks its ties by id,
   * so a vote does not reshuffle the list under the user (ADR 0014).
   */
  listWallpapers(
    filter?: StatusFilter,
    ordering?: ListOrdering,
  ): Promise<Wallpaper[]>;
  keepWallpaper(id: number): Promise<void>;
  /**
   * Undoes a Keep: the wallpaper lands on Active and comes back into review.
   * Nothing on disk moves, so there is no path to resolve with. Calling it on an
   * Active wallpaper succeeds and leaves it Active, so a double click is not an
   * error — which is also why `keepWallpaper` is not a toggle (ADR 0009).
   *
   * Rejects with `invalid_transition` for a Rejected wallpaper: its file is in
   * the reject folder, and `restoreWallpaper` is what moves it back.
   */
  unkeepWallpaper(id: number): Promise<void>;
  /**
   * Soft-rejects a wallpaper into `destinationFolder`, a Written path the
   * backend expands. Resolves with the absolute path the file landed at: a
   * collision suffixes the basename, so comparing it against the wallpaper's
   * `filename` is how a caller tells a rename from a plain move.
   */
  moveWallpaper(id: number, destinationFolder: string): Promise<string>;
  /**
   * Undoes a soft reject: the file goes back to its Origin and the wallpaper
   * lands on Active, whatever Status it held before the reject. Resolves with
   * the absolute path the file landed back at, which a collision at the Origin
   * may have suffixed.
   *
   * Rejects with `invalid_transition` for a wallpaper that is not Rejected and
   * for one rejected before its Origin was recorded — `origin_path` is `null`
   * on the row, so a caller can tell that second case before it asks — and with
   * `file_missing` when the file has left the reject folder.
   */
  restoreWallpaper(id: number): Promise<string>;
  /**
   * Starts the thumbnail pre-generation pass and resolves as soon as it is
   * spawned, so a launch pass costs the boot nothing. A second call cancels and
   * joins the first, so calling it again is a restart rather than a race.
   *
   * A warm library is silent: the work list comes back empty and neither event
   * below is ever emitted (ADR 0012).
   */
  startPregen(): Promise<void>;
  /**
   * Stands the running pass down and resolves without waiting for it, so a
   * cancel lands up to one wallpaper's decode late. Everything already
   * generated stays; the pass runs again next launch.
   */
  cancelPregen(): Promise<void>;
  /**
   * Counts the thumbnail cache: one directory read and a `metadata` per entry,
   * about 10,000 stats on the largest library. So read it on mount, on
   * `pregen-complete` and after a clear, never per progress event (ADR 0020).
   */
  getCacheSize(): Promise<CacheSize>;
  /**
   * Cancels any running pass, empties the cache directory and forgets every
   * thumbnail row. Nothing restarts: clearing is a rebuild the next launch pays
   * for rather than a way to reclaim disk, so a caller wanting the cache back
   * calls `startPregen` itself (ADR 0012).
   */
  clearCache(): Promise<void>;
  /**
   * Hands `handler` every emission of one backend event, resolving with the
   * unsubscribe once the listener is actually registered.
   *
   * Resolving late is the whole difficulty: an effect that unmounts before this
   * settles has to unsubscribe anyway, and forgetting to leaks a listener that
   * fires into a dead component for the life of the window. No component calls
   * this — `useBackendEvents` does, once, and it is what holds that rule.
   */
  subscribe<E extends keyof BackendEvents>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Promise<() => void>;
}

async function invokeVoid(name: string, args?: Record<string, unknown>) {
  await invoke<null>(name, args);
}

export const client: Client = {
  startScan: (path) => invokeVoid("start_scan", { path }),

  expandPath: (input) => invoke<Expanded>("expand_path", { input }),

  // `multiple` is spelled out rather than left to the plugin's default, because
  // it is what decides between one path and a list of them, and a path field
  // holds exactly one folder.
  pickFolder: () => open({ directory: true, multiple: false }),

  getPair: (exclude) => invoke<[Wallpaper, Wallpaper]>("get_pair", { exclude }),

  vote: (winnerId, loserId, exclude) =>
    invoke<VoteOutcome>("vote", { winnerId, loserId, exclude }),

  getStats: () => invoke<Stats>("get_stats"),

  getSettings: () => invoke<Settings>("get_settings"),

  // A value crosses as a string because a string is what the column holds. This
  // is the only stringify of a setting in the app: callers hand over a typed
  // value and never build the IPC payload themselves.
  setSetting: (key, value) =>
    invoke<Settings>("set_setting", { key, value: String(value) }),

  getReview: (limit = 50) => invoke<Wallpaper[]>("get_review", { limit }),

  listWallpapers: (filter = "all", ordering = "score_desc") =>
    invoke<Wallpaper[]>("list_wallpapers", { filter, ordering }),

  keepWallpaper: (id) => invokeVoid("keep_wallpaper", { id }),

  unkeepWallpaper: (id) => invokeVoid("unkeep_wallpaper", { id }),

  moveWallpaper: (id, destinationFolder) =>
    invoke<string>("move_wallpaper", { id, destinationFolder }),

  restoreWallpaper: (id) => invoke<string>("restore_wallpaper", { id }),

  startPregen: () => invokeVoid("start_pregen"),

  cancelPregen: () => invokeVoid("cancel_pregen"),

  getCacheSize: () => invoke<CacheSize>("get_cache_size"),

  clearCache: () => invokeVoid("clear_cache"),

  // One event name, one cast: `listen` returns Promise<UnlistenFn>, not
  // Promise<() => void>, and UnlistenFn is a branded type that isn't nominally
  // assignable, so it becomes the plain function type the interface promises.
  // The event map is what keeps the payload type tied to the name.
  subscribe<E extends keyof BackendEvents>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ) {
    return listen<BackendEvents[E]>(event, (received) =>
      handler(received.payload),
    ) as Promise<() => void>;
  },
};
