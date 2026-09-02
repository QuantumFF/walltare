import { PageBar } from "@/components/PageBar";
import { useRejectDestination } from "@/components/RejectDestination";
import { useToaster } from "@/components/ToastSurface";
import type { CardAction } from "@/components/WallpaperCard";
import { useGridColumns, WallpaperGrid } from "@/components/WallpaperGrid";
import { useApp } from "@/context/AppContext";
import {
  useAppEvent,
  useAppEvents,
  useRefetchWhenShown,
} from "@/context/AppEventsContext";
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

/**
 * What a failed transition is logged as, per action.
 *
 * The console line names the command, which is the one thing the toast beside it
 * does not: that carries the wallpaper and the backend's own sentence, and all
 * four of these arrive at the curator through the same `failed` row.
 */
const FAILURE_LOG: Record<CardAction, string> = {
  keep: "Failed to keep wallpaper:",
  "make-active": "Failed to unkeep wallpaper:",
  reject: "Failed to move wallpaper:",
  restore: "Failed to restore wallpaper:",
};

/** Whether a row still belongs in a list filtered this way. */
function matchesFilter(status: Status, filter: StatusFilter): boolean {
  return filter === "all" || filter === status;
}

/**
 * The library page: every matching row in one fetch (ADR 0016), drawn as the
 * shared card in the shared grid, inside the scroll container this view owns.
 *
 * What is still interim says so where it stands. The bar's two `<select>`s are
 * #130's to replace with the filter chips, the sort control and the line saying
 * where rejects go.
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

  const { publish } = useAppEvents();
  // Every transition this page makes reports itself on the shell's one slot, and
  // this view holds no error state of its own: two error surfaces in one view is
  // what ADR 0017 removed, and the backend's own message says more than a string
  // written here would.
  const { show } = useToaster();
  // Where a reject goes, read once for the two things that must agree about it:
  // the string `move_wallpaper` is handed, and the boolean the toast reads to
  // decide whether it has a path left to name. One object rather than a value
  // each of them resolves for itself, because `$HOME/bin` looks relative and is
  // not, so a second `expand_path` call is a second verdict (ADR 0018). The
  // read-out of it on the bar is #130's to add.
  const destination = useRejectDestination();

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

  /**
   * The four transitions a card can ask for: one call, one published patch, one
   * toast (#132).
   *
   * **Nothing here is optimistic**, and that is the difference from Review. That
   * page removes the card on the click and puts it back when the write fails,
   * because a kept wallpaper leaves its list either way. This page keeps every
   * row it fetched, so there is no removal to undo: the published patch is the
   * only thing that edits a row, the subscriber above is what applies it, and a
   * call that never lands leaves the card exactly where the curator left it.
   *
   * The patch is published **after** the write for the same reason. Publishing
   * ahead of it would grey a row that never changed, and the failure would be
   * the one thing the page did not hear about.
   *
   * Every one of them toasts, success and failure alike. The row does update in
   * place under the cursor, but a virtualised grid may reorder it or filter it
   * out from under the click, and a card that vanishes is not a confirmation
   * (ADR 0016, ADR 0017).
   *
   * The origin-less Restore never arrives here. `useCardAction` refuses it with
   * a pinned toast and makes no call, from the button and from `R` alike, so
   * that refusal is a property of the action rather than of this host
   * (ADR 0009, ADR 0019).
   */
  const act = async (action: CardAction, card: Wallpaper) => {
    const { id, filename } = card;
    try {
      switch (action) {
        case "keep":
          await client.keepWallpaper(id);
          publish({ type: "status-changed", id, status: "kept" });
          show({ kind: "kept", view: "library", id, filename });
          break;

        case "make-active":
          // The keep inverse: one column write with nothing on disk to move,
          // which is why it is `unkeep_wallpaper` and not a Restore. It carries
          // no path and offers no Undo, since Keep is the button that replaces
          // it on the card it just changed (ADR 0009, ADR 0017).
          await client.unkeepWallpaper(id);
          publish({ type: "status-changed", id, status: "active" });
          show({ kind: "made-active", filename });
          break;

        case "reject": {
          // The path the file landed at is read now: `unique_destination`
          // suffixes ` (n)` on a collision rather than overwriting what is
          // already there, so this is the only account of what the file is
          // called on the far side (ADR 0003).
          const finalPath = await client.moveWallpaper(id, destination.written);
          publish({ type: "status-changed", id, status: "rejected" });
          show({
            kind: "rejected",
            view: "library",
            id,
            filename,
            // The same read-out the call was handed, so the destination the
            // toast describes and the one the file went to are one answer.
            relativeDestination: destination.relative,
            finalPath,
          });
          break;
        }

        case "restore": {
          // A Restore lands on Active whichever Status the wallpaper held before
          // the reject, because Kept is a judgement about a rating and changing
          // your mind about a reject is not that judgement (CONTEXT.md,
          // ADR 0009). So Active is what the patch carries, and a row the filter
          // no longer matches leaves the grid.
          const finalPath = await client.restoreWallpaper(id);
          publish({ type: "status-changed", id, status: "active" });
          show({ kind: "restored", filename, finalPath });
          break;
        }
      }
    } catch (err) {
      console.error(FAILURE_LOG[action], err);
      // The card is untouched and the toast carries the backend's own account of
      // why. `invalid_transition` goes one step further on the surface itself: it
      // can only mean this view acted on a row that had already changed
      // underneath, which no patch can correct, so it asks this view for the
      // refetch `useRefetchWhenShown` above is registered for (ADR 0017).
      show({ kind: "failed", view: "library", action, filename, error: err });
    }
  };

  const handleAction = (action: CardAction, card: Wallpaper) => {
    void act(action, card);
  };

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
