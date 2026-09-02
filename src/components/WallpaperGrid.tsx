import {
  STATUS_ACTIONS,
  useCardAction,
  WallpaperCard,
  type CardAction,
} from "@/components/WallpaperCard";
import type { Status, Wallpaper } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

/**
 * The responsive column count, written once as the fact both halves read.
 *
 * The class and the number are the same statement — how many cards sit in a row
 * at this width — and two copies of it drift the moment someone adds a
 * breakpoint. Arrow keys that move by a stale count move the selection to a card
 * the curator is not looking at, and nothing on screen says why. So the table is
 * the source of both: the classes are joined into what the container wears, and
 * the widths are the queries the count is read from. The breakpoints are
 * Tailwind's own `md`, `lg` and `xl`, which is what makes the two agree.
 *
 * The class strings are spelled out rather than built from `columns`, because
 * Tailwind generates a utility only when it finds the literal in the source.
 */
const COLUMNS = [
  { minWidth: 0, columns: 2, className: "grid-cols-2" },
  { minWidth: 768, columns: 3, className: "md:grid-cols-3" },
  { minWidth: 1024, columns: 4, className: "lg:grid-cols-4" },
  { minWidth: 1280, columns: 5, className: "xl:grid-cols-5" },
] as const;

/** What the grid container wears, and the other half of the table above. */
export const GRID_COLUMN_CLASSES = COLUMNS.map((step) => step.className).join(
  " ",
);

/** The widest breakpoint the window has reached, as a number of cards. */
function columnsNow(): number {
  let columns: number = COLUMNS[0].columns;
  for (const step of COLUMNS) {
    if (
      step.minWidth === 0 ||
      window.matchMedia(`(min-width: ${step.minWidth}px)`).matches
    ) {
      columns = step.columns;
    }
  }
  return columns;
}

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * How many cards are in a row right now.
 *
 * Read from the same media queries the classes above compile to, rather than
 * measured off the laid-out cards. Measuring is the obvious answer and it has no
 * seam a test can reach: happy-dom reports every box as zero-sized, so a count
 * taken from `offsetTop` or `getBoundingClientRect` is 1 or the whole list under
 * test, and the only way to arrange a known count would be to stand a stub in
 * front of the component's own internals. `matchMedia` is answered from the
 * viewport, which a test sets the way `desktopColorScheme` sets the theme — the
 * real query, arranged.
 *
 * Exported because #79's virtualiser needs it too: rows are cards over columns,
 * and a library page that computed its own would be the second copy this table
 * exists to prevent.
 *
 * `resize` is the one subscription. happy-dom fires it from `setViewport` and a
 * real window fires it on every viewport change, while a `MediaQueryList`
 * `change` listener would need one subscription per breakpoint and is not fired
 * by happy-dom at all.
 */
export function useGridColumns(): number {
  return useSyncExternalStore(subscribeToWidth, columnsNow);
}

/**
 * The direct keys, as the actions each one names.
 *
 * `K` names two, because the keep slot has two ends: keeping an Active
 * wallpaper and making a Kept one Active again. One finger, one meaning — "the
 * keep decision" — and the card's Status picks which end of it applies, so `K`
 * is never a keep on one card and something unrelated on the card beside it.
 *
 * `Delete` rather than a letter for reject is what keeps `R` unambiguous. A
 * Rejected card offers only Restore and a non-Rejected card only Reject, so one
 * `R` for both is technically unambiguous and would still be the same finger
 * producing opposite outcomes on cards sitting next to each other in a mixed
 * grid. `Delete` also carries the right shape for the one action here that moves
 * a file (ADR 0019).
 */
const KEY_ACTIONS: Record<string, readonly CardAction[]> = {
  k: ["keep", "make-active"],
  delete: ["reject"],
  r: ["restore"],
};

/**
 * What a key means on a card of this Status, or `null` for nothing at all.
 *
 * The answer is an intersection rather than a second table: the key names
 * candidates, and `STATUS_ACTIONS` — the same table the card's buttons render
 * from — says which of them this row actually offers. So a key the Status has no
 * action for does nothing, which is what makes a wrong key a wrong key rather
 * than a wrong action, and what keeps the keyboard from ever asking for a
 * transition CONTEXT.md calls an error.
 *
 * The key is lowercased so that a curator with Caps Lock on still keeps and
 * still restores.
 */
function actionFor(key: string, status: Status): CardAction | null {
  const offered = STATUS_ACTIONS[status];
  const candidates = KEY_ACTIONS[key.toLowerCase()] ?? [];
  return candidates.find((action) => offered.includes(action)) ?? null;
}

export interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /**
   * The grid's accessible name. A composite widget is one stop in the tab order,
   * so the name is all a screen reader gets on the way in (ADR 0019).
   */
  label: string;
  onAction: (action: CardAction, wallpaper: Wallpaper) => void;
  /** Review's hover treatment. See `WallpaperCardProps.animated`. */
  animated?: boolean;
  /**
   * The rows whose Score has moved since they were fetched, by id. Their badges
   * read `Score moved` rather than a number.
   *
   * A set of ids rather than a flag per card, because that is the shape the
   * event arrives in: `score-changed` names the two wallpapers in a Comparison,
   * so the page holds a set and the grid is only carrying it the last step to
   * the card that computes its own badge (#129).
   */
  scoresMoved?: ReadonlySet<number>;
  /**
   * Put the card at `index` on screen. The seam #79 hands its virtualiser to.
   *
   * It is called before the focus move and never after it, because that is the
   * order the virtualised case needs: the library grid mounts a window of about
   * thirty cards out of five thousand, so the card an arrow key selects may have
   * no DOM node yet, and asking the virtualiser to scroll the row in is what
   * creates one. The effect below then finds nothing to focus and returns; the
   * virtualiser's own commit runs it again, and by then the node exists.
   * Focusing a node that is not there yet is the one way this pattern breaks
   * (ADR 0019).
   *
   * #79 passes `(index) => virtualiser.scrollToIndex(Math.floor(index /
   * columns))`, reading `columns` from `useGridColumns` above — the same count
   * this grid moves the selection by.
   *
   * The default scrolls the selected cell into view, which is the whole of what
   * a grid that mounts every row needs.
   */
  reveal?: (index: number) => void;
  /** Layout the host owns: Review's bottom padding, a page's own gap. */
  className?: string;
}

/**
 * The grid, shared by Review and by the library page (#79).
 *
 * One tab stop with a roving selection: the container is `role="grid"`, each
 * card a `gridcell` at `tabindex="-1"` except the selected one at `0`, so Tab
 * reaches the grid once and Tab leaves it once whatever the row count. Inside,
 * the arrows move by column and by row and `Home` and `End` reach the ends.
 * This is the pattern the chrome's tablist already uses, so the app has one
 * composite-widget model rather than two (ADR 0015, ADR 0019).
 *
 * Virtualisation is what forces it. A tab order that walks DOM nodes walks the
 * window of cards ADR 0016 mounts and then leaves the grid, which puts wallpaper
 * 3,000 out of reach however the cards are marked up. Review's fifty rows would
 * work under any model, and a second interaction model to learn is worse than
 * the one it saves.
 *
 * There are no `role="row"` wrappers. The rows here are the CSS grid's own
 * auto-flow, and a wrapper per row would have to carry `display: contents` to
 * stay out of the layout — which has a history of dropping the element, and the
 * role on it, out of the accessibility tree. The cells are in reading order and
 * the column count above is what says where the rows fall.
 */
export function WallpaperGrid({
  wallpapers,
  label,
  onAction,
  animated = false,
  scoresMoved,
  reveal,
  className,
}: WallpaperGridProps) {
  const columns = useGridColumns();
  // The same entry a card's own buttons go through, so a key and a click take
  // one path — including the refusal an origin-less Restore raises, which is
  // written once and not once per trigger.
  const act = useCardAction(onAction);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Where the selection was, for the fall back below. Also the initial stop:
  // with nothing selected yet the first card holds the tab stop, because a grid
  // where every cell is `tabindex="-1"` cannot be entered by keyboard at all.
  const positionRef = useRef(0);
  // What the last commit put focus on, so a re-render that changes nothing does
  // not re-focus and re-scroll.
  const focusedRef = useRef<number | null>(null);
  const holdsFocusRef = useRef(false);

  // The selection follows the wallpaper, then the position (ADR 0019).
  //
  // Resolved from the list on every render rather than stored as an index,
  // because the list is what moves: a vote reorders it, a filter change replaces
  // it, and an action removes a row from it. Index-only is simpler and wrong in
  // the case that matters — a curator who switches filter or ordering mid-sweep
  // would find the selection on whatever now occupies that slot.
  //
  // The id is kept even when it resolves to nothing, which is what brings the
  // selection back when a failed action re-inserts the card it removed
  // optimistically (ADR 0022).
  let index = wallpapers.findIndex((w) => w.id === selectedId);
  if (index === -1 && wallpapers.length > 0) {
    index = Math.min(positionRef.current, wallpapers.length - 1);
  }
  if (wallpapers.length === 0) index = -1;
  const selected = index === -1 ? null : wallpapers[index];
  if (index !== -1) positionRef.current = index;

  const cellAt = (at: number) =>
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${at}"]`) ?? null;

  // Focus moves here, in a layout effect after the row commits, and never inside
  // the key handler. See `reveal` above for why.
  //
  // No dependency array: the retry after `reveal` mounts a row is the commit
  // that follows, and nothing in this component's props changes to announce it.
  // `focusedRef` is what makes that cheap — every commit that moves nothing
  // returns on the first comparison.
  useLayoutEffect(() => {
    const target = selected ? selected.id : null;

    // Moving the selection must not steal focus. When the curator is somewhere
    // else in the app, a list that changes underneath updates the selection and
    // the tab stop that goes with it, and leaves focus where they put it.
    if (!holdsFocusRef.current) {
      focusedRef.current = target;
      return;
    }

    // Nothing to do when the same wallpaper is selected and its cell still has
    // the focus. The second half of that is not redundant: React reorders a
    // list by moving DOM nodes, and moving a focused node is a removal and an
    // insertion as far as the engine is concerned, so a reorder that keeps the
    // selected wallpaper can still drop focus to `body`. Re-homing it is what
    // makes "the selection follows the wallpaper" survive a vote landing under
    // the curator's hands.
    const active = document.activeElement;
    const holds = active instanceof Node && gridRef.current?.contains(active);
    if (target === focusedRef.current && holds) return;

    // The list emptied under a selection that had focus, so the container takes
    // it: the alternative is focus on `body`, where the next Tab starts from the
    // top of the document rather than from the page the curator is on.
    if (target === null || index === -1) {
      gridRef.current?.focus();
      focusedRef.current = null;
      return;
    }

    if (reveal) reveal(index);
    else cellAt(index)?.scrollIntoView({ block: "nearest" });

    const cell = cellAt(index);
    if (!cell) return;
    focusedRef.current = target;
    cell.focus();
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const last = wallpapers.length - 1;
    if (index === -1 || !selected) return;

    // The direct keys, before the movement keys and on this container rather
    // than on `window`: they fire only while focus is inside the grid, which is
    // the dividing line ADR 0019 draws and the reason nothing here reaches Rank.
    // Global shortcuts live in the shell's handler; view-local keys live on the
    // element that owns the focus.
    //
    // A single keypress rejects, with no confirm and no modifier. ADR 0009
    // deleted the confirm dialog and put act-then-undo in its place, so the
    // safety is ADR 0017's toast and the `Ctrl+Z` that presses its Undo — and
    // focus stays here while that toast is up, so the next card is already
    // selected. It does mean a stray `Delete` on a focused grid moves a file,
    // which ADR 0019 wrote down as the cost rather than as an oversight.
    const action = actionFor(event.key, selected.status);
    if (action) {
      event.preventDefault();
      act(action, selected);
      return;
    }

    // #80's seam. `Enter` opens the lightbox on the selection ADR 0022 has the
    // two surfaces share; until that exists it does nothing to the wallpaper —
    // no command, no Status change — and it is answered here rather than left to
    // the movement keys' `default` so the binding has one home to arrive at.
    //
    // Nothing is prevented, deliberately. A cell's overlay buttons are still
    // buttons: `Enter` on a focused one activates it, and that activation is a
    // default action this handler would cancel on the way up.
    if (event.key === "Enter") return;

    let next: number;
    switch (event.key) {
      // Left and Right walk the list rather than stopping at the visual row
      // edge. The rows are a wrapping of one sequence, and a sweep reads it as
      // one: stopping at the edge would mean the only way past card 4 of a
      // five-column grid is Down and then Home, four times a row.
      case "ArrowRight":
        next = Math.min(index + 1, last);
        break;
      case "ArrowLeft":
        next = Math.max(index - 1, 0);
        break;
      // Up and Down do move by the row, and do nothing when there is no card in
      // that column of the next row. Clamping to the last card instead would
      // make Down mean two different things depending on how full the last row
      // happens to be.
      case "ArrowDown":
        next = index + columns > last ? index : index + columns;
        break;
      case "ArrowUp":
        next = index - columns < 0 ? index : index - columns;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }

    // Answered here even when the selection does not move, and saying so is
    // load-bearing. Rank stays mounted under `display: none` with its vote
    // listener live on `window`, and it stands down on `defaultPrevented`: an
    // arrow that reached it from a focused grid would record a permanent
    // Comparison between two wallpapers the curator cannot see (ADR 0015 as
    // amended, ADR 0019).
    event.preventDefault();
    positionRef.current = next;
    setSelectedId(wallpapers[next].id);
  };

  const handleFocus = () => {
    holdsFocusRef.current = true;
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && gridRef.current?.contains(next)) return;
    // Focus that goes nowhere is the focused card being unmounted, not the
    // curator leaving — a keep removes the row under their hands, and the effect
    // above is what re-homes them. Engines disagree about whether removing the
    // focused node fires this at all, so the state it leaves has to be the same
    // either way: the node is still in the document when they left of their own
    // accord, and gone when the list took it.
    if (next === null && event.target instanceof HTMLElement) {
      if (!event.target.isConnected) return;
    }
    holdsFocusRef.current = false;
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      // Reachable programmatically and not by Tab. The cells hold the tab stop;
      // this is where focus lands when there is no cell left to hold it.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={cn("grid gap-6", GRID_COLUMN_CLASSES, className)}
    >
      {/*
        `cell.index` is the index in the whole list and not in what is mounted,
        which is what lets #79 render a window of this map without the selection
        or the arrow keys knowing.
      */}
      {wallpapers.map((wallpaper, cardIndex) => (
        <WallpaperCard
          key={wallpaper.id}
          wallpaper={wallpaper}
          onAction={onAction}
          animated={animated}
          scoreMoved={scoresMoved?.has(wallpaper.id)}
          cell={{ index: cardIndex, selected: cardIndex === index }}
        />
      ))}
    </div>
  );
}
