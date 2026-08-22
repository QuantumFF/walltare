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
  next_pair: [Wallpaper, Wallpaper];
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
}

/** Tagged `{ kind, message }` union mirroring error::AppError (serde snake_case) */
export type AppErrorKind =
  | "not_found"
  | "invalid_path"
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

export function wallpaperImageUrl(
  id: number,
  size: ThumbnailSize = "full",
): string {
  return `wallpaper://image/${id}?size=${size}`;
}

export interface Client {
  startScan(path: string): Promise<void>;
  getPair(): Promise<[Wallpaper, Wallpaper]>;
  vote(winnerId: number, loserId: number): Promise<VoteOutcome>;
  getStats(): Promise<Stats>;
  getReview(limit?: number): Promise<Wallpaper[]>;
  keepWallpaper(id: number): Promise<void>;
  moveWallpaper(id: number, destinationFolder: string): Promise<void>;
  onScanProgress(handler: (payload: ScanProgress) => void): Promise<() => void>;
  onScanComplete(handler: (payload: ScanComplete) => void): Promise<() => void>;
}

async function invokeVoid(name: string, args?: Record<string, unknown>) {
  await invoke<null>(name, args);
}

export const client: Client = {
  startScan: (path) => invokeVoid("start_scan", { path }),

  getPair: () => invoke<[Wallpaper, Wallpaper]>("get_pair"),

  vote: (winnerId, loserId) =>
    invoke<VoteOutcome>("vote", { winnerId, loserId }),

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
};
