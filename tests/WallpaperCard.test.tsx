import { WallpaperCard, type CardAction } from "@/components/WallpaperCard";
import { client, type Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { flush, renderInApp, settings, stats, wallpaper } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Review lists only Active wallpapers, so the pill, the dimming, the folder
// line and both Restore paths have no route through that view. They are tested
// here, against a card mounted on a fixture of each Status. What Review does
// with the same component is `ReviewView.test.tsx`'s.

afterEach(cleanup);

let asked: Array<{ action: CardAction; id: number }>;
let restores: number[];

beforeEach(() => {
  asked = [];
  restores = [];
  // The provider's boot gate; the card itself asks the backend nothing.
  mockCommand("get_stats", () => stats());
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("restore_wallpaper", (args) => {
    restores.push(args?.id as number);
    return "/library/wall-1.jpg";
  });
});

/**
 * A card as the live library produces one: rated, and not yet Evaluated.
 *
 * The dimmed badge is the default here because it is the default everywhere. σ
 * crosses 4.0 at around seven comparisons, so a young library holds no
 * Evaluated wallpaper at all and the solid badge is the case a test has to
 * arrange (ADR 0013).
 */
function card(over: Partial<Wallpaper> = {}): Wallpaper {
  return wallpaper(1, {
    filename: "wall-1.jpg",
    comparisons_count: 14,
    rating_mu: 22.4,
    ...over,
  });
}

/** A Rejected row: its file moved, and an Origin recorded to go back to. */
function rejected(over: Partial<Wallpaper> = {}): Wallpaper {
  return card({
    status: "rejected",
    path: "/library/photos/rejected/wall-1.jpg",
    origin_path: "/library/photos/wall-1.jpg",
    ...over,
  });
}

/**
 * Mount one card inside the real providers, with a host that answers the way a
 * page does: it records what was asked for and makes the call behind it.
 */
async function mount(w: Wallpaper, animated = false) {
  await renderInApp(
    <WallpaperCard
      wallpaper={w}
      animated={animated}
      onAction={(action, subject) => {
        asked.push({ action, id: subject.id });
        if (action === "restore") void client.restoreWallpaper(subject.id);
      }}
    />,
  );
  await flush();
}

/** The card itself, by the accessible name it carries. */
function cardElement(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

function badge(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-slot="badge"]');
  if (!found) throw new Error("no Score badge on the card");
  return found;
}

function toastTitle(): string | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return root.querySelector("[data-slot='toast-title']")?.textContent ?? "";
}

function toastDescription(): string | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return root.querySelector("[data-slot='toast-description']")?.textContent ?? null;
}

const buttonNames = () =>
  screen.getAllByRole("button").map((el) => el.getAttribute("aria-label"));

test("the badge is the Score to one decimal, and Unrated for a wallpaper in no Comparison", async () => {
  await mount(card({ rating_mu: 22.45 }));
  expect(badge().textContent).toBe("22.4");

  cleanup();
  // Every wallpaper at zero comparisons holds the same starting 25.0, which is
  // the app's ignorance rather than a judgement, so it says so (ADR 0013).
  await mount(card({ comparisons_count: 0, rating_mu: 25 }));
  expect(badge().textContent).toBe("Unrated");
});

test("the badge is dimmed until the wallpaper is Evaluated", async () => {
  // The whole live library, and the fixtures' default: σ 8.333 is twice the
  // threshold, so the number on the badge is provisional and reads that way.
  await mount(card());
  expect(badge().className).toContain("bg-black/50");
  expect(badge().className).not.toContain("bg-white");
  expect(badge().getAttribute("title")).toBe("Not yet Evaluated");

  cleanup();
  // Under 4.0 the app trusts the number, and one visual state says so. No
  // second number and no bands: there is one definition of confidence.
  await mount(card({ rating_sigma: 3.9 }));
  expect(badge().className).toContain("bg-white");
  expect(badge().getAttribute("title")).toBe("Evaluated");
});

test("a card names itself with its filename and its Status", async () => {
  await mount(card({ status: "kept" }));

  // The Status is otherwise a pill and a dimming, neither of which a screen
  // reader reaches (ADR 0019).
  expect(cardElement("wall-1.jpg, Kept")).toBeTruthy();
});

test("Kept and Rejected wear the pill; Active does not", async () => {
  await mount(card());
  expect(screen.queryByText("Active")).toBeNull();

  cleanup();
  await mount(card({ status: "kept" }));
  expect(screen.queryByText("Kept")).not.toBeNull();

  cleanup();
  await mount(rejected());
  expect(screen.queryByText("Rejected")).not.toBeNull();
});

test("the overlay reads the comparison count, and for a Rejected card the folder that took the file", async () => {
  await mount(card({ comparisons_count: 14 }));
  expect(screen.queryByText("14 comparisons")).not.toBeNull();

  cleanup();
  await mount(rejected({ comparisons_count: 14 }));

  // The containing folder's name only. Two source folders each with their own
  // `rejected/` produce the same line on two cards, and the title is what tells
  // them apart, which is the whole reason the card answers this and the bar's
  // read-out cannot (ADR 0018, ADR 0019).
  const line = screen.getByText("14 comparisons · now in rejected/");
  expect(line.getAttribute("title")).toBe("/library/photos/rejected/wall-1.jpg");
});

test("the dimming of a Rejected card sits on the image and not on the card", async () => {
  await mount(rejected());

  // Worth pinning because the prototype had it the other way, and on the
  // wrapper it drags the pill, the badge and the whole overlay to 60% with the
  // image — including the Restore that is the point of the overlay (ADR 0019).
  const frame = cardElement("wall-1.jpg, Rejected");
  const image = screen.getByAltText("wall-1.jpg");
  expect(image.className).toContain("opacity-60");
  expect(image.className).toContain("grayscale");
  expect(frame.className).not.toContain("opacity-60");
  expect(frame.className).not.toContain("grayscale");
});

test("an Active card offers Keep and Reject", async () => {
  await mount(card());
  expect(buttonNames()).toEqual(["Keep wall-1.jpg", "Reject wall-1.jpg"]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Keep wall-1.jpg" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reject wall-1.jpg" }));
  });

  expect(asked).toEqual([
    { action: "keep", id: 1 },
    { action: "reject", id: 1 },
  ]);
});

test("a Kept card offers Make Active and Reject", async () => {
  await mount(card({ status: "kept" }));

  // Not "Un-keep" and not "Return to voting": a Kept wallpaper already votes,
  // and the label names the Status the press produces (ADR 0019).
  expect(buttonNames()).toEqual(["Make Active wall-1.jpg", "Reject wall-1.jpg"]);
  expect(
    screen.getByRole("button", { name: "Make Active wall-1.jpg" }).textContent,
  ).toBe("Make Active");

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Make Active wall-1.jpg" }),
    );
  });
  expect(asked).toEqual([{ action: "make-active", id: 1 }]);
});

test("a Rejected card with an Origin offers Restore, and asks for it", async () => {
  await mount(rejected());
  expect(buttonNames()).toEqual(["Restore wall-1.jpg"]);

  const restore = screen.getByRole("button", { name: "Restore wall-1.jpg" });
  expect(restore.getAttribute("aria-disabled")).toBeNull();

  await act(async () => {
    fireEvent.click(restore);
  });
  expect(asked).toEqual([{ action: "restore", id: 1 }]);
  expect(restores).toEqual([1]);
});

test("a Restore with no Origin explains itself when pressed, and calls nothing", async () => {
  // The cohort rejected before ADR 0009 recorded an Origin. `origin_path` is on
  // the DTO, so the frontend knows the answer before the press.
  await mount(rejected({ origin_path: null }));

  const restore = screen.getByRole("button", { name: "Restore wall-1.jpg" });
  expect(restore.getAttribute("aria-disabled")).toBe("true");
  // Not `disabled`, which is what the prototype used: a disabled button is not
  // focusable, so the reason would be unreachable by keyboard and silent to a
  // screen reader — most of the people it was written for (ADR 0019).
  expect((restore as HTMLButtonElement).disabled).toBe(false);
  restore.focus();
  expect(document.activeElement).toBe(restore);

  await act(async () => {
    fireEvent.click(restore);
  });

  expect(toastTitle()).toBe("Can't restore wall-1.jpg");
  expect(toastDescription()).toBe(
    "Rejected before Restore existed, so nothing recorded where it came from.",
  );
  // The point of putting `origin_path` on the DTO: the refusal costs no round
  // trip, and the host is never asked for one.
  expect(asked).toEqual([]);
  expect(restores).toEqual([]);
});

test("hover and focus reveal the same overlay", async () => {
  await mount(card());

  // Two triggers, one overlay. The keyboard selection #124 builds reveals a
  // card the same way a pointer does (ADR 0019).
  const overlay = cardElement("wall-1.jpg, Active").querySelector(
    ".absolute.inset-0",
  );
  expect(overlay?.className ?? "").toContain("group-hover:opacity-100");
  expect(overlay?.className ?? "").toContain("group-focus-within:opacity-100");
});

test("the card animates nothing unless the page asks for it", async () => {
  await mount(card());

  // ADR 0016's library card: no animated property and no `will-change`, because
  // under virtualisation ADR 0007's fix buys nothing — a wheel gesture mounts
  // cards continuously, so first paint and first hover are the same moment. The
  // opposite case is Review's, pinned in `ReviewView.test.tsx`.
  const frame = cardElement("wall-1.jpg, Active");
  expect(screen.getByAltText("wall-1.jpg").className).not.toContain(
    "will-change",
  );
  expect(
    frame.querySelector(".absolute.inset-0")?.className ?? "",
  ).not.toContain("will-change");
});
