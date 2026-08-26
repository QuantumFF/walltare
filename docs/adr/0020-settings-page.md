# ADR 0020: The Settings page is four sections, and each field explains itself

**Status:** Accepted
**Ticket:** [#58](https://github.com/QuantumFF/walltare/issues/58)
**Date:** 2026-08-26

## Context

The gear in variant A's chrome leads to a page that does not exist. The
prototype ([#44](https://github.com/QuantumFF/walltare/issues/44)) shipped a
placeholder that says so in its own footer, with four sections in it so the gear
had somewhere to land.

Everything the page holds was already fixed elsewhere.
[ADR 0010](0010-settings-store.md) owns the three keys, their defaults, and the
write-on-blur rule. [ADR 0011](0011-written-paths.md) owes both path fields a
resolved-path preview and hands the "folder not found" state to whoever builds
this page. [ADR 0012](0012-thumbnail-pre-generation.md) asks for a cache size
readout, a Clear button and a Generate now button.
[ADR 0018](0018-reject-destination-is-edited-in-settings.md) makes this the only
place `reject_destination` can be edited and requires a focus target per field.
[ADR 0015](0015-navigation-shell.md) lands the user here on an empty library and
on a failed boot, and insists those two must not look alike.

So this ADR is grouping, states and copy. Four facts found while resolving it
moved more than the grouping did:

- **No file picker exists.** `tauri-plugin-dialog` is in neither `Cargo.toml`
  nor `package.json`. Browse-beside-the-field, settled during charting and kept
  by ADR 0018, is a third added dependency rather than a layout decision.
- **`expand_path` cannot answer "folder not found".** ADR 0011 states twice that
  it touches no filesystem. The state ADR 0010 promises beside the field has no
  command behind it.
- **`InvalidPath`'s message is a bare path** (`lib.rs:164`), not a sentence.
  Frontend copy for that kind survives, where ADR 0017's title-plus-detail rule
  would have replaced it.
- **The cache on this machine is 48MB across 172 files.** ADR 0012's 830MB is a
  projection for 2,000 wallpapers, and the ticket inherited it as if it were the
  live number.

## Decision

### Four sections, in first-run order

A single column at `max-w-2xl`, four sections, in this order: Library root,
Reject destination, Appearance, Thumbnails. First-run need first, maintenance
last.

Sections rather than a flat list of label-and-control rows. The ticket called
four groups of one or two controls thin, and it would be, except the two path
items are each a field, a Browse button, and a status line under them. In a flat
list those two rows tower over the two below them.

The heading is **Library root**, not "Library folder". The charting round wrote
"Library folder", ADR 0010 repeated it, and the prototype printed it, all before
`CONTEXT.md` had the term. [ADR 0017](0017-one-toast-at-a-time.md) requires the
app to speak the glossary rather than invent synonyms, and
[ADR 0019](0019-library-card-affordance.md) threw out "Return to voting" on that
ground. This is the same correction, caught before anything was built.

### One status line per path field

Each path field has exactly one line under it, and it says one thing at a time.
Four candidates were competing for the space: the resolved path, "folder not
found", `InvalidPathSyntax`, and an error from the Scan click.

For the Library root the line is normally the resolved path in muted mono, with
`· folder not found` appended when the check fails, so the user reads where it
points and that nothing is there in one glance. `InvalidPathSyntax` replaces the
whole line in the destructive colour, because there is no resolved path to show.
An error from a Scan click holds the line until the next keystroke. An empty
field shows nothing at all, since the first-run block above is already saying it
in full sentences.

"Folder not found" is not destructive-coloured. `CONTEXT.md` calls the Library
root a stated preference that may point somewhere that no longer exists, and the
usual cause is an unmounted drive.

### `expand_path` returns a struct, and stats once

```rust
expand_path(input: String) -> Result<Expanded, AppError>
struct Expanded { resolved: String, exists: bool }
```

`exists` is `is_dir()`. A file at that path reads as "folder not found", because
pointing a library at a JPEG is a typo rather than a state that deserves its own
sentence, and an unreadable directory fails the scan with `InvalidPath` where
copy already exists.

This amends ADR 0011's command and leaves its reasoning intact. `paths::expand`
stays pure and untested against the filesystem; the command stats after it
returns. The alternative was a second command, which means two IPC round trips
per edit of the same string.

ADR 0018's read-out on Review's and Library's second bars calls this same
command and ignores `exists`.

### The Reject destination line explains instead of resolving

ADR 0011 promised a resolved-path preview under both fields. This field cannot
have one. `./rejected` is the default, ADR 0011 resolves a relative reject
destination against each wallpaper's own folder, and Settings does not know
which wallpaper. So the same slot carries different content:

| `expand_path` result | line |
| --- | --- |
| absolute | the resolved path, in mono |
| relative | `Relative, so one rejected folder beside each wallpaper.` |
| `InvalidPathSyntax` | the message, in the destructive colour |

There is no not-found state, ever.
[ADR 0003](0003-soft-reject-write-ordering.md) creates the destination on
demand, which is the same reason ADR 0018 gave for leaving it off the bars.

The relative line repeats what ADR 0018 puts on two other bars, deliberately.
That relative means "beside each wallpaper" and not "beside the library root" is
the most surprising thing about this setting, and the field where it is typed is
the last place to leave it unsaid.

### Browse costs a plugin

`tauri-plugin-dialog`, plus a capability entry. ADR 0010 already noted
`tauri-plugin-window-state` as the first new Tauri plugin since the port; this
is the second, and the crate's third added dependency.

It is worth it. A folder picker cannot be hand-rolled in a WebView, and `~`
support is no substitute for pointing at a folder you cannot spell. The cost to
write down is that the picker returns an absolute canonical path, so Browsing
after typing `~/Wallpapers` overwrites it with `/home/qdes/Wallpapers` and
discards the portability the `~` was there for. Nothing warns about that,
because the user just picked the folder they meant.

### Scanning is explicit, and nothing cancels it

A button under the Library root field, reading **Scan** when the library is
empty and **Rescan** otherwise. It writes `library_root`, then calls
`start_scan` with the same string, unexpanded, which is the sequence ADR 0010
specifies. Enter in the field does the same thing, keeping `ScanView`'s
behaviour. Enter in the Reject destination field only commits, because there is
nothing there to run.

Never on blur. A blur happens on the way to the Browse button, and a scan walks
a filesystem.

While a scan runs the button is disabled and reads
`Scanning… 412 scanned, 38 added` off `scan-progress`. That duplicates
[#59](https://github.com/QuantumFF/walltare/issues/59)'s surface on purpose: the
user started the scan here and is looking here, and #59 exists for the case
where they have moved on.

No command cancels a scan. `InvalidTransition` from a second `start_scan` means
"a scan is already running" and the button can only refuse. Adding `cancel_scan`
is a backend feature no ticket on this map owns, so the gap is recorded rather
than filled.

### Appearance is a radio group that follows the desktop

`RadioGroup` from `radix-ui`, painted as a segmented control, in a new
`src/components/ui/radio-group.tsx` written like `alert-dialog.tsx`. Exactly one
of System, Light and Dark is always chosen, and none is not a valid state, which
is a radio group's contract. `ToggleGroup type="single"` deselects on a second
click unless you fight it, and it announces as pressed buttons rather than
"System, radio button 1 of 3". Both ship in `radix-ui` already, so this is free
either way.

While the setting is `system`, a `matchMedia` change listener repaints when the
desktop flips. Three lines against a window that visibly disagrees with
everything around it until relaunch. Whether WebKitGTK propagates the portal's
colour-scheme change under Hyprland is untested and unmeasurable here, since
none of this is built; if it turns out silent, the listener costs nothing and
ADR 0010's boot-time read still works.

### Thumbnails: one line, and a button that changes verb

```rust
get_cache_size() -> Result<CacheSize, AppError>
struct CacheSize { bytes: u64, files: u64 }
```

One `read_dir` plus a `metadata` per entry: 172 stats today, about 10,000 at
[ADR 0016](0016-library-page-scale.md)'s 5,000-wallpaper ceiling.

| state | line |
| --- | --- |
| idle | `48 MB cached · 172 files` |
| pass running | `48 MB cached · 240 of 1,204 generated` |
| empty cache | `Nothing cached yet`, and Clear cache disables |

The size does not refresh per `pregen-progress` event. That is one directory
walk per wallpaper to move a number by 400KB. It refreshes on mount, on
`pregen-complete`, and after a clear, and the `of 1,204` clause carries the
movement in between.

> **Amended by [ADR 0021](0021-background-work-is-a-pinned-toast.md),
> 2026-08-26.** Two things this section left implicit. The pass report that #59
> settled is **suppressed while Settings is showing**, because the Scan button
> and the Thumbnails line above already carry both counters and three copies of
> one number on one screen is not emphasis. And the report's one action
> navigates here, which its focus key cannot describe: the key is typed
> `keyof Settings` and Thumbnails is not a settings key, so that call carries
> no focus key and opens the page with Thumbnails fourth of four. Recorded
> rather than fixed; widening the key is a change nothing else asks for yet.

**Generate now becomes Cancel while a pass runs.** So this section is where
cancellation lives, and #59 owns only the reporting. ADR 0012 added
`cancel_pregen` and left it homeless, and pre-generation is running on most
launches, which is exactly when someone opens this page to ask why the machine
is busy.

Clear cache stays enabled throughout, because ADR 0012 already has it cancel any
running pass.

### Clear cache confirms, with the number in it

The `alert-dialog` component, which ADR 0017 predicted would sit unused "until
Settings needs it for ADR 0012's `clear_cache`".

> Clear 48 MB of thumbnails? They regenerate on the next launch, which takes
> about a minute for 120 wallpapers.

ADR 0009's act-then-undo does not apply, because there is nothing to undo, only
to redo slowly. What a mistaken click costs is ADR 0012's 420ms per wallpaper,
so about 50 seconds for the live library and 14 minutes for 2,000. The number
comes from the readout at the moment the dialog opens, and the dialog says the
pass will be cancelled when one is running.

### Reset is not a control

No Reset button anywhere, and no new command. Instead `set_setting` deletes the
row when the value equals the default, which amends ADR 0010 by one comparison
in `settings.rs`.

ADR 0010 keeps only what the user changed, so the table answers "what did they
actually change". Typing `./rejected` back into the field would write a row
identical to the default and quietly break that. `get_settings` already fills
gaps from `Settings::default()`, so absent and default-valued are
indistinguishable to every reader, and the property survives without a control
to explain.

### Arriving and leaving

Navigation to Settings carries an optional field key beside ADR 0015's
`returnTo`, typed as `keyof Settings`:

```ts
setView("settings", { returnTo: "library", focus: "reject_destination" })
```

On mount the page focuses that input and scrolls its section into view. It does
not select the text, because a field that writes on blur should not be one
keystroke from empty. No highlight beyond the native focus ring. That answers
ADR 0018's requirement, and the first-run block below reuses the same mechanism
with `focus: "library_root"`.

Three routes out, no Done button. Escape closes to `returnTo`, the gear toggles
back, and clicking any tab goes there instead. Escape belongs to the Settings
page rather than to ADR 0015's shell handler, which is suppressed while focus is
in a text field: this page is mostly text fields, so the suppression would have
broken the one route that needs to work from inside one. Escape does not revert
the edit. The blur commits on the way out, matching ADR 0010's no-dirty-state
rule.

Two of those three routes are invisible, so the second bar names one. Left, the
page title. Right, a control reading `Back to Library · Esc`, doing exactly what
the gear does. When boot landed the user here there is no `returnTo`, so the
control is absent and Escape does nothing, because the tabs are the way out of a
first run and there is nowhere to go back to.

### The top slot, and its two loud states

One slot above the four sections, with three states. Nothing is ever hidden or
reordered between them, which matches ADR 0015's refusal to disable a tab.

**Empty library.** Heading "No wallpapers yet", then "Choose a library root and
scan it to start ranking." The Library root field takes focus and Scan is the
only primary-styled control on the page.

**Failed boot.** Heading "Couldn't read the library" in the destructive colour,
the backend message as the detail under ADR 0017's title-plus-detail rule, and a
Retry that calls `get_stats` again.

**Otherwise.** The slot is absent.

Two headings, two colours, one with a field focused and one with a button to
press. That is what keeps ADR 0015's two landings from looking alike.

The Library root section also carries a count line from the `Stats` the boot
already fetched: "120 wallpapers in the library". No last-scanned time, because
nothing records one, and ADR 0014 found every row sharing a single `created_at`,
so `MAX(created_at)` marks the last scan that added a file rather than the last
scan. A `last_scanned` key would reopen ADR 0010's closed key set to store
something no decision needs.

### What dies in `ScanView.tsx`, and what survives

ADR 0015 said this file's `scanStartError` switch, its progress state and its
subscriptions split between this page and the shell. The split, now that the
error kinds have been read rather than assumed:

| string | fate |
| --- | --- |
| `INVALID_PATH_ERROR` | **survives**, into the status line |
| `SCAN_IN_PROGRESS_ERROR` | dies. The backend already says "a scan is already running" |
| `SCAN_FAILED_ERROR` | survives as the fallback for an unexpected kind |
| `NO_IMAGES_ERROR` | moves to #59, since it arrives on `scan-complete` |

`INVALID_PATH_ERROR` survives because `InvalidPath` carries a bare path as its
message (`lib.rs:164`), not a sentence, so there is nothing to render verbatim.
That is the boundary ADR 0011 drew when it made `InvalidPathSyntax` the one kind
whose Rust strings are user-facing copy, and it holds: the kind with copy in it
gets rendered, the kind with a path in it gets a frontend sentence.

The subscriptions move to the shell under ADR 0015. This page reads
`scan-progress` for the button label only.

Nothing here reaches `CONTEXT.md`. The one term that came up, Library root, is
already in the glossary and this ADR corrects the UI toward it.

## Alternatives rejected

**A flat list of rows.** Plainer, and the two path items are four elements each,
so a flat list either truncates them or lets them tower over Appearance and
Thumbnails.

**Keeping "Library folder" on screen.** What three earlier documents say, and it
is a synonym for a glossary term the app already has. ADR 0019 threw out a label
for exactly this and nothing built has to change.

**A second command, `directory_exists`.** Leaves ADR 0011's `expand_path`
untouched, which reads better as a boundary. It also makes the field fire two
IPC calls per edit about one string, and the second command's only caller would
be the first command's only caller.

**Extending `paths::expand` itself to stat.** Would have broken ADR 0011's test
strategy, which drives `expand_with` against a fixed map precisely so the
environment is not involved.

**No Browse button.** Saves the third dependency and the capability entry. It
also leaves the only way to name a folder as typing it, in an app whose entire
first-run flow is naming a folder.

**Scanning on blur when the path changed.** No button, and the scan happens when
the user is done typing. Blur also fires on the way to Browse, on Tab, and on
clicking anywhere else on the page, so it would walk a filesystem by accident.

**A per-field Reset control.** Explicit, and discoverable. It needs a new
command for ADR 0010's `DELETE`, and the delete-on-default rule gets the same
result from a comparison the write path was already making.

**Clearing the cache without a confirm**, on the grounds that ADR 0012 calls the
cache a rebuild rather than data. Consistent with ADR 0009's removal of the
reject confirm. It spends 14 minutes of someone's CPU on a misclick, and unlike
a reject there is no Undo to offer.

**`ToggleGroup` for the theme.** Same visual result, and it allows a fourth
state, nothing selected, that the setting cannot hold.

**Refreshing the cache size on every progress event.** Honest, live, and it is a
directory walk per wallpaper to animate a number by 400KB per step.

**A Done button.** The conventional page-with-form shape, and it implies the
page has unsaved state. ADR 0010 removed the Save button and the dirty state, so
a Done that only navigates would look like the Save that does not exist.

**Hiding the other three sections on a first run.** Focuses the one thing that
matters. It also produces a page that grows sections after a scan, and ADR 0015
already refused to hide destinations for being empty.

**Toasting a scan-start error instead of the status line.** Consistent with
ADR 0017's single error surface. ADR 0018 already broke that consistency in the
right direction: a path error the user can read before clicking beats one that
arrives after. The field is where the fix is typed.

## Consequences

`tauri-plugin-dialog` is the crate's third added dependency and needs a
capability entry in `capabilities/default.json`. A project that has kept to six
crates now has a folder picker in it.

`expand_path`'s return type changes from `String` to a struct, and ADR 0018's
read-out is already written against the string form. The frontend tests catch
it, since they drive the real components against a mocked IPC seam.

The Thumbnails section reports pre-generation progress, and so does #59's
surface. Two places show the same number at the same time, by choice, and #59
still owns what the shell shows.

Nothing cancels a scan. On a large tree the only way out is to quit the app, and
the button says so by disabling rather than by explaining.

Escape is the first view-local keyboard binding outside a grid, following the
line ADR 0019 drew: global shortcuts in the shell, view-local keys on whatever
owns the focus. The `?` dialog ADR 0015 mounts owes it a row, along with
`Ctrl+,`.

`get_cache_size` walks the cache directory on every call. At the 5,000-wallpaper
ceiling that is about 10,000 stats, on mount and twice per pass. If it ever
shows up, the number can be maintained incrementally by the pass, which is a
larger change than this readout deserves today.

The System theme listener may never fire. It is untestable until the app is
built, and if WebKitGTK stays silent under Hyprland the app behaves exactly as
ADR 0010 specified and nobody notices the dead code.

`ScanView.tsx` is deleted by this ADR rather than emptied. Its input, its
button, its progress line and three of its four error strings all land here or
in the shell, and the file's hero layout was for a screen that no longer exists.
