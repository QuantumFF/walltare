import { AppProvider, useApp } from "@/context/AppContext";
import type { Stats, Wallpaper } from "@/lib/client";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

export function wallpaper(id: number, over: Partial<Wallpaper> = {}): Wallpaper {
  return {
    id,
    filename: `wall-${id}.jpg`,
    path: `/library/wall-${id}.jpg`,
    status: "active",
    rating_mu: 25,
    rating_sigma: 8.333,
    comparisons_count: 0,
    ...over,
  };
}

export function stats(over: Partial<Stats> = {}): Stats {
  return {
    total_wallpapers: 10,
    total_comparisons: 4,
    evaluated_count: 2,
    participated_count: 5,
    percentage: 50,
    ...over,
  };
}

/** Reports the current view so a test can assert navigation without the target view mounting. */
export function ViewProbe() {
  const { view } = useApp();
  return <span data-testid="view">{view}</span>;
}

export function currentView(): string | null {
  return screen.getByTestId("view").textContent;
}

/** Render one view inside the real provider, with a probe for navigation. */
export function renderInApp(ui: ReactNode) {
  return render(
    <AppProvider>
      <ViewProbe />
      {ui}
    </AppProvider>,
  );
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** A promise a test resolves by hand, to hold a component inside its async window. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Drain queued state updates and already-resolved promise chains. Several
 * turns because the components await two or three promises in sequence.
 */
export async function flush(turns = 4): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {});
  }
}
