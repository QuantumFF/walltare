import { LibraryView } from "@/components/LibraryView";
import type { Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Profiler } from "react";
import {
  flush,
  mockBootedApp,
  mockTransitions,
  renderInApp,
  settings,
  viewportWidth,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Which tree a scroll rebuilds.
//
// Not a question a curator can put into words, and the reason it is worth a
// test anyway is that the answer is invisible until the library is large enough
// for the frames to show it. The library virtualiser calls its re-render inside
// a `flushSync`, from the scroll handler, so whoever calls `useVirtualizer` is
// the tree a wheel gesture rebuilds — and while that call lived on the page,
// every crossing of a row boundary rebuilt the filter chips, the ordering
// control, the reject destination line and the mounted lightbox along with the
// cards (#231).
//
// So these are white-box, in the same spirit as `prop-identities.test.tsx` and
// ADR 0007's `will-change` class-name pin: the property is invisible and the
// cost of losing it is not, and the way it gets lost is somebody moving the
// hook back up a level.

/** A library of `count` wallpapers, all Active. */
function cards(count: number): Wallpaper[] {
  return Array.from({ length: count }, (_, i) => wallpaper(i + 1));
}

/** How many commits the page's whole subtree made since the counter was reset. */
let commits: number;

afterEach(() => {
  cleanup();
  // The viewport outlives the test that set it, and the column count the window
  // counts its rows in is read from it.
  viewportWidth(1024);
});

beforeEach(() => {
  commits = 0;
  mockBootedApp();
  mockCommand("get_settings", () => settings());
  mockCommand("expand_path", (args) => ({
    resolved: args.input,
    exists: true,
  }));
  mockTransitions(() => []);
});

/** The library page, at four cards to a row, with every row already fetched. */
async function openLibrary(count: number) {
  viewportWidth(1024);
  const list = cards(count);
  mockCommand("list_wallpapers", () => list);
  await renderInApp(
    <Profiler
      id="library"
      onRender={() => {
        commits += 1;
      }}
    >
      <LibraryView />
    </Profiler>,
  );
  await flush();
  browserLaysOutTheScroller();
  commits = 0;
}

const scroller = () =>
  document.querySelector('[data-slot="library-rows"]') as HTMLElement;

const gridContainer = () =>
  screen.getByRole("grid", { name: "Wallpapers in the library" });

/**
 * The scroll box a browser's layout produces and happy-dom does not: a box a
 * screen tall, over content running well past the end of it.
 *
 * happy-dom leaves `clientHeight` and `scrollHeight` at zero, and the
 * virtualiser clamps every offset it is given to `scrollHeight - clientHeight`.
 * The same arrangement `LibraryView.test.tsx` makes, and the two numbers only
 * have to make a range exist — which rows end up mounted at an offset is the
 * grid's own arithmetic over the row height.
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
 * A wheel gesture, as the DOM reports one: the offset moves and the element
 * says so. happy-dom moves `scrollTop` on assignment and dispatches nothing,
 * while the offset is what the window is read from.
 */
async function scrollTo(offset: number) {
  await act(async () => {
    scroller().scrollTop = offset;
    fireEvent.scroll(scroller());
  });
}

/**
 * The props one element was last rendered with, as an identity.
 *
 * JSX builds a fresh props object on every render of the component holding the
 * element, and React writes it onto the DOM node only when that component
 * actually re-rendered. So this object is a render counter with a resolution of
 * one: it moves when the component above the element rendered, and it stays put
 * when the component was left alone. There is no other way in — a render has no
 * rendering, and every attribute here is identical before and after.
 *
 * `__reactProps$` and not the fiber's `memoizedProps`. React alternates two
 * fibers per element and the DOM node keeps pointing at whichever one it was
 * created with, so `memoizedProps` read this way is a render behind; the props
 * React caches on the node beside it are refreshed on every host update.
 */
function renderedProps(node: HTMLElement): unknown {
  const key = Object.keys(node).find((name) =>
    name.startsWith("__reactProps$"),
  );
  if (key === undefined) throw new Error("the element carries no React props");
  return (node as unknown as Record<string, unknown>)[key];
}

/** The wallpapers with a node right now, by id, in the order they are in. */
function mountedIds(): number[] {
  return screen
    .queryAllByRole("gridcell")
    .map((cell) =>
      Number(
        /^wall-(\d+)\.jpg/.exec(cell.getAttribute("aria-label") ?? "")?.[1],
      ),
    );
}

/**
 * Whether an element was left alone by a commit.
 *
 * Asserted as a boolean rather than by handing the two props objects to
 * `toBe`, because a failure would print one: they carry React elements, whose
 * `_owner` is a fiber, whose reachable graph is the document.
 */
function untouched(node: HTMLElement, before: unknown): boolean {
  return renderedProps(node) === before;
}

test("a scroll that crosses a row boundary re-renders the grid and not the page", async () => {
  // 400 wallpapers at four to a row, and a row is 154px at the fallback height:
  // 130 for the card plus the `gap-6` between rows. So 400px in is two row
  // boundaries down, which is a short flick of the wheel.
  await openLibrary(400);
  const pageBefore = renderedProps(scroller());
  const gridBefore = renderedProps(gridContainer());
  const mountedBefore = mountedIds();

  await scrollTo(400);

  // The grid rebuilt, and it rebuilt something: rows came in at the bottom and
  // went out at the top, which is the whole job.
  expect(untouched(gridContainer(), gridBefore)).toBe(false);
  expect(mountedIds()).not.toEqual(mountedBefore);

  // And the page did not. Its own element is holding the same props object it
  // was handed before the scroll, so `LibraryView` never ran — the chips, the
  // ordering control, the destination line and the lightbox are all untouched
  // inside the gesture. This is the assertion that fails against the code
  // before #231, where the page is what `useVirtualizer` re-rendered.
  expect(untouched(scroller(), pageBefore)).toBe(true);

  // And the count: the crossing is one commit of the grid's subtree, so nothing
  // above it was dragged in and nothing below it committed twice.
  expect(commits).toBe(1);
});
