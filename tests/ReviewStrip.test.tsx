import type { ReviewLayout, Settings, Wallpaper } from "@/lib/client";
import { fittedBox, ratioOf } from "@/lib/layout-plan";
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
  deferred,
  flush,
  mockBootedApp,
  mockTransitions,
  openApp,
  pointerClick,
  press,
  servingRows,
  settings,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Review's strip, driven through the whole app the way the curator reaches it:
// boot lands on Rank, a tab click opens Review, and the layout is whatever the
// settings table says. The same arrangement `ReviewView.test.tsx` makes, for the
// same reason — every transition here reports itself in the shell's toast slot,
// and the layout control writes a setting the provider above the page holds
// (ADR 0010, ADR 0017).
//
// What is deliberately not asserted here is any size. happy-dom does no layout
// and reports every box as zero, so the hero's box is `layout-plan.test.ts`'s to
// pin; this file is about what the curator can reach and what moves when they
// press something.

/** The worklist Review is serving, which the transition mocks read rows from. */
let reviewed: Wallpaper[];
/** Every `set_setting` the page made, in the order the backend heard them. */
let settingWrites: Array<{ key: string; value: string }>;
/** The settings table as the mocked backend holds it, which every write folds into. */
let stored: Settings;

/** The rows a transition answers with, read off that worklist (ADR 0023). */
const { wrote, rejectedTo } = servingRows(() => reviewed);

const reviewView = () =>
  document.querySelector(
    '[data-slot="view"][data-view="review"]',
  ) as HTMLElement;

/** Queries scoped to the page under test, since the shell keeps Rank mounted. */
const inReview = () => within(reviewView());

const strip = () =>
  reviewView().querySelector(
    '[data-slot="review-strip"]',
  ) as HTMLElement | null;

/**
 * The box the hero's picture is drawn in, as the component sized it.
 *
 * happy-dom lays nothing out, so the area the strip measures never stops being
 * its unmeasured fallback — which is what makes the box a constant here and so
 * assertable. What it cannot say is whether that fallback is a sensible size;
 * the arithmetic over a real area is `layout-plan.test.ts`'s.
 */
const heroBox = () => {
  const node = reviewView().querySelector(
    '[data-slot="hero"]',
  ) as HTMLElement | null;
  if (!node) return null;
  return {
    width: Number.parseFloat(node.style.width),
    height: Number.parseFloat(node.style.height),
  };
};

/** The area the strip falls back to while nothing has measured one. */
const UNMEASURED_AREA = { width: 1216, height: 488 };

/**
 * Assert the hero's box is the one `fittedBox` works out for this shape.
 *
 * Per axis and not by equality, because a `style` attribute round-trips through
 * the browser's own serialisation: `924.4444444444443` comes back
 * `924.444444`.
 */
function expectHeroBox(ratio: number): void {
  const drawn = heroBox();
  const want = fittedBox(UNMEASURED_AREA, ratio);
  expect(drawn?.width).toBeCloseTo(want.width);
  expect(drawn?.height).toBeCloseTo(want.height);
}

/** The Score on the hero row, which is where the strip says Evaluated. */
const heroScore = () =>
  reviewView().querySelector(
    '[data-slot="review-hero-row"] [title$="Evaluated"]',
  );

const heroPicture = () =>
  reviewView().querySelector(
    '[data-slot="hero-picture"]',
  ) as HTMLImageElement | null;

/** Every filmstrip entry, in the order it draws them. */
const entries = () => inReview().queryAllByRole("option");

/** The filmstrip entry marked as the one the hero is showing. */
const marked = () =>
  entries().filter((entry) => entry.getAttribute("aria-selected") === "true");

/** The entry holding focus, by the accessible name it carries. */
const focusedEntry = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ??
  null;

const layoutButton = (name: "Strip" | "Grid") =>
  inReview().getByRole("button", { name }) as HTMLButtonElement;

/** The title of the one toast that is up, or `null` for none. */
function toastTitle(): string | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return root.querySelector("[data-slot='toast-title']")?.textContent ?? "";
}

afterEach(cleanup);

beforeEach(() => {
  reviewed = [];
  settingWrites = [];
  // The strip, which is the layout every test in this file is about. `grid` is
  // the default, so arranging it here is arranging a curator who has already
  // pressed the control once.
  stored = settings({ review_layout: "strip" });

  mockBootedApp();
  // Rank mounts at boot and stays mounted behind this page. Its pair is named
  // apart from anything in the worklist, so a query that reaches past the shown
  // view is a failing test rather than a passing one.
  mockCommand("get_pair", () => [
    wallpaper(101, { filename: "pair-a.jpg" }),
    wallpaper(102, { filename: "pair-b.jpg" }),
  ]);
  mockCommand("expand_path", (args) => ({
    resolved: args.input,
    exists: true,
  }));
  mockCommand("get_settings", () => stored);
  // A backend rather than an echo: the write folds into the table, so the page
  // re-reads what it actually stored.
  mockCommand("set_setting", (args) => {
    settingWrites.push({ key: args.key, value: args.value });
    stored = { ...stored, [args.key]: args.value as ReviewLayout };
    return stored;
  });
  mockTransitions(() => reviewed);
});

/** Mount the app with the given worklist already served, and open Review. */
async function openStrip(list: Wallpaper[]) {
  reviewed = list;
  mockCommand("list_wallpapers", () => list);
  const rendered = await openApp();
  await click(screen.getByRole("tab", { name: "Review" }));
  return rendered;
}

/** Put focus on the filmstrip entry holding the selection, which is where Tab lands. */
async function enterStrip() {
  await act(async () => {
    (
      entries().find(
        (entry) => entry.getAttribute("tabindex") === "0",
      ) as HTMLElement
    ).focus();
  });
}

test("the strip shows one wallpaper and the whole worklist under it", async () => {
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
    wallpaper(7, { filename: "third.webp" }),
  ]);

  // One picture, at the `medium` the lightbox uses: the hero is the wallpaper
  // being judged rather than a thumbnail of it.
  expect(heroPicture()?.src).toBe("wallpaper://localhost/image/3?size=medium");
  expect(heroPicture()?.alt).toBe("first.jpg");

  // And the worklist under it, in the order the backend returned it, so the
  // curator can see what is coming.
  expect(entries().map((entry) => entry.getAttribute("aria-label"))).toEqual([
    "first.jpg",
    "second.png",
    "third.webp",
  ]);
  // The current wallpaper is marked, and only that one.
  expect(marked().map((entry) => entry.getAttribute("aria-label"))).toEqual([
    "first.jpg",
  ]);
});

test("an undersized wallpaper is badged on the hero and still in the worklist (#258)", async () => {
  // The same verdict the grid's cards wear, on the one wallpaper being judged:
  // Review lists undersized wallpapers rather than excluding them, so the hero
  // has to say so.
  stored = settings({
    review_layout: "strip",
    minimum_resolution: { width: 1920, height: 1080 },
  });
  await openStrip([
    wallpaper(1, { filename: "small.jpg", width: 1280, height: 720 }),
    wallpaper(2, { filename: "big.jpg", width: 3840, height: 2160 }),
  ]);

  expect(
    reviewView().querySelector('[data-slot="review-hero-undersized"]')
      ?.textContent,
  ).toBe("Undersized");
  expect(entries()).toHaveLength(2);

  await click(inReview().getByRole("option", { name: "big.jpg" }));

  expect(
    reviewView().querySelector('[data-slot="review-hero-undersized"]'),
  ).toBeNull();
});

test("the hero's Score badge reads against the curator's Evaluated threshold (#260)", async () => {
  // The same comparison the grid's cards make, on the one wallpaper being
  // judged — and the same σ `voting.rs` counts the Rank headline with, so the
  // hero cannot say Evaluated about a wallpaper the headline did not count
  // (ADR 0046).
  stored = settings({ review_layout: "strip", evaluated_threshold: 5 });
  await openStrip([
    wallpaper(1, { filename: "sure.jpg", rating_sigma: 4.5 }),
    wallpaper(2, { filename: "unsure.jpg", rating_sigma: 5.5 }),
  ]);

  expect(heroScore()?.getAttribute("title")).toBe("Evaluated");

  await click(inReview().getByRole("option", { name: "unsure.jpg" }));
  expect(heroScore()?.getAttribute("title")).toBe("Not yet Evaluated");

  // And the same row at Balanced, which is what an untouched table reads as: the
  // wallpaper has not changed, the threshold has.
  cleanup();
  stored = settings({ review_layout: "strip" });
  await openStrip([wallpaper(1, { filename: "sure.jpg", rating_sigma: 4.5 })]);
  expect(heroScore()?.getAttribute("title")).toBe("Not yet Evaluated");
});

/** How tall the filmstrip draws its entries, in pixels, off the one it marks. */
const entryHeight = () => Number.parseFloat(marked()[0]?.style.height ?? "");

test("the hero row puts the crop preview and the decision on buttons that print their keys", async () => {
  await openStrip([wallpaper(1, { filename: "first.jpg" })]);

  const row = reviewView().querySelector(
    '[data-slot="review-hero-row"]',
  ) as HTMLElement;
  expect(row.textContent).toContain("first.jpg");
  // A button rather than a caption naming `C`, and the same key chip the
  // lightbox's and the cards' buttons carry.
  const key = (name: RegExp | string) =>
    within(row).getByRole("button", { name }).querySelector("kbd")?.textContent;
  expect(key(/Crop preview/)).toBe("C");
  expect(key("Keep first.jpg")).toBe("K");
  expect(key("Reject first.jpg")).toBe("Del");
});

test("plus and minus size the filmstrip, clamped at both ends (#264)", async () => {
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
  ]);
  await enterStrip();

  // 128px, three steps above the prototype's 56, until the curator says
  // otherwise.
  expect(entryHeight()).toBe(128);

  await press("+");
  expect(entryHeight()).toBe(160);
  await press("-");
  await press("-");
  expect(entryHeight()).toBe(96);
  // Past the small end is still the small end.
  await press("-");
  expect(entryHeight()).toBe(96);

  for (let at = 0; at < 6; at++) await press("=");
  expect(entryHeight()).toBe(256);

  // Every entry moves together, and the selection stays where it was.
  expect(
    entries().map((entry) => Number.parseFloat(entry.style.height)),
  ).toEqual([256, 256]);
  expect(marked().map((entry) => entry.getAttribute("aria-label"))).toEqual([
    "first.jpg",
  ]);
});

test("Ctrl and the wheel size the filmstrip and not the webview (#264)", async () => {
  await openStrip([wallpaper(3, { filename: "first.jpg" })]);

  // Wheel up is in, towards larger, the same way it runs on the grid. The
  // event is refused, so the webview's own zoom never sees it.
  expect(await ctrlWheel(strip() as HTMLElement, -100)).toBe(false);
  expect(entryHeight()).toBe(160);
  expect(await ctrlWheel(strip() as HTMLElement, 100)).toBe(false);
  expect(entryHeight()).toBe(128);
});

test("clicking a filmstrip entry moves the hero to it", async () => {
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
    wallpaper(7, { filename: "third.webp" }),
  ]);

  await click(inReview().getByRole("option", { name: "third.webp" }));

  expect(heroPicture()?.alt).toBe("third.webp");
  expect(marked().map((entry) => entry.getAttribute("aria-label"))).toEqual([
    "third.webp",
  ]);
});

test("an arrow key moves the hero and the focus with it", async () => {
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
  ]);

  await enterStrip();
  expect(focusedEntry()).toBe("first.jpg");

  // Which way each key moves, and the clamp at the ends, are the keymap's and
  // asserted there once for every surface (#286). What is the strip's own is
  // that the move lands: the hero shows it and the filmstrip's focus follows.
  await press("ArrowRight");
  expect(heroPicture()?.alt).toBe("second.png");
  expect(focusedEntry()).toBe("second.png");
});

test("Keep acts on the wallpaper the hero is showing, from the control", async () => {
  const keptIds: unknown[] = [];
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args.id);
    return wrote(args, { status: "kept" });
  });

  await click(inReview().getByRole("button", { name: "Keep keeper.jpg" }));

  expect(keptIds).toEqual([4]);
  expect(toastTitle()).toBe("Kept keeper.jpg");
  // Acting advances the queue: the row is gone and the hero has moved to what
  // was next, which is the selection rule and not a rule written here.
  expect(heroPicture()?.alt).toBe("next.jpg");
  expect(entries()).toHaveLength(1);
});

test("Reject acts from the control, with no confirm in the way", async () => {
  const moveArgs: unknown[] = [];
  await openStrip([
    wallpaper(6, { filename: "reject-me.jpg" }),
    wallpaper(7, { filename: "next.jpg" }),
  ]);
  mockCommand("move_wallpaper", (args) => {
    moveArgs.push(args);
    return rejectedTo(args, "/library/rejected/reject-me.jpg");
  });

  await click(inReview().getByRole("button", { name: "Reject reject-me.jpg" }));

  // ADR 0017 replaced the confirmation with act-then-undo, so the safety is the
  // toast's Undo and the shell's `Ctrl+Z`, not a dialog in the way.
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(moveArgs).toEqual([{ id: 6, destinationFolder: "./rejected" }]);
  expect(heroPicture()?.alt).toBe("next.jpg");
});

test("K and Delete act on the hero, the same as the controls do", async () => {
  const commands: string[] = [];
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "rejectee.jpg" }),
    wallpaper(6, { filename: "last.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    commands.push(`keep ${args.id}`);
    return wrote(args, { status: "kept" });
  });
  mockCommand("move_wallpaper", (args) => {
    commands.push(`reject ${args.id}`);
    return rejectedTo(args, `/library/rejected/${wrote(args).filename}`);
  });

  await enterStrip();
  await press("k");
  await press("Delete");

  // One vocabulary in the app: the keys resolve through the same keymap the
  // grid reads, so a key and a button cannot come to mean different things
  // (ADR 0019, ADR 0022).
  expect(commands).toEqual(["keep 4", "reject 5"]);
  expect(heroPicture()?.alt).toBe("last.jpg");
  expect(entries()).toHaveLength(1);
});

test("a keep that fails puts the wallpaper back, and the hero with it", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "db", message: "disk on fire" }),
  );

  await enterStrip();
  await press("k");

  // The optimistic removal is undone and the selection follows the wallpaper
  // back, so the picture and the toast are about the same wallpaper (ADR 0022).
  expect(toastTitle()).toBe("Couldn't keep keeper.jpg");
  expect(heroPicture()?.alt).toBe("keeper.jpg");
  expect(entries()).toHaveLength(2);
});

test("the lightbox opens from the strip, on the wallpaper the hero is showing", async () => {
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);

  await enterStrip();
  await press("ArrowRight");
  await press("Enter");

  // A second rendering of the strip's selection rather than a cursor of its own,
  // which is what the shared handle buys: nothing about this surface knows which
  // layout opened it (ADR 0022).
  expect(screen.getByRole("dialog", { name: "next.jpg" })).toBeTruthy();
});

test("a click on the hero opens the lightbox and is not a keep or a reject", async () => {
  await openStrip([wallpaper(4, { filename: "keeper.jpg" })]);

  await click(
    reviewView().querySelector('[data-slot="hero"]') as HTMLElement,
  );

  expect(screen.getByRole("dialog", { name: "keeper.jpg" })).toBeTruthy();
  expect(entries()).toHaveLength(1);
  expect(toastTitle()).toBeNull();
});

test("Enter on a control activates it rather than opening the lightbox", async () => {
  // The press that keeps a wallpaper bubbles through the strip's own handler on
  // its way up, and answering it would be a keep with the lightbox opening over
  // the wallpaper it just removed.
  const keptIds: unknown[] = [];
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args.id);
    return wrote(args, { status: "kept" });
  });

  const keep = inReview().getByRole("button", { name: "Keep keeper.jpg" });
  await act(async () => {
    keep.focus();
  });
  await press("Enter");

  expect(screen.queryByRole("dialog")).toBeNull();
  // `[]` pins the runner rather than the contract: happy-dom performs no button
  // activation, so a real `Enter` on the focused Keep still keeps via click and
  // the guard above is only what keeps the lightbox closed.
  expect(keptIds).toEqual([]);
});

// The control on Review's bar, and the choice it stores.

test("the bar switches between the strip and the grid", async () => {
  await openStrip([wallpaper(4, { filename: "keeper.jpg" })]);

  expect(strip()).not.toBeNull();
  expect(inReview().queryByRole("grid")).toBeNull();
  expect(layoutButton("Strip").getAttribute("aria-pressed")).toBe("true");

  await click(layoutButton("Grid"));

  expect(strip()).toBeNull();
  expect(
    inReview().getByRole("grid", { name: "Wallpapers to review" }),
  ).toBeTruthy();
  expect(layoutButton("Grid").getAttribute("aria-pressed")).toBe("true");
  expect(layoutButton("Strip").getAttribute("aria-pressed")).toBe("false");

  await click(layoutButton("Strip"));

  expect(strip()).not.toBeNull();
  expect(inReview().queryByRole("grid")).toBeNull();
});

test("each layout keeps its own zoom across a switch", async () => {
  // A switch unmounts one surface and mounts the other, so a zoom either held
  // for itself was back at its start every time the curator swapped.
  await openStrip(Array.from({ length: 20 }, (_, i) => wallpaper(i + 1)));
  await enterStrip();
  await press("+");
  expect(entryHeight()).toBe(160);

  await click(layoutButton("Grid"));
  const grid = inReview().getByRole("grid", { name: "Wallpapers to review" });
  await act(async () => {
    (grid.querySelector('[tabindex="0"]') as HTMLElement).focus();
  });
  const start = await cardsInARow();
  await press("-");
  expect(await cardsInARow()).toBe(start + 1);

  await click(layoutButton("Strip"));
  expect(entryHeight()).toBe(160);

  await click(layoutButton("Grid"));
  await act(async () => {
    (
      inReview()
        .getByRole("grid", { name: "Wallpapers to review" })
        .querySelector('[tabindex="0"]') as HTMLElement
    ).focus();
  });
  expect(await cardsInARow()).toBe(start + 1);
});

test("switching the layout with the pointer leaves the arrows on the worklist", async () => {
  // The surface the hand-off first lands in is the one being replaced, so what
  // this pins is the re-landing: the arrows reach whichever shape takes over.
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
  ]);

  // The write answers a turn later, the way the backend does, so the new shape
  // arrives after the commit the press belongs to rather than inside it.
  const write = async (layout: ReviewLayout) => {
    const answer = deferred<Settings>();
    mockCommand("set_setting", () => answer.promise);
    await pointerClick(layoutButton(layout === "grid" ? "Grid" : "Strip"));
    stored = { ...stored, review_layout: layout };
    await act(async () => {
      answer.resolve(stored);
    });
    await flush();
  };

  await write("grid");
  expect(focusedEntry()).toBe("first.jpg, Active");

  await write("strip");
  expect(focusedEntry()).toBe("first.jpg");
  await press("ArrowRight");
  expect(focusedEntry()).toBe("second.png");
});

test("the choice is stored under Review's own key, so a restart keeps it", async () => {
  await openStrip([wallpaper(4, { filename: "keeper.jpg" })]);

  await click(layoutButton("Grid"));

  // Its own key, and the value the backend accepts back. Library's layout is a
  // different row, so a choice made here cannot decide what browsing looks like
  // (#262, #265).
  expect(settingWrites).toEqual([{ key: "review_layout", value: "grid" }]);

  // What a restart reads is the table, so re-booting the app against it is what
  // says the choice survived rather than a claim that it was written.
  cleanup();
  const rebooted = await openApp();
  await click(screen.getByRole("tab", { name: "Review" }));
  expect(strip()).toBeNull();
  expect(
    inReview().getByRole("grid", { name: "Wallpapers to review" }),
  ).toBeTruthy();
  rebooted.unmount();
});

test("Review opens on the grid it has always drawn when nothing has been chosen", async () => {
  // Every new preference has a default that leaves the app as it was, so a
  // curator who never opens the control keeps the page they already had. The
  // strip is one press away and the press is remembered.
  stored = settings();

  await openStrip([wallpaper(4, { filename: "keeper.jpg" })]);

  expect(strip()).toBeNull();
  expect(
    inReview().getByRole("grid", { name: "Wallpapers to review" }),
  ).toBeTruthy();
  expect(settingWrites).toEqual([]);
});

// The hero's box, through the component rather than through the arithmetic.
// `layout-plan.test.ts` pins `fittedBox` itself; what these say is that the
// strip hands it this wallpaper's own Dimensions, the right way round.

test("the hero is drawn at the wallpaper's own shape, not the grid's", async () => {
  // A portrait wallpaper, which is the case the uniform grid could never show:
  // its card crops every wallpaper to 16:9, so a 9:16 phone wallpaper loses its
  // top and bottom. Here the box is tall and narrow.
  await openStrip([
    wallpaper(3, { filename: "portrait.jpg", width: 1080, height: 1920 }),
    wallpaper(1, { filename: "ultrawide.jpg", width: 2560, height: 1080 }),
  ]);

  expectHeroBox(1080 / 1920);
  const portrait = heroBox()!;
  // Taller than it is wide, which is the whole claim and is what a swapped pair
  // of arguments would break.
  expect(portrait.height).toBeGreaterThan(portrait.width);
  // And it fits: the largest size the ratio allows *in the area*.
  expect(portrait.height).toBeLessThanOrEqual(UNMEASURED_AREA.height);
  expect(portrait.width).toBeLessThanOrEqual(UNMEASURED_AREA.width);

  await click(inReview().getByRole("option", { name: "ultrawide.jpg" }));

  expectHeroBox(2560 / 1080);
  const ultrawide = heroBox()!;
  expect(ultrawide.width).toBeGreaterThan(ultrawide.height);
});

test("a wallpaper whose Dimensions nothing has read is drawn at 16:9", async () => {
  // The ordinary state of a library still being backfilled, and the app keeps
  // working rather than waiting for it (CONTEXT.md, ADR 0044).
  await openStrip([
    wallpaper(3, { filename: "unread.jpg", width: null, height: null }),
  ]);

  expectHeroBox(ratioOf(null, null));
  expectHeroBox(16 / 9);
});

test("a filmstrip entry whose file is gone says so, and the hero agrees", async () => {
  // One answer off one request, so no two surfaces can disagree about one
  // wallpaper (ADR 0032). The entry learns it the same way the card does.
  await openStrip([
    wallpaper(3, { filename: "vanished.jpg" }),
    wallpaper(1, { filename: "fine.jpg" }),
  ]);

  const entry = inReview().getByRole("option", { name: "vanished.jpg" });
  await act(async () => {
    fireEvent.error(entry.querySelector("img")!);
    fireEvent.error(heroPicture()!);
  });

  expect(
    inReview().getByRole("option", { name: "vanished.jpg, File is gone" }),
  ).toBeTruthy();
  // One line on the hero, as on the card: the cause is the lightbox's second
  // line, where there is room for it.
  expect(
    reviewView().querySelector('[data-slot="hero-gone"]')?.textContent,
  ).toBe("File is gone");
});

test("closing the lightbox puts focus back on the strip", async () => {
  // ADR 0029's one route in from outside: the lightbox asks the surface for the
  // selection back, and the surface is what knows which entry that is. The
  // request goes through the same handle the grid publishes, so this is the
  // strip answering a call written against a grid (ADR 0022).
  await openStrip([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);

  await enterStrip();
  await press("ArrowRight");
  await press("Enter");
  expect(screen.getByRole("dialog", { name: "next.jpg" })).toBeTruthy();

  await press("Escape");

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(focusedEntry()).toBe("next.jpg");
});

test("Refresh keeps the hero on the same wallpaper and the filmstrip at its size", async () => {
  // The strip's cursor and its filmstrip size are its own state, so a refetch
  // that remounted it would put the curator back at the top of the worklist at
  // 128px. A refetch replaces the rows and leaves the surface alone (#285).
  const worklist = [
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
    wallpaper(7, { filename: "third.webp" }),
  ];
  await openStrip(worklist);
  mockCommand("list_wallpapers", () => worklist.map((row) => ({ ...row })));

  await enterStrip();
  await press("+");
  await press("ArrowRight");
  expect(heroPicture()?.alt).toBe("second.png");
  expect(entryHeight()).toBe(160);

  await click(inReview().getByRole("button", { name: /refresh/i }));

  expect(heroPicture()?.alt).toBe("second.png");
  expect(marked().map((entry) => entry.getAttribute("aria-label"))).toEqual([
    "second.png",
  ]);
  expect(entryHeight()).toBe(160);
});

test("switching layout keeps the curator where they were in the queue", async () => {
  // A fifty-row sweep that lands back at the top is losing your place, which is
  // what the epic means by wanting the selection preserved across a layout
  // change. The cursor is the surface's own and the surface is replaced, so
  // Review hands the wallpaper across (#230, #265).
  await openStrip([
    wallpaper(3, { filename: "first.jpg" }),
    wallpaper(1, { filename: "second.png" }),
    wallpaper(7, { filename: "third.webp" }),
  ]);

  await enterStrip();
  await press("ArrowRight");
  await press("ArrowRight");
  expect(heroPicture()?.alt).toBe("third.webp");

  await click(layoutButton("Grid"));

  expect(
    inReview().getByRole("gridcell", { name: "third.webp, Active" }),
  ).toHaveProperty("tabIndex", 0);

  await click(layoutButton("Strip"));

  expect(heroPicture()?.alt).toBe("third.webp");
});
