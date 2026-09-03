import { Section } from "@/components/SettingsView";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { client, type CacheSize, type PregenProgress } from "@/lib/client";
// The counts in the Thumbnails line are the counts the shell's report prints,
// written once so that one fact keeps one phrasing (ADR 0021).
import { bytes, counted, grouped } from "@/lib/copy";
import { useBackendEvents } from "@/lib/useBackendEvents";
import { useCallback, useEffect, useState } from "react";

/**
 * What a clear costs, which is the whole reason the click asks first.
 *
 * The rate is ADR 0012's 420ms per wallpaper, written as the ADR 0020 sentence
 * rather than computed from this library's own count. It is an example the
 * curator scales — a minute for 120, fourteen for 2,000 — and computing it would
 * print "about a minute for 12 wallpapers" on a small library, which is five
 * seconds and would make the warning read as nothing at all. The count that is
 * about this library is two sections up, under the Library root.
 */
const CLEAR_CONSEQUENCE =
  "They regenerate on the next launch, which takes about a minute for 120 wallpapers.";

/**
 * The clause the sentence gains when there is a pass to stand down as well.
 *
 * `clear_cache` cancels any running pass before it empties the directory
 * (ADR 0012), so this is not a warning about a side effect the curator could
 * avoid — it is the second half of what they are about to agree to, and the
 * button they would otherwise have pressed for it is right beside this one.
 */
const CLEAR_CANCELS_PASS = " The pass running now will be cancelled with them.";

/**
 * The Thumbnails section: one line, a button that changes verb, and the only
 * maintenance on the page.
 *
 * This is where `cancel_pregen` finally lives. ADR 0012 added the command and
 * gave it no home, ADR 0021 kept the shell's report to reporting, and
 * pre-generation runs on most launches — which is exactly when someone opens this
 * page to ask why the machine is busy (ADR 0020).
 *
 * A pass that is already running when this mounts is not asked about, because
 * there is nothing to ask with: whether one is running lives in a mutex on the
 * Rust side and no command reads it out. What the section can do honestly is
 * listen, so a pass in flight announces itself on its next `pregen-progress`,
 * which is one per wallpaper — about 420ms in release and a few seconds in a
 * debug build. Until that arrives the button reads Generate now while a pass
 * runs, and pressing it then is not a race: `start_pregen` cancels and joins its
 * predecessor, so the worst the stale label costs is a restart of work that was
 * already happening.
 *
 * That is also why the label is read from the events and never from the click. A
 * pass over a warm library finds nothing to do and emits nothing at all from
 * beginning to end (ADR 0012), so a Generate now that set "running" itself would
 * stick on Cancel forever with no event coming to free it.
 */
export function ThumbnailsSection() {
  // What the last walk of the cache directory found; `null` until the first one
  // answers, and again if one fails, in which case the section says nothing
  // rather than guessing at a number it is about to put in a confirm.
  const [size, setSize] = useState<CacheSize | null>(null);
  // The running pass, or `null` for no pass running as far as this page knows.
  const [progress, setProgress] = useState<PregenProgress | null>(null);
  /**
   * The confirm, and the two things it says, as they read when it opened.
   *
   * Snapshotted rather than read live, which is what ADR 0020 means by "the
   * number from the readout at the moment the dialog opens": a `pregen-complete`
   * arriving behind the overlay refreshes the size and clears the pass, and
   * either would rewrite the sentence under the curator while they are reading
   * it — the second one by dropping the clause about the pass after they have
   * already weighed it.
   */
  const [confirming, setConfirming] = useState<{
    size: string;
    running: boolean;
  } | null>(null);

  /**
   * Walk the cache directory and report what is in it.
   *
   * On mount, on `pregen-complete` and after a clear, and on nothing else. Not
   * per `pregen-progress`: `get_cache_size` is a `read_dir` plus a `metadata`
   * per entry, about 10,000 stats at ADR 0016's ceiling, and firing it per
   * wallpaper would be a directory walk apiece to move a number by 400KB. The
   * `of 1,204` clause carries the movement in between, which is what makes the
   * stale byte count on the line beside it a decision rather than a bug
   * (ADR 0020).
   */
  const readSize = useCallback(() => {
    void client
      .getCacheSize()
      .then(setSize)
      .catch((error: unknown) => {
        console.error("Failed to read the thumbnail cache size:", error);
        setSize(null);
      });
  }, []);

  useEffect(() => {
    readSize();
  }, [readSize]);

  // The pass, as this page hears about it. What a pass has to *say* when it ends
  // is the toast's, and it says nothing for the two clean endings (ADR 0021);
  // what is left here is a line with a count to keep and a button with a verb to
  // change back.
  useBackendEvents({
    pregenProgress: setProgress,
    pregenComplete: () => {
      setProgress(null);
      // The one refresh that is not a click: a pass that has stopped is the
      // moment the number on the line is furthest from the truth.
      readSize();
    },
  });

  const running = progress !== null;

  const generate = () => {
    void client.startPregen().catch((error: unknown) => {
      console.error("Failed to start thumbnail pre-generation:", error);
    });
  };

  // The label is left where it is until `pregen-complete` says the pass has
  // stopped. A cancel lands up to one wallpaper's decode late (ADR 0012), and a
  // button that read Generate now while a thread was still decoding would be
  // reporting the request rather than the work.
  const cancel = () => {
    void client.cancelPregen().catch((error: unknown) => {
      console.error("Failed to cancel thumbnail pre-generation:", error);
    });
  };

  const clear = () => {
    void client
      .clearCache()
      .then(readSize)
      .catch((error: unknown) => {
        console.error("Failed to clear the thumbnail cache:", error);
      });
  };

  /**
   * The one line, and the three things it says (ADR 0020).
   *
   * A running pass outranks the empty-cache reading, because a cache being
   * filled right now is not a cache with nothing in it — an empty reading beside
   * a pass is the byte count being one refresh behind, and the clause that
   * follows it is the part that is moving. Before the first walk answers there is
   * no line at all, the way an unresolved path field has none.
   */
  const line = ((): string | null => {
    if (!size) return null;
    if (progress) {
      return `${bytes(size.bytes)} cached · ${grouped(progress.done)} of ${grouped(progress.total)} generated`;
    }
    if (size.files === 0) return "Nothing cached yet";
    return `${bytes(size.bytes)} cached · ${counted(size.files, "file")}`;
  })();

  /**
   * Whether Clear cache has anything to do, which is the two rules of ADR 0020
   * put together.
   *
   * It disables on an empty cache, because a control offering to remove nothing
   * should say so rather than sit there enabled. It stays enabled throughout a
   * pass, because clearing already cancels one. Those meet on a cache that is
   * empty *and* being filled — a first launch, or the seconds after a clear —
   * where the button still has the pass to stand down, so the pass wins. With no
   * reading at all it is disabled: there is no number for the sentence the click
   * would open.
   */
  const clearable = size !== null && (size.files > 0 || running);

  return (
    <Section heading="Thumbnails">
      {line && (
        <p
          data-slot="thumbnail-cache-status"
          className="text-xs text-muted-foreground"
        >
          {line}
        </p>
      )}

      <div className="flex gap-2">
        {/* One button and two verbs, so the control that started the work is the
            control that stops it. Outline rather than primary: the one filled
            button on this page is the Scan a first run is entirely about
            (ADR 0020). */}
        <Button variant="outline" onClick={running ? cancel : generate}>
          {running ? "Cancel" : "Generate now"}
        </Button>

        <AlertDialog
          open={confirming !== null}
          onOpenChange={(open) => {
            setConfirming(
              open
                ? { size: bytes(size?.bytes ?? 0), running: progress !== null }
                : null,
            );
          }}
        >
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!clearable}>
              Clear cache
            </Button>
          </AlertDialogTrigger>

          {/* ADR 0017 predicted this component would sit unused until Settings
              needed it for `clear_cache`, and this is the caller. Act-then-undo,
              which every transition on every other page uses instead, does not
              reach here: there is nothing to undo, only to redo slowly, and at
              420ms per wallpaper a misclick costs fourteen minutes on a large
              library (ADR 0009, ADR 0012, ADR 0020). */}
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear {confirming?.size} of thumbnails?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {CLEAR_CONSEQUENCE}
                {confirming?.running && CLEAR_CANCELS_PASS}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* "Cancel" is this dialog's own dismiss and not the pass's, which
                  is a collision worth leaving alone: the alternative reads
                  "Keep them", and Keep is a Status in CONTEXT.md that this
                  button has nothing to do with. */}
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={clear}>
                Clear cache
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Section>
  );
}
