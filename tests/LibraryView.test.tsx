import { LibraryView } from "@/components/LibraryView";
import type { Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
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

let library: Wallpaper[];

afterEach(() => {
  cleanup();
  // The viewport outlives the test that set it, and the column count — which
  // the window counts its rows in — is read from it. happy-dom's default is
  // 1024, which is four cards to a row.
  viewportWidth(1024);
});

beforeEach(() => {
  library = [];
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("list_wallpapers", () => library);
});

/** A library of `count` wallpapers, on the page and fetched. */
async function openLibrary(count: number) {
  // Four cards to a row, which is the count the window and the arrow keys both
  // read off the same table (`useGridColumns`).
  viewportWidth(1024);
  library = Array.from({ length: count }, (_, i) => wallpaper(i + 1));
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
