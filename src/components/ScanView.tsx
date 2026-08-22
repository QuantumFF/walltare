import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { client } from "@/lib/client";
import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const NO_IMAGES_ERROR = "No supported images found in that directory.";
const SCAN_FAILED_ERROR = "Failed to scan directory. Please check the path.";

export function ScanView() {
  const [path, setPath] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{
    scanned: number;
    added: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setView } = useApp();

  // Subscriptions live for the whole view so no completion event can race a
  // scan start.
  useEffect(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    void Promise.all([
      client.onScanProgress(({ scanned, added }) => {
        setProgress({ scanned, added });
      }),
      client.onScanComplete(({ added_count }) => {
        setScanning(false);
        setProgress(null);
        if (added_count > 0) {
          setView("rank");
        } else {
          setError(NO_IMAGES_ERROR);
        }
      }),
    ]).then((unlisten) => {
      if (cancelled) {
        for (const fn of unlisten) fn();
        return;
      }
      unlistens.push(...unlisten);
    });

    return () => {
      cancelled = true;
      for (const fn of unlistens) fn();
    };
  }, [setView]);

  const handleScan = async () => {
    if (!path || scanning) return;

    setScanning(true);
    setError(null);
    setProgress(null);

    try {
      await client.startScan(path);
    } catch (err) {
      setScanning(false);
      setProgress(null);
      setError(SCAN_FAILED_ERROR);
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 animate-in fade-in duration-500">
      <div className="w-full max-w-lg space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-tight text-foreground">
            Wallpaper Ranker
          </h1>
          <p className="text-muted-foreground">
            Enter the path to your wallpaper collection to begin ranking.
          </p>
        </div>

        <div className="space-y-4">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors">
              <FolderOpen className="h-5 w-5" />
            </div>
            <input
              placeholder="/home/user/wallpapers"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleScan()}
              disabled={scanning}
              className="h-12 w-full rounded-lg border border-transparent bg-secondary/50 pl-10 text-lg outline-none focus-visible:border-primary transition-all"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive animate-in slide-in-from-top-2">
              {error}
            </p>
          )}

          <Button
            className="w-full h-12 text-lg font-medium transition-all"
            onClick={() => void handleScan()}
            disabled={scanning || !path}
          >
            {scanning ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Scanning Collection...
              </>
            ) : (
              "Start Ranking"
            )}
          </Button>

          {progress && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {progress.scanned} scanned, {progress.added} added
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
