import App from "@/App";
import { LibraryView } from "@/components/LibraryView";
import { useAppEvents } from "@/context/AppEventsContext";
import type { StatusFilter, Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { flush, renderInApp, settings, stats, wallpaper } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// Cross-view freshness, driven the way the curator drives it: the whole app,
// one click at a time. Every assertion here is about two views agreeing, and
// most of them are about the fetch that does not happen — a patch reaches a
// hidden view for free, and the one event that cannot be patched waits until
// the curator is looking (ADR 0015).

const PICK_FEEDBACK_MS = 300;

/** The Stats a vote answers with: a Round further on than the boot read. */
const VOTED_STATS = stats({
  round: 4,
  round_participated_count: 1,
  total_comparisons: 19,
});

let getPairCalls = 0;
let getReviewCalls = 0;
let listCalls = 0;
let listFilters: StatusFilter[];
let votes: Array<[number, number]>;
/** The library `list_wallpapers` reads, which a scan in a test appends to. */
let library: Wallpaper[];

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  getPairCalls = 0;
  getReviewCalls = 0;
  listCalls = 0;
  listFilters = [];
  votes = [];
  library = [
    wallpaper(1, { filename: "one.jpg", comparisons_count: 4, rating_mu: 29.2 }),
    wallpaper(2, { filename: "two.jpg", comparisons_count: 4, rating_mu: 20.8 }),
    wallpaper(3, {
      filename: "three.jpg",
      status: "kept",
      comparisons_count: 4,
      rating_mu: 25.5,
    }),
  ];

  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  // Review's bar resolves the stored destination as soon as the view mounts,
  // which is the one backend call this file's navigation adds (ADR 0018).
  mockCommand("expand_path", (args) => ({
    resolved: args?.input as string,
    exists: true,
  }));
  mockCommand("start_pregen", () => null);

  // Rank opens on wallpapers 1 and 2, which are also rows in the library, so a
  // vote and a library row are about the same two wallpapers.
  mockCommand("get_pair", () => {
    getPairCalls++;
    return getPairCalls === 1
      ? [wallpaper(1), wallpaper(2)]
      : [wallpaper(8), wallpaper(9)];
  });
  mockCommand("vote", (args) => {
    votes.push([args?.winnerId as number, args?.loserId as number]);
    return { next_pair: [wallpaper(8), wallpaper(9)], stats: VOTED_STATS };
  });

  mockCommand("get_review", () => {
    getReviewCalls++;
    return [
      wallpaper(1, { filename: "one.jpg" }),
      wallpaper(2, { filename: "two.jpg" }),
    ];
  });

  // The filter is honoured, because two of these tests turn on a scan adding
  // rows the current filter does not show.
  mockCommand("list_wallpapers", (args) => {
    listCalls++;
    const filter = (args?.filter as StatusFilter) ?? "all";
    listFilters.push(filter);
    return library.filter((w) => filter === "all" || w.status === filter);
  });

  mockCommand("keep_wallpaper", () => null);
  mockCommand("move_wallpaper", () => "/library/rejected/one.jpg");
});

const tab = (name: string) => screen.getByRole("tab", { name });

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
  await flush();
}

async function openApp() {
  const rendered = render(<App />);
  await flush();
  return rendered;
}

/** happy-dom never fetches an `<img>`; Rank refuses a pick until both arrive. */
async function panesArrive() {
  for (const side of ["Left", "Right"] as const) {
    const pane = screen.queryByAltText(`${side} Wallpaper`);
    if (!pane) continue;
    await act(async () => {
      fireEvent.load(pane);
    });
  }
}

/** Run out the pick-feedback delay that gates a vote reaching the backend. */
async function advancePickFeedback() {
  await act(async () => {
    jest.advanceTimersByTime(PICK_FEEDBACK_MS);
  });
  await flush();
}

const pageBar = (view: string) =>
  document.querySelector(
    `[data-view="${view}"] [data-slot="page-bar"]`,
  ) as HTMLElement;

const row = (id: number) =>
  document.querySelector(`[data-wallpaper-id="${id}"]`) as HTMLElement | null;

const cell = (id: number, slot: "score" | "status") =>
  row(id)?.querySelector(`[data-slot="${slot}"]`)?.textContent ?? null;

const scroller = () =>
  document.querySelector('[data-slot="library-rows"]') as HTMLElement;

/** Scroll the library the way a wheel does: the offset, then the event. */
async function scrollLibraryTo(offset: number) {
  const element = scroller();
  element.scrollTop = offset;
  await act(async () => {
    fireEvent.scroll(element);
  });
}

/**
 * What a real browser does to a scroll offset when the box goes away.
 *
 * `display: none` destroys the box and the offset with it, and happy-dom has no
 * layout to lose, so the drop has to be arranged here — otherwise the restore
 * would be asserting a value nothing had taken away.
 */
function browserDropsScrollOffset() {
  scroller().scrollTop = 0;
}

const select = (label: string) =>
  screen.getByLabelText(label) as HTMLSelectElement;

async function choose(label: string, value: string) {
  await act(async () => {
    fireEvent.change(select(label), { target: { value } });
  });
  await flush();
}

/**
 * Stands in for #112's error toast, which is the only caller `requestRefetch`
 * will ever have: `InvalidTransition` means the view acted on a row that had
 * already changed under it, and no patch can say what the row should be
 * instead.
 */
function RefetchProbe() {
  const { requestRefetch } = useAppEvents();
  return (
    <>
      <button onClick={() => requestRefetch("review")}>refetch review</button>
      <button onClick={() => requestRefetch("library")}>refetch library</button>
    </>
  );
}

test("a refetch request reaches the one view it names", async () => {
  // Boot lands on Library, so the view under test is the one being shown and
  // the request is paid immediately rather than owed.
  mockCommand("get_stats", () =>
    stats({ eligible_count: 1, round_participated_count: 0, evaluated_count: 0 }),
  );
  await renderInApp(
    <>
      <RefetchProbe />
      <LibraryView />
    </>,
  );
  expect(listCalls).toBe(1);

  // Named another view: every other view's rows are as good as they were, and
  // one failed request is no reason to make them all fetch again.
  await click(screen.getByRole("button", { name: "refetch review" }));
  expect(listCalls).toBe(1);

  await click(screen.getByRole("button", { name: "refetch library" }));
  expect(listCalls).toBe(2);
});

test("a keep in Review patches the hidden Library, and neither view fetches anything", async () => {
  // The assertion the whole ticket is built on. A keep is a patch: it names one
  // wallpaper and one Status, and Library edits that row where it already sits.
  // The absence of a second `list_wallpapers` is the point — a refetch here
  // would be fifty thumbnail requests for cards that are already drawn.
  await openApp();
  await click(tab("Library"));
  expect(listCalls).toBe(1);
  expect(cell(1, "status")).toBe("Active");

  await click(tab("Review"));
  expect(getReviewCalls).toBe(1);

  await click(screen.getByRole("button", { name: /keep one\.jpg/i }));

  expect(listCalls).toBe(1);
  expect(getReviewCalls).toBe(1);
  // Patched while nobody was looking at it, so the answer is already right when
  // the curator arrives rather than fetched once they do.
  expect(cell(1, "status")).toBe("Kept");

  await click(tab("Library"));
  expect(listCalls).toBe(1);
  expect(cell(1, "status")).toBe("Kept");
});

test("a reject drops the row from a Library filtered to Active", async () => {
  // The other half of a Status patch. A row can be edited or dropped and never
  // inserted: the event carries an id, so nothing here knows what an unseen row
  // looks like or where it would go.
  await openApp();
  await click(tab("Library"));
  await choose("Filter", "active");
  expect(listFilters).toEqual(["all", "active"]);
  expect(row(1)).not.toBeNull();

  await click(tab("Review"));
  await click(screen.getByRole("button", { name: /reject one\.jpg/i }));

  expect(listCalls).toBe(2); // the two the filter asked for, and no more
  expect(row(1)).toBeNull();
  expect(row(2)).not.toBeNull();
});

test("a library-scanned refetch waits until the view is shown", async () => {
  // A scan is the one thing that changes which rows exist, so it is the one
  // event a view answers with a fetch. It waits: a hidden Library pulling a
  // page of thumbnails mid-vote is exactly the contention ADR 0012 gave
  // pre-generation its own thread to keep off the next pair.
  await openApp();
  await click(tab("Review"));
  await click(tab("Library"));
  await click(tab("Rank"));
  expect([getReviewCalls, listCalls]).toEqual([1, 1]);

  library.push(wallpaper(4, { filename: "four.jpg" }));
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 40 });
  });
  await flush();

  // Both views owe a fetch and neither has made one.
  expect([getReviewCalls, listCalls]).toEqual([1, 1]);

  await click(tab("Review"));
  expect([getReviewCalls, listCalls]).toEqual([2, 1]);

  await click(tab("Library"));
  expect([getReviewCalls, listCalls]).toEqual([2, 2]);
  expect(row(4)).not.toBeNull();

  // And the debt is settled, not standing: coming back a second time fetches
  // nothing, because nothing has changed since.
  await click(tab("Rank"));
  await click(tab("Library"));
  expect(listCalls).toBe(2);
});

test("a scan that added nothing owes no refetch at all", async () => {
  // A scan inserts and never deletes, so an added count of zero says the rows
  // are the same rows. The count in the payload is what makes that knowable
  // without asking the backend.
  await openApp();
  await click(tab("Library"));
  await click(tab("Rank"));

  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 2000 });
  });
  await flush();

  await click(tab("Library"));
  expect(listCalls).toBe(1);
});

test("a scan-complete arriving while Library is showing fetches straight away", async () => {
  // Being shown is not a special case in the code and should not be one here:
  // the debt is settled immediately, because "showing" is the only condition
  // there is.
  await openApp();
  await click(tab("Library"));
  library.push(wallpaper(4, { filename: "four.jpg" }));

  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 40 });
  });
  await flush();

  expect(listCalls).toBe(2);
  expect(row(4)).not.toBeNull();
});

test("a vote patches Rank's headline from stats-changed", async () => {
  jest.useFakeTimers();
  await openApp();
  await panesArrive();
  expect(pageBar("rank").textContent).toContain("Round 3");

  await pressKey("ArrowLeft");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  // The headline reads the event rather than the response, so the one path into
  // it is the one #113's refetch after a scan will take to send it back to
  // Round 1.
  expect(pageBar("rank").textContent).toContain("Round 4");
  expect(pageBar("rank").textContent).toContain("19");
});

test("score-changed tells Library which two Scores moved, without a fetch", async () => {
  jest.useFakeTimers();
  await openApp();
  await panesArrive();
  await click(tab("Library"));
  expect([cell(1, "score"), cell(2, "score"), cell(3, "score")]).toEqual([
    "29.2",
    "20.8",
    "25.5",
  ]);

  await click(tab("Rank"));
  await pressKey("ArrowLeft");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  await click(tab("Library"));
  // The event names the two wallpapers in the Comparison and cannot name their
  // new Scores, so this is the whole of what the patch supports: those two
  // numbers are a Comparison out of date, and the third one is not.
  expect([cell(1, "score"), cell(2, "score"), cell(3, "score")]).toEqual([
    "Score moved",
    "Score moved",
    "25.5",
  ]);
  expect(listCalls).toBe(1);
});

test("a refetch makes every Score current again", async () => {
  jest.useFakeTimers();
  await openApp();
  await panesArrive();
  await click(tab("Library"));
  await click(tab("Rank"));
  await pressKey("ArrowLeft");
  await advancePickFeedback();

  library[0] = wallpaper(1, {
    filename: "one.jpg",
    comparisons_count: 5,
    rating_mu: 33.1,
  });
  await click(tab("Library"));
  await choose("Order by", "filename_asc");

  expect(cell(1, "score")).toBe("33.1");
});

test("returning to Library puts the curator back where they were", async () => {
  await openApp();
  await click(tab("Library"));
  await scrollLibraryTo(240);

  await click(tab("Rank"));
  browserDropsScrollOffset();

  await click(tab("Library"));
  // For the lifetime of the run and not across relaunches: a glance at Rank
  // must not cost the curator their place in a grid of two thousand cards.
  expect(scroller().scrollTop).toBe(240);
});

test("a filter change puts the list back at the top", async () => {
  await openApp();
  await click(tab("Library"));
  await scrollLibraryTo(240);

  await choose("Filter", "kept");

  expect(scroller().scrollTop).toBe(0);
  expect(listFilters).toEqual(["all", "kept"]);
  expect(row(3)).not.toBeNull();
  expect(row(1)).toBeNull();
});

test("an ordering change puts the list back at the top", async () => {
  // Even though the same rows come back: a position means something different
  // in a reordered list, so row 40 of one ordering is not row 40 of the next.
  await openApp();
  await click(tab("Library"));
  await scrollLibraryTo(240);

  await choose("Order by", "recently_added");

  expect(scroller().scrollTop).toBe(0);
});

test("a deferred refetch that changes the row set puts the list back at the top", async () => {
  await openApp();
  await click(tab("Library"));
  await scrollLibraryTo(240);
  await click(tab("Rank"));

  library.push(wallpaper(4, { filename: "four.jpg" }));
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 40 });
  });
  await flush();

  browserDropsScrollOffset();
  await click(tab("Library"));

  // The position was restored on the way in and then given up, because the rows
  // underneath it are not the rows it was measured against any more.
  expect(listCalls).toBe(2);
  expect(scroller().scrollTop).toBe(0);
});

test("a deferred refetch that finds the same rows keeps the place", async () => {
  // The case that separates "the rows changed" from "a fetch happened": a scan
  // adds Active wallpapers while the curator is reading the Kept ones, so the
  // fetch comes back with exactly what it had.
  await openApp();
  await click(tab("Library"));
  await choose("Filter", "kept");
  await scrollLibraryTo(240);
  await click(tab("Rank"));

  library.push(wallpaper(4, { filename: "four.jpg" }));
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 40 });
  });
  await flush();

  browserDropsScrollOffset();
  await click(tab("Library"));

  expect(listCalls).toBe(3);
  expect(scroller().scrollTop).toBe(240);
});
