/**
 * How the app writes a fact down, when more than one surface writes it.
 *
 * Two surfaces print the same numbers about the same work: the shell's report of
 * a scan or a pass, and the Settings page's Thumbnails line. ADR 0021 put
 * `240 of 1,204` in the toast precisely because ADR 0020 already prints those
 * words in that section — "one fact, one phrasing, in both places" — so the
 * phrasing lives here rather than once per caller, where the two would eventually
 * disagree about a comma.
 *
 * The same rule brought the Status and Score wording down here from the library
 * page. A Status is a pill, an accessible name and a row on the library's list,
 * and a Score is a badge, a caption and a row; each of those is a different
 * component writing down the same fact, and there is nothing to gain from two of
 * them spelling it differently.
 *
 * Nothing here is a component and nothing here reaches the backend, which is why
 * it sits beside `client.ts` rather than inside any of the files that call it.
 */
import type { Resolution, Status, Wallpaper } from "@/lib/client";
import { croppedAxis, type CropPlan } from "@/lib/layout-plan";

/**
 * A count as the copy writes it, grouped in threes: `1,536` and not `1536`.
 *
 * Grouped here rather than through `toLocaleString`, which reads the host's
 * locale: the app ships one language, and a German desktop would put `1.536` in
 * one of those two sentences while the other one said `1,536`.
 */
export function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1,536 files`, and `1 file`, so the noun agrees with the count in front of it. */
export function counted(count: number, noun: string): string {
  return `${grouped(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The units a cache size is written in, smallest first. `KB` rather than SI's
 * `kB`, which is how every document that already states a number about this
 * cache spells it (ADR 0012, ADR 0020).
 */
const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * A byte count as the copy writes it: `48 MB`, `1.6 MB`, `0 B`.
 *
 * **Powers of 1,000, not of 1,024**, and so `MB` rather than `MiB`. Every number
 * already written down about this cache is decimal: ADR 0012 measured 120 medium
 * thumbnails at 46MB and read 383KB per file off it, which is 46,000,000 ÷ 120,
 * and its 830MB projection is 2,000 × 414KB the same way. Reading those same
 * bytes in binary would print `44 MB` under a heading whose own ADR says 46, and
 * the sizing argument for the whole cache would stop adding up on screen. What
 * that costs is `du -h`, which is binary and is the one place a curator could
 * cross-check this line; a 5% disagreement with one shell command is cheaper than
 * disagreeing with every decision already recorded about this directory.
 *
 * One decimal below ten and none above, which is what makes ADR 0012's own two
 * readings come out as themselves — `1.6 MB` for the smalls, `46 MB` for the
 * mediums — while keeping the line short at the sizes that matter. Bytes are
 * whole, because there is nothing useful left to say after the decimal point down
 * there.
 */
export function bytes(count: number): string {
  let value = count;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // Rounded through `Number` so a trailing zero goes: `1 MB` rather than
  // `1.0 MB`, and ADR 0012's "2GB for 5000 wallpapers" comes out as `2 GB`.
  const rounded =
    unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${UNITS[unit]}`;
}

/**
 * The three Statuses, written the way CONTEXT.md names them.
 *
 * Capitalised, because these are the domain's proper nouns rather than adjectives
 * — the same three words the glossary uses — and the filter control offers them
 * in the same spelling (ADR 0016). The map is keyed on `Status` itself, so a
 * fourth Status could not be added to the DTO without a line arriving here for
 * it.
 */
export const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  kept: "Kept",
  rejected: "Rejected",
};

/**
 * What a wallpaper whose file will not load says about itself.
 *
 * Three surfaces write this fact: the card in the grid, the lightbox, and the
 * count on the Settings page. It is here for the reason the Status labels and
 * the Score wording are — one fact, one phrasing — and the phrasing is the part
 * that matters, because the sentence has one job: telling the curator the app
 * did not break. A stranger's library changes underneath the app constantly, so
 * the reading has to be "your file went" rather than "something failed".
 *
 * Not a Status, and not written like one. `CONTEXT.md` has three and a file that
 * comes back when a drive is plugged in is not a fourth: this is what the app
 * can see right now, which is why the word is `gone` rather than a term the
 * glossary would have to carry (ADR 0032).
 */
export const FILE_IS_GONE = "File is gone";

/**
 * The lightbox's second line, which has the room for it.
 *
 * It names the cause, because that is the half the curator cannot see and the
 * whole reason this state exists: nothing in the app deleted the file. The card
 * says only `FILE_IS_GONE`, since a tile in a grid of hundreds has room for a
 * label and not for a sentence (ADR 0032).
 */
export const FILE_IS_GONE_DETAIL =
  "It was moved or deleted outside walltare. Nothing here has changed.";

/**
 * A Score as every surface showing one writes it: μ to one decimal, or `Unrated`.
 *
 * The answer is not simply the number, because a wallpaper in no Comparison has
 * no Score yet. Every one of them holds exactly 25.0, which is the starting value
 * and not a measurement, and printing it would sort the app's own ignorance into
 * the middle of a list as though it had been judged (ADR 0013).
 *
 * One decimal and nothing else: no unit, no second number and no word `Score`,
 * which ADR 0013 keeps to the places with room for it — the hover overlay, the
 * lightbox caption and the library's sort control.
 */
export function score(wallpaper: Wallpaper): string {
  if (wallpaper.comparisons_count === 0) return "Unrated";
  return wallpaper.rating_mu.toFixed(1);
}

/**
 * A size as the curator reads it: `3840 × 2160`, with the multiplication sign
 * rather than the `x` the settings column holds.
 *
 * Two kinds of thing are written this way and they are not the same kind. The
 * Screen and the Minimum resolution are stated preferences; a wallpaper's
 * Dimensions are a fact about a file. What they share is the shape and so the
 * phrasing, which is the whole of why it is down here rather than in either of
 * the surfaces that prints one (CONTEXT.md).
 */
export function readableSize({ width, height }: Resolution): string {
  return `${width} × ${height}`;
}

/**
 * What a wallpaper below the Minimum resolution is called, on the badge that
 * says so and in the accessible name of the card carrying it.
 *
 * Not a Status, and not written like one. CONTEXT.md has three of those and
 * undersized is not a fourth: it is a fact about a file next to a preference, so
 * an undersized wallpaper is still Eligible, still votes and still appears in
 * review. The word sits here for the reason `FILE_IS_GONE` does — one fact, one
 * phrasing, wherever it is printed.
 */
export const UNDERSIZED = "Undersized";

/**
 * What the crop preview says it is answering about, and how much it costs:
 * `3840 × 2160 · 24% of the width is cut`, the prototype's sentence (#254).
 *
 * The Screen is named rather than assumed, because the whole claim the bars make
 * is about one particular display and the curator may have overridden what the
 * app detected (CONTEXT.md). The share follows it, because a percentage with no
 * subject is a number nobody can check.
 *
 * `null` is a wallpaper whose Dimensions nothing has read, so there is no plan. There is no share to
 * print then and no bars beside this line either: ADR 0044's rule is that a
 * wallpaper with no Dimensions says nothing rather than something wrong, and a
 * caption that named a percentage off the 16:9 the layouts fall back to would be
 * the app inventing one. It still names the Screen, so pressing `C` on a row
 * mid-backfill answers with why there is nothing to see.
 *
 * The axis is named because cropping to fill cuts on one only: a wallpaper wider
 * in ratio than the Screen loses width, a narrower one height, and "24% of the
 * width" is a sentence the curator can check against the bars on the sides.
 *
 * `nothing cropped` rather than `0% of the width is cut` for a wallpaper of the
 * Screen's own shape, and `under 1%` for a loss that would round to zero: both
 * are cases where the rounded number would read as "none of it goes" when only
 * one of them means it.
 */
export function cropCaption(screen: Resolution, plan: CropPlan | null): string {
  const size = readableSize(screen);
  if (plan === null) return `${size} · dimensions not read yet`;
  const axis = croppedAxis(plan);
  if (axis === null) return `${size} · nothing cropped`;
  const percent = Math.round(plan.lost * 100);
  return percent === 0
    ? `${size} · under 1% of the ${axis} is cut`
    : `${size} · ${percent}% of the ${axis} is cut`;
}
