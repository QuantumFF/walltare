import { ItemGrid, type GridCell } from "@/components/ItemGrid";
import { WALLPAPER_CARD, rowHeight } from "@/components/grid-geometry";
import {
  shortcutLines,
  type ActionTable,
  type ShortcutLine,
} from "@/components/keymap";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cardsInARow, flush, press, viewportWidth } from "./fixtures";

// The grid over something that is not a Wallpaper (#336).
//
// Discover's Results are keyed by Wallhaven ids, which are strings, and what a
// key does to one is Discover's rather than a Status transition. So this drives
// `ItemGrid` over a stand-in with a string key, its own card and its own action
// table, and asks what a curator would: where the focus goes, what `Enter`
// opens, and what a page's own key does. Everything Library and Review observe
// about the same grid is `WallpaperGrid.test.tsx`'s, unchanged.

/** A stand-in for a Result: a string key, and whether it can be picked. */
interface Thing {
  id: string;
  name: string;
  marked?: boolean;
}

/** A page's action table: `P` picks, and a marked item offers nothing. */
const THING_KEYS: ActionTable<Thing, "pick"> = {
  bindings: [
    {
      keys: ["p"],
      printed: "P",
      act: ["pick"],
      on: ["grid"],
      listed: { listing: "Pick the selected thing" },
    },
  ],
  offers: (thing) => (thing.marked ? [] : ["pick"]),
};

/** A card with a caption under it, as the plan is told. */
const THING_CARD = { ratio: 9 / 16, className: "aspect-video", caption: 48 };

let picked: string[];
let opened: string[];

beforeEach(() => {
  picked = [];
  opened = [];
});

afterEach(() => {
  cleanup();
  viewportWidth(1024);
});

/** The card the grid is handed: the cell itself, wearing what the grid finds. */
function ThingCard({ thing, cell }: { thing: Thing; cell: GridCell }) {
  return (
    <div
      role="gridcell"
      aria-label={thing.name}
      data-cell={cell.cellIndex}
      tabIndex={cell.selected ? 0 : -1}
    >
      {thing.name}
    </div>
  );
}

const things = (count: number, marked: ReadonlySet<number> = new Set()) =>
  Array.from({ length: count }, (_, at) => ({
    // A key that is not a number, and not the position either.
    id: `wh-${(at + 1).toString(36)}x`,
    // Named the way `cardsInARow` reads a card's position off its label.
    name: `wall-${at + 1}.jpg`,
    marked: marked.has(at + 1),
  }));

async function mount(list: Thing[]) {
  render(
    <ItemGrid
      items={list}
      label="Things"
      renderCard={(thing, cell) => <ThingCard thing={thing} cell={cell} />}
      actions={THING_KEYS}
      onAct={(action, thing) => picked.push(`${action} ${thing.id}`)}
      onOpen={(thing) => opened.push(thing.id)}
      card={THING_CARD}
      density="discover"
    />,
  );
  await flush();
}

const cell = (n: number) =>
  screen.getByRole("gridcell", { name: `wall-${n}.jpg` });

async function enter(n = 1) {
  await act(async () => {
    cell(n).focus();
  });
}

test("the arrows move the cursor over items keyed by a string", async () => {
  // lg, where Discover starts on three a row.
  viewportWidth(1024);
  await mount(things(12));
  await enter();

  await press("ArrowRight");
  expect(document.activeElement).toBe(cell(2));
  await press("ArrowDown");
  expect(document.activeElement).toBe(cell(5));
  await press("End");
  expect(document.activeElement).toBe(cell(12));
  await press("ArrowLeft");
  expect(document.activeElement).toBe(cell(11));

  // One tab stop, which moved with the cursor.
  const stops = screen
    .getAllByRole("gridcell")
    .filter((node) => node.tabIndex === 0);
  expect(stops).toEqual([cell(11)]);
});

test("Enter opens the item under the cursor", async () => {
  await mount(things(6));
  await enter();
  await press("ArrowRight");
  await press("ArrowRight");

  await press("Enter");
  expect(opened).toEqual(["wh-3x"]);
});

test("a page's own key acts on the item under the cursor, when it offers that", async () => {
  await mount(things(6, new Set([2])));
  await enter();

  await press("p");
  expect(picked).toEqual(["pick wh-1x"]);

  // A marked item offers nothing, so its key does nothing and goes nowhere.
  await press("ArrowRight");
  await press("p");
  expect(picked).toEqual(["pick wh-1x"]);

  // And a Status key means nothing on a page that does not act on a Status.
  await press("k");
  await press("Delete");
  expect(picked).toEqual(["pick wh-1x"]);
});

test("Discover's density runs from two to five a row", async () => {
  // xl, where the viewport alone would ask for five and Discover starts on
  // three regardless.
  viewportWidth(1280);
  await mount(things(40));
  await enter();
  expect(await cardsInARow()).toBe(3);

  for (let at = 0; at < 6; at++) await press("-");
  expect(await cardsInARow()).toBe(5);
  for (let at = 0; at < 6; at++) await press("+");
  expect(await cardsInARow()).toBe(2);
});

test("a row is as tall as its picture plus its caption", () => {
  // No caption is Library's and Review's row height, to the pixel.
  expect(rowHeight(1200, 4, undefined, WALLPAPER_CARD)).toBe(
    rowHeight(1200, 4),
  );
  expect(rowHeight(1200, 3, undefined, THING_CARD)).toBe(
    rowHeight(1200, 3) + 48,
  );
});

test("the shortcuts list prints the page's own keys after Enter", () => {
  const lines: ShortcutLine[] = shortcutLines("listing", THING_KEYS);
  const at = lines.findIndex((line) => line.keys[0] === "Enter");
  expect(lines[at + 1]).toEqual({
    keys: ["P"],
    action: "Pick the selected thing",
  });
  expect(lines.some((line) => line.keys[0] === "K")).toBe(false);
});
