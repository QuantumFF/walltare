import { Badge } from "@/components/ui/badge";
import type { Wallpaper } from "@/lib/client";
import { confidence, score } from "@/lib/copy";
import { isEvaluated } from "@/lib/wallpaper";
import { cn } from "@/lib/utils";

/**
 * A wallpaper's Score as a badge: the card's corner and the lightbox's row.
 *
 * μ to one decimal, or `Unrated`, and nothing else: no unit, no second number
 * and not the word Score, which ADR 0013 keeps to the surfaces with room for
 * it. Solid says Evaluated and dimmed says not yet, off the one σ threshold the
 * curator set, so confidence is one fact with one definition rather than a band
 * scale invented per surface (ADR 0046). Most badges on a young library are
 * dimmed and that is correct: σ is a late signal at every threshold offered.
 * The tooltip, `confidence` in `copy.ts`, is what says which state the dimming
 * is.
 *
 * **Handed the threshold rather than reading the settings itself.** The card
 * is memoised and every prop it takes is a value (ADR 0042); a badge that read
 * `useApp()` would re-render every card in a grid on any change to the app's
 * state, whatever key moved. A number costs nothing to pass, and it is what
 * ADR 0046 already chose for the card. The lightbox, which is no child of a
 * grid, reads the setting where it renders and hands it over the same way.
 *
 * `moved` is the one other thing it can read, `Score moved`, and it is not a
 * way of writing a Score down at all — it is the app saying it no longer knows
 * one, which is why it stays here rather than joining `score()` in `copy.ts`.
 * Only a page subscribed to `score-changed` can hand it over, and only the two
 * wallpapers a Comparison named get it (#129).
 */
export function ScoreBadge({
  wallpaper,
  evaluatedThreshold,
  moved = false,
  className,
}: {
  wallpaper: Wallpaper;
  /** The curator's Evaluated threshold, as a σ (ADR 0046). */
  evaluatedThreshold: number;
  /** A Comparison moved this Score since the page last fetched it. */
  moved?: boolean;
  /** The surface's own size and finish, not its tone. */
  className?: string;
}) {
  return (
    <Badge
      title={confidence(wallpaper, evaluatedThreshold)}
      className={cn(
        className,
        isEvaluated(wallpaper, evaluatedThreshold)
          ? "bg-white text-neutral-900"
          : "border-white/30 bg-black/50 text-white/70",
      )}
    >
      {moved ? "Score moved" : score(wallpaper)}
    </Badge>
  );
}
