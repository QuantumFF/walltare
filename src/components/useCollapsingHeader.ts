import { useKeptScroll } from "@/components/useKeptScroll";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

/**
 * The sticky strip's height: a PageBar's `h-11`, so a collapsed header is the
 * same fixed bar every other page has under the chrome (ADR 0015).
 */
const STRIP_HEIGHT = 44;

/**
 * How long the header's new shape takes to fade in once a scroll swaps it:
 * long enough to soften the swap, short enough that a flick past the line
 * never waits on it.
 */
const FADE_MS = 180;

export interface CollapsingHeader {
  /** The page's scroll box, which the header rides at the top of. */
  scroller: RefObject<HTMLDivElement | null>;
  header: RefObject<HTMLElement | null>;
  /** What fades in when a scroll swaps the header's shape. */
  controls: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  /** The header's own style: where it sticks, or what it keeps in the flow. */
  style: CSSProperties;
  /** The scroll box's `onScroll`. */
  onScroll: () => void;
  /** Back to the top, expanded, as a new search starts. */
  toTop: () => void;
}

/**
 * Discover's header and the scroll box under it (#340).
 *
 * The header collapses once the page has scrolled as far as the strip would
 * leave of it, and expands again short of that, so the two shapes swap where
 * they would show the same thing. While collapsed it keeps its expanded height
 * in the flow as a margin: the Results never move as it swaps, and a scroll
 * offset cannot land either side of the line because of the swap itself.
 *
 * The scroll position is kept the way Library's is (`useKeptScroll`), and the
 * header follows it once it is put back.
 */
export function useCollapsingHeader(showing: boolean): CollapsingHeader {
  // First, so the restore runs before the layout effect below that follows it.
  const {
    scroller,
    onScroll: record,
    toTop: backToTop,
  } = useKeptScroll(showing);
  const header = useRef<HTMLElement | null>(null);
  // Measured while expanded, since collapsed it is the strip's.
  const expandedHeight = useRef(0);
  // What the collapsed header keeps in the flow below itself, or `null` while
  // it is expanded.
  const [reserved, setReserved] = useState<number | null>(null);
  const collapsed = reserved !== null;
  // How far the expanded header scrolls before it sticks with a strip's height
  // of itself still showing. The sticking is the browser's and not the swap's:
  // WebKitGTK scrolls off the main thread and tells the page late, and a strip
  // that waited for the scroll event arrived after the header had gone, over
  // a page with no bar at all. Stuck this way, the bar is there from the frame
  // the header reaches the top, and the swap only changes what it holds.
  const [stickAt, setStickAt] = useState(0);
  // A scroll that crosses the line fades the new shape in rather than cutting
  // to it. Only a scroll: a remeasure, a new search or the view showing again
  // swaps where nobody is watching the line.
  const controls = useRef<HTMLDivElement | null>(null);
  const fadeNext = useRef(false);
  const fading = useRef<Animation | null>(null);
  const followScroll = useCallback(
    (fade = false) => {
      record();
      const at = scroller.current?.scrollTop ?? 0;
      const wasCollapsed = header.current?.dataset.collapsed === "true";
      if (header.current && !wasCollapsed) {
        expandedHeight.current = header.current.offsetHeight;
      }
      const reserve = Math.max(0, expandedHeight.current - STRIP_HEIGHT);
      const collapse = at > reserve;
      if (fade && collapse !== wasCollapsed) fadeNext.current = true;
      setStickAt(reserve);
      setReserved(collapse ? reserve : null);
    },
    [scroller, record],
  );
  useLayoutEffect(() => {
    const fade = fadeNext.current;
    fadeNext.current = false;
    fading.current?.cancel();
    fading.current = null;
    if (!fade || typeof controls.current?.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    fading.current = controls.current.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: FADE_MS, easing: "ease-out" },
    );
  }, [collapsed]);

  // A resize while collapsed can rewrap the expanded pills, and the height kept
  // from before would move the Results when the header next expands. So the
  // header expands for one layout, which is measured before it paints, and
  // collapses again from the new height. A width of zero is the shell hiding
  // the view, which says nothing about the layout it will show with.
  const remeasure = useRef(false);
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === 0) return;
      // Expanded, the header can be measured as it is, and a rewrap moves
      // where it sticks.
      if (header.current?.dataset.collapsed !== "true") {
        followScroll();
        return;
      }
      remeasure.current = true;
      setReserved(null);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [scroller, followScroll]);
  useLayoutEffect(() => {
    if (reserved !== null || !remeasure.current) return;
    remeasure.current = false;
    followScroll();
  }, [reserved, followScroll]);

  // The view showing again, with the offset `useKeptScroll` just put back.
  useLayoutEffect(() => {
    if (!showing || !scroller.current) return;
    followScroll();
  }, [showing, scroller, followScroll]);

  const onScroll = useCallback(() => followScroll(true), [followScroll]);
  const toTop = useCallback(() => {
    backToTop();
    setReserved(null);
  }, [backToTop]);

  return {
    scroller,
    header,
    controls,
    collapsed,
    style: collapsed ? { marginBottom: reserved } : { top: -stickAt },
    onScroll,
    toTop,
  };
}
