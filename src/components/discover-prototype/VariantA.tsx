// PROTOTYPE — Variant A, "Library twin". Everything reads like the Library
// page: one PageBar of chips and drop-downs, a uniform aspect-video grid that
// scrolls forever, marks in the Status-pill corner, a hover overlay with the
// action, and a Library-style lightbox. Multi-select is Ctrl/Shift-click or
// Space; D downloads the picks, or the cursor when nothing is picked.
import { PageBar } from "@/components/PageBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedGroup } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  canDownload,
  CATEGORIES,
  COMMON_RATIOS,
  compact,
  effectiveMark,
  MarkPill,
  megabytes,
  PURITIES,
  readableRatio,
  SORTINGS,
  TOP_RANGES,
  TOTAL,
  type DownloadState,
  type Result,
  type Sorting,
  type TopRange,
} from "./shared";
import type { DiscoverProps } from "./DiscoverPrototype";

export function VariantA({
  filters,
  set,
  toggle,
  screenRatio,
  search,
  downloads,
  picks,
}: DiscoverProps) {
  const [cursor, setCursor] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [draft, setDraft] = useState(filters.q);
  const grid = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { results } = search;

  // Infinite scroll: the next Wallhaven page loads as the sentinel nears.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && search.loadMore(),
      { rootMargin: "600px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [search]);

  useEffect(() => {
    grid.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.focus({ preventScroll: false });
  }, [cursor]);

  const downloadable = (ids: string[]) =>
    ids.filter((id) => {
      const r = results.find((x) => x.id === id);
      return r && canDownload(r, downloads.states[id]);
    });

  const downloadNow = (ids: string[]) => {
    const ok = downloadable(ids);
    downloads.download(ok);
    picks.drop(ids);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const cols = Math.max(
      1,
      Math.round(
        (grid.current?.clientWidth ?? 1) /
          ((grid.current?.firstElementChild as HTMLElement | null)
            ?.offsetWidth ?? 1),
      ),
    );
    const r = results[cursor];
    if (e.key === "ArrowRight") setCursor((c) => Math.min(results.length - 1, c + 1));
    else if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
    else if (e.key === "ArrowDown") setCursor((c) => Math.min(results.length - 1, c + cols));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - cols));
    else if (e.key === " " && r) {
      if (canDownload(r, downloads.states[r.id])) picks.toggle(r.id);
    } else if ((e.key === "d" || e.key === "D") && r) {
      downloadNow(picks.picks.length ? picks.picks : [r.id]);
    } else if (e.key === "Enter") setLightbox(true);
    else if (e.key === "Escape" && picks.picks.length) picks.clear();
    else return;
    e.preventDefault();
  };

  const pickedBytes = picks.picks.reduce(
    (sum, id) => sum + (results.find((r) => r.id === id)?.file_size ?? 0),
    0,
  );

  return (
    <>
      <PageBar>
        <form
          className="relative w-56 shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", draft);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Wallhaven"
            className="h-7 pl-7 text-[0.8rem]"
          />
        </form>

        <Select
          value={filters.ratio ?? "any"}
          onValueChange={(v) => set("ratio", v === "any" ? null : v)}
        >
          <SelectTrigger size="sm" className="shrink-0 text-[0.8rem]" aria-label="Ratio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={screenRatio} className="text-[0.8rem]">
              {readableRatio(screenRatio)} · Screen
            </SelectItem>
            {COMMON_RATIOS.filter((r) => r !== screenRatio).map((r) => (
              <SelectItem key={r} value={r} className="text-[0.8rem]">
                {readableRatio(r)}
              </SelectItem>
            ))}
            <SelectItem value="any" className="text-[0.8rem]">
              Any ratio
            </SelectItem>
          </SelectContent>
        </Select>

        <SegmentedGroup role="group" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <Button
              key={c.value}
              size="sm"
              variant="segment"
              aria-pressed={filters.categories.includes(c.value)}
              onClick={() => toggle("categories", c.value)}
            >
              {c.label}
            </Button>
          ))}
        </SegmentedGroup>

        <SegmentedGroup role="group" aria-label="Purity">
          {PURITIES.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant="segment"
              aria-pressed={filters.purity.includes(p.value)}
              disabled={p.value === "nsfw"}
              title={p.value === "nsfw" ? "Needs a Wallhaven API key (Settings)" : undefined}
              onClick={() => toggle("purity", p.value)}
            >
              {p.label}
            </Button>
          ))}
        </SegmentedGroup>

        <Select
          value={filters.sorting}
          onValueChange={(v) => set("sorting", v as Sorting)}
        >
          <SelectTrigger size="sm" className="shrink-0 text-[0.8rem]" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTINGS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-[0.8rem]">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.sorting === "toplist" && (
          <Select
            value={filters.topRange}
            onValueChange={(v) => set("topRange", v as TopRange)}
          >
            <SelectTrigger size="sm" className="shrink-0 text-[0.8rem]" aria-label="Toplist range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOP_RANGES.map((r) => (
                <SelectItem key={r} value={r} className="text-[0.8rem]">
                  Past {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {picks.picks.length > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">
                {picks.picks.length} picked · {megabytes(pickedBytes)}
              </span>
              <Button size="sm" onClick={() => downloadNow(picks.picks)}>
                <Download /> Download {picks.picks.length}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Clear picks" onClick={picks.clear}>
                <X />
              </Button>
            </>
          ) : (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {search.loading && results.length === 0
                ? "Searching…"
                : `${TOTAL} results`}
            </span>
          )}
        </div>
      </PageBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={grid}
          role="grid"
          aria-label="Wallhaven results"
          onKeyDown={onKeyDown}
          className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-6 p-4"
        >
          {results.map((r, i) => (
            <CardA
              key={r.id}
              r={r}
              index={i}
              selected={i === cursor}
              picked={picks.picks.includes(r.id)}
              state={downloads.states[r.id]}
              onOpen={() => {
                setCursor(i);
                setLightbox(true);
              }}
              onPick={() => {
                setCursor(i);
                picks.toggle(r.id);
              }}
              onDownload={() => downloadNow([r.id])}
            />
          ))}
        </div>
        <div ref={sentinel} className="flex h-16 items-center justify-center text-xs text-muted-foreground">
          {search.loading && <Loader2 className="size-4 animate-spin" />}
        </div>
      </div>

      {lightbox && results[cursor] && (
        <LightboxA
          r={results[cursor]}
          index={cursor}
          count={results.length}
          picked={picks.picks.includes(results[cursor].id)}
          state={downloads.states[results[cursor].id]}
          onStep={(by) =>
            setCursor((c) => Math.max(0, Math.min(results.length - 1, c + by)))
          }
          onPick={() => picks.toggle(results[cursor].id)}
          onDownload={() => downloadNow([results[cursor].id])}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
}

function CardA({
  r,
  index,
  selected,
  picked,
  state,
  onOpen,
  onPick,
  onDownload,
}: {
  r: Result;
  index: number;
  selected: boolean;
  picked: boolean;
  state: DownloadState | undefined;
  onOpen: () => void;
  onPick: () => void;
  onDownload: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const mark = effectiveMark(r, state);
  const pickable = canDownload(r, state);

  return (
    <div
      role="gridcell"
      data-index={index}
      tabIndex={selected ? 0 : -1}
      aria-selected={picked}
      onClick={(e) => {
        if ((e.ctrlKey || e.shiftKey) && pickable) onPick();
        else onOpen();
      }}
      className={cn(
        "group relative aspect-video cursor-pointer overflow-hidden rounded-lg border border-border bg-card outline-none",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        picked && "border-primary",
      )}
    >
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
          <AlertCircle className="size-5" />
          <span className="text-[11px] font-medium">Couldn't load preview</span>
        </div>
      ) : (
        <img
          src={r.thumbs.large}
          alt={`Wallhaven ${r.id}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            "h-full w-full object-cover",
            mark === "rejected" && "opacity-60 grayscale",
          )}
        />
      )}

      {picked && <div className="pointer-events-none absolute inset-0 bg-primary/15" />}

      {/* Top left: the pick box and the mark, the Status-pill corner. */}
      <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
        {pickable && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={picked ? "Unpick" : "Pick"}
            onClick={(e) => {
              e.stopPropagation();
              onPick();
            }}
            className={cn(
              "flex size-5 items-center justify-center rounded-full border border-white/70 bg-black/40 text-white backdrop-blur-md",
              picked
                ? "border-transparent bg-primary text-primary-foreground"
                : "opacity-0 group-hover:opacity-100",
            )}
          >
            {picked && <Check className="size-3" />}
          </button>
        )}
        <MarkPill mark={mark} />
        {state && state.kind !== "landed" && <StatePill state={state} />}
      </div>

      {/* Top right: resolution, where the Score badge sits in Library. */}
      <div className="pointer-events-none absolute top-1.5 right-1.5 rounded-md border border-white/30 bg-black/50 px-1.5 py-0.5 text-[11px] text-white/80 tabular-nums backdrop-blur-md">
        {r.dimension_x}×{r.dimension_y}
      </div>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
        <div className="dark pointer-events-auto flex items-end gap-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-white">
              {r.id} · {r.category}
            </p>
            <p className="flex items-center gap-1 truncate text-[10px] text-white/60">
              {megabytes(r.file_size)} · <Heart className="size-2.5" /> {compact(r.favorites)}
            </p>
          </div>
          {pickable ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
            >
              <Download /> Download
              <kbd className="ml-1 text-[10px] text-muted-foreground">D</kbd>
            </Button>
          ) : (
            <span className="text-[11px] text-white/60">
              {mark === "in_library"
                ? "Already in library"
                : mark === "rejected"
                  ? "You rejected this"
                  : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatePill({ state }: { state: DownloadState }) {
  if (state.kind === "landed") return null;
  return (
    <div
      title={state.kind === "failed" ? state.message : undefined}
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] backdrop-blur-md",
        state.kind === "failed"
          ? "bg-destructive text-white"
          : "bg-black/60 text-white",
      )}
    >
      {state.kind === "downloading" && <Loader2 className="size-3 animate-spin" />}
      {state.kind === "queued" ? "Queued" : state.kind === "downloading" ? "Downloading" : "Failed"}
    </div>
  );
}

function LightboxA({
  r,
  index,
  count,
  picked,
  state,
  onStep,
  onPick,
  onDownload,
  onClose,
}: {
  r: Result;
  index: number;
  count: number;
  picked: boolean;
  state: DownloadState | undefined;
  onStep: (by: 1 | -1) => void;
  onPick: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [sharp, setSharp] = useState(false);
  const mark = effectiveMark(r, state);
  const pickable = canDownload(r, state);

  useEffect(() => setSharp(false), [r.id]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === " " && pickable) onPick();
      else if ((e.key === "d" || e.key === "D") && pickable) onDownload();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onStep, onPick, onDownload, pickable]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 p-8">
      <div className="relative flex max-h-[80vh] max-w-[90vw] items-center justify-center">
        <img
          src={r.thumbs.large}
          alt=""
          className="max-h-[80vh] max-w-[90vw] object-contain"
          style={{ aspectRatio: `${r.dimension_x}/${r.dimension_y}`, width: "80vw" }}
        />
        {/* The full file, from w.wallhaven.cc — the one thing that makes this
            preview worth opening, since the largest thumbnail is 432px wide. */}
        <img
          key={r.id}
          src={r.full}
          alt={`Wallhaven ${r.id}`}
          onLoad={() => setSharp(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-contain",
            !sharp && "opacity-0",
          )}
        />
        {!sharp && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
            <Loader2 className="size-3 animate-spin" /> Loading full size ·{" "}
            {megabytes(r.file_size)}
          </div>
        )}
      </div>

      <div className="dark flex w-[min(80vw,64rem)] items-center gap-3 text-white">
        <Button size="icon-sm" variant="secondary" disabled={index === 0} onClick={() => onStep(-1)}>
          <ChevronLeft />
        </Button>
        <span className="text-xs text-white/60 tabular-nums">
          {index + 1} / {count}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            wallhaven-{r.id} · {r.resolution} · {megabytes(r.file_size)}
          </p>
          <p className="truncate text-xs text-white/60">
            {r.category} · {r.purity} · {compact(r.views)} views ·{" "}
            {compact(r.favorites)} favourites
          </p>
        </div>
        <MarkPill mark={mark} />
        {state && <StatePill state={state} />}
        {pickable && (
          <>
            <Button size="sm" variant={picked ? "default" : "secondary"} onClick={onPick}>
              {picked ? <Check /> : null} {picked ? "Picked" : "Pick"}
              <kbd className="ml-1 text-[10px] opacity-60">Space</kbd>
            </Button>
            <Button size="sm" variant="secondary" onClick={onDownload}>
              <Download /> Download <kbd className="ml-1 text-[10px] opacity-60">D</kbd>
            </Button>
          </>
        )}
        <Button size="icon-sm" variant="secondary" disabled={index === count - 1} onClick={() => onStep(1)}>
          <ChevronRight />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
    </div>
  );
}
