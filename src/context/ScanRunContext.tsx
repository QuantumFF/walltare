import { useAppEvents } from "@/context/AppEventsContext";
import { client, type ScanProgress } from "@/lib/client";
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
 * How a scan ended, as a fact about the library rather than as a sentence.
 *
 * Every word about it is the toast's (ADR 0021), so nothing here is copy: each
 * row carries what the sentence for it needs and no more. Three of the four are
 * a `scan-complete` and they are told apart here, once, because two surfaces
 * read them — the toast says the ending, and the shell decides what a finished
 * scan does next — and the distinction between them is the one rule both have
 * to agree on.
 */
export type ScanOutcome =
  /**
   * The walk turned up nothing at all. `folder` is the Library root as the
   * curator wrote it, `~` and all, because a mistyped root is what this ending
   * exists to make visible and expanding it would hide the typo (ADR 0011). Empty
   * for a scan this frontend did not start, which names no folder.
   */
  | { kind: "empty"; folder: string }
  /**
   * The walk found files and every one was already in the library. The common
   * case on every rescan, and deliberately not the row above: only a walk that
   * found nothing is an empty folder.
   */
  | { kind: "nothing-new"; scanned: number }
  /**
   * The scan added wallpapers. Every one is Undecided, which the headline's
   * count says, so the ending carries the count alone (ADR 0059).
   */
  | { kind: "added"; added: number }
  /** The backend's own account of a scan that could not finish (ADR 0034). */
  | { kind: "failed"; message: string };

/**
 * Whether a scan is running, and how far it has got.
 *
 * `run` counts runs and nothing else: it differs between two scans, which is
 * what lets a surface tell a later scan from this one, and holds still for the
 * length of one. It is `null` while the scan has been asked for and not yet
 * started — the store and `start_scan` are still in flight — because a scan
 * the backend refuses never was a run. It holds the button disabled and
 * nothing else: a report that dropped the thumbnail pass for it would have
 * thrown that run away for a scan that never happened.
 *
 * `progress` is `null` for the walk, which is silent — `collect_images` runs to
 * completion before the first `scan-progress`, so on a large or networked tree
 * the only thing the frontend knows for minutes is that it asked for a scan.
 */
export type ScanState =
  | { running: false }
  | { running: true; run: null; progress: null }
  | { running: true; run: number; progress: ScanProgress | null };

const IDLE: ScanState = { running: false };

export interface ScanRun {
  state: ScanState;
  /**
   * Store the folder, then start the walk on it.
   *
   * The order ADR 0010 fixed and ADR 0020 repeats: the store learns the folder,
   * then the walk starts on the same string, unexpanded, because the backend is
   * what expands a Written path and storing one expanded would freeze what a
   * variable meant this session (ADR 0011). `store` is the caller's rather than
   * a `set_setting` made here, because the field that holds the path has to hear
   * its own write — otherwise the blur on the way to the button stores the same
   * string a second time.
   *
   * Running from the call rather than from the first event, since the walk emits
   * nothing until it is over. Rejects with whatever refused the scan, and the run
   * is over when it does: what to say about a scan that never got going belongs
   * to the field where the fix is typed (ADR 0020). A call while one is running
   * does nothing, since no command cancels a scan and a second `start_scan`
   * answers `InvalidTransition`.
   */
  start: (
    folder: string,
    store: (folder: string) => Promise<void>,
  ) => Promise<void>;
}

/**
 * The half of the run that holds still for the life of the shell: starting a
 * scan, and hearing how each one ended.
 */
interface ScanRunControls {
  start: ScanRun["start"];
  subscribe: (listener: (outcome: ScanOutcome) => void) => () => void;
}

const ScanStateContext = createContext<ScanState | undefined>(undefined);
const ScanRunControlsContext = createContext<ScanRunControls | undefined>(
  undefined,
);

/**
 * One scan, followed from the click to its ending, above the view swap.
 *
 * It cannot live in the page that starts the scan. A scan starts from inside
 * Settings, Settings is the one view the shell unmounts, and a walk of a large
 * folder takes minutes — so by the time `scan-complete` arrives the page that
 * asked is usually gone and the curator is somewhere else entirely. Mounted in
 * the shell, the ending is observed whichever tab is showing, and a Settings
 * page that remounts mid-scan reads the run that is still going (ADR 0015).
 *
 * What a scan does to the rest of the app is here too: `library-scanned`, which
 * the views refetch on and the Stats are re-read on. What it says is the
 * toast's, and what the shell does after one —
 * restart pre-generation, rerun the boot rule — is the shell's, each reading
 * the outcome rather than the backend's events.
 *
 * State and controls are two contexts so that a progress event re-renders the
 * surfaces that print it and not the shell, which only listens for endings and
 * re-renders every mounted view when it renders.
 */
export function ScanRunProvider({ children }: { children: ReactNode }) {
  const { publish } = useAppEvents();
  const [state, setState] = useState<ScanState>(IDLE);

  // Refs rather than state for everything the events read, because the
  // handlers are registered once for the life of the shell and a scan's events
  // arrive faster than a render: `phase` is read by the next event, not by the
  // next paint.
  //
  // Three phases rather than a flag, because the backend's events and its
  // reply to `start_scan` race. On an empty folder `scan-complete` can arrive
  // before the reply does, and a run that has already ended must not be opened
  // again by the reply that started it.
  const phase = useRef<"idle" | "starting" | "started">("idle");
  const runs = useRef(0);
  /** The folder the running scan was asked for, as the curator wrote it. */
  const folder = useRef("");
  const listeners = useRef(new Set<(outcome: ScanOutcome) => void>());

  const settle = useCallback((outcome: ScanOutcome) => {
    // Over a copy, for the reason the event bus iterates one: a listener may
    // unsubscribe from inside its own call.
    for (const listener of [...listeners.current]) listener(outcome);
  }, []);

  /**
   * Give the scan its run: from the reply to `start_scan`, or from the first
   * event if that beats the reply. A scan this frontend did not start opens
   * here too, with no folder.
   */
  const open = useCallback((progress: ScanProgress | null) => {
    if (phase.current === "idle") folder.current = "";
    phase.current = "started";
    runs.current += 1;
    setState({ running: true, run: runs.current, progress });
  }, []);

  const end = useCallback(() => {
    phase.current = "idle";
    setState(IDLE);
  }, []);

  const start = useCallback<ScanRun["start"]>(
    async (next, store) => {
      if (phase.current !== "idle") return;
      phase.current = "starting";
      // `scan-complete` names no folder, so the ending that reports an empty one
      // has to have been handed the path as the curator wrote it — and this call
      // is the only place that knows it. Recorded before the walk is asked for,
      // because on an empty folder the ending can arrive before the reply.
      folder.current = next;
      setState({ running: true, run: null, progress: null });
      try {
        await store(next);
        await client.startScan(next);
      } catch (error) {
        end();
        throw error;
      }
      // Already opened by an event that beat the reply, or already over.
      if (phase.current !== "starting") return;
      open(null);
    },
    [open, end],
  );

  useBackendEvents({
    scanProgress: (progress) => {
      if (phase.current !== "started") {
        open(progress);
        return;
      }
      setState({ running: true, run: runs.current, progress });
    },

    scanComplete: ({ added_count, scanned_count }) => {
      end();
      // A scan is the one mutation that changes which rows exist, so this is
      // the one event of the four that a mounted view answers with a fetch
      // rather than with a patch. The count rides along because zero of it is
      // the answer "nothing changed": a scan inserts and never deletes.
      publish({ type: "library-scanned", added: added_count });

      if (scanned_count === 0) {
        settle({ kind: "empty", folder: folder.current });
        return;
      }
      if (added_count === 0) {
        settle({ kind: "nothing-new", scanned: scanned_count });
        return;
      }

      // The count alone, and no Stats: `library-scanned` above is what the
      // headline is re-read on (ADR 0059, #418).
      settle({ kind: "added", added: added_count });
    },

    scanFailed: ({ message }) => {
      end();
      settle({ kind: "failed", message });
    },
  });

  const controls = useMemo<ScanRunControls>(
    () => ({
      start,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [start],
  );

  return (
    <ScanRunControlsContext.Provider value={controls}>
      <ScanStateContext.Provider value={state}>
        {children}
      </ScanStateContext.Provider>
    </ScanRunControlsContext.Provider>
  );
}

function useControls(): ScanRunControls {
  const controls = useContext(ScanRunControlsContext);
  if (controls === undefined) {
    throw new Error("scan-run hooks must be used within a ScanRunProvider");
  }
  return controls;
}

/** The running scan, if there is one, and the way to start one. */
export function useScanRun(): ScanRun {
  const state = useContext(ScanStateContext);
  const { start } = useControls();
  if (state === undefined) {
    throw new Error("useScanRun must be used within a ScanRunProvider");
  }
  return { state, start };
}

/**
 * Hear how each scan ended, once per scan, for the life of the component.
 *
 * `handler` is re-read on each ending rather than re-subscribed on each render,
 * the way `useAppEvent` does it, so it may close over this render's state. It
 * does not re-render its caller on progress, which is why the shell can listen
 * without every mounted view re-rendering twice a second during a scan.
 */
export function useScanOutcome(handler: (outcome: ScanOutcome) => void): void {
  const { subscribe } = useControls();
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => subscribe((outcome) => latest.current(outcome)), [subscribe]);
}
