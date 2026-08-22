import React, { createContext, useContext, useState } from "react";

export type View = "scan" | "rank" | "review";

interface AppContextType {
  view: View;
  setView: (view: View) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("scan");

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
