import { LibraryView } from "@/components/LibraryView";
import { useApp } from "@/context/AppContext";
import type { Settings, Wallpaper } from "@/lib/client";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  cardsInARow,
  click,
  ctrlWheel,
  currentView,
  deferred,
  flush,
  mockBootedApp,
  mockTransitions,
  press,
  renderInApp,
  servingRows,
  settings,
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
/** The filter and the ordering of every call, in order, as the wire carries them. */
let listArgs: Array<[string, string]>;

/** The rows a transition answers with, read off that library (ADR 0023). */
const { wrote, rejectedTo, restoredTo } = servingRows(() => library);

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
  listArgs = [];
  mockBootedApp();
  mockCommand("list_wallpapers", (args) => {
    listCalls++;
    const filter = args.filter;
    listArgs.push([filter, args.ordering]);
    return library.filter((w) => filter === "all" || w.status === filter);
  });
  // A reject reads the stored destination and asks whether it is relative, which
  // cannot be read off the string (ADR 0018).
  mockCommand("expand_path", (args) => {
    const input = args.input;
    return { resolved: input.replace(/^~/, HOME), exists: true };
  });
  // Every transition answers with the row it wrote, off the library the test
  // arranged (ADR 0023). The tests below override the one they are about.
  mockTransitions(() => library);
});

/** A library of `count` wallpapers, on the page and fetched. */
async function openLibrary(count: number) {
  await openLibraryOf(
    Array.from({ length: count }, (_, i) => wallpaper(i + 1)),
  );
}

/**
 * The Settings field a navigation asked for, or the empty string for none.
 *
 * `ViewProbe` reports where the app went and cannot report what it wants looked
 * at on arrival, which is half of what the empty library's route is for: a page
 * of four sections with the answer somewhere in it is not the same landing as a
 * caret in the Library root field (ADR 0020).
 */
function FocusProbe() {
  const { focus } = useApp();
  return <span data-testid="focus">{focus ?? ""}</span>;
}

const focusedField = () => screen.getByTestId("focus").textContent;

/** These rows, on the page and fetched, with whatever settings the test needs. */
async function openLibraryOf(
  rows: Wallpaper[],
  stored: Partial<Settings> = {},
) {
  // Four cards to a row, which is the count the window and the arrow keys both
  // read off the same table (`useGridColumns`).
  viewportWidth(1024);
  library = rows;
  mockCommand("get_settings", () => settings(stored));
  await renderInApp(
    <>
      <FocusProbe />
      <LibraryView />
    </>,
  );
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

const cardName = (id: number) =>
  cardFor(id)?.getAttribute("aria-label") ?? null;

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
      root.querySelector("[data-slot='toast-description']")?.textContent ??
      null,
  };
}

/** The overlay button for one action on one card, by its accessible name. */
const button = (name: RegExp) => screen.getByRole("button", { name });

/** The page's own bar, which is where both controls and the read-out live. */
const bar = () =>
  within(document.querySelector('[data-slot="page-bar"]') as HTMLElement);

/** Press one filter chip, by the word on it (#130). */
async function filterBy(label: string) {
  await click(bar().getByRole("button", { name: label }));
}

/** The size control on the bar: its own axis, not a fifth chip (#258). */
const sizeControl = () => bar().getByRole("button", { name: "Undersized" });

/** The buttons inside the chips' group, which is the Status axis and only that. */
const chipLabels = () =>
  within(screen.getByRole("group", { name: "Filter by Status" }))
    .getAllByRole("button")
    .map((el) => el.textContent);

/** Narrow the list to the undersized wallpapers, or widen it back. */
const narrowToUndersized = () => click(sizeControl());

/** Whether the bar marks the size control as the one narrowing the list. */
const narrowedToUndersized = () =>
  sizeControl().getAttribute("aria-pressed") === "true";

/** The row count the bar prints, which is a count of what is on the page. */
const rowCount = () => bar().getByText(/^\d+ wallpapers?$/).textContent;

/** The chip the bar marks as the current filter, or `null` for none. */
const pressedChip = () =>
  bar()
    .getAllByRole("button", { pressed: true })
    .map((el) => el.textContent)[0] ?? null;

/** The ordering control: a combobox since #192, not a `<select>`. */
const ordering = () => bar().getByLabelText("Order by");

/**
 * The four names in the open list, in order. Unscoped, because the list is
 * portalled to the end of the body and is not inside the bar the trigger is on.
 */
const orderingNames = () =>
  screen.getAllByRole("option").map((el) => el.textContent);

/**
 * Choose one of ADR 0014's four orderings, by the name on it.
 *
 * Through the list rather than by writing a value onto the control, which is
 * what leaves the assertion on `listArgs` worth making: the curator reads a
 * sentence and picks it, and what goes over the wire is the ordering's name.
 * Enter opens and Enter chooses, both of them the trigger's and the item's own
 * bindings.
 */
async function orderBy(name: string) {
  await press("Enter", { target: ordering() });
  await press("Enter", { target: screen.getByRole("option", { name }) });
}

/** ADR 0018's line on the bar, whichever of its two shapes is up. */
const destinationLine = () =>
  document.querySelector(
    "[data-slot='reject-destination']",
  ) as HTMLElement | null;

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

/** Put focus on the grid's one tab stop, the way Tab does. */
async function enterGrid() {
  await act(async () => {
    mountedCards()[0].focus();
  });
}

/** The density gesture over this page's grid. */
const zoom = (deltaY: number) =>
  ctrlWheel(
    screen.getByRole("grid", { name: "Wallpapers in the library" }),
    deltaY,
  );

test("the density gesture reaches this page, and stops at the browse surface's bound", async () => {
  // The count the curator sees is how many cards share a row, and `ArrowDown`
  // is what says so without a layout: it moves by exactly that number, so a
  // step in that made the cards larger is a Down that lands one card earlier
  // (#264). happy-dom reports every card as the same zero-sized box at any
  // density, which is why the assertion is the keyboard's answer.
  await openLibrary(400);
  browserLaysOutTheScroller();
  await enterGrid();
  expect(await cardsInARow()).toBe(4);

  await zoom(-100);
  expect(await cardsInARow()).toBe(3);

  // Eight is where Library stops, which is wider than Review goes: this is the
  // browse surface, and going wide over five thousand wallpapers is the point.
  for (let at = 0; at < 8; at++) await zoom(100);
  expect(await cardsInARow()).toBe(8);

  // The keys are the same gesture, and the same wall.
  await press("+");
  expect(await cardsInARow()).toBe(7);
  await press("-");
  await press("-");
  expect(await cardsInARow()).toBe(8);
});

test("a density change under a window leaves the selection on the same wallpaper", async () => {
  // The one place the "neither gesture disturbs the selection" criterion can
  // fail, and the place a grid that mounted every row cannot show it: every row
  // height is rewritten while the scroll offset stays put, so the window over
  // that offset lands on a different slice of the library and the selected card
  // can lose its node. The selection is resolved against the whole list rather
  // than the mounted window, which is what makes it survive that (#137, #230).
  await openLibrary(400);
  browserLaysOutTheScroller();
  await enterGrid();

  // The far end of the library, which the window has to be moved to reach —
  // so the cursor is on a card a hundred rows from where the plan starts, and
  // the cards it started among have given their nodes up.
  await press("End");
  await browserReportsScroll();
  expect(document.activeElement).toBe(card(400));
  expect(card(1)).toBeNull();

  for (let at = 0; at < 4; at++) await zoom(100);
  await browserReportsScroll();

  // Where the cursor is, asked the only way a curator can ask it: one step
  // back. Landing on 399 is the cursor having stayed on 400 through four
  // relayouts of every row in the library, each of which moved the window.
  await press("ArrowLeft");
  await browserReportsScroll();
  expect(document.activeElement).toBe(card(399));
});

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

// The second bar (#130): the Status filter as four chips, the ordering as one
// control with ADR 0014's four names in it, and the line saying where rejects
// go. Nothing behind them changed — a filter or an ordering change refetches and
// returns the list to the top, as it did through the two interim `<select>`s.

test("the filter is four chips in one named group, with the current one pressed", async () => {
  await openLibraryOf([wallpaper(1)]);

  // One group with one name, because four buttons in a row are otherwise four
  // unrelated controls with no word between them saying what they filter. There
  // is no fifth chip: Eligible is a voting-pool term, and what it would mean
  // here is what All already shows with the rejects greyed (ADR 0016).
  const chips = within(
    screen.getByRole("group", { name: "Filter by Status" }),
  ).getAllByRole("button");
  expect(chips.map((el) => el.textContent)).toEqual([
    "All",
    "Active",
    "Kept",
    "Rejected",
  ]);

  // All is where the page opens, because its promise is everything the app
  // knows about and a default that hides rejects turns "where did that one go"
  // into a hunt (ADR 0014).
  expect(pressedChip()).toBe("All");

  await filterBy("Rejected");

  // The press refetches with that filter and the chip becomes the current one
  // to a screen reader as well as to an eye.
  expect(listArgs).toEqual([
    ["all", "score_desc"],
    ["rejected", "score_desc"],
  ]);
  expect(pressedChip()).toBe("Rejected");
});

test("the ordering offers four names, and the frontend sends the name", async () => {
  await openLibraryOf([wallpaper(1)]);

  // The current one is on the trigger, and it is where the page opens: ADR
  // 0014's default is the one view neither Rank nor Review gives.
  expect(ordering().textContent).toBe("Score, high to low");

  // Each with its direction baked in, which is why Score appears twice and
  // there is no direction toggle beside it (ADR 0014).
  await press("Enter", { target: ordering() });
  expect(orderingNames()).toEqual([
    "Score, high to low",
    "Score, low to high",
    "Filename, A to Z",
    "Recently added",
  ]);
  await press("Escape");

  await orderBy("Filename, A to Z");

  // A name and nothing else: no column, no direction and nothing sorted here.
  // The backend owns every part of the clause behind the name (ADR 0014).
  expect(listArgs).toEqual([
    ["all", "score_desc"],
    ["all", "filename_asc"],
  ]);
  expect(ordering().textContent).toBe("Filename, A to Z");
});

test("the bar says where rejects go, in the string the curator wrote", async () => {
  await openLibraryOf([wallpaper(1)], { reject_destination: "~/bin" });

  // The same line Review's bar carries, on the same object this page hands
  // `move_wallpaper`, and the written string rather than the resolved one:
  // ADR 0011 put the resolved-path preview on the Settings field (ADR 0018).
  expect(destinationLine()?.textContent).toBe(
    "Rejects go to ~/bin · change in Settings",
  );
  expect(destinationLine()?.textContent).not.toContain(HOME);
});

test("a malformed destination replaces the whole line", async () => {
  mockCommand("expand_path", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await openLibraryOf([wallpaper(1)], { reject_destination: "$HOEM/rejected" });

  // It fails every reject the page can fire, so there is no destination left to
  // describe. Reading the variable's name off the bar before the first overlay
  // click beats a toast per card after it (ADR 0011, ADR 0018).
  expect(destinationLine()?.textContent).toBe(
    "unknown environment variable HOEM",
  );
  expect(destinationLine()?.className).toContain("text-destructive");
});

// The four actions (#132). The page the curator is browsing is the page they act
// on, and what separates it from Review is that nothing is removed ahead of the
// write: the row is patched by the `status-changed` this page publishes after
// the call, so a failure has nothing to undo.

test("keep records the decision and the row changes where it sits", async () => {
  const keptIds: unknown[] = [];
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args.id);
    return wrote(args, { status: "kept" });
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
    unkeptIds.push(args.id);
    return wrote(args, { status: "active" });
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
    return rejectedTo(args, `${HOME}/bin/wall-1 (1).jpg`);
  });

  await click(button(/reject wall-1\.jpg/i));

  // The Written path as stored, not the resolved one: `expand_path` is asked
  // whether the destination is relative and never asked to rewrite it.
  expect(moveArgs).toEqual([{ id: 1, destinationFolder: "~/bin" }]);
  // `unique_destination` suffixed the name rather than overwriting what was
  // already sitting there, and the row the command answered with is the only
  // account of it (ADR 0003, ADR 0018). That row's `filename` is the column the
  // backend stored rather than one derived again here, so the card names the
  // file as it landed rather than as it was asked for (ADR 0023).
  expect(cardName(1)).toBe("wall-1 (1).jpg, Rejected");
  expect(button(/restore wall-1 \(1\)\.jpg/i)).toBeTruthy();
  // The toast names the file the curator acted on, which is the name they read
  // on the card they pressed. The path line beneath it is where the suffix
  // shows, and it is the reason that line is up at all.
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
    restoredIds.push(args.id);
    return restoredTo(args, "/library/wall-1.jpg");
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

// What a patch carries, which is the whole row its transition wrote (ADR 0023).
// Every one of these acts twice on one row without a fetch in between, because a
// row patched from half a transition is only wrong until the next refetch covers
// for it — which is what let #141 ship.

test("a row rejected in place is restorable straight away, with no refetch between", async () => {
  const restoredIds: unknown[] = [];
  await openLibraryOf([wallpaper(1, { path: "/library/photos/wall-1.jpg" })]);
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, "/library/photos/rejected/wall-1.jpg"),
  );
  mockCommand("restore_wallpaper", (args) => {
    restoredIds.push(args.id);
    return restoredTo(args, "/library/photos/wall-1.jpg");
  });

  await click(button(/reject wall-1\.jpg/i));
  expect(cardName(1)).toBe("wall-1.jpg, Rejected");

  // The reject that just ran recorded an Origin, and the row it answered with is
  // the row this page now holds. Patching the Status alone left the row on the
  // `null` it carried while Active, which is the cohort a Restore is refused for
  // — a greyed Restore on a wallpaper that could go back, indistinguishable on
  // screen from one that cannot (#141).
  await click(button(/restore wall-1\.jpg/i));

  expect(restoredIds).toEqual([1]);
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(listCalls).toBe(1);
});

test("a row rejected in place names the folder its file went into, not the one it left", async () => {
  await openLibraryOf([
    wallpaper(1, { path: "/library/photos/wall-1.jpg", comparisons_count: 14 }),
  ]);
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, "/library/photos/rejected/wall-1.jpg"),
  );

  await click(button(/reject wall-1\.jpg/i));

  // The card reads this clause off the row's own `path`, which arrives from the
  // command rather than being derived here: a row patched without it names where
  // the file used to be — `now in photos/`, pointing at the folder the reject
  // had just emptied (ADR 0019, #141).
  const line = screen.getByText("14 comparisons · now in rejected/");
  expect(line.getAttribute("title")).toBe("/library/photos/rejected/wall-1.jpg");
});

test("a restore leaves the row on the path the file landed back at", async () => {
  await openLibraryOf([
    wallpaper(1, {
      status: "rejected",
      path: "/library/photos/rejected/wall-1.jpg",
      origin_path: "/library/photos/wall-1.jpg",
      comparisons_count: 14,
    }),
  ]);
  mockCommand("restore_wallpaper", (args) =>
    restoredTo(args, "/library/photos/wall-1 (1).jpg"),
  );

  await click(button(/restore wall-1\.jpg/i));

  // A collision at the Origin suffixes this leg too, so the row takes the
  // filename off the answer here as well. The `now in` clause goes with the
  // Status rather than with the path: an Active wallpaper is where it belongs.
  expect(cardName(1)).toBe("wall-1 (1).jpg, Active");
  expect(screen.getByText("14 comparisons").getAttribute("title")).toBeNull();
  expect(listCalls).toBe(1);
});

test("a keep leaves the row's other columns alone, and the reject after it still has an Origin", async () => {
  const restoredIds: unknown[] = [];
  await openLibraryOf([wallpaper(1, { path: "/library/photos/wall-1.jpg" })]);
  mockCommand("keep_wallpaper", (args) =>
    wrote(args, { status: "kept" }),
  );
  mockCommand("unkeep_wallpaper", (args) =>
    wrote(args, { status: "active" }),
  );
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, "/library/photos/rejected/wall-1.jpg"),
  );
  mockCommand("restore_wallpaper", (args) => {
    restoredIds.push(args.id);
    return restoredTo(args, "/library/photos/wall-1.jpg");
  });

  // Keep and un-keep move no file, so the row each answers with differs from the
  // one it read in the `status` column alone — and this row's `path` has to come
  // through both of them.
  await click(button(/keep wall-1\.jpg/i));
  expect(cardName(1)).toBe("wall-1.jpg, Kept");
  await click(button(/make active wall-1\.jpg/i));
  expect(cardName(1)).toBe("wall-1.jpg, Active");

  // Which the reject after them is what proves: the backend reads that `path` as
  // the Origin it records, so a row that had lost the column would leave the
  // Restore below with nothing to act on and no call to make.
  await click(button(/reject wall-1\.jpg/i));
  await click(button(/restore wall-1\.jpg/i));

  expect(restoredIds).toEqual([1]);
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(listCalls).toBe(1);
});

test("a row whose new Status falls outside the filter leaves the grid", async () => {
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("keep_wallpaper", (args) =>
    wrote(args, { status: "kept" }),
  );
  await filterBy("Active");
  expect(listCalls).toBe(2);

  await click(button(/keep wall-1\.jpg/i));

  // Dropped rather than replaced, because a row cannot stay in a list of Active
  // wallpapers after a keep. The other direction is not a patch this page can
  // make, and the bound is position rather than ignorance: nothing in a row says
  // where it belongs in an ordering by Score (ADR 0023).
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
  // Reaching the backend is what this test says must not happen, and the
  // shared default throws on a row with no Origin — a call the frontend refuses
  // before it makes it, so a mock that answered one would hide the regression.

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
    keptIds.push(args.id);
    return wrote(args, { status: "kept" });
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

test("a click on a card opens the lightbox, and acts on nothing", async () => {
  // The gesture that opens the lightbox (#134, #138). What the surface then
  // shows is `lightbox.test.tsx`'s; what this page owes is that the click makes
  // no call and changes no Status on the way there — a look is not a decision.
  await openLibraryOf([wallpaper(1), wallpaper(2)]);

  await click(screen.getByRole("gridcell", { name: "wall-1.jpg, Active" }));

  expect(screen.getByRole("dialog", { name: "wall-1.jpg" })).toBeTruthy();
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(listCalls).toBe(1);
  expect(toast()).toBeNull();
});

// The two empty states (#133). They are two screens: the filter is the only
// thing that can tell an empty library from a filter matching nothing, because
// with All selected the fetch asked about the whole library and with any other
// filter it asked about one Status.

test("an empty library names the reason and routes to the library root field", async () => {
  await openLibraryOf([]);

  expect(
    screen.getByText("Nothing has been scanned into the library yet."),
  ).toBeTruthy();

  await click(screen.getByRole("button", { name: "Choose a library root" }));

  // Settings, with the caret asked for by name. A disabled tab explains
  // nothing, so the destination that is empty owes the route out, and the
  // route lands on the one field that fixes it (ADR 0015, ADR 0020).
  expect(currentView()).toBe("settings");
  expect(focusedField()).toBe("library_root");
});

test("a filter matching nothing names the filter and clears back to All", async () => {
  await openLibraryOf([wallpaper(1)]);
  await filterBy("Kept");
  expect(listCalls).toBe(2);

  // The library is fine and this view of it is not, which is what separates
  // this sentence from the one above. The Status is capitalised, as CONTEXT.md
  // spells it and as the card's own pill does (`copy.ts`).
  expect(screen.getByText("No Kept wallpapers in the library.")).toBeTruthy();
  expect(
    screen.queryByText("Nothing has been scanned into the library yet."),
  ).toBeNull();

  await click(screen.getByRole("button", { name: "Show all wallpapers" }));

  // Through the same state setter the control on the bar writes, so the filter
  // change owns the refetch and the scroll reset it always did — and #130
  // moving that control cannot take this way out with it.
  expect(listCalls).toBe(3);
  expect(cardFor(1)).not.toBeNull();
});

test("neither empty state renders while the first fetch is still out", async () => {
  const list = deferred<Wallpaper[]>();
  mockCommand("list_wallpapers", () => {
    listCalls++;
    return list.promise;
  });

  await renderInApp(
    <>
      <FocusProbe />
      <LibraryView />
    </>,
  );

  // A call that has not come back is not an answer. `rows` is `null` here and
  // `[]` only once the backend has said so, and telling a curator their library
  // is empty because a fetch is in flight is what that distinction prevents.
  expect(listCalls).toBe(1);
  expect(
    screen.queryByText("Nothing has been scanned into the library yet."),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Choose a library root" }),
  ).toBeNull();

  await act(async () => {
    list.resolve([]);
  });
  await flush();

  expect(
    screen.getByText("Nothing has been scanned into the library yet."),
  ).toBeTruthy();
});

// Masonry, and the control that chooses it (#262). The grid is the same
// component with the same cards, the same cursor and the same keys — what moves
// is where the plan puts them, so what these ask is that nothing a curator can
// do stops working when it does.
//
// Where the cards actually land is `layout-plan.test.ts`': happy-dom does no
// layout, so a box measures zero here and every card falls back to the same
// height. What is observable is which layout is drawing — a masonry card carries
// the position the plan gave it, and a grid card is placed by the CSS grid and
// carries none — which is the same reading `Layout.test.tsx` takes of the active
// tab, for the same reason.

/** The layout control on the bar, as the two buttons it is. */
const layoutButton = (name: string) =>
  within(bar().getByRole("group", { name: "Layout" })).getByRole("button", {
    name,
  });

/** The layout the bar marks as the current one. */
const pressedLayout = () =>
  within(bar().getByRole("group", { name: "Layout" }))
    .getAllByRole("button", { pressed: true })
    .map((el) => el.getAttribute("aria-label"))[0] ?? null;

/** Whether the cards are being positioned by the layout rather than flowed. */
const positionedCards = () =>
  mountedCards().filter((el) => el.style.top !== "");

test("the bar offers the two layouts, and the choice is written where a restart reads it", async () => {
  const written: unknown[] = [];
  await openLibraryOf([wallpaper(1), wallpaper(2)]);
  mockCommand("set_setting", (args) => {
    written.push(args);
    return settings({ library_layout: "masonry" });
  });

  // The grid is where the page opens, because it is what the app has always
  // drawn: a curator who never touches this control sees what they saw before it
  // existed. Its cards are placed by the CSS grid and carry no position.
  expect(pressedLayout()).toBe("Grid");
  expect(positionedCards()).toEqual([]);

  await click(layoutButton("Masonry"));

  // Into the settings store, which is the only thing in the app that survives a
  // restart — and under a key naming the Library, so Review's layout is its own
  // (ADR 0010).
  expect(written).toEqual([{ key: "library_layout", value: "masonry" }]);
  expect(pressedLayout()).toBe("Masonry");
  // And the cards are drawn where the plan put them rather than where a CSS grid
  // would have: each carries its own box.
  expect(positionedCards().length).toBe(mountedCards().length);
  // The layout is not a question about the library, so nothing is re-fetched.
  expect(listCalls).toBe(1);
});

test("a stored masonry layout is what the first grid draws", async () => {
  // The other half of surviving a restart. The provider reads every setting
  // before the first paint, so the curator never sees the grid flash past on the
  // way to the layout they chose.
  await openLibraryOf([wallpaper(1), wallpaper(2)], {
    library_layout: "masonry",
  });

  expect(pressedLayout()).toBe("Masonry");
  expect(positionedCards().length).toBe(mountedCards().length);
});

test("the selection is where it was after a layout switch", async () => {
  await openLibraryOf([wallpaper(1), wallpaper(2), wallpaper(3)]);
  mockCommand("set_setting", () => settings({ library_layout: "masonry" }));
  await enterGrid();
  await press("ArrowRight");
  expect(document.activeElement).toBe(card(2));

  await click(layoutButton("Masonry"));

  // The cursor is the grid's and the layout is a plan the grid reads, so there
  // is nothing to carry across: the same component is still holding the same
  // selected id (ADR 0045).
  expect(card(2)?.getAttribute("tabindex")).toBe("0");
  expect(card(1)?.getAttribute("tabindex")).toBe("-1");
});

test("the arrows reach every card in masonry, as they do in the grid", async () => {
  await openLibraryOf(
    Array.from({ length: 9 }, (_, at) => wallpaper(at + 1)),
    { library_layout: "masonry" },
  );
  await enterGrid();

  // Left and Right walk the list, which is what makes every card reachable
  // however the columns were packed: the rows are a wrapping of one sequence and
  // a sweep reads it as one (ADR 0019).
  for (let at = 2; at <= 9; at++) {
    await press("ArrowRight");
    expect(document.activeElement).toBe(card(at));
  }
  await press("Home");
  expect(document.activeElement).toBe(card(1));
  // And Down still moves by the column count, which is the same count the plan
  // packed the columns to.
  await press("ArrowDown");
  expect(document.activeElement).toBe(card(5));
  await press("End");
  expect(document.activeElement).toBe(card(9));
});

test("the lightbox opens from a masonry card", async () => {
  await openLibraryOf([wallpaper(1), wallpaper(2)], {
    library_layout: "masonry",
  });

  await click(screen.getByRole("gridcell", { name: "wall-1.jpg, Active" }));

  // The lightbox is a second rendering of the grid's selection and knows nothing
  // about which layout drew it (ADR 0022).
  expect(screen.getByRole("dialog", { name: "wall-1.jpg" })).toBeTruthy();
});

test("keep, reject and restore all work from masonry", async () => {
  await openLibraryOf(
    [
      wallpaper(1),
      wallpaper(2),
      wallpaper(3, {
        status: "rejected",
        path: "/library/rejected/wall-3.jpg",
        origin_path: "/library/wall-3.jpg",
      }),
    ],
    { library_layout: "masonry" },
  );
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, `/library/rejected/${wrote(args).filename}`),
  );
  mockCommand("restore_wallpaper", (args) =>
    restoredTo(args, "/library/wall-3.jpg"),
  );

  await click(button(/keep wall-1\.jpg/i));
  expect(cardName(1)).toBe("wall-1.jpg, Kept");

  await click(button(/reject wall-2\.jpg/i));
  expect(cardName(2)).toBe("wall-2.jpg, Rejected");

  await click(button(/restore wall-3\.jpg/i));
  expect(cardName(3)).toBe("wall-3.jpg, Active");

  // The actions are a property of a wallpaper rather than of a view, so a layout
  // choice costs the curator none of them (ADR 0023).
  expect(listCalls).toBe(1);
});

test("a library past the window has only a window of it in masonry too", async () => {
  await openLibraryOf(
    Array.from({ length: 400 }, (_, at) => wallpaper(at + 1)),
    { library_layout: "masonry" },
  );

  // Exactly what the uniform grid promises at ADR 0016's ceiling, and the reason
  // the plan is computed rather than measured: a virtualiser given estimates
  // corrects them as rows mount and moves everything below by the difference.
  const mounted = mountedCards();
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted.length).toBeLessThan(library.length);
  expect(card(1)).not.toBeNull();
  expect(card(400)).toBeNull();

  // And no wallpaper is mounted twice, which masonry's bands make possible: a
  // card taller than a band is listed in every band it crosses.
  const names = mounted.map((el) => el.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});

test("a masonry selection off the end of the window is scrolled in and focused", async () => {
  await openLibraryOf(
    Array.from({ length: 400 }, (_, at) => wallpaper(at + 1)),
    { library_layout: "masonry" },
  );
  browserLaysOutTheScroller();
  await enterGrid();

  // The reveal reads the plan for the band holding the card's own top, which for
  // masonry is not the band it ends in — scrolling to that one would put the
  // card above the window it was asked for (ADR 0019).
  await press("End");
  await browserReportsScroll();

  expect(document.activeElement).toBe(card(400));
  expect(card(1)).toBeNull();
});

test("a wallpaper whose Dimensions are unknown keeps a card in masonry", async () => {
  // The ordinary state of a library still being backfilled, which nothing waits
  // for: drawn at a ratio of nothing the card would have no height, and the
  // column under it would swallow every card after it (ADR 0044).
  await openLibraryOf(
    [
      wallpaper(1, { width: null, height: null }),
      wallpaper(2, { width: 3840, height: 1600 }),
    ],
    { library_layout: "masonry" },
  );

  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(positionedCards().length).toBe(2);
  expect(card(1)?.style.height).not.toBe("0px");
});

test("a layout switch under a window keeps the selection on the wallpaper, node or no node", async () => {
  // The switch the other selection test cannot reach: at ADR 0016's scale the
  // plan is replaced wholesale, and the card the selection is on may be mounted
  // before it and not after. The cursor follows the wallpaper rather than a
  // position in the mounted window, so neither answer is a lost selection
  // (ADR 0019, #230).
  await openLibraryOf(Array.from({ length: 400 }, (_, at) => wallpaper(at + 1)));
  mockCommand("set_setting", () => settings({ library_layout: "masonry" }));
  browserLaysOutTheScroller();
  await enterGrid();
  await press("End");
  await browserReportsScroll();
  expect(document.activeElement).toBe(card(400));

  await click(layoutButton("Masonry"));

  // The wallpaper the curator was on is still the selection, and the grid is
  // still the one holding it: the layout is a plan the grid reads, so a switch
  // rebuilds where the cards go and nothing about which one is chosen.
  expect(pressedLayout()).toBe("Masonry");
  const selected = mountedCards().filter(
    (el) => el.getAttribute("tabindex") === "0",
  );
  expect(
    selected.map((el) => el.getAttribute("aria-label")),
  ).toEqual(["wall-400.jpg, Active"]);
});

// The undersized badge and the control that rounds them up (#258). Two axes and
// two controls: the chips answer what the curator decided about a wallpaper, and
// this answers whether the file is usable at all, so Active and undersized is a
// question the bar can be asked.
//
// Every test below states the Minimum resolution it is about rather than leaning
// on the mocked monitor, because the whole of what these assert is a comparison
// against that number.

/** A Minimum resolution these tests can put wallpapers on either side of. */
const MINIMUM = { minimum_resolution: { width: 1920, height: 1080 } };

test("a wallpaper below the minimum resolution is badged and one at it is not", async () => {
  await openLibraryOf(
    [
      wallpaper(1, { width: 1280, height: 720 }),
      wallpaper(2, { width: 1920, height: 1080 }),
      wallpaper(3, { width: 3840, height: 2160 }),
      // Wide enough and too short. The comparison is per axis rather than over
      // a count of pixels, because what the curator is asking is whether the
      // file covers their screen — this one holds more pixels than the minimum
      // and still leaves a third of the height to the upscaler (CONTEXT.md).
      wallpaper(4, { width: 3840, height: 1000 }),
    ],
    MINIMUM,
  );

  // The badge is a word on the card and a word in the cell's accessible name,
  // for the reason the Status is both: a cell's own name hides its contents, so
  // a mark nobody reading with a screen reader is told about is a mark half the
  // curators do not have (ADR 0019).
  expect(cardName(1)).toBe("wall-1.jpg, Active, Undersized");
  expect(within(cardFor(1) as HTMLElement).getByText("Undersized")).toBeTruthy();

  // At the minimum is not below it.
  expect(cardName(2)).toBe("wall-2.jpg, Active");
  expect(cardName(3)).toBe("wall-3.jpg, Active");
  expect(cardName(4)).toBe("wall-4.jpg, Active, Undersized");
});

test("a wallpaper whose Dimensions are unknown carries no badge", async () => {
  await openLibraryOf([wallpaper(1, { width: null, height: null })], MINIMUM);

  // A library still being backfilled says nothing rather than something wrong:
  // the curator cannot tell a measured library from one being measured, so a
  // badge on an unread row would be a verdict the app has not reached
  // (ADR 0044).
  expect(cardName(1)).toBe("wall-1.jpg, Active");
  expect(
    within(cardFor(1) as HTMLElement).queryByText("Undersized"),
  ).toBeNull();
});

test("the size control narrows the list to the undersized wallpapers", async () => {
  await openLibraryOf(
    [
      wallpaper(1, { width: 1280, height: 720 }),
      wallpaper(2, { width: 3840, height: 2160 }),
      wallpaper(3, { width: null, height: null }),
    ],
    MINIMUM,
  );
  expect(rowCount()).toBe("3 wallpapers");

  await narrowToUndersized();

  // The one wallpaper wearing the badge, and the count says so: what the bar
  // prints is what the grid is showing.
  expect(cardFor(1)).not.toBeNull();
  expect(cardFor(2)).toBeNull();
  // Skipped rather than counted either way. An unread row is not undersized and
  // is not proof that it is fine, so it leaves with the rest (ADR 0044).
  expect(cardFor(3)).toBeNull();
  expect(rowCount()).toBe("1 wallpaper");
  expect(narrowedToUndersized()).toBe(true);

  await narrowToUndersized();

  expect(mountedCards()).toHaveLength(3);
  expect(narrowedToUndersized()).toBe(false);

  // Nothing was asked of the backend for any of it. The narrowing is a
  // comparison against a preference over rows already fetched, not a listing,
  // which is what keeps it off every other surface asking the same command
  // (ADR 0016).
  expect(listCalls).toBe(1);
  expect(listArgs).toEqual([["all", "score_desc"]]);
});

test("the size control combines with a Status chip rather than replacing one", async () => {
  await openLibraryOf(
    [
      wallpaper(1, { width: 1280, height: 720 }),
      wallpaper(2, { width: 1280, height: 720, status: "kept" }),
      wallpaper(3, { width: 3840, height: 2160 }),
    ],
    MINIMUM,
  );

  await filterBy("Active");
  await narrowToUndersized();

  // Both controls are on at once, and the bar says so on both: the chip is the
  // pressed one of four and the size control is pressed beside them. Asking for
  // one did not clear the other.
  expect(pressedChip()).toBe("Active");
  expect(narrowedToUndersized()).toBe(true);

  // And it is not one of the chips. The group the four sit in is the Status
  // axis, and a fifth entry in it would be a control that replaces a Status
  // rather than combining with one (CONTEXT.md, ADR 0016).
  expect(chipLabels()).toEqual(["All", "Active", "Kept", "Rejected"]);

  // The Active wallpaper that is too small, and neither the Kept one that is
  // nor the Active one that is big enough.
  expect(cardFor(1)).not.toBeNull();
  expect(cardFor(2)).toBeNull();
  expect(cardFor(3)).toBeNull();
  expect(rowCount()).toBe("1 wallpaper");
});

test("a size control matching nothing names both axes and the way out clears both", async () => {
  await openLibraryOf([wallpaper(1, { width: 3840, height: 2160 })], MINIMUM);

  await filterBy("Active");
  await narrowToUndersized();

  // One sentence over two axes, in the order they were applied, rather than one
  // per combination. The library is fine and this view of it is not, which is
  // what separates it from the empty-library screen.
  expect(
    screen.getByText("No undersized Active wallpapers in the library."),
  ).toBeTruthy();
  expect(
    screen.queryByText("Nothing has been scanned into the library yet."),
  ).toBeNull();

  await click(screen.getByRole("button", { name: "Show all wallpapers" }));

  // Both, because the button promises all the wallpapers and the curator cannot
  // be expected to know which of the two controls emptied the page.
  expect(pressedChip()).toBe("All");
  expect(narrowedToUndersized()).toBe(false);
  expect(cardFor(1)).not.toBeNull();
});

test("an empty library still reads as one under the size control", async () => {
  await openLibraryOf([], MINIMUM);

  await narrowToUndersized();

  // Nothing was narrowed away, because the fetch came back with nothing to
  // narrow. A library that has never been scanned into keeps the route to the
  // field that fixes it rather than blaming a control the curator just pressed,
  // which is why the empty library is read off the fetch and not off the list
  // on screen (ADR 0015, ADR 0020).
  expect(
    screen.getByText("Nothing has been scanned into the library yet."),
  ).toBeTruthy();
  expect(
    screen.queryByText("No undersized wallpapers in the library."),
  ).toBeNull();

  await click(screen.getByRole("button", { name: "Choose a library root" }));

  expect(currentView()).toBe("settings");
  expect(focusedField()).toBe("library_root");
});

test("the badge is on the card in masonry too, not only in the grid", async () => {
  // The badge is a fact about the file rather than about how the cards were laid
  // out, and both layouts draw the same card: what masonry changes is the box
  // the card is given, not what is printed on it (ADR 0045, #262).
  await openLibraryOf(
    [
      wallpaper(1, { width: 1280, height: 720 }),
      wallpaper(2, { width: 3840, height: 2160 }),
    ],
    { ...MINIMUM, library_layout: "masonry" },
  );

  // Masonry is drawing, which is the half that would otherwise go unstated: each
  // card carries the position the plan gave it rather than being flowed.
  expect(pressedLayout()).toBe("Masonry");
  expect(positionedCards().length).toBe(mountedCards().length);

  expect(cardName(1)).toBe("wall-1.jpg, Active, Undersized");
  expect(within(cardFor(1) as HTMLElement).getByText("Undersized")).toBeTruthy();
  expect(cardName(2)).toBe("wall-2.jpg, Active");
});
