import App from "@/App";
import { AppProvider, useApp } from "@/context/AppContext";
import type { Settings, Stats } from "@/lib/client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  deferred,
  desktopColorScheme,
  emptyStats,
  flush,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { mockCommand } from "./ipc-mocks";

/**
 * The scan screen's path field, which Settings hosts until #77 replaces it.
 * Present only while Settings is up, because Settings is the one view the shell
 * unmounts.
 */
const scanInput = () => screen.queryByPlaceholderText("/home/user/wallpapers");

/** The Settings view's own body, which is where boot writes why it landed here. */
const settingsView = () =>
  document.querySelector('[data-slot="view"][data-view="settings"]');

/**
 * A twelve-row library with `eligible` of them Eligible and nothing compared
 * yet — the two middle rows of ADR 0015's boot table, which differ only in that
 * count. Spelled out so the numbers stay a library the backend could report:
 * the rule reads `total_wallpapers` and `eligible_count` both.
 */
function withEligible(eligible: number): Stats {
  return stats({
    total_wallpapers: 12,
    eligible_count: eligible,
    round: 1,
    round_participated_count: 0,
    evaluated_count: 0,
    total_comparisons: 0,
  });
}

/** The palette classes index.css keys off, in the order light-then-dark. */
function palette(): { light: boolean; dark: boolean } {
  const { classList } = document.documentElement;
  return {
    light: classList.contains("light"),
    dark: classList.contains("dark"),
  };
}

/** Reports the settings `useApp` hands out, so a test can read them back. */
function SettingsProbe() {
  const { settings } = useApp();
  return <span data-testid="settings">{JSON.stringify(settings)}</span>;
}

function probedSettings(): Settings {
  const json = screen.getByTestId("settings").textContent ?? "";
  return JSON.parse(json) as Settings;
}

/** Reports a whole navigation, and offers the two calls that make one. */
function NavigationProbe() {
  const { view, returnTo, focus, setView } = useApp();
  return (
    <>
      <span data-testid="navigation">{`${view}|${returnTo}|${focus}`}</span>
      <button
        onClick={() =>
          setView("settings", {
            returnTo: "library",
            focus: "reject_destination",
          })
        }
      >
        deep link
      </button>
      <button onClick={() => setView("rank")}>plain</button>
    </>
  );
}

const probedNavigation = () => screen.getByTestId("navigation").textContent;

afterEach(cleanup);

afterEach(() => {
  // The document element outlives a render, so both the palette class and the
  // desktop underneath it have to go back before the next test arranges its own.
  document.documentElement.classList.remove("light", "dark");
  desktopColorScheme("light");
});

beforeEach(() => {
  // Rank is where the first row of the boot table lands; give it a pair to show.
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_settings", () => settings());
  // The shell starts pre-generation as soon as it mounts, which is as soon as
  // the boot gate settles, so every `<App />` in this file reaches this command.
  mockCommand("start_pregen", () => null);
});

// ADR 0015's boot table, one test per row. Boot reads what the library holds
// rather than `library_root`, because a configured root proves the curator
// typed something and not that a scan ever succeeded — and nothing is
// persisted, so where they happened to be last plays no part either.

test("a library with two Eligible wallpapers opens on Rank", async () => {
  // Two is exactly what `get_pair` needs, so it is the boundary the rule is
  // written on rather than a comfortable margin.
  mockCommand("get_stats", () => withEligible(2));

  render(<App />);
  await flush();

  expect(showingView()).toBe("rank");
  expect(screen.queryByAltText("Left Wallpaper")).not.toBeNull();
  expect(scanInput()).toBeNull();
});

test("a library with fewer than two Eligible opens on Library", async () => {
  // One wallpaper left in the pool cannot be compared against anything, and a
  // wholly Rejected library is the same row: Rank would have nothing but an
  // error string, while Library is where a Restore is.
  for (const eligible of [1, 0]) {
    mockCommand("get_stats", () => withEligible(eligible));

    render(<App />);
    await flush();

    expect(showingView()).toBe("library");
    expect(screen.queryByAltText("Left Wallpaper")).toBeNull();
    expect(scanInput()).toBeNull();

    cleanup();
  }
});

test("an empty library opens on Settings, dressed as a first run", async () => {
  mockCommand("get_stats", () => emptyStats());

  render(<App />);
  await flush();

  expect(showingView()).toBe("settings");
  // Settings hosts the scan screen until #77, so the invitation has something
  // to invite the curator into.
  expect(scanInput()).not.toBeNull();
  expect(settingsView()?.textContent).toContain("Your library is empty");
  expect(settingsView()?.textContent).not.toContain(
    "couldn't read your library",
  );
});

test("a library that will not read opens on Settings, saying that instead", async () => {
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to load library stats/);

  render(<App />);
  await flush();

  expect(showingView()).toBe("settings");
  expect(settingsView()?.textContent).toContain("couldn't read your library");
  // The backend's message verbatim: it is the only account of the fault there
  // is, and no canned sentence can name the lock.
  expect(settingsView()?.textContent).toContain("locked database");
  expect(settingsView()?.textContent).not.toContain("Your library is empty");
});

test("the two rows that both open Settings do not render the same thing", async () => {
  // The bug this replaces: one screen served both, so a curator whose database
  // would not open was told they had never scanned.
  mockCommand("get_stats", () => emptyStats());
  render(<App />);
  await flush();
  const firstRun = settingsView()?.textContent ?? "";

  cleanup();
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to load library stats/);
  render(<App />);
  await flush();
  const unreadable = settingsView()?.textContent ?? "";

  expect(firstRun).not.toBe("");
  expect(unreadable).not.toBe(firstRun);
});

test("nothing renders until the settings read has landed", async () => {
  // The reason the gate exists: a screen that reads a setting must not paint
  // once against the defaults and again against the stored choice.
  const held = deferred<Settings>();
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => held.promise);

  render(<App />);
  await flush();

  expect(scanInput()).toBeNull();

  held.resolve(settings());
  await flush();

  expect(scanInput()).not.toBeNull();
});

test("nothing renders until the stats read has landed", async () => {
  // And this one is the boot rule itself: the view is computed from the answer,
  // so there is no honest view to paint before it arrives.
  const held = deferred<Stats>();
  mockCommand("get_stats", () => held.promise);

  render(<App />);
  await flush();

  expect(scanInput()).toBeNull();

  held.resolve(emptyStats());
  await flush();

  expect(scanInput()).not.toBeNull();
});

test("the stored settings are readable from useApp", async () => {
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () =>
    settings({
      theme: "dark",
      library_root: "~/pics",
      reject_destination: "/bin/walls",
    }),
  );

  render(
    <AppProvider>
      <SettingsProbe />
    </AppProvider>,
  );
  await flush();

  expect(probedSettings()).toEqual({
    theme: "dark",
    library_root: "~/pics",
    reject_destination: "/bin/walls",
  });
});

test("a navigation carries where it came from and the field to focus", async () => {
  // The shape ADR 0020 needs: a control anywhere in the app can send the
  // curator to one Settings field and have the page close back to where they
  // were. The field key is `keyof Settings`, so a caller cannot name one that
  // is not there.
  mockCommand("get_stats", () => emptyStats());

  render(
    <AppProvider>
      <NavigationProbe />
    </AppProvider>,
  );
  await flush();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /deep link/i }));
  });
  expect(probedNavigation()).toBe("settings|library|reject_destination");

  // A plain navigation replaces the whole record. A `returnTo` left standing
  // would close Settings to a view the curator never came from.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /plain/i }));
  });
  expect(probedNavigation()).toBe("rank|null|null");
});

test("a settings read that fails still starts the app, on the defaults", async () => {
  // A bad row must not lock the curator out of the app that would let them fix
  // it, so boot logs the failure and carries on with the defaults standing.
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to load settings/);

  render(
    <AppProvider>
      <SettingsProbe />
    </AppProvider>,
  );
  await flush();

  expect(probedSettings()).toEqual(settings());
});

test("a stored theme of dark paints the dark palette", async () => {
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => settings({ theme: "dark" }));

  render(<App />);
  await flush();

  // The desktop underneath is light, so the stored choice is the only thing
  // that could have put the dark palette on the document.
  expect(palette()).toEqual({ light: false, dark: true });
});

test("a stored theme of light paints the light palette on a dark desktop", async () => {
  // The other direction of the same property, and the one frame ADR 0010
  // accepts as wrong-coloured before the gate settles.
  desktopColorScheme("dark");
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => settings({ theme: "light" }));

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: true, dark: false });
});

test("a stored theme of system takes the palette from the desktop", async () => {
  desktopColorScheme("dark");
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => settings({ theme: "system" }));

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: false, dark: true });

  cleanup();
  document.documentElement.classList.remove("light", "dark");
  desktopColorScheme("light");

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: true, dark: false });
});

test("no palette is written until the settings read has landed", async () => {
  // Until then the `prefers-color-scheme` branch in index.css is what paints,
  // and a class written early could only name the same palette twice.
  const held = deferred<Settings>();
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => held.promise);

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: false, dark: false });

  held.resolve(settings({ theme: "dark" }));
  await flush();

  expect(palette()).toEqual({ light: false, dark: true });
});

// The pre-generation trigger and the scan subscription moved into the shell,
// where a scan that finishes on some other page still reaches them, so what
// they do now lives in `Layout.test.tsx` beside the navigation they can cause.

test("both reads failing still starts the app", async () => {
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  mockCommand("get_settings", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to load library stats/);
  expectConsoleError(/Failed to load settings/);

  render(<App />);
  await flush();

  // The unreadable-library row, on the default settings: a bad row in either
  // table must not lock the curator out of the app that would let them fix it.
  expect(showingView()).toBe("settings");
  expect(settingsView()?.textContent).toContain("couldn't read your library");
  expect(scanInput()).not.toBeNull();
});
