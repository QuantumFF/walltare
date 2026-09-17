import { Section } from "@/components/SettingsView";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useApp } from "@/context/AppContext";
import {
  WORKLIST_SIZES,
  type ReviewOrdering,
  type SettingKey,
  type Settings,
  type StartupView,
  type Theme,
} from "@/lib/client";

// The four settings that are one named thing out of a handful, in one module
// because they are one section four times over: a heading, a sentence saying
// what the choice is for, and a segmented control that writes on change. That is
// the same reason the two sizes are one `SizeSection` and the two Written paths
// are one `PathFieldRow` — what differs between them is prose and which key is
// written, and a second copy of the shape is a second place for the write rule
// to drift (ADR 0026).
//
// A radio group and not a toggle group, which is the distinction ADR 0020 drew
// for Appearance and applies unchanged to the other three: none of these keys
// can hold "none", and `ToggleGroup type="single"` deselects on a second click
// unless that is fought and announces as a row of pressed buttons rather than as
// "System, radio button 1 of 3".
//
// No Reset on any of them, and none needs one: the default is one of the
// choices on offer, so picking it back is what deletes the row (ADR 0010,
// ADR 0020). That is why the sizes above print what they fall back to and these
// do not — a size the curator cannot see is a size they cannot type back.

/**
 * One choice, and the word the curator reads for it.
 *
 * `value` is the setting's own type, so a label can only be attached to a value
 * `set_setting` will take back.
 */
interface Choice<T> {
  value: T;
  label: string;
}

/**
 * One choice section: a heading, what the choice is for, and the control.
 *
 * The stored value comes from the app's copy of the store rather than from a
 * copy of its own, because Settings is the one view the shell unmounts and a
 * page holding its own would show the curator a choice they had replaced
 * (ADR 0015).
 *
 * Nothing to commit and no line under the control. The choice writes on change
 * rather than on blur, because it is one of a few named things and not a string
 * being typed a character at a time (ADR 0010).
 */
function ChoiceSection<K extends SettingKey>({
  heading,
  setting,
  purpose,
  choices,
}: {
  heading: string;
  setting: K;
  /** What the setting is for, in the sentence under the heading; absent when the heading says it. */
  purpose?: string;
  choices: ReadonlyArray<Choice<Settings[K]>>;
}) {
  const { settings, saveSetting } = useApp();

  return (
    <Section heading={heading}>
      {purpose && <p className="text-sm text-muted-foreground">{purpose}</p>}

      <RadioGroup
        aria-label={heading}
        // Radix speaks in strings, and two of these four settings do not: a
        // worklist size is a number. So the value crosses the control as the
        // label's own key and comes back out of `choices`, rather than being
        // parsed back — which is the same rule `encodeSetting` follows at the
        // other boundary, and keeps the parse in one place instead of two.
        value={String(settings[setting])}
        onValueChange={(picked) => {
          const chosen = choices.find((c) => String(c.value) === picked);
          if (!chosen) return;
          void saveSetting(setting, chosen.value).catch((error: unknown) => {
            console.error(
              `Failed to store the ${heading.toLowerCase()}:`,
              error,
            );
          });
        }}
      >
        {choices.map((choice) => (
          <RadioGroupItem
            key={String(choice.value)}
            value={String(choice.value)}
          >
            {choice.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </Section>
  );
}

/**
 * The three palettes, in the order they are painted across the control.
 *
 * System first because it is the default and the one that needs no decision;
 * Light and Dark after it in the order the two branches of `index.css` are
 * written.
 */
const THEMES: ReadonlyArray<Choice<Theme>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The Appearance section: three palettes, exactly one of them taken.
 *
 * No purpose sentence, because the heading and the three words under it are the
 * whole of the question. The repaint is the whole of the feedback too, since
 * choosing Dark and getting a light window is the only failure the curator could
 * care about and they are looking straight at it.
 */
export function AppearanceSection() {
  return (
    <ChoiceSection heading="Appearance" setting="theme" choices={THEMES} />
  );
}

/**
 * The four worklist lengths, shortest first, mirroring `WORKLIST_SIZES`.
 *
 * Derived from that list rather than written out again, so the presets the
 * backend enforces and the presets this control offers cannot drift apart. The
 * labels are the numbers, because the question is how many wallpapers and the
 * number is the answer.
 */
const WORKLIST_CHOICES: ReadonlyArray<Choice<number>> = WORKLIST_SIZES.map(
  (size) => ({ value: size, label: String(size) }),
);

/**
 * The Review worklist section: how many wallpapers Review puts in front of the
 * curator at once.
 *
 * Presets rather than a number to type, because the question is how long a
 * session to sit down to rather than how many rows a query returns — and fifty,
 * the length Review has always shown, is one of them, so a curator who ignores
 * this section has the app they had (#259).
 */
export function ReviewWorklistSection() {
  return (
    <ChoiceSection
      heading="Review worklist"
      setting="review_worklist_size"
      purpose="How many wallpapers Review puts in front of you at once."
      choices={WORKLIST_CHOICES}
    />
  );
}

/**
 * The three views the app can open on, in the order the shell's tabs name them.
 *
 * Settings is not among them: boot opens it on its own when there is nothing
 * else to show — nothing scanned, or a library that would not read — and being
 * dropped on the configuration page every launch is not somewhere a curator
 * works (ADR 0015).
 */
const STARTUP_VIEWS: ReadonlyArray<Choice<StartupView>> = [
  { value: "rank", label: "Rank" },
  { value: "review", label: "Review" },
  { value: "library", label: "Library" },
];

/**
 * The Startup view section: which view the app opens on.
 *
 * A fixed choice and not wherever the curator was last, because an app that
 * opens somewhere different every launch is disorienting. The sentence says what
 * the library can still override, because a curator who picks Rank on a library
 * with one Eligible wallpaper lands on Library and would otherwise read that as
 * the setting not working.
 */
export function StartupViewSection() {
  return (
    <ChoiceSection
      heading="Startup view"
      setting="startup_view"
      purpose="Where the app opens. A library with nothing to scan or nothing to compare still opens where it can."
      choices={STARTUP_VIEWS}
    />
  );
}

/**
 * The two ends of the ranking Review can work from.
 *
 * Score in both labels, because Score is what orders the list either way
 * (ADR 0013) and the choice is which end of it.
 */
const REVIEW_ORDERINGS: ReadonlyArray<Choice<ReviewOrdering>> = [
  { value: "score_asc", label: "Lowest Score" },
  { value: "score_desc", label: "Highest Score" },
];

/**
 * The Review ordering section: whether Review works from the lowest Scores or
 * the highest.
 *
 * Two orderings and not the library page's four. Review is a decision queue, so
 * filename order in it means nothing, and the two that remain are the two jobs
 * it does: culling the worst, and confirming favourites (#259).
 */
export function ReviewOrderingSection() {
  return (
    <ChoiceSection
      heading="Review ordering"
      setting="review_ordering"
      purpose="Which end of the ranking Review works from: cull the worst, or confirm favourites."
      choices={REVIEW_ORDERINGS}
    />
  );
}
