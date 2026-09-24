import { DiscoverView } from "@/components/DiscoverView";
import type {
  AppError,
  SearchPage,
  SearchParams,
  MarkedResult,
} from "@/lib/client";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  click,
  ctrlWheel,
  flush,
  mockBootedApp,
  press,
  renderInApp,
  settings,
  viewportWidth,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

// Discover mocks `wallhaven_search` at the IPC boundary and nothing below it:
// what the page sends is what the backend would be asked, and what it renders
// is what a page of Results answers with (#339).

/** Every search the page made, in order, as the wire carries it. */
let searches: SearchParams[];
/** What the next search answers with, by the page it asked for. */
let answer: (params: SearchParams) => SearchPage | Promise<SearchPage>;

function result(id: string, over: Partial<MarkedResult> = {}): MarkedResult {
  const prefix = id.slice(0, 2);
  return {
    id,
    url: `https://wallhaven.cc/w/${id}`,
    short_url: `https://whvn.cc/${id}`,
    views: 19368,
    favorites: 231,
    source: "",
    purity: "sfw",
    category: "anime",
    dimension_x: 3840,
    dimension_y: 2160,
    resolution: "3840x2160",
    ratio: "1.78",
    file_size: 10_129_568,
    file_type: "image/png",
    created_at: "2026-09-02 17:01:46",
    colors: ["#000000"],
    mark: "unmarked",
    thumbs: {
      large: `https://th.wallhaven.cc/lg/${prefix}/${id}.jpg`,
      original: `https://th.wallhaven.cc/orig/${prefix}/${id}.jpg`,
      small: `https://th.wallhaven.cc/small/${prefix}/${id}.jpg`,
    },
    ...over,
  };
}

/** A page of Results with these ids, `current` of `last`. */
function page(ids: string[], current = 1, last = 1): SearchPage {
  return {
    results: ids.map((id) => result(id)),
    meta: {
      current_page: current,
      last_page: last,
      per_page: 24,
      total: ids.length * last,
      seed: null,
    },
  };
}

function failure(kind: AppError["kind"], message: string): Promise<never> {
  return Promise.reject({ kind, message } satisfies AppError);
}

const cards = () => screen.queryAllByRole("gridcell");
const pageCount = () =>
  document.querySelector('[data-slot="page-count"]')?.textContent ?? null;
const ratioPill = () => screen.getByLabelText("Ratio");

async function chooseRatio(name: string) {
  await press("Enter", { target: ratioPill() });
  await press("Enter", { target: screen.getByRole("option", { name }) });
}

beforeEach(() => {
  searches = [];
  answer = () => page(["qrow67", "jedzym"]);
  mockBootedApp();
  mockCommand("wallhaven_search", (args) => {
    searches.push(args.params);
    return answer(args.params);
  });
});

afterEach(() => {
  cleanup();
  viewportWidth(1024);
});

test("the first visit searches with the remembered filters and the Screen's ratio", async () => {
  mockCommand("get_settings", () =>
    settings({
      screen: { width: 2560, height: 1440 },
      // Never prefilled into `atleast`: a Result's size is the curator's call.
      minimum_resolution: { width: 3840, height: 2160 },
      discover_filters: {
        purity: { sfw: true, sketchy: true, nsfw: false },
        categories: { general: false, anime: true, people: false },
        sorting: "toplist",
        order: "asc",
        top_range: "1y",
      },
    }),
  );

  await renderInApp(<DiscoverView />);

  expect(searches).toEqual([
    {
      q: "",
      purity: { sfw: true, sketchy: true, nsfw: false },
      categories: { general: false, anime: true, people: false },
      sorting: "toplist",
      order: "asc",
      top_range: "1y",
      ratios: ["16x9"],
      page: undefined,
      seed: undefined,
    },
  ]);
  expect(searches[0].atleast).toBeUndefined();
  expect(ratioPill().textContent).toBe("16:9 · Screen");
  expect(cards()).toHaveLength(2);
});

test("a toplist range is only sent with the toplist sort", async () => {
  // The defaults: Wallhaven's own newest-first, and a range kept for later.
  await renderInApp(<DiscoverView />);

  expect(searches[0].sorting).toBe("date_added");
  expect(searches[0].top_range).toBeUndefined();
});

test("a Screen of an unusual size searches the nearest of Wallhaven's ratios", async () => {
  mockCommand("get_settings", () =>
    settings({ screen: { width: 3440, height: 1440 } }),
  );

  await renderInApp(<DiscoverView />);

  expect(searches[0].ratios).toEqual(["21x9"]);
  expect(ratioPill().textContent).toBe("21:9 · Screen");
});

test("a card shows its lg thumbnail and its facts in the caption", async () => {
  answer = () => ({
    ...page([]),
    results: [result("qrow67", { favorites: 19_400, category: "general" })],
  });

  await renderInApp(<DiscoverView />);

  const [card] = cards();
  expect(card.querySelector("img")?.getAttribute("src")).toBe(
    "https://th.wallhaven.cc/lg/qr/qrow67.jpg",
  );
  const caption = card.querySelector("figcaption")?.textContent ?? "";
  expect(caption).toContain("3840x2160");
  expect(caption).toContain("10 MB");
  expect(caption).toContain("19.4k · general");
});

test("a Result the library holds and one the curator rejected are marked, dimmed and greyscale", async () => {
  // Marked, not hidden: every page keeps its 24 and the curator's earlier
  // judgement stays visible (ADR 0050). The mark sits in the caption where
  // Pick and Download go, and neither is offered.
  answer = () => ({
    ...page([]),
    results: [
      result("inlib1", { mark: "in_library" }),
      result("rejct1", { mark: "rejected" }),
      result("fresh1"),
    ],
  });

  await renderInApp(<DiscoverView />);

  const [held, rejected, fresh] = cards();
  expect(held.querySelector("figcaption")?.textContent).toContain(
    "In library",
  );
  expect(rejected.querySelector("figcaption")?.textContent).toContain(
    "You rejected this",
  );
  expect(held.getAttribute("aria-label")).toContain("In library");
  expect(rejected.getAttribute("aria-label")).toContain("You rejected this");
  for (const marked of [held, rejected]) {
    const picture = marked.querySelector("img") as HTMLImageElement;
    expect(picture.className).toContain("opacity-60");
    expect(picture.className).toContain("grayscale");
    // Full size, with its facts still under it.
    expect(marked.querySelector("figcaption")?.textContent).toContain(
      "3840x2160",
    );
    expect(marked.querySelectorAll("button")).toHaveLength(0);
    expect(marked.textContent).not.toMatch(/Pick|Download/);
  }

  const picture = fresh.querySelector("img") as HTMLImageElement;
  expect(picture.className).not.toContain("grayscale");
  expect(fresh.textContent).not.toContain("In library");
  expect(fresh.textContent).not.toContain("You rejected this");
});

test("a thumbnail that fails to load reads as a preview problem, not a gone file", async () => {
  await renderInApp(<DiscoverView />);

  const [first] = cards();
  await act(async () => {
    fireEvent.error(first.querySelector("img") as HTMLImageElement);
  });

  expect(first.textContent).toContain("Couldn't load preview");
  expect(document.body.textContent).not.toContain("File is gone");
  expect(cards()[1].textContent).not.toContain("Couldn't load preview");
});

test("Load more asks for the next page, appends it and counts the pages", async () => {
  answer = (params) =>
    params.page === 2 ? page(["b1b1b1"], 2, 3) : page(["a1a1a1"], 1, 3);

  await renderInApp(<DiscoverView />);
  expect(pageCount()).toBe("Page 1 of 3");

  await click(screen.getByRole("button", { name: "Load more" }));

  expect(searches.map((s) => s.page)).toEqual([undefined, 2]);
  expect(searches[1].ratios).toEqual(["16x9"]);
  expect(cards()).toHaveLength(2);
  expect(pageCount()).toBe("Page 2 of 3");
});

test("the last page offers no Load more", async () => {
  answer = () => page(["a1a1a1"], 1, 1);

  await renderInApp(<DiscoverView />);

  expect(pageCount()).toBe("Page 1 of 1");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("Load more's failure keeps the Results and puts Retry where the button was", async () => {
  let failNext = true;
  answer = (params) => {
    if (params.page === 2 && failNext) {
      failNext = false;
      return failure(
        "rate_limited",
        "Wallhaven's rate limit was reached. Try again in 37 seconds.",
      );
    }
    return params.page === 2 ? page(["b1b1b1"], 2, 3) : page(["a1a1a1"], 1, 3);
  };

  await renderInApp(<DiscoverView />);
  await click(screen.getByRole("button", { name: "Load more" }));

  expect(cards()).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toContain(
    "Try again in 37 seconds.",
  );
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

  await click(screen.getByRole("button", { name: "Retry" }));

  expect(searches.map((s) => s.page)).toEqual([undefined, 2, 2]);
  expect(cards()).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(pageCount()).toBe("Page 2 of 3");
});

test("a first search's error replaces the Results inline, and Retry searches again", async () => {
  for (const [kind, message] of [
    ["network", "Wallhaven took too long to answer."],
    ["network", "Wallhaven's Cloudflare check stopped the search."],
    ["network", "Wallhaven is having trouble (HTTP 503)."],
    ["rate_limited", "Wallhaven's rate limit was reached. Try again in 9 seconds."],
  ] as const) {
    let failed = false;
    answer = () => {
      if (failed) return page(["a1a1a1"]);
      failed = true;
      return failure(kind, message);
    };

    await renderInApp(<DiscoverView />);

    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(cards()).toHaveLength(0);
    // Inline, and no toast about it.
    expect(document.querySelectorAll("[data-slot='toast']")).toHaveLength(0);

    await click(screen.getByRole("button", { name: "Retry" }));
    expect(cards()).toHaveLength(1);
    cleanup();
  }
});

test("an empty page with a ratio set offers Any ratio, and without one Clear search", async () => {
  answer = () => page([]);

  await renderInApp(<DiscoverView />);
  expect(document.body.textContent).toContain("Nothing on Wallhaven matches");

  await click(screen.getByRole("button", { name: "Any ratio" }));
  expect(searches[1].ratios).toBeUndefined();
  expect(ratioPill().textContent).toBe("Any ratio");

  // Still nothing, and now the words are what to change.
  fireEvent.change(screen.getByLabelText("Search Wallhaven"), {
    target: { value: "zzzz" },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("search"));
  });
  await flush();
  expect(searches[2].q).toBe("zzzz");

  await click(screen.getByRole("button", { name: "Clear search" }));
  expect(searches[3].q).toBe("");
  expect(
    (screen.getByLabelText("Search Wallhaven") as HTMLInputElement).value,
  ).toBe("");
});

test("the search box sends the query verbatim, Wallhaven's syntax included", async () => {
  await renderInApp(<DiscoverView />);

  fireEvent.change(screen.getByLabelText("Search Wallhaven"), {
    target: { value: "like:qrow67 +forest -city" },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("search"));
  });
  await flush();

  expect(searches[1].q).toBe("like:qrow67 +forest -city");
  expect(searches[1].page).toBeUndefined();
});

test("the Ratio pill offers the Screen's, the common ones and Any ratio", async () => {
  await renderInApp(<DiscoverView />);

  await press("Enter", { target: ratioPill() });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "16:9 · Screen",
    "16:10",
    "21:9",
    "32:9",
    "9:16",
    "Any ratio",
  ]);
  await press("Enter", { target: screen.getByRole("option", { name: "21:9" }) });

  expect(searches[1].ratios).toEqual(["21x9"]);
  expect(ratioPill().textContent).toBe("21:9");

  await chooseRatio("Any ratio");
  expect(searches[2].ratios).toBeUndefined();
});

test("the ratio goes back to the Screen's when Discover mounts again", async () => {
  await renderInApp(<DiscoverView />);
  await chooseRatio("21:9");
  expect(ratioPill().textContent).toBe("21:9");
  cleanup();

  await renderInApp(<DiscoverView />);

  expect(searches.map((s) => s.ratios)).toEqual([["16x9"], ["21x9"], ["16x9"]]);
  expect(ratioPill().textContent).toBe("16:9 · Screen");
});

test("Enter on a card opens nothing yet, and is left to the page", async () => {
  await renderInApp(<DiscoverView />);
  await act(async () => {
    (cards()[0] as HTMLElement).focus();
  });

  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    cards()[0].dispatchEvent(event);
  });

  expect(event.defaultPrevented).toBe(false);
});

test("Ctrl and the wheel move through Discover's two to five a row", async () => {
  viewportWidth(1920);
  answer = () => page(Array.from({ length: 12 }, (_, i) => `r${i}0000`));
  await renderInApp(<DiscoverView />);
  const grid = screen.getByRole("grid");

  const inARow = async () => {
    await act(async () => {
      (cards()[0] as HTMLElement).focus();
    });
    await press("Home");
    await press("ArrowDown");
    return Number(document.activeElement?.getAttribute("data-cell"));
  };

  expect(await inARow()).toBe(3);
  for (let i = 0; i < 6; i++) await ctrlWheel(grid, 1);
  expect(await inARow()).toBe(5);
  for (let i = 0; i < 6; i++) await ctrlWheel(grid, -1);
  expect(await inARow()).toBe(2);
});

// The filter pills (#340). Each one opens a menu, and every change is a new
// search with it.

const pill = (name: string) => screen.getByLabelText(name);
// Named by the way it runs, so a screen reader hears the state and not a label.
const orderPill = () =>
  screen.getByRole("button", { name: /^(Descending|Ascending)$/ });

async function openPill(name: string) {
  await press("Enter", { target: pill(name) });
}

test("the Sort pill offers all seven sortings, and a choice searches with it", async () => {
  await renderInApp(<DiscoverView />);
  expect(pill("Sort").textContent).toBe("Date added");

  await openPill("Sort");
  expect(
    screen.getAllByRole("menuitemradio").map((o) => o.textContent),
  ).toEqual([
    "Date added",
    "Relevance",
    "Random",
    "Views",
    "Favourites",
    "Toplist",
    "Hot",
  ]);
  await click(screen.getByRole("menuitemradio", { name: "Views" }));

  expect(searches[1].sorting).toBe("views");
  expect(searches[1].top_range).toBeUndefined();
  expect(pill("Sort").textContent).toBe("Views");
  expect(screen.queryByRole("menu")).toBeNull();
});

test("the toplist range is picked inside the Sort menu, and only for Toplist", async () => {
  await renderInApp(<DiscoverView />);

  await openPill("Sort");
  expect(screen.queryByRole("menuitemradio", { name: "1y" })).toBeNull();

  // Choosing Toplist searches with the range it already has, and leaves the
  // menu open on the ranges.
  await click(screen.getByRole("menuitemradio", { name: "Toplist" }));
  expect(searches[1].sorting).toBe("toplist");
  expect(searches[1].top_range).toBe("1M");
  expect(pill("Sort").textContent).toBe("Toplist · 1M");

  await click(screen.getByRole("menuitemradio", { name: "1y" }));
  expect(searches[2].top_range).toBe("1y");
  expect(pill("Sort").textContent).toBe("Toplist · 1y");

  // Away from Toplist, the range is neither sent nor offered.
  await openPill("Sort");
  await click(screen.getByRole("menuitemradio", { name: "Hot" }));
  expect(searches[3].top_range).toBeUndefined();
  await openPill("Sort");
  expect(screen.queryByRole("menuitemradio", { name: "1y" })).toBeNull();
});

test("the Order control beside Sort flips which way the sort runs", async () => {
  await renderInApp(<DiscoverView />);
  expect(orderPill().textContent).toBe("Descending");

  await click(orderPill());
  expect(searches[1].order).toBe("asc");
  expect(orderPill().textContent).toBe("Ascending");

  await click(orderPill());
  expect(searches[2].order).toBe("desc");
});

test("the Categories pill ticks General, Anime and People, and never all off", async () => {
  await renderInApp(<DiscoverView />);
  expect(pill("Categories").textContent).toBe("All categories");

  await openPill("Categories");
  expect(
    screen.getAllByRole("menuitemcheckbox").map((o) => o.textContent),
  ).toEqual(["General", "Anime", "People"]);
  await click(screen.getByRole("menuitemcheckbox", { name: "Anime" }));

  expect(searches[1].categories).toEqual({
    general: true,
    anime: false,
    people: true,
  });
  expect(pill("Categories").textContent).toBe("General, People");
  // Still open, so a second box is one more click.
  await click(screen.getByRole("menuitemcheckbox", { name: "People" }));
  expect(searches[2].categories).toEqual({
    general: true,
    anime: false,
    people: false,
  });

  // The backend refuses a search with none, so the last one stays on.
  const general = screen.getByRole("menuitemcheckbox", { name: "General" });
  expect(general.getAttribute("aria-disabled")).toBe("true");
  await click(general);
  expect(searches).toHaveLength(3);
});

test("the Purity pill ticks SFW and Sketchy, and NSFW waits for an API key", async () => {
  await renderInApp(<DiscoverView />);
  expect(pill("Purity").textContent).toBe("SFW");

  await openPill("Purity");
  await click(screen.getByRole("menuitemcheckbox", { name: "Sketchy" }));
  expect(searches[1].purity).toEqual({ sfw: true, sketchy: true, nsfw: false });
  expect(pill("Purity").textContent).toBe("SFW + Sketchy");

  const nsfw = screen.getByRole("menuitemcheckbox", { name: /NSFW/ });
  expect(nsfw.getAttribute("aria-disabled")).toBe("true");
  expect(nsfw.textContent).toContain("Add an API key in Settings");
  await click(nsfw);
  expect(searches).toHaveLength(2);
});

test("the Colour pill offers Wallhaven's 29 and can be cleared", async () => {
  answer = (params) =>
    params.page === 2 ? page(["b1b1b1"], 2, 2) : page(["a1a1a1"], 1, 2);
  await renderInApp(<DiscoverView />);
  expect(searches[0].colors).toBeUndefined();
  expect(pill("Colour").textContent).toBe("Any colour");

  await openPill("Colour");
  const swatches = screen
    .getAllByRole("menuitemradio")
    .map((o) => o.getAttribute("aria-label") ?? o.textContent);
  expect(swatches).toHaveLength(30);
  expect(swatches[0]).toBe("Any colour");
  expect(new Set(swatches.slice(1)).size).toBe(29);
  await click(screen.getByRole("menuitemradio", { name: "#424153" }));

  expect(searches[1].colors).toBe("424153");
  expect(pill("Colour").textContent).toBe("Colour");

  // Load more keeps it, as it keeps every filter.
  await click(screen.getByRole("button", { name: "Load more" }));
  expect(searches[2].colors).toBe("424153");

  await openPill("Colour");
  await click(screen.getByRole("menuitemradio", { name: "Any colour" }));
  expect(searches[3].colors).toBeUndefined();
  expect(pill("Colour").textContent).toBe("Any colour");
});

test("every pill starts from the remembered filters", async () => {
  mockCommand("get_settings", () =>
    settings({
      discover_filters: {
        purity: { sfw: false, sketchy: true, nsfw: false },
        categories: { general: false, anime: true, people: false },
        sorting: "toplist",
        order: "asc",
        top_range: "1w",
      },
    }),
  );

  await renderInApp(<DiscoverView />);

  expect(pill("Sort").textContent).toBe("Toplist · 1w");
  expect(orderPill().textContent).toBe("Ascending");
  expect(pill("Categories").textContent).toBe("Anime");
  expect(pill("Purity").textContent).toBe("Sketchy");

  // A change carries the rest of them along.
  await openPill("Categories");
  await click(screen.getByRole("menuitemcheckbox", { name: "People" }));
  expect(searches[1]).toMatchObject({
    purity: { sfw: false, sketchy: true, nsfw: false },
    categories: { general: false, anime: true, people: true },
    sorting: "toplist",
    order: "asc",
    top_range: "1w",
  });
});

test("scrolling collapses the header into a sticky strip, and the top expands it", async () => {
  await renderInApp(<DiscoverView />);
  const scroller = document.querySelector(
    '[data-slot="discover-page"]',
  ) as HTMLElement;
  const header = () =>
    document.querySelector('[data-slot="discover-header"]') as HTMLElement;
  const scrollTo = async (top: number) => {
    await act(async () => {
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
    });
  };
  expect(header().dataset.collapsed).toBe("false");

  await scrollTo(600);
  expect(header().dataset.collapsed).toBe("true");

  // Both halves are still there and still work.
  fireEvent.change(screen.getByLabelText("Search Wallhaven"), {
    target: { value: "forest" },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("search"));
  });
  await flush();
  expect(searches[1].q).toBe("forest");

  await scrollTo(600);
  await openPill("Sort");
  await click(screen.getByRole("menuitemradio", { name: "Views" }));
  expect(searches[2].sorting).toBe("views");

  await scrollTo(600);
  expect(header().dataset.collapsed).toBe("true");
  await scrollTo(0);
  expect(header().dataset.collapsed).toBe("false");
});
