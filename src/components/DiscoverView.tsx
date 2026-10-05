import { EmptyState } from "@/components/EmptyState";
import type { Picture } from "@/components/HeroPicture";
import { ItemGrid, type GridCell } from "@/components/ItemGrid";
import {
  ItemLightbox,
  LightboxTitle,
  useLightbox,
  type LightboxRow,
} from "@/components/ItemLightbox";
import { RESULT_CARD } from "@/components/grid-geometry";
import { DIMMED_PICTURE } from "@/components/WallpaperCard";
import {
  RESULT_KEYS,
  keyShortcut,
  printedKey,
  resultKeys,
  type ResultAction,
} from "@/components/keymap";
import type { SelectionHandle } from "@/components/selection";
import { DrawTurns, SharpPicture } from "@/components/SharpPicture";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSwatchGrid,
  DropdownMenuSwatchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBasket } from "@/components/useBasket";
import { useCollapsingHeader } from "@/components/useCollapsingHeader";
import {
  useWallhavenSearch,
  type Asked,
} from "@/components/useWallhavenSearch";
import { useApp } from "@/context/AppContext";
import {
  useHandOffOnPointerPress,
  useKeyboardHandoff,
  useKeyboardSurface,
  useMenuHandOff,
} from "@/context/KeyboardHandoffContext";
import {
  EMPTY_BASKET,
  offer,
  type Offer,
  type ResultDownload,
} from "@/lib/basket";
import {
  type Categories,
  type Mark,
  type MarkedResult,
  type Purity,
  type Resolution,
  type Sorting,
  type TopRange,
  WALLHAVEN_COLOURS,
} from "@/lib/client";
import { bytes } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  Download,
  Heart,
  ImageOff,
  Loader2,
  Plus,
  Search,
  SearchX,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
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

/**
 * The two ratios Wallhaven names rather than spells as `WxH`, with the words
 * its own menu shows for them: every landscape shape, and every portrait one.
 */
const NAMED_RATIOS: Record<string, string> = {
  landscape: "Wide",
  portrait: "Portrait",
};

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
 * What each of Wallhaven's colours is called, for the swatch that has no text
 * of its own. The hex goes beside it, since a name for `#cc6633` is a guess.
 */
const COLOUR_NAMES: Record<string, string> = {
  "660000": "Maroon",
  "990000": "Dark red",
  cc0000: "Red",
  cc3333: "Brick red",
  ea4c88: "Pink",
  "993399": "Purple",
  "663399": "Violet",
  "333399": "Indigo",
  "0066cc": "Blue",
  "0099cc": "Sky blue",
  "66cccc": "Teal",
  "77cc33": "Lime",
  "669900": "Olive green",
  "336600": "Dark green",
  "666600": "Olive",
  "999900": "Mustard",
  cccc33: "Citron",
  ffff00: "Yellow",
  ffcc33: "Gold",
  ff9900: "Orange",
  ff6600: "Dark orange",
  cc6633: "Copper",
  "996633": "Brown",
  "663300": "Dark brown",
  "000000": "Black",
  "999999": "Grey",
  cccccc: "Light grey",
  ffffff: "White",
  "424153": "Slate",
};

/** `Maroon (#660000)`: a swatch, as a screen reader says it. */
function colourName(colour: string): string {
  return `${COLOUR_NAMES[colour] ?? "Colour"} (#${colour})`;
}

/** The Colour pill's value for Any colour, which no colour is spelled as. */
const ANY_COLOUR = "any";

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

/** `16x9` as the curator reads it: `16:9`, and `landscape` as `Wide`. */
function readableRatio(ratio: string): string {
  return NAMED_RATIOS[ratio] ?? ratio.replace("x", ":");
}

/** `231`, `19.4k`: a count short enough for a caption. */
function compact(count: number): string {
  return count >= 1000 ? `${Number((count / 1000).toFixed(1))}k` : String(count);
}

/**
 * Where Wallhaven serves a Result's full file: `w.wallhaven.cc`, under the
 * id's first two characters, named `wallhaven-<id>` with the extension its
 * `file_type` says.
 *
 * Spelled here rather than carried on the wire, because the answer leaves out
 * `path` on purpose: the backend keeps it for the download that names the
 * Result by id, so that nothing the webview holds is ever a URL written into
 * the library (ADR 0054). This one is only ever an `<img>`'s, which the policy
 * lets through for the lightbox alone (ADR 0055). Wallhaven serves two types,
 * and anything but a PNG is a JPEG.
 */
function fullFileUrl(result: MarkedResult): string {
  const extension = result.file_type === "image/png" ? "png" : "jpg";
  return `https://w.wallhaven.cc/full/${result.id.slice(0, 2)}/wallhaven-${result.id}.${extension}`;
}

/**
 * A Result's picture in the lightbox: the card's `lg` thumbnail under the full
 * file, in a box of the file's own Dimensions (ADR 0055). The thumbnail is
 * 16:9 whatever the file is, so it is drawn stretched to the file's shape
 * until the full file lands, which is ADR 0022's never-blank rule with
 * Wallhaven's two sizes in.
 */
function resultPicture(result: MarkedResult): Picture {
  return {
    id: result.id,
    placeholder: result.thumbs.large,
    full: fullFileUrl(result),
    alt: `wallhaven-${result.id}`,
    dimensions: { width: result.dimension_x, height: result.dimension_y },
  };
}

/**
 * What every card needs from the page to draw its caption: what each Result
 * offers, whether there is a Library root to download into, and the ways to
 * ask for each — the lightbox's open among them, since a click on a card is
 * one.
 *
 * A context rather than props through the grid's renderer, which stays a
 * value per cell so the grid can hold its memo (#230). A few pages of cards
 * re-render when a download moves, which is Review's scale.
 */
interface ResultControls {
  /**
   * What a Result offers where Pick and Download go, which the card's caption
   * and the lightbox's row both read, so the two can never offer different
   * things for one Result (`offer` in `basket.ts`).
   */
  offer: (result: MarkedResult) => Offer;
  /** No Library root, so nothing can land and Download says so (ADR 0051). */
  noRoot: boolean;
  download: (result: MarkedResult) => void;
  /** Make the Result a Pick, or stop it being one. */
  pick: (result: MarkedResult) => void;
  /** Open the Result in the lightbox, which a click on its card does. */
  open: (result: MarkedResult) => void;
}

const ResultControlsContext = createContext<ResultControls>({
  offer: (result) => offer(EMPTY_BASKET, result),
  noRoot: false,
  download: () => {},
  pick: () => {},
  open: () => {},
});

/** What a card with no Library root offers in place of Download. */
const NO_ROOT = "Choose a library root to download";

/**
 * Discover: Wallhaven's search, inside the app (#339).
 *
 * The header is a large search box that takes Wallhaven's own query syntax
 * verbatim and the filter pills (#340): Ratio, defaulting to the Screen's, Sort
 * with its Order beside it, Categories, Purity and Colour. Each change is a new
 * search. Once the page scrolls, the header collapses into a sticky strip that
 * holds both halves, so the filters stay within reach (`useCollapsingHeader`).
 * The Results are Library's grid model over cards with their facts under the
 * picture. One page at a time, by **Load more**: every API call is one the
 * curator asked for, and the page keeps each page it has loaded, since the
 * backend caches nothing (ADR 0054; `useWallhavenSearch`).
 *
 * It searches on its first visit, with the filters the last successful search
 * left remembered, so it never opens blank. The shell keeps it mounted from
 * then on (ADR 0015), which is what carries the Results, the scroll position
 * and the page count across a trip to another tab. The ratio and the colour
 * are never remembered: each launch starts on the Screen's ratio and any
 * colour.
 *
 * Several Results can be gathered as Picks and downloaded together from a
 * floating tray (#344). The Picks are the page's and not the search's, so a new
 * search or a changed filter keeps them, and a download clears them. What a
 * Result can do now is the basket's one rule (`basket.ts`), held by
 * `useBasket`.
 *
 * `Enter` on a card, or a click on one, opens the Result full size in
 * Library's lightbox (#345): the `lg` thumbnail under the full file from
 * `w.wallhaven.cc`, loaded for the Result on screen and never ahead of it
 * (ADR 0055), with Pick and Download under the picture.
 *
 * The grid mounts every card rather than windowing, because the header scrolls
 * with the Results and a window is measured against a scroll box it starts at
 * the top of. A few pages of 24 is Review's scale, not Library's.
 */
export function DiscoverView() {
  const { view, settings, setView } = useApp();
  const showing = view === "discover";
  const keyed = settings.wallhaven_key_set;

  // Read once, so a Screen changed in Settings reaches Discover's ratio on the
  // next launch rather than re-searching the page under the curator.
  const [screen] = useState(() => screenRatio(settings.screen));

  const [draft, setDraft] = useState("");
  const page = useCollapsingHeader(showing);
  const session = useWallhavenSearch(
    // The pills start from the remembered filters, read once: from then on
    // the pills are what says them, and the backend records each successful
    // search's.
    () => ({
      ...settings.discover_filters,
      q: "",
      ratio: screen,
      colour: null,
    }),
    keyed,
    // Each page that lands tells the basket the marks it carries. The two
    // hooks hear each other, so one has to be named before it is declared:
    // this only runs once a search answers, long after `basket` below is.
    (results, at) => basket.searched(results, at),
  );
  const { asked, shown, pending, failure, loadMore } = session;
  // A file that lands is a wallpaper carrying its id, so its card becomes an
  // In library card, which is what the next search would mark it anyway.
  const basket = useBasket(session.markInLibrary);

  const { toTop } = page;
  const { search: searchFor } = session;
  const search = useCallback(
    (next: Asked) => {
      toTop();
      return searchFor(next);
    },
    [toTop, searchFor],
  );

  // The first visit's search. Once, however often the effect runs: StrictMode
  // runs it twice, and a second call would spend a second request.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void search(asked);
  }, [search, asked]);

  const noRoot = settings.library_root === "";

  // Refused up front: with no library there is nothing for a download to join,
  // and the fix is one field away (ADR 0051). Pick says so too, since a Pick is
  // only ever gathered to be downloaded.
  const chooseRoot = useCallback(
    () => setView("settings", { focus: "library_root", returnTo: "discover" }),
    [setView],
  );

  const { picks, offer: offerNow, offered, clear: clearPicks } = basket;
  const { download: take, downloadPicks: takePicks, pick: toggle } = basket;
  const download = useCallback(
    (result: MarkedResult) => (noRoot ? chooseRoot() : take([result])),
    [noRoot, chooseRoot, take],
  );
  const downloadPicks = useCallback(
    () => (noRoot ? chooseRoot() : takePicks()),
    [noRoot, chooseRoot, takePicks],
  );
  const pick = useCallback(
    (result: MarkedResult) => (noRoot ? chooseRoot() : toggle(result)),
    [noRoot, chooseRoot, toggle],
  );

  const [grid, setGrid] = useState<SelectionHandle<MarkedResult> | null>(
    null,
  );
  useKeyboardSurface("discover", grid);
  // Enter on a card, or a click on one, opens it full size (#345). The
  // lightbox walks this grid's own cursor (ADR 0022).
  const lightbox = useLightbox(grid);
  const { openOn } = lightbox;

  const resultControls = useMemo<ResultControls>(
    () => ({ offer: offerNow, noRoot, download, pick, open: openOn }),
    [offerNow, noRoot, download, pick, openOn],
  );

  // What the keys act on, asking the basket at each press what a Result
  // offers, so a key does what the card's buttons do.
  const keys = useMemo(() => resultKeys(offered), [offered]);

  // The keys on the cursor: `P` and `D` are the card's own Pick and Download
  // pressed by key, and with Picks `D` is the tray's Download and `Escape` its
  // Clear.
  const handlers = useRef({ download, downloadPicks, pick });
  useEffect(() => {
    handlers.current = { download, downloadPicks, pick };
  });
  const act = useCallback(
    (action: ResultAction, result: MarkedResult) => {
      switch (action) {
        case "pick":
          handlers.current.pick(result);
          break;
        case "download":
          handlers.current.download(result);
          break;
        case "download-picks":
          handlers.current.downloadPicks();
          break;
        case "clear-picks":
          clearPicks();
          break;
      }
    },
    [clearPicks],
  );

  const ratioHandOff = useMenuHandOff();
  const handOffOnPointerPress = useHandOffOnPointerPress();
  const refine = (change: Partial<Asked>) =>
    void search({ ...asked, ...change });

  const results = shown?.results ?? [];
  const meta = shown?.meta;
  const collapsed = page.collapsed;

  const pillLabel = (ratio: string | null) =>
    ratio === null
      ? "Any ratio"
      : ratio === screen
        ? `${readableRatio(ratio)} · Screen`
        : readableRatio(ratio);

  return (
    <div
      ref={page.scroller}
      data-slot="discover-page"
      onScroll={page.onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <h1 className="sr-only">Discover</h1>

      {/* One header in two shapes rather than a strip beside it, so the search
          box and the pills are the same elements either way and the focus, the
          caret and an open menu survive the swap. */}
      <header
        ref={page.header}
        data-slot="discover-header"
        data-collapsed={collapsed}
        style={page.style}
        className={cn(
          // The strip's ground and rule fade in with its controls.
          "sticky z-20 border-b transition-[background-color,border-color] duration-200 motion-reduce:transition-none",
          collapsed
            ? "top-0 h-11 border-border/60 bg-background/95 backdrop-blur"
            : "border-transparent bg-background",
        )}
      >
        <div
          ref={page.controls}
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
                aria-label={`Ratio: ${pillLabel(asked.ratio)}`}
                size="sm"
                className="shrink-0 rounded-full text-xs"
              >
                <SelectValue>{pillLabel(asked.ratio)}</SelectValue>
              </SelectTrigger>
              <SelectContent onCloseAutoFocus={ratioHandOff.onCloseAutoFocus}>
                {Object.keys(NAMED_RATIOS).map((ratio) => (
                  <SelectItem key={ratio} value={ratio} className="text-xs">
                    {pillLabel(ratio)}
                  </SelectItem>
                ))}
                <SelectSeparator />
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
            <PurityPill asked={asked} onChange={refine} keyed={keyed} />
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
          <div className="flex gap-2">
            {failure.keyRejected && (
              <KeySettingsButton
                onClick={() => setView("settings", { returnTo: "discover" })}
              />
            )}
            <Button variant="outline" onClick={() => void search(asked)}>
              Retry
            </Button>
          </div>
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
          <ResultControlsContext.Provider value={resultControls}>
            {/* The cards' full files decode one at a time (`SharpPicture`). */}
            <DrawTurns>
              <ItemGrid
                ref={setGrid}
                items={results}
                label="Results from Wallhaven"
                actions={keys.grid(picks.length)}
                onAct={act}
                onOpen={openOn}
                // The keys act on the card under the mouse.
                followPointer
                card={RESULT_CARD}
                density="discover"
                className="gap-y-8 px-6 pb-8"
                renderCard={renderResult}
              />
            </DrawTurns>
          </ResultControlsContext.Provider>

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
                <div className="flex gap-2">
                  {failure.keyRejected && (
                    <KeySettingsButton
                      onClick={() =>
                        setView("settings", { returnTo: "discover" })
                      }
                    />
                  )}
                  <Button variant="outline" onClick={() => void loadMore()}>
                    Retry
                  </Button>
                </div>
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

      {picks.length > 0 && (
        <PicksTray
          picks={picks}
          noRoot={noRoot}
          onDownload={downloadPicks}
          onClear={clearPicks}
        />
      )}

      {/* Handed the table with no Picks whatever the tray holds, so `D` in
          here is the Result on screen, as its button says (see
          `RESULT_KEYS`). */}
      <ItemLightbox
        grid={grid}
        open={lightbox.open}
        onClose={lightbox.close}
        actions={keys.lightbox}
        onAct={act}
        picture={resultPicture}
        row={(result) => resultRow(result, resultControls)}
        rowFloor={RESULT_ROW_FLOOR}
        noun="Result"
        gone={PREVIEW_FAILED}
      />
    </div>
  );
}

/**
 * How narrow the lightbox's row under a Result is allowed to get, in pixels,
 * below which it overhangs the picture and the read-out drops (ADR 0022).
 *
 * The widest thing the floor has to hold, which is an unmarked Result whose
 * last download failed: a `wallhaven-<id>` still worth printing (120), its
 * facts beside it (130), the position (40) and the two gaps of 16 around it,
 * then **Failed**, `Pick P` and `Download D` (230 with the gaps between them).
 * That is 552, so 560. A portrait phone wallpaper at the default window is
 * narrower than that, and is the one that drops its read-out.
 */
const RESULT_ROW_FLOOR = 560;

/**
 * What the lightbox's picture says when the full file never arrives: a network
 * fact about Wallhaven, like the card's panel, and never Library's "File is
 * gone" (ADR 0053). In white, since this ground is dark in both themes.
 */
const PREVIEW_FAILED = (
  <>
    <ImageOff className="h-10 w-10 text-white/40" aria-hidden />
    <p className="text-sm font-medium text-white">
      Couldn&apos;t load preview
    </p>
    <p className="max-w-sm text-xs text-white/60">
      Wallhaven didn&apos;t send the full file. It can still be downloaded.
    </p>
  </>
);

/**
 * The lightbox's row under a Result (#345): the identity line, the read-out,
 * and Pick and Download.
 *
 * The identity line is `wallhaven-<id> · 3840×2160 · 10 MB`, the name the
 * file lands under and the two facts that decide whether it is worth taking,
 * the size in the same decimal units the card's caption and the tray use.
 * The read-out is `anime · 231 favourites · 19.4k views`, which is what drops
 * on a picture narrower than the row's floor, since nothing in it is needed in
 * order to act (ADR 0022).
 *
 * The buttons are the card's, printing the keys that fire them, off the same
 * reading of the Result the caption takes: a marked Result shows its mark in
 * their place, one on its way to the library shows where it has got to, and
 * with no Library root Download is the way to one. The dialog is named by the
 * Result, so the buttons carry the verb alone.
 */
function resultRow(
  result: MarkedResult,
  controls: ResultControls,
): LightboxRow {
  return {
    identity: (
      <div
        data-slot="lightbox-identity"
        className="flex min-w-0 items-center gap-1.5"
      >
        <LightboxTitle>{`wallhaven-${result.id}`}</LightboxTitle>{" "}
        <span className="shrink-0 text-sm text-white/70 tabular-nums">
          {`· ${result.dimension_x}×${result.dimension_y} · ${bytes(result.file_size)}`}
        </span>
      </div>
    ),
    readout: (
      <p
        data-slot="lightbox-readout"
        className="truncate text-[11px] text-white/50"
      >
        {`${result.category} · ${compact(result.favorites)} ${
          result.favorites === 1 ? "favourite" : "favourites"
        } · ${compact(result.views)} ${result.views === 1 ? "view" : "views"}`}
      </p>
    ),
    buttons: (
      <ResultOffer result={result} controls={controls} surface="lightbox" />
    ),
  };
}

/**
 * The Picks, floating at the bottom right while there are any: their
 * thumbnails, how many and how large, and **Download** and **Clear**.
 *
 * There is no action that takes a whole page, only the Picks the curator made
 * one at a time, which is Wallhaven's request not to mass-download (#335).
 *
 * The thumbnails are the cards' own `lg` ones, already fetched, so the tray
 * asks Wallhaven for nothing (ADR 0053); the last five show, overlapped. Both
 * buttons empty the tray, which unmounts the control that was pressed, so each
 * hands the keyboard back to the grid, whichever way it was pressed (ADR 0047).
 * `Escape` with the focus in the tray is its Clear, as it is from the grid.
 * With no Library root, Download is the way to one instead, as on a card.
 */
function PicksTray({
  picks,
  noRoot,
  onDownload,
  onClear,
}: {
  picks: MarkedResult[];
  noRoot: boolean;
  onDownload: () => void;
  onClear: () => void;
}) {
  const handOff = useKeyboardHandoff();
  const total = picks.reduce((sum, r) => sum + r.file_size, 0);
  return (
    <section
      aria-label="Picks"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClear();
        handOff();
      }}
      className="fixed right-6 bottom-6 z-30 flex items-center gap-3 rounded-2xl border border-border bg-popover p-2 pl-3 text-popover-foreground shadow-xl"
    >
      <div aria-hidden className="flex -space-x-3">
        {picks.slice(-5).map((r) => (
          <img
            key={r.id}
            src={r.thumbs.large}
            alt=""
            decoding="async"
            className="h-9 w-14 rounded-md border-2 border-popover object-cover"
          />
        ))}
      </div>
      <p className="text-sm tabular-nums">
        {picks.length} picked
        <span className="block text-[11px] text-muted-foreground">
          {bytes(total)}
        </span>
      </p>
      {noRoot ? (
        <Button
          variant="link"
          size="sm"
          // It puts the caret in the Library root field itself.
          data-moves-focus
          className="px-0 text-xs"
          onClick={onDownload}
        >
          {NO_ROOT}
        </Button>
      ) : (
        <Button
          aria-keyshortcuts={keyShortcut("download-picks", RESULT_KEYS)}
          onClick={() => {
            onDownload();
            handOff();
          }}
        >
          <Download />
          Download
          <Kbd aria-hidden>{printedKey("download-picks", RESULT_KEYS)}</Kbd>
        </Button>
      )}
      <Button
        variant="ghost"
        aria-keyshortcuts={keyShortcut("clear-picks", RESULT_KEYS)}
        onClick={() => {
          onClear();
          handOff();
        }}
      >
        <X />
        Clear
        <Kbd aria-hidden>{printedKey("clear-picks", RESULT_KEYS)}</Kbd>
      </Button>
    </section>
  );
}

/** A pill's look, which the Ratio pill's `SelectTrigger` has at `size="sm"`. */
const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-input bg-transparent pr-2 pl-2.5 text-xs whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted dark:bg-input/30 dark:hover:bg-input/50";

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
  const handOff = useMenuHandOff();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        {...handOff.trigger}
        aria-label={`${name}: ${label}`}
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
 * The way from a rejected key to the Settings page that replaces it. No focus
 * key rides along: the key is not a `SettingKey`, since `set_setting` never
 * writes it, so the curator lands on Settings and Back returns to Discover.
 */
function KeySettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <SettingsIcon aria-hidden />
      Open Settings
    </Button>
  );
}

/**
 * Purity. NSFW needs an API key, so until one is saved it is shown and
 * disabled, saying how to unlock it; the backend refuses it too (ADR 0054).
 */
function PurityPill({
  asked,
  onChange,
  keyed,
}: PillProps & {
  /** Whether a Wallhaven API key is saved, which is what NSFW needs. */
  keyed: boolean;
}) {
  const on = PURITIES.filter(({ value }) => asked.purity[value]);
  return (
    <Pill name="Purity" label={on.map(({ label }) => label).join(" + ")}>
      {PURITIES.map(({ value, label }) => (
        <DropdownMenuCheckboxItem
          key={value}
          checked={asked.purity[value]}
          disabled={
            (value === "nsfw" && !keyed) ||
            (asked.purity[value] && on.length === 1)
          }
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            onChange({ purity: { ...asked.purity, [value]: checked === true } })
          }
        >
          {value === "nsfw" && !keyed ? (
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
        <DropdownMenuSwatchGrid columns={8}>
          {WALLHAVEN_COLOURS.map((colour) => (
            <DropdownMenuSwatchItem
              key={colour}
              value={colour}
              colour={`#${colour}`}
              aria-label={colourName(colour)}
            />
          ))}
        </DropdownMenuSwatchGrid>
      </DropdownMenuRadioGroup>
    </Pill>
  );
}

/** The grid's renderer: a value per prop, so the card's memo holds (#230). */
function renderResult(
  result: MarkedResult,
  { cellIndex, selected, columns }: GridCell,
) {
  return (
    <ResultCard
      result={result}
      cellIndex={cellIndex}
      selected={selected}
      full={columns <= FULL_FILE_COLUMNS}
    />
  );
}

/**
 * The most columns at which a card lays the full file over its `lg`. At three
 * a card is drawn wider than the `lg`'s 432 pixels on most screens, so the
 * thumbnail is upscaled into a blur; at four and five it is not.
 */
const FULL_FILE_COLUMNS = 3;

/** What a caption says for each state of a download, where Download would sit. */
const DOWNLOAD_TEXT: Record<ResultDownload["kind"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  landed: "Added to library",
  failed: "Failed",
};

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
 * An unmarked card's caption carries Download, and then follows its file:
 * Queued, Downloading, and "Added to library", by which time the card is an
 * In library card. A file that failed reads **Failed**, with the backend's
 * sentence as its tooltip, and offers Download again. With no Library root,
 * Download is "Choose a library root to download" instead, and takes the
 * curator to that field (ADR 0051).
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
  full,
}: {
  result: MarkedResult;
  cellIndex: number;
  selected: boolean;
  /** Whether the zoom is wide enough for the full file (`FULL_FILE_COLUMNS`). */
  full: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // Whether the full file over the `lg` has been drawn, and so is shown. Kept
  // across a zoom out and back, as a Library card keeps its `medium`'s.
  const [sharp, setSharp] = useState(false);
  const controls = useContext(ResultControlsContext);
  const handOffOnPointerPress = useHandOffOnPointerPress();
  const { download, mark, picked } = controls.offer(result);
  const said = mark
    ? MARK_TEXT[mark]
    : download
      ? DOWNLOAD_TEXT[download.kind]
      : picked
        ? "Picked"
        : null;
  const facts = `${result.resolution}, ${bytes(result.file_size)}, ${result.category}`;
  const pictureClassName = cn(
    "h-full w-full object-cover",
    // On the picture and not the card, as on a Rejected card in Library, so
    // the caption's mark stays readable.
    result.mark !== "unmarked" && DIMMED_PICTURE,
  );
  // Once the full file is shown, the `lg` under it is hidden rather than left
  // to show through: two dimmed pictures stacked read as one barely dimmed.
  const covered = full && sharp;
  return (
    <figure
      role="gridcell"
      tabIndex={selected ? 0 : -1}
      data-cell={cellIndex}
      aria-label={said ? `${facts}, ${said}` : facts}
      // A click on the card opens it, as `Enter` does; its buttons keep their
      // clicks to themselves (ADR 0022).
      onClick={() => controls.open(result)}
      className="group m-0 flex flex-col gap-2 rounded-xl outline-none"
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-xl bg-card",
          // A Pick leaves the picture alone and says so on its Pick button.
          // The focus ring is the keyboard's, and not drawn while the mouse
          // put the cursor here (`data-pointed`): a `P` pressed over a card
          // would otherwise have WebKit draw it as keyboard focus.
          "not-in-data-pointed:group-focus-visible:ring-2 not-in-data-pointed:group-focus-visible:ring-primary not-in-data-pointed:group-focus-visible:ring-offset-2 not-in-data-pointed:group-focus-visible:ring-offset-background",
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
          className={cn(pictureClassName, (failed || covered) && "invisible")}
        />
        {/* Laid over the `lg` and shown once it has been drawn, so a zoom in
            sharpens the card rather than blanking it. A full file that fails
            leaves the `lg` showing, which is still the picture. Kept mounted
            but hidden at four and five once drawn, so a zoom back in shows it
            at once. */}
        {(full || sharp) && !failed && (
          <SharpPicture
            src={fullFileUrl(result)}
            className={pictureClassName}
            shown={covered}
            onDrawn={() => setSharp(true)}
          />
        )}
        {failed && (
          <div
            data-slot="preview-failed"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"
          >
            <ImageOff aria-hidden className="size-5 opacity-60" />
            <span className="text-xs">Couldn&apos;t load preview</span>
          </div>
        )}
        {/* The card under the mouse, which is the one the keys act on
            (`followPointer`). A thin, half-strength inset ring and nothing
            over the wallpaper itself, on a layer inside the clipped picture,
            so a hover repaints nothing outside the card. */}
        <div
          aria-hidden
          data-slot="hover-frame"
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-2 ring-primary/50 ring-inset transition-opacity duration-150 group-hover:opacity-100"
        />
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
        <ResultOffer
          result={result}
          controls={controls}
          surface="card"
          subject={facts}
          // The pointer's press hands the keyboard back to the grid, so `D`
          // still reaches the cursor after a click (ADR 0047), and stops
          // there rather than opening the card as well.
          onClick={(event) => {
            handOffOnPointerPress(event);
            event.stopPropagation();
          }}
        />
      </figcaption>
    </figure>
  );
});

/**
 * How the offer looks on each surface that draws it: the card's caption, on
 * the page's theme, and the lightbox's row, dark in both themes.
 *
 * On a card the buttons are out of the tab order, because the grid's cell is
 * the tab stop and `P` and `D` are how the keyboard presses them (ADR 0019).
 * In the lightbox they are the row's own controls, and the first Tab reaches
 * them (ADR 0022).
 */
const OFFER_LOOK = {
  card: {
    text: "",
    muted: "text-muted-foreground",
    landed: "text-emerald-600 dark:text-emerald-400",
    download: "outline",
    rootLink: "h-7 px-0 text-xs",
    tabIndex: -1,
  },
  lightbox: {
    text: "text-xs",
    muted: "text-white/60",
    landed: "text-emerald-400",
    download: "default",
    rootLink: "px-0 text-xs",
    tabIndex: undefined,
  },
} as const;

/**
 * What a Result offers where Pick and Download go, drawn once for the card's
 * caption and the lightbox's row (#345), off the basket's one `offer`.
 *
 * A marked Result says its mark. One on its way to the library says where it
 * has got to: Queued, Downloading, and "Added to library". Otherwise it offers
 * Pick and Download, after **Failed** with the backend's sentence as its
 * tooltip when the last try failed; with no Library root, Download is
 * "Choose a library root to download" instead, and takes the curator to that
 * field (ADR 0051).
 *
 * `subject` is what the buttons are about, for their names on a card, where a
 * grid holds many Picks and Downloads. The lightbox's dialog is already named
 * by its Result, so there the buttons carry the verb alone.
 */
function ResultOffer({
  result,
  controls,
  surface,
  subject,
  onClick,
}: {
  result: MarkedResult;
  controls: ResultControls;
  surface: keyof typeof OFFER_LOOK;
  subject?: string;
  /** A press anywhere on the buttons, which the card hands the keyboard back on. */
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const look = OFFER_LOOK[surface];
  const {
    download: state,
    mark,
    offered,
    picked: isPick,
  } = controls.offer(result);
  const named = (verb: string) => (subject ? `${verb} ${subject}` : undefined);
  if (mark) {
    return (
      <span
        data-slot="result-mark"
        className={cn("shrink-0", look.text, look.muted)}
      >
        {MARK_TEXT[mark]}
      </span>
    );
  }
  if (state && state.kind !== "failed") {
    return (
      <span
        data-slot="result-download"
        className={cn(
          "flex shrink-0 items-center gap-1",
          look.text,
          state.kind === "landed" ? look.landed : look.muted,
        )}
      >
        {state.kind === "downloading" && (
          <Loader2 aria-hidden className="size-3 animate-spin" />
        )}
        {state.kind === "landed" && <Check aria-hidden className="size-3.5" />}
        {DOWNLOAD_TEXT[state.kind]}
      </span>
    );
  }
  if (!offered) return null;
  return (
    <div className="flex shrink-0 items-center gap-2" onClick={onClick}>
      {state?.kind === "failed" && (
        <span
          data-slot="result-download"
          className={cn("text-destructive", look.text)}
          title={state.message}
        >
          Failed
        </span>
      )}
      {controls.noRoot ? (
        <Button
          variant="link"
          size="sm"
          // It puts the caret in the Library root field itself.
          data-moves-focus
          tabIndex={look.tabIndex}
          className={look.rootLink}
          onClick={() => controls.download(result)}
        >
          {NO_ROOT}
        </Button>
      ) : (
        <>
          <Button
            // Filled when picked: the button is the whole of what a Pick
            // looks like on a card.
            variant={isPick ? "default" : "ghost"}
            size="sm"
            aria-label={named("Pick")}
            aria-pressed={isPick}
            aria-keyshortcuts={keyShortcut("pick", RESULT_KEYS)}
            tabIndex={look.tabIndex}
            onClick={() => controls.pick(result)}
          >
            {isPick ? <Check /> : <Plus />}
            {isPick ? "Picked" : "Pick"}
            <Kbd aria-hidden>{printedKey("pick", RESULT_KEYS)}</Kbd>
          </Button>
          <Button
            variant={look.download}
            size="sm"
            aria-label={named("Download")}
            aria-keyshortcuts={keyShortcut("download", RESULT_KEYS)}
            tabIndex={look.tabIndex}
            onClick={() => controls.download(result)}
          >
            <Download />
            Download
            <Kbd aria-hidden>{printedKey("download", RESULT_KEYS)}</Kbd>
          </Button>
        </>
      )}
    </div>
  );
}
