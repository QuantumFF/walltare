import App from "@/App";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  cacheSize,
  deferred,
  flush,
  settings,
  stats,
  wallpaper,
} from "./fixtures";
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

/** The `medium`: the picture this surface exists to show. */
function picture(): HTMLImageElement {
  return document.querySelector(
    '[data-slot="lightbox-picture"]',
  ) as HTMLImageElement;
}

/**
 * The card's `small`, painted behind the `medium` until that one arrives, or
 * `null` once it has.
 */
function placeholder(): HTMLImageElement | null {
  return document.querySelector('[data-slot="lightbox-placeholder"]');
}

/** Every image request the surface has out, in the order they paint. */
function pictures(): string[] {
  return Array.from(screen.getByRole("dialog").querySelectorAll("img")).map(
    (img) => img.getAttribute("src") ?? "",
  );
}

const previous = () =>
  screen.getByRole("button", { name: "Previous wallpaper" });
const next = () => screen.getByRole("button", { name: "Next wallpaper" });

/**
 * What the row offers, as the curator reads it: the label and the key printed
 * beside it, in the order the buttons sit in.
 *
 * The whole set rather than a lookup per button, because "nothing is greyed to
 * hold space" is a statement about what is *not* in the row and only a list can
 * assert it. The label is read off the accessible name, which is the verb
 * alone — the wallpaper is named by the dialog — and the key off the `kbd`
 * beside it.
 */
const actions = () =>
  Array.from(row().querySelectorAll("button")).map((button) =>
    `${button.getAttribute("aria-label")} ${button.querySelector("kbd")?.textContent ?? ""}`.trim(),
  );

/** One of them, by the verb it carries. */
const action = (label: string) => screen.getByRole("button", { name: label });

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

/**
 * A keystroke with Ctrl held, which is the shell's handler's half of the
 * keyboard rather than the lightbox's: the two do not overlap, and this is how
 * a test says so.
 */
async function pressChord(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key,
      ctrlKey: true,
    });
  });
  await flush();
}

/**
 * An image arriving. happy-dom lays nothing out and loads nothing, so it fires
 * no `load` of its own — a test that needs a picture to have arrived has to say
 * so, which is also the only way to reach the frame where one has not.
 */
async function loaded(element: Element) {
  await act(async () => {
    fireEvent.load(element);
  });
  await flush();
}

async function openApp() {
  render(<App />);
  await flush();
}

/**
 * Land on Review with its grid up, and focus the first card the way Tab does.
 *
 * The rows are the two the `beforeEach` arranged unless a test hands over its
 * own; the tests that walk the list want three, so that there is a wallpaper
 * between the two ends.
 */
async function enterReview(rows: Wallpaper[] = reviewRows) {
  reviewRows = rows;
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

/** The two default rows with a third behind them, for the walking tests. */
const threeRows = (): Wallpaper[] => [
  ...reviewRows,
  wallpaper(9, { filename: "third.jpg", path: "/library/third.jpg" }),
];

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

test("the arrow keys walk the list, and the row follows", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");

  // A step is a selection move and nothing else, so what the whole row says
  // moves with it: the name the dialog is announced by, the read-out and the
  // position (ADR 0022).
  await pressKey("ArrowRight");
  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();
  expect(readOut().textContent).toBe("/library/second.jpg");
  expect(row().textContent).toContain("2 / 3");

  await pressKey("ArrowLeft");
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
  expect(readOut().textContent).toBe("/library/first.jpg");
  expect(row().textContent).toContain("1 / 3");
});

test("the ends of the list clamp, and the arrow that would leave it is unavailable", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");

  // The prototype wraps. Reaching the end of a worklist is the moment the
  // sweep is done, and wrapping hides that — at the library's ceiling it means
  // jumping from wallpaper 5,000 to wallpaper 1. Clamping is also what makes
  // the position worth printing, which is why it is asserted here.
  expect(row().textContent).toContain("1 / 3");
  expect(previous().hasAttribute("disabled")).toBe(true);
  expect(next().hasAttribute("disabled")).toBe(false);

  await pressKey("ArrowLeft");
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("1 / 3");

  await pressKey("ArrowRight");
  await pressKey("ArrowRight");
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("3 / 3");
  expect(next().hasAttribute("disabled")).toBe(true);
  expect(previous().hasAttribute("disabled")).toBe(false);

  await pressKey("ArrowRight");
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("3 / 3");
});

test("the arrow buttons make the movement the keys make", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");

  await click(next());
  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();
  await click(next());
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();
  await click(previous());
  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();

  // And a key picks up where the pointer left off, because both are the one
  // selection move rather than two cursors that have to agree.
  await pressKey("ArrowLeft");
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
});

test("a first open paints the card's small behind the medium", async () => {
  await enterReview();
  await pressKey("Enter");

  // Behind, and not beside: the two sit in one grid cell fitted against the
  // same rectangle, and the order they are in the DOM is the order they paint.
  // So what the curator opens onto is a blurry version of the picture they
  // pressed rather than an empty box or a spinner, and it costs no request —
  // the card painted that `small` a moment ago (ADR 0022).
  expect(pictures()).toEqual([
    wallpaperImageUrl(7, "small"),
    wallpaperImageUrl(7, "medium"),
  ]);
  // Announced by nothing. It is the same picture as the `medium` over it, and
  // that one is already named by the filename.
  expect(placeholder()?.getAttribute("alt")).toBe("");

  await loaded(picture());

  expect(placeholder()).toBeNull();
});

test("a step holds the outgoing picture until the next one has loaded", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");
  const element = picture();
  await loaded(element);

  await pressKey("ArrowRight");

  // The same element with a new `src`, which is the whole mechanism: an `<img>`
  // keeps painting the image it has until the new one decodes. A `key` per
  // wallpaper remounts it with nothing painted, which is the prototype's held
  // arrow key strobing to black at a median 376KB a frame.
  expect(picture()).toBe(element);
  expect(picture().getAttribute("src")).toBe(wallpaperImageUrl(8, "medium"));
  // And nothing is standing in front of it. The `small` is for the open where
  // there is no outgoing frame to hold; putting the arriving wallpaper's
  // thumbnail behind the outgoing picture would show around the edges of it.
  expect(placeholder()).toBeNull();
});

test("neither neighbour's medium is requested on a step", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");
  await loaded(picture());

  await pressKey("ArrowRight");

  // One request on the surface, for the wallpaper being looked at. Stepping
  // back is already free under ADR 0016's `max-age=300`, so only the forward
  // edge would ever pay, and a speculative request goes into the one pipeline
  // ADR 0012 gave a dedicated thread to keep clear (ADR 0022).
  expect(pictures()).toEqual([wallpaperImageUrl(8, "medium")]);
});

// The action set, one test per Status. Driven by the wallpaper alone: nothing
// below hands the lightbox an argument about which page it was opened from, and
// there is none to hand it (ADR 0009's transition table, ADR 0022).

test("an Active wallpaper offers Keep and Reject, with the key on each button", async () => {
  await enterReview();
  await pressKey("Enter");

  // Two buttons and no third. Nothing is greyed to hold space: the row's width
  // already changes on every step, because it is measured off a picture, so
  // reserving button space stabilises the wrong axis.
  expect(actions()).toEqual(["Keep K", "Reject Del"]);
});

test("a Kept wallpaper offers Make Active and Reject", async () => {
  await enterLibrary([
    wallpaper(9, { filename: "shared.jpg", status: "kept" }),
  ]);

  await click(cell("shared.jpg, Kept"));

  // **Make Active**, naming the resulting Status rather than coining a noun —
  // not "Un-keep", and not the prototype's "Return to voting", which is wrong
  // against the glossary: a Kept wallpaper already votes, and what un-keeping
  // restores is appearance in Review (ADR 0017, ADR 0019).
  expect(actions()).toEqual(["Make Active K", "Reject Del"]);
});

test("a Rejected wallpaper offers Restore alone", async () => {
  await enterLibrary([
    wallpaper(4, {
      filename: "gone.jpg",
      status: "rejected",
      path: "/library/rejected/gone.jpg",
      origin_path: "/library/gone.jpg",
    }),
  ]);

  await click(cell("gone.jpg, Rejected"));

  // One button, and Review never sees it: that list holds only Active rows, so
  // Restore and Make Active stay off it without anyone configuring that.
  expect(actions()).toEqual(["Restore R"]);
});

// The keys, which are the grid's keys. Each acts on the wallpaper on screen
// rather than the one the lightbox was opened from, and each goes through the
// entry the buttons go through.

test("K keeps the wallpaper on screen", async () => {
  const kept: unknown[] = [];
  mockCommand("keep_wallpaper", (args) => {
    kept.push(args?.id);
    return null;
  });
  await enterReview(threeRows());
  await pressKey("Enter");

  // Stepped first, so what this acts on is what is up rather than what it
  // opened on.
  await pressKey("ArrowRight");
  await pressKey("k");

  expect(kept).toEqual([8]);
  expect(toastTitle()).toBe("Kept second.jpg");
});

test("Delete rejects the wallpaper on screen", async () => {
  const moved: unknown[] = [];
  mockCommand("move_wallpaper", (args) => {
    moved.push(args?.id);
    return "/library/rejected/first.jpg";
  });
  await enterReview();
  await pressKey("Enter");

  // One keypress, no confirm and no modifier. ADR 0009 deleted the confirm
  // dialog and put act-then-undo in its place, which is the toast below and the
  // `Ctrl+Z` that presses it.
  await pressKey("Delete");

  expect(moved).toEqual([7]);
  expect(toastTitle()).toBe("Rejected first.jpg");
});

test("R restores the wallpaper on screen", async () => {
  const restored: unknown[] = [];
  mockCommand("restore_wallpaper", (args) => {
    restored.push(args?.id);
    return "/library/gone.jpg";
  });
  await enterLibrary([
    wallpaper(4, {
      filename: "gone.jpg",
      status: "rejected",
      path: "/library/rejected/gone.jpg",
      origin_path: "/library/gone.jpg",
    }),
  ]);

  await click(cell("gone.jpg, Rejected"));
  await pressKey("r");

  expect(restored).toEqual([4]);
  expect(toastTitle()).toBe("Restored gone.jpg");
});

test("Enter does nothing in here", async () => {
  const kept: unknown[] = [];
  mockCommand("keep_wallpaper", (args) => {
    kept.push(args?.id);
    return null;
  });
  await enterReview();

  await pressKey("Enter");
  await pressKey("Enter");

  // It is the key that opened this, so it gets no binding on the way in. The
  // open lands on the surface rather than on the first button of the row, which
  // is what keeps that true: Radix focuses the first tabbable element, and a
  // lightbox opened to look at a picture would otherwise open with a keep armed
  // under Enter and Space.
  expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
  expect(kept).toEqual([]);
  expect(toastTitle()).toBeNull();
});

// The four rows of ADR 0022's table, which are the issue. Advance, stay and
// close were the three candidates and each is right for exactly one of them, so
// none of the four is a rule in the lightbox: the list changes, the shared
// selection resolves against it, and what is on screen follows.

test("keeping or rejecting in Review advances to the next wallpaper", async () => {
  mockCommand("move_wallpaper", () => "/library/rejected/second.jpg");
  await enterReview(threeRows());
  await pressKey("Enter");

  // The row leaves the list, so the id no longer resolves and the fall back
  // lands on the same position in the shorter list — which is the wallpaper
  // that took its place, and reads as advancing.
  await pressKey("k");
  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("1 / 2");

  await pressKey("Delete");
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("1 / 1");
});

test("rejecting in Library under All keeps the same wallpaper up, with its new actions", async () => {
  mockCommand("move_wallpaper", () => "/library/rejected/one.jpg");
  await enterLibrary([
    wallpaper(11, { filename: "one.jpg", path: "/library/one.jpg" }),
    wallpaper(12, { filename: "two.jpg", path: "/library/two.jpg" }),
  ]);

  await click(cell("one.jpg, Active"));
  await pressKey("Delete");

  // All is the default filter, so the row stays and turns Rejected. The id
  // still resolves, so the same wallpaper is up wearing its new Status and
  // offering what that Status offers. Advancing here would move the curator off
  // the change they just made, which is why "advance always" is wrong.
  expect(screen.getByRole("dialog", { name: "one.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("Rejected");
  expect(row().textContent).toContain("1 / 2");
  expect(actions()).toEqual(["Restore R"]);

  // And it can be pressed, which the list above cannot show. This is the
  // surface that put the bad Restore in front of the curator rather than behind
  // a hover: the reject keeps the same wallpaper up and shows its new action
  // set, and what that set was offering was a Restore that refused itself
  // (#141).
  expect(action("Restore").getAttribute("aria-disabled")).toBeNull();
  // The Origin, which is what this row prints for a Rejected wallpaper and what
  // the Restore beside it acts on. The reject that just ran is where it came
  // from, and a patch carrying only the Status left this line reading the path
  // the file no longer sits at.
  expect(readOut().textContent).toBe("/library/one.jpg");
  expect(readOut().getAttribute("title")).toBe("/library/rejected/one.jpg");
});

test("restoring in the lightbox reaches the backend and puts the row back", async () => {
  const restored: unknown[] = [];
  mockCommand("move_wallpaper", () => "/library/rejected/one.jpg");
  mockCommand("restore_wallpaper", (args) => {
    restored.push(args?.id);
    return "/library/one.jpg";
  });
  await enterLibrary([
    wallpaper(11, { filename: "one.jpg" }),
    wallpaper(12, { filename: "two.jpg" }),
  ]);

  await click(cell("one.jpg, Active"));
  await pressKey("Delete");
  await pressKey("r");

  // Both legs from in here, on one row, with no fetch between them: the reject
  // wrote the Origin the Restore then read, and the Restore wrote the path the
  // row is left on. `R` and the button are one entry, so this is what the button
  // does too (ADR 0019).
  expect(restored).toEqual([11]);
  expect(row().textContent).toContain("Active");
  expect(actions()).toEqual(["Keep K", "Reject Del"]);
  expect(readOut().textContent).toBe("/library/one.jpg");
});

test("undoing a reject from its toast leaves the row where its Restore would", async () => {
  const restored: unknown[] = [];
  mockCommand("move_wallpaper", () => "/library/rejected/one.jpg");
  mockCommand("restore_wallpaper", (args) => {
    restored.push(args?.id);
    return "/library/one.jpg";
  });
  await enterLibrary([wallpaper(11, { filename: "one.jpg" })]);

  await click(cell("one.jpg, Active"));
  await pressKey("Delete");
  expect(toastTitle()).toBe("Rejected one.jpg");

  await pressChord("z");

  // The third route to a Restore, and the furthest from the row it edits: the
  // Undo fires from the shell, over whatever page the curator has wandered to,
  // eight seconds after the reject. It is the same call, so it publishes the
  // same patch and leaves the row in the state the test above leaves it.
  expect(restored).toEqual([11]);
  expect(row().textContent).toContain("Active");
  expect(actions()).toEqual(["Keep K", "Reject Del"]);
  expect(readOut().textContent).toBe("/library/one.jpg");
});

test("rejecting in Library under Active advances", async () => {
  mockCommand("move_wallpaper", () => "/library/rejected/one.jpg");
  await enterLibrary([
    wallpaper(11, { filename: "one.jpg", path: "/library/one.jpg" }),
    wallpaper(12, { filename: "two.jpg", path: "/library/two.jpg" }),
  ]);
  await click(screen.getByRole("button", { name: "Active" }));

  await click(cell("one.jpg, Active"));
  await pressKey("Delete");

  // The same action on the same page, and the other answer, because the list
  // did something else: a Rejected row does not belong in a list of Active
  // ones, so it leaves and this is Review's case again. Nothing chose between
  // the two — "stay always" would be wrong here for the same reason "advance
  // always" is wrong above.
  expect(screen.getByRole("dialog", { name: "two.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("1 / 1");
});

test("acting on the only row closes it onto the page's own empty state", async () => {
  await enterReview([reviewRows[0]]);
  await pressKey("Enter");

  await pressKey("k");

  // The list emptied, so there is no wallpaper left for a second rendering of
  // the selection to render. ADR 0015 already makes every destination own an
  // empty state that names the reason and offers the route out, and a "nothing
  // left" panel inside the lightbox would be that screen with less room.
  expect(lightbox()).toBeNull();
  expect(screen.getByText("No wallpapers to review.")).toBeTruthy();
  // And the shell takes its `inert` back, which is the half of the close that
  // nobody pressed still owes the page behind.
  expect(viewContainer().hasAttribute("inert")).toBe(false);
});

test("the origin-less Restore explains itself and calls nothing", async () => {
  await enterLibrary([
    wallpaper(5, {
      filename: "legacy.jpg",
      status: "rejected",
      path: "/library/rejected/legacy.jpg",
      origin_path: null,
    }),
  ]);
  // No `restore_wallpaper` mock at all: reaching the backend is what this test
  // says must not happen, and an unmocked command rejects into a `console.error`
  // the guard would fail on.

  await click(cell("legacy.jpg, Rejected"));

  // The one control that renders while unavailable, and it renders because it
  // has a sentence to deliver. `aria-disabled` rather than `disabled`, because a
  // disabled button is not focusable and the reason would be unreachable by
  // keyboard and silent to a screen reader (ADR 0019).
  expect(action("Restore").getAttribute("aria-disabled")).toBe("true");
  expect(action("Restore").hasAttribute("disabled")).toBe(false);

  await click(action("Restore"));

  expect(toastTitle()).toBe("Can't restore legacy.jpg");
  expect(
    screen.getByText(
      "Rejected before Restore existed, so nothing recorded where it came from.",
    ),
  ).toBeTruthy();
  // Pinned, which is the close button standing in for the eight-second timer: a
  // refusal is exactly when the curator wants to read the message twice
  // (ADR 0017).
  expect(document.querySelector("[data-slot='toast-close']")).not.toBeNull();

  // And `R` is the same event with the same outcome, because the refusal is a
  // property of the action rather than of the control that was pressed.
  await pressKey("r");
  expect(toastTitle()).toBe("Can't restore legacy.jpg");
});

test("a failed action puts the lightbox back on the wallpaper the toast names", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  const call = deferred<null>();
  mockCommand("keep_wallpaper", () => call.promise);
  await enterReview(threeRows());
  await pressKey("Enter");

  // Review removes the card ahead of the write, so the sweep moves on at once
  // rather than stalling on a file move — and the curator can walk further
  // while the call is still out.
  await pressKey("k");
  expect(screen.getByRole("dialog", { name: "second.jpg" })).toBeTruthy();
  await pressKey("ArrowRight");
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();

  await act(async () => {
    call.reject(new Error("read-only file system"));
  });
  await flush();

  // The card goes back into the list and the selection goes back onto it, so
  // the picture and the message are about one wallpaper. Without that the error
  // would name wallpaper N while the curator looked at wallpaper N+2.
  expect(toastTitle()).toBe("Couldn't keep first.jpg");
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
  expect(row().textContent).toContain("1 / 3");
});

test("Ctrl+Z presses the visible toast's Undo from inside the lightbox", async () => {
  const unkept: unknown[] = [];
  mockCommand("unkeep_wallpaper", (args) => {
    unkept.push(args?.id);
    return null;
  });
  await enterReview(threeRows());
  await pressKey("Enter");
  await pressKey("k");
  expect(toastTitle()).toBe("Kept first.jpg");

  await pressChord("z");

  // The shell's handler is live under an open lightbox. ADR 0022 deleted the
  // clause that suppressed it, whose only effect was disabling Undo in the one
  // place a reject fires from and hiding the shortcut list where it is most
  // wanted — so this works because that handler is running, and not because the
  // lightbox reimplemented it.
  expect(unkept).toEqual([7]);
  expect(toastTitle()).toBe("first.jpg is Active again");
  expect(lightbox()).not.toBeNull();
});

test("? opens the shortcut list from inside, and Escape closes that first", async () => {
  await enterReview();
  await pressKey("Enter");

  await pressKey("?");

  // The other binding the deleted suppression clause used to break, in the one
  // place a curator is most likely to want the list.
  expect(
    screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeTruthy();

  // Two dialogs are layered, which is what `?` working from in here makes
  // possible. Radix's `DismissableLayer` stack gives Escape to the topmost, so
  // the list goes and the picture stays (ADR 0022).
  await pressKey("Escape");
  expect(
    screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeNull();
  expect(screen.getByRole("dialog", { name: "first.jpg" })).toBeTruthy();
});

test("closing after a sweep focuses the card the selection ended on", async () => {
  await enterReview(threeRows());
  await pressKey("Enter");
  await pressKey("ArrowRight");
  await pressKey("ArrowRight");
  expect(screen.getByRole("dialog", { name: "third.jpg" })).toBeTruthy();

  await pressKey("Escape");

  // Radix would focus the card the lightbox was opened from, which after a
  // sweep of two hundred wallpapers is both the wrong card and probably an
  // unmounted one. The card asked for is the one holding the current selection,
  // scrolled into the virtual window and focused after the row commits
  // (ADR 0019, ADR 0022).
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "third.jpg, Active",
  );
});
