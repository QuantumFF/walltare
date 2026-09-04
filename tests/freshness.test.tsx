import App from "@/App";
import type { StatusFilter, Wallpaper } from "@/lib/client";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import { flush, mockListings, settings, stats, wallpaper } from "./fixtures";
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
let reviewFetches = 0;
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
  reviewFetches = 0;
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
    resolved: args.input,
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
    votes.push([args.winnerId, args.loserId]);
    return { next_pair: [wallpaper(8), wallpaper(9)], stats: VOTED_STATS };
  });

  // The two pages ask the same command, and the limit is what tells them apart
  // (ADR 0028). Review's fetches and the library page's are counted separately
  // here, because which of the two a refetch reaches is the whole subject of
  // this file.
  mockListings({
    review: () => {
      reviewFetches++;
      return [
        wallpaper(1, { filename: "one.jpg" }),
        wallpaper(2, { filename: "two.jpg" }),
      ];
    },
    // The filter is honoured, because two of these tests turn on a scan adding
    // rows the current filter does not show.
    library: (args) => {
      listCalls++;
      const filter = args.filter;
      listFilters.push(filter);
      return library.filter((w) => filter === "all" || w.status === filter);
    },
  });

  // Every transition answers with the row it wrote, so these mocks derive one
  // from the library rather than returning a path: a patch carries that row
  // whole, and a fixture that dropped the Score or the comparison count would
  // be a row the backend could never report (ADR 0023).
  mockCommand("keep_wallpaper", (args) => wrote(args, { status: "kept" }));
  mockCommand("move_wallpaper", (args) => {
    const before = row(args);
    return {
      ...before,
      status: "rejected",
      path: `/library/rejected/${before.filename}`,
      // What the backend writes: `origin_path = path`, in the same statement
      // that overwrites `path`.
      origin_path: before.path,
    };
  });
});

/** The library row a transition was asked about. */
function row(args: { id: number }): Wallpaper {
  const id = args.id;
  const found = library.find((w) => w.id === id);
  if (!found) throw new Error(`no library row with id ${id}`);
  return found;
}

/** That row as a transition rewrote it. */
function wrote(
  args: { id: number },
  over: Partial<Wallpaper>,
): Wallpaper {
  return { ...row(args), ...over };
}

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

/**
 * The card for a wallpaper, scoped to the library page and found by the request
 * its image makes for that row's thumbnail.
 *
 * The `<li data-wallpaper-id>` these queries used to reach for went with the
 * interim read-out (#129), and the scoping is not decoration: Review is mounted
 * behind this page and its list is drawn from the same two wallpapers, so an
 * unscoped query would answer about the wrong view's card.
 */
const card = (id: number): HTMLElement | null => {
  const image = document
    .querySelector('[data-view="library"]')
    ?.querySelector(`img[src="wallpaper://localhost/image/${id}?size=small"]`);
  return image?.closest<HTMLElement>('[role="gridcell"]') ?? null;
};

/** What the card calls itself: `<filename>, <Status>` (ADR 0019). */
const cardName = (id: number) => card(id)?.getAttribute("aria-label") ?? null;

/** The Score badge: μ to one decimal, `Unrated`, or `Score moved`. */
const badge = (id: number) =>
  card(id)?.querySelector('[data-slot="badge"]')?.textContent ?? null;

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

/**
 * The library page's own bar, which both of its controls live on.
 *
 * Scoped like the card queries above: Review is mounted behind this page and
 * carries a bar of its own, so an unscoped query would be free to answer about
 * the wrong view's (#130).
 */
const libraryBar = () => within(pageBar("library"));

/** Press one of the filter chips, by the word on it. */
async function filterBy(label: string) {
  await click(libraryBar().getByRole("button", { name: label }));
}

/** Choose one of ADR 0014's four orderings, by its wire name. */
async function orderBy(value: string) {
  await act(async () => {
    fireEvent.change(libraryBar().getByLabelText("Order by"), {
      target: { value },
    });
  });
  await flush();
}

/** The toast in the shell's one slot, as it reads. */
const toastText = () =>
  screen.queryByRole("status")?.textContent ??
  screen.queryByRole("alert")?.textContent ??
  null;

test.each([
  [
    "invalid_transition",
    "wallpaper 1 is already rejected",
  ] as const,
  ["not_found", "no wallpaper with id 1"] as const,
])(
  "a transition refused with %s refetches the page that acted",
  async (kind, message) => {
    // Both kinds mean the same thing: the row this page acted on had already
    // changed underneath it. No patch can say what it should be instead, and
    // leaving it on screen means the next click reproduces it, so the page
    // fetches and the toast says the one sentence that is true of both — a row
    // that refused and a row that is gone (ADR 0017 as amended by ADR 0025).
    mockCommand("move_wallpaper", () => Promise.reject({ kind, message }));
    expectConsoleError(/Failed to move wallpaper/);
    await openApp();
    await click(tab("Library"));
    expect(listCalls).toBe(1);

    await click(within(card(1)!).getByRole("button", { name: /reject/i }));

    expect(listCalls).toBe(2);
    expect(toastText()).toContain("one.jpg has already changed");
    // The backend's own sentence is not shown for these two: what the curator
    // has to know is that the row moved, and the refetch is what shows them
    // what it moved to.
    expect(toastText()).not.toContain(message);
  },
);

test("a refused transition refetches only the page that acted", async () => {
  // Every other view's rows are as good as they were, and one failed request is
  // no reason to make them all fetch again. Review is the page acting here, so
  // the hidden Library must not move.
  mockCommand("keep_wallpaper", () =>
    Promise.reject({
      kind: "invalid_transition",
      message: "cannot keep rejected wallpaper with id 1",
    }),
  );
  expectConsoleError(/Failed to keep wallpaper/);
  await openApp();
  await click(tab("Library"));
  await click(tab("Review"));
  expect([reviewFetches, listCalls]).toEqual([1, 1]);

  await click(screen.getByRole("button", { name: /keep one\.jpg/i }));

  expect([reviewFetches, listCalls]).toEqual([2, 1]);
});

test("a refused transition on a hidden page owes the refetch rather than making it", async () => {
  // The deferral holds for the same reason it holds after a scan: an Undo can
  // be pressed eight seconds later on a page the curator has left, and fifty
  // thumbnail requests from a hidden Review are what ADR 0012 gave
  // pre-generation its own thread to keep off the next pair. The `owe` the
  // module reaches for is the one `useRefetchWhenShown` already returned.
  await openApp();
  await click(tab("Review"));
  expect(reviewFetches).toBe(1);

  // Keep, then leave, then press the Undo the keep's toast is still holding —
  // and refuse it, because the row moved while the curator was away.
  await click(screen.getByRole("button", { name: /keep one\.jpg/i }));
  await click(tab("Rank"));
  mockCommand("unkeep_wallpaper", () =>
    Promise.reject({ kind: "not_found", message: "no wallpaper with id 1" }),
  );
  expectConsoleError(/Failed to unkeep wallpaper/);
  await click(screen.getByRole("button", { name: "Undo" }));

  expect(reviewFetches).toBe(1);

  await click(tab("Review"));
  expect(reviewFetches).toBe(2);
});

test("a keep in Review patches the hidden Library, and neither view fetches anything", async () => {
  // The assertion the whole ticket is built on. A keep is a patch: it names one
  // wallpaper and one Status, and Library edits that row where it already sits.
  // The absence of a second `list_wallpapers` is the point — a refetch here
  // would be fifty thumbnail requests for cards that are already drawn.
  await openApp();
  await click(tab("Library"));
  expect(listCalls).toBe(1);
  expect(cardName(1)).toBe("one.jpg, Active");

  await click(tab("Review"));
  expect(reviewFetches).toBe(1);

  await click(screen.getByRole("button", { name: /keep one\.jpg/i }));

  expect(listCalls).toBe(1);
  expect(reviewFetches).toBe(1);
  // Patched while nobody was looking at it, so the answer is already right when
  // the curator arrives rather than fetched once they do. The card's own name
  // is where the Status is legible, since otherwise it is a pill and a dimming.
  expect(cardName(1)).toBe("one.jpg, Kept");

  await click(tab("Library"));
  expect(listCalls).toBe(1);
  expect(cardName(1)).toBe("one.jpg, Kept");
});

test("a reject drops the row from a Library filtered to Active", async () => {
  // The other half of a Status patch. A row can be replaced or dropped and
  // never inserted, and the bound is position rather than ignorance: nothing in
  // a row says where it belongs in an ordering by Score (ADR 0023).
  await openApp();
  await click(tab("Library"));
  await filterBy("Active");
  expect(listFilters).toEqual(["all", "active"]);
  expect(card(1)).not.toBeNull();

  await click(tab("Review"));
  await click(screen.getByRole("button", { name: /reject one\.jpg/i }));

  expect(listCalls).toBe(2); // the two the filter asked for, and no more
  expect(card(1)).toBeNull();
  expect(card(2)).not.toBeNull();
});

test("a reject in Review leaves the Library row it patched restorable", async () => {
  // The case #141 shipped through. The reject test above asserts the filter
  // where the row is *dropped*, so its stale columns never render; under All the
  // row stays, and every column the reject wrote is one this page is now showing
  // — including the Origin its Restore reads to decide whether it can be pressed
  // at all (ADR 0009).
  const restores: unknown[] = [];
  mockCommand("restore_wallpaper", (args) => {
    restores.push(args.id);
    // The Origin spent and the file back at it, which is what the backend
    // writes in the one statement that clears the column.
    return wrote(args, { status: "active", origin_path: null });
  });
  await openApp();
  await click(tab("Library"));
  expect(cardName(1)).toBe("one.jpg, Active");

  await click(tab("Review"));
  await click(screen.getByRole("button", { name: /reject one\.jpg/i }));

  await click(tab("Library"));
  expect(listCalls).toBe(1);
  expect(cardName(1)).toBe("one.jpg, Rejected");

  // No refetch stood between the reject and this press, which is the whole of
  // what made the bug invisible: navigating away and back fixed the row.
  await click(within(card(1)!).getByRole("button", { name: /restore/i }));

  expect(restores).toEqual([1]);
  expect(cardName(1)).toBe("one.jpg, Active");
  expect(listCalls).toBe(1);
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
  expect([reviewFetches, listCalls]).toEqual([1, 1]);

  library.push(wallpaper(4, { filename: "four.jpg" }));
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 40 });
  });
  await flush();

  // Both views owe a fetch and neither has made one.
  expect([reviewFetches, listCalls]).toEqual([1, 1]);

  await click(tab("Review"));
  expect([reviewFetches, listCalls]).toEqual([2, 1]);

  await click(tab("Library"));
  expect([reviewFetches, listCalls]).toEqual([2, 2]);
  expect(card(4)).not.toBeNull();

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
  expect(card(4)).not.toBeNull();
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
  // Read off the card's own badge, which is where a Score is written now that
  // the page draws cards rather than describing them (#129).
  expect([badge(1), badge(2), badge(3)]).toEqual(["29.2", "20.8", "25.5"]);

  await click(tab("Rank"));
  await pressKey("ArrowLeft");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  await click(tab("Library"));
  // The event names the two wallpapers in the Comparison and cannot name their
  // new Scores, so this is the whole of what the patch supports: those two
  // numbers are a Comparison out of date, and the third one is not.
  expect([badge(1), badge(2), badge(3)]).toEqual([
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
  await orderBy("filename_asc");

  expect(badge(1)).toBe("33.1");
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

  await filterBy("Kept");

  expect(scroller().scrollTop).toBe(0);
  expect(listFilters).toEqual(["all", "kept"]);
  expect(card(3)).not.toBeNull();
  expect(card(1)).toBeNull();
});

test("an ordering change puts the list back at the top", async () => {
  // Even though the same rows come back: a position means something different
  // in a reordered list, so row 40 of one ordering is not row 40 of the next.
  await openApp();
  await click(tab("Library"));
  await scrollLibraryTo(240);

  await orderBy("recently_added");

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
  await filterBy("Kept");
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
