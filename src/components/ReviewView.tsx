import { EmptyState } from "@/components/EmptyState";
import { useLightbox } from "@/components/ItemLightbox";
import { Lightbox } from "@/components/Lightbox";
import { PageBar } from "@/components/PageBar";
import {
  RejectDestinationLine,
  useRejectDestination,
} from "@/components/RejectDestination";
import { FILMSTRIP_START, ReviewStrip } from "@/components/ReviewStrip";
import { useToaster } from "@/components/ToastSurface";
import { WallpaperGrid } from "@/components/WallpaperGrid";
import type { SelectionHandle } from "@/components/selection";
import { useWallpaperRows, type SetRows } from "@/components/useWallpaperRows";
import { Button } from "@/components/ui/button";
import { SegmentedGroup } from "@/components/ui/segmented";
import { useApp } from "@/context/AppContext";
import { useKeyboardSurface } from "@/context/KeyboardHandoffContext";
import { client, type ReviewLayout, type ReviewOrdering } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  Check,
  Columns2,
  Loader2,
  type LucideIcon,
  RefreshCw,
  Rows3,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the bar says this worklist is, which is the whole of how the curator
 * reads an ordering they set on another page.
 *
 * Both sentences name Score, because Score is what orders the list either way
 * (ADR 0013): the choice is which end of the ranking the curator is working
 * from, not which statistic (#259).
 */
const ORDERING_SENTENCE: Record<ReviewOrdering, string> = {
  score_asc: "Lowest Scores first",
  score_desc: "Highest Scores first",
};

/**
 * The two layouts Review offers, in the order the control lays them out and the
 * strip first because it is the one this page's job asks for.
 *
 * On the page bar and nowhere else. A control in two places is two places to
 * look, so it does not appear in Settings either — the choice is stored there
 * and changed here, the way the Status filter and the ordering already are
 * (ADR 0018's rule, applied the other way round: a preference this page owns is
 * edited on this page).
 */
const LAYOUTS: Array<{ value: ReviewLayout; label: string; Icon: LucideIcon }> =
  [
    { value: "strip", label: "Strip", Icon: Columns2 },
    { value: "grid", label: "Grid", Icon: Rows3 },
  ];

export function ReviewView() {
  // Whether a fetch is out, which is what the Refresh button reads. It is not
  // what decides whether the surface is drawn — see `firstLoad` below.
  const [loading, setLoading] = useState(true);
  const { setView, settings, saveSetting } = useApp();
  /**
   * Which layout this page is drawing, straight off the stored settings.
   *
   * No state of its own beside the setting, which is what makes "survives a
   * restart" true rather than hoped for: `saveSetting` writes the row and holds
   * the whole struct that comes back, so what renders is what is stored
   * (ADR 0010). Review's key is its own, so Library's choice and this one cannot
   * move each other.
   */
  const layout = settings.review_layout;
  // How long this worklist is and which end of the ranking it comes off, both
  // stated in Settings. The `limit` is still the only one the listing is given —
  // the library page asks for everything (ADR 0028) — and the ordering is a
  // member of that same listing vocabulary, so it is handed over as read (#259).
  const { review_worklist_size: worklistSize, review_ordering: ordering } =
    settings;
  // `settings.minimum_resolution` is here for the undersized badge alone, which
  // is what the cards below wear it off. It is a display fact and nothing more:
  // what this worklist holds is the listing above, before and after, because
  // excluding undersized wallpapers from review would silently change what the
  // ranking is over (CONTEXT.md, #258).
  // Where a reject goes, read once for the line on the bar, for the string
  // `move_wallpaper` is handed and for what the toast has left to say. The
  // `movePath` state that used to stand here is gone with the field that edited
  // it: it configured a global preference from inside one of the views that
  // consumes it, defaulted to a hardcoded `./rejected` and reset on every launch
  // (ADR 0010, ADR 0018).
  const destination = useRejectDestination();
  // The only toast this page still raises itself: a list that will not load is
  // not a transition, and the four that are belong to the module below. The
  // `role="alert"` paragraph that used to hold this is gone with the `error`
  // state behind it — two error surfaces in one view is what ADR 0017 set out
  // to remove.
  const { show } = useToaster();

  const fetchReviewList = useCallback(
    async (setRows: SetRows) => {
      setLoading(true);
      try {
        const list = await client.listWallpapers(
          "active",
          ordering,
          worklistSize,
        );
        setRows(list);
      } catch (err) {
        console.error("Failed to fetch review list:", err);
        show({ kind: "load-failed", noun: "the review list", error: err });
      } finally {
        setLoading(false);
      }
    },
    [ordering, worklistSize, show],
  );

  /**
   * The rows, and the four transitions on them (ADR 0023).
   *
   * `belongs` is Active, because Kept and Rejected never appear in review
   * (CONTEXT.md): a wallpaper that changed Status anywhere else leaves the list.
   * The other direction is not a patch this page can make — nothing in a row
   * says where it belongs in an ordering by Score — so a wallpaper that just
   * became Active arrives with the next fetch. The exception is an Undo of this
   * page's own keep or reject, which puts the card back where it left.
   *
   * `optimistic` is what makes this page's reject feel like one keystroke: the
   * card goes on the click and comes back with the selection if the write fails.
   *
   * `selectId` is a forward reference to the grid further down, and is not read
   * during render: the selection is resolved over the rows this module holds,
   * and the module's re-insert is what puts the selection back on the card it
   * re-inserted.
   *
   * The refetch after a scan waits until Review is the view being shown: a
   * worklist's worth of thumbnail requests from a hidden page — and the curator
   * may have asked for a hundred — is exactly what ADR 0012's dedicated
   * pre-generation thread exists to keep off the rank view's next pair.
   */
  const { rows, setRows, perform, owe } = useWallpaperRows({
    view: "review",
    fetch: fetchReviewList,
    belongs: (status) => status === "active",
    destination,
    optimistic: { selectId },
  });
  const wallpapers = rows ?? [];
  // The spinner's whole condition: a fetch is out and there is nothing to show
  // while it is. Every later fetch has rows on screen already, and it replaces
  // them where they stand, the way Library's does — so the surface drawing them
  // outlives the fetch, and with it the cursor, the density and the handle an
  // open lightbox is reading (#285). Refresh's own spin is what says a refetch
  // is in flight.
  //
  // `rows` and not a flag of this page's own, because `null` is already "no
  // fetch has landed" (`useWallpaperRows`). A first fetch that failed leaves it
  // there, so the empty state is what shows once it has given up, as it always
  // was.
  const firstLoad = loading && rows === null;

  // The grid, once it has mounted, and the whole of what this page knows about
  // the selection. The cursor is the grid's since #230, so nothing here holds it
  // or hands it down: the lightbox below subscribes to the grid's own
  // publication, which is what keeps it a second rendering of that selection
  // rather than a cursor of its own — no sync rule, because there are still not
  // two things to sync (ADR 0022, #137).
  //
  // State rather than the `useRef` ADR 0029 wrote, because this page renders its
  // own empty state instead of the grid, and a subscriber has to hear about the
  // handle arriving and going. `setGrid`'s identity is stable.
  const [grid, setGrid] = useState<SelectionHandle | null>(null);
  const lightbox = useLightbox(grid);
  // And where a hand-off to this page lands, the strip or the grid (ADR 0047).
  useKeyboardSurface("review", grid);

  /**
   * The wallpaper the outgoing surface was on, for the incoming one to open on.
   *
   * Swapping layout unmounts one surface and mounts the other, and the cursor is
   * the surface's since #230 — so without this the curator lands back at the top
   * of the worklist, which part-way through a sweep is losing their place. A ref
   * and not state: it is written in a click handler and read by the next mount,
   * and nothing renders from it.
   *
   * Spent on arrival, so it only ever answers for the swap that wrote it. An
   * emptied list that refills and remounts the surface later must not put the
   * selection back on a wallpaper the curator has since moved off. A refetch
   * remounts nothing, so it needs no handover at all (#285).
   */
  // Each layout's density, held here for the same reason: the swap would
  // otherwise put it back at the start every time.
  const gridZoom = useState(0);
  const filmstripStep = useState(FILMSTRIP_START);

  const handOver = useRef<number | null>(null);
  const resumeOn = handOver.current;
  // Keyed on the layout change, so an unrelated render between the click and
  // the confirmed flip does not spend the handover early and drop the curator
  // back at the top of the worklist.
  useEffect(() => {
    handOver.current = null;
  }, [layout]);

  // Whether this page has asked for its list yet, which is what separates the
  // two things the effect below has to do. A ref because nothing renders from
  // it and it must not reset when the settings it is guarding move.
  const fetched = useRef(false);

  // The first fetch, and every later one a changed worklist size or ordering
  // asks for.
  //
  // The first is the page's own and runs where it stands: a page that has
  // mounted has a list to fill, whatever the shell happens to be showing. The
  // rest go through `owe`, because both settings are written on a page this one
  // is hidden behind — a worklist lengthened from Settings would otherwise put a
  // hundred thumbnail requests in front of whatever the curator does next, which
  // is the deferral ADR 0015 wrote for a scan (#259).
  useEffect(() => {
    if (!fetched.current) {
      fetched.current = true;
      void fetchReviewList(setRows);
      return;
    }
    owe();
  }, [owe, fetchReviewList, setRows]);

  // The forward reference the module above takes, as a declaration so it can be
  // handed over before the grid that answers it has mounted. It fires only from
  // a failed transition or an Undo that landed.
  function selectId(id: number) {
    grid?.selection().selectId(id);
  }

  // The destination line, in the bar this page owns below the chrome. The
  // chrome's tab already names the page, so what was a 2xl heading and a
  // subtitle is the sentence that actually carries information: what Review
  // lists, and where a reject lands (ADR 0015). It renders while the list is
  // still loading too, so the page's height does not move under the curator.
  //
  // Where the field used to sit there is a read-out of the stored destination
  // and a route into Settings, which is the whole of what Review may say about a
  // preference it does not own (ADR 0018).
  const header = (
    <>
      <h1 className="sr-only">Review</h1>
      <PageBar>
        {/* Which end of the ranking this worklist came off, because the control
            that decides it is on another page and the cards below cannot say so
            for themselves — the worst wallpapers and the best both read as a
            worklist of whatever length was asked for, at a glance (#259). */}
        <span className="font-medium whitespace-nowrap">
          {ORDERING_SENTENCE[ordering]}
        </span>
        <RejectDestinationLine destination={destination} />

        {/* The layout choice, as two buttons laid out rather than two entries
            behind a menu — the shape Library's Status chips already use, for the
            same reason: both values are one word, both fit, and a row of them is
            where the current choice and the alternative are legible without
            opening anything.

            One group with one accessible name, because two buttons in a row are
            otherwise two unrelated controls with no word between them saying
            what they are for, and `aria-pressed` is what makes the current
            layout the same fact to a screen reader that the fill makes it to an
            eye.

            Pressed and not checked: a `radiogroup` would put the two on the
            arrow keys, and this page spends the arrows on walking the worklist
            (ADR 0019). */}
        <SegmentedGroup role="group" aria-label="Layout">
          {LAYOUTS.map(({ value, label, Icon }) => {
            const current = layout === value;
            return (
              <Button
                key={value}
                size="sm"
                variant="segment"
                aria-pressed={current}
                // Nothing is said about a write that failed. The control is a
                // read-out of the setting, so a refused write leaves the layout
                // where it was and the button un-pressed, which is the whole of
                // what there is to report.
                onClick={() => {
                  // Where the curator was, so the surface that replaces this one
                  // opens there rather than back at the top of the worklist.
                  // Read once, here, rather than subscribed to: a
                  // subscription would put every arrow key through this page,
                  // which is what #230 took the cursor out of it to prevent.
                  handOver.current = grid?.selection().item?.id ?? null;
                  void saveSetting("review_layout", value).catch(
                    (error: unknown) => {
                      console.error(
                        "Failed to store the Review layout:",
                        error,
                      );
                    },
                  );
                }}
              >
                <Icon />
                {label}
              </Button>
            );
          })}
        </SegmentedGroup>

        {/* Refresh, and nothing beside it.

            A **Back** button went to Rank from here, which is the shape
            ADR 0015 replaced with the chrome's tabs: a fixed bar one click away
            already names that destination, and the "two `setView` calls buried
            in Review's header" this ADR's own Context describes were half of
            what it was correcting. Refresh stays because it acts on this list
            rather than leaving it. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchReviewList(setRows)}
          className="gap-2"
          disabled={loading}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </PageBar>
    </>
  );

  return (
    <>
      {header}

      {/* One branch rather than an early return, because the lightbox below has
          to outlive it: an early return would unmount an open dialog, leaving
          the shell holding an `inert` nothing would ever take back.

          The branch is the first load and nothing later. A refetch — Refresh,
          or a `library-scanned` one landing while the curator is looking at a
          wallpaper — keeps the populated surface mounted and hands it the new
          rows, which is what makes ADR 0022's reading true: a rescan adds rows
          and cannot remove the one on screen, so it needs no handling. It used
          to swap the surface for this spinner, which dropped the grid's handle,
          and an emptied handle is the lightbox's rule for closing (#285). */}
      {firstLoad ? (
        <div
          data-slot="review-loading"
          className="flex flex-1 items-center justify-center"
        >
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        /* The same box the library page gives the same grid, which is the whole
           of what this line is now: full width, and the `p-4` the virtualiser
           over there was measured against (ADR 0027). It used to be
           `mx-auto max-w-[1920px] p-6`, so one page capped and centred its
           cards and the other let them fill the window — one grid at two card
           sizes with two gutters, decided by which tab was up.
           The cap is what went: a library of 5,000 cannot have one, because the
           grid derives its row height from the scroller's width and a narrower
           box inside that scroller would put the window against a row height
           nothing has. So Review gives up the cap rather than Library going and
           getting one.

           `w-full` stays, and it is load-bearing rather than tidiness. The grid
           inside is `minmax(0, 1fr)` columns, whose intrinsic contribution is
           nothing, so a box that is ever sized `fit-content` collapses the whole
           worklist to cards twelve pixels wide — which is what the `mx-auto`
           above used to risk, since auto cross-axis margins suppress a flex
           item's `stretch`.
           WebKitGTK's first layout stretched it anyway and its relayout did
           not, so the collapse appeared only on the second visit: ADR 0015
           hides this view with `display: none` rather than unmounting it, and
           the way back is a fresh layout (#190).

           The `animate-in fade-in duration-500` went with the padding. It fired
           on every refetch, so a Refresh flashed the whole grid out and back,
           and no other view in the app announces itself that way.

           It is its own scroller, the way the library page's rows are, so the
           bar above stays put while the worklist scrolls under it. */
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-4">
          {wallpapers.length === 0 ? (
            /* The shared state, so this page's "nothing here" is built the same
               way the library page's two are (ADR 0015). The route out names
               the destination the way the chrome's tab does — Rank is the view,
               and "Ranking" was a fourth word for it. */
            <EmptyState
              icon={Check}
              action="Go to Rank"
              onAction={() => setView("rank")}
            >
              No wallpapers to review.
            </EmptyState>
          ) : /* The grid is the shared one, and Review's own `div.grid` went with
               the card markup it used to hold. One tab stop with a roving
               selection, so the keyboard reaches every card here the same way it
               reaches every card on a library page mounting thirty of five
               thousand — a second interaction model to learn is worse than the
               one it would save (ADR 0019). Review needs no `reveal`: it mounts
               every row, so the default scroll-into-view is the whole of it.

               The confirm dialog that used to hang off Reject went the same way.
               Act-then-undo is in its place: the reject toast offers an Undo and
               the shell's `Ctrl+Z` presses it, so one interruption per reject is
               enough (ADR 0009, ADR 0017).

               `animated` is Review's alone. ADR 0016 gives the library's instance
               of this card no animated property and no `will-change`, and ADR
               0007's licence stays scoped to the fifty rows it was measured on —
               which is now the middle of the worklist sizes rather than all of
               them, since a curator may ask for a hundred (#259). Nothing has
               re-measured it at that length.

               The strip beside it is the other layout the bar offers, and the
               two are handed the same three things: the worklist, `perform`, and
               the setter that publishes a selection. Nothing below this line
               knows which one is up — the lightbox takes the handle, and both
               surfaces publish the same one — which is what keeps "the Lightbox
               opens from the strip" a property of the seam rather than a second
               wiring (ADR 0022, #265).

               Swapping layout unmounts one surface and mounts the other, so the
               incoming one is handed the wallpaper the outgoing one was on —
               see `handOver`. The alternative is a cursor living above both,
               which is the shape #230 took it out of. */
          layout === "strip" ? (
            <ReviewStrip
              ref={setGrid}
              wallpapers={wallpapers}
              label="Wallpapers to review"
              onAction={perform}
              onOpen={lightbox.openOn}
              minimumResolution={settings.minimum_resolution}
              evaluatedThreshold={settings.evaluated_threshold}
              startOn={resumeOn}
              filmstripStep={filmstripStep}
            />
          ) : (
            /* The grid's `density` is the same gesture Library answers, on
               #254's range for this tab: one to six cards to a row, starting on
               four, where Library runs two to ten. This page's cards are
               wallpapers the curator is deciding about, so it stops shorter and
               goes larger (#264). */
            <WallpaperGrid
              ref={setGrid}
              wallpapers={wallpapers}
              label="Wallpapers to review"
              onAction={perform}
              onOpen={lightbox.openOn}
              minimumResolution={settings.minimum_resolution}
              evaluatedThreshold={settings.evaluated_threshold}
              animated
              className="pb-8"
              startOn={resumeOn}
              density="review"
              zoom={gridZoom}
            />
          )}
        </div>
      )}

      {/* The same component the library page mounts, subscribing to the same
          selection the grid above is drawing, with no argument saying which page
          it is: the action set in it comes off the wallpaper's Status, and
          Review's list holds only Active rows, so Restore and Make Active never
          appear here without anyone configuring that (ADR 0022).

          `onAction` is the same `perform` the grid behind it is handed, so a
          keep from inside the lightbox is this page's keep — the optimistic removal, the published
          patch and the toast — and the advance the curator sees is that removal
          resolving through the shared selection rather than anything the
          lightbox decided.

          Outside the two branches above, so an emptied list closes it onto
          this page's own empty state rather than unmounting it out from under
          the focus restore. Its pixels land in the shell regardless — the
          portal is what keeps a `position: fixed` surface from being clipped to
          the `animate-in` container above. */}
      <Lightbox
        grid={grid}
        open={lightbox.open}
        onClose={lightbox.close}
        onAction={perform}
      />
    </>
  );
}
