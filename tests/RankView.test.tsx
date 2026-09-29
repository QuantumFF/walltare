import { RankView } from "@/components/RankView";
import { useApp } from "@/context/AppContext";
import type {
  FourOutcome,
  RankMode,
  Showing,
  VoteOutcome,
  Wallpaper,
} from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  advancePickFeedback,
  currentView,
  deferred,
  emptyStats,
  flush,
  mockBootedApp,
  panesArrive,
  press,
  renderInApp,
  settings,
  stats,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

let getPairCalls = 0;
let getStatsCalls = 0;
let votes: Array<[number, number]>;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  getPairCalls = 0;
  getStatsCalls = 0;
});

beforeEach(() => {
  // Every vote waits out a pick-feedback delay. Faking the clock keeps this
  // file fast and removes the timing tolerance that made the optimistic-swap
  // assertions vacuous. @testing-library can't detect bun's fake timers, so
  // these tests advance the clock by hand and assert synchronously instead of
  // going through `waitFor`.
  jest.useFakeTimers();
  votes = [];
  mockBootedApp();
  // Counted, because a refetch after a vote is what half this file is about.
  mockCommand("get_stats", () => {
    getStatsCalls++;
    return stats();
  });
});

function pair(leftId: number, rightId: number): [Wallpaper, Wallpaper] {
  return [wallpaper(leftId), wallpaper(rightId)];
}

/** Serve `queue` to successive `get_pair` calls; a call past the end fails the test. */
function servePairs(...queue: Array<[Wallpaper, Wallpaper]>): void {
  mockCommand("get_pair", () => {
    const next = queue[getPairCalls++];
    if (!next) {
      throw new Error(
        `get_pair called ${getPairCalls} times; only ${queue.length} pairs queued`,
      );
    }
    return next;
  });
}

/** Record every Comparison the view submits and answer with `response()`. */
function serveVote(response: () => VoteOutcome | Promise<VoteOutcome>): void {
  mockCommand("vote", (args) => {
    votes.push([args.winnerId, args.loserId]);
    return response();
  });
}

async function renderRankView() {
  const rendered = await renderInApp(<RankView />);
  await flush();
  await panesArrive();
  return rendered;
}

function idOf(alt: string): number {
  const { src } = screen.getByAltText(alt) as HTMLImageElement;
  const match = /^wallpaper:\/\/localhost\/image\/(\d+)\?size=medium$/.exec(src);
  if (!match) throw new Error(`unexpected image src: ${src}`);
  return Number(match[1]);
}

/** The wallpaper ids the two panes are showing. */
function shownIds(): [number, number] {
  return [idOf("Left Wallpaper"), idOf("Right Wallpaper")];
}

/** The arrow badge painted over the side the user picked, if any. */
function pickIndicator(side: "Left" | "Right"): Element | null {
  const card = screen.getByAltText(`${side} Wallpaper`).closest(".group");
  return card?.querySelector(`.lucide-arrow-${side.toLowerCase()}`) ?? null;
}

const skipButton = () =>
  screen.getByRole("button", { name: /skip pair/i }) as HTMLButtonElement;
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const headline = (label: RegExp) => screen.getByText(label).textContent;
const undecidedLabel = () => screen.getByText(/Undecided$/);

/**
 * The Undecided count's explanation as a mouse reaches it and as a screen
 * reader reaches it: the two have to say the same thing, since the `title` is
 * the whole hover affordance and the described-by target is the whole focus
 * one.
 */
function undecidedExplanation(): [string | null, string | null] {
  const label = undecidedLabel();
  const id = label.getAttribute("aria-describedby");
  const described = id ? document.getElementById(id) : null;
  return [label.getAttribute("title"), described?.textContent ?? null];
}

/** What the headline no longer shows: Round, a percentage, a bar, Evaluated. */
function expectNoRoundHeadline() {
  expect(screen.queryByText(/Round/)).toBeNull();
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText(/Evaluated/)).toBeNull();
}

async function clickPane(side: "Left" | "Right") {
  await act(async () => {
    fireEvent.click(screen.getByAltText(`${side} Wallpaper`));
  });
}

async function runPickFeedback() {
  await advancePickFeedback();
  await panesArrive();
}

test("loads a pair, prefetches the next, and shows the progress headline", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({
      total_wallpapers: 440,
      eligible_count: 420,
      undecided_count: 31,
      decided_below_count: 84,
      decided_above_count: 305,
      total_comparisons: 487,
    }),
  );

  await renderRankView();

  expect((screen.getByAltText("Left Wallpaper") as HTMLImageElement).src).toBe(
    "wallpaper://localhost/image/1?size=medium",
  );
  expect(shownIds()).toEqual([1, 2]);
  expect(getPairCalls).toBe(2); // the shown pair, plus the prefetch slot
  // Counted against the Eligible pool rather than the 440 rows, so rejects do
  // not move it, and shown raw: it can rise, and a percentage going backwards
  // reads as a bug (ADR 0059).
  expect(headline(/Undecided$/)).toBe("31 / 420 Undecided");
  expect(headline(/Comparisons$/)).toBe("487 Comparisons");
  expectNoRoundHeadline();
  expect(alertText()).toBeNull();
});

test("the Undecided count explains itself, on hover and on focus, and announces politely", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({
      eligible_count: 420,
      undecided_count: 31,
      decided_below_count: 84,
      decided_above_count: 305,
    }),
  );

  await renderRankView();

  const explanation =
    "31 of 420 wallpapers are Undecided: the app isn't sure yet which side of the Bar they fall on. 84 are Decided below it and 305 above. It can go up as well as down: a surprising vote can make the app unsure again.";
  expect(undecidedExplanation()).toEqual([explanation, explanation]);
  expect(undecidedLabel().tabIndex).toBe(0); // reachable without a mouse
  expect(undecidedLabel().getAttribute("aria-live")).toBe("polite");
});

test("an empty Eligible pool reads 0 / 0 Undecided", async () => {
  // Nothing to vote on cannot also serve a pair, so what this pins is the
  // headline for a pool of none.
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () => emptyStats());

  await renderRankView();

  expect(headline(/Undecided$/)).toBe("0 / 0 Undecided");
  expect(headline(/Comparisons$/)).toBe("0 Comparisons");
  const explanation =
    "0 of 0 wallpapers are Undecided: the app isn't sure yet which side of the Bar they fall on. 0 are Decided below it and 0 above. It can go up as well as down: a surprising vote can make the app unsure again.";
  expect(undecidedExplanation()).toEqual([explanation, explanation]);
  expectNoRoundHeadline();
});

test("a pick swaps in the prefetched pair before the backend answers", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  const inFlight = deferred<VoteOutcome>();
  let response: VoteOutcome | Promise<VoteOutcome> = inFlight.promise;
  serveVote(() => response);

  await renderRankView();
  const statsCallsAtLoad = getStatsCalls;

  await clickPane("Left");
  expect(votes).toEqual([]); // still inside the feedback window
  await runPickFeedback();

  // Nothing has resolved `inFlight` yet: the swap is genuinely optimistic.
  expect(votes).toEqual([[1, 2]]);
  expect(shownIds()).toEqual([3, 4]);

  await act(async () => {
    inFlight.resolve({
      next_pair: pair(5, 6),
      stats: stats({
        undecided_count: 5,
        decided_above_count: 4,
        total_comparisons: 19,
      }),
    });
  });
  await flush();

  // Headline refreshed from the VoteOutcome alone.
  expect(headline(/Undecided$/)).toBe("5 / 10 Undecided");
  expect(headline(/Comparisons$/)).toBe("19 Comparisons");
  expect(getStatsCalls).toBe(statsCallsAtLoad);

  // The returned next_pair filled the slot, so the following pick needs no fetch.
  response = { next_pair: pair(7, 8), stats: stats({ total_comparisons: 20 }) };
  await clickPane("Right");
  await runPickFeedback();

  expect(votes[1]).toEqual([4, 3]); // winner = right, loser = left
  expect(shownIds()).toEqual([5, 6]);
  expect(headline(/Comparisons$/)).toBe("20 Comparisons");
  expect(getPairCalls).toBe(2);
});

test("a pick is refused until both panes have their wallpaper", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderInApp(<RankView />);
  await flush();

  // Generating a medium thumbnail off a large source takes seconds, so at
  // this point both panes are blank. There is nothing to judge yet.
  await clickPane("Left");
  await advancePickFeedback();
  expect(votes).toEqual([]);

  // One arrival is not enough: a pick is a comparison, and half a comparison
  // is not one.
  await act(async () => {
    fireEvent.load(screen.getByAltText("Left Wallpaper"));
  });
  await clickPane("Left");
  await advancePickFeedback();
  expect(votes).toEqual([]);

  await act(async () => {
    fireEvent.load(screen.getByAltText("Right Wallpaper"));
  });
  await clickPane("Left");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);
});

test("the pair swapped in by a pick cannot be voted on before it is visible", async () => {
  // The reported bug: the panes still showed the pair just voted on, so the
  // user picked again and the progress moved — a permanent Comparison between
  // two wallpapers they never saw.
  servePairs(pair(1, 2), pair(3, 4));
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderRankView();
  await clickPane("Left");
  await advancePickFeedback();

  expect(shownIds()).toEqual([3, 4]);
  await clickPane("Left");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  await panesArrive();
  await clickPane("Left");
  await advancePickFeedback();
  expect(votes).toEqual([
    [1, 2],
    [3, 4],
  ]);
});

test("an image that fails to load unblocks its pane rather than wedging it", async () => {
  // A missing source file must not strand the user on a pair they can never
  // get past; the broken pane is visibly broken, which is its own signal.
  servePairs(pair(1, 2), pair(3, 4));
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderInApp(<RankView />);
  await flush();
  await act(async () => {
    fireEvent.error(screen.getByAltText("Left Wallpaper"));
    fireEvent.load(screen.getByAltText("Right Wallpaper"));
  });

  await clickPane("Right");
  await advancePickFeedback();
  expect(votes).toEqual([[2, 1]]);
});

test("a fetch is told which wallpapers are already on screen", async () => {
  const excludes: unknown[] = [];
  mockCommand("get_pair", (args) => {
    excludes.push(args.exclude);
    const next = [pair(1, 2), pair(3, 4), pair(5, 6), pair(7, 8)][
      getPairCalls++
    ];
    if (!next) throw new Error(`get_pair called ${getPairCalls} times`);
    return next;
  });
  let votedExclude: unknown;
  mockCommand("vote", (args) => {
    votes.push([args.winnerId, args.loserId]);
    votedExclude = args.exclude;
    return { next_pair: pair(11, 12), stats: stats() };
  });

  await renderRankView();
  // The first fetch has nothing to avoid; the prefetch behind it does.
  expect(excludes).toEqual([undefined, [1, 2]]);

  await clickPane("Left");
  await runPickFeedback();
  // 3 and 4 are on screen now, and next_pair refills the slot behind them.
  expect(votedExclude).toEqual([3, 4]);

  await act(async () => {
    fireEvent.click(skipButton());
  });
  await flush();
  // Skipping a pair means "not these two".
  expect(excludes[2]).toEqual([3, 4]);
});

test("arrow keys register the matching Comparison", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderRankView();

  await press("ArrowLeft", { target: window });
  await runPickFeedback();
  expect(votes[0]).toEqual([1, 2]);
  expect(shownIds()).toEqual([3, 4]);

  await press("ArrowRight", { target: window });
  await runPickFeedback();
  expect(votes[1]).toEqual([4, 3]);
  expect(shownIds()).toEqual([7, 8]);
});

test("one Comparison per pick, however fast the input and however slow the vote", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  const inFlight = deferred<VoteOutcome>();
  serveVote(() => inFlight.promise);

  await renderRankView();

  // Same tick: the synchronous guard.
  await act(async () => {
    fireEvent.click(screen.getByAltText("Left Wallpaper"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
  });
  await runPickFeedback();
  expect(votes).toEqual([[1, 2]]);

  // Still guarded across the async window, which spans many ticks.
  await clickPane("Right");
  await press("ArrowLeft", { target: window });
  await runPickFeedback();
  expect(votes).toEqual([[1, 2]]);

  // The guard releases once the vote lands.
  await act(async () => {
    inFlight.resolve({ next_pair: pair(7, 8), stats: stats() });
  });
  await flush();
  await clickPane("Left");
  await runPickFeedback();
  expect(votes).toEqual([
    [1, 2],
    [3, 4],
  ]);
});

test("the picked side is marked and skip is locked until the vote lands", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  const inFlight = deferred<VoteOutcome>();
  serveVote(() => inFlight.promise);

  await renderRankView();
  expect(skipButton().disabled).toBe(false);

  await clickPane("Left");
  expect(pickIndicator("Left")).not.toBeNull();
  expect(pickIndicator("Right")).toBeNull();
  expect(skipButton().disabled).toBe(true);

  await runPickFeedback();
  expect(skipButton().disabled).toBe(true); // the vote is still in flight

  await act(async () => {
    inFlight.resolve({ next_pair: pair(7, 8), stats: stats() });
  });
  await flush();
  expect(pickIndicator("Left")).toBeNull();
  expect(skipButton().disabled).toBe(false);
});

test("skip replaces the pair and refills the prefetch slot", async () => {
  servePairs(pair(1, 2), pair(3, 4), pair(5, 6), pair(7, 8));
  serveVote(() => ({ next_pair: pair(11, 12), stats: stats() }));

  await renderRankView();
  await act(async () => {
    fireEvent.click(skipButton());
  });
  await flush();

  expect(shownIds()).toEqual([5, 6]);
  expect(getPairCalls).toBe(4); // a fresh pair, and a fresh slot behind it
  expect(votes).toEqual([]);

  // The pair that was skipped past is gone from the slot too.
  await panesArrive();
  await clickPane("Left");
  await runPickFeedback();
  expect(shownIds()).toEqual([7, 8]);
});

test("a skipped pair never comes back through the prefetch slot", async () => {
  const held = deferred<[Wallpaper, Wallpaper]>();
  mockCommand("get_pair", () => {
    getPairCalls++;
    if (getPairCalls === 1) return pair(1, 2);
    if (getPairCalls === 2) return pair(3, 4); // prefetched, then skipped past
    if (getPairCalls === 3) return pair(5, 6); // the skip's fresh pair
    return held.promise; // the refill, still in flight
  });
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderRankView();
  await act(async () => {
    fireEvent.click(skipButton());
  });
  await flush();
  expect(shownIds()).toEqual([5, 6]);

  // The slot was emptied, so the vote's next_pair becomes the current pair.
  // Were the skipped pair still sitting there, it would be shown again.
  await panesArrive();
  await clickPane("Left");
  await runPickFeedback();
  expect(shownIds()).toEqual([7, 8]);
});

test("skip is locked while a skip is in flight", async () => {
  const inFlight = deferred<[Wallpaper, Wallpaper]>();
  mockCommand("get_pair", () => {
    getPairCalls++;
    if (getPairCalls === 1) return pair(1, 2);
    if (getPairCalls === 2) return pair(3, 4);
    if (getPairCalls === 3) return inFlight.promise;
    return pair(9, 10);
  });

  await renderRankView();
  await act(async () => {
    fireEvent.click(skipButton());
  });
  expect(skipButton().disabled).toBe(true);

  await act(async () => {
    inFlight.resolve(pair(5, 6));
  });
  await flush();

  expect(skipButton().disabled).toBe(false);
  expect(shownIds()).toEqual([5, 6]);
});

test("a prefetch that lands after a vote cannot overwrite the slot", async () => {
  const stale = deferred<[Wallpaper, Wallpaper]>();
  mockCommand("get_pair", () => {
    getPairCalls++;
    if (getPairCalls === 1) return pair(1, 2);
    if (getPairCalls === 2) return stale.promise; // the prefetch that lands late
    return pair(5, 6); // the post-vote refill
  });
  serveVote(() => ({ next_pair: pair(7, 8), stats: stats() }));

  await renderRankView();
  await clickPane("Left");
  await runPickFeedback();

  // Slot was empty at vote time: next_pair became the current pair and the
  // refill went to the slot.
  expect(shownIds()).toEqual([7, 8]);
  expect(getPairCalls).toBe(3);

  await act(async () => {
    stale.resolve(pair(90, 91));
  });
  await flush();

  // The next pick proves the slot still holds the refill, not the stale pair.
  await clickPane("Left");
  await runPickFeedback();
  expect(shownIds()).toEqual([5, 6]);
});

test("a vote that fails rolls back to the pair the user picked from", async () => {
  expectConsoleError(/Failed to submit vote/);
  servePairs(pair(1, 2), pair(3, 4), pair(9, 10));
  const inFlight = deferred<VoteOutcome>();
  let response: VoteOutcome | Promise<VoteOutcome> = inFlight.promise;
  serveVote(() => response);

  await renderRankView();
  await clickPane("Left");
  await runPickFeedback();
  expect(shownIds()).toEqual([3, 4]); // optimistically swapped

  await act(async () => {
    inFlight.reject({ kind: "db", message: "disk on fire" });
  });
  await flush();

  // The Comparison was never recorded, so advancing would drop the choice.
  expect(shownIds()).toEqual([1, 2]);
  expect(alertText()).toBe("That vote didn't save. Pick again.");

  // And the user really can pick again.
  response = { next_pair: pair(7, 8), stats: stats() };
  await clickPane("Left");
  await runPickFeedback();
  expect(votes).toEqual([
    [1, 2],
    [1, 2],
  ]);
  expect(alertText()).toBeNull();
  expect(shownIds()).toEqual([7, 8]);
});

test("a vote whose follow-up pair is missing re-fetches instead of erroring", async () => {
  servePairs(pair(1, 2), pair(3, 4), pair(5, 6), pair(11, 12));
  serveVote(() => ({
    next_pair: null,
    stats: stats({ total_comparisons: 5 }),
  }));

  await renderRankView();
  await clickPane("Left");
  await runPickFeedback();

  // The Comparison counted; only the follow-up fetch didn't.
  expect(alertText()).toBeNull();
  expect(headline(/Comparisons$/)).toBe("5 Comparisons");
  expect(shownIds()).toEqual([3, 4]);
  expect(getPairCalls).toBe(3); // the emptied slot was refilled

  await clickPane("Left");
  await runPickFeedback();
  expect(shownIds()).toEqual([5, 6]);
});

test("a vote with an empty slot and no follow-up pair fetches a fresh one", async () => {
  const held = deferred<[Wallpaper, Wallpaper]>(); // prefetch that never lands
  mockCommand("get_pair", () => {
    getPairCalls++;
    if (getPairCalls === 1) return pair(1, 2);
    if (getPairCalls === 2) return held.promise;
    if (getPairCalls === 3) return pair(5, 6);
    return pair(7, 8);
  });
  serveVote(() => ({
    next_pair: null,
    stats: stats({ total_comparisons: 9 }),
  }));

  await renderRankView();
  await clickPane("Left");
  await runPickFeedback();

  expect(alertText()).toBeNull();
  expect(headline(/Comparisons$/)).toBe("9 Comparisons");
  // Never leave the user on the pair they just voted on.
  expect(shownIds()).toEqual([5, 6]);
  expect(getPairCalls).toBe(4); // fresh current pair, plus a fresh slot
});

test("a library too small to rank says exactly that", async () => {
  expectConsoleError(/Failed to load a showing/);
  mockCommand("get_pair", () =>
    Promise.reject({
      kind: "not_enough_wallpapers",
      message: "need at least two",
    }),
  );

  await renderRankView();

  expect(alertText()).toBe(
    "Ranking needs at least two wallpapers that aren't rejected.",
  );
});

test("a failed load offers a way out of the dead end", async () => {
  expectConsoleError(/Failed to load a showing/);
  mockCommand("get_pair", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );

  await renderRankView();

  expect(alertText()).toBe("Failed to load wallpapers.");
  expect(screen.queryByAltText("Left Wallpaper")).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /go to review/i }));
  });
  expect(currentView()).toBe("review");
});

test("a skip that fails keeps the pair on screen and says so", async () => {
  expectConsoleError(/Failed to fetch a fresh showing/);
  mockCommand("get_pair", () => {
    getPairCalls++;
    if (getPairCalls === 1) return pair(1, 2);
    if (getPairCalls === 2) return pair(3, 4);
    return Promise.reject({ kind: "db", message: "locked database" });
  });

  await renderRankView();
  await act(async () => {
    fireEvent.click(skipButton());
  });
  await flush();

  expect(alertText()).toBe("Failed to load wallpapers.");
  expect(shownIds()).toEqual([1, 2]);
  expect(skipButton().disabled).toBe(false);
});

test("the footer offers Skip and no second route to another view", async () => {
  servePairs(pair(1, 2), pair(3, 4));

  await renderRankView();

  // ADR 0015 makes the chrome's tabs the app's navigation, so the **Stop &
  // Review** control that used to sit beside Skip is gone: the destination it
  // named is one click away in a bar that is on screen on every view.
  expect(skipButton()).not.toBeNull();
  expect(screen.queryByRole("button", { name: /review/i })).toBeNull();
});

test("each pane is a named control the keyboard can reach", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  serveVote(() => ({ next_pair: pair(5, 6), stats: stats() }));

  await renderRankView();

  // A `<div onClick>` could be neither. The arrows are a `window` fallback that
  // stands down as soon as anything else answers the key, so they are what
  // fires when nothing has focus rather than a substitute for the pane being
  // focusable.
  const left = screen.getByRole("button", {
    name: "Pick the wallpaper on the left",
  });
  expect(
    screen.getByRole("button", { name: "Pick the wallpaper on the right" }),
  ).not.toBeNull();

  await act(async () => {
    left.focus();
    fireEvent.click(left);
  });
  await runPickFeedback();

  expect(votes).toEqual([[1, 2]]);
});

const NOTHING_LEFT =
  "Nothing left to decide. The rest are Close calls, best settled in Review.";

function suggestion(): string | null {
  return screen.queryByRole("status")?.querySelector("p")?.textContent ?? null;
}

test("once nothing is left to decide, Rank suggests Review and keeps the pair", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({ undecided_count: 3, close_call_count: 3 }),
  );

  await renderRankView();

  expect(suggestion()).toBe(NOTHING_LEFT);
  expect(shownIds()).toEqual([1, 2]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start Review" }));
  });
  expect(currentView()).toBe("review");
});

test("the suggestion follows the state, and Keep ranking puts it away until it is next true", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  const outcomes: VoteOutcome[] = [
    // A vote that leaves something to decide takes it away.
    {
      next_pair: pair(5, 6),
      stats: stats({ undecided_count: 4, close_call_count: 3 }),
    },
    // One that settles the last brings it back.
    {
      next_pair: pair(7, 8),
      stats: stats({ undecided_count: 3, close_call_count: 3 }),
    },
    // Dismissed, it stays away while still true...
    {
      next_pair: pair(9, 10),
      stats: stats({ undecided_count: 3, close_call_count: 3 }),
    },
    // ...and comes back only after it was false in between.
    {
      next_pair: pair(11, 12),
      stats: stats({ undecided_count: 5, close_call_count: 3 }),
    },
    {
      next_pair: pair(13, 14),
      stats: stats({ undecided_count: 3, close_call_count: 3 }),
    },
  ];
  serveVote(() => outcomes.shift()!);
  mockCommand("get_stats", () =>
    stats({ undecided_count: 3, close_call_count: 3 }),
  );

  await renderRankView();
  expect(suggestion()).toBe(NOTHING_LEFT);

  const pick = async () => {
    await clickPane("Left");
    await runPickFeedback();
    await flush();
  };

  await pick();
  expect(suggestion()).toBeNull();
  await pick();
  expect(suggestion()).toBe(NOTHING_LEFT);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Keep ranking" }));
  });
  expect(suggestion()).toBeNull();
  expect(shownIds()).toEqual([5, 6]);

  await pick();
  expect(suggestion()).toBeNull();
  await pick();
  expect(suggestion()).toBeNull();
  await pick();
  expect(suggestion()).toBe(NOTHING_LEFT);
});

// --- showings of four (ADR 0061) ---------------------------------------------

function four(...ids: [number, number, number, number]): Showing {
  return ids.map((id) => wallpaper(id)) as Showing;
}

let getFourCalls = 0;
let fourExcludes: unknown[];
let fourVotes: Array<{ best: number; worst: number; others: number[] }>;
let settingWrites: Array<{ key: string; value: string }>;

/** Rank in `mode`, as the settings table has it, with writes recorded. */
function rankIn(mode: RankMode): void {
  let stored = settings({ rank_mode: mode });
  settingWrites = [];
  mockCommand("get_settings", () => stored);
  mockCommand("set_setting", (args) => {
    settingWrites.push(args);
    stored = { ...stored, rank_mode: args.value as RankMode };
    return stored;
  });
}

/** Serve `queue` to successive `get_four` calls; a call past the end fails. */
function serveFours(...queue: Showing[]): void {
  getFourCalls = 0;
  fourExcludes = [];
  mockCommand("get_four", (args) => {
    fourExcludes.push(args.exclude);
    const next = queue[getFourCalls++];
    if (!next) {
      throw new Error(
        `get_four called ${getFourCalls} times; only ${queue.length} queued`,
      );
    }
    return next;
  });
}

function serveFourVote(response: () => FourOutcome | Promise<FourOutcome>) {
  fourVotes = [];
  mockCommand("vote_four", (args) => {
    fourVotes.push({
      best: args.bestId,
      worst: args.worstId,
      others: [...args.otherIds].sort((a, b) => a - b),
    });
    return response();
  });
}

const tile = (n: number) =>
  screen.getByRole("button", { name: `Wallpaper ${n}` });

/** The wallpaper ids the four tiles are showing, in grid order. */
function tileIds(): number[] {
  return [1, 2, 3, 4].map((n) => {
    const src = tile(n).querySelector("img")?.getAttribute("src") ?? "";
    return Number(/image\/(\d+)\?/.exec(src)?.[1]);
  });
}

const prompt = () => screen.getByText(/^(Pick the|Now the)/).textContent;
const pressed = () =>
  [1, 2, 3, 4].filter((n) => tile(n).getAttribute("aria-pressed") === "true");

async function clickTile(n: number) {
  await act(async () => {
    fireEvent.click(tile(n));
  });
}

test("fours shows four tiles named by their key, and a pick of best then worst is one vote", async () => {
  rankIn("fours");
  serveFours(four(1, 2, 3, 4), four(5, 6, 7, 8));
  serveFourVote(() => ({ next_showing: four(9, 10, 11, 12), stats: stats() }));

  await renderRankView();

  expect(tileIds()).toEqual([1, 2, 3, 4]);
  // The prefetch behind it avoids what is on screen.
  expect(fourExcludes).toEqual([undefined, [1, 2, 3, 4]]);
  expect(prompt()).toBe("Pick the best");
  expect(screen.getByRole("button", { name: /skip these four/i })).toBeTruthy();

  await clickTile(2);
  expect(prompt()).toBe("Now the worst");
  expect(pressed()).toEqual([2]);
  expect(tile(2).textContent).toContain("Best");
  expect(fourVotes).toEqual([]);

  await clickTile(4);
  // The two named neither dim through the beat; nothing has been sent yet.
  expect(tile(1).className).toContain("opacity-50");
  expect(tile(3).className).toContain("opacity-50");
  expect(tile(2).className).not.toContain("opacity-50");
  expect(tile(4).textContent).toContain("Worst");
  expect(fourVotes).toEqual([]);

  await runPickFeedback();
  expect(fourVotes).toEqual([{ best: 2, worst: 4, others: [1, 3] }]);
  // The prefetched four swapped in, with nothing named on it.
  expect(tileIds()).toEqual([5, 6, 7, 8]);
  expect(prompt()).toBe("Pick the best");
  expect(pressed()).toEqual([]);
});

test("the best is taken back by a second click, by Backspace and by Esc", async () => {
  rankIn("fours");
  serveFours(four(1, 2, 3, 4), four(5, 6, 7, 8));
  serveFourVote(() => ({ next_showing: four(9, 10, 11, 12), stats: stats() }));

  await renderRankView();

  await clickTile(3);
  expect(pressed()).toEqual([3]);
  await clickTile(3);
  expect(pressed()).toEqual([]);
  expect(prompt()).toBe("Pick the best");

  for (const key of ["Backspace", "Escape"]) {
    await clickTile(1);
    expect(prompt()).toBe("Now the worst");
    await press(key, { target: window });
    expect(pressed()).toEqual([]);
    expect(prompt()).toBe("Pick the best");
  }

  // Taken back and named again, the second pick is the worst of the new best.
  await clickTile(4);
  await clickTile(1);
  await runPickFeedback();
  expect(fourVotes).toEqual([{ best: 4, worst: 1, others: [2, 3] }]);
});

test("1 to 4 follow the grid, S skips, and the arrows record nothing in fours", async () => {
  rankIn("fours");
  serveFours(
    four(1, 2, 3, 4),
    four(5, 6, 7, 8),
    four(13, 14, 15, 16),
    four(17, 18, 19, 20),
  );
  serveFourVote(() => ({ next_showing: four(9, 10, 11, 12), stats: stats() }));
  mockCommand("vote", () => {
    throw new Error("a pair vote in fours");
  });

  await renderRankView();

  await press("ArrowLeft", { target: window });
  await press("ArrowRight", { target: window });
  await advancePickFeedback();
  expect(fourVotes).toEqual([]);
  expect(pressed()).toEqual([]);

  // Top right is the best, bottom left the worst.
  await press("2", { target: window });
  await press("3", { target: window });
  await runPickFeedback();
  expect(fourVotes).toEqual([{ best: 2, worst: 3, others: [1, 4] }]);
  expect(tileIds()).toEqual([5, 6, 7, 8]);

  // S is "not these four", and the next draw is told so.
  await press("s", { target: window });
  await flush();
  expect(fourExcludes[2]).toEqual([5, 6, 7, 8]);
  expect(tileIds()).toEqual([13, 14, 15, 16]);
});

test("S skips a pair too", async () => {
  servePairs(pair(1, 2), pair(3, 4), pair(5, 6), pair(7, 8));
  await renderRankView();

  await press("S", { target: window });
  await flush();

  expect(shownIds()).toEqual([5, 6]);
  expect(votes).toEqual([]);
});

/** The two views a test walks between, as the chrome's tabs would. */
function ViewSwitch() {
  const { setView } = useApp();
  return (
    <>
      <button type="button" onClick={() => setView("library")}>
        To Library
      </button>
      <button type="button" onClick={() => setView("rank")}>
        To Rank
      </button>
    </>
  );
}

test("a best left behind by a skip, a switch of mode or a switch of view records nothing", async () => {
  rankIn("fours");
  serveFours(
    four(1, 2, 3, 4),
    four(5, 6, 7, 8),
    four(9, 10, 11, 12),
    four(13, 14, 15, 16),
  );
  serveFourVote(() => {
    throw new Error("a half-answered showing was sent");
  });
  servePairs(pair(21, 22), pair(23, 24));

  await renderInApp(
    <>
      <ViewSwitch />
      <RankView />
    </>,
  );
  await flush();
  await panesArrive();

  // Skipped.
  await clickTile(1);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /skip these four/i }));
  });
  await flush();
  await panesArrive();
  expect(tileIds()).toEqual([9, 10, 11, 12]);
  expect(pressed()).toEqual([]);

  // Left for another view and come back to.
  await clickTile(2);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "To Library" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "To Rank" }));
  });
  expect(pressed()).toEqual([]);
  expect(prompt()).toBe("Pick the best");

  // Switched to pairs, which draws a pair in place of the four.
  await clickTile(3);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pairs" }));
  });
  await flush();
  expect(settingWrites).toEqual([{ key: "rank_mode", value: "pairs" }]);
  expect(shownIds()).toEqual([21, 22]);
  expect(votes).toEqual([]);
});

test("the switch is remembered through the settings command and draws the other size", async () => {
  rankIn("pairs");
  servePairs(pair(1, 2), pair(3, 4));
  serveFours(four(5, 6, 7, 8), four(9, 10, 11, 12));

  await renderRankView();
  const group = screen.getByRole("group", { name: "Show" });
  const fours = screen.getByRole("button", { name: "Fours" });
  expect(group.contains(fours)).toBe(true);
  expect(
    screen.getByRole("button", { name: "Pairs" }).getAttribute("aria-pressed"),
  ).toBe("true");

  await act(async () => {
    fireEvent.click(fours);
  });
  await flush();

  expect(settingWrites).toEqual([{ key: "rank_mode", value: "fours" }]);
  expect(fours.getAttribute("aria-pressed")).toBe("true");
  // The pair on screen stays out of the four drawn for it.
  expect(fourExcludes[0]).toEqual([1, 2]);
  expect(tileIds()).toEqual([5, 6, 7, 8]);
});

test("a failed vote on four puts the showing back with the best cleared", async () => {
  expectConsoleError(/Failed to submit vote/);
  rankIn("fours");
  serveFours(four(1, 2, 3, 4), four(5, 6, 7, 8));
  serveFourVote(() => Promise.reject({ kind: "db", message: "disk full" }));

  await renderRankView();

  await clickTile(1);
  await clickTile(2);
  await runPickFeedback();

  expect(fourVotes).toHaveLength(1);
  expect(tileIds()).toEqual([1, 2, 3, 4]);
  expect(pressed()).toEqual([]);
  expect(prompt()).toBe("Pick the best");
  expect(alertText()).toBe("That vote didn't save. Pick again.");
});

test("fours with fewer than four Eligible shows a pair and votes on it as one", async () => {
  rankIn("fours");
  serveFours(pair(1, 2), pair(1, 2), pair(1, 2));
  serveVote(() => ({ next_pair: pair(1, 2), stats: stats() }));

  await renderRankView();

  expect(shownIds()).toEqual([1, 2]);
  expect(screen.queryByRole("button", { name: "Wallpaper 1" })).toBeNull();
  expect(screen.getByRole("button", { name: /skip pair/i })).toBeTruthy();

  // The digits are not bound on a pair; the arrows are.
  await press("1", { target: window });
  await advancePickFeedback();
  expect(votes).toEqual([]);
  await press("ArrowRight", { target: window });
  await runPickFeedback();
  expect(votes).toEqual([[2, 1]]);
  // What follows is still drawn for fours.
  expect(getFourCalls).toBe(3);
});

test("a pick on four is refused until every tile has its wallpaper", async () => {
  rankIn("fours");
  serveFours(four(1, 2, 3, 4), four(5, 6, 7, 8));
  serveFourVote(() => ({ next_showing: four(9, 10, 11, 12), stats: stats() }));

  await renderInApp(<RankView />);
  await flush();

  await clickTile(1);
  expect(pressed()).toEqual([]);
  await press("1", { target: window });
  expect(pressed()).toEqual([]);
});
