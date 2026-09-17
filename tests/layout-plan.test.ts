import {
  fittedBox,
  densityColumns,
  densityZoom,
  layoutPlan,
  planMasonry,
  planUniformGrid,
  ratioOf,
  UNKNOWN_RATIO,
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

/**
 * Masonry as the app wears it: 16:9 for a wallpaper whose Dimensions nothing has
 * read, and the same fallback height as the grid for a box that measures nothing
 * (ADR 0044).
 */
const MASONRY = { ...SPACING, unknownRatio: 9 / 16, unmeasuredHeight: 130 };

/** Masonry at a width, the way `WallpaperGrid` composes it. */
function masonry(
  ratios: ReadonlyArray<number | null>,
  columns: number,
  width: number,
) {
  return planMasonry({ ...MASONRY, ratios, columns, width });
}

/** The uniform grid at a width, the way `WallpaperGrid` composes the two halves. */
function uniformGrid(count: number, columns: number, width: number) {
  return planUniformGrid({
    ...SPACING,
    count,
    columns,
    rowHeight: uniformRowHeight({ ...UNIFORM, columns, width }),
  });
}

// The density: how far a zoom moves the column count, and where it stops
// (#264). Arithmetic over four numbers, so it is asserted here rather than
// through a grid — what a mounted grid can show is that the arrows move by the
// count, which is `WallpaperGrid.test.tsx`'s question.

/**
 * Library's bounds and Review's, which differ at the far end only.
 *
 * Restated here rather than imported, the way `SPACING` above restates the
 * grid's `gap-6` and `p-4`: the real pair is private to `WallpaperGrid.tsx`,
 * and that module builds its media queries off `window` as it loads — so
 * importing it would give this unit seam a DOM to have, which is the whole
 * thing it exists without.
 */
const LIBRARY = { min: 2, max: 8 };
const REVIEW = { min: 2, max: 6 };

test("a zoom of nothing is the count the viewport asked for", () => {
  // The curator who never makes the gesture gets exactly the grid that was
  // there before, at every breakpoint the app has.
  for (const base of [2, 3, 4, 5]) {
    expect(densityColumns(base, 0, LIBRARY)).toBe(base);
    expect(densityColumns(base, 0, REVIEW)).toBe(base);
  }
});

test("a step in is a card fewer, and a step out a card more", () => {
  // In is larger cards, which is fewer of them — the direction a map and a
  // browser both move under the same gesture.
  expect(densityColumns(4, 1, LIBRARY)).toBe(3);
  expect(densityColumns(4, 2, LIBRARY)).toBe(2);
  expect(densityColumns(4, -1, LIBRARY)).toBe(5);
  expect(densityColumns(4, -3, LIBRARY)).toBe(7);
});

test("the breakpoints keep applying underneath a zoom", () => {
  // The reason the state is a number of steps and not a column count. A curator
  // one step in is one step in at every width, rather than pinned to whatever
  // number the width they were at happened to be showing — so a window dragged
  // narrow narrows the grid with it.
  expect(densityColumns(5, 1, LIBRARY)).toBe(4);
  expect(densityColumns(3, 1, LIBRARY)).toBe(2);
});

test("the count stops at each tab's own bounds", () => {
  // Review's far end is six and Library's is eight: a worklist of fifty has no
  // scale to buy at the far end, and a browse surface over five thousand does.
  expect(densityColumns(4, -8, REVIEW)).toBe(6);
  expect(densityColumns(4, -8, LIBRARY)).toBe(8);
  // And both go equally large, which is the end where the wallpaper is the
  // point on either page.
  expect(densityColumns(4, 9, REVIEW)).toBe(2);
  expect(densityColumns(4, 9, LIBRARY)).toBe(2);
});

test("a step at the wall banks nothing for the way back to spend", () => {
  // The zoom is clamped where it is written rather than where it is read. Six
  // steps out of Review's range leaves the zoom at the wall, so one step back
  // in moves the grid — where an unclamped zoom of -6 would need five presses
  // before anything on screen changed, which is a curator making a gesture and
  // watching it do nothing.
  let zoom = 0;
  for (let at = 0; at < 6; at++) zoom = densityZoom(4, zoom, -1, REVIEW);
  expect(densityColumns(4, zoom, REVIEW)).toBe(6);

  zoom = densityZoom(4, zoom, 1, REVIEW);
  expect(densityColumns(4, zoom, REVIEW)).toBe(5);

  // The same at the other end.
  for (let at = 0; at < 9; at++) zoom = densityZoom(4, zoom, 1, REVIEW);
  expect(densityColumns(4, zoom, REVIEW)).toBe(2);
  expect(densityColumns(4, densityZoom(4, zoom, -1, REVIEW), REVIEW)).toBe(3);
});

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

// The hero's box, which is the other thing happy-dom structurally cannot check:
// the Review strip measures its area and computes the picture's box from it, and
// under a runner that lays nothing out every rect is zero. The arithmetic is
// here, so the property a curator sees — one wallpaper as large as its own shape
// allows — is assertable without a layout engine (#265).

test("a wallpaper's shape is its own, and 16:9 while nothing has read it", () => {
  expect(ratioOf(1920, 1080)).toBeCloseTo(16 / 9);
  expect(ratioOf(2560, 1080)).toBeCloseTo(2560 / 1080);
  expect(ratioOf(1080, 1920)).toBeCloseTo(1080 / 1920);

  // A library still being backfilled is the ordinary state, not an edge case:
  // a row with no Dimensions is drawn rather than waited for (ADR 0044).
  expect(ratioOf(null, null)).toBe(UNKNOWN_RATIO);
  expect(ratioOf(1920, null)).toBe(UNKNOWN_RATIO);
  expect(ratioOf(null, 1080)).toBe(UNKNOWN_RATIO);
  // A row someone wrote by hand. Nothing divides by it.
  expect(ratioOf(0, 1080)).toBe(UNKNOWN_RATIO);
  expect(ratioOf(1920, 0)).toBe(UNKNOWN_RATIO);
  expect(ratioOf(-1920, 1080)).toBe(UNKNOWN_RATIO);
});

test("the hero fills whichever axis runs out first, and never overflows the other", () => {
  // An area wider than the wallpaper: the height is what is used up, and the
  // width follows from the ratio.
  const wide = fittedBox({ width: 1200, height: 400 }, 16 / 9);
  expect(wide.height).toBeCloseTo(400);
  expect(wide.width).toBeCloseTo(400 * (16 / 9));
  expect(wide.width).toBeLessThanOrEqual(1200);

  // An area taller than the wallpaper: the width is what is used up.
  const tall = fittedBox({ width: 600, height: 900 }, 16 / 9);
  expect(tall.width).toBeCloseTo(600);
  expect(tall.height).toBeCloseTo(600 / (16 / 9));
  expect(tall.height).toBeLessThanOrEqual(900);

  // A portrait wallpaper in a landscape area, which is the case the uniform
  // grid could never show: the box is tall and narrow rather than cropped.
  const portrait = fittedBox({ width: 1200, height: 800 }, 1080 / 1920);
  expect(portrait.height).toBeCloseTo(800);
  expect(portrait.width).toBeCloseTo(800 * (1080 / 1920));
});

test("the hero's box is exactly the wallpaper's own shape, whatever the area", () => {
  // The property #266 depends on: the crop preview draws its bars as
  // percentages of this box, so any letterboxing inside it would be measured as
  // if it were the picture.
  for (const ratio of [16 / 9, 21 / 9, 4 / 3, 1, 1080 / 1920]) {
    for (const area of [
      { width: 1200, height: 800 },
      { width: 300, height: 900 },
      { width: 1920, height: 200 },
    ]) {
      const box = fittedBox(area, ratio);
      expect(box.width / box.height).toBeCloseTo(ratio);
      expect(box.width).toBeLessThanOrEqual(area.width + 0.001);
      expect(box.height).toBeLessThanOrEqual(area.height + 0.001);
    }
  }
});

test("an area with nothing in it is a box with nothing in it", () => {
  // Not an edge case: happy-dom reports every rect as zero, and ADR 0015 hides
  // a view with `display: none`, which zeroes the box in a browser too. The
  // caller holds its last measurement and a fallback under that.
  expect(fittedBox({ width: 0, height: 0 }, 16 / 9)).toEqual({
    width: 0,
    height: 0,
  });
  expect(fittedBox({ width: 1200, height: 0 }, 16 / 9)).toEqual({
    width: 0,
    height: 0,
  });
  expect(fittedBox({ width: 0, height: 800 }, 16 / 9)).toEqual({
    width: 0,
    height: 0,
  });
});

// Masonry (#262): every wallpaper at its own aspect ratio, packed into columns
// shortest-first. This is the part of that work happy-dom structurally cannot
// check — which card is in which column, how tall it is drawn, and which cards a
// scroll offset puts on screen are all facts about a layout, and there is no
// layout under test.

test("masonry draws every wallpaper at its own shape, and a 16:9 box for one it has not measured", () => {
  // A 16:9, a square, a 4:3 portrait, and a wallpaper still waiting on the
  // backfill. The last is the one that must not collapse: drawn at a ratio of
  // nothing it would be a card of no height, in a column that then swallows
  // every card after it (ADR 0044).
  const plan = masonry([9 / 16, 1, 4 / 3, null], 4, 1200);

  for (const [at, shape] of [9 / 16, 1, 4 / 3, 9 / 16].entries()) {
    const box = plan.boxes[at];
    expect(box.height / box.width).toBeCloseTo(shape);
    expect(box.height).toBeGreaterThan(0);
  }
});

test("the columns are equal and together they fill the width", () => {
  // Eight cards over four columns, so every column is used. A column width the
  // gaps and the padding were not taken out of would run the last column off the
  // right-hand edge of the scroll box.
  const plan = masonry(Array.from({ length: 8 }, () => 9 / 16), 4, 1200);

  // (1200 - 32 of padding - 72 of gaps) / 4.
  expect(plan.boxes.map((box) => box.width)).toEqual(Array(8).fill(274));
  expect([...new Set(plan.boxes.map((box) => box.left))]).toEqual([
    16, 314, 612, 910,
  ]);
  const last = plan.boxes[3];
  expect(last.left + last.width).toBe(1200 - 16);
});

test("each wallpaper goes to whichever column is shortest, and a tall one is not stacked on", () => {
  // Three columns 200px wide. The second wallpaper is twice as tall as the
  // others, which is the case the whole layout exists for: the cards after it
  // fill the two short columns rather than queueing underneath it.
  const plan = masonry([1, 2, 1, 1, 1], 3, 680);

  expect(plan.boxes.map((box) => box.height)).toEqual([
    200, 400, 200, 200, 200,
  ]);
  // Columns 0, 1, 2, then back to 0 and 2 — the two that the 400px card left
  // shortest. Ties go leftmost, so the order down the page still reads as the
  // order the curator asked for.
  expect(plan.boxes.map((box) => box.left)).toEqual([16, 240, 464, 16, 464]);
  expect(plan.boxes.map((box) => box.top)).toEqual([16, 16, 16, 240, 240]);

  // And the scroll height is the tallest column's bottom plus the trailing
  // padding, rather than every card's height added up.
  expect(plan.total).toBe(456);
});

test("a masonry window mounts a card that started above it, exactly once", () => {
  // The property that separates masonry's rows from the grid's. Its rows are
  // bands between card tops, and a card taller than a band is listed in each
  // band it crosses — so a window has to mount it while it is on screen without
  // mounting it twice, which would be two nodes claiming one cell index.
  const plan = masonry([1, 2, 1, 1, 1], 3, 680);

  expect(plan.rows.map((row) => row.cards)).toEqual([
    [0, 1, 2],
    [1, 3, 4],
  ]);
  // The tall card is still on screen in the second band and is mounted there.
  expect(windowOf(plan, 1, 1).cards).toEqual([1, 3, 4]);
  // Over both bands it is one node, and the cards come in list order.
  expect(windowOf(plan, 0, 1).cards).toEqual([0, 1, 2, 3, 4]);

  // The way back is the band holding a card's own top, so revealing a card
  // scrolls to where it starts rather than to where it ends.
  expect(plan.rowOfCard).toEqual([0, 0, 0, 1, 1]);
});

test("a masonry plan's bands account for the whole scroll height", () => {
  // The number a virtualiser holds the scroll range open with. The bands carry
  // their own spacing — they run from one card top to the next — so they are
  // stacked with no gap between them, and the total has to come out the same as
  // the tallest column's bottom.
  const plan = masonry([1, 2, 1, 1, 1], 3, 680);

  expect(plan.rows.map((row) => row.top)).toEqual([16, 240]);
  const last = plan.rows[plan.rows.length - 1];
  expect(last.top + last.height).toBe(plan.total - 16);
  const whole = windowOf(plan, 0, plan.rows.length - 1);
  expect(whole.before).toBe(16);
  expect(whole.after).toBe(16);
});

test("a box that measures nothing gives masonry cards about a card tall rather than none", () => {
  // The branch every happy-dom run takes, and the one a real browser takes for a
  // view the shell is hiding under `display: none` (ADR 0015). With no width to
  // divide there is no ratio to apply, so every card takes the fallback height
  // and the columns pack round-robin — which is the uniform grid's own answer to
  // the same nothing.
  const plan = masonry([9 / 16, 1, 4 / 3, null, 9 / 16], 2, 0);

  expect(plan.boxes.map((box) => box.height)).toEqual(Array(5).fill(130));
  expect(plan.boxes.map((box) => box.top)).toEqual([16, 16, 170, 170, 324]);
  expect(plan.rows.length).toBe(3);
});

test("a masonry plan of a whole library windows onto a few dozen cards", () => {
  // ADR 0016's ceiling, at the ratios a real library has. What the window mounts
  // has to stay a few dozen out of five thousand however uneven the rows get,
  // and every one of them has to be there once.
  const shapes = [9 / 16, 1, 4 / 3, 10 / 21, null];
  const plan = masonry(
    Array.from({ length: 5000 }, (_, at) => shapes[at % shapes.length]),
    4,
    1200,
  );

  expect(plan.boxes.length).toBe(5000);
  // Six bands is about a screen of a 1200px-wide library.
  const mounted = windowOf(plan, 40, 45);
  expect(mounted.cards.length).toBeLessThan(40);
  expect(new Set(mounted.cards).size).toBe(mounted.cards.length);
  // And the space above plus the mounted bands plus the space below is the whole
  // scroll height, which is what stops the list shifting under a scroll.
  const first = plan.rows[40];
  const last = plan.rows[45];
  expect(mounted.before).toBe(first.top);
  expect(mounted.before + (last.top + last.height - first.top)).toBeCloseTo(
    plan.total - mounted.after,
  );
});

test("masonry plans nothing for an empty library and occupies its own padding", () => {
  const plan = masonry([], 4, 1200);
  expect(plan.rows).toEqual([]);
  expect(plan.boxes).toEqual([]);
  expect(plan.total).toBe(32);
});
