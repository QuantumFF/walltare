import { ActionButton } from "@/components/ActionButton";
import { wallpaperPicture } from "@/components/HeroPicture";
import { ItemLightbox, LightboxTitle } from "@/components/ItemLightbox";
import { STATUS_KEYS } from "@/components/keymap";
import type { SelectionHandle } from "@/components/selection";
import {
  STATUS_ACTIONS,
  type TransitionAction,
} from "@/components/transitions";

import { Badge } from "@/components/ui/badge";
import { useApp } from "@/context/AppContext";
import type { Wallpaper } from "@/lib/client";
import {
  counted,
  FILE_IS_GONE,
  FILE_IS_GONE_DETAIL,
  score,
  STATUS_LABEL,
} from "@/lib/copy";
import { isEvaluated } from "@/lib/wallpaper";
import { ImageOff } from "lucide-react";

/**
 * How narrow the row under the picture is allowed to get, in pixels.
 *
 * The row is as wide as the picture (#44), so a portrait wallpaper
 * paints one narrower than its own controls need: at the default 1280x800
 * window the image box is about 1216x680, and a 9:16 phone wallpaper fills the
 * height and paints 382px wide. Below this the row overhangs the picture
 * instead of shrinking with it, and the read-out is what drops — an overhanging
 * row reads as controls refusing to shrink, a row clipping its own buttons
 * reads as a bug, and the read-out is the one part that tells the curator
 * nothing they need in order to act (ADR 0022).
 *
 * The number is the widest thing the floor has to hold, which is a Kept
 * wallpaper: a Score badge (38) and a Status pill (58) with a filename between
 * them that is still worth printing (88), two gaps of 8 inside that block, the
 * position (40) and the two gaps of 16 around it, and `Make Active K` beside
 * `Reject Del` (227 with the gap between them). That is 499, so 500.
 *
 * **It has no test, on purpose.** happy-dom does no layout, so under a test
 * runner the box is `ItemLightbox.tsx`'s `UNMEASURED_PICTURE` fitted to the
 * wallpaper's ratio, and a test of the floor would be a test of that fallback's
 * arithmetic rather than of a laid-out row. ADR 0022 records the floor as untested by construction, since
 * the live library holds no portrait wallpaper — 120 rows, the narrowest a
 * square — and says the arithmetic wants checking against a real 9:16 file once
 * one exists.
 */
const ROW_FLOOR = 500;

/**
 * What the picture's panel says when it will not load, which for a wallpaper
 * means its file is gone: two lines in white, because this ground is dark in
 * both themes and there is room for the cause the card and the strip do
 * without (ADR 0032).
 */
const GONE = (
  <>
    <ImageOff className="h-10 w-10 text-white/40" aria-hidden />
    <p className="text-sm font-medium text-white">{FILE_IS_GONE}</p>
    <p className="max-w-sm text-xs text-white/60">{FILE_IS_GONE_DETAIL}</p>
  </>
);

export interface LightboxProps {
  /**
   * The grid whose selection this is a second rendering of (ADR 0022).
   *
   * The grid and not the selection, and that difference is the whole of what
   * #230 had to keep true. A `selection` prop would be the page reading the
   * cursor in order to hand it down, which is a page that re-renders on every
   * arrow key — and the moment the page holds it, it is a copy somebody has to
   * keep in step with the grid's. This subscribes to the same publication the
   * cells were drawn from, so there is still one cursor and still no sync rule.
   *
   * `null` while there is no grid mounted, which is how both pages render an
   * empty list. There is nothing to be a rendering of then, and `useLightbox`
   * closes this surface in the same pass.
   */
  grid: SelectionHandle<Wallpaper> | null;
  /** Whether one is up, from `useLightbox` over that same grid. */
  open: boolean;
  /**
   * `useLightbox`'s `close`, which is the curator's own way out and the half
   * that puts focus back on the card. Radix asks for it on Escape and on the
   * Close button; the two closes nobody pressed never reach here.
   */
  onClose: () => void;
  /**
   * A transition the curator asked for while looking at the picture, on the
   * wallpaper the picture is of.
   *
   * The same entry the grid behind is handed, and the pages pass the same
   * function to both: a keep from in here is the page's own keep, with the
   * page's optimistic removal, its published patch and its toast, rather than a
   * second implementation that happens to agree. One entry rather than a
   * callback per action for the reason `WallpaperCardProps.onAction` gives —
   * this surface owns no branch on the Status either, it renders what
   * `STATUS_ACTIONS` offers — and the wallpaper travels back with the action
   * because the page answers about the row it acted on (#140).
   */
  onAction: (action: TransitionAction, wallpaper: Wallpaper) => void;
}

/**
 * Library's and Review's lightbox: `ItemLightbox` over Wallpapers, with the
 * row #44 and ADR 0022 settled — the Score, the filename, the Status, the path
 * read-out, the comparison count and the Status action buttons — and the crop
 * preview offered.
 *
 * A thin host since #338, which made the shell generic so that Discover could
 * open Results in it, the way `WallpaperGrid` became one over `ItemGrid` in
 * #336. The action set in the row comes off the wallpaper's Status and nothing
 * else, so Review's list of Active rows never offers a Restore without anyone
 * configuring that, and the card and the lightbox cannot drift into offering
 * different things.
 */
export function Lightbox({ grid, open, onClose, onAction }: LightboxProps) {
  // The Evaluated threshold, read straight off the store rather than passed in
  // from whichever page opened this: the lightbox is a second rendering of the
  // selection and not a child of the grid, so a prop would have to be threaded
  // through both pages to reach it (ADR 0022, ADR 0046).
  const { settings } = useApp();

  return (
    <ItemLightbox
      grid={grid}
      open={open}
      onClose={onClose}
      actions={STATUS_KEYS}
      onAct={onAction}
      picture={wallpaperPicture}
      rowFloor={ROW_FLOOR}
      noun="wallpaper"
      gone={GONE}
      cropPreview
      row={(wallpaper) => ({
        identity: (
          <div className="flex items-center gap-2">
            {/*
              The Score, written as every surface showing one writes it, with
              the same solid-means-Evaluated dimming the card carries. Both read
              `score` out of `copy.ts` and `isEvaluated` out of `wallpaper.ts`,
              so there is one definition of confidence in the app rather than
              one per surface (ADR 0013) — and both read it against the
              curator's threshold, which is the number the Rank headline counted
              with (ADR 0046).
            */}
            <Badge
              title={
                isEvaluated(wallpaper, settings.evaluated_threshold)
                  ? "Evaluated"
                  : "Not yet Evaluated"
              }
              className={
                isEvaluated(wallpaper, settings.evaluated_threshold)
                  ? "bg-white text-neutral-900"
                  : "border-white/30 bg-black/50 text-white/70"
              }
            >
              {score(wallpaper)}
            </Badge>

            {/* The filename is the dialog's name: the one thing already on
                this row that says which wallpaper is up. */}
            <LightboxTitle>{wallpaper.filename}</LightboxTitle>

            {/* Every Status, unlike the card's pill. That one marks the
                wallpapers a mixed grid should read as exceptions, and stays
                off fifty Active cards that would all say the same word; here
                there is one wallpaper and nothing for it to repeat. */}
            <Badge variant="outline" className="text-muted-foreground">
              {STATUS_LABEL[wallpaper.status]}
            </Badge>
          </div>
        ),
        // The read-out, which names what is not already on screen — ADR 0017's
        // rule for the toast copy, applied to a line.
        //
        // For a Rejected wallpaper that is the **Origin**: it is what #140's
        // Restore is about to act on, and it has never been rendered anywhere
        // in the app, while the folder its file went to is named by ADR 0018's
        // bar and by ADR 0019's card. Every other Status shows `path`, and so
        // does the cohort ADR 0009's migration left with no Origin at all —
        // there, the `aria-disabled` Restore #140 puts beside this line is what
        // carries the explanation.
        //
        // The `title` is always where the file is now, which is both the half a
        // Rejected row's line gives up and the full string for a line that
        // truncates.
        //
        // This is what drops on a picture narrower than the row's floor, with
        // the count below: they are the parts of the row that tell the curator
        // nothing they need in order to act, which is what makes them the parts
        // that can go (ADR 0022).
        readout: (
          <p
            data-slot="lightbox-readout"
            className="truncate font-mono text-[11px] text-white/50"
            title={wallpaper.path}
          >
            {wallpaper.status === "rejected" && wallpaper.origin_path
              ? wallpaper.origin_path
              : wallpaper.path}
          </p>
        ),
        // How much the Score beside the filename is worth, printed above the
        // position. Read-out, so it goes with the line above on a floored row;
        // the position stays, since `50 / 50` is the reason the arrow beside it
        // is unavailable.
        count: counted(wallpaper.comparisons_count, "comparison"),
        // The action set, and the reason a curator can decide while looking at
        // the thing they are deciding about. Under ADR 0019 it is also the one
        // path to acting without a hover, which is what a touchscreen has.
        //
        // One button per action the Status offers, off the same
        // `STATUS_ACTIONS` the card's overlay renders from and the grid's keys
        // resolve against: Active gets Keep and Reject, Kept gets Make Active
        // and Reject, Rejected gets Restore. Nothing here knows which page
        // opened it, so there is no caller flag and the two action sets cannot
        // drift out of agreement with ADR 0009's transition table.
        //
        // Nothing is greyed to hold its space. The row's width changes on every
        // step, because it is the picture's width and no two wallpapers in this
        // library share an aspect ratio, so reserving button space stabilises
        // the wrong axis. The one control that renders while unavailable is the
        // Restore on an origin-less row, and it renders because it has a
        // sentence to deliver.
        buttons: STATUS_ACTIONS[wallpaper.status].map((action) => (
          <ActionButton
            key={action}
            action={action}
            // Known before the press, because ADR 0009 put `origin_path` on
            // the DTO for exactly this.
            unavailable={action === "restore" && wallpaper.origin_path === null}
            // No `subject`, so the name is the verb alone. On a card it carries
            // the filename too, because a grid of fifty rows has fifty Keeps in
            // it; here there is one wallpaper and the dialog is already named
            // by it, so repeating the name on every control would be the third
            // time a reader hears it. The printed key stays out of the name for
            // the same reason it is on the button at all: it is the binding
            // shown to an eye, not part of what the control does.
            // The refusal an origin-less row gets is the host's `perform`, so
            // pressing Restore in here, pressing it on the card, and pressing
            // `R` on either are one event with one outcome (ADR 0023).
            onClick={() => onAction(action, wallpaper)}
          />
        )),
      })}
    />
  );
}
