import { useHandOffOnPointerPress } from "@/context/KeyboardHandoffContext";
import {
  ChromeVariantContext,
  pageBarClass,
} from "@/components/prototype/ChromeVariants.prototype";
import { useContext, type ReactNode } from "react";

/**
 * The bar a page owns, directly under the chrome.
 *
 * The chrome is one fixed row on every view, which it can only be if whatever a
 * page needs to say sits below it rather than in it: Rank's Undecided headline,
 * Review's destination line, Library's filter row. So the height is declared
 * here once instead of in three pages that would each drift, and nothing jumps
 * as the curator navigates (ADR 0015).
 *
 * A button in it that the pointer pressed hands the keyboard back to the page.
 * Otherwise it keeps the focus, and the arrows the curator reaches for next go
 * to a button that answers none of them instead of to the grid or filmstrip
 * under it.
 */
export function PageBar({ children }: { children?: ReactNode }) {
  const handOffOnPointerPress = useHandOffOnPointerPress();
  // PROTOTYPE: styled to match the chrome variant.
  const variant = useContext(ChromeVariantContext);

  return (
    <div
      data-slot="page-bar"
      onClick={handOffOnPointerPress}
      className={pageBarClass(variant)}
    >
      {children}
    </div>
  );
}
