/**
 * The one place a Written path is resolved for the screen.
 *
 * It sits beside `client.ts` rather than inside the page that first needed it
 * because more than one surface asks the same question of the same string. The
 * two path fields on Settings ask it to print where a path points (ADR 0020),
 * and the reject-destination read-out on the rejecting bars asks it to find out
 * whether the destination is relative, which cannot be read off the string —
 * `~/bin` and `$HOME/bin` both look relative and both expand absolute, so only
 * `expand_path` knows (ADR 0018). A second copy of the effect would be a second
 * answer to that question, memoised on its own value and firing its own call.
 *
 * A hook, so this is the one file in `src/lib` that imports React. The line the
 * directory is drawn on is that nothing here renders anything: this returns an
 * answer, and what to write on the line is the caller's, which is the whole
 * reason the two Settings fields already render different lines from it.
 */
import { client, isAppError, type Expanded } from "@/lib/client";
import { useEffect, useState } from "react";

/**
 * What `expand_path` says about the string in a path field: where it points and
 * whether a folder is there, or the syntax error that means there is no
 * resolved path at all (ADR 0011, as amended by ADR 0020).
 */
export type Expansion =
  | { kind: "expanded"; expanded: Expanded }
  | { kind: "invalid"; message: string };

/**
 * Whether a resolved Written path names a place, asked of the answer rather than
 * of the string.
 *
 * The string cannot be asked: `~/bin` and `$HOME/bin` both look relative and
 * both expand absolute, so only `expand_path` knows (ADR 0018). What comes back
 * is `PathBuf::display`, and on the one platform this app targets an absolute
 * path is exactly one with a leading `/`.
 *
 * It sits beside the hook that produces the answer because three surfaces ask
 * this same question of the same setting — the Settings line that resolves it,
 * the rejecting bars' clause and the reject toast's path line — and a second
 * copy of the rule is a second place for the three of them to disagree.
 */
export function isAbsolute(resolved: string): boolean {
  return resolved.startsWith("/");
}

/**
 * Resolve a Written path as the curator types it, once per string.
 *
 * The effect is keyed on the string and nothing else, which is what ADR 0020
 * means by memoised on the value rather than fired per paint: a caller
 * re-renders for reasons that have nothing to do with the path — Settings on
 * every `scan-progress` event and on every one of its own state changes, a
 * rejecting page on every card that changes Status — and none of that is a new
 * question to ask the backend. What is not kept is a cache of every string the
 * field has held — `exists` is a fact about the filesystem underneath, and an
 * unmounted drive coming back is exactly the case CONTEXT.md names for the
 * Library root, so the answer is re-asked when the curator re-types the path
 * rather than served from a map.
 *
 * `null` for an empty field, and for a resolution still in flight on the first
 * string. An answer that arrives after the value moved on is dropped, so the
 * line under the field can never describe a path that is no longer in it.
 *
 * The three answers are one shape and the lines drawn from them are not. The
 * Library root reports a place and can say nothing is there; the Reject
 * destination has no not-found state ever, and a relative result there is a rule
 * rather than a place.
 */
export function useExpansion(value: string): Expansion | null {
  const [expansion, setExpansion] = useState<Expansion | null>(null);

  useEffect(() => {
    if (!value) {
      setExpansion(null);
      return;
    }

    let current = true;
    void client
      .expandPath(value)
      .then((expanded) => {
        if (current) setExpansion({ kind: "expanded", expanded });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (isAppError(error) && error.kind === "invalid_path_syntax") {
          setExpansion({ kind: "invalid", message: error.message });
          return;
        }
        // Nothing else is expected: the command creates nothing and reads
        // nothing but the environment, so a rejection of any other kind is a
        // fault rather than a verdict on the path, and the line says nothing
        // rather than blaming what the curator typed.
        console.error("Failed to resolve the path:", error);
        setExpansion(null);
      });

    return () => {
      current = false;
    };
  }, [value]);

  return expansion;
}
