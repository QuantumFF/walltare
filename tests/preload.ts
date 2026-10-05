import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, jest } from "bun:test";
import {
  assertConsoleErrorsAsDeclared,
  installConsoleGuard,
  resetConsoleGuard,
} from "./console-guard";
import { flushMockFailures, registerIpcMocks, resetIpcMocks } from "./ipc-mocks";

// Nothing here may import @testing-library/*: those modules bind to
// `document` when they load, and this file runs before the DOM exists.
GlobalRegistrator.register();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Point the app's Tauri imports (via src/lib/client.ts, the single seam) at an
// in-memory command/event registry instead of the real backend.
registerIpcMocks();
installConsoleGuard();

// Global, so isolation never depends on a test file remembering to reset:
// a leftover command or listener from one file cannot reach the next. Nor can
// a faked clock: a file that fakes time and never gets to put it back (its
// `afterEach` threw before `useRealTimers`) would otherwise hang every later
// file waiting on a timeout. A file's own `beforeEach` runs after this one, so
// faking the clock there still holds.
beforeEach(() => {
  jest.useRealTimers();
  resetIpcMocks();
  resetConsoleGuard();
});

afterEach(() => {
  flushMockFailures();
  assertConsoleErrorsAsDeclared();
});
