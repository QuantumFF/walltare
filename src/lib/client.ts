import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Types mirroring the Rust DTOs locked in #4. Do not use these types or any
// invoke/listen call outside this module — everything goes through `client`.

export type ThumbnailSize = "small" | "medium" | "full";

/**
 * Mirrors voting::Wallpaper and db::Wallpaper, which are the same shape; status
 * is the lowercase DB value (db.rs CHECK constraint). One interface serving both
 * is why a field either DTO sends has to be on both of them.
 */
export interface Wallpaper {
  id: number;
  filename: string;
  path: string;
  status: "active" | "kept" | "rejected";
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

/** Mirrors voting::Stats */
export interface Stats {
  total_wallpapers: number;
  total_comparisons: number;
  evaluated_count: number;
  participated_count: number;
  percentage: number;
}

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
  onScanProgress(handler: (payload: ScanProgress) => void): Promise<() => void>;
  onScanComplete(handler: (payload: ScanComplete) => void): Promise<() => void>;
  onScanFailed(handler: (payload: ScanFailed) => void): Promise<() => void>;
}

async function invokeVoid(name: string, args?: Record<string, unknown>) {
  await invoke<null>(name, args);
}

export const client: Client = {
  startScan: (path) => invokeVoid("start_scan", { path }),

  expandPath: (input) => invoke<Expanded>("expand_path", { input }),

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

  keepWallpaper: (id) => invokeVoid("keep_wallpaper", { id }),

  unkeepWallpaper: (id) => invokeVoid("unkeep_wallpaper", { id }),

  moveWallpaper: (id, destinationFolder) =>
    invoke<string>("move_wallpaper", { id, destinationFolder }),

  restoreWallpaper: (id) => invoke<string>("restore_wallpaper", { id }),

  // `listen` returns Promise<UnlistenFn>, not Promise<() => void>; UnlistenFn
  // is a branded type that isn't nominally assignable, so cast to the plain
  // function type the Client interface promises.
  onScanProgress: (handler) =>
    listen<ScanProgress>("scan-progress", (event) =>
      handler(event.payload),
    ) as Promise<() => void>,

  onScanComplete: (handler) =>
    listen<ScanComplete>("scan-complete", (event) =>
      handler(event.payload),
    ) as Promise<() => void>,

  onScanFailed: (handler) =>
    listen<ScanFailed>("scan-failed", (event) =>
      handler(event.payload),
    ) as Promise<() => void>,
};
