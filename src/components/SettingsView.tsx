import { PageBar } from "@/components/PageBar";
import { ScanView } from "@/components/ScanView";
import { Button } from "@/components/ui/button";
import { useApp, type View } from "@/context/AppContext";
import { client, isAppError } from "@/lib/client";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * What the back control calls the view it goes back to.
 *
 * The shell's tab labels say the same three words and are not exported on
 * purpose: a tab's label names a destination in a row of them, and this names
 * one inside a sentence. `settings` is in the map because `returnTo` is a `View`
 * and the type has four of them, not because anything opens Settings from
 * Settings.
 */
const RETURN_LABEL: Record<View, string> = {
  rank: "Rank",
  review: "Review",
  library: "Library",
  settings: "Settings",
};

/**
 * One of the four sections, heading and all.
 *
 * They are empty here, and each is filled by a ticket of its own: #117 the
 * Library root, #118 the Reject destination, #119 Appearance, #120 Thumbnails.
 * What this file owns is the frame those four land in — the column, the bar, the
 * way out, and the slot above them — so that each of them is written against a
 * page that already exists rather than against half of one.
 */
function Section({
  heading,
  children,
}: {
  heading: string;
  children?: ReactNode;
}) {
  return (
    <section data-slot="settings-section" className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">{heading}</h2>
      {children}
    </section>
  );
}

/** The shell both top-slot blocks are cut from, so the two read as one slot. */
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
 * The failed-boot state of the top slot: ADR 0017's title and detail, and the
 * one button on the page that can make the fault go away.
 *
 * Retry re-reads what boot read and nothing else. The fault is outside the app —
 * a lock another process is holding, a permission, a disk that came back — so a
 * read that now succeeds is the whole of the fix, and the four sections below
 * read the store for themselves as the curator uses them.
 */
function UnreadableLibraryBlock({ message }: { message: string }) {
  // The message on screen, which starts as the one boot failed with and becomes
  // whatever a Retry failed with. Leaving the first sentence up after a second,
  // different failure is the block lying about which fault is being looked at.
  const [detail, setDetail] = useState(message);
  const [cleared, setCleared] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await client.getStats();
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

/**
 * The Settings page.
 *
 * One column at `max-w-2xl` holding four sections in first-run order, a slot
 * above them for the two reasons boot has to open this page, and a bar naming
 * the way out. What goes inside the four sections is four tickets of their own
 * (ADR 0020).
 *
 * Settings is the one destination the shell unmounts, so its fields re-read the
 * store on arrival rather than holding a stale copy of it (ADR 0015).
 */
export function SettingsView() {
  const { bootNotice, returnTo, setView } = useApp();

  // Escape, and what it does not do: it reverts nothing. There is no Save to
  // undo and no dirty state to lose, because each field writes on blur and the
  // blur has already happened by the time anything closes this page (ADR 0010,
  // ADR 0020).
  //
  // With no `returnTo` — boot landed the curator here — there is nowhere to go
  // back to, so nothing is bound at all and the key does nothing. The tabs are
  // the way out of a first run, and the back control below is absent for the
  // same reason.
  useEffect(() => {
    if (!returnTo) return;

    // Escape is the page's own binding rather than one more entry in the shell's
    // handler, which stands down while the caret is in a text field. This page
    // is mostly text fields, so putting Escape up there would have broken the
    // one route out that has to work from inside one: the curator finishes
    // typing a path and presses Escape (ADR 0020).
    //
    // On `window` and not on the column below, because Escape has to answer when
    // nothing on the page has focus — which is exactly how boot leaves it. That
    // costs no view gate: Settings is the one destination the shell unmounts, so
    // this listener lives exactly as long as the page is showing, unlike Rank's
    // vote listener, which stays mounted under `display: none` and needs the
    // gate ADR 0019 owes it.
    //
    // `defaultPrevented` is the stand-down, the same one Rank's arrows use.
    // Radix dismisses a layer from a capture-phase listener on the document and
    // marks the event, so an Escape that closed the shortcuts dialog does not
    // also close the page out from under the curator who opened it.
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setView(returnTo);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [returnTo, setView]);

  return (
    <>
      <PageBar>
        {/* The page's own heading, in the bar that carries it. The chrome names
            the other three destinations with a tab and names this one with a
            gear, so Settings is the one view whose title has to be written out
            (ADR 0015). */}
        <h1 className="font-medium">Settings</h1>

        {returnTo && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setView(returnTo)}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to {RETURN_LABEL[returnTo]}
            {/* Two of the three ways out are invisible — Escape, and the gear
                that toggles back — so the one control that is visible says which
                key does the same thing. There is no Done beside it, because a
                button that only navigates would look like the Save this page
                does not have (ADR 0020). */}
            <span className="text-muted-foreground">· Esc</span>
          </Button>
        )}
      </PageBar>

      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
        {/* The slot, above the sections and in one place. Nothing in it is ever
            hidden or reordered between its three states: the two rows of
            ADR 0015's boot table that land here are a first run and a library
            that would not read, they are different problems, and telling the
            second one it has never scanned is the bug this shape exists to
            prevent. Otherwise the slot is absent (ADR 0020). */}
        {bootNotice?.kind === "first_run" && (
          <NoticeBlock tone="muted" heading="No wallpapers yet">
            <p className="text-sm text-muted-foreground">
              Choose a library root and scan it to start ranking.
            </p>
          </NoticeBlock>
        )}
        {bootNotice?.kind === "unreadable_library" && (
          <UnreadableLibraryBlock message={bootNotice.message} />
        )}

        {/* First-run need first, maintenance last, and the order does not change
            with what the library holds: a page that grows sections after a scan
            is what ADR 0020 refused. */}
        <Section heading="Library root" />
        <Section heading="Reject destination" />
        <Section heading="Appearance" />
        <Section heading="Thumbnails" />
      </div>

      {/* The interim scan screen, still hosted below the frame. Folding scan into
          Settings is what deleted `scan` from the view union, so until #117
          builds the Library root section this is the only way to fill an empty
          library at all. That ticket deletes the file rather than emptying it. */}
      <ScanView />
    </>
  );
}
