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
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  cacheSize,
  deferred,
  flush,
  mockBootedApp,
  mockTransitions,
  servingRows,
  settings,
  showingView,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Review, driven through the whole app the way the curator reaches it: boot
// lands on Rank and a tab click opens this page. Mounting the view alone stopped
// being the arrangement the app runs when the toast moved into the shell — every
// transition here reports itself there — and the read-out on the bar routes into
// Settings, which is a second thing this file can only assert against the shell
// (ADR 0017, ADR 0018).

/** What `~` expands to in this file, matching `SettingsView.test.tsx`'s. */
const HOME = "/home/curator";

/** Every string the read-out asked `expand_path` about, in order. */
let expansions: string[];
/** The worklist Review is serving, which the transition mocks read rows from. */
let reviewed: Wallpaper[];

/** The rows a transition answers with, read off that worklist (ADR 0023). */
const { wrote, rejectedTo } = servingRows(() => reviewed);

const reviewView = () =>
  document.querySelector(
    '[data-slot="view"][data-view="review"]',
  ) as HTMLElement;

/** Queries scoped to the page under test, since the shell keeps Rank mounted. */
const inReview = () => within(reviewView());

const alerts = () =>
  inReview()
    .queryAllByRole("alert")
    .map((el) => el.textContent);
const images = () => inReview().getAllByRole("img") as HTMLImageElement[];

/**
 * The title and description of the one toast that is up, or `null` for none.
 *
 * Read off `data-slot` rather than a role: Radix gives the toast and its own
 * announce region the same `role="status"`, so a role query matches the copy
 * twice and would pass on either.
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

/** ADR 0018's line on the second bar, whichever of its two shapes is up. */
const destinationLine = () =>
  document.querySelector(
    "[data-slot='reject-destination']",
  ) as HTMLElement | null;

const refreshButton = () =>
  inReview().getByRole("button", { name: /refresh/i }) as HTMLButtonElement;

/**
 * Put focus on the grid's selection, which with nothing arrowed to yet is the
 * first card — the one cell holding the tab stop, and so where Tab lands.
 */
async function enterGrid() {
  await act(async () => {
    inReview().getAllByRole("gridcell")[0].focus();
  });
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });
  await flush();
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

/** The card holding the selection, by the accessible name it carries. */
const selectedCard = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ??
  null;

afterEach(cleanup);

beforeEach(() => {
  expansions = [];
  reviewed = [];

  // A library with wallpapers in it, so boot lands on Rank and Review is
  // reached the way the curator reaches it.
  mockBootedApp();
  // Rank mounts at boot and stays mounted behind this page. Its pair is named
  // apart from anything in the review list, so a query that reaches past the
  // shown view is a failing test rather than a passing one.
  mockCommand("get_pair", () => [
    wallpaper(101, { filename: "pair-a.jpg" }),
    wallpaper(102, { filename: "pair-b.jpg" }),
  ]);
  // The read-out resolves the stored destination, because whether it is
  // relative cannot be read off the string (ADR 0018).
  mockCommand("expand_path", (args) => {
    const input = args.input;
    expansions.push(input);
    return { resolved: input.replace(/^~/, HOME), exists: true };
  });
  // Every transition answers with the row it wrote, off the worklist the test
  // arranged (ADR 0023). The tests below override the one they are about.
  mockTransitions(() => reviewed);
});

/** Render the app and land on Review, which is what a tab click does. */
async function openApp() {
  const rendered = render(<App />);
  await flush();
  await click(screen.getByRole("tab", { name: "Review" }));
  return rendered;
}

/** Mount the app with the given list already served, and open Review. */
async function openReview(list: Wallpaper[], stored: Partial<Settings> = {}) {
  reviewed = list;
  mockCommand("list_wallpapers", () => list);
  mockCommand("get_settings", () => settings(stored));
  return openApp();
}

test("renders the rows the backend returned, in the order it returned them", async () => {
  // Deliberately not sorted: ordering and the Active-only filter belong to
  // db.rs (`the_review_listing_is_active_lowest_score_first_with_the_unrated_tail`).
  // This view is
  // a bare map, and the test says so.
  // Each one past a Comparison, so the badge is a Score rather than the
  // `Unrated` a wallpaper the app knows nothing about reads (ADR 0013).
  await openReview([
    wallpaper(3, { filename: "lowest.jpg", rating_mu: 8.24, comparisons_count: 4 }),
    wallpaper(1, { filename: "middle.png", rating_mu: 25.0, comparisons_count: 4 }),
    wallpaper(7, {
      filename: "highest.webp",
      rating_mu: 15.55,
      comparisons_count: 4,
    }),
  ]);

  expect(images().map((img) => img.src)).toEqual([
    "wallpaper://localhost/image/3?size=small",
    "wallpaper://localhost/image/1?size=small",
    "wallpaper://localhost/image/7?size=small",
  ]);
  expect(images().map((img) => img.alt)).toEqual([
    "lowest.jpg",
    "middle.png",
    "highest.webp",
  ]);

  // One mu badge per row, rounded to a single decimal.
  const badges = inReview().getAllByText(/^\d+\.\d$/);
  expect(badges.map((badge) => badge.textContent)).toEqual([
    "8.2",
    "25.0",
    "15.6",
  ]);
});

test("a card changes no shadow on hover, so a wheel scroll stays smooth", async () => {
  // Not a style preference. A wheel scroll holds the pointer still while cards
  // stream under it, so every card that passes fires :hover, and a box-shadow
  // change there repaints outside the card's own bounds. Measured in a real
  // WebKitGTK view it took the grid from a locked 60fps to 38 with every frame
  // late — the wheel felt worse than the scrollbar, which never moves the
  // pointer across the grid. Removing only the transition still dropped half
  // the frames, so the repaint is the cost, not the animation.
  //
  // happy-dom has no compositor, so the frame times cannot be asserted here;
  // this pins the decision at the only seam that exists. See ADR 0006.
  await openReview([wallpaper(1), wallpaper(2)]);

  const cards = images().map((img) => img.closest("div.group"));
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    const classes = card?.className ?? "";
    expect(classes).toContain("group");
    expect(classes).not.toMatch(/hover:shadow/);
  }
});

test("the two hover-animated elements declare will-change, so no card promotes mid-scroll", async () => {
  // Also not a style preference. WebKit builds the composited layer an
  // animated property needs the first time it is animated, which for these
  // cards means the first time each one is hovered — and a wheel scroll hovers
  // every card that passes under the still pointer. Measured in a real
  // WebKitGTK view, one wheel pass down the grid cost 12 stalls of 50-58ms and
  // 24 dropped frames on a cold process, then nothing on later passes, because
  // the layers survive. That is the "lags for a bit then goes back to normal"
  // report. Declaring will-change moves the promotion to first paint: the same
  // pass measured 0 stalls three runs out of three, with no measurable cost to
  // entering the view or to resident memory.
  //
  // happy-dom has no compositor, so the frame times cannot be asserted here;
  // this pins the decision at the only seam that exists. See ADR 0007.
  await openReview([wallpaper(1), wallpaper(2)]);

  const cards = images().map((img) => img.closest("div.group"));
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    // The image scales on hover; the overlay fades in.
    expect(card?.querySelector("img")?.className ?? "").toContain(
      "will-change-transform",
    );
    const overlay = card?.querySelector(".absolute.inset-0");
    expect(overlay?.className ?? "").toContain("will-change-[opacity]");
  }
});

test("asks the listing for the 50 Active wallpapers with the lowest Scores", async () => {
  // Review has no command of its own: it is the one listing, filtered to
  // Active, ordered lowest Score first, and bounded to a worklist (ADR 0028).
  const calls: unknown[] = [];
  mockCommand("list_wallpapers", (args) => {
    calls.push(args);
    return [];
  });

  await openApp();

  expect(calls).toEqual([
    { filter: "active", ordering: "score_asc", limit: 50 },
  ]);
});

test("keep records the decision and removes the card without waiting for a refetch", async () => {
  const keptIds: unknown[] = [];
  const pending = deferred<Wallpaper>();
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "stay.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args.id);
    return pending.promise;
  });

  await click(inReview().getByRole("button", { name: /keep keeper\.jpg/i }));

  // Gone while the command is still in flight.
  expect(keptIds).toEqual([4]);
  expect(inReview().queryByAltText("keeper.jpg")).toBeNull();
  expect(inReview().queryByAltText("stay.jpg")).not.toBeNull();

  await act(async () => {
    pending.resolve(wallpaper(4, { filename: "keeper.jpg", status: "kept" }));
  });
  expect(alerts()).toEqual([]);
});

test("refresh renders whatever the backend returns next", async () => {
  let fetches = 0;
  const responses = [
    [wallpaper(4, { filename: "keeper.jpg" })],
    [wallpaper(9, { filename: "fresh.jpg" })],
  ];
  mockCommand("list_wallpapers", () => responses[Math.min(fetches++, 1)]);

  await openApp();
  expect(fetches).toBe(1);
  expect(inReview().queryByAltText("keeper.jpg")).not.toBeNull();

  await click(refreshButton());

  expect(fetches).toBe(2);
  expect(images().map((img) => img.alt)).toEqual(["fresh.jpg"]);
});

test("a keep that fails puts the card back and says so", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([wallpaper(4, { filename: "keeper.jpg" })]);
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "db", message: "disk on fire" }),
  );

  await click(inReview().getByRole("button", { name: /keep keeper\.jpg/i }));

  // The generic "Please try again." is gone with the paragraph that carried it:
  // the title is the frontend's and the detail is the backend's own account.
  // Nothing in this view has held an error since the toast took them (ADR 0017),
  // and the empty `alerts()` below is what says so.
  expect(toast()).toEqual({
    title: "Couldn't keep keeper.jpg",
    description: "disk on fire",
  });
  expect(alerts()).toEqual([]);
  expect(inReview().queryByAltText("keeper.jpg")).not.toBeNull();
});

test("a keep that fails does not resurrect a card kept while it was in flight", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([
    wallpaper(1, { filename: "doomed.jpg" }),
    wallpaper(2, { filename: "goes-fine.jpg" }),
    wallpaper(3, { filename: "untouched.jpg" }),
  ]);

  // The first keep is still in flight when the second one succeeds. Rolling
  // the first one back by restoring a whole list snapshot would put the
  // second card back too, undoing a decision that actually persisted.
  const doomed = deferred<Wallpaper>();
  mockCommand("keep_wallpaper", (args) =>
    args.id === 1 ? doomed.promise : wrote(args, { status: "kept" }),
  );

  await click(inReview().getByRole("button", { name: /keep doomed\.jpg/i }));
  await click(inReview().getByRole("button", { name: /keep goes-fine\.jpg/i }));
  await act(async () => {
    doomed.reject({ kind: "db", message: "disk on fire" });
    await flush();
  });

  expect(toast()?.title).toBe("Couldn't keep doomed.jpg");
  expect(images().map((img) => img.alt)).toEqual([
    "doomed.jpg",
    "untouched.jpg",
  ]);
});

test("a move that fails puts the card back and says so", async () => {
  expectConsoleError(/Failed to move wallpaper/);
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })]);
  mockCommand("move_wallpaper", () =>
    Promise.reject({ kind: "io", message: "destination is read-only" }),
  );

  await click(
    inReview().getByRole("button", { name: /reject reject-me\.jpg/i }),
  );

  expect(toast()).toEqual({
    title: "Couldn't reject reject-me.jpg",
    description: "destination is read-only",
  });
  expect(inReview().queryByAltText("reject-me.jpg")).not.toBeNull();
});

test("a successful fetch does not clear the previous failure", async () => {
  expectConsoleError(/Failed to fetch review list/);
  let broken = true;
  mockCommand("list_wallpapers", () =>
    broken
      ? Promise.reject({ kind: "db", message: "locked database" })
      : [wallpaper(2, { filename: "a.jpg" })],
  );

  await openApp();
  expect(toast()?.title).toBe("Couldn't load the review list");

  broken = false;
  await click(refreshButton());

  // The inverse of what the paragraph did, and deliberately. An error is pinned
  // and gets no exception to the replacement rule: the only things that take it
  // down are the curator closing it or the next action overwriting it, because
  // either one is a signal they have read it (ADR 0017). A fetch that quietly
  // wiped it would be the eight-second error this surface exists to avoid,
  // arriving by a side door.
  expect(toast()?.title).toBe("Couldn't load the review list");
  expect(inReview().queryByAltText("a.jpg")).not.toBeNull();
});

test("a successful keep replaces the previous failure", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "stay.jpg" }),
  ]);
  let broken = true;
  mockCommand("keep_wallpaper", (args) =>
    broken
      ? Promise.reject({ kind: "db", message: "disk on fire" })
      : wrote(args, { status: "kept" }),
  );

  await click(inReview().getByRole("button", { name: /keep keeper\.jpg/i }));
  expect(toast()?.title).toBe("Couldn't keep keeper.jpg");

  broken = false;
  await click(inReview().getByRole("button", { name: /keep stay\.jpg/i }));

  // One slot, and the newest message owns it. The failed card stays in the grid
  // as the durable evidence the toast no longer carries.
  expect(toast()?.title).toBe("Kept stay.jpg");
  expect(inReview().queryByAltText("keeper.jpg")).not.toBeNull();
});

test("the list can't be refetched while a fetch is in flight", async () => {
  const first = deferred<Wallpaper[]>();
  const second = deferred<Wallpaper[]>();
  const responses = [first.promise, second.promise];
  let fetches = 0;
  mockCommand("list_wallpapers", () => responses[fetches++]);

  await openApp();

  // While loading the body is a spinner and Refresh is disabled. The control
  // lives in the bar this page owns below the chrome, which holds its height in
  // every state, so `disabled` is what keeps a second fetch out rather than the
  // button being absent.
  expect(reviewView().querySelector(".animate-spin")).not.toBeNull();
  expect(refreshButton().disabled).toBe(true);

  await act(async () => {
    first.resolve([wallpaper(2, { filename: "a.jpg" })]);
  });
  expect(refreshButton().disabled).toBe(false);
  await click(refreshButton());

  expect(fetches).toBe(2);
  expect(refreshButton().disabled).toBe(true);
  expect(inReview().queryByAltText("a.jpg")).toBeNull();

  await act(async () => {
    second.resolve([]);
  });
  expect(inReview().queryByText(/no wallpapers to review\./i)).not.toBeNull();
  expect(fetches).toBe(2);
});

test("a reject asks nothing and soft-rejects to the stored destination", async () => {
  const moveArgs: unknown[] = [];
  // Not the default, so what reaches `move_wallpaper` can only have come from
  // the settings object the bar reads (ADR 0018).
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })], {
    reject_destination: "~/bin",
  });
  // The command answers with the path the file landed at; the toast is what
  // reports it, and a card that leaves the list is what this test is about.
  mockCommand("move_wallpaper", (args) => {
    moveArgs.push(args);
    return rejectedTo(args, `${HOME}/bin/reject-me.jpg`);
  });

  await click(
    inReview().getByRole("button", { name: /reject reject-me\.jpg/i }),
  );

  // Nothing between the press and the move. Act-then-undo replaced the confirm
  // dialog that used to stand here: the toast offers an Undo and the shell's
  // `Ctrl+Z` presses it, so one interruption per reject is enough (ADR 0009,
  // ADR 0017).
  expect(screen.queryByRole("alertdialog")).toBeNull();
  // The Written path as stored, not the resolved one: `expand_path` is asked
  // whether the destination is relative, and never asked to rewrite it.
  expect(moveArgs).toEqual([{ id: 6, destinationFolder: "~/bin" }]);
  expect(inReview().queryByAltText("reject-me.jpg")).toBeNull();
  expect(inReview().queryByText(/no wallpapers to review\./i)).not.toBeNull();
});

test("the destination is a read-out and no longer a field", async () => {
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })]);

  // ADR 0018 took the editor out of Review: a control under fifty cards that
  // may have come from fifty folders looked like it belonged to the pass, while
  // it actually wrote a global preference. Settings owns the only one.
  expect(inReview().queryByLabelText(/move to:/i)).toBeNull();
  expect(reviewView().querySelector("input")).toBeNull();
  expect(destinationLine()).not.toBeNull();
});

test("the bar says where rejects go, in the string the curator wrote", async () => {
  await openReview([wallpaper(6)], { reject_destination: "~/bin" });

  // The written string and not the resolved one. ADR 0011 put the resolved-path
  // preview on the Settings field, so `~/bin` stays `~/bin` here rather than
  // repeating `${HOME}/bin` on two more bars.
  expect(destinationLine()?.textContent).toBe(
    "Rejects go to ~/bin · change in Settings",
  );
  expect(destinationLine()?.textContent).not.toContain(HOME);
  expect(destinationLine()?.className).not.toContain("text-destructive");
});

test("a relative destination gets the clause that says what relative means", async () => {
  await openReview([wallpaper(6)]);

  // The default, and the part that earns the line its place: relative resolves
  // against each wallpaper's own folder, so a nested library gets one reject
  // folder per source folder (CONTEXT.md, ADR 0011, ADR 0018).
  expect(destinationLine()?.textContent).toBe(
    "Rejects go to ./rejected, beside each wallpaper · change in Settings",
  );
});

test("whether the destination is relative is not read off the string", async () => {
  // `$HOME/bin` looks relative and expands absolute, which is why the clause
  // waits on `expand_path` rather than on a leading character (ADR 0018).
  mockCommand("expand_path", (args) => {
    const input = args.input;
    expansions.push(input);
    return { resolved: input.replace(/^\$HOME/, HOME), exists: true };
  });
  await openReview([wallpaper(6)], { reject_destination: "$HOME/bin" });

  expect(destinationLine()?.textContent).toBe(
    "Rejects go to $HOME/bin · change in Settings",
  );
});

test("a malformed destination is on the bar before the first click", async () => {
  mockCommand("expand_path", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await openReview([wallpaper(6)], { reject_destination: "$HOEM/rejected" });

  // The message replaces the whole line, in the destructive colour. It fails
  // every reject in the pass, so there is no destination left to describe, and
  // reading the variable's name here beats fifty identical failures after the
  // fact (ADR 0011, ADR 0018).
  expect(destinationLine()?.textContent).toBe(
    "unknown environment variable HOEM",
  );
  expect(destinationLine()?.className).toContain("text-destructive");
  expect(
    inReview().queryByRole("button", { name: "change in Settings" }),
  ).toBeNull();
});

test("the destination is resolved once per value, not once per render", async () => {
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "stay.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => wrote(args, { status: "kept" }));

  // Three rounds of renders that have nothing to do with the setting: a card
  // leaving the list, a toast arriving over it, and a refetch replacing the
  // whole grid. The read-out is memoised on the string, so none of them is a
  // new question for the backend (ADR 0018, ADR 0020).
  await click(inReview().getByRole("button", { name: /keep keeper\.jpg/i }));
  await click(refreshButton());

  expect(expansions).toEqual(["./rejected"]);
});

test("change in Settings opens the field the line is about", async () => {
  mockCommand("get_cache_size", () => cacheSize());
  await openReview([wallpaper(6)]);

  await click(
    inReview().getByRole("button", { name: "change in Settings" }) as HTMLElement,
  );

  // The words are a control rather than text: naming a destination that is one
  // click away and leaving it inert is a small cruelty (ADR 0018). What lands is
  // ADR 0020's arrival — the caret in the field, and a way back to the page the
  // curator was rejecting from.
  expect(showingView()).toBe("settings");
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Reject destination",
  );
  expect(
    screen.getByRole("button", { name: /back to/i }).textContent,
  ).toBe("Back to Review· Esc");
});

test("the empty state offers a way back to ranking", async () => {
  await openReview([]);

  expect(inReview().queryByText(/no wallpapers to review\./i)).not.toBeNull();
  await click(inReview().getByRole("button", { name: /return to ranking/i }));

  expect(showingView()).toBe("rank");
});

test("back returns to ranking", async () => {
  await openReview([wallpaper(2, { filename: "a.jpg" })]);

  await click(inReview().getByRole("button", { name: /^back$/i }));

  expect(showingView()).toBe("rank");
});

test("a load failure surfaces readably instead of console-only", async () => {
  expectConsoleError(/Failed to fetch review list/);
  mockCommand("list_wallpapers", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );

  await openApp();

  // On the shell's surface now, not in a paragraph of this view's own. Two
  // error surfaces in one view is what ADR 0017 removed, and a list that will
  // not load was the paragraph's last tenant.
  expect(toast()).toEqual({
    title: "Couldn't load the review list",
    description: "locked database",
  });
  expect(alerts()).toEqual([]);
});

// What the reject toast has left to say, which is decided by the same boolean
// the read-out above draws its clause from: name the path whenever the bar could
// not (ADR 0017 as amended by ADR 0018).

test("a reject into a relative destination names the path the file landed at", async () => {
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })]);
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, "/library/holiday/rejected/reject-me.jpg"),
  );

  await click(
    inReview().getByRole("button", { name: /reject reject-me\.jpg/i }),
  );

  // `./rejected` states a rule and not a place, and in a nested library the
  // file lands in one of many `rejected/` folders with nothing else on screen
  // saying which one took it.
  expect(toast()).toEqual({
    title: "Rejected reject-me.jpg",
    description: "/library/holiday/rejected/reject-me.jpg",
  });
});

test("a reject into an absolute destination repeats nothing the bar said", async () => {
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })], {
    reject_destination: "~/bin",
  });
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, `${HOME}/bin/reject-me.jpg`),
  );

  await click(
    inReview().getByRole("button", { name: /reject reject-me\.jpg/i }),
  );

  // The bar named the exact folder two inches away, and the file kept its name,
  // so there is nothing the path line could add to a fast pass.
  expect(toast()).toEqual({
    title: "Rejected reject-me.jpg",
    description: null,
  });
});

test("a rename is named wherever the destination pointed", async () => {
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })], {
    reject_destination: "~/bin",
  });
  // `unique_destination` suffixes ` (1)` rather than overwriting what is
  // already sitting there (ADR 0003), and the returned basename is the only
  // account of it — no flag rides along, because the frontend holds the
  // wallpaper's own filename to compare against (ADR 0018).
  mockCommand("move_wallpaper", (args) =>
    rejectedTo(args, `${HOME}/bin/reject-me (1).jpg`),
  );

  await click(
    inReview().getByRole("button", { name: /reject reject-me\.jpg/i }),
  );

  expect(toast()).toEqual({
    title: "Rejected reject-me.jpg",
    description: `${HOME}/bin/reject-me (1).jpg`,
  });
});

// The direct keys, through the view that mounts the grid. Review lists Active
// wallpapers only, so `K` and `Delete` are the two that have a route through it
// — the other two are the library page's, and `WallpaperGrid.test.tsx` presses
// them against a host mounting a card of each Status.

test("K keeps the selected card, the same as pressing Keep", async () => {
  const keptIds: unknown[] = [];
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args.id);
    return wrote(args, { status: "kept" });
  });

  await enterGrid();
  await press("k");

  // One handler behind both, so a key and a click cannot drift into meaning
  // different things: the same command, the same removal, the same toast.
  expect(keptIds).toEqual([4]);
  expect(inReview().queryByAltText("keeper.jpg")).toBeNull();
  expect(toast()?.title).toBe("Kept keeper.jpg");
  // And the sweep carries on from where that card was, which is what makes two
  // keystrokes per wallpaper a pass rather than a series of hunts (ADR 0019).
  expect(selectedCard()).toBe("next.jpg, Active");
});

test("Delete rejects the selected card, with no confirm in the way", async () => {
  const moveArgs: unknown[] = [];
  await openReview([
    wallpaper(6, { filename: "reject-me.jpg" }),
    wallpaper(7, { filename: "next.jpg" }),
  ]);
  mockCommand("move_wallpaper", (args) => {
    moveArgs.push(args);
    return rejectedTo(args, "/library/rejected/reject-me.jpg");
  });

  await enterGrid();
  await press("Delete");

  // A single keypress moves a file. ADR 0009 deleted the confirm dialog and put
  // act-then-undo in its place, so the safety is the toast and the `Ctrl+Z` that
  // presses its Undo — and focus stays on the grid while that toast is up.
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(moveArgs).toEqual([{ id: 6, destinationFolder: "./rejected" }]);
  expect(inReview().queryByAltText("reject-me.jpg")).toBeNull();
  expect(selectedCard()).toBe("next.jpg, Active");
});

test("a key that fails puts the card back, and the selection with it", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "next.jpg" }),
  ]);
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "db", message: "disk on fire" }),
  );

  await enterGrid();
  await press("k");

  // The optimistic removal is undone, and the selection follows the wallpaper
  // back rather than staying on whatever had moved up into the slot: it is
  // tracked by id, so the card that returns is the card that is selected
  // (ADR 0019, ADR 0022).
  expect(toast()?.title).toBe("Couldn't keep keeper.jpg");
  expect(selectedCard()).toBe("keeper.jpg, Active");
});

test("a click on a card opens the lightbox and is not a keep or a reject", async () => {
  // The click that opens the lightbox (#134, #138), which Review has because
  // the card is shared and which this view wires for itself, since ADR 0022
  // keeps that surface's state on the page that mounted the grid. What the
  // surface then shows is `lightbox.test.tsx`'s; what is this page's is the
  // second half — the card is removed optimistically by a keep or a reject, so
  // a click that quietly meant one would take the wallpaper out of the list in
  // front of the curator.
  await openReview([wallpaper(4, { filename: "keeper.jpg" })]);

  await click(inReview().getByRole("gridcell", { name: "keeper.jpg, Active" }));

  expect(screen.getByRole("dialog", { name: "keeper.jpg" })).toBeTruthy();
  expect(inReview().queryByAltText("keeper.jpg")).not.toBeNull();
  expect(toast()).toBeNull();
});
