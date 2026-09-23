import { ItemGrid, type ItemGridProps } from "@/components/ItemGrid";
import { WallpaperCard } from "@/components/WallpaperCard";
import { WALLPAPER_CARD } from "@/components/grid-geometry";
import { STATUS_KEYS } from "@/components/keymap";
import type { TransitionAction } from "@/components/transitions";
import {
  thumbnailSizeFor,
  type Resolution,
  type Wallpaper,
} from "@/lib/client";
import { isUndersized, shapeOf } from "@/lib/wallpaper";

export interface WallpaperGridProps extends Omit<
  ItemGridProps<Wallpaper, TransitionAction>,
  "items" | "renderCard" | "actions" | "onAct" | "card" | "shapeOf" | "onOpen"
> {
  wallpapers: Wallpaper[];
  /**
   * A transition asked for on a card, by its button or by its key: the page's
   * `perform`, which holds the origin-less refusal once for every trigger
   * (ADR 0023).
   */
  onAction: (action: TransitionAction, wallpaper: Wallpaper) => void;
  /** Review's hover treatment. See `WallpaperCardProps.animated`. */
  animated?: boolean;
  /**
   * The rows whose Score has moved since they were fetched, by id. Their badges
   * read `Score moved` rather than a number.
   *
   * A set of ids rather than a flag per card, because that is the shape the
   * event arrives in: `score-changed` names the two wallpapers in a Comparison,
   * so the page holds a set and the grid is only carrying it the last step to
   * the card that computes its own badge (#129).
   */
  scoresMoved?: ReadonlySet<number>;
  /**
   * The curator's Minimum resolution, which is what decides whether a card
   * wears the undersized badge (#258).
   *
   * The size itself rather than the verdict per row, because the verdict is one
   * comparison against two numbers and the rows are the list this component
   * already holds — a set of ids handed down beside them would be the same fact
   * arranged twice. `scoresMoved` above is a set for the opposite reason: that
   * one arrives as ids, because `score-changed` names wallpapers and nothing
   * about them can be recomputed from the row.
   *
   * Absent judges nothing undersized, which is what a grid mounted outside the
   * app's settings gets. Both pages pass it, and a wallpaper whose Dimensions
   * are unknown is answered by `isUndersized` rather than here (ADR 0044).
   */
  minimumResolution?: Resolution;
  /**
   * The curator's Evaluated threshold, which is the σ each card's Score badge
   * reads as solid below (#260).
   *
   * Carried rather than resolved, unlike `minimumResolution` above: a threshold
   * is one number, so handing it to the card costs the memo nothing and saves
   * this component making the same comparison the card would. Absent falls back
   * to what Evaluated meant before it was a setting, which is what a grid
   * mounted outside the app's settings gets.
   */
  evaluatedThreshold?: number;
  /**
   * The curator asking to look at a wallpaper properly, carrying the one they
   * asked about: a click on a card that was not on one of its buttons, or
   * `Enter` on the selected cell (#134, #138).
   *
   * One entry for both, because the lightbox is a second rendering of this
   * grid's selection and there is only one of it. The click is a click on the
   * cell, so the card fires that half itself and what the grid adds is the
   * route to the page — which is where ADR 0022 keeps the lightbox's state for
   * the same reason it keeps the list here: both change on every action, and
   * only the page holds them. The wallpaper travels along because a click can
   * land on a card the selection is not on, and opening there is a selection
   * move rather than a second cursor.
   */
  onOpen?: (wallpaper: Wallpaper) => void;
}

/**
 * The grid Review and the library page mount (#79): `ItemGrid` over
 * Wallpapers, drawing a `WallpaperCard` per cell and acting through
 * `STATUS_KEYS`.
 *
 * A thin host and nothing more since #336, which made the grid generic so that
 * Discover could draw Results with it. What stayed here is everything about a
 * Wallpaper that the grid itself has no business knowing: the Score badges, the
 * undersized check, the Evaluated threshold, Review's hover and the rank a
 * justified row carries. The cursor, the keys, the density and the window are
 * `ItemGrid`'s, and their reasons are written there.
 */
export function WallpaperGrid({
  wallpapers,
  onAction,
  animated = false,
  scoresMoved,
  minimumResolution,
  evaluatedThreshold,
  onOpen,
  ...grid
}: WallpaperGridProps) {
  // The rank is justified rows' whole argument for existing: the app produces a
  // ranking and the other two layouts say so in a badge the size of a word
  // (#263). Only a windowed grid draws a layout other than the uniform one, so
  // a grid with no scroll box draws no rank whatever `layout` says.
  const ranked = grid.scroller !== undefined && grid.layout === "justified";
  return (
    <ItemGrid
      {...grid}
      items={wallpapers}
      actions={STATUS_KEYS}
      onAct={onAction}
      onOpen={onOpen}
      card={WALLPAPER_CARD}
      shapeOf={shapeOf}
      /*
        Every prop below is a value or a stable identity, and that is the whole
        of what a cursor move costs: the grid re-renders, the card's memo
        compares, and only the card that lost the selection and the card that
        gained it have a changed `selected` to render for. `onAction` is
        `useWallpaperRows`' latched handler, `onOpen` the lightbox's open call
        keyed on the grid rather than on the selection, and `scoreMoved` a
        boolean read out of the page's set — three identities that all used to
        churn, and each of which would quietly defeat the memo on its own
        (#229, #230).

        `undersized` is resolved here for the same reason: the comparison is the
        page's setting against this row's Dimensions, and a card handed the size
        object would be a card whose props move when the settings struct is
        replaced, whatever key was actually written (#258).
      */
      renderCard={(wallpaper, { cellIndex, selected, box, width }) => (
        <WallpaperCard
          wallpaper={wallpaper}
          onAction={onAction}
          animated={animated}
          scoreMoved={scoresMoved?.has(wallpaper.id)}
          onOpen={onOpen}
          cellIndex={cellIndex}
          selected={selected}
          box={box}
          // A string and not a width, so a resize that leaves a card on the
          // same side of the threshold is no prop change to its memo (#230).
          imageSize={thumbnailSizeFor(width, window.devicePixelRatio || 1)}
          undersized={
            minimumResolution
              ? isUndersized(wallpaper, minimumResolution)
              : false
          }
          // Counted from one, because a rank is what the curator would say out
          // loud about a wallpaper and nobody says their favourite is number
          // zero.
          rank={ranked ? cellIndex + 1 : undefined}
          evaluatedThreshold={evaluatedThreshold}
        />
      )}
    />
  );
}
