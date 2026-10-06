import { useKeptScroll, type KeptScroll } from "@/components/useKeptScroll";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

// Where the curator left a page's scroll box (ADR 0015, #421). Library and
// Discover keep it through `useKeptScroll`, so the rule is tested here once;
// that each page wires it up is `freshness.test.tsx`'s and `Layout.test.tsx`'s.

afterEach(cleanup);

let kept: KeptScroll;

function Page({ showing }: { showing: boolean }) {
  kept = useKeptScroll(showing);
  return (
    <div data-testid="rows" ref={kept.scroller} onScroll={kept.onScroll} />
  );
}

/** The box the hook keeps, as the page drew it. */
function box(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-testid="rows"]') as HTMLElement;
}

async function scrollTo(element: HTMLElement, offset: number) {
  element.scrollTop = offset;
  await act(async () => {
    fireEvent.scroll(element);
  });
}

/**
 * The shell hiding the page: `display: none` destroys the box, and a hidden
 * container reports an offset of zero, which is the case this exists for.
 */
function hide(element: HTMLElement) {
  element.scrollTop = 0;
}

test("the offset the curator scrolled to comes back when the page shows again", async () => {
  const { container, rerender } = render(<Page showing />);
  await scrollTo(box(container), 240);

  rerender(<Page showing={false} />);
  hide(box(container));
  rerender(<Page showing />);

  expect(box(container).scrollTop).toBe(240);
});

test("back to the top forgets where the curator was", async () => {
  const { container, rerender } = render(<Page showing />);
  await scrollTo(box(container), 240);

  await act(async () => {
    kept.toTop();
  });
  expect(box(container).scrollTop).toBe(0);

  rerender(<Page showing={false} />);
  rerender(<Page showing />);
  expect(box(container).scrollTop).toBe(0);
});

test("a hidden page leaves the box alone", async () => {
  const { container, rerender } = render(<Page showing />);
  await scrollTo(box(container), 240);

  rerender(<Page showing={false} />);
  hide(box(container));
  // A render while hidden, from a patch the page took under `display: none`.
  rerender(<Page showing={false} />);

  expect(box(container).scrollTop).toBe(0);
});
