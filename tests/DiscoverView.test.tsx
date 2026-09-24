import { DiscoverView } from "@/components/DiscoverView";
import { useAppEvent, type AppEvent } from "@/context/AppEventsContext";
import {
  WALLHAVEN_COLOURS,
  type AppError,
  type DownloadOutcome,
  type SearchPage,
  type SearchParams,
  type MarkedResult,
} from "@/lib/client";
import { useApp } from "@/context/AppContext";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  click,
  ctrlWheel,
  currentView,
  flush,
  mockBootedApp,
  press,
  renderInApp,
  settings,
  stats,
  viewportWidth,
} from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

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
const ratioPill = () => screen.getByLabelText(/^Ratio: /);

async function chooseRatio(name: string) {
  await press("Enter", { target: ratioPill() });
  await press("Enter", { target: screen.getByRole("option", { name }) });
}

/** Every download the page asked for, in order, as the wire carries it. */
let downloads: string[][];

beforeEach(() => {
  searches = [];
  downloads = [];
  answer = () => page(["qrow67", "jedzym"]);
  mockBootedApp();
  mockCommand("wallhaven_search", (args) => {
    searches.push(args.params);
    return answer(args.params);
  });
  mockCommand("wallhaven_download", (args) => {
    downloads.push(args.ids);
    return null;
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

/** A pill, by what it filters: its name also says what it is set to. */
const pill = (name: string) => screen.getByLabelText(new RegExp(`^${name}: `));
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
  expect(pill("Sort").getAttribute("aria-label")).toBe("Sort: Views");
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

test("with a key saved, NSFW can be ticked and is searched with", async () => {
  mockCommand("get_settings", () => settings({ wallhaven_key_set: true }));
  await renderInApp(<DiscoverView />);

  await openPill("Purity");
  const nsfw = screen.getByRole("menuitemcheckbox", { name: "NSFW" });
  expect(nsfw.getAttribute("aria-disabled")).toBeNull();
  expect(nsfw.textContent).not.toContain("Add an API key");
  await click(nsfw);

  expect(searches[1].purity).toEqual({ sfw: true, sketchy: false, nsfw: true });
  expect(pill("Purity").textContent).toBe("SFW + NSFW");
});

/** A control that removes the key the way Settings' Remove does. */
function RemoveKey() {
  const { saveWallhavenKey } = useApp();
  return (
    <button type="button" onClick={() => void saveWallhavenKey("")}>
      Remove key
    </button>
  );
}

/** A control that saves a key the way Settings' Save does. */
function SaveKey() {
  const { saveWallhavenKey } = useApp();
  return (
    <button type="button" onClick={() => void saveWallhavenKey("abc123")}>
      Save key
    </button>
  );
}

test("saving a key in the same session enables NSFW on Discover", async () => {
  mockCommand("set_wallhaven_key", () => ({
    settings: settings({ wallhaven_key_set: true }),
    verified: true,
  }));
  await renderInApp(
    <>
      <SaveKey />
      <DiscoverView />
    </>,
  );

  await click(screen.getByRole("button", { name: "Save key" }));
  await openPill("Purity");

  const nsfw = screen.getByRole("menuitemcheckbox", { name: "NSFW" });
  expect(nsfw.getAttribute("aria-disabled")).toBeNull();
  await click(nsfw);
  expect(searches[1].purity).toEqual({ sfw: true, sketchy: false, nsfw: true });
});

test("removing the key drops NSFW from the pills without searching again", async () => {
  mockCommand("get_settings", () =>
    settings({
      wallhaven_key_set: true,
      discover_filters: {
        ...settings().discover_filters,
        purity: { sfw: false, sketchy: true, nsfw: true },
      },
    }),
  );
  mockCommand("set_wallhaven_key", () => ({
    settings: settings({ wallhaven_key_set: false }),
    verified: true,
  }));
  await renderInApp(
    <>
      <RemoveKey />
      <DiscoverView />
    </>,
  );
  expect(pill("Purity").textContent).toBe("Sketchy + NSFW");

  await click(screen.getByRole("button", { name: "Remove key" }));

  expect(pill("Purity").textContent).toBe("Sketchy");
  expect(searches).toHaveLength(1);
  await click(orderPill());
  expect(searches[1].purity).toEqual({
    sfw: false,
    sketchy: true,
    nsfw: false,
  });
});

test("a saved key Wallhaven rejects is said inline, with the way to Settings", async () => {
  const message =
    "Wallhaven rejected the saved API key. Replace or remove it in Settings.";
  mockCommand("get_settings", () => settings({ wallhaven_key_set: true }));
  answer = () => failure("key_rejected", message);

  await renderInApp(<DiscoverView />);

  expect(screen.getByRole("alert").textContent).toContain(message);
  expect(cards()).toHaveLength(0);
  // One search, and no anonymous one behind it.
  expect(searches).toHaveLength(1);
  expect(document.querySelectorAll("[data-slot='toast']")).toHaveLength(0);

  await click(screen.getByRole("button", { name: "Open Settings" }));
  expect(currentView()).toBe("settings");
});

test("a key rejected on Load more keeps the Results and offers Settings beside Retry", async () => {
  mockCommand("get_settings", () => settings({ wallhaven_key_set: true }));
  answer = (params) =>
    params.page === 2
      ? failure("key_rejected", "Wallhaven rejected the saved API key.")
      : page(["qrow67", "jedzym"], 1, 3);
  await renderInApp(<DiscoverView />);

  await click(screen.getByRole("button", { name: "Load more" }));

  expect(cards()).toHaveLength(2);
  expect(screen.getByRole("alert").textContent).toContain(
    "rejected the saved API key",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  await click(screen.getByRole("button", { name: "Open Settings" }));
  expect(currentView()).toBe("settings");
});

test("any other failure offers no way to Settings", async () => {
  answer = () => failure("network", "Wallhaven took too long to answer.");

  await renderInApp(<DiscoverView />);

  expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
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
  await click(screen.getByRole("menuitemradio", { name: "Slate (#424153)" }));

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

test("the colours are exactly the ones the backend accepts", async () => {
  // Two copies of one list, and a colour in only one of them is either never
  // offered or refused when chosen.
  const rust = await Bun.file(
    new URL("../src-tauri/src/wallhaven.rs", import.meta.url),
  ).text();
  const list = /const COLOURS: \[&str; 29\] = \[([^\]]*)\]/.exec(rust)?.[1];
  expect(list).toBeDefined();
  const backend = [...(list ?? "").matchAll(/"([0-9a-f]{6})"/g)].map(
    ([, hex]) => hex,
  );
  expect(backend).toEqual([...WALLHAVEN_COLOURS]);
});

test("the arrows walk the swatches as a grid of eight a row", async () => {
  await renderInApp(<DiscoverView />);
  await openPill("Colour");
  const swatches = screen
    .getAllByRole("menuitemradio")
    .filter((o) => o.hasAttribute("aria-label"));
  const focused = () => swatches.indexOf(document.activeElement as HTMLElement);
  await act(async () => {
    swatches[0].focus();
  });

  await press("ArrowRight");
  expect(focused()).toBe(1);
  await press("ArrowDown");
  expect(focused()).toBe(9);
  await press("ArrowLeft");
  expect(focused()).toBe(8);
  await press("ArrowDown");
  await press("ArrowDown");
  expect(focused()).toBe(24);
  // The last row holds five, so Down from past its end lands on the last one.
  await press("ArrowUp");
  await press("ArrowRight");
  await press("ArrowRight");
  await press("ArrowRight");
  await press("ArrowRight");
  await press("ArrowRight");
  expect(focused()).toBe(21);
  await press("ArrowDown");
  expect(focused()).toBe(28);

  // Up out of the top row is Any colour.
  await act(async () => {
    swatches[3].focus();
  });
  await press("ArrowUp");
  expect(document.activeElement?.textContent).toBe("Any colour");
});

test("a resize while collapsed measures the expanded header again", async () => {
  const observers: ResizeObserverCallback[] = [];
  const Real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    await renderInApp(<DiscoverView />);
    const scroller = document.querySelector(
      '[data-slot="discover-page"]',
    ) as HTMLElement;
    const header = document.querySelector(
      '[data-slot="discover-header"]',
    ) as HTMLElement;
    // happy-dom lays nothing out, so the header says how tall it is: the
    // strip's height collapsed, and the expanded one the pills wrap to.
    let expanded = 200;
    Object.defineProperty(header, "offsetHeight", {
      get: () => (header.dataset.collapsed === "true" ? 44 : expanded),
    });
    await act(async () => {
      scroller.scrollTop = 600;
      fireEvent.scroll(scroller);
    });
    expect(header.dataset.collapsed).toBe("true");
    expect(header.style.marginBottom).toBe("156px");

    // A narrower window wraps the pills onto another row.
    expanded = 240;
    await act(async () => {
      for (const callback of observers) {
        callback(
          [{ contentRect: { width: 800 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      }
    });

    expect(header.dataset.collapsed).toBe("true");
    expect(header.style.marginBottom).toBe("196px");
  } finally {
    globalThis.ResizeObserver = Real;
  }
});

// Downloading. The backend is mocked at `wallhaven_download` and its two
// events are emitted the way download.rs emits them, so what a card says is
// what the page reads off the wire (#343).

/** A library with a root, which is what lets anything be downloaded. */
function withLibraryRoot() {
  mockCommand("get_settings", () => settings({ library_root: "/pics" }));
}

const caption = (card: Element) =>
  card.querySelector("figcaption")?.textContent ?? "";
const downloadButton = (card: Element) =>
  card.querySelector<HTMLElement>('button[aria-label^="Download"]');
const picture = (card: Element) => card.querySelector("img") as HTMLElement;

/** The toast that is up: its title and description, or `null`. */
function toast(): { title: string; description: string | null } | null {
  const root = document.querySelector("[data-slot='toast']");
  if (!root) return null;
  return {
    title: root.querySelector("[data-slot='toast-title']")?.textContent ?? "",
    description:
      root.querySelector("[data-slot='toast-description']")?.textContent ?? null,
  };
}

/** One file done, as `download-progress` carries it. */
async function fileDone(
  id: string,
  outcome: DownloadOutcome,
  counts = { total: 1, landed: 0, failed: 0 },
) {
  await act(async () => {
    emitEvent("download-progress", {
      ...counts,
      item: { wallhaven_id: id, outcome },
    });
  });
  await flush();
}

test("Download queues the Result, and its caption follows the file into the library", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();

  await click(downloadButton(first)!);
  await click(downloadButton(second)!);

  // One at a time, in the order asked: the first is on the wire and the
  // second waits behind it.
  expect(downloads).toEqual([["qrow67"], ["jedzym"]]);
  expect(caption(first)).toContain("Downloading");
  expect(caption(second)).toContain("Queued");
  expect(downloadButton(first)).toBeNull();
  expect(downloadButton(second)).toBeNull();

  await fileDone("qrow67", { kind: "landed" }, { total: 2, landed: 1, failed: 0 });

  // Added, and an In library card from here on: dimmed, and nothing to
  // download again.
  expect(caption(first)).toContain("Added to library");
  expect(first.getAttribute("aria-label")).toContain("Added to library");
  expect(picture(first).className).toContain("grayscale");
  expect(downloadButton(first)).toBeNull();
  expect(caption(second)).toContain("Downloading");
});

test("a failed file reads Failed, with the reason as its tooltip, and can be downloaded again", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first] = cards();
  await click(downloadButton(first)!);

  await fileDone(
    "qrow67",
    { kind: "failed", message: "The download broke off (connection reset)." },
    { total: 1, landed: 0, failed: 1 },
  );

  const failed = first.querySelector('[data-slot="result-download"]');
  expect(failed?.textContent).toBe("Failed");
  expect(failed?.getAttribute("title")).toBe(
    "The download broke off (connection reset).",
  );
  // Nothing reached the library, so the card is still an unmarked one.
  expect(picture(first).className).not.toContain("grayscale");

  await click(downloadButton(first)!);

  expect(downloads).toEqual([["qrow67"], ["qrow67"]]);
  expect(caption(first)).toContain("Downloading");
  expect(caption(first)).not.toContain("Failed");
});

test("D downloads the Result under the cursor, and leaves a marked one alone", async () => {
  withLibraryRoot();
  answer = () => ({
    ...page([]),
    results: [result("fresh1"), result("inlib1", { mark: "in_library" })],
  });
  await renderInApp(<DiscoverView />);
  const [fresh, held] = cards();

  await act(async () => {
    (fresh as HTMLElement).focus();
  });
  await press("d");

  expect(downloads).toEqual([["fresh1"]]);
  expect(caption(fresh)).toContain("Downloading");

  // A second press on the one already downloading asks for nothing more.
  await press("D");
  expect(downloads).toEqual([["fresh1"]]);

  // A marked Result offers no Download, so its key is not answered at all.
  await press("ArrowRight");
  expect(document.activeElement).toBe(held);
  const event = new KeyboardEvent("keydown", {
    key: "d",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    held.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(downloads).toEqual([["fresh1"]]);
});

test("with no Library root, Download is refused up front and opens the root's field", async () => {
  const asked: { focus: string | null } = { focus: null };
  function FocusProbe() {
    asked.focus = useApp().focus;
    return null;
  }
  await renderInApp(
    <>
      <FocusProbe />
      <DiscoverView />
    </>,
  );
  const [first] = cards();

  // Browsing still works; only the download says what it needs.
  expect(caption(first)).toContain("Choose a library root to download");
  expect(downloadButton(first)).toBeNull();

  await click(screen.getAllByRole("button", { name: /choose a library root/i })[0]);

  expect(downloads).toEqual([]);
  expect(currentView()).toBe("settings");
  expect(asked.focus).toBe("library_root");
});

test("a download refused at the click says why, and the card offers Download again", async () => {
  withLibraryRoot();
  mockCommand("wallhaven_download", () =>
    failure(
      "invalid_path",
      "The library root /pics is not there, so nothing can be downloaded",
    ),
  );
  await renderInApp(<DiscoverView />);
  const [first] = cards();

  await click(downloadButton(first)!);

  expect(toast()).toEqual({
    title: "Couldn't download",
    description:
      "The library root /pics is not there, so nothing can be downloaded",
  });
  expect(downloadButton(first)).not.toBeNull();
  expect(caption(first)).not.toContain("Downloading");

  // Nothing was queued, so no report of a batch ever opened underneath.
  await click(
    document.querySelector<HTMLElement>("[data-slot='toast-close']")!,
  );
  expect(toast()).toBeNull();
});

test("a batch's ending leaves alone a Result clicked after the backend closed it", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  await click(downloadButton(first)!);
  await fileDone("qrow67", { kind: "landed" });

  // The backend has already closed that batch when this click reaches it, so
  // its ending arrives while the second file is on the wire.
  await click(downloadButton(second)!);
  await act(async () => {
    emitEvent("download-complete", {
      total: 1,
      landed: 1,
      failed: 0,
      first_error: null,
    });
  });
  await flush();

  expect(caption(second)).toContain("Downloading");
  expect(downloadButton(second)).toBeNull();
});

test("a batch clicked before the last one's ending still says when it sent the Round back", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  // Round 3 at the first click, and the first file fails, so nothing moves.
  await click(downloadButton(first)!);
  await fileDone(
    "qrow67",
    { kind: "failed", message: "gone" },
    { total: 1, landed: 0, failed: 1 },
  );
  await click(downloadButton(second)!);
  await act(async () => {
    emitEvent("download-complete", {
      total: 1,
      landed: 0,
      failed: 1,
      first_error: "gone",
    });
  });
  await flush();

  // The second batch started without a click of its own being first, and is
  // still judged against the Round it started from.
  mockCommand("get_stats", () => stats({ round: 1 }));
  await fileDone("jedzym", { kind: "landed" });
  await act(async () => {
    emitEvent("download-complete", {
      total: 1,
      landed: 1,
      failed: 0,
      first_error: null,
    });
  });
  await flush();

  expect(toast()).toEqual({
    title: "1 wallpaper downloaded",
    description: "Back to Round 1. The new wallpapers have no comparisons yet.",
  });
});

test("a new search drops the captions of downloads it replaced", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  await click(downloadButton(cards()[0])!);
  await click(downloadButton(cards()[1])!);
  await fileDone("qrow67", { kind: "landed" });
  await fileDone("jedzym", { kind: "failed", message: "gone" });

  // The search marks the landed one itself, and the failed one is a plain
  // card again.
  answer = () => ({
    ...page([]),
    results: [result("qrow67", { mark: "in_library" }), result("jedzym")],
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("search"));
  });
  await flush();

  const [held, fresh] = cards();
  expect(caption(held)).toContain("In library");
  expect(caption(held)).not.toContain("Added to library");
  expect(caption(fresh)).not.toContain("Failed");
  expect(downloadButton(fresh)).not.toBeNull();
});

test("each file that lands refreshes the library and the headline, as a scan would", async () => {
  withLibraryRoot();
  const heard: AppEvent[] = [];
  function Listener() {
    useAppEvent((event) => heard.push(event));
    return null;
  }
  await renderInApp(
    <>
      <Listener />
      <DiscoverView />
    </>,
  );
  mockCommand("get_stats", () => stats({ round: 1, total_wallpapers: 13 }));
  await click(downloadButton(cards()[0])!);

  await fileDone("qrow67", { kind: "landed" });

  expect(heard).toEqual([
    { type: "library-scanned", added: 1 },
    { type: "stats-changed", stats: stats({ round: 1, total_wallpapers: 13 }) },
  ]);

  // A file that failed changed nothing, and says nothing to the library.
  heard.length = 0;
  await click(downloadButton(cards()[1])!);
  await fileDone("jedzym", { kind: "failed", message: "gone" });
  expect(heard).toEqual([]);
});

// Picks and the tray (#344). A Pick is a Result the curator has chosen for the
// next download: they gather across searches, and a download clears them.

const pickButton = (card: Element) =>
  card.querySelector<HTMLElement>('button[aria-label^="Pick"]');
const tray = () => screen.queryByRole("region", { name: "Picks" });
const trayThumbnails = () =>
  [...(tray()?.querySelectorAll("img") ?? [])].map((img) =>
    img.getAttribute("src"),
  );

async function focusCard(card: Element) {
  await act(async () => {
    (card as HTMLElement).focus();
  });
}

/** A keydown on `target`, and whether anything answered it. */
async function answered(key: string, target: Element): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await flush();
  return event.defaultPrevented;
}

test("P and the Pick button toggle a Pick, and a marked Result can't be picked", async () => {
  withLibraryRoot();
  answer = () => ({
    ...page([]),
    results: [
      result("fresh1"),
      result("fresh2"),
      result("inlib1", { mark: "in_library" }),
    ],
  });
  await renderInApp(<DiscoverView />);
  const [first, second, held] = cards();
  expect(tray()).toBeNull();

  await click(pickButton(first)!);

  expect(pickButton(first)?.getAttribute("aria-pressed")).toBe("true");
  expect(caption(first)).toContain("Picked");
  expect(first.getAttribute("aria-label")).toContain("Picked");
  expect(tray()?.textContent).toContain("1 picked");

  // The cursor, and not the focused node, is what a key acts on.
  await focusCard(first);
  await press("ArrowRight");
  await press("p");
  expect(tray()?.textContent).toContain("2 picked");
  await press("P");
  expect(tray()?.textContent).toContain("1 picked");
  expect(pickButton(second)?.getAttribute("aria-pressed")).toBe("false");

  // A marked Result offers no Pick, so its key is not answered at all.
  expect(pickButton(held)).toBeNull();
  await press("ArrowRight");
  expect(document.activeElement).toBe(held);
  expect(await answered("p", held)).toBe(false);
  expect(tray()?.textContent).toContain("1 picked");

  // Nor does a Result already on its way to the library.
  await click(downloadButton(second)!);
  expect(pickButton(second)).toBeNull();
});

test("the tray shows the Picks' thumbnails, count and total size, and Clear empties it", async () => {
  withLibraryRoot();
  answer = () => ({
    ...page([]),
    results: [
      result("qrow67", { file_size: 2_000_000 }),
      result("jedzym", { file_size: 3_500_000 }),
    ],
  });
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();

  await click(pickButton(second)!);
  await click(pickButton(first)!);

  expect(trayThumbnails()).toEqual([
    "https://th.wallhaven.cc/lg/je/jedzym.jpg",
    "https://th.wallhaven.cc/lg/qr/qrow67.jpg",
  ]);
  expect(tray()?.textContent).toContain("2 picked");
  expect(tray()?.textContent).toContain("5.5 MB");
  // There is no way to take a whole page: the curator picks one at a time.
  expect(screen.queryByRole("button", { name: /download all/i })).toBeNull();

  await click(within(tray()!).getByRole("button", { name: /clear/i }));

  expect(tray()).toBeNull();
  expect(pickButton(first)?.getAttribute("aria-pressed")).toBe("false");
  expect(downloads).toEqual([]);
});

test("the tray's Download sends every Pick in pick order, and clears them", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  await click(pickButton(second)!);
  await click(pickButton(first)!);

  await click(within(tray()!).getByRole("button", { name: /^Download/ }));

  // One request, so the two land one after the other in the order picked.
  expect(downloads).toEqual([["jedzym", "qrow67"]]);
  expect(tray()).toBeNull();
  expect(caption(second)).toContain("Downloading");
  expect(caption(first)).toContain("Queued");
});

test("D downloads the Picks when there are any, and the cursor's Result otherwise", async () => {
  withLibraryRoot();
  answer = () => ({
    ...page([]),
    results: [
      result("fresh1"),
      result("fresh2"),
      result("inlib1", { mark: "in_library" }),
    ],
  });
  await renderInApp(<DiscoverView />);
  const [first, , held] = cards();
  await focusCard(first);
  await press("ArrowRight");
  await press("p");

  // From a marked card too: with Picks, `D` is about them and not the cursor.
  await press("ArrowRight");
  expect(document.activeElement).toBe(held);
  expect(await answered("d", held)).toBe(true);

  expect(downloads).toEqual([["fresh2"]]);
  expect(tray()).toBeNull();

  // No Picks now, so `D` is the cursor's Result again.
  await press("Home");
  expect(document.activeElement).toBe(first);
  await press("d");
  expect(downloads).toEqual([["fresh2"], ["fresh1"]]);
});

test("Escape clears the Picks, and is left alone when there are none", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  await focusCard(first);
  await press("p");
  await press("ArrowRight");
  await press("p");
  expect(tray()?.textContent).toContain("2 picked");

  expect(await answered("Escape", second)).toBe(true);

  expect(tray()).toBeNull();
  expect(await answered("Escape", second)).toBe(false);
});

test("Picks survive a new search and a filter change, and download from any of them", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  await click(pickButton(cards()[0])!);

  answer = () => page(["other1", "other2"]);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Search Wallhaven"), {
      target: { value: "mountains" },
    });
    fireEvent.submit(screen.getByRole("search"));
  });
  await flush();
  await chooseRatio("Any ratio");

  expect(searches).toHaveLength(3);
  expect(tray()?.textContent).toContain("1 picked");
  expect(trayThumbnails()).toEqual([
    "https://th.wallhaven.cc/lg/qr/qrow67.jpg",
  ]);

  await click(pickButton(cards()[1])!);
  await click(within(tray()!).getByRole("button", { name: /^Download/ }));

  expect(downloads).toEqual([["qrow67", "other2"]]);
});

test("a Result the library comes to hold stops being a Pick", async () => {
  withLibraryRoot();
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  await click(pickButton(first)!);
  await click(pickButton(second)!);

  // Its own Download takes it out of the Picks, which only ever hold what is
  // still to come, and leaves the others where they are.
  await click(downloadButton(first)!);

  expect(downloads).toEqual([["qrow67"]]);
  expect(tray()?.textContent).toContain("1 picked");
  expect(trayThumbnails()).toEqual([
    "https://th.wallhaven.cc/lg/je/jedzym.jpg",
  ]);
});

test("a download of the Picks refused at the click keeps them", async () => {
  withLibraryRoot();
  mockCommand("wallhaven_download", () =>
    failure(
      "invalid_path",
      "The library root /pics is not there, so nothing can be downloaded",
    ),
  );
  await renderInApp(<DiscoverView />);
  const [first, second] = cards();
  await click(pickButton(first)!);
  await click(pickButton(second)!);

  await click(within(tray()!).getByRole("button", { name: /^Download/ }));

  expect(toast()?.title).toBe("Couldn't download");
  // Nothing was queued, so there is still everything to come.
  expect(tray()?.textContent).toContain("2 picked");
  expect(caption(first)).not.toContain("Downloading");
  expect(pickButton(first)?.getAttribute("aria-pressed")).toBe("true");
});

/** A control that clears the Library root the way Settings' field does. */
function ClearRoot() {
  const { saveSetting } = useApp();
  return (
    <button type="button" onClick={() => void saveSetting("library_root", "")}>
      Clear root
    </button>
  );
}

test("with no Library root, Pick and the tray say what's missing and open the root's field", async () => {
  withLibraryRoot();
  mockCommand("set_setting", () => settings({ library_root: "" }));
  const asked: { focus: string | null } = { focus: null };
  function FocusProbe() {
    asked.focus = useApp().focus;
    return null;
  }
  await renderInApp(
    <>
      <FocusProbe />
      <ClearRoot />
      <DiscoverView />
    </>,
  );
  const [first, second] = cards();
  await click(pickButton(first)!);

  await click(screen.getByRole("button", { name: "Clear root" }));

  // The card offers the way to a root in place of Pick and Download both.
  expect(pickButton(second)).toBeNull();
  expect(caption(second)).toContain("Choose a library root to download");
  // The tray keeps its Picks, and says the same where its Download was.
  expect(tray()?.textContent).toContain("1 picked");
  expect(
    within(tray()!).queryByRole("button", { name: /^Download/ }),
  ).toBeNull();

  // `P` asks for the root the way the link does, and picks nothing.
  await focusCard(second);
  await press("p");
  expect(currentView()).toBe("settings");
  expect(asked.focus).toBe("library_root");
  expect(tray()?.textContent).toContain("1 picked");

  // Rendered on its own, the page is still here to press the tray's link.
  await click(
    within(tray()!).getByRole("button", {
      name: "Choose a library root to download",
    }),
  );
  expect(downloads).toEqual([]);
  expect(currentView()).toBe("settings");
  expect(asked.focus).toBe("library_root");
  expect(tray()?.textContent).toContain("1 picked");
});
