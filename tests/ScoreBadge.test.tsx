import { ScoreBadge } from "@/components/ScoreBadge";
import type { Wallpaper } from "@/lib/client";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { wallpaper } from "./fixtures";

// The Score badge, drawn the same way on the card and in the lightbox (#421).
// What the card and the lightbox hand it is theirs to test; what it draws from
// a row and a threshold is tested here.

afterEach(cleanup);

/** A wallpaper with a Score, at the fixtures' starting σ unless told. */
function scored(over: Partial<Wallpaper> = {}): Wallpaper {
  return wallpaper(1, { comparisons_count: 14, rating_mu: 22.4, ...over });
}

function badge(
  w: Wallpaper,
  {
    threshold = 4,
    moved = false,
  }: { threshold?: number; moved?: boolean } = {},
): HTMLElement {
  const { container } = render(
    <ScoreBadge wallpaper={w} evaluatedThreshold={threshold} moved={moved} />,
  );
  const found = container.querySelector<HTMLElement>('[data-slot="badge"]');
  if (!found) throw new Error("no Score badge");
  return found;
}

test("the badge is the Score to one decimal, and Unrated for a wallpaper in no Comparison", () => {
  expect(badge(scored({ rating_mu: 22.45 })).textContent).toBe("22.4");
  cleanup();
  // Every wallpaper at zero comparisons holds the same starting 25.0, which is
  // the app's ignorance rather than a judgement, so it says so (ADR 0013).
  expect(
    badge(scored({ comparisons_count: 0, rating_mu: 25 })).textContent,
  ).toBe("Unrated");
});

test("the badge is dimmed until the wallpaper is Evaluated", () => {
  // The whole live library, and the fixtures' default: σ 8.333 is twice the
  // threshold, so the number on the badge is provisional and reads that way.
  const provisional = badge(scored());
  expect(provisional.className).toContain("bg-black/50");
  expect(provisional.className).not.toContain("bg-white");
  expect(provisional.getAttribute("title")).toBe("Not yet Evaluated");
  cleanup();

  // Under the threshold the app trusts the number, and one visual state says
  // so. No second number and no bands: there is one definition of confidence.
  const trusted = badge(scored({ rating_sigma: 3.9 }));
  expect(trusted.className).toContain("bg-white");
  expect(trusted.getAttribute("title")).toBe("Evaluated");
});

test("the badge reads against the threshold it is handed", () => {
  // One wallpaper, three curators. σ 4.5 is not confident enough for the app as
  // it shipped and is for a curator who asked to be told sooner (ADR 0046).
  const rated = scored({ rating_sigma: 4.5 });
  const titles = [5, 4, 3].map((threshold) => {
    const title = badge(rated, { threshold }).getAttribute("title");
    cleanup();
    return title;
  });
  expect(titles).toEqual([
    "Evaluated",
    "Not yet Evaluated",
    "Not yet Evaluated",
  ]);
});

test("a wallpaper in no Comparison is Evaluated at no threshold the page offers", () => {
  // The starting σ is 8.333, above the loosest choice, so the dimmed badge and
  // `Unrated` agree without either checking the other.
  for (const threshold of [5, 4, 3]) {
    const unrated = badge(scored({ comparisons_count: 0, rating_mu: 25 }), {
      threshold,
    });
    expect(unrated.textContent).toBe("Unrated");
    expect(unrated.getAttribute("title")).toBe("Not yet Evaluated");
    cleanup();
  }
});

test("a Score a Comparison moved says so in place of a number, and keeps its tone", () => {
  const moved = badge(scored({ rating_sigma: 3.9 }), { moved: true });
  expect(moved.textContent).toBe("Score moved");
  expect(moved.getAttribute("title")).toBe("Evaluated");
  expect(moved.className).toContain("bg-white");
});
