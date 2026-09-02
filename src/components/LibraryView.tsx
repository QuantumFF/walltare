import { PageBar } from "@/components/PageBar";
import { useGridColumns, WallpaperGrid } from "@/components/WallpaperGrid";
import { useApp } from "@/context/AppContext";
import { useAppEvent, useRefetchWhenShown } from "@/context/AppEventsContext";
import {
  client,
  type ListOrdering,
  type Status,
  type StatusFilter,
  type Wallpaper,
} from "@/lib/client";
// The words for a Status, from the file that holds the app's phrasings, so the
// empty state and the card's own pill spell them alike.
import { STATUS_LABEL } from "@/lib/copy";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { Images } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const LOAD_FAILED_ERROR = "Failed to load the library.";

/**
 * The grid's own spacing, as numbers, because the virtualiser has to know how
 * tall a row is before the row exists and the CSS is the only place that says.
 * `gap-6` between the cards, `p-4` around the grid, and an `aspect-video` card
 * (`WallpaperCard`).
 *
 * Three classes and three constants, and the duplication costs something when
 * it drifts: a window positioned against a row height nothing has puts the
 * wrong cards on screen. The alternative is measuring a card once it is laid
 * out and feeding the height back, which is what happy-dom rules out — it does
 * no layout, so the measurement is zero, the window collapses and the tests
 * that pin it have nothing to assert against (#131).
 */
const GRID_GAP = 24;
const GRID_PADDING = 16;
const CARD_ASPECT = 9 / 16;

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
 * and ADR 0015 keeps this view mounted under `display: none` while another view
 * is showing, which zeroes the box in a real browser too.
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
 */
function rowHeight(boxWidth: number, columns: number): number {
  const cards = boxWidth - 2 * GRID_PADDING - GRID_GAP * (columns - 1);
  if (cards <= 0) return UNMEASURED_ROW;
  return (cards / columns) * CARD_ASPECT;
}

/** The four filters, in the order the control offers them (ADR 0016). */
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "kept", label: "Kept" },
  { value: "rejected", label: "Rejected" },
];

/**
 * ADR 0014's four orderings, by name. The frontend picks a name and the backend
 * owns every part of the clause behind it, direction included, which is why
 * Score appears twice and there is no separate direction toggle.
 */
const ORDERINGS: Array<{ value: ListOrdering; label: string }> = [
  { value: "score_desc", label: "Score, high to low" },
  { value: "score_asc", label: "Score, low to high" },
  { value: "filename_asc", label: "Filename, A to Z" },
  { value: "recently_added", label: "Recently added" },
];

/** Whether a row still belongs in a list filtered this way. */
function matchesFilter(status: Status, filter: StatusFilter): boolean {
  return filter === "all" || filter === status;
}

/**
 * The library page: every matching row in one fetch (ADR 0016), drawn as the
 * shared card in the shared grid, inside the scroll container this view owns.
 *
 * What is still interim says so where it stands. The bar's two `<select>`s are
 * #130's to replace with the filter chips and the sort control, and #132 is what
 * answers the four actions a card can ask for.
 *
 * What this view owns underneath is the state the grid reads: the rows, the
 * filter, the ordering, the scroll position, the window of rows that has cards
 * in it, and the three events that keep the rows honest while the curator is
 * looking at something else.
 *
 * The empty state stays, in both of its readings. ADR 0015 disables no tab — a
 * disabled tab is a dead end that explains nothing — so every destination owes
 * a sentence saying why it is empty and where to go instead. #133 is what
 * separates the two readings into two screens.
 */
export function LibraryView() {
  const { view } = useApp();
  const showing = view === "library";

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [ordering, setOrdering] = useState<ListOrdering>("score_desc");
  // `null` until the first fetch lands, which is what separates an empty
  // library from one nobody has asked about yet.
  const [rows, setRows] = useState<Wallpaper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rows whose Score has moved since they were fetched. `score-changed` names
  // the two wallpapers in a Comparison and cannot name their new Scores, so
  // this is the whole of what the patch supports: the page knows those two
  // numbers are a Comparison out of date and does not know what they became.
  // Refetching every row because two Scores moved is the blunt shape ADR 0015
  // turned a query library down over.
  const [scoresMoved, setScoresMoved] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  // The same count the grid moves the selection by, read from the same table
  // rather than computed a second time: a virtualiser that disagreed with the
  // arrow keys about how many cards are in a row would scroll one row in and
  // focus a card in another (#131).
  const columns = useGridColumns();

  const scroller = useRef<HTMLDivElement | null>(null);
  // Where the curator was, for the lifetime of the run and no longer.
  //
  // Kept here rather than read off the element on the way out, because
  // `display: none` destroys the box: a hidden container reports a scroll
  // offset of zero, and by the time this view knows it is hidden the offset it
  // wanted to save is already gone. So it is recorded as the curator scrolls
  // and put back when the view is shown again (ADR 0015).
  const scrollTop = useRef(0);
  // The row set as last fetched, so a refetch can tell whether the rows moved.
  const fetchedIds = useRef("");

  const toTop = useCallback(() => {
    scrollTop.current = 0;
    if (scroller.current) scroller.current.scrollTop = 0;
  }, []);

  /**
   * One call, every matching row, no paging: the row count is the size of the
   * library and nothing asks a second question to find that out (ADR 0016).
   *
   * `resetScroll` is the reorder rule. A filter or an ordering change resets
   * position whether or not the same rows come back, because a position means
   * something different in a reordered list. A refetch the curator did not ask
   * for keeps their place unless the rows actually moved under it.
   */
  const fetchRows = useCallback(
    async (resetScroll: boolean) => {
      try {
        const list = await client.listWallpapers(filter, ordering);
        const ids = list.map((w) => w.id).join(",");
        const rowSetChanged = ids !== fetchedIds.current;
        fetchedIds.current = ids;

        setRows(list);
        // Every Score in the answer is current, so nothing is out of date any
        // more — including the two a vote moved before this fetch went out.
        setScoresMoved(new Set());
        setError(null);
        if (resetScroll || rowSetChanged) toTop();
      } catch (err) {
        console.error("Failed to list wallpapers:", err);
        setError(LOAD_FAILED_ERROR);
      }
    },
    [filter, ordering, toTop],
  );

  // The first fetch is this view's first mount, which the shell defers to the
  // curator's first visit, and every later one is a filter or an ordering they
  // changed — `fetchRows` is keyed on both.
  useEffect(() => {
    void fetchRows(true);
  }, [fetchRows]);

  const refetchAfterScan = useCallback(() => {
    void fetchRows(false);
  }, [fetchRows]);

  useRefetchWhenShown("library", refetchAfterScan);

  // The two patches, applied whether this view is showing or not, because
  // editing a row that is already rendered costs nothing: no query, no
  // thumbnail request, no fetch owed.
  useAppEvent((event) => {
    if (event.type === "status-changed") {
      setRows((prev) => {
        if (!prev?.some((w) => w.id === event.id)) return prev;
        // Edited in place, and dropped when the new Status falls outside the
        // filter — a row cannot stay in a list of Rejected wallpapers after a
        // Restore made it Active. Under the default filter of All nothing is
        // ever dropped: a Rejected card greys and says what it now is.
        return prev.flatMap((w) => {
          if (w.id !== event.id) return [w];
          if (!matchesFilter(event.status, filter)) return [];
          return [{ ...w, status: event.status }];
        });
      });
      return;
    }
    if (event.type === "score-changed") {
      setScoresMoved((prev) => {
        const next = new Set(prev);
        for (const id of event.ids) next.add(id);
        return next;
      });
    }
  });

  // Put the curator back where they were, before the frame paints, so the
  // restore is never a visible jump from the top of the list. The offset is
  // still what is restored under a virtualised grid: the window is a function of
  // the offset, so putting the scroller back where it was is what mounts the
  // rows the curator was looking at.
  useLayoutEffect(() => {
    if (!showing || !scroller.current) return;
    scroller.current.scrollTop = scrollTop.current;
  }, [showing]);

  const list = rows ?? [];
  // The scroll box as last measured, and the width the row height is derived
  // from. The last non-zero measurement is kept, so a view the shell has hidden
  // — which zeroes the box — keeps the size it had rather than rebuilding its
  // whole window on the way back (ADR 0015).
  const measured = useRef({ width: 0, height: 0 });
  const [boxWidth, setBoxWidth] = useState(0);
  const rowSize = rowHeight(boxWidth, columns);

  /**
   * The window of rows (ADR 0016). Thirty cards in the DOM out of five
   * thousand fetched, because 5,000 images and 5,000 overlays is a page that
   * scrolls badly whatever the card is made of.
   *
   * It counts rows and not cards, which is why `columns` above has to be the
   * grid's own count: one virtual item is one row of the CSS grid, and the gap
   * and the padding are the grid's, told to the virtualiser rather than folded
   * into the row height so the offsets it hands back are the offsets the CSS
   * produces.
   */
  const virtualiser = useVirtualizer({
    count: Math.ceil(list.length / columns),
    getScrollElement: () => scroller.current,
    estimateSize: () => rowSize,
    // One row above and one below. Two rows doubles the in-flight image
    // requests to buy a margin the memory cache already provides after the
    // first pass (ADR 0016).
    overscan: 1,
    gap: GRID_GAP,
    paddingStart: GRID_PADDING,
    paddingEnd: GRID_PADDING,
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
          end: Math.min((lastRow.index + 1) * columns, list.length),
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

  // #132 is what turns a press into `keep_wallpaper`, `unkeep_wallpaper`,
  // `move_wallpaper` or `restore_wallpaper`, with the optimistic patch and the
  // toast around each. Until then a card's buttons and the grid's direct keys
  // arrive here and are answered by nothing — except the one refusal that never
  // gets this far, since `useCardAction` raises the origin-less Restore's toast
  // itself (ADR 0009, ADR 0019).
  const handleAction = () => {};

  return (
    <>
      <PageBar>
        {/* #130 replaces both of these with the designed filter row and sort
            control. What they are here is the state behind them: the pair of
            choices that own a refetch and reset the scroll position. */}
        <select
          aria-label="Filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as StatusFilter)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {FILTERS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="Order by"
          value={ordering}
          onChange={(event) => setOrdering(event.target.value as ListOrdering)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {ORDERINGS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <span className="ml-auto text-xs text-muted-foreground">
          {rows === null
            ? "Loading…"
            : `${rows.length} ${rows.length === 1 ? "wallpaper" : "wallpapers"}`}
        </span>
      </PageBar>

      <h1 className="sr-only">Library</h1>

      {error && (
        <p className="px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* The scroll container the grid sits in, and the position the curator
          left it at is this page's to remember. It scrolls rather than the
          whole page so that the bar above stays put while the grid moves, and
          it is the element the virtualiser measures its window against. */}
      <div
        ref={scroller}
        data-slot="library-rows"
        onScroll={() => {
          scrollTop.current = scroller.current?.scrollTop ?? 0;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {rows !== null && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <Images className="h-10 w-10 text-muted-foreground/30" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "Nothing here yet. Point walltare at a folder in Settings and scan it."
                : `No ${STATUS_LABEL[filter].toLowerCase()} wallpapers. Try a different filter.`}
            </p>
          </div>
        ) : (
          /* The grid is the shared one, in the order the fetch returned its
             rows — the ordering is ADR 0014's and belongs to the backend, so
             nothing here sorts.

             No `animated`, and that is the decision rather than an omission.
             ADR 0016 gives this card no animated property and no `will-change`,
             because a wheel gesture over #131's virtualised grid mounts cards
             continuously — first paint and first hover become the same moment,
             which is the moment ADR 0007 was moving the cost away from. That
             ADR's licence stays scoped to Review's fifty rows, so `animated` is
             Review's alone.

             The name names the library and not the filter. A composite widget
             is one tab stop, so the name is all a screen reader gets on the way
             in (ADR 0019), and the filter is a control they can read for
             themselves — a name that moved with it would announce a different
             widget every time the same grid was narrowed.

             Every row goes in and a window of them comes out. The grid is what
             resolves the selection and moves it with the arrows, so it needs the
             list the curator is browsing rather than the slice of it that has
             nodes; `range` is the slice, and `reveal` is how a selection that
             lands outside it gets one (#131). */
          <WallpaperGrid
            wallpapers={list}
            label="Wallpapers in the library"
            onAction={handleAction}
            scoresMoved={scoresMoved}
            reveal={reveal}
            range={range}
            className="p-4"
          />
        )}
      </div>
    </>
  );
}
