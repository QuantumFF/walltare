// PROTOTYPE — throwaway. Floating variant switcher for UI prototypes.
// Delete with the prototype; the winning variant gets rewritten properly.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/** The variant key in `?<param>=`, kept in the URL so a reload keeps it. */
export function usePrototypeVariant(param: string, keys: readonly string[]) {
  const read = () => {
    const value = new URLSearchParams(window.location.search).get(param);
    return value && keys.includes(value) ? value : keys[0];
  };
  const [variant, setVariantState] = useState(read);

  const setVariant = useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set(param, next);
      window.history.replaceState(window.history.state, "", url);
      setVariantState(next);
    },
    [param],
  );

  return [variant, setVariant] as const;
}

/**
 * Bottom-centre pill: ‹ key (name) ›.
 *
 * Alt+←/→ rather than bare arrows, because Rank votes with the bare arrows and
 * a stray vote is a permanent Comparison. Caught in the capture phase on
 * `window` and stopped there, so nothing in the app ever hears it.
 */
export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: ReadonlyArray<{ key: string; name: string }>;
  current: string;
  onChange: (key: string) => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const step = useCallback(
    (by: 1 | -1) =>
      onChange(variants[(index + by + variants.length) % variants.length].key),
    [index, onChange, variants],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [step]);

  if (!import.meta.env.DEV) return null;

  const { key, name } = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-1.5 py-1 text-xs font-medium text-white shadow-lg ring-2 ring-white/40">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => step(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-40 text-center tabular-nums">
        {key} ({name}) · {index + 1}/{variants.length}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => step(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
