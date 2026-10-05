import {
  EMPTY_SLOTS,
  owed,
  reduceSlots,
  type SlotAction,
  type Slots,
} from "@/components/useShowingQueue";
import type { Showing } from "@/lib/client";
import { expect, test } from "bun:test";
import { wallpaper } from "./fixtures";

// Rank's slot transitions, one action at a time. The hook around this reducer
// owns the clock, the fetches and the bus; what moves where is all here, so it
// is pinned here without a timer or a mock. `RankView.test.tsx` keeps the
// wiring.

function showing(...ids: number[]): Showing {
  return ids.map((id) => wallpaper(id)) as Showing;
}

function run(slots: Slots, ...actions: SlotAction[]): Slots {
  return actions.reduce(reduceSlots, slots);
}

const ids = (s: Showing | null) => s?.map((w) => w.id) ?? null;

const A = showing(1, 2);
const B = showing(3, 4);
const C = showing(5, 6);

/** A on screen, B behind it, nothing in flight. */
const READY: Slots = run(
  EMPTY_SLOTS,
  { type: "draw-sent" },
  { type: "drawn", showing: A },
  { type: "prefetch-sent" },
  { type: "prefetched", ticket: 1, showing: B },
);

/** A on screen, a prefetch for behind it still out. */
const PREFETCHING: Slots = run(
  EMPTY_SLOTS,
  { type: "draw-sent" },
  { type: "drawn", showing: A },
  { type: "prefetch-sent" },
);

const castOn: SlotAction = { type: "vote-cast", best: 1, worst: 2 };

test("an empty queue owes a draw, then a prefetch, then nothing", () => {
  expect(owed(EMPTY_SLOTS)).toBe("draw");
  expect(owed(run(EMPTY_SLOTS, { type: "draw-sent" }))).toBeNull();
  expect(owed(PREFETCHING)).toBeNull();
  expect(owed(run(PREFETCHING, { type: "prefetch-failed", ticket: 1 }))).toBe(
    "prefetch",
  );
  expect(owed(READY)).toBeNull();
});

test("a draw that failed on an empty screen is not owed again", () => {
  const failed = run(
    EMPTY_SLOTS,
    { type: "draw-sent" },
    { type: "draw-failed", failure: "not-enough" },
  );
  expect(failed.failure).toBe("not-enough");
  expect(owed(failed)).toBeNull();
});

test("a prefetch lands only under the ticket it was sent with", () => {
  const voided = run(
    PREFETCHING,
    { type: "draw-sent" },
    { type: "drawn", showing: C },
  );
  expect(voided.prefetch).toBeNull();
  expect(run(voided, { type: "prefetched", ticket: 1, showing: B })).toBe(
    voided,
  );

  const resent = run(voided, { type: "prefetch-sent" });
  expect(resent.prefetch).toBe(2);
  expect(
    ids(run(resent, { type: "prefetched", ticket: 2, showing: B }).next),
  ).toEqual([3, 4]);
});

test("a skip voids the prefetch out and empties the slot behind", () => {
  const sent = run(READY, { type: "draw-sent" });
  expect(sent.pending).toEqual({ kind: "draw" });
  const skipped = run(sent, { type: "drawn", showing: C });
  expect(ids(skipped.current)).toEqual([5, 6]);
  expect(skipped.next).toBeNull();
  expect(owed(skipped)).toBe("prefetch");
});

test("a vote swaps in the prefetched showing after the beat, and its answer fills the slot behind", () => {
  const cast = run(READY, castOn);
  expect(cast.pending).toEqual({ kind: "vote", best: 1, worst: 2, votedOn: A });
  expect(cast.current).toBe(A); // through the beat, the pick shows on A

  const swapped = run(cast, { type: "beat-ended" });
  expect(swapped.current).toBe(B);
  expect(swapped.next).toBeNull();
  expect(owed(swapped)).toBeNull(); // the answer will fill it

  const answered = run(swapped, { type: "vote-answered", next: C });
  expect(answered.current).toBe(B);
  expect(answered.next).toBe(C);
  expect(answered.pending).toBeNull();
});

test("a vote with nothing prefetched is replaced by its answer, and the prefetch out is voided", () => {
  const cast = run(PREFETCHING, castOn, { type: "beat-ended" });
  expect(cast.current).toBe(A);
  expect(cast.prefetch).toBeNull();

  const answered = run(cast, { type: "vote-answered", next: C });
  expect(answered.current).toBe(C);
  expect(owed(answered)).toBe("prefetch");
});

test("an answer with no showing leaves the slot it would have filled empty", () => {
  const swapped = run(
    READY,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-answered",
      next: null,
    },
  );
  expect(swapped.current).toBe(B);
  expect(owed(swapped)).toBe("prefetch");

  // Never left on the showing just voted on: the screen empties, and the
  // draw that fills it stays clear of what was voted on.
  const unswapped = run(
    PREFETCHING,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-answered",
      next: null,
    },
  );
  expect(unswapped.current).toBeNull();
  expect(unswapped.left).toEqual([1, 2]);
  expect(unswapped.failure).toBeNull();
  expect(owed(unswapped)).toBe("draw");
});

test("a failed vote puts both slots back as they were, and says so", () => {
  const failed = run(
    READY,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: false,
    },
  );
  expect(failed.current).toBe(A);
  expect(failed.next).toBe(B);
  expect(failed.failure).toBe("vote");
  expect(failed.pending).toBeNull();
  expect(owed(failed)).toBeNull();

  // The next pick clears it.
  expect(run(failed, castOn).failure).toBeNull();
});

test("a vote refused for a Rejected wallpaper moves on without a failure", () => {
  const swapped = run(
    READY,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: true,
    },
  );
  expect(swapped.current).toBe(B);
  expect(swapped.failure).toBeNull();
  expect(owed(swapped)).toBe("prefetch");

  const unswapped = run(
    PREFETCHING,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: true,
    },
  );
  expect(unswapped.current).toBeNull();
  expect(unswapped.failure).toBeNull();
  expect(owed(unswapped)).toBe("draw");
});

test("a wallpaper leaving the pool from no slot changes nothing, to the object", () => {
  expect(run(READY, { type: "left-pool", id: 9 })).toBe(READY);
});

test("a wallpaper leaving the pool from the slot behind empties it", () => {
  const left = run(READY, { type: "left-pool", id: 4 });
  expect(left.current).toBe(A);
  expect(left.next).toBeNull();
  expect(owed(left)).toBe("prefetch");
});

test("a wallpaper leaving the pool from the screen moves the showing behind up", () => {
  const failed = run(
    READY,
    castOn,
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: false,
    },
  );
  const left = run(failed, { type: "left-pool", id: 2 });
  expect(left.current).toBe(B);
  expect(left.next).toBeNull();
  // The failure was about the showing that went.
  expect(left.failure).toBeNull();
  expect(owed(left)).toBe("prefetch");

  // With nothing behind, the screen empties and the draw for it stays clear
  // of what was left of the showing.
  const empty = run(left, { type: "left-pool", id: 3 });
  expect(empty.current).toBeNull();
  expect(empty.left).toEqual([4]);
  expect(owed(empty)).toBe("draw");
});

test("a wallpaper leaving the pool from the screen voids the prefetch drawn behind it", () => {
  const left = run(PREFETCHING, { type: "left-pool", id: 1 });
  expect(left.current).toBeNull();
  expect(run(left, { type: "prefetched", ticket: 1, showing: B })).toBe(left);
});

test("a wallpaper leaving the pool during a pick's beat leaves nothing to vote on or put back", () => {
  const cast = run(READY, castOn);
  const left = run(cast, { type: "left-pool", id: 1 });
  expect(left.pending).toEqual({
    kind: "vote",
    best: 1,
    worst: 2,
    votedOn: null,
  });
  expect(left.current).toBe(B);
  expect(owed(left)).toBeNull(); // the vote is still pending

  // Nothing behind B to swap in, and nothing to restore once it settles.
  const settled = run(
    left,
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: true,
    },
  );
  expect(settled.current).toBe(B);
  expect(settled.failure).toBeNull();
  expect(owed(settled)).toBe("prefetch");

  // Emptied as well, the screen keeps what the drop said to stay clear of.
  const emptied = run(
    left,
    { type: "left-pool", id: 3 },
    { type: "beat-ended" },
    {
      type: "vote-failed",
      refused: true,
    },
  );
  expect(emptied.current).toBeNull();
  expect(emptied.left).toEqual([4]);
  expect(owed(emptied)).toBe("draw");
});

test("a wallpaper leaving the pool from the showing swapped in leaves the answer to fill the screen", () => {
  const swapped = run(READY, castOn, { type: "beat-ended" });
  const left = run(swapped, { type: "left-pool", id: 3 });
  expect(left.current).toBeNull();

  const answered = run(left, { type: "vote-answered", next: C });
  expect(answered.current).toBe(C);
  expect(owed(answered)).toBe("prefetch");

  // And a failure puts back the showing voted on, which is still whole.
  const failed = run(left, { type: "vote-failed", refused: false });
  expect(failed.current).toBe(A);
  expect(failed.next).toBeNull();
  expect(failed.failure).toBe("vote");
});

test("showings of four move through the same slots", () => {
  const four = showing(1, 2, 3, 4);
  const behind = showing(5, 6, 7, 8);
  const slots = run(
    EMPTY_SLOTS,
    { type: "draw-sent" },
    { type: "drawn", showing: four },
    { type: "prefetch-sent" },
    { type: "prefetched", ticket: 1, showing: behind },
    { type: "vote-cast", best: 2, worst: 4 },
    { type: "beat-ended" },
    { type: "vote-answered", next: showing(9, 10, 11, 12) },
  );
  expect(ids(slots.current)).toEqual([5, 6, 7, 8]);
  expect(ids(slots.next)).toEqual([9, 10, 11, 12]);

  const left = run(slots, { type: "left-pool", id: 7 });
  expect(ids(left.current)).toEqual([9, 10, 11, 12]);
});
