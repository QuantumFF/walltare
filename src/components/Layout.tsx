import { LibraryView } from "@/components/LibraryView";
import { RankView } from "@/components/RankView";
import { ReviewView } from "@/components/ReviewView";
import { SettingsView } from "@/components/SettingsView";
import { useApp, type View } from "@/context/AppContext";
import { LightboxHostProvider } from "@/context/LightboxHostContext";
import { cn } from "@/lib/utils";
import { Images, Settings as SettingsIcon } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * The three destinations that are tabs, in tab order — and the three the shell
 * keeps mounted.
 *
 * Each mounts on first visit and hides with `display: none` from then on, so
 * data, DOM, scroll position and the browser's image work all survive a switch.
 * That is the point of the whole shell: `wallpaper://` answers
 * `max-age=0, must-revalidate` with no validator, so remounting Review is fifty
 * complete IPC round trips and fifty cache-file reads — the ~25 dropped frames
 * ADR 0006 measured, paid again on every glance at Library and back. `get_review`
 * itself costs 0.3ms, which is why what is worth carrying across a switch is
 * rendered DOM and fetched images rather than JSON.
 *
 * Rank earns it twice, because its prefetched pair is state rather than pixels
 * and a remount throws the pair away.
 *
 * Settings is deliberately not in here. It is a peer view that unmounts, so its
 * fields re-read the store instead of holding a stale copy (ADR 0015).
 */
const TABS = [
  { view: "rank", label: "Rank" },
  { view: "review", label: "Review" },
  { view: "library", label: "Library" },
] as const;

type TabView = (typeof TABS)[number]["view"];

function isTabView(view: View): view is TabView {
  return TABS.some((tab) => tab.view === view);
}

function viewBody(view: TabView): ReactNode {
  switch (view) {
    case "rank":
      return <RankView />;
    case "review":
      return <ReviewView />;
    case "library":
      return <LibraryView />;
  }
}

/**
 * The tab group: an ARIA tablist with a roving tabindex.
 *
 * There are no `tabpanel`s to point `aria-controls` at. Two of the three panels
 * may not be in the tree yet — a view enters it on first visit — and Settings is
 * a peer view that is not a tab at all, so the panel relationship would be a
 * half-truth in both directions. Each view names itself with its own heading
 * instead.
 */
function ViewTabs() {
  const { view, setView } = useApp();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = TABS.findIndex((tab) => tab.view === view);

  // Roving tabindex: one Tab stop for the group, and the arrows move inside it.
  // With Settings up nothing is selected, so the first tab holds the stop —
  // a group where every tab is `tabIndex={-1}` cannot be reached by keyboard at
  // all, which is the one state this pattern must never produce.
  const stop = selected === -1 ? 0 : selected;

  const select = (index: number) => {
    tabs.current[index]?.focus();
    setView(TABS[index].view);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = TABS.length - 1;
    let next: number;
    if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;

    // The arrow is answered here, and saying so is load-bearing. Rank stays
    // mounted under `display: none` with its vote listener live on `window`, so
    // an arrow that walked the tab bar and then reached that listener would
    // record a permanent Comparison the curator never asked for. `RankView`
    // stands down on `defaultPrevented`, which is ADR 0015's rule as amended:
    // bare arrows belong to whatever has focus, and to the view only when
    // nothing in it does.
    event.preventDefault();
    select(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Views"
      className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1"
    >
      {TABS.map((tab, index) => (
        <button
          key={tab.view}
          ref={(node) => {
            tabs.current[index] = node;
          }}
          type="button"
          role="tab"
          aria-selected={view === tab.view}
          tabIndex={index === stop ? 0 : -1}
          onClick={() => setView(tab.view)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            "relative h-12 px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            view === tab.view
              ? // The chrome's own bottom edge is the indicator. Navigation
                // should not assert itself as hard as a primary button does, so
                // the active tab is underlined rather than inverted (#44).
                "font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Brand left, tabs centred, gear right, and the same height on every view. */
function Chrome() {
  const { view, returnTo, setView } = useApp();
  const onSettings = view === "settings";

  const toggleSettings = () => {
    if (!onSettings) {
      // Recording where the curator was is what makes Settings a stop rather
      // than a detour: it closes back to here.
      setView("settings", { returnTo: view });
      return;
    }
    // The gear is the way back out as well as in. With no `returnTo` — boot
    // landed the curator here — there is nowhere to go and the tabs are the
    // exit (ADR 0020). Escape is the Settings page's own, and #77 owns it.
    if (returnTo) setView(returnTo);
  };

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/95 backdrop-blur">
      <div
        data-slot="chrome-row"
        className="relative flex h-12 items-center px-4"
      >
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Images className="h-4 w-4" aria-hidden />
          walltare
        </div>

        <ViewTabs />

        <button
          type="button"
          aria-label="Settings"
          // Not a tab, so it cannot be `aria-selected`. While Settings is up no
          // tab is underlined and the gear carries the active treatment
          // instead, and this is that state spelled out for a screen reader.
          aria-current={onSettings ? "page" : undefined}
          onClick={toggleSettings}
          className={cn(
            "ml-auto rounded-md p-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            onSettings ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
        >
          <SettingsIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}

export function Layout() {
  const { view } = useApp();

  // Which destinations have ever been shown. A view enters the tree on its first
  // visit and never leaves it, so this only ever grows.
  const [visited, setVisited] = useState<ReadonlySet<TabView>>(
    () => new Set(isTabView(view) ? [view] : []),
  );
  if (isTabView(view) && !visited.has(view)) {
    // Set during render rather than from an effect. An effect would commit one
    // frame with the destination missing from the tree, which is a blank flash
    // on exactly the switch this shell exists to make free; React re-renders
    // immediately and throws this pass away instead.
    setVisited(new Set(visited).add(view));
  }

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxContainer, setLightboxContainer] = useState<HTMLElement | null>(
    null,
  );
  const lightboxHost = useMemo(
    () => ({ container: lightboxContainer, setOpen: setLightboxOpen }),
    [lightboxContainer],
  );

  return (
    <div className="flex h-screen flex-col bg-background font-sans text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
      {/* The stacking order, and the document order that goes with it. Reading
          down the file is reading up the z-axis: the views at the bottom, the
          chrome over them at z-30, the lightbox's portal node at z-50, and the
          toast viewport last of all at z-60 (#112). Radix does not portal that
          viewport and the lightbox backdrop is opaque, so a toast mounted here
          without the top z-index is a toast nobody can see during the exact
          flow it exists for — a file that just moved (ADR 0017, ADR 0022). */}
      <Chrome />

      <LightboxHostProvider value={lightboxHost}>
        {/* `inert` while a lightbox is up, which is what makes ADR 0022's
            non-modal dialog contain itself: nothing behind it takes focus or a
            click, and no focus trap can steal the toast's focus back. */}
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          inert={lightboxOpen}
        >
          {TABS.map(({ view: tabView }) => {
            if (!visited.has(tabView)) return null;
            const hidden = view !== tabView;
            return (
              <div
                key={tabView}
                data-slot="view"
                data-view={tabView}
                // `display: none` inline rather than as a class, because it has
                // to win against the `flex` this container needs when it is the
                // one showing. Hiding rather than unmounting is the whole
                // bargain: the DOM, the scroll position and every fetched image
                // stay exactly as the curator left them.
                style={hidden ? { display: "none" } : undefined}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                {viewBody(tabView)}
              </div>
            );
          })}

          {view === "settings" && (
            <div
              data-slot="view"
              data-view="settings"
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              <SettingsView />
            </div>
          )}
        </div>
      </LightboxHostProvider>

      {/* The lightbox's pixels, above the pages and below the toast. Empty until
          #80 portals into it. */}
      <div
        data-slot="lightbox-host"
        ref={setLightboxContainer}
        className="relative z-50"
      />

      {/* #112 mounts the toast viewport here, as the last child of this root. */}
    </div>
  );
}
