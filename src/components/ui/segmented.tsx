import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The track's own look, for a primitive that renders its own root. A pill, and
 * the segments in it are pills too (`Button variant="segment"`).
 */
export const segmentedTrack =
  "flex w-fit shrink-0 items-center gap-0.5 rounded-full bg-muted p-0.5 dark:bg-muted/60";

/**
 * The track a row of mutually exclusive options sits in: Rank's Show, Library's
 * Status filter and layout, Review's layout, and Settings' Appearance radios.
 * One shape for all of them, so a choice between options looks like the same
 * kind of thing on every page, and the options inside are
 * `Button variant="segment"`.
 *
 * The shape is a pill, because every control in a page bar is one (ADR 0063).
 * Settings' radios sit in the page body rather than in a bar and are pills all
 * the same: this rule is the older of the two, and a filter and a radio that
 * look like different kinds of thing would undo it to keep a bar-only rule
 * tidy. The chrome's view tabs share none of it: they navigate rather than
 * filter, and are set as bare words.
 *
 * It carries no role of its own; the caller gives it the `group` role and the
 * accessible name.
 */
export function SegmentedGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="segmented-group"
      className={cn(segmentedTrack, className)}
      {...props}
    />
  );
}
