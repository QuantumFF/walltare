import { Section } from "@/components/SettingsView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApp } from "@/context/AppContext";
import { type Resolution } from "@/lib/client";
import { useEffect, useState } from "react";

// The two sections about the curator's screen, in one module because the second
// is defined in terms of the first: the minimum resolution's default *is* the
// screen, so a reader working out what the field means has to have the section
// above it in front of them. They share one field, which is the other reason
// (ADR 0020).
//
// The screen is one setting and not two. The crop preview will read its ratio
// and the undersized check will read its pixels, and two settings holding the
// same fact can disagree about it.

/** A size as the curator reads it, which is not the `1920x1080` the column holds. */
function readableSize({ width, height }: Resolution): string {
  return `${width} × ${height}`;
}

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
 * A whole number of pixels above zero, or nothing.
 *
 * Deliberately as strict as `settings.rs`, which refuses a zero axis and would
 * answer a bad request the page would then have to explain in the backend's
 * words. Saying it here means the curator reads the sentence before the write
 * rather than after it, which is the same rule the Library root's failed Scan
 * follows (ADR 0020).
 */
function pixels(typed: string): number | null {
  const trimmed = typed.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

const REFUSED_SIZE = "Width and height are whole numbers of pixels above zero.";

/**
 * A size as two inputs, width by height, writing on blur.
 *
 * On blur and not on keystroke, for the reason the path fields are: `2560` is
 * four keystrokes and three of them are a different screen (ADR 0010). Enter
 * commits too, since there is nothing else to run here.
 *
 * The draft follows the store when the stored numbers move, and only then — a
 * write of some other setting re-renders this field and must not take a
 * half-typed number away from the curator.
 */
function ResolutionField({
  label,
  stored,
  onCommit,
}: {
  /** Names the pair in a label, as in "Screen width" and "Screen height". */
  label: string;
  stored: Resolution;
  onCommit: (next: Resolution) => void;
}) {
  const [draft, setDraft] = useState(() => asDraft(stored));
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    setDraft(asDraft(stored));
    setRefused(false);
  }, [stored.width, stored.height]);

  const commit = () => {
    const width = pixels(draft.width);
    const height = pixels(draft.height);
    if (width === null || height === null) {
      setRefused(true);
      return;
    }
    setRefused(false);
    // The store is told even when the numbers have not moved: `saveSetting`
    // answers with the whole struct and the backend deletes a row that equals
    // the default, so a blur that changes nothing costs one call and keeps the
    // write path the only thing that decides what a default is.
    onCommit({ width, height });
  };

  const edit = (axis: keyof Draft, next: string) => {
    setDraft((typed) => ({ ...typed, [axis]: next }));
    setRefused(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${label} width`}
          inputMode="numeric"
          className="w-24"
          value={draft.width}
          onChange={(event) => edit("width", event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <span aria-hidden className="text-muted-foreground">
          ×
        </span>
        <Input
          aria-label={`${label} height`}
          inputMode="numeric"
          className="w-24"
          value={draft.height}
          onChange={(event) => edit("height", event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <span className="text-xs text-muted-foreground">pixels</span>
      </div>

      {refused && <p className="text-xs text-destructive">{REFUSED_SIZE}</p>}
    </>
  );
}

/**
 * The line under a size field: what the default is, and the control that goes
 * back to it.
 *
 * A Reset the theme deliberately does not have, and for the reason it does not:
 * ADR 0020 refused one there because writing `system` back is a radio button the
 * curator is looking at. A detected screen is a number nothing on the page shows
 * once it has been overridden, so without this the "change it back" is a value
 * the curator has to remember (ADR 0010).
 */
function DefaultLine({
  slot,
  sentence,
  reset,
}: {
  slot: string;
  sentence: string;
  /** The label and the write, or `null` when the setting is already its default. */
  reset: { label: string; onReset: () => void } | null;
}) {
  return (
    <p
      data-slot={slot}
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      {sentence}
      {reset && (
        <Button variant="ghost" size="sm" onClick={reset.onReset}>
          {reset.label}
        </Button>
      )}
    </p>
  );
}

/**
 * The Screen section: the size the curator is curating for, detected by default.
 *
 * The detected monitor rides along on the settings answer rather than arriving
 * on a read of its own. It is not a setting — the backend refuses the key — but
 * this section is its only reader and wants it in the same breath as the value
 * it is comparing, and a second command would have meant a second mock in every
 * test file that opens this page for no question it answers better.
 */
export function ScreenSection() {
  const { settings, saveSetting } = useApp();
  const { screen, detected_screen } = settings;

  const write = (next: Resolution) => {
    void saveSetting("screen", next).catch((error: unknown) => {
      console.error("Failed to store the screen:", error);
    });
  };

  return (
    <Section heading="Screen">
      <p className="text-sm text-muted-foreground">
        The screen wallpapers are being curated for.
      </p>

      <ResolutionField label="Screen" stored={screen} onCommit={write} />

      <DefaultLine
        slot="screen-status"
        sentence={`Detected ${readableSize(detected_screen)}.`}
        reset={
          sameSize(screen, detected_screen)
            ? null
            : {
                label: "Use detected",
                onReset: () => write(detected_screen),
              }
        }
      />
    </Section>
  );
}

/**
 * The Minimum resolution section: the size below which a wallpaper is too small
 * for the screen above.
 *
 * Its default is the screen rather than a constant, so a curator who wants
 * exactly their own pixels has nothing to set here — and one who wants to be
 * stricter or looser than exact has somewhere to say so without lying to the
 * crop preview about what they are looking at.
 */
export function MinimumResolutionSection() {
  const { settings, saveSetting } = useApp();
  const { screen, minimum_resolution } = settings;

  const write = (next: Resolution) => {
    void saveSetting("minimum_resolution", next).catch((error: unknown) => {
      console.error("Failed to store the minimum resolution:", error);
    });
  };

  return (
    <Section heading="Minimum resolution">
      <p className="text-sm text-muted-foreground">
        Wallpapers smaller than this are flagged as too small to hang.
      </p>

      <ResolutionField
        label="Minimum"
        stored={minimum_resolution}
        onCommit={write}
      />

      <DefaultLine
        slot="minimum-resolution-status"
        sentence={`Defaults to your screen, ${readableSize(screen)}.`}
        reset={
          sameSize(minimum_resolution, screen)
            ? null
            : { label: "Use screen", onReset: () => write(screen) }
        }
      />
    </Section>
  );
}
