import { ActionButton } from "@/components/ActionButton";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_EVALUATED_THRESHOLD,
  wallpaperImageUrl,
  type Wallpaper,
} from "@/lib/client";
import type { PlannedBox } from "@/lib/layout-plan";
import {
  counted,
  FILE_IS_GONE,
  readableSize,
  score,
  STATUS_LABEL,
  UNDERSIZED,
} from "@/lib/copy";
import { dimensionsOf, isEvaluated } from "@/lib/wallpaper";
import {
  STATUS_ACTIONS,
  type TransitionAction,
} from "@/components/transitions";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import { memo, useState } from "react";

export interface WallpaperCardProps {
  wallpaper: Wallpaper;
  /**
   * One entry point rather than a callback per action.
   *
   * The card renders its buttons from `STATUS_ACTIONS`, so a host cannot hand
   * it a set of handlers that disagrees with what the Status offers — a Review
   * passing only `onKeep` and `onReject` would be silently correct until a Kept
   * row appeared in front of it. And #125's direct keys act on the selected
   * card with no button pressed at all, so the host needs an entry that is not
   * one rendered button's handler.
   *
   * The wallpaper comes back with the action because the host answers about the
   * row it acted on — the toast wants a filename, the IPC call an id — and the
   * card is holding both.
   */
  onAction: (action: TransitionAction, wallpaper: Wallpaper) => void;
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
  /**
   * Where the layout put this card, for a layout that positions its own.
   *
   * With it the card takes the shape it was given and sits where it was put;
   * without it the card is `aspect-video` and a CSS grid decides where it goes.
   * That is the whole of what separates masonry from the uniform grid on this
   * component: one crops every wallpaper to the grid's shape, the other hands
   * each card a box of the wallpaper's own — so the picture is uncropped because
   * the box already has its ratio, not because anything here stopped cropping.
   *
   * The box is the plan's, computed before any card mounted, and its identity is
   * stable for as long as the plan is — which is what keeps the memo above
   * holding through a scroll (ADR 0045, #230).
   */
  box?: PlannedBox;
  /**
   * The thumbnail the card is drawn wide enough to need. A `medium` is laid
   * over the `small` and shown once it has loaded, so a zoom in sharpens the
   * card rather than blanking it, and a zoom out drops back to the `small`
   * already in the memory cache. The grid decides from the card's width.
   */
  imageSize?: "small" | "medium";
  /**
   * Whether this wallpaper's Dimensions fall below the curator's Minimum
   * resolution, in which case the card wears a badge saying so (#258).
   *
   * A boolean rather than the Minimum resolution itself, for the reason
   * `scoreMoved` is one: every prop here is a value or a stable identity, which
   * is what makes the memo above mean anything, and a size object handed to
   * every card would be one more identity to keep still. The comparison is
   * `isUndersized`, made once per card by whoever holds the setting.
   *
   * Off by default, so a card mounted with nothing said about it says nothing.
   * That is also the answer for a wallpaper whose Dimensions have not been read
   * yet: no badge rather than a wrong one, because a curator cannot tell a
   * library that has been measured from one that is still being measured
   * (ADR 0044).
   */
  undersized?: boolean;
  /**
   * Where this wallpaper sits in the ordering the curator asked for, counted
   * from one, drawn large across the card — and absent everywhere it is not.
   *
   * Justified rows are the one layout that asks for it, and the ranking is the
   * reason that layout exists: the app's whole output is an order, and the other
   * two layouts state it in a badge the size of a word (#263). It is the card's
   * position in the list rather than anything stored, so re-ordering the list is
   * the whole of what re-ranks the cards.
   *
   * Drawn and not announced, which is the same call the Score badge already
   * makes: a cell's `aria-label` replaces its contents, so neither number
   * reaches a screen reader from inside the card, and the ordering is named by
   * the control that set it (ADR 0019).
   */
  rank?: number;
  /**
   * The σ below which this wallpaper's Score badge reads as Evaluated, which is
   * the curator's setting (#260).
   *
   * The number rather than the verdict, which is the opposite of `undersized`
   * above and for the reason given there: a prop has to be a value or a stable
   * identity for the memo to mean anything, and a threshold *is* a value, so
   * there is nothing to resolve for the card. The comparison it feeds is the one
   * `voting.rs` counts `evaluated_count` with, so the badge and the Rank
   * headline move together (ADR 0046).
   *
   * Defaults to what Evaluated meant before it was a setting, which is what a
   * card mounted outside the app's settings gets — the right answer for every
   * curator who has not moved it, and the only one available without them.
   */
  evaluatedThreshold?: number;
}

/**
 * The card, shared by Review and by the library page (#79).
 *
 * Its design is #44's prototype at ADR 0019's corrections: a dense
 * `aspect-video` card with the Score badge top right, the Status pill top left,
 * and the actions in a bottom overlay revealed by `group-hover` and by keyboard
 * focus on the card or inside it. #254's prototype is what the two uncropped
 * layouts wear on top of that: no border and no rounding once the card is
 * handed a box, and a ring on the selected one.
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
 *
 * **Memoised, and every one of its props is a value or a stable identity so
 * that the memo holds.** This is what a card costs when a cursor moves past it:
 * one shallow comparison of its props instead of a badge, up to two buttons,
 * two icons and roughly eight `twMerge` calls. Fifty of those thirty-five times
 * a second is 110 dropped frames per ten seconds of held arrow key, which is
 * ADR 0041's arrow-key run and the whole of why the cursor moved into the grid
 * (#230). The memo on its own buys nothing — #229 is what stabilised
 * `onAction`, `onOpen` and the two cell props it compares, and #230 is what
 * stopped the page re-rendering above it. All three are one mechanism, and
 * undoing any of them undoes it.
 */
export const WallpaperCard = memo(function WallpaperCard({
  wallpaper,
  onAction,
  animated = false,
  scoreMoved = false,
  onOpen,
  cellIndex,
  selected = false,
  box,
  imageSize = "small",
  undersized = false,
  rank,
  evaluatedThreshold = DEFAULT_EVALUATED_THRESHOLD,
}: WallpaperCardProps) {
  // Whether this card is a cell in a grid at all, which is the one thing the
  // absent object used to say and the index says now.
  const inGrid = cellIndex !== undefined;
  const rejected = wallpaper.status === "rejected";
  const evaluated = isEvaluated(wallpaper, evaluatedThreshold);
  // Known before the press, because ADR 0009 put `origin_path` on the DTO for
  // exactly this: the frontend can refuse without asking the backend.
  const restorable = wallpaper.origin_path !== null;
  // The Dimensions as one size, for the undersized badge's tooltip, and `null`
  // for a row nothing has measured. Read through `wallpaper.ts` rather than off the
  // two columns here, because "unknown means both are unknown" is ADR 0044's
  // rule and the badge is not the place it gets restated.
  const size = dimensionsOf(wallpaper);
  // No folder for a reject in place, whose path is still its Origin: the file
  // was already missing and went nowhere, so `now in photos/` would name the
  // folder it is missing from (ADR 0050).
  const folder =
    rejected && wallpaper.path !== wallpaper.origin_path
      ? containingFolder(wallpaper.path)
      : "";
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
  // Whether the `medium` over the `small` has loaded, and so is shown. Kept
  // across a zoom out and back, because the element that loaded it is gone and
  // the next one answers from the memory cache.
  const [sharp, setSharp] = useState(false);
  // Inside a grid the buttons leave the tab order, and the cell is the only
  // stop. Leaving them in it is the alternative ADR 0019 rejected under "the
  // buttons in the tab order and the card out of it": Review's fifty cards
  // would be a hundred stops and the library's window would still strand
  // wallpaper 3,000 behind the end of what is mounted. They stay focusable and
  // clickable, and #125's direct keys are how the keyboard fires them.
  const buttonTabIndex = inGrid ? -1 : undefined;
  const imageClassName = cn(
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
  );

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
      // The label carries the gone state, and the undersized one, for the reason
      // it carries the Status: what is otherwise a pill and a dimming, or here
      // an icon and a label inside a cell whose own `aria-label` hides its
      // contents, reaches nobody reading with a screen reader unless the name
      // says it (ADR 0019).
      //
      // Built from the parts that apply rather than by branching on them,
      // because there are four now and a ternary per fact is a sentence per
      // combination. An ordinary card is the two it always was.
      aria-label={[
        wallpaper.filename,
        STATUS_LABEL[wallpaper.status],
        undersized && UNDERSIZED,
        gone && FILE_IS_GONE,
      ]
        .filter(Boolean)
        .join(", ")}
      // See `onOpen`. Nothing is prevented and nothing is stopped: this is the
      // end of the bubble path, and a card outside a grid with no host asking
      // for the gesture simply does not fire it.
      onClick={() => onOpen?.(wallpaper)}
      // `aspect-video` is the uniform grid's crop, worn by the element that
      // crops (ADR 0027's `CARD_ASPECT.className`). A card handed a box wears
      // that box instead: the shape came from the wallpaper's own Dimensions, so
      // declaring a second one here would be the layout and the card disagreeing
      // about how tall the card is — and the window is positioned against the
      // layout's answer.
      //
      // A card handed a box also drops the frame. Masonry and justified rows
      // are #254's wall: true ratios, a 4px gutter and no chrome until a hover,
      // so a border and a rounded corner on every picture would put back the
      // boxes that layout exists to take away. The uniform grid keeps both.
      //
      // Those two layouts also ring the selected card, drawn whether or not the
      // grid has focus, as the prototype's did. The uniform grid is the one the
      // verdict kept as it was, so it keeps the browser's focus outline and no
      // ring. The ring is a `box-shadow`, and ADR 0006 is why that is safe here
      // and not on `:hover`: it changes on two cards per arrow key, never on
      // every card a wheel pass slides under the pointer. The focus outline goes
      // where the ring is, because the ring is already on the one cell that can
      // hold focus.
      className={cn(
        "group overflow-hidden bg-card",
        box
          ? "absolute outline-none"
          : "relative aspect-video rounded-lg border border-border",
        box &&
          selected &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
      style={box}
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
        className={imageClassName}
      />
      {imageSize === "medium" && !gone && (
        <img
          src={wallpaperImageUrl(wallpaper.id, "medium")}
          alt=""
          aria-hidden
          decoding="async"
          onLoad={() => setSharp(true)}
          className={cn(
            imageClassName,
            "pointer-events-none absolute inset-0",
            !sharp && "opacity-0",
          )}
        />
      )}

      {/*
        The rank, set large across the card.

        Over the picture rather than under it, which is the only place it can be:
        a justified card is filled edge to edge by a wallpaper drawn at its own
        shape, so a numeral behind the image is a numeral nobody sees. What makes
        it read as behind is the treatment — white at a fraction of its opacity,
        blended into whatever it is lying on, so it belongs to the picture rather
        than sitting on top of it as a label would.

        A fixed 6rem, which is #254's prototype and what the curator agreed on.
        The card clips it, so at a high density a numeral taller than the row is
        cropped by the picture it lies on rather than shrunk to fit.
        `leading-none` is what makes the height the glyph's own rather than a
        line box's, so the number stays centred.

        Before the badge, the pill and the reveal layer in the DOM and none of
        those is in a stacking context of its own, so all three still paint over
        it — a rank is what the curator reads while scanning, and the Score, the
        Status and the actions are what they read when they stop.
      */}
      {rank !== undefined && (
        <span
          data-slot="wallpaper-rank"
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[6rem] font-bold text-white/15 tabular-nums mix-blend-overlay leading-none"
        >
          {rank}
        </span>
      )}

      {/*
        The file is gone, said in the space the picture would have taken.

        Over the `<img>` rather than instead of it, so the element that would
        report a change is still there, and opaque so the browser's own broken-
        image glyph does not show through the label. It is before the badge, the
        pill and the reveal layer in the DOM and none of the four is positioned
        in a stacking context of its own, so those three still paint on top: a
        card whose file is gone keeps its Score, keeps its Status and keeps every
        transition the Status offers. Rejecting or restoring one is exactly the
        thing the curator might want to do about it: a reject of a gone file
        moves nothing and takes it out of voting and review (ADR 0050), and
        ADR 0009's `file_missing` answers a Restore whose file has left the
        reject folder.

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
        threshold the curator set, so confidence is one fact with one definition
        rather than a band scale invented here — and the same number the Rank
        headline counts against, so a badge that says Evaluated is a badge the
        headline counted (ADR 0046). Most badges on a young library are dimmed
        and that is correct: σ is a late signal at every threshold offered. The
        tooltip is what says which state the dimming is, since the badge itself
        may not say `Score`.

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
        The corner that says what is true of this wallpaper rather than what it
        is worth: the Status, and whether the file is big enough to use. Both
        marks stack here rather than taking a corner each, because the Score
        badge already has the other one and a card is not four corners of
        labels.

        Kept and Rejected wear the pill; Active does not. The pill is what makes
        a mixed grid legible at a glance (ADR 0016's default filter is All), and
        what it has to mark is the wallpapers that are not the default. Every
        card names its Status in the label above regardless, so nothing is lost
        where it goes unprinted — which is also what keeps Review, a list of
        fifty Active wallpapers, from carrying fifty pills that all say the same
        word.

        The undersized badge is the other axis and is weighted to say so. Solid
        white where the Status pill is translucent black, which is the strongest
        mark this card's vocabulary has and the same one an Evaluated Score
        wears in the opposite corner — a fact about the file, stated plainly,
        rather than a decision the curator made about the wallpaper (CONTEXT.md).
        No colour, deliberately: the palette in `index.css` is greyscale but for
        `--destructive`, which means Reject, and an undersized wallpaper is not
        a rejected one.

        It shows on every card, Review's included: learning a file is too small
        is the whole point of the badge, and what Review lists is untouched by
        it (#258).

        `title` carries the Dimensions, which is the number the badge is a
        verdict on and the one thing that tells a curator how far off the file
        is. It needs no Minimum resolution to print, because that is already the
        thing the badge's presence states.

        The stack exists only when it has something in it, so an Active card of
        a usable size carries the node count it always did — which on a grid
        mounting a window of cards out of five thousand is the number that
        matters (ADR 0016, ADR 0041).
      */}
      {(wallpaper.status !== "active" || undersized) && (
        <div className="pointer-events-none absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
          {wallpaper.status !== "active" && (
            <div className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-md">
              {STATUS_LABEL[wallpaper.status]}
            </div>
          )}
          {undersized && (
            <div
              data-slot="wallpaper-undersized"
              title={size ? readableSize(size) : undefined}
              className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-neutral-900 backdrop-blur-md"
            >
              {UNDERSIZED}
            </div>
          )}
        </div>
      )}

      {/*
        The reveal layer covers the card and the gradient strip inside it does
        not, so the image stays visible under a hover while there is still one
        element per card carrying the fade. `pointer-events-none` on the layer
        keeps the uncovered image clickable, so a click on the picture is a
        click on the cell and opens the lightbox; the strip takes its own events
        back for the buttons.

        Focus reveals it only when the focus is drawn, on the cell or on one of
        its buttons, which is ADR 0019's selected card under the keyboard. Plain
        `focus-within` also answered to focus a click left behind, so a card
        whose button was clicked, or whose lightbox was just closed, kept its
        overlay open after the pointer left.
      */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-has-[:focus-visible]:opacity-100",
          animated && "transition-opacity will-change-[opacity]",
        )}
      >
        {/* `.dark` because the gradient is dark in both themes, so the buttons
            on it take the dark palette's variants rather than colours of their
            own; `@container` for the key chips' width rule below. */}
        <div className="dark @container pointer-events-auto flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6">
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
            One button per action the Status offers, off `STATUS_ACTIONS` rather
            than off a branch of its own. The branch is what the card used to
            carry, and #125 is what makes the difference matter: the keymap
            reads that table, so a card whose buttons came from somewhere else
            could offer a curator one set with the mouse and another with the
            keyboard.
          */}
          <div className="flex gap-1.5">
            {STATUS_ACTIONS[wallpaper.status].map((action) => (
              <ActionButton
                key={action}
                action={action}
                // Only Restore has a row it cannot act on, and only because
                // ADR 0009's migration left one behind.
                unavailable={action === "restore" && !restorable}
                subject={wallpaper.filename}
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
                // What goes as the card narrows: the key chip first, then the
                // verb, leaving the icon. At the Library's densest a card is
                // about a hundred pixels wide, where a verb truncates to "K…"
                // and says less than the check mark does; the accessible name
                // carries the verb either way.
                className="min-w-0 flex-1 [&_kbd]:hidden @[15rem]:[&_kbd]:inline-flex [&_[data-slot=action-label]]:hidden @[9rem]:[&_[data-slot=action-label]]:inline"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

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
