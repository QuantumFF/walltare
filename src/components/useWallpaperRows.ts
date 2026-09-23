import type { RejectDestination } from "@/components/RejectDestination";
import { NO_ORIGIN_REASON, useToaster } from "@/components/ToastSurface";
import type { TransitionAction } from "@/components/transitions";
import type { View } from "@/context/AppContext";
import {
  useAppEvent,
  useAppEvents,
  useRefetchWhenShown,
} from "@/context/AppEventsContext";
import { client, isStaleRow, type Status, type Wallpaper } from "@/lib/client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * What a failed transition is logged as, per action.
 *
 * The console line names the command, which is the one thing the toast beside it
 * does not: that carries the wallpaper and the backend's own sentence, and all
 * four of these reach the curator through the same `failed` row.
 */
const FAILURE_LOG: Record<TransitionAction, string> = {
  keep: "Failed to keep wallpaper:",
  "make-active": "Failed to unkeep wallpaper:",
  reject: "Failed to move wallpaper:",
  restore: "Failed to restore wallpaper:",
};

/**
 * Where an optimistic removal took a card from, which is what puts it back.
 *
 * Its neighbours, and not only an index. The list moves between the removal and
 * the put-back — a second reject lands while the first is in flight, or a
 * refetch reorders the worklist while the Undo is still up — and an index read
 * off the old list names a different place in the new one. "After the card it
 * followed", or failing that "before the card that followed it", survives both.
 */
interface Vacancy {
  /** The id of the card it came after, or `null` when it was first. */
  after: number | null;
  /** The id of the card it came before, or `null` when it was last. */
  before: number | null;
  /** Its index, for when both neighbours have gone as well. */
  at: number;
}

/** What a page's fetch writes its rows through. */
export type SetRows = Dispatch<SetStateAction<Wallpaper[] | null>>;

export interface WallpaperRowsOptions {
  /**
   * Whether a row of this Status still belongs in the list this page is showing.
   *
   * The one thing Library and Review differ by in the patch reducer, which is
   * why there is one reducer: Library's answer reads its Status filter, and
   * Review's is `active`, because Kept and Rejected never appear in review
   * (CONTEXT.md). A row the answer is `false` for leaves the list.
   */
  belongs: (status: Status) => boolean;
  /**
   * Where a reject goes, from the page's own `useRejectDestination`.
   *
   * Passed in and never read here. Both pages already render
   * `RejectDestinationLine` from that read-out, and a second read is a second
   * `expand_path` verdict on exactly the paths a string cannot be asked about —
   * `$HOME/bin` looks relative and is not, which is what ADR 0018 exists to
   * stop. So the string `move_wallpaper` is handed and the boolean the toast
   * reads are one answer.
   */
  destination: RejectDestination;
  /** The page these rows are shown on, which is what a refetch waits for. */
  view: View;
  /**
   * The page's own fetch, handed the setter it writes through.
   *
   * The fetch stays on the page because the two are not one fetch: Library's
   * carries a filter, an ordering, a row-set comparison and a scroll reset, and
   * Review's carries a loading flag and a limit. One module over both would be a
   * parameter per difference (ADR 0023). What this module owns is when it runs
   * again: after a scan that added rows, and after a transition the backend
   * refused over a stale row, both deferred until the page is showing.
   */
  fetch: (setRows: SetRows) => Promise<void>;
  /**
   * Review's optimistic removal, and how the selection comes back if the write
   * fails or is undone.
   *
   * Absent means nothing is optimistic, which is Library: that page keeps every
   * row it fetched, so there is no removal to undo and the published patch is
   * the only thing that edits a row.
   *
   * An object rather than a boolean, because the re-insert and the selection
   * coming back with it only exist together. The removal advanced the
   * selection, and under ADR 0022 the lightbox *is* that selection, so a failed
   * reject would otherwise leave the picture on wallpaper N+1 while the error
   * toast names wallpaper N. Bundling them means there is no way to ask for an
   * optimistic removal without saying how the selection comes back.
   *
   * `selectId` alone and not the whole `WallpaperSelection`, whose shape is its
   * own open question (#162).
   */
  optimistic?: { selectId: (id: number) => void };
}

export interface WallpaperRows {
  /**
   * The rows, or `null` until the page's first fetch lands — which is what
   * separates an empty library from one nobody has asked about yet.
   */
  rows: Wallpaper[] | null;
  /** What the page's own fetch writes through, for the fetches it runs itself. */
  setRows: SetRows;
  /**
   * The four transitions a card can ask for, whole: the origin-less refusal, the
   * optional optimistic removal and its re-insert, the call, the published
   * patch, the toast with its Undo, the `console.error`, and the stale-row
   * refetch.
   *
   * Both pages hand this straight to the grid's and the lightbox's `onAction`,
   * so "one call, one published patch, one toast" is the only path there is
   * rather than a doc comment asking for it.
   *
   * One identity for the life of the component. Both pages hand it to the grid,
   * which hands it to every mounted card, and to the lightbox — so a handler
   * rebuilt per render was a changed prop on fifty cards every time anything on
   * the page re-rendered, and it is one of the three identities #229 pinned so
   * that #230's memoised card sees a changed prop only when something changed.
   * What the transition reads is latched in a ref instead, the way
   * `useBackendEvents` latches its handlers.
   */
  perform: (action: TransitionAction, wallpaper: Wallpaper) => void;
  /**
   * The page's fetch, run now if the page is showing and on its next showing if
   * not (ADR 0015).
   */
  owe: () => void;
}

/**
 * One page's rows, and every Status transition on them (ADR 0023).
 *
 * A transition is the app's central operation and it had no module. Every one of
 * them owes the same three steps — make the call, publish the patch, raise the
 * toast — and nothing in any interface enforced that, so seven call sites spelled
 * it out and four of them rebuilt the same patch object. #141 was that failure
 * once already, and the fix was a comment.
 *
 * Library and Review differ in one predicate and one optional field instead of
 * in two implementations. What is deliberately not in here is the fetch itself,
 * which is the one thing the two pages really do differently.
 */
export function useWallpaperRows({
  view,
  fetch,
  belongs,
  destination,
  optimistic,
}: WallpaperRowsOptions): WallpaperRows {
  const [rows, setRows] = useState<Wallpaper[] | null>(null);
  const refetch = useCallback(() => {
    void fetch(setRows);
  }, [fetch]);
  const owe = useRefetchWhenShown(view, refetch);
  const { publish } = useAppEvents();
  // Every transition reports itself on the shell's one slot, and neither page
  // holds an error surface of its own: two error surfaces in one view is what
  // ADR 0017 removed, and the backend's own message says more than a string
  // written here would.
  const { show } = useToaster();

  // The patch, applied whether the page is showing or not, because replacing a
  // row that is already rendered costs nothing: no query, no thumbnail request,
  // no fetch owed.
  //
  // Two reducers folded into this one. They were one rule with two predicates,
  // which is what `belongs` is. A row is replaced wholesale rather than merged
  // field by field, so nothing here can half-write a row: the payload is what
  // the command wrote, and a whole row replacing a whole row cannot wipe an
  // Origin the way a partial patch did (#141).
  //
  // Nothing is ever inserted here. The guard is what says so, and the reason is
  // position: an ordering by Score cannot be read off a row, so a wallpaper that
  // just became Active arrives with the page's next fetch. The one card that
  // comes back sooner is an Undo of this page's own optimistic removal, and it is
  // `run` that puts it back, into the vacancy it left — not this reducer.
  useAppEvent((event) => {
    if (event.type !== "status-changed") return;
    const { wallpaper } = event;
    setRows((prev) => {
      if (!prev?.some((w) => w.id === wallpaper.id)) return prev;
      return prev.flatMap((w) => {
        if (w.id !== wallpaper.id) return [w];
        return belongs(wallpaper.status) ? [wallpaper] : [];
      });
    });
  });

  /** The one IPC call each action is. */
  const call = (action: TransitionAction, id: number): Promise<Wallpaper> => {
    switch (action) {
      case "keep":
        return client.keepWallpaper(id);
      // The keep inverse: one column write with nothing on disk to move, which
      // is why it is `unkeep_wallpaper` and not a Restore (ADR 0009).
      case "make-active":
        return client.unkeepWallpaper(id);
      case "reject":
        return client.moveWallpaper(id, destination.written);
      case "restore":
        return client.restoreWallpaper(id);
    }
  };

  /**
   * The toast a landed transition raises, on the row the backend answered with.
   *
   * `was` is the row as the page was holding it, and its `filename` is what
   * titles every one of these: a reject that collided reads `Rejected wall.jpg`
   * with the new path in the description, which is where the collision is worth
   * reading.
   *
   * The two Undos are closures over the transition, so an Undo is the same
   * transition a card's own button makes — the removal, the patch, the toast and
   * the failure handling included. `ToastSurface` keeps the copy, the `once()`
   * double-press guard and which toast wins the shell's one slot; only the call
   * left it.
   *
   * `vacancy` is where the optimistic removal took the card from, and the Undo
   * carries it so that the inverse can put the card back there. Nothing else
   * could: the patch never inserts, because a row cannot say where it belongs
   * in an ordering by Score — but the place the curator just emptied is an
   * answer to exactly that. So an Undo calls the transition through `latest`
   * rather than through `perform`, which takes no vacancy (ADR 0023 as amended).
   */
  const toast = (
    action: TransitionAction,
    was: Wallpaper,
    wrote: Wallpaper,
    vacancy: Vacancy | null,
  ) => {
    switch (action) {
      case "keep":
        show({
          kind: "kept",
          filename: was.filename,
          undo: () => void latest.current("make-active", wrote, vacancy),
        });
        return;
      case "make-active":
        show({ kind: "made-active", filename: was.filename });
        return;
      case "reject":
        show({
          kind: "rejected",
          filename: was.filename,
          // A fact about what happened rather than copy, so the surface is left
          // deciding only whether the path line has something to say.
          // `unique_destination` suffixes ` (n)` on a collision, and the
          // backend derived the `filename` it stored from the path it wrote, so
          // this cannot disagree with the database (ADR 0003, ADR 0023).
          renamed: wrote.filename !== was.filename,
          // A moving reject always changes the path, since the backend refuses
          // a destination that is the file's own folder, so an unchanged one is
          // the reject in place of a file that was already gone (ADR 0050).
          moved: wrote.path !== was.path,
          relativeDestination: destination.relative,
          finalPath: wrote.path,
          undo: () => void latest.current("restore", wrote, vacancy),
        });
        return;
      case "restore":
        show({
          kind: "restored",
          filename: was.filename,
          finalPath: wrote.path,
        });
        return;
    }
  };

  /**
   * One transition, whole.
   *
   * `refill` is an Undo's: the vacancy the transition it inverts left, or
   * `null` for every other press. A landed inverse whose row belongs here again
   * goes back into it, with the selection on it.
   */
  const run = async (
    action: TransitionAction,
    wallpaper: Wallpaper,
    refill: Vacancy | null = null,
  ) => {
    // The cohort ADR 0009's migration left with no Origin, refused with no round
    // trip because `origin_path` is on the DTO for exactly this. It lives on the
    // one path every trigger goes through — the card's button, the grid's `R`,
    // the lightbox's row — so "no IPC call" is a property of the action rather
    // than of whichever control was pressed (ADR 0019).
    if (action === "restore" && wallpaper.origin_path === null) {
      show({
        kind: "refused",
        filename: wallpaper.filename,
        reason: NO_ORIGIN_REASON,
      });
      return;
    }

    // Where the row sat, or `null` when this page is not optimistic or is not
    // holding it. An Undo pressed after the card has already gone is the second
    // case, and it must not re-insert on failure at a position it never had.
    const vacancy = optimistic ? vacancyOf(wallpaper) : null;
    if (vacancy) {
      setRows((prev) => prev?.filter((w) => w.id !== wallpaper.id) ?? prev);
    }

    try {
      const wrote = await call(action, wallpaper.id);
      // After the write and not before it. Publishing ahead of it would grey a
      // row that never changed, and the failure would be the one thing the
      // other page did not hear about.
      publish({ type: "status-changed", wallpaper: wrote });
      // Every one of them toasts, success and failure alike. The row does update
      // in place under the cursor, but a virtualised grid may reorder it or
      // filter it out from under the click, and a card that vanishes is not a
      // confirmation (ADR 0016, ADR 0017).
      toast(action, wallpaper, wrote, vacancy);
      if (belongs(wrote.status)) putBack(refill, wrote);
    } catch (error) {
      console.error(FAILURE_LOG[action], error);
      putBack(vacancy, wallpaper);
      show({
        kind: "failed",
        action,
        filename: wallpaper.filename,
        error,
      });
      // A row that had already changed underneath the page that acted, which no
      // patch can correct and which the next click would reproduce. Both kinds
      // that say so are in `isStaleRow`, and the fetch is owed rather than made
      // (ADR 0017 as amended by ADR 0025).
      if (isStaleRow(error)) owe();
    }
  };

  /** The vacancy removing this card would leave, or `null` if it is not held. */
  const vacancyOf = (wallpaper: Wallpaper): Vacancy | null => {
    const at = rows?.findIndex((w) => w.id === wallpaper.id) ?? -1;
    if (!rows || at === -1) return null;
    return {
      after: rows[at - 1]?.id ?? null,
      before: rows[at + 1]?.id ?? null,
      at,
    };
  };

  /**
   * Puts one optimistically removed card back where it was, and the selection
   * back on it: after a write that failed, or after the Undo of one that landed.
   *
   * Restoring a whole snapshot of the list would resurrect any *other* card that
   * was successfully removed while this action was in flight — the snapshot goes
   * stale the moment a second action starts. Re-inserting only the affected card
   * cannot do that.
   *
   * The selection comes back because the removal moved it on. Usually the id is
   * still the one held — the selection rule keeps it through a list that no
   * longer has it — and the call is what makes this true as well when the curator
   * stepped on while the write was in flight.
   */
  const putBack = (vacancy: Vacancy | null, wallpaper: Wallpaper) => {
    if (!vacancy || !optimistic) return;
    setRows((prev) => {
      if (!prev || prev.some((w) => w.id === wallpaper.id)) return prev;
      const follows = prev.findIndex((w) => w.id === vacancy.after);
      const precedes = prev.findIndex((w) => w.id === vacancy.before);
      let at: number;
      if (vacancy.after === null) at = 0;
      else if (follows !== -1) at = follows + 1;
      else if (vacancy.before === null) at = prev.length;
      else if (precedes !== -1) at = precedes;
      else at = Math.min(vacancy.at, prev.length);
      const next = [...prev];
      next.splice(at, 0, wallpaper);
      return next;
    });
    optimistic.selectId(wallpaper.id);
  };

  /**
   * The transition as this render would run it, latched so that `perform` below
   * can be one function for the life of the component.
   *
   * The same thing `useBackendEvents` does with a caller's handlers, and for the
   * same kind of reason: the closure is rebuilt every render because it reads
   * this render's rows and this page's `optimistic` — a declaration the page
   * rebuilds too — and the ref is what stops that churn from reaching the fifty
   * cards holding the handler. What a press runs is the last committed render's
   * transition, which is what a handler rebuilt per render was giving it anyway.
   */
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  // Stable, and the two Undo closures above name `latest` while it is still in
  // its temporal dead zone — which is fine, because they are called from a toast
  // long after this render finished.
  const perform = useCallback((action: TransitionAction, wallpaper: Wallpaper) => {
    void latest.current(action, wallpaper);
  }, []);

  return { rows, setRows, perform, owe };
}
