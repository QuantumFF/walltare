import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { RankView } from "@/components/RankView";
import { AppProvider, useApp } from "@/context/AppContext";
import type { Stats, VoteOutcome, Wallpaper } from "@/lib/client";
import { mockCommand, resetIpcMocks } from "./ipc-mocks";

const FEEDBACK_MS = 300;
const SWAP_TIMEOUT = { timeout: 5000 };

const callCounts = new Map<string, number>();

function countedCommand(name: string, impl: () => unknown): void {
  callCounts.set(name, 0);
  mockCommand(name, () => {
    callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
    return impl();
  });
}

function wallpaper(id: number): Wallpaper {
  return {
    id,
    filename: `wall-${id}.jpg`,
    path: `/tmp/wallpapers/wall-${id}.jpg`,
    status: "active",
    rating_mu: 25,
    rating_sigma: 8.333,
    comparisons_count: 0,
  };
}

function stats(over: Partial<Stats> = {}): Stats {
  return {
    total_wallpapers: 10,
    total_comparisons: 4,
    evaluated_count: 2,
    participated_count: 5,
    percentage: 50,
    ...over,
  };
}

let pairs: Array<[Wallpaper, Wallpaper]>;
let pairIndex: number;
let votes: Array<[number, number]>;

/** Queue of pairs served by the mocked `get_pair`; repeats its last entry. */
function queuePairs(...queue: Array<[Wallpaper, Wallpaper]>): void {
  pairs = queue;
  pairIndex = 0;
  countedCommand("get_pair", () => {
    const pair = pairs[Math.min(pairIndex, pairs.length - 1)];
    pairIndex += 1;
    return pair;
  });
}

function mockVote(
  outcomeFor: (winnerId: number, loserId: number) => VoteOutcome,
): void {
  votes = [];
  mockCommand("vote", (args) => {
    const vote: [number, number] = [
      args?.winnerId as number,
      args?.loserId as number,
    ];
    votes.push(vote);
    return outcomeFor(vote[0], vote[1]);
  });
}

async function renderRankView() {
  render(
    <AppProvider>
      <RankView />
    </AppProvider>,
  );
  await screen.findByAltText("Left Wallpaper");
}

/** Waits until both the current and prefetch slots have consumed their pair. */
async function waitPrefetched() {
  await waitFor(() => {
    expect(callCounts.get("get_pair")).toBeGreaterThanOrEqual(2);
  });
}

const leftSrc = () =>
  (screen.getByAltText("Left Wallpaper") as HTMLImageElement).src;
const rightSrc = () =>
  (screen.getByAltText("Right Wallpaper") as HTMLImageElement).src;

afterEach(() => {
  cleanup();
  resetIpcMocks();
});

beforeEach(() => {
  queuePairs(
    [wallpaper(1), wallpaper(2)], // current on load
    [wallpaper(3), wallpaper(4)], // prefetch slot
  );
});

test("loads a pair, prefetches the next, and shows the progress headline", async () => {
  countedCommand("get_stats", () => stats({ percentage: 37.5 }));
  await renderRankView();

  expect(leftSrc()).toContain("/1?");
  expect(rightSrc()).toContain("/2?");
  expect(screen.getByText("37.5%")).toBeDefined();
  expect(screen.getByText(/\/ 10 Participated/)).toBeDefined();
  expect(screen.getByText(/Comparisons/)).toBeDefined();
});

test("voting swaps in the prefetched pair and updates stats from the response alone", async () => {
  countedCommand("get_stats", () => stats());
  mockVote(() => ({
    next_pair: [wallpaper(5), wallpaper(6)],
    stats: stats({
      percentage: 60,
      total_comparisons: 5,
      participated_count: 6,
    }),
  }));

  await renderRankView();
  await waitPrefetched();

  await act(async () => {
    fireEvent.click(screen.getByAltText("Left Wallpaper"));
  });

  // One Comparison recorded: winner = left, loser = right.
  await waitFor(() => {
    expect(votes.length).toBe(1);
  });
  expect(votes[0]).toEqual([1, 2]);

  // Optimistic swap into the prefetched pair without a loading gap.
  await waitFor(() => {
    expect(leftSrc()).toContain("/3?");
    expect(rightSrc()).toContain("/4?");
  }, SWAP_TIMEOUT);

  // Headline refreshed from the VoteOutcome alone.
  expect(screen.getByText("60.0%")).toBeDefined();
  expect(callCounts.get("get_stats")).toBe(1); // only the initial load

  // Returned next_pair fills the prefetch slot for the following vote.
  await act(async () => {
    fireEvent.click(screen.getByAltText("Right Wallpaper"));
  });
  await waitFor(() => {
    expect(votes.length).toBe(2);
  });
  expect(votes[1]).toEqual([4, 3]);
  await waitFor(() => {
    expect(leftSrc()).toContain("/5?");
    expect(rightSrc()).toContain("/6?");
  }, SWAP_TIMEOUT);
  expect(screen.getByText(/Comparisons/)).toBeDefined();
});

test("a vote arriving on an empty prefetch slot promotes next_pair without duplicating it", async () => {
  countedCommand("get_stats", () => stats());
  // The initial prefetch never lands, so the slot is empty at vote time;
  // the post-vote refill serves a distinct pair.
  let getPairCalls = 0;
  mockCommand("get_pair", () => {
    getPairCalls += 1;
    if (getPairCalls === 1) return [wallpaper(1), wallpaper(2)];
    if (getPairCalls === 2) return new Promise(() => {}); // prefetch never lands
    return [wallpaper(5), wallpaper(6)];
  });
  mockVote(() => ({
    next_pair: [wallpaper(7), wallpaper(8)],
    stats: stats(),
  }));

  await renderRankView();
  expect(leftSrc()).toContain("/1?");

  await act(async () => {
    fireEvent.click(screen.getByAltText("Left Wallpaper"));
  });

  // next_pair becomes the current pair...
  await waitFor(() => {
    expect(leftSrc()).toContain("/7?");
    expect(rightSrc()).toContain("/8?");
  }, SWAP_TIMEOUT);
  expect(votes.length).toBe(1);

  // ...and the prefetch slot is refilled with a fresh pair, not a copy.
  await waitFor(() => {
    expect(getPairCalls).toBeGreaterThanOrEqual(3);
  });
  await act(async () => {
    fireEvent.click(screen.getByAltText("Left Wallpaper"));
  });
  await waitFor(() => {
    expect(leftSrc()).toContain("/5?");
    expect(rightSrc()).toContain("/6?");
  }, SWAP_TIMEOUT);
  expect(votes[1]).toEqual([7, 8]);
});

test("arrow keys register the matching Comparison", async () => {
  countedCommand("get_stats", () => stats());
  mockVote(() => ({
    next_pair: [wallpaper(7), wallpaper(8)],
    stats: stats(),
  }));
  await renderRankView();
  await waitPrefetched();

  await act(async () => {
    fireEvent.keyDown(window, { key: "ArrowLeft" });
  });
  await waitFor(() => {
    expect(leftSrc()).toContain("/3?");
  }, SWAP_TIMEOUT);
  expect(votes.length).toBe(1);
  expect(votes[0]).toEqual([1, 2]);

  await act(async () => {
    fireEvent.keyDown(window, { key: "ArrowRight" });
  });
  await waitFor(() => {
    expect(leftSrc()).toContain("/7?");
    expect(rightSrc()).toContain("/8?");
  }, SWAP_TIMEOUT);
  expect(votes.length).toBe(2);
  expect(votes[1]).toEqual([4, 3]); // winner = right, loser = left
});

test("rapid double inputs cannot register twice", async () => {
  countedCommand("get_stats", () => stats());
  mockVote(() => ({
    next_pair: [wallpaper(7), wallpaper(8)],
    stats: stats(),
  }));
  await renderRankView();
  await waitPrefetched();

  // Click plus key presses inside the same feedback window.
  await act(async () => {
    fireEvent.click(screen.getByAltText("Left Wallpaper"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
  });

  await waitFor(() => {
    expect(leftSrc()).toContain("/3?");
  }, SWAP_TIMEOUT);

  // Let everything settle; no further Comparison may appear.
  await new Promise((resolve) => setTimeout(resolve, FEEDBACK_MS + 400));
  expect(votes.length).toBe(1);
  expect(votes[0]).toEqual([1, 2]);
});

test("skip fetches a fresh pair without recording a vote", async () => {
  countedCommand("get_stats", () => stats());
  mockVote(() => ({
    next_pair: [wallpaper(9), wallpaper(10)],
    stats: stats(),
  }));
  // Third pair served when skip refetches.
  queuePairs(
    [wallpaper(1), wallpaper(2)],
    [wallpaper(3), wallpaper(4)],
    [wallpaper(5), wallpaper(6)],
  );
  await renderRankView();
  await waitPrefetched();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /skip pair/i }));
  });

  await waitFor(() => {
    expect(leftSrc()).toContain("/5?");
    expect(rightSrc()).toContain("/6?");
  }, SWAP_TIMEOUT);
  expect(votes.length).toBe(0);
});

test("Stop & Review navigates to review", async () => {
  countedCommand("get_stats", () => stats());
  function ViewProbe() {
    const { view } = useApp();
    return <span data-testid="view">{view}</span>;
  }
  render(
    <AppProvider>
      <ViewProbe />
      <RankView />
    </AppProvider>,
  );
  await screen.findByAltText("Left Wallpaper");

  fireEvent.click(screen.getByRole("button", { name: /stop & review/i }));

  expect(screen.getByTestId("view").textContent).toBe("review");
});
