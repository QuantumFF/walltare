import { useDensityWheel, type HeldDensity } from "@/components/density";
import {
  COLUMN_CLASSES,
  GAP,
  NO_RATIOS,
  PADDING,
  useDensity,
  useGridWindow,
  type CardSpec,
  type DensityTab,
  type PlacedCards,
} from "@/components/grid-geometry";
import { answerKey, type ActionTable } from "@/components/keymap";
import {
  usePublishedSelection,
  type Keyed,
  type SelectionHandle,
} from "@/components/selection";
import type { LibraryLayout } from "@/lib/client";
import type { PlannedBox, PlannedWindow } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

/**
 * What the grid tells a card about the cell it is drawn in.
 *
 * Every field is a value, so a renderer that hands them straight to a memoised
 * card keeps that memo holding through a cursor move and a scroll: only the two
 * cards whose `selected` changed have anything to render for (#229, #230).
 *
 * The card is the cell. It wears `role="gridcell"`, `data-cell={cellIndex}` and
 * `tabIndex={selected ? 0 : -1}` itself, because the roving focus finds the
 * selected cell by `data-cell` and focuses what it finds (ADR 0019). A card that
 * leaves any of the three off is a cell the arrow keys cannot land on.
 */
export interface GridCell {
  /**
   * The card's position in the whole list and not in what is mounted, which is
   * what lets a windowed grid render a few dozen cards without the selection or
   * the arrow keys knowing (#131).
   */
  cellIndex: number;
  /** Whether the cursor is on this card. */
  selected: boolean;
  /**
   * Where the card goes, for a layout that positions its own. Absent lets the CSS
   * grid place it, which is every layout that crops to one shape.
   */
  box?: PlannedBox;
  /**
   * How wide the card is drawn, in CSS pixels: its box's width when it has one,
   * and the grid's width over its columns otherwise.
   *
   * A width rather than a thumbnail size, because which sizes there are is the
   * card's business — a Wallpaper's thumbnails and a Result's are not the same
   * set. A renderer that turns it into a size before handing it on keeps the
   * card's memo holding through a resize that stays on one side of a threshold.
   */
  width: number;
  /**
   * How many columns the grid is drawn at, which is the curator's zoom. For a
   * card whose choice of picture follows the zoom itself rather than the pixels
   * it is drawn at, as Discover's full file does at three columns and fewer.
   */
  columns: number;
}

export interface ItemGridProps<T extends Keyed, A extends string> {
  /** The list, in the order it is drawn. */
  items: T[];
  /**
   * The grid's accessible name. A composite widget is one stop in the tab order,
   * so the name is all a screen reader gets on the way in (ADR 0019).
   */
  label: string;
  /**
   * Draw one card. See `GridCell` for what the card owes the grid back.
   *
   * Called per mounted card per render and never handed to a card, so its
   * identity costs nothing: what the memo compares is the element it returns.
   */
  renderCard: (item: T, cell: GridCell) => ReactNode;
  /**
   * What a key does to the selected item on this page: `STATUS_KEYS` for Library
   * and Review, and Discover's own table for Results (#336). The navigation keys
   * are the keymap's and every page shares them.
   */
  actions: ActionTable<T, A>;
  /**
   * An action key pressed on the selected item. The same entry a card's own
   * buttons go through on the pages that have them, so a key and a click take
   * one path (ADR 0023).
   */
  onAct: (action: A, item: T) => void;
  /**
   * What a card is, as the plan has to know it before any card exists: its
   * picture's shape and the caption under it. See `CardSpec`.
   *
   * Stable for the life of the host — a module-level constant — because the plan
   * is memoised on it and a fresh one is a whole plan rebuilt per render.
   */
  card: CardSpec;
  /**
   * An item's own shape as height over width, or `null` when it has none, for
   * the two layouts that draw each item at its own. Unread by the uniform grid.
   *
   * Stable for the same reason `card` is.
   */
  shapeOf?: (item: T) => number | null;
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
   * ADR 0015's rule that every tab stays mounted — and a geometry module that
   * knew about the navigation shell is what ADR 0027 refused. Only the
   * arithmetic over the box is here (#231).
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
   * The curator asking to look at an item properly: `Enter` on the selected
   * cell (#134, #138). A click on a card reaches the host through the card
   * itself, and should reach this same handler, so the key and the mouse cannot
   * open different things (ADR 0022).
   */
  onOpen?: (item: T) => void;
  /** Layout the host owns: Review's bottom padding, a page's own gap. */
  className?: string;
  /**
   * The handle: the way focus is handed back, and the way the published
   * selection is read.
   *
   * React 19 takes `ref` as an ordinary prop on a function component, so there
   * is no `forwardRef` in the way. Hosts pass the setter of a
   * `useState<SelectionHandle | null>(null)` rather than the `useRef`
   * ADR 0029 wrote, because since #230 *when* the handle exists is information:
   * it is the publication, and a subscriber has to be told to resubscribe when
   * the grid arrives or goes. The setter's identity is stable, so ADR 0029's
   * objection to a callback — that `close`'s `useCallback` deps churn on one —
   * does not apply to this one.
   */
  ref?: Ref<SelectionHandle<T>>;
  /**
   * An item to open on, read once at mount.
   *
   * Review's layout control is the one caller: swapping the strip for this grid
   * unmounts one surface and mounts the other, and the cursor is the surface's
   * own since #230, so without this the curator lands back at the top of a
   * fifty-row worklist. The library page passes nothing and starts where it
   * always did.
   */
  startOn?: T["id"] | null;
  /**
   * Whether the cursor follows the mouse: a pointer moved onto a card selects
   * it, so the action keys act on the card under the mouse. Discover's grid,
   * where the curator browses with the mouse and presses `P` or `D` over what
   * they are looking at.
   *
   * See `useFollowPointer` for how, and for a still mouse the page scrolls
   * under.
   */
  followPointer?: boolean;
}

/**
 * The grid, over any list whose entries have a key (#336), in whichever of its
 * two shapes the host asked for.
 *
 * It holds the cursor, the keys, the density and the window, and draws nothing
 * of an item itself: the card is the host's `renderCard`, and what a key does to
 * an item is the host's action table. `WallpaperGrid` is the host Library and
 * Review mount; Discover mounts this directly over Results.
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
export function ItemGrid<T extends Keyed, A extends string>({
  scroller,
  density,
  zoom,
  layout = "grid",
  shapeOf,
  ...props
}: ItemGridProps<T, A>) {
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
      shapeOf={shapeOf}
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
interface GridProps<T extends Keyed, A extends string> extends Omit<
  ItemGridProps<T, A>,
  "scroller" | "density" | "zoom" | "layout" | "shapeOf"
> {
  /**
   * How many cards share a row, resolved from the viewport and the curator's
   * zoom together. `ItemGrid` above is the one reader of either.
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
   * Which of the cards to mount, and the empty space that holds the rest of the
   * scroll height open around them. See `PlannedWindow`. Absent mounts every
   * row.
   *
   * The grid still receives every item. It is what resolves the selection,
   * moves it with the arrows and hands each card an index in the whole list, and
   * all of that has to keep working for an item that has no DOM node at all —
   * so what a window changes is only which cards are rendered (ADR 0016, #131).
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
function WindowedGrid<T extends Keyed, A extends string>({
  scroller,
  layout,
  shapeOf,
  ...props
}: GridProps<T, A> & {
  scroller: RefObject<HTMLDivElement | null>;
  layout: LibraryLayout;
  shapeOf: ((item: T) => number | null) | undefined;
}) {
  // The shapes the plan packs, and only for the layouts that read them: the
  // uniform grid crops every item to one shape, so a ratio per card reaches
  // nothing there and would be a list of five thousand numbers rebuilt on every
  // patch to be ignored. `NO_RATIOS` is stable, so that grid's plan still
  // depends on a length and not on a list.
  const ratios = useMemo(
    () =>
      layout === "grid" || !shapeOf ? NO_RATIOS : props.items.map(shapeOf),
    [layout, shapeOf, props.items],
  );
  const { mounted, reveal, placed } = useGridWindow(
    props.items.length,
    props.columns,
    scroller,
    layout,
    ratios,
    props.card,
  );
  return <Grid {...props} mounted={mounted} reveal={reveal} placed={placed} />;
}

/**
 * How wide a uniform grid's cell is, from the grid's own width.
 *
 * One observer on the grid rather than one per card, because ADR 0041 puts the
 * gesture's cost in card mount. The cell width is the grid's width over its
 * columns, gap and padding ignored: it overshoots by a few pixels, which moves a
 * card's thumbnail threshold a few pixels early and never leaves a card
 * upscaled.
 *
 * The positioned layouts do not need it: their boxes already carry a width.
 */
function useCellWidth(
  grid: RefObject<HTMLDivElement | null>,
  columns: number,
): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = grid.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // The last non-zero width is kept, as `useGridWindow` keeps its own, so a
    // view the shell hides does not drop every card back to its smallest size.
    const observer = new ResizeObserver(([entry]) => {
      const measured = entry.contentRect.width;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [grid]);
  return width / Math.max(columns, 1);
}

/**
 * The grid's cursor following the mouse (`followPointer`): the card the mouse
 * is over becomes the selected one, through `moveByPointer`.
 *
 * Driven by `pointermove` and not by `pointerenter`, because engines disagree
 * about whether a card a wheel pass slides under a still pointer was entered:
 * WebKitGTK fired no `mouseover` across a whole wheel run (ADR 0041). So a
 * wheel's scroll is followed on its own terms instead. Once it has been quiet
 * for a moment, the card under where the mouse last was is the one it is over now,
 * and that is the card selected. Once and not per frame, so a wheel pass moves
 * the focus at its end rather than across every card it slides by.
 *
 * While the mouse is what put the cursor where it is, the grid wears
 * `data-pointed`, so a card can leave off the keyboard's focus ring: a key
 * pressed over a card the mouse focused makes the engine draw that focus as
 * keyboard focus. An arrow key takes the attribute off. Set on the node rather
 * than through state, so the mouse crossing a card renders nothing for it.
 *
 * Touch and pen have no hover to follow; a tap is a click, which opens the
 * card. `undefined` when the host did not ask, so the grid carries no pointer
 * handlers at all.
 */
function useFollowPointer(
  grid: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  moveByPointer: (index: number) => void,
) {
  // Where the mouse last was over the grid, in the viewport, or `null` once it
  // has left.
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  const move = useRef(moveByPointer);
  useEffect(() => {
    move.current = moveByPointer;
  });

  const point = (cell: number) => {
    if (grid.current) grid.current.dataset.pointed = "";
    move.current(cell);
  };

  // The cell of the grid under a point in the viewport, if there is one.
  const cellAt = (target: Element | null) => {
    const cell = target?.closest<HTMLElement>("[data-cell]");
    return cell && grid.current?.contains(cell)
      ? Number(cell.dataset.cell)
      : null;
  };

  useEffect(() => {
    if (!enabled) return;
    // Armed by the wheel and not by any scroll: an arrow key's reveal scrolls
    // too, and following that would put the cursor straight back under a
    // mouse the curator had stopped using.
    let armed = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        armed = false;
        const at = pointerAt.current;
        if (!at) return;
        const cell = cellAt(document.elementFromPoint(at.x, at.y));
        if (cell !== null) point(cell);
      }, SCROLL_SETTLE_MS);
    };
    const onWheel = (event: WheelEvent) => {
      // Ctrl and the wheel is the density, which scrolls nothing.
      if (event.ctrlKey || !pointerAt.current) return;
      armed = true;
      wait();
    };
    // A smooth scroll runs on past its last wheel event.
    const onScroll = () => {
      if (armed) wait();
    };
    // Captured on the window, because a scroll does not bubble and the box
    // that scrolls is the host's.
    const options = { capture: true, passive: true };
    window.addEventListener("wheel", onWheel, options);
    window.addEventListener("scroll", onScroll, options);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("wheel", onWheel, options);
      window.removeEventListener("scroll", onScroll, options);
    };
  }, [enabled]);

  if (!enabled) return undefined;
  return {
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") return;
      pointerAt.current = { x: event.clientX, y: event.clientY };
      const cell = cellAt(
        event.target instanceof Element ? event.target : null,
      );
      if (cell !== null) point(cell);
    },
    onPointerLeave: () => {
      pointerAt.current = null;
    },
  };
}

/** How long a scroll has to be quiet before the cursor follows the mouse. */
const SCROLL_SETTLE_MS = 120;

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
function Grid<T extends Keyed, A extends string>({
  items,
  label,
  renderCard,
  actions,
  onAct,
  reveal,
  mounted,
  columns,
  onDensityStep,
  placed,
  onOpen,
  className,
  ref,
  startOn,
  followPointer = false,
}: GridProps<T, A>) {
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
    moveByPointer,
  } = usePublishedSelection(items, focus, ref, startOn);
  const { item: selected, index } = selection;

  // What this commit puts in the DOM, as positions in the whole list — which is
  // every card until a host's window says less. Nothing above this line reads
  // it: the selection, the arrow keys and the fall back are about the list, and
  // a card the window left out is a card with no node rather than an item that
  // stopped existing.
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
    () => (windowed ? [] : items.map((_, at) => at)),
    [windowed, items],
  );
  const cards = mounted ? mounted.cards : everyCard;

  // How wide a uniform cell is drawn. See `useCellWidth`.
  const cellWidth = useCellWidth(gridRef, columns);

  // Ctrl and the wheel over the cards, changing the density rather than the
  // page's scale. See `useDensityWheel`, which Review's strip reads too.
  useDensityWheel(gridRef, onDensityStep);

  // The keys, on this container rather than on `window`: they fire only while
  // focus is inside the grid, which is the dividing line ADR 0019 draws and the
  // reason nothing here reaches Rank. Global shortcuts live in the shell's
  // handler; view-local keys live on the element that owns the focus. What a
  // key means is the keymap's, prevention included (#286), and what an action
  // key does to an item is the page's table (#336).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const intent = answerKey(
      event,
      {
        surface: { kind: "grid", columns, cell: () => focus.nodeAt(index) },
        selected,
        index,
        length: items.length,
      },
      actions,
    );
    switch (intent?.kind) {
      case "density":
        onDensityStep(intent.by);
        break;
      // The same entry a card's own buttons go through, so a key and a click
      // take one path — the origin-less refusal included, which the host's
      // `perform` holds once rather than once per trigger (ADR 0023). Focus
      // stays here while the toast is up, so the next card is already selected.
      case "act":
        onAct(intent.action, intent.item);
        break;
      // The same `onOpen` a click on the cell reaches: one host handler for the
      // gesture, so the key and the mouse cannot open different things
      // (ADR 0022, #138).
      case "open":
        onOpen?.(intent.item);
        break;
      case "move":
        // The keyboard has the cursor back, focus ring and all
        // (`useFollowPointer`).
        delete gridRef.current?.dataset.pointed;
        moveByKey(intent.to);
        break;
      // Every intent the keymap can hand this surface is answered above, so
      // only an unanswered key reaches here, and a binding newly given to this
      // surface fails to compile until it is (#286).
      default:
        intent satisfies undefined;
    }
  };

  // The cursor following the mouse, for a host that asked. See
  // `useFollowPointer`.
  const pointer = useFollowPointer(gridRef, followPointer, moveByPointer);

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      onPointerMove={pointer?.onPointerMove}
      onPointerLeave={pointer?.onPointerLeave}
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
        Keyed on the item's own key, so a reorder moves a card rather than
        rebuilding it — the fragment is only where the key goes, since the
        element inside is the host's.
      */}
      {cards.map((cardIndex) => {
        const item = items[cardIndex];
        const box = placed?.boxes[cardIndex];
        return (
          <Fragment key={item.id}>
            {renderCard(item, {
              cellIndex: cardIndex,
              selected: cardIndex === index,
              box,
              width: box ? box.width : cellWidth,
              columns,
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
