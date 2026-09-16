/** PROTOTYPE (#254) — throwaway. The switcher, fixed to the bottom of the window. */
import {
  LIBRARY_VARIANTS,
  REVIEW_VARIANTS,
  type ProtoTab,
  setVariant,
  useVariant,
} from "@/components/prototype/proto";
import { cn } from "@/lib/utils";

function Row({ tab }: { tab: ProtoTab }) {
  const active = useVariant(tab);
  const list = tab === "library" ? LIBRARY_VARIANTS : REVIEW_VARIANTS;

  return (
    <div className="flex items-center gap-1">
      <span className="w-14 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
        {tab}
      </span>
      {list.map((variant) => (
        <button
          key={variant.key}
          type="button"
          onClick={() => setVariant(tab, variant.key)}
          title={variant.blurb}
          className={cn(
            "rounded-md px-2 py-1 text-xs transition-colors",
            variant.key === active.key
              ? "bg-secondary font-medium text-foreground"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
          )}
        >
          {variant.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Both rows, always, whichever tab is up.
 *
 * Seeing the other tab's choice from here is the point: the question is whether
 * one idea can do both jobs, and a switcher that only showed the current tab
 * would hide half of the answer.
 */
export function ProtoBar({ tab }: { tab: ProtoTab }) {
  const active = useVariant(tab);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-4">
      <div className="pointer-events-auto flex flex-col gap-1.5 rounded-xl border border-border bg-background/90 px-3 py-2.5 shadow-lg backdrop-blur-md">
        <Row tab="library" />
        <Row tab="review" />
        <p className="max-w-[28rem] px-1 text-[11px] leading-snug text-muted-foreground">
          {active.blurb} Ctrl+wheel or +/- to zoom, Ctrl+Shift+P to leave the
          prototype. Nothing here writes, so Keep and Reject only hide a card
          until you refresh.
        </p>
      </div>
    </div>
  );
}
