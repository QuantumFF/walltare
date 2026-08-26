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
