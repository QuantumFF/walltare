import { rankKey } from "@/components/keymap";
import { PageBar } from "@/components/PageBar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SegmentedGroup } from "@/components/ui/segmented";
import {
  IMAGE_SIZE,
  useShowingQueue,
  type Failure,
} from "@/components/useShowingQueue";
import { useApp, useStats } from "@/context/AppContext";
import {
  wallpaperImageUrl,
  type RankMode,
  type Showing,
  type Stats,
  type Wallpaper,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  SkipForward,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const FAILURE_COPY: Record<Failure, string> = {
  vote: "That vote didn't save. Pick again.",
  "not-enough": "Ranking needs at least two wallpapers that aren't rejected.",
  load: "Failed to load wallpapers.",
};
const UNDECIDED_EXPLANATION_ID = "rank-undecided-explanation";

type Side = "left" | "right";

/** The two modes Rank offers, in the order the switch lists them. */
const MODES: readonly { value: RankMode; label: string }[] = [
  { value: "pairs", label: "Pairs" },
  { value: "fours", label: "Fours" },
];

/**
 * The Undecided count split by the Bar, in real counts. Decided is worked out on
 * every read, so the count can rise, and the explanation has to say so before
 * a rise reads as a bug (ADR 0059).
 */
function undecidedExplanation(stats: Stats | null): string {
  const undecided = stats?.undecided_count ?? 0;
  const eligible = stats?.eligible_count ?? 0;
  const below = stats?.decided_below_count ?? 0;
  const above = stats?.decided_above_count ?? 0;
  return `${undecided} of ${eligible} wallpapers are Undecided: the app isn't sure yet which side of the Bar they fall on. ${below} are Decided below it and ${above} above. It can go up as well as down: a surprising vote can make the app unsure again.`;
}

/**
 * Every Eligible wallpaper is Decided or a Close call (ADR 0060). An empty pool
 * has nothing to decide either, but it has no pair to keep ranking on, so it
 * gets no suggestion.
 */
function nothingLeftToDecide(stats: Stats | null): boolean {
  return (
    !!stats &&
    stats.eligible_count > 0 &&
    stats.undecided_count === stats.close_call_count
  );
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
  picked,
  passedOver,
  onPick,
  onSettled,
}: {
  side: Side;
  src: string;
  loaded: boolean;
  picked: boolean;
  passedOver: boolean;
  onPick: () => void;
  onSettled: () => void;
}) {
  const { alt, label, key, Icon } = PANES[side];

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

/** What a tile of a showing of four has been named, if anything. */
type Named = "best" | "worst" | null;

/**
 * One wallpaper of a showing of four, at the Screen's own ratio so it is judged
 * the way it would hang, with the key that picks it in its corner.
 *
 * A real button named by its position in the grid, `Wallpaper 1` to
 * `Wallpaper 4`, which is the key that presses it. The name says nothing about
 * the file, for the reason the pair's panes do not: where a wallpaper sits must
 * mean nothing, and a filename is a second thing to form a habit about.
 * Pressed is the best, which is also what a second press takes back.
 */
function Tile({
  slot,
  src,
  ratio,
  loaded,
  named,
  dimmed,
  onPick,
  onSettled,
}: {
  slot: number;
  src: string;
  ratio: number;
  loaded: boolean;
  named: Named;
  dimmed: boolean;
  onPick: () => void;
  onSettled: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Wallpaper ${slot + 1}`}
      aria-pressed={named === "best"}
      onClick={onPick}
      style={{ aspectRatio: ratio }}
      className={cn(
        "relative w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-[transform,opacity,filter] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        named === "best" && "ring-4 ring-emerald-500",
        named === "worst" && "ring-4 ring-destructive",
        dimmed && "scale-95 opacity-50 grayscale",
      )}
    >
      {/* Keyed on src for the reason a pane is: a swap must discard the old
          picture rather than show it until the new one lands. */}
      <img
        key={src}
        src={src}
        alt=""
        onLoad={onSettled}
        onError={onSettled}
        className="h-full w-full bg-black/20 object-cover"
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {named && (
        <span
          className={cn(
            "absolute top-2 left-2 flex animate-in items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow fade-in",
            named === "best" ? "bg-emerald-600" : "bg-destructive",
          )}
        >
          {named === "best" ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          {named === "best" ? "Best" : "Worst"}
        </span>
      )}
      <span className="absolute right-2 bottom-2 hidden md:block" aria-hidden>
        <Kbd>{slot + 1}</Kbd>
      </span>
    </button>
  );
}

export function RankView() {
  const { view, setView, settings, saveSetting } = useApp();
  const mode = settings.rank_mode;
  const ratio = settings.screen.width / settings.screen.height;
  const stats = useStats();
  const { current, pending, failure, vote, skip } = useShowingQueue(
    mode,
    view === "rank",
  );
  const voting = pending?.kind === "vote" ? pending : null;
  // The best of a showing of four, once named and until the worst is. Never
  // sent anywhere on its own: a showing half answered records nothing. Held
  // with the showing it was named on, so a showing that leaves the screen —
  // voted on, skipped, or gone with a wallpaper rejected elsewhere — takes
  // its best with it.
  const [namedBest, setNamedBest] = useState<{
    on: Showing;
    id: number;
  } | null>(null);
  // A best named and then left for another view is a showing half answered
  // too. The view stays mounted, so without this the best would still be
  // named on return. Adjusted during render, as the suggestion below is.
  if (view !== "rank" && namedBest) setNamedBest(null);
  const best = namedBest?.on === current ? namedBest.id : null;
  // Keep ranking puts the suggestion away until it is next true, so it resets
  // the moment a vote or a scan leaves something to decide again. Adjusted
  // during render rather than in an effect, so the suggestion never flashes
  // back for a frame when it becomes true again.
  const nothingLeft = nothingLeftToDecide(stats);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  if (!nothingLeft && suggestionDismissed) setSuggestionDismissed(false);
  // Image URLs the browser has finished fetching. Generating a medium
  // thumbnail off a 150MB source takes seconds, and until it lands the pane is
  // blank — so a pick made before every one lands is a pick on wallpapers the
  // user cannot see, and a Comparison is permanent.
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());

  const markFetched = useCallback((src: string) => {
    setFetched((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
  }, []);

  const srcs = current?.map((w) => wallpaperImageUrl(w.id, IMAGE_SIZE));
  const showingFetched = srcs?.every((src) => fetched.has(src)) ?? false;

  const pickOfTwo = useCallback(
    (slot: number) => {
      if (!showingFetched || current?.length !== 2) return;
      vote({ best: current[slot], worst: current[1 - slot], others: [] });
    },
    [current, showingFetched, vote],
  );

  /**
   * A pick on a showing of four: the first names the best, the best again
   * takes it back, and any other names the worst and commits.
   */
  const pickOfFour = useCallback(
    (picked: Wallpaper) => {
      if (pending || !showingFetched || current?.length !== 4) return;
      if (best === null) {
        setNamedBest({ on: current, id: picked.id });
      } else if (best === picked.id) {
        setNamedBest(null);
      } else {
        const bestOne = current.find((w) => w.id === best);
        if (!bestOne) return;
        // What is named shows through the vote's own pending from here, and a
        // vote that fails puts the showing back answered by nobody.
        setNamedBest(null);
        vote({
          best: bestOne,
          worst: picked,
          others: current.filter((w) => w.id !== best && w.id !== picked.id),
        });
      }
    },
    [best, current, pending, showingFetched, vote],
  );

  // Keyboard shortcuts mirror the click targets, and which ones are bound
  // follows the showing on screen: ← and → for a pair, 1 to 4 for four, and S
  // for either (keymap.ts).
  //
  // The listener is on `window` and the shell keeps this view mounted under
  // `display: none`, which keeps the listener live. So it is bound only while
  // Rank is the view being shown: without that gate, every arrow pressed in
  // Library or Review would record a permanent Comparison between two
  // wallpapers the curator was not even looking at (ADR 0015, as amended by
  // ADR 0019). Any future view-scoped global listener owes the same gate.
  //
  // `defaultPrevented` is the other half of the same rule. Bare keys belong to
  // whichever element has focus — the chrome's tablist walks with the arrows,
  // and the lightbox will — and to the view only when nothing in it does. An
  // element that has already answered the key marks it, and this fallback
  // stands down.
  useEffect(() => {
    if (view !== "rank" || !current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (pending || event.defaultPrevented) return;

      const intent = rankKey(event, current.length === 4 ? "four" : "pair");
      if (!intent) return;
      if (intent.kind === "skip") {
        skip();
      } else if (intent.kind === "take-back") {
        setNamedBest(null);
      } else if (current.length === 4) {
        pickOfFour(current[intent.slot]);
      } else {
        pickOfTwo(intent.slot);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [current, pending, pickOfFour, pickOfTwo, skip, view]);

  const explanation = undecidedExplanation(stats);

  // The Undecided headline, in the bar this page owns below the chrome. It
  // renders in every state, including while the first showing is still loading,
  // so that the page's own height never depends on what the backend has answered
  // yet. Shown raw, with no percentage or bar: the count can rise, and a
  // fraction moving backwards reads as a bug (ADR 0059).
  const header = (
    <>
      <h1 className="sr-only">Rank</h1>
      <PageBar>
        <span
          tabIndex={0}
          title={explanation}
          aria-describedby={UNDECIDED_EXPLANATION_ID}
          aria-live="polite"
          className="rounded-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {stats?.undecided_count ?? 0} / {stats?.eligible_count ?? 0} Undecided
        </span>
        <span id={UNDECIDED_EXPLANATION_ID} className="sr-only">
          {explanation}
        </span>
        {/* Pairs or fours, beside the headline, as Review's layout sits on its
            own bar. Pressed rather than checked for the reason that one is: a
            `radiogroup` would put the two on the arrow keys, and this page
            spends the arrows on voting. A refused write leaves the mode where
            it was, which the un-pressed button already says. */}
        <SegmentedGroup role="group" aria-label="Show">
          {MODES.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant="segment"
              aria-pressed={mode === value}
              onClick={() => {
                if (mode === value) return;
                void saveSetting("rank_mode", value).catch((error: unknown) => {
                  console.error("Failed to store the Rank mode:", error);
                });
              }}
            >
              {label}
            </Button>
          ))}
        </SegmentedGroup>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {stats?.total_comparisons}
            </span>{" "}
            Comparisons
          </span>
        </div>
      </PageBar>
      {nothingLeft && !suggestionDismissed && (
        // Under the headline and above the showing, which stays: the curator
        // can keep ranking, and showings keep coming, in whichever mode
        // (ADR 0060, ADR 0061).
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-4 py-2 text-sm"
        >
          <p className="text-muted-foreground">
            Nothing left to decide. The rest are Close calls, best settled in
            Review.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => setView("review")}>
              Start Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSuggestionDismissed(true)}
            >
              Keep ranking
            </Button>
          </div>
        </div>
      )}
    </>
  );

  // No showing yet, or none since the one on screen went with nothing behind
  // it, and the draw for it is out or owed until Rank is shown.
  if ((!current || !srcs) && !failure) {
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (!current || !srcs) {
    return (
      <>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <p role="alert">{FAILURE_COPY[failure ?? "load"]}</p>
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

  const four = current.length === 4;

  return (
    <>
      {header}

      {/* No maximum width: the showing is the whole of this page, so it takes
          the whole window rather than stopping at a 1920px column with the
          rest of a wide monitor left as margin. */}
      <div className="flex w-full min-h-0 flex-1 flex-col justify-center gap-4 p-4">
        {failure && (
          <p
            className="mx-auto text-sm text-destructive"
            role="alert"
            aria-live="polite"
          >
            {FAILURE_COPY[failure]}
          </p>
        )}

        {four ? (
          <>
            <p
              className="text-center text-sm text-muted-foreground"
              aria-live="polite"
            >
              {best === null ? (
                <>
                  Pick the{" "}
                  <b className="text-emerald-600 dark:text-emerald-400">best</b>
                </>
              ) : (
                <>
                  Now the <b className="text-destructive">worst</b>
                </>
              )}
            </p>
            {/* Two rows of two, each tile at the Screen's ratio, and no wider
                than lets both rows fit the window's height: 16rem is the
                chrome and page bar, this column's padding, the prompt, the gap
                between the rows and the Skip row. */}
            <div
              className="mx-auto grid w-full grid-cols-2 gap-4"
              style={{ maxWidth: `calc((100dvh - 16rem) * ${ratio} + 1rem)` }}
            >
              {current.map((wallpaper, slot) => {
                const src = srcs[slot];
                const named: Named =
                  (voting?.best ?? best) === wallpaper.id
                    ? "best"
                    : voting?.worst === wallpaper.id
                      ? "worst"
                      : null;
                return (
                  <Tile
                    key={wallpaper.id}
                    slot={slot}
                    src={src}
                    ratio={ratio}
                    loaded={fetched.has(src)}
                    named={named}
                    dimmed={voting !== null && named === null}
                    onPick={() => pickOfFour(wallpaper)}
                    onSettled={() => markFetched(src)}
                  />
                );
              })}
            </div>
          </>
        ) : (
          // The Comparison of two: the same component twice, with the side and
          // the wallpaper as the only difference between the two.
          //
          // As wide as the window allows, and no wider than its height does.
          // The panes are 16:9, so on a wide, short window their width would
          // otherwise drive a height taller than the view — and with the column
          // centred, the overflow falls off the top where it cannot be scrolled
          // to, taking the Skip button below with it. 14rem is everything else
          // in the window's height: the chrome and page bar, this column's
          // padding, the key under each pane and the Skip row.
          <div className="mx-auto grid w-full max-w-[calc((100dvh_-_14rem)_*_32_/_9_+_2rem)] grid-cols-2 items-start gap-4 md:gap-8">
            {(["left", "right"] as const).map((side, slot) => {
              const winner = current[slot];
              return (
                <Pane
                  key={side}
                  side={side}
                  src={srcs[slot]}
                  loaded={fetched.has(srcs[slot])}
                  picked={voting?.best === winner.id}
                  passedOver={voting !== null && voting.best !== winner.id}
                  onPick={() => pickOfTwo(slot)}
                  onSettled={() => markFetched(srcs[slot])}
                />
              );
            })}
          </div>
        )}

        {/* Skip, and nothing beside it but its key.

            A **Stop & Review** button used to sit here behind a divider, which
            is the shape ADR 0015 replaced: the chrome's tabs are the app's
            navigation, and a second control going to a destination already one
            click away in a fixed bar is the "two `setView` calls buried in a
            view's header" that ADR removed from Review. Skip stays because it
            is the one control here that has nowhere else to live — it changes
            the showing rather than the destination. */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={skip}
            disabled={pending !== null}
          >
            <SkipForward />
            {four ? "Skip these four" : "Skip pair"}
          </Button>
          <span className="hidden md:inline" aria-hidden>
            <Kbd>S</Kbd>
          </span>
        </div>
      </div>
    </>
  );
}
