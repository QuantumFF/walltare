import { Section } from "@/components/SettingsView";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApp } from "@/context/AppContext";
import { DEFAULT_EVALUATED_THRESHOLD, EVALUATED_THRESHOLDS } from "@/lib/client";

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

/**
 * One offered threshold: the σ stored, the word on the control, and what
 * choosing it costs or buys.
 *
 * The σ is not printed anywhere. It is the app's own scale, and a curator who
 * knows what 4.0 means already knows what the three words mean — while one who
 * does not would be reading a number with no unit and no range beside it.
 */
const CONFIDENCES: Array<{ threshold: number; label: string; meaning: string }> =
  [
    {
      threshold: EVALUATED_THRESHOLDS[0],
      label: "Lenient",
      meaning: "Evaluated sooner, on fewer Comparisons.",
    },
    {
      threshold: DEFAULT_EVALUATED_THRESHOLD,
      label: "Balanced",
      meaning:
        "Evaluated at roughly half the uncertainty a new wallpaper starts with.",
    },
    {
      threshold: EVALUATED_THRESHOLDS[2],
      label: "Strict",
      meaning: "Evaluated later, on more Comparisons.",
    },
  ];

/**
 * A stored threshold as the radio group's value, which is how `set_setting`
 * receives it too.
 *
 * `String(4)` is `"4"`, and that is what `client.ts` sends and what
 * `settings.rs` parses back, so the control's value and the column's contents are
 * the same string. Nothing here rounds or formats: a threshold the backend would
 * refuse cannot be in the table to be shown.
 */
const asValue = (threshold: number): string => String(threshold);

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

  const chosen =
    CONFIDENCES.find(
      ({ threshold }) => threshold === settings.evaluated_threshold,
    ) ?? CONFIDENCES[1];

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
        value={asValue(settings.evaluated_threshold)}
        onValueChange={(next) => {
          void saveSetting("evaluated_threshold", Number(next)).catch(
            (error: unknown) => {
              console.error("Failed to store the Evaluated threshold:", error);
            },
          );
        }}
      >
        {CONFIDENCES.map(({ threshold, label }) => (
          <RadioGroupItem key={threshold} value={asValue(threshold)}>
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
