# ADR 0034: A hostile Library root does not break the scan

**Status:** Accepted
**Ticket:** [#202](https://github.com/QuantumFF/walltare/issues/202),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

Every scan this app has ever run was against a tidy library. Point it at a
folder holding years of accumulated downloads and four things turn up that
nothing in the code has been asked about: a zero-byte image, a download that
stopped halfway, a subdirectory the curator cannot read, and a Library root that
has been deleted since it was set.

They are one ticket because they are one moment in the app's life — the walk, and
the pre-generation pass that follows it — and because the honest answer to three
of them is the same answer: carry on.

Reading the code, two of the four were already right and two were not.

- **The walk already skips what it cannot read.** `scanner::walk` returns on a
  failed `read_dir` and `flatten`s away an entry it cannot stat, so an
  unreadable folder costs that folder and nothing else. It said so nowhere, and
  no test held it.
- **A broken image already survives the pass.** `pregen::step` counts an error
  and moves to the next wallpaper, and ADR 0012 wrote that down: "a missing or
  undecodable source increments `failed` and the pass continues".
- **But it survives it again on every launch.** The work list is built from the
  `thumbnails` rows, a cache directory listing and one `stat` per source, and a
  file that will not decode never gets a row. So it is due forever: a hostile
  library pays one full decode attempt per broken file per launch, and reports
  the same `n failed` every time, which is the shape of a notification people
  learn to ignore.
- **And a Library root that is gone is refused rather than reported.**
  `start_scan` resolved the root on the IPC thread and answered `InvalidPath`,
  which Settings turns into `That directory doesn't exist or can't be read.`
  under the field (ADR 0020). That reaches a curator standing on Settings and
  nobody else, and `CONTEXT.md` is explicit that this is not a malformed string
  but an ordinary fact about the world: "The Library root is a stated
  preference, not a fact about the library. It can point somewhere that no
  longer exists."

[ADR 0032](0032-a-missing-file-reads-as-gone.md) drew a line through the middle
of this and named this ticket as the other side of it: "A file that is present
and will not decode paints as gone and is not counted. That is stated on the
line's own wording … Issue #202 is where a truncated file gets its own answer."

## Decision

### An undecodable source is written down, so the pass stops re-reading it

A new table, and no new Status, no new column on `wallpapers`, and nothing in
`CONTEXT.md`:

```sql
CREATE TABLE IF NOT EXISTS thumbnail_failures (
    wallpaper_id INTEGER PRIMARY KEY REFERENCES wallpapers(id) ON DELETE CASCADE,
    source_mtime INTEGER NOT NULL,
    message      TEXT    NOT NULL,
    failed_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

`thumbnails::work_list` joins it and skips a wallpaper whose note names the
mtime the source currently has. So a broken file costs one decode attempt in
total rather than one per launch, and the second launch's work list is the same
length whether the library holds three broken files or three hundred.

**Keyed on the mtime, which is what makes it a note about bytes rather than
about a wallpaper.** That is the freshness rule the `thumbnails` rows already
keep, reused rather than reinvented: a curator who re-exports the file gives it
a new mtime, the note stops applying, and the next pass generates its
thumbnails with nothing to press. An entry that says "this wallpaper is broken"
would have needed a way to retract it, and the filesystem is already telling the
truth once a launch for free.

**One row per wallpaper, so the table is bounded by the library.** The primary
key is the wallpaper, and the write is an upsert. A note left behind by a file
that has since been fixed is inert, because the comparison is against the
current mtime, so nothing has to sweep them.

**Only `AppError::Image` is noted.** That is the one variant meaning the bytes
were there and are not an image this build can decode — a zero-byte file, a
truncated download, a `.jpg` that is really something else. Everything else is
either about the file being absent, which is ADR 0032's subject and costs a
`stat` rather than a decode, or about the machine, and a full disk must not
permanently retire a wallpaper that is perfectly fine.

**A missing source is deliberately not noted**, and the code makes that
structural rather than conditional: the note is keyed on the mtime of the file
the row points at, and a file that is not there has no mtime, so there is
nothing to say the note is about. It therefore stays in the work list, stays
counted in `failed`, and stays cheap. That is the same division ADR 0032 made
between a file that is gone and a file that will not decode, arrived at from the
other side.

**Clear thumbnail cache forgets the notes with the rows.** `thumbnails::clear`
deletes both tables, which makes that button the one control that gives an
undecodable source another go. A curator asking for the whole cache to be
rebuilt is asking for that too, and no second control is needed to say it.

**No version bump.** A whole new table is reached by the DDL, which
`init_schema` runs before it branches, so an existing library gains
`thumbnail_failures` on its next launch — the property `settings` already rests
on (ADR 0005). Without it, the join in `work_list` would fail on every existing
database, so a test holds it.

### The Library root becomes the scan's own ending, on `scan-failed`

`start_scan` splits its two failures, because they are two different kinds of
thing.

| failure | where it is answered |
| --- | --- |
| the Written path will not expand (`InvalidPathSyntax`) | refused by the call, on Settings' status line |
| the folder is not there, or will not resolve | the scan's own `scan-failed` event |

A Written path that cannot be expanded is a fact about the string the curator is
typing, and ADR 0020 is right that the field is where the fix is typed. Whether
a folder is there is a fact about the world at the moment the walk begins, and
`CONTEXT.md` says in as many words that the Library root may point somewhere
that no longer exists. So it is not a refusal of the request; it is how the scan
ended.

That puts it on [ADR 0021](0021-background-work-is-a-pinned-toast.md)'s
`scan-failed` row — `Couldn't finish the scan`, the backend message underneath,
**pinned** — which reaches a curator who has since wandered to Rank, and needs no
new event, no new toast row and no frontend change at all. The report the walk
raised is cleared by the same handler that clears every other scan ending.

The message is written in Rust, as `InvalidPathSyntax`'s already is, because
ADR 0021 prints the backend's account verbatim:

> There's no folder at /media/photos/walls. Nothing was scanned, and every
> wallpaper already in your library is still in it.

Both sentences are load-bearing. The first is the thing to fix. The second is
the half the curator cannot see for themselves, and the whole reason the ticket
asks for this: `CONTEXT.md` keeps the wallpapers an earlier scan found in the
library regardless of where the Library root points now, so a curator whose
drive is unmounted otherwise reads an empty scan as the app having forgotten
their library. The exotic case — the directory check passes and the
canonicalization does not — gets the same second sentence and `walltare couldn't
read the folder at …` for its first, because telling that curator there is no
folder there would be a lie they can see out of the window.

**The pre-generation cancel moves onto the scan thread with the check.**
`start_scan` used to stand a running pass down on the IPC thread, before the
walk. Nothing restarts the pass on `scan-failed` — the frontend restarts it on
`scan-complete` — so leaving the cancel where it was would let one mistyped
folder retire the launch pass for the rest of the session. It now happens after
the root resolves, which is what the original comment was already reaching for:
a scan that never starts cancels nothing.

### The walk's skip is stated, logged and held by a test

`scanner::walk` keeps returning on a failed `read_dir` rather than propagating,
and now says why: a permissions quirk somewhere below the Library root must not
cost the whole library, and a scan that stops at the first such folder looks to
the curator exactly like a broken app. One `eprintln!` per unreadable folder,
because it is diagnosable and there is nothing to act on per folder — the scan's
own ending already reports how many files it found, which is the number a
curator can do something with.

**Nothing counts skipped folders on the wire.** A `skipped` field on
`ScanComplete` would reach `client.ts`, the event types and ADR 0021's table, to
tell the curator a number they cannot act on: the folders they cannot read are
not folders this app can do anything about, and a library where that matters
reports itself through the file count being lower than expected.

### The tests build the hostile library

Both new suites are ADR 0012's and ADR 0032's seam, unchanged: modules over a
`&Connection` or a temp directory, with the command wrappers holding no logic.

- `scanner` gets a temp tree holding a zero-byte `.jpg`, a truncated `.png`, and
  an unreadable folder with files inside and below it, plus an image beside it
  and one further down, so the walk has to carry on in both directions.
- `pregen` gets a library holding all four hostile cases in front of one good
  wallpaper, and asserts the good one is warm at the end, that the count is
  three, and that the next work list holds the missing file and not the
  undecodable ones.

**The unreadable-folder test is tolerant of running as root**, which ignores the
mode bits. It reads whether the folder is actually denied before it walks, and
asserts the skip only when it is; the half that holds either way — the walk
finishes, and everything outside the locked folder is found — is asserted
unconditionally. A test that assumes it is not root is a test that fails in
somebody's container for a reason that has nothing to do with the code.

## Alternatives rejected

**Remember failures in memory, on the `Pregen` state.** No table, no migration
question, and it covers the repeats within one session — a scan, a Generate now,
another scan. It does not cover the launch pass, which is the one that runs on
essentially every start, so the hostile library would pay its full decode bill
once a day forever and report the same failure count each time.

**A `broken` column on `wallpapers`, or a fourth Status.** Sortable and
filterable, and the curator could be shown a list. It reaches `CONTEXT.md`,
ADR 0001, ADR 0025's guard and the `CHECK` constraint for a property that is
about the bytes in a file rather than about a decision anybody made, and
ADR 0032 refused exactly this a week ago for exactly this reason. The row cannot
be dropped anyway.

**Record a zero-dimension `thumbnails` row as the tombstone.** No new table at
all, and `work_list` would skip it with no change. It also puts a row into the
table `fulfill` reads as a cache hit, so the wallpaper protocol would start
promising bytes for a file nothing ever wrote.

**Note a missing source too, so it stops being retried as well.** Symmetrical,
and it would shrink the work list further on a library that has lost a drive. It
needs a sentinel mtime, since there is nothing to stat, and it would then have
to decide when to stop believing the sentinel — which is the plugged-back-in
case, and the one thing the filesystem answers for free on the next pass. It
would also take the missing files out of `failed`, which is the only place the
pass reports them.

**Give the pass a `pregen-failed` event, or a per-item event, so the curator
learns which files are broken.** ADR 0012 declined both and its reasoning holds:
the only whole-run failure is the database being gone, which is already fatal
everywhere else, and a grid of hundreds of per-item events is ADR 0017's
one-toast-at-a-time rule producing one arbitrary filename. What the curator gets
is the count on `pregen-complete`, and a card that says **File is gone**
wherever the wallpaper appears — because the `wallpaper://` request for an
undecodable source fails, which is the state ADR 0032 built that panel for.

**Keep the missing-root refusal synchronous and *also* emit `scan-failed`.** The
status line survives and the toast reaches the wanderer. It is two surfaces
reporting one failure, which is what ADR 0017 exists to prevent, and the pinned
toast shows on Settings too — so the curator standing at the field reads it
without the line's help. The field's own `· folder not found` preview is already
under the input before the button is pressed.

**Report skipped folders in the scan's ending.** Covered above: a number the
curator cannot act on, at the cost of a payload change reaching four files and
one ADR table.

## Consequences

**`InvalidPath` no longer reaches the frontend from `start_scan`.**
`paths::expand` only produces `InvalidPathSyntax`, so ADR 0020's
`INVALID_PATH_ERROR` becomes the fallback it was written to be rather than a
live path. It stays in `SettingsView`, and its test stays with it: the page is
being asked what it does with a kind the backend may send, and answering that
correctly is not conditional on the backend still sending it.

**A scan on a missing root now shows `Scanning…` for an instant first.**
`start_scan` resolves, so the button and the report both start, and the
`scan-failed` that follows a moment later clears them. That is the same sequence
every other failed scan already produces.

**The pass's `failed` count means something slightly different on the second
launch.** It counts what *this* pass found, and a permanently broken file is
found by exactly one pass. So the toast reports it once, which is the point: a
count that reappeared unchanged every launch is a notification with nothing in
it.

**The count in ADR 0032's Missing files line and the pass's `failed` still
disagree, in the direction that ADR named.** A present file that will not decode
is in neither: it is not missing, and after the pass that found it, it is not
work either. Where it does show up is the card, which says **File is gone**
because the request for it fails. That is the answer ADR 0032 said this ticket
owed, and it needed no code to deliver.

**Nothing reaches `CONTEXT.md`.** A thumbnail that could not be made is cache
plumbing, the same call ADR 0012 made about the cache and ADR 0032 made about a
file that is not there.
