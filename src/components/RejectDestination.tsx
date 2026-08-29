import { useApp } from "@/context/AppContext";
import { isAbsolute, useExpansion } from "@/lib/useExpansion";

/**
 * The stored reject destination, as the two pages that reject need it.
 *
 * One hook and one object rather than a value each page reads for itself,
 * because three things downstream have to agree about the same setting: the line
 * on the bar, the string handed to `move_wallpaper`, and whether the reject
 * toast names the path the file landed at. ADR 0018 states the toast's rule as
 * "name the path whenever the bar could not", which is only true if both are
 * reading one answer — and the answer is not in the string, so a second reader
 * would be a second `expand_path` call that can come back at a different time
 * with a different verdict.
 */
export interface RejectDestination {
  /**
   * The Written path exactly as stored, which is what the line prints. `~/bin`
   * stays `~/bin`: ADR 0011 put the resolved-path preview on the Settings field,
   * and repeating it on two other bars is noise (ADR 0018).
   */
  written: string;
  /**
   * Whether it resolves relative, and so lands beside each wallpaper rather than
   * in one named folder (ADR 0011).
   *
   * `false` until `expand_path` has answered, which is the honest reading of an
   * unknown: the clause on the bar states a rule, and stating one before knowing
   * it applies is worse than stating it a paint later. The toast reads the same
   * field, so for that one frame the two still say the same thing.
   */
  relative: boolean;
  /**
   * `invalid_path_syntax`'s own message, or `null`. The one error kind whose
   * Rust string is user-facing copy, because it names the variable the curator
   * mistyped (ADR 0011).
   */
  invalidMessage: string | null;
}

/**
 * Read the reject destination out of the app's settings and resolve it once.
 *
 * The value comes from the context object rather than from a fetch of its own,
 * which is what ADR 0018 means by the bar and the move reading the same object:
 * `move_wallpaper` is handed `written` from here, so a bar naming a folder the
 * reject does not use is not a state this app has.
 *
 * The resolution is `useExpansion`, memoised on the string, so a page that
 * re-renders on every card that changes Status asks the backend nothing new
 * (ADR 0018).
 */
export function useRejectDestination(): RejectDestination {
  const { settings } = useApp();
  const written = settings.reject_destination;
  const expansion = useExpansion(written);

  return {
    written,
    relative:
      expansion?.kind === "expanded" &&
      !isAbsolute(expansion.expanded.resolved),
    invalidMessage: expansion?.kind === "invalid" ? expansion.message : null,
  };
}

/**
 * The line on a rejecting page's bar, naming where rejects go:
 *
 * ```
 * Rejects go to ./rejected, beside each wallpaper · change in Settings
 * ```
 *
 * One component for Review's second bar and the library page's, since a reject
 * fired from a card overlay on a page nobody opened in order to reject anything
 * needs it more than a worklist does (ADR 0018).
 *
 * The trailing clause is the part that earns the line its place. That a relative
 * destination means "beside each wallpaper" rather than "beside the library
 * root" is the most surprising thing about this setting, and it was written down
 * only in an ADR until this line and the Settings field started saying it.
 *
 * The destination it holds is passed in rather than read here, so that the page
 * rejecting to it and the line describing it cannot be looking at two different
 * answers. See `useRejectDestination`.
 */
export function RejectDestinationLine({
  destination,
}: {
  destination: RejectDestination;
}) {
  const { view, setView } = useApp();

  // `min-w-0 flex-1 truncate`: where the bar runs out of width this line
  // truncates first and the controls beside it keep their labels, because it is
  // a read-out and they are the things the curator came to press (ADR 0018).
  const className = "min-w-0 flex-1 truncate";

  if (destination.invalidMessage !== null) {
    // The whole line, not a clause beside it. `$HOEM/rejected` fails every
    // reject in the pass, so there is no destination left to describe, and
    // reading `unknown environment variable HOEM` before the first click beats
    // fifty identical failures after it (ADR 0011, ADR 0018). What goes with it
    // is the route into Settings, which is no loss: the chrome's gear opens the
    // same page from every view.
    return (
      <p
        data-slot="reject-destination"
        className={`${className} text-destructive`}
      >
        {destination.invalidMessage}
      </p>
    );
  }

  return (
    <p
      data-slot="reject-destination"
      className={`${className} text-muted-foreground`}
    >
      Rejects go to <span className="font-mono">{destination.written}</span>
      {destination.relative ? ", beside each wallpaper" : null} ·{" "}
      {/* A control and not text. Naming a destination that is one click away
          and leaving the words inert is a small cruelty, and `returnTo` carries
          the curator back to the page they were rejecting from while `focus`
          puts the caret in the field this line is about (ADR 0015, ADR 0018,
          ADR 0020). It is a button dressed as inline text rather than one of
          the app's Buttons, because the whole line has to truncate as one
          sentence and a control laid out as a box does not. */}
      <button
        type="button"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={() =>
          setView("settings", { returnTo: view, focus: "reject_destination" })
        }
      >
        change in Settings
      </button>
    </p>
  );
}
