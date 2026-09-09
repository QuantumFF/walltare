import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { wallpaperImageUrl, type Status, type Wallpaper } from "@/lib/client";
import {
  counted,
  FILE_IS_GONE,
  isEvaluated,
  score,
  STATUS_LABEL,
} from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  Check,
  FolderInput,
  ImageOff,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

/**
 * The four transitions a card can offer, named after the resulting Status where
 * the domain has no verb for one: `make-active` is the keep inverse, which
 * CONTEXT.md leaves unnamed on purpose and ADR 0019 labels **Make Active**
 * rather than coining a noun.
 */
export type CardAction = "keep" | "reject" | "make-active" | "restore";

/**
 * What each Status offers: Active gets Keep and Reject, Kept gets Make Active
 * and Reject, Rejected gets Restore (ADR 0019).
 *
 * One table, read twice. The overlay below renders its buttons from it, and
 * #125's direct keys resolve against it in `WallpaperGrid`, so a key cannot
 * offer a transition the buttons do not — and neither surface can drift into
 * asking for one the domain refuses. CONTEXT.md is what makes that a
 * correctness rule rather than a tidiness one: Active becomes Kept or Rejected,
 * Kept becomes Rejected or Active again, Rejected becomes Active again by a
 * Restore, and anything else is an error the backend answers with
 * `invalid_transition` rather than a no-op. Every entry here is one of those
 * legal moves; a key that finds none simply does nothing.
 */
export const STATUS_ACTIONS: Record<Status, readonly CardAction[]> = {
  active: ["keep", "reject"],
  kept: ["make-active", "reject"],
  rejected: ["restore"],
};

/**
 * How each action reads on the control that makes it, and the accessible name it
 * takes here: `<label> <filename>`, so a screen reader hears which card the
 * control belongs to on a grid full of identical rows.
 *
 * **Make Active** is the keep inverse's label, naming the resulting Status
 * rather than coining a noun — not "Un-keep", and not the prototype's "Return to
 * voting", which is wrong against the glossary: a Kept wallpaper already votes,
 * and what un-keeping restores is appearance in Review (ADR 0017, ADR 0019).
 *
 * Exported because #140 puts the same four in the lightbox's row. That surface
 * has its own layout and its own accessible name — one wallpaper, already named
 * by the dialog — and none of that is the wording, which is the half that must
 * not differ: the label above is the one ADR 0019 argued three alternatives down
 * to, and a second copy of it is where "Un-keep" comes back.
 */
export const ACTION_CONTROLS: Record<
  CardAction,
  { label: string; Icon: LucideIcon; destructive?: boolean }
> = {
  keep: { label: "Keep", Icon: Check },
  "make-active": { label: "Make Active", Icon: Undo2 },
  reject: { label: "Reject", Icon: FolderInput, destructive: true },
  restore: { label: "Restore", Icon: RotateCcw },
};

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
  /**
   * Whether the Score on this row is a Comparison out of date, in which case the
   * badge says so instead of printing a number.
   *
   * The library page is the only caller that can know this. `score-changed`
   * names the two wallpapers in a Comparison and cannot name their new Scores,
   * so a page subscribed to it knows those two numbers are stale and does not
   * know what they became — and refetching every row because two Scores moved is
   * the blunt shape ADR 0015 turned a query library down over. A card mounted
   * anywhere else is showing the numbers it was handed, which are current.
   */
  scoreMoved?: boolean;
  /**
   * A click anywhere on the card that is not a button: the curator asking to
   * look closer, which is what opens the lightbox (#134).
   *
   * There is no open control, and the card is the target rather than the image
   * inside it because ADR 0019 made the card a `gridcell` — the cell is the
   * thing the curator pressed, and a button for the gesture the whole card
   * already carries would be a second affordance for one action. The overlay's
   * buttons stop the click before it reaches here, so pressing Keep is a keep
   * and nothing else. It is the touchscreen path too: a hover-less pointer
   * cannot reveal the overlay, so its tap lands on the cell and the lightbox is
   * where its Keep, Reject and Restore live (ADR 0019, ADR 0022).
   *
   * The wallpaper travels with the click rather than being read off the grid's
   * selection, which a click does not move. ADR 0022 has the lightbox render
   * that selection, so opening on a card the selection was not on is a
   * selection move, made by the host that holds both (#138).
   */
  onOpen?: (wallpaper: Wallpaper) => void;
  /**
   * Where this card sits in the grid that mounted it, and absent for a card
   * standing on its own.
   *
   * The card renders itself as a cell from this and from `selected` rather than
   * the grid reaching in and setting attributes on a node it does not own: what
   * a `gridcell` is made of — the role, the roving `tabindex`, the position the
   * grid finds it by — arrives as props, and a card mounted outside a grid has
   * no cell index and stays the labelled `group` it was.
   *
   * The index in the whole list, not in what is mounted. ADR 0016's library grid
   * mounts a window of about thirty cards out of five thousand, so the two
   * differ there and the absolute one is what the selection means.
   *
   * A number and a boolean and not the one `GridCell` object they used to
   * arrive in. The grid built that object per card per render, so a card's props
   * changed identity whenever anything on the page re-rendered even though
   * neither value in it had moved — which is what #229 removed so that #230's
   * memoised card sees a changed prop only when something changed.
   */
  cellIndex?: number;
  /** Whether this cell is the one holding the grid's selection. */
  selected?: boolean;
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
  scoreMoved = false,
  onOpen,
  cellIndex,
  selected = false,
}: WallpaperCardProps) {
  // Whether this card is a cell in a grid at all, which is the one thing the
  // absent object used to say and the index says now.
  const inGrid = cellIndex !== undefined;
  const rejected = wallpaper.status === "rejected";
  const evaluated = isEvaluated(wallpaper);
  // Known before the press, because ADR 0009 put `origin_path` on the DTO for
  // exactly this: the frontend can refuse without asking the backend.
  const restorable = wallpaper.origin_path !== null;
  const folder = rejected ? containingFolder(wallpaper.path) : "";
  /**
   * Whether the picture failed to arrive, which is how this card learns its
   * file is gone.
   *
   * The `wallpaper://` request is already being made, so the answer costs
   * nothing and catches every cause: a deleted file, a renamed folder, an
   * unplugged drive, a permission the curator lost, a source that will not
   * decode. That is the whole reason detection is a load failure rather than a
   * field on the row — a flag on the listing would need a `stat` per card on
   * every visit to a grid ADR 0016 sizes at 5,000, and it would still be one
   * pass behind the truth (ADR 0032).
   *
   * `load` clears it as well as `error` setting it, so a card is never stuck on
   * an answer the browser has since revised. There is no effect and no reset on
   * the wallpaper, because the grid keys every card on its id: the row can be
   * rewritten under this card by a transition, but it is never a different
   * wallpaper.
   */
  const [gone, setGone] = useState(false);
  // Inside a grid the buttons leave the tab order, and the cell is the only
  // stop. Leaving them in it is the alternative ADR 0019 rejected under "the
  // buttons in the tab order and the card out of it": Review's fifty cards
  // would be a hundred stops and the library's window would still strand
  // wallpaper 3,000 behind the end of what is mounted. They stay focusable and
  // clickable, and #125's direct keys are how the keyboard fires them.
  const buttonTabIndex = inGrid ? -1 : undefined;

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
      role={inGrid ? "gridcell" : "group"}
      tabIndex={inGrid ? (selected ? 0 : -1) : undefined}
      // How the grid finds this cell to focus it. An attribute rather than a
      // ref handed back up, because under ADR 0016's virtualisation the mounted
      // cards are a window: their order in the DOM is not their order in the
      // list, and only the index the grid wrote is.
      data-cell={cellIndex}
      // The label carries the gone state for the reason it carries the Status:
      // what is otherwise a pill and a dimming, or here an icon and a label
      // inside a cell whose own `aria-label` hides its contents, reaches nobody
      // reading with a screen reader unless the name says it (ADR 0019).
      aria-label={
        gone
          ? `${wallpaper.filename}, ${STATUS_LABEL[wallpaper.status]}, ${FILE_IS_GONE}`
          : `${wallpaper.filename}, ${STATUS_LABEL[wallpaper.status]}`
      }
      // See `onOpen`. Nothing is prevented and nothing is stopped: this is the
      // end of the bubble path, and a card outside a grid with no host asking
      // for the gesture simply does not fire it.
      onClick={() => onOpen?.(wallpaper)}
      className="group relative aspect-video overflow-hidden rounded-lg border border-border bg-card"
    >
      <img
        src={wallpaperImageUrl(wallpaper.id, "small")}
        alt={wallpaper.filename}
        loading="lazy"
        // Decoded off the main thread. Without it WebKit decodes the JPEG
        // synchronously when the image has to paint, and Review paints fifty at
        // once while the library page mounts a fresh row on every wheel notch —
        // which is the frame ADR 0007 moved the layer promotion out of.
        decoding="async"
        // See `gone`. The element stays mounted whichever way this went, so the
        // browser's answer can still change: unmounting it on the failure would
        // leave nothing left to fire `load`.
        onLoad={() => setGone(false)}
        onError={() => setGone(true)}
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
        The file is gone, said in the space the picture would have taken.

        Over the `<img>` rather than instead of it, so the element that would
        report a change is still there, and opaque so the browser's own broken-
        image glyph does not show through the label. It is before the badge, the
        pill and the reveal layer in the DOM and none of the four is positioned
        in a stacking context of its own, so those three still paint on top: a
        card whose file is gone keeps its Score, keeps its Status and keeps every
        transition the Status offers. Rejecting or restoring one is exactly the
        thing the curator might want to do about it, and ADR 0009's
        `file_missing` is what answers if the move has nothing to move.

        `pointer-events-none` because the cell underneath is the click target: a
        gone card still opens the lightbox, which is where the path and the
        explanation are (ADR 0022, ADR 0032).

        This is what makes the state distinguishable from a thumbnail that is
        still generating, which is the plain frame with nothing in it. There is
        no skeleton and no spinner on that one, deliberately: ADR 0016 mounts a
        window of cards out of five thousand and a wheel pass remounts them
        continuously, so a placeholder per card would animate the whole grid to
        say something a card resolves in a few hundred milliseconds — while a
        file that is gone never resolves, which is why it is the one that gets
        the words (ADR 0006, ADR 0032).
      */}
      {gone && (
        <div
          data-slot="wallpaper-gone"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground"
        >
          <ImageOff className="h-5 w-5" aria-hidden />
          <span className="text-[11px] font-medium">{FILE_IS_GONE}</span>
        </div>
      )}

      {/*
        μ to one decimal, or `Unrated`, and nothing else: no unit, no second
        number and not the word Score, which ADR 0013 keeps to the surfaces with
        room for it. Solid says Evaluated and dimmed says not yet, off the one σ
        threshold the app defines, so confidence is one fact with one definition
        rather than a band scale invented here. Every badge on the live library
        is dimmed today and that is correct: σ crosses 4.0 at about seven
        comparisons. The tooltip is what says which state the dimming is, since
        the badge itself may not say `Score`.

        `Score moved` is the one other thing the badge can read, and it is not a
        way of writing a Score down at all — it is the app saying it no longer
        knows one, which is why it stays here rather than joining `score()` in
        `copy.ts`. Only a page subscribed to `score-changed` can hand it over,
        and only the two wallpapers a Comparison named get it (#129).
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
          {scoreMoved ? "Score moved" : score(wallpaper)}
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
        keeps the uncovered image clickable, so a click on the picture is a
        click on the cell and opens the lightbox; the strip takes its own events
        back for the buttons.
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

          {/*
            One button per action the Status offers, off the table above rather
            than off a branch of its own. The branch is what the card used to
            carry, and #125 is what makes the difference matter: the direct keys
            read that table, so a card whose buttons came from somewhere else
            could offer a curator one set with the mouse and another with the
            keyboard.
          */}
          <div className="flex gap-1.5">
            {STATUS_ACTIONS[wallpaper.status].map((action) => {
              const { label, Icon, destructive } = ACTION_CONTROLS[action];
              // Only Restore has a row it cannot act on, and only because
              // ADR 0009's migration left one behind.
              const unavailable = action === "restore" && !restorable;
              return (
                <Button
                  key={action}
                  size="xs"
                  variant={destructive ? "destructive" : undefined}
                  // Not `disabled`. A disabled button is not focusable, so under
                  // ADR 0019's keyboard model the reason would be unreachable by
                  // keyboard and silent to a screen reader, which is most of the
                  // people the explanation exists for. `aria-disabled` keeps the
                  // control in the tab order and in the roving selection, styled
                  // as unavailable, and lets it explain itself when pressed.
                  aria-disabled={unavailable ? true : undefined}
                  aria-label={`${label} ${wallpaper.filename}`}
                  tabIndex={buttonTabIndex}
                  // The refusal an origin-less row gets is the host's, inside
                  // the one `perform` every trigger reaches, so pressing Restore
                  // and pressing `R` are the same event with the same outcome
                  // (ADR 0023).
                  onClick={(event) => {
                    // Where the card's own click handler stops. The cell
                    // underneath opens the lightbox, and a press on one of
                    // these is that transition and not both of them (#134).
                    //
                    // Propagation only: the default action stays, because that
                    // is what `Enter` on a focused button produces. Cancelling
                    // it here would leave the keyboard pressing a control that
                    // does nothing.
                    event.stopPropagation();
                    onAction(action, wallpaper);
                  }}
                  className={cn(
                    destructive
                      ? "flex-1 bg-destructive/90 text-white hover:bg-destructive"
                      : "flex-1 bg-white/15 text-white hover:bg-white/25",
                    unavailable &&
                      "cursor-not-allowed opacity-40 hover:bg-white/15",
                  )}
                >
                  <Icon />
                  {label}
                </Button>
              );
            })}
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
