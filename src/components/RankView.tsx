import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApp } from "@/context/AppContext";
import {
  client,
  isAppError,
  wallpaperImageUrl,
  type Stats,
  type Wallpaper,
} from "@/lib/client";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  SkipForward,
  StopCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const PICK_FEEDBACK_MS = 300;
const IMAGE_SIZE = "medium";
const VOTE_FAILED_ERROR = "That vote didn't save. Pick again.";
const NOT_ENOUGH_ERROR =
  "Ranking needs at least two wallpapers that aren't rejected.";
const LOAD_FAILED_ERROR = "Failed to load wallpapers.";
const ROUND_EXPLANATION_ID = "rank-round-explanation";

type Side = "left" | "right";

/**
 * Within-Round progress, as a whole percent. An empty Eligible pool is a
 * library that is about to start Round 1, not one at NaN%.
 */
function roundPercent(stats: Stats | null): number {
  if (!stats || stats.eligible_count === 0) return 0;
  return Math.round(
    (stats.round_participated_count / stats.eligible_count) * 100,
  );
}

/**
 * The Round rule in real counts. The Round is derived from comparison counts
 * the user never sees (ADR 0008), so the number has to explain itself.
 */
function roundExplanation(stats: Stats | null): string {
  const round = stats?.round ?? 1;
  const times = round === 1 ? "1 time" : `${round} times`;
  return `Round ${round}: ${stats?.round_participated_count ?? 0} of ${stats?.eligible_count ?? 0} wallpapers have been compared at least ${times}.`;
}

/** The ids in a pair slot, for the exclusion `getPair`/`vote` accept. */
function idsOf(pair: [Wallpaper, Wallpaper] | null): number[] {
  return pair ? [pair[0].id, pair[1].id] : [];
}

/** Warm the browser cache so the swapped-in pair renders without a gap. */
function preloadPair(pair: [Wallpaper, Wallpaper]): void {
  for (const wallpaper of pair) {
    const img = new Image();
    img.src = wallpaperImageUrl(wallpaper.id, IMAGE_SIZE);
  }
}

export function RankView() {
  const { setView } = useApp();
  const [currentPair, setCurrentPair] = useState<[Wallpaper, Wallpaper] | null>(
    null,
  );
  const [nextPair, setNextPair] = useState<[Wallpaper, Wallpaper] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<Side | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Image URLs the browser has finished fetching. Generating a medium
  // thumbnail off a 150MB source takes seconds, and until it lands the pane is
  // blank — so a pick made before both land is a pick on wallpapers the user
  // cannot see, and a Comparison is permanent.
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());

  const markFetched = useCallback((src: string) => {
    setFetched((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
  }, []);

  const srcs = currentPair?.map((w) => wallpaperImageUrl(w.id, IMAGE_SIZE));
  const pairFetched = srcs?.every((src) => fetched.has(src)) ?? false;

  // Synchronous re-entry guard so rapid double inputs register one Comparison.
  const busyRef = useRef(false);
  const currentPairRef = useRef(currentPair);
  const nextPairRef = useRef(nextPair);
  const prefetchTokenRef = useRef(0);
  // Prefetches outlive the component; without this they set state after unmount.
  const mountedRef = useRef(true);

  const prefetchNextPair = useCallback(async () => {
    const token = ++prefetchTokenRef.current;
    try {
      const pair = await client.getPair(idsOf(currentPairRef.current));
      if (!mountedRef.current) return;
      if (token !== prefetchTokenRef.current) return; // stale prefetch
      setNextPair(pair);
      nextPairRef.current = pair;
      preloadPair(pair);
    } catch (error) {
      console.error("Failed to prefetch next pair:", error);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [pair, initialStats] = await Promise.all([
          client.getPair(),
          client.getStats(),
        ]);
        if (cancelled) return;
        setCurrentPair(pair);
        currentPairRef.current = pair;
        setStats(initialStats);
        setLoading(false);
        void prefetchNextPair();
      } catch (err) {
        console.error("Failed to load pair:", err);
        if (cancelled) return;
        setError(
          isAppError(err) && err.kind === "not_enough_wallpapers"
            ? NOT_ENOUGH_ERROR
            : LOAD_FAILED_ERROR,
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prefetchNextPair]);

  const handleVote = useCallback(
    async (winner: Wallpaper, loser: Wallpaper, side: Side) => {
      if (busyRef.current || !pairFetched) return;
      busyRef.current = true;
      setVoting(side);
      setError(null);

      // Kept so a failed vote can put the pair the user was looking at back;
      // the optimistic swap below has already moved on by then.
      const votedOn = currentPairRef.current;

      try {
        // Visual pick feedback before the swap.
        await new Promise((resolve) => setTimeout(resolve, PICK_FEEDBACK_MS));

        // Optimistic swap into the prefetched pair, no loading gap.
        const prefetched = nextPairRef.current;
        if (prefetched) {
          prefetchTokenRef.current += 1; // invalidate in-flight prefetches
          setCurrentPair(prefetched);
          currentPairRef.current = prefetched;
          setNextPair(null);
          nextPairRef.current = null;
        }

        // `next_pair` refills the slot behind whatever is on screen now, so
        // exclude that too — the backend already excludes the two voted on.
        const outcome = await client.vote(
          winner.id,
          loser.id,
          idsOf(currentPairRef.current),
        );
        if (!mountedRef.current) return;

        // Headline updates from the response alone. With an empty prefetch
        // slot, next_pair becomes the current pair and the slot is refilled
        // with a fresh pair so the two never show the same Comparison twice.
        setStats(outcome.stats);
        if (!outcome.next_pair) {
          // The vote counted; only the follow-up fetch didn't. Refill whichever
          // slot is empty rather than leave the user on a pair they just voted
          // on — and never report this as a failed vote.
          if (prefetched) {
            void prefetchNextPair();
          } else {
            const fresh = await client
              .getPair([winner.id, loser.id])
              .catch(() => null);
            if (fresh && mountedRef.current) {
              setCurrentPair(fresh);
              currentPairRef.current = fresh;
              preloadPair(fresh);
              void prefetchNextPair();
            }
          }
          return;
        }
        if (prefetched) {
          setNextPair(outcome.next_pair);
          nextPairRef.current = outcome.next_pair;
        } else {
          setCurrentPair(outcome.next_pair);
          currentPairRef.current = outcome.next_pair;
          void prefetchNextPair();
        }
        preloadPair(outcome.next_pair);
      } catch (err) {
        console.error("Failed to submit vote:", err);
        if (!mountedRef.current) return;
        // Undo the optimistic swap: the Comparison was never recorded, so
        // silently advancing would drop the user's choice without telling them.
        if (votedOn) {
          setCurrentPair(votedOn);
          currentPairRef.current = votedOn;
        }
        setError(VOTE_FAILED_ERROR);
      } finally {
        setVoting(null);
        busyRef.current = false;
      }
    },
    [pairFetched, prefetchNextPair],
  );

  const handleSkip = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSkipping(true);
    setError(null);

    try {
      prefetchTokenRef.current += 1;
      // Skipping a pair means "not these two", so they stay out of the draw.
      const pair = await client.getPair(idsOf(currentPairRef.current));
      if (!mountedRef.current) return;
      setCurrentPair(pair);
      currentPairRef.current = pair;
      setNextPair(null);
      nextPairRef.current = null;
      void prefetchNextPair();
    } catch (err) {
      console.error("Failed to fetch a fresh pair:", err);
      if (!mountedRef.current) return;
      setError(
        isAppError(err) && err.kind === "not_enough_wallpapers"
          ? NOT_ENOUGH_ERROR
          : LOAD_FAILED_ERROR,
      );
    } finally {
      setSkipping(false);
      busyRef.current = false;
    }
  }, [prefetchNextPair]);

  // Keyboard shortcuts mirror the click targets: ← picks left, → picks right.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const pair = currentPairRef.current;
      if (!pair || busyRef.current) return;

      if (event.key === "ArrowLeft") {
        void handleVote(pair[0], pair[1], "left");
      } else if (event.key === "ArrowRight") {
        void handleVote(pair[1], pair[0], "right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleVote]);

  if (loading) {
    return (
      <>
        <h1 className="sr-only">Rank</h1>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (!currentPair) {
    return (
      <>
        <h1 className="sr-only">Rank</h1>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <p role="alert">{error ?? LOAD_FAILED_ERROR}</p>
          {/* Without a way out this screen is a dead end: there is no route
              back to scan, so the user would have to restart the app. */}
          <Button variant="outline" onClick={() => setView("review")}>
            Go to Review
          </Button>
        </div>
      </>
    );
  }

  const [left, right] = currentPair;
  const [leftSrc, rightSrc] = srcs as [string, string];
  const percent = roundPercent(stats);
  const explanation = roundExplanation(stats);

  return (
    <div className="flex h-full w-full max-w-[1920px] min-h-0 mx-auto flex-1 flex-col p-4">
      <h1 className="sr-only">Rank</h1>

      <div className="flex w-full flex-1 flex-col justify-center gap-4">
        {error && (
          <p
            className="mx-auto text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        )}

        {/* Progress headline */}
        <div className="mx-auto w-full max-w-2xl space-y-2">
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Progress
              </span>
              <span className="text-2xl font-bold" aria-live="polite">
                <span
                  tabIndex={0}
                  title={explanation}
                  aria-describedby={ROUND_EXPLANATION_ID}
                  className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  Round {stats?.round ?? 1}
                </span>{" "}
                · {percent}%
              </span>
              <span id={ROUND_EXPLANATION_ID} className="sr-only">
                {explanation}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
              <span aria-live="polite">
                <span className="font-medium text-foreground">
                  {stats?.evaluated_count ?? 0}
                </span>{" "}
                / {stats?.eligible_count ?? 0} Evaluated
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {stats?.total_comparisons}
                </span>{" "}
                Comparisons
              </span>
            </div>
          </div>
          <Progress value={percent} className="h-2" />
        </div>

        {/* Comparison area */}
        <div className="grid grid-cols-2 items-start gap-4 md:gap-8">
          {/* Left option */}
          <div
            className="group flex cursor-pointer flex-col gap-3"
            onClick={() => void handleVote(left, right, "left")}
          >
            <div
              className={`relative aspect-video w-full rounded-xl transition-all duration-300 ${
                voting === "right" ? "scale-95 opacity-50 grayscale" : ""
              } ${
                voting === "left"
                  ? "scale-[1.02] ring-4 ring-primary"
                  : "group-hover:scale-[1.01]"
              }`}
            >
              <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {/* Keyed on src so a pane swap discards the old element
                    rather than repainting the previous wallpaper until the
                    new one arrives — the state in which a pick lands on a
                    wallpaper the user never saw. */}
                <img
                  key={leftSrc}
                  src={leftSrc}
                  alt="Left Wallpaper"
                  onLoad={() => markFetched(leftSrc)}
                  onError={() => markFetched(leftSrc)}
                  className="h-full w-full bg-black/20 object-cover"
                />
                {!fetched.has(leftSrc) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-card">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
                  <span className="rounded-full bg-background/80 px-4 py-2 text-sm font-medium text-foreground opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    Select Left
                  </span>
                </div>
                {/* Pick feedback */}
                {voting === "left" && (
                  <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-primary/20 duration-200">
                    <div className="rounded-full bg-primary p-4 text-primary-foreground shadow-xl">
                      <ArrowLeft className="h-8 w-8" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <span className="hidden text-center text-xs font-medium text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 md:block">
              ← Left Arrow
            </span>
          </div>

          {/* Right option */}
          <div
            className="group flex cursor-pointer flex-col gap-3"
            onClick={() => void handleVote(right, left, "right")}
          >
            <div
              className={`relative aspect-video w-full rounded-xl transition-all duration-300 ${
                voting === "left" ? "scale-95 opacity-50 grayscale" : ""
              } ${
                voting === "right"
                  ? "scale-[1.02] ring-4 ring-primary"
                  : "group-hover:scale-[1.01]"
              }`}
            >
              <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <img
                  key={rightSrc}
                  src={rightSrc}
                  alt="Right Wallpaper"
                  onLoad={() => markFetched(rightSrc)}
                  onError={() => markFetched(rightSrc)}
                  className="h-full w-full bg-black/20 object-cover"
                />
                {!fetched.has(rightSrc) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-card">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
                  <span className="rounded-full bg-background/80 px-4 py-2 text-sm font-medium text-foreground opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    Select Right
                  </span>
                </div>
                {/* Pick feedback */}
                {voting === "right" && (
                  <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-primary/20 duration-200">
                    <div className="rounded-full bg-primary p-4 text-primary-foreground shadow-xl">
                      <ArrowRight className="h-8 w-8" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <span className="hidden text-center text-xs font-medium text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 md:block">
              Right Arrow →
            </span>
          </div>
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("review")}
            className="text-muted-foreground hover:text-foreground"
          >
            <StopCircle className="mr-2 h-4 w-4" />
            Stop &amp; Review
          </Button>

          <div className="h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSkip()}
            disabled={voting !== null || skipping}
            className="text-muted-foreground hover:text-foreground"
          >
            <SkipForward className="mr-2 h-4 w-4" />
            Skip Pair
          </Button>
        </div>
      </div>
    </div>
  );
}
