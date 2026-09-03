import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { isAppError } from "@/lib/client";
import { useState, type ReactNode } from "react";

/** The shell both top-slot blocks are cut from, so the two read as one slot. */
export function NoticeBlock({
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
 * The failed-boot state of the top slot: ADR 0017's title and detail, and the
 * one button on the page that can make the fault go away.
 *
 * Retry re-reads what boot read and nothing else. The fault is outside the app —
 * a lock another process is holding, a permission, a disk that came back — so a
 * read that now succeeds is the whole of the fix, and the four sections below
 * read the store for themselves as the curator uses them.
 */
export function UnreadableLibraryBlock({ message }: { message: string }) {
  const { readLibrary } = useApp();

  // The message on screen, which starts as the one boot failed with and becomes
  // whatever a Retry failed with. Leaving the first sentence up after a second,
  // different failure is the block lying about which fault is being looked at.
  const [detail, setDetail] = useState(message);
  const [cleared, setCleared] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      // The read the whole app shares, so a Retry that succeeds also gives the
      // count line below its number rather than leaving the section reporting
      // nothing about a library that now reads.
      await readLibrary();
      setCleared(true);
    } catch (error) {
      console.error("Retrying the library read failed:", error);
      setDetail(isAppError(error) ? error.message : String(error));
    } finally {
      setRetrying(false);
    }
  };

  if (cleared) return null;

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
