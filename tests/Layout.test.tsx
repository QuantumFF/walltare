import App from "@/App";
import type { Settings } from "@/lib/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  deferred,
  emptyStats,
  flush,
  hiddenViews,
  mountedViews,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// The shell owns the navigation, so every test here renders the whole app and
// clicks what the curator clicks. Mounting a view alone would test an
// arrangement the app no longer runs.

const PICK_FEEDBACK_MS = 300;

let getPairCalls = 0;
let getReviewCalls = 0;
let pregenStarts = 0;
let scannedPaths: string[];
let votes: Array<[number, number]>;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  getPairCalls = 0;
  getReviewCalls = 0;
  pregenStarts = 0;
  scannedPaths = [];
  votes = [];

  // A library with wallpapers in it, so boot lands on Rank and every test
  // starts where the curator spends their time.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  // The shell starts pre-generation as soon as it mounts, which is as soon as
  // the boot gate settles, so every render in this file reaches this command.
  mockCommand("start_pregen", () => {
    pregenStarts++;
    return null;
  });
  mockCommand("get_pair", () => {
    getPairCalls++;
    return [wallpaper(getPairCalls * 2 - 1), wallpaper(getPairCalls * 2)];
  });
  mockCommand("get_review", () => {
    getReviewCalls++;
    return [wallpaper(90, { filename: "lowest.jpg" })];
  });
  // Library fetches its rows on the curator's first visit to it, which is what
  // the shell's mount-on-first-visit rule defers it to.
  mockCommand("list_wallpapers", () => [
    wallpaper(90, { filename: "lowest.jpg" }),
    wallpaper(91, { filename: "highest.jpg", comparisons_count: 4 }),
  ]);
  mockCommand("vote", (args) => {
    votes.push([args?.winnerId as number, args?.loserId as number]);
    return { next_pair: [wallpaper(80), wallpaper(81)], stats: stats() };
  });
  mockCommand("start_scan", (args) => {
    scannedPaths.push(args?.path as string);
    return null;
  });
});

const tab = (name: string) =>
  screen.getByRole("tab", { name }) as HTMLButtonElement;
const allTabs = () => screen.getAllByRole("tab") as HTMLButtonElement[];
const gear = () =>
  screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
const chromeRow = () =>
  document.querySelector('[data-slot="chrome-row"]') as HTMLElement;
const scanInput = () => screen.queryByPlaceholderText("/home/user/wallpapers");

/** Which tab carries the active treatment, if any. */
function selectedTab(): string | null {
  const selected = allTabs().find(
    (el) => el.getAttribute("aria-selected") === "true",
  );
  return selected?.textContent ?? null;
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function pressKey(
  target: Window | Element,
  key: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
) {
  await act(async () => {
    fireEvent.keyDown(target, { key, ...modifiers });
  });
  await flush();
}

/** happy-dom never fetches an `<img>`; Rank refuses a pick until both arrive. */
async function panesArrive() {
  for (const side of ["Left", "Right"] as const) {
    const pane = screen.queryByAltText(`${side} Wallpaper`);
    if (!pane) continue;
    await act(async () => {
      fireEvent.load(pane);
    });
  }
}

/** Run out the pick-feedback delay that gates a vote reaching the backend. */
async function advancePickFeedback() {
  await act(async () => {
    jest.advanceTimersByTime(PICK_FEEDBACK_MS);
  });
  await flush();
}

async function openApp() {
  const rendered = render(<App />);
  await flush();
  return rendered;
}

test("clicking a tab changes the view", async () => {
  await openApp();
  expect(showingView()).toBe("rank");
  expect(selectedTab()).toBe("Rank");

  await click(tab("Review"));
  expect(showingView()).toBe("review");
  expect(selectedTab()).toBe("Review");
  expect(screen.queryByAltText("lowest.jpg")).not.toBeNull();

  await click(tab("Library"));
  expect(showingView()).toBe("library");
  expect(selectedTab()).toBe("Library");
});

test("a view switched away from is still in the DOM, and costs nothing to come back to", async () => {
  await openApp();
  expect(getPairCalls).toBe(2); // the shown pair, plus the prefetch slot

  await click(tab("Review"));
  expect(getReviewCalls).toBe(1);

  // The assertion that pins hide-and-show rather than remount: Rank's pair is
  // still rendered, hidden, holding the images the browser already fetched.
  expect(hiddenViews()).toEqual(["rank"]);
  expect(screen.queryByAltText("Left Wallpaper")).not.toBeNull();

  await click(tab("Rank"));
  await click(tab("Review"));
  await click(tab("Rank"));

  // Three switches and not one refetch. Remounting Review is fifty IPC round
  // trips and fifty cache-file reads, which is what this buys back.
  expect(getPairCalls).toBe(2);
  expect(getReviewCalls).toBe(1);
  expect(hiddenViews()).toEqual(["review"]);
});

test("the gear records where the curator was, and closing Settings returns there", async () => {
  await openApp();
  await click(tab("Library"));

  await click(gear());
  expect(showingView()).toBe("settings");
  // Settings hosts the scan screen until #77 replaces it.
  expect(scanInput()).not.toBeNull();
  // No tab is underlined while Settings is up; the gear takes the treatment.
  expect(selectedTab()).toBeNull();
  expect(gear().getAttribute("aria-current")).toBe("page");

  await click(gear());
  expect(showingView()).toBe("library");
  expect(selectedTab()).toBe("Library");
  expect(gear().getAttribute("aria-current")).toBeNull();
  // Settings is the one view that unmounts, so its fields re-read the store on
  // the next visit rather than holding a stale copy.
  expect(scanInput()).toBeNull();
});

test("a tab click out of Settings goes to the tab, not back to where Settings came from", async () => {
  await openApp();
  await click(gear());
  expect(showingView()).toBe("settings");

  await click(tab("Review"));
  expect(showingView()).toBe("review");
  expect(selectedTab()).toBe("Review");
});

test("arrows pressed while Library is showing cast no vote", async () => {
  // The regression a view union invites every time a destination is added:
  // Rank stays mounted under `display: none`, and a `window` listener does not
  // care that nobody can see the pair it is voting on.
  jest.useFakeTimers();
  await openApp();
  await panesArrive();

  // First prove the arrow does work where it belongs, so the assertion below
  // is about the gate rather than about a broken fixture.
  await pressKey(window, "ArrowLeft");
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  // The swapped-in pair has to be visible too, or the vote it would cast is
  // refused for having no images rather than for being on a hidden view, and
  // this test would pass for the wrong reason.
  await panesArrive();

  await click(tab("Library"));
  expect(showingView()).toBe("library");

  await pressKey(window, "ArrowLeft");
  await pressKey(window, "ArrowRight");
  await advancePickFeedback();

  expect(votes).toEqual([[1, 2]]);
});

test("an arrow inside the tab bar walks the tabs and casts no vote", async () => {
  // The other half of the same rule. Here Rank *is* the current view, so the
  // view check cannot help: the tablist answers the key and marks it, and
  // Rank's listener stands down on `defaultPrevented`.
  jest.useFakeTimers();
  await openApp();
  await panesArrive();

  await pressKey(tab("Rank"), "ArrowRight");
  expect(showingView()).toBe("review");
  expect(document.activeElement).toBe(tab("Review"));

  await advancePickFeedback();
  expect(votes).toEqual([]);
});

test("the tab group is a tablist with one Tab stop, wherever the curator is", async () => {
  await openApp();
  expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Views");
  expect(allTabs().map((el) => el.tabIndex)).toEqual([0, -1, -1]);

  await click(tab("Library"));
  expect(allTabs().map((el) => el.tabIndex)).toEqual([-1, -1, 0]);

  await click(gear());
  // Nothing is selected on Settings, so the first tab holds the stop. A group
  // where every tab is -1 cannot be reached from the keyboard at all.
  expect(allTabs().map((el) => el.tabIndex)).toEqual([0, -1, -1]);
});

test("the active tab is underlined by the chrome's own bottom edge", async () => {
  await openApp();

  // happy-dom has no layout to measure, so the utility is what there is to
  // assert — and it is the whole difference between an underline and the
  // inverted chip #44 turned down: navigation should not shout as loudly as a
  // primary button.
  expect(tab("Rank").className).toContain("after:bottom-0");
  expect(tab("Review").className).not.toContain("after:bottom-0");

  await click(tab("Review"));
  expect(tab("Review").className).toContain("after:bottom-0");
  expect(tab("Rank").className).not.toContain("after:bottom-0");
});

test("the chrome row is the same row on every view, and each page carries the bar below it", async () => {
  await openApp();
  const row = chromeRow();
  const shape = row.className;

  for (const name of ["Review", "Library"]) {
    await click(tab(name));
    expect(chromeRow()).toBe(row); // never remounted
    expect(chromeRow().className).toBe(shape); // and never a different height
  }
  await click(gear());
  expect(chromeRow()).toBe(row);
  expect(chromeRow().className).toBe(shape);

  // What lets the chrome hold still: every page owns a bar of its own below it,
  // carrying what would otherwise have to fit in the chrome.
  const views = mountedViews();
  expect(views.map((el) => el.dataset.view)).toEqual([
    "rank",
    "review",
    "library",
    "settings",
  ]);
  expect(
    views.map((el) => el.querySelectorAll('[data-slot="page-bar"]').length),
  ).toEqual([1, 1, 1, 1]);
});

test("Rank's Round headline lives in Rank's own bar", async () => {
  await openApp();

  const bar = mountedViews()[0].querySelector('[data-slot="page-bar"]');
  expect(bar?.textContent).toContain("Round 3");
  expect(bar?.textContent).toContain("2 / 10 Evaluated");
  // And not in the chrome, which would make its height depend on the page.
  expect(chromeRow().textContent).not.toContain("Round");
});

test("Library lists what the backend returned, in the bar and the scroll container #79 fills", async () => {
  await openApp();
  await click(tab("Library"));

  // Interim: the grid, the card and the designed controls are #79's. What has
  // to be here now is the state under them, which is why the rows, the filter
  // and the ordering are assertable at all.
  const rows = document.querySelectorAll("[data-wallpaper-id]");
  expect(Array.from(rows).map((el) => el.textContent)).toEqual([
    "lowest.jpgUnratedActive",
    "highest.jpg25.0Active",
  ]);
  expect(
    (screen.getByLabelText("Filter") as HTMLSelectElement).value,
  ).toBe("all");
  expect(
    (screen.getByLabelText("Order by") as HTMLSelectElement).value,
  ).toBe("score_desc");
});

test("an empty library says so on the page that would have listed it", async () => {
  mockCommand("list_wallpapers", () => []);
  await openApp();
  await click(tab("Library"));

  // ADR 0015 disables no tab, so every destination owes an empty state that
  // says why it is empty and where to go instead.
  expect(screen.queryByText(/nothing here yet/i)).not.toBeNull();
});

test("a scan still runs end to end from inside Settings, and leaves the curator there", async () => {
  await openApp();
  await click(tab("Review"));
  await click(gear());

  const input = scanInput() as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "/tmp/walls" } });
  });
  await click(screen.getByRole("button", { name: /start ranking/i }));
  expect(scannedPaths).toEqual(["/tmp/walls"]);

  await act(async () => {
    emitEvent("scan-complete", { added_count: 4, scanned_count: 9 });
  });
  await flush();

  // The library already had wallpapers, so this is a rescan and it navigates
  // nowhere: a scan takes minutes and finishes wherever the curator has
  // wandered to, which used to be Rank whether they liked it or not.
  expect(showingView()).toBe("settings");
  expect(screen.getByRole("button", { name: /start ranking/i })).not.toBeNull();

  // And the gear still closes back to where Settings was opened from.
  await click(gear());
  expect(showingView()).toBe("review");
});

test("the shell starts pre-generation after boot and again after every scan", async () => {
  // The frontend owns the trigger (ADR 0012) and it fires after the boot gate,
  // so decoding never competes with the first paint. Freshly scanned rows sit
  // at zero comparisons, which is the head of the pass's queue, so the restart
  // after a scan is what warms what the app will show next.
  const held = deferred<Settings>();
  mockCommand("get_settings", () => held.promise);

  render(<App />);
  await flush();

  // The shell is what holds the subscription, and the shell does not mount
  // until the boot reads have settled: that is the gate, spelled out.
  expect(pregenStarts).toBe(0);

  held.resolve(settings());
  await flush();
  expect(pregenStarts).toBe(1);

  for (const added of [4, 0]) {
    await act(async () => {
      emitEvent("scan-complete", { added_count: added, scanned_count: 9 });
    });
    await flush();
  }
  expect(pregenStarts).toBe(3);

  // Switching view does not restart it: the subscription is the shell's, and the
  // shell is mounted once.
  await click(tab("Library"));
  expect(pregenStarts).toBe(3);
});

test("a pre-generation start that fails leaves the app where it booted", async () => {
  // Nothing the curator can see depends on the pass: the views it warms all
  // generate on demand, so a refused start is logged and the boot stands.
  mockCommand("start_pregen", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to start thumbnail pre-generation/);

  await openApp();

  expect(showingView()).toBe("rank");
});

test("a scan that fills an empty library lands on Rank, once", async () => {
  // The boot rule's one rerun, and the only navigation left on `scan-complete`.
  mockCommand("get_stats", () => emptyStats());
  await openApp();
  expect(showingView()).toBe("settings");

  mockCommand("get_stats", () => stats());
  await act(async () => {
    emitEvent("scan-complete", { added_count: 12, scanned_count: 12 });
  });
  await flush();
  expect(showingView()).toBe("rank");

  // Once: the library is not empty any more, so the next scan is a rescan and
  // leaves the curator reading whatever they went to read.
  await click(tab("Library"));
  await act(async () => {
    emitEvent("scan-complete", { added_count: 3, scanned_count: 40 });
  });
  await flush();
  expect(showingView()).toBe("library");
});

test("a first scan that finds nothing leaves an empty library on Settings", async () => {
  // Nothing filled, so nothing to rerun the rule about — and the folder the
  // curator typed is still in the field, ready to be corrected.
  mockCommand("get_stats", () => emptyStats());
  await openApp();

  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 0 });
  });
  await flush();

  expect(showingView()).toBe("settings");

  // And the rerun is still armed, because that scan never filled anything.
  mockCommand("get_stats", () => stats());
  await act(async () => {
    emitEvent("scan-complete", { added_count: 12, scanned_count: 12 });
  });
  await flush();
  expect(showingView()).toBe("rank");
});

test("a first scan that turns up a single wallpaper lands on Library", async () => {
  // The rule reruns rather than a hardcoded "rank": one wallpaper has nothing
  // to be compared against, and Rank would only have an error string for it.
  mockCommand("get_stats", () => emptyStats());
  await openApp();

  mockCommand("get_stats", () =>
    stats({
      total_wallpapers: 1,
      eligible_count: 1,
      round_participated_count: 0,
      evaluated_count: 0,
      total_comparisons: 0,
    }),
  );
  mockCommand("list_wallpapers", () => [wallpaper(1)]);
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 1 });
  });
  await flush();

  expect(showingView()).toBe("library");
});

test("Ctrl+1, Ctrl+2 and Ctrl+3 reach Rank, Review and Library", async () => {
  await openApp();

  await pressKey(window, "2", { ctrlKey: true });
  expect(showingView()).toBe("review");
  expect(selectedTab()).toBe("Review");

  await pressKey(window, "3", { ctrlKey: true });
  expect(showingView()).toBe("library");

  await pressKey(window, "1", { ctrlKey: true });
  expect(showingView()).toBe("rank");

  // The digit alone is not a shortcut: bare keys belong to the view, and Rank
  // is about to want them.
  await pressKey(window, "3");
  expect(showingView()).toBe("rank");
});

test("Ctrl+, opens Settings and records where the curator was", async () => {
  await openApp();
  await click(tab("Library"));

  await pressKey(window, ",", { ctrlKey: true });
  expect(showingView()).toBe("settings");
  expect(selectedTab()).toBeNull();

  // Pressed again it does nothing: the gear is the way out, and #77's Escape
  // will be the other. A binding that both opened and closed would mean two
  // things.
  await pressKey(window, ",", { ctrlKey: true });
  expect(showingView()).toBe("settings");

  await click(gear());
  expect(showingView()).toBe("library");
});

test("a keystroke typed into a text field navigates nowhere", async () => {
  await openApp();
  await click(gear());
  const input = scanInput() as HTMLInputElement;

  // A path may hold a comma, and `?` is a character like any other. Every
  // binding is off while the caret is in a field, which is the whole of the
  // suppression rule.
  for (const key of ["1", "2", "3", ","]) {
    await pressKey(input, key, { ctrlKey: true });
    expect(showingView()).toBe("settings");
  }
  await pressKey(input, "?");
  expect(screen.queryByRole("dialog")).toBeNull();

  // The same keystroke outside the field does navigate, so this test is about
  // the suppression rather than about a shortcut that never worked.
  await pressKey(window, "1", { ctrlKey: true });
  expect(showingView()).toBe("rank");
});

test("? opens a dialog listing every binding the epic defines", async () => {
  await openApp();
  expect(screen.queryByRole("dialog")).toBeNull();

  await pressKey(window, "?");

  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Keyboard shortcuts");

  // Four the shell binds, and four it does not: the arrows are Rank's, F8 is
  // the toast viewport's own hotkey, and Ctrl+Z presses the Undo #112 mounts.
  // A shortcut nobody can find is a shortcut nobody uses.
  const keys = Array.from(dialog.querySelectorAll("kbd")).map(
    (el) => el.textContent,
  );
  expect(keys).toEqual([
    "Ctrl",
    "1",
    "Ctrl",
    "2",
    "Ctrl",
    "3",
    "Ctrl",
    ",",
    "←",
    "→",
    "Ctrl",
    "Z",
    "F8",
    "?",
  ]);
  for (const action of ["Rank", "Review", "Library", "Settings", "Undo"]) {
    expect(dialog.textContent).toContain(action);
  }

  // It is a dialog rather than a page, so it closes and leaves the curator
  // exactly where they were.
  await click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(showingView()).toBe("rank");
});

test("the lightbox's portal node sits above the pages and below where the toast goes", async () => {
  await openApp();

  const host = document.querySelector('[data-slot="lightbox-host"]');
  const container = mountedViews()[0].parentElement as HTMLElement;
  expect(host).not.toBeNull();

  // After the view container, so a lightbox paints over the pages rather than
  // inside one, and last in the shell for now: #112's toast viewport goes after
  // it and takes the top of the stack.
  expect(
    container.compareDocumentPosition(host as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host?.parentElement?.lastElementChild).toBe(host as Element);

  // Nothing has opened one, so nothing behind it is inert yet.
  expect(container.hasAttribute("inert")).toBe(false);
});
