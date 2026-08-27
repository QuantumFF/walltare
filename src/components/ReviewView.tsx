import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageBar } from "@/components/PageBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import {
  useAppEvent,
  useAppEvents,
  useRefetchWhenShown,
} from "@/context/AppEventsContext";
import { client, wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import {
  ArrowLeft,
  Check,
  FolderInput,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export const REVIEW_LIMIT = 50;

/**
 * A review card. Carries no hover shadow, deliberately.
 *
 * A wheel scroll holds the pointer still while cards stream underneath, so
 * every card that passes fires `:hover`. Changing `box-shadow` there repaints
 * outside the card's own bounds, and measured against a real WebKitGTK view it
 * took the grid from a locked 60fps to 38 with every frame late — which is why
 * the wheel felt worse than the scrollbar, where the pointer never crosses the
 * grid. Dropping only the transition still dropped half the frames, so it is
 * the repaint and not the animation. The overlay fade, the image scale, and
 * the backdrop blurs all measured free. See ADR 0006.
 *
 * The image and the overlay declare `will-change` for the one property each
 * animates, which is why the fade and the scale stay affordable. Without it
 * WebKit builds those two composited layers the first time a card is hovered,
 * and that lands mid-gesture: one ~50-95ms stall per card, scaling with the
 * card's pixel area, until every card on screen has been passed over once.
 * See ADR 0007.
 */
const CARD_CLASS =
  "group relative aspect-video bg-card rounded-xl overflow-hidden border border-border shadow-sm";
const DEFAULT_MOVE_PATH = "./rejected";
const LOAD_FAILED_ERROR = "Failed to load the review list.";
const KEEP_FAILED_ERROR = "Failed to keep wallpaper. Please try again.";
const MOVE_FAILED_ERROR = "Failed to move wallpaper. Please check the destination.";

export function ReviewView() {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movePath, setMovePath] = useState(DEFAULT_MOVE_PATH);
  const { setView } = useApp();
  const { publish } = useAppEvents();

  const fetchReviewList = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.getReview(REVIEW_LIMIT);
      setWallpapers(list);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch review list:", err);
      setError(LOAD_FAILED_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setError(null);
    try {
      await client.keepWallpaper(id);
      // After the write and not before it: a card removed optimistically comes
      // back if the write fails, and a Library that had already greyed the row
      // would be the one place the failure did not reach.
      publish({ type: "status-changed", id, status: "kept" });
    } catch (err) {
      console.error("Failed to keep wallpaper:", err);
      if (removed) restoreCard(index, removed);
      setError(KEEP_FAILED_ERROR);
    }
  };

  const handleMove = async (id: number) => {
    const index = wallpapers.findIndex((w) => w.id === id);
    const removed = wallpapers[index];
    setWallpapers((prev) => prev.filter((w) => w.id !== id));
    setError(null);
    try {
      // The path the file landed at goes unread here. Review has a confirm
      // dialog rather than a toast, so it has nowhere to report a rename yet;
      // that arrives with the reject toast when Review is rebuilt.
      await client.moveWallpaper(id, movePath);
      publish({ type: "status-changed", id, status: "rejected" });
    } catch (err) {
      console.error("Failed to move wallpaper:", err);
      if (removed) restoreCard(index, removed);
      setError(MOVE_FAILED_ERROR);
    }
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
        {error && (
          <p
            className="text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        )}

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
            {wallpapers.map((wallpaper) => (
              <div
                key={wallpaper.id}
                className={CARD_CLASS}
              >
                <img
                  src={wallpaperImageUrl(wallpaper.id, "small")}
                  alt={wallpaper.filename}
                  className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105 will-change-transform"
                />

                {/* Rating Badge */}
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="bg-black/60 backdrop-blur-md text-white border-none"
                  >
                    {wallpaper.rating_mu.toFixed(1)}
                  </Badge>
                </div>

                {/* Hover Actions Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity will-change-[opacity] flex flex-col items-center justify-center gap-3 p-4 backdrop-blur-[2px]">
                  <p className="text-white text-xs font-medium truncate w-full text-center px-2 mb-2">
                    {wallpaper.filename}
                  </p>
                  <div className="flex gap-2 w-full max-w-[200px]">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 bg-white/10 hover:bg-white/20 text-white border-none"
                      aria-label={`Keep ${wallpaper.filename}`}
                      onClick={() => void handleKeep(wallpaper.id)}
                    >
                      <Check className="mr-2 h-3 w-3" />
                      Keep
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="flex-1"
                          aria-label={`Move ${wallpaper.filename}`}
                        >
                          <FolderInput className="mr-2 h-3 w-3" />
                          Move
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Move Wallpaper?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will move "{wallpaper.filename}" to "{movePath}".
                            It will be soft-rejected: out of voting and review,
                            its history preserved.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleMove(wallpaper.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Move File
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
