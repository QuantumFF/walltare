# ADR 0051: A download lands as a scan of one file

**Status:** Accepted
**Ticket:** [#321](https://github.com/QuantumFF/walltare/issues/321), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

Discover downloads a Wallhaven wallpaper into the library, where it becomes an
ordinary Active wallpaper right away, with no rescan. So the download has to do
what a scan does for a new file. It also has to leave the next scan with nothing
to add. The scan inserts with `INSERT OR IGNORE` against `UNIQUE(path)`, and
its only filter is the file extension. A half-written `foo.jpg` is therefore
inserted like any other file.

Three things about the download were open: where it lands, what happens when a
file with that name is already there, and whether the row or the file comes
first. ADR 0003 settled that last question the other way round for soft reject.

## Decision

**A relative Download folder means the Library root.** That makes a third
relativity rule beside ADR 0011's two. It resolves at each download, against
the root as it stands then. The root must exist. Only the Download folder, and
anything below it, is created on demand. With the root unset or missing,
Download refuses rather than creating the root on an empty mount point. That is
the typo-becomes-a-folder hazard ADR 0011 refused. An absolute Download folder
is created on demand behind ADR 0035's write probe, and it may sit outside the
Library root. A rescan never walks it, but it doesn't need to, because the rows
already exist.

**The file keeps Wallhaven's name**, `wallhaven-<id>.<ext>`, so ADR 0050's
grammar still recognises it if the database is lost.

**An untracked file with that name is adopted, not suffixed.** A result that is
In library or Rejected can't be downloaded, so a collision means a file is on
disk with no row for it. That is almost always an earlier manual download of
the same image. The download inserts that file instead of fetching it. A
suffixed copy would put the same image into voting twice. Adopting the file
trusts bytes the app never saw arrive. That is exactly what a scan of the same
folder would do, and ADR 0034 already handles a file that turns out to be
truncated.

**The file comes first, then the row.** The bytes stream into a hidden staging
file in the Download folder. The name follows soft reject's staging pattern and
has no image extension, so a scan ignores it. The byte count is checked against
the API's `file_size`. The file is then renamed into place without overwriting,
and only then is the row inserted. The failure cases:

- **The insert fails.** The file is already where a scan will find it and give
  it its id, so the next scan repairs it.
- **The transfer fails.** The staging file is deleted and nothing reaches the
  library.
- **The app crashes mid-transfer.** It leaves a hidden staging file that
  nothing sweeps up. That is the cost ADR 0035 accepted for its probe.

Row-first would do the opposite. A failure would leave a row with no file, and
its card would read "File is gone" (ADR 0032).

**After that, it is a scan of one file, plus the id.**

- **The path is spelled as a scan would spell it**: the canonical Download
  folder joined with the filename. A rescan then hits `IGNORE`, and a
  concurrent scan that gets there first simply wins.
- **Dimensions come from the file's header, not the API** (ADR 0044).
- **Thumbnails are made on demand** by the `wallpaper://` protocol. No
  pre-generation pass is started or cancelled.
- **Each landed file publishes `library-scanned` and `stats-changed`**, so the
  views refresh as they do after a scan.

**Downloads are background work** under ADR 0021.

- **The queue.** Files download one at a time, in a backend queue, in the order
  they were picked. Later picks join the running batch, and there is no cancel.
- **Running beside a scan.** Downloads may run during a scan. Their pinned
  report ranks below a scan's and above pre-generation's.
- **The batch's ending.** A batch where every file landed ends in a transient
  toast. It carries the scan ending's "back to Round 1" sentence when it
  applies, because every download is a wallpaper with no comparisons. Any
  failure ends the batch pinned.
- **Two checks.** The Download folder is checked when you click Download, and
  a failure refuses the call there. It is checked again for each file, because
  the answer expires (ADR 0035).

## Considered options

- **Resolve a relative Download folder against the working directory, like the
  Library root.** That is meaningless for a desktop launch. Resolving against
  each wallpaper's folder, as a reject destination does, has no wallpaper to
  resolve against.
- **Freeze the resolved folder when the setting is written.** That contradicts
  ADR 0011's rule that Written paths are stored as written.
- **Fall back to `$XDG_PICTURES_DIR` when there is no Library root.** It is a
  guess about where the curator keeps their library, and it would be made
  silently.
- **Suffix on collision, as soft reject does.** It never overwrites and never
  trusts unseen bytes. It also creates a duplicate that the next scan pairs
  with the original.
- **Refuse on collision and ask for a scan.** Honest, but a dead end for the
  commonest case.
- **Row first, as in ADR 0003.** A reject's row records a move that must be
  undoable. Here the file is the only thing that can go wrong, and a file on
  its own is something the scan already knows how to finish.
- **Verify by decoding.** It costs a full decode per download to catch what
  ADR 0034 already catches once.
