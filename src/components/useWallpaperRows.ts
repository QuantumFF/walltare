import type { RejectDestination } from "@/components/RejectDestination";
import { NO_ORIGIN_REASON, useToaster } from "@/components/ToastSurface";
import type { CardAction } from "@/components/WallpaperCard";
import { useAppEvent, useAppEvents } from "@/context/AppEventsContext";
import { client, isStaleRow, type Status, type Wallpaper } from "@/lib/client";
import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * What a failed transition is logged as, per action.
 *
 * The console line names the command, which is the one thing the toast beside it
 * does not: that carries the wallpaper and the backend's own sentence, and all
 * four of these reach the curator through the same `failed` row.
 */
const FAILURE_LOG: Record<CardAction, string> = {
  keep: "Failed to keep wallpaper:",
  "make-active": "Failed to unkeep wallpaper:",
  reject: "Failed to move wallpaper:",
  restore: "Failed to restore wallpaper:",
};

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
  /**
   * The page's own `owe`, from `useRefetchWhenShown`, for a row that turned out
   * to be stale.
   *
   * `owe` rather than a view name, because nothing left in here wants page
   * identity: the toast requests no longer carry a view, and the refetch is the
   * page's own fetch deferred until it is showing (ADR 0023).
   */
  owe: () => void;
  /**
   * Review's optimistic removal, and how the selection comes back if the write
   * fails.
   *
   * Absent means nothing is optimistic, which is Library: that page keeps every
   * row it fetched, so there is no removal to undo and the published patch is
   * the only thing that edits a row.
   *
   * An object rather than a boolean, because the re-insert and the selection
   * restore only exist together. The removal advanced the selection, and under
   * ADR 0022 the lightbox *is* that selection, so a failed reject would
   * otherwise leave the picture on wallpaper N+1 while the error toast names
   * wallpaper N. Bundling them means there is no way to ask for an optimistic
   * removal without saying how the selection comes back.
   *
   * `selectId` alone and not the whole `GridSelection`, whose seven-member shape
   * is its own open question (#162).
   */
  optimistic?: { selectId: (id: number) => void };
}

export interface WallpaperRows {
  /**
   * The rows, or `null` until the page's first fetch lands — which is what
   * separates an empty library from one nobody has asked about yet.
   */
  rows: Wallpaper[] | null;
  /**
   * What the page's own fetch writes through.
   *
   * The fetch stays on the page because the two are not one fetch: Library's
   * carries a filter, an ordering, a row-set comparison and a scroll reset, and
   * Review's carries a loading flag and a limit. One module over both would be a
   * parameter per difference (ADR 0023).
   */
  setRows: Dispatch<SetStateAction<Wallpaper[] | null>>;
  /**
   * The four transitions a card can ask for, whole: the origin-less refusal, the
   * optional optimistic removal and its re-insert, the call, the published
   * patch, the toast with its Undo, the `console.error`, and the stale-row
   * refetch.
   *
   * Both pages hand this straight to the grid's and the lightbox's `onAction`,
   * so "one call, one published patch, one toast" is the only path there is
   * rather than a doc comment asking for it.
   */
  perform: (action: CardAction, wallpaper: Wallpaper) => void;
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
 * in two implementations. What is deliberately not in here is the fetch, which
 * is the one thing the two pages really do differently.
 */
export function useWallpaperRows({
  belongs,
  destination,
  owe,
  optimistic,
}: WallpaperRowsOptions): WallpaperRows {
  const [rows, setRows] = useState<Wallpaper[] | null>(null);
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
  // Nothing is ever inserted. The guard is what says so, and the reason is
  // position: an ordering by Score cannot be read off a row, so a wallpaper that
  // just became Active arrives with the page's next fetch.
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
  const call = (action: CardAction, id: number): Promise<Wallpaper> => {
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
   * The two Undos are closures over `perform`, so an Undo is the same transition
   * a card's own button makes — the removal, the patch, the toast and the
   * failure handling included. `ToastSurface` keeps the copy, the `once()`
   * double-press guard and the slot precedence; only the call left it.
   */
  const toast = (action: CardAction, was: Wallpaper, wrote: Wallpaper) => {
    switch (action) {
      case "keep":
        show({
          kind: "kept",
          filename: was.filename,
          undo: () => perform("make-active", wrote),
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
          relativeDestination: destination.relative,
          finalPath: wrote.path,
          undo: () => perform("restore", wrote),
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

  const run = async (action: CardAction, wallpaper: Wallpaper) => {
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

    // Where the row sat, or `-1` when this page is not optimistic or is not
    // holding it. An Undo pressed after the card has already gone is the second
    // case, and it must not re-insert on failure at a position it never had.
    const removedFrom = optimistic
      ? (rows?.findIndex((w) => w.id === wallpaper.id) ?? -1)
      : -1;
    if (removedFrom !== -1) {
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
      toast(action, wallpaper, wrote);
    } catch (error) {
      console.error(FAILURE_LOG[action], error);
      restore(removedFrom, wallpaper);
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

  /**
   * Puts one optimistically removed card back where it was, and the selection
   * back on it.
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
  const restore = (removedFrom: number, wallpaper: Wallpaper) => {
    if (removedFrom === -1 || !optimistic) return;
    setRows((prev) => {
      if (!prev || prev.some((w) => w.id === wallpaper.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(removedFrom, next.length), 0, wallpaper);
      return next;
    });
    optimistic.selectId(wallpaper.id);
  };

  // A declaration rather than a `const`, so the two Undo closures above can name
  // the transition they are.
  function perform(action: CardAction, wallpaper: Wallpaper) {
    void run(action, wallpaper);
  }

  return { rows, setRows, perform };
}
