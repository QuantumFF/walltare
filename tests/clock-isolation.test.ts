import { expect, jest, test } from "bun:test";

// Pins the preload's real-clock reset: the first test leaves time faked, the
// way a file whose `afterEach` throws before `useRealTimers` would, and the
// next one must not inherit it. Bun runs a file's tests in order.

test("a test can leave the clock faked behind it", () => {
  jest.useFakeTimers();
  expect(jest.isFakeTimers()).toBe(true);
});

test("the next test starts on a real clock anyway", () => {
  expect(jest.isFakeTimers()).toBe(false);
});
