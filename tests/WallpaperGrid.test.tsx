import type { CardAction } from "@/components/WallpaperCard";
import { client, type Wallpaper } from "@/lib/client";
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

/** The commands the keys below reached, in order, and what was asked for. */
let commands: string[];
let asked: CardAction[];
/** The wallpapers a click asked to open the lightbox on, in order (#134). */
let opened: number[];

beforeEach(() => {
  commands = [];
  asked = [];
  opened = [];
  // The provider's boot gate; the grid itself asks the backend nothing.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  // The four a page can make on the curator's behalf. Review reaches two of
  // them and the library page reaches all four, so this host stands in for the
  // page rather than for either one.
  mockCommand("keep_wallpaper", () => commands.push("keep_wallpaper"));
  mockCommand("unkeep_wallpaper", () => commands.push("unkeep_wallpaper"));
  mockCommand("move_wallpaper", () => {
    commands.push("move_wallpaper");
    return "/library/rejected/wall-1.jpg";
  });
  mockCommand("restore_wallpaper", () => {
    commands.push("restore_wallpaper");
    return "/library/wall-1.jpg";
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
 * is the card's table, which is the point of asserting on the commands.
 */
function handleAction(action: CardAction, subject: Wallpaper): void {
  asked.push(action);
  if (action === "keep") void client.keepWallpaper(subject.id);
  if (action === "make-active") void client.unkeepWallpaper(subject.id);
  if (action === "reject") void client.moveWallpaper(subject.id, "./rejected");
  if (action === "restore") void client.restoreWallpaper(subject.id);
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
        onAction={handleAction}
        onOpen={(subject) => opened.push(subject.id)}
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
function cell(id: number, status = "Active"): HTMLElement {
  return screen.getByRole("gridcell", { name: `wall-${id}.jpg, ${status}` });
}

/** The title and description of the one toast that is up, or `null` for none. */
function toast(): { title: string; description: string | null } | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return {
    title: root.querySelector("[data-slot='toast-title']")?.textContent ?? "",
    description:
      root.querySelector("[data-slot='toast-description']")?.textContent ?? null,
  };
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

// The direct keys. Each one presses on a card of every Status and asks which
// command the page was made to call, because that is what a curator can observe:
// a key that acts moves a file or writes a column, and a key that does not acts
// on nothing at all (ADR 0019).

test("K keeps an Active card, makes a Kept one Active, and does nothing on a Rejected one", async () => {
  await mount(mixed());
  await enterGrid();

  await press("k");
  expect(commands).toEqual(["keep_wallpaper"]);

  // The keep slot's other end. One finger means "the keep decision" and the
  // Status picks which end applies, rather than `K` meaning something unrelated
  // on the card beside it.
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2, "Kept"));
  await press("k");
  expect(commands).toEqual(["keep_wallpaper", "unkeep_wallpaper"]);

  // Rejected offers only Restore, so `K` is a wrong key rather than a wrong
  // action — and never a transition CONTEXT.md would call an error.
  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(3, "Rejected"));
  await press("k");
  expect(commands).toEqual(["keep_wallpaper", "unkeep_wallpaper"]);
  expect(asked).toEqual(["keep", "make-active"]);
});

test("Delete rejects an Active card and a Kept one, and does nothing on a Rejected one", async () => {
  await mount(mixed());
  await enterGrid();

  // No confirm and no modifier: the dialog is gone and the toast's Undo is the
  // safety net (ADR 0009, ADR 0017).
  await press("Delete");
  expect(commands).toEqual(["move_wallpaper"]);

  await press("ArrowRight");
  await press("Delete");
  expect(commands).toEqual(["move_wallpaper", "move_wallpaper"]);

  // A soft reject of an already Rejected wallpaper is the transition the
  // backend answers with `invalid_transition`. The key never asks for it.
  await press("ArrowRight");
  await press("Delete");
  expect(commands).toEqual(["move_wallpaper", "move_wallpaper"]);
  expect(asked).toEqual(["reject", "reject"]);
});

test("R restores a Rejected card with an Origin, and does nothing on an Active or a Kept one", async () => {
  await mount(mixed());
  await enterGrid();

  await press("r");
  await press("ArrowRight");
  await press("r");
  expect(commands).toEqual([]);
  expect(asked).toEqual([]);

  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(3, "Rejected"));
  await press("r");
  expect(commands).toEqual(["restore_wallpaper"]);
  expect(asked).toEqual(["restore"]);
});

test("R on a row with no Origin explains itself and calls nothing", async () => {
  await mount(mixed());
  await enterGrid();
  await press("End");
  expect(document.activeElement).toBe(cell(4, "Rejected"));

  await press("r");

  // The same refusal the `aria-disabled` button raises, from the same place:
  // `origin_path` is on the DTO, so the frontend knows the answer before the
  // press and the key costs no round trip (ADR 0009, ADR 0019).
  expect(toast()).toEqual({
    title: "Can't restore wall-4.jpg",
    description:
      "Rejected before Restore existed, so nothing recorded where it came from.",
  });
  expect(commands).toEqual([]);
  expect(asked).toEqual([]);
});

test("Enter calls no command and changes no Status", async () => {
  await mount(mixed());
  await enterGrid();

  // #80 opens the lightbox on the selection. Until then the binding is claimed
  // and inert, which is the state worth pinning: the card it is pressed on is
  // the same card afterwards, by the Status in its own accessible name.
  await press("Enter");
  await press("ArrowRight");
  await press("Enter");

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
