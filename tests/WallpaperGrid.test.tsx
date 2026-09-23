import type { TransitionAction } from "@/components/transitions";
import { client, type Wallpaper } from "@/lib/client";
import type {
  SelectionHandle,
  WallpaperSelection,
} from "@/components/selection";
import {
  rowHeight,
  WallpaperGrid,
  type WallpaperGridProps,
} from "@/components/WallpaperGrid";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useRef, useState } from "react";
import {
  cardsInARow,
  ctrlWheel,
  flush,
  mockBootedApp,
  press,
  renderInApp,
  viewportWidth,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// What a curator can observe about the keyboard: which card takes focus. Every
// test below presses keys and asks that question, and none of them reads a
// `tabindex` — the roving bookkeeping is how the answer is produced, not the
// answer (ADR 0019).

afterEach(() => {
  cleanup();
  // The viewport outlives the test that set it, and the column count is read
  // from it. happy-dom's own default is 1024.
  viewportWidth(1024);
});

/** The commands the keys below reached, in order, and what was asked for. */
let commands: string[];
let asked: TransitionAction[];
/**
 * The wallpapers the host was asked to open the lightbox on, in order, whether
 * that came from a click or from `Enter` (#134, #138).
 */
let opened: number[];

beforeEach(() => {
  commands = [];
  asked = [];
  opened = [];
  // The provider's boot gate; the grid itself asks the backend nothing.
  mockBootedApp();
  // The four a page can make on the curator's behalf. Review reaches two of
  // them and the library page reaches all four, so this host stands in for the
  // page rather than for either one.
  // Each answers with the row it wrote (ADR 0023); this host only counts which
  // command was reached, but a mock answering with a path or with the length of
  // an array was answering with a row nothing produces.
  mockCommand("keep_wallpaper", (args) => {
    commands.push("keep_wallpaper");
    return wallpaper(args.id, { status: "kept" });
  });
  mockCommand("unkeep_wallpaper", (args) => {
    commands.push("unkeep_wallpaper");
    return wallpaper(args.id);
  });
  mockCommand("move_wallpaper", (args) => {
    commands.push("move_wallpaper");
    const before = wallpaper(args.id);
    return wallpaper(args.id, {
      status: "rejected",
      path: `${args.destinationFolder}/${before.filename}`,
      origin_path: before.path,
    });
  });
  mockCommand("restore_wallpaper", (args) => {
    commands.push("restore_wallpaper");
    return wallpaper(args.id);
  });
});

/** Wallpapers 1..count, `wall-1.jpg` through `wall-<count>.jpg`. */
function cards(count: number): Wallpaper[] {
  return Array.from({ length: count }, (_, i) => wallpaper(i + 1));
}

/**
 * One card of each Status, plus the cohort ADR 0009's migration left with no
 * Origin.
 *
 * Review lists Active wallpapers only, so three of the four transitions have no
 * route through that view; the keys are tested here against a host that mounts
 * a row of each, the way the card's own tests are.
 */
function mixed(): Wallpaper[] {
  return [
    wallpaper(1),
    wallpaper(2, { status: "kept" }),
    wallpaper(3, {
      status: "rejected",
      path: "/library/rejected/wall-3.jpg",
      origin_path: "/library/wall-3.jpg",
    }),
    wallpaper(4, {
      status: "rejected",
      path: "/library/rejected/wall-4.jpg",
      origin_path: null,
    }),
  ];
}

/**
 * What a page does with what a card asks for: one command per action, and
 * nothing that decides for itself whether the action was offered. That decision
 * is `STATUS_ACTIONS`'s, in `transitions.ts`, which is the point of asserting on
 * the commands.
 */
function handleAction(action: TransitionAction, subject: Wallpaper): void {
  asked.push(action);
  if (action === "keep") void client.keepWallpaper(subject.id);
  if (action === "make-active") void client.unkeepWallpaper(subject.id);
  if (action === "reject") void client.moveWallpaper(subject.id, "./rejected");
  if (action === "restore") void client.restoreWallpaper(subject.id);
}

let setList: (list: Wallpaper[]) => void = () => {};
/**
 * The grid's handle, which is the whole of what a page holds: the one way in
 * from outside, and the publication a page's lightbox subscribes to (ADR 0029,
 * #230). `null` until the grid has mounted.
 */
let gridHandle: SelectionHandle | null = null;

/**
 * The selection as the grid last published it: the wallpaper on screen, where it
 * sits in the list, a move, and a set to a named id (#137). The lightbox is the
 * caller; these tests read it off the handle the way it does.
 */
function selection(): WallpaperSelection {
  if (gridHandle === null) throw new Error("the grid has not mounted");
  return gridHandle.selection();
}

/**
 * The grid between two other tab stops, so a test can walk into it and out the
 * far side, and with the list in state so it can change under the selection the
 * way an action or a filter does.
 *
 * The selection is not the host's. The grid resolves it over the list it is
 * handed and publishes it through the handle, which is what this harness holds
 * — there is no version of it that keeps a second copy (#230).
 *
 * The scroll box is always in the markup and the ref is handed over only when a
 * test asks for a window, because that prop is the whole of the difference
 * between the library page's grid and Review's: with it the grid windows itself
 * against this element, without it every row is mounted (ADR 0016, #231).
 */
function Harness({
  initial,
  windowed = false,
  density = "library",
}: {
  initial: Wallpaper[];
  /**
   * Whether the grid gets the scroll box, which is what makes it window itself.
   * A window is what puts a card out of the DOM, and a card with no node is
   * what a reveal is for.
   */
  windowed?: boolean;
  /**
   * Which tab the grid is standing in, which is what bounds the density
   * gesture: Library goes wider at the far end than Review does (#264).
   */
  density?: WallpaperGridProps["density"];
}) {
  const [list, set] = useState(initial);
  setList = set;
  // The shape both pages hold it in: state, because when the handle exists is
  // what a subscriber has to hear about.
  const [handle, setHandle] = useState<SelectionHandle | null>(null);
  gridHandle = handle;
  const box = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <button type="button">before</button>
      <div ref={box} data-slot="harness-rows">
        <WallpaperGrid
          ref={setHandle}
          wallpapers={list}
          label="Wallpapers"
          onAction={handleAction}
          onOpen={(subject) => opened.push(subject.id)}
          scroller={windowed ? box : undefined}
          density={density}
        />
      </div>
      <button type="button">after</button>
    </>
  );
}

async function mount(
  list: Wallpaper[],
  density?: WallpaperGridProps["density"],
) {
  await renderInApp(<Harness initial={list} density={density} />);
  await flush();
}

/** The same grid, windowing itself against the box the harness renders. */
async function mountWindowed(list: Wallpaper[]) {
  await renderInApp(<Harness initial={list} windowed />);
  await flush();
  browserLaysOutTheScroller();
}

const scroller = () =>
  document.querySelector('[data-slot="harness-rows"]') as HTMLElement;

/**
 * The scroll box a browser's layout produces and happy-dom does not: a box a
 * screen tall, over content running well past the end of it.
 *
 * The virtualiser clamps every scroll it makes to the range the element itself
 * reports, `scrollHeight - clientHeight`, and happy-dom leaves both at zero. So
 * with nothing arranged there is no range to move through: every scroll lands
 * back at the top and no row can be brought in at all. The two numbers only
 * have to make a range exist — which rows end up mounted at the offset is the
 * grid's own arithmetic over the row height, not these. The same arrangement
 * `LibraryView.test.tsx` makes for the real page.
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
 * offset is what the window is read from.
 */
async function browserReportsScroll() {
  await act(async () => {
    fireEvent.scroll(scroller());
  });
}

/** Hand the list back a new one, the way a keep or a refetch does. */
async function relist(list: Wallpaper[]) {
  await act(async () => {
    setList(list);
  });
}

/** One card, by the accessible name it carries as a cell. */
function cell(id: number, status = "Active"): HTMLElement {
  return screen.getByRole("gridcell", { name: `wall-${id}.jpg, ${status}` });
}

/** Whether that card has a node at all, which under a window it may not. */
function mounted(id: number): boolean {
  return (
    screen.queryByRole("gridcell", { name: `wall-${id}.jpg, Active` }) !== null
  );
}

/** Every card with a node, which is the whole list unless a window says less. */
function mountedCells(): HTMLElement[] {
  return screen.queryAllByRole("gridcell");
}

function grid(): HTMLElement {
  return screen.getByRole("grid", { name: "Wallpapers" });
}

function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

const TAB_ORDER =
  "a[href], button, input, select, textarea, [tabindex], [contenteditable]";

/**
 * Press Tab, the way a browser answers it: focus goes to the next element in
 * document order that is in the tab order, and `tabindex="-1"` is not.
 *
 * happy-dom moves no focus on a key event, and there is no `user-event` in this
 * project, so the walk is written out here. It is still the user's question —
 * where does Tab land — rather than an assertion about attributes, and a grid
 * that put every card or every button in the tab order would fail these tests by
 * landing somewhere else.
 */
function pressTab(): void {
  const stops = Array.from(
    document.querySelectorAll<HTMLElement>(TAB_ORDER),
  ).filter(
    (el) =>
      (el.getAttribute("tabindex") ?? "0") !== "-1" &&
      !el.hasAttribute("disabled"),
  );
  const from = stops.indexOf(document.activeElement as HTMLElement);
  (stops[from + 1] ?? stops[0]).focus();
}

/** Put focus on the grid's one tab stop, the way Tab does. */
async function enterGrid(): Promise<void> {
  await act(async () => {
    button("before").focus();
    pressTab();
  });
}

// The row height, which is the one piece of the window that is arithmetic over
// the grid's own CSS rather than a question about the DOM (ADR 0027). It is
// reachable as a function because both of its inputs are arguments; through a
// mounted page it is reachable only at a box that measures zero.

test("a row is as tall as the cards sharing its width, at every column count", () => {
  // The four breakpoints, each against the width the cards actually get: the
  // box less `p-4` at both ends, less a `gap-6` between every pair, divided by
  // the count and shaped by `aspect-video`.
  const height = (boxWidth: number, columns: number) =>
    ((boxWidth - 32 - 24 * (columns - 1)) / columns) * (9 / 16);

  expect(rowHeight(700, 2)).toBeCloseTo(height(700, 2));
  expect(rowHeight(900, 3)).toBeCloseTo(height(900, 3));
  expect(rowHeight(1200, 4)).toBeCloseTo(height(1200, 4));
  expect(rowHeight(1500, 5)).toBeCloseTo(height(1500, 5));

  // And it falls with the width rather than with the count: five cards in the
  // box four were sharing are five narrower cards, so the row is shorter.
  expect(rowHeight(1200, 5)).toBeLessThan(rowHeight(1200, 4));
});

test("a box that measures nothing falls back to a row about a card tall", () => {
  // The branch every happy-dom run takes, and the one a real browser takes for
  // a view the shell is hiding under `display: none` (ADR 0015). Without it the
  // virtualiser is handed a row height of zero or less and mounts nothing.
  expect(rowHeight(0, 4)).toBe(130);
  // Not only at exactly zero: a box narrower than its own padding and gaps
  // leaves the cards no width at all, which is the same nothing to divide.
  expect(rowHeight(100, 5)).toBe(130);
});

test("Tab reaches the grid once, and Tab again leaves it", async () => {
  // Nine cards over however many rows: the count is what must not matter. Every
  // card a tab stop is 15,000 of them at ADR 0016's ceiling, and Tab from the
  // last mounted card would leave the grid with most of the library behind it.
  await mount(cards(9));

  await act(async () => {
    button("before").focus();
  });
  await act(async () => {
    pressTab();
  });
  expect(document.activeElement).toBe(cell(1));

  await act(async () => {
    pressTab();
  });
  expect(document.activeElement).toBe(button("after"));
});

test("the arrows move by column and by row, against the column count the window has", async () => {
  // lg: four cards to a row, which is the same fact the grid's own container
  // class states — since #264 that class is named by this very count, so a
  // breakpoint added to the table cannot leave the arrows moving by a stale
  // one.
  viewportWidth(1024);
  await mount(cards(9));
  await enterGrid();

  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2));

  await press("ArrowDown");
  expect(document.activeElement).toBe(cell(6));

  await press("ArrowUp");
  expect(document.activeElement).toBe(cell(2));

  await press("ArrowLeft");
  expect(document.activeElement).toBe(cell(1));

  // Nothing above the first row and nothing before the first card.
  await press("ArrowUp");
  await press("ArrowLeft");
  expect(document.activeElement).toBe(cell(1));

  // The window narrows to `md`, and a row is three cards from here on.
  await act(async () => {
    viewportWidth(800);
  });
  await press("ArrowDown");
  expect(document.activeElement).toBe(cell(4));
});

// The density, and the two gestures that move it (#264).
//
// What a curator observes about it is how many cards share a row, and the thing
// that says so without a layout is `ArrowDown`: it moves by exactly the count
// the grid is drawing at, so a step in that made the cards larger is a Down that
// lands one card earlier. happy-dom has no layout to measure and would report
// every card as the same zero-sized box at any density, which is why the
// assertion is the keyboard's answer rather than a width (ADR 0027).

/** The gesture over this harness's grid: a negative `deltaY` is the wheel up. */
const zoom = (deltaY: number) => ctrlWheel(grid(), deltaY);

test("Ctrl and the wheel change how many cards share a row", async () => {
  // lg, so the viewport asks for four on its own.
  viewportWidth(1024);
  await mount(cards(40));
  await enterGrid();
  expect(await cardsInARow()).toBe(4);

  // Up is in: fewer cards, each of them larger.
  await zoom(-100);
  expect(await cardsInARow()).toBe(3);
  // And the container is drawn at the count the arrows just moved by. The class
  // is the only observable difference here, because happy-dom does no layout —
  // the same carve-out `Layout.test.tsx` makes for the active tab — and it is
  // the one thing in this change that moved from a CSS guarantee to a lookup.
  expect(grid().className).toContain("grid-cols-3");

  // And down is out, past where it started.
  await zoom(100);
  await zoom(100);
  expect(await cardsInARow()).toBe(5);
  expect(grid().className).toContain("grid-cols-5");
});

test("the plus and minus keys move the density the wheel does", async () => {
  viewportWidth(1024);
  await mount(cards(40));
  await enterGrid();

  await press("+");
  expect(await cardsInARow()).toBe(3);
  await press("-");
  await press("-");
  expect(await cardsInARow()).toBe(5);
});

test("the density stops at each tab's own bounds", async () => {
  viewportWidth(1024);
  // Review's range, #254's one to six: a worklist of fifty has no scale for the
  // far end to buy, and it goes down to one wallpaper across. It starts on four
  // however wide the window, which is the viewport's own count here.
  await mount(cards(40), "review");
  await enterGrid();
  expect(await cardsInARow()).toBe(4);

  for (let at = 0; at < 6; at++) await zoom(100);
  expect(await cardsInARow()).toBe(6);

  // And one step back moves, rather than spending five the gesture banked at
  // the wall. A zoom clamped where it is read instead of where it is written
  // fails exactly here: the curator makes the gesture and watches it do nothing.
  await zoom(-100);
  expect(await cardsInARow()).toBe(5);

  for (let at = 0; at < 8; at++) await zoom(-100);
  expect(await cardsInARow()).toBe(1);
});

test("Library goes wider than Review does", async () => {
  viewportWidth(1024);
  // The same gesture on the browse surface, where going wide is the point: a
  // library of up to five thousand is what the far end of this range is for.
  await mount(cards(40), "library");
  await enterGrid();

  for (let at = 0; at < 8; at++) await press("-");
  expect(await cardsInARow()).toBe(10);
});

test("the gesture refuses the webview's own zoom, and an ordinary wheel is left alone", async () => {
  viewportWidth(1024);
  await mount(cards(40));
  await enterGrid();

  // Ctrl and the wheel is the browser's zoom shortcut, and the grid answering
  // it has to say so: React attaches its own `wheel` listener passively, so a
  // handler that did not take the event itself would change the density *and*
  // scale the whole app.
  expect(await zoom(-100)).toBe(false);
  expect(await cardsInARow()).toBe(3);

  // Without Ctrl it is a scroll, and the scroll box keeps it. Fired straight
  // rather than through the fixture, which is the gesture and always holds it.
  let survived = true;
  await act(async () => {
    survived = fireEvent.wheel(grid(), { deltaY: -100 });
  });
  await flush();
  expect(survived).toBe(true);
  expect(await cardsInARow()).toBe(3);
});

test("neither gesture disturbs the selection", async () => {
  viewportWidth(1024);
  await mount(cards(40));
  await enterGrid();
  await press("ArrowRight");
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(3));

  await zoom(-100);
  // The same wallpaper, still selected and still holding the focus. The count
  // the arrows move by changed under it, which is the whole gesture; where the
  // cursor is did not (ADR 0042).
  expect(selection().wallpaper?.id).toBe(3);
  expect(selection().index).toBe(2);
  expect(document.activeElement).toBe(cell(3));

  await press("+");
  await press("-");
  expect(selection().wallpaper?.id).toBe(3);
  expect(document.activeElement).toBe(cell(3));
});

test("the selected card shows its overlay", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");

  // Focus and hover reveal the same thing (ADR 0019), and the reveal is the
  // card's own `group-focus-visible`. What is worth pinning is that it holds
  // when focus is on the cell wrapper rather than on a button inside it: the
  // wrapper *is* the `group`, which `group-has-[:focus-visible]` alone would
  // miss, since `:has()` looks only at descendants. happy-dom draws no focus,
  // so the two halves are asserted separately — the focused node is the group,
  // and the group is what the overlay's reveal keys off.
  const selected = cell(2);
  expect(document.activeElement).toBe(selected);
  expect(selected.className).toContain("group");
  expect(
    selected.querySelector(".absolute.inset-0")?.className ?? "",
  ).toContain("group-focus-visible:opacity-100");
});

test("a reorder that keeps the card keeps the selection on it", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2));

  // A vote, a rescan or a change of ordering. The selection is tracked by
  // wallpaper id, so it goes where the wallpaper went — index-only would leave
  // it on whatever now occupies the slot (ADR 0019).
  await relist([wallpaper(4), wallpaper(3), wallpaper(1), wallpaper(2)]);

  expect(document.activeElement).toBe(cell(2));
});

test("the selected card leaving the list puts the selection at the same index", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2));

  // What a keep or a reject does in Review: the row leaves. The sweep continues
  // from where that card was, so the wallpaper that moved up into the slot is
  // the one selected.
  await relist([wallpaper(1), wallpaper(3), wallpaper(4)]);
  expect(document.activeElement).toBe(cell(3));

  // And at the end of the list the fall back clamps rather than running off it.
  await press("End");
  expect(document.activeElement).toBe(cell(4));
  await relist([wallpaper(1), wallpaper(3)]);
  expect(document.activeElement).toBe(cell(3));
});

test("the list emptying puts focus on the grid itself", async () => {
  await mount(cards(2));
  await enterGrid();

  await relist([]);

  // Not `body`, where the next Tab would start from the top of the document
  // rather than from the page the curator is on.
  expect(document.activeElement).toBe(grid());
});

test("a list that changes while focus is elsewhere does not pull focus in", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");

  await act(async () => {
    button("after").focus();
  });
  // The card holding the selection leaves while the curator is somewhere else
  // entirely: the selection moves and focus does not.
  await relist([wallpaper(1), wallpaper(3), wallpaper(4)]);
  expect(document.activeElement).toBe(button("after"));

  // And the selection that was updated in the background is where Tab lands on
  // the way back in: the same index, one card on.
  await act(async () => {
    button("before").focus();
    pressTab();
  });
  expect(document.activeElement).toBe(cell(3));
});

test("the selection is scrolled into view when it moves", async () => {
  // ADR 0016's window, and the order it forces: the card an arrow key selects
  // may have no DOM node yet, so the row is scrolled in before the focus move
  // rather than inside the key handler. Review mounts every row, so its default
  // is a scroll of the cell itself; this is the virtualised case, where the
  // ordering is what a curator can observe — focus cannot land on a node that
  // only exists because the reveal brought its row in.
  await mountWindowed(cards(400));

  await act(async () => {
    mountedCells()[0].focus();
  });
  expect(mounted(400)).toBe(false);

  await press("End");
  await browserReportsScroll();

  expect(document.activeElement).toBe(cell(400));
  // And the window moved rather than grew: the card the sweep started on is a
  // hundred rows behind it and has given its node up.
  expect(mounted(1)).toBe(false);
});

test("the wheel scrolls past the selected card rather than being pulled back to it", async () => {
  // The other direction of the same rule, and the one a curator hits first: the
  // selection is scrolled into view when *it* moves, and not when the window
  // does. Scrolling the selected card out of the window unmounts it, which takes
  // the focus with it, and a grid that reads that as focus to re-home puts the
  // window straight back where it was. The wheel then does nothing at all.
  await mountWindowed(cards(400));
  await act(async () => {
    mountedCells()[0].focus();
  });
  expect(document.activeElement).toBe(cell(1));

  await act(async () => {
    scroller().scrollTop = 4000;
  });
  await browserReportsScroll();

  // The gesture stands: the offset the wheel asked for is the offset the box is
  // at, and the window is the one that offset names rather than the top of the
  // list.
  expect(scroller().scrollTop).toBe(4000);
  expect(mounted(1)).toBe(false);

  // The card the focus was on is gone with the window, so the container holds
  // it rather than `body`, where the next Tab would start at the top of the
  // document. The keys are still answered, so one arrow moves the selection and
  // brings it back on screen.
  expect(document.activeElement).toBe(grid());
  await press("ArrowRight");
  await browserReportsScroll();
  expect(document.activeElement).toBe(cell(2));
});

// The three things the page holds the selection for (#137). The lightbox is
// what calls them: it renders this same selection, so opening on a card the
// selection was not on is a move, a failed action puts the selection back on the
// wallpaper the toast names, and closing asks for the card to take focus again.

test("the page can select a wallpaper by id, and the tab stop follows it", async () => {
  await mount(cards(4));

  // Nobody has been in the grid, so this is the case the page's failure handler
  // lands in: the curator is elsewhere and the selection moves under them.
  await act(async () => {
    button("after").focus();
  });
  await act(async () => {
    selection().selectId(3);
  });

  // Focus stayed where they put it, and the selection moved anyway. The way
  // back in is what makes the second half observable.
  expect(document.activeElement).toBe(button("after"));
  await act(async () => {
    button("before").focus();
    pressTab();
  });
  expect(document.activeElement).toBe(cell(3));
});

test("a focus request from the page puts focus on the selected card", async () => {
  await mount(cards(4));
  await act(async () => {
    button("after").focus();
  });
  await act(async () => {
    selection().selectId(3);
  });
  expect(document.activeElement).toBe(button("after"));

  // The one route in from outside. Moving the selection deliberately does not
  // take focus, so closing the lightbox has to ask — and what it asks for is
  // the card for the current selection, not the one it was opened from
  // (ADR 0022).
  await act(async () => {
    gridHandle?.focusSelection();
  });
  expect(document.activeElement).toBe(cell(3));
});

test("a focus request reveals a card with no node before focusing it", async () => {
  await mountWindowed(cards(400));

  // The window ADR 0016 puts over the library: a few dozen of the 400 cards
  // have a node, and the wallpaper the page selects is not one of them.
  expect(mountedCells().length).toBeLessThan(400);
  await act(async () => {
    selection().selectId(400);
  });
  expect(mounted(400)).toBe(false);

  await act(async () => {
    gridHandle?.focusSelection();
  });
  await browserReportsScroll();

  // The row was asked for before the focus move: the reveal moves the window,
  // the commit that follows gives card 400 a node, and the focus lands on the
  // pass after that. Focusing a node that does not exist yet is the one way the
  // pattern breaks (ADR 0019).
  expect(mounted(400)).toBe(true);
  expect(document.activeElement).toBe(cell(400));
});

test("a request not to reveal focuses the grid where it stands", async () => {
  await mountWindowed(cards(400));
  await act(async () => {
    selection().selectId(400);
  });
  expect(mounted(400)).toBe(false);

  // A keyboard hand-off's ask: the curator's scroll position is theirs, so the
  // window stays where it is and the container takes the focus in the card's
  // place, the way it does after a wheel scrolled the selection away (ADR 0047).
  await act(async () => {
    gridHandle?.focusSelection({ reveal: false });
  });
  await browserReportsScroll();
  expect(mounted(400)).toBe(false);
  expect(document.activeElement).toBe(grid());

  // The keys are answered from there, and the next one is a reveal.
  await press("ArrowLeft");
  await browserReportsScroll();
  expect(document.activeElement).toBe(cell(399));
});

test("R on a row with no Origin reaches the host, the same as its button does", async () => {
  await mount(mixed());
  await enterGrid();
  await press("End");
  expect(document.activeElement).toBe(cell(4, "Rejected"));

  await press("r");

  // The key goes where the button goes, which is the whole of what this grid
  // owes: the origin-less refusal is the host's, held once in the `perform`
  // both triggers reach, so a key cannot raise a different answer from a click
  // (ADR 0009, ADR 0019, ADR 0023). This host has no refusal in it, which is
  // what makes the reach visible; `LibraryView.test.tsx` asserts the sentence.
  expect(asked).toEqual(["restore"]);
  expect(commands).toEqual(["restore_wallpaper"]);
});

test("Enter asks to open the selected card, and changes no Status", async () => {
  await mount(mixed());
  await enterGrid();

  // The same `onOpen` a click arrives at, so the key and the mouse cannot open
  // different things — and it names the card holding the selection, which is
  // the card the key was pressed on (#138).
  await press("Enter");
  await press("ArrowRight");
  await press("Enter");

  expect(opened).toEqual([1, 2]);
  // And nothing else. `Enter` is a look, not a decision: the two cards it was
  // pressed on still hold the Status in their own accessible names.
  expect(commands).toEqual([]);
  expect(asked).toEqual([]);
  expect(cell(1, "Active")).toBeTruthy();
  expect(cell(2, "Kept")).toBeTruthy();
});

// The click (#134). It reaches the host through the grid because the page is
// where ADR 0022 keeps the lightbox's state, and it names the card it landed on
// rather than the one holding the selection, which a click does not move.

test("a click on a card asks to open it, and a click on a button does not", async () => {
  await mount(mixed());

  await act(async () => {
    fireEvent.click(cell(2, "Kept"));
  });
  expect(opened).toEqual([2]);

  await act(async () => {
    fireEvent.click(button("Keep wall-1.jpg"));
  });

  // One press, one outcome: the button stops the click, so a keep is a keep
  // rather than a keep with the lightbox opening over the card it emptied.
  expect(commands).toEqual(["keep_wallpaper"]);
  expect(opened).toEqual([2]);
});

test("Enter on an overlay button is left to the button", async () => {
  await mount(mixed());

  const keep = button("Keep wall-1.jpg");
  let survived = false;
  await act(async () => {
    keep.focus();
    // `fireEvent` answers with whether the event survived, which is the whole
    // question: the keypress bubbles through the cell to the grid's own
    // handler, and a handler that cancelled the default action on the way up
    // would leave `Enter` pressing a control that does nothing. happy-dom
    // synthesises no activation from it, so the surviving default is what
    // there is to assert on (ADR 0019).
    survived = fireEvent.keyDown(keep, { key: "Enter" });
  });

  expect(survived).toBe(true);
  // And the grid does not answer it either, which is the second half of one
  // press, one outcome: a keep with the lightbox opening over the card it
  // emptied is what the buttons' `stopPropagation` refuses for the mouse
  // (#138).
  expect(opened).toEqual([]);
});

test("a key that removes the selected card leaves the selection at that index", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2));

  await press("k");
  expect(commands).toEqual(["keep_wallpaper"]);
  // What a page does next, and the whole reason the keys are worth having: the
  // row leaves, and the sweep continues from where that card was rather than
  // from wherever a rebuilt tab order happens to start (ADR 0019).
  await relist([wallpaper(1), wallpaper(3), wallpaper(4)]);
  expect(document.activeElement).toBe(cell(3));

  await press("Delete");
  expect(commands).toEqual(["keep_wallpaper", "move_wallpaper"]);
});
