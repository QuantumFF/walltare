// PROTOTYPE ONLY. Throwaway code for issue #44. Do not build on this.
//
// The switcher, the URL state it reads, and the two hooks all three variants
// share. Nothing here is a layout: each variant owns its own shell, grid and
// lightbox, which is the whole point of running three.

import { useCallback, useEffect, useState } from "react";

export const VARIANTS = ["A", "B", "C"] as const;
export type VariantKey = (typeof VARIANTS)[number];

export const VARIANT_NAMES: Record<VariantKey, string> = {
  A: "Toolbar",
  B: "Inspector",
  C: "List",
};

export const PAGES = ["rank", "review", "library", "settings"] as const;
export type Page = (typeof PAGES)[number];

export const DATA_STATES = ["ready", "loading", "empty"] as const;
export type DataState = (typeof DATA_STATES)[number];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Housings for the tab group in the middle of variant A's chrome.
 *
 * Settled: `underline` won. The other four stay switchable because the branch
 * is throwaway and they cost one dropdown, but they are no longer the question.
 */
export const HEADERS = ["underline", "segmented", "island", "boxed", "sliding"] as const;
export type Header = (typeof HEADERS)[number];

export const HEADER_NAMES: Record<Header, string> = {
  underline: "bare tabs, active underlined (chosen)",
  segmented: "inset segmented control",
  island: "floating island",
  boxed: "outlined boxes",
  sliding: "one pill, sliding indicator",
};

/**
 * Housings for Keep / Reject / Restore inside variant A's lightbox. The live
 * question: where those buttons sit while a wallpaper is being previewed, and
 * what contains them.
 */
export const ACTIONS = ["bar", "top", "dock", "rail", "inline"] as const;
export type ActionHousing = (typeof ACTIONS)[number];

export const ACTION_NAMES: Record<ActionHousing, string> = {
  bar: "right end of the bottom caption bar",
  top: "centred in a top bar",
  dock: "floating dock over the image",
  rail: "vertical rail on the right edge",
  inline: "under the image, at the image's width",
};

interface ProtoState {
  variant: VariantKey;
  page: Page;
  data: DataState;
  theme: Theme;
  header: Header;
  actions: ActionHousing;
  /** Index into the current list to open the lightbox on, so it is linkable. */
  open: number | null;
}

function read(): ProtoState {
  const q = new URLSearchParams(window.location.search);
  const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = q.get(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  };
  const open = Number(q.get("open"));
  return {
    variant: one("variant", VARIANTS, "A"),
    page: one("page", PAGES, "library"),
    data: one("state", DATA_STATES, "ready"),
    theme: one("theme", THEMES, "dark"),
    header: one("header", HEADERS, "underline"),
    actions: one("actions", ACTIONS, "bar"),
    open: q.has("open") && Number.isInteger(open) && open >= 0 ? open : null,
  };
}

/** URL-backed so a variant is shareable and survives a reload. */
export function useProtoState() {
  const [state, setState] = useState(read);

  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", state.theme === "dark");
  }, [state.theme]);

  const patch = useCallback((next: Partial<ProtoState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next };
      const q = new URLSearchParams({
        variant: merged.variant,
        page: merged.page,
        state: merged.data,
        theme: merged.theme,
        header: merged.header,
        actions: merged.actions,
      });
      if (merged.open !== null) q.set("open", String(merged.open));
      window.history.replaceState(null, "", `?${q}`);
      return merged;
    });
  }, []);

  return [state, patch] as const;
}

/**
 * Keyboard for a lightbox. Shared because all three variants claim the same
 * keys, and disagreeing about them by accident would be noise in the reaction.
 */
export function useLightboxKeys(
  open: boolean,
  handlers: { onPrev: () => void; onNext: () => void; onClose: () => void },
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") handlers.onPrev();
      else if (event.key === "ArrowRight") handlers.onNext();
      else if (event.key === "Escape") handlers.onClose();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handlers]);
}

/**
 * A toast, so the reaction can judge the surface ADR 0009 specifies: eight
 * seconds, newest replaces the previous rather than stacking.
 */
export function useToast() {
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(
    null,
  );

  const show = useCallback((message: string, undo?: () => void) => {
    setToast({ message, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, show, dismiss: () => setToast(null) };
}

const SELECT_CLASS =
  "bg-white/10 text-white text-xs rounded-md px-2 py-1 border border-white/20 focus:outline-none focus:ring-1 focus:ring-white/60";

/**
 * The switcher. Deliberately ugly and high-contrast so nobody mistakes it for
 * part of the design being judged.
 *
 * Variant cycling is Alt+←/→, not bare arrows: the lightbox under test claims
 * ← and → for navigation, and stealing them would break the thing being
 * evaluated.
 */
export function PrototypeBar({
  state,
  patch,
}: {
  state: ProtoState;
  patch: (next: Partial<ProtoState>) => void;
}) {
  // `?bar=off` starts hidden, for a screenshot or a clean first look.
  const [hidden, setHidden] = useState(
    () => new URLSearchParams(window.location.search).get("bar") === "off",
  );

  const step = useCallback(
    (delta: number) => {
      const index = VARIANTS.indexOf(state.variant);
      patch({ variant: VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length] });
    },
    [state.variant, patch],
  );

  // Alt+↑/↓ drives whichever axis is live. That is the action housing now; the
  // tab housing is settled and keeps only its dropdown.
  const stepActions = useCallback(
    (delta: number) => {
      const index = ACTIONS.indexOf(state.actions);
      patch({ actions: ACTIONS[(index + delta + ACTIONS.length) % ACTIONS.length] });
    },
    [state.actions, patch],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable]")) return;
      // `h` hides the bar: it sits over variant A's caption bar, and the
      // harness must not be what you judge the caption bar through.
      if (!event.altKey && event.key === "h") {
        setHidden((v) => !v);
        return;
      }
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowUp") stepActions(-1);
      else if (event.key === "ArrowDown") stepActions(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, stepActions]);

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="fixed bottom-0 left-1/2 z-[100] -translate-x-1/2 rounded-t-md bg-neutral-900 px-3 py-0.5 font-mono text-[10px] text-white/70 ring-1 ring-white/20"
      >
        {state.variant} · h
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-neutral-900 px-3 py-2 font-mono text-xs text-white shadow-2xl ring-1 ring-white/20">
      <button
        onClick={() => step(-1)}
        className="rounded px-2 py-1 hover:bg-white/15"
        aria-label="Previous variant"
      >
        ←
      </button>
      <span className="w-32 text-center font-semibold tabular-nums">
        {state.variant} ({VARIANT_NAMES[state.variant]})
      </span>
      <button
        onClick={() => step(1)}
        className="rounded px-2 py-1 hover:bg-white/15"
        aria-label="Next variant"
      >
        →
      </button>

      <span className="mx-1 h-4 w-px bg-white/25" />

      {state.variant === "A" && (
        <>
          <label className="flex items-center gap-1">
            <span className="opacity-60">actions</span>
            <select
              value={state.actions}
              onChange={(e) => patch({ actions: e.target.value as ActionHousing })}
              className={`${SELECT_CLASS} ring-1 ring-amber-300/60`}
            >
              {ACTIONS.map((housing) => (
                <option key={housing} value={housing} className="text-black">
                  {housing} — {ACTION_NAMES[housing]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1">
            <span className="opacity-60">tabs</span>
            <select
              value={state.header}
              onChange={(e) => patch({ header: e.target.value as Header })}
              className={SELECT_CLASS}
            >
              {HEADERS.map((header) => (
                <option key={header} value={header} className="text-black">
                  {header} — {HEADER_NAMES[header]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <label className="flex items-center gap-1">
        <span className="opacity-60">page</span>
        <select
          value={state.page}
          onChange={(e) => patch({ page: e.target.value as Page })}
          className={SELECT_CLASS}
        >
          {PAGES.map((page) => (
            <option key={page} value={page} className="text-black">
              {page}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1">
        <span className="opacity-60">state</span>
        <select
          value={state.data}
          onChange={(e) => patch({ data: e.target.value as DataState })}
          className={SELECT_CLASS}
        >
          {DATA_STATES.map((data) => (
            <option key={data} value={data} className="text-black">
              {data}
            </option>
          ))}
        </select>
      </label>

      <button
        onClick={() => patch({ theme: state.theme === "dark" ? "light" : "dark" })}
        className="rounded-md border border-white/20 bg-white/10 px-2 py-1 hover:bg-white/20"
      >
        {state.theme}
      </button>

      <button
        onClick={() => setHidden(true)}
        className="rounded px-1.5 py-1 opacity-50 hover:bg-white/15 hover:opacity-100"
        title="Hide the bar (h)"
      >
        h
      </button>

      <span className="ml-0.5 opacity-40">
        alt+←/→{state.variant === "A" ? " ↑/↓" : ""}
      </span>
    </div>
  );
}
