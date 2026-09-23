/**
 * The Status transitions a curator can ask for, what each Status offers, and how
 * each one reads on the control that makes it.
 *
 * A module of its own rather than a corner of the card's file, because nothing
 * here is a fact about a card. The card's overlay, Review's strip and the
 * lightbox's row all render their buttons from these tables, the keymap resolves
 * `K`, `Delete` and `R` against them, and the toast and `useWallpaperRows` name
 * a transition by the same four words. Before #286 every one of those imported
 * a component module to learn them, and the toast kept a second copy of the type
 * under another name.
 */
import type { Status } from "@/lib/client";
import {
  Check,
  FolderInput,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from "lucide-react";

/**
 * The four transitions, named after the resulting Status where the domain has no
 * verb for one: `make-active` is the keep inverse, which CONTEXT.md leaves
 * unnamed on purpose and ADR 0019 labels **Make Active** rather than coining a
 * noun.
 */
export type TransitionAction = "keep" | "reject" | "make-active" | "restore";

/**
 * What each Status offers: Active gets Keep and Reject, Kept gets Make Active
 * and Reject, Rejected gets Restore (ADR 0019).
 *
 * One table, read by every surface. The buttons render from it, and the direct
 * keys resolve against it in the keymap, so a key cannot offer a transition the
 * buttons do not — and no surface can drift into asking for one the domain
 * refuses. CONTEXT.md is what makes that a correctness rule rather than a
 * tidiness one: Active becomes Kept or Rejected, Kept becomes Rejected or Active
 * again, Rejected becomes Active again by a Restore, and anything else is an
 * error the backend answers with `invalid_transition` rather than a no-op. Every
 * entry here is one of those legal moves; a key that finds none simply does
 * nothing.
 */
export const STATUS_ACTIONS: Record<Status, readonly TransitionAction[]> = {
  active: ["keep", "reject"],
  kept: ["make-active", "reject"],
  rejected: ["restore"],
};

/**
 * How each action reads on the control that makes it.
 *
 * **Make Active** is the keep inverse's label, naming the resulting Status
 * rather than coining a noun — not "Un-keep", and not the prototype's "Return to
 * voting", which is wrong against the glossary: a Kept wallpaper already votes,
 * and what un-keeping restores is appearance in Review (ADR 0017, ADR 0019).
 *
 * Shared because the card, the strip and the lightbox each put the same four on
 * their own row. Each surface has its own layout and its own accessible name,
 * and none of that is the wording, which is the half that must not differ: the
 * label above is the one ADR 0019 argued three alternatives down to, and a
 * second copy of it is where "Un-keep" comes back.
 */
export const ACTION_CONTROLS: Record<
  TransitionAction,
  { label: string; Icon: LucideIcon; destructive?: boolean }
> = {
  keep: { label: "Keep", Icon: Check },
  "make-active": { label: "Make Active", Icon: Undo2 },
  reject: { label: "Reject", Icon: FolderInput, destructive: true },
  restore: { label: "Restore", Icon: RotateCcw },
};
