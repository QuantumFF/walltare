import App from "@/App";
import { AppProvider, useApp } from "@/context/AppContext";
import type { Settings, Stats } from "@/lib/client";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  deferred,
  desktopColorScheme,
  flush,
  settings,
  stats,
  wallpaper,
} from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

/** How many times the provider has asked for a pre-generation pass. */
let pregenStarts = 0;

const scanInput = () => screen.queryByPlaceholderText("/home/user/wallpapers");

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

afterEach(cleanup);

afterEach(() => {
  // The document element outlives a render, so both the palette class and the
  // desktop underneath it have to go back before the next test arranges its own.
  document.documentElement.classList.remove("light", "dark");
  desktopColorScheme("light");
});

beforeEach(() => {
  // RankView is what the bootstrap redirect lands on; give it a pair to show.
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_settings", () => settings());
  // The provider starts pre-generation as soon as the gate settles, so every
  // render in this file reaches this command.
  pregenStarts = 0;
  mockCommand("start_pregen", () => {
    pregenStarts++;
    return null;
  });
});

test("a library that already has wallpapers opens on rank, not scan", async () => {
  mockCommand("get_stats", () => stats({ total_wallpapers: 3 }));

  render(<App />);
  await flush();

  // Nothing else navigates here: the scan screen is the only entry point, so
  // without the bootstrap every launch after the first strands the user on it.
  expect(screen.queryByAltText("Left Wallpaper")).not.toBeNull();
  expect(scanInput()).toBeNull();
});

test("an empty library stays on scan", async () => {
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));

  render(<App />);
  await flush();

  expect(scanInput()).not.toBeNull();
  expect(screen.queryByAltText("Left Wallpaper")).toBeNull();
});

test("a stats lookup that fails leaves the user on scan", async () => {
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to load library stats/);

  render(<App />);
  await flush();

  expect(scanInput()).not.toBeNull();
});

test("nothing renders until the settings read has landed", async () => {
  // The reason the gate exists: a screen that reads a setting must not paint
  // once against the defaults and again against the stored choice.
  const held = deferred<Settings>();
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
  mockCommand("get_settings", () => held.promise);

  render(<App />);
  await flush();

  expect(scanInput()).toBeNull();

  held.resolve(settings());
  await flush();

  expect(scanInput()).not.toBeNull();
});

test("nothing renders until the stats read has landed", async () => {
  const held = deferred<Stats>();
  mockCommand("get_stats", () => held.promise);

  render(<App />);
  await flush();

  expect(scanInput()).toBeNull();

  held.resolve(stats({ total_wallpapers: 0 }));
  await flush();

  expect(scanInput()).not.toBeNull();
});

test("the stored settings are readable from useApp", async () => {
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
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

test("a settings read that fails still starts the app, on the defaults", async () => {
  // A bad row must not lock the curator out of the app that would let them fix
  // it, so boot logs the failure and carries on with the defaults standing.
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
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
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
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
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
  mockCommand("get_settings", () => settings({ theme: "light" }));

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: true, dark: false });
});

test("a stored theme of system takes the palette from the desktop", async () => {
  desktopColorScheme("dark");
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
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
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
  mockCommand("get_settings", () => held.promise);

  render(<App />);
  await flush();

  expect(palette()).toEqual({ light: false, dark: false });

  held.resolve(settings({ theme: "dark" }));
  await flush();

  expect(palette()).toEqual({ light: false, dark: true });
});

test("the pre-generation pass starts once the boot gate has settled", async () => {
  // The frontend owns the trigger (ADR 0012), and it fires after the gate so
  // decoding cannot compete with the first paint. A re-render must not fire it
  // again: each call cancels and joins the pass before it.
  const held = deferred<Settings>();
  mockCommand("get_stats", () => stats({ total_wallpapers: 3 }));
  mockCommand("get_settings", () => held.promise);

  const { rerender } = render(<App />);
  await flush();

  expect(pregenStarts).toBe(0);

  held.resolve(settings());
  await flush();

  expect(pregenStarts).toBe(1);

  rerender(<App />);
  await flush();

  expect(pregenStarts).toBe(1);
});

test("a scan-complete starts the pre-generation pass again", async () => {
  // Freshly scanned rows sit at zero comparisons, which is the head of the
  // pass's queue, so the restart is what warms what the app will show next.
  mockCommand("get_stats", () => stats({ total_wallpapers: 3 }));

  render(<App />);
  await flush();

  expect(pregenStarts).toBe(1);

  await act(async () => {
    emitEvent("scan-complete", { added_count: 2, scanned_count: 5 });
  });
  await flush();

  expect(pregenStarts).toBe(2);
});

test("a pre-generation start that fails leaves the app where it booted", async () => {
  // Nothing the curator can see depends on the pass: the views it warms all
  // generate on demand, so a refused start is logged and the boot stands.
  mockCommand("get_stats", () => stats({ total_wallpapers: 3 }));
  mockCommand("start_pregen", () =>
    Promise.reject({ kind: "db", message: "locked database" }),
  );
  expectConsoleError(/Failed to start thumbnail pre-generation/);

  render(<App />);
  await flush();

  expect(screen.queryByAltText("Left Wallpaper")).not.toBeNull();
  expect(scanInput()).toBeNull();
});

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

  expect(scanInput()).not.toBeNull();
});
