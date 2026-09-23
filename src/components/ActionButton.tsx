import { STATUS_KEYS, keyShortcut, printedKey } from "@/components/keymap";
import {
  ACTION_CONTROLS,
  type TransitionAction,
} from "@/components/transitions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

/**
 * One transition as a button: its icon, its verb, and the key that fires it.
 *
 * The Review strip, a card's overlay and the lightbox each drew this themselves
 * and each drew it differently — a bare verb in one, a glass pill in the next,
 * a hand-coloured pair with a key chip in the third — so one decision looked
 * like three controls depending on where the curator made it. This is the one
 * drawing, and the callers differ only in what they hand it.
 *
 * Keep is the page's primary colour and Reject the destructive tint, off the
 * stock variants. The lightbox and the card overlay are dark in both themes,
 * and they get the dark palette by carrying `.dark` rather than by overriding
 * colours here.
 *
 * `aria-disabled` rather than `disabled`, for ADR 0019's reason: an
 * unavailable Restore has a sentence to deliver when pressed, and a disabled
 * button is not focusable.
 */
export function ActionButton({
  action,
  subject,
  unavailable = false,
  className,
  ...props
}: {
  action: TransitionAction;
  /**
   * What the action is on, for the accessible name: `Keep wall-1.jpg`. Left
   * out where the surface is already named by the one wallpaper it shows, as
   * the lightbox's dialog is, and the verb alone is the name.
   */
  subject?: string;
  unavailable?: boolean;
} & Omit<
  ComponentProps<typeof Button>,
  "variant" | "size" | "children" | "aria-label"
>) {
  const { label, Icon, destructive } = ACTION_CONTROLS[action];
  return (
    <Button
      size="sm"
      variant={destructive ? "destructive" : "default"}
      data-action={action}
      aria-label={subject ? `${label} ${subject}` : label}
      aria-disabled={unavailable ? true : undefined}
      aria-keyshortcuts={keyShortcut(action, STATUS_KEYS)}
      className={cn(
        "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
        // The variant's hover, pinned to its resting fill: a control drawn as
        // unavailable does not light up under the pointer. The press does not
        // nudge it either, which the base `Button` already leaves out for
        // `aria-disabled`.
        unavailable &&
          (destructive
            ? "hover:bg-destructive/10 dark:hover:bg-destructive/20"
            : "hover:bg-primary"),
        className,
      )}
      {...props}
    >
      <Icon />
      {/* In its own box so a narrow card truncates the verb rather than
          spilling it past the button's edge. */}
      <span data-slot="action-label" className="min-w-0 truncate">
        {label}
      </span>
      <Kbd aria-hidden>{printedKey(action, STATUS_KEYS)}</Kbd>
    </Button>
  );
}
