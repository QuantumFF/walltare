import { client, wallpaperImageUrl } from "@/lib/client";
import { describe, expect, test } from "bun:test";
import { emitEvent, mockCommand } from "./ipc-mocks";

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

  test("expandPath forwards the input argument", async () => {
    let receivedInput: string | undefined;
    mockCommand("expand_path", (args) => {
      receivedInput = args?.input as string;
      return { resolved: "/home/me/pics", exists: true };
    });
    const expanded = await client.expandPath("~/pics");
    expect(receivedInput).toBe("~/pics");
    expect(expanded).toEqual({ resolved: "/home/me/pics", exists: true });
  });

  test("expandPath surfaces a syntax error untouched", async () => {
    // The message names the variable, so nothing may rewrite it on the way up.
    mockCommand("expand_path", () =>
      Promise.reject({
        kind: "invalid_path_syntax",
        message: "unknown environment variable HOEM",
      }),
    );
    expect(client.expandPath("$HOEM/pics")).rejects.toEqual({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    });
  });

  test("getReview asks for 50 rows unless told otherwise", async () => {
    const limits: unknown[] = [];
    mockCommand("get_review", (args) => {
      limits.push(args?.limit);
      return [];
    });
    await client.getReview();
    await client.getReview(5);
    expect(limits).toEqual([50, 5]);
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

  test("unlisten stops delivery", async () => {
    const unlisten = await client.onScanFailed(() => {});
    expect(emitEvent("scan-failed", { message: "boom" })).toBe(1);
    unlisten();
    expect(emitEvent("scan-failed", { message: "boom" })).toBe(0);
  });
});

describe("wallpaperImageUrl", () => {
  // `localhost` is the placeholder authority; `image` has to sit in the path
  // or the Rust protocol handler rejects the request (see client.ts).
  test("puts image in the path, behind a localhost authority", () => {
    expect(wallpaperImageUrl(7)).toBe(
      "wallpaper://localhost/image/7?size=full",
    );
  });

  test("carries the requested thumbnail size", () => {
    expect(wallpaperImageUrl(7, "small")).toBe(
      "wallpaper://localhost/image/7?size=small",
    );
    expect(wallpaperImageUrl(42, "medium")).toBe(
      "wallpaper://localhost/image/42?size=medium",
    );
  });
});
