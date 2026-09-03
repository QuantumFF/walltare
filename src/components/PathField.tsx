import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { client } from "@/lib/client";
// The field resolves the string the curator has *typed*, which moves per
// keystroke and does not reach the store until blur. That is a different string
// from the stored one `useRejectDestination` resolves, and the same hook and the
// same `expand_path` answer serve both (ADR 0018, ADR 0026).
import { useExpansion, type Expansion } from "@/lib/useExpansion";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The two settings that hold a Written path, which is the two fields on Settings. */
export type PathSetting = "library_root" | "reject_destination";

/**
 * What each setting is called in a sentence, which is the one thing about the
 * two fields that has to differ inside this module.
 *
 * A commit that fails says which path it failed to store, so the message is
 * written once and the key picks the name — rather than the same sentence twice
 * with two words swapped, which is where it was before (ADR 0026).
 */
const SETTING_NAME: Record<PathSetting, string> = {
  library_root: "library root",
  reject_destination: "reject destination",
};

/** The `data-slot` on the line under each field, likewise off the key. */
const STATUS_SLOT: Record<PathSetting, string> = {
  library_root: "library-root-status",
  reject_destination: "reject-destination-status",
};

/**
 * Which of the three tones the line under a path field is in.
 *
 * ADR 0020 gave the two fields different tables — the Library root has four
 * candidates for one line, the Reject destination three rows — and the classes
 * those two tables resolve to are one vocabulary of three. That is what makes
 * the line shareable while the sentences stay with the sections (ADR 0026).
 */
export type PathLineTone = "path" | "rule" | "error";

const PATH_LINE_CLASS: Record<PathLineTone, string> = {
  // A place: where the string resolves to, in muted mono because that is what a
  // path looks like.
  path: "font-mono text-xs break-all text-muted-foreground",
  // A rule rather than a place, so it reads as the sentence it is and not as
  // something that could be pasted into a shell.
  rule: "text-xs text-muted-foreground",
  // A failed Scan, or the one error kind rendered verbatim: it names the
  // variable the curator mistyped, and reading `unknown environment variable
  // HOEM` here beats learning it from fifty identical failed rejects
  // (ADR 0011, ADR 0018).
  error: "text-xs text-destructive",
};

/**
 * Everything the two Written path fields on Settings are alike in: the string as
 * the curator has it typed, what the backend says it resolves to, the pair of
 * refs a navigation naming this field addresses it by, and the three handlers
 * the row wires up.
 *
 * One object rather than six loose values, for the reason `RejectDestination`
 * has the same shape: consumers cannot end up looking at two different answers
 * about one string (ADR 0026).
 *
 * What is *not* here is the sentence under the field. The Library root reports a
 * place and can say nothing is there, the Reject destination explains a rule and
 * never can (ADR 0020), so each section works out its own line and hands it back
 * as a tone and a text.
 */
export interface PathField {
  /** Which setting this is, which is what picks the prose and the slot. */
  setting: PathSetting;
  /**
   * The Written path as the curator has it typed, which is not the same thing as
   * the stored one: it moves per keystroke and the store hears about it on blur
   * (ADR 0010).
   */
  value: string;
  /** What `expand_path` says about it; `null` for an empty field or an answer in flight. */
  expansion: Expansion | null;
  field: RefObject<HTMLInputElement | null>;
  section: RefObject<HTMLElement | null>;
  /** Store the Written path, if the store does not already hold it. */
  commit: (next: string) => Promise<void>;
  /** The row's `onChange`: typing is not committing. */
  edit: (next: string) => void;
  /** The Browse button: pick a folder, and store it without waiting for a blur. */
  browse: () => void;
  /** The row's `onBlur`, and its Enter unless the caller replaces it. */
  commitFromBlur: () => void;
}

/**
 * Hold one Written path setting as a field: the typed string, its resolution,
 * and the writes.
 *
 * `options.onEdit` fires on typing and on a Browse pick, which are the two ways
 * the value moves without a commit behind it. The Library root clears its Scan
 * error there — a freshly picked folder makes a stale Scan error just as untrue
 * as a keystroke does — and the Reject destination passes no options at all
 * (ADR 0026).
 */
export function usePathField(
  key: PathSetting,
  options?: { onEdit?: (next: string) => void },
): PathField {
  const { settings, saveSetting, focus } = useApp();
  const onEdit = options?.onEdit;

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

  const edit = (next: string) => {
    setValue(next);
    onEdit?.(next);
  };

  const commitFromBlur = () => {
    void commit(value).catch((error: unknown) => {
      console.error(`Failed to store the ${SETTING_NAME[key]}:`, error);
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
      // as deliberate as the blur ADR 0010 writes on. The picker answers with an
      // absolute path, so a destination that was a rule is now a place, and the
      // line under the field changes shape with it.
      await commit(picked);
    })().catch((error: unknown) => {
      console.error("Failed to store the picked folder:", error);
    });
  };

  return {
    setting: key,
    value,
    expansion,
    field,
    section,
    commit,
    edit,
    browse,
    commitFromBlur,
  };
}

/**
 * A Written path field, the Browse button beside it, and the shell of the line
 * underneath.
 *
 * The sentence is the caller's and the shell is this module's: it owns the
 * three-tone class map, the `<p>`, and the `data-slot` it derives from the key.
 * `useExpansion` already draws that line in its own note — it returns an answer,
 * and what to write on the line is the caller's (ADR 0026).
 *
 * The one control only one field has, the Library root's Scan, is a sibling
 * rendered underneath rather than a slot in here: the order inside `Section` is
 * already field row, status line, count line, button.
 */
export function PathFieldRow({
  field,
  label,
  placeholder,
  status,
  onEnter,
}: {
  field: PathField;
  label: string;
  placeholder: string;
  status: { tone: PathLineTone; text: string } | null;
  /**
   * What Enter does instead of committing.
   *
   * It *replaces* the default rather than running before it. `LibraryRootSection`
   * passes `scan`, which already awaits `commit(value)` as its first act, so
   * running both would write one string twice per Enter — harmless today only
   * because `commit` no-ops on a string the store already holds, and a double
   * write surviving on a guard rather than on intent is the kind of thing that
   * stops being harmless quietly (ADR 0026).
   */
  onEnter?: () => void;
}) {
  return (
    <>
      <div className="flex gap-2">
        <Input
          ref={field.field}
          aria-label={label}
          placeholder={placeholder}
          value={field.value}
          onChange={(event) => field.edit(event.target.value)}
          // On blur and never on keystroke, so a path is not stored one
          // character at a time (ADR 0010). It does not scan: a blur happens on
          // the way to the Browse button beside it, and a scan walks a
          // filesystem.
          onBlur={field.commitFromBlur}
          // Enter commits, which is all there is to do in a field that writes on
          // blur — "Enter in the Reject destination field only commits, because
          // there is nothing there to run" (ADR 0020). The Library root has
          // something to run and says so with `onEnter`.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (onEnter) onEnter();
            else field.commitFromBlur();
          }}
        />
        <Button variant="outline" onClick={field.browse}>
          <FolderOpen aria-hidden />
          Browse
        </Button>
      </div>

      {status && (
        <p
          data-slot={STATUS_SLOT[field.setting]}
          className={PATH_LINE_CLASS[status.tone]}
        >
          {status.text}
        </p>
      )}
    </>
  );
}
