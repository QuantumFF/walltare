import { Section } from "@/components/SettingsView";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApp } from "@/context/AppContext";
import { useAppEvents } from "@/context/AppEventsContext";
import {
  client,
  DEFAULT_EVALUATED_THRESHOLD,
  EVALUATED_THRESHOLDS,
} from "@/lib/client";

// The one setting that changes what a word in the app means rather than what the
// app looks like. Evaluated used to be a fact about a wallpaper — σ below 4.0 —
// and is now a threshold the curator sets, so the count in the Rank headline and
// the Score badge on every card both read this row (CONTEXT.md, ADR 0046).
//
// Three named confidences and not a number field, which is the rule the epic set
// for the Review worklist size: σ is the app's own uncertainty scale and a
// curator typing 6.5 into it is guessing at a unit nothing on the page can
// explain. `settings.rs` refuses anything but these three, so the control and the
// refusal are one rule.
//
// No Reset control, which is ADR 0020's rule: pressing Balanced is what deletes
// the row, and the line under the control says so.
//
// It is one of the two sections on this page that publish (Missing files, whose
// reject changes the Eligible pool, is the other). Every badge in the
// app reads the threshold out of `AppContext`, so those move on the write; the
// Evaluated count in the Rank headline is the backend's and is patched onto
// Rank by `stats-changed`. Without
// that the two halves of the same claim would be a change apart until the next
// vote — which is exactly what "the count and the badges agree" forbids
// (ADR 0046).

/** One offered confidence: the σ stored, the word on the control, and its cost. */
interface Confidence {
  threshold: number;
  label: string;
  meaning: string;
}

// The loosest and the strictest, named off the mirror of `settings.rs`'s list so
// that the three numbers are stated in one place and nothing here indexes into
// that list by position. The middle one is skipped because it is the default,
// and the Balanced entry below reads `DEFAULT_EVALUATED_THRESHOLD` directly:
// "the middle choice" and "the default" are the same fact, and a reference says
// so where a position only implies it.
const [LENIENT, , STRICT] = EVALUATED_THRESHOLDS;

/**
 * The choice a curator who has said nothing is on, and what the control falls
 * back to showing if a row somehow holds a σ this page does not offer.
 *
 * Named rather than found in the list below, because the two things that make it
 * the default — that `settings.rs` reads it with no row, and that writing it back
 * deletes one — are about this σ and not about where it sits in a row of three.
 */
const BALANCED: Confidence = {
  threshold: DEFAULT_EVALUATED_THRESHOLD,
  label: "Balanced",
  meaning:
    "Evaluated at roughly half the uncertainty a new wallpaper starts with.",
};

/**
 * The three, in the order they are painted across the control: loosest first, so
 * moving right is asking for more evidence.
 *
 * The σ is not printed anywhere. It is the app's own scale, and a curator who
 * knows what 4.0 means already knows what the three words mean — while one who
 * does not would be reading a number with no unit and no range beside it.
 */
const CONFIDENCES: Confidence[] = [
  {
    threshold: LENIENT,
    label: "Lenient",
    meaning: "Evaluated sooner, on fewer Comparisons.",
  },
  BALANCED,
  {
    threshold: STRICT,
    label: "Strict",
    meaning: "Evaluated later, on more Comparisons.",
  },
];

/**
 * The Evaluated threshold section: how sure the app has to be before it says a
 * Score is trustworthy.
 *
 * A radio group and not a toggle group, for the reason Appearance is one: the
 * setting cannot hold "none", and `ToggleGroup type="single"` deselects on a
 * second click (ADR 0020). It writes on change rather than on blur, because a
 * confidence is one of three named things and not a string being typed a
 * character at a time (ADR 0010) — and the feedback is the count in the Rank
 * headline and every badge in the Library moving together, which is the whole
 * point of the setting.
 */
export function EvaluatedSection() {
  const { settings, saveSetting } = useApp();
  const { publish } = useAppEvents();

  /**
   * Store the threshold, then tell Rank what the count is now.
   *
   * The re-read is `get_stats` and not `readLibrary`, which is the same numbers
   * plus two side effects this has no business causing: it sets `libraryTotal`
   * and retires an unreadable-library notice. Nothing about a σ says either.
   *
   * A failed re-read leaves the old count standing rather than blanking it. The
   * write has already landed, so the badges are right and the headline is one
   * stats fetch behind — which is the state Rank is in after any other failure
   * to read, and is recoverable by the next vote.
   */
  const choose = async (threshold: number) => {
    await saveSetting("evaluated_threshold", threshold);
    publish({ type: "stats-changed", stats: await client.getStats() });
  };

  const chosen =
    CONFIDENCES.find(
      ({ threshold }) => threshold === settings.evaluated_threshold,
    ) ?? BALANCED;

  return (
    <Section heading="Evaluated threshold">
      <p className="text-sm text-muted-foreground">
        How many Comparisons make a Score trustworthy. It moves the Evaluated
        count on Rank and the Score badge on every card together.
      </p>

      <RadioGroup
        aria-label="Evaluated threshold"
        // The stored choice, read from the app's copy of the store rather than
        // from a copy of its own: Settings is unmounted between visits, and what
        // renders is what `set_setting` answered (ADR 0015).
        //
        // `String(4)` is `"4"`, which is what `client.ts` sends and what
        // `settings.rs` parses back, so this value and the column's contents are
        // the same string. Nothing rounds or formats: a σ the backend would
        // refuse cannot be in the table to be shown.
        value={String(settings.evaluated_threshold)}
        onValueChange={(next) => {
          void choose(Number(next)).catch((error: unknown) => {
            console.error("Failed to store the Evaluated threshold:", error);
          });
        }}
      >
        {CONFIDENCES.map(({ threshold, label }) => (
          <RadioGroupItem key={threshold} value={String(threshold)}>
            {label}
          </RadioGroupItem>
        ))}
      </RadioGroup>

      {/* What the current choice means, and what the default is — the second
          half being the whole of how the setting is changed back, since there is
          no Reset control to do it in one click (ADR 0010, ADR 0020). */}
      <p
        data-slot="evaluated-threshold-status"
        className="text-xs text-muted-foreground"
      >
        {chosen.meaning} Balanced is the default.
      </p>
    </Section>
  );
}
