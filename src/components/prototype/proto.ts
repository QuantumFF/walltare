/**
 * PROTOTYPE (#254) — throwaway. See README.md in this folder.
 *
 * The registry, the `?proto=` state and the two bits of arithmetic the variants
 * share: how wide a wallpaper is, and how many columns the curator asked for.
 */
import { wallpaperImageUrl } from "@/lib/client";
import { useEffect, useState, useSyncExternalStore } from "react";

export type ProtoTab = "library" | "review";

export interface ProtoVariant {
  key: string;
  label: string;
  /** One line on the bar, so the curator knows what they are looking at. */
  blurb: string;
  /** Where the zoom starts on this variant, if it wants something other than the tab default. */
  columns?: number;
}

/** Four for the browse surface. */
export const LIBRARY_VARIANTS: ProtoVariant[] = [
  {
    key: "masonry",
    label: "Masonry",
    blurb: "True ratios, 4px gutters, no chrome at all until you hover.",
  },
  {
    key: "mosaic",
    label: "Mosaic",
    blurb: "Edge to edge, no gutters, cropped. The Score is the bar underneath.",
    columns: 3,
  },
  {
    key: "justified",
    label: "Justified rows",
    blurb: "Uncropped, scaled to a shared row height, rank set large behind.",
  },
  {
    key: "sheet",
    label: "Contact sheet",
    blurb: "Small, dense, filenames always on. Built for 5,000, not for 120.",
    columns: 9,
  },
];

/** Three for the decision queue. */
export const REVIEW_VARIANTS: ProtoVariant[] = [
  {
    key: "hero",
    label: "Hero + filmstrip",
    blurb: "One wallpaper at full size, the queue as a strip below it.",
  },
  {
    key: "compare",
    label: "Two up",
    blurb: "Pairs side by side, the way voting already asks you to look.",
  },
  {
    key: "bigcell",
    label: "Big cells",
    blurb: "Two columns, uncropped, actions always visible instead of on hover.",
    columns: 2,
  },
];

export function variantsFor(tab: ProtoTab): ProtoVariant[] {
  return tab === "library" ? LIBRARY_VARIANTS : REVIEW_VARIANTS;
}

/** Zoom range and starting column count, per tab (#254 Q19). */
export const ZOOM: Record<ProtoTab, { min: number; max: number; start: number }> =
  {
    library: { min: 2, max: 10, start: 5 },
    review: { min: 1, max: 6, start: 3 },
  };

/* -------------------------------------------------------------------------
 * `?proto=<library>.<review>`
 *
 * A module-level store rather than component state, because both tabs stay
 * mounted under `display: none` (ADR 0015) and the bar that writes it renders
 * inside whichever one is up. The URL is the mirror, not the source: reading
 * `location.search` per render would make every keystroke a parse.
 * ---------------------------------------------------------------------- */

interface ProtoState {
  library: string;
  review: string;
}

/** Where the choice is kept between launches, since the webview has no URL bar. */
const STORE_KEY = "walltare:proto";

function readUrl(): ProtoState | null {
  if (typeof window === "undefined") return null;
  // The query string first, for `bun run dev` in a browser where it can be
  // typed. Then storage, which is the only way in under `bun tauri dev`: the
  // Tauri window has no address bar, so `?proto=` is unreachable there and the
  // chord below is what turns this on.
  const raw =
    new URLSearchParams(window.location.search).get("proto") ??
    window.localStorage.getItem(STORE_KEY);
  if (raw === null) return null;
  const [library, review] = raw.split(".");
  const has = (list: ProtoVariant[], key: string) =>
    list.some((v) => v.key === key);
  return {
    library: has(LIBRARY_VARIANTS, library) ? library : LIBRARY_VARIANTS[0].key,
    review: has(REVIEW_VARIANTS, review ?? "") ? review : REVIEW_VARIANTS[0].key,
  };
}

let state = readUrl();
const listeners = new Set<() => void>();

/** Whether the override is on at all. Fixed for the life of the window. */
export const PROTO = state !== null;

export function setVariant(tab: ProtoTab, key: string) {
  if (!state) return;
  state = { ...state, [tab]: key };
  const pair = `${state.library}.${state.review}`;
  window.localStorage.setItem(STORE_KEY, pair);
  const url = new URL(window.location.href);
  url.searchParams.set("proto", pair);
  window.history.replaceState(null, "", url);
  for (const listener of listeners) listener();
}

/**
 * Ctrl+Shift+P turns the whole thing on and off, and reloads.
 *
 * `PROTO` is read once at module load and both views branch on it, so flipping
 * it has to be a reload rather than a re-render. That is also what makes the
 * const the right shape: nothing in either page has to handle the grid changing
 * identity underneath it.
 *
 * Registered on import, so it works whether or not the prototype is on. This is
 * the whole reason the folder is imported by both views unconditionally.
 */
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "p") {
      return;
    }
    event.preventDefault();
    if (state) window.localStorage.removeItem(STORE_KEY);
    else window.localStorage.setItem(STORE_KEY, "masonry.hero");
    const url = new URL(window.location.href);
    url.searchParams.delete("proto");
    window.history.replaceState(null, "", url);
    window.location.reload();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVariant(tab: ProtoTab): ProtoVariant {
  const key = useSyncExternalStore(
    subscribe,
    () => (state ? state[tab] : ""),
    () => "",
  );
  const list = variantsFor(tab);
  return list.find((v) => v.key === key) ?? list[0];
}

/* -------------------------------------------------------------------------
 * Ratios
 * ---------------------------------------------------------------------- */

const ratios = new Map<number, number>();
const pending = new Set<number>();
const ratioListeners = new Set<() => void>();

/**
 * Aspect ratio by wallpaper id, width over height.
 *
 * The DTO has no dimensions, so this loads the `small` thumbnail the card is
 * about to load anyway and reads `naturalWidth` off it. The browser cache means
 * the card's own `<img>` does not fetch twice. It also means this is only
 * reasonable at 120 wallpapers: the real fix is `width` and `height` on the row.
 */
export function useRatios(ids: number[]): Map<number, number> {
  const [, bump] = useState(0);

  useEffect(() => {
    const onDone = () => bump((n) => n + 1);
    ratioListeners.add(onDone);

    for (const id of ids) {
      if (ratios.has(id) || pending.has(id)) continue;
      pending.add(id);
      const img = new Image();
      img.onload = () => {
        pending.delete(id);
        if (img.naturalHeight > 0) {
          ratios.set(id, img.naturalWidth / img.naturalHeight);
          for (const listener of ratioListeners) listener();
        }
      };
      img.onerror = () => {
        pending.delete(id);
        // A wallpaper whose file is gone still needs a box to say so in.
        ratios.set(id, 16 / 9);
        for (const listener of ratioListeners) listener();
      };
      img.src = wallpaperImageUrl(id, "small");
    }

    return () => {
      ratioListeners.delete(onDone);
    };
  }, [ids]);

  return ratios;
}

/** 16:9 until the real one arrives, which is what makes this reflow. */
export function ratioOf(id: number): number {
  return ratios.get(id) ?? 16 / 9;
}
