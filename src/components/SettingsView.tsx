import { PageBar } from "@/components/PageBar";
import { useToaster } from "@/components/ToastSurface";
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
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApp, type View } from "@/context/AppContext";
import {
  client,
  isAppError,
  type CacheSize,
  type PregenProgress,
  type ScanProgress,
  type Theme,
} from "@/lib/client";
// The counts in the Thumbnails line are the counts the shell's report prints,
// written once so that one fact keeps one phrasing (ADR 0021).
import { bytes, counted, grouped } from "@/lib/copy";
// Both fields below resolve their string through the same hook the rejecting
// bars read the destination with, so "is this path relative" has one answer and
// one `expand_path` call behind it (ADR 0018).
import { useBackendEvents } from "@/lib/useBackendEvents";
import { isAbsolute, useExpansion } from "@/lib/useExpansion";
import { ArrowLeft, FolderOpen } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
 * One of the four sections, heading and all.
 *
 * `ref` is here for the one thing a section is addressed by from outside: a
 * navigation that names a field scrolls the section holding it into view, and
 * the heading is the top of what has to be on screen for the field below it to
 * make sense (ADR 0020).
 */
function Section({
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

/** The two settings that hold a Written path, which is the two fields below. */
type PathSetting = "library_root" | "reject_destination";

/**
 * Everything the two Written path fields on this page are alike in: the string
 * as the curator has it typed, the one write that stores it, what the backend
 * says it resolves to, and the pair of refs a navigation naming this field
 * addresses it by.
 *
 * They are alike in more than they differ. What differs is the line underneath —
 * the Library root reports a place and can say nothing is there, the Reject
 * destination explains a rule and never can (ADR 0020) — and the button only one
 * of them has, so both of those stay with the sections.
 */
function usePathField(key: PathSetting) {
  const { settings, saveSetting, focus } = useApp();

  // The Written path as the curator has it typed, which is not the same thing
  // as the stored one: it moves per keystroke and the store hears about it on
  // blur (ADR 0010).
  const [value, setValue] = useState(settings[key]);

  // What the store was last told, so that a blur on the way to a button does
  // not write a string the store already holds, and so a click that follows
  // that blur does not write it a second time.
  const committed = useRef(settings[key]);
  const field = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);

  const expansion = useExpansion(value);

  // Focus, and the scroll that makes focusing mean anything on a page four
  // sections long. The text is deliberately not selected: these fields write on
  // blur, and a selected value is one keystroke from being an empty setting that
  // the next blur stores (ADR 0020).
  useEffect(() => {
    if (focus !== key) return;
    field.current?.focus();
    section.current?.scrollIntoView({ block: "nearest" });
  }, [focus, key]);

  /**
   * Store the Written path, if the store does not already hold it.
   *
   * Recorded before the write lands rather than after, because a Scan click
   * arrives on the heels of the blur that fires on the way to it, and otherwise
   * the store would hear the same string twice for one scan. A write that fails
   * puts the record back, so the next commit tries again rather than assuming it
   * took.
   */
  const commit = useCallback(
    async (next: string) => {
      if (next === committed.current) return;
      const previous = committed.current;
      committed.current = next;
      try {
        await saveSetting(key, next);
      } catch (error) {
        committed.current = previous;
        throw error;
      }
    },
    [key, saveSetting],
  );

  return { value, setValue, commit, expansion, field, section };
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

  const { value, setValue, commit, expansion, field, section } =
    usePathField("library_root");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  // A Scan that never got going, on the status line until the value changes.
  // Not a toast: ADR 0020 put it here because the field is where the fix is
  // typed, and an error the curator reads before clicking beats one that
  // arrives after.
  const [scanError, setScanError] = useState<string | null>(null);

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

  // Typing is not committing, and the value moving is what clears a stale Scan
  // error off the line: the sentence was about a path that is no longer in the
  // field (ADR 0020).
  const edit = (next: string) => {
    setValue(next);
    setScanError(null);
  };

  const commitFromBlur = () => {
    void commit(value).catch((error: unknown) => {
      console.error("Failed to store the library root:", error);
    });
  };

  const browse = () => {
    void (async () => {
      const picked = await client.pickFolder();
      // A dismissal is an answer rather than a failure, and the answer is that
      // the field keeps what it had.
      if (picked === null) return;
      edit(picked);
      // Committed here rather than left to a blur, because the field has
      // already lost focus to this button and will not blur again: the pick is
      // as deliberate as the blur ADR 0010 writes on.
      await commit(picked);
    })().catch((error: unknown) => {
      console.error("Failed to store the picked folder:", error);
    });
  };

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
  const status = ((): { destructive: boolean; text: string } | null => {
    if (!value) return null;
    if (scanError) return { destructive: true, text: scanError };
    if (expansion?.kind === "invalid") {
      return { destructive: true, text: expansion.message };
    }
    if (expansion?.kind === "expanded") {
      const { resolved, exists } = expansion.expanded;
      return {
        destructive: false,
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
    <Section heading="Library root" ref={section}>
      <div className="flex gap-2">
        <Input
          ref={field}
          aria-label="Library root"
          placeholder="/home/user/wallpapers"
          value={value}
          onChange={(event) => edit(event.target.value)}
          // On blur and never on keystroke, so a path is not stored one
          // character at a time (ADR 0010). It does not scan: a blur happens on
          // the way to the Browse button beside it, and a scan walks a
          // filesystem.
          onBlur={commitFromBlur}
          // Enter scans, which is the habit the screen this section replaced
          // taught. The guard inside `scan` is what makes that safe while one is
          // already running, since Enter reaches the handler with the button
          // disabled.
          onKeyDown={(event) => {
            if (event.key === "Enter") scan();
          }}
        />
        <Button variant="outline" onClick={browse}>
          <FolderOpen aria-hidden />
          Browse
        </Button>
      </div>

      {status && (
        <p
          data-slot="library-root-status"
          className={
            status.destructive
              ? "text-xs text-destructive"
              : "font-mono text-xs break-all text-muted-foreground"
          }
        >
          {status.text}
        </p>
      )}

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

/** Which of ADR 0020's three rows the Reject destination's line is showing. */
type DestinationLine = "path" | "rule" | "error";

const DESTINATION_LINE_CLASS: Record<DestinationLine, string> = {
  // A place, in the same muted mono the Library root's resolved path is in,
  // because it is the same kind of answer.
  path: "font-mono text-xs break-all text-muted-foreground",
  // A rule rather than a place, so it reads as the sentence it is and not as
  // something that could be pasted into a shell.
  rule: "text-xs text-muted-foreground",
  // The one error kind rendered verbatim: it names the variable the curator
  // mistyped, and reading `unknown environment variable HOEM` here beats
  // learning it from fifty identical failed rejects (ADR 0011, ADR 0018).
  error: "text-xs text-destructive",
};

/**
 * The Reject destination section: the field, Browse, and one status line that
 * explains rather than resolves.
 *
 * The only place `reject_destination` can be edited. ADR 0018 took the field out
 * of Review because a control sitting under fifty cards, which may have come
 * from fifty different folders, looked like it belonged to the pass while
 * actually writing a global preference — and it is the same correction ADR 0010
 * made when it moved the Library root out of `ScanView`.
 */
function RejectDestinationSection() {
  const { value, setValue, commit, expansion, field, section } =
    usePathField("reject_destination");

  const store = (next: string) => {
    void commit(next).catch((error: unknown) => {
      console.error("Failed to store the reject destination:", error);
    });
  };

  const browse = () => {
    void (async () => {
      const picked = await client.pickFolder();
      // A dismissal is an answer rather than a failure, and the answer is that
      // the field keeps what it had.
      if (picked === null) return;
      setValue(picked);
      // Committed here rather than left to a blur, because the field has
      // already lost focus to this button and will not blur again. The picker
      // answers with an absolute path, so a destination that was a rule is now
      // a place, and the line under the field changes shape with it.
      await commit(picked);
    })().catch((error: unknown) => {
      console.error("Failed to store the picked folder:", error);
    });
  };

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
  const status = ((): { kind: DestinationLine; text: string } | null => {
    if (expansion === null) return null;
    if (expansion.kind === "invalid") {
      return { kind: "error", text: expansion.message };
    }
    const { resolved } = expansion.expanded;
    return isAbsolute(resolved)
      ? { kind: "path", text: resolved }
      : { kind: "rule", text: RELATIVE_DESTINATION };
  })();

  return (
    <Section heading="Reject destination" ref={section}>
      <div className="flex gap-2">
        <Input
          ref={field}
          aria-label="Reject destination"
          placeholder="./rejected"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          // On blur and never on keystroke, so a path is not stored one
          // character at a time (ADR 0010).
          onBlur={() => store(value)}
          // Enter only commits. The Library root field beside this one scans on
          // Enter, and there is nothing of the sort here: a reject destination
          // is read by the next reject, on a page the curator has to leave this
          // one to reach (ADR 0020).
          onKeyDown={(event) => {
            if (event.key === "Enter") store(value);
          }}
        />
        <Button variant="outline" onClick={browse}>
          <FolderOpen aria-hidden />
          Browse
        </Button>
      </div>

      {status && (
        <p
          data-slot="reject-destination-status"
          className={DESTINATION_LINE_CLASS[status.kind]}
        >
          {status.text}
        </p>
      )}
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
function ThumbnailsSection() {
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
