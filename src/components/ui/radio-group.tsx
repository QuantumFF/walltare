import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { buttonVariants } from "@/components/ui/button"
import { segmentedTrack } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

/*
 * Painted as a segmented control rather than as a column of dots, which is what
 * ADR 0020 asked the Appearance section for — the same track and segments the
 * chrome's tabs and the page bars' filters are drawn with.
 * `RadioGroupPrimitive.Indicator` is therefore not wrapped: the selected state
 * is the item raised off the track, and a dot inside it would be a second
 * answer to the same question. Everything
 * that makes this a radio group rather than a row of buttons — one tab stop for
 * the whole group, arrow keys moving the selection, "System, radio button 1 of
 * 3" — is the primitive's and is untouched here.
 */

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn(
        segmentedTrack,
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        buttonVariants({ variant: "segment", size: "sm" }),
        "px-3",
        className
      )}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }
