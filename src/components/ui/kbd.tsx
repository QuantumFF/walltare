import type { ComponentProps } from "react";

/**
 * One key, drawn as a key.
 *
 * The shortcuts dialog is where the whole set is written down and it is not the
 * only place the app names a key: Rank prints the arrow that picks each side,
 * the action buttons print the key that fires them, and the Settings bar names
 * Escape beside the control that does the same thing. A key that looks like a
 * key in one of those and like prose in another is the same fact in two voices,
 * so the treatment is declared once.
 *
 * Tinted from the text colour rather than from a token, so the same chip reads
 * as part of a white button, a red one, and the page behind neither.
 *
 * On a button, the chip is for an eye: the button names its binding to a
 * screen reader with `aria-keyshortcuts` and hides the chip, so the key is not
 * read as part of what the button is called.
 */
export function Kbd(props: ComponentProps<"kbd">) {
  return (
    <kbd
      {...props}
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-current/10 px-1 font-mono text-[10px] leading-none font-normal ring-1 ring-current/15 ring-inset"
    />
  );
}
