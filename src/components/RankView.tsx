import { PageBar } from "@/components/PageBar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { useApp } from "@/context/AppContext";
import { useAppEvent, useAppEvents } from "@/context/AppEventsContext";
import {
  client,
  isAppError,
  wallpaperImageUrl,
  type Stats,
  type Wallpaper,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  SkipForward,
  type LucideIcon,
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

/**
 * Everything that differs between the two sides, which is four strings and an
 * icon.
 *
 * The accessible name is worded the way the shortcuts dialog words the key that
 * does the same thing, so the two surfaces describing one action agree. The
 * `alt` stays positional and names no file: CONTEXT.md has the pair presented
 * in random order so that a habit does not become part of the rating, and a
 * filename is a second thing to form a habit about.
 */
const PANES: Record<
  Side,
  { alt: string; label: string; key: string; Icon: LucideIcon }
> = {
  left: {
    alt: "Left Wallpaper",
    label: "Pick the wallpaper on the left",
    key: "←",
    Icon: ArrowLeft,
  },
  right: {
    alt: "Right Wallpaper",
    label: "Pick the wallpaper on the right",
    key: "→",
    Icon: ArrowRight,
  },
};

/**
 * One side of the Comparison: the picture, what a pick does to it, and the key
 * that makes the pick.
 *
 * One component for both sides rather than the two near-identical blocks this
 * file carried — fifty lines duplicated with `left` and `right` swapped in eight
 * places, which is a correction somebody has to remember to make twice.
 *
 * **The frame is a real button.** It was a `<div>` with an `onClick`, which made
 * it the one interactive surface in the app that Tab could not reach and a
 * screen reader could not name. Rank's arrows are a `window` fallback that
 * stands down as soon as anything else answers the key (ADR 0015, as amended by
 * ADR 0019), so they are not a substitute for the control being focusable: they
 * are what fires when nothing is.
 *
 * The key below it is the whole of what used to be two labels. A `Select Left`
 * pill faded in on hover over a persistent `← Left Arrow` caption, so one action
 * carried two names, neither of which the card grids give their own click
 * target (ADR 0019). The name is on the button now, and what is left on screen
 * is the shortcut, which is the part the curator cannot discover by looking.
 */
function Pane({
  side,
  src,
  loaded,
  voting,
  onPick,
  onSettled,
}: {
  side: Side;
  src: string;
  loaded: boolean;
  voting: Side | null;
  onPick: () => void;
  onSettled: () => void;
}) {
  const { alt, label, key, Icon } = PANES[side];
  const picked = voting === side;
  const passedOver = voting !== null && !picked;

  return (
    <div className="group flex flex-col gap-3">
      <button
        type="button"
        aria-label={label}
        onClick={onPick}
        // The transition names its properties. `transition-all` animates every
        // one of them, which on a full-width `aspect-video` frame is the blunt
        // shape ADR 0007 measured the cost of — and the three below are the
        // three that ever move.
        className={cn(
          "relative aspect-video w-full cursor-pointer rounded-xl transition-[transform,opacity,filter] duration-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          passedOver && "scale-95 opacity-50 grayscale",
          picked
            ? "scale-[1.02] ring-4 ring-primary"
            : "group-hover:scale-[1.01]",
        )}
      >
        <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-card">
          {/* Keyed on src so a pane swap discards the old element rather than
              repainting the previous wallpaper until the new one arrives — the
              state in which a pick lands on a wallpaper the user never saw. */}
          <img
            key={src}
            src={src}
            alt={alt}
            onLoad={onSettled}
            onError={onSettled}
            className="h-full w-full bg-black/20 object-cover"
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-card">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {picked && (
            <div className="absolute inset-0 flex animate-in fade-in items-center justify-center bg-primary/20 duration-200">
              <div className="rounded-full bg-primary p-4 text-primary-foreground">
                <Icon className="h-8 w-8" />
              </div>
            </div>
          )}
        </div>
      </button>

      {/* The shortcut, drawn as a key rather than spelled out as prose, which
          is how the shortcuts dialog draws the same one. Hidden where the two
          panes are narrow enough that the keyboard is not the likely input. */}
      <div className="hidden justify-center md:flex" aria-hidden>
        <Kbd>{key}</Kbd>
      </div>
    </div>
  );
}

export function RankView() {
  const { view, setView } = useApp();
  const { publish } = useAppEvents();
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

        // Published before the mounted check, and before anything else is done
        // with the response: the Comparison is recorded and permanent, so both
        // of these are true whether or not this component is still around to
        // draw the consequences.
        //
        // The two ids and nothing else, because that is all Library can be told
        // for free — a Comparison answers with the whole `Stats` rather than
        // with two ratings, and asking the backend for the two rows would put a
        // query on the path between one pair and the next.
        publish({ type: "score-changed", ids: [winner.id, loser.id] });
        // The headline updates through the bus rather than beside it, so there
        // is one path into it: Rank is the only publisher of this today, and
        // #113's refetch after a scan is the next one, moving the same headline
        // back to Round 1 without Rank needing to know a scan happened.
        publish({ type: "stats-changed", stats: outcome.stats });

        if (!mountedRef.current) return;

        // With an empty prefetch slot, next_pair becomes the current pair and
        // the slot is refilled with a fresh pair so the two never show the same
        // Comparison twice.
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
    [pairFetched, prefetchNextPair, publish],
  );

  // The headline is a patch, and this is the whole of Rank's interest in what
  // happens elsewhere: the pair on screen is Rank's own business, and no other
  // view can change which two wallpapers it is showing.
  useAppEvent((event) => {
    if (event.type === "stats-changed") setStats(event.stats);
  });

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
  //
  // The listener is on `window` and the shell keeps this view mounted under
  // `display: none`, which keeps the listener live. So it is bound only while
  // Rank is the view being shown: without that gate, every arrow pressed in
  // Library or Review would record a permanent Comparison between two
  // wallpapers the curator was not even looking at (ADR 0015, as amended by
  // ADR 0019). Any future view-scoped global listener owes the same gate.
  //
  // `defaultPrevented` is the other half of the same rule. Bare arrows belong to
  // whichever element has focus — the chrome's tablist walks with them, and the
  // lightbox will — and to the view only when nothing in it does. An element
  // that has already answered the key marks it, and this fallback stands down.
  useEffect(() => {
    if (view !== "rank") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const pair = currentPairRef.current;
      if (!pair || busyRef.current || event.defaultPrevented) return;

      if (event.key === "ArrowLeft") {
        void handleVote(pair[0], pair[1], "left");
      } else if (event.key === "ArrowRight") {
        void handleVote(pair[1], pair[0], "right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleVote, view]);

  const percent = roundPercent(stats);
  const explanation = roundExplanation(stats);

  // The Round headline, in the bar this page owns below the chrome. It renders
  // in every state, including while the first pair is still loading, so that the
  // page's own height never depends on what the backend has answered yet.
  const header = (
    <>
      <h1 className="sr-only">Rank</h1>
      <PageBar>
        <span className="font-medium" aria-live="polite">
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
        <Progress value={percent} className="h-1.5 w-40" />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
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

  if (!currentPair) {
    return (
      <>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <p role="alert">{error ?? LOAD_FAILED_ERROR}</p>
          {/* The chrome's tabs are the way out of this now, so this button is a
              second one rather than the only one. It stays because the sentence
              above it names Review as the fix. */}
          <Button variant="outline" onClick={() => setView("review")}>
            Go to Review
          </Button>
        </div>
      </>
    );
  }

  const [left, right] = currentPair;
  const [leftSrc, rightSrc] = srcs as [string, string];

  return (
    <>
      {header}

      {/* No maximum width: the pair is the whole of this page, so it takes the
          whole window rather than stopping at a 1920px column with the rest of
          a wide monitor left as margin. */}
      <div className="flex w-full min-h-0 flex-1 flex-col justify-center gap-4 p-4">
        {error && (
          <p
            className="mx-auto text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        )}

        {/* The Comparison itself: the same component twice, with the side and
            the wallpaper as the only difference between the two. */}
        {/* As wide as the window allows, and no wider than its height does.
            The panes are 16:9, so on a wide, short window their width would
            otherwise drive a height taller than the view — and with the column
            centred, the overflow falls off the top where it cannot be scrolled
            to, taking the Skip button below with it. 14rem is everything else
            in the window's height: the chrome and page bar, this column's
            padding, the key under each pane and the Skip row. */}
        <div className="mx-auto grid w-full max-w-[calc((100dvh_-_14rem)_*_32_/_9_+_2rem)] grid-cols-2 items-start gap-4 md:gap-8">
          <Pane
            side="left"
            src={leftSrc}
            loaded={fetched.has(leftSrc)}
            voting={voting}
            onPick={() => void handleVote(left, right, "left")}
            onSettled={() => markFetched(leftSrc)}
          />
          <Pane
            side="right"
            src={rightSrc}
            loaded={fetched.has(rightSrc)}
            voting={voting}
            onPick={() => void handleVote(right, left, "right")}
            onSettled={() => markFetched(rightSrc)}
          />
        </div>

        {/* Skip, and nothing beside it.

            A **Stop & Review** button used to sit here behind a divider, which
            is the shape ADR 0015 replaced: the chrome's tabs are the app's
            navigation, and a second control going to a destination already one
            click away in a fixed bar is the "two `setView` calls buried in a
            view's header" that ADR removed from Review. Skip stays because it
            is the one control here that has nowhere else to live — it changes
            the pair rather than the destination. */}
        <div className="flex items-center justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSkip()}
            disabled={voting !== null || skipping}
          >
            <SkipForward />
            Skip pair
          </Button>
        </div>
      </div>
    </>
  );
}
