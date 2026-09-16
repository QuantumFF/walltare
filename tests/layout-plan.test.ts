import {
  layoutPlan,
  planUniformGrid,
  uniformRowHeight,
  windowOf,
} from "@/lib/layout-plan";
import { expect, test } from "bun:test";

// Where the cards go, worked out before any of them exists.
//
// The one seam in this work that needs no DOM, and the reason it is a seam at
// all: happy-dom does no layout and reports every box as zero, so a row height
// taken off a mounted card is zero under test and a window built on it mounts
// nothing (#131). Everything a curator sees about the layout — which card is in
// which row, how tall a row is, which cards a scroll offset puts on screen —
// falls out of these functions, so this is where it can be asserted at all.

/** The grid's own spacing: `gap-6` between cards, `p-4` at both ends. */
const SPACING = { gap: 24, padding: 16 };

/** The uniform grid, as the app wears it: every card cropped to `aspect-video`. */
const UNIFORM = { ...SPACING, cardRatio: 9 / 16, unmeasuredHeight: 130 };

/** The uniform grid at a width, the way `WallpaperGrid` composes the two halves. */
function uniformGrid(count: number, columns: number, width: number) {
  return planUniformGrid({
    ...SPACING,
    count,
    columns,
    rowHeight: uniformRowHeight({ ...UNIFORM, columns, width }),
  });
}

test("a row is as tall as the cards sharing its width, at every column count", () => {
  // The box less the padding at both ends, less a gap between every pair,
  // divided by the count and shaped by the ratio the card crops to.
  const height = (width: number, columns: number) =>
    ((width - 32 - 24 * (columns - 1)) / columns) * (9 / 16);

  for (const [width, columns] of [
    [700, 2],
    [900, 3],
    [1200, 4],
    [1500, 5],
  ]) {
    expect(uniformRowHeight({ ...UNIFORM, width, columns })).toBeCloseTo(
      height(width, columns),
    );
  }

  // And it falls with the width rather than with the count: five cards in the
  // box four were sharing are five narrower cards, so the row is shorter.
  expect(
    uniformRowHeight({ ...UNIFORM, width: 1200, columns: 5 }),
  ).toBeLessThan(uniformRowHeight({ ...UNIFORM, width: 1200, columns: 4 }));
});

test("a box that measures nothing gives rows about a card tall rather than none", () => {
  // The branch every happy-dom run takes, and the one a real browser takes for a
  // view the shell is hiding under `display: none` (ADR 0015). Rows of zero
  // height are a window over nothing, so every card would lose its node.
  const plan = uniformGrid(8, 4, 0);
  expect(plan.rows.map((row) => row.height)).toEqual([130, 130]);

  // Not only at exactly zero: a box narrower than its own padding and gaps
  // leaves the cards no width at all, which is the same nothing to divide.
  expect(uniformRowHeight({ ...UNIFORM, width: 100, columns: 5 })).toBe(130);
});

test("the uniform grid cuts the list into rows of the column count, in reading order", () => {
  const plan = uniformGrid(9, 4, 1200);

  // Nine cards over three rows, the last of them short — the wrapping a CSS
  // grid's own auto-flow produces, which is what the curator is looking at.
  expect(plan.rows.map((row) => row.cards)).toEqual([
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8],
  ]);
  // And every card knows its row, which is what a selection moving to a card
  // with no node needs before it can be focused (ADR 0019).
  expect(plan.rowOfCard).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2]);
});

test("an empty list plans no rows and occupies its own padding", () => {
  const plan = uniformGrid(0, 4, 1200);
  expect(plan.rows).toEqual([]);
  expect(plan.total).toBe(32);
  // Nothing to mount, and no space held open for cards that are not there.
  expect(windowOf(plan, 0, 0)).toEqual({ cards: [], before: 0, after: 0 });
});

test("rows sit below one another, a gap apart, inside the grid's padding", () => {
  const plan = layoutPlan(
    [
      { cards: [0, 1], height: 100 },
      { cards: [2, 3], height: 250 },
      { cards: [4], height: 40 },
    ],
    SPACING,
  );

  // The leading padding, then each row's own height with a gap between
  // consecutive rows. A plan that assumed one height for all three would put the
  // third row 210px above where its cards actually are.
  expect(plan.rows.map((row) => row.top)).toEqual([16, 140, 414]);
  // And the scroll height is everything plus the padding at the far end.
  expect(plan.total).toBe(470);
});

test("a plan of varying row heights windows onto the cards those rows hold", () => {
  // The property the uniform grid cannot show, because all its rows are the same
  // height and hold the same number of cards. Every layout after this one has
  // rows that differ in both, and the window has to read them rather than
  // multiply an index by a column count (#261).
  const plan = layoutPlan(
    [
      { cards: [0, 1, 2], height: 100 },
      { cards: [3], height: 400 },
      { cards: [4, 5], height: 200 },
      { cards: [6, 7, 8, 9], height: 80 },
    ],
    SPACING,
  );

  const middle = windowOf(plan, 1, 2);
  // The cards of the rows asked for, in drawing order, and no others: a window
  // over rows 1 and 2 is one card and then two, not two rows of a fixed width.
  expect(middle.cards).toEqual([3, 4, 5]);
  // The space above is exactly where row 1 starts, so the mounted rows land
  // where the scroll offset says they are rather than 300px off it.
  expect(middle.before).toBe(140);
  // And the space below holds the rest of the scroll height open: row 3 and the
  // two gaps around it, plus the trailing padding.
  expect(middle.after).toBe(plan.total - (plan.rows[2].top + 200));
  expect(middle.before + 400 + 24 + 200 + middle.after).toBe(plan.total);

  // The ends of the plan, where the padding is the space rather than a row.
  expect(windowOf(plan, 0, 0)).toEqual({
    cards: [0, 1, 2],
    before: 16,
    after: plan.total - 116,
  });
  const whole = windowOf(plan, 0, plan.rows.length - 1);
  expect(whole.cards).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(whole.before).toBe(16);
  expect(whole.after).toBe(16);
});

test("a window past the end of a plan mounts what is left rather than nothing", () => {
  // The list shrinks under a scrolled window — a keep, a reject, a filter change
  // — and the rows asked for are the ones the last plan had. The cards that are
  // still there are the answer; a window that returned nothing would empty the
  // grid until the next scroll event.
  const plan = layoutPlan(
    [
      { cards: [0, 1], height: 100 },
      { cards: [2], height: 100 },
    ],
    SPACING,
  );

  expect(windowOf(plan, 1, 9).cards).toEqual([2]);
  expect(windowOf(plan, 4, 9).cards).toEqual([2]);
  expect(windowOf(plan, -3, 0).cards).toEqual([0, 1]);
});

test("a uniform plan holds the scroll height its own rows add up to", () => {
  // The number a virtualiser holds the scroll range open with, and the one a
  // scrollbar's length is drawn from. It has to be the rows, their gaps and the
  // padding and nothing else, or the last row is unreachable or the list ends in
  // empty space.
  const plan = uniformGrid(400, 4, 1200);
  const height = uniformRowHeight({ ...UNIFORM, width: 1200, columns: 4 });

  expect(plan.rows.length).toBe(100);
  expect(plan.total).toBeCloseTo(100 * height + 99 * 24 + 32);
  const last = plan.rows[99];
  expect(last.top + last.height).toBeCloseTo(plan.total - 16);
});
