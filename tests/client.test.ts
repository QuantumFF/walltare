import { afterEach, describe, expect, test } from "bun:test";
import { client } from "@/lib/client";
import { emitEvent, mockCommand, resetIpcMocks } from "./ipc-mocks";

afterEach(() => resetIpcMocks());

describe("client seam", () => {
  test("startScan forwards the path argument", async () => {
    let receivedPath: string | undefined;
    mockCommand("start_scan", (args) => {
      receivedPath = args?.path as string;
      return null;
    });
    await client.startScan("/tmp/pics");
    expect(receivedPath).toBe("/tmp/pics");
  });

  test("startScan surfaces backend errors untouched", async () => {
    mockCommand("start_scan", () =>
      Promise.reject({ kind: "invalid_path", message: "nope" }),
    );
    expect(client.startScan("/nope")).rejects.toEqual({
      kind: "invalid_path",
      message: "nope",
    });
  });

  test("event subscriptions unwrap tauri payloads", async () => {
    const seen: unknown[] = [];
    const unlisten = await client.onScanProgress((payload) =>
      seen.push(payload),
    );
    const delivered = emitEvent("scan-progress", { scanned: 10, added: 3 });
    expect(delivered).toBe(1);
    expect(seen).toEqual([{ scanned: 10, added: 3 }]);
    unlisten();
  });
});
