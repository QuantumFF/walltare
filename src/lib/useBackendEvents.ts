/**
 * The one subscription to the backend's events.
 *
 * It sits beside `client.ts` for the reason `useExpansion` does: more than one
 * surface listens to the same events, and the registration is the same fourteen
 * lines every time — a `cancelled` flag, an array of unsubscribes, and a
 * cleanup that has to work whether or not `listen` has resolved yet. Four copies
 * of that guard were four chances to get the race wrong, and the race has no
 * symptom on a machine fast enough to resolve before the first unmount.
 *
 * Nothing here renders. What an event *means* stays with the caller: the shell
 * restarts pre-generation on a finished scan, `ToastSurface` writes the
 * sentence, and Settings moves a button's label. This only decides when a
 * handler is called.
 */
import { client } from "@/lib/client";
import type {
  PregenComplete,
  PregenProgress,
  ScanComplete,
  ScanFailed,
  ScanProgress,
} from "@/lib/client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * What a caller cares about: one optional handler per backend event, named the
 * way the frontend spells things rather than the way the wire does.
 */
export interface BackendEventHandlers {
  scanProgress?: (payload: ScanProgress) => void;
  scanComplete?: (payload: ScanComplete) => void;
  scanFailed?: (payload: ScanFailed) => void;
  pregenProgress?: (payload: PregenProgress) => void;
  pregenComplete?: (payload: PregenComplete) => void;
}

type HandlerName = keyof BackendEventHandlers;

/** The names in a fixed order, so the set a caller asked for has one spelling. */
const HANDLER_NAMES = [
  "scanProgress",
  "scanComplete",
  "scanFailed",
  "pregenProgress",
  "pregenComplete",
] as const satisfies readonly HandlerName[];

/**
 * One subscription each, tying a handler name to the event it listens for.
 *
 * Written out rather than derived from a name map because each line is what
 * carries the payload type from `BackendEvents` to the handler — a loop over
 * the names would hand every handler the union of all five and need a cast to
 * get back what the caller already declared.
 *
 * Each reads its handler out of the ref at emission time. That is the point of
 * the hook rather than an optimisation: a resubscribe is a gap, and the gap in
 * a scan or a pre-generation pass is a dropped progress event or a dropped
 * ending — a button left saying Scanning… with nothing running.
 */
const SUBSCRIBE: {
  [Name in HandlerName]: (
    latest: RefObject<BackendEventHandlers>,
  ) => Promise<() => void>;
} = {
  scanProgress: (latest) =>
    client.subscribe("scan-progress", (payload) =>
      latest.current.scanProgress?.(payload),
    ),
  scanComplete: (latest) =>
    client.subscribe("scan-complete", (payload) =>
      latest.current.scanComplete?.(payload),
    ),
  scanFailed: (latest) =>
    client.subscribe("scan-failed", (payload) =>
      latest.current.scanFailed?.(payload),
    ),
  pregenProgress: (latest) =>
    client.subscribe("pregen-progress", (payload) =>
      latest.current.pregenProgress?.(payload),
    ),
  pregenComplete: (latest) =>
    client.subscribe("pregen-complete", (payload) =>
      latest.current.pregenComplete?.(payload),
    ),
};

/**
 * Listen for the backend's events for as long as the component is mounted.
 *
 * Callers pass the handlers they want and get nothing back. Fresh closures are
 * expected — inline arrows included — and cost nothing: a handler is re-read on
 * each emission rather than re-subscribed on each render, so a caller's
 * handlers may close over this render's state without the subscription
 * churning.
 *
 * Only the events a caller named are subscribed to. The set is allowed to
 * change between renders and the subscriptions follow it, but no caller does
 * that today: they all pass an object literal with the same keys every time.
 */
export function useBackendEvents(handlers: BackendEventHandlers): void {
  const latest = useRef(handlers);
  // Declared before the subscription effect so that it has already run when
  // that one reads the ref to find out which events were asked for.
  useEffect(() => {
    latest.current = handlers;
  });

  // The set of events, flattened to a string, so the effect re-runs when a
  // caller starts or stops wanting one and never merely because a handler was
  // rebuilt by a render.
  const wanted = HANDLER_NAMES.filter((name) => handlers[name]).join(" ");

  useEffect(() => {
    // The race this hook exists to hold. `client.subscribe` resolves only once
    // the backend has the listener, which can be after React has already run
    // this cleanup — so an unsubscribe arriving late is used on arrival, and
    // one arriving in time is kept for the cleanup to call.
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    void Promise.all(
      HANDLER_NAMES.filter((name) => latest.current[name]).map((name) =>
        SUBSCRIBE[name](latest),
      ),
    ).then((offs) => {
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
  }, [wanted]);
}
