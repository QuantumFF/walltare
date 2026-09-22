import {
  ACTION_CONTROLS,
  actionFor,
  STATUS_ACTIONS,
  type CardAction,
} from "@/components/WallpaperCard";
import { CropPreview, useCropPreview } from "@/components/CropPreview";
import {
  usePublishedSelection,
  type SelectionHandle,
} from "@/components/selection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_EVALUATED_THRESHOLD,
  wallpaperImageUrl,
  type Resolution,
  type Wallpaper,
} from "@/lib/client";
import {
  FILE_IS_GONE,
  isEvaluated,
  score,
  dimensionsOf,
  isUndersized,
  readableSize,
  UNDERSIZED,
} from "@/lib/copy";
import { fittedBox, ratioOf, type Box } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

/**
 * What the hero's area is taken to be while nothing has measured it.
 *
 * The default 1280x800 window, less what is above and below the hero: 1280 wide
 * less the page's own `p-4` at both ends is 1248, and 800 tall less the chrome's
 * 48, the page bar's 44, that same 32 of padding, the filmstrip's 132, the row
 * under the picture at about 32, and the two 12px gaps between the three is
 * about 488. Rounded to 1216x488, because the number it feeds is a fallback and
 * not a measurement — the moment a browser lays the box out, the observer below
 * replaces it.
 *
 * Not an edge case. happy-dom reports every rect as zero, and ADR 0015 keeps
 * this view mounted under `display: none` while another one is showing, which
 * zeroes the box in a real browser too — so a hero with no fallback is a hero
 * that paints nothing on the way back. The same pair the grid's window carries,
 * for the same two reasons (ADR 0027).
 */
const UNMEASURED_AREA: Box = { width: 1216, height: 488 };

/**
 * How tall a filmstrip entry is at each density step, in pixels, and the step it
 * starts on.
 *
 * Three steps above the prototype's range, at the curator's request: its `h-14`
 * of 56 was the second step of 40, 56, 72, 96, 128, and the list here starts at
 * the fourth and carries the same progression on past 128. The density
 * gesture moves along this list rather than a column count, because the strip
 * has no columns: #254's verdict gives zoom to both tabs and says that in the
 * strip it sizes the filmstrip (#264).
 *
 * A height and not a share of the column, because what the strip is for is
 * seeing what is coming: a strip that grew with the window would take the space
 * from the one wallpaper the page exists to show. The hero gets everything left
 * over, and it gets it from the browser rather than from arithmetic here, since
 * the area is measured. That makes this number the strip's own business and
 * nothing the hero has to know (ADR 0027).
 *
 * Not persisted, the same as the grid's zoom.
 */
const FILMSTRIP_HEIGHTS = [96, 128, 160, 200, 256] as const;
const FILMSTRIP_START = 1;

/**
 * An entry's width over its height: the prototype's `w-24` over `h-14`.
 *
 * Every entry has the same shape and crops to it, as the prototype drew them.
 * The filmstrip is for picking which wallpaper the hero shows, and the hero is
 * where the shape is judged. A row of uniform boxes also keeps the current
 * entry's ring in the same place on the screen from one step to the next.
 */
const FILMSTRIP_ENTRY_RATIO = 96 / 56;

/**
 * The room around the entries, so the current one's ring is not clipped. A
 * scroll container clips on both axes once it scrolls on one, and a 2px ring
 * sits outside the entry's box.
 */
const FILMSTRIP_INSET = 2;

/**
 * Which way each key moves the filmstrip's size: the grid's four keys, for the
 * grid's reasons.
 */
const DENSITY_KEYS: Record<string, number> = {
  "+": 1,
  "=": 1,
  "-": -1,
  _: -1,
};

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
   * The curator's Minimum resolution, which is what decides whether the hero
   * wears the undersized badge (#258).
   *
   * The size itself rather than the verdict, because the verdict is one
   * comparison against the selected row's Dimensions and the hero is the one
   * wallpaper being judged — the same reason the grid resolves it per card
   * rather than taking a set of ids. Absent judges nothing undersized.
   */
  minimumResolution?: Resolution;
  /**
   * The curator's Evaluated threshold, which is the σ the hero's Score badge
   * reads as solid below (#260).
   *
   * The number rather than the verdict, unlike `minimumResolution` above: a
   * threshold is one value, so there is nothing to resolve before handing it to
   * the comparison. Absent falls back to what Evaluated meant before it was a
   * setting (ADR 0046).
   */
  evaluatedThreshold?: number;
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
  /**
   * A wallpaper to open on, read once at mount: the one Review's other layout
   * was showing when the curator swapped, so a swap does not cost them their
   * place in a fifty-row sweep.
   */
  startOn?: number | null;
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
 * next. There is no confirm step: ADR 0009 deleted it and put act-then-undo in
 * its place, so the safety is ADR 0017's toast and the `Ctrl+Z` that presses its
 * Undo.
 */
export function ReviewStrip({
  wallpapers,
  label,
  onAction,
  onOpen,
  minimumResolution,
  evaluatedThreshold = DEFAULT_EVALUATED_THRESHOLD,
  ref,
  startOn,
}: ReviewStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  // How this layout finds an entry and brings one on screen, which is the whole
  // of what the shared roving focus does not already know (`selection.ts`).
  //
  // The container is the strip rather than the filmstrip, because focus does not
  // stay on the filmstrip: pressing Keep with the pointer lands it on that
  // button, and everything in here has to count as still being inside. There is
  // no `reveal` — every entry is mounted, so scrolling the node into view is the
  // whole of it.
  const focus = {
    container: stripRef,
    nodeAt: (at: number) =>
      filmstripRef.current?.querySelector<HTMLElement>(
        `[data-entry="${at}"]`,
      ) ?? null,
  };

  // The cursor, the publication, the handle and the roving focus, all of which
  // are the shared selection module's — the same four the grid takes, off the
  // same call. That is what makes the lightbox a second rendering of whichever
  // surface is up, and Review's optimistic re-insert land on either (ADR 0022).
  const {
    selection,
    onFocus: handleFocus,
    onBlur: handleBlur,
  } = usePublishedSelection(wallpapers, focus, ref, startOn);
  const { wallpaper: selected, index, moveTo } = selection;

  // The same verdict the grid's cards wear, on the one wallpaper being judged:
  // Review lists undersized wallpapers rather than excluding them, so the hero
  // has to say so (#258). Resolved here off the setting for the same reason
  // the grid resolves it per card rather than taking a verdict per row.
  const undersized =
    selected && minimumResolution
      ? isUndersized(selected, minimumResolution)
      : false;
  const heroSize = selected ? dimensionsOf(selected) : null;

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

  // The bars, and the press that raises them. Held in the settings store rather
  // than here, so they are still up on the next launch and so the lightbox
  // opening over this hero shows the same preview rather than a second one
  // (#266).
  const crop = useCropPreview();

  // The filmstrip's density step. In is larger, the same direction the grid's
  // zoom runs.
  const [size, setSize] = useState(FILMSTRIP_START);
  const stepSize = useCallback(
    (by: number) =>
      setSize((was) =>
        Math.max(0, Math.min(FILMSTRIP_HEIGHTS.length - 1, was + by)),
      ),
    [],
  );
  const entryHeight = FILMSTRIP_HEIGHTS[size];

  // Ctrl and the wheel, off a non-passive listener so the webview's own zoom is
  // refused. React's `onWheel` is passive and cannot, which is the grid's reason
  // for the same effect.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      stepSize(event.deltaY < 0 ? 1 : -1);
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [stepSize]);

  // In a layout effect and not a passive one: the `<img>`'s `src` changes in the
  // same commit, and a reset that lands a frame later paints "File is gone" over
  // the outgoing picture on the way to a wallpaper that is perfectly fine.
  useLayoutEffect(() => {
    setGone(false);
  }, [selected?.id]);

  // One handler for the whole strip rather than one on the filmstrip, because
  // focus does not stay on the filmstrip: pressing Keep with the pointer lands
  // it on that button, and the arrows have to keep working from there. Every key
  // below reaches this by bubbling, whichever control the curator is standing
  // on. The lightbox binds on `window` for the same reason and cannot here,
  // since Review's grid is the other layout and would answer the same keys.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The density keys, ahead of the `Shift` guard: `+` arrives with `Shift`
    // held on most layouts.
    const by = DENSITY_KEYS[event.key];
    if (by !== undefined && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      stepSize(by);
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
      return;
    if (index === -1 || !selected) return;

    // The direct keys, before the movement keys and resolved against the Status
    // by the shared `actionFor` beside `STATUS_ACTIONS` in `WallpaperCard.tsx`: `K` and `Delete` do exactly what they do on
    // a card, and a key the Status has no action for does nothing at all. One
    // action vocabulary in the app, so no surface can offer the curator one set
    // with the mouse and another with the keyboard (ADR 0019, ADR 0022).
    const action = actionFor(event.key, selected.status);
    if (action) {
      event.preventDefault();
      onAction(action, selected);
      return;
    }

    // `C` raises the crop preview over the hero and lowers it again. Before the
    // movement keys and after the transitions, because it is neither: it is a
    // question about the wallpaper on screen rather than a decision about it or
    // a step away from it. A toggle rather than a hold, so it stays up while the
    // curator arrows through the worklist (#266).
    if (event.key === "c" || event.key === "C") {
      event.preventDefault();
      if (!event.repeat) crop.toggle();
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
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
    >
      {/* The area the hero is fitted into, and the element that is measured.
          `min-h-0` is what lets it actually shrink inside the flex column —
          without it the row below can be pushed off the page by a picture that
          refuses to give up its height.

          The hero is centred inside an absolutely positioned layer rather than
          being a flex child of this box. Its size is in pixels, taken from the
          last measurement of this box, and as an in-flow child that size fed back
          into the page's minimum height: when the filmstrip grew, or the window
          shrank, this box could not give up the height its own picture was
          holding, and the filmstrip was pushed out of the bottom of the window.
          Out of the flow, the picture takes no space, the box shrinks to what is
          left, and the observer refits the picture to it. */}
      <div
        ref={heroRef}
        data-slot="review-hero-area"
        className="relative min-h-0 flex-1"
      >
        <div className="absolute inset-0 flex items-center justify-center">
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
              {/* What the Screen would cut off, over the picture it would cut it
                off. The hero's box is exactly the wallpaper's own ratio, which
                is what makes the bars percentages of the picture rather than of
                letterboxing around it — see `fittedBox`.

                Not drawn over a wallpaper whose file is gone: the panel below
                says there is no picture, and bars over it would be a claim about
                one. */}
              {crop.on && !gone && <CropPreview wallpaper={selected} />}
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
      </div>

      {/* The row under the picture, as #254's prototype laid it out: centred,
          the filename and Score in one muted line, the crop preview's key, then
          the decision. It sits between the hero and the filmstrip rather than
          over the picture, because the picture is the thing being judged and an
          overlay on it is a judgement made through something. */}
      {selected && (
        <div
          data-slot="review-hero-row"
          className="flex shrink-0 flex-wrap items-center justify-center gap-3"
        >
          <span
            className="min-w-0 truncate text-sm text-muted-foreground"
            title={selected.path}
          >
            {selected.filename} ·{" "}
            {/* The Score, reading against the curator's Evaluated threshold
                (#260): the title says which side of it this wallpaper is on, and
                an Evaluated Score is set in the foreground colour rather than
                the muted one around it. */}
            <span
              title={
                isEvaluated(selected, evaluatedThreshold)
                  ? "Evaluated"
                  : "Not yet Evaluated"
              }
              className={cn(
                "tabular-nums",
                isEvaluated(selected, evaluatedThreshold) && "text-foreground",
              )}
            >
              {score(selected)}
            </span>
          </span>
          {undersized && (
            <Badge
              data-slot="review-hero-undersized"
              title={heroSize ? readableSize(heroSize) : undefined}
              className="shrink-0 bg-white font-medium text-neutral-900"
            >
              {UNDERSIZED}
            </Badge>
          )}
          <span
            data-slot="review-crop-hint"
            className="shrink-0 text-xs text-muted-foreground/70"
          >
            C: crop preview
          </span>

          {/* The decision, without leaving the layout that made it possible.
              One button per action the Status offers, off the same
              `STATUS_ACTIONS` the card's overlay and the lightbox's row render
              from, so a curator cannot be offered one set here and another
              there. Review lists Active rows only, so in practice that is Keep
              and Reject; nothing here branches on the page it is mounted in. */}
          {STATUS_ACTIONS[selected.status].map((action) => {
            const { label: actionLabel, destructive } = ACTION_CONTROLS[action];
            return (
              <Button
                key={action}
                size="sm"
                variant={destructive ? "destructive" : "default"}
                aria-label={`${actionLabel} ${selected.filename}`}
                onClick={() => onAction(action, selected)}
                className="shrink-0"
              >
                {actionLabel}
              </Button>
            );
          })}
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
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden"
        style={{
          height: entryHeight + 2 * FILMSTRIP_INSET,
          padding: FILMSTRIP_INSET,
        }}
      >
        {wallpapers.map((entry, at) => (
          <FilmstripEntry
            key={entry.id}
            wallpaper={entry}
            at={at}
            current={at === index}
            onSelect={moveTo}
            height={entryHeight}
          />
        ))}
      </div>
    </div>
  );
}

interface FilmstripEntryProps {
  wallpaper: Wallpaper;
  /** Where it sits in the worklist, which is how the roving focus finds it. */
  at: number;
  /** Whether this is the one the hero is showing. */
  current: boolean;
  /** Select it, by the position above. */
  onSelect: (at: number) => void;
  /** How tall it is, in pixels: the filmstrip's density step. */
  height: number;
}

/**
 * One wallpaper in the filmstrip: a thumbnail cropped to the strip's one shape,
 * ringed when it is the one the hero is showing and dimmed when it is not.
 *
 * **Memoised, and every prop is a value or a stable identity so that the memo
 * holds.** `onSelect` is the cursor's `moveTo`, which follows the list rather
 * than the selection, so an arrow key re-renders this component for the entry
 * that lost the mark and the one that gained it and compares four props on the
 * other forty-eight. That is the same mechanism ADR 0041 and #230 put behind the
 * card, and it matters here for the same reason: a held arrow key is a run of
 * commits, and fifty thumbnails re-rendering on each of them is the cost that
 * ADR 0041 measured in card mount.
 *
 * It is a component rather than markup in the loop above because of `gone`.
 * ADR 0032 has a surface learn its file is missing from the `wallpaper://`
 * request it was making anyway, which is state per entry — and without it a
 * wallpaper whose file has gone would be a blank entry under a hero that says
 * **File is gone**, which is two surfaces disagreeing about one wallpaper.
 */
const FilmstripEntry = memo(function FilmstripEntry({
  wallpaper,
  at,
  current,
  onSelect,
  height,
}: FilmstripEntryProps) {
  const [gone, setGone] = useState(false);

  return (
    <div
      role="option"
      aria-selected={current}
      // The name carries the gone state for the reason the card's does: what is
      // otherwise an icon inside an element whose own `aria-label` hides its
      // contents reaches nobody reading with a screen reader unless the name
      // says it (ADR 0019, ADR 0032).
      aria-label={
        gone ? `${wallpaper.filename}, ${FILE_IS_GONE}` : wallpaper.filename
      }
      data-entry={at}
      tabIndex={current ? 0 : -1}
      onClick={() => onSelect(at)}
      // The prototype's marker: a ring on the current entry and the rest at
      // half opacity, so the eye finds the current one by what is lit.
      className={cn(
        "relative shrink-0 cursor-pointer overflow-hidden rounded-md bg-muted outline-none",
        current ? "ring-2 ring-primary" : "opacity-50 hover:opacity-100",
      )}
      // One shape for every entry, the prototype's `w-24` by `h-14` scaled to
      // the density step. The hero shows the wallpaper's own shape; this only
      // has to say which one is coming.
      style={{ height, width: Math.round(height * FILMSTRIP_ENTRY_RATIO) }}
    >
      <img
        src={wallpaperImageUrl(wallpaper.id, "small")}
        alt=""
        loading="lazy"
        decoding="async"
        // The same answer off the same request the card, the hero and the
        // lightbox read, so no two surfaces can disagree about one wallpaper.
        // `load` clears it as well as `error` setting it, so an entry is never
        // stuck on an answer the browser has since revised (ADR 0032).
        onLoad={() => setGone(false)}
        onError={() => setGone(true)}
        className="h-full w-full object-cover"
      />
      {gone && (
        <div
          data-slot="filmstrip-gone"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
        >
          <ImageOff className="h-4 w-4" aria-hidden />
        </div>
      )}
    </div>
  );
});
