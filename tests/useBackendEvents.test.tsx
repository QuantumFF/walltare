import type {
  PregenComplete,
  PregenProgress,
  ScanComplete,
  ScanFailed,
  ScanProgress,
} from "@/lib/client";
import {
  useBackendEvents,
  type BackendEventHandlers,
} from "@/lib/useBackendEvents";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { deferListen, emitEvent } from "./ipc-mocks";

afterEach(cleanup);

/** A component whose only behaviour is the subscription. */
function Listener(props: { handlers: BackendEventHandlers }) {
  useBackendEvents(props.handlers);
  return null;
}

const progress: ScanProgress = { scanned: 12, added: 3 };
const complete: ScanComplete = { added_count: 3, scanned_count: 12 };
const failed: ScanFailed = { message: "permission denied" };
const pregen: PregenProgress = { done: 4, total: 42 };
const pregenDone: PregenComplete = { generated: 40, failed: 2, cancelled: false };

test("every backend event reaches the handler named for it, payload intact", () => {
  const seen: Array<[string, unknown]> = [];
  render(
    <Listener
      handlers={{
        scanProgress: (payload) => seen.push(["scanProgress", payload]),
        scanComplete: (payload) => seen.push(["scanComplete", payload]),
        scanFailed: (payload) => seen.push(["scanFailed", payload]),
        pregenProgress: (payload) => seen.push(["pregenProgress", payload]),
        pregenComplete: (payload) => seen.push(["pregenComplete", payload]),
      }}
    />,
  );

  emitEvent("scan-progress", progress);
  emitEvent("scan-complete", complete);
  emitEvent("scan-failed", failed);
  emitEvent("pregen-progress", pregen);
  emitEvent("pregen-complete", pregenDone);

  // The hook is the one place the wire names are spelled, so a handler landing
  // on the wrong event is a mistake nothing else would catch.
  expect(seen).toEqual([
    ["scanProgress", progress],
    ["scanComplete", complete],
    ["scanFailed", failed],
    ["pregenProgress", pregen],
    ["pregenComplete", pregenDone],
  ]);
});

test("an event a caller did not name is not subscribed to at all", () => {
  // Every caller wants some of the five. Registering the rest anyway would put
  // a listener behind nothing on each — and Settings, which mounts the hook
  // twice, counts the listeners on its own events to know they went away.
  const seen: unknown[] = [];
  render(<Listener handlers={{ scanComplete: (p) => seen.push(p) }} />);

  expect(emitEvent("pregen-complete", pregenDone)).toBe(0);
  expect(emitEvent("scan-complete", complete)).toBe(1);
  expect(seen).toEqual([complete]);
});

test("a caller may start wanting an event it did not want before", async () => {
  const seen: string[] = [];
  const view = render(
    <Listener handlers={{ scanProgress: () => seen.push("progress") }} />,
  );

  view.rerender(
    <Listener
      handlers={{
        scanProgress: () => seen.push("progress"),
        scanComplete: () => seen.push("complete"),
      }}
    />,
  );

  // The rebuilt subscriptions settle a microtask after the render, because the
  // unsubscribe the cleanup needs is itself a promise. Until they have, the old
  // scan-progress listener is still attached alongside the new one.
  await act(async () => {});

  // Rebuilt from this render's handlers rather than from the first render's.
  expect(emitEvent("scan-progress", progress)).toBe(1);
  expect(emitEvent("scan-complete", complete)).toBe(1);
  expect(seen).toEqual(["progress", "complete"]);
});

test("the handler an event reaches is the newest render's, on one subscription", () => {
  // The ref is the point of the hook. `ToastSurface`'s handlers close over
  // `publish` and `raise`; were the subscription rebuilt whenever one of those
  // changed identity, a scan would drop progress events into the gap.
  const seen: string[] = [];
  const view = render(
    <Listener handlers={{ scanProgress: () => seen.push("first") }} />,
  );

  view.rerender(
    <Listener handlers={{ scanProgress: () => seen.push("second") }} />,
  );

  // One listener, not two: a rebuilt subscription would double the delivery.
  expect(emitEvent("scan-progress", progress)).toBe(1);
  expect(seen).toEqual(["second"]);
});

test("an unmount before the subscription resolves still unsubscribes", async () => {
  // The race the four hand-rolled copies of this effect existed to guard, and
  // the one no test covered. `listen` resolves on a round trip to the backend,
  // so a view mounted and left again inside that window — Settings, on the way
  // through — runs its cleanup with no unsubscribe to call yet.
  const release = deferListen();
  const seen: unknown[] = [];

  const view = render(
    <Listener handlers={{ scanProgress: (p) => seen.push(p) }} />,
  );

  // Attached, though the unsubscribe that takes it off again has not arrived.
  expect(emitEvent("scan-progress", progress)).toBe(1);

  view.unmount();
  await act(async () => {
    release();
  });

  // Gone. Without the guard the listener stays for the life of the window,
  // firing into an unmounted component on every scan from here on.
  expect(emitEvent("scan-progress", progress)).toBe(0);
  expect(seen).toEqual([progress]);
});
