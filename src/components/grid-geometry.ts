import { useHeldDensity, type HeldDensity } from "@/components/density";
import type { LibraryLayout } from "@/lib/client";
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
  type PlanSpacing,
} from "@/lib/layout-plan";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
 * here is a count the CSS cannot draw, so the bounds below stay inside one and
 * ten, and this table is where a wider tab would have to start.
 */
export const COLUMN_CLASSES: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
  10: "grid-cols-10",
};

/** The two tabs that mount this grid, which is what their bounds are named by. */
export type DensityTab = "library" | "review";

/**
 * How far the density goes on each tab, and the most columns it starts on.
 *
 * #254's prototype, which is what the curator agreed on: Library runs from two
 * to ten and starts on five, Review from one to six and starts on four. Library
 * is the browse surface, going "from a few large wallpapers to many small ones"
 * over a library of up to five thousand. Review is fifty wallpapers the curator
 * is deciding about, so it goes down to one wallpaper across and starts larger.
 *
 * `start` caps the viewport's own count rather than replacing it, so a narrow
 * window still starts on the two or three that fit. Library's five is the widest
 * breakpoint's count already, so it changes nothing there.
 *
 * Library's far end has a cost Review's does not: more columns is shorter rows,
 * and shorter rows is more cards inside the same window, which is the mount rate
 * ADR 0041 measured the grid's frame time against. Ten is past the eight it was
 * measured at, and nobody has measured it.
 *
 * The numbers are the grid's, and they stay here. A host names which tab it is
 * and the grid looks the bounds up, rather than the two pairs being exported for
 * a page to import and hand straight back — which would widen this module's
 * interface by two names without deepening anything, the shape ADR 0027 refused
 * for the geometry constants.
 */
const DENSITY: Record<DensityTab, DensityRange & { start: number }> = {
  library: { min: 2, max: 10, start: 5 },
  review: { min: 1, max: 6, start: 4 },
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
export function useDensity(
  tab: DensityTab,
  held: HeldDensity | undefined,
): {
  columns: number;
  step: (by: number) => void;
} {
  const range = DENSITY[tab];
  const base = Math.min(useGridColumns(), range.start);
  const [zoom, setZoom] = useHeldDensity(held, 0);
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
 * two are worn by the grid's container in `WallpaperGrid.tsx` (ADR 0027).
 */
export const GAP = { px: 24, className: "gap-6" };
const CARD_ASPECT = { ratio: 9 / 16, className: "aspect-video" };
export const PADDING = { px: 16, className: "p-4" };

/**
 * The gutter between wallpapers in the two layouts that draw each one at its own
 * shape: 4px, which is what #254's prototype put between them and what the
 * verdict picked.
 *
 * Its own number rather than `GAP`, because the uniform grid kept its spacing
 * and these two are a wall rather than a page of cards. With no border and no
 * rounding on the card either, the pictures are what the eye reads as the edges.
 * No class beside it, because both layouts place every card themselves and
 * nothing in the CSS wears it.
 */
const WALL_GAP = { px: 4 };

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
const SPACING: PlanSpacing = { gap: GAP.px, padding: PADDING.px };
const WALL_SPACING: PlanSpacing = { gap: WALL_GAP.px, padding: PADDING.px };

/**
 * Which spacing each layout is planned against: the uniform grid's own, or the
 * wall's 4px gutter for the two that draw each wallpaper at its own shape. One
 * table, so the plan and the virtualiser read the same answer rather than each
 * branching on the layout for it.
 */
const LAYOUT_SPACING: Record<LibraryLayout, PlanSpacing> = {
  grid: SPACING,
  masonry: WALL_SPACING,
  justified: WALL_SPACING,
};

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
 * Without that seam the arithmetic would be reachable only through a mounted
 * page whose box measures zero (ADR 0027).
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
export function rowHeight(
  boxWidth: number,
  columns: number,
  spacing: PlanSpacing = SPACING,
): number {
  return uniformRowHeight({
    ...spacing,
    columns,
    width: boxWidth,
    cardRatio: CARD_ASPECT.ratio,
    unmeasuredHeight: UNMEASURED_ROW,
  });
}

/**
 * What a grid that is not drawing masonry hands the plan.
 *
 * One array for the life of the module, because it is a dependency of the memo
 * that builds the plan: a fresh `[]` per render would rebuild the whole plan on
 * every scroll notch.
 */
export const NO_RATIOS: ReadonlyArray<number | null> = [];

/**
 * A layout that puts its own cards where they go, said as the two facts that go
 * with each other and never apart.
 *
 * One object rather than two props, because either alone is a layout that cannot
 * be drawn: cards out of the flow hold no scroll height open, and a scroll height
 * with no boxes under it is an empty page. Its presence is also what says which
 * of the two shapes the grid is drawing, so there is one question to ask
 * rather than two that could disagree.
 *
 * The boxes are the plan's, so a card's size is the size the window was measured
 * against rather than one the browser worked out afterwards — the same exactness
 * the row heights have, for the same reason (ADR 0045).
 */
export interface PlacedCards {
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
 * Called from `WindowedGrid` in `WallpaperGrid.tsx` and nowhere else. ADR 0027 exported it for
 * `LibraryView` to call, on the argument that every number behind it is this
 * module's own CSS; #231 applied that argument to the call site as well, because
 * the virtualiser's re-render notification belongs to whoever calls it and the
 * library page was the wrong tree to rebuild inside a wheel gesture. The hook
 * has no caller outside the grid any more.
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
export function useGridWindow(
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
    const spacing = LAYOUT_SPACING[layout];
    if (masonry) {
      return planMasonry({
        ...spacing,
        ratios,
        columns,
        width: boxWidth,
        unknownRatio,
        unmeasuredHeight: UNMEASURED_ROW,
      });
    }
    if (layout === "justified") {
      return planJustified({
        ...spacing,
        ratios,
        columns,
        width: boxWidth,
        // The height of a row of `columns` 16:9 cards across this width, as the
        // height a justified row aims for. That is what makes the density
        // gesture mean one thing across the layouts: the same zoom that puts four
        // cards in a grid row puts about four wallpapers in a justified one,
        // because it is the same number of the same width being asked for
        // (#264). Worked out against the wall's own gutter rather than the
        // grid's, so four is four across the width this layout actually has.
        targetHeight: rowHeight(boxWidth, columns, spacing),
        unknownRatio,
      });
    }
    return planUniformGrid({
      ...spacing,
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
    gap: masonry ? 0 : LAYOUT_SPACING[layout].gap,
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
