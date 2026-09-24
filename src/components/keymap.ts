/**
 * The keys the listing surfaces answer: the grid, Review's strip and the
 * lightbox, as one table and one reading of it (#286).
 *
 * Each surface keeps its own listener — `onKeyDown` on the grid's and the
 * strip's container, `window` for the lightbox, for the reasons written beside
 * each — and hands every keypress here. What comes back is what the key means on
 * that surface for the wallpaper it has selected: a move to an index, a
 * transition, an open, a density step, the crop preview, or nothing. What the
 * surface then does with it stays its own, since only it knows how to move its
 * cursor or size its density.
 *
 * Before this the same seven steps were written out three times, in the same
 * order, with the differences between the surfaces left as drift between the
 * copies rather than said anywhere. They are said here, as the two things a
 * surface tells this module about itself: how far Up and Down go, and where
 * `Enter` may open from. The shortcuts dialog renders from the same table, so a
 * listed key is a key something answers.
 *
 * **Two tables since #336, one shared and one per page.** Moving, opening and
 * the density mean the same on every listing whatever it lists, so they are
 * `BINDINGS` below and every surface reads them. What a key *does to* the
 * selected item is the page's: Library and Review act on a Wallpaper's Status
 * through `STATUS_KEYS`, and Discover acts on Results through a table of its
 * own. A surface is handed the page's table beside the event, and the shortcuts
 * dialog prints the shared lines with whichever table the page it opened over
 * uses.
 */
import {
  STATUS_ACTIONS,
  type TransitionAction,
} from "@/components/transitions";
import type { Wallpaper } from "@/lib/client";

/**
 * Which surface is asking, and the two facts about it that change what a key
 * means.
 *
 * The grid moves Up and Down by its column count, and the strip moves them by
 * one, because a filmstrip is one line of wallpapers however it is laid out and
 * there is no second axis for them to mean anything else on. With one column the
 * grid's rule is the strip's: the clamp at the ends falls out of the same
 * arithmetic.
 *
 * The grid opens on `Enter` only from the selected cell itself, so it asks for
 * that cell. Lazily, because only `Enter` needs it and a query per arrow key
 * would be a query for nothing.
 *
 * The lightbox says whether it offers the crop preview, since #338 made that
 * opt-in: Library's and Review's do, and a lightbox that does not leaves `C`
 * alone rather than answering it with nothing.
 */
export type ListingSurface =
  | { kind: "grid"; columns: number; cell: () => Element | null }
  | { kind: "strip" }
  | { kind: "lightbox"; crop: boolean };

type SurfaceKind = ListingSurface["kind"];

/** Where a key lands: the surface, and the selection it holds right now. */
export interface KeyContext<T, S extends ListingSurface = ListingSurface> {
  surface: S;
  /** The selected item, or `null` when there is none. */
  selected: T | null;
  /** The selection's position in the list, or -1 when there is none. */
  index: number;
  /** How many items the list holds. */
  length: number;
}

/**
 * The part of a keydown this module reads, which both React's synthetic event
 * and the DOM's own carry. The lightbox listens on `window` and the other two
 * through React, and a type naming either would turn one of them away.
 */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
}

/**
 * What an answered key asks the surface to do.
 *
 * `held` is a toggle's key held down: answered, so it goes nowhere else, and
 * doing nothing, because a toggle that flipped at the key repeat rate would
 * strobe (#266).
 */
export type Intent<T, A extends string> =
  | { kind: "move"; to: number }
  | { kind: "act"; action: A; item: T }
  | { kind: "open"; item: T }
  | { kind: "density"; by: number }
  | { kind: "crop" }
  | { kind: "held" };

type Does =
  | { move: "previous" | "next" | "up" | "down" | "first" | "last" }
  | { density: number }
  | "open"
  | "crop";

/**
 * The two places a listing key is written down in the shortcuts dialog: under
 * the heading both listing surfaces share, and under the lightbox's.
 */
export type ShortcutGroup = "listing" | "lightbox";

/** What a key is bound to and how it is written down, in either table. */
interface BoundKey {
  /** The `event.key` values it answers to, compared without case. */
  keys: readonly string[];
  /** How the shortcuts dialog prints it. */
  printed: string;
  /** How a button firing it prints it, where that differs from `printed`. */
  button?: string;
  /** The surfaces that answer it. */
  on: readonly SurfaceKind[];
  /** Its line in the shortcuts dialog, per group it is listed under. */
  listed: Partial<Record<ShortcutGroup, string>>;
}

interface Binding extends BoundKey {
  does: Does;
}

/**
 * One key of a page's action table: the actions it names, of which the first
 * the selected item offers is the one it fires.
 */
export interface ActionBinding<A extends string> extends BoundKey {
  act: readonly A[];
}

/**
 * What a key does to the selected item on one page: the keys, and which of
 * their actions a given item offers.
 *
 * `offers` is the page's own rule, and it is what makes a key that names an
 * action the item does not offer a key left alone rather than a wrong action.
 * For Library and Review it is `STATUS_ACTIONS`, the table every card's buttons
 * render from.
 *
 * No key here may be one `BINDINGS` answers on the same surface: the shared
 * table is read first, so the page's binding would never be reached.
 */
export interface ActionTable<T, A extends string> {
  bindings: readonly ActionBinding<A>[];
  offers: (item: T) => readonly A[];
}

/**
 * A table read for its keys alone, which is every reader but the one that
 * resolves a keypress against an item: the shortcuts dialog and a button's
 * printed key. Any page's table is one.
 */
export type AnyActionTable = ActionTable<never, string>;

const ALL = ["grid", "strip", "lightbox"] as const;
const LISTINGS = ["grid", "strip"] as const;

/**
 * Every key a listing surface answers whatever it lists, in the order the
 * shortcuts dialog lists them — with the page's action table between `Enter`
 * and the density, which is where the transitions always sat.
 *
 * No two entries share a key on the same surface, so the order says nothing
 * about which wins. The one ordering that does matter — the density keys ahead
 * of the guard against modifiers — is a property of those two entries, and
 * `intentOf` reads it off them.
 *
 * **Left and Right walk the list** rather than stopping at the visual row edge.
 * The rows are a wrapping of one sequence, and a sweep reads it as one: stopping
 * at the edge would mean the only way past card 4 of a five-column grid is Down
 * and then Home, four times a row. The lightbox walks with the same two, which is
 * ADR 0022's one vocabulary, and lists neither: they are already listed twice,
 * for Rank and for the grid, and a third copy saying the same thing about a third
 * surface would make the list longer without making it truer.
 *
 * **Up and Down move by the row**, and do nothing when there is no card in that
 * column of the next row. Clamping to the last card instead would make Down mean
 * two different things depending on how full the last row happens to be. The
 * column count and not the plan, in every layout: under masonry the card that
 * number lands on is usually the one below and is not obliged to be, and reading
 * the plan here is the version where Down means one thing in the grid and
 * another in masonry (#255). The strip has one column, so there they walk the
 * queue like Left and Right, and a curator sweeping a worklist does not have to
 * notice which pair of keys that surface chose.
 *
 * **Four density keys for two directions**, because both of the obvious ones need
 * their unshifted twin. `+` is `Shift` and `=` on most layouts, so a curator
 * reaching for it without the shift lands on `=`; `_` is the other half of the
 * same pair for `-`. The numeric keypad reports its own two as `+` and `-`, so it
 * is already covered. Only the keys are listed, because the dialog is a list of
 * keyboard shortcuts and the Ctrl-and-wheel half of the gesture would be the one
 * entry the curator cannot press (#264).
 *
 * **`C` is listed twice with the same action written two ways**, because the
 * difference is which surface answers it. The strip's line says so out loud: the
 * heading above it names the grid as well, and the crop preview is not offered
 * over a grid of thirty thumbnails, where it would be noise rather than an
 * answer (#266).
 */
const BINDINGS = [
  {
    keys: ["ArrowLeft"],
    printed: "←",
    does: { move: "previous" },
    on: ALL,
    listed: { listing: "Select the wallpaper before this one" },
  },
  {
    keys: ["ArrowRight"],
    printed: "→",
    does: { move: "next" },
    on: ALL,
    listed: { listing: "Select the wallpaper after this one" },
  },
  {
    keys: ["ArrowUp"],
    printed: "↑",
    does: { move: "up" },
    on: LISTINGS,
    listed: { listing: "Select the wallpaper a row up, or the one before" },
  },
  {
    keys: ["ArrowDown"],
    printed: "↓",
    does: { move: "down" },
    on: LISTINGS,
    listed: { listing: "Select the wallpaper a row down, or the one after" },
  },
  {
    keys: ["Home"],
    printed: "Home",
    does: { move: "first" },
    on: LISTINGS,
    listed: { listing: "Select the first wallpaper" },
  },
  {
    keys: ["End"],
    printed: "End",
    does: { move: "last" },
    on: LISTINGS,
    listed: { listing: "Select the last wallpaper" },
  },
  // Not the lightbox's: `Enter` is the key that opened it (ADR 0022). Its line
  // and the dialog's heading still say "wallpaper" above rows that are now the
  // page's own; #339 rewords them when Discover's rows join the list.
  {
    keys: ["Enter"],
    printed: "Enter",
    does: "open",
    on: LISTINGS,
    listed: { listing: "Open the selected wallpaper" },
  },
  {
    keys: ["+", "="],
    printed: "+",
    does: { density: 1 },
    on: LISTINGS,
    listed: { listing: "Fewer, larger wallpapers" },
  },
  {
    keys: ["-", "_"],
    printed: "-",
    does: { density: -1 },
    on: LISTINGS,
    listed: { listing: "More, smaller wallpapers" },
  },
  {
    keys: ["c"],
    printed: "C",
    does: "crop",
    on: ["strip", "lightbox"],
    listed: {
      listing: "Show what your screen would crop, in the strip",
      lightbox: "Show what your screen would crop",
    },
  },
] as const satisfies readonly Binding[];

/**
 * The keys Library and Review act on a Wallpaper with, resolved against its
 * Status.
 *
 * **`K` names two actions**, because the keep slot has two ends: keeping an
 * Active wallpaper and making a Kept one Active again. One finger, one meaning —
 * "the keep decision" — and the Status picks which end of it applies, so `K` is
 * never a keep on one card and something unrelated on the card beside it.
 *
 * **`Delete` rather than a letter for reject** is what keeps `R` unambiguous. A
 * Rejected card offers only Restore and a non-Rejected card only Reject, so one
 * `R` for both is technically unambiguous and would still be the same finger
 * producing opposite outcomes on cards sitting next to each other in a mixed
 * grid. `Delete` also carries the right shape for the one action here that moves
 * a file (ADR 0019). It prints as `Del` on a button, because the key's own name
 * is wider than the verb in front of it on a row that has a floor to fit inside,
 * and because that is how it is printed on the keyboard the curator is looking
 * at (#140).
 *
 * The shared table is the keymap's and this one is the Status's, but both pages
 * that act on a Status read it, so it lives beside the rule it feeds rather than
 * in either page.
 */
export const STATUS_KEYS: ActionTable<Wallpaper, TransitionAction> = {
  bindings: [
    {
      keys: ["k"],
      printed: "K",
      act: ["keep", "make-active"],
      on: ALL,
      listed: {
        listing: "Keep the selected wallpaper, or make a Kept one Active",
      },
    },
    {
      keys: ["Delete"],
      printed: "Delete",
      button: "Del",
      act: ["reject"],
      on: ALL,
      listed: { listing: "Reject the selected wallpaper" },
    },
    {
      keys: ["r"],
      printed: "R",
      act: ["restore"],
      on: ALL,
      listed: { listing: "Restore the selected wallpaper" },
    },
  ],
  offers: (wallpaper) => STATUS_ACTIONS[wallpaper.status],
};

/** The table read at run time, where one entry's literal types are no help. */
const TABLE: readonly Binding[] = BINDINGS;

/**
 * The intents a surface can be handed, read off the table's `on` lists rather
 * than written beside them.
 *
 * So a surface's handler can switch over exactly these and end in a default
 * that only `undefined` reaches: add a surface to a binding's `on` and every
 * handler that does not yet act on what it means stops compiling, rather than
 * the key being prevented and then doing nothing.
 *
 * `act` is every surface's, because every surface is handed a page's action
 * table: which surfaces a page's key reaches is that table's `on`, read at run
 * time.
 */
export type IntentOn<K extends SurfaceKind, T, A extends string> = Extract<
  Intent<T, A>,
  { kind: KindOf<BoundOn<(typeof BINDINGS)[number], K>["does"]> | "act" }
>;

type BoundOn<B, K> = B extends { on: readonly (infer O)[] }
  ? K extends O
    ? B
    : never
  : never;

type KindOf<D> = D extends { move: unknown }
  ? "move"
  : D extends { density: unknown }
    ? "density"
    : D extends "open"
      ? "open"
      : D extends "crop"
        ? "crop" | "held"
        : never;

/**
 * What a keypress means on this surface, with the key prevented whenever it
 * means anything — or `undefined`, and the key left alone, when it is not this
 * surface's.
 *
 * **Answered means prevented, and that is load-bearing.** Rank stays mounted
 * under `display: none` with its vote listener live on `window`, and it stands
 * down on `defaultPrevented`: an arrow that reached it from a focused grid would
 * record a permanent Comparison between two wallpapers the curator cannot see
 * (ADR 0015 as amended, ADR 0019). So an arrow is answered at the ends of the
 * list too, where the move goes nowhere — the key belongs to the surface whether
 * or not the selection moves — and a held `C` is answered while it toggles
 * nothing. A key that is left alone is left alone entirely: a transition key the
 * Status offers nothing for, and `Enter` on a button, whose own activation is
 * the default this would otherwise cancel.
 */
export function answerKey<S extends ListingSurface, T, A extends string>(
  event: KeyPress,
  context: KeyContext<T, S>,
  actions: ActionTable<T, A>,
): IntentOn<S["kind"], T, A> | undefined {
  const intent = intentOf(event, context, actions);
  if (intent) event.preventDefault();
  // Narrowed by the table's own `on` lists, which `intentOf` is what reads.
  return intent as IntentOn<S["kind"], T, A> | undefined;
}

function intentOf<T, A extends string>(
  event: KeyPress,
  { surface, selected, index, length }: KeyContext<T>,
  actions: ActionTable<T, A>,
): Intent<T, A> | undefined {
  // Every chord the shell answers is a `Ctrl` one and nothing here may eat
  // those: `Ctrl+Z` presses the visible toast's Undo and `Ctrl+2` changes the
  // view from any of these surfaces, because the shell's handler is running and
  // not because a surface reimplemented them. `Ctrl` and `+` is the webview's
  // own zoom and not the curator's density.
  if (event.ctrlKey || event.altKey || event.metaKey) return undefined;

  // Compared without case, so a curator with Caps Lock on still keeps and still
  // restores.
  const key = event.key.toLowerCase();
  const answers = (entry: BoundKey) =>
    entry.on.includes(surface.kind) &&
    entry.keys.some((bound) => bound.toLowerCase() === key);
  const binding = TABLE.find(answers);
  const acting = binding ? undefined : actions.bindings.find(answers);
  if (!binding && !acting) return undefined;

  // The density keys, ahead of the `Shift` half of the guard rather than behind
  // it. `+` is `Shift` and `=` on most layouts, so a curator pressing the key
  // the gesture is named for arrives holding a modifier, and a guard written for
  // the app's chords would send them away. Nor does a density need a selection:
  // an empty grid still has a size.
  const does = binding?.does;
  if (typeof does === "object" && "density" in does) {
    return { kind: "density", by: does.density };
  }

  if (event.shiftKey) return undefined;
  if (index === -1 || !selected) return undefined;

  // The direct keys. The key names candidates, and the page's `offers` — for
  // Library and Review `STATUS_ACTIONS`, the same table every surface's buttons
  // render from — says which of them this item actually offers. So a key the
  // Status has no action for does nothing, which is what makes a wrong key a
  // wrong key rather than a wrong action, and what keeps the keyboard from ever
  // asking for a transition CONTEXT.md calls an error.
  //
  // A single keypress rejects, with no confirm and no modifier. ADR 0009 deleted
  // the confirm dialog and put act-then-undo in its place, so the safety is ADR
  // 0017's toast and the `Ctrl+Z` that presses its Undo. It does mean a stray
  // `Delete` moves a file, which ADR 0019 wrote down as the cost rather than as
  // an oversight.
  if (acting) {
    const offered = actions.offers(selected);
    const action = acting.act.find((candidate) => offered.includes(candidate));
    return action ? { kind: "act", action, item: selected } : undefined;
  }
  if (does === undefined) return undefined;

  // A toggle rather than a hold, so the bars stay up while the curator arrows
  // through the worklist, and once per press rather than per repeat (#266).
  if (does === "crop") {
    if (surface.kind === "lightbox" && !surface.crop) return undefined;
    return event.repeat ? { kind: "held" } : { kind: "crop" };
  }

  if (does === "open") {
    return opensFrom(event.target, surface)
      ? { kind: "open", item: selected }
      : undefined;
  }

  const last = length - 1;
  const stride = surface.kind === "grid" ? surface.columns : 1;
  const to = {
    previous: Math.max(index - 1, 0),
    next: Math.min(index + 1, last),
    up: index - stride < 0 ? index : index - stride,
    down: index + stride > last ? index : index + stride,
    first: 0,
    last,
  }[does.move];
  return { kind: "move", to };
}

/**
 * Whether `Enter` on this target opens the selection, which is the one guard
 * the two surfaces that open on it write differently.
 *
 * Neither opens from a button. A button is still a button, and `Enter` on a
 * focused one activates it, so the press that keeps a wallpaper bubbles through
 * the surface's handler on its way up — and answering it would be a keep with
 * the lightbox opening over the wallpaper it just removed, which is the same
 * two-answers-to-one-press the buttons' `stopPropagation` refuses for the mouse.
 *
 * The grid says it the narrow way, opening only from the selected cell itself,
 * since a cell holds nothing else that `Enter` could be meant for. The strip says
 * it the wide way, opening from anywhere but a button, since its container is
 * what focus falls back to when a press takes the control it was on away.
 */
function opensFrom(target: EventTarget | null, surface: ListingSurface) {
  switch (surface.kind) {
    case "grid":
      return target === surface.cell();
    case "strip":
      return !(target instanceof HTMLElement && target.closest("button"));
    case "lightbox":
      return false;
  }
}

/**
 * The key that fires an action, spelled as the control firing it prints it:
 * `Keep K`, `Reject Del`, `Restore R`, and `Make Active K` for the other end of
 * the keep slot (#140) — and `C` on the crop preview's toggle, a button that
 * fires one of the shared table's plain intents rather than a page's action.
 *
 * Read out of the tables rather than written a second time beside the labels,
 * so a rebinding takes the print with it: a button carrying a key that no longer
 * works is worse than a button carrying no key at all, and #140 puts the key on
 * the button precisely because that is the copy that survives the row
 * narrowing. A page's action is looked up in that page's table, which the
 * caller names. Every action is bound, so the empty string is what a future
 * unbound one would print rather than a case the app reaches.
 */
export function printedKey(action: PlainButton): string;
export function printedKey<A extends string>(
  action: A,
  actions: ActionTable<never, A>,
): string;
export function printedKey(action: string, actions?: AnyActionTable): string {
  const bound = bindingOf(action, actions);
  return bound ? (bound.button ?? bound.printed) : "";
}

/**
 * The same key as a button's `aria-keyshortcuts` names it: the table's own
 * spelling, which for every key a button fires is the one ARIA uses —
 * `Delete` where the button prints `Del`. The chip is hidden from a screen
 * reader, so this is where the binding reaches one.
 */
export function keyShortcut(action: PlainButton): string;
export function keyShortcut<A extends string>(
  action: A,
  actions: ActionTable<never, A>,
): string;
export function keyShortcut(action: string, actions?: AnyActionTable): string {
  return bindingOf(action, actions)?.printed ?? "";
}

/** What a button can fire off the shared table: one of its plain intents. */
type PlainButton = Extract<Does, string>;

function bindingOf(
  action: string,
  actions: AnyActionTable | undefined,
): BoundKey | undefined {
  return actions
    ? actions.bindings.find(({ act }) => act.includes(action))
    : TABLE.find(({ does }) => does === action);
}

/** One line of the shortcuts dialog. */
export interface ShortcutLine {
  keys: readonly string[];
  action: string;
}

/**
 * The lines the shortcuts dialog prints under one group: the shared table's, with
 * the page's action table after `Enter`.
 *
 * Read from the bindings rather than written beside them, so the list cannot
 * name a key nothing answers or leave out one something does: the dialog is the
 * one place the whole set is written down, and copy that drifts from what the
 * app binds is the failure it exists to prevent (ADR 0015).
 */
export function shortcutLines(
  group: ShortcutGroup,
  actions: AnyActionTable,
): ShortcutLine[] {
  const opens = TABLE.findIndex(({ does }) => does === "open") + 1;
  const ordered: readonly BoundKey[] = [
    ...TABLE.slice(0, opens),
    ...actions.bindings,
    ...TABLE.slice(opens),
  ];
  return ordered.flatMap((binding) => {
    const action = binding.listed[group];
    return action ? [{ keys: [binding.printed], action }] : [];
  });
}
