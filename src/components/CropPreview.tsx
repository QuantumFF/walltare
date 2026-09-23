import { keyShortcut, printedKey } from "@/components/keymap";
import { useToaster } from "@/components/ToastSurface";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useApp } from "@/context/AppContext";
import type { Wallpaper } from "@/lib/client";
import { cropCaption, dimensionsOf } from "@/lib/copy";
import { cropToFill, ratioOf, type CropPlan } from "@/lib/layout-plan";
import { cn } from "@/lib/utils";
import { Crop } from "lucide-react";
import { useCallback } from "react";

/**
 * Whether the crop preview is up, and the press that changes that.
 *
 * The state is the settings store's rather than either surface's, which is what
 * makes two of the ticket's lines one fact: the toggle survives a restart, and
 * the Review strip and the Lightbox are showing the same preview rather than two
 * that happen to agree. A curator who turns the bars on in the strip and opens
 * the lightbox over it does not find them off (ADR 0010, #266).
 *
 * A toggle and not a hold. Hold-to-preview was the decision until it was on
 * screen: the bars want to stay up while the curator works through a run, and a
 * key held down is a key that cannot arrow.
 */
export function useCropPreview(): { on: boolean; toggle: () => void } {
  const { settings, saveSetting } = useApp();
  const { show } = useToaster();
  const on = settings.crop_preview;

  const toggle = useCallback(() => {
    void saveSetting("crop_preview", !on).catch((error: unknown) => {
      show({ kind: "save-failed", noun: "the crop preview", error });
    });
  }, [on, saveSetting, show]);

  return { on, toggle };
}

/**
 * The crop preview's switch, for a pointer: the same toggle `C` flips, pressed
 * while the bars are up. It sits in the Review strip's row and the lightbox's,
 * beside the decisions, and prints its key the way they print theirs — a key
 * named in a muted caption beside a row of buttons read as a caption, and
 * gave a pointer nothing to press.
 */
export function CropPreviewToggle() {
  const { on, toggle } = useCropPreview();
  return (
    <Button
      size="sm"
      variant="toggle"
      aria-pressed={on}
      aria-keyshortcuts={keyShortcut("crop")}
      onClick={toggle}
      className="shrink-0"
    >
      <Crop />
      Crop preview
      <Kbd aria-hidden>{printedKey("crop")}</Kbd>
    </Button>
  );
}

export interface CropPreviewProps {
  /** The wallpaper being looked at, for its Dimensions. */
  wallpaper: Wallpaper;
}

/**
 * What the desktop would cut off, drawn over the wallpaper: the discarded
 * regions dimmed, the kept region outlined, and a caption naming the Screen and
 * the share that goes.
 *
 * **It fills its parent, and the parent has to be exactly the picture.** The
 * bars are percentages, so a box with letterboxing in it would measure the
 * letterboxing — which is why the strip's hero is a computed `fittedBox` rather
 * than an `<img>` with a maximum in each axis, and why this takes no size of its
 * own. Both callers position it in a box of the wallpaper's own ratio.
 *
 * **Dimmed rather than hidden**, because the question the curator is asking is
 * what they are about to lose. The bars are drawn over the discarded part and
 * the picture underneath is untouched; nothing here crops an image.
 *
 * **The Screen is read here rather than passed in.** CONTEXT.md has one Screen
 * precisely so that everything asking how a wallpaper would be cropped gets the
 * same answer, and a prop is two surfaces each deciding which screen they are
 * answering about. The override is included by construction: `settings.screen`
 * is what the curator says their display is, and the detected value is only what
 * it reads as until they say otherwise.
 */
export function CropPreview({ wallpaper }: CropPreviewProps) {
  const { settings } = useApp();
  const screen = settings.screen;

  // A wallpaper whose Dimensions nothing has read has no shape to crop, and the
  // 16:9 the layouts fall back to is a guess rather than a measurement — so this
  // says nothing instead of something wrong (CONTEXT.md, ADR 0044). The caption
  // still names the Screen, which is what makes the press answer at all.
  const size = dimensionsOf(wallpaper);
  const plan: CropPlan | null =
    size === null
      ? null
      : cropToFill(
          ratioOf(size.width, size.height),
          ratioOf(screen.width, screen.height),
        );

  return (
    <div
      data-slot="crop-preview"
      // Over the picture and under every control: the hero is clickable and the
      // lightbox has arrows hanging off the edges of its picture, and neither
      // may stop taking a press because the bars are up.
      className="pointer-events-none absolute inset-0"
    >
      {/* The discarded regions. Exactly one pair is ever drawn, because cropping
          to fill overflows on one axis only — and a wallpaper of the Screen's
          own shape draws neither. */}
      {plan && plan.side > 0 && (
        <>
          <Bar edge="left" share={plan.side} />
          <Bar edge="right" share={plan.side} />
        </>
      )}
      {plan && plan.band > 0 && (
        <>
          <Bar edge="top" share={plan.band} />
          <Bar edge="bottom" share={plan.band} />
        </>
      )}

      {/* The kept region, outlined so the boundary between kept and lost is
          unambiguous, and the caption so the line is always readable: it sits
          across the bottom of the whole picture rather than inside what
          survives, because a wallpaper cropped almost out of existence leaves
          a kept region too narrow to hold its own percentage.

          An `outline` drawn inwards rather than a border: a border would take
          its two pixels out of the region it is marking, and on the axis that is
          not cropped the edge it draws is the edge of the picture, where an
          outline drawn outwards would fall outside the box entirely.

          It is drawn for a wallpaper that loses nothing too. "This is what your
          screen keeps" is worth saying when the answer is all of it, and an
          outline around the whole picture is what says so. A wallpaper with no
          Dimensions gets no outline, because there is no region to claim. */}
      <div
        data-slot="crop-kept"
        style={
          plan
            ? {
                left: percent(plan.side),
                right: percent(plan.side),
                top: percent(plan.band),
                bottom: percent(plan.band),
              }
            : { inset: 0 }
        }
        // One pixel at 70%, the prototype's line: enough to mark the boundary
        // without a white frame competing with the picture inside it.
        className={cn(
          "absolute",
          plan && "outline-1 -outline-offset-1 outline-white/70",
        )}
      />
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-2">
        <p
          data-slot="crop-caption"
          className="max-w-full rounded-md bg-neutral-950/80 px-2 py-1 text-center text-[11px] wrap-anywhere text-white tabular-nums"
        >
          {cropCaption(screen, plan)}
        </p>
      </div>
    </div>
  );
}

/** A share as CSS reads one. */
function percent(share: number): string {
  return `${share * 100}%`;
}

/**
 * One discarded region.
 *
 * The edge determines position and axis; the share determines thickness.
 */
function Bar({
  edge,
  share,
}: {
  edge: "left" | "right" | "top" | "bottom";
  share: number;
}) {
  const vertical = edge === "left" || edge === "right";
  return (
    <div
      data-slot="crop-bar"
      // Which edge it sits on, because that is the whole of what a bar says and
      // happy-dom lays nothing out: a test can see that a wide wallpaper lost
      // its sides and a tall one its top and bottom, where a width in percent is
      // the arithmetic `layout-plan.test.ts` already pins.
      data-edge={edge}
      style={{
        [edge]: 0,
        ...(vertical
          ? { top: 0, bottom: 0, width: percent(share) }
          : { left: 0, right: 0, height: percent(share) }),
      }}
      className="absolute bg-neutral-950/70"
    />
  );
}
