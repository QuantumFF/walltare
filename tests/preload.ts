import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach } from "bun:test";
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
// a leftover command or listener from one file cannot reach the next.
beforeEach(() => {
  resetIpcMocks();
  resetConsoleGuard();
});

afterEach(() => {
  flushMockFailures();
  assertConsoleErrorsAsDeclared();
});
