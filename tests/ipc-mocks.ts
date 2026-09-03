import { mock } from "bun:test";

type CommandArgs = Record<string, unknown> | undefined;
type EventHandler = (event: { payload: unknown }) => void;

const commands = new Map<string, (args: CommandArgs) => unknown>();
const handlers = new Map<string, Set<EventHandler>>();

// A mock body that throws synchronously is a broken test, not a backend
// failure: every component catches IPC rejections, so a failed `expect()`
// inside a mock would surface as "Failed to load the review list" and the test
// would pass. Park those errors here and rethrow after the test body.
// Deliberate backend failures are written as `Promise.reject(...)` instead.
const mockFailures: unknown[] = [];

/**
 * Resolvers for `listen` calls being held open, or `null` when they resolve
 * straight away. See `deferListen`.
 */
let held: Array<() => void> | null = null;

/** Replace every registered command and event listener. */
export function resetIpcMocks(): void {
  commands.clear();
  handlers.clear();
  mockFailures.length = 0;
  held = null;
}

/**
 * Hold every `listen` promise open until the returned function is called, so a
 * test can act in the window between asking to subscribe and being handed the
 * unsubscribe — which is where the cleanup race lives.
 *
 * The listener itself is registered immediately, as the real plugin's is: what
 * arrives late is only the means to take it back off again. So a subscriber
 * that unmounted while its promise was held has a listener still attached, and
 * whether `emitEvent` reaches it after the release is the whole question.
 */
export function deferListen(): () => void {
  const waiting: Array<() => void> = [];
  held = waiting;
  return () => {
    if (held === waiting) held = null;
    for (const resolve of waiting.splice(0)) resolve();
  };
}

/**
 * Rethrow whatever a mock body threw synchronously. Registered as a global
 * `afterEach` in preload.ts so a swallowed assertion can't pass as green.
 */
export function flushMockFailures(): void {
  if (mockFailures.length === 0) return;
  const [first] = mockFailures;
  mockFailures.length = 0;
  throw first;
}

/** Register (or replace) the mock implementation of a Tauri command. */
export function mockCommand(
  name: string,
  impl: (args: CommandArgs) => unknown,
): void {
  commands.set(name, impl);
}

/**
 * The command `client.pickFolder` reaches through the dialog plugin.
 *
 * The plugin's JS half is a single `invoke` of this name, so the picker mocks
 * through the registry above rather than through a module mock of its own. That
 * keeps one seam for the whole backend and means `resetIpcMocks` clears a
 * leftover picker along with everything else.
 */
const FOLDER_PICKER_COMMAND = "plugin:dialog|open";

/** What the picker was asked for, and how often, while a test ran. */
export interface FolderPicker {
  /** Openings so far, so a test about a dismissal can tell it was not vacuous. */
  opened: number;
  /** The options the last opening handed the plugin. */
  options?: Record<string, unknown>;
}

/**
 * Stand in for the folder picker, answering every opening with `chosen` — a
 * path for a curator who picked a folder, `null` for one who dismissed the
 * dialog. Both are outcomes rather than failures, so neither rejects.
 */
export function mockFolderPicker(chosen: string | null): FolderPicker {
  const picker: FolderPicker = { opened: 0 };
  mockCommand(FOLDER_PICKER_COMMAND, (args) => {
    picker.opened += 1;
    picker.options = args?.options as Record<string, unknown>;
    return chosen;
  });
  return picker;
}

/**
 * Deliver an event to every listener registered through `listen`.
 * Returns how many listeners received it.
 */
export function emitEvent(name: string, payload: unknown): number {
  const registered = handlers.get(name);
  if (!registered) return 0;
  for (const handler of registered) handler({ payload });
  return registered.size;
}

let registered = false;

/** Point the app's Tauri imports at this registry. Idempotent. */
export function registerIpcMocks(): void {
  if (registered) return;
  registered = true;

  mock.module("@tauri-apps/api/core", () => ({
    invoke: (command: string, args?: Record<string, unknown>) => {
      const impl = commands.get(command);
      if (!impl) {
        return Promise.reject(
          new Error(`no mock registered for command ${command}`),
        );
      }
      try {
        return Promise.resolve(impl(args));
      } catch (error) {
        mockFailures.push(error);
        return Promise.reject(error);
      }
    },
  }));

  mock.module("@tauri-apps/api/event", () => ({
    listen: (event: string, handler: EventHandler) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      const unlisten = () => {
        set?.delete(handler);
      };
      if (!held) return Promise.resolve(unlisten);
      const waiting = held;
      return new Promise<() => void>((resolve) => {
        waiting.push(() => resolve(unlisten));
      });
    },
  }));
}
