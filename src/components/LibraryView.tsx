import { Lightbox, useLightbox } from "@/components/Lightbox";
import { PageBar } from "@/components/PageBar";
import {
  RejectDestinationLine,
  useRejectDestination,
} from "@/components/RejectDestination";
import {
  useGridColumns,
  useGridSelection,
  WallpaperGrid,
} from "@/components/WallpaperGrid";
import { useWallpaperRows } from "@/components/useWallpaperRows";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useAppEvent, useRefetchWhenShown } from "@/context/AppEventsContext";
import {
  client,
  type ListOrdering,
  type Status,
  type StatusFilter,
} from "@/lib/client";
// The words for a Status, from the file that holds the app's phrasings, so the
// empty state and the card's own pill spell them alike.
import { STATUS_LABEL } from "@/lib/copy";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { Filter, Images, type LucideIcon } from "lucide-react";
import {
  type ReactNode,
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

/**
 * The four filters, in the order the chips sit in, and All first because the
 * page's promise is everything the app knows about (ADR 0014).
 *
 * Four and not five. There is no Eligible chip: Eligible is a voting-pool term,
 * and on a browsing surface it reads as "everything I haven't thrown out", which
 * is what All already shows with the rejects greyed. Putting a word with a
 * precise domain meaning on a chip invites a looser reading of it (CONTEXT.md,
 * ADR 0016).
 */
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
 * The shape both of this page's empty states share: an icon, one sentence
 * saying why there is nothing here, and the control that leads out of it.
 *
 * One component rather than two blocks, because ADR 0015's rule is about the
 * pair and not about either half — no tab is ever disabled, so every
 * destination owes a sentence saying why it is empty *and* where to go instead
 * — and two independently written blocks are how one of them ends up with the
 * sentence and no route. What differs between the two states is the wording and
 * where the control leads, which is the whole of what this takes.
 */
function EmptyState({
  icon: Icon,
  action,
  onAction,
  children,
}: {
  icon: LucideIcon;
  action: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/30" aria-hidden />
      <p className="text-sm text-muted-foreground">{children}</p>
      <Button variant="link" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/**
 * The library page: every matching row in one fetch (ADR 0016), drawn as the
 * shared card in the shared grid, inside the scroll container this view owns.
 *
 * The bar carries four things and they are all read-outs of the same two pieces
 * of state or of a setting: the Status filter as four chips, the ordering as one
 * named control, the line saying where rejects go, and the row count (#130).
 *
 * What this view owns underneath is the state the grid reads: the filter, the
 * ordering, the fetch behind them, the scroll position, the window of rows that
 * has cards in it, and the moved Scores a vote elsewhere leaves behind. The rows
 * themselves and the four transitions on them are `useWallpaperRows`', which is
 * where this page and Review differ in one predicate rather than in two
 * implementations (ADR 0023).
 *
 * There are two empty states and they are two screens: a library nothing has
 * been scanned into, which routes to the Settings field that fixes it, and a
 * filter matching nothing, which offers to go back to All. ADR 0015 disables no
 * tab — a disabled tab is a dead end that explains nothing — so every
 * destination owes a sentence saying why it is empty and where to go instead,
 * and the two reasons here have different answers to the second half.
 */
export function LibraryView() {
  // `setView` is the empty library's way out: nothing on this page can name a
  // library root, so the state that says so routes to the page that can
  // (ADR 0015, ADR 0020).
  const { view, setView } = useApp();
  const showing = view === "library";

  // Where a reject goes, read once for the two things that must agree about it:
  // the string `move_wallpaper` is handed, and the boolean the toast reads to
  // decide whether it has a path left to name. One object rather than a value
  // each of them resolves for itself, because `$HOME/bin` looks relative and is
  // not, so a second `expand_path` call is a second verdict (ADR 0018). The line
  // on the bar is handed this same object rather than reading the setting for
  // itself, which is what makes "the toast names the path whenever the bar could
  // not" a property of the page rather than a hope about two callers.
  const destination = useRejectDestination();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [ordering, setOrdering] = useState<ListOrdering>("score_desc");
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
   * The rows, and the four transitions on them (ADR 0023).
   *
   * Nothing here is optimistic, which is the difference from Review and is what
   * the absent `optimistic` says. This page keeps every row it fetched, so there
   * is no removal to undo: the published patch is the only thing that edits a
   * row, and a call that never lands leaves the card exactly where the curator
   * left it.
   *
   * `belongs` is the Status filter, so a row the filter no longer matches leaves
   * the grid — a wallpaper cannot stay in a list of Rejected ones after a
   * Restore made it Active. Under the default filter of All nothing is ever
   * dropped: a Rejected card greys and says what it now is.
   *
   * `owe` is a forward reference to `useRefetchWhenShown` below, and the two are
   * a cycle this page breaks here: the module holds the rows the fetch writes,
   * and the fetch is the one `useRefetchWhenShown` defers. Nothing reads it
   * during render — it fires only from a transition the backend refused.
   */
  const { rows, setRows, perform } = useWallpaperRows({
    belongs: (status) => matchesFilter(status, filter),
    destination,
    owe: oweRefetch,
  });

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
    [filter, ordering, setRows, toTop],
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

  const owe = useRefetchWhenShown("library", refetchAfterScan);

  // See `owe` on the module above: a declaration, so it can be handed over
  // before the hook that answers it has run.
  function oweRefetch() {
    owe();
  }

  // The one patch left on the page. A moved Score is not a transition, so it
  // stays here rather than folding into the module with `status-changed`.
  useAppEvent((event) => {
    if (event.type !== "score-changed") return;
    setScoresMoved((prev) => {
      const next = new Set(prev);
      for (const id of event.ids) next.add(id);
      return next;
    });
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
   * The grid's selection, held here rather than inside the grid because ADR
   * 0022 has the lightbox render this same selection and keeps the lightbox's
   * state on the page that mounted the grid — for the same reason the rows are
   * here, that both change on every action.
   *
   * Both surfaces below read this one object, which is what makes the lightbox
   * a second rendering of the grid rather than a cursor of its own: there is no
   * sync rule between them because there are not two things to sync. It is
   * resolved against `list` and not against the `range` above, so wallpaper
   * 3,000 can hold the selection whichever thirty cards have nodes (#137).
   */
  const selection = useGridSelection(list);
  const lightbox = useLightbox(selection);

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

  return (
    <>
      <PageBar>
        {/* The filter, as four chips laid out rather than four entries behind a
            menu. Every value is one word, all four fit, and a chip row is the
            one shape where the current filter and the three alternatives are
            legible without opening anything.

            One group with one accessible name, because four buttons in a row
            are otherwise four unrelated controls with no word between them
            saying what they are for, and `aria-pressed` is what makes the
            current filter the same fact to a screen reader that the fill makes
            it to an eye.

            Pressed and not checked: a `radiogroup` would put the four on the
            arrow keys, and this page already spends the arrows on moving the
            selection through the grid (ADR 0019). */}
        <div
          role="group"
          aria-label="Filter by Status"
          className="flex shrink-0 items-center gap-1"
        >
          {FILTERS.map(({ value, label }) => {
            const current = filter === value;
            return (
              <Button
                key={value}
                size="sm"
                variant={current ? "secondary" : "ghost"}
                aria-pressed={current}
                onClick={() => setFilter(value)}
                className="rounded-full"
              >
                {label}
              </Button>
            );
          })}
        </div>

        {/* ADR 0018's line, and it sits between the two controls because it is
            the thing that truncates when the bar runs out of width: the chips
            and the ordering keep their labels and the read-out gives up its
            tail, which is the order of precedence that ADR names. It is the
            same component Review's bar carries, on the object this page hands
            `move_wallpaper`. */}
        <RejectDestinationLine destination={destination} />

        {/* One control with ADR 0014's four names in it, direction included, so
            nothing here composes a key and a direction — the frontend picks a
            name and the backend owns every part of the clause behind it.

            A `<select>`, styled to sit beside the chips. Four fixed entries the
            curator opens, reads and closes is exactly what the native control
            is, and a popover would be a menu component, a focus trap and a
            keyboard model this app does not otherwise have. */}
        <select
          aria-label="Order by"
          value={ordering}
          onChange={(event) => setOrdering(event.target.value as ListOrdering)}
          className="h-7 shrink-0 rounded-lg border border-border bg-background px-2 text-[0.8rem] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {ORDERINGS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {/* The row count, which is the size of the library under this filter and
            not a page of it: one call returns every matching row, so nothing
            asks a second question to say how many there are (ADR 0016). */}
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
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
        {/* The two empty states, and they are two screens rather than one
            sentence with a branch in it (#133).

            The condition on `rows` is what keeps either of them off the screen
            while the first fetch is still out: `null` is "nobody has asked yet"
            and `[]` is the backend's answer, and telling a curator their library
            is empty because a call has not come back is the state this
            distinction exists to prevent.

            Which of the two is showing is read off the filter, because that is
            the only thing that can tell them apart. With All selected the fetch
            asked about the whole library, so no rows means no library. The other
            three asked about one Status, so no rows means a library with nothing
            of that Status in it — the library is fine and this view of it is
            not. */}
        {rows !== null && rows.length === 0 ? (
          filter === "all" ? (
            /* The route carries `focus`, so the curator lands on the field they
               have to fill in rather than on a page of four sections with the
               answer somewhere in it (ADR 0020). `returnTo` is this page by
               name and not the current view, since the only way to press this is
               to be looking at it. */
            <EmptyState
              icon={Images}
              action="Choose a library root"
              onAction={() =>
                setView("settings", {
                  returnTo: "library",
                  focus: "library_root",
                })
              }
            >
              Nothing has been scanned into the library yet.
            </EmptyState>
          ) : (
            /* The Status as CONTEXT.md spells it, capitalised: these are the
               domain's proper nouns and `STATUS_LABEL` is where the app agrees
               with itself about them, card pill included (`copy.ts`).

               The way out is the same state setter the chips on the bar write,
               not a chip itself: #130 turned that control from a `<select>`
               into four buttons, and an empty state reaching for a DOM node
               would have gone with it. Going through `setFilter` also means the
               refetch and the scroll reset are the ones a filter change already
               owns (ADR 0016). */
            <EmptyState
              icon={Filter}
              action="Show all wallpapers"
              onAction={() => setFilter("all")}
            >
              No {STATUS_LABEL[filter]} wallpapers in the library.
            </EmptyState>
          )
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
            selection={selection}
            label="Wallpapers in the library"
            onAction={perform}
            onOpen={lightbox.openOn}
            scoresMoved={scoresMoved}
            reveal={reveal}
            range={range}
            className="p-4"
          />
        )}
      </div>

      {/* The same component Review mounts, on the same selection the grid above
          is showing, with no argument saying which page it is: the action set in
          it comes off the wallpaper's Status, so this page's Kept and Rejected
          rows offer Make Active and Restore in there without the lightbox
          knowing whose grid it opened over (ADR 0022).

          `onAction` is the same `perform` the grid behind it is handed, so
          nothing a curator does from in there is optimistic either: the published patch is what edits the
          row, which is why rejecting under a filter of All leaves the same
          wallpaper up wearing its new Status and its new actions, and rejecting
          under Active takes the row out of the list and advances.

          Outside the empty-state branch, so a filter that empties the list
          closes it onto that state rather than unmounting it out from under the
          focus restore. Its pixels land in the shell regardless, above the
          pages and below the toast. */}
      <Lightbox
        selection={selection}
        open={lightbox.open}
        onClose={lightbox.close}
        onAction={perform}
      />
    </>
  );
}
