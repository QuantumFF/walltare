import { client, DEFAULT_SETTINGS, type Settings } from "@/lib/client";
import React, { createContext, useContext, useEffect, useState } from "react";

export type View = "scan" | "rank" | "review";

interface AppContextType {
  view: View;
  setView: (view: View) => void;
  /** What the curator chose, complete: an unread key holds its default. */
  settings: Settings;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("scan");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [booted, setBooted] = useState(false);

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

      // A library survives across launches, but the scan view is the only entry
      // point and a rescan of an already-scanned folder adds nothing — which
      // ScanView reports as "no images found". Without this bootstrap the user
      // is locked out of their own library on every launch after the first.
      if (stats && stats.total_wallpapers > 0) {
        setView((current) => (current === "scan" ? "rank" : current));
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
  // ScanView listens to `scan-complete` as well, for its own reporting. This is
  // a second listener rather than a call from there because that event is what
  // moves the user off the scan view, so the component that would make the call
  // unmounts as it fires. Nothing renders progress yet (#59).
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
    <AppContext.Provider value={{ view, setView, settings }}>
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
