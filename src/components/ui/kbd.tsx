import type { ReactNode } from "react";

/**
 * One key, drawn as a key.
 *
 * The shortcuts dialog is where the whole set is written down and it is not the
 * only place the app names a key: Rank prints the arrow that picks each side,
 * and the Settings bar names Escape beside the control that does the same
 * thing. A key that looks like a key in one of those and like prose in another
 * is the same fact in two voices, so the treatment is declared once.
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground">
      {children}
    </kbd>
  );
}
