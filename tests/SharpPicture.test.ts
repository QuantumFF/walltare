import { takeTurns } from "@/components/SharpPicture";
import { expect, test } from "bun:test";

// The line a card's full files are drawn in (ADR 0055). How a card draws is
// DiscoverView's tests'; this is only the turn-taking, which used to be one
// line shared by every page and every test in the process (#419).

/** Work that finishes, or throws, when the test says. */
function held() {
  let settle: (fail: boolean) => void = () => {};
  const done = new Promise<string>((resolve, reject) => {
    settle = (fail) =>
      fail ? reject(new Error("draw failed")) : resolve("drawn");
  });
  return { done, finish: () => settle(false), fail: () => settle(true) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("each draw starts once the one before it has settled", async () => {
  const turns = takeTurns();
  const first = held();
  const started: string[] = [];

  void turns(() => {
    started.push("first");
    return first.done;
  });
  const second = turns(async () => {
    started.push("second");
    return "second";
  });
  await tick();
  expect(started).toEqual(["first"]);

  first.finish();
  expect(await second).toBe("second");
  expect(started).toEqual(["first", "second"]);
});

test("a draw that throws still lets the next one come, and its caller hears the throw", async () => {
  const turns = takeTurns();
  const first = held();

  const failing = turns(() => first.done);
  const next = turns(async () => "next");
  first.fail();

  await expect(failing).rejects.toThrow("draw failed");
  expect(await next).toBe("next");
});

test("two lines never wait on each other", async () => {
  const one = takeTurns();
  const other = takeTurns();
  const stuck = held();

  void one(() => stuck.done);

  expect(await other(async () => "free")).toBe("free");
  stuck.finish();
});
