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
 * CONTEXT.md's Evaluated, per wallpaper: σ below 4.0, roughly half the starting
 * uncertainty and about seven comparisons away from it.
 *
 * The number is the one `voting.rs` counts `evaluated_count` with
 * (`WHERE status IN ('active', 'kept') AND rating_sigma < 4.0`), and this is the
 * frontend's only copy of it. A Score badge dims until a wallpaper reaches it,
 * and that is the whole of what the app says about confidence: no second number
 * and no bands, so there is one definition to disagree with rather than two
 * (ADR 0013, ADR 0019).
 *
 * A wallpaper in no Comparison is never Evaluated — it still holds the starting
 * σ — so the dimmed badge and `Unrated` agree without either checking the other.
 */
export const EVALUATED_SIGMA = 4.0;

export function isEvaluated(wallpaper: Wallpaper): boolean {
  return wallpaper.rating_sigma < EVALUATED_SIGMA;
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
 * A wallpaper's Dimensions as one size, or `null` while nothing has read them.
 *
 * The two columns are NULL together and set together — they are written in one
 * statement and read off one file — so the pair is one fact and this is the one
 * place that says so (ADR 0044). Both readers want the pair rather than either
 * half: the comparison below needs two numbers and the badge's tooltip prints
 * two numbers, and each of them re-deriving "unknown means both" is a second
 * copy of a rule that can only ever be wrong in the same way.
 */
export function dimensionsOf(wallpaper: Wallpaper): Resolution | null {
  const { width, height } = wallpaper;
  return width === null || height === null ? null : { width, height };
}

/**
 * CONTEXT.md's undersized: a wallpaper whose Dimensions fall below the Minimum
 * resolution.
 *
 * Below on either axis, rather than by a count of pixels. The question the
 * curator is asking is whether the file covers their screen, and a 3840x1080
 * ultrawide holds more pixels than a 2560x1440 while leaving half of a 4K
 * desktop for the upscaler to invent.
 *
 * **A wallpaper whose Dimensions nothing has read is not undersized.** That is
 * ADR 0044's rule, and it is one rule for both readers: no badge on the card,
 * and out of the filter rather than counted either way. `dimensionsOf` above is
 * where the unread row is recognised, so this reads as the comparison it is.
 *
 * The minimum arrives as an argument rather than being read from the settings
 * store here, because this file reaches nothing: the card is handed a boolean
 * and the library page holds the setting, which is what keeps a badge and a
 * filter that must agree reading one comparison.
 */
export function isUndersized(
  wallpaper: Wallpaper,
  minimum: Resolution,
): boolean {
  const size = dimensionsOf(wallpaper);
  if (size === null) return false;
  return size.width < minimum.width || size.height < minimum.height;
}
