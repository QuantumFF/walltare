import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";

export function RankView() {
  const { setView } = useApp();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Rank</h1>
      <p className="text-muted-foreground">Pairwise voting lands here.</p>
      <Button onClick={() => setView("review")}>Go to review</Button>
    </div>
  );
}
