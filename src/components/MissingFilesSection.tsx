import { Section } from "@/components/SettingsView";
import { Button } from "@/components/ui/button";
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
 * The Missing files section: one button, and one line about the last time it was
 * pressed.
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
 * There is nothing to fix from here, deliberately. The rows stay, so the
 * honest offer is a number and the library grid, where each card says which
 * wallpaper it was; a control that dropped those rows would take their
 * Comparisons with them, which the domain does not allow (ADR 0001).
 */
export function MissingFilesSection() {
  /**
   * What the last check found, or `null` for a page nobody has pressed the
   * button on yet — which is every visit, since nothing is remembered between
   * them and nothing should be: a stored count would be a claim about a
   * filesystem that has moved on.
   */
  const [found, setFound] = useState<MissingFiles | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = () => {
    if (checking) return;
    setChecking(true);
    // Both cleared on the way in, so the line never shows a stale count or a
    // stale failure beside a check that is running.
    setFailed(false);
    setFound(null);

    void client
      .countMissingFiles()
      .then(setFound)
      .catch((error: unknown) => {
        console.error("Failed to check the library for missing files:", error);
        setFailed(true);
      })
      .finally(() => setChecking(false));
  };

  /**
   * The one line, and the three things it says.
   *
   * A check in flight says nothing here: the button's own label carries it, the
   * way the Scan button carries a scan. Before the first press there is no line
   * at all, the way an unresolved path field has none.
   */
  const line = ((): { tone: "muted" | "error"; text: string } | null => {
    if (failed) return { tone: "error", text: CHECK_FAILED };
    if (checking || !found) return null;
    return { tone: "muted", text: checkedLine(found) };
  })();

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
      <div className="flex">
        <Button variant="outline" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check now"}
        </Button>
      </div>
    </Section>
  );
}
