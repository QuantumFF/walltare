/**
 * The one place a Written path is resolved for the screen.
 *
 * Two hooks over one effect, because there are two questions and one way of
 * asking them. `useExpansion` asks where a path points, which is what a Library
 * root and the rejecting bars' read-out need; `useDestinationCheck` asks whether
 * a reject could land there, which only the destination field needs and only a
 * write can answer (ADR 0035). Both are keyed on the string, both drop an answer
 * the field has moved on from, and both turn the one syntax error into copy.
 *
 * It sits beside `client.ts` rather than inside the page that first needed it
 * because more than one surface asks the same question of the same string. The
 * Library root field on Settings asks it to print where a path points
 * (ADR 0020),
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
import {
  client,
  isAppError,
  type DestinationCheck,
  type Expanded,
} from "@/lib/client";
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
 * What `check_reject_destination` says about the string in the Soft reject
 * destination field: whether it can take a file, or the same syntax error.
 *
 * The two fields on Settings hold Written paths and ask different questions of
 * them. A Library root is asked where it points and whether a folder is there,
 * because it is a stated preference that may point at an unmounted drive. A
 * reject destination is asked whether a file could land in it, because the next
 * click moves one — and only a write can answer that (ADR 0035).
 */
export type Destination =
  | { kind: "checked"; check: DestinationCheck }
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
 * The two answers are one shape and the lines drawn from them are not. The
 * Library root field reports a place and can say nothing is there; the rejecting
 * bars read the same answer only to find out whether the destination is
 * relative, and print the written string either way (ADR 0018).
 */
export function useExpansion(value: string): Expansion | null {
  const answer = useResolution(value, client.expandPath);
  if (answer === null || answer.kind === "invalid") return answer;
  return { kind: "expanded", expanded: answer.answer };
}

/**
 * Resolve a Written path as the reject destination, once per string.
 *
 * The same machinery as [`useExpansion`] against the other question, and `null`
 * means the same three things: an empty field, a first answer still in flight,
 * and an answer that arrived after the value moved on.
 *
 * The string is the one the curator has **typed**, which is not the one a reject
 * would use: that is the stored setting, which `useRejectDestination` reads.
 * Both call the backend rather than reading the answer off the string, because
 * `~/bin` and `$HOME/bin` both look relative and both expand absolute
 * (ADR 0018).
 */
export function useDestinationCheck(value: string): Destination | null {
  const answer = useResolution(value, client.checkRejectDestination);
  if (answer === null || answer.kind === "invalid") return answer;
  return { kind: "checked", check: answer.answer };
}

/** One backend answer about one Written path, or the syntax error instead. */
type Resolution<T> =
  { kind: "answered"; answer: T } | { kind: "invalid"; message: string };

/**
 * The half the two hooks above share: ask `resolve` about `value`, once per
 * string, and drop an answer the field has moved on from.
 *
 * `resolve` is read as a dependency rather than closed over, so it has to be a
 * stable function — the two callers pass a `client` method, which is one for the
 * life of the module. Anything built per render would ask the backend again on
 * every paint, which is exactly what keying the effect on the string is for.
 */
function useResolution<T>(
  value: string,
  resolve: (input: string) => Promise<T>,
): Resolution<T> | null {
  const [resolution, setResolution] = useState<Resolution<T> | null>(null);

  useEffect(() => {
    if (!value) {
      setResolution(null);
      return;
    }

    let current = true;
    void resolve(value)
      .then((answer) => {
        if (current) setResolution({ kind: "answered", answer });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (isAppError(error) && error.kind === "invalid_path_syntax") {
          setResolution({ kind: "invalid", message: error.message });
          return;
        }
        // Nothing else is expected: neither command creates anything or stores
        // anything, so a rejection of any other kind is a fault rather than a
        // verdict on the path, and the line says nothing rather than blaming
        // what the curator typed.
        console.error("Failed to resolve the path:", error);
        setResolution(null);
      });

    return () => {
      current = false;
    };
  }, [value, resolve]);

  return resolution;
}
