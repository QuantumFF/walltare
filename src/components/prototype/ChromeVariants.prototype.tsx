// PROTOTYPE — throwaway. Five takes on the chrome row (brand, view tabs, gear),
// switchable with `?chrome=A..E` and the floating pill / Alt+←/→.
// Only the rendering swaps; the tablist's keyboard behaviour is the real
// `ViewTabs`, handed in as `renderTabs`.
import appIcon from "@/assets/app-icon.png";
import { Button } from "@/components/ui/button";
import { useStats } from "@/context/AppContext";
import { cn } from "@/lib/utils";
import { Settings as SettingsIcon } from "lucide-react";
import { createContext, type ReactNode } from "react";

export type TabDef = { view: string; label: string };

export type TabStyle = {
  list: string;
  tab: (selected: boolean) => string;
  label?: (tab: TabDef, index: number, selected: boolean) => ReactNode;
};

export type ChromeProps = {
  renderTabs: (style: TabStyle) => ReactNode;
  onSettings: boolean;
  toggleSettings: () => void;
};

// Round 1 was A–F; B–E stay in the code but out of the cycle. Round 2 keeps
// F's typographic cluster on top and tries page bars under it.
export const CHROME_VARIANTS = [
  { key: "A", name: "Current" },
  { key: "F1", name: "Centred, no rule" },
  { key: "F2", name: "Hanging sheet" },
  { key: "F3", name: "Raised shelf" },
  { key: "F4", name: "Title chip" },
  { key: "F5", name: "Glow" },
] as const;

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function Gear({
  onSettings,
  toggleSettings,
  className,
}: Omit<ChromeProps, "renderTabs"> & { className?: string }) {
  return (
    <Button
      variant={onSettings ? "secondary" : "ghost"}
      size="icon"
      aria-label="Settings"
      aria-current={onSettings ? "page" : undefined}
      onClick={toggleSettings}
      className={cn(!onSettings && "text-muted-foreground", className)}
    >
      <SettingsIcon aria-hidden />
    </Button>
  );
}

/** A: what ships today. Brand left, filled tabs centred, gear right. */
function VariantA({ renderTabs, ...gear }: ChromeProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="relative flex h-12 items-center px-4"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <img src={appIcon} alt="" className="h-4 w-4" />
          walltare
        </div>
        {renderTabs({
          list: "absolute left-1/2 flex -translate-x-1/2 items-center gap-1",
          tab: (selected) =>
            cn(
              "h-8 rounded-md px-3 text-sm transition-colors",
              FOCUS,
              selected
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            ),
        })}
        <Gear {...gear} className="ml-auto" />
      </div>
    </header>
  );
}

/**
 * B: everything in one floating pill in the middle — icon, tabs, gear. No
 * wordmark; the rest of the row is bare title bar to drag by.
 */
function VariantB({ renderTabs, ...gear }: ChromeProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="flex h-12 items-center justify-center px-4"
      >
        <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/80 p-1 shadow-sm backdrop-blur">
          <img
            src={appIcon}
            alt="walltare"
            className="mr-1 ml-2 size-4"
            data-tauri-drag-region
          />
          {renderTabs({
            list: "flex items-center gap-0.5",
            tab: (selected) =>
              cn(
                "h-7 rounded-full px-3.5 text-[13px] transition-colors",
                FOCUS,
                selected
                  ? "bg-foreground font-medium text-background"
                  : "text-muted-foreground hover:text-foreground",
              ),
          })}
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Gear {...gear} className="size-7 rounded-full" />
        </div>
      </div>
    </header>
  );
}

/**
 * C: brand and tabs together on the left as one nav, an accent underline on the
 * bottom edge for the current view, and the Ctrl shortcut shown faintly.
 */
function VariantC({ renderTabs, ...gear }: ChromeProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="flex h-12 items-stretch gap-8 px-4"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <img src={appIcon} alt="" className="h-4 w-4" />
          walltare
        </div>
        {renderTabs({
          list: "flex items-stretch gap-6",
          tab: (selected) =>
            cn(
              "group relative flex items-center text-sm transition-colors",
              FOCUS,
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
              selected
                ? "font-medium text-foreground after:bg-emerald-500"
                : "text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border",
            ),
          label: (tab, index) => (
            <>
              {tab.label}
              <kbd className="ml-1.5 font-sans text-[10px] text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70">
                ⌃{index + 1}
              </kbd>
            </>
          ),
        })}
        <div className="ml-auto flex items-center">
          <Gear {...gear} />
        </div>
      </div>
    </header>
  );
}

/**
 * D: the segmented track the page bars already use, with each view's live
 * count riding on its tab — how much is left to do there, readable from any
 * view.
 */
function VariantD({ renderTabs, ...gear }: ChromeProps) {
  const stats = useStats();
  const counts: Record<string, { n: number; title: string } | undefined> =
    stats
      ? {
          rank: { n: stats.undecided_count, title: "Undecided" },
          review: { n: stats.decided_below_count, title: "Decided below the Bar" },
          library: { n: stats.total_wallpapers, title: "Wallpapers" },
        }
      : {};

  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="relative flex h-12 items-center px-4"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <img src={appIcon} alt="" className="h-4 w-4" />
          walltare
        </div>
        {renderTabs({
          list: "absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-muted p-0.5",
          tab: (selected) =>
            cn(
              "flex h-7 items-center rounded-md px-3 text-sm transition-colors",
              FOCUS,
              selected
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ),
          label: (tab, _index, selected) => {
            const count = counts[tab.view];
            return (
              <>
                {tab.label}
                {count && (
                  <span
                    title={count.title}
                    className={cn(
                      "ml-2 rounded-full px-1.5 text-[11px] leading-4 tabular-nums",
                      selected
                        ? "bg-secondary text-foreground"
                        : "bg-background/60 text-muted-foreground",
                    )}
                  >
                    {count.n}
                  </span>
                )}
              </>
            );
          },
        })}
        <Gear {...gear} className="ml-auto" />
      </div>
    </header>
  );
}

/**
 * E: no pills, no fills — the view names are the type. Larger and bolder, the
 * current one at full strength and the rest faded. The wordmark steps back to a
 * whisper beside the gear.
 */
function VariantE({ renderTabs, ...gear }: ChromeProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="flex h-12 items-center gap-4 px-4"
      >
        <img
          src={appIcon}
          alt="walltare"
          className="size-5"
          data-tauri-drag-region
        />
        {renderTabs({
          list: "flex items-baseline gap-5",
          tab: (selected) =>
            cn(
              "rounded-sm text-[17px] font-semibold tracking-tight transition-colors",
              FOCUS,
              selected
                ? "text-foreground"
                : "text-muted-foreground/45 hover:text-muted-foreground",
            ),
        })}
        <div className="ml-auto flex items-center gap-2">
          <span
            data-tauri-drag-region
            className="text-xs tracking-tight text-muted-foreground/60"
          >
            walltare
          </span>
          <Gear {...gear} />
        </div>
      </div>
    </header>
  );
}

/**
 * F: B's placement, E's type. Icon, tabs and gear gathered in the middle as one
 * cluster, but nothing boxes them in — no pill, no fill, no shadow. The view
 * names are the type, at E's size, and the gear sits behind a hairline.
 */
function VariantF({ renderTabs, ...gear }: ChromeProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        data-tauri-drag-region
        className="flex h-12 items-center justify-center px-4"
      >
        <div className="flex items-center gap-5">
          <img
            src={appIcon}
            alt="walltare"
            className="size-5"
            data-tauri-drag-region
          />
          {renderTabs({
            list: "flex items-baseline gap-5",
            tab: (selected) =>
              cn(
                "rounded-sm text-[17px] font-semibold tracking-tight transition-colors",
                FOCUS,
                selected
                  ? "text-foreground"
                  : "text-muted-foreground/45 hover:text-muted-foreground",
              ),
          })}
          <div className="h-4 w-px bg-border" />
          <Gear {...gear} className="-ml-2" />
        </div>
      </div>
    </header>
  );
}

export function ChromeVariant({
  variant,
  ...props
}: ChromeProps & { variant: string }) {
  switch (variant) {
    case "B":
      return <VariantB {...props} />;
    case "C":
      return <VariantC {...props} />;
    case "D":
      return <VariantD {...props} />;
    case "E":
      return <VariantE {...props} />;
    case "F":
    case "F1":
    case "F2":
    case "F3":
    case "F4":
    case "F5":
      return <VariantF {...props} />;
    default:
      return <VariantA {...props} />;
  }
}

/** Which variant is up; read by `PageBar` so the row under the chrome follows. */
export const ChromeVariantContext = createContext("A");

// The page bar's children belong to each page (Rank's headline, Review's
// sentence, Library's filters), so a variant restyles them from outside:
// the title is the bar's first `span`/`h1`, and the controls are
// `segmented-group`s and `button`s.
const PAGE_BAR: Record<string, string> = {
  A: "h-11 gap-3 border-b border-border/60 px-4",

  // B: the bar floats too — an inset rounded strip, every control a pill.
  B: cn(
    "mx-3 mt-0.5 mb-2 h-10 gap-3 rounded-full border border-border/70 bg-card/60 px-4 shadow-sm",
    "[&_button]:rounded-full [&_[data-slot=segmented-group]]:rounded-full",
  ),

  // C: chrome and bar read as one header. The bar is a tinted band whose top
  // rule the chrome's underline sits on, like a tab on its folder; the
  // segmented controls drop their track and mark the choice the same way the
  // tabs do, in the accent.
  C: cn(
    "h-10 gap-4 border-y border-border/60 bg-muted/30 px-4",
    "[&_[data-slot=segmented-group]]:bg-transparent dark:[&_[data-slot=segmented-group]]:bg-transparent",
    "[&_[aria-pressed=true]]:bg-transparent [&_[aria-pressed=true]]:text-emerald-500 [&_[aria-pressed=true]]:shadow-none dark:[&_[aria-pressed=true]]:bg-transparent",
  ),

  // D: a toolbar. No rule, a faint fill, and the page's title shrunk to a
  // small-caps label so the controls carry the row (the counts are up in the
  // tabs now).
  D: cn(
    "h-10 gap-4 bg-muted/40 px-4 text-[13px]",
    "[&>h1:first-child]:text-[11px] [&>h1:first-child]:font-semibold [&>h1:first-child]:tracking-wider [&>h1:first-child]:text-muted-foreground [&>h1:first-child]:uppercase",
    "[&>span:first-child]:text-[11px] [&>span:first-child]:font-semibold [&>span:first-child]:tracking-wider [&>span:first-child]:text-muted-foreground [&>span:first-child]:uppercase",
  ),

  // E: the title is a heading. Taller bar, no box, no fill — the page's title
  // set large under the nav words, controls quietened to ghosts, and a rule
  // that fades out to the right instead of a hard line.
  E: cn(
    "relative h-14 gap-4 px-4",
    "after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-gradient-to-r after:from-border after:to-transparent",
    "[&>h1:first-child]:text-xl [&>h1:first-child]:font-semibold [&>h1:first-child]:tracking-tight",
    "[&>span:first-child]:text-xl [&>span:first-child]:font-semibold [&>span:first-child]:tracking-tight",
    "[&_[data-slot=segmented-group]]:bg-transparent dark:[&_[data-slot=segmented-group]]:bg-transparent",
    "[&_[data-slot=button]]:border-transparent [&_[data-slot=button]]:shadow-none",
  ),

  // F: D's toolbar under the typographic cluster.
  get F() {
    return this.D;
  },

  // F1: the bar follows the cluster into the middle. Title, controls and
  // counts centred on one line under the tabs, nothing separating it from the
  // page but space.
  F1: cn(
    "h-12 justify-center gap-5 px-4",
    "[&>.ml-auto]:ml-0 [&>.flex-1]:flex-none",
    "[&>h1:first-child]:text-base [&>h1:first-child]:font-semibold [&>h1:first-child]:tracking-tight",
    "[&>span:first-child]:text-base [&>span:first-child]:font-semibold [&>span:first-child]:tracking-tight",
  ),

  // F2: a sheet hanging from the chrome — inset, its own surface, rounded only
  // at the bottom, as if pulled down from under the tabs.
  F2: cn(
    "mx-4 h-11 gap-4 rounded-b-2xl border-x border-b border-border/60 bg-card px-4 shadow-sm",
    "[&>h1:first-child]:font-semibold [&>span:first-child]:font-semibold",
  ),

  // F3: a solid shelf that casts a shadow down onto the page instead of
  // drawing a line on it. Title at heading size.
  F3: cn(
    "relative z-10 h-12 gap-4 bg-muted/70 px-4 shadow-[0_8px_16px_-10px_rgb(0_0_0/0.6)] dark:bg-muted/40",
    "[&>h1:first-child]:text-lg [&>h1:first-child]:font-semibold [&>h1:first-child]:tracking-tight",
    "[&>span:first-child]:text-lg [&>span:first-child]:font-semibold [&>span:first-child]:tracking-tight",
  ),

  // F4: no bar at all. The title sits in a chip of its own and the controls
  // float beside it as pills, straight over the page.
  F4: cn(
    "h-12 gap-3 px-4",
    "[&>h1:first-child]:rounded-full [&>h1:first-child]:bg-muted [&>h1:first-child]:px-3.5 [&>h1:first-child]:py-1 [&>h1:first-child]:font-semibold",
    "[&>span:first-child]:rounded-full [&>span:first-child]:bg-muted [&>span:first-child]:px-3.5 [&>span:first-child]:py-1 [&>span:first-child]:font-semibold",
    "[&_button]:rounded-full [&_[data-slot=segmented-group]]:rounded-full",
  ),

  // F5: the edge is light, not a line — a soft wash under the chrome that fades
  // into the page.
  F5: cn(
    "h-12 gap-4 bg-gradient-to-b from-muted/70 to-transparent px-4",
    "[&>h1:first-child]:text-base [&>h1:first-child]:font-semibold [&>h1:first-child]:tracking-tight",
    "[&>span:first-child]:text-base [&>span:first-child]:font-semibold [&>span:first-child]:tracking-tight",
  ),
};

export function pageBarClass(variant: string) {
  return cn(
    "flex shrink-0 items-center text-sm",
    PAGE_BAR[variant] ?? PAGE_BAR.A,
  );
}
