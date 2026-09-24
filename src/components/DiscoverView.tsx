import { EmptyState } from "@/components/EmptyState";
import { ItemGrid, type GridCell } from "@/components/ItemGrid";
import { RESULT_CARD } from "@/components/grid-geometry";
import { DIMMED_PICTURE } from "@/components/WallpaperCard";
import { RESULT_KEYS } from "@/components/keymap";
import type { SelectionHandle } from "@/components/selection";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSwatchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/context/AppContext";
import {
  useHandOffOnPointerPress,
  useKeyboardHandoff,
  useKeyboardSurface,
} from "@/context/KeyboardHandoffContext";
import {
  client,
  isAppError,
  type Categories,
  type DiscoverFilters,
  type Mark,
  type MarkedResult,
  type Purity,
  type Resolution,
  type SearchPage,
  type SearchParams,
  type Sorting,
  type TopRange,
} from "@/lib/client";
import { bytes } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Heart,
  ImageOff,
  Loader2,
  Search,
  SearchX,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
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

/** Wallhaven's seven sort orders, in the order its own menu lists them. */
const SORTINGS: { value: Sorting; label: string }[] = [
  { value: "date_added", label: "Date added" },
  { value: "relevance", label: "Relevance" },
  { value: "random", label: "Random" },
  { value: "views", label: "Views" },
  { value: "favorites", label: "Favourites" },
  { value: "toplist", label: "Toplist" },
  { value: "hot", label: "Hot" },
];

/** How far back a toplist reaches, shortest first. */
const TOP_RANGES: TopRange[] = ["1d", "3d", "1w", "1M", "3M", "6M", "1y"];

const CATEGORIES: { value: keyof Categories; label: string }[] = [
  { value: "general", label: "General" },
  { value: "anime", label: "Anime" },
  { value: "people", label: "People" },
];

const PURITIES: { value: keyof Purity; label: string }[] = [
  { value: "sfw", label: "SFW" },
  { value: "sketchy", label: "Sketchy" },
  { value: "nsfw", label: "NSFW" },
];

/**
 * Wallhaven's 29 colours, the only values its `colors` parameter takes, in its
 * own palette's order. Mirrors `wallhaven::COLOURS`, which refuses anything
 * else (ADR 0054).
 */
const COLOURS = [
  "660000",
  "990000",
  "cc0000",
  "cc3333",
  "ea4c88",
  "993399",
  "663399",
  "333399",
  "0066cc",
  "0099cc",
  "66cccc",
  "77cc33",
  "669900",
  "336600",
  "666600",
  "999900",
  "cccc33",
  "ffff00",
  "ffcc33",
  "ff9900",
  "ff6600",
  "cc6633",
  "996633",
  "663300",
  "000000",
  "999999",
  "cccccc",
  "ffffff",
  "424153",
];

/** The Colour pill's value for Any colour, which no colour is spelled as. */
const ANY_COLOUR = "any";

/**
 * The sticky strip's height: a PageBar's `h-11`, so a collapsed header is the
 * same fixed bar every other page has under the chrome (ADR 0015).
 */
const STRIP_HEIGHT = 44;

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

/**
 * What the curator last asked for: the search box and every pill.
 *
 * The five remembered filters, which a successful search records, and three
 * the backend never remembers: the words, the ratio and the colour describe
 * what the curator is looking for right now (ADR 0054).
 */
interface Asked extends DiscoverFilters {
  q: string;
  /** `null` is Any ratio. */
  ratio: string | null;
  /** One of `COLOURS`, or `null` for Any colour. */
  colour: string | null;
}

/** The request for one page of `asked`. */
function paramsFor(
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
interface Shown {
  results: MarkedResult[];
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
 * verbatim and the filter pills (#340): Ratio, defaulting to the Screen's, Sort
 * with its Order beside it, Categories, Purity and Colour. Each change is a new
 * search. Once the page scrolls, the header collapses into a sticky strip that
 * holds both halves, so the filters stay within reach. The Results are
 * Library's grid model over cards with their facts under the picture. One page
 * at a time, by **Load more**: every API call is one the curator asked for, and
 * the page keeps each page it has loaded, since the backend caches nothing
 * (ADR 0054).
 *
 * It searches on its first visit, with the filters the last successful search
 * left remembered, so it never opens blank. The shell keeps it mounted from
 * then on (ADR 0015), which is what carries the Results, the scroll position
 * and the page count across a trip to another tab. The ratio and the colour
 * are never remembered: each launch starts on the Screen's ratio and any
 * colour.
 *
 * The grid mounts every card rather than windowing, because the header scrolls
 * with the Results and a window is measured against a scroll box it starts at
 * the top of. A few pages of 24 is Review's scale, not Library's.
 */
export function DiscoverView() {
  const { view, settings } = useApp();
  const showing = view === "discover";

  // Read once, so a Screen changed in Settings reaches Discover's ratio on the
  // next launch rather than re-searching the page under the curator.
  const [screen] = useState(() => screenRatio(settings.screen));

  const [draft, setDraft] = useState("");
  // The pills start from the remembered filters, read once: from then on the
  // pills are what says them, and the backend records each successful search's.
  const [asked, setAsked] = useState<Asked>(() => ({
    ...settings.discover_filters,
    q: "",
    ratio: screen,
    colour: null,
  }));
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

  // The sticky strip. The header collapses once the page has scrolled as far as
  // the strip would leave of it, and expands again short of that, so the two
  // shapes swap where they would show the same thing. While collapsed it keeps
  // its expanded height in the flow as a margin: the Results never move as it
  // swaps, and a scroll offset cannot land either side of the line because of
  // the swap itself.
  const header = useRef<HTMLElement | null>(null);
  // Measured while expanded, since collapsed it is the strip's.
  const expandedHeight = useRef(0);
  // What the collapsed header keeps in the flow below itself, or `null` while
  // it is expanded.
  const [reserved, setReserved] = useState<number | null>(null);
  const collapsed = reserved !== null;
  const followScroll = useCallback(() => {
    const at = scroller.current?.scrollTop ?? 0;
    scrollTop.current = at;
    if (header.current?.dataset.collapsed === "false") {
      expandedHeight.current = header.current.offsetHeight;
    }
    const reserve = Math.max(0, expandedHeight.current - STRIP_HEIGHT);
    setReserved(at > reserve ? reserve : null);
  }, []);

  const search = useCallback(async (next: Asked) => {
    const call = ++latest.current;
    setAsked(next);
    setShown(null);
    setFailure(null);
    setPending("first");
    scrollTop.current = 0;
    if (scroller.current) scroller.current.scrollTop = 0;
    setReserved(null);
    try {
      const page = await client.searchWallhaven(paramsFor(next));
      if (call !== latest.current) return;
      setShown({ results: page.results, meta: page.meta });
    } catch (error) {
      if (call !== latest.current) return;
      setFailure({ at: "first", message: searchFailure(error) });
    } finally {
      if (call === latest.current) setPending(null);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!shown) return;
    const call = ++latest.current;
    setFailure(null);
    setPending("more");
    try {
      const page = await client.searchWallhaven(
        paramsFor(asked, shown.meta.current_page + 1, shown.meta.seed),
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
  }, [asked, shown]);

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
    followScroll();
  }, [showing, followScroll]);

  const [grid, setGrid] = useState<SelectionHandle<MarkedResult> | null>(
    null,
  );
  useKeyboardSurface("discover", grid);

  const ratioHandOff = usePillHandOff();
  const handOffOnPointerPress = useHandOffOnPointerPress();
  const refine = (change: Partial<Asked>) =>
    void search({ ...asked, ...change });

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
      onScroll={followScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <h1 className="sr-only">Discover</h1>

      {/* One header in two shapes rather than a strip beside it, so the search
          box and the pills are the same elements either way and the focus, the
          caret and an open menu survive the swap. */}
      <header
        ref={header}
        data-slot="discover-header"
        data-collapsed={collapsed}
        style={collapsed ? { marginBottom: reserved } : undefined}
        className={cn(
          collapsed &&
            "sticky top-0 z-20 h-11 border-b border-border/60 bg-background/95 backdrop-blur",
        )}
      >
        <div
          className={cn(
            "mx-auto flex gap-3 px-4",
            collapsed
              ? "h-full items-center"
              : "max-w-3xl flex-col items-center pt-8 pb-6",
          )}
        >
          <form
            role="search"
            className={cn("relative", collapsed ? "w-72 shrink-0" : "w-full")}
            onSubmit={(event) => {
              event.preventDefault();
              void search({ ...asked, q: draft });
            }}
          >
            <Search
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
                collapsed ? "left-3" : "left-4",
              )}
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
              className={cn(
                "w-full rounded-full border border-border bg-card text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                collapsed ? "h-8 pr-4 pl-9" : "h-12 pr-5 pl-11",
              )}
            />
          </form>

          {/* A pill the pointer pressed hands the keyboard back to the grid, as
            a PageBar's buttons do; the menus do it as they close. */}
          <div
            onClick={handOffOnPointerPress}
            className={cn(
              "flex gap-2",
              collapsed
                ? "min-w-0 flex-nowrap overflow-x-auto py-1"
                : "flex-wrap justify-center",
            )}
          >
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
                {...ratioHandOff.trigger}
                aria-label="Ratio"
                size="sm"
                className="shrink-0 rounded-full text-xs"
              >
                <SelectValue>{pillLabel(asked.ratio)}</SelectValue>
              </SelectTrigger>
              <SelectContent onCloseAutoFocus={ratioHandOff.onCloseAutoFocus}>
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

            <SortPill asked={asked} onChange={refine} />

            <button
              type="button"
              onClick={() =>
                refine({ order: asked.order === "desc" ? "asc" : "desc" })
              }
              className={PILL}
            >
              {asked.order === "desc" ? (
                <ArrowDownWideNarrow aria-hidden className="size-3.5" />
              ) : (
                <ArrowUpNarrowWide aria-hidden className="size-3.5" />
              )}
              {asked.order === "desc" ? "Descending" : "Ascending"}
            </button>

            <CategoriesPill asked={asked} onChange={refine} />
            <PurityPill asked={asked} onChange={refine} />
            <ColourPill asked={asked} onChange={refine} />
          </div>
        </div>
      </header>

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

/** A pill's look, which the Ratio pill's `SelectTrigger` has at `size="sm"`. */
const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-input bg-transparent pr-2 pl-2.5 text-xs whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted dark:bg-input/30 dark:hover:bg-input/50";

/**
 * Where a pill's menu leaves the keyboard as it closes.
 *
 * Opened by the pointer, it goes back to the grid, the way a pressed PageBar
 * button hands it back; opened by the keyboard, it goes back to the pill, so
 * `Tab` carries on along the row from where the curator was (ADR 0047).
 */
function usePillHandOff() {
  const handOff = useKeyboardHandoff();
  const byPointer = useRef(false);
  return {
    trigger: {
      onPointerDown: () => {
        byPointer.current = true;
      },
      onKeyDown: () => {
        byPointer.current = false;
      },
    },
    onCloseAutoFocus: (event: Event) => {
      if (!byPointer.current) return;
      event.preventDefault();
      handOff();
    },
  };
}

/**
 * A pill that opens a menu: what it filters by as its name, what it is set to
 * as its text, then the chevron every pill wears.
 *
 * The menu is Radix's, portalled clear of the grid whose arrows it would
 * otherwise take (ADR 0019), and walked with the arrows inside itself.
 */
function Pill({
  name,
  label,
  swatch,
  className,
  children,
}: {
  name: string;
  label: string;
  /** A colour drawn before the label, as the Colour pill's is. */
  swatch?: string;
  /** The menu's own box, for one that is not a list. */
  className?: string;
  children: ReactNode;
}) {
  const handOff = usePillHandOff();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        {...handOff.trigger}
        aria-label={name}
        className={PILL}
      >
        {swatch && (
          <span
            aria-hidden
            className="size-3 rounded-full border border-border/60"
            style={{ background: swatch }}
          />
        )}
        {label}
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={handOff.onCloseAutoFocus}
        className={className}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface PillProps {
  asked: Asked;
  onChange: (change: Partial<Asked>) => void;
}

/**
 * Sort: all seven of Wallhaven's orders. Choosing Toplist keeps the menu open
 * on the toplist range, which is picked right there, and the pill says both.
 */
function SortPill({ asked, onChange }: PillProps) {
  const label =
    asked.sorting === "toplist"
      ? `Toplist · ${asked.top_range}`
      : (SORTINGS.find((s) => s.value === asked.sorting)?.label ?? "");
  return (
    <Pill name="Sort" label={label}>
      <DropdownMenuRadioGroup
        value={asked.sorting}
        onValueChange={(value) => {
          if (value !== asked.sorting) onChange({ sorting: value as Sorting });
        }}
      >
        {SORTINGS.map(({ value, label }) => (
          <DropdownMenuRadioItem
            key={value}
            value={value}
            onSelect={
              value === "toplist"
                ? (event) => event.preventDefault()
                : undefined
            }
          >
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {asked.sorting === "toplist" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Toplist range</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={asked.top_range}
            onValueChange={(value) => {
              if (value !== asked.top_range) {
                onChange({ top_range: value as TopRange });
              }
            }}
          >
            {TOP_RANGES.map((range) => (
              <DropdownMenuRadioItem key={range} value={range}>
                {range}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      )}
    </Pill>
  );
}

/**
 * Categories and Purity: checkboxes that stay open while they are ticked, each
 * tick a search. The last box on cannot be turned off, because the backend
 * refuses a search with none rather than let Wallhaven answer it (ADR 0054).
 */
function CategoriesPill({ asked, onChange }: PillProps) {
  const on = CATEGORIES.filter(({ value }) => asked.categories[value]);
  return (
    <Pill
      name="Categories"
      label={
        on.length === CATEGORIES.length
          ? "All categories"
          : on.map(({ label }) => label).join(", ")
      }
    >
      {CATEGORIES.map(({ value, label }) => (
        <DropdownMenuCheckboxItem
          key={value}
          checked={asked.categories[value]}
          disabled={asked.categories[value] && on.length === 1}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            onChange({
              categories: { ...asked.categories, [value]: checked === true },
            })
          }
        >
          {label}
        </DropdownMenuCheckboxItem>
      ))}
    </Pill>
  );
}

/**
 * Purity. NSFW needs an API key, and until one can be saved it is shown and
 * disabled, saying how to unlock it; the backend refuses it too (ADR 0054).
 */
function PurityPill({ asked, onChange }: PillProps) {
  const on = PURITIES.filter(({ value }) => asked.purity[value]);
  return (
    <Pill name="Purity" label={on.map(({ label }) => label).join(" + ")}>
      {PURITIES.map(({ value, label }) => (
        <DropdownMenuCheckboxItem
          key={value}
          checked={asked.purity[value]}
          disabled={
            value === "nsfw" || (asked.purity[value] && on.length === 1)
          }
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            onChange({ purity: { ...asked.purity, [value]: checked === true } })
          }
        >
          {value === "nsfw" ? (
            <span className="flex flex-col">
              {label}
              <span className="text-[11px] text-muted-foreground">
                Add an API key in Settings
              </span>
            </span>
          ) : (
            label
          )}
        </DropdownMenuCheckboxItem>
      ))}
    </Pill>
  );
}

/** Colour: Wallhaven's 29 swatches, and Any colour to clear it. */
function ColourPill({ asked, onChange }: PillProps) {
  return (
    <Pill
      name="Colour"
      label={asked.colour ? "Colour" : "Any colour"}
      swatch={asked.colour ? `#${asked.colour}` : undefined}
      className="w-60"
    >
      <DropdownMenuRadioGroup
        value={asked.colour ?? ANY_COLOUR}
        onValueChange={(value) => {
          const colour = value === ANY_COLOUR ? null : value;
          if (colour !== asked.colour) onChange({ colour });
        }}
      >
        <DropdownMenuRadioItem value={ANY_COLOUR}>
          Any colour
        </DropdownMenuRadioItem>
        <DropdownMenuSeparator />
        <div className="grid grid-cols-8 gap-1 p-1">
          {COLOURS.map((colour) => (
            <DropdownMenuSwatchItem
              key={colour}
              value={colour}
              colour={`#${colour}`}
              aria-label={`#${colour}`}
            />
          ))}
        </div>
      </DropdownMenuRadioGroup>
    </Pill>
  );
}

/** Discover acts on no Result by key yet, so there is nothing for this to do. */
function noAction(): void {}

/** The grid's renderer: a value per prop, so the card's memo holds (#230). */
function renderResult(
  result: MarkedResult,
  { cellIndex, selected }: GridCell,
) {
  return (
    <ResultCard result={result} cellIndex={cellIndex} selected={selected} />
  );
}

/** What a marked card's caption says, where Pick and Download would sit. */
const MARK_TEXT: Record<Exclude<Mark, "unmarked">, string> = {
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
  result: MarkedResult;
  cellIndex: number;
  selected: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const mark = result.mark === "unmarked" ? null : MARK_TEXT[result.mark];
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
            mark && DIMMED_PICTURE,
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
