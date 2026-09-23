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
  AppearanceSection,
  ReviewOrderingSection,
  ReviewWorklistSection,
  StartupViewSection,
} from "@/components/ChoiceSections";
import { EvaluatedSection } from "@/components/EvaluatedSection";
import { MissingFilesSection } from "@/components/MissingFilesSection";
import {
  FirstRunBlock,
  UnreadableLibraryBlock,
} from "@/components/SettingsNotices";
import {
  MinimumResolutionSection,
  ScreenSection,
} from "@/components/ScreenSections";
import { ThumbnailsSection } from "@/components/ThumbnailsSection";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useApp, type View } from "@/context/AppContext";
import { useKeyboardHandoff } from "@/context/KeyboardHandoffContext";
import { useScanRun } from "@/context/ScanRunContext";
import { isAppError } from "@/lib/client";
// The counts in the Library root's line are the counts the shell's report
// prints, written once so that one fact keeps one phrasing (ADR 0021).
import { counted, grouped } from "@/lib/copy";
import { ArrowLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
  type Ref,
} from "react";

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
 * One of the page's sections, heading and all.
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
      <h3 className="text-sm font-medium text-foreground">{heading}</h3>
      {children}
    </section>
  );
}

/**
 * The groups the sections are gathered under, in page order. Twelve sections
 * in one flat column read as a wall; five named groups give the page something
 * to scan and the jump row something to point at. The section order is
 * ADR 0020's first-run-first, maintenance-last order, unchanged (ADR 0020, as
 * amended for #303). Wallhaven sits before Maintenance, which stays last.
 */
const GROUPS = [
  { id: "folders", title: "Folders" },
  { id: "display", title: "Display" },
  { id: "curation", title: "Curation" },
  { id: "wallhaven", title: "Wallhaven" },
  { id: "maintenance", title: "Maintenance" },
] as const;

type GroupId = (typeof GROUPS)[number]["id"];

type GroupRefs = Partial<Record<GroupId, HTMLElement | null>>;

/**
 * One group: a heading, and its sections in a bordered card divided by rules.
 *
 * `scroll-mt-14` clears the sticky jump row, which is what the group lands
 * under when the row scrolls to it.
 */
function SettingsGroup({
  id,
  groups,
  children,
}: {
  id: GroupId;
  groups: RefObject<GroupRefs>;
  children: ReactNode;
}) {
  const title = GROUPS.find((group) => group.id === id)!.title;
  const headingId = `settings-group-${id}`;
  return (
    <section
      ref={(el) => {
        groups.current[id] = el;
      }}
      aria-labelledby={headingId}
      data-slot="settings-group"
      className="scroll-mt-14 space-y-3"
    >
      <h2
        id={headingId}
        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h2>
      <div className="divide-y rounded-lg border bg-card [&>*]:p-4">
        {children}
      </div>
    </section>
  );
}

/**
 * A row of buttons to each group, stuck to the top of the view's scroll
 * container so it is still there after the first jump.
 */
function GroupNav({ groups }: { groups: RefObject<GroupRefs> }) {
  return (
    <nav
      aria-label="Settings groups"
      className="sticky top-0 z-10 -mx-4 flex flex-wrap gap-1 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur"
    >
      {GROUPS.map((group) => (
        <Button
          key={group.id}
          variant="ghost"
          size="sm"
          onClick={() =>
            groups.current[group.id]?.scrollIntoView({
              block: "start",
              behavior: "smooth",
            })
          }
        >
          {group.title}
        </Button>
      ))}
    </nav>
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
function LibraryRootSection({
  onValue,
}: {
  /**
   * Hears the field's value as it moves, typed or picked, so the Download
   * folder's line can follow a root that has not been committed yet (ADR 0051).
   */
  onValue?: (next: string) => void;
}) {
  const { libraryTotal } = useApp();
  // The run is read from above the view swap rather than held here. This is
  // the one page the shell unmounts and a walk takes minutes, so a button that
  // kept its own `scanning` came back from a tab switch offering to start a
  // scan that was still going (ADR 0015).
  const { state: run, start } = useScanRun();

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
    onEdit: (next) => {
      setScanError(null);
      onValue?.(next);
    },
  });
  const { value, commit, resolution } = path;

  // What the endings *say* is not read here either. ADR 0021 gives every word
  // about how a scan finished to the toast, which can name the folder as the
  // curator wrote it and reach them on whatever page they wandered to. What is
  // left to this section is a button that presents a scan as running for
  // exactly as long as the run says one is.
  const scanning = run.running;
  const progress = run.running ? run.progress : null;

  const scan = () => {
    if (!value || scanning) return;
    setScanError(null);
    // The field's own commit is handed over as the store, so the write the
    // scan makes is the one the field already knows about and the blur on the
    // way to this button does not make it twice (ADR 0026).
    void start(value, commit).catch((error: unknown) => {
      setScanError(scanStartError(error));
      console.error("Failed to start a scan:", error);
    });
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
    if (resolution?.kind === "invalid") {
      return { tone: "error", text: resolution.message };
    }
    if (resolution?.kind === "expanded") {
      const { resolved, exists } = resolution.expanded;
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
 * What a destination that is not there yet means, which is not a problem.
 *
 * ADR 0003 creates the destination on the first reject, so a folder that is
 * absent is a folder that is about to exist — the reason this field had no
 * not-found state for as long as `exists` was all it knew. What it could not say
 * before is the case this clause is beside: a folder that *is* there and will
 * not take a file, which is an error and reads as one (ADR 0035).
 */
const DESTINATION_ABSENT = "created on the first reject";

/**
 * The Reject destination section: the field, Browse, and one status line that
 * explains a rule it cannot resolve and reports a folder that will not take a
 * file.
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
   * The one status line, which explains where it cannot resolve and reports
   * where it can (ADR 0020, as amended by ADR 0035).
   *
   * Five answers now. A malformed path replaces the line with the backend's own
   * words, because there is no destination to describe. A relative destination
   * states the rule, since it resolves per wallpaper and this page does not know
   * which wallpaper. An absolute one that takes a file is a place, and prints as
   * one. An absolute one that is not there yet prints as a place with a clause,
   * because the first reject creates it (ADR 0003) — the one thing this field
   * still does not treat as an error. And an absolute one that is there and will
   * not take a file is the case this ticket exists for: the backend's sentence,
   * in the destructive colour, before a file moves rather than after.
   *
   * A field the curator has emptied says nothing, for the want of anything to
   * resolve.
   */
  const status = ((): { tone: PathLineTone; text: string } | null => {
    const { resolution } = path;
    if (resolution === null) return null;
    if (resolution.kind === "invalid") {
      return { tone: "error", text: resolution.message };
    }
    if (resolution.kind !== "checked") return null;
    switch (resolution.check.state) {
      case "relative":
        return { tone: "rule", text: RELATIVE_DESTINATION };
      case "ready":
        return { tone: "path", text: resolution.check.resolved };
      case "absent":
        return {
          tone: "path",
          text: `${resolution.check.resolved} · ${DESTINATION_ABSENT}`,
        };
      case "refused":
        // The backend's sentence verbatim, for the reason the syntax error is
        // rendered verbatim: it names the folder and what refused it, and no
        // canned string here could say which of a permission, a read-only mount
        // and a file in the way it was (ADR 0035).
        return { tone: "error", text: resolution.check.reason };
    }
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
 * What a Download folder that is not there yet means, which is not a problem:
 * the first download creates it (ADR 0051), the way the first reject creates a
 * destination.
 */
const DOWNLOAD_FOLDER_ABSENT = "created on the first download";

/**
 * Why an empty Download folder is refused. The same sentence as
 * `download_folder::empty` in the backend, which a download refuses with.
 */
const EMPTY_DOWNLOAD_FOLDER =
  "The download folder is empty; name a folder, such as wallhaven";

/**
 * The Download folder section: the field, Browse, and one status line that
 * follows the Library root field above it as that field is typed.
 *
 * A relative Download folder means the Library root as it stands at each
 * download, so the line is about the two strings together, and it has six
 * answers (ADR 0051). A malformed path replaces the line with the backend's own
 * words. No root set and a root that is not there are the backend's sentences
 * too, in the rule tone rather than the error one: neither is a mistake in this
 * field, and a root on an unplugged drive is not destructive-coloured in its own
 * field either. Ready is the resolved place, absent is the place with the
 * clause saying the first download creates it, and a folder that is there and
 * will not take a file is the backend's sentence as an error, as the reject
 * destination's is (ADR 0035).
 *
 * An emptied field is refused, unlike the other two, because empty would mean
 * the Library root itself.
 */
function DownloadFolderSection({ libraryRoot }: { libraryRoot: string }) {
  const path = usePathField("download_folder", { libraryRoot });

  const status = ((): { tone: PathLineTone; text: string } | null => {
    // Unlike the other two fields, an emptied one is not silence: an empty
    // Download folder would mean the Library root itself, so downloads would
    // land loose among the curator's wallpapers, and the backend refuses it.
    // An empty string is also the one value the resolution hooks never ask
    // about, so the refusal is said here, in the backend's words.
    if (path.value === "") return { tone: "error", text: EMPTY_DOWNLOAD_FOLDER };
    const { resolution } = path;
    if (resolution === null) return null;
    if (resolution.kind === "invalid") {
      return { tone: "error", text: resolution.message };
    }
    if (resolution.kind !== "download") return null;
    const check = resolution.check;
    switch (check.state) {
      case "no_root":
      case "root_missing":
        return { tone: "rule", text: check.reason };
      case "ready":
        return { tone: "path", text: check.resolved };
      case "absent":
        return {
          tone: "path",
          text: `${check.resolved} · ${DOWNLOAD_FOLDER_ABSENT}`,
        };
      case "refused":
        return { tone: "error", text: check.reason };
    }
  })();

  return (
    <Section heading="Download folder" ref={path.section}>
      <PathFieldRow
        field={path}
        label="Download folder"
        placeholder="wallhaven"
        status={status}
      />
    </Section>
  );
}

/**
 * The Settings page.
 *
 * One column at `max-w-2xl` holding twelve sections in five groups, in first-run order, a slot
 * above them for the two reasons boot has to open this page, and a bar naming
 * the way out (ADR 0020, ADR 0032).
 *
 * On the two boot landings that slot is the page rather than a block above it:
 * the invitation, or the fault, with the Library root section under it and the
 * rest withheld until there is a library for them to be about (ADR 0033).
 *
 * Settings is the one destination the shell unmounts, so its fields start from
 * the store rather than from a copy they held across a visit — which is why the
 * write path keeps `AppContext`'s copy in step with what `set_setting` answers,
 * instead of each field remembering what it wrote (ADR 0015).
 */
export function SettingsView() {
  const { bootNotice, returnTo, setView, settings } = useApp();
  // The Library root as its field has it typed, which the Download folder's
  // line resolves against. Held here because the two fields are in different
  // groups; it starts from the store, as the field does (ADR 0051).
  const [typedRoot, setTypedRoot] = useState(settings.library_root);
  // And it follows the store when the store moves, which is a commit: the
  // Library root section remounts when a landing becomes the ordinary page, and
  // its field starts again from the store, so this has to as well. Adjusted
  // during render rather than in an effect, so the line never paints a frame
  // against the old root.
  const [seededFrom, setSeededFrom] = useState(settings.library_root);
  if (seededFrom !== settings.library_root) {
    setSeededFrom(settings.library_root);
    setTypedRoot(settings.library_root);
  }
  const handOff = useKeyboardHandoff();

  // Every way out lands the keyboard on the page it goes back to, whatever
  // pressed it: the control that did it is unmounted with this page, so the
  // focus has nowhere of its own to stay.
  const goBack = useCallback(
    (to: View) => {
      setView(to);
      handOff();
    },
    [handOff, setView],
  );

  /**
   * Whether boot opened this page because there was nothing else to show, which
   * is the whole of what makes it a landing rather than Settings.
   *
   * Both rows of ADR 0015's boot table that come here are read off one notice —
   * an empty library and a library that would not read — because what the
   * withheld sections have in common is that neither curator has a library for
   * them to be about. A reject destination, a screen to hang wallpapers on, a
   * thumbnail cache and a count of missing files are all questions about
   * wallpapers the app either has not found yet or cannot see (ADR 0033).
   *
   * It is the notice and not `libraryTotal === 0`, so the page stops being a
   * landing on exactly the two occasions the landing is over: the boot rule's
   * rerun moves the curator off it once a scan fills the library, and a Retry
   * that reads retires the fault. A curator who came back through the gear is
   * not on a first run any more and gets the ordinary page, which is the rule
   * `AppContext` already keeps the notice on the navigation record for.
   */
  const landing = bootNotice !== null;

  const groups = useRef<GroupRefs>({});

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
      goBack(returnTo);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goBack, returnTo]);

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
            variant="outline"
            size="sm"
            className="ml-auto"
            aria-keyshortcuts="Escape"
            onClick={() => goBack(returnTo)}
          >
            <ArrowLeft aria-hidden />
            Back to {RETURN_LABEL[returnTo]}
            {/* Two of the three ways out are invisible — Escape, and the gear
                that toggles back — so the one control that is visible says which
                key does the same thing. There is no Done beside it, because a
                button that only navigates would look like the Save this page
                does not have (ADR 0020). */}
            <Kbd aria-hidden>Esc</Kbd>
          </Button>
        )}
      </PageBar>

      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
        {/* The slot, above the sections and in one place. The two rows of
            ADR 0015's boot table that land here are a first run and a library
            that would not read; they are different problems, and telling the
            second one it has never scanned is the bug this shape exists to
            prevent. Otherwise the slot is absent (ADR 0020). */}
        {bootNotice?.kind === "first_run" && <FirstRunBlock />}
        {bootNotice?.kind === "unreadable_library" && (
          <UnreadableLibraryBlock message={bootNotice.message} />
        )}

        {/* First-run need first, maintenance last, and the order never changes:
            the Library root is first on both the landing and the ordinary page,
            so nothing the curator learned where the field was moves once they
            have a library (ADR 0020, ADR 0032). */}
        {/* On a landing the Library root is the only section, but it still
            sits in its group so the heading levels do not skip from the page
            title to the section's (ADR 0033). */}
        {landing ? (
          <SettingsGroup id="folders" groups={groups}>
            <LibraryRootSection onValue={setTypedRoot} />
          </SettingsGroup>
        ) : (
          <>
            <GroupNav groups={groups} />
            <SettingsGroup id="folders" groups={groups}>
              <LibraryRootSection onValue={setTypedRoot} />
              <RejectDestinationSection />
            </SettingsGroup>
            {/* The two sizes sit with Appearance because they are the same
                kind of thing: what the app looks like and what it is being
                curated for. Screen first, because Minimum resolution's default
                is it (ADR 0020, ADR 0032). */}
            <SettingsGroup id="display" groups={groups}>
              <AppearanceSection />
              <ScreenSection />
              <MinimumResolutionSection />
            </SettingsGroup>
            {/* How the app runs a curation: how sure a ranking has to be before
                it says Evaluated (ADR 0046), which page opens, and what Review
                hands the curator (#259). */}
            <SettingsGroup id="curation" groups={groups}>
              <EvaluatedSection />
              <StartupViewSection />
              <ReviewWorklistSection />
              <ReviewOrderingSection />
            </SettingsGroup>
            {/* Where Discover's downloads land, before any exists. The API key
                section joins it with #342. */}
            <SettingsGroup id="wallhaven" groups={groups}>
              <DownloadFolderSection libraryRoot={typedRoot} />
            </SettingsGroup>
            {/* Maintenance last: questions nobody asks until something looks
                wrong (ADR 0020, ADR 0032). */}
            <SettingsGroup id="maintenance" groups={groups}>
              <ThumbnailsSection />
              <MissingFilesSection />
            </SettingsGroup>
          </>
        )}
      </div>
    </>
  );
}
