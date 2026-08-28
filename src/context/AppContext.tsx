import {
  client,
  DEFAULT_SETTINGS,
  isAppError,
  type Settings,
  type Stats,
} from "@/lib/client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
 * What `get_pair` needs before Rank can draw anything (`voting.rs:74`), and so
 * the count that decides whether Rank is somewhere the curator can act.
 */
const ELIGIBLE_MINIMUM = 2;

/**
 * Why boot landed on Settings, when it did.
 *
 * Both rows of ADR 0015's boot table that open Settings are reached with no
 * wallpapers to show, and they must not look alike: "you have not scanned yet"
 * is an invitation and "the database will not open" is a fault, and one screen
 * serving both tells the second curator they have never used the app.
 *
 * `null` on the two rows that land on Rank or Library, and on every navigation
 * the curator makes afterwards.
 */
export type BootNotice =
  | { kind: "first_run" }
  /** `message` is the backend's, which is the only account of the fault there is. */
  | { kind: "unreadable_library"; message: string };

interface BootLanding {
  view: View;
  notice: BootNotice | null;
  /**
   * The Settings field boot wants the caret in, on the one landing that has an
   * answer: a first run is entirely about naming a folder, so it arrives with
   * the same focus key a control elsewhere would have sent (ADR 0020). The
   * other three landings ask for nothing.
   */
  focus: keyof Settings | null;
}

/**
 * ADR 0015's boot rule: one `get_stats`, four outcomes.
 *
 * It reads what the library holds and not `library_root`, because a configured
 * root proves the curator typed something rather than that a scan ever
 * succeeded — ADR 0010 is explicit that the field records what was configured,
 * and ADR 0011's Written paths can point somewhere that no longer exists.
 * `eligible_count` is what separates the two libraries that both have rows in
 * them: a wholly Rejected library cannot draw a pair, so sending it to Rank
 * lands the curator on an error string instead of on the page that can fix it.
 *
 * Nothing here is persisted. Where the curator happened to be last is less use
 * than what their library can currently do (ADR 0015).
 */
function bootLanding(stats: Stats | null, error: unknown): BootLanding {
  if (!stats) {
    return {
      view: "settings",
      notice: {
        kind: "unreadable_library",
        message: isAppError(error) ? error.message : String(error),
      },
      // Nothing is asked of the field, because the fault is not in it: the
      // button to press is the Retry in the block above (ADR 0020).
      focus: null,
    };
  }
  if (stats.total_wallpapers === 0) {
    return {
      view: "settings",
      notice: { kind: "first_run" },
      focus: "library_root",
    };
  }
  if (stats.eligible_count >= ELIGIBLE_MINIMUM) {
    return { view: "rank", notice: null, focus: null };
  }
  return { view: "library", notice: null, focus: null };
}

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
  /**
   * Rides on the navigation record rather than beside it, so it lives exactly as
   * long as the landing that produced it. A curator who leaves Settings and
   * opens it again from the gear is not on a first run any more, and a notice
   * left standing would tell them they were.
   */
  notice: BootNotice | null;
}

interface AppContextType {
  view: View;
  /** Where the current view closes back to; `null` when boot landed here. */
  returnTo: View | null;
  /** The field this navigation asked Settings to focus; `null` when none did. */
  focus: keyof Settings | null;
  /** Why boot opened Settings, for the page to say so; `null` in every other case. */
  bootNotice: BootNotice | null;
  setView: (view: View, options?: NavigationOptions) => void;
  /** What the curator chose, complete: an unread key holds its default. */
  settings: Settings;
  /**
   * Write one setting, and hold on to the whole struct that comes back.
   *
   * The app's copy of the store lives here rather than in the page that edits
   * it, because Settings is the one view the shell unmounts: a page that wrote
   * `library_root` and then re-read it on its next visit from a `settings`
   * frozen at boot would show the curator the path they had replaced — and blur
   * it back over the one they typed. `set_setting` answers with the whole
   * struct precisely so that a stale read cannot survive a write (ADR 0010),
   * and this is where that answer is kept.
   *
   * Rejects with whatever the write rejected with. What to say about a failed
   * write belongs to the field that asked for it.
   */
  saveSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  /**
   * How many wallpapers the library holds, as of the last read; `null` when
   * that read failed and there is no honest number to show.
   *
   * It is published from here rather than fetched by the page that prints it,
   * because boot already reads the whole `Stats` to decide where to land
   * (ADR 0020) and Settings arrives on a mount rather than on a fetch. Only the
   * total is published: every other field of `Stats` moves with a vote, and
   * `AppProvider` sits above the event bus and so cannot hear one, which would
   * make the rest of the struct a set of numbers going stale between two
   * clicks. A scan is the only thing that moves this one, and
   * `readLibraryAfterScan` is what follows it.
   */
  libraryTotal: number | null;
  /**
   * Re-read what the library holds, and keep `libraryTotal` in step with it.
   *
   * Rejects with whatever the read rejected with, because its other caller is
   * the failed-boot block's Retry, whose whole content is the fault it hit.
   */
  readLibrary: () => Promise<Stats>;
  /**
   * What the app re-reads after a scan, called by the shell on every
   * `scan-complete`: the count the Library root section prints, and the boot
   * rule's one rerun.
   *
   * The rerun is a no-op unless the library was empty before the scan and is
   * not after, which is what makes it happen at most once: a first run scans,
   * and the app moves off the page that asked it to. Every other completion
   * leaves the curator where they are, because a scan now starts from inside
   * Settings and finishes minutes later on whatever page they wandered to
   * (ADR 0015). The count follows every scan either way, since a rescan that
   * adds files is the ordinary case and the number on screen would otherwise be
   * the one boot read.
   */
  readLibraryAfterScan: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // `null` until the boot read settles, which is the same fact as "nothing has
  // rendered yet": where the app opens is computed from what the library holds,
  // so before that answer arrives there is no honest view to show.
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null);
  const booted = navigation !== null;

  // Whether the library was empty the last time anything counted it, which is
  // the "before the scan" half of the rerun's condition. A ref rather than
  // state: nothing renders from it, and the scan-complete handler that reads it
  // is registered once for the life of the shell.
  const libraryEmpty = useRef(false);

  // A navigation replaces the whole record rather than merging into it. A
  // `returnTo` left standing from an earlier hop would close Settings to a view
  // the curator never came from, and a `focus` left standing would pull the
  // caret into a field nobody asked about.
  const setView = useCallback((view: View, options?: NavigationOptions) => {
    setNavigation({
      view,
      returnTo: options?.returnTo ?? null,
      focus: options?.focus ?? null,
      notice: null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Kept beside the read rather than thrown away with it: the failed row of
      // the boot table renders the backend's own message, which is the only
      // account of the fault there is.
      let statsError: unknown = null;

      // One round trip's worth of waiting for both reads. Each catches its own
      // rejection rather than letting `Promise.all` discard the other's answer,
      // because neither failure may stop the app: a library that will not read
      // is a row of the boot table rather than a dead end, and a preference that
      // will not read must not lock the curator out of the app that would let
      // them fix it (ADR 0010).
      const [stats, stored] = await Promise.all([
        client.getStats().catch((error: unknown) => {
          console.error("Failed to load library stats:", error);
          statsError = error;
          return null;
        }),
        client.getSettings().catch((error: unknown) => {
          console.error("Failed to load settings:", error);
          return null;
        }),
      ]);
      if (cancelled) return;

      if (stored) setSettings(stored);

      // A read that failed says nothing about whether the library is empty, so
      // it does not arm the rerun below either, and leaves the count line with
      // nothing to print rather than with a zero it did not measure.
      libraryEmpty.current = stats?.total_wallpapers === 0;
      setLibraryTotal(stats?.total_wallpapers ?? null);

      const landing = bootLanding(stats, statsError);
      setNavigation({
        view: landing.view,
        returnTo: null,
        focus: landing.focus,
        notice: landing.notice,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings(await client.setSetting(key, value));
    },
    [],
  );

  const readLibrary = useCallback(async () => {
    const stats = await client.getStats();
    setLibraryTotal(stats.total_wallpapers);
    return stats;
  }, []);

  const readLibraryAfterScan = useCallback(() => {
    void (async () => {
      const stats = await readLibrary().catch((error: unknown) => {
        console.error("Failed to re-read library stats after a scan:", error);
        return null;
      });
      // The count above follows every scan. Everything below is the rerun, which
      // is armed only for a library that was empty before this one.
      if (!libraryEmpty.current) return;
      // Neither a failed read nor a scan that added nothing can establish "and
      // is not after", so both leave the curator on the page that offered to
      // scan — with the folder they typed still in the field. A later scan of a
      // better path is still the first one that fills the library, and still
      // gets the rerun.
      if (!stats || stats.total_wallpapers === 0) return;

      libraryEmpty.current = false;
      // The rule, not a hardcoded "rank": a first scan that turned up a single
      // wallpaper has nothing for Rank to compare it against, and lands on
      // Library for the same reason boot would have.
      const landing = bootLanding(stats, null);
      setNavigation({
        view: landing.view,
        returnTo: null,
        focus: landing.focus,
        notice: landing.notice,
      });
    })();
  }, [readLibrary]);

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
  // stored choice, and no view paints before the boot rule has picked one. The
  // palette in index.css covers the gap.
  if (navigation === null) return null;

  return (
    <AppContext.Provider
      value={{
        view: navigation.view,
        returnTo: navigation.returnTo,
        focus: navigation.focus,
        bootNotice: navigation.notice,
        setView,
        settings,
        saveSetting,
        libraryTotal,
        readLibrary,
        readLibraryAfterScan,
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
