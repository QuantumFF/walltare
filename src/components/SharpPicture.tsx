import { cn } from "@/lib/utils";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** How much wider than it was drawn a shown card grows before it draws again. */
const REDRAW_GROWTH = 1.1;

/** How long a card's size has to be quiet before a wider one draws again. */
const RESIZE_SETTLE_MS = 150;

/**
 * Work that takes turns: each piece starts once the one before it has settled,
 * whether that one finished or threw.
 */
export type Turns = <T>(work: () => Promise<T>) => Promise<T>;

/** A new line of turns, empty. */
export function takeTurns(): Turns {
  let last: Promise<unknown> = Promise.resolve();
  return (work) => {
    const mine = last.then(work);
    last = mine.catch(() => {});
    return mine;
  };
}

const DrawTurnsContext = createContext<Turns | null>(null);

/**
 * One line of turns for every `SharpPicture` under it, so a page whose files
 * land together decodes one at a time. The line is the provider's, and goes
 * with it: two pages, or two tests, never wait on each other's draws.
 */
export function DrawTurns({ children }: { children: ReactNode }) {
  const [turns] = useState(takeTurns);
  return (
    <DrawTurnsContext.Provider value={turns}>
      {children}
    </DrawTurnsContext.Provider>
  );
}

/**
 * A card's preview, drawn once onto a canvas the card's size in device pixels
 * (ADR 0055, ADR 0062).
 *
 * The `<img>` is only the fetch, lazy like the `lg`'s and never painted. Once it
 * has loaded, the picture is decoded and drawn onto the canvas, cropped to the
 * card's shape, and the `<img>` unmounts, so no card holds it decoded at its
 * own size. That matters at a preview's 1920 pixels as well as at a full
 * file's: 24 cards holding 8 MB each still flickered. It unmounts too when the
 * fetch or the draw fails, and the `lg` stays the picture.
 *
 * Draws take turns with every other picture under the same `DrawTurns`, so a
 * page whose files land together decodes one at a time; one drawn outside any
 * takes turns only with itself. A shown card that settles wider than it was
 * drawn at, from three columns to two, fetches and draws again. A hidden one at
 * four and five does not, because only the `lg` shows there.
 */
export function SharpPicture({
  src,
  className,
  shown,
  onDrawn,
}: {
  src: string;
  className: string;
  /**
   * Whether the canvas is the card's picture: at three columns and fewer, once
   * it has been drawn. It never is before then.
   */
  shown: boolean;
  onDrawn: () => void;
}) {
  const shared = useContext(DrawTurnsContext);
  const [own] = useState(takeTurns);
  const turns = shared ?? own;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Whether the `<img>` is mounted: until the first draw, and again while a
  // wider card fetches the file to draw it at its new size.
  const [fetching, setFetching] = useState(true);
  // How many device pixels wide the canvas was last drawn at, 0 before then.
  const drawnWidth = useRef(0);
  // A loaded file waiting for the canvas to be laid out, as it is not while
  // the shell hides the page, and drawn once it is.
  const waiting = useRef<HTMLImageElement | null>(null);
  // Read by the resize observer below, which outlives any one render.
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });

  // Whether the `<img>` is done with: drawn, or failed to be. Not while the
  // canvas has no size to draw at.
  const draw = async (image: HTMLImageElement): Promise<boolean> => {
    const canvas = canvasRef.current;
    if (!canvas) return true;
    const { width, height } = devicePixelsOf(canvas);
    if (width === 0) {
      waiting.current = image;
      return false;
    }
    waiting.current = null;
    await image.decode();
    const context = image.naturalWidth > 0 ? canvas.getContext("2d") : null;
    if (!context) return true;
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingQuality = "high";
    // `object-cover`'s crop, done here so the canvas holds only what shows.
    const scale = Math.max(
      width / image.naturalWidth,
      height / image.naturalHeight,
    );
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    context.drawImage(
      image,
      (image.naturalWidth - sourceWidth) / 2,
      (image.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    drawnWidth.current = width;
    onDrawn();
    return true;
  };

  // Drawn or not, the `<img>` goes once its turn is done with it, and a draw
  // that throws still lets the next card's turn come.
  const queueDraw = (image: HTMLImageElement) => {
    void turns(() => draw(image))
      .catch(() => true)
      .then((done) => {
        if (done) setFetching(false);
      });
  };
  // Read by the resize observer, which is set up once.
  const queued = useRef(queueDraw);
  useLayoutEffect(() => {
    queued.current = queueDraw;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    // Judged once the size is quiet, so dragging the window wider draws once at
    // the end rather than at every step.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (waiting.current) {
          queued.current(waiting.current);
          return;
        }
        const grown =
          drawnWidth.current > 0 &&
          devicePixelsOf(canvas).width > drawnWidth.current * REDRAW_GROWTH;
        if (grown && shownRef.current) setFetching(true);
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          className,
          "pointer-events-none absolute inset-0",
          !shown && "invisible",
        )}
      />
      {fetching && (
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          onLoad={(event) => queueDraw(event.currentTarget)}
          onError={() => setFetching(false)}
          className="pointer-events-none invisible absolute inset-0 h-full w-full"
        />
      )}
    </>
  );
}

/** How many device pixels a canvas is laid out across. */
function devicePixelsOf(canvas: HTMLCanvasElement) {
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  return {
    width: Math.round(box.width * ratio),
    height: Math.round(box.height * ratio),
  };
}
