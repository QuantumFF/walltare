import { CropPreview, useCropPreview } from "@/components/CropPreview";
import {
  wallpaperImageUrl,
  type Resolution,
  type Wallpaper,
} from "@/lib/client";
import { fittedBox, ratioOf, type Box } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { dimensionsOf } from "@/lib/wallpaper";
import {
  useCallback,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";

/**
 * What a hero picture is drawn from: two sources of one picture, and the
 * Dimensions of the file they are pictures of.
 *
 * Not a Wallpaper, since #338. Discover's lightbox draws a Result, whose two
 * sizes are Wallhaven's `lg` thumbnail and its full file rather than the
 * `small` and `medium` a wallpaper is served at (ADR 0055), and whose id is a
 * string. What the picture needs of either is the same five facts, so those
 * are what it takes, and `wallpaperPicture` below reads them off a Wallpaper.
 */
export interface Picture {
  /** Which item this is the picture of. A change is a step. */
  id: string | number;
  /** Painted under `full` until that has painted, and never requested twice. */
  placeholder: string;
  /** The picture itself. */
  full: string;
  /** The picture's accessible name. */
  alt: string;
  /**
   * The file's Dimensions, or `null` while nothing has read them: what the
   * box is shaped by and what the crop preview crops (ADR 0044).
   */
  dimensions: Resolution | null;
}

/**
 * A wallpaper's picture, as the Review strip and Library's lightbox draw it:
 * its `small` under its `medium`, both from `wallpaper://` (ADR 0022).
 */
export function wallpaperPicture(wallpaper: Wallpaper): Picture {
  return {
    id: wallpaper.id,
    placeholder: wallpaperImageUrl(wallpaper.id, "small"),
    full: wallpaperImageUrl(wallpaper.id, "medium"),
    alt: wallpaper.filename,
    dimensions: dimensionsOf(wallpaper),
  };
}

/** A picture's decoded size, and the item it is the picture of. */
interface NaturalSize {
  id: string | number;
  width: number;
  height: number;
}

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
 * The ratio is the picture's Dimensions. A picture whose Dimensions nothing
 * has read has none, and gets the 16:9 guess every layout falls back to
 * (ADR 0044) — unless the surface hands `learnNaturalSize` to the picture's
 * `onNaturalSize`, in which case the decoded full source's own shape replaces
 * the guess once it has loaded. That is opt-in because it moves the box after the
 * picture arrives: the lightbox wants it, since its row shrink-wraps the
 * picture and a portrait of unknown shape would otherwise get a 16:9 row
 * (ADR 0022); the strip does not, since its hero crops to the box and a box
 * that jumps on arrival would move the filmstrip's neighbours with it. A
 * `medium` is capped in width only, so its shape is the wallpaper's, and a
 * Wallhaven full file is the file.
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
  picture: Picture | null,
  unmeasured: Box,
): {
  area: RefCallback<HTMLElement>;
  box: Box;
  learnNaturalSize: (id: Picture["id"], size: Box) => void;
} {
  const [measured, setMeasured] = useState<Box>(unmeasured);
  // Keyed on the item it was decoded for, so a step never draws the next item
  // in the last one's shape.
  const [natural, setNatural] = useState<NaturalSize | null>(null);

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

  const learnNaturalSize = useCallback((id: Picture["id"], size: Box) => {
    // A decode that reports nothing is no shape; happy-dom reports every image
    // this way.
    if (size.width <= 0 || size.height <= 0) return;
    setNatural((held) =>
      held?.id === id &&
      held.width === size.width &&
      held.height === size.height
        ? held
        : { id, ...size },
    );
  }, []);

  const known = picture?.dimensions ?? null;
  const learned =
    !known && picture && natural?.id === picture.id ? natural : null;
  const shape = known ?? learned;
  const box = fittedBox(
    measured,
    ratioOf(shape?.width ?? null, shape?.height ?? null),
  );
  return { area, box, learnNaturalSize };
}

export interface HeroPictureProps {
  /** The picture being shown. A change of `id` is a step, and the picture holds through it. */
  picture: Picture;
  /** The box to draw it in, from `usePictureBox`. */
  box: Box;
  /**
   * How the picture sits in its box, which differs only for a wallpaper whose
   * box is the 16:9 guess: `cover` crops to it and `contain` letterboxes in it.
   * A box of the wallpaper's own ratio crops and letterboxes nothing either way.
   *
   * A named input because it is a difference the two surfaces mean. The strip's
   * hero is a frame the picture fills, the same as the filmstrip under it; the
   * lightbox exists to show all of the picture, and learns its shape on arrival
   * anyway (`usePictureBox`).
   */
  fit: "cover" | "contain";
  /**
   * Whether the crop preview is offered over this picture, drawn while the
   * stored toggle is up (#266).
   *
   * Opt-in since #338: the Review strip and Library's lightbox offer it, and
   * Discover's lightbox leaves it out, since a Result is not yet anything the
   * Screen would crop.
   */
  cropPreview?: boolean;
  /**
   * What the panel says when the full source fails to load, which for a
   * wallpaper means its file is gone: the words, the icon and their
   * colours, since the strip sits on the page's theme and the lightbox on a
   * dark backdrop in both themes, and the lightbox has room for the second line
   * the strip's hero does without (ADR 0032). Where and when it shows is this
   * module's.
   */
  gone: ReactNode;
  /** The surface's own look for the box: its ground, its rounding, its cursor. */
  className?: string;
  /** A press on the picture, which the Review strip opens the lightbox from. */
  onClick?: () => void;
  /**
   * Told the full source's decoded size when it loads, for `usePictureBox`'s
   * `learnNaturalSize`. Absent for a surface that keeps the 16:9 guess.
   */
  onNaturalSize?: (id: Picture["id"], size: Box) => void;
}

/**
 * One picture, large: the Review strip's hero and the lightbox's picture.
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
 *   and not while the panel says there is no picture (#266), for a surface
 *   that offers it.
 *
 * The phases are named for a wallpaper's two sizes below, and are the same
 * for any placeholder and full source: Discover's `lg` under its full file is
 * this rule with Wallhaven's sizes in (ADR 0055).
 *
 * The measurement is `usePictureBox` above, in this module for the same reason.
 * Where the surfaces differ on purpose, the difference is a named input: `fit`,
 * `cropPreview`, `gone`, and whether to pass `onNaturalSize`.
 */
export function HeroPicture({
  picture,
  box,
  fit,
  cropPreview = false,
  gone: goneNotice,
  className,
  onClick,
  onNaturalSize,
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
  const [goneId, setGoneId] = useState<Picture["id"] | null>(null);
  const gone = goneId === picture.id;

  // Whether the `<img>` is showing a failure, which is not the same question as
  // whether the panel is up. The panel goes the moment the wallpaper changes;
  // the element still holds the failed request until the next one lands, and
  // unhidden it would flash the next wallpaper's `alt` and the broken-image
  // glyph for the length of the decode. So it stays hidden until a `load`.
  const [broken, setBroken] = useState(false);

  const { on: cropOn } = useCropPreview();

  const fitClass = fit === "cover" ? "object-cover" : "object-contain";

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
          src={picture.placeholder}
          alt=""
          className={cn("absolute inset-0 h-full w-full", fitClass)}
        />
      )}
      <img
        data-slot="hero-picture"
        src={picture.full}
        alt={picture.alt}
        // No `key`, deliberately: an `<img>` whose `src` changes keeps painting
        // the image it has until the new one decodes, so the outgoing wallpaper
        // holds the frame for the whole of a step. A fresh element per wallpaper
        // remounts with nothing painted, which is a held arrow key strobing to
        // black at a median 376KB a frame (ADR 0022).
        onLoad={(event) => {
          setArrived(true);
          setGoneId(null);
          setBroken(false);
          const { naturalWidth, naturalHeight } = event.currentTarget;
          onNaturalSize?.(picture.id, {
            width: naturalWidth,
            height: naturalHeight,
          });
        }}
        // `error` counts as arrival too, for ADR 0006's reason: a thumbnail held
        // in front of a picture that is never coming is the spinner that never
        // resolves. What it leaves is the panel below (ADR 0032).
        onError={() => {
          setArrived(true);
          setGoneId(picture.id);
          setBroken(true);
        }}
        // Not dimmed, whatever the card does to a Rejected one: both surfaces
        // exist to show one picture properly (ADR 0019, ADR 0022). Hidden once
        // it has failed rather than covered, since what a failed `<img>` paints
        // is its `alt`; `invisible` keeps it mounted, so a later `load` can
        // still clear it.
        className={cn(
          "absolute inset-0 h-full w-full",
          fitClass,
          broken && "invisible",
        )}
      />
      {/* What the Screen would cut off, over the picture it would cut it off.
          Not drawn over a wallpaper whose file is gone: the panel says there is
          no picture, and bars over it would be a claim about one (#266). */}
      {cropPreview && cropOn && !gone && (
        <CropPreview dimensions={picture.dimensions} />
      )}
      {gone && (
        // The file is gone, said where the picture would have been, in the
        // surface's own words (ADR 0032).
        //
        // No fill of its own, because the picture under it is hidden and the
        // surface's ground shows through, as it does around the picture.
        // `pointer-events-none` so the controls around the box, and a press on
        // the box itself, keep taking their own clicks.
        <div
          data-slot="hero-gone"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center"
        >
          {goneNotice}
        </div>
      )}
    </div>
  );
}
