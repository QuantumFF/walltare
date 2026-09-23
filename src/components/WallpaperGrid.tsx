import { WallpaperCard } from "@/components/WallpaperCard";
import { useDensityWheel, type HeldDensity } from "@/components/density";
import {
  COLUMN_CLASSES,
  GAP,
  NO_RATIOS,
  PADDING,
  useDensity,
  useGridWindow,
  type DensityTab,
  type PlacedCards,
} from "@/components/grid-geometry";
import { answerKey } from "@/components/keymap";
import type { TransitionAction } from "@/components/transitions";
import {
  usePublishedSelection,
  type SelectionHandle,
} from "@/components/selection";
import type { LibraryLayout, Resolution, Wallpaper } from "@/lib/client";
import { isUndersized, shapeOf } from "@/lib/wallpaper";
import type { PlannedWindow } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";

export interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /**
   * The grid's accessible name. A composite widget is one stop in the tab order,
   * so the name is all a screen reader gets on the way in (ADR 0019).
   */
  label: string;
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
   * The scroll box this grid sits inside, for a host that has one.
   *
   * With it the grid windows itself: a few dozen cards in the DOM out of the
   * whole list, measured against this element (ADR 0016). Without it every row
   * is mounted, which is what Review wants at fifty and what a grid outside a
   * scroll container has no way to improve on.
   *
   * A ref the host owns rather than an element the grid creates. `scrollTop`,
   * `toTop` and the restore that puts the curator back where they were are the
   * page's, because the restore turns on `showing` from `useApp()` and on
   * ADR 0015's rule that Rank, Review and Library stay mounted — and a geometry
   * module that knew about the navigation shell is what ADR 0027 refused. Only
   * the arithmetic over the box is here (#231).
   *
   * Whether it is passed at all is fixed for the life of a host: the two shapes
   * are two components below, so a call that started windowing and stopped
   * would remount its cards.
   */
  scroller?: RefObject<HTMLDivElement | null>;
  /**
   * Which tab this grid is on, which is what bounds the density gesture: see
   * `DENSITY` in `grid-geometry`.
   *
   * A name and not a pair of numbers. What the curator zoomed to is the grid's,
   * the way the cursor and the geometry are (ADR 0027, ADR 0042); the one thing
   * the grid cannot work out for itself is which page it was mounted on. So the
   * host says that and nothing else, and the bounds never leave this module —
   * which is also what makes the prop impossible to churn the identity of.
   */
  density: DensityTab;
  /**
   * The zoom, when the host holds it so it outlives this grid (see
   * `HeldDensity`). Absent, the grid holds its own.
   */
  zoom?: HeldDensity;
  /**
   * How the cards are laid out: cropped to one shape, or each at its own.
   *
   * Read only by the windowed shape, and not because masonry is expensive. Its
   * cards carry their own position, that position comes out of the plan, and the
   * plan is what the window builds — so a host with no scroll box has no plan
   * and nothing to position from. Review is the only such host and it draws the
   * uniform grid, which is what an absent `scroller` already means here.
   */
  layout?: LibraryLayout;
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
  /** Layout the host owns: Review's bottom padding, a page's own gap. */
  className?: string;
  /**
   * The handle: the way focus is handed back, and the way the published
   * selection is read.
   *
   * React 19 takes `ref` as an ordinary prop on a function component, so there
   * is no `forwardRef` in the way. Both pages pass the setter of a
   * `useState<SelectionHandle | null>(null)` rather than the `useRef`
   * ADR 0029 wrote, because since #230 *when* the handle exists is information:
   * it is the publication, and a subscriber has to be told to resubscribe when
   * the grid arrives or goes. The setter's identity is stable, so ADR 0029's
   * objection to a callback — that `close`'s `useCallback` deps churn on one —
   * does not apply to this one.
   */
  ref?: Ref<SelectionHandle>;
  /**
   * A wallpaper to open on, read once at mount.
   *
   * Review's layout control is the one caller: swapping the strip for this grid
   * unmounts one surface and mounts the other, and the cursor is the surface's
   * own since #230, so without this the curator lands back at the top of a
   * fifty-row worklist. The library page passes nothing and starts where it
   * always did.
   */
  startOn?: number | null;
}

/**
 * The grid, shared by Review and by the library page (#79), in whichever of its
 * two shapes the host asked for.
 *
 * Two components and not one with a branch in it. A window is a `useVirtualizer`
 * call, hooks do not run conditionally, and a virtualiser standing by on a host
 * that has no scroll box is still `setOptions` and three layout effects on every
 * render of Review's fifty cards. So the choice is a component boundary: pass a
 * `scroller` and the window is computed one level above the cells; pass none and
 * nothing about Review's grid runs at all (ADR 0007, ADR 0016).
 *
 * This is also what makes a scroll cost what it should. The virtualiser
 * re-renders whoever called it, inside a `flushSync` from the scroll handler, so
 * the call site is the tree a wheel gesture rebuilds. Below this line that is
 * the cells; above it, while the page held the call, it was the filter chips,
 * the ordering control, the reject destination line and the mounted lightbox
 * (#231).
 */
export function WallpaperGrid({
  scroller,
  density,
  zoom,
  layout = "grid",
  ...props
}: WallpaperGridProps) {
  // The density is resolved here, above the branch, because both shapes need
  // the count and neither is the whole grid: the windowed one cuts its rows at
  // it one component down and the cells move the selection by it two. Holding
  // it here is also what makes the zoom survive this grid swapping shapes; a
  // host that swaps this grid for another surface holds it itself (`zoom`).
  const { columns, step } = useDensity(density, zoom);
  return scroller ? (
    <WindowedGrid
      scroller={scroller}
      columns={columns}
      onDensityStep={step}
      layout={layout}
      {...props}
    />
  ) : (
    <Grid columns={columns} onDensityStep={step} {...props} />
  );
}

/**
 * The cells, plus the window over them when there is one.
 *
 * The window and the reveal were props of the exported component until #231.
 * They are still the same two facts crossing the same seam; the seam is inside
 * this file now, which is the whole of what that ticket moved.
 */
interface GridProps extends Omit<
  WallpaperGridProps,
  "scroller" | "density" | "zoom" | "layout"
> {
  /**
   * How many cards share a row, resolved from the viewport and the curator's
   * zoom together. `WallpaperGrid` above is the one reader of either.
   */
  columns: number;
  /**
   * Move the density a step: 1 in towards fewer, larger cards, -1 out towards
   * more, smaller ones. Bounded by the host's range, which this side never sees.
   */
  onDensityStep: (by: number) => void;
  /**
   * Where the cards go, for a layout that positions its own. Absent lets the CSS
   * grid below place them, which is every layout that crops to one shape.
   */
  placed?: PlacedCards;
  /**
   * Whether each card draws its own rank: where it sits in the ordering the
   * curator asked for, counted from one.
   *
   * The position in the list and nothing stored, which is the whole of why the
   * rank follows the ordering. A wallpaper's place among the others is what the
   * ordering *is*, so a list re-fetched under a different one hands every card a
   * different number without anything here being told the ordering changed.
   */
  ranked?: boolean;
  /**
   * Which of the cards to mount, and the empty space that holds the rest of the
   * scroll height open around them. See `PlannedWindow`. Absent mounts every
   * row.
   *
   * The grid still receives every wallpaper. It is what resolves the selection,
   * moves it with the arrows and hands each card an index in the whole list, and
   * all of that has to keep working for a wallpaper that has no DOM node at all
   * — so what a window changes is only which cards are rendered (ADR 0016,
   * #131).
   */
  mounted?: PlannedWindow;
  /**
   * Put the card at `index` on screen.
   *
   * It is called before the focus move and never after it, because that is the
   * order the virtualised case needs: the library grid mounts a window of about
   * thirty cards out of five thousand, so the card an arrow key selects may have
   * no DOM node yet, and asking the virtualiser to scroll the row in is what
   * creates one. The effect below then finds nothing to focus and returns; the
   * virtualiser's own commit runs it again, and by then the node exists.
   * Focusing a node that is not there yet is the one way this pattern breaks
   * (ADR 0019).
   *
   * Absent scrolls the selected cell into view, which is the whole of what a
   * grid that mounts every row needs.
   */
  reveal?: (index: number) => void;
}

/**
 * The windowed shape: the same grid, with the window arithmetic one component
 * above the cells.
 *
 * One component's worth of separation is what a scroll now costs. The
 * virtualiser's notification lands here, so a crossing of a row boundary
 * re-renders this and the cells and nothing else — not the page that mounted
 * it, which is what it re-rendered while the call lived up there (#231).
 *
 * The cursor sits one level further down, in `Grid`, so the separation runs the
 * other way too: a cursor move re-renders the cells and leaves the window
 * arithmetic alone. Nothing about the window depends on which card is selected —
 * the reveal is asked for, not derived — so a component that recomputes a
 * virtualiser's options on every arrow key would be recomputing them for nothing
 * (#230).
 */
function WindowedGrid({
  scroller,
  layout,
  ...props
}: GridProps & {
  scroller: RefObject<HTMLDivElement | null>;
  layout: LibraryLayout;
}) {
  // The shapes the plan packs, and only for the layouts that read them: the
  // uniform grid crops every wallpaper to one shape, so a ratio per card reaches
  // nothing there and would be a list of five thousand numbers rebuilt on every
  // patch to be ignored. `NO_RATIOS` is stable, so that grid's plan still
  // depends on a length and not on a list.
  const ratios = useMemo(
    () => (layout === "grid" ? NO_RATIOS : props.wallpapers.map(shapeOf)),
    [layout, props.wallpapers],
  );
  const { mounted, reveal, placed } = useGridWindow(
    props.wallpapers.length,
    props.columns,
    scroller,
    layout,
    ratios,
  );
  return (
    <Grid
      {...props}
      mounted={mounted}
      reveal={reveal}
      placed={placed}
      // The rank is justified rows' whole argument for existing: the app
      // produces a ranking and the other two layouts say so in a badge the size
      // of a word (#263). A boolean rather than the layout's name, because what
      // the cells below need to know is whether a card carries its position and
      // not which plan put it where — and a value is what keeps the card's memo
      // holding through a scroll (#229).
      ranked={layout === "justified"}
    />
  );
}

/**
 * The cells, the cursor, the focus and the keys.
 *
 * One tab stop with a roving selection: the container is `role="grid"`, each
 * card a `gridcell` at `tabindex="-1"` except the selected one at `0`, so Tab
 * reaches the grid once and Tab leaves it once whatever the row count. Inside,
 * the arrows move by column and by row and `Home` and `End` reach the ends.
 * This is the pattern the chrome's tablist already uses, so the app has one
 * composite-widget model rather than two (ADR 0015, ADR 0019).
 *
 * Virtualisation is what forces it. A tab order that walks DOM nodes walks the
 * window of cards ADR 0016 mounts and then leaves the grid, which puts wallpaper
 * 3,000 out of reach however the cards are marked up. Review's fifty rows would
 * work under any model, and a second interaction model to learn is worse than
 * the one it saves.
 *
 * There are no `role="row"` wrappers. The rows here are the CSS grid's own
 * auto-flow, and a wrapper per row would have to carry `display: contents` to
 * stay out of the layout — which has a history of dropping the element, and the
 * role on it, out of the accessibility tree. The cells are in reading order and
 * the column count above is what says where the rows fall.
 */
function Grid({
  wallpapers,
  label,
  onAction,
  animated = false,
  scoresMoved,
  minimumResolution,
  evaluatedThreshold,
  reveal,
  mounted,
  columns,
  onDensityStep,
  placed,
  ranked = false,
  onOpen,
  className,
  ref,
  startOn,
}: GridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // How this layout finds a cell and brings one on screen, which is the whole of
  // what the shared roving focus does not already know (`selection.ts`).
  // Rebuilt per render and latched in there, so nothing here has to be stable.
  const focus = {
    container: gridRef,
    nodeAt: (at: number) =>
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${at}"]`) ??
      null,
    reveal,
  };

  // The cursor, the publication, the handle and the focus, all of which are the
  // shared selection module's. They are here rather than in the page since #230,
  // which is what makes a move a re-render of this component and of the two
  // cards whose `selected` changed, instead of the page and every card on it
  // (ADR 0041). #265 took the same four out of this file and into one both
  // listing surfaces read, because Review's strip owes every one of them too.
  const {
    selection,
    onFocus: handleFocus,
    onBlur: handleBlur,
    moveByKey,
  } = usePublishedSelection(wallpapers, focus, ref, startOn);
  const { wallpaper: selected, index } = selection;

  // What this commit puts in the DOM, as positions in the whole list — which is
  // every card until a host's window says less. Nothing above this line reads
  // it: the selection, the arrow keys and the fall back are about the list, and
  // a card the window left out is a card with no node rather than a wallpaper
  // that stopped existing.
  //
  // Positions and not a slice, because which cards a row holds is the plan's to
  // say. The uniform grid's rows hold runs and a slice would do; a layout that
  // packs by shortest column does not, and a grid that assumed it would draw the
  // wrong cards rather than fail (#261).
  //
  // Built only for the host that has no window, and memoised on the list, so
  // Review's fifty positions are not rebuilt on a cursor move and the library's
  // five thousand are never built at all. Whether a host windows is fixed for
  // its life, which is what makes that a stable dependency (see `scroller`).
  const windowed = mounted !== undefined;
  const everyCard = useMemo(
    () => (windowed ? [] : wallpapers.map((_, at) => at)),
    [windowed, wallpapers],
  );
  const cards = mounted ? mounted.cards : everyCard;

  // Ctrl and the wheel over the cards, changing the density rather than the
  // page's scale. See `useDensityWheel`, which Review's strip reads too.
  useDensityWheel(gridRef, onDensityStep);

  // The keys, on this container rather than on `window`: they fire only while
  // focus is inside the grid, which is the dividing line ADR 0019 draws and the
  // reason nothing here reaches Rank. Global shortcuts live in the shell's
  // handler; view-local keys live on the element that owns the focus. What a
  // key means is the keymap's, prevention included (#286).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const intent = answerKey(event, {
      surface: { kind: "grid", columns, cell: () => focus.nodeAt(index) },
      selected,
      index,
      length: wallpapers.length,
    });
    switch (intent?.kind) {
      case "density":
        onDensityStep(intent.by);
        break;
      // The same entry a card's own buttons go through, so a key and a click
      // take one path — the origin-less refusal included, which the host's
      // `perform` holds once rather than once per trigger (ADR 0023). Focus
      // stays here while the toast is up, so the next card is already selected.
      case "act":
        onAction(intent.action, intent.wallpaper);
        break;
      // The same `onOpen` a click on the cell reaches: one host handler for the
      // gesture, so the key and the mouse cannot open different things
      // (ADR 0022, #138).
      case "open":
        onOpen?.(intent.wallpaper);
        break;
      case "move":
        moveByKey(intent.to);
        break;
      // Every intent the keymap can hand this surface is answered above, so
      // only an unanswered key reaches here, and a binding newly given to this
      // surface fails to compile until it is (#286).
      default:
        intent satisfies undefined;
    }
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      // Reachable programmatically and not by Tab. The cells hold the tab stop;
      // this is where focus lands when there is no cell left to hold it.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // A windowed grid wears the padding its window was measured against, which
      // is what keeps every geometry number inside the grid: `PADDING.px` is
      // told to the virtualiser and `PADDING.className` is worn here, off the
      // one pair. Review mounts every card and its own `pb-8` reaches this same
      // element (ADR 0027).
      //
      // A layout that positions its own cards wears none of it. Its cards are
      // out of the flow, so a CSS grid has nothing to flow and the padding is
      // already inside the boxes — what this element is then is the box those
      // offsets are measured from, which is what `relative` says.
      className={
        placed
          ? cn("relative", className)
          : cn(
              "grid",
              GAP.className,
              mounted && PADDING.className,
              // The class for the count the arrows move by and the plan cuts its
              // rows at, rather than a set of responsive utilities stating the
              // same thing a second time. A count outside `COLUMN_CLASSES` is a
              // density range wider than the table, which is a bug in the range
              // and not in a render, so the grid falls back to its own auto-flow
              // rather than disappearing.
              COLUMN_CLASSES[columns],
              className,
            )
      }
      // The window's position inside the scroller, and the reason the class
      // above can still carry a `p-4`: an inline `padding-top` replaces only the
      // top of that shorthand, so the host's horizontal padding survives being
      // told where the mounted range sits.
      //
      // Held open by a height instead when the cards position themselves: the
      // space above and below the window is the space nothing is drawn in, and
      // an absolutely positioned card adds none of it.
      style={
        placed
          ? { height: placed.total }
          : mounted
            ? { paddingTop: mounted.before, paddingBottom: mounted.after }
            : undefined
      }
    >
      {/*
        `cellIndex` is the index in the whole list and not in what is mounted,
        which is what lets the library page render a window of these cards
        without the selection or the arrow keys knowing (#131).

        Two values and not the one object they used to arrive in. The object was
        built here per card per render, so every mounted card saw a new prop
        whenever anything on the page re-rendered — a number and a boolean carry
        the same two facts and carry them by value, which is what makes #230's
        memoised card mean something (#229).

        Every prop below is a value or a stable identity, and that is the whole
        of what a cursor move costs: this component re-renders, the card's memo
        compares, and only the card that lost the selection and the card that
        gained it have a changed `selected` to render for. `onAction` is
        `useWallpaperRows`' latched handler, `onOpen` the lightbox's open call
        keyed on the grid rather than on the selection, and `scoreMoved` a
        boolean read out of the page's set — three identities that all used to
        churn, and each of which would quietly defeat the memo on its own.

        `undersized` is resolved here for the same reason: the comparison is the
        page's setting against this row's Dimensions, and a card handed the size
        object would be a card whose props move when the settings struct is
        replaced, whatever key was actually written (#258).
      */}
      {cards.map((cardIndex) => {
        const wallpaper = wallpapers[cardIndex];
        return (
          <WallpaperCard
            key={wallpaper.id}
            wallpaper={wallpaper}
            onAction={onAction}
            animated={animated}
            scoreMoved={scoresMoved?.has(wallpaper.id)}
            onOpen={onOpen}
            cellIndex={cardIndex}
            selected={cardIndex === index}
            box={placed?.boxes[cardIndex]}
            undersized={
              minimumResolution
                ? isUndersized(wallpaper, minimumResolution)
                : false
            }
            // Counted from one, because a rank is what the curator would say out
            // loud about a wallpaper and nobody says their favourite is number
            // zero.
            rank={ranked ? cardIndex + 1 : undefined}
            evaluatedThreshold={evaluatedThreshold}
          />
        );
      })}
    </div>
  );
}
