// PROTOTYPE ONLY. Throwaway code for issue #59. Do not build on this.
//
// A fake event stream for the background work variant A has to report: a scan,
// the pre-generation pass that follows it, and whatever scan-complete has to
// say. Every housing in ToolbarShell renders from the state this produces, so
// the five are judged against the same timeline rather than five stills.
//
// The shape follows the real events exactly, including their gaps:
//
//   scan-progress   { scanned, added }   no total on the wire
//   scan-complete   { added_count, scanned_count }
//   pregen-progress { done, total }      ADR 0012
//   pregen-complete { generated, failed, cancelled }
//
// Two things about the scan are read off lib.rs:180-197 rather than assumed.
// `scanner::collect_images` runs to completion before the first event, so the
// directory walk is silent however long it takes. And the loop that does emit
// is chunked at SCAN_CHUNK_SIZE = 256 inserts, so the live 120-wallpaper
// library produces exactly one scan-progress event, at 100%.
//
// One second here is one minute of the real pass. ADR 0012 costs a wallpaper
// at roughly 420ms single-threaded, so 1,204 thumbnails is about 8.4 minutes
// and runs for 8.4 seconds below.

import { useCallback, useEffect, useRef, useState } from "react";

export const RUNS = ["launch", "rescan", "nothing-new", "no-images"] as const;
export type RunKind = (typeof RUNS)[number];

export const RUN_NAMES: Record<RunKind, string> = {
  launch: "launch pass — 1,204 thumbnails, no scan",
  rescan: "rescan — 412 new files, then their thumbnails",
  "nothing-new": "rescan — 2,000 files, nothing new, no pass",
  "no-images": "scan — the folder holds no images",
};

export type WorkPhase = "idle" | "walking" | "inserting" | "pregen" | "settled";

/** What scan-complete or pregen-complete concluded. Null until one of them has. */
export type Outcome =
  | { kind: "added"; added: number; roundFrom: number; roundTo: number }
  | { kind: "nothing-new"; scanned: number }
  | { kind: "no-images" }
  | { kind: "thumbnails"; generated: number };

export interface WorkState {
  phase: WorkPhase;
  /** scan-progress. `scanned` counts inserted files, not walked ones. */
  scanned: number;
  added: number;
  /** pregen-progress. */
  done: number;
  total: number;
  outcome: Outcome | null;
  running: boolean;
}

export const IDLE: WorkState = {
  phase: "idle",
  scanned: 0,
  added: 0,
  done: 0,
  total: 0,
  outcome: null,
  running: false,
};

interface Segment {
  phase: WorkPhase;
  ms: number;
}

interface Script {
  segments: Segment[];
  scanned: number;
  added: number;
  total: number;
  outcome: Outcome | null;
}

/** 420ms per wallpaper, compressed a minute to a second. */
const pregenMs = (count: number) => Math.round(count * 0.42 * (1000 / 60));

const SCRIPTS: Record<RunKind, Script> = {
  launch: {
    segments: [
      { phase: "pregen", ms: pregenMs(1204) },
      { phase: "settled", ms: 9000 },
    ],
    scanned: 0,
    added: 0,
    total: 1204,
    outcome: { kind: "thumbnails", generated: 1204 },
  },
  rescan: {
    // The walk is silent and its length is unknowable from the frontend.
    segments: [
      { phase: "walking", ms: 2200 },
      { phase: "inserting", ms: 900 },
      { phase: "pregen", ms: pregenMs(412) },
      { phase: "settled", ms: 12000 },
    ],
    scanned: 2000,
    added: 412,
    total: 412,
    // ADR 0008: 412 wallpapers at zero comparisons drag the floor to zero, so
    // the Round genuinely goes backwards and the headline must not hide it.
    outcome: { kind: "added", added: 412, roundFrom: 4, roundTo: 1 },
  },
  "nothing-new": {
    // An empty work list emits no pregen event at all (ADR 0012), so there is
    // no pass segment here. This is the every-launch case.
    segments: [
      { phase: "walking", ms: 2200 },
      { phase: "inserting", ms: 900 },
      { phase: "settled", ms: 9000 },
    ],
    scanned: 2000,
    added: 0,
    total: 0,
    outcome: { kind: "nothing-new", scanned: 2000 },
  },
  "no-images": {
    segments: [
      { phase: "walking", ms: 1600 },
      { phase: "settled", ms: 9000 },
    ],
    scanned: 0,
    added: 0,
    total: 0,
    outcome: { kind: "no-images" },
  },
};

function at(kind: RunKind, elapsed: number): WorkState {
  const script = SCRIPTS[kind];
  let start = 0;

  for (const segment of script.segments) {
    const end = start + segment.ms;
    if (elapsed >= end) {
      start = end;
      continue;
    }
    const share = segment.ms === 0 ? 1 : (elapsed - start) / segment.ms;
    const done = segment.phase === "pregen" ? Math.floor(script.total * share) : 0;
    return {
      phase: segment.phase,
      // The chunked loop emits every 256 inserts, so the counter steps rather
      // than sweeps. Rounding to a chunk boundary keeps that visible.
      scanned:
        segment.phase === "inserting"
          ? Math.min(script.scanned, Math.floor((script.scanned * share) / 256) * 256)
          : segment.phase === "walking"
            ? 0
            : script.scanned,
      added:
        segment.phase === "inserting"
          ? Math.floor(script.added * share)
          : segment.phase === "walking"
            ? 0
            : script.added,
      done,
      total: segment.phase === "pregen" ? script.total : 0,
      outcome: segment.phase === "settled" ? script.outcome : null,
      running: true,
    };
  }

  return IDLE;
}

/**
 * `?run=rescan` starts a timeline on load, and `?at=4000` freezes it that many
 * milliseconds in. Neither is written back into the URL by the harness, since
 * a moment is something you link deliberately rather than something a click
 * should pin you to.
 */
function readUrl(): { kind: RunKind; elapsed: number; frozen: boolean } | null {
  const q = new URLSearchParams(window.location.search);
  const kind = q.get("run") as RunKind | null;
  if (!kind || !RUNS.includes(kind)) return null;
  const at = Number(q.get("at"));
  const frozen = q.has("at") && Number.isFinite(at) && at >= 0;
  return { kind, elapsed: frozen ? at : 0, frozen };
}

/**
 * Drives one run. `tick` is 80ms rather than a frame, because a progress
 * surface that only reads well at 60fps is not the surface this is choosing.
 */
export function useBackgroundWork() {
  const initial = useRef(readUrl());
  const [state, setState] = useState<WorkState>(() =>
    initial.current ? at(initial.current.kind, initial.current.elapsed) : IDLE,
  );
  // `?at=` freezes a moment, so a housing mid-pass is a link and a screenshot.
  const [paused, setPaused] = useState(() => initial.current?.frozen ?? false);
  const run = useRef(initial.current ? { ...initial.current } : null);

  const start = useCallback((kind: RunKind) => {
    run.current = { kind, elapsed: 0, frozen: false };
    setPaused(false);
    setState(at(kind, 0));
  }, []);

  const stop = useCallback(() => {
    run.current = null;
    setPaused(false);
    setState(IDLE);
  }, []);

  useEffect(() => {
    if (!state.running || paused) return;
    const timer = setInterval(() => {
      const current = run.current;
      if (!current) return;
      current.elapsed += 80;
      setState(at(current.kind, current.elapsed));
    }, 80);
    return () => clearInterval(timer);
  }, [state.running, paused]);

  return { work: state, start, stop, paused, setPaused };
}

/** The two-phase label. One string, so every housing says the same words. */
export function phaseLabel(work: WorkState): string {
  switch (work.phase) {
    case "walking":
      return "Scanning…";
    case "inserting":
      return `Scanning… ${work.scanned.toLocaleString()} files, ${work.added.toLocaleString()} new`;
    case "pregen":
      return `Preparing thumbnails… ${work.done.toLocaleString()} of ${work.total.toLocaleString()}`;
    default:
      return "";
  }
}

/**
 * The short form. Deliberately a percentage rather than a count, so the axis
 * asks the ticket's third question directly: the chip says the app is busy and
 * roughly how far in, the strip and the toast say 240 of 1,204, and the
 * reaction gets to say which of those anyone wanted.
 */
export function phaseShort(work: WorkState): string {
  switch (work.phase) {
    case "walking":
    case "inserting":
      return "Scanning";
    case "pregen":
      return `Thumbnails ${percent(work) ?? 0}%`;
    default:
      return "";
  }
}

/**
 * Determinate only during pre-generation. The scan has no denominator on the
 * wire and the walk before it emits nothing, so a scan bar can only ever be
 * indeterminate. ADR 0012's "one bar with two phases" has this hole in it.
 */
export function percent(work: WorkState): number | null {
  if (work.phase !== "pregen" || work.total === 0) return null;
  return Math.round((work.done / work.total) * 100);
}

export interface Message {
  title: string;
  detail: string | null;
  tone: "info" | "error";
}

/** Glossary vocabulary only, per ADR 0017's copy rule. */
export function outcomeMessage(outcome: Outcome): Message {
  switch (outcome.kind) {
    case "added":
      return {
        title: `${outcome.added.toLocaleString()} wallpapers added`,
        detail: `Back to Round ${outcome.roundTo}. The new wallpapers have no comparisons yet.`,
        tone: "info",
      };
    case "nothing-new":
      return {
        title: "No new wallpapers",
        detail: `${outcome.scanned.toLocaleString()} files scanned, all already in your library.`,
        tone: "info",
      };
    case "no-images":
      return {
        title: "No supported images found",
        detail: "Nothing in that folder looks like an image.",
        tone: "error",
      };
    case "thumbnails":
      return {
        title: `${outcome.generated.toLocaleString()} thumbnails ready`,
        detail: null,
        tone: "info",
      };
  }
}
