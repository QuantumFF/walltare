import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

export interface KeptScroll {
  /** The page's scroll box. */
  scroller: RefObject<HTMLDivElement | null>;
  /** The scroll box's `onScroll`, which records where the curator is. */
  onScroll: () => void;
  /** Back to the top, and forget where the curator was. */
  toTop: () => void;
}

/**
 * Where the curator left a page's scroll box, kept for the life of the run and
 * put back when the page shows again (ADR 0015). Library and Discover read it.
 *
 * Recorded as the curator scrolls rather than read off the box on the way out,
 * because `display: none` destroys the box: a hidden container reports an
 * offset of zero, and by the time a page knows it is hidden the offset it
 * wanted is already gone. Put back in a layout effect, before the frame paints,
 * so the restore is never a visible jump from the top. Under a virtualised
 * grid the offset is still the thing to restore: the window is a function of
 * it, so putting the box back is what mounts the rows the curator was looking
 * at.
 *
 * `onScroll` writes a ref and renders nothing, which keeps a wheel gesture off
 * the page that holds this.
 *
 * `toTop` is the page's to call, when a position no longer means anything: a
 * reordered list, a new search.
 *
 * A caller that reads the scroll box after the restore declares its own layout
 * effect on `showing` below this call, since a component's layout effects run
 * in the order they are declared.
 */
export function useKeptScroll(showing: boolean): KeptScroll {
  const scroller = useRef<HTMLDivElement | null>(null);
  const scrollTop = useRef(0);

  useLayoutEffect(() => {
    if (!showing || !scroller.current) return;
    scroller.current.scrollTop = scrollTop.current;
  }, [showing]);

  const onScroll = useCallback(() => {
    scrollTop.current = scroller.current?.scrollTop ?? 0;
  }, []);
  const toTop = useCallback(() => {
    scrollTop.current = 0;
    if (scroller.current) scroller.current.scrollTop = 0;
  }, []);

  return { scroller, onScroll, toTop };
}
