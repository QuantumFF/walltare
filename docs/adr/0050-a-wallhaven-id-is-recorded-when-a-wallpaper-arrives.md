# ADR 0050: A Wallhaven id is recorded when a wallpaper arrives, not read off its name

**Status:** Accepted
**Ticket:** [#320](https://github.com/QuantumFF/walltare/issues/320), part of
[#317](https://github.com/QuantumFF/walltare/issues/317)
**Date:** 2026-09-24

## Context

Discover marks search results that the library already holds. To do that, it
needs to know which wallpapers came from Wallhaven. Wallhaven names every file
`wallhaven-<id>.<jpg|png>` and sends no `Content-Disposition` header, so the
filename alone could answer the question. Anyone who has used Wallhaven before
already has a folder of files named this way.

Parsing the name whenever someone asks is the obvious design. It breaks in
places the app itself causes. A soft reject that collides adds a suffix to the
basename, so `wallhaven-85e1g1.jpg` can land as `wallhaven-85e1g1 (2).jpg`.
A wallpaper's identity is its absolute path, so a file renamed outside the app
is a new wallpaper, and the old row reads as gone (ADR 0032).

## Decision

**Recorded on arrival, then fixed.** A wallpaper's Wallhaven id is written when
its row is created. For a Discover download, it comes from the API. For a scan,
it comes from the filename. Nothing ever rewrites it: soft reject, Restore, a
collision suffix and a missing file all leave it alone.

**Scans count, not just downloads.** A scan that finds `wallhaven-<id>` records
the id. The name may also carry a ` (n)` suffix before a case-insensitive image
extension. The suffix covers this app's own reject collisions and a browser's
duplicate downloads. A non-Wallhaven file that happens to carry that exact
shape is a risk accepted in exchange for recognising the folders people
already have.

**One backfill.** Rows that existed before this change will never arrive
again, because a rescan inserts only new paths. So the schema migration
records ids for them once from their current filename, across every Status,
using the same grammar.

**Shared, not unique.** Two wallpapers may carry the same id, for example a
duplicate copy, or a file renamed and then rescanned. Path stays the identity
and the id is only an attribute. A uniqueness rule would force the scan to
refuse a file or pick a winner.

**Matching is by id alone.** A result is **In library** when any Active or Kept
wallpaper carries its id. Otherwise it is **Rejected** when any Rejected one
does. A wallpaper whose file is gone still counts, because a missing file is a
rendering fact (ADR 0032) and a search must not `stat` the library. Both marks
are shown rather than hidden, and neither result can be downloaded again.
Changing your mind about a reject is a Restore in the library, not a
re-download.

## Considered options

- **Parse the filename on demand.** No schema change. It loses the id to a
  collision suffix, and it makes the answer depend on what the file is called
  today rather than what it is.
- **Record it for Discover downloads only.** Clean provenance, but every
  existing Wallhaven folder would show up as not in the library.
- **Match by path or hash.** A path breaks as soon as the landing folder moves.
  A hash needs the file, which is exactly what a search result lacks.
- **Hide Rejected results.** That would leave pages short of Wallhaven's 24 and
  hide a judgement the curator has already made.
- **Offer Restore, or a re-download, from a Rejected result.** Restore pulls a
  Status transition onto a page that is about finding new images. A re-download
  duplicates a decision already made.
