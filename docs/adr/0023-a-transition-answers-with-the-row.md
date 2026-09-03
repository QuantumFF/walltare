# ADR 0023: A transition answers with the row it wrote, and one module holds the sequence

**Status:** Accepted
**Ticket:** [#150](https://github.com/QuantumFF/walltare/issues/150)
**Date:** 2026-09-03

## Context

A Status transition is the app's central operation and it had no module. Every
one of them owes the same three steps: make the call, publish a `status-changed`
patch carrying the columns the file move wrote, raise the toast. Nothing in any
interface enforced that, so seven call sites spelled it out: `LibraryView.act`
with four cases, `ReviewView`'s `handleKeep` and `handleMove`, and the two Undo
closures inside `ToastSurface`.

Four of them rebuilt the same patch object independently, and two were
character-identical:

```ts
changed: { path: finalPath, filename: basename(finalPath), origin_path: null }
```

The obligation existed only as prose. `LibraryView` had to say "one call, one
published patch, one toast" and "every one of them toasts, success and failure
alike" in a doc comment, which is what a rule looks like when no interface holds
it. [#141](https://github.com/QuantumFF/walltare/issues/141) was this exact
failure once already, and the fix was another comment.

The other half sat on the Rust side. `move_wallpaper` and `restore_wallpaper`
answered with `Result<String>`, `keep_wallpaper` and `unkeep_wallpaper` with
`Result<()>`, so the frontend predicted the row instead of being told it.
`db.rs:230`'s `origin_path = path` and `db.rs:325`'s `origin_path = NULL` were
restated in TypeScript three times over, next to a `basename()` re-deriving a
column the backend had already derived and stored.

Two facts settled the shape. [ADR 0001](0001-status-transitions.md) already
priced a second read per transition: both guards read the row before writing,
and at one call per user click that does not matter. And
[#158](https://github.com/QuantumFF/walltare/issues/158) left
`db::get_wallpaper(conn, id)` in place, so answering with the row is a line per
function rather than a new query.

The live hole is what made this the first candidate rather than a tidy-up.
`ReviewView.handleMove` fired `move_wallpaper` unconditionally and then guarded
both the publish and the toast on `if (removed)`, because the Origin had to come
off `removed.path`. If that lookup missed, the file moved and nothing anywhere
heard about it. The comment above it knew and accepted this.

## Decision

### The command answers with the row it wrote

`keep_wallpaper`, `unkeep_wallpaper`, `move_wallpaper` and `restore_wallpaper`
return `db::Wallpaper` instead of `()` and `String`.

The read belongs inside the four `db.rs` functions, after `tx.commit()`, not in
the four command wrappers in `lib.rs`. One copy of it, for the reason
`WALLPAPER_COLUMNS` is one copy.

The frontend then predicts nothing, and the hole closes by construction: a row
that arrives in the response needs no lookup to succeed, so the case where the
file moves and nothing hears about it stops existing. `basename` has no callers
left and `src/lib/paths.ts` is deleted.

This widens four IPC return types, which is a wire change and the one behaviour
exception this decision claims. The frontend tests are the check on it: they
drive the real components against a mocked IPC seam, so a DTO the TypeScript
types do not follow fails there rather than at runtime.

### The patch carries the row

`status-changed` becomes `{ type: "status-changed", wallpaper: Wallpaper }`. The
`Pick<Wallpaper, "path" | "filename" | "origin_path">` goes, and with it the
complete-or-absent reasoning #141 needed: a whole row replacing a whole row
cannot half-wipe an Origin, so the load-bearing spread in Library's reducer goes
too. `stats-changed` already carries a whole `Stats`, so nothing about the bus
is new here.

One argument has to be rewritten rather than kept. "A patch can never insert a
row" rested on "an event carries an id and not a row", and that premise dies
here. The rule survives on the leg that was always the real one: nothing in a
row says where it belongs in an ordering by Score, so a wallpaper that just
became Active still arrives with Review's next fetch. The bound is position, not
ignorance.

### One module owns a page's rows and every transition on them

```ts
useWallpaperRows({
  belongs,      // (status: Status) => boolean
  destination,  // the page's own useRejectDestination read-out
  owe,          // from useRefetchWhenShown, for a stale row
  optimistic,   // { selectId } | undefined
}): { rows, setRows, perform }
```

`perform(action, wallpaper)` owns the whole sequence: the origin-less refusal,
the optional optimistic removal and its re-insert, the call, the published
patch, the toast with its Undo, the `console.error`, and the
`invalid_transition` refetch. Library and Review differ in one predicate and one
optional field instead of in two implementations, and both hand `perform`
straight to the grid's `onAction`, so the doc comment that had to state the rule
in prose is replaced by the only path there is.

Four parameter decisions carry the reasoning:

**`destination` is passed in, never read inside.** Both pages already render
`RejectDestinationLine` from their own `useRejectDestination`, and a second read
is a second `expand_path` verdict on exactly the paths a string cannot be asked
about. That is what [ADR 0018](0018-reject-destination-is-edited-in-settings.md)
exists to stop.

**`optimistic` is `{ selectId }` rather than a boolean.** The re-insert and the
selection restore only exist together: the removal advanced the selection, and
under [ADR 0022](0022-lightbox-shares-the-selection.md) the lightbox *is* that
selection, so a failed reject would otherwise leave the picture on wallpaper N+1
while the error toast names wallpaper N. Bundling them means there is no way to
ask for an optimistic removal without saying how the selection comes back.
`selectId` alone and not the whole `GridSelection`, whose seven-member shape is
its own open question
([#162](https://github.com/QuantumFF/walltare/issues/162)).

**`owe` rather than a view name.** Nothing left in the module wants page
identity, because the toast requests no longer carry a view and the stale-row
refetch is the page's own fetch.

**The fetch stays on the page.** Library's carries a filter, an ordering and a
scroll reset; Review's carries a loading flag and a limit. Merging those is a
different argument, and `setRows` is what a page's fetch writes through.

The two patch reducers fold into the module: they were one rule with two
predicates, which is what `belongs` is. Library's `score-changed` subscription
stays on the page, since a moved Score is not a transition.

### The Undo closures leave the toast surface

The page hands `undo: () => void perform("restore", rejectedRow)` along with the
toast request, and with the command answering with the row the closure has what
it needs. `ToastSurface` drops its `client`, `publish` and `basename` imports
and becomes what its doc claims: copy plus two slots.

[ADR 0017](0017-one-toast-at-a-time.md)'s "no view holds toast state of its own"
survives untouched, because the copy table, the `once()` double-press guard and
the slot precedence all stay there. Only the IPC call leaves.

The rejected request carries `renamed: boolean` in place of the surface
re-deriving it with `basename(finalPath) !== filename`. That is a fact about
what happened rather than copy, so the division holds: the surface still decides
that `renamed || relativeDestination` is what gives the path line something to
say. The pre-transition filename still titles the toast, so a reject that
collided reads `Rejected wall.jpg` with the new path in the description, exactly
as before.

### The refetch channel goes

`AppEventBus` drops to `publish` and `subscribe`. `requestRefetch` and
`onRefetchRequest` spent two of four members delivering one message read at one
line, and the doc on the first of them still said "Nothing calls it yet".

`useRefetchWhenShown(view, refetch)` returns its `owe` callback instead, so the
deferral still holds for an Undo pressed eight seconds later on a page the
curator has left: a hidden view owes the fetch and pays it on the switch the
curator is already waiting through. `view` leaves three `ToastRequest` rows and
seven `show()` call sites, six of which never used it.

### The refusal and the routers go with it

`useCardAction` is deleted and `perform` holds the origin-less refusal. Both
grids and the lightbox already reach the page's handler, so the hypothetical
host that bypassed the module was the only thing the old placement protected.
`WallpaperCard` stops importing `useToaster` and `NO_ORIGIN_REASON` and keeps
rendering `aria-disabled` off `origin_path`, which is drawing rather than
policy.

Both action routers go too. `ReviewView.handleAction` was two `if`s with no
`default` and no exhaustiveness, so `make-active` and `restore` fell through
silently while `LibraryView.act` next door was an exhaustive `switch`. One
`perform` handles all four, and the fallthrough stops being possible rather than
staying merely unreachable.

## Alternatives rejected

**Leave the wire alone and put the derivation in one frontend module.** The
narrow reading, and it deletes the four copies. What it keeps is a prediction:
`origin_path = path` and `origin_path = NULL` stay restated in TypeScript, just
once, and one copy of a prediction is still a prediction. It also leaves the
`if (removed)` hole, because the Origin still has to come off a row the
frontend looked up.

**A module that owns the fetch as well.** Library's fetch carries a filter, an
ordering, a row-set comparison and a scroll reset; Review's carries a loading
flag and a limit. One module over both is a parameter per difference, which is
the shallow shape this decision is trying to leave.

**A module that only owns the action sequence, with the page keeping its rows.**
Then `perform` needs a remove-and-reinsert pair handed in, and the optimistic
removal is split across two files again: the reducer that drops a row and the
handler that puts it back are the same rule seen from two sides.

**Passing the whole `GridSelection` in.** Seven members to use one, on an object
whose shape is already a known problem.

**`useRejectDestination()` inside the module.** Two `expand_path` verdicts per
page, disagreeing on exactly the destinations a string cannot be asked about.
ADR 0018 wrote that down once already.

**Keeping `requestRefetch` and giving the module a view name.** The channel's
one message is read at one line, by the module that would now be the one
publishing it.

**Leaving the refusal in `useCardAction`.** Defends a host that does not exist,
and splits the transition's branches across two files to do it.

## Consequences

**[ADR 0015](0015-navigation-shell.md)'s patch payload changes again**, and its
#141 amendment is superseded rather than extended: the payload is the row, and
the no-insert rule is re-argued from position. Recorded there.

**ADR 0017 loses the `view` field and the refetch channel**, and keeps
everything else. The `InvalidTransition` refetch still happens; the module makes
it rather than routing it through the bus. Recorded there.

**ADR 0001's pricing gets spent a second time.** Each transition now costs the
guard's `SELECT` plus the row read that answers the caller. Same argument, one
call per user click, and the guard's own read is
[#152](https://github.com/QuantumFF/walltare/issues/152)'s to restructure.

**#152 should land after the build this ADR asks for.** It works the same four
`db.rs` functions, and this changes what they return.

**Three behaviour changes, named.** Four IPC return types widen. A reject in
Review whose id lookup misses now publishes and toasts instead of going silent,
which is the point rather than a side effect. And Review's `make-active` and
`restore` reach a real implementation rather than falling through, which changes
nothing on screen, since Review lists Active rows only. Everything else is
behaviour-preserving.

**`src/lib/paths.ts` is deleted.** `containingFolder` lives in `WallpaperCard`
and is unaffected.

**No `CONTEXT.md` change.** "Transition" is already the glossary's word and
nothing here coins a domain term. `useWallpaperRows` is implementation, which is
the same call ADRs 0015, 0017, 0019, 0021 and 0022 each made about UI plumbing.
