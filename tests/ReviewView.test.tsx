import { ReviewView } from "@/components/ReviewView";
import type { Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  currentView,
  deferred,
  flush,
  renderInApp,
  settings,
  stats,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

const alerts = () => screen.queryAllByRole("alert").map((el) => el.textContent);
const images = () => screen.getAllByRole("img") as HTMLImageElement[];
const refreshButton = () =>
  screen.getByRole("button", { name: /refresh/i }) as HTMLButtonElement;

afterEach(cleanup);

beforeEach(() => {
  // The provider's boot gate, which holds every render until both land. This
  // view is reached from rank, not from the bootstrap redirect.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  // Started by the provider once that gate settles.
  mockCommand("start_pregen", () => null);
});

/** Mount the view with the given list already served. */
async function openReview(list: Wallpaper[]) {
  mockCommand("get_review", () => list);
  const rendered = await renderInApp(<ReviewView />);
  await flush();
  return rendered;
}

test("renders the rows the backend returned, in the order it returned them", async () => {
  // Deliberately not sorted: ordering and the Active-only filter belong to
  // db.rs (`get_review_returns_active_ordered_by_mu_ascending`). This view is
  // a bare map, and the test says so.
  await openReview([
    wallpaper(3, { filename: "lowest.jpg", rating_mu: 8.24 }),
    wallpaper(1, { filename: "middle.png", rating_mu: 25.0 }),
    wallpaper(7, { filename: "highest.webp", rating_mu: 15.55 }),
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
  const badges = screen.getAllByText(/^\d+\.\d$/);
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

test("asks the backend for 50 rows", async () => {
  const limits: unknown[] = [];
  mockCommand("get_review", (args) => {
    limits.push(args?.limit);
    return [];
  });

  await renderInApp(<ReviewView />);
  await flush();

  expect(limits).toEqual([50]);
});

test("keep records the decision and removes the card without waiting for a refetch", async () => {
  const keptIds: unknown[] = [];
  const pending = deferred<null>();
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "stay.jpg" }),
  ]);
  mockCommand("keep_wallpaper", (args) => {
    keptIds.push(args?.id);
    return pending.promise;
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /keep keeper\.jpg/i }));
  });

  // Gone while the command is still in flight.
  expect(keptIds).toEqual([4]);
  expect(screen.queryByAltText("keeper.jpg")).toBeNull();
  expect(screen.queryByAltText("stay.jpg")).not.toBeNull();

  await act(async () => {
    pending.resolve(null);
  });
  expect(alerts()).toEqual([]);
});

test("refresh renders whatever the backend returns next", async () => {
  let fetches = 0;
  const responses = [
    [wallpaper(4, { filename: "keeper.jpg" })],
    [wallpaper(9, { filename: "fresh.jpg" })],
  ];
  mockCommand("get_review", () => responses[Math.min(fetches++, 1)]);

  await renderInApp(<ReviewView />);
  await flush();
  expect(fetches).toBe(1);
  expect(screen.queryByAltText("keeper.jpg")).not.toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  });

  expect(fetches).toBe(2);
  expect(images().map((img) => img.alt)).toEqual(["fresh.jpg"]);
});

test("a keep that fails puts the card back and says so", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([wallpaper(4, { filename: "keeper.jpg" })]);
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "db", message: "disk on fire" }),
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /keep keeper\.jpg/i }));
  });

  expect(alerts()).toEqual(["Failed to keep wallpaper. Please try again."]);
  expect(screen.queryByAltText("keeper.jpg")).not.toBeNull();
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
  const doomed = deferred<null>();
  mockCommand("keep_wallpaper", (args) =>
    args?.id === 1 ? doomed.promise : null,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /keep doomed\.jpg/i }));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: /keep goes-fine\.jpg/i }),
    );
  });
  await act(async () => {
    doomed.reject({ kind: "db", message: "disk on fire" });
    await flush();
  });

  expect(alerts()).toEqual(["Failed to keep wallpaper. Please try again."]);
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

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move file/i }));
  });

  expect(alerts()).toEqual([
    "Failed to move wallpaper. Please check the destination.",
  ]);
  expect(screen.queryByAltText("reject-me.jpg")).not.toBeNull();
});

test("a successful fetch clears the previous failure", async () => {
  expectConsoleError(/Failed to fetch review list/);
  let broken = true;
  mockCommand("get_review", () =>
    broken
      ? Promise.reject({ kind: "db", message: "locked database" })
      : [wallpaper(2, { filename: "a.jpg" })],
  );

  await renderInApp(<ReviewView />);
  await flush();
  expect(alerts()).toEqual(["Failed to load the review list."]);

  broken = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  });

  expect(alerts()).toEqual([]);
  expect(screen.queryByAltText("a.jpg")).not.toBeNull();
});

test("a successful keep clears the previous failure", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview([
    wallpaper(4, { filename: "keeper.jpg" }),
    wallpaper(5, { filename: "stay.jpg" }),
  ]);
  let broken = true;
  mockCommand("keep_wallpaper", () =>
    broken ? Promise.reject({ kind: "db", message: "disk on fire" }) : null,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /keep keeper\.jpg/i }));
  });
  expect(alerts()).toHaveLength(1);

  broken = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /keep stay\.jpg/i }));
  });

  expect(alerts()).toEqual([]);
  expect(screen.queryByAltText("keeper.jpg")).not.toBeNull();
});

test("the list can't be refetched while a fetch is in flight", async () => {
  const first = deferred<Wallpaper[]>();
  const second = deferred<Wallpaper[]>();
  const responses = [first.promise, second.promise];
  let fetches = 0;
  mockCommand("get_review", () => responses[fetches++]);

  const { container } = await renderInApp(<ReviewView />);

  // While loading the body is a spinner and Refresh is disabled. The control
  // lives in the bar this page owns below the chrome, which holds its height in
  // every state, so `disabled` is what keeps a second fetch out rather than the
  // button being absent.
  expect(container.querySelector(".animate-spin")).not.toBeNull();
  expect(refreshButton().disabled).toBe(true);

  await act(async () => {
    first.resolve([wallpaper(2, { filename: "a.jpg" })]);
  });
  expect(refreshButton().disabled).toBe(false);
  await act(async () => {
    fireEvent.click(refreshButton());
  });

  expect(fetches).toBe(2);
  expect(refreshButton().disabled).toBe(true);
  expect(screen.queryByAltText("a.jpg")).toBeNull();

  await act(async () => {
    second.resolve([]);
  });
  expect(screen.queryByText(/no wallpapers to review\./i)).not.toBeNull();
  expect(fetches).toBe(2);
});

test("move is gated behind a confirm dialog showing filename and destination", async () => {
  const moveArgs: unknown[] = [];
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })]);
  // The command answers with the path the file landed at; Review has nowhere to
  // report it yet, and a card that leaves the list either way is what this test
  // is about.
  mockCommand("move_wallpaper", (args) => {
    moveArgs.push(args);
    return "/library/rejected/reject-me.jpg";
  });

  // Cancel path: no command fired.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  });
  expect(
    screen.queryByText(/this will move "reject-me\.jpg" to "\.\/rejected"\./i),
  ).not.toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  });
  await waitFor(() => {
    expect(screen.queryByText(/move wallpaper\?/i)).toBeNull();
  });
  expect(moveArgs).toEqual([]);
  expect(screen.queryByAltText("reject-me.jpg")).not.toBeNull();

  // Confirm path: the soft reject runs with the destination it showed.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move file/i }));
  });

  expect(moveArgs).toEqual([{ id: 6, destinationFolder: "./rejected" }]);
  expect(screen.queryByAltText("reject-me.jpg")).toBeNull();
  expect(screen.queryByText(/no wallpapers to review\./i)).not.toBeNull();
});

test("the destination defaults to ./rejected and is editable before confirming", async () => {
  let destination = "";
  await openReview([wallpaper(6, { filename: "reject-me.jpg" })]);
  mockCommand("move_wallpaper", (args) => {
    destination = args?.destinationFolder as string;
    return `${destination}/reject-me.jpg`;
  });

  const destinationInput = screen.getByLabelText(
    /move to:/i,
  ) as HTMLInputElement;
  expect(destinationInput.value).toBe("./rejected");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  });
  await act(async () => {
    fireEvent.change(destinationInput, {
      target: { value: "/mnt/archive/rejected" },
    });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /move file/i }));
  });

  expect(destination).toBe("/mnt/archive/rejected");
});

test("the empty state offers a way back to ranking", async () => {
  await openReview([]);

  expect(screen.queryByText(/no wallpapers to review\./i)).not.toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /return to ranking/i }));
  });

  expect(currentView()).toBe("rank");
});

test("back returns to ranking", async () => {
  await openReview([wallpaper(2, { filename: "a.jpg" })]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
  });

  expect(currentView()).toBe("rank");
});

test("a load failure surfaces readably instead of console-only", async () => {
  expectConsoleError(/Failed to fetch review list/);
  mockCommand("get_review", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );

  await renderInApp(<ReviewView />);
  await flush();

  expect(alerts()).toEqual(["Failed to load the review list."]);
});
