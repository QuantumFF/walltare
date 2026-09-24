/**
 * Which item a surface is pointed at, and the one way that fact leaves it.
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
 * moved is the cursor rule, the publication, the handle and the roving focus;
 * every reason for each of them is unchanged, and `WallpaperGrid.test.tsx`,
 * `LibraryView.test.tsx`, `lightbox.test.tsx`, `render-scope.test.tsx` and
 * `prop-identities.test.tsx` passing untouched are what say the move changed
 * nothing a curator can see.
 *
 * **This contradicts one statement of
 * [ADR 0042](../../docs/adr/0042-the-grid-owns-the-cursor.md), deliberately.**
 * Its "the exports do not grow" section lists `GridSelection`,
 * `WallpaperGridHandle` and `useGridSelection` by name, and defends the last of
 * those keeping its name on the grounds that it is "the same fact under the same
 * label: the grid's selection". Under #265 it is not the grid's selection any
 * more — Review's strip publishes the same object from the same rule — so the
 * label is what stopped being true, and the three are `WallpaperSelection`,
 * `SelectionHandle` and `useSelection` here. What that ADR was actually
 * refusing, a new name added *beside* an old one, still holds: `WallpaperGrid`'s
 * export list is four names shorter and nothing was left behind as an alias.
 *
 * **Over any item with a key since #336.** The rule never read anything about a
 * wallpaper but its id, and Discover's grid holds Results, whose Wallhaven ids
 * are strings. So `WallpaperSelection` is `Selection<T>` and the selected item
 * is `item`, the same rename refusal as above: nothing is left behind under the
 * old name. `T` defaults to `Wallpaper`, which is what every surface but
 * Discover's draws, so their handles are spelled as they were.
 */
import type { Wallpaper } from "@/lib/client";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type Ref,
  type RefObject,
} from "react";

/**
 * What a list has to carry for a cursor to follow one entry of it: a key, unique
 * in the list. A Wallpaper's is its row id; a Result's is its Wallhaven id.
 */
export interface Keyed {
  id: string | number;
}

/**
 * A surface's selection, as that surface publishes it.
 *
 * Five members and not seven. Where the focus is used to be two of them, and it
 * is the drawing surface's own — `SelectionHandle` below is what a page asks
 * through (ADR 0029).
 */
export interface Selection<T extends Keyed = Wallpaper> {
  /** The selected item, or `null` when the list is empty. */
  item: T | null;
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
   * selection, because it is the same list: a page reading `items.length`
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
   * failure handler and its Undo are the callers: each re-inserts the card it
   * removed optimistically, by which time the selection has already moved on to
   * the next wallpaper (ADR 0022).
   */
  selectId: (id: T["id"]) => void;
}

/**
 * What a surface drawing a list can be asked from outside it, and what it says
 * back.
 *
 * A handle rather than members on `Selection`, because both facts on it
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
/**
 * How a requested focus is drawn, in the shape `focus()` itself takes.
 *
 * `focusVisible` is in WebKit and the HTML spec and not yet in the DOM lib this
 * repo's TypeScript ships, hence the widening. The platform's own three states
 * are the ones meant: drawn, not drawn, and absent for the engine's guess.
 */
export type FocusRequest = FocusOptions & {
  focusVisible?: boolean;
  /**
   * `false` to focus the selection where it stands; see `focusSelection`. The
   * surface's own field, which `focus()` is handed along with the rest and
   * ignores.
   */
  reveal?: boolean;
};

export interface SelectionHandle<T extends Keyed = Wallpaper> {
  /**
   * Put the selected wallpaper on screen and focus it, revealing it first.
   *
   * `focusVisible` is whether the focus it lands should match `:focus-visible`,
   * which is what reveals a card's overlay. A focus moved by script is one the
   * engine has to guess about, and WebKitGTK guesses visible whenever the last
   * focus was not a click — so a caller that knows how the curator got here
   * says so rather than leaving it to the guess. Left out, the guess stands.
   *
   * `reveal: false` focuses it where it stands instead, and leaves the scroll
   * alone: its entry when it has a node, and the surface's container when the
   * window has scrolled it away — the same answer the surface gives a wheel
   * that moved the window and not the selection. A keyboard hand-off is the
   * caller, returning the curator to a page whose scroll position is theirs
   * (ADR 0047).
   */
  focusSelection: (request?: FocusRequest) => void;
  /** Hear about it whenever the published selection is replaced. */
  subscribe: (listener: () => void) => () => void;
  /** The selection as last published, which is the one the surface was drawn from. */
  selection: () => Selection<T>;
}

/**
 * What a subscriber reads while there is no surface to read from.
 *
 * Every page renders its own empty state *instead of* the list, so the handle is
 * `null` for exactly as long as there is nothing to select (ADR 0029 as amended
 * by #174). One object for the life of the module rather than a literal per
 * read, because `useSyncExternalStore` compares snapshots by identity and a new
 * one per render is a re-render per render.
 *
 * Typed as holding no item and taking any key, which is what lets the one object
 * stand in for a selection over whichever list is asking.
 */
export const NO_SELECTION: Omit<Selection<never>, "selectId"> &
  Pick<Selection<Keyed>, "selectId"> = {
  item: null,
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
interface SelectionPublication<T extends Keyed> {
  subscribe: (listener: () => void) => () => void;
  get: () => Selection<T>;
  /** Announce a selection, or nothing at all if it is the one already out. */
  publish: (next: Selection<T>) => void;
}

function createPublication<T extends Keyed>(): SelectionPublication<T> {
  let current: Selection<T> = NO_SELECTION;
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
 * changes, so a caller reading `item !== null` hears the list empty and
 * hears nothing about an arrow key. It has to be stable for the life of the
 * caller — a module-level function, not a literal per render — because a fresh
 * one is a fresh snapshot getter on every render.
 *
 * A `null` handle is a surface that is not mounted, which every page produces by
 * rendering an empty state in its place. It reads as `NO_SELECTION` and
 * subscribes to nothing.
 */
export function useSelection<R, T extends Keyed = Wallpaper>(
  handle: SelectionHandle<T> | null,
  read: (selection: Selection<T>) => R,
): R {
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
 *
 * `startOn` is a wallpaper to open on, read once at mount and never again. Its
 * caller is a page handing the selection from one surface to the surface
 * replacing it: Review swaps its strip for its grid and the curator keeps their
 * place. Nothing and the first wallpaper are the same answer here, because the
 * fall back to position starts at 0.
 */
export function useSelectionCursor<T extends Keyed>(
  items: T[],
  startOn: T["id"] | null = null,
): Selection<T> {
  const [selectedId, setSelectedId] = useState<T["id"] | null>(startOn);
  // Where the selection was, for the fall back below. Also the initial stop:
  // with nothing selected yet the first entry holds the tab stop, because a list
  // where every cell is `tabindex="-1"` cannot be entered by keyboard at all.
  const positionRef = useRef(0);

  let index = items.findIndex((entry) => entry.id === selectedId);
  if (index === -1 && items.length > 0) {
    index = Math.min(positionRef.current, items.length - 1);
  }
  if (items.length === 0) index = -1;
  const item = index === -1 ? null : items[index];
  if (index !== -1) positionRef.current = index;

  const moveTo = useCallback(
    (to: number) => {
      if (items.length === 0) return;
      const at = Math.max(0, Math.min(to, items.length - 1));
      positionRef.current = at;
      setSelectedId(items[at].id);
    },
    [items],
  );

  const selectId = useCallback((id: T["id"]) => setSelectedId(id), []);

  // Memoised on the five values it carries, because the object is what the
  // surface publishes and the lightbox is a second rendering of it (ADR 0022). A
  // fresh literal per render is a fresh snapshot for every subscriber whenever
  // anything re-renders the surface, which is what #229 is about. The two
  // functions are already stable — `moveTo` follows the list it clamps against,
  // `selectId` never changes — so the identity moves when the selection moves or
  // the list does, and not otherwise.
  return useMemo(
    () => ({ item, index, length: items.length, moveTo, selectId }),
    [item, index, items.length, moveTo, selectId],
  );
}

/**
 * The cursor a surface drew from, and the two handlers that tell the roving
 * focus whether the curator is inside it.
 *
 * The handlers go on the element that owns the focus, which is the same element
 * `SelectionFocus.container` names. They are stable for the life of the caller,
 * so putting them on a container costs nothing per render.
 */
export interface PublishedSelection<T extends Keyed> {
  selection: Selection<T>;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  /**
   * `moveTo` for a key: the entry it lands on is focused drawn, which is what
   * reveals a card's overlay. A move from anywhere else leaves the drawing to
   * the engine, and WebKitGTK copies the last focus's — after a click's
   * hand-off (ADR 0047), an undrawn one, so the arrows moved an overlay nobody
   * could see. Only the key says so, because the selection also moves when an
   * action removes the row under it, and a vote made with the mouse must not
   * pin the next card's overlay open.
   */
  moveByKey: (index: number) => void;
  /**
   * `moveTo` for a mouse that moved onto an entry, so a key pressed next acts
   * on what is under it. It never scrolls, since the entry is already where
   * the pointer is, and it is focused undrawn. It takes the focus from
   * anywhere except a field the curator is typing in (`pointerMayTakeFocus`),
   * and it takes it for the entry already selected too: that is the one the
   * mouse is on.
   */
  moveByPointer: (index: number) => void;
}

/**
 * How a surface finds and reveals the entry a selection is on, which is the only
 * part of the roving focus below that a layout decides for itself.
 */
export interface SelectionFocus {
  /**
   * The element that owns the focus, and the one that takes it when there is no
   * entry left to hold it: focus on `body` starts the next Tab from the top of
   * the document rather than from the page the curator is on (ADR 0029).
   */
  container: RefObject<HTMLElement | null>;
  /**
   * The entry at a position in the whole list, or `null` when it has no node —
   * which under a window is most of the list (ADR 0016).
   */
  nodeAt: (at: number) => HTMLElement | null;
  /**
   * Put the entry at `at` on screen, which under a window means mounting its row
   * first.
   *
   * Absent scrolls whatever node the entry already has into view, which is the
   * whole of what a surface that mounts everything needs.
   */
  reveal?: (at: number) => void;
}

/**
 * The cursor over a list, the handle that is the whole of the way to it, and the
 * roving focus that answers a request to come back.
 *
 * Every surface that draws a list owes the same four things — resolve the
 * cursor, build a handle once, say out loud what this commit drew, and put focus
 * where the selection went — and none of them is about what the list looks like.
 * The grid and Review's strip differ in how an entry is found and how it is
 * brought on screen, which is what `SelectionFocus` is; everything else below is
 * one copy for both. Two copies of this effect is what the first cut of #265
 * had, and the two had already drifted before the branch was reviewed.
 *
 * The handle's identity never moves, because that is what a subscriber
 * resubscribes on: a fresh one per render would be a resubscription per render
 * and, on a page holding it in state, a render that schedules the next one. The
 * `focus` argument is latched rather than captured for the same reason, so a
 * caller may rebuild it per render.
 */
export function usePublishedSelection<T extends Keyed>(
  items: T[],
  focus: SelectionFocus,
  ref: Ref<SelectionHandle<T>> | undefined,
  startOn: T["id"] | null = null,
): PublishedSelection<T> {
  const selection = useSelectionCursor(items, startOn);
  const { item: selected, index, moveTo } = selection;

  // What made the move the next focus answers: a key (`moveByKey`), the mouse
  // (`moveByPointer`), or anything else.
  const movedByRef = useRef<"key" | "pointer" | null>(null);
  const moveByKey = useCallback(
    (to: number) => {
      movedByRef.current = "key";
      moveTo(to);
    },
    [moveTo],
  );

  const latest = useRef(focus);
  useLayoutEffect(() => {
    latest.current = focus;
  });

  // What the last commit put focus on, so a re-render that changes nothing does
  // not re-focus and re-scroll.
  const focusedRef = useRef<T["id"] | null>(null);
  const holdsFocusRef = useRef(false);
  // A page's request for the selected entry back, or `null` when nothing is
  // asking. It stays set until an entry has actually taken the focus — a reveal
  // that has not mounted the row yet leaves it outstanding for the commit that
  // follows. The request carries how the focus is to be drawn, because that
  // means nothing without it.
  //
  // One request and not a counter: two requests in a row want the same entry
  // focused, and once the asking and the answering are in one place a request
  // already outstanding is already asking for it (ADR 0029). The later one's
  // drawing is the one kept, and a reveal outranks a request that would leave
  // the scroll alone.
  const focusRequestRef = useRef<FocusRequest | null>(null);
  // The commit the request is answered on. Setting a ref renders nothing, and
  // the effect that reads it runs on a render — so the ask schedules one. Its
  // value is never read, which is what keeps it a nudge rather than a second
  // counter.
  const [, askedForFocus] = useReducer((asks: number) => asks + 1, 0);

  // The mouse on the entry already selected moves nothing, so it asks for the
  // commit the effect answers on, as a page's request does. Only when there is
  // something to answer: the entry does not hold the focus yet and may take
  // it, which keeps a mouse wandering over one card from rendering per event.
  const moveByPointer = useCallback(
    (to: number) => {
      if (to === index) {
        const node = latest.current.nodeAt(to);
        if (!pointerMayTakeFocus() || document.activeElement === node) return;
      }
      movedByRef.current = "pointer";
      moveTo(to);
      askedForFocus();
    },
    [index, moveTo],
  );

  const [published] = useState(createPublication<T>);
  const [handle] = useState<SelectionHandle<T>>(() => ({
    focusSelection: (request = {}) => {
      const outstanding = focusRequestRef.current;
      const reveal =
        request.reveal !== false ||
        (outstanding !== null && outstanding.reveal !== false);
      focusRequestRef.current = { ...request, reveal };
      askedForFocus();
    },
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

  // Focus moves here, in a layout effect after the row commits, and never inside
  // a key handler. The entry an arrow key selected may have no node yet, and
  // asking for it to be revealed is what creates one — so the reveal comes
  // first, the effect finds nothing to focus and returns, and the commit that
  // follows finds the node. Focusing a node that is not there yet is the one way
  // this pattern breaks (ADR 0019).
  //
  // No dependency array: that retry is a commit nothing in the props announces.
  // `focusedRef` is what makes it cheap — every commit that moves nothing
  // returns on the first comparison.
  useLayoutEffect(() => {
    const { container, nodeAt, reveal } = latest.current;
    const target = selected ? selected.id : null;
    // Whether a page has asked for the selected entry back, which is the one
    // route in from outside. Closing the lightbox is the caller, and it needs
    // the override below because the entry it has to land on is the one for the
    // current selection, which after two hundred steps is neither where focus is
    // nor an entry that has a node (ADR 0022).
    const request = focusRequestRef.current;
    const requested = request !== null;
    const byPointer = movedByRef.current === "pointer";
    if (byPointer) movedByRef.current = null;

    // Moving the selection must not steal focus. When the curator is somewhere
    // else in the app, a list that changes underneath updates the selection and
    // the tab stop that goes with it, and leaves focus where they put it. The
    // mouse is the exception: the curator put it on this entry to act on it.
    const pointerTakes = byPointer && pointerMayTakeFocus();
    if (!holdsFocusRef.current && !requested && !pointerTakes) {
      focusedRef.current = target;
      return;
    }

    // The pointer is already on the entry, so nothing scrolls, and the focus is
    // undrawn: the mouse is what says where the cursor is. Ahead of the checks
    // below, because the entry it is on may be the one already selected, with
    // the focus on the container after a wheel pass or on a button after a
    // click.
    if (byPointer && !requested && target !== null && index !== -1) {
      const node = nodeAt(index);
      if (!node) return;
      focusedRef.current = target;
      if (document.activeElement !== node) node.focus({ preventScroll: true });
      return;
    }

    // Nothing to do when the same wallpaper is selected and its entry still has
    // the focus. The second half of that is not redundant: React reorders a list
    // by moving DOM nodes, and moving a focused node is a removal and an
    // insertion as far as the engine is concerned, so a reorder that keeps the
    // selected wallpaper can still drop focus to `body`. Re-homing it is what
    // makes "the selection follows the wallpaper" survive a vote landing under
    // the curator's hands. A request that arrives while that entry already holds
    // the focus is answered by that fact and nothing moves.
    const active = document.activeElement;
    const holds = active instanceof Node && container.current?.contains(active);
    if (target === focusedRef.current && holds) {
      // A key that moved nothing, at either end of the list, is spent here
      // rather than left to draw whatever the selection does next.
      movedByRef.current = null;
      focusRequestRef.current = null;
      return;
    }

    // The window moved and the selection did not. A wheel gesture scrolled the
    // selected entry out of the mounted range, the node went with the window and
    // the focus went with the node.
    //
    // Re-homing it is what would make the library unscrollable. The reveal below
    // would put the window back on the selected row, so every notch of the wheel
    // is undone before it paints and the curator never gets past the entry they
    // are standing on. A reveal is for a selection that moved, and nothing moved
    // this one: they scrolled.
    //
    // Unreachable on a surface that mounts every entry, where `nodeAt` always
    // answers — which is Review in both of its layouts. It costs that surface
    // one query and is the same rule for both, rather than a flag saying which
    // kind of surface this is. `preventScroll`, because a focus move that
    // scrolled would eat the same gesture by another route.
    if (target === focusedRef.current && !requested && !nodeAt(index)) {
      container.current?.focus({ preventScroll: true });
      return;
    }

    // The list emptied under a selection that had focus, so the container takes
    // it: the alternative is focus on `body`, where the next Tab starts from the
    // top of the document rather than from the page the curator is on.
    //
    // Both listing pages swap their surface for their own empty state in the
    // same commit, so today focus lands on `body` anyway and not because of
    // anything here — the same thing `useLightbox`'s own emptied-list handler
    // records about its ask. The rule holds whichever surface a page decides to
    // show next, which is why it is stated rather than left out (ADR 0029).
    if (target === null || index === -1) {
      container.current?.focus(request ?? undefined);
      focusedRef.current = null;
      focusRequestRef.current = null;
      return;
    }

    // A request to come back without moving the page, which is the wheel's
    // answer above made on purpose: the entry if it has a node, and the
    // container if the window has scrolled it away, either one without
    // scrolling. The next arrow moves the selection, and that is a reveal.
    if (request?.reveal === false) {
      (nodeAt(index) ?? container.current)?.focus({
        ...request,
        preventScroll: true,
      });
      focusedRef.current = target;
      focusRequestRef.current = null;
      return;
    }

    if (reveal) reveal(index);
    else nodeAt(index)?.scrollIntoView({ block: "nearest", inline: "nearest" });

    const node = nodeAt(index);
    if (!node) return;
    // Drawn when a key moved it here (`moveByKey`); the engine's guess
    // otherwise.
    const byKey = movedByRef.current === "key";
    movedByRef.current = null;
    focusedRef.current = target;
    focusRequestRef.current = null;
    node.focus(request ?? (byKey ? { focusVisible: true } : undefined));
  });

  const onFocus = useCallback(() => {
    holdsFocusRef.current = true;
  }, []);

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    const container = latest.current.container.current;
    if (next instanceof Node && container?.contains(next)) return;
    // Focus that goes nowhere is the focused entry being unmounted, not the
    // curator leaving — a keep removes it under their hands, and the effect
    // above is what re-homes them. Engines disagree about whether removing the
    // focused node fires this at all, so the state it leaves has to be the same
    // either way: the node is still in the document when they left of their own
    // accord, and gone when the list took it.
    if (next === null && event.target instanceof HTMLElement) {
      if (!event.target.isConnected) return;
    }
    holdsFocusRef.current = false;
  }, []);

  return { selection, onFocus, onBlur, moveByKey, moveByPointer };
}

/**
 * Whether a mouse moved onto an entry may take the focus from wherever it is.
 *
 * Anywhere but a field the curator types in: a letter pressed there is a
 * letter, and the mouse passing over the grid on the way to somewhere must not
 * turn it into a Pick. A button a click left focused holds nothing the curator
 * would lose.
 */
function pointerMayTakeFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return true;
  return !(
    active.isContentEditable || active.matches("input, textarea, select")
  );
}
