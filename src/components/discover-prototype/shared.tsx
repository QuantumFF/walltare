// PROTOTYPE — throwaway. Answers "how should the Discover page look and
// behave?" (#324, part of #317). Nothing here talks to the backend: search
// pages come from a real Wallhaven fixture captured 2026-09-24, and the
// download queue is a timer that pretends to be ADR 0051's queue.
import { useApp } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import fixture from "./fixture.json";

export type Mark = "none" | "in_library" | "rejected";

export interface Result {
  id: string;
  views: number;
  favorites: number;
  purity: string;
  category: string;
  dimension_x: number;
  dimension_y: number;
  resolution: string;
  ratio: string;
  file_size: number;
  file_type: string;
  created_at: string;
  colors: string[];
  thumbs: { large: string; original: string };
  /** Full file on w.wallhaven.cc — would need an ADR 0053 amendment. */
  full: string;
  mark: Mark;
}

const ALL = fixture as Result[];
export const PER_PAGE = 24;
export const LAST_PAGE = 36;
export const TOTAL = 846;

// ---------------------------------------------------------------- filters

export const SORTINGS = [
  { value: "toplist", label: "Toplist" },
  { value: "hot", label: "Hot" },
  { value: "date_added", label: "Latest" },
  { value: "favorites", label: "Favourites" },
  { value: "views", label: "Views" },
  { value: "random", label: "Random" },
  { value: "relevance", label: "Relevance" },
] as const;
export type Sorting = (typeof SORTINGS)[number]["value"];

export const TOP_RANGES = ["1d", "3d", "1w", "1M", "3M", "6M", "1y"] as const;
export type TopRange = (typeof TOP_RANGES)[number];

export const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "anime", label: "Anime" },
  { value: "people", label: "People" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];

export const PURITIES = [
  { value: "sfw", label: "SFW" },
  { value: "sketchy", label: "Sketchy" },
  { value: "nsfw", label: "NSFW" },
] as const;
export type Purity = (typeof PURITIES)[number]["value"];

/** Wallhaven's 29 colours, the only values `colors` accepts. */
export const COLORS = [
  "660000", "990000", "cc0000", "cc3333", "ea4c88", "993399", "663399",
  "333399", "0066cc", "0099cc", "66cccc", "77cc33", "669900", "336600",
  "666600", "999900", "cccc33", "ffff00", "ffcc33", "ff9900", "ff6600",
  "cc6633", "996633", "663300", "000000", "999999", "cccccc", "ffffff",
  "424153",
];

export const COMMON_RATIOS = ["16x9", "16x10", "21x9", "32x9", "9x16"];

export interface Filters {
  q: string;
  sorting: Sorting;
  topRange: TopRange;
  categories: Category[];
  purity: Purity[];
  /** `null` = any ratio. Defaults to the Screen's on every visit. */
  ratio: string | null;
  color: string | null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function useScreenRatio() {
  const { settings } = useApp();
  const { width, height } = settings.screen;
  const d = gcd(width, height);
  return {
    screen: settings.screen,
    ratio: `${width / d}x${height / d}`,
  };
}

export function readableRatio(ratio: string) {
  return ratio.replace("x", ":");
}

export function useFilters() {
  const { ratio } = useScreenRatio();
  const [filters, setFilters] = useState<Filters>({
    q: "",
    sorting: "toplist",
    topRange: "1M",
    categories: ["general", "anime", "people"],
    purity: ["sfw"],
    ratio,
    color: null,
  });
  const set = useCallback(
    <K extends keyof Filters>(key: K, value: Filters[K]) =>
      setFilters((f) => ({ ...f, [key]: value })),
    [],
  );
  const toggle = useCallback(
    <K extends "categories" | "purity">(key: K, value: Filters[K][number]) =>
      setFilters((f) => {
        const list = f[key] as string[];
        const next = list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value];
        return { ...f, [key]: next.length ? next : list };
      }),
    [],
  );
  return { filters, set, toggle, screenRatio: ratio };
}

// ---------------------------------------------------------------- search

/**
 * Pretend search: every filter change returns the same fixture, rotated so the
 * grid visibly changes, after a 350ms "network" wait. Pages past the fixture
 * wrap around with suffixed ids.
 */
export function fakePage(filters: Filters, page: number): Result[] {
  const seed =
    (filters.q.length * 7 +
      filters.sorting.length * 3 +
      (filters.ratio?.length ?? 0) +
      filters.categories.length * 5 +
      TOP_RANGES.indexOf(filters.topRange)) %
    ALL.length;
  const out: Result[] = [];
  for (let i = 0; i < PER_PAGE; i++) {
    const n = (page - 1) * PER_PAGE + i;
    const r = ALL[(n + seed) % ALL.length];
    const lap = Math.floor((n + seed) / ALL.length);
    out.push(lap === 0 ? r : { ...r, id: `${r.id}~${lap}` });
  }
  return out;
}

export function useFakeSearch(filters: Filters, mode: "append" | "page") {
  const [pages, setPages] = useState<Result[][]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(filters);

  useEffect(() => {
    setLoading(true);
    setPages([]);
    setPage(1);
    const t = setTimeout(() => {
      setPages([fakePage(filters, 1)]);
      setLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [key]);

  const loadMore = useCallback(() => {
    if (loading || page >= LAST_PAGE) return;
    setLoading(true);
    const next = page + 1;
    setTimeout(() => {
      setPages((p) => [...p, fakePage(filters, next)]);
      setPage(next);
      setLoading(false);
    }, 350);
  }, [loading, page, key]);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.max(1, Math.min(LAST_PAGE, n));
      setLoading(true);
      setTimeout(() => {
        setPages([fakePage(filters, target)]);
        setPage(target);
        setLoading(false);
      }, 350);
    },
    [key],
  );

  const results = useMemo(
    () => (mode === "append" ? pages.flat() : (pages[0] ?? [])),
    [pages, mode],
  );
  return { results, page, loading, loadMore, goTo };
}

// ---------------------------------------------------------------- downloads

export type DownloadState =
  | { kind: "queued" }
  | { kind: "downloading" }
  | { kind: "landed" }
  | { kind: "failed"; message: string };

export interface Batch {
  total: number;
  landed: number;
  failed: number;
  running: boolean;
  firstError: string | null;
}

/**
 * ADR 0051's queue, faked: one file at a time in pick order, later picks join
 * the running batch, no cancel, no byte-level progress (ADR 0054). Roughly one
 * in eight fails so the failure path is visible.
 */
export function useFakeDownloads() {
  const [states, setStates] = useState<Record<string, DownloadState>>({});
  const [batch, setBatch] = useState<Batch | null>(null);
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const tried = useRef(new Set<string>());

  const pump = useCallback(() => {
    if (busy.current) return;
    const id = queue.current.shift();
    if (!id) {
      setBatch((b) => (b ? { ...b, running: false } : b));
      return;
    }
    busy.current = true;
    setStates((s) => ({ ...s, [id]: { kind: "downloading" } }));
    setTimeout(
      () => {
        // Fails once, for about one id in eight; a retry lands.
        const fail = !tried.current.has(id) && id.charCodeAt(1) % 8 === 0;
        tried.current.add(id);
        setStates((s) => ({
          ...s,
          [id]: fail
            ? { kind: "failed", message: "Connection reset by w.wallhaven.cc" }
            : { kind: "landed" },
        }));
        setBatch((b) =>
          b
            ? {
                ...b,
                landed: b.landed + (fail ? 0 : 1),
                failed: b.failed + (fail ? 1 : 0),
                firstError:
                  b.firstError ?? (fail ? "Connection reset by w.wallhaven.cc" : null),
              }
            : b,
        );
        busy.current = false;
        pump();
      },
      900 + Math.random() * 1400,
    );
  }, []);

  const download = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter(
        (id) =>
          !queue.current.includes(id) &&
          (states[id] === undefined || states[id].kind === "failed"),
      );
      if (fresh.length === 0) return;
      queue.current.push(...fresh);
      setStates((s) => {
        const next = { ...s };
        for (const id of fresh) next[id] = { kind: "queued" };
        return next;
      });
      setBatch((b) =>
        b && b.running
          ? { ...b, total: b.total + fresh.length }
          : {
              total: fresh.length,
              landed: 0,
              failed: 0,
              running: true,
              firstError: null,
            },
      );
      setTimeout(pump, 0);
    },
    [pump, states],
  );

  const dismiss = useCallback(() => setBatch(null), []);

  return { states, batch, download, dismiss };
}

/** A result's mark once downloads are folded in: a landed file is In library. */
export function effectiveMark(r: Result, s: DownloadState | undefined): Mark {
  if (s?.kind === "landed") return "in_library";
  return r.mark;
}

export function canDownload(r: Result, s: DownloadState | undefined) {
  return effectiveMark(r, s) === "none" && (!s || s.kind === "failed");
}

// ---------------------------------------------------------------- picks

export function usePicks() {
  const [picks, setPicks] = useState<string[]>([]);
  const toggle = useCallback(
    (id: string) =>
      setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    [],
  );
  const clear = useCallback(() => setPicks([]), []);
  const drop = useCallback(
    (ids: string[]) => setPicks((p) => p.filter((x) => !ids.includes(x))),
    [],
  );
  return { picks, toggle, clear, drop, setPicks };
}

// ---------------------------------------------------------------- copy

export const MARK_LABEL: Record<Exclude<Mark, "none">, string> = {
  in_library: "In library",
  rejected: "Rejected",
};

export function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ---------------------------------------------------------------- toast

/**
 * Stand-in for ADR 0021's pinned background toast and ADR 0051's ending,
 * drawn where the real one sits (top right, under the chrome).
 */
export function FakeDownloadToast({
  batch,
  onDismiss,
}: {
  batch: Batch | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!batch || batch.running || batch.failed > 0) return;
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [batch, onDismiss]);

  if (!batch) return null;
  const done = batch.landed + batch.failed;
  return (
    <div className="fixed top-14 right-4 z-[60] w-80 rounded-lg border border-border bg-popover p-3 text-sm shadow-lg">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {batch.running ? (
            <>
              <p className="font-medium">
                Downloading… {done} of {batch.total}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${(done / batch.total) * 100}%` }}
                />
              </div>
            </>
          ) : batch.failed === 0 ? (
            <>
              <p className="font-medium">
                {batch.landed} {batch.landed === 1 ? "wallpaper" : "wallpapers"}{" "}
                added
              </p>
              <p className="text-xs text-muted-foreground">Back to Round 1</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                {batch.landed} added, {batch.failed} failed
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {batch.firstError}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- switcher

export const VARIANTS = [
  { key: "A", name: "Library twin" },
  { key: "B", name: "Filter rail + detail pane" },
  { key: "C", name: "Search-first stream" },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get("variant");
  return (VARIANTS.find((x) => x.key === v)?.key ?? "A") as VariantKey;
}

export function useVariant() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const go = useCallback((key: VariantKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
    setVariant(key);
  }, []);
  return { variant, go };
}

function isTyping(t: EventTarget | null) {
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")
  );
}

/**
 * The floating switcher. Alt+←/→ rather than bare arrows, because every
 * variant spends the bare arrows on its grid.
 */
export function PrototypeSwitcher({
  variant,
  go,
  state,
}: {
  variant: VariantKey;
  go: (key: VariantKey) => void;
  state: string;
}) {
  const at = VARIANTS.findIndex((v) => v.key === variant);
  const step = useCallback(
    (by: 1 | -1) => go(VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length].key),
    [at, go],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || isTyping(e.target)) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-2 py-1 text-xs text-white shadow-xl">
      <button
        type="button"
        onClick={() => step(-1)}
        className="rounded-full px-2 py-1 hover:bg-white/20"
      >
        ←
      </button>
      <span className="font-medium">
        PROTOTYPE {variant} ({VARIANTS[at].name})
      </span>
      <span className="text-white/70">{state}</span>
      <button
        type="button"
        onClick={() => step(1)}
        className="rounded-full px-2 py-1 hover:bg-white/20"
      >
        →
      </button>
    </div>
  );
}

export function MarkPill({ mark, className }: { mark: Mark; className?: string }) {
  if (mark === "none") return null;
  return (
    <div
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11px] backdrop-blur-md",
        mark === "in_library"
          ? "bg-white font-medium text-neutral-900"
          : "bg-black/60 text-white",
        className,
      )}
    >
      {MARK_LABEL[mark]}
    </div>
  );
}
