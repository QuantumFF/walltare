# ADR 0031: The command seam is typed, and shared test helpers earn their place

**Status:** Accepted
**Ticket:** [#182](https://github.com/QuantumFF/walltare/issues/182)
**Date:** 2026-09-04

## Context

The frontend test suite registers **246** `mockCommand("<rust name>", …)` calls
across 13 test files, over the 16 commands in `lib.rs`'s `generate_handler!`
(`:571-588`). `get_stats` is registered 47 times, `get_settings` 30,
`move_wallpaper` 25, `keep_wallpaper` 23, `expand_path` 19, `get_pair` 17,
`list_wallpapers` 16.

Every one of those names is a bare string literal, and `client.ts` holds the same
16 strings inside its `invoke` calls. Both sides of the seam spell the wire
independently.

That is the finding the ticket was raised on. It is the smaller half of the
problem.

### The answers were never checked either

`mockCommand`'s signature is `(args: CommandArgs) => unknown`
(`ipc-mocks.ts:61-66`), over `type CommandArgs = Record<string, unknown> |
undefined` (`:3`, and a second copy at `fixtures.tsx:36`). So:

| what crosses | how it is checked today |
| --- | --- |
| the command name | not at all, at 246 sites |
| the answer | not at all: the declared type is `unknown` |
| the args | not at all: 82 reads, 50 of them casting (`args?.id as number`) |
| a deliberate failure | not at all: 40 hand-spelled `Promise.reject({ kind, message })` |

A mock handing back a `Wallpaper` with no `origin_path` compiles. A mock rejecting
with `kind: "not_fnud"` compiles, and that one is worse than it looks:
`isStaleRow` (`client.ts:252`) and the toast copy both branch on `kind`, so a
misspelled kind silently takes the fallback path and the test still passes.

**The [map](https://github.com/QuantumFF/walltare/issues/149)'s testing note is
half true because of this.** It says a backend DTO change the TypeScript types do
not follow "shows up there rather than at runtime". That holds where a mock
answers through a typed fixture builder, which at least 66 of the 246
registrations do. Everywhere else the answer is an inline literal typed `unknown`,
and the DTO change surfaces as a failed assertion in whichever test happens to
cover the path, or not at all.

### This question was already answered once, in the same file

`client.ts:159-174` types the five backend event names against their payloads,
and its own doc comment says why:

> The names are the wire names, `emit` in `lib.rs` and `pregen.rs`, so this is the
> one place in the frontend where a hyphenated string has to match Rust.

The commands are the identical problem. They were left untyped. That precedent is
a stronger argument than any principle about seams, because it is this codebase's
own answer to this question, given once already and sitting eight lines above the
object that needs it.

### The duplication is mostly not IPC

Measured across the suite, the largest duplication is DOM plumbing rather than
command fixtures:

| helper | copies | shape |
| --- | --- | --- |
| `click(element)` | 7 | byte-identical |
| `openApp()` | 5 (+1) | identical but for a discarded return; ReviewView's also navigates |
| `press` / `pressKey` / `pressArrow` / `pressChord` | 8 across 7 files | four shapes |
| `wrote(args, over)` | 5 | one shape, four row sources |
| `advancePickFeedback()` | 3 | byte-identical |
| `panesArrive()` | 3 | identical but for one local name |
| `rejectedTo` | 3 | identical |
| `restoredTo` | 2 | identical |

A decision scoped to IPC fixtures alone would have settled the smaller half of
what the suite actually needs.

### There is already a precedent for centralising, and it is narrow and it works

`fixtures.tsx:47` has `mockListings({ review, library })`, which branches on the
`limit` because Review and the library page ask the same command and only that
argument tells them apart (ADR 0028). It is in five test files. The question is
how much further it goes.

## Decision

### `client.ts` names the 16 commands once, and types what crosses

Two declarations, beside `BackendEvents`:

```ts
/** Every command the backend exposes, under the name `invoke` reaches it by. */
export type Command =
  | "start_scan" | "start_pregen" | "cancel_pregen" | "get_cache_size"
  | "clear_cache" | "expand_path" | "get_pair" | "vote" | "get_stats"
  | "list_wallpapers" | "keep_wallpaper" | "unkeep_wallpaper"
  | "move_wallpaper" | "restore_wallpaper" | "get_settings" | "set_setting";

/** What each command takes and what it answers with. */
export interface BackendCommands {
  get_stats: { args: undefined; answer: Stats };
  list_wallpapers: {
    args: { filter: StatusFilter; ordering: ListOrdering; limit?: number };
    answer: Wallpaper[];
  };
  // … one entry per name in `Command`
}
```

`mockCommand` becomes generic over it:

```ts
export function mockCommand<C extends Command | PluginCommand>(
  name: C,
  impl: (args: ArgsOf<C>) => AnswerOf<C> | Promise<AnswerOf<C>>,
): void;
```

`Promise.reject(…)` is `Promise<never>` and stays assignable, so the 40 deliberate
failures need no special case; the rejection is typed `AppError`, so an invented
`kind` stops compiling.

`PluginCommand` is `"plugin:dialog|open"` and it stays in `ipc-mocks.ts`,
replacing `FOLDER_PICKER_COMMAND` (`:76`). The comment above it already argues
that a plugin call belongs on this seam, and `client.ts` reaches the picker
through the plugin's own wrapper and never spells the string. No test file spells
anything outside the 16, so the union needs no escape hatch.

Both `CommandArgs` aliases are deleted rather than renamed.

### What the type does not do, stated so nobody assumes otherwise

This is the part a future reader will get wrong, so it goes in the decision rather
than the consequences.

- **A typo was already caught.** `ipc-mocks.ts:124` rejects with "no mock
  registered for command X". The union adds nothing there.
- **A Rust rename is still not a compilation failure.** Nothing short of generated
  bindings makes it one, and those are refused below.

What the type buys is that once a rename reaches `client.ts`, all 246
registrations light up at once, instead of only the tests that happen to exercise
that path. Plus the answers, the args and the failures, which is the larger half.

### A default that hides a value is worse than explicit lines; a default that applies a rule is the point

This is the line that decides the two registration sets, and they look alike until
you have it.

A test that renders because of a line in another file is harder to read than
twelve explicit lines, and its failure mode is silent: it passes for reasons its
own file does not state. But a rule stated in each of N places is a rule that
drifts, and centralising it is the whole reason to have a shared fixture at all.
`mockListings` is already the second kind.

**`mockBootedApp()`** registers `get_stats → stats()`, `get_settings → settings()`
and `start_pregen → null`, and returns nothing. The boot triple is in 12 of the 13
files' `beforeEach`; `client.test.ts` is the exception and renders nothing. It is
named for what it arranges, so a reader sees the name and knows the app got past
its gate. Three files call it and then re-register one command, because their
`get_stats` or `start_pregen` carries bookkeeping rather than a plain answer. That
reads correctly: the shared line says the app boots, the local line says what this
file is counting.

**Not `expand_path`**, despite being in 8 of those blocks. Its bodies differ in
what they resolve to, and in half of them that is the thing under test.

**`mockTransitions(source)`** registers all four transition commands from one row
source, built on `servingRows(() => Wallpaper[])` answering `{ row, wrote,
rejectedTo, restoredTo }`. It carries ADR 0023's rule, which is currently
paraphrased in five separate doc comments, three of which spell out "a command
answers with the row it wrote and every column it did not touch comes through
unchanged" in their own words. They have already started to drift:
`LibraryView.test.tsx:89`'s copy takes an `id` where the other four take `args`.

### The rule for what earns a place in a shared test module

[ADR 0030](0030-the-soft-reject-owns-its-ordering.md) set this for Rust: helpers
two or more test modules need, and not before. That is the floor here, not the
test. On its own it sweeps in `enterGrid`'s three genuinely different bodies and it
licenses the value-bearing default just refused.

Two conditions, either one qualifying:

1. **The helper holds a rule an ADR states.** `wrote` and `rejectedTo` through
   ADR 0023, `mockListings` through ADR 0028.
2. **Its copies are mechanically identical**, or made identical by a change with no
   effect on any assertion, **demonstrated by running the suite**. The
   demonstration is part of the condition. Without it, the rule licenses guessing
   about which differences between two copies were deliberate.

Every duplicate in the suite, sorted against it:

| tier | helpers | outcome |
| --- | --- | --- |
| identical as written | `click` ×7, `advancePickFeedback` ×3, `panesArrive` ×3 | unify |
| identical after a verified no-op | `press` ×4, `openApp` ×5 | unify |
| only by growing the interface | `wrote` ×5, `filterBy` ×2, `orderBy` ×2 | `wrote` only |
| not at all | `enterGrid` ×3, ReviewView's `openApp`, `expand_path` ×8 | stay |

**Why the two limbs are not interchangeable.** Tier three is where it shows.
`filterBy` and `orderBy` have two copies each differing only in which page bar
they scope to, so unifying them means a parameter that is the difference between
two call sites moved up a level: one line saved, one indirection added. `wrote`'s
row-source parameter looks identical and is not, because it carries a rule the
shared version then owns. So `wrote` qualifies on the first limb and those two
stay put.

`press` unifies to Layout's parameterised shape, `press(key, { target?, ctrlKey?,
altKey?, metaKey? })`, defaulting the target to `document.activeElement ??
document.body` and always flushing. That covers all eight keystroke helpers across
seven files, the two `window`-targeted ones included.

### Two modules, not three

- **`client.ts`** holds `Command` and `BackendCommands`, next to `BackendEvents`.
- **`ipc-mocks.ts`** stays transport, unchanged in scope: the typed `mockCommand`,
  `PluginCommand`, `emitEvent`, `deferListen`, `mockFolderPicker`.
- **`fixtures.tsx`** holds everything a test arranges *or does*, `click` and
  `press` included, and its header gains a line saying so.

A third module for the DOM helpers is the clean-looking split and it is wrong at
this size. `click` is four lines around `flush`, which is in `fixtures.tsx`
already, along with `renderInApp`. That file is already the render-and-act module;
naming a new one for a `fireEvent` wrapper is more interface than the job needs.

## What this does not touch

**Any wire name.** `Command` records the 16 as they are. This is the same call
ADR 0030 made when it kept `move_wallpaper` and `restore_wallpaper` on the wire
while renaming the function behind them.

**Anything in `src/` except `client.ts`,** and that additively. No component, hook
or command changes. If one needs an edit, the change has gone wrong.

**`CONTEXT.md`.** `Command` and `BackendCommands` are wire vocabulary, not domain.
This is the same call ADRs 0015, 0017, 0019, 0021, 0022, 0027, 0029 and 0030 all
made.

**`mockListings`.** It keeps its shape and its ADR 0028 comment. Its `args?.limit
=== undefined` branch typechecks unchanged against the typed args, which is what
made it safe to type the args in the same pass as the answers.

**ADR 0030's rule for `src/testing.rs`.** Its narrowness was deliberate and it
stays narrow. This ADR extends the frontend's version of it with a second limb;
the Rust module's rule is unchanged, and widening that one is still a decision for
whoever has the second caller.

## Alternatives rejected

**Generated bindings (`tauri-specta`).** The only option that makes a Rust rename
a compilation failure, which is the thing the ticket most wanted. Rejected: a
build step and a generated file for a 16-command surface whose mismatch has never
bitten once, and the map's rule that one adapter is a hypothetical seam cuts the
same way. Worth revisiting if the surface grows, or the first time a rename does
slip through.

**No type at all.** Defensible on the ticket's own argument, that there is exactly
one adapter behind `invoke` so the seam is hypothetical. It answers the wrong
question. The type is not a seam; it is the one place the 16 names are written
down, which is the job `BackendEvents` already does eight lines above it for the
five event names.

**Type the names only, leaving the answers `unknown`.** The version the ticket
asked for. It fixes the smaller half and leaves 246 answer bodies unchecked, and
it costs a second sweep of the same 246 lines later to finish the job. The 50 arg
casts also survive it for no reason.

**Answers first, args in a second pass.** Considered because the args looked like
they might fight `list_wallpapers`' optional `limit`. They do not: that branch
typechecks unchanged, and the four void commands take no args. One pass.

**A coherent default registration set the tests override.** The ticket's first
bullet, extending `fixtures.tsx:57-62`'s treatment of *values* to the
*registrations*. Rejected for everything but the boot triple, on the line above: a
default that hides a value fails silently, and eight `expand_path` bodies that
differ in what they resolve to are values, not a rule.

**A third module for the DOM helpers.** Covered above.

**Unifying `filterBy` and `orderBy` as well.** Two copies each, four lines each,
and the parameter that would unify them is just the difference between the two
call sites. Rejected, and this is the case that made the two limbs of the rule
necessary rather than one.

## Consequences

**No behaviour change in the app.** No component, hook or command changes, and the
app behaves identically in every path.

**One in the test suite's shape,** which is ADR 0030's exception again. Helpers
move to shared modules, and four `press` call sites gain an `await flush()`. That
reconciliation was run before it was proposed: added to `LibraryView`'s,
`WallpaperGrid`'s and `RankView`'s copies, 45 tests pass across the first two and
22 across `RankView`, then reverted to a green suite of 354.

**The typed sweep will find mock answers that were quietly wrong.** The declared
answer type has been `unknown` at every site, so nothing has ever checked them.
This is why the build order puts the types first: a wrong answer found before its
mock is folded into a shared helper is a finding, and one found afterwards is a
bug with a shared home. Any that turn up get the mock fixed, not the type widened.

**The map's testing note becomes true.** After this, a backend DTO change the
TypeScript types do not follow is a compilation failure at every mock, rather than
at the 66-odd that answer through a builder.

**Two spellings of each command's types, in one file.** `client`'s methods state
the args and answers for callers, and `BackendCommands` states them for the one
generic caller that cannot read a method signature. That is redundancy, and it is
the same redundancy `BackendEvents` carries next to `subscribe`. The alternative
was leaving the mocks untyped, which is what this decision is about.

**A rename of a wire command is now a three-file edit** rather than a
find-and-replace: `lib.rs`, `Command`, `BackendCommands`. The compiler and the
type checker between them name every remaining site.
