// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// Variant C — "List". The provocation: a library in the low thousands is a
// list, not a wall. Rows carry a thumbnail chip, sortable columns, and actions
// that are always visible, so nothing hides behind hover and a fixed row height
// makes virtualisation arithmetic trivial. The image is the thing you click to
// see properly, not the thing you scan.
//
// If this loses, the reaction is worth having anyway: it says out loud that the
// grid is for judging pictures rather than managing files, which is a claim the
// library page's whole design rests on.
//
// Settings is a fourth tab in the same pill group. The chrome carries the Round
// line as text and pre-generation as an inline meter.

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
  ArrowDown,
  ArrowUp,
  Check,
  FolderInput,
  Info,
  Loader2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

const TABS: Array<{ key: Page; label: string }> = [
  { key: "rank", label: "Rank" },
  { key: "review", label: "Review" },
  { key: "library", label: "Library" },
  { key: "settings", label: "Settings" },
];

const FILTERS: Array<{ key: Status | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "kept", label: "Kept" },
  { key: "rejected", label: "Rejected" },
];

const PREGEN = { done: 412, total: 1204 };

type SortKey = "filename" | "score" | "comparisons" | "status";

function ScoreCell({ w }: { w: ProtoWallpaper }) {
  const solid = isEvaluated(w);
  return (
    <span
      title={solid ? "Evaluated" : "Not yet Evaluated"}
      className={[
        "inline-block rounded px-1.5 py-0.5 text-xs tabular-nums",
        solid
          ? "bg-foreground font-medium text-background"
          : "border border-border text-muted-foreground",
      ].join(" ")}
    >
      {scoreLabel(w)}
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  const tone =
    status === "rejected"
      ? "border-border text-muted-foreground"
      : status === "kept"
        ? "border-foreground/30 text-foreground"
        : "border-border text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function Chrome({ page, onPage }: { page: Page; onPage: (page: Page) => void }) {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex h-13 items-center gap-4 px-4 py-2">
        <span className="text-sm font-semibold tracking-tight">walltare</span>

        <nav className="flex gap-0.5 rounded-lg bg-secondary/60 p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onPage(tab.key)}
              className={[
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                page === tab.key
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
          <span title={ROUND_EXPLAINER} className="cursor-help">
            Round {STATS.round} · {ROUND_PERCENT}% · {STATS.evaluated_count}/
            {STATS.eligible_count} Evaluated
          </span>
          {PREGEN.done < PREGEN.total && (
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                <span
                  className="block h-full bg-foreground/50"
                  style={{ width: `${(PREGEN.done / PREGEN.total) * 100}%` }}
                />
              </span>
              thumbnails {PREGEN.done}/{PREGEN.total}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function Row({
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
    <tr
      className={[
        "border-b border-border/60 hover:bg-accent/50",
        rejected ? "text-muted-foreground" : "",
      ].join(" ")}
    >
      <td className="py-1 pl-3">
        <button onClick={onOpen} className="block cursor-zoom-in">
          <img
            src={cardSrc(w.id)}
            alt={w.filename}
            loading="lazy"
            className={[
              "h-10 w-[72px] rounded object-cover",
              rejected ? "opacity-55 grayscale" : "",
            ].join(" ")}
          />
        </button>
      </td>
      <td className="max-w-[1px] px-3">
        <button onClick={onOpen} className="block w-full truncate text-left text-sm">
          {w.filename}
        </button>
      </td>
      <td className="px-3">
        <ScoreCell w={w} />
      </td>
      <td className="px-3 text-right text-xs tabular-nums">{w.comparisons_count}</td>
      <td className="px-3">
        <StatusPill status={w.status} />
      </td>
      <td className="max-w-[1px] px-3">
        <p className="truncate font-mono text-[11px] text-muted-foreground">{w.path}</p>
        {w.origin_path && (
          <p className="truncate font-mono text-[10px] text-muted-foreground/60">
            from {w.origin_path}
          </p>
        )}
      </td>
      <td className="px-3 py-1 text-right whitespace-nowrap">
        {rejected ? (
          <button
            disabled={!w.origin_path}
            title={
              w.origin_path
                ? `Restore to ${w.origin_path}`
                : "Rejected before restore existed, so there is no origin to go back to"
            }
            onClick={() => onAction("Restored")}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
            Restore
          </button>
        ) : (
          <span className="inline-flex gap-1.5">
            <button
              onClick={() => onAction(w.status === "kept" ? "Returned to voting" : "Kept")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
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
              className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <FolderInput className="h-3 w-3" />
              Reject
            </button>
          </span>
        )}
      </td>
    </tr>
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
  const [info, setInfo] = useState(false);
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

  // Chrome-light on purpose: the image gets the whole frame, the metadata is
  // one keypress away rather than permanently on screen.
  return (
    <div className="fixed inset-0 z-50 bg-black" onClick={onClose}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 py-3">
        <span className="truncate text-sm text-white">{w.filename}</span>
        <span className="shrink-0 text-xs text-white/50 tabular-nums">
          {index + 1} / {list.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setInfo((v) => !v);
          }}
          className="ml-auto rounded-md p-1.5 text-white/70 hover:bg-white/15 hover:text-white"
          aria-label="Details"
        >
          <Info className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-white/70 hover:bg-white/15 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <img
        key={w.id}
        src={largeSrc(w.id)}
        alt={w.filename}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
      />

      {info && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-14 right-4 z-10 w-80 space-y-2 rounded-lg bg-black/80 p-4 text-xs text-white/80 backdrop-blur-md"
        >
          <div className="flex justify-between">
            <span className="text-white/50">Score</span>
            <span className="tabular-nums">
              {scoreLabel(w)} {isEvaluated(w) ? "· Evaluated" : "· not yet Evaluated"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Comparisons</span>
            <span className="tabular-nums">{w.comparisons_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Status</span>
            <span>{statusLabel(w.status)}</span>
          </div>
          <div>
            <p className="text-white/50">Path</p>
            <p className="font-mono break-all">{w.path}</p>
          </div>
          {w.origin_path && (
            <div>
              <p className="text-white/50">Came from</p>
              <p className="font-mono break-all">{w.origin_path}</p>
            </div>
          )}
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur-md"
      >
        {w.status === "rejected" ? (
          <button
            disabled={!w.origin_path}
            onClick={() => onAction("Restored")}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            Restore
          </button>
        ) : (
          <>
            <button
              onClick={() => onAction("Kept")}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white hover:bg-white/15"
            >
              <Check className="h-4 w-4" />
              Keep
            </button>
            <span className="h-5 w-px bg-white/20" />
            <button
              onClick={() => onAction("Rejected")}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white hover:bg-white/15"
            >
              <FolderInput className="h-4 w-4" />
              Reject
            </button>
          </>
        )}
        <span className="px-3 text-[11px] text-white/40">← → i Esc</span>
      </div>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="divide-y divide-border">
      {[
        { label: "Library folder", value: "~/Wallpapers", hint: "/home/qdes/Wallpapers" },
        {
          label: "Reject destination",
          value: "./rejected",
          hint: "Relative to each wallpaper's own folder",
        },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-4 px-4 py-4">
          <div className="w-48 shrink-0">
            <p className="text-sm font-medium">{row.label}</p>
            <p className="text-xs text-muted-foreground">{row.hint}</p>
          </div>
          <input
            defaultValue={row.value}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Browse
          </button>
        </div>
      ))}

      <div className="flex items-center gap-4 px-4 py-4">
        <div className="w-48 shrink-0 text-sm font-medium">Appearance</div>
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {["System", "Light", "Dark"].map((t, i) => (
            <button
              key={t}
              className={`rounded px-3 py-1.5 ${i === 0 ? "bg-secondary font-medium" : "text-muted-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 py-4">
        <div className="w-48 shrink-0">
          <p className="text-sm font-medium">Thumbnails</p>
          <p className="text-xs text-muted-foreground">830 MB cached · 792 pending</p>
        </div>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
          Generate now
        </button>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
          Clear cache
        </button>
      </div>

      <p className="px-4 py-4 text-xs text-muted-foreground/70">
        Placeholder. A settings tab is the cheapest of the three placements and the most
        prominent, which is the trade this variant is testing.
      </p>
    </div>
  );
}

export function ListShell({
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
  const [sort, setSort] = useState<SortKey>("score");
  const [descending, setDescending] = useState(true);
  const { toast, show, dismiss } = useToast();

  const list = useMemo(() => {
    if (page === "review") return REVIEW_LIST;
    const filtered = LIBRARY.filter((w) => filter === "all" || w.status === filter);
    const sorted = filtered.slice().sort((a, b) => {
      if (sort === "filename") return a.filename.localeCompare(b.filename);
      if (sort === "comparisons") return a.comparisons_count - b.comparisons_count;
      if (sort === "status") return a.status.localeCompare(b.status);
      return a.rating_mu - b.rating_mu;
    });
    return descending ? sorted.reverse() : sorted;
  }, [page, filter, sort, descending]);

  const act = (verb: string) =>
    show(`${verb}.`, verb === "Rejected" ? () => dismiss() : undefined);

  const header = (key: SortKey, label: string, align = "text-left") => (
    <th className={`px-3 py-2 font-medium ${align}`}>
      <button
        onClick={() => {
          if (sort === key) setDescending((v) => !v);
          else {
            setSort(key);
            setDescending(key === "score");
          }
        }}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {label}
        {sort === key &&
          (descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  const table = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        {page === "library" ? (
          <>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={[
                  "rounded-full border px-3 py-1 text-xs",
                  filter === f.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {list.length} of {LIBRARY.length}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium">Review · lowest scores first</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {list.length} rows
            </span>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data === "loading" ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : data === "empty" || list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              {page === "review" ? "Nothing to review." : "No rows match this filter."}
            </p>
          </div>
        ) : (
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[88px]" />
              <col />
              <col className="w-20" />
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-[34%]" />
              <col className="w-[190px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-background text-xs">
              <tr>
                <th className="px-3 py-2" />
                {header("filename", "Filename")}
                {header("score", "Score")}
                {header("comparisons", "#", "text-right")}
                {header("status", "Status")}
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Path</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((w, i) => (
                <Row key={w.id} w={w} onOpen={() => setOpen(i)} onAction={act} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Chrome page={page} onPage={onPage} />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {page === "rank" &&
          (data === "empty" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing left to rank. Every wallpaper is rejected.
              </p>
              <button onClick={() => onPage("settings")} className="text-sm underline">
                Open Settings
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center bg-neutral-900 p-5">
              <div className="grid w-full grid-cols-2 gap-5">
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
          ))}
        {page === "settings" && <SettingsPage />}
        {(page === "library" || page === "review") && table}
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
