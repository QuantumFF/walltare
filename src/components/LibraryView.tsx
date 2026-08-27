import { PageBar } from "@/components/PageBar";
import { Images } from "lucide-react";

/**
 * Interim, and it is meant to read as one. #79 builds the library page: the
 * grid, the card, the filter and the ordering, with the filter row going into
 * the bar below rather than into the chrome.
 *
 * What lands here is the destination itself, because ADR 0015 disables no tab —
 * a disabled tab is a dead end that explains nothing — and every view owes an
 * empty state that says why it is empty and where to go instead.
 */
export function LibraryView() {
  return (
    <>
      <PageBar>
        {/* #79 replaces this with the filter and the ordering. */}
        <span className="font-medium">Library</span>
      </PageBar>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <h1 className="sr-only">Library</h1>
        <Images className="h-10 w-10 text-muted-foreground/30" aria-hidden />
        <p className="text-sm text-muted-foreground">
          The library page isn't built yet. Rank compares wallpapers two at a
          time, and Review lists the lowest Scores.
        </p>
      </div>
    </>
  );
}
