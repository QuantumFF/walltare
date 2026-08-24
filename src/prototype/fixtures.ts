// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// Fixture data for the shell / library grid / lightbox prototype. No IPC: the
// real app's only route to `invoke` is src/lib/client.ts and a prototype has no
// business going through it.
//
// The rows in library.json are the live 120-wallpaper library, exported as-is,
// so the Score spread, the σ band and the 45 Unrated wallpapers are real. Two
// things are fabricated on top, deliberately:
//
//   1. Statuses. Every real row is Active, so a library page that shows all
//      three statuses would have nothing to show. Kept and Rejected are
//      assigned by id here.
//   2. An aged slice. Nothing in the live library is Evaluated (σ tops out at
//      6.07, the threshold is 4.0), so the solid badge state would never
//      render. Ids ending in 3 or 7 get σ and comparison counts taken from
//      ADR 0013's own table, which is where the numbers below come from.

import rows from "./library.json";

export type Status = "active" | "kept" | "rejected";

export interface ProtoWallpaper {
  id: number;
  filename: string;
  /** Where the file is now. For a Rejected wallpaper, inside the reject folder. */
  path: string;
  /** Where a Rejected wallpaper came from, per ADR 0009. Null for everything else. */
  origin_path: string | null;
  status: Status;
  rating_mu: number;
  rating_sigma: number;
  comparisons_count: number;
  /** Scan order stand-in, for a sort control that offers one. */
  created_at: number;
}

/** σ below this is Evaluated. CONTEXT.md, Evaluated / Participated. */
export const EVALUATED_SIGMA = 4.0;

const REJECT_FOLDER = "rejected";

/** ADR 0013's measured σ decay, so an aged wallpaper carries a plausible pair. */
const AGED: Array<[comparisons: number, sigma: number]> = [
  [8, 3.46],
  [10, 3.03],
  [14, 2.51],
  [20, 1.98],
];

function rejectPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return `${path.slice(0, cut)}/${REJECT_FOLDER}${path.slice(cut)}`;
}

export const LIBRARY: ProtoWallpaper[] = rows.map((row, index) => {
  // Rejected: every 5th. Kept: every 7th. Aged: ids ending 3 or 7.
  const rejected = row.id % 5 === 0;
  const kept = !rejected && row.id % 7 === 0;
  const aged = row.comparisons_count > 0 && (row.id % 10 === 3 || row.id % 10 === 7);
  const [comparisons, sigma] = AGED[row.id % AGED.length];

  return {
    id: row.id,
    filename: row.filename,
    path: rejected ? rejectPath(row.path) : row.path,
    origin_path: rejected ? row.path : null,
    status: rejected ? "rejected" : kept ? "kept" : "active",
    rating_mu: row.rating_mu,
    rating_sigma: aged ? sigma : row.rating_sigma,
    comparisons_count: aged ? comparisons : row.comparisons_count,
    created_at: 1_760_000_000 - index * 3_600,
  };
});

/** One row rejected before ADR 0009's migration: no Origin, so it cannot be restored. */
export const LEGACY_REJECT_ID = LIBRARY.find((w) => w.status === "rejected")!.id;
for (const w of LIBRARY) {
  if (w.id === LEGACY_REJECT_ID) w.origin_path = null;
}

export const EVALUATED_COUNT = LIBRARY.filter(
  (w) => w.status !== "rejected" && w.rating_sigma < EVALUATED_SIGMA,
).length;

export const ELIGIBLE_COUNT = LIBRARY.filter((w) => w.status !== "rejected").length;

/** Stats as ADR 0008 reshaped it: Round is derived, `percentage` is gone. */
export const STATS = {
  total_wallpapers: LIBRARY.length,
  eligible_count: ELIGIBLE_COUNT,
  round: 2,
  round_participated_count: Math.round(ELIGIBLE_COUNT * 0.63),
  evaluated_count: EVALUATED_COUNT,
  total_comparisons: 137,
};

export const ROUND_PERCENT = Math.round(
  (STATS.round_participated_count / STATS.eligible_count) * 100,
);

/** ADR 0008's hover string for the Round element, with these counts in it. */
export const ROUND_EXPLAINER =
  `Round ${STATS.round}: ${STATS.round_participated_count} of ` +
  `${STATS.eligible_count} wallpapers have been compared at least ` +
  `${STATS.round} times.`;

export function cardSrc(id: number): string {
  return `/proto-images/${id}_card.jpg`;
}

/** The lightbox serves `medium` only. ADR 0006. */
export function largeSrc(id: number): string {
  return `/proto-images/${id}_large.jpg`;
}

export function isEvaluated(w: ProtoWallpaper): boolean {
  return w.rating_sigma < EVALUATED_SIGMA && w.comparisons_count > 0;
}

/**
 * What the badge reads. ADR 0013: Score is μ to one decimal, the number alone,
 * and a wallpaper with no Comparison reads `Unrated` because its 25.0 is the
 * starting value rather than a measurement.
 */
export function scoreLabel(w: ProtoWallpaper): string {
  return w.comparisons_count === 0 ? "Unrated" : w.rating_mu.toFixed(1);
}

export function statusLabel(status: Status): string {
  return status === "active" ? "Active" : status === "kept" ? "Kept" : "Rejected";
}

/** The pair the rank view is showing, so the header is judged over real content. */
export const RANK_PAIR: [ProtoWallpaper, ProtoWallpaper] = [
  LIBRARY.find((w) => w.status === "active")!,
  LIBRARY.filter((w) => w.status === "active")[3],
];

export const REVIEW_LIST: ProtoWallpaper[] = LIBRARY.filter(
  (w) => w.status === "active",
)
  .slice()
  .sort((a, b) => a.rating_mu - b.rating_mu)
  .slice(0, 50);
