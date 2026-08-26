import { AppProvider, useApp } from "@/context/AppContext";
import type { Settings, Stats, Wallpaper } from "@/lib/client";
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

/**
 * An empty settings table read back, which is what most tests want: the
 * provider gates on `get_settings`, so every test that mocks `get_stats` needs
 * this beside it or nothing renders at all.
 *
 * The values are spelled out rather than taken from `DEFAULT_SETTINGS`, so what
 * a test arranged is readable here and does not move under it when the app's
 * defaults do.
 */
export function settings(over: Partial<Settings> = {}): Settings {
  return {
    theme: "system",
    library_root: "",
    reject_destination: "./rejected",
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

/**
 * Render one view inside the real provider, with a probe for navigation.
 *
 * Awaits the provider's boot gate, so `ui` is mounted by the time this returns.
 * A command the test deliberately left pending stays pending: only the two boot
 * reads are waited on here.
 */
export async function renderInApp(ui: ReactNode) {
  const rendered = render(
    <AppProvider>
      <ViewProbe />
      {ui}
    </AppProvider>,
  );
  await flush();
  return rendered;
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
