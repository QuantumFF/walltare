import { RankView } from "@/components/RankView";
import type { VoteOutcome, Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  currentView,
  deferred,
  flush,
  renderInApp,
  settings,
  stats,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

const PICK_FEEDBACK_MS = 300;

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
  mockCommand("get_stats", () => {
    getStatsCalls++;
    return stats();
  });
  // The other half of the provider's boot gate; without it nothing renders.
  mockCommand("get_settings", () => settings());
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
function serveVote(response: () => unknown): void {
  mockCommand("vote", (args) => {
    votes.push([args?.winnerId as number, args?.loserId as number]);
    return response();
  });
}

/**
 * happy-dom never fetches an `<img>`, so stand in for the browser finishing
 * one. The view refuses a pick until both panes have their image, because a
 * pick on a pane that is still blank is a Comparison on a wallpaper the user
 * never saw.
 */
async function panesArrive() {
  for (const side of ["Left", "Right"] as const) {
    const el = screen.queryByAltText(`${side} Wallpaper`);
    if (!el) continue;
    await act(async () => {
      fireEvent.load(el);
    });
  }
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
const roundLabel = () => screen.getByText(/^Round \d+$/);
const barValue = () =>
  screen.getByRole("progressbar").getAttribute("aria-valuenow");

/**
 * The Round's explanation as a mouse reaches it and as a screen reader reaches
 * it: the two have to say the same thing, since the `title` is the whole hover
 * affordance and the described-by target is the whole focus one.
 */
function roundExplanation(): [string | null, string | null] {
  const round = roundLabel();
  const id = round.getAttribute("aria-describedby");
  const described = id ? document.getElementById(id) : null;
  return [round.getAttribute("title"), described?.textContent ?? null];
}

async function clickPane(side: "Left" | "Right") {
  await act(async () => {
    fireEvent.click(screen.getByAltText(`${side} Wallpaper`));
  });
}

async function pressArrow(key: "ArrowLeft" | "ArrowRight") {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
}

/** Run out the pick-feedback delay that gates the optimistic swap. */
async function advancePickFeedback() {
  await act(async () => {
    jest.advanceTimersByTime(PICK_FEEDBACK_MS);
  });
  await flush();
}

async function runPickFeedback() {
  await advancePickFeedback();
  await panesArrive();
}

test("loads a pair, prefetches the next, and shows the progress headline", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({
      total_wallpapers: 140,
      eligible_count: 120,
      round: 4,
      round_participated_count: 98,
      evaluated_count: 61,
      total_comparisons: 487,
    }),
  );

  await renderRankView();

  expect((screen.getByAltText("Left Wallpaper") as HTMLImageElement).src).toBe(
    "wallpaper://localhost/image/1?size=medium",
  );
  expect(shownIds()).toEqual([1, 2]);
  expect(getPairCalls).toBe(2); // the shown pair, plus the prefetch slot
  // 98 of 120 through Round 4, and the Evaluated count reads against the
  // eligible pool rather than the 140 rows, so rejects do not drop it.
  expect(headline(/%$/)).toBe("Round 4 · 82%");
  expect(barValue()).toBe("82");
  expect(headline(/Evaluated$/)).toBe("61 / 120 Evaluated");
  expect(headline(/Comparisons$/)).toBe("487 Comparisons");
  expect(alertText()).toBeNull();
});

test("the Round explains its own rule in real counts, on hover and on focus", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({
      eligible_count: 120,
      round: 4,
      round_participated_count: 98,
    }),
  );

  await renderRankView();

  const rule =
    "Round 4: 98 of 120 wallpapers have been compared at least 4 times.";
  expect(roundExplanation()).toEqual([rule, rule]);
  expect(roundLabel().tabIndex).toBe(0); // reachable without a mouse
});

test("an empty Eligible pool reads Round 1 at 0%", async () => {
  // Nothing to vote on cannot also serve a pair, so what this pins is the
  // division: `eligible_count` of 0 renders the start of Round 1, not NaN%.
  servePairs(pair(1, 2), pair(3, 4));
  mockCommand("get_stats", () =>
    stats({
      total_wallpapers: 0,
      eligible_count: 0,
      round: 1,
      round_participated_count: 0,
      evaluated_count: 0,
      total_comparisons: 0,
    }),
  );

  await renderRankView();

  expect(headline(/%$/)).toBe("Round 1 · 0%");
  expect(barValue()).toBe("0");
  expect(headline(/Evaluated$/)).toBe("0 / 0 Evaluated");
  const rule = "Round 1: 0 of 0 wallpapers have been compared at least 1 time.";
  expect(roundExplanation()).toEqual([rule, rule]);
});

test("a pick swaps in the prefetched pair before the backend answers", async () => {
  servePairs(pair(1, 2), pair(3, 4));
  const inFlight = deferred<VoteOutcome>();
  let response: unknown = inFlight.promise;
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
        round_participated_count: 7,
        evaluated_count: 3,
        total_comparisons: 19,
      }),
    });
  });
  await flush();

  // Headline refreshed from the VoteOutcome alone.
  expect(headline(/%$/)).toBe("Round 3 · 70%");
  expect(barValue()).toBe("70");
  expect(headline(/Evaluated$/)).toBe("3 / 10 Evaluated");
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
    excludes.push(args?.exclude);
    const next = [pair(1, 2), pair(3, 4), pair(5, 6), pair(7, 8)][
      getPairCalls++
    ];
    if (!next) throw new Error(`get_pair called ${getPairCalls} times`);
    return next;
  });
  let votedExclude: unknown;
  mockCommand("vote", (args) => {
    votes.push([args?.winnerId as number, args?.loserId as number]);
    votedExclude = args?.exclude;
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

  await pressArrow("ArrowLeft");
  await runPickFeedback();
  expect(votes[0]).toEqual([1, 2]);
  expect(shownIds()).toEqual([3, 4]);

  await pressArrow("ArrowRight");
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
  await pressArrow("ArrowLeft");
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
  let response: unknown = inFlight.promise;
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
  expectConsoleError(/Failed to load pair/);
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
  expectConsoleError(/Failed to load pair/);
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
  expectConsoleError(/Failed to fetch a fresh pair/);
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

test("Stop & Review navigates to review", async () => {
  servePairs(pair(1, 2), pair(3, 4));

  await renderRankView();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /stop & review/i }));
  });

  expect(currentView()).toBe("review");
});
