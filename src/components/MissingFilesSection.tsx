import { Section } from "@/components/SettingsView";
import { Button } from "@/components/ui/button";
import { useAppEvents } from "@/context/AppEventsContext";
import { client, type MissingFiles } from "@/lib/client";
import { counted } from "@/lib/copy";
import { useState } from "react";

/**
 * The sentence a check that would not run leaves on the line.
 *
 * One string for every kind, unlike the Library root's four: the only thing that
 * can fail here is the query or the walk behind it, and neither has anything the
 * curator could act on. What matters is that the line does not go on showing a
 * count from before the press.
 */
const CHECK_FAILED = "Couldn't check the library for missing files.";

/** The same, for a press of the reject button. */
const REJECT_FAILED = "Couldn't reject the wallpapers whose files are missing.";

/**
 * How the line writes what one reject of the missing files did.
 *
 * `nothing moved` because that is the half the curator cannot see: every one
 * of these was rejected in place, and the reject destination received nothing
 * (ADR 0050). Zero is a drive that came back between the check and the press,
 * since the backend asks each file again.
 */
function rejectedLine(rejected: number): string {
  return rejected === 0
    ? "Nothing rejected · the files are back"
    : `${counted(rejected, "wallpaper")} rejected · nothing moved`;
}

/**
 * How the line writes what one check found.
 *
 * Two facts with the `·` ADR 0020's Thumbnails line already uses, and the second
 * one says **Active and Kept** rather than "wallpapers": the number is out of
 * CONTEXT.md's Eligible pool, and a Rejected wallpaper is not in it because its
 * file moved to the reject destination on purpose. Naming the two Statuses is
 * what stops the count reading as a claim about the whole library, and it says
 * so in the glossary's own words rather than in a second sentence underneath.
 *
 * The zero case gets its own opening, the way ADR 0020's `Nothing cached yet`
 * does, because `0 files missing` is a number the eye has to read before it
 * knows there is nothing wrong.
 */
function checkedLine({ missing, eligible }: MissingFiles): string {
  const pool = `${counted(eligible, "wallpaper")} checked`;
  return missing === 0
    ? `No files missing · ${pool}`
    : `${counted(missing, "file")} missing · ${pool}`;
}

/**
 * The Missing files section: a button, a second one once a check has found
 * something, and one line about the last press.
 *
 * A wallpaper whose file was deleted or moved outside the app still has a row,
 * because nothing deletes one — `comparisons` references it with `RESTRICT` and
 * Comparisons are never deleted — and its card is the only place that says so.
 * This is the answer to "how many", which no amount of scrolling a grid of
 * hundreds gives (#200).
 *
 * **On demand, and only on demand.** There is no read on mount, unlike the
 * Thumbnails line beside it: `get_cache_size` is one `read_dir` of a directory
 * the app owns, and this is a `stat` per Active or Kept row against paths that
 * may be on an external drive or a network mount. Opening Settings to change the
 * theme must not walk somebody's library. That is also why nothing refreshes it
 * afterwards — a count is about the moment it was taken, and the button is how
 * the curator takes another (ADR 0032).
 *
 * **Rejecting them is the one fix on offer.** A check that found some offers
 * a second button that soft-rejects every one: nothing moves, the rows stay
 * with their Comparisons, and they leave voting and review because they are no
 * longer Eligible. Rows are never dropped, because that would take their
 * Comparisons with them, which the domain does not allow (ADR 0001); a Restore
 * of any one of them puts it back (ADR 0050).
 */
export function MissingFilesSection() {
  /**
   * What the last check found, or `null` for a page nobody has pressed the
   * button on yet — which is every visit, since nothing is remembered between
   * them and nothing should be: a stored count would be a claim about a
   * filesystem that has moved on.
   */
  const [found, setFound] = useState<MissingFiles | null>(null);
  /** How many the last reject took out of the pool, or `null` for none yet. */
  const [rejected, setRejected] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checking" | "rejecting" | null>(null);
  const { publish } = useAppEvents();

  const check = () => {
    if (busy) return;
    setBusy("checking");
    // All cleared on the way in, so the line never shows a stale count or a
    // stale failure beside a check that is running.
    setFailed(null);
    setFound(null);
    setRejected(null);

    void client
      .countMissingFiles()
      .then(setFound)
      .catch((error: unknown) => {
        console.error("Failed to check the library for missing files:", error);
        setFailed(CHECK_FAILED);
      })
      .finally(() => setBusy(null));
  };

  /**
   * Soft-reject everything the check found, then tell the other views.
   *
   * Every row goes out as its own `status-changed`, which is the patch Review
   * and Library already apply to a reject made anywhere else: Review drops the
   * rows and Library repaints their pills. The Eligible pool shrank, so Rank's
   * headline is re-read the way `EvaluatedSection` re-reads it, and a failed
   * re-read leaves the old one standing until the next vote.
   *
   * The count comes off the line afterwards, because the rows it counted are
   * not Eligible any more; pressing Check now again is how to see what is left.
   */
  const reject = () => {
    if (busy) return;
    setBusy("rejecting");
    setFailed(null);

    void client
      .rejectMissingFiles()
      .then((rows) => {
        for (const wallpaper of rows) {
          publish({ type: "status-changed", wallpaper });
        }
        setFound(null);
        setRejected(rows.length);
        // Its own catch, so a re-read that fails does not report a reject
        // that landed as one that did not.
        void client
          .getStats()
          .then((stats) => publish({ type: "stats-changed", stats }))
          .catch((error: unknown) => {
            console.error("Failed to re-read the stats after a reject:", error);
          });
      })
      .catch((error: unknown) => {
        console.error("Failed to reject the missing files:", error);
        setFailed(REJECT_FAILED);
      })
      .finally(() => setBusy(null));
  };

  /**
   * The one line, and the things it says.
   *
   * A check in flight says nothing here: the button's own label carries it, the
   * way the Scan button carries a scan. Before the first press there is no line
   * at all, the way an unresolved path field has none. A reject in flight
   * leaves the count up, since it is the count being acted on.
   */
  const line = ((): { tone: "muted" | "error"; text: string } | null => {
    if (failed) return { tone: "error", text: failed };
    if (busy === "checking") return null;
    if (rejected !== null)
      return { tone: "muted", text: rejectedLine(rejected) };
    if (!found) return null;
    return { tone: "muted", text: checkedLine(found) };
  })();
  const offerReject =
    found !== null && found.missing > 0 && busy !== "checking";

  return (
    <Section heading="Missing files">
      {line && (
        <p
          data-slot="missing-files-status"
          className={
            line.tone === "error"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {line.text}
        </p>
      )}

      {/* Outline rather than primary: the one filled button on this page is the
          Scan a first run is entirely about (ADR 0020). The label says what the
          press does rather than naming the section again, and it carries the
          check the way the Scan button carries a scan. */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={check} disabled={busy !== null}>
          {busy === "checking" ? "Checking…" : "Check now"}
        </Button>
        {/* Only beside a count that found some, so it is never a button that
            acts on nothing. Outline like its neighbour: a reject is undone by a
            Restore, so it is not the destructive colour. */}
        {offerReject && (
          <Button variant="outline" onClick={reject} disabled={busy !== null}>
            {busy === "rejecting" ? "Rejecting…" : "Reject missing"}
          </Button>
        )}
      </div>
    </Section>
  );
}
