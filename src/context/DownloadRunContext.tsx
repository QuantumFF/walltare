import { useAppEvents } from "@/context/AppEventsContext";
import { client, type DownloadProgress } from "@/lib/client";
import { useBackendEvents } from "@/lib/useBackendEvents";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * How a batch of downloads ended, as a fact about the library rather than as
 * a sentence: `download-complete`'s counts, and the Round the landed files sent
 * the library back to.
 *
 * `backToRound` is `null` when the Round did not move backwards, which includes
 * a batch where nothing landed and a read of the Round that failed on either
 * side of the batch, the way a scan's `added` ending has it (ADR 0008). Every
 * download is a wallpaper with no comparisons, so a batch that landed anything
 * on a library past Round 1 sends it back there (ADR 0051).
 */
export interface DownloadEnding {
  total: number;
  landed: number;
  failed: number;
  firstError: string | null;
  backToRound: number | null;
}

/**
 * Whether a batch is downloading, and how far it has got.
 *
 * `run` counts batches, for the toast's key. `progress` is `null` until the
 * first file is done: there is no byte-level progress, so the only thing the
 * frontend knows before then is that it asked (ADR 0054).
 */
export type DownloadState =
  | { running: false }
  | { running: true; run: number; progress: DownloadProgress | null };

const IDLE: DownloadState = { running: false };

interface DownloadRunControls {
  /**
   * Queue these Results, and resolve once the backend has queued them.
   *
   * Rejects with whatever refused them — an id no search served, a Download
   * folder that cannot be used — and nothing is queued when it does. What to
   * say about that is the caller's, since it is where the click was.
   */
  download: (ids: string[]) => Promise<void>;
  subscribe: (listener: (ending: DownloadEnding) => void) => () => void;
}

const DownloadStateContext = createContext<DownloadState | undefined>(
  undefined,
);
const DownloadRunControlsContext = createContext<
  DownloadRunControls | undefined
>(undefined);

/**
 * Discover's downloads, followed from the click to the batch's ending, above
 * the view swap.
 *
 * Shell-level for the reason the scan run is: a batch runs in the background
 * while the curator browses, and its ending is news about the library wherever
 * they have got to by then (ADR 0021). What a landed file does to the rest of
 * the app is here too: each one publishes `library-scanned` and
 * `stats-changed`, so the views refresh as they do after a scan, with no
 * rescan (ADR 0051). What a batch *says* is the toast's, and what each card
 * says is Discover's, which reads the per-file events itself.
 *
 * State and controls are two contexts, so a progress event re-renders the
 * report and not Discover's grid.
 */
export function DownloadRunProvider({ children }: { children: ReactNode }) {
  const { publish } = useAppEvents();
  const [state, setState] = useState<DownloadState>(IDLE);

  // Refs for everything the events read, for the scan run's reason: the
  // handlers are registered once and the events outrun a render.
  const running = useRef(false);
  const runs = useRef(0);
  /** Whether the backend has queued anything for the batch that is open. */
  const accepted = useRef(false);
  /**
   * The Round as it stood before the batch's first file, which the "back to
   * Round N" ending is judged against.
   */
  const roundBefore = useRef<number | null>(null);
  const listeners = useRef(new Set<(ending: DownloadEnding) => void>());

  const open = useCallback((progress: DownloadProgress | null) => {
    running.current = true;
    runs.current += 1;
    accepted.current = false;
    roundBefore.current = null;
    setState({ running: true, run: runs.current, progress });
  }, []);

  const end = useCallback(() => {
    running.current = false;
    setState(IDLE);
  }, []);

  const download = useCallback<DownloadRunControls["download"]>(
    async (ids) => {
      const opening = !running.current;
      if (opening) {
        open(null);
        const run = runs.current;
        // Before the call, so no file can land ahead of the read: the Round
        // the batch is judged against is the one it started from.
        try {
          const stats = await client.getStats();
          if (runs.current === run) roundBefore.current = stats.round;
        } catch (error) {
          console.error("Failed to read the Round before a download:", error);
        }
      }
      const run = runs.current;
      try {
        await client.downloadWallhaven(ids);
        if (runs.current === run) accepted.current = true;
      } catch (error) {
        // A batch this call opened and nothing else joined never was one: the
        // backend queued nothing, so no ending is coming to close it.
        if (opening && runs.current === run && !accepted.current) end();
        throw error;
      }
    },
    [open, end],
  );

  useBackendEvents({
    downloadProgress: (progress) => {
      if (!running.current) open(progress);
      accepted.current = true;
      setState({ running: true, run: runs.current, progress });
      if (progress.item.outcome.kind !== "landed") return;
      // A landed file is a new row, which only a refetch can place, and a new
      // wallpaper with no comparisons, which moves the headline (ADR 0051).
      publish({ type: "library-scanned", added: 1 });
      void client
        .getStats()
        .then((stats) => publish({ type: "stats-changed", stats }))
        .catch((error: unknown) => {
          console.error("Failed to read the stats after a download:", error);
        });
    },

    downloadComplete: ({ total, landed, failed, first_error }) => {
      const before = roundBefore.current;
      end();
      const settle = (backToRound: number | null) => {
        const ending = {
          total,
          landed,
          failed,
          firstError: first_error,
          backToRound,
        };
        for (const listener of [...listeners.current]) listener(ending);
      };
      if (landed === 0 || before === null) {
        settle(null);
        return;
      }
      void client
        .getStats()
        .then((stats) => settle(stats.round < before ? stats.round : null))
        .catch((error: unknown) => {
          console.error(
            "Failed to read the Round a download left behind:",
            error,
          );
          settle(null);
        });
    },
  });

  const controls = useMemo<DownloadRunControls>(
    () => ({
      download,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [download],
  );

  return (
    <DownloadRunControlsContext.Provider value={controls}>
      <DownloadStateContext.Provider value={state}>
        {children}
      </DownloadStateContext.Provider>
    </DownloadRunControlsContext.Provider>
  );
}

function useControls(): DownloadRunControls {
  const controls = useContext(DownloadRunControlsContext);
  if (controls === undefined) {
    throw new Error(
      "download-run hooks must be used within a DownloadRunProvider",
    );
  }
  return controls;
}

/** The running batch, if there is one. */
export function useDownloadState(): DownloadState {
  const state = useContext(DownloadStateContext);
  if (state === undefined) {
    throw new Error(
      "useDownloadState must be used within a DownloadRunProvider",
    );
  }
  return state;
}

/**
 * The way to queue a download, without re-rendering on the batch's progress:
 * Discover's cards follow their own files off `download-progress`.
 */
export function useDownload(): DownloadRunControls["download"] {
  return useControls().download;
}

/**
 * Hear how each batch ended, once per batch, for the life of the component.
 * `handler` is re-read on each ending, the way `useScanOutcome` does it.
 */
export function useDownloadEnding(
  handler: (ending: DownloadEnding) => void,
): void {
  const { subscribe } = useControls();
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => subscribe((ending) => latest.current(ending)), [subscribe]);
}
