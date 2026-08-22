import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import App from "@/App";
import type { Wallpaper } from "@/lib/client";
import { emitEvent, mockCommand, resetIpcMocks } from "./ipc-mocks";

const REVIEW_LIMIT = 20;

function wallpaper(
  id: number,
  filename: string,
  ratingMu: number,
): Wallpaper {
  return {
    id,
    filename,
    path: `/library/${filename}`,
    status: "active",
    rating_mu: ratingMu,
    rating_sigma: 1.0,
    comparisons_count: 3,
  };
}

/** Scan a directory, then navigate to the review view. */
async function openReview() {
  const input = screen.getByPlaceholderText("/home/user/wallpapers");
  await act(async () => {
    fireEvent.change(input, { target: { value: "/tmp/wallpapers" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /start ranking/i }));
    emitEvent("scan-complete", { added_count: 3 });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /go to review/i }));
  });
}

afterEach(() => {
  cleanup();
  resetIpcMocks();
});

beforeEach(() => {
  mockCommand("start_scan", () => null);
});

test("lists lowest-mu active wallpapers ascending with mu badges and small thumbnails", async () => {
  const list = [
    wallpaper(3, "lowest.jpg", 8.2),
    wallpaper(1, "middle.png", 15.5),
    wallpaper(7, "highest.webp", 25.0),
  ];
  mockCommand("get_review", (args) => {
    expect(args?.limit).toBe(REVIEW_LIMIT);
    return list;
  });

  render(<App />);
  await openReview();

  expect(screen.getByRole("heading", { name: "Review Low-Rated" })).toBeDefined();

  const images = screen.getAllByRole("img") as HTMLImageElement[];
  expect(images.map((img) => img.src)).toEqual([
    "wallpaper://image/3?size=small",
    "wallpaper://image/1?size=small",
    "wallpaper://image/7?size=small",
  ]);
  expect(images.map((img) => img.alt)).toEqual([
    "lowest.jpg",
    "middle.png",
    "highest.webp",
  ]);

  // Mu badges, in the same ascending order.
  const badges = screen.getAllByText(/^\d+\.\d$/);
  expect(badges.map((badge) => badge.textContent)).toEqual([
    "8.2",
    "15.5",
    "25.0",
  ]);
});

test("keep persists Kept status, removes the card immediately, and survives refresh", async () => {
  const library = [wallpaper(4, "keeper.jpg", 9.9), wallpaper(5, "stay.jpg", 12.0)];
  mockCommand("get_review", () =>
    library.filter((w) => w.status === "active"),
  );
  let keptCalls = 0;
  mockCommand("keep_wallpaper", (args) => {
    const id = args?.id;
    expect(id).toBe(4);
    keptCalls++;
    const target = library.find((w) => w.id === id);
    if (target) target.status = "kept";
    return null;
  });

  render(<App />);
  await openReview();
  expect(screen.getAllByRole("img")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: /keep keeper\.jpg/i }));

  // Card vanishes without waiting on a refetch.
  expect(await screen.findAllByRole("img")).toHaveLength(1);
  expect(screen.queryByAltText("keeper.jpg")).toBeNull();
  expect(keptCalls).toBe(1);

  // Survives refresh: the backend list no longer contains it.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  });
  await waitFor(() => {
    expect(screen.queryByAltText("keeper.jpg")).toBeNull();
  });
  expect(screen.getByAltText("stay.jpg")).toBeDefined();
});

test("keep failure surfaces a readable error and keeps the card", async () => {
  mockCommand("get_review", () => [wallpaper(4, "keeper.jpg", 9.9)]);
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "db", message: "disk on fire" }),
  );

  render(<App />);
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: /keep keeper\.jpg/i }));

  expect(await screen.findByText(/failed to keep/i)).toBeDefined();
  expect(screen.getByAltText("keeper.jpg")).toBeDefined();
});

test("move is gated behind a confirm dialog showing filename and destination", async () => {
  const library = [wallpaper(6, "reject-me.jpg", 7.7)];
  mockCommand("get_review", () => library.filter((w) => w.status === "active"));
  let moveArgs: unknown = null;
  mockCommand("move_wallpaper", (args) => {
    moveArgs = args as Record<string, unknown>;
    const target = library.find((w) => w.id === args?.id);
    if (target) target.status = "rejected";
    return null;
  });

  render(<App />);
  await openReview();

  // Cancel path: no command fired.
  fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  expect(await screen.findByText(/move wallpaper\?/i)).toBeDefined();
  expect(
    screen.getByText(/this will move "reject-me\.jpg" to "\.\/rejected"\./i),
  ).toBeDefined();
  expect(screen.getAllByText(/\.\/rejected/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  await waitFor(() => {
    expect(screen.queryByText(/move wallpaper\?/i)).toBeNull();
  });
  expect(moveArgs).toBeNull();
  expect(screen.getByAltText("reject-me.jpg")).toBeDefined();

  // Confirm path: soft-reject runs with the shown destination.
  fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  fireEvent.click(await screen.findByRole("button", { name: /move file/i }));

  expect(moveArgs).toEqual({ id: 6, destinationFolder: "./rejected" });
  expect(await screen.findByText(/no wallpapers to review\./i)).toBeDefined();
  expect(screen.queryByAltText("reject-me.jpg")).toBeNull();
});

test("destination input defaults to ./rejected and is editable before confirming", async () => {
  const library = [wallpaper(6, "reject-me.jpg", 7.7)];
  mockCommand("get_review", () => library.filter((w) => w.status === "active"));
  let destination = "";
  mockCommand("move_wallpaper", (args) => {
    destination = args?.destinationFolder as string;
    return null;
  });

  render(<App />);
  await openReview();

  const destinationInput = screen.getByLabelText(/move to:/i) as HTMLInputElement;
  expect(destinationInput.value).toBe("./rejected");

  fireEvent.click(screen.getByRole("button", { name: /move reject-me\.jpg/i }));
  await screen.findByText(/move wallpaper\?/i);

  fireEvent.change(destinationInput, { target: { value: "/mnt/archive/rejected" } });
  fireEvent.click(screen.getByRole("button", { name: /move file/i }));

  await waitFor(() => {
    expect(destination).toBe("/mnt/archive/rejected");
  });
});

test("refresh re-pulls the list through get_review", async () => {
  let fetches = 0;
  let list = [wallpaper(2, "a.jpg", 10.0)];
  mockCommand("get_review", () => {
    fetches++;
    return [...list];
  });

  render(<App />);
  await openReview();
  expect(fetches).toBe(1);

  list = [];
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
  });
  expect(fetches).toBe(2);
  expect(await screen.findByText(/no wallpapers to review\./i)).toBeDefined();
});

test("empty state offers a way back to ranking", async () => {
  mockCommand("get_review", () => []);

  render(<App />);
  await openReview();

  expect(await screen.findByText(/no wallpapers to review\./i)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: /return to ranking/i }));
  expect(screen.getByRole("heading", { name: "Rank" })).toBeDefined();
});

test("back returns to ranking", async () => {
  mockCommand("get_review", () => [wallpaper(2, "a.jpg", 10.0)]);

  render(<App />);
  await openReview();
  expect(screen.getByAltText("a.jpg")).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
  expect(screen.getByRole("heading", { name: "Rank" })).toBeDefined();
});

test("load failures surface readably instead of console-only", async () => {
  mockCommand("get_review", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );

  render(<App />);
  await openReview();

  expect(
    await screen.findByText(/failed to load the review list\./i),
  ).toBeDefined();
});
