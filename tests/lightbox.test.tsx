import App from "@/App";
import type { Wallpaper } from "@/lib/client";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cacheSize, flush, settings, stats, wallpaper } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// ADR 0022's surface, driven the way a curator reaches it: render the whole app,
// navigate to a page that mounts the grid, open the lightbox from a real card,
// and ask what is on screen. The selection is the thing under test and it is
// observable as which filename the lightbox is showing, so nothing here reads
// the state behind it.
//
// Both pages mount the same component from the same selection, so most of this
// runs on Review and the two tests that need a Kept or a Rejected row run on
// the library page, which is the page that lists one.

afterEach(() => {
  cleanup();
});

/** The rows Review's fetch answers with, set per test. */
let reviewRows: Wallpaper[];
/** The rows the library page's fetch answers with, set per test. */
let libraryRows: Wallpaper[];

beforeEach(() => {
  reviewRows = [
    wallpaper(7, {
      filename: "first.jpg",
      path: "/library/first.jpg",
      comparisons_count: 3,
    }),
    wallpaper(8, { filename: "second.jpg", path: "/library/second.jpg" }),
  ];
  libraryRows = [];

  // A library with wallpapers in it, so boot lands on Rank and every test
  // navigates from where the curator actually starts.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("get_cache_size", () => cacheSize());
  // Both rejecting pages read where a reject goes for the line on their bar.
  mockCommand("expand_path", (args) => ({
    resolved: args?.input as string,
    exists: true,
  }));
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_review", () => reviewRows);
  mockCommand("list_wallpapers", () => libraryRows);
  mockCommand("keep_wallpaper", () => null);
});

const tab = (name: string) => screen.getByRole("tab", { name });

/** The lightbox, or `null` when none is up. */
const lightbox = () => screen.queryByRole("dialog");

/** The one view container the shell is showing, which is what carries `inert`. */
const viewContainer = () =>
  document.querySelector('[data-slot="view"]')?.parentElement as HTMLElement;

const row = () =>
  document.querySelector('[data-slot="lightbox-row"]') as HTMLElement;

const readOut = () =>
  document.querySelector('[data-slot="lightbox-readout"]') as HTMLElement;

/**
 * The title of the one toast that is up, or `null` for none. Read off
 * `data-slot` rather than a role, the way the other toast files do: Radix gives
 * the toast and its own announce region the same `role="status"`.
 */
const toastTitle = () =>
  document.querySelector("[data-slot='toast'] [data-slot='toast-title']")
    ?.textContent ?? null;

/** The picture the lightbox is showing, by the alt text that names it. */
function picture(): HTMLImageElement {
  return screen.getByRole("dialog").querySelector("img") as HTMLImageElement;
}

function cell(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name });
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

/**
 * A keystroke, from wherever focus is — which while a lightbox is up is inside
 * it, and which is what puts Escape in front of the layer that answers it.
 */
async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
  await flush();
}

async function openApp() {
  render(<App />);
  await flush();
}

/** Land on Review with its grid up, and focus the first card the way Tab does. */
async function enterReview() {
  await openApp();
  await click(tab("Review"));
  await act(async () => {
    screen.getAllByRole("gridcell")[0].focus();
  });
}

/** Land on the library page with the rows this test arranged. */
async function enterLibrary(rows: Wallpaper[]) {
  libraryRows = rows;
  await openApp();
  await click(tab("Library"));
}

test("Enter on the selected card opens the lightbox on it", async () => {
  await enterReview();
  expect(lightbox()).toBeNull();

  await pressKey("Enter");

  // The dialog is named by the filename, which is the identity line doubling as
  // the `Dialog.Title` Radix wants for `aria-labelledby` — so what a screen
  // reader is told on the way in is which wallpaper is up.
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
  expect(picture().getAttribute("alt")).toBe("first.jpg");
});

test("a click on a card body opens the lightbox on that card, wherever the selection was", async () => {
  await enterReview();

  // The second card, while the selection is on the first: a click is a
  // selection move and not a second cursor, so what opens is what was pressed
  // and the grid behind agrees about it (ADR 0022).
  await click(cell("second.jpg, Active"));

  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();

  // And the grid is pointed there too, which is observable as the card Escape
  // hands the focus back to.
  await pressKey("Escape");
  expect(lightbox()).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "second.jpg, Active",
  );
});

test("a click on an overlay button acts and opens nothing", async () => {
  await enterReview();

  await click(screen.getByRole("button", { name: "Keep first.jpg" }));

  // One press, one outcome. The button stops the click before it reaches the
  // cell, so a keep is a keep rather than a keep with the lightbox opening over
  // the card it just emptied.
  expect(lightbox()).toBeNull();
  expect(screen.queryByAltText("first.jpg")).toBeNull();
});

test("Enter on an overlay button acts and opens nothing", async () => {
  await enterReview();

  // The keyboard's half of the same rule. `Enter` on a focused button activates
  // it and the keypress still bubbles through the grid's own handler, which
  // answers the key only from the cell itself.
  const keep = screen.getByRole("button", { name: "Keep first.jpg" });
  await act(async () => {
    keep.focus();
  });
  await pressKey("Enter");

  expect(lightbox()).toBeNull();
});

test("the row carries the identity, the read-out and the position", async () => {
  await enterReview();

  await pressKey("Enter");

  // Everything #44's housing puts under the picture, on the one row: the Score,
  // the filename, the Status, where the file is, how much the Score is worth,
  // and where this wallpaper sits in the list being walked. The position stays
  // even though nothing steps yet, because #139 clamps rather than wrapping and
  // that is what makes the end of a worklist mean something.
  expect(row().textContent).toContain("25.0");
  expect(row().textContent).toContain("first.jpg");
  expect(row().textContent).toContain("Active");
  expect(row().textContent).toContain("/library/first.jpg");
  expect(row().textContent).toContain("3 comparisons");
  expect(row().textContent).toContain("1 / 2");
});

test("a non-Rejected wallpaper's read-out is its path", async () => {
  await enterReview();

  await pressKey("Enter");

  expect(readOut().textContent).toBe("/library/first.jpg");
  expect(readOut().getAttribute("title")).toBe("/library/first.jpg");
});

test("a Rejected wallpaper's read-out is its Origin, at full colour", async () => {
  await enterLibrary([
    wallpaper(4, {
      filename: "gone.jpg",
      status: "rejected",
      path: "/library/rejected/gone.jpg",
      origin_path: "/library/gone.jpg",
    }),
  ]);

  await click(cell("gone.jpg, Rejected"));

  // The Origin, which is what #140's Restore is about to act on and which has
  // never been rendered anywhere else in the app, with the current path in
  // `title`. That is the toast's rule applied to a read-out: name what is not
  // already on screen — the reject folder is named by the bar and by the card,
  // and the Origin is named by nothing.
  expect(readOut().textContent).toBe("/library/gone.jpg");
  expect(readOut().getAttribute("title")).toBe("/library/rejected/gone.jpg");
  expect(row().textContent).toContain("Rejected");

  // And the picture keeps its colour, whatever the card behind it does. The
  // card fades a Rejected image so it recedes in a mixed grid; this is the one
  // surface built to show a picture, and the Status pill carries the signal.
  expect(picture().className).not.toContain("opacity");
  expect(picture().className).not.toContain("grayscale");
});

test("a Rejected wallpaper with no Origin falls back to its path", async () => {
  await enterLibrary([
    wallpaper(5, {
      filename: "legacy.jpg",
      status: "rejected",
      path: "/library/rejected/legacy.jpg",
      origin_path: null,
    }),
  ]);

  await click(cell("legacy.jpg, Rejected"));

  // The cohort ADR 0009's migration left with nothing recorded. There is no
  // Origin to name, so the line says where the file is; #140's `aria-disabled`
  // Restore is what carries the explanation beside it.
  expect(readOut().textContent).toBe("/library/rejected/legacy.jpg");
});

test("the lightbox is a non-modal dialog, labelled by the filename", async () => {
  await enterReview();
  await pressKey("Enter");

  const dialog = screen.getByRole("dialog", { name: "first.jpg" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");

  // Non-modal is the whole configuration, and what it buys is a toast that
  // still reaches a screen reader. A modal dialog runs `hideOthers`, which
  // marks every sibling on the way up `aria-hidden`, and Radix does not portal
  // the toast viewport — so the live region a file's move is announced through
  // would be out of the accessibility tree on the exact flow it exists for
  // (ADR 0017, ADR 0022). This is that, asserted where it lands.
  const viewport = document.querySelector('[data-slot="toast-viewport"]');
  expect(viewport?.getAttribute("aria-hidden")).toBeNull();
  expect(viewContainer().getAttribute("aria-hidden")).toBeNull();
});

test("the pages behind are inert while it is open, and the toast viewport is not", async () => {
  await enterReview();
  expect(viewContainer().hasAttribute("inert")).toBe(false);

  await pressKey("Enter");

  // The containment ADR 0022 chose in place of a focus trap: nothing behind the
  // opaque backdrop takes focus or a click.
  expect(viewContainer().hasAttribute("inert")).toBe(true);

  // And the toast viewport sits outside that container, which is what keeps it
  // announced and what lets F8 move focus into it while the lightbox is up.
  const viewport = document.querySelector('[data-slot="toast-viewport"]');
  expect(viewport).not.toBeNull();
  expect(viewContainer().contains(viewport)).toBe(false);

  await pressKey("Escape");
  expect(viewContainer().hasAttribute("inert")).toBe(false);
});

test("the background progress report is suppressed while it is open", async () => {
  await enterReview();

  await act(async () => {
    emitEvent("pregen-progress", { done: 5, total: 10 });
  });
  await flush();
  // Up first, so this test is about the suppression rather than about a report
  // that never arrived.
  expect(toastTitle()).toBe("Preparing thumbnails… 5 of 10");

  await pressKey("Enter");

  // Not covered — suppressed. A full-screen picture is the one place the app
  // asks for the whole window, and ADR 0017's reason for putting a toast over
  // this surface is confirming a keep or a reject fired from inside it, which
  // does not extend to a report of work nobody started (ADR 0021).
  expect(toastTitle()).toBeNull();

  await pressKey("Escape");
  expect(toastTitle()).toBe("Preparing thumbnails… 5 of 10");
});

test("Escape closes it and puts the card for the current selection back in focus", async () => {
  await enterReview();
  await pressKey("Enter");
  expect(lightbox()).not.toBeNull();

  await pressKey("Escape");

  expect(lightbox()).toBeNull();
  // Radix would have focused the trigger; the card asked for is the one holding
  // the current selection, which after #139's stepping is a different card and
  // often an unmounted one (ADR 0022).
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "first.jpg, Active",
  );
});

test("the Close button closes it, which is the touchscreen's way out", async () => {
  await enterReview();
  await pressKey("Enter");

  // There is no hover to reveal and no Escape to press on a hover-less pointer,
  // and ADR 0019 routes that curator through this surface for every action.
  await click(screen.getByRole("button", { name: "Close" }));

  expect(lightbox()).toBeNull();
});

test("changing destination closes it", async () => {
  await enterReview();
  await pressKey("Enter");
  expect(lightbox()).not.toBeNull();

  // ADR 0015's rule, and the reason the shell's keyboard handler can stay live
  // underneath: `Ctrl+2` under an open lightbox is not a view swapped out from
  // under a surface walking a list it can no longer see.
  await click(tab("Library"));

  expect(lightbox()).toBeNull();
  expect(viewContainer().hasAttribute("inert")).toBe(false);
});

test("both pages open one, from the same component", async () => {
  await enterLibrary([
    wallpaper(9, { filename: "shared.jpg", status: "kept" }),
  ]);

  await click(cell("shared.jpg, Kept"));

  // The library page's Kept row, in a lightbox that was told nothing about
  // which page opened it: #140's action set comes off the Status, so Review's
  // list of Active rows never offers a Restore without anyone configuring that.
  expect(screen.getByRole("dialog", { name: "shared.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("Kept");
  expect(row().textContent).toContain("1 / 1");
});
