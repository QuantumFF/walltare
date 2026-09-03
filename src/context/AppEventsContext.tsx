import { useApp, type View } from "@/context/AppContext";
import type { Stats, Wallpaper } from "@/lib/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

/**
 * What one view tells the others about a mutation it made, so that two views
 * showing the same wallpaper never disagree.
 *
 * These are the app's own in-process events and not the backend's: nothing here
 * crosses IPC, and `client.ts` stays the only place a Tauri event is listened
 * for. A reject in Review changes a row in Library, and a vote in Rank moves the
 * Round headline, and with the shell keeping all three views mounted there is no
 * remount left to make either of those true by accident (ADR 0015).
 *
 * Three of the four are **patches**. `status-changed` tells Library what
 * wallpaper 7 now is and Library replaces that row: no query, no thumbnail
 * request, and the card is already rendered. A patch applies immediately whether
 * the view is showing or not, because it costs nothing.
 *
 * A patch carries a whole row and still cannot insert one: nothing in a row says
 * where it belongs in an ordering by Score, so a view can replace a row it
 * already holds or drop it, and never place one it does not have. Only
 * `library-scanned` changes which rows exist, and only it forces a refetch —
 * deferred until the view is next shown, which is what `useRefetchWhenShown` is
 * for.
 *
 * That bound is position, not ignorance, and re-arguing it is what ADR 0023
 * owed. The rule shipped as "an event carries an id and not a row", which is the
 * premise this payload retires; what survives is the leg that was always the
 * real one. A wallpaper that just became Active arrives with Review's next
 * fetch because Review is ordered by Score and the row does not say where it
 * falls.
 *
 * A query library was considered for this and turned down. It caches JSON worth
 * 0.3ms and does nothing for DOM, scroll, or the fifty image requests that are
 * the actual cost of a view switch, and with the views kept mounted there is no
 * cache left to manage: each one already holds its list and needs only to be
 * told what changed.
 */
export type AppEvent =
  /**
   * Review and Library both hold rows keyed on Status, so both listen — through
   * the one module that owns a page's rows and every transition on them.
   *
   * The whole row, as the command that wrote it answered. A `Pick` of the
   * columns a file move touched came before it, and the complete-or-absent
   * reasoning that `Pick` needed goes with it: a whole row replacing a whole row
   * cannot half-wipe an Origin, which is the bug #141 was (ADR 0023).
   *
   * `stats-changed` already carries a whole `Stats`, so nothing about the bus is
   * new here.
   */
  | { type: "status-changed"; wallpaper: Wallpaper }
  /**
   * The two wallpapers in a Comparison, which is every wallpaper whose Score
   * just moved. The new Scores are deliberately not in here: a Comparison
   * answers with the whole `Stats` and not with two ratings, and asking the
   * backend for the two rows would be a query on the hot path of voting.
   */
  | { type: "score-changed"; ids: [number, number] }
  /** The Round, the counts and the fractions, all of them, as the backend just reported them. */
  | { type: "stats-changed"; stats: Stats }
  /**
   * Wallpapers a scan added. Zero is published too and says something worth
   * knowing: a scan only ever inserts, so a scan that added nothing cannot have
   * changed which rows exist, and nothing owes a refetch for it.
   */
  | { type: "library-scanned"; added: number };

/**
 * The shell's publish/subscribe seam, and the whole of it.
 *
 * Views reach it through `useAppEvents`, `useAppEvent` and
 * `useRefetchWhenShown` rather than through these members directly;
 * `subscribe` exists for those hooks.
 *
 * A `requestRefetch(view)` channel stood beside these two, with an
 * `onRefetchRequest` to receive it. It spent two of four members delivering one
 * message read at one line, and the module that would now be publishing it is
 * the module that reads it — so the stale-row refetch is the page's own fetch,
 * asked for through the `owe` that `useRefetchWhenShown` returns (ADR 0023).
 */
export interface AppEventBus {
  publish: (event: AppEvent) => void;
  subscribe: (handler: (event: AppEvent) => void) => () => void;
}

const AppEventsContext = createContext<AppEventBus | undefined>(undefined);

/**
 * Holds the subscriber sets for the life of the app.
 *
 * The sets live in refs and the bus itself is memoised once, so subscribing
 * re-renders nothing and no consumer re-renders because another one subscribed.
 * A publish is a synchronous fan-out, which is what lets a patch land in the
 * same React batch as the action that caused it.
 */
export function AppEventsProvider({ children }: { children: ReactNode }) {
  const listeners = useRef<Set<(event: AppEvent) => void>>(new Set());

  const bus = useMemo<AppEventBus>(
    () => ({
      // Iterated over a copy: a handler may unsubscribe — a view dropping the
      // last row it held, say — and mutating a Set mid-iteration would skip
      // whichever subscriber came after it.
      publish: (event) => {
        for (const handler of [...listeners.current]) handler(event);
      },
      subscribe: (handler) => {
        listeners.current.add(handler);
        return () => {
          listeners.current.delete(handler);
        };
      },
    }),
    [],
  );

  return (
    <AppEventsContext.Provider value={bus}>{children}</AppEventsContext.Provider>
  );
}

export function useAppEvents(): AppEventBus {
  const bus = useContext(AppEventsContext);
  if (bus === undefined) {
    throw new Error("useAppEvents must be used within an AppEventsProvider");
  }
  return bus;
}

/**
 * Listen for every app event, with one subscription for the life of the
 * component.
 *
 * `handler` is re-read on each publish rather than re-subscribed on each
 * render, so it closes over this render's state without the subscription
 * churning — which matters because a handler is registered once and then reads
 * whatever the view is currently showing.
 */
export function useAppEvent(handler: (event: AppEvent) => void): void {
  const bus = useAppEvents();
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => bus.subscribe((event) => latest.current(event)), [bus]);
}

/**
 * Refetch when the view is next shown, for the things that can change which
 * rows exist.
 *
 * A hidden view refetching straight away is the one thing this whole
 * arrangement must not do. ADR 0012 gave pre-generation a single dedicated
 * thread precisely so that background image work never queues ahead of the rank
 * view's next pair, and a hidden Library pulling a page of thumbnails mid-vote
 * walks straight back into that — it is the same contention, arriving from the
 * frontend instead. So the fetch is owed, not made, and it is paid on the
 * switch the curator is already waiting through.
 *
 * `refetch` is called at most once per thing owed. Being shown when the news
 * arrives is not a special case: the debt is settled immediately, because
 * "showing" is the only condition there is.
 *
 * It **returns that `owe`**, which is what lets a stale row ask for the same
 * deferral without a channel on the bus. A transition refused because the row
 * had already changed underneath is the caller: it owes the page a fetch, and
 * the deferral still holds for an Undo pressed eight seconds later on a page the
 * curator has left (ADR 0023).
 */
export function useRefetchWhenShown(
  view: View,
  refetch: () => void,
): () => void {
  const showing = useApp().view === view;
  const owed = useRef(false);

  // Read by the two subscriptions below, which are registered once and would
  // otherwise close over the first render's answers forever.
  const latest = useRef({ showing, refetch });
  useEffect(() => {
    latest.current = { showing, refetch };
  });

  const owe = useCallback(() => {
    if (latest.current.showing) latest.current.refetch();
    else owed.current = true;
  }, []);

  useAppEvent((event) => {
    // The one event that changes which rows exist. A patch never does, so a
    // reject somewhere else costs this view nothing at all.
    if (event.type !== "library-scanned") return;
    // A scan inserts and never deletes, so nothing was added means nothing
    // moved and the rows this view holds are still the right ones.
    if (event.added === 0) return;
    owe();
  });

  useEffect(() => {
    if (!showing || !owed.current) return;
    owed.current = false;
    refetch();
  }, [showing, refetch]);

  return owe;
}
