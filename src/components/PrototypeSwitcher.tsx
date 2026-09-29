// PROTOTYPE (#389), throwaway: lives only on prototype/showing-of-four.
//
// Floating variant switcher. `[` and `]` cycle rather than the arrow keys the
// skill suggests, because Rank already answers the arrows. The variant is kept
// in `?variant=` so a reload stays on it.
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next.key);
    window.history.replaceState(null, "", url);
    onChange(next.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "[") go(-1);
      else if (e.key === "]") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white shadow-xl">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ‹ [
      </button>
      <span>
        {v.key} ({v.name})
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        ] ›
      </button>
    </div>
  );
}

export function initialVariant(keys: string[]): string {
  const v = new URLSearchParams(window.location.search).get("variant");
  return v && keys.includes(v) ? v : keys[0];
}
