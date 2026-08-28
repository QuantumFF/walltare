import App from "@/App";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  emptyStats,
  flush,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The whole page is a shell interaction: Escape, the back control and the top
// slot are all about where the curator came from and why boot sent them here.
// So every test renders the app and navigates the way a curator does, rather
// than mounting the view against arranged props it never gets in the app.

let statsCalls = 0;

afterEach(cleanup);

beforeEach(() => {
  statsCalls = 0;

  // A library with wallpapers in it, so boot lands on Rank and the curator
  // reaches Settings through the gear — which is what puts a `returnTo` on the
  // navigation. The two tests about a first run and a failed boot override it.
  mockCommand("get_stats", () => {
    statsCalls++;
    return stats();
  });
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_review", () => []);
  mockCommand("list_wallpapers", () => []);
});

const gear = () =>
  screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
const backControl = () => screen.queryByRole("button", { name: /back to/i });
const scanInput = () =>
  screen.getByPlaceholderText("/home/user/wallpapers") as HTMLInputElement;
const sectionHeadings = () =>
  Array.from(document.querySelectorAll('[data-slot="settings-section"] h2')).map(
    (el) => el.textContent,
  );

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function pressEscape(target: Window | Element) {
  await act(async () => {
    fireEvent.keyDown(target, { key: "Escape" });
  });
  await flush();
}

async function openApp() {
  const rendered = render(<App />);
  await flush();
  return rendered;
}

/** Boot on Rank, then reach Settings the way the gear does, from Library. */
async function openSettingsFromLibrary() {
  await openApp();
  await click(screen.getByRole("tab", { name: "Library" }));
  await click(gear());
  expect(showingView()).toBe("settings");
}

test("the page is one column of four sections, in first-run order", async () => {
  await openSettingsFromLibrary();

  expect(sectionHeadings()).toEqual([
    "Library root",
    "Reject destination",
    "Appearance",
    "Thumbnails",
  ]);

  // happy-dom has no layout to measure, so the utility is what there is to
  // assert — and the width is the decision: four groups of one or two controls
  // read as a page at this measure and as a form at full width (ADR 0020).
  const column = document.querySelector('[data-slot="settings-section"]')
    ?.parentElement as HTMLElement;
  expect(column.className).toContain("max-w-2xl");

  // Empty, and staying that way until four tickets fill them one each. What is
  // asserted here is that they are already in the page and already in order, so
  // none of those four has to decide where its section goes.
  for (const section of document.querySelectorAll(
    '[data-slot="settings-section"]',
  )) {
    expect(section.children.length).toBe(1);
  }
});

test("the bar names the page and the way out of it", async () => {
  await openSettingsFromLibrary();

  // Scoped to the Settings container, because the two views the curator passed
  // through on the way here are still mounted with bars of their own.
  const bar = document.querySelector(
    '[data-view="settings"] [data-slot="page-bar"]',
  ) as HTMLElement;
  expect(bar.querySelector("h1")?.textContent).toBe("Settings");

  // The label names where it goes, because the curator came from Library and
  // could have come from either of the other two, and it names the key that
  // does the same thing, because that route is otherwise invisible.
  const back = backControl() as HTMLButtonElement;
  expect(back.textContent).toBe("Back to Library· Esc");
  expect(bar.contains(back)).toBe(true);

  await click(back);
  expect(showingView()).toBe("library");
});

test("Escape closes to where the curator came from", async () => {
  await openSettingsFromLibrary();

  await pressEscape(window);
  expect(showingView()).toBe("library");

  // And from Review, so the exit follows `returnTo` rather than a hardcoded
  // destination that happened to match.
  await click(screen.getByRole("tab", { name: "Review" }));
  await click(gear());
  await pressEscape(window);
  expect(showingView()).toBe("review");
});

test("Escape closes from inside a text field, which is the whole reason the page owns it", async () => {
  await openSettingsFromLibrary();

  // The shell's handler stands down while the caret is in a field — a path may
  // hold a comma, and `?` is a character — so a shell-level Escape would be off
  // in the one place this page is mostly made of. Proved against the shell's own
  // suppression first, so this is about where Escape lives and not about a
  // keystroke that never worked.
  const input = scanInput();
  await act(async () => {
    fireEvent.keyDown(input, { key: ",", ctrlKey: true });
  });
  await flush();
  expect(showingView()).toBe("settings");

  await pressEscape(input);
  expect(showingView()).toBe("library");
});

test("Escape does not close the page out from under the shortcuts dialog", async () => {
  await openSettingsFromLibrary();

  await act(async () => {
    fireEvent.keyDown(window, { key: "?" });
  });
  await flush();
  expect(screen.queryByRole("dialog")).not.toBeNull();

  // Radix dismisses its layer from a capture-phase listener and marks the event,
  // and this page stands down on that mark. One Escape closes one thing.
  await pressEscape(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(showingView()).toBe("settings");
});

test("with no returnTo the back control is absent and Escape does nothing", async () => {
  // Boot landed the curator here, so there is nowhere to go back to and the tabs
  // are the way out of a first run.
  mockCommand("get_stats", () => emptyStats());
  await openApp();
  expect(showingView()).toBe("settings");

  expect(backControl()).toBeNull();

  await pressEscape(window);
  expect(showingView()).toBe("settings");
  await pressEscape(scanInput());
  expect(showingView()).toBe("settings");

  // The tabs still work from here, which is what makes the absent control
  // honest rather than a dead end.
  await click(screen.getByRole("tab", { name: "Library" }));
  expect(showingView()).toBe("library");
});

test("an empty library reads as an invitation", async () => {
  mockCommand("get_stats", () => emptyStats());
  await openApp();

  const block = screen.getByRole("status");
  expect(block.textContent).toContain("No wallpapers yet");
  expect(block.textContent).toContain(
    "Choose a library root and scan it to start ranking.",
  );
  // Not a fault, and nothing offers to retry a read that succeeded.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("a library that would not read reads as a fault, in the backend's own words", async () => {
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "database is locked" }),
  );
  expectConsoleError(/Failed to load library stats/);
  await openApp();
  expect(showingView()).toBe("settings");

  // The two landings must not look alike: a different heading, a different
  // colour, and one of them has a button to press rather than a field to fill.
  const block = screen.getByRole("alert");
  expect(block.textContent).toContain("Couldn't read the library");
  expect(block.textContent).toContain("database is locked");
  expect(block.querySelector("p")?.className).toContain("text-destructive");
  expect(screen.queryByRole("status")).toBeNull();
  expect(block.textContent).not.toContain("No wallpapers yet");

  // And the sections are all still there in the same order underneath, because
  // nothing in this slot is hidden or reordered between its states.
  expect(sectionHeadings()).toEqual([
    "Library root",
    "Reject destination",
    "Appearance",
    "Thumbnails",
  ]);
});

test("Retry re-reads the library, and a read that succeeds clears the block", async () => {
  mockCommand("get_stats", () => {
    statsCalls++;
    return Promise.reject({ kind: "db", message: "database is locked" });
  });
  expectConsoleError(/Failed to load library stats/);
  expectConsoleError(/Retrying the library read failed/);
  await openApp();
  expect(statsCalls).toBe(1);

  // A fault that is still there says so with whatever the backend said this
  // time, rather than leaving the first sentence up.
  mockCommand("get_stats", () => {
    statsCalls++;
    return Promise.reject({ kind: "db", message: "permission denied" });
  });
  await click(screen.getByRole("button", { name: "Retry" }));
  expect(statsCalls).toBe(2);
  expect(screen.getByRole("alert").textContent).toContain("permission denied");

  // The fault is outside the app, so a read that now works is the whole of the
  // fix and the block has nothing left to report.
  mockCommand("get_stats", () => {
    statsCalls++;
    return stats();
  });
  await click(screen.getByRole("button", { name: "Retry" }));
  expect(statsCalls).toBe(3);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

  // The page is still the page: clearing the slot leaves the sections where
  // they were, and the curator on Settings.
  expect(showingView()).toBe("settings");
  expect(sectionHeadings().length).toBe(4);
});

test("neither block is up when boot found a library it could read", async () => {
  await openSettingsFromLibrary();

  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sectionHeadings().length).toBe(4);
});
