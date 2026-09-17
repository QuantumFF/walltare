import { Section } from "@/components/SettingsView";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { type Resolution, type SettingKey } from "@/lib/client";
// A size as the curator reads it, from the file that holds the app's phrasings:
// the undersized badge prints a wallpaper's Dimensions the same way these two
// sections print the settings they are compared against.
import { readableSize } from "@/lib/copy";
import { useEffect, useRef, useState } from "react";

// The two sections about the curator's Screen, in one module because the second
// is defined in terms of the first: a Minimum resolution's default *is* the
// Screen, so a reader working out what the field means has to have the section
// above it in front of them. They are one component twice over, which is the
// other reason (ADR 0026).
//
// One Screen and not two. The crop preview will read its ratio and the
// undersized check will read its pixels, and two settings holding the same fact
// can disagree about it.
//
// No Reset control on either, which is ADR 0020's rule and is why each section
// prints what it falls back to instead: the line names the detected size,
// whatever this machine's monitor turns out to be, and typing that back is what
// deletes the row. A button would have been one click rather than four digits,
// and the ADR's own reason for refusing one — it needs a command for the
// `DELETE` — does not apply, since writing the default through `set_setting`
// already deletes the row. Reopening that is an ADR, not a section.

/** The two settings this module is about, which is the two that hold a size. */
type SizeSetting = Extract<SettingKey, "screen" | "minimum_resolution">;

/** The `data-slot` on the line under each field, off the key, as `PathField` does. */
const STATUS_SLOT: Record<SizeSetting, string> = {
  screen: "screen-status",
  minimum_resolution: "minimum-resolution-status",
};

function sameSize(a: Resolution, b: Resolution): boolean {
  return a.width === b.width && a.height === b.height;
}

/** The two inputs as strings, because an input the curator has emptied is one. */
interface Draft {
  width: string;
  height: string;
}

const asDraft = ({ width, height }: Resolution): Draft => ({
  width: String(width),
  height: String(height),
});

/**
 * The largest number the column's reader will take, because `settings.rs` parses
 * a size into two `u32`s.
 *
 * Without it this field's "whole number above zero" and the backend's are two
 * different rules, and the gap between them is a write that looks accepted and
 * comes back a refusal the curator never sees.
 */
const MAX_PIXELS = 4_294_967_295;

/** A whole number of pixels the backend would take, or nothing. */
function pixels(typed: string): number | null {
  const trimmed = typed.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 && value <= MAX_PIXELS ? value : null;
}

const REFUSED_SIZE = "Width and height are whole numbers of pixels above zero.";

/** One axis of a size, which is the same input twice but for which half it is. */
function AxisInput({
  label,
  value,
  onEdit,
  onCommit,
}: {
  label: string;
  value: string;
  onEdit: (next: string) => void;
  onCommit: () => void;
}) {
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      className="w-24"
      value={value}
      onChange={(event) => onEdit(event.target.value)}
      // On blur and never on keystroke, for the reason the path fields are:
      // `2560` is four keystrokes and three of them are a different Screen
      // (ADR 0010).
      onBlur={onCommit}
      // Enter commits, which is all there is to do in a field that writes on
      // blur — the same rule the Reject destination's Enter follows (ADR 0020).
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit();
      }}
    />
  );
}

/**
 * A size as two inputs, width by height, writing on blur.
 *
 * The draft follows the store when the stored numbers move, and only then — a
 * write of some other setting re-renders this field and must not take a
 * half-typed number away from the curator.
 */
function SizeField({
  label,
  stored,
  onCommit,
}: {
  /** Names the pair in a label, as in "Screen width" and "Screen height". */
  label: string;
  stored: Resolution;
  /** Store the size. Rejects if the write did not take, so the record can go back. */
  onCommit: (next: Resolution) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => asDraft(stored));
  const [refused, setRefused] = useState(false);

  // What the store was last told, so a blur on the way out of the section does
  // not write a size the store already holds — the guard `usePathField` keeps
  // for the same reason, and the reason a Tab through two inputs is not two
  // writes (ADR 0026).
  const committed = useRef(stored);

  useEffect(() => {
    setDraft(asDraft(stored));
    committed.current = stored;
    setRefused(false);
  }, [stored.width, stored.height]);

  // Recorded before the write lands rather than after, because the blur on the
  // way out of the width and the one out of the height are two commits of the
  // same pair. A write that fails puts the record back, so the next blur tries
  // again rather than assuming it took — the second half of the guard
  // `usePathField` keeps, without which a refused size is a field the curator
  // has to edit before it will be sent a second time.
  const commit = () => {
    const width = pixels(draft.width);
    const height = pixels(draft.height);
    if (width === null || height === null) {
      setRefused(true);
      return;
    }
    setRefused(false);
    const next = { width, height };
    if (sameSize(next, committed.current)) return;
    const previous = committed.current;
    committed.current = next;
    void onCommit(next).catch(() => {
      committed.current = previous;
    });
  };

  const edit = (axis: keyof Draft, next: string) => {
    setDraft((typed) => ({ ...typed, [axis]: next }));
    setRefused(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <AxisInput
          label={`${label} width`}
          value={draft.width}
          onEdit={(next) => edit("width", next)}
          onCommit={commit}
        />
        <span aria-hidden className="text-muted-foreground">
          ×
        </span>
        <AxisInput
          label={`${label} height`}
          value={draft.height}
          onEdit={(next) => edit("height", next)}
          onCommit={commit}
        />
        <span className="text-xs text-muted-foreground">pixels</span>
      </div>

      {refused && <p className="text-xs text-destructive">{REFUSED_SIZE}</p>}
    </>
  );
}

/**
 * One size section: a heading, what the setting is for, the field, and the line
 * naming what it falls back to.
 *
 * Both sections are this component, for the reason the two Written path fields
 * are one `PathFieldRow`: what differs between them is prose and which key is
 * written, and a second copy of the shape is a second place for the blur rule to
 * drift (ADR 0026).
 */
function SizeSection({
  heading,
  setting,
  purpose,
  fieldLabel,
  stored,
  fallback,
}: {
  heading: string;
  setting: SizeSetting;
  /** What the setting is for, in the sentence under the heading. */
  purpose: string;
  /**
   * What the two inputs are called, which is not the heading: "Minimum
   * resolution height" is a mouthful for a four-digit box.
   */
  fieldLabel: string;
  stored: Resolution;
  /** What this setting reads as with no row, and the sentence that names it. */
  fallback: { size: Resolution; sentence: (size: string) => string };
}) {
  const { saveSetting } = useApp();

  return (
    <Section heading={heading}>
      <p className="text-sm text-muted-foreground">{purpose}</p>

      <SizeField
        label={fieldLabel}
        stored={stored}
        // Logged here, where the heading names which setting failed, and thrown
        // on so the field can put its record back and let the next blur retry.
        onCommit={(next) =>
          saveSetting(setting, next).catch((error: unknown) => {
            console.error(
              `Failed to store the ${heading.toLowerCase()}:`,
              error,
            );
            throw error;
          })
        }
      />

      {/* The one default on this page a curator could not otherwise recover, so
          it is printed rather than left to an empty settings table to imply. It
          is also the whole of how the setting is changed back, with no Reset
          control to do it in one click (ADR 0010, ADR 0020). */}
      <p
        data-slot={STATUS_SLOT[setting]}
        className="text-xs text-muted-foreground"
      >
        {fallback.sentence(readableSize(fallback.size))}
      </p>
    </Section>
  );
}

/**
 * The Screen section: the display the curator is curating for, detected by
 * default.
 *
 * The detected monitor rides along on the settings answer rather than arriving
 * on a read of its own. It is not a setting — the backend refuses the key — but
 * this section is its only reader and wants it in the same breath as the value
 * it is comparing, and a second command would have meant a second mock in every
 * test file that opens this page for no question it answers better.
 */
export function ScreenSection() {
  const { settings } = useApp();

  return (
    <SizeSection
      heading="Screen"
      setting="screen"
      purpose="The display wallpapers are being curated for."
      fieldLabel="Screen"
      stored={settings.screen}
      fallback={{
        size: settings.detected_screen,
        sentence: (size) => `Detected ${size}. Type it back to use it again.`,
      }}
    />
  );
}

/**
 * The Minimum resolution section: the size below which a wallpaper counts as
 * undersized for the Screen above.
 *
 * Its default is the Screen rather than a constant, so a curator who wants
 * exactly their own pixels has nothing to set here — and one who wants to be
 * stricter or looser has somewhere to say so without lying to the crop preview
 * about what they are looking at.
 */
export function MinimumResolutionSection() {
  const { settings } = useApp();

  return (
    <SizeSection
      heading="Minimum resolution"
      setting="minimum_resolution"
      purpose="Wallpapers smaller than this count as undersized for your screen."
      fieldLabel="Minimum"
      stored={settings.minimum_resolution}
      fallback={{
        size: settings.screen,
        sentence: (size) =>
          `Defaults to your screen, ${size}. Type it back to use it again.`,
      }}
    />
  );
}
