import type { RejectDestination } from "@/components/RejectDestination";
import { useToaster } from "@/components/ToastSurface";
import { Button } from "@/components/ui/button";
import {
  useAppEvent,
  useAppEvents,
  useRefetchWhenShown,
} from "@/context/AppEventsContext";
import { useKeyboardHandoff } from "@/context/KeyboardHandoffContext";
import {
  client,
  isStaleRow,
  wallpaperImageUrl,
  type NearDuplicatePair,
  type Wallpaper,
} from "@/lib/client";
import { counted } from "@/lib/copy";
import { useBackendEvents } from "@/lib/useBackendEvents";
import { Check, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface NearDuplicates {
  /** The pairs waiting, empty until the first listing lands or while none are. */
  pairs: NearDuplicatePair[];
  /** Lists the pairs again now, for the page's Refresh. */
  refresh: () => void;
  /**
   * The keep-one answer: `other` is soft-rejected into the stored destination,
   * the way a card's Reject is, and the toast says so with the same Undo.
   */
  keepOne: (kept: Wallpaper, other: Wallpaper) => void;
  /**
   * The keep-both answer: the pair is recorded as Distinct and leaves the
   * section, and neither wallpaper's Status changes.
   */
  keepBoth: (pair: NearDuplicatePair) => void;
}

/**
 * The Near-duplicate pairs waiting in Review, and the answers to them.
 *
 * `restore` is the page's own Restore, which is what the answer's Undo presses:
 * it brings the rejected wallpaper back, and the pair with it.
 */
export function useNearDuplicates({
  destination,
  restore,
}: {
  destination: RejectDestination;
  restore: (wallpaper: Wallpaper) => void;
}): NearDuplicates {
  const [pairs, setPairs] = useState<NearDuplicatePair[]>([]);
  const { publish } = useAppEvents();
  const { show } = useToaster();
  const handOff = useKeyboardHandoff();

  // A listing that will not load costs the section and not the page.
  const fetchPairs = useCallback(async () => {
    try {
      setPairs(await client.listNearDuplicates());
    } catch (err) {
      console.error("Failed to list Near-duplicates:", err);
    }
  }, []);
  const refresh = useCallback(() => void fetchPairs(), [fetchPairs]);

  // Owed rather than made while Review is hidden, for the reason every
  // listing's refetch is (ADR 0015): after a scan, after pre-generation, which
  // is what writes the hashes pairs are worked out from, and after any Status
  // change, since a reject takes a pair away and a Restore brings one back.
  const owe = useRefetchWhenShown("review", refresh);
  useAppEvent((event) => {
    if (event.type === "status-changed") owe();
  });
  useBackendEvents({ pregenComplete: owe });
  useEffect(refresh, [refresh]);

  /**
   * It hands the keyboard back on every press that lands, the keyboard's too,
   * because the pair leaves with the button that answered it (ADR 0047).
   *
   * The toast is built here rather than by `useWallpaperRows`, whose four
   * transitions are the Status table's: this reject goes through `keep_one`,
   * which refuses a pair that is no longer waiting.
   */
  const keepOne = async (kept: Wallpaper, other: Wallpaper) => {
    try {
      const rejected = await client.keepOne(
        kept.id,
        other.id,
        destination.written,
      );
      publish({ type: "status-changed", wallpaper: rejected });
      show({
        kind: "rejected",
        filename: other.filename,
        renamed: rejected.filename !== other.filename,
        moved: rejected.path !== other.path,
        relativeDestination: destination.relative,
        finalPath: rejected.path,
        undo: () => restore(rejected),
      });
      handOff();
    } catch (error) {
      console.error("Failed to keep one Near-duplicate:", error);
      show({
        kind: "failed",
        action: "reject",
        filename: other.filename,
        error,
      });
      // A pair that stopped waiting underneath the page, which the listing is
      // owed for.
      if (isStaleRow(error)) refresh();
    }
  };

  /**
   * Hands the keyboard back for `keepOne`'s reason. No toast on success: there
   * is nothing to undo, since Distinct is a record, and the pair leaving is
   * the answer landing. Only this pair leaves, so the others stay as listed.
   */
  const keepBoth = async (pair: NearDuplicatePair) => {
    const [a, b] = pair.wallpapers;
    try {
      await client.keepBoth(a.id, b.id);
      setPairs((listed) => listed.filter((p) => !samePair(p, pair)));
      handOff();
    } catch (error) {
      console.error("Failed to keep both Near-duplicates:", error);
      show({
        kind: "save-failed",
        noun: `keep both for ${a.filename} and ${b.filename}`,
        error,
      });
      if (isStaleRow(error)) refresh();
    }
  };

  return {
    pairs,
    refresh,
    keepOne: (kept, other) => void keepOne(kept, other),
    keepBoth: (pair) => void keepBoth(pair),
  };
}

/** Whether two listed pairs are the same two wallpapers. */
const samePair = (p: NearDuplicatePair, q: NearDuplicatePair) =>
  p.wallpapers[0].id === q.wallpapers[0].id &&
  p.wallpapers[1].id === q.wallpapers[1].id;

/**
 * The Near-duplicate pairs waiting in Review, each side by side, with a
 * keep-one answer under each wallpaper and keep both under the two.
 *
 * Only ever mounted with a pair to show: the section is hidden while nothing is
 * waiting, so an empty one is never drawn. Answering is `useNearDuplicates`'s.
 *
 * Every pair is `keep_one` for now. The pair carries its `kind` so the answers
 * a later kind offers can be drawn from it rather than guessed here.
 */
export function NearDuplicatesSection({
  pairs,
  onKeepOne,
  onKeepBoth,
}: {
  pairs: NearDuplicatePair[];
  onKeepOne: (kept: Wallpaper, other: Wallpaper) => void;
  onKeepBoth: (pair: NearDuplicatePair) => void;
}) {
  return (
    <section
      aria-labelledby="near-duplicates-heading"
      data-slot="near-duplicates"
      // `shrink-0` and one row that scrolls sideways, so however many pairs are
      // waiting the section is one pair tall and the strip below keeps the
      // height its hero is sized from.
      className="mb-4 shrink-0 space-y-3"
    >
      <div className="flex items-baseline gap-2">
        <h2 id="near-duplicates-heading" className="text-sm font-medium">
          Near-duplicates
        </h2>
        <span className="text-sm text-muted-foreground">
          {counted(pairs.length, "pair")} waiting · keeping one rejects the
          other, keeping both stops asking
        </span>
      </div>
      <ul className="flex gap-4 overflow-x-auto pb-2">
        {pairs.map((pair) => {
          const [a, b] = pair.wallpapers;
          return (
            <li
              key={`${a.id}-${b.id}`}
              aria-label={`${a.filename} and ${b.filename}`}
              className="grid w-[28rem] max-w-full shrink-0 grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3"
            >
              <Side kept={a} other={b} onKeepOne={onKeepOne} />
              <Side kept={b} other={a} onKeepOne={onKeepOne} />
              <Button
                size="sm"
                variant="ghost"
                className="col-span-2 gap-2"
                aria-label={`Keep both ${a.filename} and ${b.filename}`}
                onClick={() => onKeepBoth(pair)}
              >
                <CheckCheck />
                Keep both
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One wallpaper of a pair, and the answer that keeps it. */
function Side({
  kept,
  other,
  onKeepOne,
}: {
  kept: Wallpaper;
  other: Wallpaper;
  onKeepOne: (kept: Wallpaper, other: Wallpaper) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <img
        src={wallpaperImageUrl(kept.id, "small")}
        alt={kept.filename}
        className="aspect-video w-full rounded-lg bg-black/20 object-cover"
      />
      <span className="truncate text-xs text-muted-foreground">
        {kept.filename}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="gap-2"
        aria-label={`Keep ${kept.filename}, reject ${other.filename}`}
        onClick={() => onKeepOne(kept, other)}
      >
        <Check />
        Keep this one
      </Button>
    </div>
  );
}
