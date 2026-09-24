import type { Picture } from "@/components/HeroPicture";
import { ItemGrid, type GridCell } from "@/components/ItemGrid";
import {
  ItemLightbox,
  LightboxTitle,
  useLightbox,
} from "@/components/ItemLightbox";
import type { ActionTable } from "@/components/keymap";
import type { SelectionHandle } from "@/components/selection";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useState } from "react";
import { flush, mockBootedApp, press, renderInApp, settings } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The lightbox over something that is not a Wallpaper (#338).
//
// Discover opens Results in the lightbox Library opens wallpapers in, so this
// drives the shell the way that page will: a generic grid over a stand-in with
// a string key, the shell over that grid's handle, and the page's own picture
// sources, row and action table. What it asks is what a curator would — which
// item is up, what it is drawn from, where `←` and `→` go, what the page's key
// does, and where Escape hands the focus back. Everything Library and Review
// observe about their lightbox is `lightbox.test.tsx`'s, unchanged.

/** A stand-in for a Result: a string key, a size, and whether it is marked. */
interface Thing {
  id: string;
  name: string;
  width: number;
  height: number;
  marked?: boolean;
}

/** A page's action table, the one its grid takes too: `P` picks. */
const THING_KEYS: ActionTable<Thing, "pick"> = {
  bindings: [
    {
      keys: ["p"],
      printed: "P",
      act: ["pick"],
      on: ["grid", "lightbox"],
      listed: { listing: "Pick the selected thing" },
    },
  ],
  offers: (thing) => (thing.marked ? [] : ["pick"]),
};

const THING_CARD = { ratio: 9 / 16, className: "aspect-video", caption: 48 };

const THINGS: Thing[] = [
  { id: "wh-a1", name: "first thing", width: 3840, height: 2160 },
  { id: "wh-b2", name: "second thing", width: 1080, height: 1920 },
  { id: "wh-c3", name: "third thing", width: 2560, height: 1080, marked: true },
];

/** Two sources that are not `wallpaper://`, the way a Result's are. */
const pictureOf = (thing: Thing): Picture => ({
  id: thing.id,
  placeholder: `https://th.example/lg/${thing.id}.jpg`,
  full: `https://w.example/full/${thing.id}.jpg`,
  alt: thing.name,
  dimensions: { width: thing.width, height: thing.height },
});

let acted: string[];

beforeEach(() => {
  acted = [];
  mockBootedApp();
});

afterEach(cleanup);

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

/** A page with nothing but the grid and the lightbox over it. */
function ThingPage() {
  const [grid, setGrid] = useState<SelectionHandle<Thing> | null>(null);
  const lightbox = useLightbox(grid);
  const onAct = (action: "pick", thing: Thing) =>
    acted.push(`${action} ${thing.id}`);
  return (
    <>
      <ItemGrid
        ref={setGrid}
        items={THINGS}
        label="Things"
        renderCard={(thing, cell) => <ThingCard thing={thing} cell={cell} />}
        actions={THING_KEYS}
        onAct={onAct}
        onOpen={lightbox.openOn}
        card={THING_CARD}
        density="discover"
      />
      <ItemLightbox
        grid={grid}
        open={lightbox.open}
        onClose={lightbox.close}
        actions={THING_KEYS}
        onAct={onAct}
        picture={pictureOf}
        rowFloor={300}
        noun="thing"
        gone={<p>Couldn&apos;t load preview</p>}
        row={(thing) => ({
          identity: <LightboxTitle>{thing.id}</LightboxTitle>,
          readout: <p data-slot="thing-readout">{thing.name}</p>,
          buttons: thing.marked ? (
            <span>Marked</span>
          ) : (
            <button type="button" onClick={() => onAct("pick", thing)}>
              Pick
            </button>
          ),
        })}
      />
    </>
  );
}

async function mount() {
  await renderInApp(<ThingPage />);
  await act(async () => {
    screen.getByRole("gridcell", { name: "first thing" }).focus();
  });
}

const dialog = () => screen.queryByRole("dialog");

/** Every image the picture has out, in the order they paint. */
const requests = () =>
  Array.from(dialog()?.querySelectorAll("img") ?? []).map(
    (img) => img.getAttribute("src") ?? "",
  );

test("it opens over a non-Wallpaper item, walks the grid's cursor, and closes back to the card", async () => {
  await mount();
  await press("Enter");

  // Named by the page's own title, and drawn from the page's own sources: the
  // placeholder under the full source, never blank while that loads.
  expect(screen.getByRole("dialog", { name: "wh-a1" })).toBeTruthy();
  expect(requests()).toEqual([
    "https://th.example/lg/wh-a1.jpg",
    "https://w.example/full/wh-a1.jpg",
  ]);
  expect(dialog()?.textContent).toContain("1 / 3");
  expect(screen.getByRole("button", { name: "Previous thing" })).toBeTruthy();

  await press("ArrowRight");
  expect(screen.getByRole("dialog", { name: "wh-b2" })).toBeTruthy();
  expect(dialog()?.textContent).toContain("2 / 3");
  // The step asks for the stepped-to item's full source and nothing else:
  // the same element takes it, holding the outgoing picture meanwhile.
  expect(requests()[requests().length - 1]).toBe(
    "https://w.example/full/wh-b2.jpg",
  );

  await press("ArrowRight");
  await press("ArrowLeft");
  expect(screen.getByRole("dialog", { name: "wh-b2" })).toBeTruthy();

  await press("Escape");
  expect(dialog()).toBeNull();
  // The grid's cursor walked with the lightbox, so the card handed the focus
  // back is the one the curator stepped to.
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "second thing",
  );
});

test("the page's own row and keys are what it offers", async () => {
  await mount();
  await press("Enter");

  expect(
    dialog()?.querySelector('[data-slot="thing-readout"]')?.textContent,
  ).toBe("first thing");

  // The page's key, resolved against what the item offers.
  await press("p");
  fireEvent.click(screen.getByRole("button", { name: "Pick" }));
  expect(acted).toEqual(["pick wh-a1", "pick wh-a1"]);

  // A marked item offers nothing, so its key does nothing, and its row says
  // what the page put there.
  await press("ArrowRight");
  await press("ArrowRight");
  await press("p");
  expect(acted).toEqual(["pick wh-a1", "pick wh-a1"]);
  expect(dialog()?.textContent).toContain("Marked");

  // And a Status key means nothing on a page that does not act on a Status.
  await press("k");
  await press("Delete");
  expect(acted).toEqual(["pick wh-a1", "pick wh-a1"]);
  expect(dialog()).not.toBeNull();
});

test("a page that leaves the crop preview out gets no toggle, no bars and no C", async () => {
  // Up, off the stored toggle Library's lightbox and the strip read.
  mockCommand("get_settings", () => settings({ crop_preview: true }));
  let saved = 0;
  mockCommand("set_setting", () => {
    saved++;
    return settings();
  });
  await mount();
  await press("Enter");
  await flush();

  expect(screen.queryByRole("button", { name: /Crop preview/ })).toBeNull();
  expect(document.querySelector('[data-slot="crop-preview"]')).toBeNull();

  await press("c");
  expect(saved).toBe(0);
});
