import { NO_ORIGIN_REASON, useToaster } from "@/components/ToastSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { counted, isEvaluated, score, STATUS_LABEL } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { Check, FolderInput, RotateCcw, Undo2 } from "lucide-react";

/**
 * The four transitions a card can offer, named after the resulting Status where
 * the domain has no verb for one: `make-active` is the keep inverse, which
 * CONTEXT.md leaves unnamed on purpose and ADR 0019 labels **Make Active**
 * rather than coining a noun.
 */
export type CardAction = "keep" | "reject" | "make-active" | "restore";

/**
 * Where this card sits in the grid that mounted it, and whether it is the one
 * holding the selection.
 *
 * The card renders itself as a cell from this rather than the grid reaching in
 * and setting attributes on a node it does not own: what a `gridcell` is made of
 * — the role, the roving `tabindex`, the position the grid finds it by — is one
 * fact arriving through one prop, and a card mounted outside a grid simply has
 * no cell and stays the labelled `group` it was.
 *
 * `index` is the index in the whole list, not in what is mounted. ADR 0016's
 * library grid mounts a window of about thirty cards out of five thousand, so
 * the two differ there and the absolute one is what the selection means.
 */
export interface GridCell {
  index: number;
  selected: boolean;
}

export interface WallpaperCardProps {
  wallpaper: Wallpaper;
  /**
   * One entry point rather than a callback per action.
   *
   * The card owns the Status-to-action mapping below, so a host cannot hand it
   * a set of handlers that disagrees with what the Status offers — a Review
   * passing only `onKeep` and `onReject` would be silently correct until a Kept
   * row appeared in front of it. And #125's direct keys act on the selected
   * card with no button pressed at all, so the host needs an entry that is not
   * one rendered button's handler.
   *
   * The wallpaper comes back with the action because the host answers about the
   * row it acted on — the toast wants a filename, the IPC call an id — and the
   * card is holding both.
   */
  onAction: (action: CardAction, wallpaper: Wallpaper) => void;
  /**
   * Review's hover treatment: the image scales and the overlay fades, each
   * declaring `will-change` for the one property it animates.
   *
   * Off by default, because the library page is the caller that must not have
   * it. ADR 0016 virtualises that grid to 5,000 rows and rules the animation
   * out by ADR 0007's own arithmetic — 5,000 images and 5,000 overlays each
   * declaring `will-change` is 10,000 composited textures — while ADR 0007's
   * licence stays scoped to Review's fifty. So the shared card carries the
   * library's constraint in the library and Review's `will-change` in Review,
   * which is exactly what ADR 0016 said it would do, and
   * `the two hover-animated elements declare will-change` keeps pinning Review
   * alone.
   */
  animated?: boolean;
  /** See `GridCell`. Absent for a card standing on its own. */
  cell?: GridCell;
}

/**
 * The card, shared by Review and by the library page (#79).
 *
 * Its design is #44's prototype at ADR 0019's corrections: a dense
 * `aspect-video` card with the Score badge top right, the Status pill top left,
 * and the actions in a bottom overlay revealed by `group-hover` and
 * `group-focus-within`.
 *
 * It carries no hover shadow, deliberately. A wheel scroll holds the pointer
 * still while cards stream underneath, so every card that passes fires
 * `:hover`. Changing `box-shadow` there repaints outside the card's own bounds,
 * and measured against a real WebKitGTK view it took Review's grid from a
 * locked 60fps to 38 with every frame late — which is why the wheel felt worse
 * than the scrollbar, where the pointer never crosses the grid. Dropping only
 * the transition still dropped half the frames, so it is the repaint and not
 * the animation. The overlay fade, the image scale, and the backdrop blurs all
 * measured free. See ADR 0006.
 */
export function WallpaperCard({
  wallpaper,
  onAction,
  animated = false,
  cell,
}: WallpaperCardProps) {
  const { show } = useToaster();
  const rejected = wallpaper.status === "rejected";
  const evaluated = isEvaluated(wallpaper);
  // Known before the press, because ADR 0009 put `origin_path` on the DTO for
  // exactly this: the frontend can refuse without asking the backend.
  const restorable = wallpaper.origin_path !== null;
  const folder = rejected ? containingFolder(wallpaper.path) : "";
  // Inside a grid the buttons leave the tab order, and the cell is the only
  // stop. Leaving them in it is the alternative ADR 0019 rejected under "the
  // buttons in the tab order and the card out of it": Review's fifty cards
  // would be a hundred stops and the library's window would still strand
  // wallpaper 3,000 behind the end of what is mounted. They stay focusable and
  // clickable, and #125's direct keys are how the keyboard fires them.
  const buttonTabIndex = cell ? -1 : undefined;

  return (
    <div
      // ADR 0019 asks each card for an accessible name carrying the filename
      // and the Status, since the Status is otherwise a pill and a dimming —
      // and on an Active card not even a pill.
      //
      // A card in a grid is that grid's cell, and the roving `tabindex` is what
      // makes the whole grid one tab stop: every cell is out of the tab order
      // except the selected one, so Tab reaches the grid once and leaves it
      // once whatever the row count. Outside a grid the honest role is the
      // labelled `group` this card has always been, and nothing there is
      // focusable but the buttons in the overlay.
      role={cell ? "gridcell" : "group"}
      tabIndex={cell ? (cell.selected ? 0 : -1) : undefined}
      // How the grid finds this cell to focus it. An attribute rather than a
      // ref handed back up, because under ADR 0016's virtualisation the mounted
      // cards are a window: their order in the DOM is not their order in the
      // list, and only the index the grid wrote is.
      data-cell={cell?.index}
      aria-label={`${wallpaper.filename}, ${STATUS_LABEL[wallpaper.status]}`}
      className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-card"
    >
      <img
        src={wallpaperImageUrl(wallpaper.id, "small")}
        alt={wallpaper.filename}
        loading="lazy"
        className={cn(
          "h-full w-full object-cover",
          // The dimming of a Rejected card sits here and not on the wrapper,
          // which is where the prototype had it. On the wrapper it drags the
          // pill, the badge and the whole overlay to 60% with the image, and
          // white text on a `black/70` gradient at 60% is not a contrast the
          // overlay can afford. Restore lives in that overlay, so the one card
          // whose buttons have to stay readable was the one the prototype
          // faded. A solid frame around a faded image also reads less like a
          // failed load than a faded frame around one (ADR 0019).
          rejected && "opacity-60 grayscale",
          // The scale, and the layer it needs. WebKit builds the composited
          // layer an animated property needs the first time it is animated,
          // which on a wheel pass is mid-gesture: one ~50-95ms stall per card
          // until every card on screen has been passed over once. Declaring
          // `will-change` moves the promotion to first paint (ADR 0007).
          animated &&
            "transition-transform duration-500 group-hover:scale-105 will-change-transform",
        )}
      />

      {/*
        μ to one decimal, or `Unrated`, and nothing else: no unit, no second
        number and not the word Score, which ADR 0013 keeps to the surfaces with
        room for it. Solid says Evaluated and dimmed says not yet, off the one σ
        threshold the app defines, so confidence is one fact with one definition
        rather than a band scale invented here. Every badge on the live library
        is dimmed today and that is correct: σ crosses 4.0 at about seven
        comparisons. The tooltip is what says which state the dimming is, since
        the badge itself may not say `Score`.
      */}
      <div className="pointer-events-none absolute top-1.5 right-1.5">
        <Badge
          title={evaluated ? "Evaluated" : "Not yet Evaluated"}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums backdrop-blur-md",
            evaluated
              ? "bg-white text-neutral-900"
              : "border-white/30 bg-black/50 text-white/70",
          )}
        >
          {score(wallpaper)}
        </Badge>
      </div>

      {/*
        Kept and Rejected wear the pill; Active does not. The pill is what makes
        a mixed grid legible at a glance (ADR 0016's default filter is All), and
        what it has to mark is the wallpapers that are not the default. Every
        card names its Status in the label above regardless, so nothing is lost
        where it goes unprinted — which is also what keeps Review, a list of
        fifty Active wallpapers, from carrying fifty pills that all say the same
        word.
      */}
      {wallpaper.status !== "active" && (
        <div className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-md">
          {STATUS_LABEL[wallpaper.status]}
        </div>
      )}

      {/*
        The reveal layer covers the card and the gradient strip inside it does
        not, so the image stays visible under a hover while there is still one
        element per card carrying the fade. `pointer-events-none` on the layer
        keeps the uncovered image clickable for the lightbox #124 opens; the
        strip takes its own events back for the buttons.
      */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          animated && "transition-opacity will-change-[opacity]",
        )}
      >
        <div className="pointer-events-auto flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6">
          <div className="min-w-0">
            <p
              className="truncate text-[11px] font-medium text-white"
              title={wallpaper.filename}
            >
              {wallpaper.filename}
            </p>
            {/*
              How much the Score above is worth, and for a Rejected card where
              its file went. ADR 0018's read-out names `reject_destination` as
              written, which for the default `./rejected` states a rule rather
              than a place: a nested library gets one reject folder per source
              folder and the bar cannot say which one took this file. The card
              holds the row's own `path`, so it is the surface that can answer,
              and it answers for every Rejected wallpaper rather than only for
              the one the last toast was about. The folder's name only, with the
              full path in `title` — two source folders each with their own
              `rejected/` produce the same line on two cards, and the `title` is
              what tells them apart (ADR 0019).
            */}
            <p
              className="truncate text-[10px] text-white/60"
              title={folder ? wallpaper.path : undefined}
            >
              {counted(wallpaper.comparisons_count, "comparison")}
              {folder ? ` · now in ${folder}/` : ""}
            </p>
          </div>

          <div className="flex gap-1.5">
            {rejected ? (
              <Button
                size="xs"
                // Not `disabled`. A disabled button is not focusable, so under
                // ADR 0019's keyboard model the reason would be unreachable by
                // keyboard and silent to a screen reader, which is most of the
                // people the explanation exists for. `aria-disabled` keeps the
                // control in the tab order and in the roving selection, styled
                // as unavailable, and lets it explain itself when pressed.
                aria-disabled={restorable ? undefined : true}
                aria-label={`Restore ${wallpaper.filename}`}
                tabIndex={buttonTabIndex}
                onClick={() => {
                  if (!restorable) {
                    // No IPC call. `origin_path` is `null` on the row, so the
                    // answer is known here, and the sentence is the frontend's
                    // own — the one place ADR 0017's "the title is ours and the
                    // detail is the backend's" does not apply, because there is
                    // no backend in it.
                    show({
                      kind: "refused",
                      filename: wallpaper.filename,
                      reason: NO_ORIGIN_REASON,
                    });
                    return;
                  }
                  onAction("restore", wallpaper);
                }}
                className={cn(
                  "flex-1 bg-white/15 text-white hover:bg-white/25",
                  !restorable &&
                    "cursor-not-allowed opacity-40 hover:bg-white/15",
                )}
              >
                <RotateCcw />
                Restore
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  aria-label={
                    wallpaper.status === "kept"
                      ? `Make Active ${wallpaper.filename}`
                      : `Keep ${wallpaper.filename}`
                  }
                  tabIndex={buttonTabIndex}
                  onClick={() =>
                    onAction(
                      wallpaper.status === "kept" ? "make-active" : "keep",
                      wallpaper,
                    )
                  }
                  className="flex-1 bg-white/15 text-white hover:bg-white/25"
                >
                  {wallpaper.status === "kept" ? <Undo2 /> : <Check />}
                  {wallpaper.status === "kept" ? "Make Active" : "Keep"}
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  aria-label={`Reject ${wallpaper.filename}`}
                  tabIndex={buttonTabIndex}
                  onClick={() => onAction("reject", wallpaper)}
                  className="flex-1 bg-destructive/90 text-white hover:bg-destructive"
                >
                  <FolderInput />
                  Reject
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The name of the folder a path sits in, for the `now in rejected/` clause.
 *
 * Empty when the path names no folder at all, which drops the clause rather
 * than printing `now in /`. A Rejected row's `path` is absolute — `move_wallpaper`
 * writes back what `unique_destination` resolved — so that is a guard against a
 * malformed row and not a case the app produces.
 */
function containingFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}
