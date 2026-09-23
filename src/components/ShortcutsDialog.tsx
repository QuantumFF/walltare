import {
  shortcutLines,
  type AnyActionTable,
  type ShortcutLine,
} from "@/components/keymap";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
 * The two listing groups are not written here at all. They are the keymap's
 * lines, read out of the table the grid, the strip and the lightbox classify
 * their keys against, so the list cannot name a key none of them answers or miss
 * one they do (#286). The keymap says why each line reads as it does — why `←`
 * and `→` are listed for the grid and not again for the lightbox, and why `C`
 * is listed twice. What the lightbox adds by hand is its Escape, which is
 * Radix's `DismissableLayer` and no key of the keymap's.
 *
 * The grid's keys are read by the grid container's own `keydown` and by nothing
 * above it, so they fire only while focus is inside a grid. That is the dividing
 * line ADR 0019 draws — global shortcuts live in the shell's handler, view-local
 * keys live on the element that owns the focus — and it is why `←` and `→` are
 * listed twice: in a grid they move the selection, and they reach Rank only from
 * outside one. Review mounts that grid and the library page mounts the same one
 * (#79), so the heading names the grid rather than either page — and Review's
 * strip beside it, which answers the same keys off the same table (#265).
 *
 * What those surfaces do to the selected item is the page's since #336, so the
 * listing groups are built with the action table of the page the dialog opened
 * over: `K`, `Delete` and `R` over Library and Review, and Discover's own keys
 * over Discover. The listing heading still names wallpapers; #339 rewords it
 * when Discover's rows join the list.
 */
function groupsFor(actions: AnyActionTable): readonly {
  heading: string;
  bindings: readonly ShortcutLine[];
}[] {
  return [
    {
      heading: "Go to",
      bindings: [
        { keys: ["Ctrl", "1"], action: "Rank" },
        { keys: ["Ctrl", "2"], action: "Review" },
        { keys: ["Ctrl", "3"], action: "Library" },
        { keys: ["Ctrl", ","], action: "Settings" },
        { keys: ["Ctrl", "Tab"], action: "Next tab" },
        { keys: ["Ctrl", "Shift", "Tab"], action: "Previous tab" },
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
      heading: "Wallpaper grid and strip",
      bindings: shortcutLines("listing", actions),
    },
    {
      heading: "Lightbox",
      bindings: [
        ...shortcutLines("lightbox", actions),
        { keys: ["Esc"], action: "Close, back to the grid" },
      ],
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
  ];
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
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action table of the page the dialog opened over. */
  actions: AnyActionTable;
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
            {groupsFor(actions).map((group) => (
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
                          <Kbd key={key}>{key}</Kbd>
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
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "absolute top-3 right-3 text-muted-foreground",
            )}
          >
            <X />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
