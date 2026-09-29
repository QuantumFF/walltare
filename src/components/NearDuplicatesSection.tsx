import { Button } from "@/components/ui/button";
import {
  wallpaperImageUrl,
  type NearDuplicatePair,
  type Wallpaper,
} from "@/lib/client";
import { counted } from "@/lib/copy";
import { Check } from "lucide-react";

/**
 * The Near-duplicate pairs waiting in Review, each side by side, with a
 * keep-one answer under each wallpaper.
 *
 * Only ever mounted with a pair to show: the section is hidden while nothing is
 * waiting, so an empty one is never drawn. Answering is the page's, because a
 * keep one is a reject of the other and the page owns the toast, the Undo and
 * the patch every reject publishes.
 *
 * Every pair is `keep_one` for now. The pair carries its `kind` so the answers
 * a later kind offers can be drawn from it rather than guessed here.
 */
export function NearDuplicatesSection({
  pairs,
  onKeepOne,
}: {
  pairs: NearDuplicatePair[];
  onKeepOne: (kept: Wallpaper, other: Wallpaper) => void;
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
          other
        </span>
      </div>
      <ul className="flex gap-4 overflow-x-auto pb-2">
        {pairs.map(({ wallpapers: [a, b] }) => (
          <li
            key={`${a.id}-${b.id}`}
            aria-label={`${a.filename} and ${b.filename}`}
            className="grid w-[28rem] max-w-full shrink-0 grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3"
          >
            <Side kept={a} other={b} onKeepOne={onKeepOne} />
            <Side kept={b} other={a} onKeepOne={onKeepOne} />
          </li>
        ))}
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
