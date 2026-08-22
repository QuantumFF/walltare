import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useApp } from "@/context/AppContext";
import {
  client,
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

type Side = "left" | "right";

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

  // Synchronous re-entry guard so rapid double inputs register one Comparison.
  const busyRef = useRef(false);
  const currentPairRef = useRef(currentPair);
  const nextPairRef = useRef(nextPair);
  const prefetchTokenRef = useRef(0);

  const prefetchNextPair = useCallback(async () => {
    const token = ++prefetchTokenRef.current;
    try {
      const pair = await client.getPair();
      if (token !== prefetchTokenRef.current) return; // stale prefetch
      setNextPair(pair);
      nextPairRef.current = pair;
      preloadPair(pair);
    } catch (error) {
      console.error("Failed to prefetch next pair:", error);
    }
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
      } catch (error) {
        console.error("Failed to load pair:", error);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prefetchNextPair]);

  const handleVote = useCallback(
    async (winner: Wallpaper, loser: Wallpaper, side: Side) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setVoting(side);

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

        const outcome = await client.vote(winner.id, loser.id);

        // Headline updates from the response alone; its next_pair fills the
        // now-empty prefetch slot.
        setStats(outcome.stats);
        if (!prefetched) {
          setCurrentPair(outcome.next_pair);
          currentPairRef.current = outcome.next_pair;
        }
        setNextPair(outcome.next_pair);
        nextPairRef.current = outcome.next_pair;
        preloadPair(outcome.next_pair);
      } catch (error) {
        console.error("Failed to submit vote:", error);
      } finally {
        setVoting(null);
        busyRef.current = false;
      }
    },
    [],
  );

  const handleSkip = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSkipping(true);

    try {
      prefetchTokenRef.current += 1;
      const pair = await client.getPair();
      setCurrentPair(pair);
      currentPairRef.current = pair;
      setNextPair(null);
      nextPairRef.current = null;
      void prefetchNextPair();
    } catch (error) {
      console.error("Failed to fetch a fresh pair:", error);
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
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Error loading wallpapers.
        </div>
      </>
    );
  }

  const [left, right] = currentPair;

  return (
    <div className="flex h-full w-full max-w-[1920px] min-h-0 mx-auto flex-1 flex-col p-4">
      <h1 className="sr-only">Rank</h1>


      <div className="flex w-full flex-1 flex-col justify-center gap-4">
        {/* Progress headline */}
        <div className="mx-auto w-full max-w-2xl space-y-2">
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Progress
              </span>
              <span className="text-2xl font-bold" aria-live="polite">
                {stats?.percentage.toFixed(1)}%
              </span>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
              <span aria-live="polite">
                <span className="font-medium text-foreground">
                  {stats?.participated_count}
                </span>{" "}
                / {stats?.total_wallpapers} Rated
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {stats?.total_comparisons}
                </span>{" "}
                Comparisons
              </span>
            </div>
          </div>
          <Progress value={stats?.percentage ?? 0} className="h-2" />
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
                <img
                  src={wallpaperImageUrl(left.id, IMAGE_SIZE)}
                  alt="Left Wallpaper"
                  className="h-full w-full bg-black/20 object-cover"
                />
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
                  src={wallpaperImageUrl(right.id, IMAGE_SIZE)}
                  alt="Right Wallpaper"
                  className="h-full w-full bg-black/20 object-cover"
                />
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
