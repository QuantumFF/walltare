import { useHandOffOnPointerPress } from "@/context/KeyboardHandoffContext";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * The bar a page owns, directly under the chrome.
 *
 * The chrome is one fixed row on every view, which it can only be if whatever a
 * page needs to say sits below it rather than in it: Rank's Undecided headline,
 * Review's destination line, Library's filter row. So the height is declared
 * here once instead of in three pages that would each drift, and nothing jumps
 * as the curator navigates (ADR 0015). It is the chrome's own `h-12`, held in
 * `pageBarHeight`, which Discover's collapsed header wears as well.
 *
 * It has no surface and no rule (ADR 0063). The chrome above it is bare words,
 * so a band or a line here would be the only drawn edge in the header, and it
 * used to split one header into strips. What tells the bar from the page is
 * what sits on it: a title in a chip, `PageBarTitle`, and every control a
 * pill. The pills are the controls' own — `SegmentedGroup` is one everywhere,
 * and a lone button or drop-down here takes `pageBarPill` where it is written —
 * rather than a rule in this component reaching into the page's children,
 * which would round whatever a page happened to put in the bar, popover
 * triggers it did not mean included.
 *
 * A button in it that the pointer pressed hands the keyboard back to the page.
 * Otherwise it keeps the focus, and the arrows the curator reaches for next go
 * to a button that answers none of them instead of to the grid or filmstrip
 * under it.
 */
/**
 * The bar's height, as the class that sets it and as the number Discover's
 * collapsing header does its arithmetic with (`useCollapsingHeader`). Written
 * side by side so the two cannot be changed apart; Discover's collapsed header
 * is that page's bar, so it wears the class too (ADR 0063).
 */
export const pageBarHeight = "h-12";
export const PAGE_BAR_HEIGHT_PX = 48;

export function PageBar({ children }: { children?: ReactNode }) {
  const handOffOnPointerPress = useHandOffOnPointerPress();

  return (
    <div
      data-slot="page-bar"
      onClick={handOffOnPointerPress}
      className={cn(
        "flex shrink-0 items-center gap-3 px-4 text-sm",
        pageBarHeight,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A lone control's shape in a page bar: a pill the segmented track's 32px tall,
 * so a standalone toggle, drop-down or button stands as high as the tracks and
 * the title chip beside it. A `size="sm"` button alone is 28px, which made
 * Library's bar, the one with the most lone controls, read a size smaller than
 * Rank's.
 *
 * A class the page puts on its own control, not a rule here that reaches into
 * the bar's children (ADR 0063). A `SelectTrigger` takes it at `size="default"`:
 * its `sm` height is a `data-[size=sm]:` utility that outranks a plain `h-8`.
 */
export const pageBarPill = "h-8 rounded-full";

/**
 * What the page is counting or saying about itself, set in a chip at the head
 * of its bar: Rank's Undecided headline and Review's ordering sentence.
 * Settings writes its heading plain (ADR 0063), and Library and Discover have
 * none, because their bars open on a control.
 *
 * A component rather than a style on whatever comes first in the bar, so the
 * page says which element is its title instead of the bar guessing from the
 * order.
 */
export function PageBarTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="page-bar-title"
      className={cn(
        // The segmented track's size, since that is what it sits beside on
        // both pages that have one: a `size="sm"` segment's `h-7` and
        // `0.8rem` inside the track's `p-0.5`.
        "inline-flex h-8 items-center rounded-full bg-muted px-3 text-[0.8rem] font-semibold",
        className,
      )}
      {...props}
    />
  );
}
