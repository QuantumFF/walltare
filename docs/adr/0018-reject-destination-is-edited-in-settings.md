# ADR 0018: The reject destination is edited in Settings, and the views that reject only read it

**Status:** Accepted
**Ticket:** [#51](https://github.com/QuantumFF/walltare/issues/51)
**Date:** 2026-08-26

## Context

`ReviewView.tsx:149` holds a text field labelled "Move to:", defaulting to a
hardcoded `./rejected`, resetting on every launch. It was fine when Review was
the only view that could reject.

Three changes landed since, and each one bends it further. [ADR
0010](0010-settings-store.md) made `reject_destination` a persisted setting, so
the field now configures a global preference from inside one of the views that
consumes it. [ADR 0009](0009-reject-is-reversible.md) deleted Review's reject
confirm dialog, which was the only moment in the flow where a per-reject
destination could have been chosen. [ADR 0016](0016-library-page-scale.md) gave
the library page its own reject, so a second view now moves files to a folder
its own chrome never names.

ADR 0010 closes by deferring this question outright. The charting round for
[the map](https://github.com/QuantumFF/walltare/issues/37) had settled that the
Browse button sits beside the text field, "same treatment in Review's move
destination", which assumed the field survives. This ADR overturns that clause
and leaves the rest of it standing.

## Decision

### Settings owns the only editor

The field leaves Review. `reject_destination` is edited on the Settings page and
nowhere else, with the Browse button beside it that the charting round asked
for. [#58](https://github.com/QuantumFF/walltare/issues/58) owns how it sits on
the page.

What pushed it out is the mismatch between what the control looks like and what
it does. The default `./rejected` is relative, and [ADR
0011](0011-written-paths.md) keeps a relative reject destination relative to
each wallpaper's own folder. So a field in Review reads as a per-pass control
while actually writing a global setting whose meaning is per-wallpaper, in a
view showing fifty wallpapers that may come from fifty different folders. ADR
0010 moved the Library root out of `ScanView` to end the same confusion.

### There is no one-off destination

Rejecting to somewhere other than the current setting, for one wallpaper,
without changing the setting, does not exist. ADR 0009 removed the one moment
that could have held the choice, so building it means inventing a new one: a
split button, a modifier-click, or a second Reject control. Nobody has asked for
it, and act-then-undo already covers a wrong destination, since the toast's Undo
restores the file and the setting can be fixed before the next click.

`move_wallpaper` keeps its `destination_folder` argument anyway, which is what
keeps this cheap to add later.

### Both rejecting pages carry a read-out

Review's second bar and the library page's second bar carry the same line, from
the same component:

```
Rejects go to ./rejected, beside each wallpaper · change in Settings
```

Library gets it for the reason Review does, only more so. A reject fires from a
card overlay on a page nobody opened in order to reject anything, and a control
that moves a file to a folder the page never names is worse there than on a
worklist. Where the bar runs out of width the line truncates first; it is not
the first thing to cut.

The line renders the **written** string, not the resolved one. `~/bin` stays
`~/bin`. ADR 0011 put the resolved-path preview on the Settings field, and
repeating it on two other bars is noise.

The trailing clause appears only when the destination resolves relative, and it
is the part that earns the line its place. That relative means "beside each
wallpaper" rather than "beside the library root" is the single most surprising
thing about this setting, and until now it was written down only in an ADR.

Whether a destination is relative cannot be read off the string: `~/bin` and
`$HOME/bin` both look relative and both expand absolute. Only ADR 0011's
`expand_path` knows, so the read-out calls it. That call pays for two other
things below.

### A malformed destination is shown on the bar

A reject destination cannot be "not found" the way a Library root can, because
[ADR 0003](0003-soft-reject-write-ordering.md) creates it on demand. It can be
malformed. `$HOEM/rejected` is `InvalidPathSyntax` under ADR 0011, and it fails
every reject in the pass with a message naming the variable.

When `expand_path` returns that error, its message replaces the line in the
destructive colour. ADR 0011 made this one error kind's Rust strings user-facing
copy precisely so it could name the variable, and a bar reading
`unknown environment variable HOEM` before the first click beats fifty identical
failures after it. The check costs nothing, because the read-out already makes
the call.

### `move_wallpaper` keeps its argument and gains a return

```rust
move_wallpaper(id: i64, destination_folder: String) -> Result<String, AppError>
```

The argument stays, and the frontend passes `settings.reject_destination` out of
the same context object the read-out renders from. That is what keeps the bar
and the move in agreement rather than hoping they are, and it follows ADR 0010's
position on `start_scan`: a command whose behaviour depends on hidden state
needs its setting written before any test can run it, and a failed write moves
files silently.

The counter is real and worth recording, because it is sharper here than it was
for scanning. A scan reads; a reject moves files, so a frontend passing a stale
value moves wallpapers somewhere the user did not configure. It loses to the
agreement argument, not by much.

The return is the final absolute path. `db::move_wallpaper` already computes it
as `dest_str` at `db.rs:187` and throws it away. The toast needs it, and until
now nothing said where it came from. Whether a rename happened needs no flag:
the frontend holds `wallpaper.filename` and compares basenames.
`restore_wallpaper` owes the same return for the same reason, which belongs to
[#39](https://github.com/QuantumFF/walltare/issues/39).

### The preview shows nothing

The lightbox backdrop is opaque, settled in
[#44](https://github.com/QuantumFF/walltare/issues/44) because at 97% the tabs
ghosted through, so the second bar's line is invisible while the preview is
open. It stays invisible. The preview is about the wallpaper, its action housing
was won by staying attached to the picture, and its read-out block is already
carrying Score, comparison count, position and keys. Reporting where a file
would go is the toast's job, which is what the next section changes.

### ADR 0017's reject toast, amended

[ADR 0017](0017-one-toast-at-a-time.md)'s copy table prints the final path on a
reject "only if `unique_destination` renamed it", justified by the destination
"sitting in the field the user typed it into". This ADR deletes that field.

The new rule: a reject toast names the final path when the file was renamed
**or** when the destination resolved relative. Stated once, it is "the toast
names the path whenever the bar could not". It reuses the same boolean the
read-out already computes.

The relative case is the hole ADR 0017 could not see. When the destination is
`./rejected`, the bar states a rule and not a place, and in a nested library the
file lands in one of many `rejected/` folders with nothing on screen saying
which. When the destination is absolute, the bar named the exact folder and
repeating it is the noise ADR 0017 was right to avoid.

### The line routes to Settings

`change in Settings` is a control, not text. It navigates to Settings with [ADR
0015](0015-navigation-shell.md)'s `returnTo` set to the current view, and it
focuses the Reject destination field on arrival. Naming a destination one click
away and leaving the words inert is a small cruelty, and the `returnTo`
machinery already exists.

This hands [#58](https://github.com/QuantumFF/walltare/issues/58) a requirement:
the Settings page needs a focus target per field, not only a grouping.

> **Answered by [ADR 0020](0020-settings-page.md), 2026-08-26.** The navigation
> call carries a `keyof Settings` beside `returnTo`, so the mechanism is general
> and the first-run block reuses it. The page focuses the input without
> selecting its text, since a field that writes on blur should not be one
> keystroke from empty.

### Nothing already rejected is stranded

`restore_wallpaper` reads `origin_path` off the row under ADR 0009, never
`reject_destination`. A wallpaper rejected into `./rejected`, followed by a
destination change to `~/bin`, keeps its file where it is, its `path` pointing
at it, and its Origin pointing home. Changing this setting cannot orphan
anything.

## Alternatives rejected

**Keeping the field in Review, editable, writing the setting on blur.** What the
charting round asked for, and one keystroke to redirect a pass is genuinely
faster than a trip to Settings. It also puts a global preference behind a
control that looks like it belongs to the fifty cards under it, and it leaves
the library page either duplicating the field or rejecting blind.

**Deleting the field with nothing in its place.** Cheapest. It makes the
destination invisible from both views that use it, which is the complaint that
opened the ticket rather than an answer to it.

**A per-reject override behind a split button or a modifier-click.** Every shape
either resurrects the interruption ADR 0009 deleted or hides the choice
somewhere nobody finds it. The argument to have another look is a user sorting
into two bins in one pass; the answer for now is two passes.

**Rendering the resolved path in the read-out.** More precise for an absolute
destination, and impossible for a relative one, which is the default. A line
whose shape changes from a path to a rule depending on the setting is harder to
read than one that always shows what the user typed.

**Leaving `InvalidPathSyntax` to the first failed reject.** No error state on
the bar. It also means learning about a typo by moving a file, fifty times.

**`move_wallpaper` reading `reject_destination` itself.** One argument fewer and
no chance of the frontend passing a stale value. It is the shape ADR 0010
rejected for `start_scan`, and it breaks the property that the bar and the move
read the same object.

**Returning a `renamed: bool` alongside the path.** The frontend already has
`filename`. A second field to save a comparison invites the two to disagree.

**Naming the final path on every reject toast, matching Restore.** One branch
instead of a conditional, and a path line is already normal in this app. It
prints a folder the bar named two inches away, on every reject of a fast pass.
The conditional is one expression over a boolean that already exists.

**Copy that varies by which surface the reject came from**, so only a reject
fired inside the preview names its path. Honest about the opaque backdrop, and
it adds a caller argument to a primitive ADR 0017 built to be called from
anywhere.

## Consequences

The charting round's "same treatment in Review's move destination" clause is
void. Browse-beside-the-field survives on Settings, which is where the pairing
was always really about.

`DEFAULT_MOVE_PATH`, `MOVE_FAILED_ERROR` and the `movePath` state in
`ReviewView.tsx` all go. ADR 0010 already owns the default and ADR 0017 already
owns the error copy.

The read-out calls `expand_path` on every render of two second bars. It is pure
and touches no filesystem under ADR 0011, so the call is cheap, but it is an IPC
round trip and wants memoising on the setting value rather than firing per
paint.

`move_wallpaper`'s return type changes, which the frontend tests catch: they
drive the real components against a mocked IPC seam, so the TypeScript type has
to follow.

Two error kinds can now be reported without a click. `InvalidPathSyntax` reaches
the user from the bar, while `InvalidPath` and `FileMissing` still arrive as
toasts after an action. That is the split ADR 0011 set up when it made one
kind's messages user-facing copy, now visible in the UI.

Setting a destination that resolves to a wallpaper's own folder still fails per
reject, with `InvalidPath` from `db.rs:181`, and the bar cannot warn about it:
whether it collides depends on which wallpaper is being rejected.

**[ADR 0019](0019-library-card-affordance.md) closes the relative-destination
hole on the library page.** The bar states a rule rather than a place when the
destination resolves relative, and this ADR handed that to the toast, which only
speaks about the wallpaper the user just acted on. ADR 0019 puts the containing
folder on every Rejected card's overlay, read off the row's own `path`, so the
question is answerable for the whole library and not only for the last reject.
