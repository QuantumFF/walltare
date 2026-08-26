import App from "@/App";
import { AppProvider, useApp } from "@/context/AppContext";
import type { Settings, Stats } from "@/lib/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import { deferred, flush, settings, stats, wallpaper } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

const scanInput = () => screen.queryByPlaceholderText("/home/user/wallpapers");

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

beforeEach(() => {
  // RankView is what the bootstrap redirect lands on; give it a pair to show.
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_settings", () => settings());
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
