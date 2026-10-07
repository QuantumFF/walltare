/**
 * A plain wheel over a scroller that only scrolls sideways, such as Review's
 * filmstrip, moving it sideways.
 *
 * A mouse wheel only ever sends a vertical delta, and a box that scrolls on the
 * horizontal axis alone ignores one, so without this the filmstrip moves only
 * from its scrollbar or a trackpad's sideways swipe.
 *
 * It shares the wheel with the density gesture (`density.ts`, #264): with Ctrl
 * held the event is the density's, so it is left alone here. A swipe that is
 * already mostly sideways is the browser's own and left alone as well.
 */
import { useEffect, type RefObject } from "react";

/**
 * The plain wheel over `target` scrolling it sideways.
 *
 * An effect rather than React's `onWheel`, for `useDensityWheel`'s reason: React
 * listens passively, and the vertical scroll has to be refused so that it does
 * not also reach whatever is behind. Refused only when the box can still move
 * that way, though, so a filmstrip that fits, or one already at its end, hands
 * the wheel on as if this were not here.
 *
 * WebKit reports every wheel delta in pixels, so the delta is the distance.
 */
export function useSidewaysWheel(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const end = node.scrollWidth - node.clientWidth;
      const room = event.deltaY > 0 ? end - node.scrollLeft : node.scrollLeft;
      if (room <= 0) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [target]);
}
