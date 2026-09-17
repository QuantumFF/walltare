import {
  actionFor,
  WallpaperCard,
  type CardAction,
} from "@/components/WallpaperCard";
import {
  usePublishedSelection,
  type SelectionHandle,
} from "@/components/selection";
import type {
  LibraryLayout,
  Resolution,
  Wallpaper,
} from "@/lib/client";
import { isUndersized } from "@/lib/copy";
import {
  NOTHING_MOUNTED,
  densityColumns,
  densityZoom,
  planJustified,
  planMasonry,
  planUniformGrid,
  uniformRowHeight,
  windowOf,
  type DensityRange,
  type JustifiedPlan,
  type LayoutPlan,
  type MasonryPlan,
  type PlannedBox,
  type PlannedWindow,
} from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";

/**
 * How many cards a row holds at each width, before the curator has said
 * anything about it.
 *
 * The breakpoints are Tailwind's own `md`, `lg` and `xl`, so the widths the
 * count steps at are the widths the rest of the app steps at.
 *
 * The classes that used to sit beside these numbers are gone, and #264 is what
 * took them. The count is no longer a function of the viewport alone — a zoom
 * offsets it, inside the bounds of whichever tab the grid is on — so a set of
 * responsive `grid-cols-*` utilities could not state it at all. What the
 * container wears is read out of `COLUMN_CLASSES` below, off the same number the
 * arrows move by and the plan cuts its rows at. So the pair ADR 0027 wrote down
 * survives the change in the stronger form: one number, and one class named by
 * it, rather than two statements a breakpoint could put out of step.
 */
const COLUMNS = [
  { minWidth: 0, columns: 2 },
  { minWidth: 768, columns: 3 },
  { minWidth: 1024, columns: 4 },
  { minWidth: 1280, columns: 5 },
] as const;

/**
 * What the grid container wears for a column count, and the whole of what the
 * CSS can draw.
 *
 * Spelled out rather than built from the number, because Tailwind generates a
 * utility only when it finds the literal in the source — the same constraint
 * that used to make `COLUMNS` carry its class strings. A count with no entry
 * here is a count the CSS cannot draw, so the bounds below stay inside two and
 * eight, and this table is where a wider tab would have to start.
 */
const COLUMN_CLASSES: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

/** The two tabs that mount this grid, which is what their bounds are named by. */
type DensityTab = "library" | "review";

/**
 * How far the density goes on each tab.
 *
 * Both go equally large, because the wallpaper is the point on either page. What
 * differs is the far end. Library is the browse surface, and the epic's story is
 * going "from a few large wallpapers to many small ones" over a library of up to
 * five thousand, so eight is where a card is still a picture rather than a
 * swatch. Review is fifty wallpapers the curator is deciding about, and a card
 * too small to judge without opening it has stopped doing that page's job — there
 * is no scale there for a wider end to buy (ADR 0028).
 *
 * Library's far end has a cost Review's does not: more columns is shorter rows,
 * and shorter rows is more cards inside the same window, which is the mount rate
 * ADR 0041 measured the grid's frame time against.
 *
 * The numbers are the grid's, and they stay here. A host names which tab it is
 * and the grid looks the bounds up, rather than the two pairs being exported for
 * a page to import and hand straight back — which would widen this module's
 * interface by two names without deepening anything, the shape ADR 0027 refused
 * for the geometry constants.
 */
const DENSITY: Record<DensityTab, DensityRange> = {
  library: { min: 2, max: 8 },
  review: { min: 2, max: 6 },
};

/**
 * Which way each key moves the density: in towards fewer, larger cards, or out
 * towards more, smaller ones.
 *
 * Four keys for two directions, because both of the obvious ones need their
 * unshifted twin. `+` is `Shift` and `=` on most layouts, so a curator reaching
 * for it without the shift lands on `=`; `_` is the other half of the same pair
 * for `-`. The numeric keypad reports its own two as `+` and `-`, so it is
 * already covered.
 */
const DENSITY_KEYS: Record<string, number> = {
  "+": 1,
  "=": 1,
  "-": -1,
  _: -1,
};

/**
 * The queries behind the table, parsed once for the life of the process.
 *
 * A `MediaQueryList` answers `matches` off the window it was made from, so four
 * of them made here answer for every reader forever. Made per call they were on
 * the hot path twice over: the count below is a `useSyncExternalStore` snapshot,
 * which React reads on every render of every reader and again to check for
 * tearing, and two hooks read it.
 *
 * The first step has no query. `minWidth: 0` matches every viewport, so it is
 * the count a window narrower than `md` gets and there is nothing to ask.
 */
const QUERIES: ReadonlyArray<MediaQueryList | null> = COLUMNS.map((step) =>
  step.minWidth === 0
    ? null
    : window.matchMedia(`(min-width: ${step.minWidth}px)`),
);

/** The widest breakpoint the window has reached, as a number of cards. */
function measureColumns(): number {
  let columns: number = COLUMNS[0].columns;
  for (const [at, step] of COLUMNS.entries()) {
    const query = QUERIES[at];
    if (query === null || query.matches) columns = step.columns;
  }
  return columns;
}

/**
 * The count as last measured, and every hook waiting to hear that it moved.
 *
 * The cache is what makes `columnsNow` a snapshot rather than a measurement. A
 * `useSyncExternalStore` getter that measures is a getter that can answer
 * differently inside one render, and it puts the whole media-query read on every
 * render of every reader — which after #230 is a read inside a scroll handler.
 * So the queries are consulted when a `resize` says the viewport moved, and the
 * number in between is the same number.
 *
 * One subscription serves every reader. Each hook registering its own `resize`
 * listener meant N handlers doing the same work to reach the same conclusion,
 * and the set is what replaces them: the listener goes on with the first reader
 * and comes off with the last.
 */
let columns = measureColumns();
const readers = new Set<() => void>();

/** The one `resize` handler, however many hooks are reading the count. */
function remeasure(): void {
  const moved = measureColumns();
  if (moved === columns) return;
  columns = moved;
  // Over a copy, the way the event bus fans out: a reader may unsubscribe on
  // being told, and mutating the set mid-iteration would skip the one after it.
  for (const reader of [...readers]) reader();
}

function subscribeToColumns(onChange: () => void): () => void {
  if (readers.size === 0) window.addEventListener("resize", remeasure);
  readers.add(onChange);
  return () => {
    readers.delete(onChange);
    if (readers.size === 0) window.removeEventListener("resize", remeasure);
  };
}

/**
 * How many cards are in a row, from the cache above.
 *
 * Measured only while nothing is subscribed, which is the one window in which
 * the cache can be wrong: no listener was there to hear the resize, and the
 * first reader's first render is where the answer has to be right. Every read
 * after that is the cached number, so the snapshot React compares is the same
 * value while the breakpoint holds.
 */
function columnsNow(): number {
  if (readers.size === 0) columns = measureColumns();
  return columns;
}

/**
 * How many cards are in a row right now.
 *
 * Read from the same media queries the classes above compile to, rather than
 * measured off the laid-out cards. Measuring is the obvious answer and it has no
 * seam a test can reach: happy-dom reports every box as zero-sized, so a count
 * taken from `offsetTop` or `getBoundingClientRect` is 1 or the whole list under
 * test, and the only way to arrange a known count would be to stand a stub in
 * front of the component's own internals. `matchMedia` is answered from the
 * viewport, which a test sets the way `desktopColorScheme` sets the theme — the
 * real query, arranged.
 *
 * `resize` is the one subscription, and it is one for the whole app rather than
 * one per hook. happy-dom fires it from `setViewport` and a real window fires it
 * on every viewport change, while a `MediaQueryList` `change` listener would
 * need one subscription per breakpoint and is not fired by happy-dom at all.
 */
function useGridColumns(): number {
  return useSyncExternalStore(subscribeToColumns, columnsNow);
}

/**
 * The density: how many cards share a row, and the two gestures that move it.
 *
 * One reader of the responsive count for the whole grid, and every part that
 * needs a column count is handed the answer. Both halves used to call
 * `useGridColumns` for themselves — the window to cut its rows, the cells to
 * move the selection — and once the curator can offset it, two readers is two
 * chances to offset it differently.
 *
 * The zoom is a number of steps and not a column count, which is what keeps the
 * breakpoints working underneath it: a curator who went one step in is one step
 * in at every window width rather than pinned to the number that width happened
 * to be showing (see `densityColumns`).
 *
 * `step` is written functionally, so it depends on the base and the bounds rather
 * than on the zoom it is reading — a gesture on a grid mid-commit cannot be
 * applied to a stale one. Its identity moves when the viewport crosses a
 * breakpoint and not otherwise, and no card is ever handed it (ADR 0042).
 *
 * The tab arrives as a name and the bounds are looked up here, so the caller
 * cannot hand over an object rebuilt per render — which would make the callback
 * a fresh one per render and the wheel listener a resubscription per render.
 */
function useDensity(tab: DensityTab): {
  columns: number;
  step: (by: number) => void;
} {
  const range = DENSITY[tab];
  const base = useGridColumns();
  const [zoom, setZoom] = useState(0);
  const step = useCallback(
    (by: number) => setZoom((was) => densityZoom(base, was, by, range)),
    [base, range],
  );
  return { columns: densityColumns(base, zoom, range), step };
}

/**
 * The grid's own spacing, as numbers beside the classes they restate, because
 * the plan below has to know how tall a row is before the row exists and the
 * CSS is the only place that says.
 *
 * The same pair `COLUMNS` is: the number and the class are one statement, and
 * two copies of it drift. What it costs when they do is a window positioned
 * against a row height nothing has, which puts the wrong cards on screen. The
 * alternative is measuring a card once it is laid out and feeding the height
 * back, which is what happy-dom rules out — it does no layout, so the
 * measurement is zero, the window collapses and the tests that pin it have
 * nothing to assert against (#131).
 *
 * `className` is the cross-reference and not always the thing that gets worn:
 * `aspect-video` stays literal on `WallpaperCard`, which is the element wearing
 * it, and this field is how a reader of either file finds the other. The other
 * two are worn by the container below (ADR 0027).
 */
const GAP = { px: 24, className: "gap-6" };
const CARD_ASPECT = { ratio: 9 / 16, className: "aspect-video" };
const PADDING = { px: 16, className: "p-4" };

/**
 * What a box that measures zero is taken to be: a row about as tall as a card
 * in the default 1280x800 window, inside a viewport about as tall as that
 * window.
 *
 * A zero-sized box is not an edge case here, and a window with no fallback is
 * no window at all — the virtualiser answers a viewport of zero with an empty
 * range, so every card would be unmounted rather than thirty of them mounted.
 * happy-dom does no layout and reports every rect as zero, which is what would
 * otherwise leave the two windowing tests asserting about an empty grid (#131);
 * and ADR 0015 keeps the library view mounted under `display: none` while
 * another view is showing, which zeroes the box in a real browser too.
 */
const UNMEASURED_ROW = 130;
const UNMEASURED_BOX = 800;

/**
 * The two spacings a plan is laid out against, as the plan module takes them.
 *
 * Written once here rather than at each of the two calls below, which is the
 * same rule the pairs above follow: a copy of `GAP.px` is a copy that drifts.
 */
const SPACING = { gap: GAP.px, padding: PADDING.px };

/**
 * How tall one row of cards is, from the width the row has to fill and the
 * number of cards sharing it.
 *
 * Derived from the width rather than measured off a laid-out card, for the same
 * reason `useGridColumns` reads the media queries rather than the cards: a size
 * taken from a rect is zero under test, and a window built on it degenerates.
 *
 * Both numbers are arguments rather than read from `columnsNow` and a box, so
 * this is a pure function of two numbers that one test can drive over the four
 * column counts — including the zero-width branch every happy-dom run takes.
 * That test is the reason for the `export`, which is the whole of what it is
 * for: nothing in the app calls this from outside this file, and the arithmetic
 * is otherwise reachable only through a mounted page whose box measures zero
 * (ADR 0027).
 *
 * This is where the grid's four private constants meet the arithmetic over them:
 * `@/lib/layout-plan` is handed the numbers and holds no copy of them, so the
 * grid still owns its geometry and the arithmetic is still a pure function
 * nothing has to mount to drive.
 *
 * What it answers is the uniform grid's row height and nothing more general.
 * The plan below is where a row height becomes a fact per row rather than one
 * number for all of them.
 */
export function rowHeight(boxWidth: number, columns: number): number {
  return uniformRowHeight({
    ...SPACING,
    columns,
    width: boxWidth,
    cardRatio: CARD_ASPECT.ratio,
    unmeasuredHeight: UNMEASURED_ROW,
  });
}

/**
 * A wallpaper's shape, as height over width, or `null` while the app has not
 * read its Dimensions.
 *
 * Named for the wallpaper's own shape rather than for the card's, because
 * `UniformRow.cardRatio` next door is the other thing: the one shape every card
 * is cropped to. A layout reads exactly one of the two, and which one it reads
 * is the whole of what separates the plans.
 *
 * `null` and not a guess, because the guess belongs to the layout rather than to
 * the row: a plan that draws uncropped answers for an unknown shape with the one
 * the uniform grid crops to, and a plan that crops never asks. CONTEXT.md is
 * what makes that the rule — a wallpaper whose Dimensions have not been read has
 * none rather than a guess (ADR 0044).
 *
 * Exported for its test, the way `rowHeight` above is: the arithmetic is
 * otherwise reachable only through a mounted grid whose every box measures zero.
 */
export function shapeOf(wallpaper: Wallpaper): number | null {
  const { width, height } = wallpaper;
  if (width === null || height === null || width <= 0) return null;
  return height / width;
}

/**
 * What a grid that is not drawing masonry hands the plan.
 *
 * One array for the life of the module, because it is a dependency of the memo
 * that builds the plan: a fresh `[]` per render would rebuild the whole plan on
 * every scroll notch.
 */
const NO_RATIOS: ReadonlyArray<number | null> = [];

/**
 * A layout that puts its own cards where they go, said as the two facts that go
 * with each other and never apart.
 *
 * One object rather than two props, because either alone is a layout that cannot
 * be drawn: cards out of the flow hold no scroll height open, and a scroll height
 * with no boxes under it is an empty page. Its presence is also what says which
 * of the two shapes the grid below is drawing, so there is one question to ask
 * rather than two that could disagree.
 *
 * The boxes are the plan's, so a card's size is the size the window was measured
 * against rather than one the browser worked out afterwards — the same exactness
 * the row heights have, for the same reason (ADR 0045).
 */
interface PlacedCards {
  /** Where each card goes, by its position in the whole list. */
  boxes: PlannedBox[];
  /** The whole scroll height those boxes occupy, both paddings included. */
  total: number;
}

/** The window over a list too long to mount (ADR 0016), and the way in to a card
 * that has no node yet.
 *
 * Thirty cards in the DOM out of five thousand fetched, because 5,000 images and
 * 5,000 overlays is a page that scrolls badly whatever the card is made of. It
 * counts rows and not cards, and the rows are the plan's: one virtual item is
 * one row of the plan, its height is that row's own rather than an estimate for
 * all of them, and the gap and the padding are told to the virtualiser rather
 * than folded into the heights, so the offsets it works over are the offsets the
 * CSS produces.
 *
 * Exact sizes and no measurement. A virtualiser given an estimate corrects it
 * when the row mounts and moves everything below by the difference, which is a
 * library that shifts under the curator's hand as they reach for a card. The
 * plan is computable before anything renders, so there is nothing to correct
 * (#261).
 *
 * Private, and called from `WindowedGrid` below. ADR 0027 exported it for
 * `LibraryView` to call, on the argument that every number behind it is this
 * module's own CSS; #231 applied that argument to the call site as well, because
 * the virtualiser's re-render notification belongs to whoever calls it and the
 * library page was the wrong tree to rebuild inside a wheel gesture. The hook
 * has no caller outside this file any more.
 *
 * `count` and not the list: the arithmetic needs the length and nothing else, so
 * the hook never holds the rows. The scroller arrives as a ref the host already
 * owns, because the page needs that same element for its own scroll position and
 * a hook that created it would have to hand it back (ADR 0015, ADR 0027).
 *
 * `columns` arrives too, rather than being read here. It was the viewport's
 * answer and nothing else until #264; it is now the viewport's answer offset by
 * the curator's zoom, and the one place that resolves the two is `useDensity`
 * above. A window that read the viewport for itself would go on cutting rows of
 * five while the cells drew eight.
 */
function useGridWindow(
  count: number,
  columns: number,
  scroller: RefObject<HTMLDivElement | null>,
  layout: LibraryLayout,
  ratios: ReadonlyArray<number | null>,
): {
  mounted: PlannedWindow;
  reveal: (index: number) => void;
  /** Where the cards go, for a layout that positions its own; absent for the grid. */
  placed?: PlacedCards;
} {
  // The scroll box as last measured, and the width the plan is computed
  // against. The last non-zero measurement is kept, so a view the shell has
  // hidden — which zeroes the box — keeps the size it had rather than rebuilding
  // its whole window on the way back (ADR 0015).
  const measured = useRef({ width: 0, height: 0 });
  const [boxWidth, setBoxWidth] = useState(0);
  // Where every card goes, before any of them has a node. Memoised on the facts
  // it is computed from, because it is what the virtualiser's options and the
  // cells are both read out of and a fresh one per render would rebuild both on
  // every scroll notch.
  const masonry = layout === "masonry";
  // A plan, and for the two layouts that position their own cards the boxes on
  // it. The union rather than `LayoutPlan` with an optional field, because a box
  // per card is what separates a layout that positions its own cards from one a
  // CSS grid places: a plan that carries the field and never fills it is a field
  // nothing checks (ADR 0045).
  const plan: LayoutPlan | MasonryPlan | JustifiedPlan = useMemo<
    LayoutPlan | MasonryPlan | JustifiedPlan
  >(() => {
    // The shape a wallpaper with no Dimensions is drawn at, and it is the grid's
    // own `aspect-video` rather than a number either layout invented: the
    // fallback is "draw it the way the app has always drawn it", so a library
    // mid-backfill reads as the layout the curator switched away from rather
    // than as a collapsed row.
    const unknownRatio = CARD_ASPECT.ratio;
    if (masonry) {
      return planMasonry({
        ...SPACING,
        ratios,
        columns,
        width: boxWidth,
        unknownRatio,
        unmeasuredHeight: UNMEASURED_ROW,
      });
    }
    if (layout === "justified") {
      return planJustified({
        ...SPACING,
        ratios,
        columns,
        width: boxWidth,
        // The uniform grid's own row height, as the height a justified row aims
        // for. That is what makes the density gesture mean one thing across the
        // layouts: the same zoom that puts four cards in a grid row puts about
        // four wallpapers in a justified one, because it is the same number of
        // the same width being asked for (#264).
        targetHeight: rowHeight(boxWidth, columns),
        unknownRatio,
      });
    }
    return planUniformGrid({
      ...SPACING,
      count,
      columns,
      rowHeight: rowHeight(boxWidth, columns),
    });
  }, [masonry, layout, ratios, count, columns, boxWidth]);

  const virtualiser = useVirtualizer({
    count: plan.rows.length,
    getScrollElement: () => scroller.current,
    // The row's own height, read out of the plan. Named `estimateSize` by the
    // library and exact here: nothing measures a mounted row and nothing
    // corrects this afterwards, which is what keeps a scroll from jumping.
    //
    // Indexed without a guard, unlike `windowOf` below, because the count on the
    // line above comes off the same plan in the same render: a row the
    // virtualiser asks about is a row the plan has. What it hands back is
    // memoised, which is the case `windowOf` clamps for.
    estimateSize: (row) => plan.rows[row].height,
    // One row above and one below. Two rows doubles the in-flight image
    // requests to buy a margin the memory cache already provides after the
    // first pass (ADR 0016).
    //
    // A masonry row is not a row of cards, so the same number would not be the
    // same margin: its rows are bands between consecutive card tops, and a card
    // height holds about as many of those as there are columns. So masonry
    // overscans by the column count, which buys it the one card of lead-in the
    // grid gets — inheriting the 1 unchanged would mount cards at the viewport
    // edge, and ADR 0041 puts the gesture's cost in card mount.
    overscan: masonry ? columns : 1,
    // The space between two rows, which masonry has already spent. Its rows are
    // bands running from one card top to the next, so the gaps between cards are
    // inside those heights and a gap between bands would be counted twice — the
    // virtualiser's offsets would then disagree with the boxes the same plan
    // computed.
    gap: masonry ? 0 : GAP.px,
    paddingStart: PADDING.px,
    paddingEnd: PADDING.px,
    // The measurement, with the fallback above under it. The virtualiser's own
    // observer does the observing — this wraps it rather than replacing it, so
    // the resize handling stays theirs — and what the wrapper adds is that a
    // rect of zero never reaches the window calculation, and that the width the
    // row height is derived from comes off the same measurement rather than a
    // second one taken somewhere else.
    observeElementRect: (instance, report) =>
      observeElementRect(instance, ({ width, height }) => {
        const box = {
          width: width || measured.current.width,
          height: height || measured.current.height,
        };
        measured.current = box;
        setBoxWidth(box.width);
        report({ width: box.width, height: box.height || UNMEASURED_BOX });
      }),
  });

  // A changed plan does not re-measure by itself: the virtualiser caches what it
  // measured and rebuilds when the row count changes, not when the function
  // behind the sizes starts answering differently. So the first real measurement
  // after a mount, and a resize that does not cross a breakpoint, say so here.
  useLayoutEffect(() => {
    virtualiser.measure();
  }, [virtualiser, plan]);

  const mountedRows = virtualiser.getVirtualItems();
  const firstRow = mountedRows[0];
  const lastRow = mountedRows[mountedRows.length - 1];
  // The mounted cards and the empty space that holds the rest of the scroll
  // height open above and below them — read off the plan, which is where the
  // rows and their offsets are. The virtualiser says which rows; the plan says
  // what is in them and where they sit, so a row that holds a different number
  // of cards than its neighbour, or a different height, needs nothing here.
  const mounted =
    firstRow && lastRow
      ? windowOf(plan, firstRow.index, lastRow.index)
      : NOTHING_MOUNTED;

  /**
   * Put the card the selection moved to on screen, which under a window means
   * mounting its row first.
   *
   * The grid calls this before it moves focus and never after, because a card
   * an arrow key selected may have no node yet and asking the virtualiser to
   * scroll the row in is what creates one. Focusing a node that does not exist
   * is the one way that pattern breaks (ADR 0019).
   *
   * Which row that is comes out of the plan rather than out of the column count,
   * because a card's row is a fact about the layout and not arithmetic a caller
   * can do for itself.
   */
  const reveal = useCallback(
    (index: number) => virtualiser.scrollToIndex(plan.rowOfCard[index] ?? 0),
    [virtualiser, plan],
  );

  return {
    mounted,
    reveal,
    placed:
      "boxes" in plan ? { boxes: plan.boxes, total: plan.total } : undefined,
  };
}

export interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /**
   * The grid's accessible name. A composite widget is one stop in the tab order,
   * so the name is all a screen reader gets on the way in (ADR 0019).
   */
  label: string;
  onAction: (action: CardAction, wallpaper: Wallpaper) => void;
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
   * `DENSITY` above.
   *
   * A name and not a pair of numbers. What the curator zoomed to is the grid's,
   * the way the cursor and the geometry are (ADR 0027, ADR 0042); the one thing
   * the grid cannot work out for itself is which page it was mounted on. So the
   * host says that and nothing else, and the bounds never leave this module —
   * which is also what makes the prop impossible to churn the identity of.
   */
  density: DensityTab;
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
  layout = "grid",
  ...props
}: WallpaperGridProps) {
  // The density is resolved here, above the branch, because both shapes need
  // the count and neither is the whole grid: the windowed one cuts its rows at
  // it one component down and the cells move the selection by it two. Holding
  // it here is also what makes the zoom survive a host swapping shapes, which
  // nothing does today and which the props say nothing to forbid.
  const { columns, step } = useDensity(density);
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
interface GridProps
  extends Omit<WallpaperGridProps, "scroller" | "density" | "layout"> {
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
  } = usePublishedSelection(wallpapers, focus, ref, startOn);
  const { wallpaper: selected, index, moveTo } = selection;

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

  /**
   * Ctrl and the wheel, changing the density rather than the page's scale.
   *
   * Listened for here rather than through React's `onWheel`, and that is the
   * whole reason this is an effect. React attaches its `wheel` listener to the
   * root as a passive one, so `preventDefault` from a synthetic handler is a
   * no-op and the webview zooms the app anyway — which is the gesture's own
   * default action and the one thing #264 says must not happen. A listener with
   * `passive: false` is the only way to refuse it.
   *
   * On the container and not the window, which is the line ADR 0019 draws for
   * the keys below and the same line here: the gesture is about these cards, and
   * a grid on a view the shell is only hiding must not answer a wheel over the
   * view in front of it.
   *
   * One step per event. A trackpad pinch sends a run of them and will cross the
   * range in a flick, which the range is what makes survivable: both ends are a
   * density that still renders, so the worst the gesture does is arrive.
   */
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      onDensityStep(event.deltaY < 0 ? 1 : -1);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [onDensityStep]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Every chord the shell answers is a `Ctrl` one and nothing here may eat
    // those; `Ctrl` and `+` is the webview's own zoom and not this grid's.
    const chord = event.ctrlKey || event.altKey || event.metaKey;

    // The density keys, ahead of the `Shift` half of the guard below rather than
    // behind it. `+` is `Shift` and `=` on most layouts, so a curator pressing
    // the key this gesture is named for arrives holding a modifier, and a guard
    // written for the app's chords would send them away.
    const by = DENSITY_KEYS[event.key];
    if (by !== undefined && !chord) {
      event.preventDefault();
      onDensityStep(by);
      return;
    }

    if (chord || event.shiftKey) return;
    const last = wallpapers.length - 1;
    if (index === -1 || !selected) return;

    // The direct keys, before the movement keys and on this container rather
    // than on `window`: they fire only while focus is inside the grid, which is
    // the dividing line ADR 0019 draws and the reason nothing here reaches Rank.
    // Global shortcuts live in the shell's handler; view-local keys live on the
    // element that owns the focus.
    //
    // A single keypress rejects, with no confirm and no modifier. ADR 0009
    // deleted the confirm dialog and put act-then-undo in its place, so the
    // safety is ADR 0017's toast and the `Ctrl+Z` that presses its Undo — and
    // focus stays here while that toast is up, so the next card is already
    // selected. It does mean a stray `Delete` on a focused grid moves a file,
    // which ADR 0019 wrote down as the cost rather than as an oversight.
    // The same entry a card's own buttons go through, so a key and a click take
    // one path — the origin-less refusal included, which the host's `perform`
    // holds once rather than once per trigger (ADR 0023).
    const action = actionFor(event.key, selected.status);
    if (action) {
      event.preventDefault();
      onAction(action, selected);
      return;
    }

    // `Enter` opens the lightbox on the selection the two surfaces share, and
    // it arrives at the same `onOpen` a click on the cell does: one host
    // handler for the gesture, so the key and the mouse cannot open different
    // things (ADR 0022, #138).
    //
    // Only from the cell itself. A cell's overlay buttons are still buttons and
    // `Enter` on a focused one activates it, so the keypress that keeps a
    // wallpaper bubbles through here on its way up — and answering it would be
    // a keep with the lightbox opening over the card it emptied, which is the
    // same two-answers-to-one-press the buttons' `stopPropagation` refuses for
    // the mouse.
    //
    // Nothing is prevented either way, deliberately: that activation is the
    // default action this handler would otherwise cancel, and a cell has no
    // default action of its own to suppress.
    if (event.key === "Enter") {
      if (event.target === focus.nodeAt(index)) onOpen?.(selected);
      return;
    }

    let next: number;
    switch (event.key) {
      // Left and Right walk the list rather than stopping at the visual row
      // edge. The rows are a wrapping of one sequence, and a sweep reads it as
      // one: stopping at the edge would mean the only way past card 4 of a
      // five-column grid is Down and then Home, four times a row.
      case "ArrowRight":
        next = Math.min(index + 1, last);
        break;
      case "ArrowLeft":
        next = Math.max(index - 1, 0);
        break;
      // Up and Down do move by the row, and do nothing when there is no card in
      // that column of the next row. Clamping to the last card instead would
      // make Down mean two different things depending on how full the last row
      // happens to be.
      //
      // The column count and not the plan, in every layout. Under masonry the
      // card that number lands on is usually the one below and is not obliged to
      // be, since a tall card makes its column take fewer of them — and reading
      // the plan here is the version where Down means one thing in the grid and
      // another in masonry. #255 asks for navigation that works identically in
      // every layout, and one rule over one list is what that is.
      case "ArrowDown":
        next = index + columns > last ? index : index + columns;
        break;
      case "ArrowUp":
        next = index - columns < 0 ? index : index - columns;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }

    // Answered here even when the selection does not move, and saying so is
    // load-bearing. Rank stays mounted under `display: none` with its vote
    // listener live on `window`, and it stands down on `defaultPrevented`: an
    // arrow that reached it from a focused grid would record a permanent
    // Comparison between two wallpapers the curator cannot see (ADR 0015 as
    // amended, ADR 0019).
    event.preventDefault();
    moveTo(next);
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
      // is what keeps every geometry number inside this file: `PADDING.px` is
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
          />
        );
      })}
    </div>
  );
}
