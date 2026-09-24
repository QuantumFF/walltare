import { EmptyState } from "@/components/EmptyState";
import { ItemGrid, type GridCell } from "@/components/ItemGrid";
import { RESULT_CARD } from "@/components/grid-geometry";
import { RESULT_KEYS } from "@/components/keymap";
import type { SelectionHandle } from "@/components/selection";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import {
  useKeyboardHandoff,
  useKeyboardSurface,
} from "@/context/KeyboardHandoffContext";
import {
  client,
  isAppError,
  type DiscoverFilters,
  type Mark,
  type Resolution,
  type SearchPage,
  type SearchParams,
  type SearchResult,
} from "@/lib/client";
import { bytes } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { Heart, ImageOff, Loader2, Search, SearchX } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The ratios Wallhaven's own ratio menu offers, as its `ratios` parameter
 * spells them. The Screen's is matched against these first, so a 2560×1080
 * display searches Wallhaven's `21x9` rather than an exact `64x27` nothing is
 * tagged with.
 */
const WALLHAVEN_RATIOS = [
  "16x9",
  "16x10",
  "21x9",
  "32x9",
  "48x9",
  "9x16",
  "10x16",
  "9x18",
  "1x1",
  "3x2",
  "4x3",
  "5x4",
];

/** The ratios the pill offers besides the Screen's, most common first. */
const COMMON_RATIOS = ["16x9", "16x10", "21x9", "32x9", "9x16"];

/** The pill's value for Any ratio, which no ratio can be spelled as. */
const ANY_RATIO = "any";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The Screen's shape, as a ratio Wallhaven searches by.
 *
 * The nearest of Wallhaven's own ratios when one is within 3% — a marketed 21:9
 * is 2560×1080, 3440×1440 or 5120×2160, and none of those reduces to `21x9` —
 * and the exact ratio otherwise, so an unusual screen still filters by its own
 * shape rather than by somebody else's.
 */
function screenRatio({ width, height }: Resolution): string {
  const shape = width / height;
  let nearest: string | null = null;
  let off = Infinity;
  for (const ratio of WALLHAVEN_RATIOS) {
    const [w, h] = ratio.split("x").map(Number);
    const by = Math.abs(w / h - shape) / (w / h);
    if (by < off) {
      off = by;
      nearest = ratio;
    }
  }
  if (nearest && off <= 0.03) return nearest;
  const d = gcd(width, height);
  return `${width / d}x${height / d}`;
}

/** `16x9` as the curator reads it: `16:9`. */
function readableRatio(ratio: string): string {
  return ratio.replace("x", ":");
}

/** `231`, `19.4k`: a count short enough for a caption. */
function compact(count: number): string {
  return count >= 1000 ? `${Number((count / 1000).toFixed(1))}k` : String(count);
}

/**
 * What a failed search says, where the Results would be (ADR 0054).
 *
 * The backend's own sentence for the three kinds that carry one written for
 * the curator: an unreachable or odd Wallhaven, the rate limit's wait, and a
 * value it refused. Anything else is a fault in the app rather than something
 * the curator can act on, and gets the plain line.
 */
function searchFailure(error: unknown): string {
  if (isAppError(error)) {
    if (error.kind === "network" || error.kind === "rate_limited") {
      return error.message;
    }
    if (error.kind === "bad_request") {
      return `Wallhaven can't search for that: ${error.message}.`;
    }
  }
  return "Couldn't search Wallhaven.";
}

/** What the curator last asked for: the search box and the ratio pill. */
interface Asked {
  q: string;
  /** `null` is Any ratio. */
  ratio: string | null;
}

/** The request for one page of `asked`, under the remembered filters. */
function paramsFor(
  asked: Asked,
  filters: DiscoverFilters,
  page?: number,
  seed?: string | null,
): SearchParams {
  return {
    q: asked.q,
    categories: filters.categories,
    purity: filters.purity,
    sorting: filters.sorting,
    order: filters.order,
    // Only a toplist reads a range, and the backend refuses one sent with any
    // other sort rather than let it be ignored (ADR 0054).
    top_range: filters.sorting === "toplist" ? filters.top_range : undefined,
    ratios: asked.ratio ? [asked.ratio] : undefined,
    page,
    seed: seed ?? undefined,
  };
}

/** The pages shown so far, flattened, and where the last of them sits. */
interface Shown {
  results: SearchResult[];
  meta: SearchPage["meta"];
}

/**
 * A call that did not answer, and whether it was the first page's — which
 * replaces the Results — or a Load more's, which leaves them standing.
 */
interface Failure {
  at: "first" | "more";
  message: string;
}

/**
 * Discover: Wallhaven's search, inside the app (#339).
 *
 * The header is a large search box that takes Wallhaven's own query syntax
 * verbatim and a Ratio pill defaulting to the Screen's, and the Results are
 * Library's grid model over cards with their facts under the picture. One page
 * at a time, by **Load more**: every API call is one the curator asked for, and
 * the page keeps each page it has loaded, since the backend caches nothing
 * (ADR 0054).
 *
 * It searches on its first visit, with the filters the last successful search
 * left remembered, so it never opens blank. The shell keeps it mounted from
 * then on (ADR 0015), which is what carries the Results, the scroll position
 * and the page count across a trip to another tab. The ratio is the one filter
 * never remembered: each launch starts on the Screen's.
 *
 * The grid mounts every card rather than windowing, because the header scrolls
 * with the Results and a window is measured against a scroll box it starts at
 * the top of. A few pages of 24 is Review's scale, not Library's.
 */
export function DiscoverView() {
  const { view, settings } = useApp();
  const showing = view === "discover";

  // The filters Discover opens with, read once: until the filter pills arrive
  // they are the remembered ones and nothing on the page changes them.
  const [filters] = useState(() => settings.discover_filters);
  // Read once too, so a Screen changed in Settings reaches Discover's ratio on
  // the next launch rather than re-searching the page under the curator.
  const [screen] = useState(() => screenRatio(settings.screen));

  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<Asked>({ q: "", ratio: screen });
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState<"first" | "more" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Which call is the latest, so an answer to one the curator has since
  // replaced lands nowhere.
  const latest = useRef(0);

  const scroller = useRef<HTMLDivElement | null>(null);
  // Recorded as the curator scrolls and put back when the view shows again,
  // because `display: none` reports an offset of zero (ADR 0015).
  const scrollTop = useRef(0);

  const search = useCallback(
    async (next: Asked) => {
      const call = ++latest.current;
      setAsked(next);
      setShown(null);
      setFailure(null);
      setPending("first");
      scrollTop.current = 0;
      if (scroller.current) scroller.current.scrollTop = 0;
      try {
        const page = await client.searchWallhaven(paramsFor(next, filters));
        if (call !== latest.current) return;
        setShown({ results: page.results, meta: page.meta });
      } catch (error) {
        if (call !== latest.current) return;
        setFailure({ at: "first", message: searchFailure(error) });
      } finally {
        if (call === latest.current) setPending(null);
      }
    },
    [filters],
  );

  const loadMore = useCallback(async () => {
    if (!shown) return;
    const call = ++latest.current;
    setFailure(null);
    setPending("more");
    try {
      const page = await client.searchWallhaven(
        paramsFor(asked, filters, shown.meta.current_page + 1, shown.meta.seed),
      );
      if (call !== latest.current) return;
      // Wallhaven can hand a Result across two pages when one is added between
      // the calls, and a key the grid has already drawn is a key it cannot
      // draw twice.
      const have = new Set(shown.results.map((r) => r.id));
      setShown({
        results: [
          ...shown.results,
          ...page.results.filter((r) => !have.has(r.id)),
        ],
        meta: page.meta,
      });
    } catch (error) {
      if (call !== latest.current) return;
      setFailure({ at: "more", message: searchFailure(error) });
    } finally {
      if (call === latest.current) setPending(null);
    }
  }, [asked, filters, shown]);

  // The first visit's search. Once, however often the effect runs: StrictMode
  // runs it twice, and a second call would spend a second request.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void search(asked);
  }, [search, asked]);

  useLayoutEffect(() => {
    if (!showing || !scroller.current) return;
    scroller.current.scrollTop = scrollTop.current;
  }, [showing]);

  const [grid, setGrid] = useState<SelectionHandle<SearchResult> | null>(
    null,
  );
  useKeyboardSurface("discover", grid);

  const handOff = useKeyboardHandoff();
  const ratioByPointer = useRef(false);

  const results = shown?.results ?? [];
  const meta = shown?.meta;

  const pillLabel = (ratio: string | null) =>
    ratio === null
      ? "Any ratio"
      : ratio === screen
        ? `${readableRatio(ratio)} · Screen`
        : readableRatio(ratio);

  return (
    <div
      ref={scroller}
      data-slot="discover-page"
      onScroll={() => {
        scrollTop.current = scroller.current?.scrollTop ?? 0;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <h1 className="sr-only">Discover</h1>

      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 pt-8 pb-6">
        <form
          role="search"
          className="relative w-full"
          onSubmit={(event) => {
            event.preventDefault();
            void search({ ...asked, q: draft });
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Search Wallhaven"
            placeholder="Search Wallhaven: tags, +tag -tag, id:, like:"
            // Wallhaven's syntax is the curator's own words, so nothing here
            // corrects them.
            spellCheck={false}
            autoComplete="off"
            className="h-12 w-full rounded-full border border-border bg-card pr-5 pl-11 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>

        <div className="flex flex-wrap justify-center gap-2">
          {/* The Ratio pill: a single choice from a short list, so the same
              Radix list Library's ordering uses, portalled clear of the grid
              whose arrows it would otherwise take (ADR 0019). */}
          <Select
            value={asked.ratio ?? ANY_RATIO}
            onValueChange={(value) =>
              void search({
                ...asked,
                ratio: value === ANY_RATIO ? null : value,
              })
            }
          >
            <SelectTrigger
              onPointerDown={() => {
                ratioByPointer.current = true;
              }}
              onKeyDown={() => {
                ratioByPointer.current = false;
              }}
              aria-label="Ratio"
              size="sm"
              className="rounded-full text-xs"
            >
              <SelectValue>{pillLabel(asked.ratio)}</SelectValue>
            </SelectTrigger>
            <SelectContent
              onCloseAutoFocus={(event) => {
                if (!ratioByPointer.current) return;
                event.preventDefault();
                handOff();
              }}
            >
              {[screen, ...COMMON_RATIOS.filter((r) => r !== screen)].map(
                (ratio) => (
                  <SelectItem key={ratio} value={ratio} className="text-xs">
                    {pillLabel(ratio)}
                  </SelectItem>
                ),
              )}
              <SelectItem value={ANY_RATIO} className="text-xs">
                Any ratio
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pending === "first" ? (
        <div className="flex justify-center py-16">
          <Loader2
            aria-label="Searching Wallhaven"
            className="size-5 animate-spin text-muted-foreground"
          />
        </div>
      ) : failure?.at === "first" ? (
        /* Inline and not a toast: the explanation sits where the Results would
           have been, and stays there until the curator does something about it
           (ADR 0054). */
        <div
          role="alert"
          className="flex flex-col items-center gap-3 px-4 py-16 text-center"
        >
          <p className="text-sm text-muted-foreground">{failure.message}</p>
          <Button variant="outline" onClick={() => void search(asked)}>
            Retry
          </Button>
        </div>
      ) : shown && results.length === 0 ? (
        /* The way out is whichever filter is most likely to have emptied the
           page: the ratio when one is set, and the words otherwise. */
        asked.ratio !== null ? (
          <EmptyState
            icon={SearchX}
            action="Any ratio"
            onAction={() => void search({ ...asked, ratio: null })}
          >
            Nothing on Wallhaven matches.
          </EmptyState>
        ) : (
          <EmptyState
            icon={SearchX}
            action="Clear search"
            onAction={() => {
              setDraft("");
              void search({ ...asked, q: "" });
            }}
          >
            Nothing on Wallhaven matches.
          </EmptyState>
        )
      ) : shown ? (
        <>
          {/* Unwindowed: every card is mounted, which is fine at Review's
              scale of a few pages of 24. Load more has no ceiling, so if a
              curator ever pages far enough for mount cost to matter, windowing
              against this page's scroller is the follow-up (ADR 0016). */}
          <ItemGrid
            ref={setGrid}
            items={results}
            label="Results from Wallhaven"
            actions={RESULT_KEYS}
            onAct={noAction}
            card={RESULT_CARD}
            density="discover"
            className="gap-y-8 px-6 pb-8"
            renderCard={renderResult}
          />

          <div className="flex flex-col items-center gap-2 px-4 pb-24">
            {failure?.at === "more" ? (
              /* Load more's failure keeps every page already shown and puts
                 Retry where the button was. */
              <div
                role="alert"
                className="flex flex-col items-center gap-2 text-center"
              >
                <p className="text-sm text-muted-foreground">
                  {failure.message}
                </p>
                <Button variant="outline" onClick={() => void loadMore()}>
                  Retry
                </Button>
              </div>
            ) : (
              meta &&
              meta.current_page < meta.last_page && (
                <Button
                  variant="outline"
                  onClick={() => void loadMore()}
                  disabled={pending === "more"}
                >
                  {pending === "more" && <Loader2 className="animate-spin" />}
                  Load more
                </Button>
              )
            )}
            {meta && (
              <span
                data-slot="page-count"
                className="text-xs text-muted-foreground tabular-nums"
              >
                Page {meta.current_page} of {meta.last_page}
              </span>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Discover acts on no Result by key yet, so there is nothing for this to do. */
function noAction(): void {}

/** The grid's renderer: a value per prop, so the card's memo holds (#230). */
function renderResult(result: SearchResult, { cellIndex, selected }: GridCell) {
  return (
    <ResultCard result={result} cellIndex={cellIndex} selected={selected} />
  );
}

/** What a marked card's caption says, where Pick and Download would sit. */
const MARK_TEXT: Record<Exclude<Mark, "none">, string> = {
  in_library: "In library",
  rejected: "You rejected this",
};

/**
 * One Result: its `lg` thumbnail from `th.wallhaven.cc`, with the facts in a
 * caption underneath — resolution and file size, then favourites and category.
 *
 * A marked Result is still a full-size card, so every page keeps its 24 and the
 * curator's earlier judgement stays in view (ADR 0050). Its picture is dimmed
 * and greyscale, the way a Rejected card's is in Library, and its caption says
 * "In library" or "You rejected this" where Pick and Download go. It offers
 * neither: a duplicate is not downloaded, and changing one's mind about a
 * reject is a Restore in Library.
 *
 * The card is the grid's cell, wearing the role, the roving `tabindex` and the
 * position the grid finds it by (ADR 0019). Its shape is `RESULT_CARD`: the
 * picture's `aspect-video` and a caption of two lines under a `gap-2`.
 *
 * A thumbnail that will not load is a network fact about Wallhaven and not a
 * missing file, so it says so in a muted panel of its own and never borrows
 * Library's "File is gone" (ADR 0053).
 */
const ResultCard = memo(function ResultCard({
  result,
  cellIndex,
  selected,
}: {
  result: SearchResult;
  cellIndex: number;
  selected: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const mark = result.mark === "none" ? null : MARK_TEXT[result.mark];
  const facts = `${result.resolution}, ${bytes(result.file_size)}, ${result.category}`;
  return (
    <figure
      role="gridcell"
      tabIndex={selected ? 0 : -1}
      data-cell={cellIndex}
      aria-label={mark ? `${facts}, ${mark}` : facts}
      className="group m-0 flex flex-col gap-2 rounded-xl outline-none"
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-xl bg-card",
          "group-focus-visible:ring-2 group-focus-visible:ring-primary group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
        )}
      >
        {/* Kept mounted after a failure, so a load that later succeeds can
            still say so. */}
        <img
          src={result.thumbs.large}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setFailed(false)}
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover",
            // On the picture and not the card, as on a Rejected card in
            // Library, so the caption's mark stays readable.
            mark && "opacity-60 grayscale",
            failed && "invisible",
          )}
        />
        {failed && (
          <div
            data-slot="preview-failed"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"
          >
            <ImageOff aria-hidden className="size-5 opacity-60" />
            <span className="text-xs">Couldn&apos;t load preview</span>
          </div>
        )}
      </div>
      <figcaption className="flex items-center gap-2 text-xs leading-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium tabular-nums">
            {result.resolution}{" "}
            <span className="font-normal text-muted-foreground">
              · {bytes(result.file_size)}
            </span>
          </p>
          <p className="flex items-center gap-1 text-muted-foreground">
            <Heart aria-hidden className="size-3" />
            {compact(result.favorites)} · {result.category}
          </p>
        </div>
        {mark && (
          <span
            data-slot="result-mark"
            className="shrink-0 text-muted-foreground"
          >
            {mark}
          </span>
        )}
      </figcaption>
    </figure>
  );
});
