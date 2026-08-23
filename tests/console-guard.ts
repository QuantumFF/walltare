/**
 * Turns stray `console.error` output into a test failure.
 *
 * React reports "not wrapped in act(...)" through `console.error`, and so do
 * the components' own diagnostics. Both used to scroll past a green run. Here
 * every message is captured; a test that expects one declares it with
 * `expectConsoleError`, and anything left over fails the test.
 */

let recorded: string[] = [];
let expected: RegExp[] = [];

function format(value: unknown): string {
  return typeof value === "string" ? value : Bun.inspect(value);
}

/** Swap `console.error` for the recorder. Called once from preload.ts. */
export function installConsoleGuard(): void {
  console.error = (...args: unknown[]) => {
    recorded.push(args.map(format).join(" "));
  };
}

/** Forget everything recorded and expected. Runs before every test. */
export function resetConsoleGuard(): void {
  recorded = [];
  expected = [];
}

/**
 * Declare a `console.error` this test expects, one call per message. The
 * assertion is two-sided: an expected message that never arrives fails too.
 */
export function expectConsoleError(pattern: RegExp): void {
  expected.push(pattern);
}

/** Fail the test on any undeclared (or missing) `console.error`. Runs after every test. */
export function assertConsoleErrorsAsDeclared(): void {
  const unmatched = [...expected];
  const unexpected: string[] = [];

  for (const message of recorded) {
    const index = unmatched.findIndex((pattern) => pattern.test(message));
    if (index === -1) unexpected.push(message);
    else unmatched.splice(index, 1);
  }

  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected console.error output (declare it with expectConsoleError):\n` +
        unexpected.map((message) => `  - ${message}`).join("\n"),
    );
  }
  if (unmatched.length > 0) {
    throw new Error(
      `Expected console.error output that never arrived:\n` +
        unmatched.map((pattern) => `  - ${String(pattern)}`).join("\n"),
    );
  }
}
