import { CropPreview, useCropPreview } from "@/components/CropPreview";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { FILE_IS_GONE, FILE_IS_GONE_DETAIL } from "@/lib/copy";
import { fittedBox, ratioOf, type Box } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import { useCallback, useState, type RefCallback } from "react";

/**
 * The box a hero picture is drawn in, and the element whose size decides it.
 *
 * The surface hands over the area it has room for by putting `area` on an
 * element that fills that room, and gets back the largest box of the
 * wallpaper's own ratio that fits in it. The arithmetic is `fittedBox`'s, so a
 * test can drive it without a layout engine; see there for why a box that
 * declares only an `aspect-ratio` collapses, and why the crop preview's bars
 * need a box that is exactly the picture.
 *
 * The last non-zero measurement is kept, and `unmeasured` stands in until there
 * is one. Not an edge case: happy-dom reports every rect as zero, and ADR 0015
 * keeps a view mounted under `display: none` while another one is showing,
 * which zeroes the area in a real browser too — so a picture with no fallback
 * is a picture that paints nothing on the way back (ADR 0027).
 *
 * A callback ref rather than a ref and an effect, because the lightbox's area
 * mounts and unmounts with its dialog while the component asking for the box
 * stays mounted: an effect keyed on nothing would observe the node that was
 * there at mount, which in the lightbox's case is none. The first measurement
 * is taken as the node attaches, which is inside the commit and so before the
 * frame paints.
 */
export function usePictureBox(
  wallpaper: Wallpaper | null,
  unmeasured: Box,
): { area: RefCallback<HTMLElement>; box: Box } {
  const [measured, setMeasured] = useState<Box>(unmeasured);

  const area = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setMeasured((held) =>
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

  const box = fittedBox(
    measured,
    ratioOf(wallpaper?.width ?? null, wallpaper?.height ?? null),
  );
  return { area, box };
}

export interface HeroPictureProps {
  /** The wallpaper being shown. A change is a step, and the picture holds through it. */
  wallpaper: Wallpaper;
  /** The box to draw it in, from `usePictureBox`. */
  box: Box;
  /**
   * The surface's own look for the box: its ground, its rounding, its cursor,
   * and the colour the gone panel's text is drawn in. The panel takes its colour
   * from here rather than choosing one, because the Review strip sits on the
   * page's theme and the lightbox on a dark backdrop in both themes.
   */
  className?: string;
  /** A press on the picture, which the Review strip opens the lightbox from. */
  onClick?: () => void;
}

/**
 * One wallpaper, large: the Review strip's hero and the lightbox's picture.
 *
 * Everything about the picture itself is here and nowhere else, which is what
 * the two surfaces lost by each carrying a copy (#279). Their copies had drifted
 * in exactly the part that is hardest to see — when the gone panel went away on
 * a step, which one of them got a frame late — and each defended its own choice
 * in prose. So this owns three things the surfaces only place and style:
 *
 * - **The load phases.** The `small` under the `medium` until the `medium` has
 *   painted, then the `medium`, or the gone panel if it never will.
 * - **When each phase resets.** The placeholder once per mount and the gone
 *   panel once per wallpaper, for the reasons beside each below.
 * - **The crop preview**, drawn over the picture while the stored toggle is up
 *   and not while the panel says there is no picture (#266).
 *
 * The measurement is `usePictureBox` above, in this module for the same reason.
 */
export function HeroPicture({
  wallpaper,
  box,
  className,
  onClick,
}: HeroPictureProps) {
  // Whether a `medium` has painted since this picture was mounted, which is the
  // whole question the placeholder answers: a step has the outgoing picture to
  // hold, and the first wallpaper has nothing.
  //
  // Not reset per wallpaper, deliberately. Once one has painted there is always
  // an outgoing frame for the next step to hold, and re-mounting the `small`
  // would put the *arriving* wallpaper's thumbnail behind the outgoing picture
  // — visible around its edges wherever two ratios differ — and spend a request
  // per step on it. The mount is what resets it, because a mount is an `<img>`
  // with nothing painted: the strip mounts this once for as long as its worklist
  // has anything in it, and the lightbox once per open, since its content goes
  // when it closes. That is one rule, and it is why the lightbox no longer needs
  // a reset of its own on close.
  const [arrived, setArrived] = useState(false);

  // Which wallpaper's picture failed to arrive, which is how both surfaces learn
  // the file is gone — the same answer off the same request the card reads, so
  // no two surfaces can disagree about one wallpaper (ADR 0032).
  //
  // An id rather than a flag, so the reset per wallpaper is not an effect at
  // all. The `<img>` has no `key` and keeps painting the outgoing picture while
  // the next one decodes, so the panel has to go the moment the wallpaper
  // changes. A flag reset in a passive effect went a frame late and painted the
  // panel over a wallpaper that is fine; one reset in a layout effect never
  // painted it but still committed it. Keyed on the id, the render that steps is
  // the render that drops the panel.
  const [goneId, setGoneId] = useState<number | null>(null);
  const gone = goneId === wallpaper.id;

  const { on: cropOn } = useCropPreview();

  return (
    <div
      data-slot="hero"
      // The box, at exactly the wallpaper's own ratio. In pixels rather than as
      // an `aspect-ratio`, because the latter collapses here and because the
      // crop bars are percentages of this box — see `fittedBox`.
      style={{ width: box.width, height: box.height }}
      className={cn("relative overflow-hidden", className)}
      onClick={onClick}
    >
      {!arrived && (
        // The first frame, and the reason arriving never shows an empty box: the
        // card's or the filmstrip's own `small` is already in the memory cache
        // under ADR 0016's `max-age=300`, so this is one element and no request,
        // and it paints the picture the curator just picked scaled up while the
        // `medium` arrives. ADR 0006 measured a cold `medium` at 386ms mean and
        // 1962ms worst, and a spinner there would show the curator a spinner
        // instead of their wallpaper (ADR 0022).
        //
        // Nothing announces it: the picture over it is the same one and is
        // already named.
        <img
          data-slot="hero-placeholder"
          src={wallpaperImageUrl(wallpaper.id, "small")}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      <img
        data-slot="hero-picture"
        src={wallpaperImageUrl(wallpaper.id, "medium")}
        alt={wallpaper.filename}
        // No `key`, deliberately: an `<img>` whose `src` changes keeps painting
        // the image it has until the new one decodes, so the outgoing wallpaper
        // holds the frame for the whole of a step. A fresh element per wallpaper
        // remounts with nothing painted, which is a held arrow key strobing to
        // black at a median 376KB a frame (ADR 0022).
        onLoad={() => {
          setArrived(true);
          setGoneId(null);
        }}
        // `error` counts as arrival too, for ADR 0006's reason: a thumbnail held
        // in front of a picture that is never coming is the spinner that never
        // resolves. What it leaves is the panel below (ADR 0032).
        onError={() => {
          setArrived(true);
          setGoneId(wallpaper.id);
        }}
        // `object-contain` inside a box of the picture's own ratio crops nothing
        // and letterboxes nothing, so the bars measure the picture. The one box
        // that is not the picture's shape is the 16:9 guess for a wallpaper
        // whose Dimensions nothing has read, and there this shows all of it
        // rather than cropping to a shape that was never measured (ADR 0044).
        //
        // Not dimmed, whatever the card does to a Rejected one: both surfaces
        // exist to show one picture properly (ADR 0019, ADR 0022). Hidden once
        // it has failed rather than covered, since what a failed `<img>` paints
        // is its `alt`; `invisible` keeps it mounted, so a later `load` can
        // still clear the panel.
        className={cn(
          "absolute inset-0 h-full w-full object-contain",
          gone && "invisible",
        )}
      />
      {/* What the Screen would cut off, over the picture it would cut it off.
          Not drawn over a wallpaper whose file is gone: the panel says there is
          no picture, and bars over it would be a claim about one (#266). */}
      {cropOn && !gone && <CropPreview wallpaper={wallpaper} />}
      {gone && (
        // The file is gone, said where the picture would have been, in two
        // lines. The second names the cause, which is the half the curator
        // cannot see and the whole point: a file that vanished from under the
        // app reads as their own library changing rather than as the app
        // breaking (ADR 0032).
        //
        // No fill of its own, because the picture under it is hidden and the
        // surface's ground shows through, as it does around the picture.
        // `pointer-events-none` so the controls around the box, and a press on
        // the box itself, keep taking their own clicks.
        <div
          data-slot="hero-gone"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
        >
          <ImageOff className="h-10 w-10 opacity-40" aria-hidden />
          <p className="text-sm font-medium">{FILE_IS_GONE}</p>
          <p className="max-w-sm text-xs opacity-60">{FILE_IS_GONE_DETAIL}</p>
        </div>
      )}
    </div>
  );
}
