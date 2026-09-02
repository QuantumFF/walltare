import { PageBar } from "@/components/PageBar";
import { WallpaperGrid } from "@/components/WallpaperGrid";
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
import { Images } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const LOAD_FAILED_ERROR = "Failed to load the library.";

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
 * #130's to replace with the filter chips and the sort control; the grid mounts
 * every row until #131 puts ADR 0016's window of cards in front of it; and #132
 * is what answers the four actions a card can ask for.
 *
 * What this view owns underneath is the state the grid reads: the rows, the
 * filter, the ordering, the scroll position, and the three events that keep the
 * rows honest while the curator is looking at something else.
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
  // restore is never a visible jump from the top of the list.
  useLayoutEffect(() => {
    if (!showing || !scroller.current) return;
    scroller.current.scrollTop = scrollTop.current;
  }, [showing]);

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
          it is the element #131's virtualiser measures its window against. */}
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

             No `reveal` yet: every row is mounted, so the default
             scroll-into-view is the whole of what the selection needs. #131 is
             what hands the virtualiser in. */
          <WallpaperGrid
            wallpapers={rows ?? []}
            label="Wallpapers in the library"
            onAction={handleAction}
            scoresMoved={scoresMoved}
            className="p-4"
          />
        )}
      </div>
    </>
  );
}
