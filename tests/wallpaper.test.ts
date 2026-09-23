import { shapeOf } from "@/lib/wallpaper";
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
