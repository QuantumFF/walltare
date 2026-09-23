// PROTOTYPE — Variant B, "Filter rail + detail pane". Wallhaven's own search
// form as a left rail with every filter visible at once (colours included),
// numbered pages of 24 in the middle with a checkbox always on each card, and
// a right pane showing the result under the cursor: a large preview plus the
// metadata you would decide a download on. Downloads list in the rail.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize2,
  Search,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import {
  canDownload,
  CATEGORIES,
  COLORS,
  COMMON_RATIOS,
  compact,
  effectiveMark,
  LAST_PAGE,
  MarkPill,
  megabytes,
  PURITIES,
  readableRatio,
  SORTINGS,
  TOP_RANGES,
  TOTAL,
  type DownloadState,
  type Result,
} from "./shared";
import type { DiscoverProps } from "./DiscoverPrototype";

export function VariantB({
  filters,
  set,
  toggle,
  screenRatio,
  search,
  downloads,
  picks,
  log,
}: DiscoverProps) {
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState(filters.q);
  const { results } = search;
  const current = results[cursor];

  const downloadNow = (ids: string[]) => {
    downloads.download(
      ids.filter((id) => {
        const r = results.find((x) => x.id === id);
        return r && canDownload(r, downloads.states[id]);
      }),
    );
    picks.drop(ids);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cols = Math.max(
      1,
      Math.round(
        e.currentTarget.clientWidth /
          ((e.currentTarget.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1),
      ),
    );
    if (e.key === "ArrowRight") setCursor((c) => Math.min(results.length - 1, c + 1));
    else if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, c - 1));
    else if (e.key === "ArrowDown") setCursor((c) => Math.min(results.length - 1, c + cols));
    else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - cols));
    else if (e.key === " " && current && canDownload(current, downloads.states[current.id]))
      picks.toggle(current.id);
    else if ((e.key === "d" || e.key === "D") && current)
      downloadNow(picks.picks.length ? picks.picks : [current.id]);
    else if (e.key === "PageDown") search.goTo(search.page + 1);
    else if (e.key === "PageUp") search.goTo(search.page - 1);
    else return;
    e.preventDefault();
  };

  const pickedBytes = picks.picks.reduce(
    (sum, id) => sum + (results.find((r) => r.id === id)?.file_size ?? 0),
    0,
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* ------------------------------------------------ the rail */}
      <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border/60 p-4 text-sm">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", draft);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tags, @user, id:…, like:…"
            className="h-8 pl-7 text-[0.8rem]"
          />
        </form>

        <RailGroup title="Sort">
          <div className="grid grid-cols-2 gap-1">
            {SORTINGS.map((s) => (
              <RailChip
                key={s.value}
                on={filters.sorting === s.value}
                onClick={() => set("sorting", s.value)}
              >
                {s.label}
              </RailChip>
            ))}
          </div>
          {filters.sorting === "toplist" && (
            <div className="mt-2 flex flex-wrap gap-1">
              {TOP_RANGES.map((r) => (
                <RailChip key={r} on={filters.topRange === r} onClick={() => set("topRange", r)}>
                  {r}
                </RailChip>
              ))}
            </div>
          )}
        </RailGroup>

        <RailGroup title="Ratio">
          <div className="flex flex-wrap gap-1">
            <RailChip on={filters.ratio === screenRatio} onClick={() => set("ratio", screenRatio)}>
              {readableRatio(screenRatio)} · Screen
            </RailChip>
            {COMMON_RATIOS.filter((r) => r !== screenRatio).map((r) => (
              <RailChip key={r} on={filters.ratio === r} onClick={() => set("ratio", r)}>
                {readableRatio(r)}
              </RailChip>
            ))}
            <RailChip on={filters.ratio === null} onClick={() => set("ratio", null)}>
              Any
            </RailChip>
          </div>
        </RailGroup>

        <RailGroup title="Categories">
          {CATEGORIES.map((c) => (
            <RailCheck
              key={c.value}
              on={filters.categories.includes(c.value)}
              onClick={() => toggle("categories", c.value)}
            >
              {c.label}
            </RailCheck>
          ))}
        </RailGroup>

        <RailGroup title="Purity">
          {PURITIES.map((p) => (
            <RailCheck
              key={p.value}
              on={filters.purity.includes(p.value)}
              disabled={p.value === "nsfw"}
              onClick={() => toggle("purity", p.value)}
            >
              {p.label}
              {p.value === "nsfw" && (
                <span className="ml-auto text-[10px] text-muted-foreground underline">
                  needs API key
                </span>
              )}
            </RailCheck>
          ))}
        </RailGroup>

        <RailGroup title="Colour">
          <div className="grid grid-cols-8 gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={`#${c}`}
                onClick={() => set("color", filters.color === c ? null : c)}
                className={cn(
                  "aspect-square rounded-sm border border-border/60",
                  filters.color === c && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
                style={{ background: `#${c}` }}
              />
            ))}
          </div>
        </RailGroup>

        <RailGroup title="Downloads">
          {log.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing downloaded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {log.map(({ r, state }) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <img src={r.thumbs.original} alt="" className="h-6 w-10 rounded-sm object-cover" />
                  <span className="min-w-0 flex-1 truncate">{r.id}</span>
                  <DownloadWord state={state} />
                </li>
              ))}
            </ul>
          )}
        </RailGroup>
      </aside>

      {/* ------------------------------------------------ results */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4 text-xs text-muted-foreground">
          <span>
            {TOTAL} results · page {search.page} of {LAST_PAGE}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" disabled={search.page === 1} onClick={() => search.goTo(search.page - 1)}>
              <ChevronLeft />
            </Button>
            {pageNumbers(search.page).map((n, i) =>
              n === null ? (
                <span key={`gap${i}`} className="px-1">…</span>
              ) : (
                <Button
                  key={n}
                  size="sm"
                  variant={n === search.page ? "secondary" : "ghost"}
                  onClick={() => search.goTo(n)}
                  className="min-w-7 px-1.5 tabular-nums"
                >
                  {n}
                </Button>
              ),
            )}
            <Button size="icon-sm" variant="ghost" disabled={search.page === LAST_PAGE} onClick={() => search.goTo(search.page + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {search.loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          <div
            role="grid"
            tabIndex={0}
            aria-label="Wallhaven results"
            onKeyDown={onKeyDown}
            className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 p-4 outline-none"
          >
            {results.map((r, i) => (
              <CardB
                key={r.id}
                r={r}
                selected={i === cursor}
                picked={picks.picks.includes(r.id)}
                state={downloads.states[r.id]}
                onSelect={() => setCursor(i)}
                onPick={() => picks.toggle(r.id)}
              />
            ))}
          </div>
        </div>

        {picks.picks.length > 0 && (
          <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border/60 bg-secondary/40 px-4 text-sm">
            <span>
              <b>{picks.picks.length}</b> picked · {megabytes(pickedBytes)}
            </span>
            <Button size="sm" variant="ghost" onClick={picks.clear}>
              Clear
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => downloadNow(picks.picks)}>
              <Download /> Download {picks.picks.length}
            </Button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ detail pane */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/60 p-4 text-sm">
        {current ? (
          <Detail
            key={current.id}
            r={current}
            state={downloads.states[current.id]}
            picked={picks.picks.includes(current.id)}
            onPick={() => picks.toggle(current.id)}
            onDownload={() => downloadNow([current.id])}
            onColor={(c) => set("color", c)}
          />
        ) : (
          <p className="text-muted-foreground">Nothing selected.</p>
        )}
      </aside>
    </div>
  );
}

function pageNumbers(page: number): (number | null)[] {
  const set = new Set([1, 2, page - 1, page, page + 1, LAST_PAGE]);
  const list = [...set].filter((n) => n >= 1 && n <= LAST_PAGE).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  list.forEach((n, i) => {
    if (i > 0 && n - list[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

function RailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function RailChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-left text-xs",
        on
          ? "border-transparent bg-secondary font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function RailCheck({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 text-xs disabled:opacity-50"
    >
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-sm border border-border",
          on && "border-transparent bg-primary text-primary-foreground",
        )}
      >
        {on && <Check className="size-3" />}
      </span>
      {children}
    </button>
  );
}

function CardB({
  r,
  selected,
  picked,
  state,
  onSelect,
  onPick,
}: {
  r: Result;
  selected: boolean;
  picked: boolean;
  state: DownloadState | undefined;
  onSelect: () => void;
  onPick: () => void;
}) {
  const mark = effectiveMark(r, state);
  const pickable = canDownload(r, state);
  return (
    <div
      role="gridcell"
      onClick={onSelect}
      className={cn(
        "relative aspect-video cursor-pointer overflow-hidden rounded-md border border-border bg-card",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <img
        src={r.thumbs.large}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("h-full w-full object-cover", mark !== "none" && "opacity-40 grayscale")}
      />
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        disabled={!pickable}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        className={cn(
          "absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border border-white/80 bg-black/40 text-white disabled:hidden",
          picked && "border-transparent bg-primary text-primary-foreground",
        )}
      >
        {picked && <Check className="size-3.5" />}
      </button>
      <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
        <MarkPill mark={mark} />
        {state && state.kind !== "landed" && (
          <div className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            <DownloadWord state={state} />
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadWord({ state }: { state: DownloadState }) {
  switch (state.kind) {
    case "queued":
      return <span className="text-muted-foreground">Queued</span>;
    case "downloading":
      return (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Downloading
        </span>
      );
    case "landed":
      return <span className="text-emerald-600 dark:text-emerald-400">Added</span>;
    case "failed":
      return (
        <span className="text-destructive" title={state.message}>
          Failed
        </span>
      );
  }
}

function Detail({
  r,
  state,
  picked,
  onPick,
  onDownload,
  onColor,
}: {
  r: Result;
  state: DownloadState | undefined;
  picked: boolean;
  onPick: () => void;
  onDownload: () => void;
  onColor: (c: string) => void;
}) {
  const [full, setFull] = useState<"off" | "loading" | "on">("off");
  const mark = effectiveMark(r, state);
  const pickable = canDownload(r, state);

  return (
    <>
      <div className="relative overflow-hidden rounded-md border border-border bg-card">
        <img src={r.thumbs.large} alt="" className="aspect-video w-full object-cover" />
        {full !== "off" && (
          <img
            src={r.full}
            alt=""
            onLoad={() => setFull("on")}
            className={cn("absolute inset-0 h-full w-full object-cover", full === "loading" && "opacity-0")}
          />
        )}
        <Button
          size="icon-xs"
          variant="secondary"
          className="absolute right-1.5 bottom-1.5"
          title={`Load full size (${megabytes(r.file_size)})`}
          onClick={() => setFull("loading")}
          disabled={full !== "off"}
        >
          {full === "loading" ? <Loader2 className="animate-spin" /> : <Maximize2 />}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <p className="font-medium">wallhaven-{r.id}</p>
        <MarkPill mark={mark} className="ml-auto" />
      </div>

      {mark === "in_library" && (
        <p className="text-xs text-muted-foreground">
          Already in your library. It won't be downloaded again.
        </p>
      )}
      {mark === "rejected" && (
        <p className="text-xs text-muted-foreground">
          You rejected this. Restore it from Library to change your mind.
        </p>
      )}
      {state?.kind === "failed" && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <X className="size-3" /> {state.message}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Resolution</dt>
        <dd className="tabular-nums">{r.resolution}</dd>
        <dt className="text-muted-foreground">Ratio</dt>
        <dd>{r.ratio}</dd>
        <dt className="text-muted-foreground">Size</dt>
        <dd>
          {megabytes(r.file_size)} · {r.file_type.replace("image/", "")}
        </dd>
        <dt className="text-muted-foreground">Category</dt>
        <dd className="capitalize">{r.category}</dd>
        <dt className="text-muted-foreground">Purity</dt>
        <dd className="uppercase">{r.purity}</dd>
        <dt className="text-muted-foreground">Views</dt>
        <dd>{compact(r.views)}</dd>
        <dt className="text-muted-foreground">Favourites</dt>
        <dd>{compact(r.favorites)}</dd>
        <dt className="text-muted-foreground">Uploaded</dt>
        <dd>{r.created_at.slice(0, 10)}</dd>
      </dl>

      <div className="flex gap-1">
        {r.colors.map((c) => (
          <button
            key={c}
            type="button"
            title={`Search ${c}`}
            onClick={() => onColor(c.slice(1))}
            className="h-5 flex-1 rounded-sm border border-border/60"
            style={{ background: c }}
          />
        ))}
      </div>

      {pickable && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onPick}>
            {picked ? <Check /> : null} {picked ? "Picked" : "Pick"}
          </Button>
          <Button size="sm" className="flex-1" onClick={onDownload}>
            <Download /> Download
          </Button>
        </div>
      )}
      {state && state.kind !== "failed" && (
        <p className="text-xs">
          <DownloadWord state={state} />
        </p>
      )}
    </>
  );
}
