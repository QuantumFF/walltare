import { PageBar } from "@/components/PageBar";
import { useApp } from "@/context/AppContext";
import { useAppEvent, useRefetchWhenShown } from "@/context/AppEventsContext";
import {
  client,
  type ListOrdering,
  type Status,
  type StatusFilter,
  type Wallpaper,
} from "@/lib/client";
// The words for a Status and for a Score, from the file that holds the app's
// phrasings, so the list below and the card #78 builds spell them alike.
import { score, STATUS_LABEL } from "@/lib/copy";
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
 * Interim, and it is meant to read as one. #79 builds the library page: the
 * virtualised grid ADR 0016 settled on, the card, the designed filter row and
 * the sort control, all of them inside the two seams below — the bar, and the
 * scroll container.
 *
 * What lands here is everything the grid will sit on and nothing that looks
 * like it: the row state, the filter, the ordering, the scroll position, and
 * the three events that keep the rows honest while the curator is looking at
 * something else. The list of lines is a read-out of that state rather than a
 * design, because a page that fetched every row and drew none of them could not
 * be told from one that fetched nothing.
 *
 * The empty state stays, in both of its readings. ADR 0015 disables no tab — a
 * disabled tab is a dead end that explains nothing — so every destination owes
 * a sentence saying why it is empty and where to go instead.
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

  /**
   * The shared wording, with this page's one extra answer in front of it.
   *
   * `Score moved` stays here and does not belong in `copy.ts`, because it is not
   * a way of writing a Score down at all — it is this page saying it no longer
   * knows one. It comes from `score-changed`, which this view subscribes to and
   * which names two wallpapers without naming their new numbers, so a card
   * rendered anywhere else has nothing to say it with.
   */
  const scoreLabel = (wallpaper: Wallpaper): string => {
    if (scoresMoved.has(wallpaper.id)) return "Score moved";
    return score(wallpaper);
  };

  return (
    <>
      <PageBar>
        {/* #79 replaces both of these with the designed filter row and sort
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

      {/* The scroll container, which is the other half of what #79 needs: the
          grid goes in here, and the position the curator left it at is this
          page's to remember. It scrolls rather than the whole page so that the
          bar above stays put while the grid moves. */}
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
          <ul className="divide-y divide-border/60">
            {(rows ?? []).map((wallpaper) => (
              <li
                key={wallpaper.id}
                data-wallpaper-id={wallpaper.id}
                className="flex items-center gap-4 px-4 py-2 text-sm"
              >
                <span className="truncate" title={wallpaper.path}>
                  {wallpaper.filename}
                </span>
                <span
                  data-slot="score"
                  className="ml-auto shrink-0 text-xs text-muted-foreground"
                >
                  {scoreLabel(wallpaper)}
                </span>
                <span
                  data-slot="status"
                  className="w-20 shrink-0 text-right text-xs text-muted-foreground"
                >
                  {STATUS_LABEL[wallpaper.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
