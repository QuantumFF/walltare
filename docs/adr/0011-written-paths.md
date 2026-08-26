# ADR 0011: Written paths expand before use and are stored as written

**Status:** Accepted
**Ticket:** [#41](https://github.com/QuantumFF/walltare/issues/41)
**Date:** 2026-08-24

## Context

The app takes two folders from the user: the Library root that `start_scan`
walks, and the destination a soft reject moves a file into. Neither understands
`~` or environment variables, and on the reject path that is worse than a
missing feature.

`db::resolve_destination_dir` treats any non-absolute destination as relative to
the wallpaper's own folder, and it calls `create_dir_all` before it canonicalizes.
Type `~/rejected` into Review today and the app creates a directory literally
named `~` inside the wallpaper's folder, moves the file into it, and stores that
as the wallpaper's path. Nothing errors. The user gets a folder they did not ask
for, in a place they will not look.

The UI/UX overhaul makes both fields worse if this stays. The Library root moves
into Settings and gets typed once and remembered, so a path that means the wrong
thing means it every launch. [ADR 0010](0010-settings-store.md) gives the reject
destination a stored default, so a mistyped one persists too.

The charting round for [the map](https://github.com/QuantumFF/walltare/issues/37)
fixed the syntax before this ticket opened: `~`, `~/...`, `$VAR`, `${VAR}`, plus
the relative paths that already work, with no globs, no `~otheruser`, and no
brace expansion. One helper in Rust that both callers use. What was open is
everything around it.

## Decision

### The term

`CONTEXT.md` gains **Written path**: how the user writes a folder for the app to
use. Both the Library root and a soft reject destination are Written paths, and
the rules below apply to both.

### What expands

| Input | Result |
| --- | --- |
| `~`, `~/pics` | `$HOME`, `$HOME/pics`. Leading position only |
| `/pics/backup~1` | Unchanged. A `~` past position 0 is a literal character |
| `$HOME/pics`, `${HOME}/pics` | Expanded. `[A-Za-z_][A-Za-z0-9_]*` names, anywhere in the string |
| `/pics/paid$`, `/pics/a$-b` | Unchanged. A `$` with no valid name after it is literal |
| `~otheruser`, `*.jpg`, `{a,b}` | Unchanged, so they fail later as a missing directory |
| `$(whoami)` | Unchanged, because `$` followed by `(` is not a name |

There is no escape syntax, so a folder genuinely named `$HOME` cannot be
reached. An escape character is a second syntax to learn, for a case that does
not exist on a real machine.

### An unset variable is an error

Naming a variable that is not set fails with a message that names it. It does
not expand to empty and it does not stay literal.

Empty is what a shell does and it is the dangerous one here. `$HOEM/pics`
becomes `/pics`, which exists on most systems, and on the reject path
`create_dir_all` would then create `/pics` and start moving wallpapers into it.
A shell gets away with this because the user is watching a transcript. A text
field in a GUI is not a transcript.

Staying literal is safe, but it fails as "that directory doesn't exist", which
sends the user looking at their filesystem instead of at their typo.

### What relative means, which differs per caller

A soft reject destination that is not absolute stays relative to the
wallpaper's own folder, as in [ADR 0003](0003-soft-reject-write-ordering.md).
A nested library therefore gets one reject folder per source folder. Expansion
is what makes the single central bin easy to ask for instead: type
`~/pics/rejected` and get it. Changing the meaning would silently relocate where
existing users' rejects land, to buy something they can now type.

A Library root that is not absolute stays relative to the process working
directory, which for a desktop launch is whatever the launcher set. It survives
because it earns its keep in development, where `./test-wallpapers` from the
repo root works. The preview below is what stops it being a guess.

### Stored as written

The `settings` table keeps `library_root` exactly as the user typed it, `~` and
variables included. [ADR 0010](0010-settings-store.md) already calls the Library
root a stated preference and refuses to validate it at boot, and this is the same
position: the app records the preference, not one machine's reading of it.

Expanding at write time would freeze whatever `$XDG_PICTURES_DIR` meant during
one session, and would show the user a path in the settings field that they never
typed.

The cost is that a setting can go from valid to invalid with nobody editing it,
so the settings panel has to show that state beside the field rather than only
at scan time.

### Where the helper lives

New `src-tauri/src/paths.rs`. Not `db.rs`, which is where it would land by
default, and not `scanner.rs`.

```rust
pub fn expand(input: &str) -> Result<PathBuf, AppError>
fn expand_with(input: &str, lookup: impl Fn(&str) -> Option<String>) -> Result<PathBuf, AppError>
```

`expand` does nothing but call `expand_with` with `std::env::var`. The split is
for the tests. The table above needs `HOME` set to a known value for some rows
and unset for another, and cargo runs tests as threads in one process, so
mutating the environment would race every other test in the crate. Driving
`expand_with` against a fixed map avoids that, and it also stops `~` being a
special case, since it becomes a lookup of `HOME` like any other.

Neither function touches the filesystem or creates anything.

### Order of operations

`move_wallpaper` keeps [ADR 0003](0003-soft-reject-write-ordering.md)'s
sequence, with expansion inserted at the front of step 2: expand, resolve
relative against the wallpaper's folder, `create_dir_all`, canonicalize.
Creating the destination on demand stays, because `./rejected` has to come from
somewhere on the first reject, but it now runs only after expansion succeeds.

`start_scan` expands, then checks `is_dir`, then canonicalizes. Its parameter
changes from `PathBuf` to `String`, because a `PathBuf` holding `~/pics` is a
template, not a path, and `is_dir()` on the unexpanded string fails. The
command's argument name and the `client.ts` signature do not change; the
frontend was already sending a string.

Canonicalizing stays last on both paths, and that is what keeps expansion from
producing two spellings of one library. `~/pics`, `$HOME/pics`, and
`/home/me/./pics` all canonicalize to the same string, so `UNIQUE(path)` is
unaffected.

`lib.rs`'s `path.canonicalize().unwrap_or(path)` becomes a hard `InvalidPath`.
`is_dir()` has already passed by that point, so the fallback only fires in
exotic cases, and when it does it stores the un-canonicalized string, which is
exactly the duplicate-library case the comment above it says it prevents.

### Errors

`AppError` gains `InvalidPathSyntax(String)`, serialising to
`invalid_path_syntax`. It means the string is malformed. `InvalidPath` keeps
meaning the path is well formed and leads nowhere useful.

This is the one error kind whose message the frontend renders verbatim, because
it can name the variable and no canned string can. That makes the Rust strings
user-facing copy: `unknown environment variable HOEM`, and `cannot expand ~
because HOME is not set`. The mapping lives in one shared helper rather than in
a copy of `ScanView`'s `scanStartError` switch per view.

### The preview

```rust
expand_path(input: String) -> Result<String, AppError>
```

Pure, no writes, no directory creation. It gives the settings field and the
reject destination field a resolved path under them while the user types, which
turns a typo into feedback before anything is created or moved. It is also what
makes the working-directory-relative Library root defensible, since the field
shows where it actually points.

It does not check whether the directory exists. ADR 0010's "folder not found"
note belongs to whoever builds the settings panel.

> **Amended by [ADR 0020](0020-settings-page.md), 2026-08-26.** The command
> returns `Expanded { resolved: String, exists: bool }`, where `exists` is
> `is_dir()` on the expanded path. The settings panel could not answer "folder
> not found" from anything else, and a second command would mean two IPC calls
> per edit of one string. `paths::expand` and `expand_with` stay pure and stay
> testable against a fixed map; the command stats after they return. ADR 0018's
> read-out on the two second bars calls the same command and ignores `exists`.
>
> The reject destination field gets no resolved path when the result is
> relative, because there is nothing to resolve it against in Settings. It
> prints "Relative, so one rejected folder beside each wallpaper." instead.

## Alternatives rejected

**`shellexpand`.** Does this, and brings `dirs` with it. Its undefined-variable
behaviour is the shell one, which is the thing this ADR rejects, so it would be
a dependency wrapped in a policy layer. The hand-rolled version is under 60
lines including the table's tests, in a crate that has kept to six dependencies.

**Expanding an unset variable to empty.** Covered above. It is shell-compatible
and it turns a typo into a move into `/`.

**Resolving a relative reject destination against the Library root.** One
central bin without typing an absolute path, at the cost of changing where
existing rejects go, and of a destination whose meaning depends on a setting
that may be empty.

**Refusing a relative Library root.** Honest about the fact that a GUI's working
directory is meaningless, and it breaks `./test-wallpapers` in development for
no user-visible gain.

**Storing `library_root` expanded.** Stable across a variable changing meaning,
and it stops the setting following `$HOME` between machines, which is most of
why someone types `~` in the first place.

**Reusing `BadRequest` for expansion failures.** Free, since it already crosses
the IPC and already means "you sent me something malformed". It is also the kind
ADR 0010 gives to rejected setting writes, and the same text field can produce
both, so the frontend could not tell them apart.

**Keeping `InvalidPath` and rewording the copy.** The frontend branches on
`kind`, so one kind cannot carry two messages.

**No preview.** Cheaper by one command. It also leaves `create_dir_all` willing
to create a folder from a valid expansion of a typo, with nothing shown to the
user until after the file has moved.

## Consequences

Three path-ish error kinds exist once [ADR 0009](0009-reject-is-reversible.md)
lands `FileMissing`: `InvalidPath`, `FileMissing`, `InvalidPathSyntax`. Each
wants different copy, which is why they are separate, but the next one added
should have to argue for itself.

Rust error strings are now user-facing for one kind. Anyone editing an
`InvalidPathSyntax` message is editing UI copy.

`start_scan`'s signature change is visible in the frontend tests, which drive
the real components against a mocked IPC seam, so the TypeScript type has to
follow or the tests catch it.

Wallpapers rejected before this shipped, into a literal `~` folder, keep working:
their stored paths are absolute and canonical, and a Restore uses the Origin
recorded by [ADR 0009](0009-reject-is-reversible.md), not the destination field.
Nothing cleans up the stray `~` directories.
