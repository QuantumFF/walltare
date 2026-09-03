import { ToastSurface } from "@/components/ToastSurface";
import { AppProvider, useApp } from "@/context/AppContext";
import { AppEventsProvider } from "@/context/AppEventsContext";
import { LightboxHostProvider } from "@/context/LightboxHostContext";
import type { CacheSize, Settings, Stats, Wallpaper } from "@/lib/client";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * One row as `list_wallpapers` would answer with it.
 *
 * The `path` follows the `filename` rather than the id, so a test that renames a
 * row gets a coherent one: the backend derives the `filename` column it stores
 * as the basename of the path it wrote, and a fixture where the two disagree is
 * a row it could never report. Every transition answers with such a row and the
 * patch carries it whole (ADR 0023), so a test arranged on an incoherent one
 * would be asserting against a wallpaper nothing produces. Pass `path` to
 * override it, which is what a Rejected row does.
 */
export function wallpaper(id: number, over: Partial<Wallpaper> = {}): Wallpaper {
  const filename = over.filename ?? `wall-${id}.jpg`;
  return {
    id,
    filename,
    path: `/library/${filename}`,
    status: "active",
    rating_mu: 25,
    rating_sigma: 8.333,
    comparisons_count: 0,
    origin_path: null,
    ...over,
  };
}

/**
 * A mid-life library the backend could actually report: 12 rows of which 10 are
 * eligible, every eligible one past two comparisons so the Round is 3, six of
 * them already through their third, and the two ahead of the pool confident
 * enough to count as Evaluated. 18 Comparisons is the pool's comparison counts
 * halved, so a test that overrides nothing reads a coherent library.
 */
export function stats(over: Partial<Stats> = {}): Stats {
  return {
    total_wallpapers: 12,
    eligible_count: 10,
    round: 3,
    round_participated_count: 6,
    evaluated_count: 2,
    total_comparisons: 18,
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

/**
 * The thumbnail cache as ADR 0020 measured it on the live machine: 48MB across
 * 172 files, which is the reading its Thumbnails line is written around. Every
 * visit to Settings walks the cache directory on mount, so this belongs beside
 * `settings()` for the same reason that one does.
 */
export function cacheSize(over: Partial<CacheSize> = {}): CacheSize {
  return { bytes: 48_200_000, files: 172, ...over };
}

/**
 * A library nothing has been scanned into: the row of ADR 0015's boot table
 * that dresses Settings as a first run. Spelled out rather than overridden off
 * `stats()`, because a `total_wallpapers` of 0 beside an Eligible pool of 10 is
 * a library the backend could never report, and the boot rule reads both.
 */
export function emptyStats(over: Partial<Stats> = {}): Stats {
  return {
    total_wallpapers: 0,
    eligible_count: 0,
    round: 1,
    round_participated_count: 0,
    evaluated_count: 0,
    total_comparisons: 0,
    ...over,
  };
}

/** Every view container in the tree, in the order the shell renders them. */
export function mountedViews(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="view"]'),
  );
}

/**
 * The one view being shown, by name. Throws if the shell is showing none or
 * more than one, which is the failure a hide-and-show swap can produce and a
 * remount cannot.
 */
export function showingView(): string {
  const shown = mountedViews().filter((el) => el.style.display !== "none");
  if (shown.length !== 1) {
    throw new Error(
      `${shown.length} views showing, of ${mountedViews().length} mounted`,
    );
  }
  return shown[0].dataset.view ?? "";
}

/** The names of the views that are in the DOM but hidden. */
export function hiddenViews(): string[] {
  return mountedViews()
    .filter((el) => el.style.display === "none")
    .map((el) => el.dataset.view ?? "");
}

/** happy-dom keeps the media-query answers on the window rather than in the DOM. */
interface DeviceWindow {
  happyDOM: { settings: { device: { prefersColorScheme: "light" | "dark" } } };
}

/**
 * Say whether the desktop underneath is light or dark, which is what
 * `matchMedia("(prefers-color-scheme: dark)")` then answers. happy-dom serves
 * the query from its own device settings, so this arranges the real media query
 * instead of standing a stub in front of it.
 *
 * It outlives the test that set it; reset it wherever it is used.
 */
export function desktopColorScheme(scheme: "light" | "dark"): void {
  const { device } = (window as unknown as DeviceWindow).happyDOM.settings;
  device.prefersColorScheme = scheme;
}

interface ViewportWindow {
  happyDOM: { setViewport: (viewport: { width: number }) => void };
}

/**
 * Set how wide the window is, which is what `matchMedia("(min-width: ...)")`
 * then answers — and so how many columns the wallpaper grid has.
 *
 * The same arrangement `desktopColorScheme` makes for the theme: the real media
 * query, given a viewport, rather than a stub in front of the component. happy-dom
 * fires `resize` from this, which is the one event the grid subscribes to.
 *
 * It outlives the test that set it; reset it wherever it is used.
 */
export function viewportWidth(width: number): void {
  (window as unknown as ViewportWindow).happyDOM.setViewport({ width });
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
 * Render one view inside the real providers, with a probe for navigation.
 *
 * Awaits the provider's boot gate, so `ui` is mounted by the time this returns.
 * A command the test deliberately left pending stays pending: only the two boot
 * reads are waited on here.
 *
 * The event bus is here because a view publishes to it as soon as the curator
 * acts — a vote publishes `stats-changed`, a keep publishes `status-changed` —
 * so a view mounted without it would throw on the first click. Nothing else
 * subscribes, which is the point: what a shell full of views does with those
 * events is `Layout.test.tsx` and `freshness.test.tsx`'s to assert.
 *
 * The toast surface is here for the same reason and with the same limit. A view
 * raises a toast on every transition and every failure, so one mounted without
 * it throws on the first click; but the shell's `Ctrl+Z` is not in this tree, so
 * what the surface does with a keyboard is `toasts.test.tsx`'s to assert against
 * the whole app.
 *
 * The lightbox host is the third, and its limit is the sharpest. Any page that
 * mounts a grid reads it, so a view mounted without it throws before it
 * renders; what it holds here is a `null` container, which Radix's `Portal`
 * answers by falling back to `document.body`, and a `setOpen` nothing listens
 * to. So the surface opens and is assertable, while the shell's half of it —
 * the `inert` on the pages behind and ADR 0021's suppressed report — belongs to
 * `Layout.test.tsx` and `background-report.test.tsx`, which render the app.
 */
const LIGHTBOX_HOST = { container: null, setOpen: () => {} };

export async function renderInApp(ui: ReactNode) {
  const rendered = render(
    <AppProvider>
      <AppEventsProvider>
        <ToastSurface>
          <LightboxHostProvider value={LIGHTBOX_HOST}>
            <ViewProbe />
            {ui}
          </LightboxHostProvider>
        </ToastSurface>
      </AppEventsProvider>
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
