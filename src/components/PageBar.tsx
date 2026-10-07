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
 * as the curator navigates (ADR 0015). It is the chrome's own `h-12`, and
 * Discover's collapsed header holds the same number (`useCollapsingHeader`).
 *
 * It has no surface and no rule (ADR 0063). The chrome above it is bare words,
 * so a band or a line here would be the only drawn edge in the header, and it
 * used to split one header into strips. What tells the bar from the page is
 * what sits on it: a title in a chip, `PageBarTitle`, and every control a
 * pill. The pills are the controls' own — `SegmentedGroup` is one everywhere,
 * and a lone button or drop-down here takes `rounded-full` where it is
 * written, the way Discover's pills already did — rather than a rule in this
 * component reaching into the page's children, which would round whatever a
 * page happened to put in the bar, popover triggers it did not mean included.
 *
 * A button in it that the pointer pressed hands the keyboard back to the page.
 * Otherwise it keeps the focus, and the arrows the curator reaches for next go
 * to a button that answers none of them instead of to the grid or filmstrip
 * under it.
 */
export function PageBar({ children }: { children?: ReactNode }) {
  const handOffOnPointerPress = useHandOffOnPointerPress();

  return (
    <div
      data-slot="page-bar"
      onClick={handOffOnPointerPress}
      className="flex h-12 shrink-0 items-center gap-3 px-4 text-sm"
    >
      {children}
    </div>
  );
}

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
        "rounded-full bg-muted px-3.5 py-1 font-semibold",
        className,
      )}
      {...props}
    />
  );
}
