import App from "@/App";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import { flush, stats, wallpaper } from "./fixtures";
import { mockCommand } from "./ipc-mocks";

const scanInput = () => screen.queryByPlaceholderText("/home/user/wallpapers");

afterEach(cleanup);

beforeEach(() => {
  // RankView is what the bootstrap redirect lands on; give it a pair to show.
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
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
