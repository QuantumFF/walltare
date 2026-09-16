# ADR 0044: Pixel dimensions live on the Wallpaper row, because the thumbnails table only knows the shape

**Status:** Accepted
**Ticket:** [#256](https://github.com/QuantumFF/walltare/issues/256)
**Date:** 2026-09-17

## Context

[#255](https://github.com/QuantumFF/walltare/issues/255) asks the app two
questions it cannot currently answer. What will this wallpaper look like on my
screen, given that the desktop crops it to fill? And is this wallpaper even large
enough for my screen, given that a 1280x720 file on a 4K monitor is not a
wallpaper no matter how it ranks?

Both need a number the app does not hold: how many pixels wide and tall the
source file actually is. The crop preview, the undersized badge and its filter,
and the two uncropped Library layouts all rest on it, and every one of them is a
sibling ticket. This one is the foundation and the only ticket in the epic that
touches the schema.

There is a table that looks like it already answers this, which is why the
question is worth writing down rather than assuming.

## Decision

### The dimensions go on `wallpapers`, not on `thumbnails`

`thumbnails` has `width` and `height` columns. They are the cache file's
dimensions, not the source's, and the difference is the whole of this ADR.

A `medium` is capped at 1920px wide ([ADR 0004](0004-thumbnail-resolution-phases.md)),
so a 5120x2160 ultrawide and a 1920x810 crop of it record the same
`1920 x 810` row. The ratio survives the downscale and the resolution does not.
Ratio is enough for masonry and for justified rows; it is not enough for the
undersized badge, which is a comparison against the curator's screen in pixels,
and it is not enough for the crop preview's caption, which says how much of the
image goes.

Three further reasons the cache table could not carry it even if the numbers were
right:

- **A thumbnail row is a cache entry and is deleted as one.** Clear thumbnail
  cache empties the table; so does a purge. A fact about the wallpaper must not
  be thrown away by a button that promises to free disk space.
- **The freshness rule is the wrong rule.** A thumbnail row is valid while its
  `source_mtime` matches the file. The source's dimensions are a fact about the
  bytes, and re-reading them is a header read rather than a decode, so tying them
  to a cache invalidation would regenerate a fact that was never stale.
- **`full` has no row.** No caller asks for it ([ADR 0012](0012-thumbnail-pre-generation.md)),
  so the one size that would hold the true dimensions is the one size the table
  never has.

So: `wallpapers.width` and `wallpapers.height`, nullable, behind a schema version
bump to 4 and the one-way migration `db.rs` already performs
([ADR 0005](0005-schema-migrations.md)). Both fields are on the `Wallpaper` DTO
and on the mirrored `Wallpaper` in `client.ts`, so every listing and every voting
pair carries them.

### NULL is an answer, and every reader has one for it

A row whose dimensions have not been read yet holds NULL in both columns. That is
the ordinary state of a library mid-backfill, not an error, so nothing waits for
it: such a wallpaper shows no badge, is skipped by the undersized filter, and
falls back to 16:9 for layout. A wrong badge on a library still being measured is
worse than no badge, because the curator cannot tell which one they are looking
at.

The two columns are written in one statement and read off one file, so they are
NULL together or set together. Nothing has to handle a width without a height.

Dimensions are never overwritten with NULL. A file that is momentarily
unreadable — an unmounted drive, a file being rewritten — would otherwise turn a
measured wallpaper into an unmeasured one, and the app would forget something it
knew. The write only ever happens with numbers in hand.

### A header read, not a decode

`image::image_dimensions` opens the file, guesses the format and reads as far as
the size fields. That is a few hundred bytes against the hundreds of megabytes a
4K PNG expands to, and it is what makes measuring affordable in both places it
happens. `scanner::dimensions` is that call, `None` for a file that is gone or is
not an image this build can read.

`None` rather than an error because neither caller has anything to do with one. A
scan that failed over a bad `.jpg` would lose the library behind it, and a source
that will not decode is already the pre-generation pass's to count and report
([ADR 0034](0034-a-hostile-library-root.md)). The row keeps its NULL columns,
which is the app's ignorance written down rather than a wrong answer.

### The scan measures what it adds, and only that

`insert_new_wallpapers` answers with the rows it inserted rather than a count, so
the scan can read each new file's header and write the numbers back. `INSERT OR
IGNORE` is what makes that distinction worth having: a rescan hands over the
whole library and only some of it is new, and measuring every file every time
would be a file open per wallpaper for rows that already have their answer.

The three steps are the insert under the connection, the header reads with it
released, then the writes — [ADR 0039](0039-the-connection-lock-is-taken-for-queries.md)'s
split. A chunk is 500 files, so holding the lock across the reads would queue
every command and every `wallpaper://` request behind 500 file opens on whatever
drive the Library root sits on.

A wallpaper already in the library keeps whatever it was measured at, even if the
curator has since re-exported the file at a different size. That is the same
staleness the `filename` column already has and the same cure: it is corrected by
the pass, not by the scan.

### The pre-generation pass backfills, and it is listed for dimensions alone

Every wallpaper scanned before this landed has NULL dimensions and, on most
machines, a perfectly warm cache. So the backfill cannot ride on the thumbnails:
`work_list`'s freshness rule drops exactly the cohort that needs it.

The work list therefore has two reasons to hold a wallpaper rather than one.
`Pending::missing` becomes `Option<Missing>` — `None` is a wallpaper that owes no
thumbnail — and `Pending::dimensions` says whether the row is still short of its
numbers. A wallpaper can owe thumbnails, dimensions, or both, and the pass reads
each answer off the entry rather than inferring one from the other. The entry
leaves the list for good once the dimensions are written, so the backfill is one
pass and not one per launch.

The pass is where this goes because it is already the one pass over every source
in the library, with its own ordering, its own progress bar, its own cancel and
[ADR 0012](0012-thumbnail-pre-generation.md)'s one-wallpaper-at-a-time budget. A
backfill that needed any of those would be building a second copy of it.

A wallpaper listed for its dimensions alone comes back as `Step::Measured` rather
than `Step::Generated`. `pregen-complete` speaks about thumbnails, and a backfill
over a warm library that reported one thumbnail per wallpaper it measured would
be a number nothing on disk agrees with. The count is not reported at all, for
the reason the skip count is not: nobody acts on how many rows were filled in.
The progress bar still reaches its total, so the pass does not appear to stall.

## Alternatives rejected

**Reading the dimensions off the decoded image the pass already holds.** This is
how the epic described it, and it is free in exactly one of the three branches.
`generate_both` decodes the source, so the source's dimensions are in hand; the
single-missing-size branch may decode a *donor* thumbnail instead
([ADR 0004](0004-thumbnail-resolution-phases.md)), whose dimensions are not the
source's, and the dimensions-only branch decodes nothing at all. Threading the
source's size out of one branch buys one saved header read per cold wallpaper —
around 0.1% of a decode — in exchange for two ways of learning the same fact and
two sets of tests. One rule, one call site.

**Backfilling in the migration.** `migrate` runs before the first window. Reading
5,000 image headers there would put a walk of somebody's external drive between
the launch and the app appearing, with no progress bar and no cancel. The
migration adds the columns and nothing else.

**A `dimensions` table beside `thumbnails`.** A second table keyed on
`wallpaper_id` holding exactly two integers that are never queried on their own,
for a fact that is one-to-one with the row. It is a column.

**Deriving the resolution from the thumbnail's ratio and the cache file.** The
ratio is all the thumbnail knows, and the resolution cannot be recovered from it.
This is the alternative this ADR exists to refuse.

## Consequences

`SCHEMA_VERSION` is 4. A v3 database gains both columns with nothing in them; a
v1 or v2 one runs every step below the target and arrives at the same shape.

The first launch after this ships runs a pass over the whole library on most
machines — one header read per wallpaper, one batched `UPDATE` each — and ends
saying nothing, because it generated no thumbnails and failed nothing. Every
launch after that has an empty work list again.

Nothing is visible yet. The crop preview, the undersized badge and its filter,
and the two uncropped Library layouts are the siblings that spend this, and each
of them has to keep answering for a NULL.
