import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** The track's own look, for a primitive that renders its own root. */
export const segmentedTrack =
  "flex w-fit shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5 dark:bg-muted/60";

/**
 * The track a row of mutually exclusive options sits in: Library's Status
 * filter and layout, Review's layout, and Settings' Appearance radios. One
 * shape for all of them, so a choice between options looks like the same kind
 * of thing on every page, and the options inside are `Button variant="segment"`.
 * The chrome's view tabs keep their own filled look: they navigate rather than
 * filter.
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
