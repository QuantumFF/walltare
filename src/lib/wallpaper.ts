/**
 * What the app decides about a wallpaper from its row alone.
 *
 * Predicates rather than phrasing: whether a wallpaper is Evaluated, what its
 * Dimensions are, whether it is undersized and what shape it is. They lived in
 * `copy.ts` beside the words that print their answers, but a badge, a filter
 * and a layout all ask them, and none of those is writing anything down. The
 * words stay in `copy.ts`; the questions they answer live here.
 *
 * Nothing here is a component and nothing here reaches the backend: each is a
 * pure function of a row and whatever setting the caller holds.
 */
import type { Resolution, Wallpaper } from "@/lib/client";

/**
 * CONTEXT.md's Evaluated, per wallpaper: σ below the threshold the curator set.
 *
 * The threshold is a setting and not a constant, because how many Comparisons
 * make a Score trustworthy is the curator's call (ADR 0046). It is passed in
 * rather than read here so this stays a pure function of a row and a number —
 * and so every surface that shows a Score badge (the card, the lightbox, the
 * Review hero) answers off the same comparison and cannot drift apart.
 *
 * A Score badge dims until a wallpaper reaches the threshold, and that is the
 * whole of what the app says about confidence: no second number and no bands, so
 * there is one definition to disagree with rather than two (ADR 0013, ADR 0019).
 *
 * A wallpaper in no Comparison is never Evaluated at any offered threshold — it
 * still holds the starting σ of 8.333 — so the dimmed badge and `Unrated` agree
 * without either checking the other.
 */
export function isEvaluated(wallpaper: Wallpaper, threshold: number): boolean {
  return wallpaper.rating_sigma < threshold;
}

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

/**
 * A wallpaper's shape, as height over width, or `null` while the app has not
 * read its Dimensions.
 *
 * Named for the wallpaper's own shape rather than for the card's, because
 * `UniformRow.cardRatio` in the layout plan is the other thing: the one shape
 * every card is cropped to. A layout reads exactly one of the two, and which one
 * it reads is the whole of what separates the plans.
 *
 * `null` and not a guess, because the guess belongs to the layout rather than to
 * the row: a plan that draws uncropped answers for an unknown shape with the one
 * the uniform grid crops to, and a plan that crops never asks. CONTEXT.md is
 * what makes that the rule — a wallpaper whose Dimensions have not been read has
 * none rather than a guess (ADR 0044).
 *
 * Read off `dimensionsOf` above, so "unknown means both" stays said once; the
 * `width <= 0` guard is this function's own, since a ratio over a zero width is
 * no shape either.
 */
export function shapeOf(wallpaper: Wallpaper): number | null {
  const size = dimensionsOf(wallpaper);
  if (size === null || size.width <= 0) return null;
  return size.height / size.width;
}

/**
 * Where the Bar falls in a worklist ordered from the lowest Score: the position
 * of the first wallpaper with a Score not below it, or `null` when no rule
 * belongs in this list.
 *
 * Strict about the side, as Decided is: a Score exactly on the Bar is not below
 * it. An Unrated wallpaper has no Score, so the tail of them never places the
 * rule. With no Bar, or every scored wallpaper here below it, the Bar lies past
 * what the list reaches, and a rule at the end would claim a place the list
 * cannot vouch for (CONTEXT.md, ADR 0056).
 */
export function barFallsAt(
  wallpapers: readonly Wallpaper[],
  bar: number | null,
): number | null {
  if (bar === null) return null;
  const at = wallpapers.findIndex(
    (w) => w.comparisons_count > 0 && w.rating_mu >= bar,
  );
  return at === -1 ? null : at;
}
