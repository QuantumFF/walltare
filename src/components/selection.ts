/**
 * Which wallpaper a surface is pointed at, and the one way that fact leaves it.
 *
 * The cursor belongs to whichever surface draws the list — the grid since #230,
 * and Review's strip since #265 — and what crosses the seam is a reading of it
 * rather than the state behind it. That is ADR 0022's rule, held through two
 * surfaces: the lightbox is a second rendering of somebody's selection rather
 * than a cursor of its own, so there is no rule keeping two cursors in step
 * because there are still not two things to sync.
 *
 * It sits here rather than inside `WallpaperGrid.tsx`, where it was written,
 * because the strip is not a grid and must not import one to hold a cursor. What
 * moved is the cursor rule, the publication and the handle; every reason for
 * each of them is unchanged, and `WallpaperGrid.test.tsx` and
 * `prop-identities.test.tsx` are what say the move changed nothing.
 */
import type { Wallpaper } from "@/lib/client";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";

/**
 * A surface's selection, as that surface publishes it.
 *
 * Five members and not seven. Where the focus is used to be two of them, and it
 * is the drawing surface's own — `SelectionHandle` below is what a page asks
 * through (ADR 0029).
 */
export interface WallpaperSelection {
  /** The selected Wallpaper, or `null` when the list is empty. */
  wallpaper: Wallpaper | null;
  /**
   * Where it sits in the whole list, and `-1` when nothing is selected. The
   * whole list and not the window a virtualising host mounted, which is what
   * lets the lightbox's position line read `3 / 50` (ADR 0016, ADR 0022).
   */
  index: number;
  /**
   * How long that list is, which is the other half of `3 / 50`.
   *
   * Carried here rather than left to the page to hand over beside the
   * selection, because it is the same list: a page reading `wallpapers.length`
   * for the lightbox could pass a count that the selection was never resolved
   * against, and the position line is the one place that disagreement would be
   * legible — as a `51 / 50`. #139's arrow buttons read it for the same reason,
   * since being at the end of the list is what makes them unavailable.
   */
  length: number;
  /**
   * Select the wallpaper at an index in the whole list, with out of range
   * clamped into it: the arrow arithmetic sits on both sides of this seam — the
   * grid moves by column and by row, the strip and the lightbox by one — and
   * none of them can select a wallpaper that is not there.
   */
  moveTo: (index: number) => void;
  /**
   * Select a wallpaper by id, whether or not the list holds it yet. Review's
   * failure handler is the caller: it re-inserts the card it removed
   * optimistically, by which time the selection has already moved on to the
   * next wallpaper (ADR 0022).
   */
  selectId: (id: number) => void;
}

/**
 * What a surface drawing a list can be asked from outside it, and what it says
 * back.
 *
 * A handle rather than members on `WallpaperSelection`, because both facts on it
 * belong to the surface: it holds what the last commit focused and whether the
 * curator is inside, and since #230 it holds the cursor as well. A request the
 * page held too made "does the selection have focus" a question with four
 * answers across a seam (ADR 0029), and a cursor the page held made an arrow key
 * a re-render of the page (ADR 0041).
 *
 * The publication is two methods and no value, because that is what
 * `useSyncExternalStore` reads and what lets a subscriber take only the part it
 * cares about: the lightbox reads the whole selection, and the hook that decides
 * whether to close it reads a boolean, so a cursor move re-renders one of them
 * and not the other. `useSelection` below is the way in.
 *
 * There is still no reader for where the focus is. Nothing outside asks whether
 * the selection has focus, because the only use for the answer is deciding
 * whether to move it, and that is what `focusSelection` is for.
 */
export interface SelectionHandle {
  /** Put the selected wallpaper on screen and focus it, revealing it first. */
  focusSelection: () => void;
  /** Hear about it whenever the published selection is replaced. */
  subscribe: (listener: () => void) => () => void;
  /** The selection as last published, which is the one the surface was drawn from. */
  selection: () => WallpaperSelection;
}

/**
 * What a subscriber reads while there is no surface to read from.
 *
 * Every page renders its own empty state *instead of* the list, so the handle is
 * `null` for exactly as long as there is nothing to select (ADR 0029 as amended
 * by #174). One object for the life of the module rather than a literal per
 * read, because `useSyncExternalStore` compares snapshots by identity and a new
 * one per render is a re-render per render.
 */
export const NO_SELECTION: WallpaperSelection = {
  wallpaper: null,
  index: -1,
  length: 0,
  moveTo: () => {},
  selectId: () => {},
};

/**
 * The drawing surface's side of the publication: the selection as last
 * committed, and everyone who asked to hear it move.
 *
 * Outside React on purpose. The point of the move is that a cursor step does not
 * re-render whoever is holding the selection for somebody else, and state held
 * anywhere above the surface does exactly that — which is what #230 is about. So
 * the cursor is React state inside the surface, where a move re-renders the
 * cells and the memo stops it at the two that changed, and this is how the same
 * object reaches a surface that is not below it at all.
 */
interface SelectionPublication {
  subscribe: (listener: () => void) => () => void;
  get: () => WallpaperSelection;
  /** Announce a selection, or nothing at all if it is the one already out. */
  publish: (next: WallpaperSelection) => void;
}

function createPublication(): SelectionPublication {
  let current = NO_SELECTION;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => current,
    publish: (next) => {
      if (next === current) return;
      current = next;
      // Over a copy, the way the column cache fans out: a listener may
      // unsubscribe on being told, and mutating the set mid-iteration would skip
      // the one after it.
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * Read a surface's published selection, or the part of it you need.
 *
 * The subscribing half of what used to be a hook the page called to *create* a
 * selection. The rule is the same rule and the object is the same object; what
 * moved is who holds it, so the caller now names a handle rather than a list
 * (#230).
 *
 * `read` is what keeps a cursor move off the surfaces that do not draw one.
 * `useSyncExternalStore` re-renders a subscriber only when its own snapshot
 * changes, so a caller reading `wallpaper !== null` hears the list empty and
 * hears nothing about an arrow key. It has to be stable for the life of the
 * caller — a module-level function, not a literal per render — because a fresh
 * one is a fresh snapshot getter on every render.
 *
 * A `null` handle is a surface that is not mounted, which every page produces by
 * rendering an empty state in its place. It reads as `NO_SELECTION` and
 * subscribes to nothing.
 */
export function useSelection<T>(
  handle: SelectionHandle | null,
  read: (selection: WallpaperSelection) => T,
): T {
  const subscribe = useCallback(
    (listener: () => void) => handle?.subscribe(listener) ?? (() => {}),
    [handle],
  );
  const snapshot = useCallback(
    () => read(handle?.selection() ?? NO_SELECTION),
    [handle, read],
  );
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * The selection rule, in the one place every surface reads it from: track the
 * wallpaper by id, fall back to the same position clamped to the new length when
 * that id is gone from the list, and fall back to nothing at all when the list
 * empties (ADR 0019).
 *
 * Resolved from the list on every render rather than stored as an index,
 * because the list is what moves: a vote reorders it, a filter change replaces
 * it, and an action removes a row from it. Index-only is simpler and wrong in
 * the case that matters — a curator who switches filter or ordering mid-sweep
 * would find the selection on whatever now occupies that slot.
 *
 * Falling back to the position is also what makes acting on a wallpaper advance
 * the queue: Review removes the row it acted on, the id it was tracking is gone,
 * and the same position is now the wallpaper that was next. Nothing anywhere
 * says "advance" — one rule produces it in the grid and in the strip alike
 * (ADR 0017).
 *
 * The id is kept even when it resolves to nothing, which is what brings the
 * selection back when a failed action re-inserts the card it removed
 * optimistically (ADR 0022).
 */
export function useSelectionCursor(
  wallpapers: Wallpaper[],
): WallpaperSelection {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Where the selection was, for the fall back below. Also the initial stop:
  // with nothing selected yet the first entry holds the tab stop, because a list
  // where every cell is `tabindex="-1"` cannot be entered by keyboard at all.
  const positionRef = useRef(0);

  let index = wallpapers.findIndex((w) => w.id === selectedId);
  if (index === -1 && wallpapers.length > 0) {
    index = Math.min(positionRef.current, wallpapers.length - 1);
  }
  if (wallpapers.length === 0) index = -1;
  const wallpaper = index === -1 ? null : wallpapers[index];
  if (index !== -1) positionRef.current = index;

  const moveTo = useCallback(
    (to: number) => {
      if (wallpapers.length === 0) return;
      const at = Math.max(0, Math.min(to, wallpapers.length - 1));
      positionRef.current = at;
      setSelectedId(wallpapers[at].id);
    },
    [wallpapers],
  );

  const selectId = useCallback((id: number) => setSelectedId(id), []);

  // Memoised on the five values it carries, because the object is what the
  // surface publishes and the lightbox is a second rendering of it (ADR 0022). A
  // fresh literal per render is a fresh snapshot for every subscriber whenever
  // anything re-renders the surface, which is what #229 is about. The two
  // functions are already stable — `moveTo` follows the list it clamps against,
  // `selectId` never changes — so the identity moves when the selection moves or
  // the list does, and not otherwise.
  return useMemo(
    () => ({ wallpaper, index, length: wallpapers.length, moveTo, selectId }),
    [wallpaper, index, wallpapers.length, moveTo, selectId],
  );
}

/**
 * The cursor over a list, plus the handle that is the whole of the way to it.
 *
 * Every surface that draws a list owes the same three things — resolve the
 * cursor, build a handle once, say out loud what this commit drew — and the only
 * part that differs is what "put the selection back in focus" means, which is
 * the caller's own focus machinery. So that arrives as an argument and
 * everything else is here.
 *
 * `focusSelection` is latched rather than captured, so a caller may hand over a
 * closure rebuilt per render without the handle's identity moving. The handle's
 * identity is what a subscriber resubscribes on, so a fresh one per render would
 * be a resubscription per render and, on a page holding it in state, a render
 * that schedules the next one.
 */
export function usePublishedSelection(
  wallpapers: Wallpaper[],
  focusSelection: () => void,
  ref: Ref<SelectionHandle> | undefined,
): WallpaperSelection {
  const selection = useSelectionCursor(wallpapers);

  const latestFocus = useRef(focusSelection);
  useLayoutEffect(() => {
    latestFocus.current = focusSelection;
  });

  const [published] = useState(createPublication);
  const [handle] = useState<SelectionHandle>(() => ({
    focusSelection: () => latestFocus.current(),
    subscribe: published.subscribe,
    selection: published.get,
  }));
  useImperativeHandle(ref, () => handle, [handle]);

  // The selection this commit drew from, said out loud once it is in the DOM. In
  // a layout effect rather than during the render that resolved it, because a
  // store written mid-render is a store that can be read torn — and because what
  // a subscriber wants is the selection the cells are actually showing. A
  // subscriber's own re-render runs inside this same commit, before anything
  // paints.
  useLayoutEffect(() => {
    published.publish(selection);
  }, [published, selection]);

  return selection;
}
