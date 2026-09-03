import { PageBar } from "@/components/PageBar";
// Both fields below are the one Written path field module, which resolves the
// typed string through the same hook the rejecting bars read the stored
// destination with — so "is this path relative" has one answer and one
// `expand_path` call behind it (ADR 0018, ADR 0026).
import {
  PathFieldRow,
  usePathField,
  type PathLineTone,
} from "@/components/PathField";
import {
  NoticeBlock,
  UnreadableLibraryBlock,
} from "@/components/SettingsNotices";
import { ThumbnailsSection } from "@/components/ThumbnailsSection";
import { useToaster } from "@/components/ToastSurface";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApp, type View } from "@/context/AppContext";
import {
  client,
  isAppError,
  type ScanProgress,
  type Theme,
} from "@/lib/client";
// The counts in the Library root's line are the counts the shell's report
// prints, written once so that one fact keeps one phrasing (ADR 0021).
import { counted, grouped } from "@/lib/copy";
import { useBackendEvents } from "@/lib/useBackendEvents";
import { isAbsolute } from "@/lib/useExpansion";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode, type Ref } from "react";

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
 * `ref` is here for the one thing a section is addressed by from outside: a
 * navigation that names a field scrolls the section holding it into view, and
 * the heading is the top of what has to be on screen for the field below it to
 * make sense (ADR 0020).
 */
export function Section({
  heading,
  children,
  ref,
}: {
  heading: string;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} data-slot="settings-section" className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">{heading}</h2>
      {children}
    </section>
  );
}

/**
 * The sentence for a `start_scan` that never got going, when the backend's own
 * message is not one.
 *
 * `InvalidPath` carries a bare path (`lib.rs:164`) rather than a sentence, so
 * there is a frontend string for it; `InvalidPathSyntax` carries copy that names
 * the variable the curator mistyped, so that one is rendered verbatim and has no
 * string here. That is the boundary ADR 0011 drew and ADR 0020 kept: the kind
 * with copy in it gets rendered, the kind with a path in it gets a sentence.
 *
 * `InvalidTransition` has no string either, and for the opposite reason. It can
 * only mean a scan is already running, which is what the button says by being
 * disabled while one is — so if it ever reaches here at all, something the page
 * did not expect happened and the fallback below is the honest answer.
 */
const INVALID_PATH_ERROR = "That directory doesn't exist or can't be read.";
const SCAN_FAILED_ERROR = "Failed to scan directory. Please check the path.";

function scanStartError(err: unknown): string {
  if (!isAppError(err)) return SCAN_FAILED_ERROR;
  switch (err.kind) {
    case "invalid_path":
      return INVALID_PATH_ERROR;
    case "invalid_path_syntax":
      return err.message;
    default:
      return SCAN_FAILED_ERROR;
  }
}

/**
 * The Library root section: the field, Browse, one status line, the count, and
 * the button that starts a scan.
 *
 * This is the section a first run is entirely about, and the one that replaced
 * `ScanView`. What came across from that file is its input, its button, its
 * progress line and two of its four error strings; what did not is its hero
 * layout, which was for a screen that no longer exists (ADR 0020).
 */
function LibraryRootSection() {
  const { libraryTotal } = useApp();
  const { scanStarted } = useToaster();

  // A Scan that never got going, on the status line until the value changes.
  // Not a toast: ADR 0020 put it here because the field is where the fix is
  // typed, and an error the curator reads before clicking beats one that
  // arrives after.
  const [scanError, setScanError] = useState<string | null>(null);
  // Typing is not committing, and the value moving is what clears a stale Scan
  // error off the line: the sentence was about a path that is no longer in the
  // field. A Browse pick clears it for the same reason, which is why this is the
  // field's `onEdit` rather than the input's `onChange` (ADR 0020, ADR 0026).
  const path = usePathField("library_root", {
    onEdit: () => setScanError(null),
  });
  const { value, commit, expansion } = path;

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  // The button's own progress line, and the two endings that free it.
  //
  // What the endings *say* is not read here. ADR 0021 gives every word about how
  // a scan finished to the toast, which can name the folder as the curator wrote
  // it and reach them on whatever page they wandered to during a walk that takes
  // minutes. What is left to this section is a button that has a scan to stop
  // presenting as running.
  const finished = () => {
    setScanning(false);
    setProgress(null);
  };

  useBackendEvents({
    scanProgress: setProgress,
    scanComplete: finished,
    scanFailed: finished,
  });

  const scan = () => {
    if (!value || scanning) return;
    setScanning(true);
    setScanError(null);
    setProgress(null);

    void (async () => {
      try {
        // The order ADR 0010 fixed and ADR 0020 repeats: the store learns the
        // folder, then the walk starts on the same string, unexpanded, because
        // the backend is what expands a Written path and storing one expanded
        // would freeze what a variable meant this session (ADR 0011).
        await commit(value);
        await client.startScan(value);
        // The walk emits nothing until it is over, so the report of a scan in
        // progress can only start from the call that asked for one — and the
        // folder as the curator wrote it is knowable nowhere else either
        // (ADR 0021).
        scanStarted(value);
      } catch (error) {
        setScanning(false);
        setProgress(null);
        setScanError(scanStartError(error));
        console.error("Failed to start a scan:", error);
      }
    })();
  };

  /**
   * The one status line, and the one thing it says.
   *
   * In precedence order, which is the order the four candidates for the space
   * became true in: an empty field says nothing at all, because the first-run
   * block above is already saying it in full sentences; a failed Scan is the
   * newest news there is about this string; a syntax error replaces the line
   * because there is no resolved path to show; otherwise the line is where the
   * path points, with the not-found clause appended.
   *
   * Not-found is deliberately not destructive-coloured. The Library root is a
   * stated preference that may point somewhere that no longer exists
   * (CONTEXT.md), and the usual cause is an unmounted drive rather than a
   * mistake.
   */
  const status = ((): { tone: PathLineTone; text: string } | null => {
    if (!value) return null;
    if (scanError) return { tone: "error", text: scanError };
    if (expansion?.kind === "invalid") {
      return { tone: "error", text: expansion.message };
    }
    if (expansion?.kind === "expanded") {
      const { resolved, exists } = expansion.expanded;
      return {
        tone: "path",
        text: exists ? resolved : `${resolved} · folder not found`,
      };
    }
    return null;
  })();

  const scanLabel = () => {
    if (!scanning) return libraryTotal ? "Rescan" : "Scan";
    if (!progress) return "Scanning…";
    return `Scanning… ${grouped(progress.scanned)} scanned, ${grouped(progress.added)} added`;
  };

  return (
    <Section heading="Library root" ref={path.section}>
      {/* Enter scans, which is the habit the screen this section replaced
          taught, and it replaces the commit the field would otherwise do:
          `scan` awaits `commit` as its first act. The guard inside `scan` is
          what makes Enter safe while one is already running, since Enter
          reaches the handler with the button disabled (ADR 0026). */}
      <PathFieldRow
        field={path}
        label="Library root"
        placeholder="/home/user/wallpapers"
        status={status}
        onEnter={scan}
      />

      {/* A fact rather than another control, from the `Stats` boot already
          read. No last-scanned time beside it: nothing records one, and every
          row a scan adds shares a single `created_at`, so the nearest available
          number would mark the last scan that added a file rather than the last
          scan (ADR 0020). */}
      {libraryTotal !== null && (
        <p className="text-xs text-muted-foreground">
          {counted(libraryTotal, "wallpaper")} in the library
        </p>
      )}

      {/* Primary-styled, because on a first run this is the one thing to do on
          the page and ADR 0020 asks for exactly one such control there.
          Disabled while a scan runs, which is the only refusal available: no
          command cancels a scan, and a second `start_scan` would answer
          `InvalidTransition` with a sentence the curator can do nothing about. */}
      <div className="flex">
        <Button onClick={scan} disabled={scanning || !value}>
          {scanLabel()}
        </Button>
      </div>
    </Section>
  );
}

/**
 * What a relative reject destination means, which is the whole reason this line
 * exists.
 *
 * Settings cannot resolve a relative destination, because ADR 0011 resolves one
 * against each wallpaper's own folder and this page does not know which
 * wallpaper. So the line states the rule instead — and that relative means
 * "beside each wallpaper" rather than "beside the library root" is the most
 * surprising thing about this setting, which makes the field it is typed into
 * the last place to leave it unsaid (ADR 0018, ADR 0020).
 */
const RELATIVE_DESTINATION =
  "Relative, so one rejected folder beside each wallpaper.";

/**
 * The Reject destination section: the field, Browse, and one status line that
 * explains rather than resolves.
 *
 * The only place `reject_destination` can be edited. ADR 0018 took the field out
 * of Review because a control sitting under fifty cards, which may have come
 * from fifty different folders, looked like it belonged to the pass while
 * actually writing a global preference — and it is the same correction ADR 0010
 * made when it moved the Library root out of `ScanView`.
 *
 * No options on the hook and no Enter of its own: there is nothing to run here,
 * so Enter is the field's own commit (ADR 0020, ADR 0026).
 */
function RejectDestinationSection() {
  const path = usePathField("reject_destination");

  /**
   * The one status line, which explains instead of resolving (ADR 0020).
   *
   * Three answers and three lines, and nothing in the list is a not-found state.
   * A reject destination cannot fail to exist: ADR 0003 creates it on demand, so
   * `exists` is the one field of `Expanded` this section reads past — which is
   * the same reason ADR 0018 gave for leaving not-found off the two read-out
   * bars.
   *
   * A field the curator has emptied says nothing, for the want of anything to
   * resolve. ADR 0020's table has three rows and none of them is that, and a
   * fourth line invented here would be inventing a rule with it.
   */
  const status = ((): { tone: PathLineTone; text: string } | null => {
    const { expansion } = path;
    if (expansion === null) return null;
    if (expansion.kind === "invalid") {
      return { tone: "error", text: expansion.message };
    }
    const { resolved } = expansion.expanded;
    return isAbsolute(resolved)
      ? { tone: "path", text: resolved }
      : { tone: "rule", text: RELATIVE_DESTINATION };
  })();

  return (
    <Section heading="Reject destination" ref={path.section}>
      <PathFieldRow
        field={path}
        label="Reject destination"
        placeholder="./rejected"
        status={status}
      />
    </Section>
  );
}

/**
 * The three palettes, in the order they are painted across the control.
 *
 * System first because it is the default and the one that needs no decision;
 * Light and Dark after it in the order the two branches of `index.css` are
 * written. The values are `Theme`, so a label can only be attached to a palette
 * `set_setting` will take back.
 */
const THEMES: Array<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The Appearance section: three choices, exactly one of them taken.
 *
 * A radio group and not a toggle group, which is the distinction ADR 0020 drew:
 * `theme` cannot hold "none", and `ToggleGroup type="single"` deselects on a
 * second click unless that is fought and announces as a row of pressed buttons
 * rather than as "System, radio button 1 of 3". Both primitives ship in
 * `radix-ui`, so the correct one is free.
 *
 * There is nothing here to commit and no line under the control. The choice
 * writes on change rather than on blur, because a palette is one of three named
 * things and not a string being typed a character at a time (ADR 0010) — and
 * the repaint is the whole of the feedback, since choosing Dark that leaves the
 * window light is the only failure the curator could care about and they are
 * looking straight at it.
 *
 * No Reset beside it either. Writing `system` back is what deletes the row,
 * which `set_setting` already does for every key on this page, so a control for
 * it would only be explaining a rule the write path enforces (ADR 0010,
 * ADR 0020).
 */
function AppearanceSection() {
  const { settings, saveSetting } = useApp();

  return (
    <Section heading="Appearance">
      <RadioGroup
        aria-label="Appearance"
        // The stored choice, read from the app's copy of the store rather than
        // from a copy of its own. Settings is unmounted between visits, and a
        // repaint the curator can see the instant they click is exactly the
        // `set_setting` answer travelling back through `AppContext` (ADR 0015).
        value={settings.theme}
        onValueChange={(next) => {
          void saveSetting("theme", next as Theme).catch((error: unknown) => {
            console.error("Failed to store the theme:", error);
          });
        }}
      >
        {THEMES.map((theme) => (
          <RadioGroupItem key={theme.value} value={theme.value}>
            {theme.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </Section>
  );
}

/**
 * The Settings page.
 *
 * One column at `max-w-2xl` holding four sections in first-run order, a slot
 * above them for the two reasons boot has to open this page, and a bar naming
 * the way out (ADR 0020).
 *
 * Settings is the one destination the shell unmounts, so its fields start from
 * the store rather than from a copy they held across a visit — which is why the
 * write path keeps `AppContext`'s copy in step with what `set_setting` answers,
 * instead of each field remembering what it wrote (ADR 0015).
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
        <LibraryRootSection />
        <RejectDestinationSection />
        <AppearanceSection />
        <ThumbnailsSection />
      </div>
    </>
  );
}
