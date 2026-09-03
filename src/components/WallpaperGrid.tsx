import {
  STATUS_ACTIONS,
  WallpaperCard,
  type CardAction,
} from "@/components/WallpaperCard";
import type { Status, Wallpaper } from "@/lib/client";
import { cn } from "@/lib/utils";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";

/**
 * The responsive column count, written once as the fact both halves read.
 *
 * The class and the number are the same statement — how many cards sit in a row
 * at this width — and two copies of it drift the moment someone adds a
 * breakpoint. Arrow keys that move by a stale count move the selection to a card
 * the curator is not looking at, and nothing on screen says why. So the table is
 * the source of both: the classes are joined into what the container wears, and
 * the widths are the queries the count is read from. The breakpoints are
 * Tailwind's own `md`, `lg` and `xl`, which is what makes the two agree.
 *
 * The class strings are spelled out rather than built from `columns`, because
 * Tailwind generates a utility only when it finds the literal in the source.
 */
const COLUMNS = [
  { minWidth: 0, columns: 2, className: "grid-cols-2" },
  { minWidth: 768, columns: 3, className: "md:grid-cols-3" },
  { minWidth: 1024, columns: 4, className: "lg:grid-cols-4" },
  { minWidth: 1280, columns: 5, className: "xl:grid-cols-5" },
] as const;

/** What the grid container wears, and the other half of the table above. */
const GRID_COLUMN_CLASSES = COLUMNS.map((step) => step.className).join(" ");

/** The widest breakpoint the window has reached, as a number of cards. */
function columnsNow(): number {
  let columns: number = COLUMNS[0].columns;
  for (const step of COLUMNS) {
    if (
      step.minWidth === 0 ||
      window.matchMedia(`(min-width: ${step.minWidth}px)`).matches
    ) {
      columns = step.columns;
    }
  }
  return columns;
}

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
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
 * `resize` is the one subscription. happy-dom fires it from `setViewport` and a
 * real window fires it on every viewport change, while a `MediaQueryList`
 * `change` listener would need one subscription per breakpoint and is not fired
 * by happy-dom at all.
 */
function useGridColumns(): number {
  return useSyncExternalStore(subscribeToWidth, columnsNow);
}

/**
 * The grid's own spacing, as numbers beside the classes they restate, because
 * `useGridWindow` below has to know how tall a row is before the row exists and
 * the CSS is the only place that says.
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
 * for: nothing in the app calls this from outside the hook below, and the
 * arithmetic is otherwise reachable only through a mounted page whose box
 * measures zero (ADR 0027).
 */
export function rowHeight(boxWidth: number, columns: number): number {
  const cards = boxWidth - 2 * PADDING.px - GAP.px * (columns - 1);
  if (cards <= 0) return UNMEASURED_ROW;
  return (cards / columns) * CARD_ASPECT.ratio;
}

/**
 * The direct keys, as the actions each one names.
 *
 * `K` names two, because the keep slot has two ends: keeping an Active
 * wallpaper and making a Kept one Active again. One finger, one meaning — "the
 * keep decision" — and the card's Status picks which end of it applies, so `K`
 * is never a keep on one card and something unrelated on the card beside it.
 *
 * `Delete` rather than a letter for reject is what keeps `R` unambiguous. A
 * Rejected card offers only Restore and a non-Rejected card only Reject, so one
 * `R` for both is technically unambiguous and would still be the same finger
 * producing opposite outcomes on cards sitting next to each other in a mixed
 * grid. `Delete` also carries the right shape for the one action here that moves
 * a file (ADR 0019).
 */
const KEY_ACTIONS: Record<string, readonly CardAction[]> = {
  k: ["keep", "make-active"],
  delete: ["reject"],
  r: ["restore"],
};

/**
 * How each key is written on the control that fires it: `Keep K`, `Reject Del`,
 * `Restore R`, and `Make Active K` for the other end of the keep slot (#140).
 *
 * `Del` is the one abbreviation, because the key's own name is wider than the
 * verb in front of it on a row that has a floor to fit inside, and because it
 * is what the key is printed as on the keyboard the curator is looking at.
 */
const KEY_NAMES: Record<string, string> = { k: "K", delete: "Del", r: "R" };

/**
 * The key that fires an action, spelled as the control firing it prints it.
 *
 * Read out of the table above rather than written a second time beside the
 * labels, so a rebinding takes the print with it: a button carrying a key that
 * no longer works is worse than a button carrying no key at all, and #140 puts
 * the key on the button precisely because that is the copy that survives the
 * row narrowing. Every action is bound, so the empty string is what a future
 * unbound one would print rather than a case the app reaches.
 */
export function printedKey(action: CardAction): string {
  const bound = Object.entries(KEY_ACTIONS).find(([, actions]) =>
    actions.includes(action),
  );
  return bound ? KEY_NAMES[bound[0]] : "";
}

/**
 * What a key means on a wallpaper of this Status, or `null` for nothing at all.
 *
 * The answer is an intersection rather than a second table: the key names
 * candidates, and `STATUS_ACTIONS` — the same table the card's buttons render
 * from — says which of them this row actually offers. So a key the Status has no
 * action for does nothing, which is what makes a wrong key a wrong key rather
 * than a wrong action, and what keeps the keyboard from ever asking for a
 * transition CONTEXT.md calls an error.
 *
 * The key is lowercased so that a curator with Caps Lock on still keeps and
 * still restores.
 *
 * Exported because #140's lightbox answers the same three keys on the wallpaper
 * it is showing. It resolves them here rather than carrying its own copy, which
 * is the same reason its buttons render from `STATUS_ACTIONS` and its presses
 * reach the host's own `perform`: one action vocabulary in the app, and no
 * surface that can offer a curator one set with the mouse and another with the
 * keyboard (ADR 0022).
 */
export function actionFor(key: string, status: Status): CardAction | null {
  const offered = STATUS_ACTIONS[status];
  const candidates = KEY_ACTIONS[key.toLowerCase()] ?? [];
  return candidates.find((action) => offered.includes(action)) ?? null;
}

/**
 * The grid's selection, held by the page that mounts the grid.
 *
 * It lives up there because ADR 0022 has the lightbox render this same
 * selection rather than a cursor of its own, and the lightbox's state is the
 * page's. From here the page can read which wallpaper is up and where it sits
 * in the list, step it, and put it back on the wallpaper a failed action
 * re-inserted. A selection private to the grid answers none of those, and a
 * second cursor beside it would need a sync rule in both directions plus an
 * answer for a refetch landing between them (#137).
 *
 * Five members and not seven. Where the focus is used to be two of them, and it
 * is the grid's own — `WallpaperGridHandle` below is what a page asks through
 * now (ADR 0029).
 */
export interface GridSelection {
  /** The selected Wallpaper, or `null` when the list is empty. */
  wallpaper: Wallpaper | null;
  /**
   * Where it sits in the whole list, and `-1` when nothing is selected. The
   * whole list and not the window a virtualising host mounted, which is what
   * lets the lightbox's position line read `3 / 50` (ADR 0016, ADR 0022).
   */
  index: number;
  /**
   * How long that list is, which is the other half of `3 / 50`.
   *
   * Carried here rather than left to the page to hand over beside the
   * selection, because it is the same list: a page reading `wallpapers.length`
   * for the lightbox could pass a count that the selection was never resolved
   * against, and the position line is the one place that disagreement would be
   * legible — as a `51 / 50`. #139's arrow buttons read it for the same reason,
   * since being at the end of the list is what makes them unavailable.
   */
  length: number;
  /**
   * Select the wallpaper at an index in the whole list, with out of range
   * clamped into it: the arrow arithmetic sits on both sides of this seam — the
   * grid moves by column and by row, the lightbox by one — and neither can
   * select a wallpaper that is not there.
   */
  moveTo: (index: number) => void;
  /**
   * Select a wallpaper by id, whether or not the list holds it yet. Review's
   * failure handler is the caller: it re-inserts the card it removed
   * optimistically, by which time the selection has already moved on to the
   * next wallpaper (ADR 0022).
   */
  selectId: (id: number) => void;
}

/**
 * The one thing the grid can be asked to do from outside it.
 *
 * A handle rather than a pair on `GridSelection`, because where the focus is
 * belongs to the grid: it already holds what the last commit focused and whether
 * the curator is inside, and a request the page held too made "does the
 * selection have focus" a question with four answers across a seam (ADR 0029).
 *
 * There is no reader for the fact. Nothing outside asks whether the selection
 * has focus, because the only use for the answer is deciding whether to move it,
 * and that is what the method below is for. The DOM carries it twice anyway —
 * `document.activeElement` is the cell, and that cell is the one at
 * `tabindex="0"`.
 */
export interface WallpaperGridHandle {
  /** Put the selected card on screen and focus it, revealing its row first. */
  focusSelection: () => void;
}

/**
 * The selection rule, in the one place both sides of the seam read it from:
 * track the wallpaper by id, fall back to the same position clamped to the new
 * length when that id is gone from the list, and fall back to nothing at all
 * when the list empties (ADR 0019).
 *
 * Resolved from the list on every render rather than stored as an index,
 * because the list is what moves: a vote reorders it, a filter change replaces
 * it, and an action removes a row from it. Index-only is simpler and wrong in
 * the case that matters — a curator who switches filter or ordering mid-sweep
 * would find the selection on whatever now occupies that slot.
 *
 * The id is kept even when it resolves to nothing, which is what brings the
 * selection back when a failed action re-inserts the card it removed
 * optimistically (ADR 0022).
 */
export function useGridSelection(wallpapers: Wallpaper[]): GridSelection {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Where the selection was, for the fall back below. Also the initial stop:
  // with nothing selected yet the first card holds the tab stop, because a grid
  // where every cell is `tabindex="-1"` cannot be entered by keyboard at all.
  const positionRef = useRef(0);

  let index = wallpapers.findIndex((w) => w.id === selectedId);
  if (index === -1 && wallpapers.length > 0) {
    index = Math.min(positionRef.current, wallpapers.length - 1);
  }
  if (wallpapers.length === 0) index = -1;
  const wallpaper = index === -1 ? null : wallpapers[index];
  if (index !== -1) positionRef.current = index;

  const moveTo = useCallback(
    (to: number) => {
      if (wallpapers.length === 0) return;
      const at = Math.max(0, Math.min(to, wallpapers.length - 1));
      positionRef.current = at;
      setSelectedId(wallpapers[at].id);
    },
    [wallpapers],
  );

  const selectId = useCallback((id: number) => setSelectedId(id), []);

  return { wallpaper, index, length: wallpapers.length, moveTo, selectId };
}

/**
 * The slice of the list a virtualising host wants mounted, and the empty space
 * that holds the rest of the scroll height open around it.
 *
 * The grid still receives every wallpaper. It is what resolves the selection,
 * moves it with the arrows and hands each card an index in the whole list, and
 * all of that has to keep working for a wallpaper that has no DOM node at all —
 * so what a range changes is only which cards are rendered (ADR 0016, #131).
 *
 * `start` is inclusive and `end` exclusive, the way `slice` reads them.
 * `before` and `after` are pixels, and they arrive as padding on the container
 * rather than as spacer elements above and below it: the container is a CSS
 * grid, and a spacer inside one is a cell that takes a column.
 */
export interface GridRange {
  start: number;
  end: number;
  before: number;
  after: number;
}

/**
 * The window over a list too long to mount (ADR 0016), and the way in to a card
 * that has no node yet.
 *
 * Thirty cards in the DOM out of five thousand fetched, because 5,000 images and
 * 5,000 overlays is a page that scrolls badly whatever the card is made of. It
 * counts rows and not cards, and the count it divides by is the grid's own:
 * one virtual item is one row of the CSS grid, and the gap and the padding above
 * are told to the virtualiser rather than folded into the row height, so the
 * offsets it hands back are the offsets the CSS produces.
 *
 * It lives here rather than on the page because every number behind it is this
 * module's own CSS. A host that computed its own window would import three
 * constants to work out one, which is the shallow shape ADR 0027 set out to fix
 * — and after this no geometry leaves the file.
 *
 * `count` and not the list: the arithmetic needs the length and nothing else, so
 * the hook never holds the rows. The scroller arrives as a ref the host already
 * owns, because the page needs that same element for its own scroll position and
 * a hook that created it would have to hand it back.
 */
export function useGridWindow(
  count: number,
  scroller: RefObject<HTMLDivElement | null>,
): { range: GridRange; reveal: (index: number) => void } {
  const columns = useGridColumns();
  // The scroll box as last measured, and the width the row height is derived
  // from. The last non-zero measurement is kept, so a view the shell has hidden
  // — which zeroes the box — keeps the size it had rather than rebuilding its
  // whole window on the way back (ADR 0015).
  const measured = useRef({ width: 0, height: 0 });
  const [boxWidth, setBoxWidth] = useState(0);
  const rowSize = rowHeight(boxWidth, columns);

  const virtualiser = useVirtualizer({
    count: Math.ceil(count / columns),
    getScrollElement: () => scroller.current,
    estimateSize: () => rowSize,
    // One row above and one below. Two rows doubles the in-flight image
    // requests to buy a margin the memory cache already provides after the
    // first pass (ADR 0016).
    overscan: 1,
    gap: GAP.px,
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

  // A changed estimate does not re-measure by itself: the virtualiser caches
  // what it measured and rebuilds when the row count changes, not when the
  // function behind the estimate starts answering differently. So the first
  // real measurement after a mount, and a resize that does not cross a
  // breakpoint, say so here.
  useLayoutEffect(() => {
    virtualiser.measure();
  }, [virtualiser, rowSize]);

  const mountedRows = virtualiser.getVirtualItems();
  const firstRow = mountedRows[0];
  const lastRow = mountedRows[mountedRows.length - 1];
  // The mounted range, as indexes into the whole list, and the empty space that
  // holds the rest of the scroll height open above and below it.
  const range =
    firstRow && lastRow
      ? {
          start: firstRow.index * columns,
          end: Math.min((lastRow.index + 1) * columns, count),
          before: firstRow.start,
          after: virtualiser.getTotalSize() - lastRow.end,
        }
      : { start: 0, end: 0, before: 0, after: 0 };

  /**
   * Put the card the selection moved to on screen, which under a window means
   * mounting its row first.
   *
   * The grid calls this before it moves focus and never after, because a card
   * an arrow key selected may have no node yet and asking the virtualiser to
   * scroll the row in is what creates one. Focusing a node that does not exist
   * is the one way that pattern breaks (ADR 0019).
   */
  const reveal = useCallback(
    (index: number) => virtualiser.scrollToIndex(Math.floor(index / columns)),
    [virtualiser, columns],
  );

  return { range, reveal };
}

export interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /**
   * The selection, from the page's own `useGridSelection` over this same list.
   *
   * Required, and there is no fallback to a selection of the grid's own: the
   * rule has one home, and a grid that could resolve its own would be the
   * second copy of it the moment a page held one too (#137).
   */
  selection: GridSelection;
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
   * Put the card at `index` on screen. The seam #79 hands its virtualiser to.
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
   * #79 passes `(index) => virtualiser.scrollToIndex(Math.floor(index /
   * columns))`, reading `columns` from `useGridColumns` above — the same count
   * this grid moves the selection by.
   *
   * The default scrolls the selected cell into view, which is the whole of what
   * a grid that mounts every row needs.
   */
  reveal?: (index: number) => void;
  /**
   * Which of the cards to mount. See `GridRange`.
   *
   * Every row is mounted without one, which is what Review wants at fifty and
   * what a grid outside a scroll container has no way to improve on.
   */
  range?: GridRange;
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
   * The handle, for the page that has to hand focus back: a
   * `useRef<WallpaperGridHandle | null>(null)` it also passes to `useLightbox`.
   *
   * React 19 takes `ref` as an ordinary prop on a function component, so there
   * is no `forwardRef` in the way. A ref and not a callback the page wraps,
   * because a callback's identity changes every render and `close`'s
   * `useCallback` deps would churn on it (ADR 0029).
   */
  ref?: Ref<WallpaperGridHandle>;
}

/**
 * The grid, shared by Review and by the library page (#79).
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
export function WallpaperGrid({
  wallpapers,
  selection,
  label,
  onAction,
  animated = false,
  scoresMoved,
  reveal,
  range,
  onOpen,
  className,
  ref,
}: WallpaperGridProps) {
  const columns = useGridColumns();
  const gridRef = useRef<HTMLDivElement>(null);
  // The selection follows the wallpaper, then the position, and the rule that
  // says so is the page's `useGridSelection` over this same list (ADR 0019).
  // What is left here is the focus bookkeeping below, which is the grid's own
  // business: nothing above this component knows which node holds the focus or
  // whether a row has been mounted yet.
  const { wallpaper: selected, index, moveTo } = selection;
  // What the last commit put focus on, so a re-render that changes nothing does
  // not re-focus and re-scroll.
  const focusedRef = useRef<number | null>(null);
  const holdsFocusRef = useRef(false);
  // Whether the page has asked for the selected card back. It stays set until a
  // card has actually taken the focus — a reveal that has not mounted the row
  // yet leaves it outstanding for the commit that follows.
  //
  // A flag and not the counter this was while the page held it: two requests in
  // a row want the same card focused, and once the asking and the answering are
  // in one component a flag that is already set is already asking for it
  // (ADR 0029).
  const wantsFocusRef = useRef(false);
  // The commit the flag is answered on. Setting a ref renders nothing, and the
  // effect that reads it runs on a render — so the ask schedules one. Its value
  // is never read, which is what keeps it a nudge rather than a second counter.
  const [, askedForFocus] = useReducer((asks: number) => asks + 1, 0);

  useImperativeHandle(ref, () => ({
    focusSelection: () => {
      wantsFocusRef.current = true;
      askedForFocus();
    },
  }));

  // What this commit puts in the DOM, which is every row until a host says
  // otherwise. Nothing above this line reads it: the selection, the arrow keys
  // and the fall back are about the list, and a card the window left out is a
  // card with no node rather than a wallpaper that stopped existing.
  const from = range ? range.start : 0;
  const mounted = range ? wallpapers.slice(range.start, range.end) : wallpapers;

  const cellAt = (at: number) =>
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${at}"]`) ?? null;

  // Focus moves here, in a layout effect after the row commits, and never inside
  // the key handler. See `reveal` above for why.
  //
  // No dependency array: the retry after `reveal` mounts a row is the commit
  // that follows, and nothing in this component's props changes to announce it.
  // `focusedRef` is what makes that cheap — every commit that moves nothing
  // returns on the first comparison.
  useLayoutEffect(() => {
    const target = selected ? selected.id : null;
    // Whether the page has asked for the selected card back, which is the one
    // route in from outside the grid. Closing the lightbox is the caller, and it
    // needs the override below because the card it has to land on is the one for
    // the current selection, which after two hundred steps is neither where
    // focus is nor a card that has a node (ADR 0022).
    const requested = wantsFocusRef.current;

    // Moving the selection must not steal focus. When the curator is somewhere
    // else in the app, a list that changes underneath updates the selection and
    // the tab stop that goes with it, and leaves focus where they put it.
    if (!holdsFocusRef.current && !requested) {
      focusedRef.current = target;
      return;
    }

    // Nothing to do when the same wallpaper is selected and its cell still has
    // the focus. The second half of that is not redundant: React reorders a
    // list by moving DOM nodes, and moving a focused node is a removal and an
    // insertion as far as the engine is concerned, so a reorder that keeps the
    // selected wallpaper can still drop focus to `body`. Re-homing it is what
    // makes "the selection follows the wallpaper" survive a vote landing under
    // the curator's hands. A request that arrives while that card already holds
    // the focus is answered by that fact and nothing moves.
    const active = document.activeElement;
    const holds = active instanceof Node && gridRef.current?.contains(active);
    if (target === focusedRef.current && holds) {
      wantsFocusRef.current = false;
      return;
    }

    // The list emptied under a selection that had focus, so the container takes
    // it: the alternative is focus on `body`, where the next Tab starts from the
    // top of the document rather than from the page the curator is on.
    if (target === null || index === -1) {
      gridRef.current?.focus();
      focusedRef.current = null;
      wantsFocusRef.current = false;
      return;
    }

    if (reveal) reveal(index);
    else cellAt(index)?.scrollIntoView({ block: "nearest" });

    const cell = cellAt(index);
    if (!cell) return;
    focusedRef.current = target;
    wantsFocusRef.current = false;
    cell.focus();
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
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
      if (event.target === cellAt(index)) onOpen?.(selected);
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

  const handleFocus = () => {
    holdsFocusRef.current = true;
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && gridRef.current?.contains(next)) return;
    // Focus that goes nowhere is the focused card being unmounted, not the
    // curator leaving — a keep removes the row under their hands, and the effect
    // above is what re-homes them. Engines disagree about whether removing the
    // focused node fires this at all, so the state it leaves has to be the same
    // either way: the node is still in the document when they left of their own
    // accord, and gone when the list took it.
    if (next === null && event.target instanceof HTMLElement) {
      if (!event.target.isConnected) return;
    }
    holdsFocusRef.current = false;
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
      // one pair. Review passes no `range` and its own `pb-8` reaches this same
      // element (ADR 0027).
      className={cn(
        "grid",
        GAP.className,
        range && PADDING.className,
        GRID_COLUMN_CLASSES,
        className,
      )}
      // The window's position inside the scroller, and the reason the class
      // above can still carry a `p-4`: an inline `padding-top` replaces only the
      // top of that shorthand, so the host's horizontal padding survives being
      // told where the mounted range sits.
      style={
        range
          ? { paddingTop: range.before, paddingBottom: range.after }
          : undefined
      }
    >
      {/*
        `cell.index` is the index in the whole list and not in what is mounted,
        which is what lets the library page render a window of these cards
        without the selection or the arrow keys knowing (#131).
      */}
      {mounted.map((wallpaper, offset) => {
        const cardIndex = from + offset;
        return (
          <WallpaperCard
            key={wallpaper.id}
            wallpaper={wallpaper}
            onAction={onAction}
            animated={animated}
            scoreMoved={scoresMoved?.has(wallpaper.id)}
            onOpen={onOpen}
            cell={{ index: cardIndex, selected: cardIndex === index }}
          />
        );
      })}
    </div>
  );
}
