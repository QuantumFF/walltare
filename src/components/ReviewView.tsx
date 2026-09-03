import { Lightbox, useLightbox } from "@/components/Lightbox";
import { PageBar } from "@/components/PageBar";
import {
  RejectDestinationLine,
  useRejectDestination,
} from "@/components/RejectDestination";
import { useToaster } from "@/components/ToastSurface";
import {
  useGridSelection,
  WallpaperGrid,
  type WallpaperGridHandle,
} from "@/components/WallpaperGrid";
import { useWallpaperRows } from "@/components/useWallpaperRows";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useRefetchWhenShown } from "@/context/AppEventsContext";
import { client } from "@/lib/client";
import { ArrowLeft, Check, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How many cards the worklist holds. The only `limit` the listing is given —
 * the library page asks for everything (ADR 0028).
 */
export const REVIEW_LIMIT = 50;

export function ReviewView() {
  const [loading, setLoading] = useState(true);
  const { setView } = useApp();
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

  /**
   * The rows, and the four transitions on them (ADR 0023).
   *
   * `belongs` is Active, because Kept and Rejected never appear in review
   * (CONTEXT.md): a wallpaper that changed Status anywhere else leaves the list.
   * The other direction is not a patch this page can make — nothing in a row
   * says where it belongs in an ordering by Score — so a wallpaper that just
   * became Active arrives with the next fetch.
   *
   * `optimistic` is what makes this page's reject feel like one keystroke: the
   * card goes on the click and comes back with the selection if the write fails.
   *
   * Both of the fields below are forward references to hooks further down, and
   * neither is read during render. The selection is resolved over the rows this
   * module holds, and the module's re-insert is what puts the selection back on
   * the card it re-inserted; the fetch writes through `setRows`, and `owe` is
   * the deferral of that fetch.
   */
  const { rows, setRows, perform } = useWallpaperRows({
    belongs: (status) => status === "active",
    destination,
    owe: oweRefetch,
    optimistic: { selectId },
  });
  const wallpapers = rows ?? [];

  // The grid's selection, held here rather than inside the grid because ADR
  // 0022 has the lightbox render this same selection and keeps the lightbox's
  // state on the page that mounted the grid (#137). Both surfaces below read
  // this one object, which is what makes the lightbox a second rendering of the
  // grid rather than a cursor of its own: there is no sync rule between them
  // because there are not two things to sync.
  const selection = useGridSelection(wallpapers);
  // The grid's handle, passed twice: to the grid as its `ref`, and to the
  // lightbox as the way it hands focus back on the way down (ADR 0029).
  const grid = useRef<WallpaperGridHandle | null>(null);
  const lightbox = useLightbox(selection, grid);

  const fetchReviewList = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.listWallpapers(
        "active",
        "score_asc",
        REVIEW_LIMIT,
      );
      setRows(list);
    } catch (err) {
      console.error("Failed to fetch review list:", err);
      show({ kind: "load-failed", noun: "the review list", error: err });
    } finally {
      setLoading(false);
    }
  }, [setRows, show]);

  useEffect(() => {
    void fetchReviewList();
  }, [fetchReviewList]);

  // The one event this list answers with a fetch rather than with a patch, and
  // the fetch waits until Review is the view being shown: fifty thumbnail
  // requests from a hidden page are exactly what ADR 0012's dedicated
  // pre-generation thread exists to keep off the rank view's next pair.
  const owe = useRefetchWhenShown("review", fetchReviewList);

  // The two forward references the module above takes, as declarations so they
  // can be handed over before the hooks that answer them have run. Both fire
  // only from a transition: `selectId` from a failed one, `oweRefetch` from one
  // the backend refused over a stale row.
  function selectId(id: number) {
    selection.selectId(id);
  }

  function oweRefetch() {
    owe();
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
        <span className="font-medium whitespace-nowrap">
          Lowest Scores first
        </span>
        <RejectDestinationLine destination={destination} />
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchReviewList()}
            className="gap-2"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView("rank")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </PageBar>
    </>
  );

  return (
    <>
      {header}

      {/* One branch rather than an early return, because the lightbox below has
          to outlive it. A `library-scanned` refetch puts this page back in its
          loading state while the curator is looking at a wallpaper, and an
          early return would unmount the open dialog — leaving the shell holding
          an `inert` nothing would ever take back. ADR 0022 reads that rescan as
          needing no handling, which is only true while a refetch cannot tear
          the surface down. */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mx-auto flex h-full max-w-[1920px] flex-col gap-8 p-6 animate-in fade-in duration-500">
          {/* Content */}
          {wallpapers.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
              <Check className="h-12 w-12 opacity-20" />
              <p>No wallpapers to review.</p>
              <Button variant="link" onClick={() => setView("rank")}>
                Return to Ranking
              </Button>
            </div>
          ) : (
            /* The grid is the shared one, and Review's own `div.grid` went with
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
               0007's licence stays scoped to the fifty rows it was measured on. */
            <WallpaperGrid
              ref={grid}
              wallpapers={wallpapers}
              selection={selection}
              label="Wallpapers to review"
              onAction={perform}
              onOpen={lightbox.openOn}
              animated
              className="pb-8"
            />
          )}
        </div>
      )}

      {/* The same component the library page mounts, on the same selection the
          grid above is showing, with no argument saying which page it is: the
          action set in it comes off the wallpaper's Status, and Review's list
          holds only Active rows, so Restore and Make Active never appear here
          without anyone configuring that (ADR 0022).

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
        selection={selection}
        open={lightbox.open}
        onClose={lightbox.close}
        onAction={perform}
      />
    </>
  );
}
