import { useAppEvent, useAppEvents } from "@/context/AppEventsContext";
import {
  client,
  isAppError,
  wallpaperImageUrl,
  type RankMode,
  type Showing,
  type Stats,
  type Wallpaper,
} from "@/lib/client";
import { isEligible } from "@/lib/wallpaper";
import { useEffect, useMemo, useRef, useState } from "react";

/** How long a pick shows as picked before the vote goes out. */
export const PICK_FEEDBACK_MS = 300;
export const IMAGE_SIZE = "medium";

/**
 * The vote a showing is waiting on: the best, the worst, and for four the two
 * named neither. A pair's best is its winner and its worst its loser.
 */
export interface Vote {
  best: Wallpaper;
  worst: Wallpaper;
  others: Wallpaper[];
}

/** Why there is something to say: the copy for each is the page's. */
export type Failure = "vote" | "load" | "not-enough";

/**
 * What the queue is waiting on. One thing at a time: a pick, a skip and a
 * refill all move the same two slots, so a second one waits for the first.
 */
export type Pending =
  /** A showing for the screen, in place of the one there or of none. */
  | { kind: "draw" }
  /**
   * A vote, from the pick until its answer. `votedOn` is what goes back on
   * screen if it fails, and is `null` once a wallpaper in it left the
   * Eligible pool: there is nothing left to put back, or to vote on.
   */
  | { kind: "vote"; best: number; worst: number; votedOn: Showing | null };

/**
 * The showing on screen and the one queued behind it.
 *
 * `next` is fetched while the curator looks at `current`, so a vote swaps it in
 * with no loading gap. Every movement between the two is a transition of this
 * reducer, so how the slots move is written once rather than in each of the
 * vote, the skip and the prefetch.
 */
export interface Slots {
  current: Showing | null;
  next: Showing | null;
  /**
   * The ticket of the prefetch still wanted for `next`, or `null` when none
   * is. Any change to `current` voids it: a prefetch is drawn to stay clear
   * of one showing, and behind another it can repeat it.
   */
  prefetch: number | null;
  tickets: number;
  pending: Pending | null;
  failure: Failure | null;
  /**
   * The ids the draw that fills an empty screen stays clear of: what was left
   * of the last showing when it went with nothing to take its place.
   */
  avoid: number[] | undefined;
}

export const EMPTY_SLOTS: Slots = {
  current: null,
  next: null,
  prefetch: null,
  tickets: 0,
  pending: null,
  failure: null,
  avoid: undefined,
};

export type SlotAction =
  | { type: "draw-sent" }
  | { type: "drawn"; showing: Showing }
  | { type: "draw-failed"; failure: Failure }
  | { type: "prefetch-sent" }
  | { type: "prefetched"; ticket: number; showing: Showing }
  | { type: "prefetch-failed"; ticket: number }
  | { type: "vote-cast"; best: number; worst: number }
  /** The pick's feedback has run out, and the vote is about to go. */
  | { type: "feedback-ended" }
  | { type: "vote-answered"; next: Showing | null }
  /**
   * `refused` is the backend saying a wallpaper in the showing sits out of
   * voting: it was rejected after it was drawn.
   */
  | { type: "vote-failed"; refused: boolean }
  /** A wallpaper stopped being Eligible, rejected from another view. */
  | { type: "left-pool"; id: number };

/** The ids in a showing, for the exclusion every fetch and vote accepts. */
export function idsOf(showing: Showing | null): number[] {
  return showing ? showing.map((w) => w.id) : [];
}

function holds(showing: Showing | null, id: number): boolean {
  return !!showing && showing.some((w) => w.id === id);
}

/** The vote in flight, if what is pending is one. */
function pendingVote(slots: Slots): Extract<Pending, { kind: "vote" }> | null {
  return slots.pending?.kind === "vote" ? slots.pending : null;
}

/** `current` replaced, which voids whatever was being prefetched behind it. */
function onScreen(
  slots: Slots,
  showing: Showing | null,
  avoid: number[] | undefined,
): Slots {
  return {
    ...slots,
    current: showing,
    prefetch: null,
    avoid: showing ? undefined : avoid,
  };
}

export function reduceSlots(slots: Slots, action: SlotAction): Slots {
  switch (action.type) {
    case "draw-sent":
      return {
        ...slots,
        pending: { kind: "draw" },
        prefetch: null,
        failure: null,
      };

    case "drawn":
      return {
        ...onScreen(slots, action.showing, undefined),
        next: null,
        pending: null,
        failure: null,
      };

    case "draw-failed":
      return { ...slots, pending: null, failure: action.failure };

    case "prefetch-sent":
      return {
        ...slots,
        tickets: slots.tickets + 1,
        prefetch: slots.tickets + 1,
      };

    case "prefetched":
      if (action.ticket !== slots.prefetch) return slots;
      return { ...slots, next: action.showing, prefetch: null };

    case "prefetch-failed":
      if (action.ticket !== slots.prefetch) return slots;
      return { ...slots, prefetch: null };

    case "vote-cast":
      return {
        ...slots,
        pending: {
          kind: "vote",
          best: action.best,
          worst: action.worst,
          votedOn: slots.current,
        },
        failure: null,
      };

    // The optimistic swap: the prefetched showing goes up before the backend
    // has answered. With nothing prefetched the showing voted on stays until
    // the answer replaces it, and a prefetch still out was drawn to sit behind
    // that showing, so it is no longer wanted.
    case "feedback-ended":
      if (!pendingVote(slots)) return slots;
      if (!slots.next) return { ...slots, prefetch: null };
      return { ...onScreen(slots, slots.next, undefined), next: null };

    case "vote-answered": {
      const vote = pendingVote(slots);
      if (!vote) return slots;
      const settled = { ...slots, pending: null };
      // Nothing was swapped in, so what is on screen is what was voted on, and
      // it goes whether or not the answer brought something to replace it.
      if (slots.current !== null && slots.current === vote.votedOn) {
        return onScreen(settled, action.next, idsOf(vote.votedOn));
      }
      if (!action.next) return settled;
      if (slots.current === null) {
        return onScreen(settled, action.next, undefined);
      }
      return slots.next ? settled : { ...settled, next: action.next };
    }

    case "vote-failed": {
      const vote = pendingVote(slots);
      if (!vote) return slots;
      const settled = { ...slots, pending: null };
      // A showing a wallpaper has left cannot be voted on again, so there is
      // nothing to roll back to and nothing to ask the curator to redo. Once
      // `left-pool` has seen to it, the slots have already moved.
      if (vote.votedOn === null) return settled;
      const swappedIn = slots.current !== vote.votedOn ? slots.current : null;
      if (action.refused) {
        return swappedIn
          ? settled
          : onScreen(settled, null, idsOf(vote.votedOn));
      }
      // The Comparison was never recorded, so advancing would drop the
      // curator's choice without telling them. Both slots go back as they
      // were: the showing voted on, and the one swapped in behind it.
      return {
        ...onScreen(settled, vote.votedOn, undefined),
        next: swappedIn ?? slots.next,
        failure: "vote",
      };
    }

    case "left-pool": {
      const { id } = action;
      const vote = pendingVote(slots);
      const votedOn = vote?.votedOn ?? null;
      if (
        !holds(slots.current, id) &&
        !holds(slots.next, id) &&
        !holds(votedOn, id)
      ) {
        // The usual case, and the one a hidden Rank pays on every reject made
        // elsewhere: the same object back, so nothing renders (ADR 0043).
        return slots;
      }
      const next = holds(slots.next, id) ? null : slots.next;
      const pending =
        vote && holds(votedOn, id) ? { ...vote, votedOn: null } : slots.pending;
      if (!holds(slots.current, id)) return { ...slots, next, pending };
      // The showing behind moves up. Whatever was said about the one that went
      // was said about it, so it goes too.
      const avoid = slots.current!.filter((w) => w.id !== id).map((w) => w.id);
      return {
        ...onScreen(slots, next, avoid),
        next: null,
        pending,
        failure: null,
      };
    }
  }
}

/**
 * What the slots are missing that a fetch would fill, if nothing is in flight.
 *
 * An empty screen after a failure stays empty while the failure is on it, so
 * a draw that failed is not retried on a loop. It is retried on `returning`,
 * when the curator comes back to Rank: a reject elsewhere can empty the
 * screen, and the library can have changed while they were away.
 */
export function owed(
  slots: Slots,
  returning = false,
): "draw" | "prefetch" | null {
  if (slots.pending) return null;
  if (!slots.current) return slots.failure && !returning ? null : "draw";
  if (!slots.next && slots.prefetch === null) return "prefetch";
  return null;
}

/**
 * A fresh showing for `mode`. Fours asks for four and is answered with a pair
 * while fewer than four wallpapers are Eligible, so the showing on screen and
 * not the mode is what decides how Rank draws and which keys it answers.
 */
function fetchShowing(mode: RankMode, exclude?: number[]): Promise<Showing> {
  return mode === "fours" ? client.getFour(exclude) : client.getPair(exclude);
}

/** Warm the browser cache so the swapped-in showing renders without a gap. */
function preload(showing: Showing): void {
  for (const wallpaper of showing) {
    const img = new Image();
    img.src = wallpaperImageUrl(wallpaper.id, IMAGE_SIZE);
  }
}

export interface ShowingQueue {
  current: Showing | null;
  pending: Pending | null;
  failure: Failure | null;
  /** Record `vote` on the showing on screen, unless something is pending. */
  vote: (vote: Vote) => void;
  /** A fresh showing in place of the one on screen, which stays out of it. */
  skip: () => void;
}

/**
 * Rank's showings: the one on screen, the one behind it, and every fetch and
 * vote that moves them.
 *
 * **A wallpaper that leaves the Eligible pool leaves the slots.** A reject in
 * Library or Review publishes `status-changed`, and a showing holding the
 * wallpaper is dropped and the one behind moves up, because the backend
 * refuses a vote naming a Rejected wallpaper and a showing that cannot be
 * voted on is one the curator would be stranded on. The refusal is handled
 * too, for the reject that crosses a vote already out.
 *
 * **Rank fetches only while it is shown.** Moving the slots up is a patch and
 * applies at once; the draw that refills them waits for the curator to come
 * back, the way `useRefetchWhenShown` defers a hidden page's refetch: a draw
 * brings image work with it, and ADR 0012 keeps that off the page the curator
 * is using.
 */
export function useShowingQueue(mode: RankMode, shown: boolean): ShowingQueue {
  const { publish } = useAppEvents();
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  // The slots as of the last transition, rather than the last render: two
  // inputs in one tick must see each other, so one pick is one Comparison.
  // `live` is false once unmounted, when a fetch still out must not start
  // another.
  const held = useRef({ slots: EMPTY_SLOTS, mode, shown, live: true });

  useEffect(() => {
    held.current.mode = mode;
    held.current.shown = shown;
  });

  const queue = useMemo(() => {
    function dispatch(action: SlotAction): void {
      if (!held.current.live) return;
      const before = held.current.slots;
      const after = reduceSlots(before, action);
      if (after === before) return;
      held.current.slots = after;
      setSlots(after);
    }

    /** Fetch whatever the slots are missing, if Rank is on screen to want it. */
    function refill(returning = false): void {
      if (!held.current.live || !held.current.shown) return;
      const want = owed(held.current.slots, returning);
      if (want === "draw") void draw();
      else if (want === "prefetch") void prefetch();
    }

    /**
     * After anything that was pending: a mode that moved while it was in
     * flight makes what it drew the old mode's, which a skip replaces.
     */
    function settle(drawnFor: RankMode): void {
      if (held.current.mode !== drawnFor && held.current.slots.current) {
        skip();
      } else {
        refill();
      }
    }

    async function draw(): Promise<void> {
      if (!held.current.live) return;
      const { current, avoid } = held.current.slots;
      const drawnFor = held.current.mode;
      dispatch({ type: "draw-sent" });
      try {
        const showing = await fetchShowing(
          drawnFor,
          current ? idsOf(current) : avoid,
        );
        dispatch({ type: "drawn", showing });
      } catch (err) {
        console.error(
          current
            ? "Failed to fetch a fresh showing:"
            : "Failed to load a showing:",
          err,
        );
        dispatch({
          type: "draw-failed",
          failure:
            isAppError(err) && err.kind === "not_enough_wallpapers"
              ? "not-enough"
              : "load",
        });
      }
      settle(drawnFor);
    }

    async function prefetch(): Promise<void> {
      const behind = held.current.slots.current;
      dispatch({ type: "prefetch-sent" });
      const ticket = held.current.slots.prefetch;
      if (ticket === null) return;
      try {
        const showing = await fetchShowing(held.current.mode, idsOf(behind));
        dispatch({ type: "prefetched", ticket, showing });
        if (held.current.slots.next === showing) preload(showing);
      } catch (error) {
        console.error("Failed to prefetch the next showing:", error);
        dispatch({ type: "prefetch-failed", ticket });
      }
    }

    function skip(): void {
      const { current, pending } = held.current.slots;
      if (pending || !current) return;
      void draw();
    }

    async function vote({ best, worst, others }: Vote): Promise<void> {
      const { current, pending } = held.current.slots;
      const on = idsOf(current);
      if (pending || ![best, worst, ...others].every((w) => on.includes(w.id)))
        return;
      const drawnFor = held.current.mode;
      dispatch({ type: "vote-cast", best: best.id, worst: worst.id });

      // Visual pick feedback before the swap.
      await new Promise((resolve) => setTimeout(resolve, PICK_FEEDBACK_MS));
      dispatch({ type: "feedback-ended" });

      const cast = held.current.slots.pending;
      if (cast?.kind === "vote" && cast.votedOn === null) {
        // A wallpaper picked from was rejected elsewhere during the beat. The
        // backend would refuse the vote, so it is not sent.
        dispatch({ type: "vote-failed", refused: true });
        settle(drawnFor);
        return;
      }

      // The answer's showing refills the slot behind whatever is on screen
      // now, so exclude that too — the backend already excludes the ones
      // voted on.
      const exclude = idsOf(held.current.slots.current);
      try {
        let outcome: { next: Showing | null; stats: Stats };
        if (others.length === 2) {
          const answer = await client.voteFour(
            best.id,
            worst.id,
            [others[0].id, others[1].id],
            exclude,
          );
          outcome = { next: answer.next_showing, stats: answer.stats };
        } else {
          const answer = await client.vote(best.id, worst.id, exclude);
          // In fours a pair shows only while the library is too small for
          // four, and what follows it is drawn for fours, which a pair vote's
          // answer is not: the slot refills as it does for a missing one.
          outcome = {
            next: drawnFor === "pairs" ? answer.next_pair : null,
            stats: answer.stats,
          };
        }

        // Published before anything else is done with the response, and
        // whether or not Rank is still mounted: the Comparison is recorded
        // and permanent, so both of these are true regardless.
        //
        // The ids and nothing else, because that is all Library can be told
        // for free — a Comparison answers with the whole `Stats` rather than
        // with the ratings, and asking the backend for the rows would put a
        // query on the path between one showing and the next.
        publish({
          type: "score-changed",
          ids: [best.id, ...others.map((w) => w.id), worst.id],
        });
        // The headline updates through the bus rather than beside it, so
        // there is one path into it: the Stats `useStats` holds, which every
        // other fact that moves a count reaches by a re-read (#418).
        publish({ type: "stats-changed", stats: outcome.stats });

        // A missing showing means the vote counted and only the follow-up
        // draw did not, so it is never reported as a failed vote: the slot it
        // leaves empty is refilled below.
        dispatch({ type: "vote-answered", next: outcome.next });
        if (outcome.next) preload(outcome.next);
      } catch (err) {
        const refused = isAppError(err) && err.kind === "unknown_wallpaper";
        if (!refused) console.error("Failed to submit vote:", err);
        dispatch({ type: "vote-failed", refused });
      }
      settle(drawnFor);
    }

    function leftPool(id: number): void {
      const before = held.current.slots;
      dispatch({ type: "left-pool", id });
      if (held.current.slots !== before) refill();
    }

    return {
      refill,
      leftPool,
      skip,
      vote: (v: Vote) => void vote(v),
    };
  }, [publish]);

  useEffect(() => {
    held.current.live = true;
    return () => {
      held.current.live = false;
    };
  }, []);

  // The first draw, on mount, and whatever was owed while Rank was hidden.
  useEffect(() => {
    if (shown) queue.refill(true);
  }, [shown, queue]);

  // A change of mode draws a showing of the new size in place of the one on
  // screen. Not on the first render, which the first draw is for.
  const drawnMode = useRef(mode);
  useEffect(() => {
    if (drawnMode.current === mode) return;
    drawnMode.current = mode;
    queue.skip();
  }, [mode, queue]);

  useAppEvent((event) => {
    if (event.type !== "status-changed" || isEligible(event.wallpaper)) return;
    queue.leftPool(event.wallpaper.id);
  });

  return {
    current: slots.current,
    pending: slots.pending,
    failure: slots.failure,
    vote: queue.vote,
    skip: queue.skip,
  };
}
