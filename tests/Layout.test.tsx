import App from "@/App";
import type { Settings, Wallpaper } from "@/lib/client";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  advancePickFeedback,
  cacheSize,
  click,
  deferred,
  emptyStats,
  flush,
  hiddenViews,
  mockBootedApp,
  mockListings,
  mountedViews,
  openApp,
  panesArrive,
  press,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// The shell owns the navigation, so every test here renders the whole app and
// clicks what the curator clicks. Mounting a view alone would test an
// arrangement the app no longer runs.

let getPairCalls = 0;
let reviewFetches = 0;
/** The worklist Review is serving, which one test below narrows. */
let reviewRows: Wallpaper[];
/** The library the listing page is serving, which two tests below replace. */
let libraryRows: Wallpaper[];
let pregenStarts = 0;
let scannedPaths: string[];
let votes: Array<[number, number]>;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  getPairCalls = 0;
  reviewFetches = 0;
  reviewRows = [wallpaper(90, { filename: "lowest.jpg" })];
  libraryRows = [
    wallpaper(90, { filename: "lowest.jpg" }),
    wallpaper(91, { filename: "highest.jpg", comparisons_count: 4 }),
  ];
  pregenStarts = 0;
  scannedPaths = [];
  votes = [];

  // A library with wallpapers in it, so boot lands on Rank and every test
  // starts where the curator spends their time.
  mockBootedApp();
  // The Library root field resolves what it holds and stores it before a scan,
  // so every visit to Settings in this file reaches these two.
  mockCommand("expand_path", (args) => ({
    resolved: args.input,
    exists: true,
  }));
  mockCommand("set_setting", () => settings());
  // And its Thumbnails section walks the cache directory on mount, for the line
  // it reads out (ADR 0020).
  mockCommand("get_cache_size", () => cacheSize());
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
  // Library fetches its rows on the curator's first visit to it, which is what
  // the shell's mount-on-first-visit rule defers it to. Review asks the same
  // command with a limit.
  mockListings({
    review: () => {
      reviewFetches++;
      return reviewRows;
    },
    library: () => libraryRows,
  });
  mockCommand("vote", (args) => {
    votes.push([args.winnerId, args.loserId]);
    return { next_pair: [wallpaper(80), wallpaper(81)], stats: stats() };
  });
  mockCommand("start_scan", (args) => {
    scannedPaths.push(args.path);
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
  expect(reviewFetches).toBe(1);

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
  expect(reviewFetches).toBe(1);
  expect(hiddenViews()).toEqual(["review"]);
});

test("the gear records where the curator was, and closing Settings returns there", async () => {
  await openApp();
  await click(tab("Library"));

  await click(gear());
  expect(showingView()).toBe("settings");
  // The Library root field, which is this file's proof that the page itself is
  // up rather than only its container.
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
  await press("ArrowLeft", { target: window });
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  // The swapped-in pair has to be visible too, or the vote it would cast is
  // refused for having no images rather than for being on a hidden view, and
  // this test would pass for the wrong reason.
  await panesArrive();

  await click(tab("Library"));
  expect(showingView()).toBe("library");

  await press("ArrowLeft", { target: window });
  await press("ArrowRight", { target: window });
  await advancePickFeedback();

  expect(votes).toEqual([[1, 2]]);
});

test("arrows pressed while Review is showing move the selection and cast no vote", async () => {
  // The same gate, on the view that now answers arrows itself. Review's grid
  // walks its selection with them, so a curator arrowing across a page of cards
  // is holding down the key Rank votes with — and Rank is still mounted behind
  // it under `display: none` (ADR 0015, ADR 0019).
  jest.useFakeTimers();
  reviewRows = [
    wallpaper(90, { filename: "lowest.jpg" }),
    wallpaper(91, { filename: "next.jpg" }),
  ];
  await openApp();
  await panesArrive();

  // First prove the arrow does work where it belongs, so the assertion below is
  // about the gate rather than about a broken fixture.
  await press("ArrowLeft", { target: window });
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);
  await panesArrive();

  await click(tab("Review"));

  // With focus outside the grid nothing answers the key at all, so the view
  // check is the only thing standing between an arrow and a Comparison. That is
  // the half of this the grid's own `preventDefault` cannot cover.
  await press("ArrowLeft", { target: window });
  await advancePickFeedback();
  expect(votes).toEqual([[1, 2]]);

  const first = screen.getAllByRole("gridcell")[0];
  await act(async () => {
    first.focus();
  });

  await press("ArrowRight", { target: first });
  await advancePickFeedback();

  // The key moved the selection and nothing else. A vote here would be a
  // permanent Comparison between two wallpapers the curator cannot see.
  expect(votes).toEqual([[1, 2]]);
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "next.jpg, Active",
  );
});

test("an arrow inside the tab bar walks the tabs and casts no vote", async () => {
  // The other half of the same rule. Here Rank *is* the current view, so the
  // view check cannot help: the tablist answers the key and marks it, and
  // Rank's listener stands down on `defaultPrevented`.
  jest.useFakeTimers();
  await openApp();
  await panesArrive();

  await press("ArrowRight", { target: tab("Rank") });
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

test("Library draws the shared card in the shared grid, under the bar's two controls", async () => {
  await openApp();
  await click(tab("Library"));

  const library = within(
    document.querySelector('[data-view="library"]') as HTMLElement,
  );
  // The grid is one tab stop, so its name is all a screen reader gets on the
  // way in — and it names the library rather than the filter, which is a
  // control the curator can read for themselves (ADR 0019).
  expect(library.getByRole("grid").getAttribute("aria-label")).toBe(
    "Wallpapers in the library",
  );
  // One card per row the fetch returned, in the order it returned them, each
  // naming its filename and its Status.
  expect(
    library.getAllByRole("gridcell").map((el) => el.getAttribute("aria-label")),
  ).toEqual(["lowest.jpg, Active", "highest.jpg, Active"]);
  // And the bar over it, as #130 built it: the four chips in one named group
  // with All the current one, and the ordering opening on Score, high to low —
  // the one view neither Rank nor Review gives (ADR 0014, ADR 0016).
  const bar = within(
    document.querySelector(
      '[data-view="library"] [data-slot="page-bar"]',
    ) as HTMLElement,
  );
  const chips = within(
    bar.getByRole("group", { name: "Filter by Status" }),
  ).getAllByRole("button");
  expect(chips.map((el) => el.textContent)).toEqual([
    "All",
    "Active",
    "Kept",
    "Rejected",
  ]);
  expect(
    bar.getAllByRole("button", { pressed: true }).map((el) => el.textContent),
  ).toEqual(["All"]);
  expect(bar.getByLabelText("Order by").textContent).toBe("Score, high to low");
});

test("an empty library says so on the page that would have listed it", async () => {
  libraryRows = [];
  await openApp();
  await click(tab("Library"));

  // ADR 0015 disables no tab, so every destination owes an empty state that
  // says why it is empty and where to go instead.
  expect(
    screen.queryByText("Nothing has been scanned into the library yet."),
  ).not.toBeNull();

  // And the route out is a real one through the whole shell: the control lands
  // on Settings, where the field it asked for is the one the curator has to
  // fill in (#133, ADR 0020).
  await click(screen.getByRole("button", { name: "Choose a library root" }));

  expect(showingView()).toBe("settings");
  expect(document.activeElement).toBe(scanInput());
});

test("a scan still runs end to end from inside Settings, and leaves the curator there", async () => {
  await openApp();
  await click(tab("Review"));
  await click(gear());

  const input = scanInput() as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "/tmp/walls" } });
  });
  await click(screen.getByRole("button", { name: /^rescan$/i }));
  expect(scannedPaths).toEqual(["/tmp/walls"]);

  await act(async () => {
    emitEvent("scan-complete", { added_count: 4, scanned_count: 9 });
  });
  await flush();

  // The library already had wallpapers, so this is a rescan and it navigates
  // nowhere: a scan takes minutes and finishes wherever the curator has
  // wandered to, which used to be Rank whether they liked it or not.
  expect(showingView()).toBe("settings");
  expect(screen.getByRole("button", { name: /^rescan$/i })).not.toBeNull();

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
  libraryRows = [wallpaper(1)];
  await act(async () => {
    emitEvent("scan-complete", { added_count: 1, scanned_count: 1 });
  });
  await flush();

  expect(showingView()).toBe("library");
});

test("Ctrl+1, Ctrl+2 and Ctrl+3 reach Rank, Review and Library", async () => {
  await openApp();

  await press("2", { target: window, ctrlKey: true });
  expect(showingView()).toBe("review");
  expect(selectedTab()).toBe("Review");

  await press("3", { target: window, ctrlKey: true });
  expect(showingView()).toBe("library");

  await press("1", { target: window, ctrlKey: true });
  expect(showingView()).toBe("rank");

  // The digit alone is not a shortcut: bare keys belong to the view, and Rank
  // is about to want them.
  await press("3", { target: window });
  expect(showingView()).toBe("rank");
});

test("Ctrl+, opens Settings and records where the curator was", async () => {
  await openApp();
  await click(tab("Library"));

  await press(",", { target: window, ctrlKey: true });
  expect(showingView()).toBe("settings");
  expect(selectedTab()).toBeNull();

  // Pressed again it does nothing: the gear and Escape are the ways out. A
  // binding that both opened and closed would mean two things.
  await press(",", { target: window, ctrlKey: true });
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
    await press(key, { target: input, ctrlKey: true });
    expect(showingView()).toBe("settings");
  }
  await press("?", { target: input });
  expect(screen.queryByRole("dialog")).toBeNull();

  // The same keystroke outside the field does navigate, so this test is about
  // the suppression rather than about a shortcut that never worked.
  await press("1", { target: window, ctrlKey: true });
  expect(showingView()).toBe("rank");
});

test("? opens a dialog listing every binding the epic defines", async () => {
  await openApp();
  expect(screen.queryByRole("dialog")).toBeNull();

  await press("?", { target: window });

  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Keyboard shortcuts");

  // Four the shell binds, and the rest it does not: the arrows are Rank's,
  // Escape is the Settings page's own, F8 is the toast viewport's own hotkey,
  // Ctrl+Z presses the Undo #112 mounts, and the nine in the middle are read by
  // the grid container while focus is inside it. A shortcut nobody can find is a
  // shortcut nobody uses, and a listed key nothing reads is worse still — which
  // is what this assertion is for: the list is copy, and copy that drifts from
  // what the app binds is the failure the dialog exists to prevent.
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
    "←",
    "→",
    "↑",
    "↓",
    "Home",
    "End",
    "Enter",
    "K",
    "Delete",
    "R",
    "Esc",
    "Esc",
    "Ctrl",
    "Z",
    "F8",
    "?",
  ]);
  for (const action of ["Rank", "Review", "Library", "Settings", "Undo"]) {
    expect(dialog.textContent).toContain(action);
  }

  // The grid's keys say what they do to the selected wallpaper, and the two the
  // lightbox adds are the two that are its alone: it walks and acts with the
  // grid's own keys, so `Enter` and its Escape are the whole of what it
  // contributes (ADR 0022).
  expect(dialog.textContent).toContain("Keep the selected wallpaper");
  expect(dialog.textContent).toContain("Reject the selected wallpaper");
  expect(dialog.textContent).toContain("Restore the selected wallpaper");
  expect(dialog.textContent).toContain("Open the selected wallpaper");
  expect(dialog.textContent).toContain("Close, back to the grid");

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
  // inside one, and last in the shell root: the toast viewport is rendered
  // outside that root by the surface wrapping it, which is what takes the top
  // of the stack (#112, ADR 0017).
  expect(
    container.compareDocumentPosition(host as Node) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host?.parentElement?.lastElementChild).toBe(host as Element);

  // Nothing has opened one, so nothing behind it is inert. What a page portalled
  // into this node does to that attribute is `lightbox.test.tsx`'s.
  expect(container.hasAttribute("inert")).toBe(false);
});
