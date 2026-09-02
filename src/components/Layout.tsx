import { LibraryView } from "@/components/LibraryView";
import { RankView } from "@/components/RankView";
import { ReviewView } from "@/components/ReviewView";
import { SettingsView } from "@/components/SettingsView";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { ToastSurface, useToaster } from "@/components/ToastSurface";
import { useApp, type View } from "@/context/AppContext";
import { useAppEvents } from "@/context/AppEventsContext";
import { LightboxHostProvider } from "@/context/LightboxHostContext";
import { client } from "@/lib/client";
import { cn } from "@/lib/utils";
import { Images, Settings as SettingsIcon } from "lucide-react";
import {
  useEffect,
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
    // exit (ADR 0020). Escape does the same thing from the page's own handler,
    // which is where it has to be to answer from inside a text field.
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

/**
 * The destination behind each `Ctrl` shortcut.
 *
 * `Ctrl` rather than a bare digit because bare keys are spoken for: Rank votes
 * with the arrows, ADR 0022's lightbox walks with them and rejects with `Delete`,
 * and a single-key navigation would fire from any of that (ADR 0015).
 */
const NAVIGATION_KEYS: Record<string, View> = {
  "1": "rank",
  "2": "review",
  "3": "library",
  ",": "settings",
};

/**
 * `<input>` types that hold no text. A keystroke on a checkbox or a slider is a
 * command rather than a character, so those are not the curator typing.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether a keystroke landed somewhere the curator is entering text. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
}

/**
 * Everything the shell renders, inside the toast surface that wraps it.
 *
 * Split from `Layout` for one reason: the keyboard handler below binds `Ctrl+Z`
 * to the visible toast's Undo, so it has to sit under the provider that holds
 * the slot. One handler for the whole app is the rule (ADR 0015), and the way to
 * keep it one is for it to be inside.
 */
function Shell({
  lightboxOpen,
  setLightboxOpen,
}: {
  lightboxOpen: boolean;
  setLightboxOpen: (open: boolean) => void;
}) {
  const { view, setView, readLibraryAfterScan } = useApp();
  const { publish } = useAppEvents();
  const { pressUndo } = useToaster();

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

  const [lightboxContainer, setLightboxContainer] = useState<HTMLElement | null>(
    null,
  );
  const lightboxHost = useMemo(
    () => ({ container: lightboxContainer, setOpen: setLightboxOpen }),
    [lightboxContainer, setLightboxOpen],
  );

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // The scan subscription, above the view swap.
  //
  // It cannot live in the page that starts the scan. A scan now starts from
  // inside Settings, Settings is the one view the shell unmounts, and a walk of
  // a large folder takes minutes — so by the time `scan-complete` arrives the
  // component that asked for it is usually gone, and the curator is somewhere
  // else entirely. That is also why the event no longer navigates: it used to
  // pull them to Rank from whatever they were doing, on every rescan.
  //
  // Three things hang off it here, and they are what a scan *does* rather than
  // what it says: the pre-generation restart, the freshness event, and the
  // re-read of what the library now holds, which carries the boot rule's one
  // rerun with it. ADR 0021's report of the same event — the progress line,
  // the four endings, and the `Stats` refetch that says whether the Round moved
  // backwards — is `ToastSurface`'s, so that every word the app puts in a toast
  // is written in one file.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // The frontend owns the trigger for pre-generation, the way it already owns
    // the scan: spawning the pass from Tauri's `setup()` would start decoding
    // before the window paints, competing with WebKit for the first frame
    // (ADR 0012). Mounting is the gate — `AppProvider` renders nothing until
    // both boot reads have settled — so this runs after the boot rule has
    // picked a view, and again after every scan, which is what gets freshly
    // scanned files warmed first.
    //
    // A pass that will not start leaves the cache cold and nothing else: the
    // views it warms for all still generate on demand, so this is logged the
    // way a failed boot read is and the app carries on.
    const startPregen = () => {
      void client.startPregen().catch((error: unknown) => {
        console.error("Failed to start thumbnail pre-generation:", error);
      });
    };

    startPregen();
    void client
      .onScanComplete((payload) => {
        startPregen();
        // A scan is the one mutation that changes which rows exist, so this is
        // the one event of the four that a mounted view answers with a fetch
        // rather than with a patch. The count rides along because zero of it is
        // the answer "nothing changed": a scan inserts and never deletes.
        publish({ type: "library-scanned", added: payload.added_count });
        // The count the Library root section prints, and the boot rule's one
        // exception — the only navigation left on this event. It decides for
        // itself whether this scan is the one that filled an empty library.
        readLibraryAfterScan();
      })
      .then((off) => {
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [publish, readLibraryAfterScan]);

  // One keyboard handler for the whole app, on `window` because the shell is
  // always mounted and there is exactly one of it — the view-scoped gate
  // ADR 0019 owes every other global listener does not apply here.
  //
  // Suppressed while the caret is in a text field and at no other time. That is
  // the whole of it: `Ctrl+,` is a character a curator can be typing (a path
  // may hold a comma) and `?` certainly is, so a shortcut firing mid-typing
  // navigates away from a half-entered folder. ADR 0022 deleted the other half
  // of the old rule — the lightbox no longer suppresses this handler, because
  // doing so disabled `Ctrl+Z` in the one place a reject fires from and hid the
  // shortcut list where it is most wanted. The one binding that looks dangerous,
  // `Ctrl+2` swapping the view under an open lightbox, is answered by the rule
  // that changing destination closes the lightbox, which `useLightbox` holds.
  //
  // Bare arrows are deliberately absent. They belong to whichever element has
  // focus — the tablist above walks with them — and to the view when nothing in
  // it does, which is how Rank votes with them (ADR 0015, as amended).
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTextEntry(event.target)) return;

      if (
        event.key === "?" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      // A shortcut for the button on screen, not an undo stack. With no toast
      // up, or one that offers no Undo, it does nothing — and that is the honest
      // behaviour rather than a gap: CONTEXT.md says Comparisons are never
      // deleted, so there is no vote for a general `Ctrl+Z` to take back
      // (ADR 0017). Nothing native is being suppressed, because this whole
      // handler is already off while the caret is in a field.
      if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        pressUndo();
        return;
      }

      const destination = NAVIGATION_KEYS[event.key];
      if (!destination) return;
      event.preventDefault();

      if (destination !== "settings") {
        setView(destination);
        return;
      }
      // The same bargain the gear strikes: Settings is a page with no back of
      // its own, so the shortcut records where the curator was. Pressed while
      // Settings is already up it does nothing — the gear, Escape and the back
      // control are the ways out, and a second `Ctrl+,` closing the page would
      // make the binding mean two things.
      if (view !== "settings") setView("settings", { returnTo: view });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setView, view]);

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

      {/* The lightbox's pixels, above the pages and below the toast. Empty
          whenever no page has one open; a `z-50` stacking context either way,
          which is what the portalled surface's `position: fixed` paints
          inside. */}
      <div
        data-slot="lightbox-host"
        ref={setLightboxContainer}
        className="relative z-50"
      />

      {/* Portalled to the body by the primitive, so its place in this file is
          not what stacks it — the z-index in the component is. It is mounted
          here rather than in a view because `?` reaches it from all four
          destinations, and a per-view copy would need four (ADR 0015). */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/**
 * The shell, wrapped in the surface that holds its two toast slots.
 *
 * The surface is outside rather than inside so that `show` is in scope for every
 * view and for the shell's own `Ctrl+Z`, and its viewport renders after the
 * shell root instead of within it. Radix does not portal the viewport, so
 * document order is half of what puts a toast over the page; the z-index in the
 * component is the other half (ADR 0017, ADR 0022).
 *
 * Whether a lightbox is up is the one fact both halves need and neither owns:
 * the shell puts `inert` on the view container while one is, and the surface
 * suppresses ADR 0021's report outright while one is, because a full-screen
 * picture is the one place the app asks for the whole window. So it is held here
 * — the component that wraps them both — rather than in either of them.
 */
export function Layout() {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  return (
    <ToastSurface lightboxOpen={lightboxOpen}>
      <Shell lightboxOpen={lightboxOpen} setLightboxOpen={setLightboxOpen} />
    </ToastSurface>
  );
}
