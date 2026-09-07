import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { isAppError } from "@/lib/client";
import { useState, type ReactNode } from "react";

/**
 * The shell both top-slot blocks are cut from, so the two read as one slot.
 *
 * Not exported: both blocks that wear it are in this file, and the page reaches
 * them by name rather than assembling one out of a tone and a heading — which is
 * what keeps the copy for a landing beside the landing it is for (ADR 0033).
 */
function NoticeBlock({
  tone,
  heading,
  children,
}: {
  tone: "muted" | "destructive";
  heading: string;
  children: ReactNode;
}) {
  const destructive = tone === "destructive";
  return (
    <div
      // A first run is an invitation and a library that would not open is a
      // fault, so one is a status and the other an alert. That is the whole of
      // what a screen reader hears differently, since both say their piece in
      // the same slot in the same shape.
      role={destructive ? "alert" : "status"}
      className={
        destructive
          ? "space-y-2 rounded-lg border border-destructive/40 bg-card px-4 py-3"
          : "space-y-2 rounded-lg border border-border bg-card px-4 py-3"
      }
    >
      <p
        className={
          destructive
            ? "text-sm font-medium text-destructive"
            : "text-sm font-medium text-foreground"
        }
      >
        {heading}
      </p>
      {children}
    </div>
  );
}

/**
 * What walltare is for, in one line.
 *
 * A curator who has just installed this has never read the README and has no
 * reason to know why a wallpaper app wants a folder, so the block that asks for
 * one says what it will do with what it finds there. One line, because the
 * answer to "why is this asking me for a folder" is one sentence long and a
 * paragraph of it would be a wizard page with no Next button (ADR 0033).
 */
const WHAT_WALLTARE_DOES =
  "walltare ranks the wallpapers you already have by showing you two at a " +
  "time and asking which you prefer.";

/**
 * What a Library root is, said once, where the term is first met.
 *
 * `CONTEXT.md`'s own definition — "the folder a scan walks to find wallpapers" —
 * because this is the first time the curator reads the word and the heading
 * above, the label beside the field and the section below it all use it as
 * though it were already known. Teaching the term rather than swapping in
 * "folder" is what keeps the glossary on screen (ADR 0017, ADR 0033).
 */
const WHAT_A_LIBRARY_ROOT_IS =
  "The Library root is the folder it scans to find them.";

/**
 * The first-run state of the top slot: the prompt the page leads with, and the
 * only thing a curator opening walltare for the first time is asked for.
 *
 * The block leads and the Library root section follows it, with the other four
 * sections withheld until there is a library for them to be about — so what a
 * first run reads is an invitation and not a configuration page with a blank
 * field in it (ADR 0033).
 */
export function FirstRunBlock() {
  return (
    <NoticeBlock tone="muted" heading="Choose a Library root">
      <p className="text-sm text-muted-foreground">{WHAT_WALLTARE_DOES}</p>
      <p className="text-sm text-muted-foreground">{WHAT_A_LIBRARY_ROOT_IS}</p>
    </NoticeBlock>
  );
}

/**
 * The failed-boot state of the top slot: ADR 0017's title and detail, and the
 * one button on the page that can make the fault go away.
 *
 * Retry re-reads what boot read and nothing else. The fault is outside the app —
 * a lock another process is holding, a permission, a disk that came back — so a
 * read that now succeeds is the whole of the fix.
 *
 * What that read succeeding *does* is not this block's to decide, which is why
 * nothing here remembers having cleared: the notice is boot's account of a read
 * that failed, `readLibrary` retires it, and the page reads the notice to know
 * whether it is showing a boot landing or the ordinary five sections. A local
 * "cleared" flag would have hidden the block while leaving the page still
 * dressed as a landing (ADR 0033).
 */
export function UnreadableLibraryBlock({ message }: { message: string }) {
  const { readLibrary } = useApp();

  // The message on screen, which starts as the one boot failed with and becomes
  // whatever a Retry failed with. Leaving the first sentence up after a second,
  // different failure is the block lying about which fault is being looked at.
  const [detail, setDetail] = useState(message);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      // The read the whole app shares, so a Retry that succeeds also gives the
      // count line below its number rather than leaving the section reporting
      // nothing about a library that now reads.
      await readLibrary();
    } catch (error) {
      console.error("Retrying the library read failed:", error);
      setDetail(isAppError(error) ? error.message : String(error));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <NoticeBlock tone="destructive" heading="Couldn't read the library">
      {/* The backend's own message, verbatim. It is the only account of the
          fault there is, and a canned sentence in front of it would hide which
          file or which lock is the problem (ADR 0017). */}
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void retry()}
        disabled={retrying}
      >
        Retry
      </Button>
    </NoticeBlock>
  );
}
