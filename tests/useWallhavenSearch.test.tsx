import {
  appendPage,
  useWallhavenSearch,
  type Asked,
} from "@/components/useWallhavenSearch";
import {
  DEFAULT_DISCOVER_FILTERS,
  type MarkedResult,
  type SearchPage,
  type SearchParams,
} from "@/lib/client";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { mockCommand } from "./ipc-mocks";

// The search session on its own: the latest call wins, and the pages it shows
// never draw one Result twice (#419). What the page draws from it is
// DiscoverView's tests'.

afterEach(cleanup);

function page(ids: string[], current = 1, last = 3): SearchPage {
  return {
    results: ids.map((id) => ({ id, mark: "unmarked" }) as MarkedResult),
    meta: {
      current_page: current,
      last_page: last,
      per_page: 24,
      total: ids.length * last,
      seed: null,
    },
  };
}

const ASKED: Asked = {
  ...DEFAULT_DISCOVER_FILTERS,
  q: "",
  ratio: null,
  colour: null,
};

/** Searches that answer when the test says, by their words. */
function heldSearches() {
  const out = new Map<string, (page: SearchPage) => void>();
  mockCommand("wallhaven_search", (args: { params: SearchParams }) => {
    const key = `${args.params.q}:${args.params.page ?? 1}`;
    return new Promise<SearchPage>((resolve) => out.set(key, resolve));
  });
  return async (key: string, answer: SearchPage) => {
    await act(async () => {
      out.get(key)!(answer);
    });
  };
}

function session() {
  const heard: [string[], string][] = [];
  const hook = renderHook(() =>
    useWallhavenSearch(
      () => ASKED,
      true,
      (results, at) => heard.push([results.map((r) => r.id), at]),
    ),
  );
  return { hook, heard };
}

test("appendPage adds the next page after the shown ones, skipping a Result already shown", () => {
  const shown = page(["aaaaaa", "bbbbbb"]);

  const next = appendPage(shown, page(["bbbbbb", "cccccc"], 2));

  expect(next.results.map((r) => r.id)).toEqual(["aaaaaa", "bbbbbb", "cccccc"]);
  expect(next.results[1]).toBe(shown.results[1]);
  expect(next.meta.current_page).toBe(2);
});

test("an answer to a search the curator has since replaced lands nowhere", async () => {
  const answer = heldSearches();
  const { hook, heard } = session();

  act(() => {
    void hook.result.current.search({ ...ASKED, q: "old" });
  });
  act(() => {
    void hook.result.current.search({ ...ASKED, q: "new" });
  });
  await answer("new:1", page(["newnew"]));
  await answer("old:1", page(["oldold"]));

  expect(hook.result.current.shown?.results.map((r) => r.id)).toEqual([
    "newnew",
  ]);
  expect(hook.result.current.asked.q).toBe("new");
  expect(hook.result.current.pending).toBeNull();
  expect(heard).toEqual([[["newnew"], "first"]]);
});

test("a search replaces a Load more that is out, and the Load more's answer is dropped", async () => {
  const answer = heldSearches();
  const { hook, heard } = session();
  act(() => {
    void hook.result.current.search({ ...ASKED, q: "cats" });
  });
  await answer("cats:1", page(["aaaaaa"]));

  act(() => {
    void hook.result.current.loadMore();
  });
  expect(hook.result.current.pending).toBe("more");
  act(() => {
    void hook.result.current.search({ ...ASKED, q: "dogs" });
  });
  await answer("cats:2", page(["bbbbbb"], 2));

  expect(hook.result.current.shown).toBeNull();
  expect(hook.result.current.pending).toBe("first");

  await answer("dogs:1", page(["cccccc"]));
  expect(hook.result.current.shown?.results.map((r) => r.id)).toEqual([
    "cccccc",
  ]);
  expect(heard.map(([, at]) => at)).toEqual(["first", "first"]);
});

test("a Load more lands on the pages as they are when it answers", async () => {
  const answer = heldSearches();
  const { hook, heard } = session();
  act(() => {
    void hook.result.current.search({ ...ASKED, q: "cats" });
  });
  await answer("cats:1", page(["aaaaaa"]));

  act(() => {
    void hook.result.current.loadMore();
  });
  act(() => hook.result.current.markInLibrary("aaaaaa"));
  await answer("cats:2", page(["bbbbbb"], 2));

  expect(hook.result.current.shown?.results.map((r) => [r.id, r.mark])).toEqual(
    [
      ["aaaaaa", "in_library"],
      ["bbbbbb", "unmarked"],
    ],
  );
  expect(heard[heard.length - 1]).toEqual([["bbbbbb"], "more"]);
});
