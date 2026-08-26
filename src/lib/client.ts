import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Types mirroring the Rust DTOs locked in #4. Do not use these types or any
// invoke/listen call outside this module — everything goes through `client`.

export type ThumbnailSize = "small" | "medium" | "full";

/** Mirrors voting::Wallpaper; status is the lowercase DB value (db.rs CHECK constraint) */
export interface Wallpaper {
  id: number;
  filename: string;
  path: string;
  status: "active" | "kept" | "rejected";
  rating_mu: number;
  rating_sigma: number;
  comparisons_count: number;
}

/** Mirrors voting::Stats */
export interface Stats {
  total_wallpapers: number;
  total_comparisons: number;
  evaluated_count: number;
  participated_count: number;
  percentage: number;
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
  getReview(limit?: number): Promise<Wallpaper[]>;
  keepWallpaper(id: number): Promise<void>;
  moveWallpaper(id: number, destinationFolder: string): Promise<void>;
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

  getReview: (limit = 50) => invoke<Wallpaper[]>("get_review", { limit }),

  keepWallpaper: (id) => invokeVoid("keep_wallpaper", { id }),

  moveWallpaper: (id, destinationFolder) =>
    invokeVoid("move_wallpaper", { id, destinationFolder }),

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
