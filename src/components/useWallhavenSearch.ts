import type { SearchAt } from "@/lib/basket";
import {
  client,
  DEFAULT_DISCOVER_FILTERS,
  isAppError,
  type DiscoverFilters,
  type MarkedResult,
  type SearchPage,
  type SearchParams,
} from "@/lib/client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the curator last asked for: the search box and every pill.
 *
 * The five remembered filters, which a successful search records, and three
 * the backend never remembers: the words, the ratio and the colour describe
 * what the curator is looking for right now (ADR 0054).
 */
export interface Asked extends DiscoverFilters {
  q: string;
  /** `null` is Any ratio. */
  ratio: string | null;
  /** One of `WALLHAVEN_COLOURS`, or `null` for Any colour. */
  colour: string | null;
}

/** The request for one page of `asked`. */
export function paramsFor(
  asked: Asked,
  page?: number,
  seed?: string | null,
): SearchParams {
  return {
    q: asked.q,
    categories: asked.categories,
    purity: asked.purity,
    sorting: asked.sorting,
    order: asked.order,
    // Only a toplist reads a range, and the backend refuses one sent with any
    // other sort rather than let it be ignored (ADR 0054). The pill keeps it
    // for when the curator comes back to Toplist.
    top_range: asked.sorting === "toplist" ? asked.top_range : undefined,
    ratios: asked.ratio ? [asked.ratio] : undefined,
    colors: asked.colour ?? undefined,
    page,
    seed: seed ?? undefined,
  };
}

/** The pages shown so far, flattened, and where the last of them sits. */
export interface Shown {
  results: MarkedResult[];
  meta: SearchPage["meta"];
}

/**
 * `shown` with the next page after it.
 *
 * Wallhaven can hand a Result across two pages when one is added between the
 * calls, and a key the grid has already drawn is a key it cannot draw twice,
 * so a Result already shown keeps its place and its copy.
 */
export function appendPage(shown: Shown, page: SearchPage): Shown {
  const have = new Set(shown.results.map((r) => r.id));
  return {
    results: [...shown.results, ...page.results.filter((r) => !have.has(r.id))],
    meta: page.meta,
  };
}

/**
 * A call that did not answer, and whether it was the first page's — which
 * replaces the Results — or a Load more's, which leaves them standing.
 */
export interface Failure {
  at: SearchAt;
  message: string;
  /**
   * The saved key got a 401. Nothing falls back to anonymous: the page says so
   * and offers the way to Settings, where the key is replaced or removed
   * (ADR 0054).
   */
  keyRejected: boolean;
}

/**
 * What a failed search says, where the Results would be (ADR 0054).
 *
 * The backend's own sentence for the three kinds that carry one written for
 * the curator: an unreachable or odd Wallhaven, the rate limit's wait, and a
 * value it refused, and a saved key Wallhaven rejected, which the page follows
 * with a way to Settings. Anything else is a fault in the app rather than
 * something the curator can act on, and gets the plain line.
 */
function searchFailure(error: unknown): string {
  if (isAppError(error)) {
    if (
      error.kind === "network" ||
      error.kind === "rate_limited" ||
      error.kind === "key_rejected"
    ) {
      return error.message;
    }
    if (error.kind === "bad_request") {
      return `Wallhaven can't search for that: ${error.message}.`;
    }
  }
  return "Couldn't search Wallhaven.";
}

/** The failure a call that did not answer leaves, at `at`. */
function failed(at: SearchAt, error: unknown): Failure {
  return {
    at,
    message: searchFailure(error),
    keyRejected: isAppError(error) && error.kind === "key_rejected",
  };
}

export interface WallhavenSearch {
  asked: Asked;
  /** `null` before the first page of the latest search has answered. */
  shown: Shown | null;
  /** Which call is out, if one is. */
  pending: SearchAt | null;
  failure: Failure | null;
  /** A new search for `next`, which replaces the Results. */
  search: (next: Asked) => Promise<void>;
  /** The next page of the search shown. */
  loadMore: () => Promise<void>;
  /** Mark a shown Result In library, as a landed file makes it. */
  markInLibrary: (id: string) => void;
}

/**
 * Discover's search session: what the curator asked for, the pages answered so
 * far, and the call that is out (#339, #419).
 *
 * **The latest call wins.** A search or a Load more replaces whatever call was
 * out before it, and an answer to a replaced one lands nowhere: not its
 * Results, not its failure, and not the end of the spinner the newer call
 * started. One counter, read the same way by both.
 *
 * `onAnswer` hears every page that lands, as it lands, for the basket to read
 * the marks it carries.
 *
 * `keyed` is whether a Wallhaven key is saved. A key removed in Settings drops
 * NSFW from the remembered filters, and the pills follow, so the next search is
 * not one the backend refuses. Nothing searches again for it: every call is one
 * the curator asked for. Adjusted during render, so the Purity pill never
 * paints NSFW without a key.
 */
export function useWallhavenSearch(
  initial: () => Asked,
  keyed: boolean,
  onAnswer: (results: MarkedResult[], at: SearchAt) => void,
): WallhavenSearch {
  const [asked, setAsked] = useState(initial);
  if (!keyed && asked.purity.nsfw) {
    const purity = { ...asked.purity, nsfw: false };
    setAsked({
      ...asked,
      purity:
        purity.sfw || purity.sketchy ? purity : DEFAULT_DISCOVER_FILTERS.purity,
    });
  }
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState<SearchAt | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const answered = useRef(onAnswer);
  useEffect(() => {
    answered.current = onAnswer;
  });

  // Which call is the latest, so an answer to one the curator has since
  // replaced lands nowhere.
  const latest = useRef(0);
  const call = useCallback(
    async (
      at: SearchAt,
      params: SearchParams,
      land: (page: SearchPage) => void,
    ) => {
      const mine = ++latest.current;
      setFailure(null);
      setPending(at);
      try {
        const page = await client.searchWallhaven(params);
        if (mine !== latest.current) return;
        land(page);
        answered.current(page.results, at);
      } catch (error) {
        if (mine !== latest.current) return;
        setFailure(failed(at, error));
      } finally {
        if (mine === latest.current) setPending(null);
      }
    },
    [],
  );

  const search = useCallback(
    (next: Asked) => {
      setAsked(next);
      setShown(null);
      return call("first", paramsFor(next), (page) =>
        setShown({ results: page.results, meta: page.meta }),
      );
    },
    [call],
  );

  const loadMore = useCallback(async () => {
    if (!shown) return;
    await call(
      "more",
      paramsFor(asked, shown.meta.current_page + 1, shown.meta.seed),
      // Onto the pages as they are when this one lands, and not as they were
      // when it was asked for: a file can land in between, and its mark is
      // on the shown copy.
      (page) => setShown((now) => now && appendPage(now, page)),
    );
  }, [call, asked, shown]);

  const markInLibrary = useCallback((id: string) => {
    setShown(
      (now) =>
        now && {
          ...now,
          results: now.results.map((r) =>
            r.id === id ? { ...r, mark: "in_library" } : r,
          ),
        },
    );
  }, []);

  return { asked, shown, pending, failure, search, loadMore, markInLibrary };
}
