import App from "@/App";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import { flush, settings, stats, wallpaper } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// The toast lives in the shell, so every test here renders the whole app and
// navigates to the surface that raises one. A view mounted alone would be
// testing an arrangement the app does not run.

/** ADR 0009's eight seconds, which the provider applies when nothing overrides it. */
const LIFETIME = 8000;

let keeps: number[];
let unkeeps: number[];
let moves: Array<{ id: number; destination: string }>;
let restores: number[];
let getReviewCalls: number;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  keeps = [];
  unkeeps = [];
  moves = [];
  restores = [];
  getReviewCalls = 0;

  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("list_wallpapers", () => []);
  mockCommand("get_review", () => {
    getReviewCalls++;
    return [
      wallpaper(7, { filename: "wall-7.jpg" }),
      wallpaper(8, { filename: "wall-8.jpg" }),
    ];
  });
  mockCommand("keep_wallpaper", (args) => {
    keeps.push(args?.id as number);
    return null;
  });
  mockCommand("unkeep_wallpaper", (args) => {
    unkeeps.push(args?.id as number);
    return null;
  });
  mockCommand("move_wallpaper", (args) => {
    moves.push({
      id: args?.id as number,
      destination: args?.destinationFolder as string,
    });
    return `/library/rejected/${String(args?.id)}.jpg`;
  });
  mockCommand("restore_wallpaper", (args) => {
    restores.push(args?.id as number);
    return "/library/wall-7.jpg";
  });
});

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

const undoButton = () =>
  document.querySelector("[data-slot='toast-action']") as HTMLElement | null;
const closeButton = () =>
  document.querySelector("[data-slot='toast-close']") as HTMLElement | null;

/** Render the app and land on Review, which is where the live transitions fire. */
async function openReview() {
  render(<App />);
  await flush();
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
  });
  await flush();
}

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
  await flush();
}

/** Reject wall-7. One press: #123 removed the confirm dialog that stood here. */
async function rejectWall7() {
  await click(/reject wall-7\.jpg/i);
}

test("a keep raises its toast, with the Undo named twice over", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);

  expect(toast()).toEqual({ title: "Kept wall-7.jpg", description: null });

  // The word on the button, and the binding spelled out for a reader who
  // cannot tab to it inside eight seconds.
  const undo = undoButton();
  expect(undo?.textContent).toBe("Undo");
  expect(undo?.getAttribute("aria-label") ?? "").toBe("");
  expect(screen.getByRole("status").textContent).toContain("Undo (Ctrl+Z)");
});

test("a reject names the final path when the destination resolved relative", async () => {
  await openReview();
  await rejectWall7();

  // `./rejected` names a rule rather than a place: under ADR 0011 a nested
  // library gets one reject folder per source folder, and nothing on screen
  // says which one took the file. So the toast says.
  expect(toast()).toEqual({
    title: "Rejected wall-7.jpg",
    description: "/library/rejected/7.jpg",
  });
});

test("a reject with an absolute destination that renamed nothing says no path", async () => {
  mockCommand("move_wallpaper", () => "/rejects/wall-7.jpg");
  render(<App />);
  await flush();
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
  });
  await flush();

  const field = screen.getByLabelText("Move to:") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(field, { target: { value: "/rejects" } });
  });
  await rejectWall7();

  // The bar already names the place and the file kept its name, so repeating
  // the path on every reject would be noise during a fast pass.
  expect(toast()).toEqual({ title: "Rejected wall-7.jpg", description: null });
});

test("a reject that renamed the file says so even from an absolute destination", async () => {
  // `unique_destination` suffixes ` (n)` rather than overwriting, and that
  // suffix is the one thing the destination read-out cannot have told anyone.
  mockCommand("move_wallpaper", () => "/rejects/wall-7 (2).jpg");
  render(<App />);
  await flush();
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
  });
  await flush();

  const field = screen.getByLabelText("Move to:") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(field, { target: { value: "/rejects" } });
  });
  await rejectWall7();

  expect(toast()).toEqual({
    title: "Rejected wall-7.jpg",
    description: "/rejects/wall-7 (2).jpg",
  });
});

test("undoing a keep makes it Active again and answers in the toast that offered it", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);
  await act(async () => {
    fireEvent.click(undoButton()!);
  });
  await flush();

  expect(unkeeps).toEqual([7]);
  // The row that leads with a filename, because CONTEXT.md gives the keep
  // inverse no noun and the copy names the resulting Status instead.
  expect(toast()).toEqual({
    title: "wall-7.jpg is Active again",
    description: null,
  });
  // The button you pressed turned into the answer, and the answer offers none.
  expect(undoButton()).toBeNull();
});

test("undoing a reject Restores the file and always names where it landed", async () => {
  await openReview();
  await rejectWall7();
  await act(async () => {
    fireEvent.click(undoButton()!);
  });
  await flush();

  expect(restores).toEqual([7]);
  // Always, unlike a reject's path line: an Origin appears nowhere on screen,
  // so this is the only account of where the file went back to.
  expect(toast()).toEqual({
    title: "Restored wall-7.jpg",
    description: "/library/wall-7.jpg",
  });
  expect(undoButton()).toBeNull();
});

test("Ctrl+Z presses the visible Undo", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);

  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await flush();

  expect(unkeeps).toEqual([7]);
  expect(toast()?.title).toBe("wall-7.jpg is Active again");
});

test("Ctrl+Z with no toast up does nothing", async () => {
  await openReview();
  expect(toast()).toBeNull();

  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await flush();

  // Not a gap. CONTEXT.md says Comparisons are never deleted, so there is no
  // vote for a general Ctrl+Z to take back: the binding can only ever do what
  // the screen already offers.
  expect(unkeeps).toEqual([]);
  expect(restores).toEqual([]);
  expect(toast()).toBeNull();
});

test("Ctrl+Z on a toast that offers no Undo does nothing", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);
  await act(async () => {
    fireEvent.click(undoButton()!);
  });
  await flush();
  expect(toast()?.title).toBe("wall-7.jpg is Active again");

  await act(async () => {
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  });
  await flush();

  // One unkeep, from the button. The answering toast is not itself undoable.
  expect(unkeeps).toEqual([7]);
  expect(toast()?.title).toBe("wall-7.jpg is Active again");
});

test("a second transition replaces the first rather than stacking", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);
  await click(/keep wall-8\.jpg/i);

  expect(document.querySelectorAll("[data-slot='toast']")).toHaveLength(1);
  expect(toast()?.title).toBe("Kept wall-8.jpg");
  expect(keeps).toEqual([7, 8]);
});

test("a replacement starts a fresh eight seconds rather than inheriting the remainder", async () => {
  jest.useFakeTimers();
  await openReview();
  await click(/keep wall-7\.jpg/i);

  // Seven of the first toast's eight seconds are gone before the second one
  // arrives. Radix restarts the close timer on `open` and `duration` and on
  // nothing else, so a stable key would leave the new message holding the old
  // countdown — one second, not eight.
  act(() => {
    jest.advanceTimersByTime(LIFETIME - 1000);
  });
  await click(/keep wall-8\.jpg/i);

  act(() => {
    jest.advanceTimersByTime(LIFETIME - 1000);
  });
  expect(toast()?.title).toBe("Kept wall-8.jpg");

  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(toast()).toBeNull();
});

test("an error is still up after eight seconds and closes when the curator closes it", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  jest.useFakeTimers();
  await openReview();
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "io", message: "permission denied" }),
  );
  await click(/keep wall-7\.jpg/i);

  expect(toast()).toEqual({
    title: "Couldn't keep wall-7.jpg",
    description: "permission denied",
  });

  // Ten times the lifetime a transition gets. A failing action is exactly when
  // the curator wants to read the message twice.
  act(() => {
    jest.advanceTimersByTime(LIFETIME * 10);
  });
  expect(toast()?.title).toBe("Couldn't keep wall-7.jpg");

  await act(async () => {
    fireEvent.click(closeButton()!);
  });
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(toast()).toBeNull();
});

test("a transition toast carries no close button, because it goes on its own", async () => {
  await openReview();
  await click(/keep wall-7\.jpg/i);
  expect(closeButton()).toBeNull();
});

test("FileMissing on a Restore says its own sentence, from the backend", async () => {
  expectConsoleError(/Failed to undo a reject/);
  await openReview();
  await rejectWall7();
  mockCommand("restore_wallpaper", () =>
    Promise.reject({
      kind: "file_missing",
      message: "the file is no longer in the reject folder",
    }),
  );

  await act(async () => {
    fireEvent.click(undoButton()!);
  });
  await flush();

  expect(toast()).toEqual({
    title: "Couldn't restore wall-7.jpg",
    description: "the file is no longer in the reject folder",
  });
});

test("InvalidTransition says the row already changed and makes the view refetch", async () => {
  expectConsoleError(/Failed to keep wallpaper/);
  await openReview();
  const fetchesBefore = getReviewCalls;
  mockCommand("keep_wallpaper", () =>
    Promise.reject({ kind: "invalid_transition", message: "already kept" }),
  );

  await click(/keep wall-7\.jpg/i);

  // No backend message on this one: it is a bug signal rather than a user
  // error, so the row goes rather than the errno.
  expect(toast()).toEqual({
    title: "wall-7.jpg has already changed",
    description: null,
  });
  // The view that acted refetches. Leaving the stale row on screen means the
  // curator's next click reproduces the same refusal.
  expect(getReviewCalls).toBe(fetchesBefore + 1);
});

test("the filename carries its full string for the title that truncates it", async () => {
  mockCommand("get_review", () => [
    wallpaper(7, {
      filename: "a-very-long-wallpaper-filename-that-will-not-fit.jpg",
    }),
  ]);
  await openReview();
  await click(/keep a-very-long-wallpaper-filename/i);

  const name = document.querySelector("[data-slot='toast-filename']");
  expect(name?.getAttribute("title")).toBe(
    "a-very-long-wallpaper-filename-that-will-not-fit.jpg",
  );
  expect(name?.className).toContain("truncate");
});

test("Review still has the destination field for #126 to remove", async () => {
  await openReview();

  // Out of this ticket's scope and in #126's, which puts ADR 0018's read-out on
  // the bar in its place. A test rather than a comment, because removing it
  // early is the easy mistake and it would collide with that issue.
  //
  // The confirm dialog that used to stand beside it here is gone: #123 rebuilt
  // this view on the shared card, whose Reject has nowhere to hang one, and the
  // Undo above is what replaced it (ADR 0009, ADR 0017).
  expect(screen.getByLabelText("Move to:")).toBeTruthy();
  await click(/reject wall-7\.jpg/i);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
