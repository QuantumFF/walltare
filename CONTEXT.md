# CONTEXT

Glossary for walltare. Terms only; no implementation.

## Wallpaper

A single image file known to the app. Identified by its absolute path; one wallpaper per file.

## Library root

The folder a scan walks to find wallpapers, including everything beneath it.
One folder, chosen by the user.

The Library root is a stated preference, not a fact about the library. It can
point somewhere that no longer exists, and the wallpapers an earlier scan found
stay in the library regardless of where it points now. It is a Written path.

## Written path

How the user writes a folder for the app to use: the Library root, a soft
reject's destination, and the Download folder. It may use `~` for the home folder and environment
variables, and the app stores it as written, so it keeps meaning whatever those
mean on the machine reading it. Naming a variable that is not set is an error,
not an empty string.

A Written path that is not absolute is relative to different things depending on
where it is used. A soft reject destination is relative to the wallpaper's own
folder, so a nested library gets one reject folder per source folder. A Library
root is relative to wherever the app was launched from. A Download folder is
relative to the Library root. See
[ADR 0011](docs/adr/0011-written-paths.md).

## Download folder

Where a wallpaper downloaded from Wallhaven lands. It is a Written path, and by
default it is a folder named `wallhaven` inside the Library root.

A relative Download folder means the Library root as it stands at each
download. So it follows the root when the root moves, and wallpapers that were
downloaded earlier stay where they landed. It needs the root to exist. With no
Library root, or one that is not there, nothing can be downloaded, rather than
the app creating the root itself. An absolute Download folder may sit outside
the Library root.

A file that lands there is a wallpaper at once, and it is Active, exactly as if
a scan had found it. See
[ADR 0051](docs/adr/0051-a-download-lands-as-a-scan-of-one-file.md).

_Avoid_: landing folder

## Dimensions

How many pixels wide and tall a wallpaper's file actually is. A fact about the
source, not about any thumbnail made from it: a thumbnail is capped in width, so
it carries the wallpaper's shape and not its size.

The app may not know them. A wallpaper whose Dimensions have not been read yet
has none rather than a guess, and everything that would draw on them says nothing
instead of saying something wrong. See
[ADR 0044](docs/adr/0044-pixel-dimensions-live-on-the-wallpaper-row.md).

## Wallhaven id

Which Wallhaven wallpaper a wallpaper's file is. It is recorded when the
wallpaper arrives in the library: by a download from Wallhaven, or by a scan
that finds a file named the way Wallhaven names its files. After that it never
changes. It stays through a soft reject, a Restore, and a file going missing.
A file renamed outside the app is not changed by that either, because the app
sees it as a new wallpaper at a new path.

Most wallpapers have none. Several wallpapers may share one, for example a
copy in two folders. The id is what marks a Result as already in the library
or Rejected. See
[ADR 0050](docs/adr/0050-a-wallhaven-id-is-recorded-when-a-wallpaper-arrives.md).

_Avoid_: Source (that is the full-size file as opposed to its thumbnail),
provenance

## Result

A Wallhaven wallpaper that a search on Discover shows. It is not a Wallpaper:
it has no file in the library, no Status and no Score. It becomes a Wallpaper
only by being downloaded, and from then on it is an ordinary Active one.

Each Result carries a mark, decided by its Wallhaven id:

- **In library**: some Active or Kept wallpaper carries its id.
- **Rejected**: no Active or Kept wallpaper does, but a Rejected one does.
- **Unmarked**: no wallpaper carries its id.

A marked Result is still shown, but it cannot be picked or downloaded again.
Changing your mind about a Rejected one is a Restore in the library.

_Avoid_: search hit, remote wallpaper, candidate

## Pick

A Result the curator has chosen for the next download. Picks gather across
searches, so a changed filter keeps them, and a download clears them. Only an
unmarked Result can be a Pick.

_Avoid_: selection (that is the grid's cursor), queue (that is what a download
works through)

## Screen

How many pixels wide and tall the display the user is curating for is. One
screen, whatever the machine has plugged into it, because everything that asks
about it — how a wallpaper would be cropped, whether it is large enough — has to
get the same answer.

The Screen is a stated preference, not a fact about the machine. It defaults to
the monitor the app detected and the user may say otherwise; saying the detected
value is what puts it back. A monitor the platform will not describe leaves a
usable Screen standing rather than an error.

## Minimum resolution

The smallest Dimensions a wallpaper may have before it counts as **undersized**
for the Screen. It defaults to the Screen's own pixels, so a user who wants
exactly what their display is has nothing to say, and one who wants to be
stricter or looser says it here.

Because the default is the Screen rather than a fixed number, a Minimum
resolution the user has not moved off follows the Screen when the Screen moves.

Undersized is a fact about a file next to a preference, not a Status: an
undersized wallpaper is still Eligible, still votes and still appears in review.
A wallpaper whose Dimensions are unknown is not undersized either, because
nothing has read them.

## Status

Every wallpaper is exactly one of:

- **Active**: participates in voting and appears in review.
- **Kept**: the user has explicitly decided to keep it despite its rating. Still participates in voting, but never appears in review.
- **Rejected**: the user moved the file out via a soft reject. Sits out of voting and review entirely; its history remains part of the library's record.

Statuses are mutually exclusive; "keep" and "reject" are transitions, not parallel flags.

Active becomes Kept or Rejected. Kept becomes Rejected or, by undoing the keep,
Active again. Rejected becomes Active again by a Restore. Asking for any other
transition is an error, not a no-op. A wallpaper rejected before Restore existed
has no Origin to go back to, so for those rows Rejected stays terminal. See
[ADR 0009](docs/adr/0009-reject-is-reversible.md).

## Soft reject

Rejecting a wallpaper by moving its file to a destination folder without erasing its history: the row survives as `rejected`, preserving every comparison it took part in.

The destination is a Written path naming a folder, and the move never
overwrites a file already sitting in it. The reject records the wallpaper's
Origin so a Restore can put it back, so a wallpaper can be rejected and restored
as often as the user changes their mind. See
[ADR 0003](docs/adr/0003-soft-reject-write-ordering.md) and
[ADR 0009](docs/adr/0009-reject-is-reversible.md).

A wallpaper whose file is already missing is soft-rejected without a move:
there is nothing to move, so it stays where it was, and its Origin is that same
place. This is how a wallpaper whose file left outside the app leaves voting and
review. See [ADR 0050](docs/adr/0050-a-missing-file-is-rejected-in-place.md).

## Restore

Undoing a soft reject: the file moves back to its Origin and the wallpaper
becomes Active, whichever status it held before the reject. Restoring clears the
Origin, so the next reject records a fresh one.

A Restore lands on Active rather than on the previous status because Kept is a
judgement about a rating, and changing your mind about a reject is not that
judgement. A wallpaper with no Origin cannot be restored.

A wallpaper that was soft-rejected because its file was missing never left its
Origin, so its Restore moves nothing: it becomes Active whether the file has
come back or not.

## Origin

Where a wallpaper's file sat before its current soft reject. Recorded by the
reject and cleared by the Restore, so only a currently-rejected wallpaper has
one. A wallpaper rejected before Restore existed has none either, because
nothing recorded it at the time.

## Missing file

A wallpaper whose file is not where the app says it is: deleted, moved, or on a
drive that is not plugged in. A fact about the filesystem at the moment somebody
looks, not a Status, because it becomes true and false again without the user
doing anything. The app shows such a wallpaper as gone. See
[ADR 0032](docs/adr/0032-a-missing-file-reads-as-gone.md).

## Comparison

One pairwise vote: two wallpapers, one winner, one loser. Permanent. Comparisons are never deleted.

Which of the two the user sees on the left carries no meaning. The pair is
presented in random order so that the habit of picking the left one does not
become part of the rating.

## Score

A wallpaper's standing among the others: the μ of its rating. Every wallpaper
starts at the same Score and moves from there with each Comparison it takes
part in.

A Score is comparable only within one library, because it is a position among
these wallpapers and nothing else. A wallpaper that has been in no Comparison
has no Score yet; the number it starts on is the app's ignorance, not a
judgement of the image.

A Rejected wallpaper sits out of voting, so its Score stops moving and stays
the last thing the app knew about it.

Score answers how good. Evaluated answers how sure. Review orders by Score —
from the lowest, to cull the worst, or from the highest, to confirm favourites —
so the wallpaper the app is least confident about is not thereby the wallpaper
it likes least. See [ADR 0013](docs/adr/0013-review-orders-by-mu.md).

## Eligible

A wallpaper the voting pool draws from: Active or Kept. Rejected wallpapers are
not eligible. Every progress fraction is measured against the eligible pool, not
against the whole library.

## Round

One pass over the eligible pool. Round 4 means every eligible wallpaper has been
in at least three comparisons and the app is working through the fourth.

A Round is derived from the comparison counts, never stored, so it moves in
whichever direction the truth does: rejecting the least-compared wallpaper
advances it, and scanning in unseen files sends it back. Progress within a Round
is the share of the eligible pool that has already had its comparison for that
Round. See [ADR 0008](docs/adr/0008-round-is-derived.md).

## Evaluated / Participated

Two distinct progress notions. **Participated**: has been in at least one
comparison. **Evaluated**: its rating is confident enough to trust, meaning σ
below the Evaluated threshold. Evaluated is a late signal at every threshold on
offer, so a young library has none.

Both are counted over the eligible pool. Participated is Round progress at
Round 1, and is pinned to the size of the pool from Round 2 onwards, so the
headline reports it per-Round rather than as a total. Evaluated headlines
alongside it as the confidence signal: the two answer different questions and
the app shows both.

## Evaluated threshold

How sure the app has to be about a Score before it counts as Evaluated: the σ a
wallpaper's rating falls below to qualify.

The Evaluated threshold is a stated preference, not a fact about the library.
How many Comparisons make a Score trustworthy is the user's call, so the app
offers three confidences and keeps whichever was chosen. It defaults to σ below
4.0, roughly half the uncertainty a wallpaper starts with, which is what
Evaluated meant before the user could say otherwise.

One threshold, because everything that asks whether a wallpaper is Evaluated —
the count in the headline, the Score badge on every card — has to get the same
answer. See [ADR 0046](docs/adr/0046-the-evaluated-threshold-is-the-curators.md).
