import App from "@/App";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { flush, settings, stats, wallpaper } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// The shell owns the navigation, so every test here renders the whole app and
// clicks what the curator clicks. Mounting a view alone would test an
// arrangement the app no longer runs.

const PICK_FEEDBACK_MS = 300;

let getPairCalls = 0;
let getReviewCalls = 0;
let scannedPaths: string[];
let votes: Array<[number, number]>;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  getPairCalls = 0;
  getReviewCalls = 0;
  scannedPaths = [];
  votes = [];

  // A library with wallpapers in it, so boot lands on Rank and every test
  // starts where the curator spends their time.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("get_pair", () => {
    getPairCalls++;
    return [wallpaper(getPairCalls * 2 - 1), wallpaper(getPairCalls * 2)];
  });
  mockCommand("get_review", () => {
    getReviewCalls++;
    return [wallpaper(90, { filename: "lowest.jpg" })];
  });
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

/** Every view container in the tree, in the order the shell renders them. */
function mountedViews(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="view"]'),
  );
}

/**
 * The one view being shown, by name. Throws if the shell is showing none or
 * more than one, which is the failure a hide-and-show swap can produce and a
 * remount cannot.
 */
function showingView(): string {
  const shown = mountedViews().filter((el) => el.style.display !== "none");
  if (shown.length !== 1) {
    throw new Error(
      `${shown.length} views showing, of ${mountedViews().length} mounted`,
    );
  }
  return shown[0].dataset.view ?? "";
}

/** The names of the views that are in the DOM but hidden. */
function hiddenViews(): string[] {
  return mountedViews()
    .filter((el) => el.style.display === "none")
    .map((el) => el.dataset.view ?? "");
}

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

async function pressKey(target: Window | Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(target, { key });
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

test("Library shows an empty state that names the way on", async () => {
  await openApp();
  await click(tab("Library"));

  expect(
    screen.queryByText(/the library page isn't built yet/i),
  ).not.toBeNull();
});

test("a scan still runs end to end from inside Settings", async () => {
  await openApp();
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

  // ScanView still navigates on completion. #110 moves the subscription into
  // the shell and takes that navigation away.
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
