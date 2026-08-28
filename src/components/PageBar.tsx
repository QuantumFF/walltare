import type { ReactNode } from "react";

/**
 * The bar a page owns, directly under the chrome.
 *
 * The chrome is one fixed row on every view, which it can only be if whatever a
 * page needs to say sits below it rather than in it: Rank's Round headline,
 * Review's destination line, Library's filter row. So the height is declared
 * here once instead of in three pages that would each drift, and nothing jumps
 * as the curator navigates (ADR 0015).
 */
export function PageBar({ children }: { children?: ReactNode }) {
  return (
    <div
      data-slot="page-bar"
      className="flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-4 text-sm"
    >
      {children}
    </div>
  );
}
