import type { AppError, Resolution, SettingKey, Settings, Wallpaper } from "@/lib/client";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  click,
  mockBootedApp,
  mockListings,
  mockTransitions,
  openApp,
  press,
  settings,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The crop preview (#266), driven the way the curator reaches it: render the
// whole app, open the surface, press `C`, and ask what is on screen.
//
// What is deliberately not asserted here is any size. happy-dom does no layout
// and reports every box as zero, so how wide a bar is drawn is arithmetic and
// belongs to `layout-plan.test.ts`. What a view test can see is which edges have
// bars on them, what the caption says, and whether the setting was written — and
// those are the whole of the ticket's acceptance apart from the geometry.

/** The rows Review is serving, set per test. */
let reviewRows: Wallpaper[];
/** The rows the library page is serving, for the lightbox raised from a grid. */
let libraryRows: Wallpaper[];
/** Every `set_setting` the app made, in the order the backend heard them. */
let settingWrites: Array<{ key: string; value: string }>;
/** The settings table as the mocked backend holds it, which every write folds into. */
let stored: Settings;

/**
 * One written value back in the shape a read answers with, which is the inverse
 * of `encodeSetting`.
 *
 * Only the one key this file writes, and the throw is the point: a test that
 * started writing another would say so rather than folding a raw string into
 * the table. Decoding at all rather than answering with the string is what makes
 * the mock a backend — the app reads `crop_preview` as a boolean, and `"false"`
 * is not one. It is a truthy string, so a preview turned off would stay up and
 * this file would pass on a bug (`client.ts`).
 */
function storedAs(key: SettingKey, value: string): Partial<Settings> {
  if (key === "crop_preview") return { crop_preview: value === "true" };
  throw new Error(`this file writes no ${key}`);
}

const reviewView = () =>
  document.querySelector(
    '[data-slot="view"][data-view="review"]',
  ) as HTMLElement;

/** The preview as the curator sees it, or `null` when the bars are down. */
const preview = (within?: HTMLElement) =>
  (within ?? document).querySelector(
    '[data-slot="crop-preview"]',
  ) as HTMLElement | null;

/**
 * Which edges of the picture are dimmed, in a stable order.
 *
 * The one thing about a bar a runner with no layout can see, and the one thing
 * the ticket asks about: a wallpaper wider in ratio than the screen loses its
 * sides, a narrower one its top and bottom, and one that matches loses nothing.
 */
function dimmedEdges(root?: HTMLElement): string[] {
  const node = preview(root);
  if (!node) return [];
  return Array.from(node.querySelectorAll("[data-slot='crop-bar']"))
    .map((bar) => bar.getAttribute("data-edge") ?? "")
    .sort();
}

/** What the caption says, or `null` when there is no preview up. */
function caption(root?: HTMLElement): string | null {
  return (
    preview(root)?.querySelector("[data-slot='crop-caption']")?.textContent ??
    null
  );
}

/** Whether the kept region is outlined, which is the boundary's own marker. */
function outlined(root?: HTMLElement): boolean {
  const kept = preview(root)?.querySelector("[data-slot='crop-kept']");
  return kept?.className.includes("outline-2") ?? false;
}

afterEach(cleanup);

beforeEach(() => {
  reviewRows = [];
  libraryRows = [];
  settingWrites = [];
  // The strip, because that is where the epic offers this first. `grid` is the
  // default, so this is a curator who has already pressed that control once.
  stored = settings({ review_layout: "strip" });

  mockBootedApp();
  mockCommand("get_settings", () => stored);
  // A backend rather than an echo: the write folds into the table and the app
  // re-reads what it actually stored, which is what makes "survives a restart"
  // assertable at all (ADR 0010).
  mockCommand("set_setting", (args) => {
    settingWrites.push({ key: args.key, value: args.value });
    stored = { ...stored, ...storedAs(args.key, args.value) };
    return stored;
  });
  mockCommand("expand_path", (args) => ({
    resolved: args.input,
    exists: true,
  }));
  // Rank mounts at boot and stays mounted behind every page here.
  mockCommand("get_pair", () => [
    wallpaper(101, { filename: "pair-a.jpg" }),
    wallpaper(102, { filename: "pair-b.jpg" }),
  ]);
  mockListings({ review: () => reviewRows, library: () => libraryRows });
  mockTransitions(() => [...reviewRows, ...libraryRows]);
});

/** Mount the app with a worklist served, and open Review's strip. */
async function openStrip(list: Wallpaper[]) {
  reviewRows = list;
  await openApp();
  await click(screen.getByRole("tab", { name: "Review" }));
}

/** Put focus on the filmstrip entry holding the selection, which is where Tab lands. */
async function enterStrip() {
  await act(async () => {
    (
      within(reviewView())
        .queryAllByRole("option")
        .find((entry) => entry.getAttribute("tabindex") === "0") as HTMLElement
    ).focus();
  });
}

/** A 16:9 screen, which the wallpapers below are shaped against. */
const SCREEN: Resolution = { width: 1920, height: 1080 };

test("C turns the crop preview on and off in the Review strip", async () => {
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1, { filename: "wide.jpg" })]);
  await enterStrip();

  expect(preview()).toBeNull();

  await press("c");
  expect(preview()).not.toBeNull();

  // A toggle rather than a hold: the same key puts it away, and nothing was
  // released to make that happen (#266).
  await press("c");
  expect(preview()).toBeNull();
});

test.each(["strip", "lightbox"])(
  "holding C in the %s toggles only once per press",
  async (surface) => {
    await openStrip([wallpaper(1)]);
    await enterStrip();
    if (surface === "lightbox") await press("Enter");

    await press("c");
    await press("c", { repeat: true });
    await press("c", { repeat: true });
    expect(preview()).not.toBeNull();
    expect(settingWrites).toEqual([{ key: "crop_preview", value: "true" }]);

    await press("c");
    await press("c", { repeat: true });
    expect(preview()).toBeNull();
    expect(settingWrites).toEqual([
      { key: "crop_preview", value: "true" },
      { key: "crop_preview", value: "false" },
    ]);
  },
);

test.each(["strip", "lightbox"])(
  "a failed crop setting write in the %s explains the failure without changing the preview",
  async (surface) => {
    await openStrip([wallpaper(1)]);
    await enterStrip();
    if (surface === "lightbox") await press("Enter");
    mockCommand("set_setting", () =>
      Promise.reject({
        kind: "db",
        message: "The settings database is read-only",
      } satisfies AppError),
    );

    await press("c");

    expect(preview()).toBeNull();
    const toast = document.querySelector('[data-slot="toast"]');
    expect(toast?.querySelector('[data-slot="toast-title"]')?.textContent).toBe(
      "Couldn't save the crop preview",
    );
    expect(toast?.querySelector('[data-slot="toast-description"]')?.textContent).toBe(
      "The settings database is read-only",
    );
    expect(stored.crop_preview).toBe(false);
  },
);

test("the preview stays up while the curator arrows through the worklist", async () => {
  // The whole reason it is a toggle. A key held down is a key that cannot
  // arrow, so the bars have to survive a step.
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([
    wallpaper(1, { filename: "first.jpg", width: 3440, height: 1440 }),
    wallpaper(2, { filename: "second.jpg", width: 1600, height: 1200 }),
  ]);
  await enterStrip();

  await press("c");
  expect(dimmedEdges()).toEqual(["left", "right"]);

  await press("ArrowRight");

  // Still up, and now answering about the wallpaper that arrived rather than
  // the one that left.
  expect(dimmedEdges()).toEqual(["bottom", "top"]);
});

test("a wallpaper wider in ratio than the screen shows bars on its sides", async () => {
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1, { width: 3440, height: 1440 })]);
  await enterStrip();

  await press("c");

  expect(dimmedEdges()).toEqual(["left", "right"]);
  // The kept region is outlined, so the boundary between kept and lost is not
  // left to the eye to guess at.
  expect(outlined()).toBe(true);
  // And the caption names the screen and what it costs.
  expect(caption()).toBe("1920 × 1080 · 26% cropped");
});

test("a wallpaper narrower in ratio than the screen shows them top and bottom", async () => {
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1, { width: 1600, height: 1200 })]);
  await enterStrip();

  await press("c");

  expect(dimmedEdges()).toEqual(["bottom", "top"]);
  expect(caption()).toBe("1920 × 1080 · 25% cropped");
});

test("a wallpaper matching the screen's ratio shows no bars", async () => {
  // Two different pairs of numbers for one shape, because that is how a library
  // holds it: a 4K file on a 1080p screen fits exactly, and the app must not
  // draw a hairline bar because two divisions disagreed in their last bit.
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1, { width: 3840, height: 2160 })]);
  await enterStrip();

  await press("c");

  expect(preview()).not.toBeNull();
  expect(dimmedEdges()).toEqual([]);
  // The claim is still made, because "all of it" is an answer: the outline goes
  // round the whole picture and the caption says nothing goes.
  expect(outlined()).toBe(true);
  expect(caption()).toBe("1920 × 1080 · nothing cropped");
});

test("the preview follows the screen setting, including an overridden one", async () => {
  // The curator's own screen rather than the monitor the backend detected,
  // which is the half of CONTEXT.md's Screen that a detected value cannot
  // answer for.
  stored = settings({
    review_layout: "strip",
    screen: { width: 2560, height: 1080 },
  });
  await openStrip([wallpaper(1, { width: 3840, height: 2160 })]);
  await enterStrip();

  await press("c");

  // An ultrawide screen throws away the top and bottom of a 16:9 wallpaper,
  // which is the opposite of what the same file loses on a 16:9 screen.
  expect(dimmedEdges()).toEqual(["bottom", "top"]);
  expect(caption()).toBe("2560 × 1080 · 25% cropped");
});

test("a wallpaper whose Dimensions nothing has read says so rather than guessing", async () => {
  // ADR 0044's rule: a row mid-backfill has no shape, and the 16:9 the layouts
  // fall back to is a guess. So no bars and no outline — but the press is still
  // answered, because a key that appears to do nothing reads as a broken key.
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1, { width: null, height: null })]);
  await enterStrip();

  await press("c");

  expect(dimmedEdges()).toEqual([]);
  expect(outlined()).toBe(false);
  expect(caption()).toBe("1920 × 1080 · dimensions not read yet");
});

test("the toggle is written to the settings store, so it survives a restart", async () => {
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([wallpaper(1)]);
  await enterStrip();

  await press("c");
  await press("c");
  await press("c");

  // Each press writes what the preview now is, and the value is the spelling
  // the column holds — a boolean stringified once, never `1` or `on`.
  expect(settingWrites).toEqual([
    { key: "crop_preview", value: "true" },
    { key: "crop_preview", value: "false" },
    { key: "crop_preview", value: "true" },
  ]);
});

test("a stored preview is up the moment the strip is opened", async () => {
  // The other half of surviving a restart: the app reads the row and draws the
  // bars without the curator pressing anything.
  stored = settings({
    review_layout: "strip",
    screen: SCREEN,
    crop_preview: true,
  });
  await openStrip([wallpaper(1, { width: 3440, height: 1440 })]);

  expect(dimmedEdges()).toEqual(["left", "right"]);
  expect(settingWrites).toEqual([]);
});

test("C does the same in the Lightbox, over the same stored toggle", async () => {
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([
    wallpaper(1, { filename: "wide.jpg", width: 3440, height: 1440 }),
  ]);
  await enterStrip();
  await press("Enter");

  const dialog = screen.getByRole("dialog", { name: "wide.jpg" });
  expect(preview(dialog)).toBeNull();

  await press("c");

  expect(dimmedEdges(dialog)).toEqual(["left", "right"]);
  expect(caption(dialog)).toBe("1920 × 1080 · 26% cropped");
  expect(outlined(dialog)).toBe(true);

  await press("c");
  expect(preview(dialog)).toBeNull();
});

test("the preview raised in the strip is still up in the lightbox over it", async () => {
  // One toggle rather than two that happen to agree: the curator asked a
  // question about their screen, not about a surface.
  stored = settings({ review_layout: "strip", screen: SCREEN });
  await openStrip([
    wallpaper(1, { filename: "wide.jpg", width: 3440, height: 1440 }),
  ]);
  await enterStrip();

  await press("c");
  await press("Enter");

  const dialog = screen.getByRole("dialog", { name: "wide.jpg" });
  expect(dimmedEdges(dialog)).toEqual(["left", "right"]);
});

test("the lightbox answers C from the library page too", async () => {
  // The lightbox is the one surface both pages mount, and it knows nothing
  // about which one opened it (ADR 0022).
  stored = settings({ screen: SCREEN });
  libraryRows = [
    wallpaper(9, { filename: "tall.jpg", width: 1600, height: 1200 }),
  ];
  await openApp();
  await click(screen.getByRole("tab", { name: "Library" }));
  await click(screen.getByRole("gridcell", { name: /tall\.jpg/ }));

  const dialog = screen.getByRole("dialog", { name: "tall.jpg" });
  await press("c");

  expect(dimmedEdges(dialog)).toEqual(["bottom", "top"]);
});

test("nothing changes in the grid layouts", async () => {
  // Bars over thirty thumbnails would be noise rather than an answer, so the
  // grid does not offer them — and the key does nothing there rather than
  // drawing something smaller.
  stored = settings({ review_layout: "grid", crop_preview: true });
  await openStrip([
    wallpaper(1, { filename: "wide.jpg", width: 3440, height: 1440 }),
  ]);

  // The stored toggle is on, and Review is drawing its grid: no bars anywhere.
  expect(preview()).toBeNull();

  await act(async () => {
    (
      within(reviewView())
        .getAllByRole("gridcell")
        .find((cell) => cell.getAttribute("tabindex") === "0") as HTMLElement
    ).focus();
  });
  await press("c");

  expect(preview()).toBeNull();
  // And the press wrote nothing, so a curator sweeping a grid cannot flip a
  // preference they cannot see.
  expect(settingWrites).toEqual([]);
});
