import { client } from "@/lib/client";
import React, { createContext, useContext, useEffect, useState } from "react";

export type View = "scan" | "rank" | "review";

interface AppContextType {
  view: View;
  setView: (view: View) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("scan");

  // A library survives across launches, but the scan view is the only entry
  // point and a rescan of an already-scanned folder adds nothing — which
  // ScanView reports as "no images found". Without this bootstrap the user is
  // locked out of their own library on every launch after the first.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stats = await client.getStats();
        if (cancelled) return;
        if (stats.total_wallpapers > 0) {
          setView((current) => (current === "scan" ? "rank" : current));
        }
      } catch (error) {
        // An empty or unreadable library just leaves the user on scan.
        console.error("Failed to load library stats:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppContext.Provider value={{ view, setView }}>
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
