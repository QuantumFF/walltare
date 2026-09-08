# ADR 0035: A reject destination is checked twice, and a file moves only after it passes

**Status:** Accepted
**Ticket:** [#203](https://github.com/QuantumFF/walltare/issues/203),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

Nothing had ever asked whether a Soft reject destination could take a file.

[ADR 0003](0003-soft-reject-write-ordering.md) makes the reject safe by
ordering: the row is written inside a transaction, the file moves last, and a
failed move rolls the row back. That holds, and [#181](https://github.com/QuantumFF/walltare/issues/181)
added the test that proves it for a folder the process cannot write to. So the
failure mode was never a lost file. It was three smaller things:

- **The curator finds out afterwards.** `chmod 0o555` on the reject folder, a
  reject folder on a read-only mount, a folder owned by another user: every one
  of those reached the curator as `Permission denied (os error 13)` in a toast,
  once per click, after the click. The Settings field said nothing, because
  `expand_path` only knows where a path points.
- **The field's one not-found answer was "there is none".** ADR 0020 gave the
  destination field three rows, and [ADR 0018](0018-reject-destination-is-edited-in-settings.md)
  said why: "A reject destination cannot be 'not found' the way a Library root
  can, because ADR 0003 creates it on demand." True of a folder that is absent,
  and it was being read as true of the folder that is *there* and refuses — the
  case that actually costs a curator a reject. `tests/SettingsView.test.tsx`
  held a test called `no destination is ever reported as not found`.
- **The reject learned it from the `rename`.** `create_dir_all` is a no-op on a
  directory that already exists, so an unwritable destination passed every step
  of the reject until the move. The row was written and rolled back for a
  destination that could never have taken the file.

The Written path half was already right. `paths::expand_with` refuses an unset
variable rather than expanding it to nothing (ADR 0011), and both moments
inherit that: `$HOEM/rejected` must never become `/rejected` and get created at
the root of the disk.

## Decision

### One module, asked at both moments

`reject_destination.rs` owns the question "can this folder take a file" and the
sentence the app says when it cannot. Two entry points:

```rust
pub fn check(written: &str) -> Result<Check, AppError>   // Settings
pub fn prepare(dir: &Path) -> Result<PathBuf, AppError>  // the reject
```

Both moments matter because the answer expires. The folder can go between
Settings and the click: a drive unmounts, a tidy-up deletes it, a file lands on
the name. So Settings is a courtesy and `prepare` is the guarantee, and the
reason they are one module is that they say the same three sentences —
`not_a_folder`, `cannot_create`, `cannot_write` — and a curator who read one
under the field and a differently worded one in a toast would not know they had
been told the same thing twice.

### The check is a write, not a permission bit

`takes_a_file` puts a file in the folder and removes it again. `std` has no
`access(2)`, and adding a crate for one syscall is out under the epic's
no-new-dependencies rule — but the mode bits would be the wrong question anyway.
A read-only mount, a POSIX ACL and a folder owned by somebody else all refuse a
write that `0o755` promises, and those are how a reject folder actually goes
wrong. A probe is also the only check that is honest about root, which ignores
the mode bits and really can write.

The probe is `.walltare-write-check-<pid>`: a dotfile so it is invisible in a
file manager, and pid-stamped so two walltares checking at once cannot answer
each other's question. The removal is best effort — the answer is already known
by then — so a process killed between the create and the remove leaves a
zero-byte dotfile behind. That is the cost, and it is smaller than the cost of
being wrong about the folder.

### Settings says what can be said, in five lines

`Check` is four states, and the field turns them plus the syntax error into five
lines. This **amends [ADR 0020](0020-settings-page.md)**'s three-row table for
this field, and the two new rows are the two the old table could not express:

| answer | line | tone |
| --- | --- | --- |
| syntax error | the backend's message, verbatim | error |
| `relative` | `Relative, so one rejected folder beside each wallpaper.` | rule |
| `ready` | the resolved path | path |
| `absent` | `<resolved> · created on the first reject` | path |
| `refused` | the backend's `reason`, verbatim | error |

`absent` is **not** an error, and this is where ADR 0018's clause survives: ADR
0003 creates the destination on the first reject, so a folder that is not there
is a folder that is about to exist. What it gains is the resolved path and a
clause saying so, because that is what a curator needs to recognise a typo.

`relative` carries no path. ADR 0011 resolves a relative destination against
each wallpaper's own folder, so there is no one place to name, and naming the
folder this process happens to be running from would name a folder no reject
will ever use. That is the whole of what Settings can say about one, and the
reject-time check catches the rest.

`refused` carries the backend's sentence rather than a canned frontend string,
for the reason `invalid_path_syntax` does (ADR 0011): no string written in the
frontend could say which of a permission, a read-only mount and a file in the
way it was, and the folder it names is the one the curator has to go and fix.

### Its own command, because it is not free of the filesystem

`check_reject_destination` sits beside `expand_path` rather than inside it.
ADR 0011 made a point of `expand_path` creating nothing and reading nothing but
the environment, and the Library root's field has to stay that cheap and that
harmless: probing a Library root for writability would write into the curator's
photo library on every keystroke, to answer a question nobody asked about it.

So `useExpansion.ts` grows a second hook over one effect. `useExpansion` asks
where a path points, for the Library root's field and for the rejecting bars'
read-out; `useDestinationCheck` asks whether a reject could land there, for the
destination field alone. This **amends [ADR 0026](0026-the-written-path-field.md)**:
the two fields still share `usePathField` and `PathFieldRow`, but the answer on
the object is now `resolution`, a union of the two, because the two settings ask
different questions of their strings. `usePathField` calls both hooks — hooks
are called unconditionally — and hands the one that is not this field's an empty
string, which is the value it already answers `null` to without asking the
backend anything.

Neither command creates the destination. Only a reject does that, so a curator
typing their way to `~/pics/rejected` leaves no folder behind for every prefix
on the way.

### The reject-time check is one more line in the free half

ADR 0003's ordering is unchanged. `soft_reject::reject` already resolved its
destination above the `UPDATE`; `create_destination_dir` now ends in
`reject_destination::prepare`, which is where the `create_dir_all` and the
`canonicalize` already were, with the not-a-folder test in front and the probe
behind. Everything fallible about a destination therefore happens in the half of
the function where a failure is still free: no row written, no file moved,
nothing to put back. That is what the module note in `soft_reject.rs` asks of
anything added there.

A refused reject can leave an empty created folder behind — `create_dir_all`
succeeds and the probe then fails. That is the folder the curator asked for, it
is empty, and a second reject will use it once they have fixed the permissions,
so it is not worth an unwind that could itself fail.

### The refusal is `InvalidPath`, and there is no new kind

`AppError::InvalidPath` already means "the string is well formed and leads
nowhere useful", which is exactly this. Its message crosses the IPC and the
transition-failure toast prints it verbatim under `Couldn't reject <filename>`,
so the curator reads
`/mnt/rejects cannot be written to: Permission denied (os error 13)` and knows
which folder to go and fix. A new kind would buy a frontend branch that would
render the same sentence.

No new Status, nothing in `CONTEXT.md`, and no change to the transition rules. A
refused reject is a wallpaper that stayed where it was.

## Alternatives rejected

**Mode bits, or `metadata().permissions().readonly()`.** Free of any write, and
wrong: `readonly()` on Unix asks whether *no* write bit is set, which says
nothing about whether *this* process can write. It answers "yes you can" for a
folder owned by another user with `0o755`, and "no you cannot" for one this
process owns at `0o500` and could `chmod`. Getting it right means the effective
uid, the gid list, the ACL and the mount flags, which is `access(2)`, which is a
dependency.

**A field on `expand_path` — `Expanded { resolved, exists, refusal }`.** One
command and one hook. It makes every keystroke in the Library root field write a
probe file into the curator's photo library to answer a question that field never
asks, or it takes a boolean parameter that says which of two commands it is.

**Checking whether an `absent` destination could be created, in Settings.** It
is the honest completion of "does not exist, cannot be created, or cannot be
written to", and it means probing the nearest existing ancestor — writing into
`$HOME`, or into some folder the curator did not name, per keystroke, to report
on a folder that does not exist. The ticket's own instruction is to say what can
be said and let the reject-time check catch the rest, and `prepare` reports
`cannot be created` naming the folder that refused.

**Giving the rejecting bars' read-out the check too.** ADR 0018's argument for
putting the syntax error on the bar applies word for word: reading it before the
first click beats fifty identical failures after it. It is left out because the
ticket names two moments and this would be a third, and because it would run a
filesystem write on every mount of Review and of the library page, including for
curators who never reject. The reject itself now refuses with a sentence naming
the folder, which is the same words a paint later.

**Unwinding a folder `prepare` created before the probe failed.** A rollback
that is itself a filesystem operation that can fail, to remove an empty folder
the curator asked for.

## Consequences

`reject_destination.rs` is 12 tests over a tempdir and the injected environment
lookup, so no test reads or sets a real process variable: the two syntax errors,
the relative acceptance, `ready` with the probe cleaning up after itself,
`absent` creating nothing, `~` expanding before the check, a file in the way, an
unwritable folder, the serde tags, and `prepare` in three states.

Two of those depend on the mode bits being obeyed, which root ignores. Each asks
by writing — the same way the module asks — before it asserts, and takes the
other branch when the answer is "root": a folder that takes a file *is* `Ready`,
and a folder root can create *is* created. Asserting a refusal there would be
asserting that root cannot write to a directory. CI runs as a non-root user, so
the refusal is the branch normally exercised, and
`scanner.rs`'s unreadable-subdirectory test took this shape first
([ADR 0034](0034-a-hostile-library-root.md)).

`soft_reject.rs`'s permission test keeps every assertion it had — the row, the
Origin, the file, the empty destination — and changes the error it expects from
an `Io` errno to the sentence. Two tests join it: a destination that goes bad
*between* two rejects, which is the case the second check exists for, and a row
seeded the way an older version left one, restored to prove that a Restore still
works for every wallpaper rejected before any of this existed. A Restore does not
go through `prepare` at all.

The Settings field's own contradiction is gone:
`no destination is ever reported as not found` is now
`a destination that is not there yet says so, and is not an error`, beside two
new tests for the refusals and one asserting that neither field's string reaches
the other field's command.
