import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { client, isAppError } from "@/lib/client";
import { FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const INVALID_PATH_ERROR = "That directory doesn't exist or can't be read.";
const NO_IMAGES_ERROR = "No supported images found in that directory.";
const SCAN_FAILED_ERROR = "Failed to scan directory. Please check the path.";
const SCAN_IN_PROGRESS_ERROR = "A scan is already running.";

function scanStartError(err: unknown): string {
  if (!isAppError(err)) return SCAN_FAILED_ERROR;
  switch (err.kind) {
    case "invalid_path":
      return INVALID_PATH_ERROR;
    // The only kind rendered verbatim. Its message names the variable the user
    // mistyped, which no canned string here can do.
    case "invalid_path_syntax":
      return err.message;
    case "invalid_transition":
      return SCAN_IN_PROGRESS_ERROR;
    default:
      return SCAN_FAILED_ERROR;
  }
}

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
      client.onScanComplete(({ added_count, scanned_count }) => {
        setScanning(false);
        setProgress(null);
        // Only a walk that turned up nothing at all is an empty directory.
        // A rescan that adds nothing means the library already has these —
        // the common case on every launch after the first, and reporting it
        // as "no images" strands the user on this screen.
        if (added_count > 0 || scanned_count > 0) {
          setView("rank");
        } else {
          setError(NO_IMAGES_ERROR);
        }
      }),
      client.onScanFailed(({ message }) => {
        setScanning(false);
        setProgress(null);
        setError(SCAN_FAILED_ERROR);
        console.error("Scan failed:", message);
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
      setError(scanStartError(err));
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
