import { LibraryView } from "@/components/LibraryView";
import type { Settings, Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  flush,
  renderInApp,
  settings,
  stats,
  viewportWidth,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The window of cards, at a library size that has to have one. ADR 0016 fetches
// every row and mounts a few dozen of them, so what these tests ask about is the
// difference between those two numbers: which cards have a DOM node, and what
// the selection does when it lands on a card that has none.
//
// happy-dom does no layout and reports every box as zero-sized, which would
// leave the window with no height to fill and nothing in it. `LibraryView`'s
// fallbacks are what make a zero-sized box mean a window of about a screen
// rather than an empty grid, and so what makes either question answerable here
// (#131).

/** What `~` expands to in this file, matching `ReviewView.test.tsx`'s. */
const HOME = "/home/curator";

let library: Wallpaper[];
/** How many times the page asked for the list, since a patch must ask for none. */
let listCalls: number;

afterEach(() => {
  cleanup();
  // The viewport outlives the test that set it, and the column count — which
  // the window counts its rows in — is read from it. happy-dom's default is
  // 1024, which is four cards to a row.
  viewportWidth(1024);
});

beforeEach(() => {
  library = [];
  listCalls = 0;
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("list_wallpapers", (args) => {
    listCalls++;
    const filter = (args?.filter as string) ?? "all";
    return library.filter((w) => filter === "all" || w.status === filter);
  });
  // A reject reads the stored destination and asks whether it is relative, which
  // cannot be read off the string (ADR 0018).
  mockCommand("expand_path", (args) => {
    const input = String(args?.input);
    return { resolved: input.replace(/^~/, HOME), exists: true };
  });
});

/** A library of `count` wallpapers, on the page and fetched. */
async function openLibrary(count: number) {
  await openLibraryOf(
    Array.from({ length: count }, (_, i) => wallpaper(i + 1)),
  );
}

/** These rows, on the page and fetched, with whatever settings the test needs. */
async function openLibraryOf(rows: Wallpaper[], stored: Partial<Settings> = {}) {
  // Four cards to a row, which is the count the window and the arrow keys both
  // read off the same table (`useGridColumns`).
  viewportWidth(1024);
  library = rows;
  mockCommand("get_settings", () => settings(stored));
  await renderInApp(<LibraryView />);
  await flush();
}

/** One card, by the name it carries as a cell, or `null` when it has no node. */
function card(id: number): HTMLElement | null {
  return screen.queryByRole("gridcell", { name: `wall-${id}.jpg, Active` });
}

function mountedCards(): HTMLElement[] {
  return screen.queryAllByRole("gridcell");
}

/**
 * The card for a wallpaper, found by the request its image makes for that row's
 * thumbnail — which is the one thing on it that does not move when the Status
 * does. Its accessible name is `<filename>, <Status>` (ADR 0019), so the name is
 * where a patched row is legible.
 */
const cardFor = (id: number): HTMLElement | null =>
  document
    .querySelector(`img[src="wallpaper://localhost/image/${id}?size=small"]`)
    ?.closest<HTMLElement>('[role="gridcell"]') ?? null;

const cardName = (id: number) => cardFor(id)?.getAttribute("aria-label") ?? null;

/**
 * The title and description of the one toast that is up, or `null` for none.
 *
 * Read off `data-slot` rather than a role, since Radix gives the toast and its
 * own announce region the same `role="status"`.
 */
function toast(): { title: string; description: string | null } | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return {
    title: root.querySelector("[data-slot='toast-title']")?.textContent ?? "",
    description:
      root.querySelector("[data-slot='toast-description']")?.textContent ?? null,
  };
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

/** The overlay button for one action on one card, by its accessible name. */
const button = (name: RegExp) => screen.getByRole("button", { name });

async function choose(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
  await flush();
}

const scroller = () =>
  document.querySelector('[data-slot="library-rows"]') as HTMLElement;

/**
 * The scroll box a browser's layout produces and happy-dom does not: a box a
 * screen tall, over content running well past the end of it.
 *
 * The virtualiser clamps every scroll it makes to the range the element itself
 * reports, `scrollHeight - clientHeight`, and happy-dom leaves both at zero. So
 * with nothing arranged there is no range to move through: every scroll lands
 * back at the top and no row can be brought in at all. The two numbers only
 * have to make a range exist — which rows end up mounted at the offset is the
 * virtualiser's arithmetic over the row height, not these.
 */
function browserLaysOutTheScroller() {
  const box = scroller();
  Object.defineProperty(box, "clientHeight", {
    value: 800,
    configurable: true,
  });
  Object.defineProperty(box, "scrollHeight", {
    value: 100_000,
    configurable: true,
  });
}

/**
 * The `scroll` event a browser fires and happy-dom does not.
 *
 * happy-dom moves `scrollTop` — for an assignment, and for the `scrollTo` the
 * virtualiser makes to bring a row in — and dispatches nothing, while the
 * offset is what the virtualiser reads its window from. So the event is fired
 * here, which is the arrangement `freshness.test.tsx` already makes for the
 * scroll position: the real offset, plus the notification a browser sends about
 * it.
 */
async function browserReportsScroll() {
  await act(async () => {
    fireEvent.scroll(scroller());
  });
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
}

/** Put focus on the grid's one tab stop, the way Tab does. */
async function enterGrid() {
  await act(async () => {
    mountedCards()[0].focus();
  });
}

test("a library past the window has only a window of it in the DOM", async () => {
  await openLibrary(400);

  // Every row was fetched and a few dozen cards were built. The count itself is
  // not the assertion — it moves with the box, the breakpoint and the overscan
  // — but the distance between it and 400 is, because 400 images and 400
  // overlays is the page ADR 0016 rules out on ADR 0007's arithmetic.
  const mounted = mountedCards();
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted.length).toBeLessThan(library.length);

  // The top of the library, which is where the curator is standing.
  expect(card(1)).not.toBeNull();
  expect(card(400)).toBeNull();
});

test("moving the selection to the last card scrolls it in and focuses it", async () => {
  await openLibrary(400);
  browserLaysOutTheScroller();
  await enterGrid();
  expect(document.activeElement).toBe(card(1));

  // `End` selects a wallpaper with no node, so the grid asks for its row before
  // it moves focus: the reveal scrolls the row in, the commit that follows
  // mounts it, and the focus lands on the second pass. Focusing a node that
  // does not exist is the one way the pattern breaks (ADR 0019).
  await press("End");
  await browserReportsScroll();

  expect(document.activeElement).toBe(card(400));
  // And the window moved rather than grew: the card the curator started on is
  // a hundred rows behind them and has given its node up.
  expect(card(1)).toBeNull();
});

// The four actions (#132). The page the curator is browsing is the page they act
// on, and what separates it from Review is that nothing is removed ahead of the
// write: the row is patched by the `status-changed` this page publishes after
// the call, so a failure has nothing to undo.

test("keep records the decision and the row changes where it sits", async () => {
  const keptIds: unknown[] = [];
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args?.id);
    return null;
  });

  await click(button(/keep wall-1\.jpg/i));

  expect(keptIds).toEqual([1]);
  // Patched in place, and under the default filter of All the card stays put
  // and says what it now is. No second fetch: the card is already drawn, so a
  // refetch here would be a page of thumbnail requests for it (ADR 0015).
  expect(cardName(1)).toBe("wall-1.jpg, Kept");
  expect(cardName(2)).toBe("wall-2.jpg, Active");
  expect(listCalls).toBe(1);
  // A virtualised row may reorder or filter itself out from under the click, so
  // the confirmation is the toast rather than the card (ADR 0017).
  expect(toast()).toEqual({ title: "Kept wall-1.jpg", description: null });
});

test("make active undoes a keep and says which Status it landed on", async () => {
  const unkeptIds: unknown[] = [];
  await openLibraryOf([wallpaper(1, { status: "kept" })]);
  mockCommand("unkeep_wallpaper", (args) => {
    unkeptIds.push(args?.id);
    return null;
  });

  await click(button(/make active wall-1\.jpg/i));

  expect(unkeptIds).toEqual([1]);
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  // CONTEXT.md gives the keep inverse no noun, so the copy names the resulting
  // Status rather than coining one (ADR 0017, ADR 0019).
  expect(toast()).toEqual({
    title: "wall-1.jpg is Active again",
    description: null,
  });
});

test("reject moves the file to the stored destination and names where it went", async () => {
  const moveArgs: unknown[] = [];
  // Not the default, so what reaches `move_wallpaper` can only have come from
  // the settings object the read-out is built on (ADR 0018).
  await openLibraryOf([wallpaper(1)], { reject_destination: "~/bin" });
  mockCommand("move_wallpaper", (args) => {
    moveArgs.push(args);
    return `${HOME}/bin/wall-1 (1).jpg`;
  });

  await click(button(/reject wall-1\.jpg/i));

  // The Written path as stored, not the resolved one: `expand_path` is asked
  // whether the destination is relative and never asked to rewrite it.
  expect(moveArgs).toEqual([{ id: 1, destinationFolder: "~/bin" }]);
  expect(cardName(1)).toBe("wall-1.jpg, Rejected");
  // `unique_destination` suffixed the name rather than overwriting what was
  // already sitting there, and the returned path is the only account of it
  // (ADR 0003, ADR 0018).
  expect(toast()).toEqual({
    title: "Rejected wall-1.jpg",
    description: `${HOME}/bin/wall-1 (1).jpg`,
  });
});

test("restore puts the file back and the wallpaper on Active", async () => {
  const restoredIds: unknown[] = [];
  await openLibraryOf([
    wallpaper(1, {
      status: "rejected",
      path: "/library/rejected/wall-1.jpg",
      origin_path: "/library/wall-1.jpg",
    }),
  ]);
  mockCommand("restore_wallpaper", (args) => {
    restoredIds.push(args?.id);
    return "/library/wall-1.jpg";
  });

  await click(button(/restore wall-1\.jpg/i));

  expect(restoredIds).toEqual([1]);
  // Active, whichever Status it held before the reject: Kept is a judgement
  // about a rating and changing your mind about a reject is not that judgement
  // (CONTEXT.md, ADR 0009).
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  // The path always, unlike a reject's: an Origin appears nowhere on screen, so
  // this line is the only account of where the file went (ADR 0017).
  expect(toast()).toEqual({
    title: "Restored wall-1.jpg",
    description: "/library/wall-1.jpg",
  });
});

test("a row whose new Status falls outside the filter leaves the grid", async () => {
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("keep_wallpaper", () => null);
  await choose("Filter", "active");
  expect(listCalls).toBe(2);

  await click(button(/keep wall-1\.jpg/i));

  // Dropped rather than edited, because a row cannot stay in a list of Active
  // wallpapers after a keep. The other direction is not a patch this page can
  // make: an event carries an id and not a row, so nothing here knows what a
  // missing wallpaper looks like or where it belongs in the ordering.
  expect(cardFor(1)).toBeNull();
  expect(cardFor(2)).not.toBeNull();
  expect(listCalls).toBe(2);
});

test("a failed action leaves the card where it was and says why", async () => {
  expectConsoleError(/Failed to move wallpaper/);
  await openLibraryOf([wallpaper(1)]);
  mockCommand("move_wallpaper", () =>
    Promise.reject({ kind: "io", message: "destination is read-only" }),
  );

  await click(button(/reject wall-1\.jpg/i));

  // Nothing was removed ahead of the write and nothing was published after it,
  // so the row is untouched — which is the difference from Review, where a card
  // leaves the grid on the click and has to be put back. The title is the
  // frontend's and the detail is the backend's own account (ADR 0017).
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(listCalls).toBe(1);
  expect(toast()).toEqual({
    title: "Couldn't reject wall-1.jpg",
    description: "destination is read-only",
  });
});

test("an origin-less Restore is refused before any call is made", async () => {
  await openLibraryOf([
    wallpaper(1, { status: "rejected", path: "/library/rejected/wall-1.jpg" }),
  ]);
  // No `restore_wallpaper` mock at all: reaching the backend is what this test
  // says must not happen, and an unmocked command rejects.

  await click(button(/restore wall-1\.jpg/i));

  // The cohort rejected before ADR 0009 recorded an Origin. `origin_path` is on
  // the DTO, so the refusal is the frontend's own sentence and this page is
  // never asked (ADR 0009, ADR 0019).
  expect(cardName(1)).toBe("wall-1.jpg, Rejected");
  expect(toast()).toEqual({
    title: "Can't restore wall-1.jpg",
    description:
      "Rejected before Restore existed, so nothing recorded where it came from.",
  });
});

test("the direct keys act on the selected card, the same as its buttons", async () => {
  const keptIds: unknown[] = [];
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args?.id);
    return null;
  });

  await act(async () => {
    mountedCards()[0].focus();
  });
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "k" });
  });
  await flush();

  // One handler behind both, so a key and a click cannot drift into meaning
  // different things: the same command, the same patch, the same toast.
  expect(keptIds).toEqual([1]);
  expect(cardName(1)).toBe("wall-1.jpg, Kept");
  expect(toast()?.title).toBe("Kept wall-1.jpg");
});
