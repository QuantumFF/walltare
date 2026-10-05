import {
  EMPTY_BASKET,
  livePicks,
  offer,
  reduceBasket,
  type Basket,
  type BasketEvent,
} from "@/lib/basket";
import type { Mark, MarkedResult } from "@/lib/client";
import { expect, test } from "bun:test";

// The basket's rules, without a page: what a Result offers, and what each
// event does to the Picks and the page's downloads (#419). How the page wires
// these to the cards, the tray and the backend is DiscoverView's tests'.

function result(id: string, mark: Mark = "unmarked"): MarkedResult {
  return { id, mark } as MarkedResult;
}

const a = result("aaaaaa");
const b = result("bbbbbb");
const c = result("cccccc");

/** The basket after `events`, from empty. */
function after(...events: BasketEvent[]): Basket {
  return events.reduce(reduceBasket, EMPTY_BASKET);
}

const picked = (r: MarkedResult): BasketEvent => ({
  type: "picked",
  result: r,
});
const taken = (...results: MarkedResult[]): BasketEvent => ({
  type: "taken",
  results,
});
const landed = (r: MarkedResult): BasketEvent => ({
  type: "progress",
  id: r.id,
  outcome: { kind: "landed" },
});
const failed = (r: MarkedResult): BasketEvent => ({
  type: "progress",
  id: r.id,
  outcome: { kind: "failed", message: "gone" },
});
const ids = (results: readonly MarkedResult[]) => results.map((r) => r.id);

test("an unmarked Result with no download offers Pick and Download, and a marked one neither", () => {
  expect(offer(EMPTY_BASKET, a)).toEqual({
    download: undefined,
    mark: null,
    offered: true,
    picked: false,
  });
  expect(offer(EMPTY_BASKET, result("held01", "in_library"))).toMatchObject({
    mark: "in_library",
    offered: false,
  });
  expect(offer(EMPTY_BASKET, result("gone01", "rejected"))).toMatchObject({
    mark: "rejected",
    offered: false,
  });
});

test("picked toggles a Pick, and a marked Result can't be one", () => {
  const marked = result("held01", "in_library");

  expect(ids(after(picked(a), picked(b)).picks)).toEqual(["aaaaaa", "bbbbbb"]);
  expect(after(picked(a), picked(a)).picks).toEqual([]);
  expect(after(picked(marked)).picks).toEqual([]);
  expect(offer(after(picked(a)), a).picked).toBe(true);
});

test("a taken Result is Downloading at the head of the queue and Queued behind it", () => {
  const state = after(taken(a, b));

  expect(state.queue).toEqual(["aaaaaa", "bbbbbb"]);
  expect(offer(state, a).download).toEqual({ kind: "downloading" });
  expect(offer(state, b).download).toEqual({ kind: "queued" });
  expect(offer(state, a).offered).toBe(false);
});

test("a Queued or Downloading Result can't be picked or taken again", () => {
  const state = after(taken(a, b), picked(a), picked(b), taken(a));

  expect(state.picks).toEqual([]);
  expect(state.queue).toEqual(["aaaaaa", "bbbbbb"]);
});

test("taking a Pick takes it out of the Picks and leaves the others", () => {
  const state = after(picked(a), picked(b), taken(a));

  expect(ids(state.picks)).toEqual(["bbbbbb"]);
  expect(state.queue).toEqual(["aaaaaa"]);
});

test("taken skips the Results that can't be downloaded and keeps the order given", () => {
  const marked = result("held01", "in_library");

  const state = after(picked(b), picked(a), taken(b, marked, a));

  expect(state.queue).toEqual(["bbbbbb", "aaaaaa"]);
});

test("a landed file says so, and is neither picked nor downloaded again", () => {
  const state = after(taken(a), landed(a));

  // The page marks it In library too, but a copy that missed the mark is
  // still the file that landed: the rule reads the download, not only the mark.
  expect(offer(state, a)).toEqual({
    download: { kind: "landed" },
    mark: null,
    offered: false,
    picked: false,
  });
  expect(after(taken(a), landed(a), picked(a)).picks).toEqual([]);
  expect(after(taken(a), landed(a), taken(a)).queue).toEqual([]);
  // And an In library copy says how it got there, not the mark.
  expect(offer(state, result("aaaaaa", "in_library")).mark).toBeNull();
});

test("a failed file says why, and can be picked and downloaded again", () => {
  const state = after(taken(a), failed(a));

  expect(offer(state, a)).toMatchObject({
    download: { kind: "failed", message: "gone" },
    offered: true,
  });
  expect(ids(after(taken(a), failed(a), picked(a)).picks)).toEqual(["aaaaaa"]);
  const again = after(taken(a), failed(a), taken(a));
  expect(offer(again, a).download).toEqual({ kind: "downloading" });
});

test("a refusal puts back the Picks it took, after any picked since", () => {
  const state = after(picked(a), picked(b), taken(a, b), picked(c), {
    type: "refused",
    ids: ["aaaaaa", "bbbbbb"],
  });

  expect(ids(state.picks)).toEqual(["aaaaaa", "bbbbbb", "cccccc"]);
  expect(state.queue).toEqual([]);
  expect(state.held).toEqual([]);
});

test("a refusal after a Clear leaves the Picks cleared", () => {
  const state = after(
    picked(a),
    picked(b),
    taken(a, b),
    picked(c),
    { type: "cleared" },
    { type: "refused", ids: ["aaaaaa", "bbbbbb"] },
  );

  expect(state.picks).toEqual([]);
  // Nothing was queued, so the cards offer Download again all the same.
  expect(offer(state, a).offered).toBe(true);
});

test("a download the backend accepted has nothing left to put back", () => {
  const state = after(picked(a), taken(a), {
    type: "accepted",
    ids: ["aaaaaa"],
  });

  expect(state.held).toEqual([]);
  expect(state.queue).toEqual(["aaaaaa"]);
});

test("a new search forgets how files ended, and a Load more doesn't", () => {
  const ended = [taken(a, b), landed(a), failed(b)];

  const searched = after(...ended, {
    type: "searched",
    results: [],
    at: "first",
  });
  expect(offer(searched, a).download).toBeUndefined();
  expect(offer(searched, b).download).toBeUndefined();

  const more = after(...ended, { type: "searched", results: [], at: "more" });
  expect(offer(more, a).download).toEqual({ kind: "landed" });
});

test("a search leaves the queue alone", () => {
  const state = after(taken(a), { type: "searched", results: [], at: "first" });

  expect(offer(state, a).download).toEqual({ kind: "downloading" });
});

test("Picks survive a search that doesn't show them", () => {
  const state = after(picked(a), {
    type: "searched",
    results: [b],
    at: "first",
  });

  expect(ids(livePicks(state))).toEqual(["aaaaaa"]);
});

test("a Pick a later search marks leaves, and doesn't come back with the next", () => {
  const marked = after(picked(a), picked(b), {
    type: "searched",
    results: [result("aaaaaa", "in_library"), b],
    at: "first",
  });
  expect(ids(livePicks(marked))).toEqual(["bbbbbb"]);

  const moved = reduceBasket(marked, {
    type: "searched",
    results: [c],
    at: "first",
  });
  expect(ids(livePicks(moved))).toEqual(["bbbbbb"]);
});

test("a taken Pick a search marks isn't put back by a refusal", () => {
  const state = after(
    picked(a),
    taken(a),
    { type: "searched", results: [result("aaaaaa", "rejected")], at: "more" },
    { type: "refused", ids: ["aaaaaa"] },
  );

  expect(livePicks(state)).toEqual([]);
});
