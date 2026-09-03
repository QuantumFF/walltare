# ADR 0026: The Written path field is one module, and the sentence under it is the caller's

**Status:** Accepted
**Ticket:** [#154](https://github.com/QuantumFF/walltare/issues/154)
**Date:** 2026-09-03

## Context

Two settings hold a Written path, the Library root and the reject destination
([ADR 0010](0010-settings-store.md), [ADR 0011](0011-written-paths.md)).
`usePathField` (`SettingsView.tsx:129-181`) found that concept and stopped at
holding four fields, so everything around it is written twice:

| what | Library root | Reject destination |
| --- | --- | --- |
| `browse` | `:238-252` | `:435-450` |
| commit-error wrapper | `:232-236` | `:429-433` |
| field plus Browse markup | `:321-345` | `:478-500` |
| status line, as its own IIFE | `:297-311` | `:465-474` |

The `browse` pair is identical across fifteen lines apart from which setter it
calls, console message included. The blur wrapper differs in that one message.
The markup differs in an `aria-label`, a placeholder and the Enter handler.

What looks like the real difference is the status line, and it is not.
[ADR 0020](0020-settings-page.md) gave the two fields different tables. The
Library root has four candidates competing for one line and a not-found clause
to append; the Reject destination has three rows and no not-found state ever.
But the classes those two tables resolve to are one vocabulary of three tones.
`DESTINATION_LINE_CLASS` names all three, and the Library root's boolean picks
two of the same three, character for character:

| tone | class | Library root | Reject destination |
| --- | --- | --- | --- |
| `path` | `font-mono text-xs break-all text-muted-foreground` | the resolved path, with or without the clause | absolute |
| `rule` | `text-xs text-muted-foreground` | never | relative |
| `error` | `text-xs text-destructive` | a failed Scan, `InvalidPathSyntax` | `InvalidPathSyntax` |

So the two sentences differ and the two class schemes do not. That is what makes
the line shareable without reopening ADR 0020.

The ticket was written against `3897ed2`. The file is 1015 lines, not the 1047
it reports, and every line number above is about fifteen lower than the one it
quotes. All four rows of its table survived; nothing else in it expired.

## Decision

### One hook, one object, one row

`usePathField(key, options?)` returns a single `PathField` object rather than
six loose values, and `<PathFieldRow field={…} />` takes that object whole. This
is the shape of `useRejectDestination` and `RejectDestinationLine`, for the same
reason those have it: one hook, one object, and consumers that cannot end up
looking at two different answers about one string.

The object holds `value`, `expansion`, the `field` and `section` refs, `commit`,
and the two handlers the row wires up, `browse` and `commitFromBlur`.

The alternative was `<PathField setting="library_root" />` calling the hook
itself. Smaller interface, and it does not survive the Library root: Scan reads
`value` three times (`startScan`, `scanStarted`, `disabled`), awaits `commit`
before it walks anything, and clears the scan error on every keystroke. Three
quarters of the hook would come back out through callbacks and a render prop,
which is a larger interface than the one it replaced.

`options.onEdit` is how the scan error gets cleared now that the module owns the
`onChange`. It fires on typing and on a Browse pick, which are exactly the two
places `edit` is called today, because a freshly picked folder makes a stale
Scan error just as untrue as a keystroke does. The Reject destination passes no
options.

### The module renders the field, Browse, and the status shell

The caller passes `{ tone, text } | null`. The module owns the three-tone class
map, the `<p>` around it, and the `data-slot`, which it derives from the key:
`library_root` becomes `library-root-status`.

ADR 0020's two tables stay in the two sections, where the sentences are. The
Library root keeps its four-way precedence: an empty field says nothing, then a
failed Scan, then a syntax error, then the resolved path with `· folder not
found` appended. The destination keeps its three rows and its silence on an
emptied field. What moves is the wrapper and the class lookup, which is the part
that was one thing said twice.

The module knows neither sentence. `useExpansion` already draws that line in its
own note: it returns an answer, and what to write on the line is the caller's.

### The Scan button is a sibling, not a slot

No `children`, no render prop. The order inside `<Section>` is already field
row, status line, count line, Scan button, so the button sits below the line
rather than beside the field. `LibraryRootSection` renders `<PathFieldRow />`
and then its two extra elements underneath, exactly as it does now. The one
control that only one of the two fields has costs the module's interface
nothing, which is the opposite of what the ticket expected.

### Enter commits, and only the Library root replaces that

ADR 0020: "Enter in the Reject destination field only commits, because there is
nothing there to run." That is the default behaviour of a field that writes on
blur, so the module holds it and `RejectDestinationSection` loses its
`onKeyDown` entirely.

`onEnter` **replaces** the default rather than running before it.
`LibraryRootSection` passes `onEnter={scan}`, and `scan` already awaits
`commit(value)` as its first act, so running both would write one string twice
per Enter. It is harmless today only because `commit` no-ops on a string the
store already holds, and a double write surviving on a guard rather than on
intent is the kind of thing that stops being harmless quietly.

### The key picks the prose

Two strings come off `PathSetting` rather than off a prop: the `data-slot`
above, and the setting's name in the console message when a commit fails
(`Failed to store the library root:` against
`Failed to store the reject destination:`). `browse`'s message is already
identical on both sides, so after this there is one wrapper, one call site per
message, and one two-entry record holding both.

### `useExpansion` and `RejectDestination` do not change

The field resolves the string the curator has **typed**, which moves per
keystroke and does not reach the store until blur. `useRejectDestination`
resolves the **stored** setting. Two different strings, so the destination
section cannot read the shared hook without printing a line about a path that is
not in the field.

Both already sit on `useExpansion` and `isAbsolute`, which is the sharing that
is actually available here and is already taken. `PathFieldRow` is a third
consumer of the one `expand_path` answer, not a second copy of it.

### The file split

`SettingsView.tsx` is 1015 lines holding ten declarations and five copy
constants. `PathFieldRow` needs a file of its own regardless, so three move at
once:

- `src/components/PathField.tsx`: the hook, the `PathField` type, the row, the
  tone map, and the two key-derived records.
- `src/components/ThumbnailsSection.tsx`
- `src/components/SettingsNotices.tsx`: `NoticeBlock` and
  `UnreadableLibraryBlock`.

What is left in `SettingsView.tsx` is `Section`, the two path sections,
Appearance, and the page: four sections in ADR 0020's order, which is what that
ADR says the page is.

This is locality with no leverage, and it wins on that alone. No interface
changes, nothing gets more testable. It is worth one commit inside a refactor
that is already rewriting the file, and it would not be worth its own trip
through it.

## Alternatives rejected

**The module knows both sentences.** One prop fewer and the two tables land in
one place. It puts `Relative, so one rejected folder beside each wallpaper.`
inside a module the Library root also renders, and the not-found clause inside
one the destination renders, so each caller carries copy that ADR 0020 says can
never appear under its field. It also hands the module `scanError`, which is
Library-root state about a command the module has never heard of.

**The field and Browse only, leaving both status blocks with their callers.**
The safe answer, and the right one if the tones had differed. They do not, so it
keeps two identical `<p>` wrappers and two spellings of the same three classes,
which is exactly where the next divergence starts.

**Clearing the scan error from an effect keyed on `field.value`.** Avoids the
options bag. It clears a paint late, and at the point of the effect there is
nothing to say why a value moving has anything to do with a Scan that failed.

**Splitting the file in its own issue.** Keeps a pure-motion commit away from a
refactor. The refactor is opening this file anyway and adding a fourth
component to it, so deferring the split means reading 1015 lines twice.

## Consequences

`RejectDestinationSection` becomes a hook call, a status IIFE and one element.
Its `browse`, its `store` wrapper and its `onKeyDown` all go.

The row is one module with two callers, which is the count the seam rule asks
for. It will not get a third: ADR 0010 fixed the settings key set at three and
only two of them are Written paths. The module is justified by drift between two
copies, not by a caller that might arrive.

Behaviour-preserving in full. No copy changes, no tone changes, no change to
either precedence order, no new state, and the focus-and-scroll effect moves
unaltered.

`tests/SettingsView.test.tsx` addresses both fields through `getByLabelText` and
both lines through their `data-slot`, and both survive the move, so the suite
should pass unedited. If it does not, the move changed something this ADR says
it does not.
