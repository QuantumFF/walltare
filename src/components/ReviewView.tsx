import { PageBar } from "@/components/PageBar";
import { useToaster } from "@/components/ToastSurface";
import { WallpaperCard, type CardAction } from "@/components/WallpaperCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const DEFAULT_MOVE_PATH = "./rejected";

export function ReviewView() {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [movePath, setMovePath] = useState(DEFAULT_MOVE_PATH);
  const { setView } = useApp();
  const { publish } = useAppEvents();
  // Every failure this view can have now goes to the shell's one slot, and the
  // `role="alert"` paragraph that used to hold them is gone with the `error`
  // state behind it. Two error surfaces in one view is what ADR 0017 set out to
  // remove, and the generic strings it also removed — "Failed to keep
  // wallpaper. Please try again." — said less than the backend message that
  // replaces them.
  const { show } = useToaster();

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
      const finalPath = await client.moveWallpaper(id, movePath);
      publish({ type: "status-changed", id, status: "rejected" });
      if (removed) {
        show({
          kind: "rejected",
          view: "review",
          id,
          filename: removed.filename,
          destination: movePath,
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

  // The destination line, in the bar this page owns below the chrome. The
  // chrome's tab already names the page, so what was a 2xl heading and a
  // subtitle is the sentence that actually carries information: what Review
  // lists, and where a reject lands (ADR 0015). It renders while the list is
  // still loading too, so the page's height does not move under the curator.
  //
  // ADR 0018 replaces the field with a read-out of the stored destination and a
  // route into Settings, in the issue that reworks this whole view.
  const header = (
    <>
      <h1 className="sr-only">Review</h1>
      <PageBar>
        <span className="font-medium">Lowest Scores first</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 p-1">
            <span className="px-2 text-xs font-medium text-muted-foreground">
              Move to:
            </span>
            <Input
              aria-label="Move to:"
              value={movePath}
              onChange={(e) => setMovePath(e.target.value)}
              className="h-7 w-40 border-none bg-background shadow-none focus-visible:ring-0"
            />
          </div>
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 pb-8">
            {/* The card is the shared one, and the confirm dialog that used to
                hang off its Reject went with the markup it replaced. Act-then-undo
                is in its place: the reject toast offers an Undo and the shell's
                `Ctrl+Z` presses it, so one interruption per reject is enough
                (ADR 0009, ADR 0017).

                `animated` is Review's alone. ADR 0016 gives the library's
                instance of this card no animated property and no `will-change`,
                and ADR 0007's licence stays scoped to the fifty rows it was
                measured on. */}
            {wallpapers.map((wallpaper) => (
              <WallpaperCard
                key={wallpaper.id}
                wallpaper={wallpaper}
                onAction={handleAction}
                animated
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
