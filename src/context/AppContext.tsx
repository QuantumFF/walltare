import { client, DEFAULT_SETTINGS, type Settings } from "@/lib/client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * The four destinations, and the whole of the app's navigation.
 *
 * There is no router. This app has no URL bar to synchronise, no window-chrome
 * back button, one level of nesting and a bundle too small to split — and a
 * router unmounts a route by default, which is the one thing the shell exists
 * to prevent (ADR 0015).
 */
export type View = "rank" | "review" | "library" | "settings";

/**
 * Where boot lands, until #110 implements ADR 0015's rule: one `get_stats` and
 * four outcomes, two of which dress Settings differently and neither of which
 * is expressible from the single `total_wallpapers` read below.
 *
 * Settings hosts the scan screen for now, so an empty library still has a way
 * to fill itself. That is what the deleted `scan` view was for.
 */
const INITIAL_VIEW: View = "settings";

/** Where a navigation came from, and what it wants looked at on arrival. */
export interface NavigationOptions {
  /**
   * The view Settings closes back to. Settings is a page rather than a sheet,
   * so it has no back of its own: the gear records where the curator was and
   * Settings returns there, which is what stops opening it being a detour
   * (ADR 0015).
   */
  returnTo?: View;
  /**
   * A Settings field to focus on arrival, so a control elsewhere can send the
   * curator to the exact input it was talking about. Keyed on `keyof Settings`
   * for the same reason `setSetting` is: a caller cannot name a field that is
   * not there (ADR 0020).
   */
  focus?: keyof Settings;
}

interface Navigation {
  view: View;
  returnTo: View | null;
  focus: keyof Settings | null;
}

interface AppContextType {
  view: View;
  /** Where the current view closes back to; `null` when boot landed here. */
  returnTo: View | null;
  /** The field this navigation asked Settings to focus; `null` when none did. */
  focus: keyof Settings | null;
  setView: (view: View, options?: NavigationOptions) => void;
  /** What the curator chose, complete: an unread key holds its default. */
  settings: Settings;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [navigation, setNavigation] = useState<Navigation>({
    view: INITIAL_VIEW,
    returnTo: null,
    focus: null,
  });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [booted, setBooted] = useState(false);

  // A navigation replaces the whole record rather than merging into it. A
  // `returnTo` left standing from an earlier hop would close Settings to a view
  // the curator never came from, and a `focus` left standing would pull the
  // caret into a field nobody asked about.
  const setView = useCallback((view: View, options?: NavigationOptions) => {
    setNavigation({
      view,
      returnTo: options?.returnTo ?? null,
      focus: options?.focus ?? null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // One round trip's worth of waiting for both reads. Each catches its own
      // rejection rather than letting `Promise.all` discard the other's answer,
      // because neither failure may stop the app: a library that will not read
      // just leaves the user on scan, and a preference that will not read must
      // not lock them out of the app that would let them fix it (ADR 0010).
      const [stats, stored] = await Promise.all([
        client.getStats().catch((error: unknown) => {
          console.error("Failed to load library stats:", error);
          return null;
        }),
        client.getSettings().catch((error: unknown) => {
          console.error("Failed to load settings:", error);
          return null;
        }),
      ]);
      if (cancelled) return;

      if (stored) setSettings(stored);

      // A library survives across launches, so a curator who has already
      // scanned lands on Rank rather than on the page offering to scan again.
      // Without this they are locked out of their own library every launch
      // after the first, because a rescan of an already-scanned folder adds
      // nothing — which the scan screen reports as "no images found".
      //
      // #110 replaces it with ADR 0015's rule, which reads `eligible_count`
      // too and can tell an empty library from a wholly Rejected one.
      if (stats && stats.total_wallpapers > 0) {
        setNavigation((current) =>
          current.view === INITIAL_VIEW ? { ...current, view: "rank" } : current,
        );
      }

      setBooted(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The frontend owns the trigger for pre-generation, the way it already owns
  // the scan: spawning the pass from Tauri's `setup()` would start decoding
  // before the window paints, competing with WebKit for the first frame
  // (ADR 0012). So it starts once the gate above has settled, and again after
  // every scan, which is what gets freshly scanned files warmed first.
  //
  // ScanView listens to `scan-complete` as well, for its own reporting, and
  // this stays a second listener rather than a call from there because that
  // event still navigates and so unmounts the component that would make the
  // call. #110 moves the whole subscription up into the shell, where a scan
  // that finishes on some other page still reaches all three things hanging off
  // it. Nothing renders progress yet (#112).
  useEffect(() => {
    if (!booted) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // A pass that will not start leaves the cache cold and nothing else: the
    // views it warms for all still generate on demand, so this is logged the
    // way a failed boot read is and the app carries on.
    const start = () => {
      void client.startPregen().catch((error: unknown) => {
        console.error("Failed to start thumbnail pre-generation:", error);
      });
    };

    start();
    void client.onScanComplete(start).then((off) => {
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
  }, [booted]);

  // The palette is a class on the document element, because index.css keys both
  // the tokens and the `dark:` variant off one there. Nothing is written before
  // the gate settles: until then the `prefers-color-scheme` branch in index.css
  // is what paints, and it already answers what `system` would.
  //
  // `system` is resolved once, here. Repainting when the desktop flips
  // mid-session needs a `matchMedia` listener, which arrives with the control
  // that makes the choice.
  useEffect(() => {
    if (!booted) return;
    const dark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    // `light` is set and not merely absent: the media branch in index.css needs
    // something to lose to when the choice is Light on a dark desktop.
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
  }, [booted, settings.theme]);

  // Nothing paints until both reads have settled, so a screen that reads a
  // setting never renders once against the defaults and again against the
  // stored choice. The palette in index.css covers the gap.
  if (!booted) return null;

  return (
    <AppContext.Provider
      value={{
        view: navigation.view,
        returnTo: navigation.returnTo,
        focus: navigation.focus,
        setView,
        settings,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
