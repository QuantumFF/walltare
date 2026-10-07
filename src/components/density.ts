/**
 * The density gesture's wheel half: Ctrl and the wheel, read the same way by
 * every surface that has a density (#264).
 *
 * Two surfaces answer it. The grid moves a column count and Review's strip moves
 * its filmstrip's height, but what counts as "in" and "out", and how the webview's
 * own zoom is refused, is one rule. It sits here, the way `selection.ts` holds the
 * cursor, so the strip does not import a grid to learn what a wheel means. The
 * plus and minus keys are the gesture's other half, and they live in the keymap
 * beside every other key those surfaces answer (#286).
 *
 * What each surface does with a step stays its own. This module turns an event
 * into a step and nothing else.
 */
import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

/**
 * A density held by the host rather than the surface, as the `useState` pair
 * that holds it.
 *
 * Review swaps its grid for its strip by unmounting one and mounting the other,
 * so a density the surface held was back at its start after every swap. The
 * page holds one per layout and hands each its own.
 */
export type HeldDensity = readonly [number, Dispatch<SetStateAction<number>>];

/** The host's density when it holds one, and the surface's own when not. */
export function useHeldDensity(
  held: HeldDensity | undefined,
  start: number,
): HeldDensity {
  const own = useState(start);
  return held ?? own;
}

/**
 * Ctrl and the wheel over `target`, changing the density rather than the page's
 * scale.
 *
 * An effect rather than React's `onWheel`, and that is the whole reason this is
 * a hook. React attaches its `wheel` listener to the root as a passive one, so
 * `preventDefault` from a synthetic handler is a no-op and the webview zooms the
 * app anyway, which is the one thing #264 says must not happen. A listener with
 * `passive: false` is the only way to refuse it.
 *
 * On the surface's own element and not the window, which is the line ADR 0019
 * draws for keys and the same line here: a surface on a view the shell is only
 * hiding must not answer a wheel over the view in front of it.
 *
 * One step per event. A trackpad pinch sends a run of them and will cross the
 * range in a flick, which the range is what makes survivable.
 *
 * `onStep` should be stable, or the listener is resubscribed on every render.
 */
export function useDensityWheel(
  target: RefObject<HTMLElement | null>,
  onStep: (by: number) => void,
): void {
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      onStep(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [target, onStep]);
}

/**
 * A plain wheel over `target` scrolling it sideways: what a one-line scroller
 * like Review's filmstrip needs, since a mouse wheel only ever sends a vertical
 * delta and a box that scrolls on the horizontal axis alone ignores it. Without
 * this the filmstrip moves only from its scrollbar or a trackpad's sideways
 * swipe.
 *
 * Here beside `useDensityWheel` because the two split one wheel between them:
 * with Ctrl held the event is the density's, so this leaves it alone. A swipe
 * that is already mostly sideways is the browser's own and left alone as well.
 * `passive: false` for the density hook's reason, so the vertical scroll is
 * refused rather than also reaching whatever is behind.
 */
export function useSidewaysWheel(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      // A wheel that counts in lines or pages rather than pixels, which some
      // mice send: a line taken as a line of text, a page as the box's width.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? node.clientWidth
            : 1;
      node.scrollLeft += event.deltaY * unit;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [target]);
}
