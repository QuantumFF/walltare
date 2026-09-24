import { EmptyState } from "@/components/EmptyState";
import { useLightbox } from "@/components/ItemLightbox";
import { Lightbox } from "@/components/Lightbox";
import { PageBar } from "@/components/PageBar";
import {
  RejectDestinationLine,
  useRejectDestination,
} from "@/components/RejectDestination";
import { WallpaperGrid } from "@/components/WallpaperGrid";
import type { SelectionHandle } from "@/components/selection";
import { useWallpaperRows, type SetRows } from "@/components/useWallpaperRows";
import { Button } from "@/components/ui/button";
import { SegmentedGroup } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import { useAppEvent } from "@/context/AppEventsContext";
import {
  useKeyboardHandoff,
  useKeyboardSurface,
} from "@/context/KeyboardHandoffContext";
import {
  client,
  type LibraryLayout,
  type ListOrdering,
  type Status,
  type StatusFilter,
} from "@/lib/client";
// The words for a Status, from the file that holds the app's phrasings, so the
// empty state and the card's own pill spell them alike.
import { readableSize, STATUS_LABEL, UNDERSIZED } from "@/lib/copy";
// The one comparison behind the badge and the control below, so the two cannot
// disagree about which wallpapers are undersized.
import { isUndersized } from "@/lib/wallpaper";
import {
  Filter,
  Images,
  LayoutGrid,
  LayoutPanelTop,
  Rows3,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const LOAD_FAILED_ERROR = "Failed to load the library.";

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

/**
 * The layouts the Library offers, in the order the control sits in, and the grid
 * first because it is what the app has always drawn and what a curator who
 * ignores this control keeps.
 *
 * Icons rather than words, because the bar has four things on it already and the
 * three names are longer than the chips beside them. The name is on the control
 * for a screen reader regardless, which is the half that must not be an icon
 * (ADR 0019).
 *
 * Justified joins the end rather than sitting beside masonry, so a curator's
 * finger finds the same control in the same place it was before this one
 * existed. The two uncropped layouts being adjacent is the order this already
 * had, since the grid is first.
 */
const LAYOUTS: Array<{ value: LibraryLayout; label: string; Icon: LucideIcon }> =
  [
    { value: "grid", label: "Grid", Icon: LayoutGrid },
    { value: "masonry", label: "Masonry", Icon: LayoutPanelTop },
    { value: "justified", label: "Justified", Icon: Rows3 },
  ];

/** Whether a row still belongs in a list filtered this way. */
function matchesFilter(status: Status, filter: StatusFilter): boolean {
  return filter === "all" || filter === status;
}

/**
 * What the empty state says when the list is empty because the curator narrowed
 * it, which is one sentence over two axes rather than one per combination.
 *
 * The adjective before the proper noun, so the two controls read in the order
 * they were applied: `No undersized Active wallpapers in the library.` A Status
 * of All contributes nothing, and so does the size control when it is off —
 * which is also the case this sentence is never used for, since a library with
 * nothing in it under no narrowing is the other empty state entirely.
 */
function emptyNarrowingSentence(
  filter: StatusFilter,
  undersizedOnly: boolean,
): string {
  const size = undersizedOnly ? "undersized " : "";
  const status = filter === "all" ? "" : `${STATUS_LABEL[filter]} `;
  return `No ${size}${status}wallpapers in the library.`;
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
 * ordering, the fetch behind them, the scroll position, and the moved Scores a
 * vote elsewhere leaves behind. The rows themselves and the four transitions on
 * them are `useWallpaperRows`', and the window of rows that has cards in it is
 * the grid's own — so what separates this page from Review is one predicate and
 * one prop rather than two implementations (ADR 0023, ADR 0027, #231).
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
  // `settings` answers two of this page's questions. Which layout the grid
  // draws, read from the store rather than held here, which is the whole of what
  // makes it survive a restart: the provider reads every setting before the
  // first paint, so the first grid the curator sees is already the one they
  // chose (ADR 0010). And the Minimum resolution, which is the one thing both
  // the badge on a card and the size control on the bar are comparisons
  // against — the page holds it once and hands the grid the size, so a curator
  // who narrows to the undersized wallpapers gets exactly the cards wearing the
  // badge (CONTEXT.md, #258).
  const { view, setView, settings, saveSetting } = useApp();
  const showing = view === "library";
  const layout = settings.library_layout;
  const minimumResolution = settings.minimum_resolution;

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
  /**
   * Whether the list is narrowed to the wallpapers too small for the curator's
   * screen.
   *
   * Its own axis and not a fifth Status chip. The chips answer what the curator
   * decided about a wallpaper; this answers whether the file is usable at all,
   * so the two combine and Active and undersized can be asked for together
   * (CONTEXT.md, #258).
   *
   * View state, like the filter and the ordering beside it, and not persisted:
   * ADR 0016 refused to remember either of those, and a narrowing that survives
   * a restart is a library that opens missing most of itself for a reason
   * nothing on screen explains.
   */
  const [undersizedOnly, setUndersizedOnly] = useState(false);
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
    async (setRows: SetRows, resetScroll = false) => {
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
   */
  const { rows, setRows, perform } = useWallpaperRows({
    view: "library",
    fetch: fetchRows,
    belongs: (status) => matchesFilter(status, filter),
    destination,
  });

  // The first fetch is this view's first mount, which the shell defers to the
  // curator's first visit, and every later one is a filter or an ordering they
  // changed — `fetchRows` is keyed on both.
  useEffect(() => {
    void fetchRows(setRows, true);
  }, [fetchRows, setRows]);

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

  /**
   * The rows the grid draws: everything the fetch returned, or only the
   * undersized ones.
   *
   * Narrowed here rather than in `list_wallpapers`, which is the decision this
   * control turns on. The Status filter is a backend argument because it is a
   * `WHERE` over a column and ADR 0016 made the four names a serde enum for
   * exactly that; undersized is not a column and not a Status — it is a
   * comparison between a wallpaper's Dimensions and a preference, and asking
   * the backend for it would mean the listing query reading the settings table
   * and the list going stale the moment a curator changed the Minimum
   * resolution in another view. Every row is already here (ADR 0016), so the
   * comparison is over rows in hand and moves with the setting on the next
   * render.
   *
   * A wallpaper whose Dimensions are unknown is skipped rather than counted
   * either way, which is `isUndersized`'s rule and the same one the badge
   * follows (ADR 0044).
   *
   * Memoised because it is the grid's `wallpapers`, which the selection cursor
   * and the window are both resolved against: a fresh array per render is a
   * fresh dependency for both.
   */
  const list = useMemo(() => {
    const fetched = rows ?? [];
    if (!undersizedOnly) return fetched;
    return fetched.filter((w) => isUndersized(w, minimumResolution));
  }, [rows, undersizedOnly, minimumResolution]);

  /**
   * The grid, once it has mounted, and the whole of what this page knows about
   * the selection.
   *
   * The cursor is the grid's since #230. This page does not read it, does not
   * hold it and does not hand it down: both surfaces below take the handle, and
   * the one that draws a selection subscribes to the grid's publication. That is
   * what keeps ADR 0022's property through the move — the lightbox is a second
   * rendering of the grid's selection rather than a cursor of its own, so there
   * is no sync rule between them because there are still not two things to sync
   * — while a cursor move stops re-rendering this page and every card the window
   * has mounted under it (ADR 0041, #137).
   *
   * State rather than the `useRef` ADR 0029 wrote, because when the handle
   * exists is now information a subscriber needs: this page renders its empty
   * state *instead of* the grid, and the lightbox has to hear about that.
   * `setGrid`'s identity is stable, so nothing downstream churns on it.
   */
  const [grid, setGrid] = useState<SelectionHandle | null>(null);
  const lightbox = useLightbox(grid);
  // And where a hand-off to this page lands (ADR 0047).
  useKeyboardSurface("library", grid);

  // Whether the ordering's list was opened with the pointer, which decides where
  // the focus goes when it closes. Radix puts it back on the trigger, which is
  // right for a curator who opened it from the keyboard and strands the arrows
  // for one who clicked: a trigger answers them by opening the list again. The
  // same bargain as a button in the bar, made at close because the list is the
  // popup `PageBar` leaves alone.
  const handOff = useKeyboardHandoff();
  const orderingByPointer = useRef(false);

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
        <SegmentedGroup
          role="group"
          aria-label="Filter by Status"
        >
          {FILTERS.map(({ value, label }) => {
            const current = filter === value;
            return (
              <Button
                key={value}
                size="sm"
                variant="segment"
                aria-pressed={current}
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            );
          })}
        </SegmentedGroup>

        {/* The other axis, and deliberately not a fifth chip.

            The chips answer what the curator decided about a wallpaper and this
            answers whether the file is usable at all, so the two combine rather
            than replacing one another: Active and undersized is a question this
            bar can be asked, and it is the question that makes cleaning them out
            one action rather than a hunt (CONTEXT.md, #258).

            Said in the shape as well as in the position. The chips are four
            segments in one track sharing one accessible name; this is one
            outlined toggle standing outside that track, so what a curator sees
            is two controls rather than five of one. `aria-pressed` is the same
            statement to a screen reader that the fill is to an eye, and it is
            pressed and not checked for the reason the chips are: a `radiogroup`
            would put the arrow keys on the bar, which this page spends on the
            grid (ADR 0019).

            The word on it is the word on the badge, from `copy.ts`, so the
            control and the mark it rounds up cannot come to be called two
            things. The `title` names the number behind both, since the Minimum
            resolution is a setting two views away and the word alone does not
            say what a wallpaper is being measured against. It states the
            threshold rather than the gesture, so it reads the same pressed and
            unpressed.

            It returns the list to the top, which is `fetchRows`' reorder rule
            applied to the one narrowing that does not refetch: a position means
            something different in a list of forty than in the five thousand it
            was taken in, so the curator is put at the start of what they asked
            for rather than somewhere in the middle of it (ADR 0016). */}
        <Button
          size="sm"
          variant="toggle"
          aria-pressed={undersizedOnly}
          title={`Below the minimum resolution of ${readableSize(minimumResolution)}`}
          onClick={() => {
            setUndersizedOnly((on) => !on);
            toTop();
          }}
          className="shrink-0"
        >
          {UNDERSIZED}
        </Button>

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

            The app's own drop-down rather than a native `<select>`. The native
            control was the smaller thing to reach for and it is the one control
            in the window a stylesheet cannot paint: WebKit draws it from the
            UA's appearance and ignores `background-color`, so under the dark
            palette it came out white with a near-white label on it (#192). The
            keyboard model that was the argument against a popover is Radix's,
            not this file's, and the list is portalled clear of the grid, so the
            arrows the cards spend belong to whichever surface is in front
            (ADR 0019).

            `size="sm"` is the chips' 28px, so the two controls sit on one
            line. */}
        <Select
          value={ordering}
          onValueChange={(value) => setOrdering(value as ListOrdering)}
        >
          <SelectTrigger
            onPointerDown={() => {
              orderingByPointer.current = true;
            }}
            onKeyDown={() => {
              orderingByPointer.current = false;
            }}
            aria-label="Order by"
            size="sm"
            className="shrink-0 text-[0.8rem]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            onCloseAutoFocus={(event) => {
              if (!orderingByPointer.current) return;
              event.preventDefault();
              handOff();
            }}
          >
            {ORDERINGS.map(({ value, label }) => (
              <SelectItem key={value} value={value} className="text-[0.8rem]">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The layout, as a button each in a named group — the chips' shape, for
            the same reason: controls in a row with no word between them are
            unrelated buttons to a screen reader, and `aria-pressed` is what
            makes the current layout the same fact there that the fill makes it
            to an eye.

            Here and not in Settings. A control in two places is two places to
            look, and this is the page the choice is about: the curator changes
            how the Library looks while they are looking at it. The choice is
            still stored, which is what a restart reads it back from.

            Pressed and not checked, for the reason the chips are: a
            `radiogroup` would put them on the arrow keys, and this page
            spends the arrows on moving the selection through the grid
            (ADR 0019). */}
        <SegmentedGroup
          role="group"
          aria-label="Layout"
        >
          {LAYOUTS.map(({ value, label, Icon }) => {
            const current = layout === value;
            return (
              <Button
                key={value}
                // The chips' 28px, as a square: the control carries an icon and
                // no word, so a button sized for a label would be a chip's worth
                // of empty space either side of it.
                size="icon-sm"
                variant="segment"
                aria-pressed={current}
                aria-label={label}
                title={label}
                onClick={() => {
                  // The write is what the next launch reads, and the control
                  // follows the store rather than a copy held here — so a write
                  // that fails leaves the bar saying what the app is actually
                  // drawing instead of a layout nothing chose.
                  void saveSetting("library_layout", value).catch(
                    (error: unknown) => {
                      console.error("Failed to save the library layout:", error);
                    },
                  );
                }}
              >
                <Icon aria-hidden />
              </Button>
            );
          })}
        </SegmentedGroup>

        {/* The row count, which is the size of the library under this filter and
            not a page of it: one call returns every matching row, so nothing
            asks a second question to say how many there are (ADR 0016).

            It counts what is on the page rather than what came back, so the
            size control moves it the way a chip does. A number that stayed at
            the whole library's size while the grid showed forty cards would be
            the one thing on the bar disagreeing with the thing under it. */}
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {rows === null
            ? "Loading…"
            : `${list.length} ${list.length === 1 ? "wallpaper" : "wallpapers"}`}
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
          it is the element the grid measures its window against — the ref goes
          down as a prop and the offset stays up here, because the restore below
          turns on `showing` and on ADR 0015's rule that this view stays mounted
          (ADR 0027, #231).

          `onScroll` writes a ref and renders nothing, which is what keeps a
          wheel gesture off this component: the window that moves with it is the
          grid's, and the grid is what the virtualiser re-renders. */}
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

            Which of the two is showing is what the two controls are read for,
            and they are read differently because they narrow at different
            points. With the Status filter on All the fetch asked about the whole
            library, so a fetch that came back with nothing is a library with
            nothing in it — whatever the size control is doing, since a narrowing
            of no rows is still no rows. Any other case is a library with nothing
            matching in it: the library is fine and this view of it is not.

            So the empty library is the *fetch* coming back empty under All, and
            not the list on screen being empty, which is the distinction the size
            control introduces: it drops rows after the fetch, and a curator who
            pressed it must not be told their library was never scanned. */}
        {rows !== null && list.length === 0 ? (
          filter === "all" && rows.length === 0 ? (
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

               The way out is the same state setters the controls on the bar
               write, not a control itself: #130 turned the filter from a
               `<select>` into four buttons, and an empty state reaching for a
               DOM node would have gone with it. Going through `setFilter` also
               means the refetch and the scroll reset are the ones a filter
               change already owns (ADR 0016).

               It clears both axes, because it promises all the wallpapers and
               the curator cannot be expected to know which of the two controls
               emptied the page — a way out that left the size control pressed
               would land them on the same empty screen. */
            <EmptyState
              icon={Filter}
              action="Show all wallpapers"
              onAction={() => {
                setFilter("all");
                setUndersizedOnly(false);
              }}
            >
              {emptyNarrowingSentence(filter, undersizedOnly)}
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

             Every row goes in and a window of a few dozen of them comes out.
             The grid is what resolves the selection and moves it with the
             arrows, so it needs the list the curator is browsing rather than
             the slice of it that has nodes — and it works the slice out for
             itself, from the scroll box this page hands it. That box is the
             only thing about the window that crosses this seam now; the row
             height, the column count and the way a selection outside the window
             gets a node are all arithmetic over the grid's own CSS (#131, #231,
             ADR 0027). The selection is resolved against this whole list too,
             so wallpaper 3,000 can hold it whichever thirty cards have nodes
             (#137, #230).

             `density` is how far Ctrl and the wheel may go on this page, and
             the browse surface is the wide end of it: two enormous cards to a
             row or eight small ones, against Review's six. The numbers are the
             grid's, for the same reason its row height and column count are
             (ADR 0027); which of the two ranges this page is, is the page's
             (#264). */
          <WallpaperGrid
            ref={setGrid}
            wallpapers={list}
            label="Wallpapers in the library"
            onAction={perform}
            onOpen={lightbox.openOn}
            scoresMoved={scoresMoved}
            minimumResolution={minimumResolution}
            evaluatedThreshold={settings.evaluated_threshold}
            scroller={scroller}
            density="library"
            /* The one thing the layout choice changes down here. The grid is
               the same component with the same cards, the same cursor and the
               same keys — what moves is where the plan puts them, which is why
               the selection survives a switch without anything carrying it
               across (ADR 0045). */
            layout={layout}
          />
        )}
      </div>

      {/* The same component Review mounts, subscribing to the same selection
          the grid above is drawing, with no argument saying which page it is:
          the action set in it comes off the wallpaper's Status, so this page's
          Kept and Rejected rows offer Make Active and Restore in there without
          the lightbox knowing whose grid it opened over (ADR 0022).

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
        grid={grid}
        open={lightbox.open}
        onClose={lightbox.close}
        onAction={perform}
      />
    </>
  );
}
