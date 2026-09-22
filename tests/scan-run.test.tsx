import {
  AppEventsProvider,
  useAppEvent,
  type AppEvent,
} from "@/context/AppEventsContext";
import {
  ScanRunProvider,
  useScanOutcome,
  useScanRun,
  type ScanOutcome,
  type ScanRun,
} from "@/context/ScanRunContext";
import type { Stats } from "@/lib/client";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { flush, stats } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

// One scan, from the click to how it ended, against the module that owns it and
// nothing else: no shell, no toast, no page. What the endings say is
// `background-report.test.tsx`'s; what a finished scan does to the shell is
// `Layout.test.tsx`'s. Here is which ending a scan had, what it told the other
// views, and whether one is running.

/** The `Stats` `get_stats` answers with right now, so a scan can move it. */
let library: Stats;
/** The commands the start sequence made, in the order the backend heard them. */
let calls: string[];
let outcomes: ScanOutcome[];
let published: AppEvent[];
/** The run as the probe last rendered it. */
let run: ScanRun;

afterEach(cleanup);

beforeEach(() => {
  // A mid-life library on Round 3, so the Round has somewhere to move back from.
  library = stats();
  calls = [];
  outcomes = [];
  published = [];

  mockCommand("get_stats", () => library);
  mockCommand("start_scan", (args) => {
    calls.push(`start_scan ${args.path}`);
    return null;
  });
});

function Probe() {
  run = useScanRun();
  useScanOutcome((outcome) => outcomes.push(outcome));
  useAppEvent((event) => published.push(event));
  return null;
}

async function mount() {
  render(
    <AppEventsProvider>
      <ScanRunProvider>
        <Probe />
      </ScanRunProvider>
    </AppEventsProvider>,
  );
  await flush();
}

/** The store a Settings field hands over, recording that it was reached. */
async function store(folder: string) {
  calls.push(`store ${folder}`);
}

async function start(folder: string) {
  await act(async () => {
    await run.start(folder, store);
  });
  await flush();
}

async function emit(name: string, payload: unknown) {
  await act(async () => {
    emitEvent(name, payload);
  });
  await flush();
}

test("a scan stores the folder, then walks it, and runs from the click", async () => {
  await mount();
  expect(run.state).toEqual({ running: false });

  await start("~/pics");

  // The order ADR 0010 fixed: the store learns the folder, then the walk starts
  // on the same string, unexpanded (ADR 0011).
  expect(calls).toEqual(["store ~/pics", "start_scan ~/pics"]);
  // Running before any event, because the walk emits nothing until it is over.
  expect(run.state).toEqual({ running: true, run: 1, progress: null });

  await emit("scan-progress", { scanned: 412, added: 38 });
  expect(run.state).toEqual({
    running: true,
    run: 1,
    progress: { scanned: 412, added: 38 },
  });

  await emit("scan-complete", { added_count: 38, scanned_count: 412 });
  expect(run.state).toEqual({ running: false });
});

test("a second start while one is running does nothing", async () => {
  await mount();
  await start("~/pics");
  await start("~/other");

  // No command cancels a scan, and a second `start_scan` would answer
  // `InvalidTransition` with a sentence the curator can do nothing about.
  expect(calls).toEqual(["store ~/pics", "start_scan ~/pics"]);
});

test("a scan that never got going rejects, and is not running", async () => {
  mockCommand("start_scan", () =>
    Promise.reject({ kind: "invalid_path", message: "/nope" }),
  );
  await mount();

  let refused: unknown = null;
  await act(async () => {
    await run.start("/nope", store).catch((error: unknown) => {
      refused = error;
    });
  });
  await flush();

  // What to say about it is the field's, where the fix is typed (ADR 0020), so
  // the refusal comes back to the caller whole and nothing ends as an outcome.
  expect(refused).toEqual({ kind: "invalid_path", message: "/nope" });
  expect(run.state).toEqual({ running: false });
  expect(outcomes).toEqual([]);
});

test("a walk that turned up nothing is an empty folder, named as written", async () => {
  await mount();
  await start("~/Pictures/wallpapers");

  await emit("scan-complete", { added_count: 0, scanned_count: 0 });

  // As written, `~` and all: expanding it would hide the typo this ending
  // exists to make visible (ADR 0011).
  expect(outcomes).toEqual([
    { kind: "empty", folder: "~/Pictures/wallpapers" },
  ]);
});

test("a rescan that found files and added none is nothing new, not an empty folder", async () => {
  await mount();
  await start("/library");

  await emit("scan-complete", { added_count: 0, scanned_count: 2000 });

  // The common case on every rescan, and only a walk that found nothing at all
  // is an empty folder (ADR 0021).
  expect(outcomes).toEqual([{ kind: "nothing-new", scanned: 2000 }]);
});

test("a scan that added wallpapers says how many, and the Round it sent the library back to", async () => {
  await mount();
  await start("/library");

  // 412 unseen files with no comparisons between them, so the Round goes from
  // 3 to 1 (ADR 0008).
  library = stats({
    total_wallpapers: 424,
    eligible_count: 422,
    round: 1,
    round_participated_count: 10,
  });
  await emit("scan-complete", { added_count: 412, scanned_count: 2000 });

  expect(outcomes).toEqual([{ kind: "added", added: 412, backToRound: 1 }]);
});

test("a scan that added wallpapers to a library already on Round 1 moved no Round", async () => {
  // A number that did not move needs no explanation, which is why this is a
  // comparison against the Round before the walk and not a sentence attached
  // to every count.
  library = stats({
    round: 1,
    round_participated_count: 10,
    evaluated_count: 0,
  });
  await mount();
  await start("/library");

  await emit("scan-complete", { added_count: 6, scanned_count: 18 });

  expect(outcomes).toEqual([{ kind: "added", added: 6, backToRound: null }]);
});

test("a scan the frontend did not start has no Round to compare, and reports anyway", async () => {
  await mount();

  await emit("scan-progress", { scanned: 40, added: 3 });
  // It opens a run of its own on the first event it hears.
  expect(run.state).toEqual({
    running: true,
    run: 1,
    progress: { scanned: 40, added: 3 },
  });

  library = stats({ round: 1 });
  await emit("scan-complete", { added_count: 3, scanned_count: 40 });

  // Nobody read the Round before this walk, so there is nothing to say it moved
  // from — and an explanation the frontend cannot back up is not given.
  expect(outcomes).toEqual([{ kind: "added", added: 3, backToRound: null }]);
});

test("a scan that failed ends with the backend's own account, and is not running", async () => {
  await mount();
  await start("/library");

  await emit("scan-failed", { message: "permission denied: /library/private" });

  expect(run.state).toEqual({ running: false });
  expect(outcomes).toEqual([
    { kind: "failed", message: "permission denied: /library/private" },
  ]);
});

test("every finished scan tells the views which rows exist, and one that added tells Rank the Round", async () => {
  await mount();
  await start("/library");

  library = stats({ total_wallpapers: 15, round: 1 });
  await emit("scan-complete", { added_count: 3, scanned_count: 40 });
  await start("/library");
  await emit("scan-complete", { added_count: 0, scanned_count: 40 });

  // `library-scanned` on both, zero included, because zero is the answer
  // "nothing changed" and the views owe no refetch for it. `stats-changed` only
  // where the scan could have moved the headline, carrying the read the ending
  // was judged on (ADR 0015).
  expect(published).toEqual([
    { type: "library-scanned", added: 3 },
    { type: "stats-changed", stats: stats({ total_wallpapers: 15, round: 1 }) },
    { type: "library-scanned", added: 0 },
  ]);
});
