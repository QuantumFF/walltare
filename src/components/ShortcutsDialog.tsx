import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

/**
 * Every keyboard binding the app answers, grouped by what owns it.
 *
 * The shell binds four of these and reads none of the rest: the arrows belong
 * to whichever element has focus and reach Rank only when nothing in it does,
 * F8 is Radix's own hotkey written into the toast viewport's label, `Ctrl+Z`
 * presses the Undo on a visible toast, which #112 mounts, and Escape is the
 * Settings page's own. They are listed here anyway because a shortcut nobody
 * can find is a shortcut nobody uses, and this dialog is the one place the whole
 * set is written down (ADR 0015).
 *
 * The grid's nine are read by the grid container's own `keydown` and by nothing
 * above it, so they fire only while focus is inside a grid. That is the dividing
 * line ADR 0019 draws — global shortcuts live in the shell's handler, view-local
 * keys live on the element that owns the focus — and it is why `←` and `→` are
 * listed twice: in a grid they move the selection, and they reach Rank only from
 * outside one. Review mounts that grid today and the library page mounts the
 * same one (#79), so the heading names the grid rather than either page.
 *
 * The lightbox contributes two entries and no more, and that is ADR 0022
 * showing through rather than a gap: it walks with the grid's own `←` and `→`
 * and acts with the grid's `K`, `Delete` and `R`, so the only keys that are
 * its alone are the `Enter` that opens it and the Escape that closes it. `←`
 * and `→` are already listed twice, for Rank and for the grid; a third copy
 * saying the same thing about a third surface would make the list longer
 * without making it truer.
 */
const GROUPS = [
  {
    heading: "Go to",
    bindings: [
      { keys: ["Ctrl", "1"], action: "Rank" },
      { keys: ["Ctrl", "2"], action: "Review" },
      { keys: ["Ctrl", "3"], action: "Library" },
      { keys: ["Ctrl", ","], action: "Settings" },
    ],
  },
  {
    heading: "Rank",
    bindings: [
      { keys: ["←"], action: "Pick the wallpaper on the left" },
      { keys: ["→"], action: "Pick the wallpaper on the right" },
    ],
  },
  {
    heading: "Wallpaper grid",
    bindings: [
      { keys: ["←"], action: "Select the wallpaper before this one" },
      { keys: ["→"], action: "Select the wallpaper after this one" },
      { keys: ["↑"], action: "Select the wallpaper a row up" },
      { keys: ["↓"], action: "Select the wallpaper a row down" },
      { keys: ["Home"], action: "Select the first wallpaper" },
      { keys: ["End"], action: "Select the last wallpaper" },
      { keys: ["Enter"], action: "Open the selected wallpaper" },
      {
        keys: ["K"],
        action: "Keep the selected wallpaper, or make a Kept one Active",
      },
      { keys: ["Delete"], action: "Reject the selected wallpaper" },
      { keys: ["R"], action: "Restore the selected wallpaper" },
    ],
  },
  {
    heading: "Lightbox",
    bindings: [{ keys: ["Esc"], action: "Close, back to the grid" }],
  },
  {
    heading: "Settings",
    bindings: [{ keys: ["Esc"], action: "Close, back to where you were" }],
  },
  {
    heading: "Notifications",
    bindings: [
      { keys: ["Ctrl", "Z"], action: "Undo, on the toast offering it" },
      { keys: ["F8"], action: "Move focus to the notifications" },
    ],
  },
  {
    heading: "Help",
    bindings: [{ keys: ["?"], action: "This list" }],
  },
] as const;

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground">
      {children}
    </kbd>
  );
}

/**
 * The shortcut list, opened by `?` and mounted in the shell.
 *
 * Modal, so Escape and the focus trap come from the primitive rather than from a
 * second keyboard handler arguing with the shell's. It is the one layered
 * surface in the app that may be modal: ADR 0022 made the lightbox non-modal
 * because a modal layer `aria-hidden`s the un-portalled toast viewport, and a
 * list of shortcuts is a surface the curator opened on purpose and dismisses
 * before doing anything else.
 *
 * Built on the primitive directly rather than through a `ui/dialog.tsx`. The
 * lightbox was expected to be the second caller that wanted the wrapper and it
 * turned out not to be: it is non-modal where this is modal, full-screen and
 * opaque where this is a centred card over a blurred overlay, portalled into a
 * shell-owned container rather than the body, and it refuses the outside
 * interactions this one dismisses on. What the two share is `Root`, `Portal`
 * and `Content`, which is the primitive itself (ADR 0022).
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0",
            "fixed inset-0 z-[70] bg-black/20 duration-100 supports-backdrop-filter:backdrop-blur-xs",
          )}
        />
        {/* Above the toast viewport's z-60, which is the whole app's ceiling
            otherwise: a dialog the curator opened themselves is the one thing
            that may sit over a report of background work. */}
        <Dialog.Content
          className={cn(
            "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95",
            "fixed top-1/2 left-1/2 z-[70] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-6 ring-1 ring-foreground/10 outline-none duration-100",
          )}
        >
          <Dialog.Title className="text-lg font-medium">
            Keyboard shortcuts
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            None of these fire while the caret is in a text field, so a path
            with a comma in it stays a path. Escape is the exception, because
            Settings is mostly text fields and closing it has to work from
            inside one.
          </Dialog.Description>

          <div className="mt-5 space-y-5">
            {GROUPS.map((group) => (
              <div key={group.heading}>
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.heading}
                </h3>
                <dl className="mt-2 space-y-1.5">
                  {group.bindings.map((binding) => (
                    <div
                      key={binding.action}
                      className="flex items-baseline justify-between gap-4 text-sm"
                    >
                      <dt className="text-muted-foreground">
                        {binding.action}
                      </dt>
                      <dd className="flex shrink-0 items-center gap-1">
                        {binding.keys.map((key) => (
                          <Key key={key}>{key}</Key>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <Dialog.Close
            aria-label="Close"
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
