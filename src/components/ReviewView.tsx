import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";

export function ReviewView() {
  const { setView } = useApp();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Review</h1>
      <p className="text-muted-foreground">Kept and Active wallpapers land here.</p>
      <Button variant="link" onClick={() => setView("rank")}>
        Back to rank
      </Button>
    </div>
  );
}
