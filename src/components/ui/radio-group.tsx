import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * Painted as a segmented control rather than as a column of dots, which is what
 * ADR 0020 asked the Appearance section for. `RadioGroupPrimitive.Indicator` is
 * therefore not wrapped: the selected state is the item's own filled surface,
 * and a dot inside it would be a second answer to the same question. Everything
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
        "bg-muted inline-flex w-fit items-center gap-1 rounded-lg p-1",
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
        "focus-visible:ring-ring/50 data-[state=checked]:bg-background data-[state=checked]:text-foreground text-muted-foreground hover:text-foreground inline-flex h-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] px-3 text-[0.8rem] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:shadow-xs",
        className
      )}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }
