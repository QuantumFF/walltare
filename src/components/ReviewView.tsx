import { PageBar } from "@/components/PageBar";
import {
  RejectDestinationLine,
  useRejectDestination,
} from "@/components/RejectDestination";
import { useToaster } from "@/components/ToastSurface";
import type { CardAction } from "@/components/WallpaperCard";
import { useGridSelection, WallpaperGrid } from "@/components/WallpaperGrid";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import {
  useAppEvent,
  useAppEvents,
  useRefetchWhenShown,
} from "@/context/AppEventsContext";
import { client, type Wallpaper } from "@/lib/client";
import { ArrowLeft, Check, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export const REVIEW_LIMIT = 50;

export function ReviewView() {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [loading, setLoading] = useState(true);
  const { setView } = useApp();
  // Where a reject goes, read once for the line on the bar, for the string
  // `move_wallpaper` is handed and for what the toast has left to say. The
  // `movePath` state that used to stand here is gone with the field that edited
  // it: it configured a global preference from inside one of the views that
  // consumes it, defaulted to a hardcoded `./rejected` and reset on every launch
  // (ADR 0010, ADR 0018).
  const destination = useRejectDestination();
  const { publish } = useAppEvents();
  // Every failure this view can have now goes to the shell's one slot, and the
  // `role="alert"` paragraph that used to hold them is gone with the `error`
  // state behind it. Two error surfaces in one view is what ADR 0017 set out to
  // remove, and the generic strings it also removed — "Failed to keep
  // wallpaper. Please try again." — said less than the backend message that
  // replaces them.
  const { show } = useToaster();
  // The grid's selection, held here rather than inside the grid because ADR
  // 0022 has the lightbox render this same selection and keeps the lightbox's
  // state on the page that mounted the grid. Nothing on this page reads it yet;
  // it is handed straight back down, and #80 is the first caller of any of it —
  // starting with the failure handler below, which re-inserts a card the
  // selection has by then moved off (#137).
  const selection = useGridSelection(wallpapers);

  const fetchReviewList = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.getReview(REVIEW_LIMIT);
      setWallpapers(list);
    } catch (err) {
      console.error("Failed to fetch review list:", err);
      show({ kind: "load-failed", noun: "the review list", error: err });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    void fetchReviewList();
  }, [fetchReviewList]);

  // The one event this list answers with a fetch rather than with a patch, and
  // the fetch waits until Review is the view being shown: fifty thumbnail
  // requests from a hidden page are exactly what ADR 0012's dedicated
  // pre-generation thread exists to keep off the rank view's next pair.
  useRefetchWhenShown("review", fetchReviewList);

  // Kept and Rejected never appear in review (CONTEXT.md), so a wallpaper that
  // changed Status anywhere else leaves the list, and the card is the one thing
  // that has to move. The other direction is not a patch this view can make: an
  // event carries an id and not a row, so nothing here knows what a wallpaper
  // that just became Active looks like or where it belongs in an ordering by
  // Score. It arrives with the next fetch.
  useAppEvent((event) => {
    if (event.type !== "status-changed" || event.status === "active") return;
    setWallpapers((prev) => prev.filter((w) => w.id !== event.id));
  });

  // Puts one card back where it was after a failed action.
  //
  // Restoring a whole snapshot of the list would resurrect any *other* card
  // that was successfully removed while this action was in flight — the
  // snapshot is captured at render time and goes stale the moment a second
  // action starts. Re-inserting only the affected card cannot do that.
  const restoreCard = (index: number, wallpaper: Wallpaper) => {
    setWallpapers((prev) => {
      if (prev.some((w) => w.id === wallpaper.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, wallpaper);
      return next;
    });
  };

  const handleKeep = async (id: number) => {
    // Optimistic removal; restore the card if the persist fails.
    const index = wallpapers.findIndex((w) => w.id === id);
    const removed = wallpapers[index];
    setWallpapers((prev) => prev.filter((w) => w.id !== id));
    try {
      await client.keepWallpaper(id);
      // After the write and not before it: a card removed optimistically comes
      // back if the write fails, and a Library that had already greyed the row
      // would be the one place the failure did not reach.
      publish({ type: "status-changed", id, status: "kept" });
      // The card is already gone by the time this lands, which is the whole
      // reason it toasts: a card that vanishes is not a confirmation, and the
      // Undo is what replaces the confirm step (ADR 0009, ADR 0017).
      if (removed) {
        show({ kind: "kept", view: "review", id, filename: removed.filename });
      }
    } catch (err) {
      console.error("Failed to keep wallpaper:", err);
      // The card goes back in the grid and the toast reports why. Both: the
      // toast is replaceable and the grid is the durable evidence.
      if (removed) {
        restoreCard(index, removed);
        show({
          kind: "failed",
          view: "review",
          action: "keep",
          filename: removed.filename,
          error: err,
        });
      }
    }
  };

  const handleMove = async (id: number) => {
    const index = wallpapers.findIndex((w) => w.id === id);
    const removed = wallpapers[index];
    setWallpapers((prev) => prev.filter((w) => w.id !== id));
    try {
      // The path the file landed at is read now: `unique_destination` suffixes
      // ` (n)` on a collision, so this is the only account of what the file is
      // called on the far side, and the toast decides whether it has anything
      // to say (ADR 0003, ADR 0017).
      const finalPath = await client.moveWallpaper(id, destination.written);
      publish({ type: "status-changed", id, status: "rejected" });
      if (removed) {
        show({
          kind: "rejected",
          view: "review",
          id,
          filename: removed.filename,
          // The read-out's own boolean, handed over rather than worked out
          // again from the string. It is what decides whether the toast has a
          // path to name, and a second answer computed somewhere else would
          // disagree with the bar on exactly the destinations the string cannot
          // be asked about — `$HOME/bin` looks relative and is not (ADR 0018).
          relativeDestination: destination.relative,
          finalPath,
        });
      }
    } catch (err) {
      console.error("Failed to move wallpaper:", err);
      if (removed) {
        restoreCard(index, removed);
        show({
          kind: "failed",
          view: "review",
          action: "reject",
          filename: removed.filename,
          error: err,
        });
      }
    }
  };

  // What a card asks for, routed to the two handlers that already existed.
  //
  // Review lists Active wallpapers only (CONTEXT.md), so Keep and Reject are
  // the only two that can arrive here; Make Active and Restore are offered by
  // the same card on the library page, which is the page that mounts a Kept or
  // a Rejected row. Nothing branches on the wallpaper: the card decides what to
  // offer from the Status it was handed, and this only says who answers.
  const handleAction = (action: CardAction, card: Wallpaper) => {
    if (action === "keep") void handleKeep(card.id);
    if (action === "reject") void handleMove(card.id);
  };

  /**
   * A click on a card asks for the lightbox, here as well as on the library
   * page (#134).
   *
   * **The lightbox is #80 and does not exist**, so this opens nothing, calls
   * nothing and changes no Status. Review is wired for it anyway rather than
   * left to inherit it later: the card is shared, so the gesture is already on
   * every card in this grid, and ADR 0022 keeps the state on whichever page
   * mounted the grid — so the page that shows the fifty needs its own answer to
   * a click the same way the library page does. The action set inside the
   * lightbox is read off the Status, so nothing here has to tell it that Review
   * lists Active wallpapers only.
   *
   * It takes no argument yet, for the same reason the library page's does not:
   * the wallpaper arrives and there is nowhere to put it until #80 lands.
   */
  const handleOpen = () => {};

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

  if (loading) {
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  return (
    <>
      {header}

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
            wallpapers={wallpapers}
            selection={selection}
            label="Wallpapers to review"
            onAction={handleAction}
            onOpen={handleOpen}
            animated
            className="pb-8"
          />
        )}
      </div>
    </>
  );
}
