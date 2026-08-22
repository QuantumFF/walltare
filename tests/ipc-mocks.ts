import { mock } from "bun:test";

type CommandArgs = Record<string, unknown> | undefined;
type EventHandler = (event: { payload: unknown }) => void;

const commands = new Map<string, (args: CommandArgs) => unknown>();
const handlers = new Map<string, Set<EventHandler>>();

/** Replace every registered command and event listener. */
export function resetIpcMocks(): void {
  commands.clear();
  handlers.clear();
}

/** Register (or replace) the mock implementation of a Tauri command. */
export function mockCommand(
  name: string,
  impl: (args: CommandArgs) => unknown,
): void {
  commands.set(name, impl);
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
      return Promise.resolve(() => {
        set?.delete(handler);
      });
    },
  }));
}
