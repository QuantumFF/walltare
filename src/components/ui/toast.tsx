import * as React from "react"
import { Toast as ToastPrimitive } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * ADR 0009's eight seconds, set once on the provider instead of on every call.
 * An error toast passes `duration={Infinity}`, which Radix reads as "never arm
 * the close timer" rather than as a very long one.
 */
const TOAST_DURATION = 8000

function ToastProvider({
  duration = TOAST_DURATION,
  swipeDirection = "right",
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  return (
    <ToastPrimitive.Provider
      duration={duration}
      swipeDirection={swipeDirection}
      {...props}
    />
  )
}

function ToastViewport({
  className,
  hotkey = ["F8"],
  label = "Notifications ({hotkey})",
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      // Both are Radix defaults, written out because they are the reason this
      // sits on the primitive at all: the viewport is an `ol` landmark that F8
      // moves focus into, and Radix substitutes the key into `{hotkey}` so the
      // landmark's own name tells you which key gets you there.
      hotkey={hotkey}
      label={label}
      className={cn(
        // `top-14` is ADR 0017's placement: the 48px chrome row plus the 8px
        // gap, so the toast clears the gear and overlays the page's second bar
        // instead. The z-index is the load-bearing half. Radix does not portal
        // the viewport — it renders where it is mounted — and Keep and Reject
        // fire from inside the lightbox, whose backdrop is opaque, so anything
        // at or below the dialog layer's `z-50` would be invisible during the
        // exact flow the toast exists for. ADR 0022 covers the other half:
        // painting on top is not enough if a *modal* layer `aria-hidden`s the
        // siblings around it, which is why the lightbox is non-modal.
        "pointer-events-none fixed top-14 right-4 z-[60] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 outline-none",
        className,
      )}
      {...props}
    />
  )
}

function Toast({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root>) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        // Two auto columns after the text so an action and a close can sit
        // beside it without either being required; empty ones collapse, which
        // is why the spacing rides on the buttons rather than on a column gap.
        // The palette is all tokens, so both themes come from index.css.
        "pointer-events-auto grid max-w-[min(24rem,calc(100vw-2rem))] grid-cols-[1fr_auto_auto] items-center rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-card-foreground shadow-lg outline-none",
        "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-4 data-closed:animate-out data-closed:fade-out-0 duration-150",
        // The swipe Radix already implements: it reports the drag as a data
        // attribute and the live offset as a custom property, and the styling
        // is all that is left to supply.
        "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function ToastTitle({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("col-start-1 min-w-0 font-medium", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn(
        "col-start-1 mt-0.5 min-w-0 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function ToastAction({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Action>) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      // `altText` stays required, inherited from the primitive's own props: it
      // is the only route to this button for a reader who cannot tab to it
      // inside eight seconds, and Radix announces it in place of the label.
      className={cn(
        "col-start-2 row-start-1 row-span-2 ml-3 self-center rounded-md font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  "aria-label": ariaLabel = "Dismiss",
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={ariaLabel}
      className={cn(
        "col-start-3 row-start-1 row-span-2 ml-3 self-center rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      {children ?? <X className="size-3.5" />}
    </ToastPrimitive.Close>
  )
}

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
}
