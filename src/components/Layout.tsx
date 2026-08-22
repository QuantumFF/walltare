import { RankView } from "@/components/RankView";
import { ReviewView } from "@/components/ReviewView";
import { ScanView } from "@/components/ScanView";
import { useApp } from "@/context/AppContext";

export function Layout() {
  const { view } = useApp();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col selection:bg-primary selection:text-primary-foreground">
      <main className="flex-1 flex flex-col relative">
        {view === "scan" && <ScanView />}
        {view === "rank" && <RankView />}
        {view === "review" && <ReviewView />}
      </main>
    </div>
  );
}
