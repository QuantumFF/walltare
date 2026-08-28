import { ScanView } from "@/components/ScanView";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  currentView,
  emptyStats,
  flush,
  renderInApp,
  settings,
} from "./fixtures";
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
  // The provider's boot gate: an empty library is what keeps the curator here,
  // and the settings read has to land before anything renders at all.
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => settings());
  // Nothing in this file mounts the shell, so nothing starts pre-generation or
  // hears `scan-complete` above this view. The mock stands in case a boot path
  // reaches it.
  mockCommand("start_pregen", () => null);
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

test("a scan reports progress, and the completion frees the button", async () => {
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

  // This screen no longer navigates on completion. The shell owns the
  // subscription above the view swap, because a scan finishes wherever the
  // curator has wandered to since, and only the boot rule's one rerun moves
  // them (ADR 0015).
  expect(currentView()).toBe("settings");
  expect(progressText()).toBeNull();
  expect(scanButton().textContent).toContain("Start Ranking");
});

test("a rescan that adds nothing is not reported as an empty directory", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  // The common case on every launch after the first: the walk found images,
  // the library already knew them. Reporting that as "no images" was what
  // stranded the curator on this screen.
  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 42 });
  });

  expect(currentView()).toBe("settings");
  expect(
    screen.queryByText(/No supported images found in that directory\./i),
  ).toBeNull();
});

test("a directory with no images at all leaves the view usable and says nothing on it", async () => {
  await renderInApp(<ScanView />);
  await startScan();

  await act(async () => {
    emitEvent("scan-complete", { added_count: 0, scanned_count: 0 });
  });

  // The sentence moved to the toast the event arrives on, where it names the
  // folder as the curator wrote it and reaches them wherever they have gone
  // since (ADR 0021); `background-report.test.tsx` asserts the copy there. What
  // is left to this screen is a button that is usable again.
  const said = screen.getByText(/No supported images found/i);
  expect(said.closest("[data-slot='toast']")).not.toBeNull();
  expect(currentView()).toBe("settings");
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
  expect(currentView()).toBe("settings");
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

  // Fixing the path works: a fresh scan runs, completes, and clears the error
  // this screen put up.
  mockCommand("start_scan", () => null);
  await startScan("/tmp/wallpapers");
  await act(async () => {
    emitEvent("scan-complete", { added_count: 5, scanned_count: 5 });
  });
  expect(
    screen.queryByText(/That directory doesn't exist or can't be read\./i),
  ).toBeNull();
  expect(scanButton().textContent).toContain("Start Ranking");
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
  // Two listeners: this view's own, and the toast surface's, which reports the
  // same scan wherever the curator is (ADR 0021). Both have to go.
  expect(await emitInAct("scan-progress", { scanned: 1, added: 1 })).toBe(2);

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
