import type { TransitionAction } from "@/components/transitions";
import { WallpaperCard } from "@/components/WallpaperCard";
import { client, type Wallpaper } from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { flush, mockBootedApp, renderInApp, wallpaper } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Review lists only Active wallpapers, so the pill, the dimming, the folder
// line and both Restore paths have no route through that view. They are tested
// here, against a card mounted on a fixture of each Status. What Review does
// with the same component is `ReviewView.test.tsx`'s.

afterEach(cleanup);

let asked: Array<{ action: TransitionAction; id: number }>;
let restores: number[];
/** The wallpapers a click asked to look closer at, in order (#134). */
let opened: number[];

beforeEach(() => {
  asked = [];
  restores = [];
  opened = [];
  // The provider's boot gate; the card itself asks the backend nothing.
  mockBootedApp();
  // The row a Restore writes: back on Active, at the path it came from, and
  // its Origin spent (ADR 0023). The card only counts the calls, but a mock
  // answering with a bare path was answering with a row nothing produces.
  mockCommand("restore_wallpaper", (args) => {
    restores.push(args.id);
    return wallpaper(args.id);
  });
});

/**
 * A card as the live library produces one: rated, and not yet Evaluated.
 *
 * The dimmed badge is the default here because it is the default everywhere. σ
 * is a late signal at every threshold the curator can choose, so a young library
 * holds no Evaluated wallpaper at all and the solid badge is the case a test has
 * to arrange (ADR 0013).
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
async function mount(
  w: Wallpaper,
  animated = false,
  undersized = false,
  evaluatedThreshold?: number,
) {
  await renderInApp(
    <WallpaperCard
      wallpaper={w}
      animated={animated}
      undersized={undersized}
      evaluatedThreshold={evaluatedThreshold}
      onAction={(action, subject) => {
        asked.push({ action, id: subject.id });
        if (action === "restore") void client.restoreWallpaper(subject.id);
      }}
      onOpen={(subject) => opened.push(subject.id)}
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

const buttonNames = () =>
  screen.getAllByRole("button").map((el) => el.getAttribute("aria-label"));

/**
 * The `wallpaper://` request failing, which is the whole of how a card learns
 * its file is gone.
 *
 * happy-dom fetches no `<img>` and so fires neither event of its own, which is
 * what makes both frames reachable: the one before this is a thumbnail still on
 * its way, and the one after is a file that is not there (ADR 0032).
 */
async function failedToLoad() {
  await act(async () => {
    fireEvent.error(screen.getByAltText("wall-1.jpg"));
  });
  await flush();
}

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
  // Under the threshold the app trusts the number, and one visual state says
  // so. No second number and no bands: there is one definition of confidence.
  await mount(card({ rating_sigma: 3.9 }));
  expect(badge().className).toContain("bg-white");
  expect(badge().getAttribute("title")).toBe("Evaluated");
});

test("the badge reads against the threshold the curator set, not a constant", async () => {
  // One wallpaper, three curators. σ 4.5 is not confident enough for the app as
  // it shipped and is for a curator who asked to be told sooner, which is the
  // whole of what #260 moved (ADR 0046).
  const rated = card({ rating_sigma: 4.5 });

  await mount(rated, false, false, 5);
  expect(badge().getAttribute("title")).toBe("Evaluated");
  expect(badge().className).toContain("bg-white");

  cleanup();
  await mount(rated, false, false, 4);
  expect(badge().getAttribute("title")).toBe("Not yet Evaluated");

  cleanup();
  await mount(rated, false, false, 3);
  expect(badge().getAttribute("title")).toBe("Not yet Evaluated");

  cleanup();
  // A card told nothing reads against what Evaluated meant before it was a
  // setting, which is the answer for every curator who has not moved it.
  await mount(rated);
  expect(badge().getAttribute("title")).toBe("Not yet Evaluated");
});

test("a wallpaper in no Comparison is Evaluated at no threshold the page offers", async () => {
  // The starting σ is 8.333, above the loosest choice, so the dimmed badge and
  // `Unrated` agree without either checking the other.
  for (const threshold of [5, 4, 3]) {
    await mount(
      card({ comparisons_count: 0, rating_mu: 25 }),
      false,
      false,
      threshold,
    );
    expect(badge().textContent).toBe("Unrated");
    expect(badge().getAttribute("title")).toBe("Not yet Evaluated");
    cleanup();
  }
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
  expect(line.getAttribute("title")).toBe(
    "/library/photos/rejected/wall-1.jpg",
  );
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
  expect(buttonNames()).toEqual([
    "Make Active wall-1.jpg",
    "Reject wall-1.jpg",
  ]);
  expect(
    screen.getByRole("button", { name: "Make Active wall-1.jpg" }).textContent,
  ).toBe("Make ActiveK");

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

test("a Restore with no Origin is drawn unavailable and still reaches the host", async () => {
  // The cohort rejected before ADR 0009 recorded an Origin. `origin_path` is on
  // the DTO, so the answer is known before the press — and what this card does
  // about it is draw the control as unavailable, which is drawing rather than
  // policy. The refusal itself is the host's, in the one `perform` the button,
  // the grid's `R` and the lightbox's row all reach, so it cannot disagree with
  // itself across three triggers (ADR 0023). `LibraryView.test.tsx` is where
  // the sentence it raises is asserted.
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

  // This host holds no refusal, which is what makes the reach visible here.
  expect(asked).toEqual([{ action: "restore", id: 1 }]);
});

test("a click on the card asks to look closer, and a click on a button does not", async () => {
  await mount(card());

  // The picture is most of the card and the click lands on it, which is the
  // gesture: there is no open control, because the cell is the target
  // (ADR 0019, ADR 0022). What the host gets is the wallpaper that was pressed.
  await act(async () => {
    fireEvent.click(screen.getByAltText("wall-1.jpg"));
  });
  expect(opened).toEqual([1]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Keep wall-1.jpg" }));
  });

  // The button stopped the click on its way up, so pressing Keep is a keep and
  // not a keep with the lightbox opening over it.
  expect(asked).toEqual([{ action: "keep", id: 1 }]);
  expect(opened).toEqual([1]);
});

test("an unavailable Restore is not a way of opening the card either", async () => {
  await mount(rejected({ origin_path: null }));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore wall-1.jpg" }));
  });

  // The one button the host answers with a sentence rather than an action. It
  // still stops the click on its way up, so the card underneath stays where it
  // was: a refusal that also opened the lightbox would be two answers to one
  // press.
  expect(opened).toEqual([]);
});

test("hover and focus reveal the same overlay", async () => {
  await mount(card());

  // Two triggers, one overlay. The keyboard selection #124 builds reveals a
  // card the same way a pointer does (ADR 0019) — keyboard focus on the cell or
  // on a button inside it. Drawn focus only: `focus-within` also answered to
  // the focus a click leaves behind, which kept a card's overlay open after
  // the pointer had left it.
  const overlay =
    cardElement("wall-1.jpg, Active").querySelector(".absolute.inset-0");
  const classes = overlay?.className ?? "";
  expect(classes).toContain("group-hover:opacity-100");
  expect(classes).toContain("group-focus-visible:opacity-100");
  expect(classes).toContain("group-has-[:focus-visible]:opacity-100");
  expect(classes).not.toContain("group-focus-within");
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

test("a card whose picture will not load says the file is gone", async () => {
  await mount(card());

  // The plain frame is what a thumbnail still generating looks like: nothing in
  // the space, because ADR 0016's grid mounts a window out of five thousand
  // cards and a placeholder per card would animate the whole grid to say
  // something a request resolves in a few hundred milliseconds. So the words
  // belong to the state that never resolves, and that is what tells the two
  // apart (ADR 0032).
  expect(screen.queryByText("File is gone")).toBeNull();
  expect(document.querySelector('[data-slot="wallpaper-gone"]')).toBeNull();

  await failedToLoad();

  // Not a blank tile and not a spinner: the card reacts to the `wallpaper://`
  // request it was already making, which costs nothing and catches every cause
  // — a deleted file, a renamed folder, an unplugged drive, a permission the
  // curator lost (#200).
  expect(screen.getByText("File is gone")).toBeTruthy();
  expect(cardElement("wall-1.jpg, Active, File is gone")).toBeTruthy();
});

test("a gone card keeps its Score, its Status and its transitions", async () => {
  await mount(rejected());
  await failedToLoad();

  // The panel covers the picture and nothing else. Rejecting or restoring a
  // wallpaper whose file is gone is exactly what the curator might want to do
  // about it, and ADR 0009's `file_missing` is what answers if the move has
  // nothing to move — so none of these leaves the card (ADR 0032).
  expect(badge().textContent).toBe("22.4");
  expect(screen.queryByText("Rejected")).not.toBeNull();
  expect(buttonNames()).toEqual(["Restore wall-1.jpg"]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore wall-1.jpg" }));
  });
  expect(asked).toEqual([{ action: "restore", id: 1 }]);
});

test("a gone card is still the way into the lightbox", async () => {
  await mount(card());
  await failedToLoad();

  // The panel takes no pointer events, so the cell underneath is still the
  // click target — which matters most here, because the lightbox is where the
  // path and the explanation are (ADR 0022, ADR 0032).
  await act(async () => {
    fireEvent.click(screen.getByText("File is gone"));
  });
  expect(opened).toEqual([1]);
});

test("a picture that arrives after a failure takes the message back off", async () => {
  await mount(card());
  await failedToLoad();
  expect(screen.queryByText("File is gone")).not.toBeNull();

  // The element stays mounted through the failure, which is what leaves
  // anything to fire `load`: a card is never stuck on an answer the browser has
  // since revised.
  await act(async () => {
    fireEvent.load(screen.getByAltText("wall-1.jpg"));
  });

  expect(screen.queryByText("File is gone")).toBeNull();
  expect(cardElement("wall-1.jpg, Active")).toBeTruthy();
});

test("an undersized card wears the badge and names its Dimensions (#258)", async () => {
  await mount(card({ width: 1280, height: 720 }), false, true);

  // The word, and the size behind the verdict. The badge says a file is too
  // small; the `title` is the only thing that says by how much, and it needs no
  // Minimum resolution to print, since the badge's presence is already that
  // comparison.
  const mark = screen.getByText("Undersized");
  expect(mark.getAttribute("title")).toBe("1280 × 720");

  // And in the name, beside the Status. A card's own `aria-label` hides its
  // contents, so a mark that is only a word inside it is a mark nobody reading
  // with a screen reader is told about (ADR 0019).
  expect(cardElement("wall-1.jpg, Active, Undersized")).toBeTruthy();
});

test("a card says nothing about its size unless it was told to", async () => {
  // The flag is the whole of what the card knows: whoever holds the Minimum
  // resolution makes the comparison, and a wallpaper whose Dimensions nothing
  // has read arrives here as `false` rather than as a guess (ADR 0044).
  await mount(card({ width: null, height: null }));

  expect(screen.queryByText("Undersized")).toBeNull();
  expect(cardElement("wall-1.jpg, Active")).toBeTruthy();
});

test("a placed card wears a ring when selected, and a grid card never does (#254)", async () => {
  // Drawn off `selected` rather than off focus, so the cursor is still visible
  // after the curator clicks somewhere else on the page. The uncropped layouts
  // are the prototype's; the uniform grid is the one the verdict kept as it was.
  const box = { left: 0, top: 0, width: 320, height: 180 };
  await renderInApp(
    <div role="grid">
      <WallpaperCard
        wallpaper={card({ id: 1, filename: "one.jpg" })}
        onAction={() => {}}
        cellIndex={0}
        selected
        box={box}
      />
      <WallpaperCard
        wallpaper={card({ id: 2, filename: "two.jpg" })}
        onAction={() => {}}
        cellIndex={1}
        box={box}
      />
      <WallpaperCard
        wallpaper={card({ id: 3, filename: "three.jpg" })}
        onAction={() => {}}
        cellIndex={2}
        selected
      />
    </div>,
  );
  await flush();

  const [placed, unselected, grid] = screen.getAllByRole("gridcell");
  expect(placed.classList.contains("ring-primary")).toBe(true);
  expect(unselected.classList.contains("ring-primary")).toBe(false);
  expect(grid.classList.contains("ring-primary")).toBe(false);
});

test("a card the layout placed has no frame, and a grid card keeps its own (#254)", async () => {
  // Masonry and justified rows are a wall of pictures with a 4px gutter; the
  // uniform grid is still a grid of cards.
  const classes = (element: HTMLElement) => [...element.classList];
  await renderInApp(
    <WallpaperCard
      wallpaper={card({ id: 1, filename: "placed.jpg" })}
      onAction={() => {}}
      box={{ left: 0, top: 0, width: 320, height: 180 }}
    />,
  );
  await flush();
  const placed = classes(cardElement("placed.jpg, Active"));
  expect(placed).not.toContain("border");
  expect(placed.some((name) => name.startsWith("rounded"))).toBe(false);

  cleanup();
  await mount(card({ id: 1, filename: "grid.jpg" }));
  const framed = classes(cardElement("grid.jpg, Active"));
  expect(framed).toContain("border");
  expect(framed).toContain("rounded-lg");
});

/** Every `<img>` on the card, the `small` first. */
const images = () => Array.from(document.querySelectorAll("img"));

test("a card drawn at small asks for nothing sharper", async () => {
  await mount(card());
  expect(images().map((img) => img.getAttribute("src"))).toEqual([
    "wallpaper://localhost/image/1?size=small",
  ]);
});

test("a card drawn wide lays a medium over the small, shown once it loads", async () => {
  await renderInApp(
    <WallpaperCard wallpaper={card()} onAction={() => {}} imageSize="medium" />,
  );
  await flush();

  const [small, medium] = images();
  expect(small.getAttribute("src")).toBe(
    "wallpaper://localhost/image/1?size=small",
  );
  expect(medium.getAttribute("src")).toBe(
    "wallpaper://localhost/image/1?size=medium",
  );
  // Hidden until it has arrived, so the zoom sharpens the card and never
  // blanks it.
  expect(medium.className).toContain("opacity-0");

  await act(async () => {
    fireEvent.load(medium);
  });
  expect(medium.className).not.toContain("opacity-0");
});
