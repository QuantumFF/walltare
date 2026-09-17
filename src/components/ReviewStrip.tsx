import {
  ACTION_CONTROLS,
  STATUS_ACTIONS,
  type CardAction,
} from "@/components/WallpaperCard";
import { actionFor, printedKey } from "@/components/WallpaperGrid";
import {
  usePublishedSelection,
  type SelectionHandle,
} from "@/components/selection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { FILE_IS_GONE, grouped, isEvaluated, score, counted } from "@/lib/copy";
import { fittedBox, ratioOf, type Box } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

/**
 * What the hero's area is taken to be while nothing has measured it: about the
 * space a 1280x800 window leaves once the chrome, the page bar and the filmstrip
 * are out of it.
 *
 * Not an edge case. happy-dom reports every rect as zero, and ADR 0015 keeps
 * this view mounted under `display: none` while another one is showing, which
 * zeroes the box in a real browser too — so a hero with no fallback is a hero
 * that paints nothing on the way back. The same pair the grid's window carries,
 * for the same two reasons (ADR 0027).
 */
const UNMEASURED_AREA: Box = { width: 1216, height: 520 };

/**
 * How tall the filmstrip is.
 *
 * A fixed height and not a share of the column, because what the strip is for is
 * seeing what is coming: a strip that grew with the window would take the space
 * from the one wallpaper the page exists to show. The hero gets everything left
 * over, and it gets it from the browser rather than from arithmetic here — the
 * area is measured, which is what makes this number the strip's own business
 * and nothing the hero has to know (ADR 0027).
 */
const FILMSTRIP_HEIGHT = "h-24";

export interface ReviewStripProps {
  /** The worklist, in the order the backend returned it. */
  wallpapers: Wallpaper[];
  /**
   * The strip's accessible name, on the filmstrip that holds the tab stop. A
   * composite widget is one stop in the tab order, so the name is all a screen
   * reader gets on the way in (ADR 0019).
   */
  label: string;
  /**
   * A transition the curator asked for, on the wallpaper it is about.
   *
   * The same entry the grid and the lightbox take, and Review hands all three
   * the same `perform`: a keep from in here is the page's keep — the optimistic
   * removal, the published patch and the toast — rather than a second
   * implementation that happens to agree (ADR 0023).
   */
  onAction: (action: CardAction, wallpaper: Wallpaper) => void;
  /** The curator asking to look at a wallpaper properly: a click on the hero, or `Enter`. */
  onOpen?: (wallpaper: Wallpaper) => void;
  /**
   * The handle: the way focus is handed back, and the way the published
   * selection is read.
   *
   * The same handle the grid publishes, so nothing above this component knows
   * which of the two layouts is on screen: Review hands it to the lightbox and
   * to its own failed-transition handler, and both were written against the grid
   * (ADR 0022).
   */
  ref?: Ref<SelectionHandle>;
}

/**
 * Review's strip: one wallpaper at the largest size its ratio allows, with the
 * worklist as a filmstrip beneath it.
 *
 * The decision queue the epic asks for. Review is fifty Active wallpapers the
 * curator is pressing Keep or Reject on, and a wall of identical 16:9 crops
 * serves that badly: the judgement is about the picture, so the picture is the
 * page and the queue is a strip under it.
 *
 * **It is not a layout of the grid.** ADR 0045 makes a layout a plan — rows of
 * cards, heights computed before anything renders — and Library's three all fit
 * that shape. This one does not: it is a hero and a filmstrip, one wallpaper
 * large and fifty small, with no row structure to plan. What it does share is
 * the part that has to be shared, which is the cursor: `usePublishedSelection`
 * is the same module the grid draws its selection from, so the lightbox opening
 * over this is a second rendering of the same selection and Review's optimistic
 * re-insert lands here exactly as it lands on a grid.
 *
 * **Acting advances the queue, and nothing here says so.** The page removes the
 * row it acted on, the id the cursor was tracking is gone, and the selection
 * rule falls back to the same position — which is now the wallpaper that was
 * next. There is no confirm step: ADR 0017 replaced it with act-then-undo, and
 * the toast's Undo and the shell's `Ctrl+Z` are the safety.
 */
export function ReviewStrip({
  wallpapers,
  label,
  onAction,
  onOpen,
  ref,
}: ReviewStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  // What the last commit put focus on, so a re-render that changes nothing does
  // not re-focus and re-scroll.
  const focusedRef = useRef<number | null>(null);
  const holdsFocusRef = useRef(false);
  // Whether the page has asked for the selected entry back, which is the one
  // route in from outside: closing the lightbox is the caller (ADR 0022).
  const wantsFocusRef = useRef(false);
  // The commit the flag is answered on. Setting a ref renders nothing, and the
  // effect that reads it runs on a render — so the ask schedules one. Its value
  // is never read, which is what keeps it a nudge rather than a counter.
  const [, askForFocus] = useReducer((asks: number) => asks + 1, 0);

  const selection = usePublishedSelection(
    wallpapers,
    () => {
      wantsFocusRef.current = true;
      askForFocus();
    },
    ref,
  );
  const { wallpaper: selected, index, length, moveTo } = selection;

  // The hero's area as last measured, and the box the picture is drawn in. The
  // last non-zero measurement is kept, so a view the shell has hidden — which
  // zeroes the box — keeps the size it had rather than painting nothing on the
  // way back (ADR 0015).
  const heroRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Box>(UNMEASURED_AREA);

  useLayoutEffect(() => {
    const node = heroRef.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setArea((held) =>
        held.width === width && held.height === height
          ? held
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * The picture's box: exactly the wallpaper's own shape, as large as the area
   * allows.
   *
   * Computed rather than declared in CSS, and the arithmetic is
   * `@/lib/layout-plan`'s rather than this file's — which is what keeps it
   * reachable for #266's crop preview, and drivable by a test in a runner that
   * lays nothing out. See `fittedBox` for why a box that declares only an
   * `aspect-ratio` collapses.
   */
  const hero = fittedBox(
    area,
    ratioOf(selected?.width ?? null, selected?.height ?? null),
  );

  // Whether a `medium` has painted since this strip was mounted, which is the
  // whole question the placeholder answers: a step has the outgoing picture to
  // hold, and the first wallpaper has nothing. The same arrangement the lightbox
  // makes, and for ADR 0006's reason — a cold cache is 386ms mean and 1962ms
  // worst, and the `small` the filmstrip is already showing costs no request.
  const [arrived, setArrived] = useState(false);
  // Whether the picture failed to arrive, which is how this surface learns the
  // file is gone — the same answer off the same request the card and the
  // lightbox read, so no two of them can disagree about one wallpaper
  // (ADR 0032). Reset per wallpaper, because the `<img>` has no `key` and keeps
  // painting the outgoing picture while the next one decodes.
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setGone(false);
  }, [selected?.id]);

  const entryAt = (at: number) =>
    filmstripRef.current?.querySelector<HTMLElement>(`[data-entry="${at}"]`) ??
    null;

  // Focus moves here, in a layout effect after the row commits, and never inside
  // the key handler — the same ordering the grid keeps, and for the same reason:
  // the entry an arrow key selected has to be in the DOM before it is focused.
  //
  // No dependency array, and `focusedRef` is what makes that cheap: every commit
  // that moves nothing returns on the first comparison.
  useLayoutEffect(() => {
    const target = selected ? selected.id : null;
    const requested = wantsFocusRef.current;

    // Moving the selection must not steal focus. A refetch that lands while the
    // curator is somewhere else in the app updates the selection and the tab
    // stop that goes with it, and leaves focus where they put it.
    if (!holdsFocusRef.current && !requested) {
      focusedRef.current = target;
      return;
    }

    // Nothing to do when the same wallpaper is selected and focus is still
    // inside. The second half is not redundant: React reorders a list by moving
    // DOM nodes, and moving a focused node is a removal and an insertion as far
    // as the engine is concerned.
    const active = document.activeElement;
    const holds = active instanceof Node && stripRef.current?.contains(active);
    if (target === focusedRef.current && holds) {
      wantsFocusRef.current = false;
      return;
    }

    // The list emptied under a selection that had focus, so the strip takes it:
    // the alternative is focus on `body`, where the next Tab starts from the top
    // of the document rather than from the page the curator is on (ADR 0029).
    if (target === null || index === -1) {
      stripRef.current?.focus();
      focusedRef.current = null;
      wantsFocusRef.current = false;
      return;
    }

    const entry = entryAt(index);
    if (!entry) return;
    entry.scrollIntoView({ block: "nearest", inline: "nearest" });
    focusedRef.current = target;
    wantsFocusRef.current = false;
    entry.focus({ preventScroll: true });
  });

  // One handler for the whole strip rather than one on the filmstrip, because
  // focus does not stay on the filmstrip: pressing Keep with the pointer lands
  // it on that button, and the arrows have to keep working from there. Every key
  // below reaches this by bubbling, whichever control the curator is standing
  // on. The lightbox binds on `window` for the same reason and cannot here,
  // since Review's grid is the other layout and would answer the same keys.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
      return;
    if (index === -1 || !selected) return;

    // The direct keys, before the movement keys and resolved against the Status
    // by the grid's own `actionFor`: `K` and `Delete` do exactly what they do on
    // a card, and a key the Status has no action for does nothing at all. One
    // action vocabulary in the app, so no surface can offer the curator one set
    // with the mouse and another with the keyboard (ADR 0019, ADR 0022).
    const action = actionFor(event.key, selected.status);
    if (action) {
      event.preventDefault();
      onAction(action, selected);
      return;
    }

    // `Enter` opens the lightbox, from the same entry point a click on the hero
    // reaches — but not from a button, whose own activation `Enter` already is.
    // Answering it there would be a keep with the lightbox opening over the
    // wallpaper it just removed.
    if (event.key === "Enter") {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      onOpen?.(selected);
      return;
    }

    let next: number;
    switch (event.key) {
      // All four arrows walk the queue. The filmstrip is one line of wallpapers
      // however it is laid out, so there is no second axis for Up and Down to
      // mean anything else on — and a curator sweeping a worklist should not
      // have to notice which pair of keys this surface chose.
      case "ArrowRight":
      case "ArrowDown":
        next = Math.min(index + 1, wallpapers.length - 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = wallpapers.length - 1;
        break;
      default:
        return;
    }

    // Answered even when the selection does not move, and saying so is
    // load-bearing: Rank stays mounted under `display: none` with its vote
    // listener live on `window`, and it stands down on `defaultPrevented`
    // (ADR 0015 as amended, ADR 0019).
    event.preventDefault();
    moveTo(next);
  };

  return (
    <div
      ref={stripRef}
      data-slot="review-strip"
      // Reachable programmatically and not by Tab. The filmstrip's entries hold
      // the tab stop; this is where focus lands when there is no entry left to
      // hold it.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        holdsFocusRef.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && stripRef.current?.contains(next)) return;
        // Focus that goes nowhere is the focused entry being unmounted, not the
        // curator leaving — a keep removes it under their hands, and the effect
        // above is what re-homes them.
        if (next === null && event.target instanceof HTMLElement) {
          if (!event.target.isConnected) return;
        }
        holdsFocusRef.current = false;
      }}
      className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
    >
      {/* The area the hero is fitted into, and the element that is measured.
          `min-h-0` is what lets it actually shrink inside the flex column —
          without it the row below can be pushed off the page by a picture that
          refuses to give up its height. */}
      <div
        ref={heroRef}
        data-slot="review-hero-area"
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        {selected && (
          <div
            data-slot="review-hero"
            // The box, at exactly the wallpaper's own ratio. In pixels rather
            // than as an `aspect-ratio` because the latter collapses here, and
            // because #266's crop bars are percentages of this box — see
            // `fittedBox`.
            style={{ width: hero.width, height: hero.height }}
            className="relative cursor-zoom-in overflow-hidden rounded-lg bg-muted"
            onClick={() => onOpen?.(selected)}
          >
            {!arrived && (
              // The first frame, and the reason arriving here never shows an
              // empty box: the filmstrip's own `small` is already in the memory
              // cache under ADR 0016's `max-age=300`, so this is one element and
              // no request. Nothing announces it — the picture over it is named.
              <img
                data-slot="review-hero-placeholder"
                src={wallpaperImageUrl(selected.id, "small")}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <img
              data-slot="review-hero-picture"
              src={wallpaperImageUrl(selected.id, "medium")}
              alt={selected.filename}
              // No `key`, deliberately: an `<img>` whose `src` changes keeps
              // painting the image it has until the new one decodes, so the
              // outgoing wallpaper holds the frame for the whole of a step. A
              // fresh element per wallpaper remounts with nothing painted, which
              // is a held arrow key strobing to black (ADR 0022).
              onLoad={() => {
                setArrived(true);
                setGone(false);
              }}
              // `error` counts as arrival too, for ADR 0006's reason: a
              // thumbnail held in front of a picture that is never coming is the
              // spinner that never resolves.
              onError={() => {
                setArrived(true);
                setGone(true);
              }}
              // `object-cover` inside a box of the picture's own ratio crops
              // nothing: the box *is* the picture's shape, so there is no
              // letterboxing for #266's bars to measure.
              className="absolute inset-0 h-full w-full object-cover"
            />
            {gone && (
              <div
                data-slot="review-hero-gone"
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"
              >
                <ImageOff className="h-8 w-8" aria-hidden />
                <span className="text-sm font-medium">{FILE_IS_GONE}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The row under the picture: what this wallpaper is, how far through the
          worklist it is, and the decision. It sits between the hero and the
          filmstrip rather than over the picture, because the picture is the
          thing being judged and an overlay on it is a judgement made through
          something. */}
      {selected && (
        <div
          data-slot="review-hero-row"
          className="flex shrink-0 items-center gap-3 px-1"
        >
          <Badge
            title={isEvaluated(selected) ? "Evaluated" : "Not yet Evaluated"}
            className={cn(
              "shrink-0 tabular-nums",
              isEvaluated(selected)
                ? undefined
                : "border-muted-foreground/30 bg-transparent text-muted-foreground",
            )}
          >
            {score(selected)}
          </Badge>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={selected.path}>
              {selected.filename}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {counted(selected.comparisons_count, "comparison")}
            </p>
          </div>

          {/* Where this wallpaper sits in the worklist, which is worth printing
              because the arrows clamp rather than wrapping: reaching the end of
              a fifty-row queue is the moment the sweep is done. */}
          <span
            data-slot="review-position"
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {`${grouped(index + 1)} / ${grouped(length)}`}
          </span>

          {/* The decision, without leaving the layout that made it possible.
              One button per action the Status offers, off the same
              `STATUS_ACTIONS` the card's overlay and the lightbox's row render
              from — so a curator cannot be offered one set here and another
              there. Review lists Active rows only, so in practice that is Keep
              and Reject; nothing here branches on the page it is mounted in. */}
          <div className="flex shrink-0 items-center gap-2">
            {STATUS_ACTIONS[selected.status].map((action) => {
              const {
                label: actionLabel,
                Icon,
                destructive,
              } = ACTION_CONTROLS[action];
              return (
                <Button
                  key={action}
                  size="sm"
                  variant={destructive ? "destructive" : "secondary"}
                  aria-label={`${actionLabel} ${selected.filename}`}
                  onClick={() => onAction(action, selected)}
                >
                  <Icon />
                  {actionLabel}
                  {/* The key, on the control it fires (#140). */}
                  <kbd className="rounded border border-current/25 px-1 py-0.5 font-mono text-[10px] leading-none opacity-70">
                    {printedKey(action)}
                  </kbd>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* The worklist, as the strip the hero is one wallpaper out of.
          `role="listbox"` and not the grid's `role="grid"`, and the difference is
          what the two surfaces are for: a grid of cards is a set of things each
          with its own actions, while a filmstrip's whole job is picking which
          one the hero shows. `aria-selected` is exactly "marks the current
          wallpaper", and it says to a screen reader what the ring says to an
          eye. The interaction is ADR 0019's unchanged — one tab stop, a roving
          `tabindex`, the arrows moving inside it. */}
      <div
        ref={filmstripRef}
        data-slot="review-filmstrip"
        role="listbox"
        aria-label={label}
        aria-orientation="horizontal"
        tabIndex={-1}
        className={cn(
          "flex shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden",
          FILMSTRIP_HEIGHT,
        )}
      >
        {wallpapers.map((entry, at) => {
          const current = at === index;
          return (
            <div
              key={entry.id}
              role="option"
              aria-selected={current}
              aria-label={entry.filename}
              data-entry={at}
              tabIndex={current ? 0 : -1}
              onClick={() => moveTo(at)}
              className={cn(
                "relative h-full shrink-0 cursor-pointer overflow-hidden rounded border-2 outline-none",
                // The aspect ratio is the entry's own, so a 21:9 in the strip is
                // a wider entry rather than a cropped one — which is the whole
                // reason the curator can see what is coming.
                current
                  ? "border-primary"
                  : "border-transparent opacity-60 hover:opacity-100",
              )}
              style={{
                aspectRatio: ratioOf(entry.width, entry.height),
              }}
            >
              <img
                src={wallpaperImageUrl(entry.id, "small")}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
