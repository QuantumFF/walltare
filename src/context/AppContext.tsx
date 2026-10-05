import { useAppEvent } from "@/context/AppEventsContext";
import {
  client,
  DEFAULT_SETTINGS,
  isAppError,
  type SettingKey,
  type Settings,
  type StartupView,
  type Stats,
} from "@/lib/client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * The five destinations, and the whole of the app's navigation.
 *
 * There is no router. This app has no URL bar to synchronise, no window-chrome
 * back button, one level of nesting and a bundle too small to split — and a
 * router unmounts a route by default, which is the one thing the shell exists
 * to prevent (ADR 0015).
 *
 * Written as the three a curator can open the app on plus Discover and
 * Settings, rather than as five names, because that is the relationship between
 * the two types: the startup view is every destination except the one boot
 * reaches on its own and Discover, which opens on a network search and so is
 * never where the app starts (#339).
 */
export type View = StartupView | "discover" | "settings";

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
  focus: SettingKey | null;
}

/**
 * ADR 0015's boot rule: one `get_stats`, four outcomes, with the curator's
 * chosen `startupView` standing where that table wrote Rank.
 *
 * It reads what the library holds and not `library_root`, because a configured
 * root proves the curator typed something rather than that a scan ever
 * succeeded — ADR 0010 is explicit that the field records what was configured,
 * and ADR 0011's Written paths can point somewhere that no longer exists.
 * `eligible_count` is what separates the two libraries that both have rows in
 * them: a wholly Rejected library cannot draw a pair, so sending it to Rank
 * lands the curator on an error string instead of on the page that can fix it.
 *
 * **This narrows ADR 0015's "boot reads the library, not the preference", and
 * says so.** What that ADR refused was persisting where the curator happened to
 * be last, which is less use than what their library can currently do. A stated
 * startup view is not that: it is fixed, so the app opens in the same place
 * every launch. What the library can do still wins where the two disagree —
 * nothing scanned and a library that would not read both still open Settings,
 * and Rank with fewer than two Eligible wallpapers still falls to Library,
 * because `get_pair` has nothing to draw (#259).
 */
function bootLanding(
  stats: Stats | null,
  error: unknown,
  startupView: StartupView,
): BootLanding {
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
  // Rank is the only destination the library can refuse, so it is the only one
  // this line has to check: Review and Library both own an empty state that
  // names the reason and offers the route out, which is ADR 0015's rule for
  // every tab. Rank with one Eligible wallpaper has nothing to compare it
  // against, and lands on Library for exactly the reason it always did.
  if (startupView === "rank" && stats.eligible_count < ELIGIBLE_MINIMUM) {
    return { view: "library", notice: null, focus: null };
  }
  return { view: startupView, notice: null, focus: null };
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
   * curator to the exact input it was talking about. Keyed on `SettingKey` for
   * the same reason `setSetting` is: a caller cannot name a field that is not
   * there (ADR 0020).
   */
  focus?: SettingKey;
}

interface Navigation {
  view: View;
  returnTo: View | null;
  focus: SettingKey | null;
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
  focus: SettingKey | null;
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
  saveSetting: <K extends SettingKey>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  /**
   * Save a Wallhaven API key, or remove the saved one with an empty `key`, and
   * hold on to the settings that come back, as `saveSetting` does. Resolves
   * with whether Wallhaven could be asked about the key before it was stored
   * (ADR 0052).
   *
   * Rejects with whatever the save rejected with: `bad_request` for a key
   * Wallhaven refused, which is then not stored.
   */
  saveWallhavenKey: (key: string) => Promise<boolean>;
  /**
   * Re-read the Stats, and resolve with what the read answered.
   *
   * Rejects with whatever the read rejected with, because its caller is the
   * failed-boot block's Retry, whose whole content is the fault it hit.
   */
  readLibrary: () => Promise<Stats>;
  /**
   * The boot rule's one rerun, called by the shell on every scan run that
   * finished rather than failed.
   *
   * A no-op unless the library was empty before the scan and is not after,
   * which is what makes it happen at most once: a first run scans, and the app
   * moves off the page that asked it to. Every other completion leaves the
   * curator where they are, because a scan now starts from inside Settings and
   * finishes minutes later on whatever page they wandered to (ADR 0015). The
   * count the Library root section prints follows every scan without this,
   * because `library-scanned` is one of the facts the Stats are re-read on.
   */
  readLibraryAfterScan: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * The settings whose write can move the Stats. Decided reads the Bar, so a new
 * Bar share can move the Undecided count with nothing voted (ADR 0059). No
 * other key reaches a field of `Stats`: the Evaluated threshold lost its count
 * with ADR 0059, and the rest decide what a page shows.
 */
const MOVES_THE_STATS: ReadonlySet<SettingKey> = new Set(["bar_share"]);

/** Every field of two `Stats` agrees, so the second is no news. */
function sameStats(a: Stats | null, b: Stats): boolean {
  return (
    a !== null &&
    (Object.keys(b) as (keyof Stats)[]).every((key) => a[key] === b[key])
  );
}

/**
 * The Stats as of the last read, published apart from the rest of the app's
 * state so that a new count re-renders the pages that print one and nothing
 * else.
 */
const StatsContext = createContext<Stats | null | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  // `null` until the boot read settles, which is the same fact as "nothing has
  // rendered yet": where the app opens is computed from what the library holds,
  // so before that answer arrives there is no honest view to show.
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const booted = navigation !== null;

  // The Stats, and the one place in the frontend that reads them. Every module
  // that changes something publishes the fact it already publishes, and this
  // re-reads on the facts that can move a count; nothing else calls
  // `get_stats` (#418). `null` until a read has landed, so a page with no
  // honest number prints none rather than a zero nobody measured.
  const [stats, setStats] = useState<Stats | null>(null);
  // A read asked for and not yet sent. Facts published in one go — a reject of
  // every missing file is one `status-changed` a row — join it, so they cost
  // one read between them and not one each.
  const queuedRead = useRef<Promise<Stats> | null>(null);
  // Counts what has set the Stats, so a read that was overtaken — by a later
  // read, or by a vote's answer — lands without undoing it.
  const statsVersion = useRef(0);
  // Reads sent and not yet answered.
  const readsInFlight = useRef(0);

  const readStats = useCallback((): Promise<Stats> => {
    if (queuedRead.current) return queuedRead.current;
    const read = Promise.resolve().then(async () => {
      queuedRead.current = null;
      const version = ++statsVersion.current;
      readsInFlight.current += 1;
      let answer: Stats;
      try {
        answer = await client.getStats();
      } finally {
        readsInFlight.current -= 1;
      }
      // An unchanged answer keeps the object it would replace, so a fact that
      // moved no count — a keep, say — re-renders nobody.
      if (version === statsVersion.current) {
        setStats((held) => (sameStats(held, answer) ? held : answer));
      }
      // A read that now succeeds retires the account of one that did not. The
      // notice is why boot opened Settings, and the page shows a boot landing —
      // the block, and the Library root section on its own — for as long as one
      // stands: a Retry that fixed nothing but the block would leave the
      // curator on a page still missing every section but the first
      // (ADR 0033).
      //
      // Only the fault. A first-run notice is about what the library holds
      // rather than about whether it could be read, and this same read follows
      // every scan — so clearing that one here would drop the invitation on a
      // scan that found nothing, which is exactly when it is still true.
      setNavigation((current) =>
        current?.notice?.kind === "unreadable_library"
          ? { ...current, notice: null }
          : current,
      );
      return answer;
    });
    queuedRead.current = read;
    return read;
  }, []);

  const rereadStats = useCallback(() => {
    // A failed re-read leaves the old Stats standing rather than blanking
    // them: the fact has landed, the counts are one read behind, and the next
    // fact or vote catches them up (ADR 0046).
    readStats().catch((error: unknown) => {
      console.error("Failed to re-read the stats:", error);
    });
  }, [readStats]);

  useAppEvent((event) => {
    switch (event.type) {
      // A vote answers with the whole `Stats`, so there is nothing to read —
      // unless a read is already out. Nothing says which of the two the backend
      // answered last, and dropping either can leave a count stale: the read
      // may carry a new Bar the vote's answer predates. So the vote's answer
      // stands for now, and one more read, sent after it landed, settles both.
      case "stats-changed":
        statsVersion.current += 1;
        setStats((held) => (sameStats(held, event.stats) ? held : event.stats));
        if (readsInFlight.current > 0) rereadStats();
        return;
      // A reject or a Restore changes the Eligible pool. A keep does not, and
      // the payload cannot tell the two apart, so every transition re-reads.
      case "status-changed":
        rereadStats();
        return;
      // A scan or a download. One that added nothing moved no count, and is
      // read anyway: it is the read that retires a boot that could not read
      // the library, and the read the boot rule's rerun joins.
      case "library-scanned":
        rereadStats();
        return;
      // The ids in a Comparison, whose `Stats` came with the vote's answer.
      case "score-changed":
        return;
    }
  });

  // Whether the library was empty the last time anything counted it, which is
  // the "before the scan" half of the rerun's condition. A ref rather than
  // state: nothing renders from it, and the scan-complete handler that reads it
  // is registered once for the life of the shell.
  const libraryEmpty = useRef(false);

  // Read by the boot rule's one rerun below, which is the only navigation left
  // on a finished scan.
  const startupView = settings.startup_view;

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
        readStats().catch((error: unknown) => {
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
      // it does not arm the rerun below either.
      libraryEmpty.current = stats?.total_wallpapers === 0;

      // The startup view off the read that just landed rather than off the
      // state it is about to set, which has not re-rendered yet. A settings
      // read that failed lands on the default, Rank, which is where boot has
      // always gone: a preference that could not be read must not move the app
      // somewhere the curator cannot account for (ADR 0010).
      const landing = bootLanding(
        stats,
        statsError,
        (stored ?? DEFAULT_SETTINGS).startup_view,
      );
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
  }, [readStats]);

  const saveSetting = useCallback(
    async <K extends SettingKey>(key: K, value: Settings[K]) => {
      setSettings(await client.setSetting(key, value));
      if (MOVES_THE_STATS.has(key)) rereadStats();
    },
    [rereadStats],
  );

  const saveWallhavenKey = useCallback(async (key: string) => {
    const saved = await client.setWallhavenKey(key);
    setSettings(saved.settings);
    return saved.verified;
  }, []);

  const readLibraryAfterScan = useCallback(() => {
    // Armed only for a library that was empty before this scan.
    if (!libraryEmpty.current) return;
    void (async () => {
      // The read `library-scanned` just queued, joined rather than repeated:
      // the scan published it before its ending reached the shell. A failure
      // is that read's to report.
      const stats = await readStats().catch(() => null);
      // Neither a failed read nor a scan that added nothing can establish "and
      // is not after", so both leave the curator on the page that offered to
      // scan — with the folder they typed still in the field. A later scan of a
      // better path is still the first one that fills the library, and still
      // gets the rerun.
      if (!stats || stats.total_wallpapers === 0) return;

      libraryEmpty.current = false;
      // The rule, not a hardcoded "rank": a first scan that turned up a single
      // wallpaper has nothing for Rank to compare it against, and lands on
      // Library for the same reason boot would have. The startup view is the
      // one the curator holds now, not the one boot read — this rerun happens
      // on a page they have been sitting on, and the section is on it.
      const landing = bootLanding(stats, null, startupView);
      setNavigation({
        view: landing.view,
        returnTo: null,
        focus: landing.focus,
        notice: landing.notice,
      });
    })();
  }, [readStats, startupView]);

  // The palette is a class on the document element, because index.css keys both
  // the tokens and the `dark:` variant off one there. Nothing is written before
  // the gate settles: until then the `prefers-color-scheme` branch in index.css
  // is what paints, and it already answers what `system` would.
  //
  // The listener that follows the desktop lives here rather than in the
  // Appearance section that offers the choice, because Settings is the one view
  // the shell unmounts (ADR 0015): owned by that page, it would repaint only
  // while the curator had the page open, and the flip worth answering is the one
  // that happens while they are anywhere else. `AppProvider` is mounted for as
  // long as the app is.
  useEffect(() => {
    if (!booted) return;

    const desktop = window.matchMedia("(prefers-color-scheme: dark)");

    const paint = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && desktop.matches);
      // `light` is set and not merely absent: the media branch in index.css
      // needs something to lose to when the choice is Light on a dark desktop.
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };

    paint();

    // Only `system` is a promise to follow the desktop. Light and Dark are the
    // curator saying which palette they want regardless of what is around the
    // window, so the subscription exists on exactly one of the three values and
    // is dropped by this effect re-running when the choice moves off it — and by
    // the same cleanup when the app goes away.
    //
    // ADR 0020 records that this may never fire: whether WebKitGTK propagates
    // the portal's colour-scheme change under Hyprland is untested and not
    // measurable from here. If it stays silent this costs nothing and the
    // boot-time read above is still what paints (ADR 0010).
    if (settings.theme !== "system") return;
    desktop.addEventListener("change", paint);
    return () => desktop.removeEventListener("change", paint);
  }, [booted, settings.theme]);

  // Memoised, so a new count re-renders the readers of `useStats` and not every
  // reader of this: the shell and every mounted view are among them, and a
  // hidden page re-rendered on each vote is the cost ADR 0043 priced.
  const app = useMemo<AppContextType | null>(
    () =>
      navigation && {
        view: navigation.view,
        returnTo: navigation.returnTo,
        focus: navigation.focus,
        bootNotice: navigation.notice,
        setView,
        settings,
        saveSetting,
        saveWallhavenKey,
        readLibrary: readStats,
        readLibraryAfterScan,
      },
    [
      navigation,
      setView,
      settings,
      saveSetting,
      saveWallhavenKey,
      readStats,
      readLibraryAfterScan,
    ],
  );

  // Nothing paints until both reads have settled, so a screen that reads a
  // setting never renders once against the defaults and again against the
  // stored choice, and no view paints before the boot rule has picked one. The
  // palette in index.css covers the gap.
  if (app === null) return null;

  return (
    <AppContext.Provider value={app}>
      <StatsContext.Provider value={stats}>{children}</StatsContext.Provider>
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

/**
 * The library's `Stats` as of the last read, kept current for as long as the
 * app runs; `null` until a read has landed.
 *
 * Read here and never fetched by the page that prints them. Every fact that
 * can move a count is on the bus — a transition's `status-changed`, a scan's
 * or a download's `library-scanned`, a vote's `stats-changed` — and the one
 * write that moves one, the Bar share, goes through `saveSetting`. So a module
 * that changes something publishes what it already publishes, and the counts
 * follow without it knowing who prints them (#418).
 */
export function useStats(): Stats | null {
  const stats = useContext(StatsContext);
  if (stats === undefined) {
    throw new Error("useStats must be used within an AppProvider");
  }
  return stats;
}
