import {
  STATUS_KEYS,
  answerKey,
  printedKey,
  shortcutLines,
  type Intent,
  type KeyContext,
  type ListingSurface,
} from "@/components/keymap";
import type { TransitionAction } from "@/components/transitions";
import type { Status, Wallpaper } from "@/lib/client";
import { expect, test } from "bun:test";
import { wallpaper } from "./fixtures";

// Every key the three listing surfaces answer, on every surface, through the one
// function all three hand their keydowns to (#286).
//
// Pure, so it wants no mounted page: a surface's own tests keep one test each
// that an intent is acted on, and what a key *means* — which surface answers it,
// which Status offers it, which way it moves — is asserted here once rather than
// once per surface. Each row also asserts the rule the whole table exists to
// hold: a key that is answered is prevented, and one that is not is left alone.
// An arrow that reached Rank's `window` listener unprevented would record a
// permanent Comparison (ADR 0015 as amended, ADR 0019).

type Kind = ListingSurface["kind"];

/** The selected cell, and a button inside it, for the grid's `Enter` guard. */
const cell = document.createElement("div");
const button = document.createElement("button");
const label = document.createElement("span");
button.append(label);
cell.append(button);
const elsewhere = document.createElement("div");

const TARGETS = { cell, button, label, elsewhere } as const;

interface Case {
  on: Kind;
  key: string;
  /** Defaults to an Active wallpaper; `null` is nothing selected. */
  status?: Status | null;
  /** Defaults to 5 of 12, in a grid four wide: row 1, column 1. */
  index?: number;
  length?: number;
  modifiers?: Partial<
    Record<"shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat", boolean>
  >;
  target?: keyof typeof TARGETS;
  /** The intent, without the wallpaper an `act` or `open` carries. */
  means: Meaning | undefined;
}

type WallpaperIntent = Intent<Wallpaper, TransitionAction>;
type Meaning = {
  [K in WallpaperIntent["kind"]]: Omit<
    Extract<WallpaperIntent, { kind: K }>,
    "item"
  >;
}[WallpaperIntent["kind"]];

const COLUMNS = 4;

const CASES: Case[] = [
  // Left and Right walk the list on all three surfaces, and clamp at the ends —
  // still answered there, since the key is the surface's whether or not the
  // selection moves.
  ...(["grid", "strip", "lightbox"] as const).flatMap((on): Case[] => [
    { on, key: "ArrowLeft", means: { kind: "move", to: 4 } },
    { on, key: "ArrowRight", means: { kind: "move", to: 6 } },
    { on, key: "ArrowLeft", index: 0, means: { kind: "move", to: 0 } },
    { on, key: "ArrowRight", index: 11, means: { kind: "move", to: 11 } },
  ]),

  // Up and Down: by the column count in the grid, standing still where the next
  // row has no card in that column rather than clamping to the last card.
  { on: "grid", key: "ArrowUp", means: { kind: "move", to: 1 } },
  { on: "grid", key: "ArrowDown", means: { kind: "move", to: 9 } },
  { on: "grid", key: "ArrowUp", index: 2, means: { kind: "move", to: 2 } },
  { on: "grid", key: "ArrowDown", index: 9, means: { kind: "move", to: 9 } },
  {
    on: "grid",
    key: "ArrowDown",
    index: 7,
    length: 10,
    means: { kind: "move", to: 7 },
  },
  // By one in the strip, which is a single line of wallpapers.
  { on: "strip", key: "ArrowUp", means: { kind: "move", to: 4 } },
  { on: "strip", key: "ArrowDown", means: { kind: "move", to: 6 } },
  { on: "strip", key: "ArrowUp", index: 0, means: { kind: "move", to: 0 } },
  { on: "strip", key: "ArrowDown", index: 11, means: { kind: "move", to: 11 } },
  // And not at all in the lightbox, which walks with Left and Right alone.
  { on: "lightbox", key: "ArrowUp", means: undefined },
  { on: "lightbox", key: "ArrowDown", means: undefined },

  // Home and End, on the two listings only.
  ...(["grid", "strip"] as const).flatMap((on): Case[] => [
    { on, key: "Home", means: { kind: "move", to: 0 } },
    { on, key: "End", means: { kind: "move", to: 11 } },
  ]),
  { on: "lightbox", key: "Home", means: undefined },
  { on: "lightbox", key: "End", means: undefined },

  // The direct keys, resolved against what the Status offers, on all three.
  ...(["grid", "strip", "lightbox"] as const).flatMap((on): Case[] => [
    { on, key: "k", status: "active", means: { kind: "act", action: "keep" } },
    {
      on,
      key: "k",
      status: "kept",
      means: { kind: "act", action: "make-active" },
    },
    { on, key: "k", status: "rejected", means: undefined },
    {
      on,
      key: "Delete",
      status: "active",
      means: { kind: "act", action: "reject" },
    },
    {
      on,
      key: "Delete",
      status: "kept",
      means: { kind: "act", action: "reject" },
    },
    { on, key: "Delete", status: "rejected", means: undefined },
    {
      on,
      key: "r",
      status: "rejected",
      means: { kind: "act", action: "restore" },
    },
    { on, key: "r", status: "active", means: undefined },
    { on, key: "r", status: "kept", means: undefined },
    // Caps Lock on still keeps and still restores.
    { on, key: "K", status: "active", means: { kind: "act", action: "keep" } },
    {
      on,
      key: "R",
      status: "rejected",
      means: { kind: "act", action: "restore" },
    },
  ]),

  // The density, on the two listings, by all four keys. Ahead of the modifier
  // guard, because `+` arrives holding `Shift` on most layouts — and not ahead
  // of `Ctrl`, which is the webview's own zoom.
  ...(["grid", "strip"] as const).flatMap((on): Case[] => [
    { on, key: "+", means: { kind: "density", by: 1 } },
    { on, key: "=", means: { kind: "density", by: 1 } },
    { on, key: "-", means: { kind: "density", by: -1 } },
    { on, key: "_", means: { kind: "density", by: -1 } },
    {
      on,
      key: "+",
      modifiers: { shiftKey: true },
      means: { kind: "density", by: 1 },
    },
    {
      on,
      key: "_",
      modifiers: { shiftKey: true },
      means: { kind: "density", by: -1 },
    },
    { on, key: "+", modifiers: { ctrlKey: true }, means: undefined },
    { on, key: "-", modifiers: { altKey: true }, means: undefined },
    { on, key: "=", modifiers: { metaKey: true }, means: undefined },
    // An empty list still has a size.
    {
      on,
      key: "+",
      status: null,
      index: -1,
      length: 0,
      means: { kind: "density", by: 1 },
    },
  ]),
  { on: "lightbox", key: "+", means: undefined },
  { on: "lightbox", key: "-", means: undefined },

  // The crop preview, on the strip and the lightbox and not over a grid of
  // thumbnails. A held key is answered and toggles nothing.
  ...(["strip", "lightbox"] as const).flatMap((on): Case[] => [
    { on, key: "c", means: { kind: "crop" } },
    { on, key: "C", means: { kind: "crop" } },
    { on, key: "c", modifiers: { repeat: true }, means: { kind: "held" } },
  ]),
  { on: "grid", key: "c", means: undefined },

  // `Enter` opens, from the selected cell in the grid and from anything but a
  // button in the strip. A button's own activation is left to it.
  { on: "grid", key: "Enter", target: "cell", means: { kind: "open" } },
  { on: "grid", key: "Enter", target: "button", means: undefined },
  { on: "grid", key: "Enter", target: "elsewhere", means: undefined },
  { on: "strip", key: "Enter", target: "elsewhere", means: { kind: "open" } },
  { on: "strip", key: "Enter", target: "cell", means: { kind: "open" } },
  { on: "strip", key: "Enter", target: "button", means: undefined },
  { on: "strip", key: "Enter", target: "label", means: undefined },
  // Not the lightbox's: it is the key that opened it.
  { on: "lightbox", key: "Enter", target: "elsewhere", means: undefined },

  // Every other modifier sends every other key away, so the shell's chords
  // reach the shell.
  ...(["grid", "strip", "lightbox"] as const).flatMap((on): Case[] => [
    ...(["shiftKey", "ctrlKey", "altKey", "metaKey"] as const).map(
      (modifier): Case => ({
        on,
        key: "ArrowRight",
        modifiers: { [modifier]: true },
        means: undefined,
      }),
    ),
    { on, key: "k", modifiers: { shiftKey: true }, means: undefined },
    { on, key: "Delete", modifiers: { shiftKey: true }, means: undefined },
    { on, key: "C", modifiers: { shiftKey: true }, means: undefined },
    { on, key: "Enter", modifiers: { shiftKey: true }, means: undefined },
    { on, key: "z", modifiers: { ctrlKey: true }, means: undefined },
    // Nothing selected, nothing to move or act on.
    {
      on,
      key: "ArrowRight",
      status: null,
      index: -1,
      length: 0,
      means: undefined,
    },
    { on, key: "k", status: null, index: -1, length: 0, means: undefined },
    // And keys nothing binds.
    { on, key: "x", means: undefined },
    { on, key: "Escape", means: undefined },
  ]),
];

function surfaceOf(on: Kind): ListingSurface {
  return on === "grid"
    ? { kind: "grid", columns: COLUMNS, cell: () => cell }
    : on === "lightbox"
      ? { kind: on, crop: true }
      : { kind: on };
}

function describe(c: Case): string {
  const held = Object.entries(c.modifiers ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name.replace("Key", ""));
  const on = [c.on, c.target && `from ${c.target}`].filter(Boolean).join(" ");
  const status =
    c.status === null ? "nothing selected" : (c.status ?? "active");
  return `${[...held, c.key].join("+")} on the ${on}, ${status} at ${c.index ?? 5}`;
}

for (const c of CASES) {
  test(describe(c), () => {
    const selected =
      c.status === null ? null : wallpaper(1, { status: c.status ?? "active" });
    const context: KeyContext<Wallpaper> = {
      surface: surfaceOf(c.on),
      selected,
      index: c.index ?? 5,
      length: c.length ?? 12,
    };
    let prevented = false;
    const intent = answerKey(
      {
        key: c.key,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        ...c.modifiers,
        target: TARGETS[c.target ?? "cell"],
        preventDefault: () => {
          prevented = true;
        },
      },
      context,
      STATUS_KEYS,
    );

    if (c.means === undefined) {
      expect(intent).toBeUndefined();
    } else {
      expect(intent).toMatchObject(c.means);
      // A transition and an open are about the wallpaper holding the selection.
      if (intent && "item" in intent) {
        expect(intent.item).toBe(selected!);
      }
    }
    // Answered means prevented, and nothing else is.
    expect(prevented).toBe(c.means !== undefined);
  });
}

// The shortcuts dialog prints the keymap's own lines, so every line it prints
// must be a key the surfaces under its heading answer — a listed key nothing
// reads is worse than one left out.
test("every line the dialog lists is a key its surfaces answer", () => {
  const pressed: Record<string, string> = {
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
  };
  const groups = [
    ["listing", ["grid", "strip"]],
    ["lightbox", ["lightbox"]],
  ] as const;
  for (const [group, surfaces] of groups) {
    for (const line of shortcutLines(group, STATUS_KEYS)) {
      const key = pressed[line.keys[0]] ?? line.keys[0];
      const answered = surfaces.filter(
        (on) =>
          answerKey(
            {
              key,
              shiftKey: false,
              ctrlKey: false,
              altKey: false,
              metaKey: false,
              repeat: false,
              target: on === "grid" ? cell : elsewhere,
              preventDefault: () => {},
            },
            {
              surface: surfaceOf(on),
              selected: wallpaper(1, {
                status: line.keys[0] === "R" ? "rejected" : "active",
              }),
              index: 5,
              length: 12,
            },
            STATUS_KEYS,
          ) !== undefined,
      );
      expect({ line: line.action, answered: answered.length > 0 }).toEqual({
        line: line.action,
        answered: true,
      });
    }
  }
});

// A page's table is read after the shared one, so a key both bind on the same
// surface would never reach the page's action. Every page's table is checked.
test("no page table binds a key the shared table answers on the same surface", () => {
  const pages = { STATUS_KEYS } as const;
  for (const [name, table] of Object.entries(pages)) {
    for (const binding of table.bindings) {
      for (const on of binding.on) {
        for (const key of binding.keys) {
          // A key the shared table answers is answered with no page table at
          // all: an empty one leaves only the shared keys to answer.
          const shared = answerKey(
            {
              key,
              shiftKey: false,
              ctrlKey: false,
              altKey: false,
              metaKey: false,
              repeat: false,
              target: on === "grid" ? cell : elsewhere,
              preventDefault: () => {},
            },
            {
              surface: surfaceOf(on),
              selected: wallpaper(1),
              index: 5,
              length: 12,
            },
            { bindings: [], offers: () => [] },
          );
          expect({ name, on, key, shared }).toEqual({
            name,
            on,
            key,
            shared: undefined,
          });
        }
      }
    }
  }
});

// A button carries the key that fires it, read off the same table, so a
// rebinding takes the print with it (#140).
test("each transition's button prints the key the keymap answers it by", () => {
  expect(printedKey("keep", STATUS_KEYS)).toBe("K");
  expect(printedKey("make-active", STATUS_KEYS)).toBe("K");
  expect(printedKey("reject", STATUS_KEYS)).toBe("Del");
  expect(printedKey("restore", STATUS_KEYS)).toBe("R");
});

// The crop preview is opt-in on the lightbox since #338, and a lightbox that
// leaves it out leaves `C` alone: unanswered, so unprevented.
test("C goes unanswered on a lightbox that offers no crop preview", () => {
  let prevented = false;
  const intent = answerKey(
    {
      key: "c",
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      target: elsewhere,
      preventDefault: () => {
        prevented = true;
      },
    },
    {
      surface: { kind: "lightbox", crop: false },
      selected: wallpaper(1),
      index: 5,
      length: 12,
    },
    STATUS_KEYS,
  );
  expect(intent).toBeUndefined();
  expect(prevented).toBe(false);
});
