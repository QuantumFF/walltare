import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import App from "@/App";
import { wallpaperImageUrl } from "@/lib/client";
import { emitEvent, mockCommand, resetIpcMocks } from "./ipc-mocks";

afterEach(() => {
  cleanup();
  resetIpcMocks();
});

beforeEach(() => {
  mockCommand("start_scan", () => null);
});

async function startScan(path = "/tmp/wallpapers") {
  const input = screen.getByPlaceholderText("/home/user/wallpapers");
  await act(async () => {
    fireEvent.change(input, { target: { value: path } });
  });
  const button = screen.getByRole("button", { name: /start ranking/i });
  await act(async () => {
    fireEvent.click(button);
  });
}

test("imageUrl builds wallpaper scheme urls", () => {
  expect(wallpaperImageUrl(7)).toBe("wallpaper://image/7?size=full");
  expect(wallpaperImageUrl(7, "small")).toBe("wallpaper://image/7?size=small");
  expect(wallpaperImageUrl(42, "medium")).toBe("wallpaper://image/42?size=medium");
});

test("valid scan shows progress then lands on the rank placeholder", async () => {
  render(<App />);
  expect(screen.getByPlaceholderText("/home/user/wallpapers")).toBeDefined();

  await startScan();

  // Progress feedback while events stream in.
  await waitFor(() => {
    expect(screen.getByText(/scanning collection/i)).toBeDefined();
  });

  await act(async () => {
    emitEvent("scan-progress", { scanned: 256, added: 256 });
  });
  expect(screen.getByText(/256 scanned/i)).toBeDefined();

  await act(async () => {
    emitEvent("scan-complete", { added_count: 256 });
  });

  // Lands on the rank placeholder once wallpapers were added.
  expect(await screen.findByRole("heading", { name: "Rank" })).toBeDefined();
  expect(
    screen.queryByPlaceholderText("/home/user/wallpapers"),
  ).toBeNull();
});

test("image-free path shows the existing error copy and stays usable", async () => {
  render(<App />);
  await startScan();

  await act(async () => {
    emitEvent("scan-complete", { added_count: 0 });
  });

  expect(
    await screen.findByText(/No supported images found in that directory\./i),
  ).toBeDefined();
  expect(screen.getByPlaceholderText("/home/user/wallpapers")).toBeDefined();
  const button = screen.getByRole("button", { name: /start ranking/i });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  // A retry re-runs the command.
  await startScan("/tmp/more");
  await waitFor(() => {
    expect(screen.getByText(/scanning collection/i)).toBeDefined();
  });
});

test("invalid path shows the existing error copy and stays usable", async () => {
  mockCommand("start_scan", (args) =>
    Promise.reject({
      kind: "invalid_path",
      message: `${args?.path} is not a directory`,
    }),
  );
  render(<App />);
  await startScan("/definitely/not/a/dir");

  expect(
    await screen.findByText(
      /Failed to scan directory\. Please check the path\./i,
    ),
  ).toBeDefined();
  expect(screen.getByPlaceholderText("/home/user/wallpapers")).toBeDefined();

  // Stays usable: fixing the path works.
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText("/home/user/wallpapers"), {
      target: { value: "/tmp/wallpapers" },
    });
  });
  await startScan("/tmp/wallpapers");
  await act(async () => {
    emitEvent("scan-complete", { added_count: 5 });
  });
  expect(await screen.findByRole("heading", { name: "Rank" })).toBeDefined();
});
