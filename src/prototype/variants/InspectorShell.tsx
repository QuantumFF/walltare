// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// Variant B — "Inspector". The bet: a wallpaper's actions do not belong on the
// wallpaper. The grid becomes bare tiles you select, and every control lives in
// a right-hand inspector that shows one wallpaper at a time. That kills the
// `group-hover` overlay outright, which is what the map's fog patch on keyboard
// reachability is about: arrow keys move the selection, Enter opens the
// lightbox, and every action is a real focusable button in the panel.
//
// The chrome is one thin row. Round and Evaluated ride in it as chips, so the
// header is the same height on every page and Rank gains no second bar.
// Settings is a right-hand sheet over the current page, not a destination.

import {
  cardSrc,
  isEvaluated,
  largeSrc,
  LIBRARY,
  RANK_PAIR,
  REVIEW_LIST,
  ROUND_EXPLAINER,
  ROUND_PERCENT,
  scoreLabel,
  STATS,
  statusLabel,
  type ProtoWallpaper,
  type Status,
} from "../fixtures";
import { useLightboxKeys, useToast, type DataState, type Page } from "../harness";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  ImageOff,
  Loader2,
  RotateCcw,
  Settings as SettingsIcon,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const COLUMNS = 4;

function ScoreBadge({ w, size = "sm" }: { w: ProtoWallpaper; size?: "sm" | "lg" }) {
  const solid = isEvaluated(w);
  return (
    <span
      className={[
        "rounded font-medium tabular-nums",
        size === "lg" ? "px-2 py-0.5 text-base" : "px-1.5 py-0.5 text-[11px] backdrop-blur-md",
        solid
          ? "bg-foreground text-background"
          : "border border-current/25 bg-background/70 text-muted-foreground",
      ].join(" ")}
    >
      {scoreLabel(w)}
    </span>
  );
}

function Chrome({
  page,
  onPage,
  onSettings,
}: {
  page: Page;
  onPage: (page: Page) => void;
  onSettings: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onPage(tab.key)}
          className={[
            "rounded-full px-4 py-1.5 text-sm transition-colors",
            page === tab.key
              ? "bg-secondary font-medium text-secondary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}

      <div className="ml-auto flex items-center gap-2">
        {/* The status cluster. Same chips on every page, so Rank does not need a
            headline of its own and the numbers stay visible while browsing. */}
        <span
          title={ROUND_EXPLAINER}
          className="flex cursor-help items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1"
        >
          <span className="relative grid h-6 w-6 place-items-center">
            <svg viewBox="0 0 32 32" className="h-6 w-6 -rotate-90">
              <circle cx="16" cy="16" r="13" fill="none" strokeWidth="5" className="stroke-secondary" />
              <circle
                cx="16"
                cy="16"
                r="13"
                fill="none"
                strokeWidth="5"
                strokeLinecap="round"
                className="stroke-foreground"
                strokeDasharray={`${(ROUND_PERCENT / 100) * 81.6} 81.6`}
              />
            </svg>
          </span>
          <span className="text-xs font-medium tabular-nums">Round {STATS.round}</span>
        </span>

        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground tabular-nums">
          {STATS.evaluated_count} / {STATS.eligible_count} Evaluated
        </span>

        {PREGEN.done < PREGEN.total && (
          <span
            title={`Generating thumbnails: ${PREGEN.done} of ${PREGEN.total}`}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground tabular-nums"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {Math.round((PREGEN.done / PREGEN.total) * 100)}%
          </span>
        )}

        <button
          onClick={onSettings}
          aria-label="Settings"
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function Tile({
  w,
  selected,
  onSelect,
  onOpen,
  innerRef,
}: {
  w: ProtoWallpaper;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  innerRef?: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={innerRef}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={[
        "group relative aspect-video overflow-hidden rounded-md bg-card text-left outline-none",
        selected
          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
          : "ring-1 ring-border hover:ring-foreground/40",
        w.status === "rejected" ? "opacity-55 grayscale" : "",
      ].join(" ")}
    >
      <img
        src={cardSrc(w.id)}
        alt={w.filename}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      <span className="absolute top-1.5 right-1.5">
        <ScoreBadge w={w} />
      </span>
      {w.status !== "active" && (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">
          {statusLabel(w.status)}
        </span>
      )}
    </button>
  );
}

function ActionStack({
  w,
  onAction,
  compact,
}: {
  w: ProtoWallpaper;
  onAction: (verb: string) => void;
  compact?: boolean;
}) {
  const base = `flex w-full items-center justify-center gap-2 rounded-md ${
    compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"
  }`;

  if (w.status === "rejected") {
    return (
      <div className="space-y-2">
        <button
          disabled={!w.origin_path}
          onClick={() => onAction("Restored")}
          className={`${base} bg-foreground text-background disabled:opacity-40`}
        >
          <RotateCcw className="h-4 w-4" />
          Restore
        </button>
        {!w.origin_path && (
          <p className="text-xs text-muted-foreground">
            Rejected before restore existed, so nothing recorded where it came from.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {w.status === "kept" ? (
        <button
          onClick={() => onAction("Returned to voting")}
          className={`${base} border border-border hover:bg-accent`}
        >
          <Undo2 className="h-4 w-4" />
          Return to voting
        </button>
      ) : (
        <button
          onClick={() => onAction("Kept")}
          className={`${base} bg-foreground text-background`}
        >
          <Check className="h-4 w-4" />
          Keep
        </button>
      )}
      <button
        onClick={() => onAction("Rejected")}
        className={`${base} border border-destructive/40 text-destructive hover:bg-destructive/10`}
      >
        <FolderInput className="h-4 w-4" />
        Reject
      </button>
    </div>
  );
}

function Inspector({
  w,
  onOpen,
  onAction,
}: {
  w: ProtoWallpaper | null;
  onOpen: () => void;
  onAction: (verb: string) => void;
}) {
  if (!w) {
    return (
      <aside className="hidden w-80 shrink-0 border-l border-border p-6 text-sm text-muted-foreground lg:block">
        Pick a wallpaper to see it here.
      </aside>
    );
  }

  return (
    <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border lg:block">
      <button onClick={onOpen} className="block w-full cursor-zoom-in">
        <img
          src={cardSrc(w.id)}
          alt={w.filename}
          className="aspect-video w-full object-cover"
        />
      </button>

      <div className="space-y-5 p-4">
        <div>
          <p className="text-sm leading-snug font-medium break-all">{w.filename}</p>
          <p className="mt-1 text-xs text-muted-foreground">{statusLabel(w.status)}</p>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Score</dt>
            <dd className="flex items-center gap-2">
              <ScoreBadge w={w} size="lg" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Comparisons</dt>
            <dd className="tabular-nums">{w.comparisons_count}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>{isEvaluated(w) ? "Evaluated" : "Not yet"}</dd>
          </div>
        </dl>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Path</p>
          <p className="font-mono text-[11px] break-all">{w.path}</p>
          {w.origin_path && (
            <>
              <p className="pt-2 text-xs text-muted-foreground">Came from</p>
              <p className="font-mono text-[11px] break-all">{w.origin_path}</p>
            </>
          )}
        </div>

        <ActionStack w={w} onAction={onAction} />
      </div>
    </aside>
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
  const next = useCallback(
    () => onIndex((index + 1) % list.length),
    [index, list.length, onIndex],
  );
  useLightboxKeys(true, { onPrev: prev, onNext: next, onClose });

  // The rail is the inspector again, at full height. Same information in the
  // same order, so moving between grid and lightbox costs no re-reading.
  return (
    <div className="fixed inset-0 z-50 flex bg-neutral-950">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
        <img
          key={w.id}
          src={largeSrc(w.id)}
          alt={w.filename}
          className="max-h-full max-w-full object-contain"
        />
        <button
          onClick={prev}
          aria-label="Previous"
          className="absolute left-3 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={next}
          aria-label="Next"
          className="absolute right-3 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1} of {list.length}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <div>
            <p className="text-sm leading-snug font-medium break-all">{w.filename}</p>
            <p className="mt-1 text-xs text-muted-foreground">{statusLabel(w.status)}</p>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Score</dt>
              <dd>
                <ScoreBadge w={w} size="lg" />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Comparisons</dt>
              <dd className="tabular-nums">{w.comparisons_count}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Confidence</dt>
              <dd>{isEvaluated(w) ? "Evaluated" : "Not yet"}</dd>
            </div>
          </dl>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Path</p>
            <p className="font-mono text-[11px] break-all">{w.path}</p>
            {w.origin_path && (
              <>
                <p className="pt-2 text-xs text-muted-foreground">Came from</p>
                <p className="font-mono text-[11px] break-all">{w.origin_path}</p>
              </>
            )}
          </div>

          <ActionStack w={w} onAction={onAction} />

          <p className="border-t border-border pt-4 text-[11px] text-muted-foreground">
            ← → next · Esc close
          </p>
        </div>
      </aside>
    </div>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-[420px] flex-col overflow-y-auto border-l border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-medium">Settings</h2>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-6 p-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">Library folder</label>
            <div className="flex gap-2">
              <input
                defaultValue="~/Wallpapers"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button className="rounded-md border border-border px-3 text-sm hover:bg-accent">
                Browse
              </button>
            </div>
            <p className="font-mono text-xs text-muted-foreground">/home/qdes/Wallpapers</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reject destination</label>
            <div className="flex gap-2">
              <input
                defaultValue="./rejected"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button className="rounded-md border border-border px-3 text-sm hover:bg-accent">
                Browse
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Appearance</label>
            <div className="flex rounded-md border border-border p-0.5 text-xs">
              {["System", "Light", "Dark"].map((t, i) => (
                <button
                  key={t}
                  className={`flex-1 rounded px-3 py-1.5 ${i === 0 ? "bg-secondary font-medium" : "text-muted-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Thumbnails</p>
            <p className="text-xs text-muted-foreground">830 MB cached · 792 pending</p>
            <div className="flex gap-2">
              <button className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                Generate now
              </button>
              <button className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
                Clear cache
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/70">
            Placeholder contents. The sheet-versus-page question is what this is here to
            answer.
          </p>
        </div>
      </div>
    </div>
  );
}

export function InspectorShell({
  page,
  onPage,
  data,
  open,
  onOpenChange: setOpen,
}: {
  page: Page;
  onPage: (page: Page) => void;
  data: DataState;
  open: number | null;
  onOpenChange: (index: number | null) => void;
}) {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [sort, setSort] = useState("score-desc");
  const [selected, setSelected] = useState(open ?? 0);
  const [settings, setSettings] = useState(page === "settings");
  const { toast, show, dismiss } = useToast();
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);

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

  // Arrow keys walk the grid, Enter opens. The reason the tiles carry no
  // buttons of their own.
  useEffect(() => {
    if (open !== null || settings) return;
    const onKey = (event: KeyboardEvent) => {
      const delta =
        event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowLeft"
            ? -1
            : event.key === "ArrowDown"
              ? COLUMNS
              : event.key === "ArrowUp"
                ? -COLUMNS
                : 0;
      if (delta) {
        event.preventDefault();
        setSelected((prev) => Math.max(0, Math.min(list.length - 1, prev + delta)));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setOpen(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length, open, selected, settings]);

  useEffect(() => {
    tiles.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const act = (verb: string) =>
    show(`${verb}.`, verb === "Rejected" ? () => dismiss() : undefined);

  const grid = (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {page === "library" ? (
            <>
              <div className="flex rounded-md border border-border p-0.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={[
                      "rounded px-2.5 py-1 text-xs",
                      filter === f.key
                        ? "bg-secondary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="score-desc">Score, best first</option>
                <option value="score-asc">Score, worst first</option>
                <option value="filename">Filename</option>
                <option value="scanned">Recently scanned</option>
              </select>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {list.length} shown
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">Review · lowest scores first</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {list.length} of {STATS.eligible_count} eligible
              </span>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {data === "loading" ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="aspect-video animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : data === "empty" || list.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <ImageOff className="h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {page === "review"
                  ? "Nothing to review."
                  : "No wallpapers match this filter."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {list.map((w, i) => (
                <Tile
                  key={w.id}
                  w={w}
                  selected={i === selected}
                  onSelect={() => setSelected(i)}
                  onOpen={() => setOpen(i)}
                  innerRef={(node) => {
                    tiles.current[i] = node;
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Inspector
        w={data === "ready" ? (list[selected] ?? null) : null}
        onOpen={() => setOpen(selected)}
        onAction={act}
      />
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Chrome
        page={page}
        onPage={(next) => {
          setSettings(false);
          onPage(next);
        }}
        onSettings={() => setSettings(true)}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        {page === "rank" ? (
          data === "empty" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing left to rank. Every wallpaper is rejected.
              </p>
              <button onClick={() => setSettings(true)} className="text-sm underline">
                Open Settings
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center bg-neutral-900 p-6">
              <div className="grid w-full grid-cols-2 gap-6">
                {RANK_PAIR.map((w, i) => (
                  <div
                    key={w.id}
                    className="group relative aspect-video overflow-hidden rounded-lg ring-0 ring-white transition-all hover:ring-2"
                  >
                    {data === "loading" ? (
                      <div className="flex h-full items-center justify-center bg-neutral-800">
                        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
                      </div>
                    ) : (
                      <img src={largeSrc(w.id)} alt="" className="h-full w-full object-cover" />
                    )}
                    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white opacity-0 group-hover:opacity-100">
                      {i === 0 ? "← Left" : "Right →"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          grid
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

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-lg">
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
