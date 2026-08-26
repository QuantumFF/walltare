// PROTOTYPE ONLY. Throwaway code for issue #59. Do not build on this.
//
// Five housings for background work in variant A. Same timeline, same copy,
// same events underneath: the only variable is where the report lives and what
// happens to it when the work stops.
//
// Three of them render here. `toast` and `quiet` render nothing during the run
// and put everything in ADR 0017's single toast slot, which ToolbarShell owns,
// so they are the two that have to answer what happens when a Keep lands
// mid-pass and replaces the report.

import { Loader2, X } from "lucide-react";
import {
  outcomeMessage,
  percent,
  phaseLabel,
  phaseShort,
  type WorkState,
} from "../backgroundWork";

/**
 * Round one's answer: 2px across the full width of the chrome. Kept as the
 * baseline, because "better than a stray rule under the brand" is a low bar
 * and the alternatives should have to clear it visibly.
 *
 * The scan half has no denominator, so it can only sweep. That is not a
 * rendering choice: `scan-progress` carries `{scanned, added}` and no total.
 */
export function ProgressSeam({ work }: { work: WorkState }) {
  const pct = percent(work);
  const scanning = work.phase === "walking" || work.phase === "inserting";

  if (!scanning && pct === null) return <div className="h-[2px] w-full" />;

  return (
    <div className="h-[2px] w-full overflow-hidden bg-transparent">
      {scanning ? (
        <div className="proto-sweep h-full w-1/3 bg-foreground/40" />
      ) : (
        <div
          className="h-full bg-foreground/40 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}

/**
 * A chip in the chrome row, left of the gear. The bet: background work is a
 * status, not a measurement, so it wants the smallest thing that can be
 * present and then absent. Clicking it lands on Settings, where ADR 0020 put
 * the Cancel button.
 */
export function ProgressChip({
  work,
  onSettings,
}: {
  work: WorkState;
  onSettings: () => void;
}) {
  const busy = work.phase === "walking" || work.phase === "inserting" || work.phase === "pregen";

  if (busy) {
    return (
      <button
        onClick={onSettings}
        title={phaseLabel(work)}
        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="tabular-nums">{phaseShort(work)}</span>
      </button>
    );
  }

  if (!work.outcome) return null;
  const message = outcomeMessage(work.outcome);

  return (
    <button
      onClick={onSettings}
      title={message.detail ?? message.title}
      className={[
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
        message.tone === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {message.title}
    </button>
  );
}

/**
 * Its own row, the last one in the header, below the page's second bar. The
 * bet: work that runs for minutes and changes what the library holds deserves
 * a sentence and a way to stop it. The cost is the one thing variant A
 * promised never to do, which is change the height above the page. Both bars
 * above it hold still; the page is what moves.
 */
export function ProgressStrip({
  work,
  onCancel,
  onDismiss,
}: {
  work: WorkState;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const pct = percent(work);
  const scanning = work.phase === "walking" || work.phase === "inserting";
  const message = work.outcome ? outcomeMessage(work.outcome) : null;

  if (!scanning && pct === null && !message) return null;

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-border/60 bg-secondary/40 px-4 text-xs">
      {message ? (
        <>
          <span
            className={message.tone === "error" ? "font-medium text-destructive" : "font-medium"}
          >
            {message.title}
          </span>
          {message.detail && <span className="text-muted-foreground">{message.detail}</span>}
        </>
      ) : (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="tabular-nums">{phaseLabel(work)}</span>
          <div className="h-1 w-48 overflow-hidden rounded-full bg-secondary">
            {scanning ? (
              <div className="proto-sweep h-full w-1/3 bg-foreground/50" />
            ) : (
              <div
                className="h-full bg-foreground/50 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-1">
        {work.phase === "pregen" && (
          <button onClick={onCancel} className="rounded px-2 py-1 hover:bg-accent">
            Cancel
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The pinned toast. ADR 0017 has `duration: Infinity` and an explicit close
 * already, for errors, so a pass that runs for fourteen minutes costs no new
 * machinery. What it costs is the slot: the next Keep replaces it.
 */
export function ProgressToast({
  work,
  onCancel,
  onDismiss,
}: {
  work: WorkState;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const pct = percent(work);
  const scanning = work.phase === "walking" || work.phase === "inserting";
  const message = work.outcome ? outcomeMessage(work.outcome) : null;

  if (!scanning && pct === null && !message) return null;

  return (
    <div className="w-80 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {message ? (
            <>
              <p
                className={[
                  "text-sm font-medium",
                  message.tone === "error" ? "text-destructive" : "",
                ].join(" ")}
              >
                {message.title}
              </p>
              {message.detail && (
                <p className="mt-0.5 text-xs text-muted-foreground">{message.detail}</p>
              )}
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="tabular-nums">{phaseLabel(work)}</span>
              </p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
                {scanning ? (
                  <div className="proto-sweep h-full w-1/3 bg-foreground/50" />
                ) : (
                  <div
                    className="h-full bg-foreground/50 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
            </>
          )}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {work.phase === "pregen" && (
        <button
          onClick={onCancel}
          className="mt-2 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
