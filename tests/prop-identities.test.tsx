import type { RejectDestination } from "@/components/RejectDestination";
import {
  useWallpaperRows,
  type WallpaperRows,
} from "@/components/useWallpaperRows";
import { WallpaperCard } from "@/components/WallpaperCard";
import {
  WallpaperGrid,
  type GridSelection,
  type WallpaperGridHandle,
} from "@/components/WallpaperGrid";
import type { Wallpaper } from "@/lib/client";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useReducer, useRef, useState } from "react";
import {
  click,
  flush,
  mockBootedApp,
  renderInApp,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// What a card is handed, and whether it is the same thing twice.
//
// Every other file here asks what a curator can observe. This one cannot: an
// object's identity has no rendering, and the whole point of #229 is that two
// renders hand the card the same values. So the pins are white-box, in the
// spirit of ADR 0007's `will-change` class-name pin — the property is invisible
// and the cost of losing it is not, and the way it gets lost is somebody
// writing an object literal back into a render.
//
// What each of them protects is #230: a memoised card sees a changed prop only
// when something changed, so a cursor move re-renders two cards instead of
// fifty. Undo any of these and the memo still compiles and buys nothing.

afterEach(() => {
  cleanup();
});

/** The four transitions, so a press through the latched handler can land. */
beforeEach(() => {
  mockBootedApp();
  mockCommand("keep_wallpaper", (args) =>
    wallpaper(args.id, { status: "kept" }),
  );
});

/** Wallpapers 1..count, as `list_wallpapers` would answer with them. */
function cards(count: number): Wallpaper[] {
  return Array.from({ length: count }, (_, i) => wallpaper(i + 1));
}

/**
 * Where a reject goes, as data rather than through `useRejectDestination`.
 *
 * Nothing here rejects. The hook reads a setting and an `expand_path` verdict
 * to produce these three fields, and a page arranging both to ask about prop
 * identities is arranging the wrong thing (ADR 0018).
 */
const DESTINATION: RejectDestination = {
  written: "./rejected",
  relative: true,
  invalidMessage: null,
};

/** What each render of the page handed over, oldest first. */
let performs: Array<WallpaperRows["perform"]>;
/** The grid's handle, which is what a page holds instead of a selection (#230). */
let gridHandle: WallpaperGridHandle | null;
/** Re-render the page with nothing about it changed. */
let rerender: () => void;

/** The selection as the grid last published it. */
function selection(): GridSelection {
  if (gridHandle === null) throw new Error("the grid has not mounted");
  return gridHandle.selection();
}

/**
 * The library page's shape, reduced to what the identities this is about hang
 * off — the rows-and-transitions module, and the grid holding the cursor —
 * inside the scroll box the grid windows itself against.
 *
 * A harness rather than `LibraryView` itself, because the question is what one
 * render hands the next and a page cannot be asked that. The scroll box is what
 * makes the grid read the column count twice: the window counts rows in it and
 * the cells move the selection by it, both inside the component since #231
 * (ADR 0027), which is what makes the one-subscription test below a test about
 * two readers.
 */
function Page({ list }: { list: Wallpaper[] }) {
  const [, forceRender] = useReducer((renders: number) => renders + 1, 0);
  rerender = forceRender;

  const scroller = useRef<HTMLDivElement | null>(null);
  const { perform } = useWallpaperRows({
    belongs: (status) => status === "active",
    destination: DESTINATION,
    owe: () => {},
  });
  const [handle, setHandle] = useState<WallpaperGridHandle | null>(null);
  gridHandle = handle;

  performs.push(perform);

  return (
    <div ref={scroller}>
      <WallpaperGrid
        ref={setHandle}
        wallpapers={list}
        label="Wallpapers"
        onAction={perform}
        scroller={scroller}
      />
    </div>
  );
}

/**
 * The page, with the list in state so that a re-render can leave it alone.
 *
 * `list` is the same array every render, which is the case these tests are
 * about: nothing changed, so nothing a card holds may change either.
 */
function Host({ initial }: { initial: Wallpaper[] }) {
  const [list] = useState(initial);
  return <Page list={list} />;
}

async function mount(list: Wallpaper[]) {
  performs = [];
  gridHandle = null;
  await renderInApp(<Host initial={list} />);
  await flush();
}

/** One card, by the accessible name it carries as a cell. */
function cell(id: number, status = "Active"): HTMLElement {
  return screen.getByRole("gridcell", { name: `wall-${id}.jpg, ${status}` });
}

/** A React fiber, as far as reading the props off one needs to know. */
interface Fiber {
  elementType: unknown;
  memoizedProps: Record<string, unknown>;
  return: Fiber | null;
}

/**
 * The props the grid handed one card, read off the fiber behind its cell.
 *
 * There is no other way in. The values are the card's own arguments, and what
 * this file has to compare is their identity — which no attribute, no role and
 * no accessible name carries. Reading React's own bookkeeping is the smallest
 * thing that answers it, and it fails loudly rather than quietly if a future
 * React spells the bookkeeping differently.
 */
function cardProps(node: HTMLElement): Record<string, unknown> {
  const key = Object.keys(node).find((name) =>
    name.startsWith("__reactFiber$"),
  );
  if (key === undefined) throw new Error("the cell carries no React fiber");
  let fiber = (node as unknown as Record<string, Fiber | null>)[key];
  while (fiber !== null && fiber !== undefined) {
    if (fiber.elementType === WallpaperCard) return fiber.memoizedProps;
    fiber = fiber.return;
  }
  throw new Error("no WallpaperCard above the cell");
}

/** The props whose identity moved between two renders of the same card. */
function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

/**
 * Count what a render asks of the two window facilities behind the column
 * count, with the real ones still answering.
 *
 * `matchMedia` is the parse the queries were costing per call, and a `resize`
 * listener is what each reader used to register for itself.
 *
 * Only the breakpoint queries are counted. The theme reads
 * `(prefers-color-scheme: dark)` through the same call, and the provider around
 * every page here is what asks it (ADR 0002).
 */
function watchWindow() {
  const realMatchMedia = window.matchMedia;
  const realAdd = window.addEventListener;
  const realRemove = window.removeEventListener;
  const counts = { queries: 0, subscribed: 0, unsubscribed: 0 };

  window.matchMedia = ((query: string) => {
    if (query.startsWith("(min-width:")) counts.queries += 1;
    return realMatchMedia.call(window, query);
  }) as typeof window.matchMedia;
  window.addEventListener = ((...args: Parameters<typeof realAdd>) => {
    if (args[0] === "resize") counts.subscribed += 1;
    return realAdd.apply(window, args);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
    if (args[0] === "resize") counts.unsubscribed += 1;
    return realRemove.apply(window, args);
  }) as typeof window.removeEventListener;

  return {
    counts,
    restore() {
      window.matchMedia = realMatchMedia;
      window.addEventListener = realAdd;
      window.removeEventListener = realRemove;
    },
  };
}

test("the published selection is one object while the selection and the list are unchanged", async () => {
  await mount(cards(6));
  const before = selection();

  await act(async () => {
    rerender();
  });
  // A render of the page above it is not news, and `useSyncExternalStore`
  // compares snapshots by identity — a fresh object here is a re-render of
  // every subscriber every time anything moves on the page.
  expect(selection()).toBe(before);

  // And a new one when the selection moves, because a memo that never lets go
  // is the other way to fail this: the lightbox is a rendering of this object
  // (ADR 0022, #230).
  await act(async () => {
    before.moveTo(1);
  });
  expect(selection()).not.toBe(before);
  expect(selection().index).toBe(1);
});

test("the action handler holds one identity for the life of the page", async () => {
  await mount(cards(6));
  const first = performs[0];

  await act(async () => {
    rerender();
  });
  await act(async () => {
    selection().moveTo(2);
  });

  expect(performs.length).toBeGreaterThan(2);
  expect(new Set(performs).size).toBe(1);
  expect(performs[performs.length - 1]).toBe(first);

  // And the transition behind it still runs, which is the thing the ref latch
  // could quietly break: a handler stable because it is the first render's
  // closure would keep an interface and lose the page.
  const kept: number[] = [];
  mockCommand("keep_wallpaper", (args) => {
    kept.push(args.id);
    return wallpaper(args.id, { status: "kept" });
  });
  await click(screen.getByRole("button", { name: "Keep wall-3.jpg" }));
  expect(kept).toEqual([3]);
});

test("a card's props keep their identity when nothing about the card changed", async () => {
  await mount(cards(6));
  const before = cardProps(cell(1));

  await act(async () => {
    rerender();
  });
  expect(changed(before, cardProps(cell(1)))).toEqual([]);

  // The one prop a cursor move may change on a card it leaves, and the whole
  // reason it is a boolean rather than a field of an object built per render.
  await act(async () => {
    selection().moveTo(1);
  });
  const afterMove = cardProps(cell(1));
  expect(changed(before, afterMove)).toEqual(["selected"]);
  expect(before.selected).toBe(true);
  expect(afterMove.selected).toBe(false);
});

test("the column count is answered from a cache, and no query is built during a render", async () => {
  const watch = watchWindow();
  try {
    await mount(cards(6));
    await act(async () => {
      rerender();
    });
    await act(async () => {
      selection().moveTo(3);
    });
    // The four queries are the module's, parsed once when it loaded, so a
    // render that reads the count asks the window nothing.
    expect(watch.counts.queries).toBe(0);
  } finally {
    watch.restore();
  }
});

test("one resize subscription serves every reader", async () => {
  const watch = watchWindow();
  try {
    // Two readers, both inside the grid since #231: the window counting its
    // rows, and the cells moving the selection by the same count.
    await mount(cards(6));
    expect(watch.counts.subscribed).toBe(1);
    expect(watch.counts.unsubscribed).toBe(0);

    // And it comes off with the last of them.
    cleanup();
    await flush();
    expect(watch.counts.unsubscribed).toBe(1);
  } finally {
    watch.restore();
  }
});
