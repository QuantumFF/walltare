import App from "@/App";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
  cacheSize,
  flush,
  mockBootedApp,
  mockListings,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// ADR 0021's lower slot. The report is shell-level and outlives every page, so
// every test here renders the whole app and drives the backend events the way
// the backend emits them.

/** ADR 0009's eight seconds, which the provider applies when nothing overrides it. */
const LIFETIME = 8000;

let scannedPaths: string[];

let frozen = false;

/**
 * Fake the clock for a test that has to watch eight seconds go by.
 *
 * A helper rather than `jest.useFakeTimers()` at the top of each one, because of
 * what has to happen on the way out: this file's pinned toasts are still mounted
 * when a test ends, holding queued timers, and handing the clock back with those
 * pending leaves bun's shim frozen for the next file — where the first `waitFor`
 * then never resolves.
 */
function freezeClock() {
  frozen = true;
  jest.useFakeTimers();
}

afterEach(() => {
  cleanup();
  if (frozen) {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    frozen = false;
  }
});

beforeEach(() => {
  scannedPaths = [];

  // A mid-life library on Round 3, so boot lands on Rank and the Round has
  // somewhere to move back from.
  mockBootedApp();
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockListings({
    review: () => [
      wallpaper(7, { filename: "wall-7.jpg" }),
      wallpaper(8, { filename: "wall-8.jpg" }),
    ],
    library: () => [],
  });
  // Every transition answers with the row it wrote (ADR 0023), and a keep's row
  // differs from the one it read in the `status` column alone.
  mockCommand("keep_wallpaper", (args) =>
    wallpaper(args.id, {
      filename: `wall-${String(args.id)}.jpg`,
      status: "kept",
    }),
  );
  mockCommand("start_scan", (args) => {
    scannedPaths.push(args.path);
    return null;
  });
  // What the Settings page does around the scan it starts: it resolves the path
  // under the field as it is typed, and stores it before the walk begins.
  mockCommand("expand_path", (args) => ({
    resolved: args.input,
    exists: true,
  }));
  mockCommand("set_setting", () => settings());
  // And its Thumbnails section walks the cache directory on mount, for the line
  // that prints the same pass this file's report does (ADR 0020).
  mockCommand("get_cache_size", () => cacheSize());
});

/**
 * The title and description of the one toast that is up, or `null` for none.
 *
 * Read off `data-slot` rather than a role, the way `toasts.test.tsx` does:
 * Radix gives the toast and its own announce region the same `role="status"`,
 * so a role query matches the copy twice and would pass on either.
 */
function toast(): { title: string; description: string | null } | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return {
    title: root.querySelector("[data-slot='toast-title']")?.textContent ?? "",
    description:
      root.querySelector("[data-slot='toast-description']")?.textContent ?? null,
  };
}

const toastNode = () => document.querySelector("[data-slot='toast']");
const toastCount = () => document.querySelectorAll("[data-slot='toast']").length;
/** The report's own bar. Rank's page bar carries one too, and it is not this. */
const bar = () =>
  document.querySelector("[data-slot='toast'] [data-slot='progress']");
const actionButton = () =>
  document.querySelector("[data-slot='toast-action']") as HTMLElement | null;
const closeButton = () =>
  document.querySelector("[data-slot='toast-close']") as HTMLElement | null;

/**
 * The gear, and not the report's own action: both carry the accessible name
 * "Settings", which is the whole point of the action.
 */
const gear = () =>
  document.querySelector(
    '[data-slot="chrome-row"] button[aria-label="Settings"]',
  ) as HTMLElement;

const tab = (name: string) => screen.getByRole("tab", { name });

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

async function emit(name: string, payload: unknown) {
  await act(async () => {
    emitEvent(name, payload);
  });
  await flush();
}

async function runOut(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

async function openApp() {
  render(<App />);
  await flush();
}

/** Start a scan the way the curator does, from the page that holds the button. */
async function scanFrom(path: string) {
  await click(gear());
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("/home/user/wallpapers"), {
      target: { value: path },
    });
  });
  await click(screen.getByRole("button", { name: /^rescan$/i }));
  expect(scannedPaths).toEqual([path]);
}

/** Land on Review and keep wall-7, which is the transition that covers a report. */
async function keepWall7() {
  await click(tab("Review"));
  await click(screen.getByRole("button", { name: /keep wall-7\.jpg/i }));
}

test("a running scan counts up in words, and draws no bar", async () => {
  await openApp();

  await emit("scan-progress", { scanned: 1536, added: 212 });

  // `scan-progress` carries no total, the walk before it emits nothing, and the
  // loop that does emit chunks at 256 inserts — so a real library fires one
  // event, at 100%. A bar drawn for that would be an animation standing in for
  // information the frontend does not have.
  expect(toast()?.title).toBe("Scanning… 1,536 files, 212 new");
  expect(bar()).toBeNull();
});

test("the thumbnail pass draws a determinate bar beside its counts", async () => {
  await openApp();

  await emit("pregen-progress", { done: 240, total: 1204 });

  // The count stays beside the bar, in the words ADR 0020 already prints in the
  // Thumbnails section: one fact, one phrasing, in both places.
  expect(toast()?.title).toBe("Preparing thumbnails… 240 of 1,204");
  expect(bar()?.getAttribute("aria-valuenow")).toBe("20");
});

test("the report's key is the run, so a progress event mutates a mounted toast", async () => {
  await openApp();

  await emit("pregen-progress", { done: 0, total: 1204 });
  const mounted = toastNode();
  expect(mounted).not.toBeNull();

  await emit("pregen-progress", { done: 1, total: 1204 });
  await emit("pregen-progress", { done: 2, total: 1204 });

  // The same node, not an equal one. A key that changed with the payload would
  // remount this toast 1,204 times over a single pass — and it can afford a
  // stable key because a pinned toast holds no countdown for a remount to
  // re-arm, which is exactly ADR 0017's rule inverted (ADR 0021).
  expect(toastNode()).toBe(mounted);
  expect(toast()?.title).toBe("Preparing thumbnails… 2 of 1,204");

  // And the consequence that makes a pinned progress toast tolerable at all:
  // Radix memoises the announced text on the node, so a screen reader hears the
  // first line and none of the updates after it. Read on real timers, inside
  // the second the announce region keeps itself on screen for.
  const announce = screen
    .getAllByRole("status")
    .find((el) => el.textContent?.includes("Preparing thumbnails"));
  expect(announce?.textContent).toContain("Preparing thumbnails… 0 of 1,204");
  expect(announce?.textContent).not.toContain("2 of 1,204");
  // And politely. A launch pass follows no click at all, so the live region
  // waits its turn rather than interrupting what is being read.
  expect(announce?.getAttribute("aria-live")).toBe("polite");
});

test("a transition covers the report for its eight seconds, and then hands it back", async () => {
  freezeClock();
  await openApp();
  await emit("pregen-progress", { done: 12, total: 412 });
  expect(toast()?.title).toBe("Preparing thumbnails… 12 of 412");

  await keepWall7();

  // The curator's own click outranks a machine's progress, and there is still
  // exactly one toast on screen: the surface renders `transient ?? background`
  // rather than stacking them.
  expect(toast()).toEqual({ title: "Kept wall-7.jpg", description: null });
  expect(toastCount()).toBe(1);

  // Background work arriving underneath does not disturb it.
  await emit("pregen-progress", { done: 13, total: 412 });
  expect(toast()?.title).toBe("Kept wall-7.jpg");

  await runOut(LIFETIME);

  // The report was covered rather than replaced, so it is still there when the
  // eight seconds are up — with the progress that arrived while it was hidden.
  expect(toast()?.title).toBe("Preparing thumbnails… 13 of 412");
  expect(toastCount()).toBe(1);

  // And it stays. A pass runs for minutes and the report holds no close timer
  // at all, so nothing but the work ending or the curator closing it takes it
  // off the screen.
  await runOut(LIFETIME * 10);
  expect(toast()?.title).toBe("Preparing thumbnails… 13 of 412");
});

test("closing the report stops it for the run, and a later run reports again", async () => {
  freezeClock();
  await openApp();
  await emit("pregen-progress", { done: 1, total: 100 });

  await click(closeButton()!);
  expect(toast()).toBeNull();

  // "Stop telling me" means for the rest of this pass, not for this event.
  await emit("pregen-progress", { done: 2, total: 100 });
  expect(toast()).toBeNull();

  // And not merely a closed toast. A transition takes the slot and hands it
  // back eight seconds later, which is a fresh mount for whatever is underneath
  // — and what is underneath is a run the curator has finished with.
  await keepWall7();
  expect(toast()?.title).toBe("Kept wall-7.jpg");
  await runOut(LIFETIME);
  expect(toast()).toBeNull();

  await emit("pregen-complete", { generated: 100, failed: 0, cancelled: false });
  await emit("pregen-progress", { done: 1, total: 50 });

  // A different run, and one the curator's own scan or Generate now asked for.
  expect(toast()?.title).toBe("Preparing thumbnails… 1 of 50");
});

test("closing the progress does not suppress the ending", async () => {
  await openApp();
  await emit("scan-progress", { scanned: 40, added: 3 });
  await click(closeButton()!);
  expect(toast()).toBeNull();

  await emit("scan-complete", { added_count: 3, scanned_count: 40 });

  // The ending is news about the library rather than news about the work, and
  // it lands in the upper slot, which nothing dismissed.
  expect(toast()?.title).toBe("3 wallpapers added");
});

test("a scan started on Settings is silent there and reports where the curator goes", async () => {
  await openApp();
  await scanFrom("/library");

  // Settings prints the scan's counter on its own button, and three copies of
  // one number on one screen is not emphasis.
  expect(toast()).toBeNull();

  await click(tab("Rank"));

  // The walk is silent — `collect_images` runs to completion before the first
  // event — so this line can only come from the call that asked for the scan.
  expect(toast()?.title).toBe("Scanning…");
  expect(bar()).toBeNull();

  await emit("scan-progress", { scanned: 1536, added: 212 });
  expect(toast()?.title).toBe("Scanning… 1,536 files, 212 new");
});

// The second suppressed surface is the open lightbox, against the same flag the
// shell puts `inert` on the views with. Its assertion is in
// `lightbox.test.tsx`, beside the surface that raises the flag.
test("the report is suppressed on Settings rather than dismissed by it", async () => {
  await openApp();
  await emit("pregen-progress", { done: 5, total: 10 });
  expect(toast()?.title).toBe("Preparing thumbnails… 5 of 10");

  await click(gear());
  expect(toast()).toBeNull();

  await click(tab("Rank"));
  expect(toast()?.title).toBe("Preparing thumbnails… 5 of 10");
});

test("the report's action opens Settings from where the curator was, and stays up", async () => {
  await openApp();
  await emit("pregen-progress", { done: 5, total: 10 });

  // Named for a reader who cannot tab to it: Radix announces `altText` in place
  // of the label. There is no focus key beside the `returnTo`, and there cannot
  // be one — the field is typed `keyof Settings` and Thumbnails is a section
  // rather than a setting (ADR 0020, ADR 0021).
  expect(actionButton()?.textContent).toBe("Settings");

  await click(actionButton()!);
  expect(showingView()).toBe("settings");

  // The gear closes back to where the action was pressed, which is the whole
  // point of navigating with `returnTo`.
  await click(gear());
  expect(showingView()).toBe("rank");

  // And pressing the action did not mean "stop telling me": the report is where
  // the curator left it.
  expect(toast()?.title).toBe("Preparing thumbnails… 5 of 10");
});

test("a scan that added wallpapers says how many, and explains the Round moving backwards", async () => {
  await openApp();
  await scanFrom("/library");

  // 412 unseen files with no comparisons between them, so the Round the
  // headline shows goes from 3 to 1 (ADR 0008).
  mockCommand("get_stats", () =>
    stats({
      total_wallpapers: 424,
      eligible_count: 422,
      round: 1,
      round_participated_count: 10,
    }),
  );
  await emit("scan-complete", { added_count: 412, scanned_count: 2000 });

  expect(toast()).toEqual({
    title: "412 wallpapers added",
    description: "Back to Round 1. The new wallpapers have no comparisons yet.",
  });
});

test("a scan that added wallpapers to a library already on Round 1 explains nothing", async () => {
  // The other half of the rule, and the reason it is a comparison rather than a
  // sentence attached to the count: a number that did not move needs no excuse.
  mockCommand("get_stats", () =>
    stats({ round: 1, round_participated_count: 10, evaluated_count: 0 }),
  );
  await openApp();
  await scanFrom("/library");

  await emit("scan-complete", { added_count: 6, scanned_count: 18 });

  expect(toast()).toEqual({ title: "6 wallpapers added", description: null });
});

test("a rescan that added nothing is not reported as an empty folder", async () => {
  await openApp();

  await emit("scan-complete", { added_count: 0, scanned_count: 2000 });

  // The common case on every launch after the first, and it says what actually
  // happened rather than borrowing the empty-folder sentence below.
  expect(toast()).toEqual({
    title: "No new wallpapers",
    description: "2,000 files scanned, all already in your library.",
  });
});

test("a walk that turned up nothing at all pins, with the folder as written", async () => {
  freezeClock();
  await openApp();
  await scanFrom("~/Pictures/wallpapers");

  await emit("scan-complete", { added_count: 0, scanned_count: 0 });

  // As written, `~` and all: a mistyped Library root is the thing this message
  // exists to make visible, and expanding it would hide the typo (ADR 0011).
  expect(toast()).toEqual({
    title: "No supported images found",
    description: "~/Pictures/wallpapers",
  });

  await runOut(LIFETIME * 10);
  expect(toast()?.title).toBe("No supported images found");
  expect(closeButton()).not.toBeNull();
});

test("a scan that failed pins the backend's own account of it", async () => {
  freezeClock();
  await openApp();

  await emit("scan-failed", { message: "permission denied: /library/private" });

  expect(toast()).toEqual({
    title: "Couldn't finish the scan",
    description: "permission denied: /library/private",
  });

  await runOut(LIFETIME * 10);
  expect(toast()?.title).toBe("Couldn't finish the scan");
});

test("a pass that lost files says so, and takes its eight seconds", async () => {
  freezeClock();
  await openApp();
  await emit("pregen-progress", { done: 1203, total: 1204 });

  await emit("pregen-complete", { generated: 1201, failed: 3, cancelled: false });

  expect(toast()).toEqual({
    title: "1,201 thumbnails ready, 3 failed",
    description: null,
  });

  await runOut(LIFETIME);
  expect(toast()).toBeNull();
});

test("a pass that finished cleanly says nothing at all", async () => {
  await openApp();
  await emit("pregen-progress", { done: 1203, total: 1204 });
  expect(toast()?.title).toBe("Preparing thumbnails… 1,203 of 1,204");

  await emit("pregen-complete", { generated: 1204, failed: 0, cancelled: false });

  // The row most likely to be implemented as a toast by accident, and it is a
  // decision rather than an omission: nobody acts on "1,204 thumbnails ready",
  // the pass runs on essentially every launch, and a notification whose only
  // content is that a background task stopped is what trains people to dismiss
  // notifications unread. The report going is what says it finished.
  expect(toast()).toBeNull();
  expect(toastCount()).toBe(0);
});

test("a pass the curator cancelled says nothing either", async () => {
  await openApp();
  await emit("pregen-progress", { done: 40, total: 1204 });

  await emit("pregen-complete", { generated: 38, failed: 2, cancelled: true });

  // Even with files it could not read. They pressed the button; the report
  // disappearing is the answer, and a count of what a cancelled pass managed is
  // not something anyone acts on.
  expect(toast()).toBeNull();
});
