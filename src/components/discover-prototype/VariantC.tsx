// PROTOTYPE — Variant C, "Search-first stream". No page bar: a big search box
// with the filters folded into pills that open on click, then large cards
// with their facts written under the picture instead of over it. Marked
// results shrink to a thin strip so they're visible but out of the way. Picks
// collect in a floating dock; "Load more" rather than endless scroll; a click
// opens a full-window viewer with a filmstrip of what's loaded.
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  Download,
  Heart,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canDownload,
  CATEGORIES,
  COLORS,
  COMMON_RATIOS,
  compact,
  effectiveMark,
  LAST_PAGE,
  MARK_LABEL,
  megabytes,
  PURITIES,
  readableRatio,
  SORTINGS,
  TOP_RANGES,
  type DownloadState,
  type Result,
} from "./shared";
import type { DiscoverProps } from "./DiscoverPrototype";

export function VariantC({
  filters,
  set,
  toggle,
  screenRatio,
  search,
  downloads,
  picks,
}: DiscoverProps) {
  const [draft, setDraft] = useState(filters.q);
  const [viewing, setViewing] = useState<number | null>(null);
  const { results } = search;

  const downloadNow = (ids: string[]) => {
    downloads.download(
      ids.filter((id) => {
        const r = results.find((x) => x.id === id);
        return r && canDownload(r, downloads.states[id]);
      }),
    );
    picks.drop(ids);
  };

  const sortLabel = SORTINGS.find((s) => s.value === filters.sorting)!.label;
  const pickedResults = picks.picks
    .map((id) => results.find((r) => r.id === id))
    .filter((r): r is Result => !!r);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 pt-8 pb-6">
        <form
          className="relative w-full"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", draft);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Wallhaven — tags, colours, like:<id>…"
            className="h-11 w-full rounded-full border border-border bg-card pr-4 pl-10 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </form>

        <div className="flex flex-wrap justify-center gap-2">
          <Pill label={filters.ratio ? `${readableRatio(filters.ratio)}${filters.ratio === screenRatio ? " · Screen" : ""}` : "Any ratio"}>
            {(close) => (
              <PillMenu>
                {[screenRatio, ...COMMON_RATIOS.filter((r) => r !== screenRatio)].map((r) => (
                  <PillItem key={r} on={filters.ratio === r} onClick={() => { set("ratio", r); close(); }}>
                    {readableRatio(r)} {r === screenRatio && <span className="text-muted-foreground">· your Screen</span>}
                  </PillItem>
                ))}
                <PillItem on={filters.ratio === null} onClick={() => { set("ratio", null); close(); }}>
                  Any ratio
                </PillItem>
              </PillMenu>
            )}
          </Pill>

          <Pill label={filters.sorting === "toplist" ? `Toplist · ${filters.topRange}` : sortLabel}>
            {(close) => (
              <PillMenu>
                {SORTINGS.map((s) => (
                  <PillItem key={s.value} on={filters.sorting === s.value} onClick={() => { set("sorting", s.value); if (s.value !== "toplist") close(); }}>
                    {s.label}
                  </PillItem>
                ))}
                {filters.sorting === "toplist" && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t border-border pt-2">
                    {TOP_RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => { set("topRange", r); close(); }}
                        className={cn("rounded px-1.5 py-0.5 text-xs", filters.topRange === r ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-muted")}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </PillMenu>
            )}
          </Pill>

          <Pill label={filters.categories.length === 3 ? "All categories" : filters.categories.map((c) => CATEGORIES.find((x) => x.value === c)!.label).join(", ")}>
            {() => (
              <PillMenu>
                {CATEGORIES.map((c) => (
                  <PillItem key={c.value} on={filters.categories.includes(c.value)} check onClick={() => toggle("categories", c.value)}>
                    {c.label}
                  </PillItem>
                ))}
              </PillMenu>
            )}
          </Pill>

          <Pill label={filters.purity.map((p) => PURITIES.find((x) => x.value === p)!.label).join(" + ")}>
            {() => (
              <PillMenu>
                {PURITIES.map((p) => (
                  <PillItem key={p.value} on={filters.purity.includes(p.value)} check disabled={p.value === "nsfw"} onClick={() => toggle("purity", p.value)}>
                    {p.label}
                    {p.value === "nsfw" && <span className="text-[10px] text-muted-foreground">Add an API key in Settings</span>}
                  </PillItem>
                ))}
              </PillMenu>
            )}
          </Pill>

          <Pill
            label={filters.color ? "Colour" : "Any colour"}
            swatch={filters.color}
          >
            {(close) => (
              <div className="grid w-56 grid-cols-8 gap-1 p-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { set("color", filters.color === c ? null : c); close(); }}
                    className={cn("aspect-square rounded-sm border border-border/60", filters.color === c && "ring-2 ring-primary")}
                    style={{ background: `#${c}` }}
                  />
                ))}
              </div>
            )}
          </Pill>
        </div>
      </div>

      {search.loading && results.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-x-6 gap-y-8 px-6 pb-8">
          {results.map((r, i) => {
            const state = downloads.states[r.id];
            const mark = effectiveMark(r, state);
            return mark !== "none" && state?.kind !== "landed" ? (
              <MarkedStrip key={r.id} r={r} mark={mark} onOpen={() => setViewing(i)} />
            ) : (
              <CardC
                key={r.id}
                r={r}
                state={state}
                picked={picks.picks.includes(r.id)}
                onOpen={() => setViewing(i)}
                onPick={() => picks.toggle(r.id)}
                onDownload={() => downloadNow([r.id])}
              />
            );
          })}
        </div>
      )}

      {results.length > 0 && (
        <div className="flex flex-col items-center gap-1 pb-24">
          <Button variant="outline" onClick={search.loadMore} disabled={search.loading || search.page >= LAST_PAGE}>
            {search.loading ? <Loader2 className="animate-spin" /> : null} Load more
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {search.page} of {LAST_PAGE}
          </span>
        </div>
      )}

      {pickedResults.length > 0 && (
        <div className="fixed right-6 bottom-16 z-40 flex items-center gap-3 rounded-2xl border border-border bg-popover p-2 pl-3 shadow-xl">
          <div className="flex -space-x-3">
            {pickedResults.slice(-5).map((r) => (
              <img key={r.id} src={r.thumbs.original} alt="" className="h-9 w-14 rounded-md border-2 border-popover object-cover" />
            ))}
          </div>
          <span className="text-sm">
            {pickedResults.length} picked
            <span className="block text-[11px] text-muted-foreground">
              {megabytes(pickedResults.reduce((s, r) => s + r.file_size, 0))}
            </span>
          </span>
          <Button onClick={() => downloadNow(picks.picks)}>
            <Download /> Download
          </Button>
          <Button size="icon" variant="ghost" onClick={picks.clear} aria-label="Clear picks">
            <X />
          </Button>
        </div>
      )}

      {viewing !== null && results[viewing] && (
        <Viewer
          results={results}
          index={viewing}
          states={downloads.states}
          picks={picks.picks}
          onIndex={setViewing}
          onPick={(id) => picks.toggle(id)}
          onDownload={(id) => downloadNow([id])}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function Pill({
  label,
  swatch,
  children,
}: {
  label: string;
  swatch?: string | null;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs hover:bg-muted",
          open && "bg-secondary",
        )}
      >
        {swatch && <span className="size-3 rounded-full" style={{ background: `#${swatch}` }} />}
        {label}
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-10 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-border bg-popover shadow-lg">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function PillMenu({ children }: { children: ReactNode }) {
  return <div className="flex min-w-44 flex-col p-1">{children}</div>;
}

function PillItem({
  on,
  check,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  check?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
    >
      <span className={cn("flex size-3.5 items-center justify-center", check && "rounded-sm border border-border", check && on && "border-transparent bg-primary text-primary-foreground")}>
        {on && <Check className="size-3" />}
      </span>
      <span className="flex flex-col">{children}</span>
    </button>
  );
}

function CardC({
  r,
  state,
  picked,
  onOpen,
  onPick,
  onDownload,
}: {
  r: Result;
  state: DownloadState | undefined;
  picked: boolean;
  onOpen: () => void;
  onPick: () => void;
  onDownload: () => void;
}) {
  const pickable = canDownload(r, state);
  return (
    <figure className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "relative aspect-video overflow-hidden rounded-xl bg-card",
          picked && "ring-3 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <img src={r.thumbs.large} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        {state?.kind === "downloading" && (
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/40">
            <div className="h-full w-full animate-pulse bg-white/80" />
          </div>
        )}
      </button>
      <figcaption className="flex items-center gap-2 text-xs">
        <div className="min-w-0 flex-1">
          <p className="font-medium tabular-nums">
            {r.resolution} <span className="font-normal text-muted-foreground">· {megabytes(r.file_size)}</span>
          </p>
          <p className="flex items-center gap-1 text-muted-foreground">
            <Heart className="size-3" /> {compact(r.favorites)} · {r.category}
          </p>
        </div>
        {state?.kind === "landed" ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" /> Added to library
          </span>
        ) : state?.kind === "queued" ? (
          <span className="text-muted-foreground">Queued</span>
        ) : state?.kind === "downloading" ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Downloading
          </span>
        ) : (
          <>
            {state?.kind === "failed" && (
              <span className="text-destructive" title={state.message}>
                Failed
              </span>
            )}
            {pickable && (
              <>
                <Button size="sm" variant={picked ? "secondary" : "ghost"} onClick={onPick}>
                  {picked ? <Check /> : <Plus />} {picked ? "Picked" : "Pick"}
                </Button>
                <Button size="icon-sm" variant="outline" onClick={onDownload} aria-label="Download">
                  <Download />
                </Button>
              </>
            )}
          </>
        )}
      </figcaption>
    </figure>
  );
}

function MarkedStrip({
  r,
  mark,
  onOpen,
}: {
  r: Result;
  mark: "in_library" | "rejected";
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-12 items-center gap-3 self-start rounded-xl border border-dashed border-border px-2 text-left text-xs text-muted-foreground hover:bg-muted"
    >
      <img src={r.thumbs.original} alt="" className={cn("h-8 w-14 rounded object-cover", mark === "rejected" && "grayscale")} />
      <span className="min-w-0 flex-1 truncate">
        {MARK_LABEL[mark]} · {r.resolution}
      </span>
    </button>
  );
}

function Viewer({
  results,
  index,
  states,
  picks,
  onIndex,
  onPick,
  onDownload,
  onClose,
}: {
  results: Result[];
  index: number;
  states: Record<string, DownloadState>;
  picks: string[];
  onIndex: (i: number) => void;
  onPick: (id: string) => void;
  onDownload: (id: string) => void;
  onClose: () => void;
}) {
  const r = results[index];
  const state = states[r.id];
  const mark = effectiveMark(r, state);
  const pickable = canDownload(r, state);
  const [full, setFull] = useState(false);
  const [sharp, setSharp] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFull(false);
    setSharp(false);
    strip.current
      ?.querySelector(`[data-i="${index}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
      else if (e.key === "ArrowRight") onIndex(Math.min(results.length - 1, index + 1));
      else if ((e.key === "p" || e.key === "P") && pickable) onPick(r.id);
      else if ((e.key === "d" || e.key === "D") && pickable) onDownload(r.id);
      else if (e.key === "f" || e.key === "F") setFull(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, results.length, pickable, r.id, onClose, onIndex, onPick, onDownload]);

  return (
    <div className="dark fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 items-center justify-center p-6">
          <img src={r.thumbs.large} alt="" className="max-h-full max-w-full object-contain" style={{ width: "100%" }} />
          {full && (
            <img
              src={r.full}
              alt=""
              onLoad={() => setSharp(true)}
              className={cn("absolute inset-6 m-auto max-h-[calc(100%-3rem)] max-w-[calc(100%-3rem)] object-contain", !sharp && "opacity-0")}
            />
          )}
          {!full && (
            <button
              type="button"
              onClick={() => setFull(true)}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs backdrop-blur hover:bg-white/20"
            >
              Preview is 432px — load full size ({megabytes(r.file_size)}) <kbd className="ml-1 opacity-60">F</kbd>
            </button>
          )}
          {full && !sharp && (
            <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs">
              <Loader2 className="size-3 animate-spin" /> Loading {megabytes(r.file_size)}
            </div>
          )}
        </div>

        <aside className="flex w-72 shrink-0 flex-col gap-3 border-l border-white/10 p-5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50 tabular-nums">
              {index + 1} / {results.length}
            </span>
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
          <p className="text-lg font-medium tabular-nums">{r.resolution}</p>
          <p className="text-xs text-white/60">
            {megabytes(r.file_size)} · {r.category} · {r.purity} ·{" "}
            {compact(r.favorites)} favourites · {compact(r.views)} views
          </p>
          <div className="flex gap-1">
            {r.colors.map((c) => (
              <span key={c} className="h-4 flex-1 rounded-sm" style={{ background: c }} />
            ))}
          </div>
          {mark !== "none" && (
            <p className="rounded-md bg-white/10 px-2 py-1.5 text-xs">
              {mark === "in_library" ? "Already in your library." : "You rejected this one."}
            </p>
          )}
          {pickable && (
            <div className="mt-auto flex flex-col gap-2">
              <Button variant="secondary" onClick={() => onPick(r.id)}>
                {picks.includes(r.id) ? <Check /> : <Plus />} {picks.includes(r.id) ? "Picked" : "Pick"}
                <kbd className="ml-auto text-[10px] opacity-60">P</kbd>
              </Button>
              <Button onClick={() => onDownload(r.id)}>
                <Download /> Download now <kbd className="ml-auto text-[10px] opacity-60">D</kbd>
              </Button>
            </div>
          )}
          {state && state.kind !== "failed" && (
            <p className="mt-auto text-xs text-white/60 capitalize">{state.kind}</p>
          )}
        </aside>
      </div>

      <div ref={strip} className="flex h-20 shrink-0 gap-1.5 overflow-x-auto border-t border-white/10 p-2">
        {results.map((x, i) => {
          const m = effectiveMark(x, states[x.id]);
          return (
            <button
              key={x.id}
              data-i={i}
              type="button"
              onClick={() => onIndex(i)}
              className={cn(
                "relative h-full shrink-0 overflow-hidden rounded",
                i === index && "ring-2 ring-white",
              )}
            >
              <img src={x.thumbs.original} alt="" className={cn("h-full object-cover", m !== "none" && "opacity-40")} />
              {picks.includes(x.id) && (
                <Check className="absolute top-0.5 right-0.5 size-3.5 rounded-full bg-primary p-0.5 text-primary-foreground" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
