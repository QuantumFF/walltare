import type { Wallpaper } from "@/lib/client";
import { WallpaperGrid } from "@/components/WallpaperGrid";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useState } from "react";
import {
  flush,
  renderInApp,
  settings,
  stats,
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

beforeEach(() => {
  // The provider's boot gate; the grid itself asks the backend nothing.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
});

/** Wallpapers 1..count, `wall-1.jpg` through `wall-<count>.jpg`. */
function cards(count: number): Wallpaper[] {
  return Array.from({ length: count }, (_, i) => wallpaper(i + 1));
}

let setList: (list: Wallpaper[]) => void = () => {};

/**
 * The grid between two other tab stops, so a test can walk into it and out the
 * far side, and with the list in state so it can change under the selection the
 * way an action or a filter does.
 */
function Harness({ initial }: { initial: Wallpaper[] }) {
  const [list, set] = useState(initial);
  setList = set;
  return (
    <>
      <button type="button">before</button>
      <WallpaperGrid
        wallpapers={list}
        label="Wallpapers"
        onAction={() => {}}
      />
      <button type="button">after</button>
    </>
  );
}

async function mount(list: Wallpaper[]) {
  await renderInApp(<Harness initial={list} />);
  await flush();
}

/** Hand the list back a new one, the way a keep or a refetch does. */
async function relist(list: Wallpaper[]) {
  await act(async () => {
    setList(list);
  });
}

/** One card, by the accessible name it carries as a cell. */
function cell(id: number): HTMLElement {
  return screen.getByRole("gridcell", { name: `wall-${id}.jpg, Active` });
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

async function press(key: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
}

/** Put focus on the grid's one tab stop, the way Tab does. */
async function enterGrid(): Promise<void> {
  await act(async () => {
    button("before").focus();
    pressTab();
  });
}

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
  // lg: four cards to a row, which is the same fact the `lg:grid-cols-4` class
  // states — the grid reads both off one table, so a breakpoint added to the
  // classes cannot leave the arrows moving by a stale count.
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

test("Right walks off the end of a row, and Down stops at the last row", async () => {
  viewportWidth(1024);
  // Six cards over two rows, the second of them short: 5 and 6 sit under 1 and 2.
  await mount(cards(6));
  await enterGrid();

  await press("ArrowRight");
  await press("ArrowRight");
  await press("ArrowRight");
  // The rows are a wrapping of one list, and a sweep reads it as one, so the
  // fourth card is not a wall.
  expect(document.activeElement).toBe(cell(4));
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(5));

  // Down from card 4 would be card 8, which does not exist. It does nothing
  // rather than clamping to the last card, so Down does not mean two different
  // things depending on how full the last row happens to be.
  await press("ArrowLeft");
  await press("ArrowDown");
  expect(document.activeElement).toBe(cell(4));
});

test("Home and End reach the first and last card", async () => {
  await mount(cards(9));
  await enterGrid();

  await press("End");
  expect(document.activeElement).toBe(cell(9));

  await press("Home");
  expect(document.activeElement).toBe(cell(1));
});

test("the selected card shows its overlay", async () => {
  await mount(cards(4));
  await enterGrid();
  await press("ArrowRight");

  // Focus and hover reveal the same thing (ADR 0019), and the reveal is the
  // card's own `group-focus-within`. What is worth pinning is that it still
  // holds when focus is on the cell wrapper rather than on a button inside it:
  // the wrapper *is* the `group`, and `:focus-within` matches an element that
  // has focus itself. happy-dom has no `:focus-within`, so the two halves are
  // asserted separately — the focused node is the group, and the group is what
  // the overlay's reveal keys off.
  const selected = cell(2);
  expect(document.activeElement).toBe(selected);
  expect(selected.className).toContain("group");
  expect(
    selected.querySelector(".absolute.inset-0")?.className ?? "",
  ).toContain("group-focus-within:opacity-100");
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
  // The seam #79 hands ADR 0016's virtualiser: the card an arrow key selects
  // may have no DOM node yet, so the row is scrolled in before the focus move
  // rather than inside the key handler. Review mounts every row, so its default
  // is a scroll of the cell itself; this asserts the order the virtualised case
  // needs, which is reveal first and focus after.
  const revealed: number[] = [];
  await renderInApp(
    <WallpaperGrid
      wallpapers={cards(9)}
      label="Wallpapers"
      onAction={() => {}}
      reveal={(index) => {
        revealed.push(index);
        expect(document.activeElement).not.toBe(cell(index + 1));
      }}
    />,
  );
  await flush();

  await act(async () => {
    cell(1).focus();
  });
  await press("End");

  expect(revealed).toEqual([8]);
  expect(document.activeElement).toBe(cell(9));
});
