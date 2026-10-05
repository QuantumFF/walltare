import { barFallsAt, isUnrated, shapeOf } from "@/lib/wallpaper";
import { expect, test } from "bun:test";
import { wallpaper } from "./fixtures";

// What the app decides about a wallpaper from its row alone, asked without
// mounting anything to ask it.

test("a wallpaper's shape comes off its own Dimensions, and is nothing at all without them", () => {
  // What masonry packs, read off the row rather than off the thumbnail: a
  // thumbnail is capped in width, so it carries the shape and not the size, and
  // the shape is all this answers (CONTEXT.md, ADR 0044).
  expect(shapeOf(wallpaper(1, { width: 1920, height: 1080 }))).toBeCloseTo(
    9 / 16,
  );
  expect(shapeOf(wallpaper(2, { width: 1600, height: 1200 }))).toBeCloseTo(
    3 / 4,
  );
  // And the same shape whatever the resolution, which is what makes it a
  // question about shape: a 5120x2160 and a 1920x810 crop of it are drawn alike.
  expect(shapeOf(wallpaper(3, { width: 5120, height: 2160 }))).toBe(
    shapeOf(wallpaper(4, { width: 1920, height: 810 })) as number,
  );

  // A row mid-backfill has no Dimensions and so no shape — not a guess. What to
  // draw instead belongs to the layout, which is the only thing that knows
  // whether it is cropping.
  expect(shapeOf(wallpaper(5, { width: null, height: null }))).toBeNull();
});

test("the Bar falls before the first scored wallpaper not below it", () => {
  const scored = (id: number, mu: number) =>
    wallpaper(id, { rating_mu: mu, comparisons_count: 3 });
  const worklist = [scored(1, 10), scored(2, 18), scored(3, 20), scored(4, 26)];

  expect(barFallsAt(worklist, 19)).toBe(2);
  // Strict about the side: a Score exactly on the Bar is not below it.
  expect(barFallsAt(worklist, 20)).toBe(2);
  // Every Score above it puts the rule at the top.
  expect(barFallsAt(worklist, 5)).toBe(0);
});

test("no Bar, or none of the worklist's Scores at it, draws no rule", () => {
  const scored = (id: number, mu: number) =>
    wallpaper(id, { rating_mu: mu, comparisons_count: 3 });
  // An Unrated tail has no Score to stand on either side, so it does not place
  // the rule even with a starting Score above the Bar.
  const worklist = [
    scored(1, 10),
    scored(2, 18),
    wallpaper(3, { rating_mu: 40 }),
  ];

  expect(barFallsAt(worklist, null)).toBeNull();
  // Everything here is below, and the Bar may be further down than the
  // worklist reaches, so no line claims to know where.
  expect(barFallsAt(worklist, 30)).toBeNull();
  expect(barFallsAt([], 30)).toBeNull();
});

test("a wallpaper is Unrated until its first Comparison, whatever Score it starts from", () => {
  expect(isUnrated(wallpaper(1, { comparisons_count: 0 }))).toBe(true);
  // A starting Score from a prediction is still no Score (ADR 0057).
  expect(
    isUnrated(wallpaper(2, { comparisons_count: 0, rating_mu: 31.2 })),
  ).toBe(true);
  expect(isUnrated(wallpaper(3, { comparisons_count: 1 }))).toBe(false);
});
