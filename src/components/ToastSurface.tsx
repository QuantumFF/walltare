import { Progress } from "@/components/ui/progress";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useApp, type View } from "@/context/AppContext";
import { useAppEvents } from "@/context/AppEventsContext";
// The counts these toasts print are the counts ADR 0020's Thumbnails line
// prints, so both read them out of one file (ADR 0021).
import { counted, grouped } from "@/lib/copy";
import {
  client,
  isAppError,
  type PregenProgress,
  type ScanProgress,
} from "@/lib/client";
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

/** The four Status transitions, by the name the control that makes them carries. */
type TransitionAction = "keep" | "reject" | "restore" | "make-active";

/**
 * What a caller hands the shell after it has acted, and the whole of the API:
 * no view holds toast state of its own, and none of them writes copy either.
 *
 * A request names what happened rather than what to print. That is what keeps
 * ADR 0017's table in one file while keep and reject fire from Review, Library's
 * card overlays and the lightbox — three surfaces that would otherwise each
 * spell "Kept" their own way, and one of them would eventually say Removed.
 */
export type ToastRequest =
  /**
   * A Keep that persisted. `view` rides along for the failure path rather than
   * for this toast: Undo can be pressed eight seconds later from a different
   * page, so the view that owes a refetch is the one that acted and not the one
   * the curator is looking at when it goes wrong.
   */
  | { kind: "kept"; view: View; id: number; filename: string }
  /**
   * A soft reject that persisted. `destination` is the Written path it was sent
   * to and `finalPath` is the absolute path `move_wallpaper` answered with;
   * between them they decide whether the path line has anything to say.
   */
  | {
      kind: "rejected";
      view: View;
      id: number;
      filename: string;
      destination: string;
      finalPath: string;
    }
  /** A Restore that persisted, with the absolute path `restore_wallpaper` answered with. */
  | { kind: "restored"; filename: string; finalPath: string }
  /**
   * The keep inverse. CONTEXT.md gives it no noun — "by undoing the keep, Active
   * again" — so this is the one row that leads with a filename instead of a
   * verb, and the copy names the resulting Status rather than coining one
   * (ADR 0017, ADR 0019).
   */
  | { kind: "made-active"; filename: string }
  /**
   * One of the four refused by the backend. The title is the frontend's and the
   * detail is the backend's, which is what lets `InvalidPathSyntax` name the
   * variable the curator mistyped while `FileMissing` still says its own
   * sentence (ADR 0011, ADR 0009).
   */
  | {
      kind: "failed";
      view: View;
      action: TransitionAction;
      filename: string;
      error: unknown;
    }
  /**
   * A fetch that failed. Not a transition, and on this surface because ADR 0017
   * took away the `role="alert"` paragraph that used to hold it: one view
   * carrying two error surfaces is what that decision set out to remove, and a
   * list that will not load was the paragraph's last tenant. `noun` names what
   * failed to load, because "the review list" is the caller's own subject.
   */
  | { kind: "load-failed"; noun: string; error: unknown }
  /**
   * A refusal the frontend made itself, with no call behind it: the cohort
   * rejected before ADR 0009 recorded an Origin. `origin_path` is on the DTO, so
   * the answer is known before the press and the description is the frontend's
   * own sentence — the one place ADR 0017's "the backend message" does not
   * apply. `WallpaperCard`'s Restore is the `aria-disabled` control that raises
   * it, on any page that mounts a Rejected card.
   */
  | { kind: "refused"; filename: string; reason: string };

/** ADR 0019's sentence for the cohort that has no Origin to go back to. */
export const NO_ORIGIN_REASON =
  "Rejected before Restore existed, so nothing recorded where it came from.";

/**
 * The shell's one slot, as it renders.
 *
 * The title is three pieces because the filename is the only part that may be
 * cut: it truncates with an ellipsis and carries the full string in `title`, and
 * two of the six rows put it at the front, where truncating the line would eat
 * "is Active again" instead.
 */
interface Transient {
  /**
   * Fresh per message, and load-bearing. Radix restarts the close timer on
   * `open` and `duration` and on nothing else, so swapping a mounted toast's
   * content leaves the previous countdown running and the new message inherits
   * whatever was left of the old eight seconds. A new key remounts, which arms a
   * new timer.
   *
   * The outgoing toast therefore skips its exit animation, and for a
   * replacement that is the right reading: the old message is not leaving, it is
   * being overwritten (ADR 0017).
   */
  key: string;
  prefix: string;
  filename: string;
  suffix: string;
  description?: string;
  /**
   * Present on the two rows that offer it. Absent on the two inverses, which are
   * already one click away, and on every error — an Undo that shuttles a file
   * back and forth can suffix it on each leg (ADR 0009).
   */
  undo?: () => void;
  /**
   * Errors never dismiss themselves. `duration={Infinity}` and an explicit
   * close, because a failing action is exactly when the curator wants to read
   * the message twice. They get no exception to the replacement rule: the one
   * thing that wipes an unread error is the curator taking another action, which
   * is the one signal that they have moved on (ADR 0017).
   */
  pinned: boolean;
  /**
   * Set when this toast has closed itself or been closed, which is what hands
   * the surface over to the lower slot: a keep during a fourteen-minute pass
   * covers the report for eight seconds and the report comes back when the
   * eight seconds are up (ADR 0021).
   *
   * The record outlives the toast either way — see `disarm` — so this is the
   * difference between "the slot holds a message" and "a message is on screen",
   * and only the second one covers anything.
   */
  closed?: boolean;
}

/**
 * The lower slot: whatever background work is running, reported wherever the
 * curator is (ADR 0021).
 *
 * `run` is the toast's key, and it is the pass rather than the payload —
 * exactly the inverse of `Transient.key`'s rule, and it inverts for the reason
 * that rule exists. Radix restarts the close timer on `open` and `duration`, and
 * `duration={Infinity}` short-circuits `startTimer` outright, so this toast
 * holds no countdown for a fresh key to re-arm. What a fresh key would buy
 * instead is 1,204 remounts of one report whose content changes twice a second,
 * each of them re-announcing itself to a screen reader.
 */
type Background =
  /**
   * `progress` is `null` for the walk, which is silent: `collect_images` runs to
   * completion before the first `scan-progress`, so on a large or networked tree
   * the only thing the frontend knows for minutes is that it asked for a scan.
   */
  | { run: string; kind: "scan"; progress: ScanProgress | null }
  | { run: string; kind: "pregen"; progress: PregenProgress };

/** The one line the report shows, which is the phase the work is in. */
function backgroundLine(work: Background): string {
  if (work.kind === "pregen") {
    const { done, total } = work.progress;
    return `Preparing thumbnails… ${grouped(done)} of ${grouped(total)}`;
  }
  if (!work.progress) return "Scanning…";
  const { scanned, added } = work.progress;
  return `Scanning… ${counted(scanned, "file")}, ${grouped(added)} new`;
}

export interface Toaster {
  /** Raise a toast, replacing whatever is in the slot. */
  show: (request: ToastRequest) => void;
  /**
   * Press the Undo on the toast that is up, if it has one. The shell's `Ctrl+Z`
   * is the only caller: it is a shortcut for the button on screen and not an
   * undo stack, so with no toast up, or a toast that offers no Undo, it does
   * nothing (ADR 0017).
   */
  pressUndo: () => void;
  /**
   * Say that a scan has just been started, and on what folder.
   *
   * The one thing about background work that no backend event can tell this
   * surface. The walk emits nothing at all, so `Scanning…` can only come from
   * the call that asked for it; and `scan-complete` names no folder, so the
   * ending that reports an empty one has to have been handed the path as the
   * curator wrote it. Reading the Round before the walk starts belongs here for
   * the same reason: by the time the scan is over, the Round it moved is gone.
   *
   * Its one caller is the Scan button in Settings, which inherited both the call
   * and the button from `ScanView` when that file was deleted (ADR 0020).
   */
  scanStarted: (folder: string) => void;
}

const ToasterContext = createContext<Toaster | undefined>(undefined);

/** The last segment of an absolute path, which is the name the file ended up with. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Whether a reject's destination read-out already told the curator where the
 * file went.
 *
 * A leading `/` or `~` resolves absolute, so the bar names the place and
 * repeating it on every reject is noise during a fast review pass. Everything
 * else gets the path line: a relative destination names a rule rather than a
 * place, and under ADR 0011 a nested library then has one `rejected/` folder per
 * source folder with nothing on screen saying which one took the file. A `$VAR`
 * lands here too, because the frontend cannot resolve one without a round trip
 * and naming a path the bar could also have named costs a line rather than being
 * wrong.
 *
 * #78 puts ADR 0018's read-out on Review's bar, which computes this same boolean
 * from `expand_path` for its own clause; this is the syntactic stand-in until
 * then.
 */
function destinationNamesAPlace(destination: string): boolean {
  return destination.startsWith("/") || destination.startsWith("~");
}

/**
 * The reject's path line: the final path when the file was renamed or when the
 * destination resolved relative, which is "name the path whenever the read-out
 * could not" (ADR 0017 as amended by ADR 0018).
 *
 * `unique_destination` suffixes ` (n)` on a collision, so comparing the returned
 * basename against the wallpaper's own filename is how a rename is spotted.
 */
function rejectPathLine(
  filename: string,
  destination: string,
  finalPath: string,
): string | undefined {
  const renamed = basename(finalPath) !== filename;
  if (renamed || !destinationNamesAPlace(destination)) return finalPath;
  return undefined;
}

/** `Couldn't <do the thing to> <filename>`, split around the name. */
const FAILED_TITLE: Record<TransitionAction, { prefix: string; suffix: string }> =
  {
    keep: { prefix: "Couldn't keep ", suffix: "" },
    reject: { prefix: "Couldn't reject ", suffix: "" },
    restore: { prefix: "Couldn't restore ", suffix: "" },
    "make-active": { prefix: "Couldn't make ", suffix: " Active" },
  };

/** The backend's own account of a failure, which is the only one there is. */
function backendMessage(error: unknown): string {
  return isAppError(error) ? error.message : String(error);
}

/**
 * Wrap an Undo so that pressing it twice runs it once.
 *
 * `Ctrl+Z` and the button are two routes to the same closure and the call is
 * async, so the toast that offered it is still up while the undo is in flight. A
 * second press would restore a file that is already back, which
 * `restore_wallpaper` answers with `invalid_transition` — an error toast for
 * something that worked.
 */
function once(run: () => void): () => void {
  let pressed = false;
  return () => {
    if (pressed) return;
    pressed = true;
    run();
  };
}

/**
 * The shell's toast surface: two slots, `transient ?? background`, and at most
 * one mounted toast.
 *
 * It wraps the shell's body rather than sitting beside it, so that the viewport
 * lands as the last child of the shell root while `show` is in scope for
 * everything above it — the views, and the shell's own keyboard handler. Radix
 * portals each toast into the viewport, so where the `<Toast>` sits in this tree
 * is not what places it on screen; the viewport's own z-index is (ADR 0017,
 * ADR 0022).
 *
 * The upper slot holds ADR 0017's four transitions and every error; the lower
 * holds ADR 0021's report of work nobody clicked for. Precedence is what lets
 * one mounted toast serve two lifetimes: background work never replaces a
 * transition, because the curator's own click outranks a machine's progress, and
 * a transition never destroys the report, because it did not replace anything.
 *
 * `lightboxOpen` is one of the two surfaces the report is suppressed on rather
 * than merely covered by. It arrives as a prop because the state has to be read
 * here and written inside the shell, and this component is the one wrapping the
 * other; `LightboxHostContext` carries the setter down to whoever opens one.
 */
export function ToastSurface({
  children,
  lightboxOpen = false,
}: {
  children: ReactNode;
  lightboxOpen?: boolean;
}) {
  const { view, setView } = useApp();
  const { publish, requestRefetch } = useAppEvents();
  const [transient, setTransient] = useState<Transient | null>(null);
  const [background, setBackground] = useState<Background | null>(null);
  /** The run the curator said "stop telling me" about; `null` for none. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  // A counter and not a hash of the message, because the key's whole job is to
  // differ: two keeps of the same wallpaper are two messages and the second one
  // owes a full eight seconds.
  //
  // One counter for both slots, and that is load-bearing. React reconciles the
  // two at the same position, so a transient keyed `1` arriving over a report
  // keyed `1` is one element type under one key: React would keep the mounted
  // toast and swap its props, handing a pinned report's node — and its open
  // state, and its `onOpenChange` — to an eight-second message.
  const keys = useRef(0);

  /** The folder the running scan was asked for, as the curator wrote it. */
  const scanFolder = useRef("");
  /**
   * The Round as it stood when the running scan started, which is the only thing
   * the "back to Round 1" sentence can be judged against: a scan that adds
   * unseen files sends the Round backwards, and one that adds files to a library
   * still on its first Round moves nothing (ADR 0008).
   */
  const roundBeforeScan = useRef<number | null>(null);

  /**
   * Put a message with no filename in it into the upper slot.
   *
   * The whole title is one string here, the way `load-failed` already writes it:
   * nothing a scan or a pass has to say names a file, so there is nothing in
   * these titles that may be truncated.
   */
  const raise = useCallback(
    (title: string, description: string | undefined, pinned: boolean) => {
      setTransient({
        key: String(++keys.current),
        prefix: title,
        filename: "",
        suffix: "",
        description,
        pinned,
      });
    },
    [],
  );

  const show = useCallback(
    // A named function expression, so the Undo closures below can raise the
    // toast that answers them without a ref to break the cycle.
    function show(request: ToastRequest) {
      const key = String(++keys.current);

      switch (request.kind) {
        case "kept": {
          const { view, id, filename } = request;
          setTransient({
            key,
            prefix: "Kept ",
            filename,
            suffix: "",
            pinned: false,
            // The keep inverse is one column write with nothing on disk to move,
            // which is why it is `unkeep_wallpaper` and not a Restore.
            undo: once(() => {
              void client
                .unkeepWallpaper(id)
                .then(() => {
                  publish({ type: "status-changed", id, status: "active" });
                  show({ kind: "made-active", filename });
                })
                .catch((error: unknown) => {
                  console.error("Failed to undo a keep:", error);
                  show({
                    kind: "failed",
                    view,
                    action: "make-active",
                    filename,
                    error,
                  });
                });
            }),
          });
          return;
        }

        case "rejected": {
          const { view, id, filename, destination, finalPath } = request;
          setTransient({
            key,
            prefix: "Rejected ",
            filename,
            suffix: "",
            description: rejectPathLine(filename, destination, finalPath),
            pinned: false,
            undo: once(() => {
              void client
                .restoreWallpaper(id)
                .then((restoredTo) => {
                  publish({ type: "status-changed", id, status: "active" });
                  show({ kind: "restored", filename, finalPath: restoredTo });
                })
                .catch((error: unknown) => {
                  console.error("Failed to undo a reject:", error);
                  show({
                    kind: "failed",
                    view,
                    action: "restore",
                    filename,
                    error,
                  });
                });
            }),
          });
          return;
        }

        case "restored":
          setTransient({
            key,
            prefix: "Restored ",
            filename: request.filename,
            suffix: "",
            // Always, unlike a reject's. A restore's Origin appears nowhere on
            // screen, so this line is the only account of where the file went.
            description: request.finalPath,
            pinned: false,
          });
          return;

        case "made-active":
          setTransient({
            key,
            prefix: "",
            filename: request.filename,
            suffix: " is Active again",
            pinned: false,
          });
          return;

        case "failed": {
          const { view, action, filename, error } = request;
          // A stale row and not a user error: the view acted on something that
          // had already changed under it, which ADR 0015's patch events exist to
          // prevent. No patch can say what the row should be instead, and
          // leaving it on screen means the curator's next click reproduces it,
          // so the view that acted refetches (ADR 0017).
          const stale = isAppError(error) && error.kind === "invalid_transition";
          if (stale) requestRefetch(view);
          setTransient({
            key,
            prefix: stale ? "" : FAILED_TITLE[action].prefix,
            filename,
            suffix: stale ? " has already changed" : FAILED_TITLE[action].suffix,
            description: stale ? undefined : backendMessage(error),
            pinned: true,
          });
          return;
        }

        case "load-failed":
          setTransient({
            key,
            prefix: `Couldn't load ${request.noun}`,
            filename: "",
            suffix: "",
            description: backendMessage(request.error),
            pinned: true,
          });
          return;

        case "refused":
          setTransient({
            key,
            prefix: "Can't restore ",
            filename: request.filename,
            suffix: "",
            description: request.reason,
            pinned: true,
          });
          return;
      }
    },
    [publish, requestRefetch],
  );

  const scanStarted = useCallback(
    (folder: string) => {
      scanFolder.current = folder;
      roundBeforeScan.current = null;
      // Read now rather than held from boot, because "now" is the only moment
      // this number is knowable: the walk takes minutes, the inserts that follow
      // move the Round, and by the time `scan-complete` arrives the answer has
      // already changed. A read that fails costs the sentence and nothing else.
      void client
        .getStats()
        .then((stats) => {
          roundBeforeScan.current = stats.round;
        })
        .catch((error: unknown) => {
          console.error("Failed to read the Round before a scan:", error);
        });
      setBackground({
        run: String(++keys.current),
        kind: "scan",
        progress: null,
      });
    },
    [],
  );

  /**
   * ADR 0021's report, and the four endings that close it out.
   *
   * The subscriptions are here rather than in the shell for the reason the rest
   * of this file exists: what a scan or a pass has to say is copy, and every
   * word the app puts in a toast is written in one place. The shell keeps its
   * own `scan-complete` listener for what a scan *does* — restart pre-generation,
   * publish `library-scanned`, rerun the boot rule — and the two never overlap.
   *
   * Registered once for the life of the shell, which is what a report of work
   * that outlives any page needs: a pass is running before the first view mounts
   * and a scan finishes wherever the curator has wandered to since.
   */
  useEffect(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    /** Empty the lower slot, but only if the work that filled it is the work that ended. */
    const clear = (kind: Background["kind"]) => {
      setBackground((prev) => (prev?.kind === kind ? null : prev));
    };

    void Promise.all([
      client.onScanProgress((progress) => {
        // The run is spent outside the updater, which has to stay pure. A
        // counter's only job is to differ, so one burnt on a run that turns out
        // to be already open costs nothing.
        const run = String(++keys.current);
        setBackground((prev) =>
          prev?.kind === "scan"
            ? { ...prev, progress }
            : { run, kind: "scan", progress },
        );
      }),

      client.onScanComplete(({ added_count, scanned_count }) => {
        clear("scan");

        // Only a walk that turned up nothing at all is an empty folder, and it
        // pins with the folder named, because a mistyped Library root is
        // something the curator has to see and fix. A rescan that adds nothing
        // is the common case and is the row below.
        if (scanned_count === 0) {
          raise(
            "No supported images found",
            scanFolder.current || undefined,
            true,
          );
          return;
        }

        if (added_count === 0) {
          raise(
            "No new wallpapers",
            `${counted(scanned_count, "file")} scanned, all already in your library.`,
            false,
          );
          return;
        }

        const before = roundBeforeScan.current;
        roundBeforeScan.current = null;
        // The message waits on the read rather than being amended by it. A
        // number moving backwards on Rank's headline needs its explanation in
        // the same sentence the curator reads once, and `get_stats` costs 0.3ms.
        void client
          .getStats()
          .then((stats) => {
            // The headline moves through the bus, so Rank hears about the Round
            // a scan just sent it back to without knowing a scan happened.
            publish({ type: "stats-changed", stats });
            raise(
              `${counted(added_count, "wallpaper")} added`,
              before !== null && stats.round < before
                ? `Back to Round ${grouped(stats.round)}. The new wallpapers have no comparisons yet.`
                : undefined,
              false,
            );
          })
          .catch((error: unknown) => {
            console.error("Failed to read the Round a scan left behind:", error);
            raise(`${counted(added_count, "wallpaper")} added`, undefined, false);
          });
      }),

      client.onScanFailed(({ message }) => {
        clear("scan");
        raise("Couldn't finish the scan", message, true);
      }),

      client.onPregenProgress((progress) => {
        const run = String(++keys.current);
        setBackground((prev) => {
          // A scan outranks the pass underneath it: it is the work the curator
          // asked for, it is the shorter of the two, and `scan-complete`
          // restarts the pass anyway, so what is dropped here is a run that is
          // about to be replaced.
          if (prev?.kind === "scan") return prev;
          if (prev?.kind === "pregen") return { ...prev, progress };
          return { run, kind: "pregen", progress };
        });
      }),

      client.onPregenComplete(({ generated, failed, cancelled: byRequest }) => {
        clear("pregen");
        // Two of the three endings say nothing at all, and that is the decision
        // rather than an omission. Nobody acts on "1,204 thumbnails ready", the
        // pass runs on essentially every launch, and a notification whose only
        // content is that a background task stopped is what trains people to
        // dismiss notifications unread. A cancel says it more directly still,
        // since the curator pressed the button.
        if (byRequest || failed === 0) return;
        raise(
          `${counted(generated, "thumbnail")} ready, ${grouped(failed)} failed`,
          undefined,
          false,
        );
      }),
    ]).then((offs) => {
      if (cancelled) {
        for (const off of offs) off();
        return;
      }
      unlistens.push(...offs);
    });

    return () => {
      cancelled = true;
      for (const off of unlistens) off();
    };
  }, [publish, raise]);

  // Read by `pressUndo`, which is registered once for the life of the shell and
  // would otherwise press the first render's toast forever.
  const latest = useRef<Transient | null>(null);
  useEffect(() => {
    latest.current = transient;
  });

  const pressUndo = useCallback(() => {
    latest.current?.undo?.();
  }, []);

  const toaster = useMemo<Toaster>(
    () => ({ show, pressUndo, scanStarted }),
    [show, pressUndo, scanStarted],
  );

  /**
   * A closed toast keeps its record, loses its Undo, and stops covering the slot.
   *
   * Clearing the slot outright would unmount the toast mid-fade, since Radix
   * keeps the node around for its own exit animation; leaving the Undo on a
   * record whose toast is gone would let `Ctrl+Z` press a button that is not on
   * screen. Re-rendering under the same key restarts nothing, which is the
   * other half of what makes the key load-bearing.
   */
  const disarm = useCallback((key: string) => {
    setTransient((prev) =>
      prev?.key === key ? { ...prev, undo: undefined, closed: true } : prev,
    );
  }, []);

  /**
   * The lower slot, as it renders: suppressed outright on the two surfaces that
   * already carry the same numbers, and hidden for the rest of a run the curator
   * has closed.
   *
   * A full-screen lightbox is the one place the app asks for the whole window,
   * and ADR 0017's reason for putting a toast over it — confirming a keep or a
   * reject fired from inside it — does not extend to a report about work nobody
   * started. Settings prints the scan's counter on its button and the pass's in
   * its Thumbnails line, and three copies of one number on one screen is not
   * emphasis (ADR 0020, ADR 0021).
   */
  const report =
    background &&
    background.run !== dismissed &&
    view !== "settings" &&
    !lightboxOpen
      ? background
      : null;

  // `transient ?? background`, with "a message is on screen" rather than "the
  // slot holds a message" as the test: an expired transition hands the surface
  // back, and one that has expired with nothing waiting keeps its own node for
  // the length of its fade.
  const covering = transient !== null && !(transient.closed && report);

  return (
    <ToasterContext.Provider value={toaster}>
      <ToastProvider>
        {children}

        {covering && transient ? (
          <Toast
            key={transient.key}
            // Every one of these follows the curator's own click, so the live
            // region interrupts rather than waits. The background report below
            // is the only `background` toast the app has.
            type="foreground"
            duration={transient.pinned ? Infinity : undefined}
            onOpenChange={(open) => {
              if (!open) disarm(transient.key);
            }}
          >
            <ToastTitle className="flex">
              {transient.prefix && (
                <span className="shrink-0 whitespace-pre">
                  {transient.prefix}
                </span>
              )}
              {transient.filename && (
                <span
                  data-slot="toast-filename"
                  className="min-w-0 truncate"
                  title={transient.filename}
                >
                  {transient.filename}
                </span>
              )}
              {transient.suffix && (
                <span className="shrink-0 whitespace-pre">
                  {transient.suffix}
                </span>
              )}
            </ToastTitle>

            {transient.description && (
              <ToastDescription>{transient.description}</ToastDescription>
            )}

            {transient.undo && (
              // Named twice over: "Undo" on the button, and the binding spelled
              // out for a reader who cannot tab to it inside eight seconds.
              <ToastAction altText="Undo (Ctrl+Z)" onClick={transient.undo}>
                Undo
              </ToastAction>
            )}

            {transient.pinned && <ToastClose />}
          </Toast>
        ) : (
          report && (
            <Toast
              // The run, not the payload: a progress event mutates this toast
              // rather than remounting it, which is what keeps a report that
              // changes twice a second from re-announcing itself 1,204 times
              // (ADR 0021). Radix memoises `announceTextContent` on the node, so
              // a screen reader hears the first line and none of the updates —
              // and that is Radix's to do, as long as the node holds still.
              key={report.run}
              // A launch pass follows no click at all, and a scan follows one
              // made minutes ago on a page the curator has left, so the live
              // region waits its turn rather than interrupting.
              type="background"
              // Pinned. `startTimer` short-circuits `Infinity`, so this toast
              // arms no close timer and the pause machinery is inert for it: the
              // report goes when the work does, or when the curator says so.
              duration={Infinity}
              onOpenChange={(open) => {
                // "Stop telling me", for the rest of this run. A later scan or a
                // later pass reports again, because it is a different run and
                // the curator asked for it.
                if (!open) setDismissed(report.run);
              }}
            >
              <ToastTitle>{backgroundLine(report)}</ToastTitle>

              {/* Only the pass draws one. `scan-progress` carries no total, the
                  walk before it emits nothing, and the loop that does emit
                  chunks at 256 inserts, so a real library fires one event at
                  100% — any bar drawn for it would be an animation standing in
                  for information the frontend does not have (ADR 0021). */}
              {report.kind === "pregen" && (
                <Progress
                  className="col-start-1 mt-2 h-1"
                  aria-label="Thumbnail progress"
                  // A percentage rather than a count, because the indicator
                  // translates by `100 - value` and reads no `max`.
                  value={
                    report.progress.total === 0
                      ? 0
                      : Math.round(
                          (report.progress.done / report.progress.total) * 100,
                        )
                  }
                />
              )}

              {/* Cancel lives on Settings, on the button that becomes it while a
                  pass runs (ADR 0020), so the report's one action is the route
                  there. It carries no focus key: that field is typed
                  `keyof Settings` and Thumbnails is a section rather than a
                  setting. `preventDefault` keeps the report up — a `ToastAction`
                  is a `ToastClose` underneath, and "let me do something about
                  it" is not "stop telling me". */}
              <ToastAction
                altText="Settings"
                onClick={(event) => {
                  event.preventDefault();
                  setView("settings", { returnTo: view });
                }}
              >
                Settings
              </ToastAction>

              <ToastClose />
            </Toast>
          )
        )}

        <ToastViewport />
      </ToastProvider>
    </ToasterContext.Provider>
  );
}

export function useToaster(): Toaster {
  const toaster = useContext(ToasterContext);
  if (toaster === undefined) {
    throw new Error("useToaster must be used within a ToastSurface");
  }
  return toaster;
}
