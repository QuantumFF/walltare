// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// Variant A — "Toolbar". A compact chrome bar that never changes, plus a
// second context bar each page owns. Everything a page needs (filters, sort,
// the Round headline, pre-generation) lives in that second bar, so the chrome
// row stays a fixed height no matter which page is up. Settings is a page
// behind a gear at the far right.
//
// The library grid is the existing Review card at higher density: hover
// overlay, badge in the corner, actions inside the overlay. The lightbox puts
// everything in one caption bar pinned to the bottom.

import {
  cardSrc,
  isEvaluated,
  largeSrc,
  LIBRARY,
  REVIEW_LIST,
  RANK_PAIR,
  ROUND_EXPLAINER,
  ROUND_PERCENT,
  scoreLabel,
  STATS,
  statusLabel,
  type ProtoWallpaper,
  type Status,
} from "../fixtures";
import {
  useLightboxKeys,
  useToast,
  type DataState,
  type Header,
  type Page,
} from "../harness";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  Images,
  Loader2,
  RotateCcw,
  Settings as SettingsIcon,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

const TABS: Array<{ key: Page; label: string }> = [
  { key: "rank", label: "Rank" },
  { key: "review", label: "Review" },
  { key: "library", label: "Library" },
];

const FILTERS: Array<{ key: Status | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "kept", label: "Kept" },
  { key: "rejected", label: "Rejected" },
];

const PREGEN = { done: 412, total: 1204 };

function ScoreBadge({ w, size = "sm" }: { w: ProtoWallpaper; size?: "sm" | "lg" }) {
  const solid = isEvaluated(w);
  return (
    <span
      title={
        solid
          ? `Score ${w.rating_mu.toFixed(1)} · Evaluated`
          : `Score ${scoreLabel(w)} · not yet Evaluated`
      }
      className={[
        "rounded-md font-medium tabular-nums backdrop-blur-md",
        size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-[11px]",
        solid
          ? "bg-white text-neutral-900"
          : "border border-white/30 bg-black/50 text-white/70",
      ].join(" ")}
    >
      {scoreLabel(w)}
    </span>
  );
}

/**
 * The housings. Five containers for the same three tabs in the same place, so
 * the only thing being judged is how much the group asserts itself against the
 * brand on its left and the gear on its right.
 *
 * The tab row stays 48px tall in all five: changing the chrome's height per
 * housing would confound the comparison with a size difference.
 */
function HeaderTabs({
  page,
  onPage,
  header,
}: {
  page: Page;
  onPage: (page: Page) => void;
  header: Header;
}) {
  const active = TABS.findIndex((tab) => tab.key === page);

  if (header === "underline") {
    // Nothing houses them. The chrome's own bottom edge is the indicator, which
    // ties the tabs to the bar and reads as a document, not a control.
    return (
      <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onPage(tab.key)}
            className={[
              "relative h-12 px-4 text-sm transition-colors",
              page === tab.key
                ? "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    );
  }

  if (header === "segmented") {
    // Sunk into the bar. The active tab is a raised chip, the group reads as
    // one control rather than three links.
    return (
      <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-secondary p-0.5 shadow-inner ring-1 ring-border/70">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onPage(tab.key)}
            className={[
              "rounded-md px-4 py-1.5 text-sm transition-colors",
              page === tab.key
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    );
  }

  if (header === "island") {
    // Lifted off the bar entirely: its own surface, its own border, its own
    // shadow. Most assertive of the five, and the only one where the active
    // tab inverts.
    return (
      <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-md">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onPage(tab.key)}
            className={[
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              page === tab.key
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    );
  }

  if (header === "boxed") {
    // No shared container at all. Three separate outlined boxes, which is the
    // loudest option per-tab and the quietest as a group.
    return (
      <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onPage(tab.key)}
            className={[
              "rounded-md border px-4 py-1.5 text-sm transition-colors",
              page === tab.key
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    );
  }

  // sliding: one pill with a single indicator that moves between fixed-width
  // tabs. The only housing where switching pages is animated, which is either
  // the point or the objection.
  return (
    <nav className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-full bg-secondary p-1">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 w-[6rem] rounded-full bg-background shadow-sm transition-transform duration-200 ease-out"
        style={{ transform: `translateX(${Math.max(active, 0) * 6}rem)` }}
      />
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onPage(tab.key)}
          className={[
            "relative w-[6rem] py-1.5 text-center text-sm transition-colors",
            page === tab.key
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function Chrome({
  page,
  onPage,
  context,
  header,
}: {
  page: Page;
  onPage: (page: Page) => void;
  context: React.ReactNode;
  header: Header;
}) {
  const pregenPercent = Math.round((PREGEN.done / PREGEN.total) * 100);

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/95 backdrop-blur">
      <div className="relative flex h-12 items-center px-4">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Images className="h-4 w-4" />
          walltare
        </div>

        <HeaderTabs page={page} onPage={onPage} header={header} />

        <button
          onClick={() => onPage("settings")}
          aria-label="Settings"
          className={[
            "ml-auto rounded-md p-2 transition-colors hover:bg-accent",
            page === "settings" ? "bg-accent text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Pre-generation: a 2px seam across the whole chrome, plus a word in the
          context bar. It is background work and never blocks a page. */}
      <div className="h-[2px] w-full bg-transparent">
        <div
          className="h-full bg-foreground/40 transition-[width] duration-300"
          style={{ width: `${pregenPercent}%` }}
        />
      </div>

      <div className="flex h-11 items-center gap-3 border-t border-border/60 px-4 text-sm">
        {context}
      </div>
    </header>
  );
}

function LibraryContext({
  filter,
  onFilter,
  sort,
  onSort,
  count,
}: {
  filter: Status | "all";
  onFilter: (next: Status | "all") => void;
  sort: string;
  onSort: (next: string) => void;
  count: number;
}) {
  return (
    <>
      <div className="flex items-center rounded-md border border-border p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilter(f.key)}
            className={[
              "rounded px-2.5 py-1 text-xs transition-colors",
              filter === f.key
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Sort
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
        >
          <option value="score-desc">Score, best first</option>
          <option value="score-asc">Score, worst first</option>
          <option value="filename">Filename</option>
          <option value="scanned">Recently scanned</option>
        </select>
      </label>

      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {count} shown · thumbnails {PREGEN.done}/{PREGEN.total}
      </span>
    </>
  );
}

function Card({
  w,
  onOpen,
  onAction,
}: {
  w: ProtoWallpaper;
  onOpen: () => void;
  onAction: (verb: string) => void;
}) {
  const rejected = w.status === "rejected";
  return (
    <div
      className={[
        "group relative aspect-video overflow-hidden rounded-lg border border-border bg-card",
        rejected ? "opacity-60 grayscale" : "",
      ].join(" ")}
    >
      <img
        src={cardSrc(w.id)}
        alt={w.filename}
        loading="lazy"
        onClick={onOpen}
        className="h-full w-full cursor-zoom-in object-cover"
      />

      <div className="pointer-events-none absolute top-1.5 right-1.5">
        <ScoreBadge w={w} />
      </div>

      {w.status !== "active" && (
        <div className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-md">
          {statusLabel(w.status)}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-white">{w.filename}</p>
          <p className="truncate text-[10px] text-white/60">
            {w.comparisons_count} comparisons
            {rejected ? ` · now in ${w.path.split("/").slice(-2, -1)[0]}/` : ""}
          </p>
        </div>
        <div className="flex gap-1.5">
          {rejected ? (
            <button
              disabled={!w.origin_path}
              title={
                w.origin_path
                  ? `Restore to ${w.origin_path}`
                  : "Rejected before restore existed, so there is no origin to go back to"
              }
              onClick={() => onAction("Restored")}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25 disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" />
              Restore
            </button>
          ) : (
            <>
              <button
                onClick={() => onAction(w.status === "kept" ? "Returned to voting" : "Kept")}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25"
              >
                {w.status === "kept" ? (
                  <>
                    <Undo2 className="h-3 w-3" />
                    Un-keep
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" />
                    Keep
                  </>
                )}
              </button>
              <button
                onClick={() => onAction("Rejected")}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-destructive/90 px-2 py-1 text-[11px] text-white hover:bg-destructive"
              >
                <FolderInput className="h-3 w-3" />
                Reject
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Lightbox({
  list,
  index,
  onIndex,
  onClose,
  onAction,
}: {
  list: ProtoWallpaper[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  onAction: (verb: string) => void;
}) {
  const w = list[index];
  const prev = useCallback(
    () => onIndex((index - 1 + list.length) % list.length),
    [index, list.length, onIndex],
  );
  const next = useCallback(() => onIndex((index + 1) % list.length), [index, list.length, onIndex]);
  useLightboxKeys(true, { onPrev: prev, onNext: next, onClose });

  // Opaque, not 97%: at 97% the chrome's tabs ghosted through the top of the
  // preview, which is both a distraction and a lie about what is clickable.
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
        <img
          key={w.id}
          src={largeSrc(w.id)}
          alt={w.filename}
          className="max-h-full max-w-full object-contain"
        />

        <button
          onClick={prev}
          aria-label="Previous"
          className="absolute left-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={next}
          aria-label="Next"
          className="absolute right-2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* One caption bar carries everything: identity on the left, actions on
          the right, keys underneath. */}
      <div className="shrink-0 border-t border-white/10 bg-black/60 px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ScoreBadge w={w} size="lg" />
              <span className="truncate text-sm font-medium text-white">{w.filename}</span>
              <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/70">
                {statusLabel(w.status)}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-white/50">{w.path}</p>
          </div>

          <div className="shrink-0 text-right text-[11px] text-white/50 tabular-nums">
            <div>
              Score {scoreLabel(w)} · {w.comparisons_count} comparisons
            </div>
            <div>
              {index + 1} / {list.length} · ← → navigate · Esc close
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {w.status === "rejected" ? (
              <button
                disabled={!w.origin_path}
                onClick={() => onAction("Restored")}
                className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-2 text-xs text-white hover:bg-white/25 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </button>
            ) : (
              <>
                <button
                  onClick={() => onAction("Kept")}
                  className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-2 text-xs text-white hover:bg-white/25"
                >
                  <Check className="h-3.5 w-3.5" />
                  Keep
                </button>
                <button
                  onClick={() => onAction("Rejected")}
                  className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-xs text-white"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GridBody({
  list,
  data,
  onOpen,
  onAction,
  emptyNote,
}: {
  list: ProtoWallpaper[];
  data: DataState;
  onOpen: (index: number) => void;
  onAction: (verb: string) => void;
  emptyNote: string;
}) {
  if (data === "loading") {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            className="aspect-video animate-pulse rounded-lg border border-border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (data === "empty" || list.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <Images className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">{emptyNote}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {list.map((w, i) => (
        <Card key={w.id} w={w} onOpen={() => onOpen(i)} onAction={onAction} />
      ))}
    </div>
  );
}

function RankPage({ data }: { data: DataState }) {
  if (data === "empty") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing left to rank. Every wallpaper is rejected.
        </p>
        <button className="text-sm underline">Open Settings to pick a library folder</button>
      </div>
    );
  }

  return (
    // The neutral dark surround, fixed in both themes: judging two wallpapers
    // against white is a different judgement than against black.
    <div className="flex flex-1 flex-col bg-neutral-900 p-4">
      <div className="grid flex-1 grid-cols-2 items-center gap-4">
        {RANK_PAIR.map((w, i) => (
          <div
            key={w.id}
            className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl ring-0 ring-white transition-all hover:ring-2"
          >
            {data === "loading" ? (
              <div className="flex h-full items-center justify-center bg-neutral-800">
                <Loader2 className="h-6 w-6 animate-spin text-white/40" />
              </div>
            ) : (
              <img src={largeSrc(w.id)} alt="" className="h-full w-full object-cover" />
            )}
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              {i === 0 ? "← Left arrow" : "Right arrow →"}
            </span>
          </div>
        ))}
      </div>
      <div className="pt-3 text-center text-xs text-white/40">
        Skip pair · Space
      </div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 p-8">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Library folder</h2>
        <div className="flex gap-2">
          <input
            defaultValue="~/Wallpapers"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
            Browse
          </button>
        </div>
        <p className="font-mono text-xs text-muted-foreground">/home/qdes/Wallpapers</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Reject destination</h2>
        <div className="flex gap-2">
          <input
            defaultValue="./rejected"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
            Browse
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Relative to each wallpaper&apos;s own folder.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Appearance</h2>
        <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
          {["System", "Light", "Dark"].map((t, i) => (
            <button
              key={t}
              className={`rounded px-3 py-1.5 ${i === 0 ? "bg-secondary font-medium" : "text-muted-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Thumbnails</h2>
        <p className="text-xs text-muted-foreground">830 MB cached · 240 of 1204 pending</p>
        <div className="flex gap-2">
          <button className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Generate now
          </button>
          <button className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
            Clear cache
          </button>
        </div>
      </section>

      <p className="text-xs text-muted-foreground/70">
        Placeholder. The panel&apos;s own shape is still fog on the map; this exists so the
        gear has somewhere to land.
      </p>
    </div>
  );
}

export function ToolbarShell({
  page,
  onPage,
  data,
  open,
  onOpenChange: setOpen,
  header,
}: {
  page: Page;
  onPage: (page: Page) => void;
  data: DataState;
  open: number | null;
  onOpenChange: (index: number | null) => void;
  header: Header;
}) {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [sort, setSort] = useState("score-desc");
  const { toast, show, dismiss } = useToast();

  const list = useMemo(() => {
    if (page === "review") return REVIEW_LIST;
    const filtered = LIBRARY.filter((w) => filter === "all" || w.status === filter);
    const sorted = filtered.slice();
    if (sort === "score-desc") sorted.sort((a, b) => b.rating_mu - a.rating_mu);
    else if (sort === "score-asc") sorted.sort((a, b) => a.rating_mu - b.rating_mu);
    else if (sort === "filename") sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    else sorted.sort((a, b) => b.created_at - a.created_at);
    return sorted;
  }, [page, filter, sort]);

  const act = (verb: string) => show(`${verb}.`, verb === "Rejected" ? () => dismiss() : undefined);

  const context =
    page === "library" ? (
      <LibraryContext
        filter={filter}
        onFilter={setFilter}
        sort={sort}
        onSort={setSort}
        count={list.length}
      />
    ) : page === "review" ? (
      <>
        <span className="text-sm font-medium">Lowest scores first</span>
        <span className="text-xs text-muted-foreground">
          {REVIEW_LIST.length} of {STATS.eligible_count} eligible
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Rejects go to <span className="font-mono">./rejected</span> · change in Settings
        </span>
      </>
    ) : page === "rank" ? (
      <>
        <span
          title={ROUND_EXPLAINER}
          className="cursor-help text-sm font-medium underline decoration-dotted underline-offset-4"
        >
          Round {STATS.round} · {ROUND_PERCENT}%
        </span>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-foreground" style={{ width: `${ROUND_PERCENT}%` }} />
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {STATS.evaluated_count} / {STATS.eligible_count} Evaluated ·{" "}
          {STATS.total_comparisons} comparisons
        </span>
      </>
    ) : (
      <span className="text-sm font-medium">Settings</span>
    );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Chrome page={page} onPage={onPage} context={context} header={header} />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {page === "rank" && <RankPage data={data} />}
        {page === "settings" && <SettingsPage />}
        {(page === "library" || page === "review") && (
          <GridBody
            list={list}
            data={data}
            onOpen={setOpen}
            onAction={act}
            emptyNote={
              page === "review"
                ? "Nothing to review. Every eligible wallpaper is above the cut."
                : "No wallpapers match this filter."
            }
          />
        )}
      </main>

      {open !== null && list[open] && (
        <Lightbox
          list={list}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onAction={act}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-lg">
          <span>{toast.message}</span>
          {toast.undo && (
            <button onClick={toast.undo} className="font-medium underline">
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
