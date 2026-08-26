import { ScanView } from "@/components/ScanView";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import { currentView, flush, renderInApp, settings, stats } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

let scannedPaths: string[];

const input = () =>
  screen.getByPlaceholderText("/home/user/wallpapers") as HTMLInputElement;
const scanButton = () =>
  screen.getByRole("button", { name: /start ranking|scanning collection/i }) as HTMLButtonElement;
const progressText = () => screen.queryByText(/scanned,/);

afterEach(cleanup);

beforeEach(() => {
  scannedPaths = [];
  mockCommand("start_scan", (args) => {
    scannedPaths.push(args?.path as string);
    return null;
  });
  // The provider's boot gate: an empty library is what keeps the user here, and
  // the settings read has to land before anything renders at all.
  mockCommand("get_stats", () => stats({ total_wallpapers: 0 }));
  mockCommand("get_settings", () => settings());
});

/** Emit a backend event and report how many listeners took it. */
async function emitInAct(name: string, payload: unknown): Promise<number> {
  let delivered = 0;
  await act(async () => {
    delivered = emitEvent(name, payload);
  });
  return delivered;
}

async function typePath(path: string) {
  await act(async () => {
    fireEvent.change(input(), { target: { value: path } });
  });
}

async function startScan(path = "/tmp/wallpapers") {
  await typePath(path);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /start ranking/i }));
  });
}

test("a scan reports progress, then lands on rank", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  expect(scannedPaths).toEqual(["/tmp/wallpapers"]);
  expect(scanButton().textContent).toContain("Scanning Collection");

  await act(async () => {
    emitEvent("scan-progress", { scanned: 256, added: 12 });
  });
  expect(progressText()?.textContent).toBe("256 scanned, 12 added");

  await act(async () => {
    emitEvent("scan-complete", { added_count: 12, scanned_count: 256 });
  });

  expect(currentView()).toBe("rank");
  expect(progressText()).toBeNull();
  expect(scanButton().textContent).toContain("Start Ranking");
});

test("a rescan that adds nothing still lands on rank", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  // The common case on every launch after the first: the walk found images,
  // the library already knew them. Reporting that as "no images" was what
  // stranded the user on this screen.
  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 42 });
  });

  expect(currentView()).toBe("rank");
  expect(
    screen.queryByText(/No supported images found in that directory\./i),
  ).toBeNull();
});

test("a directory with no images at all is reported, and the view stays usable", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 0 });
  });

  expect(
    screen.queryByText(/No supported images found in that directory\./i),
  ).not.toBeNull();
  expect(currentView()).toBe("scan");
  expect(progressText()).toBeNull();
  expect(scanButton().disabled).toBe(false);

  // A retry re-runs the command.
  await startScan("/tmp/more");
  expect(scannedPaths).toEqual(["/tmp/wallpapers", "/tmp/more"]);
});

test("a scan that fails mid-walk is reported and clears the progress line", async () => {
  expectConsoleError(/Scan failed: permission denied/);
  await renderInApp(<ScanView />);
  await startScan();

  await act(async () => {
    emitEvent("scan-progress", { scanned: 10, added: 10 });
  });
  await act(async () => {
    emitEvent("scan-failed", { message: "permission denied" });
  });

  expect(
    screen.queryByText(/Failed to scan directory\. Please check the path\./i),
  ).not.toBeNull();
  expect(progressText()).toBeNull();
  expect(currentView()).toBe("scan");
  expect(scanButton().disabled).toBe(false);
});

test("an unreadable path is reported and the view stays usable", async () => {
  expectConsoleError(/invalid_path/);
  mockCommand("start_scan", (args) =>
    Promise.reject({
      kind: "invalid_path",
      message: `${args?.path} is not a directory`,
    }),
  );
  await renderInApp(<ScanView />);
  await startScan("/definitely/not/a/dir");
  await flush();

  expect(
    screen.queryByText(/That directory doesn't exist or can't be read\./i),
  ).not.toBeNull();
  expect(scanButton().disabled).toBe(false);

  // Fixing the path works: a fresh scan runs and completes.
  mockCommand("start_scan", () => null);
  await startScan("/tmp/wallpapers");
  await act(async () => {
    emitEvent("scan-complete", { added_count: 5, scanned_count: 5 });
  });
  expect(currentView()).toBe("rank");
});

test("a mistyped variable in the path is reported by name", async () => {
  // The one error kind whose backend message reaches the user verbatim: no
  // canned string can name the variable, which is what sends the user to their
  // typo instead of to their filesystem.
  expectConsoleError(/invalid_path_syntax/);
  mockCommand("start_scan", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await renderInApp(<ScanView />);
  await startScan("$HOEM/pics");
  await flush();

  expect(
    screen.queryByText("unknown environment variable HOEM"),
  ).not.toBeNull();
  expect(
    screen.queryByText(/Failed to scan directory\. Please check the path\./i),
  ).toBeNull();
  expect(scanButton().disabled).toBe(false);
});

test("a scan started while one is already running is reported as such", async () => {
  expectConsoleError(/invalid_transition/);
  mockCommand("start_scan", () =>
    Promise.reject({
      kind: "invalid_transition",
      message: "a scan is already running",
    }),
  );
  await renderInApp(<ScanView />);
  await startScan();
  await flush();

  expect(screen.queryByText("A scan is already running.")).not.toBeNull();
  expect(scanButton().disabled).toBe(false);
});

test("an empty path cannot start a scan", async () => {
  await renderInApp(<ScanView />);

  expect(scanButton().disabled).toBe(true);
  // Enter bypasses the disabled button, so the handler guards the path itself.
  await act(async () => {
    fireEvent.keyDown(input(), { key: "Enter" });
  });
  expect(scannedPaths).toEqual([]);
});

test("a scan in flight cannot be started a second time", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  expect(scanButton().disabled).toBe(true);
  expect(input().disabled).toBe(true);
  await act(async () => {
    fireEvent.keyDown(input(), { key: "Enter" });
  });
  expect(scannedPaths).toEqual(["/tmp/wallpapers"]);
});

test("unmounting drops the scan subscriptions", async () => {
  const { unmount } = await renderInApp(<ScanView />);
  await flush();
  expect(await emitInAct("scan-progress", { scanned: 1, added: 1 })).toBe(1);

  unmount();

  // A live listener here would also set state on an unmounted component.
  expect(emitEvent("scan-progress", { scanned: 2, added: 2 })).toBe(0);
  expect(emitEvent("scan-complete", { added_count: 0, scanned_count: 0 })).toBe(
    0,
  );
  expect(emitEvent("scan-failed", { message: "late" })).toBe(0);
});

test("unmounting before the subscriptions resolve still drops them", async () => {
  // No await between render and unmount: `listen` is still pending, so the
  // effect cleanup has nothing to unsubscribe yet and the resolution, which
  // lands after the component is gone, has to undo its own work.
  const { unmount } = await renderInApp(<ScanView />);
  unmount();
  await flush();

  expect(emitEvent("scan-progress", { scanned: 1, added: 1 })).toBe(0);
  expect(emitEvent("scan-complete", { added_count: 0, scanned_count: 0 })).toBe(
    0,
  );
  expect(emitEvent("scan-failed", { message: "late" })).toBe(0);
});
