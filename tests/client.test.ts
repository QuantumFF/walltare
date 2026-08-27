import { client, wallpaperImageUrl } from "@/lib/client";
import type { Settings, Theme } from "@/lib/client";
import { describe, expect, test } from "bun:test";
import { wallpaper } from "./fixtures";
import { emitEvent, mockCommand } from "./ipc-mocks";

/** A settings table with something in every key, so a default can't stand in. */
const stored: Settings = {
  theme: "dark",
  library_root: "~/pics",
  reject_destination: "/bin/walls",
};

/** Serve `set_setting` and keep the arguments it was handed. */
function captureSetSetting(): { args?: Record<string, unknown> } {
  const captured: { args?: Record<string, unknown> } = {};
  mockCommand("set_setting", (args) => {
    captured.args = args;
    return stored;
  });
  return captured;
}

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

  test("getSettings hands back the struct the backend sent", async () => {
    mockCommand("get_settings", () => stored);
    expect(await client.getSettings()).toEqual(stored);
  });

  test("setSetting sends the key and the value under the names set_setting expects", async () => {
    const received = captureSetSetting();
    await client.setSetting("theme", "dark");
    // Snake-case command, `key` and `value` arguments: the Rust signature is
    // `set_setting(key: String, value: String)`.
    expect(received.args).toEqual({ key: "theme", value: "dark" });
  });

  test("setSetting hands over a plain string, stringified once", async () => {
    // The seam is the only module that builds an IPC payload, so this is the
    // one place a setting becomes a string. A caller that stringified as well
    // would send `"\"~/pics\""`, and the backend would store the quotes.
    const received = captureSetSetting();
    await client.setSetting("library_root", "~/pics");
    expect(received.args?.value).toBe("~/pics");
    expect(typeof received.args?.value).toBe("string");
  });

  test("setSetting sends an empty value as an empty string", async () => {
    // Clearing the library root is how a curator writes it back to its default,
    // which the backend answers by deleting the row. A stringify that turned ""
    // into anything else would make that unreachable.
    const received = captureSetSetting();
    await client.setSetting("library_root", "");
    expect(received.args).toEqual({ key: "library_root", value: "" });
  });

  test("setSetting resolves with every setting, not just the one written", async () => {
    // A stale read cannot survive a write, so nothing reassembles state from a
    // patch.
    mockCommand("set_setting", () => ({ ...stored, theme: "light" }));
    expect(await client.setSetting("theme", "light")).toEqual({
      theme: "light",
      library_root: "~/pics",
      reject_destination: "/bin/walls",
    });
  });

  test("setSetting surfaces a refused write untouched", async () => {
    mockCommand("set_setting", () =>
      Promise.reject({
        kind: "bad_request",
        message: '"solarized" is not a theme; expected system, light or dark',
      }),
    );
    expect(client.setSetting("theme", "solarized" as Theme)).rejects.toEqual({
      kind: "bad_request",
      message: '"solarized" is not a theme; expected system, light or dark',
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

  test("getReview carries a row's Origin through as the backend sent it", async () => {
    // A null Origin and a path are different answers — one is a reject nothing
    // can put back, the other is where a Restore puts the file — so nothing in
    // the seam may fold one into the other.
    mockCommand("get_review", () => [
      wallpaper(1),
      wallpaper(2, {
        status: "rejected",
        origin_path: "/library/landscapes/dawn.jpg",
      }),
    ]);
    const review = await client.getReview();
    expect(review.map((w) => w.origin_path)).toEqual([
      null,
      "/library/landscapes/dawn.jpg",
    ]);
  });

  test("moveWallpaper sends the id and the destination and resolves with where the file landed", async () => {
    let received: Record<string, unknown> | undefined;
    mockCommand("move_wallpaper", (args) => {
      received = args;
      return "/bin/walls/dawn.jpg";
    });

    const landed = await client.moveWallpaper(3, "/bin/walls");

    // Snake-case command, camel-case arguments: the Rust signature is
    // `move_wallpaper(id: i64, destination_folder: String)`.
    expect(received).toEqual({ id: 3, destinationFolder: "/bin/walls" });
    expect(landed).toBe("/bin/walls/dawn.jpg");
  });

  test("moveWallpaper resolves with the suffixed path a collision produced", async () => {
    // The seam returns a path, not a folder plus the filename it went in with:
    // a destination that already holds `dawn.jpg` suffixes the basename, and a
    // caller rebuilding the path from its own `wallpaper.filename` would name a
    // file that is not there.
    mockCommand("move_wallpaper", () => "/bin/walls/dawn (2).jpg");

    expect(await client.moveWallpaper(3, "/bin/walls")).toBe(
      "/bin/walls/dawn (2).jpg",
    );
  });

  test("restoreWallpaper sends the id and resolves with where the file landed back", async () => {
    let received: Record<string, unknown> | undefined;
    mockCommand("restore_wallpaper", (args) => {
      received = args;
      return "/library/landscapes/dawn.jpg";
    });

    const landed = await client.restoreWallpaper(3);

    // Snake-case command, one argument: the Rust signature is
    // `restore_wallpaper(id: i64)`. The Origin comes off the row, so no caller
    // gets to say where the file goes back to.
    expect(received).toEqual({ id: 3 });
    expect(landed).toBe("/library/landscapes/dawn.jpg");
  });

  test("restoreWallpaper resolves with the suffixed path a collision at the Origin produced", async () => {
    // Something took the name while the wallpaper was away, so the path the
    // file is at is not the Origin the row advertised. A caller reporting the
    // Origin instead would name a file that is not the restored one.
    mockCommand("restore_wallpaper", () => "/library/dawn (2).jpg");

    expect(await client.restoreWallpaper(3)).toBe("/library/dawn (2).jpg");
  });

  test("restoreWallpaper surfaces a refusal untouched", async () => {
    // Two refusals the caller has to tell apart: a reject whose file has left
    // the folder, and a reject from before the Origin was recorded.
    mockCommand("restore_wallpaper", () =>
      Promise.reject({
        kind: "file_missing",
        message: "/bin/walls/dawn.jpg",
      }),
    );
    expect(client.restoreWallpaper(3)).rejects.toEqual({
      kind: "file_missing",
      message: "/bin/walls/dawn.jpg",
    });

    mockCommand("restore_wallpaper", () =>
      Promise.reject({
        kind: "invalid_transition",
        message: "wallpaper 4 is active, so there is no reject to undo",
      }),
    );
    expect(client.restoreWallpaper(4)).rejects.toEqual({
      kind: "invalid_transition",
      message: "wallpaper 4 is active, so there is no reject to undo",
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
