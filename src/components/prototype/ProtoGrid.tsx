/**
 * PROTOTYPE (#254) — throwaway. See README.md in this folder.
 *
 * Seven layouts behind one component. No virtualisation, no memoisation, no
 * tests, and every action is local state. Do not take anything here as a model
 * for the real grid: `WallpaperGrid` is the one with the ADRs behind it.
 */
import { ProtoBar } from "@/components/prototype/ProtoBar";
import {
  type ProtoTab,
  type ProtoVariant,
  ZOOM,
  ratioOf,
  useRatios,
  useVariant,
} from "@/components/prototype/proto";
import { Button } from "@/components/ui/button";
import { type Wallpaper, wallpaperImageUrl } from "@/lib/client";
import { STATUS_LABEL, isEvaluated, score } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* -------------------------------------------------------------------------
 * Zoom and measurement
 * ---------------------------------------------------------------------- */

/** Ctrl+wheel and +/-, clamped to the tab's range. Not persisted, by design. */
function useZoom(tab: ProtoTab, variant: ProtoVariant) {
  const range = ZOOM[tab];
  const [columns, setColumns] = useState(variant.columns ?? range.start);

  // A variant that wants its own starting density gets it on every switch, so
  // the contact sheet opens dense and the hero opens at one.
  useEffect(() => {
    setColumns(variant.columns ?? range.start);
  }, [variant, range.start]);

  const step = useCallback(
    (delta: number) =>
      setColumns((n) => Math.min(range.max, Math.max(range.min, n + delta))),
    [range.max, range.min],
  );

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      step(event.deltaY > 0 ? 1 : -1);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") step(-1);
      else if (event.key === "-") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [step]);

  return columns;
}

/**
 * The screen's own ratio, for the crop preview.
 *
 * `window.screen` rather than Tauri's `currentMonitor`, because this is a
 * prototype and the browser already knows. The real one is the "Your screen"
 * setting (#254 Q26): detected from the monitor, overridable, and the same
 * number the minimum-resolution check measures against.
 */
function useScreenRatio(): { ratio: number; label: string } {
  return useMemo(() => {
    const width = window.screen?.width ?? 1920;
    const height = window.screen?.height ?? 1080;
    return { ratio: width / height, label: `${width}x${height}` };
  }, []);
}

/** Whether a key is down right now. Held rather than toggled (#254 Q24). */
function useHeld(key: string): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const match = (event: KeyboardEvent) =>
      event.key.toLowerCase() === key && !event.ctrlKey && !event.metaKey;
    const down = (event: KeyboardEvent) => match(event) && setHeld(true);
    const up = (event: KeyboardEvent) => match(event) && setHeld(false);
    // A window that loses focus never sees the keyup, so the bars would stay up.
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [key]);
  return held;
}

/**
 * The box's size. Justified rows need the width; the hero needs both.
 *
 * Measured rather than left to CSS. A box that is only `aspect-ratio` plus
 * `max-height` inside a flex parent has a definite size in neither axis, so it
 * resolves to zero and the image disappears — which is exactly what happened
 * when the hero stopped being `object-contain` inside a `flex-1` div.
 */
function useBox(ref: React.RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = (width: number, height: number) => {
      // A view hidden with `display: none` measures zero (ADR 0015). Keeping the
      // last real numbers is what stops the layout collapsing on a tab switch.
      if (width > 0 && height > 0) setBox({ width, height });
    };
    // The observer's first callback is a frame away, and a justified row cannot
    // lay out without a width, so read it here as well as subscribing.
    read(node.offsetWidth, node.offsetHeight);
    const observer = new ResizeObserver(([entry]) =>
      read(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/* -------------------------------------------------------------------------
 * The card
 * ---------------------------------------------------------------------- */

interface Chrome {
  /** The Score badge. On everywhere except the mosaic, which draws it as a bar. */
  badge?: boolean;
  /** A Score bar along the bottom edge, width by rank within the list. */
  bar?: number;
  /** Filename under the card rather than inside the hover overlay. */
  caption?: boolean;
  rounded?: boolean;
  /** Keep and Reject on the face of the card instead of waiting for a hover. */
  persistentActions?: boolean;
}

function ProtoCard({
  wallpaper,
  selected,
  chrome,
  onOpen,
  onAct,
  onMouseEnter,
  className,
  style,
}: {
  wallpaper: Wallpaper;
  selected: boolean;
  chrome: Chrome;
  onOpen: () => void;
  onAct: (id: number) => void;
  onMouseEnter?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const act = (event: React.MouseEvent, id: number) => {
    event.stopPropagation();
    onAct(id);
  };

  return (
    <div
      className={cn("group relative", className)}
      style={style}
      onMouseEnter={onMouseEnter}
    >
      <div
        role="button"
        tabIndex={-1}
        onClick={onOpen}
        className={cn(
          "relative h-full w-full overflow-hidden bg-card",
          chrome.rounded && "rounded-lg",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <img
          src={wallpaperImageUrl(wallpaper.id, "small")}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full object-cover",
            wallpaper.status === "rejected" && "opacity-60 grayscale",
          )}
        />

        {chrome.badge && (
          <span
            className={cn(
              "absolute top-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums backdrop-blur-md",
              isEvaluated(wallpaper)
                ? "bg-white/90 text-black"
                : "border border-white/30 bg-black/50 text-white/70",
            )}
          >
            {score(wallpaper)}
          </span>
        )}

        {wallpaper.status !== "active" && (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-md">
            {STATUS_LABEL[wallpaper.status]}
          </span>
        )}

        {/* The Score as a line rather than a number. Mosaic has no room for a
            badge without putting a box back on a layout whose whole argument is
            that it has no boxes. */}
        {chrome.bar !== undefined && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
            <div
              className="h-full bg-white/80"
              style={{ width: `${Math.round(chrome.bar * 100)}%` }}
            />
          </div>
        )}

        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 pt-6",
            chrome.persistentActions
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <p className="truncate text-[11px] font-medium text-white">
            {wallpaper.filename}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <Button
              size="sm"
              className="h-6 bg-white/15 px-2 text-[11px] hover:bg-white/25"
              onClick={(event) => act(event, wallpaper.id)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              className="h-6 bg-destructive/90 px-2 text-[11px]"
              onClick={(event) => act(event, wallpaper.id)}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>

      {chrome.caption && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          {wallpaper.filename}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * The grid
 * ---------------------------------------------------------------------- */

export function ProtoGrid({
  wallpapers,
  tab,
}: {
  wallpapers: Wallpaper[];
  tab: ProtoTab;
}) {
  const variant = useVariant(tab);
  const columns = useZoom(tab, variant);
  const box = useRef<HTMLDivElement>(null);
  const { width } = useBox(box);

  const ids = useMemo(() => wallpapers.map((w) => w.id), [wallpapers]);
  useRatios(ids);

  // Every action in this prototype, in one line: the card goes away until the
  // page refetches. Nothing reaches the backend (#254 Q17).
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const hide = useCallback(
    (id: number) => setHidden((set) => new Set(set).add(id)),
    [],
  );

  const list = useMemo(
    () => wallpapers.filter((w) => !hidden.has(w.id)),
    [wallpapers, hidden],
  );

  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<Wallpaper | null>(null);
  const at = Math.min(cursor, Math.max(0, list.length - 1));
  const current = list[at];

  const move = useCallback(
    (delta: number) =>
      setCursor((n) => Math.min(list.length - 1, Math.max(0, n + delta))),
    [list.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      switch (event.key) {
        case "ArrowRight":
          move(1);
          break;
        case "ArrowLeft":
          move(-1);
          break;
        case "ArrowDown":
          move(columns);
          break;
        case "ArrowUp":
          move(-columns);
          break;
        case "Enter":
          setOpen(current ?? null);
          break;
        case "Escape":
          setOpen(null);
          return;
        case "k":
        case "K":
        case "Delete":
          if (current) hide(current.id);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, columns, current, hide]);

  // Rank within the list, for the mosaic's Score bar. Recomputed per render
  // because this is a prototype and 120 rows is nothing.
  const bars = useMemo(() => {
    const sorted = [...list].sort((a, b) => a.rating_mu - b.rating_mu);
    const rank = new Map<number, number>();
    sorted.forEach((w, index) =>
      rank.set(w.id, sorted.length < 2 ? 1 : index / (sorted.length - 1)),
    );
    return rank;
  }, [list]);

  const shared = {
    onAct: hide,
    list,
    at,
    setOpen,
    setCursor,
    columns,
    bars,
    width,
  };

  return (
    <>
      <div ref={box} className="h-full w-full">
        {variant.key === "masonry" && <Masonry {...shared} />}
        {variant.key === "mosaic" && <Mosaic {...shared} />}
        {variant.key === "justified" && <Justified {...shared} />}
        {variant.key === "sheet" && <Sheet {...shared} />}
        {variant.key === "hero" && <Hero {...shared} />}
        {variant.key === "compare" && <Compare {...shared} />}
        {variant.key === "bigcell" && <BigCell {...shared} />}
      </div>

      <ProtoBar tab={tab} />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-8"
          onClick={() => setOpen(null)}
        >
          <img
            src={wallpaperImageUrl(open.id, "medium")}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
          <button
            type="button"
            className="absolute top-4 right-4 rounded-md bg-white/10 p-2 text-white"
            onClick={() => setOpen(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

interface LayoutProps {
  list: Wallpaper[];
  at: number;
  columns: number;
  width: number;
  bars: Map<number, number>;
  onAct: (id: number) => void;
  setOpen: (wallpaper: Wallpaper | null) => void;
  setCursor: (index: number) => void;
}

/* --- Library ------------------------------------------------------------ */

/** CSS columns, true ratios, 4px gutters, nothing between the images. */
function Masonry({ list, at, columns, onAct, setOpen, setCursor }: LayoutProps) {
  return (
    <div style={{ columnCount: columns, columnGap: 4 }}>
      {list.map((wallpaper, index) => (
        <div
          key={wallpaper.id}
          className="mb-1 break-inside-avoid"
          onMouseEnter={() => setCursor(index)}
        >
          <ProtoCard
            wallpaper={wallpaper}
            selected={index === at}
            chrome={{ badge: true }}
            onOpen={() => setOpen(wallpaper)}
            onAct={onAct}
            style={{ aspectRatio: ratioOf(wallpaper.id) }}
          />
        </div>
      ))}
    </div>
  );
}

/** Gapless and cropped. The wall, rather than a page of cards. */
function Mosaic({
  list,
  at,
  columns,
  bars,
  onAct,
  setOpen,
  setCursor,
}: LayoutProps) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {list.map((wallpaper, index) => (
        <ProtoCard
          key={wallpaper.id}
          wallpaper={wallpaper}
          selected={index === at}
          chrome={{ bar: bars.get(wallpaper.id) ?? 0 }}
          onOpen={() => setOpen(wallpaper)}
          onAct={onAct}
          onMouseEnter={() => setCursor(index)}
          className="aspect-video"
        />
      ))}
    </div>
  );
}

/**
 * Rows scaled to a shared height, uncropped, with the rank set large behind.
 *
 * The row height falls out of the ratios rather than being chosen: fill the row
 * with whole images, then divide the width by the ratios you used. Zoom moves
 * the target height, which moves how many images a row holds.
 */
function Justified({
  list,
  at,
  columns,
  width,
  onAct,
  setOpen,
  setCursor,
}: LayoutProps) {
  const rows = useMemo(() => {
    if (width === 0) return [];
    const target = width / columns / (16 / 9);
    const out: Array<{ items: Wallpaper[]; height: number }> = [];
    let run: Wallpaper[] = [];
    let sum = 0;
    for (const wallpaper of list) {
      run.push(wallpaper);
      sum += ratioOf(wallpaper.id);
      if (sum * target >= width) {
        out.push({ items: run, height: width / sum });
        run = [];
        sum = 0;
      }
    }
    if (run.length > 0) out.push({ items: run, height: Math.min(target, width / sum) });
    return out;
  }, [list, width, columns]);

  let index = -1;
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-1">
          {row.items.map((wallpaper) => {
            index += 1;
            const here = index;
            return (
              <div
                key={wallpaper.id}
                className="relative"
                style={{
                  height: row.height,
                  width: row.height * ratioOf(wallpaper.id),
                }}
                onMouseEnter={() => setCursor(here)}
              >
                <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-[6rem] leading-none font-bold text-white/15 tabular-nums mix-blend-overlay">
                  {here + 1}
                </span>
                <ProtoCard
                  wallpaper={wallpaper}
                  selected={here === at}
                  chrome={{ badge: true }}
                  onOpen={() => setOpen(wallpaper)}
                  onAct={onAct}
                  className="h-full w-full"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Small, dense, named. The argument against everything above it. */
function Sheet({ list, at, columns, onAct, setOpen, setCursor }: LayoutProps) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {list.map((wallpaper, index) => (
        <div key={wallpaper.id} onMouseEnter={() => setCursor(index)}>
          <ProtoCard
            wallpaper={wallpaper}
            selected={index === at}
            chrome={{ badge: true, caption: true, rounded: true }}
            onOpen={() => setOpen(wallpaper)}
            onAct={onAct}
            className="aspect-video"
          />
        </div>
      ))}
    </div>
  );
}

/* --- Review ------------------------------------------------------------- */

/**
 * What the screen would keep of this wallpaper, and what it would throw away.
 *
 * Cropping to fill means scaling until the image covers the screen and cutting
 * whatever hangs over, so the overflow is on one axis only: an image wider in
 * ratio than the screen loses its sides, a narrower one loses its top and
 * bottom. The bars are drawn over the discarded part rather than hiding it,
 * because the question is what you are about to lose.
 */
function CropBars({
  imageRatio,
  screen,
}: {
  imageRatio: number;
  screen: { ratio: number; label: string };
}) {
  const wider = imageRatio > screen.ratio;
  const kept = wider ? screen.ratio / imageRatio : imageRatio / screen.ratio;
  const bar = `${((1 - kept) / 2) * 100}%`;
  const lost = Math.round((1 - kept) * 100);

  return (
    <>
      <div
        className="pointer-events-none absolute bg-black/70"
        style={
          wider
            ? { top: 0, bottom: 0, left: 0, width: bar }
            : { left: 0, right: 0, top: 0, height: bar }
        }
      />
      <div
        className="pointer-events-none absolute bg-black/70"
        style={
          wider
            ? { top: 0, bottom: 0, right: 0, width: bar }
            : { left: 0, right: 0, bottom: 0, height: bar }
        }
      />
      <div
        className="pointer-events-none absolute border border-white/70"
        style={
          wider
            ? { top: 0, bottom: 0, left: bar, right: bar }
            : { left: 0, right: 0, top: bar, bottom: bar }
        }
      />
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[11px] text-white">
        {screen.label} · {lost}% of the {wider ? "width" : "height"} is cut
      </span>
    </>
  );
}

/** One wallpaper at the size you would actually hang it, the queue underneath. */
function Hero({ list, at, onAct, setOpen, setCursor }: LayoutProps) {
  const screen = useScreenRatio();
  const cropping = useHeld("c");
  const area = useRef<HTMLDivElement>(null);
  const { width, height } = useBox(area);
  const current = list[at];

  // The largest box of the image's own ratio that fits the area, in pixels.
  // The image needs a box of exactly its own shape for the crop bars to be
  // percentages of the image rather than of the letterboxing around it, and
  // that shape cannot come from CSS here: see `useBox`.
  const ratio = current ? ratioOf(current.id) : 16 / 9;
  const fitHeight = Math.min(height, width / ratio);

  return (
    <div className="flex h-full flex-col gap-3">
      <div
        ref={area}
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        {current && fitHeight > 0 && (
          <div
            className="relative"
            style={{ height: fitHeight, width: fitHeight * ratio }}
          >
            <img
              src={wallpaperImageUrl(current.id, "medium")}
              alt=""
              className="h-full w-full rounded-lg object-cover"
            />
            {cropping && <CropBars imageRatio={ratio} screen={screen} />}
          </div>
        )}
      </div>

      {current && (
        <div className="flex shrink-0 items-center justify-center gap-3">
          <span className="text-sm text-muted-foreground">
            {current.filename} · {score(current)}
          </span>
          <span className="text-xs text-muted-foreground/70">
            hold C to crop
          </span>
          <Button size="sm" onClick={() => onAct(current.id)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onAct(current.id)}
          >
            Reject
          </Button>
        </div>
      )}

      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-36">
        {list.map((wallpaper, index) => (
          <button
            key={wallpaper.id}
            type="button"
            onClick={() => setCursor(index)}
            onDoubleClick={() => setOpen(wallpaper)}
            className={cn(
              "h-14 w-24 shrink-0 overflow-hidden rounded-md",
              index === at ? "ring-2 ring-primary" : "opacity-50",
            )}
          >
            <img
              src={wallpaperImageUrl(wallpaper.id, "small")}
              alt=""
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two at a time, the way the voting view already asks you to look. */
function Compare({ list, at, onAct, setOpen }: LayoutProps) {
  const pair = [list[at], list[at + 1]].filter(Boolean);

  return (
    <div className="grid h-full grid-cols-2 gap-4 pb-36">
      {pair.map((wallpaper) => (
        <div key={wallpaper.id} className="flex min-h-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen(wallpaper)}
            className="min-h-0 flex-1"
          >
            <img
              src={wallpaperImageUrl(wallpaper.id, "medium")}
              alt=""
              className="h-full w-full rounded-lg object-contain"
            />
          </button>
          <div className="flex shrink-0 items-center justify-center gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {wallpaper.filename}
            </span>
            <Button size="sm" onClick={() => onAct(wallpaper.id)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onAct(wallpaper.id)}
            >
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Today's grid, uncropped, three times the size, with the buttons already out. */
function BigCell({ list, at, columns, onAct, setOpen, setCursor }: LayoutProps) {
  return (
    <div
      className="grid gap-4 pb-36"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {list.map((wallpaper, index) => (
        <div key={wallpaper.id} onMouseEnter={() => setCursor(index)}>
          <ProtoCard
            wallpaper={wallpaper}
            selected={index === at}
            chrome={{ badge: true, rounded: true, persistentActions: true }}
            onOpen={() => setOpen(wallpaper)}
            onAct={onAct}
            style={{ aspectRatio: ratioOf(wallpaper.id) }}
          />
        </div>
      ))}
    </div>
  );
}
