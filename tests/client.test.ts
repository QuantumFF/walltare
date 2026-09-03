import { client, wallpaperImageUrl } from "@/lib/client";
import type { Settings, Theme } from "@/lib/client";
import { describe, expect, test } from "bun:test";
import { wallpaper } from "./fixtures";
import { emitEvent, mockCommand, mockFolderPicker } from "./ipc-mocks";

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

  test("pickFolder asks for one folder rather than for files", async () => {
    // `directory` is what makes the native dialog a folder picker rather than a
    // file picker, and `multiple` is what makes its answer one path rather than
    // a list of them.
    const picker = mockFolderPicker("/home/qdes/Wallpapers");

    await client.pickFolder();

    expect(picker.options).toEqual({ directory: true, multiple: false });
  });

  test("pickFolder resolves with the folder the curator chose", async () => {
    // An absolute canonical path, which is what the caller writes into the
    // field over whatever `~` was typed there (ADR 0020).
    mockFolderPicker("/home/qdes/Wallpapers");
    expect(await client.pickFolder()).toBe("/home/qdes/Wallpapers");
  });

  test("pickFolder resolves with null when the curator dismisses the dialog", async () => {
    // A dismissal is an answer. Rejecting here would put an error on screen for
    // a decision the curator made on purpose, and the field they were already
    // editing has to survive it untouched.
    const picker = mockFolderPicker(null);

    expect(await client.pickFolder()).toBeNull();
    expect(picker.opened).toBe(1);
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

  test("listWallpapers asks for every wallpaper by Score, high to low, unless told otherwise", async () => {
    const calls: unknown[] = [];
    mockCommand("list_wallpapers", (args) => {
      calls.push(args);
      return [];
    });

    await client.listWallpapers();
    await client.listWallpapers("rejected", "filename_asc");

    // Snake-case command, one argument per enum: the Rust signature is
    // `list_wallpapers(filter: StatusFilter, ordering: ListOrdering)`, and each
    // value is a name the backend maps to a clause it owns.
    expect(calls).toEqual([
      { filter: "all", ordering: "score_desc" },
      { filter: "rejected", ordering: "filename_asc" },
    ]);
  });

  test("listWallpapers defaults the ordering while honouring a given filter", async () => {
    // The two arguments default independently, so filtering to one Status does
    // not silently reorder the grid.
    const calls: unknown[] = [];
    mockCommand("list_wallpapers", (args) => {
      calls.push(args);
      return [];
    });

    await client.listWallpapers("active");

    expect(calls).toEqual([{ filter: "active", ordering: "score_desc" }]);
  });

  test("listWallpapers hands back the rows in the order the backend sent them", async () => {
    // The ordering is the backend's answer, so the seam must not sort. A
    // Rejected row arrives with its Origin, which is how the page says where
    // the file came from without a second call.
    mockCommand("list_wallpapers", () => [
      wallpaper(7, { rating_mu: 30.5, comparisons_count: 4 }),
      wallpaper(2, {
        status: "rejected",
        origin_path: "/library/landscapes/dawn.jpg",
      }),
      wallpaper(9, { rating_mu: 25, comparisons_count: 0 }),
    ]);

    const rows = await client.listWallpapers();

    expect(rows.map((w) => w.id)).toEqual([7, 2, 9]);
    expect(rows[1].origin_path).toBe("/library/landscapes/dawn.jpg");
  });

  test("moveWallpaper sends the id and the destination and resolves with the row it wrote", async () => {
    let received: Record<string, unknown> | undefined;
    const rejected = wallpaper(3, {
      filename: "dawn.jpg",
      path: "/bin/walls/dawn.jpg",
      status: "rejected",
      origin_path: "/library/dawn.jpg",
    });
    mockCommand("move_wallpaper", (args) => {
      received = args;
      return rejected;
    });

    const wrote = await client.moveWallpaper(3, "/bin/walls");

    // Snake-case command, camel-case arguments: the Rust signature is
    // `move_wallpaper(id: i64, destination_folder: String)`.
    expect(received).toEqual({ id: 3, destinationFolder: "/bin/walls" });
    // The whole row, not a path. `origin_path = path` is the backend's rule and
    // a caller restating it in TypeScript would be predicting the row rather
    // than being told it (ADR 0023).
    expect(wrote).toEqual(rejected);
  });

  test("moveWallpaper resolves with the suffixed name a collision produced", async () => {
    // The row reports where the file actually is, not the folder plus the
    // filename it went in with: a destination that already holds `dawn.jpg`
    // suffixes the basename, and the backend derives the `filename` column it
    // stores from the path it wrote — so the two agree here by construction
    // where a caller rebuilding either would not.
    mockCommand("move_wallpaper", () =>
      wallpaper(3, {
        filename: "dawn (2).jpg",
        path: "/bin/walls/dawn (2).jpg",
        status: "rejected",
        origin_path: "/library/dawn.jpg",
      }),
    );

    const wrote = await client.moveWallpaper(3, "/bin/walls");
    expect(wrote.path).toBe("/bin/walls/dawn (2).jpg");
    expect(wrote.filename).toBe("dawn (2).jpg");
  });

  test("keepWallpaper sends the id and resolves with the row it wrote", async () => {
    let received: Record<string, unknown> | undefined;
    mockCommand("keep_wallpaper", (args) => {
      received = args;
      return wallpaper(3, { status: "kept" });
    });

    // Snake-case command, one argument: the Rust signature is
    // `keep_wallpaper(id: i64)`. Nothing on disk moves, so the `status` column
    // is the whole of what the row it answers with has changed — and it answers
    // with the row anyway, so all four transitions read alike.
    expect((await client.keepWallpaper(3)).status).toBe("kept");
    expect(received).toEqual({ id: 3 });
  });

  test("unkeepWallpaper sends the id and resolves with the row it wrote", async () => {
    let received: Record<string, unknown> | undefined;
    mockCommand("unkeep_wallpaper", (args) => {
      received = args;
      return wallpaper(3, { status: "active" });
    });

    // Snake-case command, one argument: the Rust signature is
    // `unkeep_wallpaper(id: i64)`. Nothing on disk moves, so unlike a Restore
    // the row's `path` is where it always was.
    const wrote = await client.unkeepWallpaper(3);
    expect(wrote.status).toBe("active");
    expect(wrote.path).toBe("/library/wall-3.jpg");
    expect(received).toEqual({ id: 3 });
  });

  test("unkeepWallpaper surfaces a refused transition untouched", async () => {
    // A Rejected wallpaper is the refusal: its file is in the reject folder, so
    // `restoreWallpaper` is the call that brings it back, and the seam must not
    // dress the reason up as a success.
    mockCommand("unkeep_wallpaper", () =>
      Promise.reject({
        kind: "invalid_transition",
        message: "wallpaper 4 is rejected, so a Restore is what brings it back",
      }),
    );
    expect(client.unkeepWallpaper(4)).rejects.toEqual({
      kind: "invalid_transition",
      message: "wallpaper 4 is rejected, so a Restore is what brings it back",
    });
  });

  test("restoreWallpaper sends the id and resolves with the row it wrote", async () => {
    let received: Record<string, unknown> | undefined;
    mockCommand("restore_wallpaper", (args) => {
      received = args;
      return wallpaper(3, {
        filename: "dawn.jpg",
        path: "/library/landscapes/dawn.jpg",
        status: "active",
      });
    });

    const wrote = await client.restoreWallpaper(3);

    // Snake-case command, one argument: the Rust signature is
    // `restore_wallpaper(id: i64)`. The Origin comes off the row, so no caller
    // gets to say where the file goes back to.
    expect(received).toEqual({ id: 3 });
    expect(wrote.path).toBe("/library/landscapes/dawn.jpg");
    // Spent, and by the backend rather than by a `null` written here.
    expect(wrote.origin_path).toBeNull();
    expect(wrote.status).toBe("active");
  });

  test("restoreWallpaper resolves with the suffixed name a collision at the Origin produced", async () => {
    // Something took the name while the wallpaper was away, so the path the
    // file is at is not the Origin the row advertised. A caller reporting the
    // Origin instead would name a file that is not the restored one.
    mockCommand("restore_wallpaper", () =>
      wallpaper(3, { filename: "dawn (2).jpg", path: "/library/dawn (2).jpg" }),
    );

    const wrote = await client.restoreWallpaper(3);
    expect(wrote.path).toBe("/library/dawn (2).jpg");
    expect(wrote.filename).toBe("dawn (2).jpg");
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

  test("startPregen and cancelPregen take no arguments and resolve with nothing", async () => {
    // Neither Rust signature has a parameter: `start_pregen(app)` and
    // `cancel_pregen(state)` are both filled by Tauri, so a payload here could
    // only be noise. `start_pregen` returns the moment the pass is spawned, so
    // resolving says "started", not "finished".
    const received: unknown[] = [];
    mockCommand("start_pregen", (args) => {
      received.push(args);
      return null;
    });
    mockCommand("cancel_pregen", (args) => {
      received.push(args);
      return null;
    });

    expect(await client.startPregen()).toBeUndefined();
    expect(await client.cancelPregen()).toBeUndefined();
    expect(received).toEqual([undefined, undefined]);
  });

  test("startPregen surfaces a backend failure untouched", async () => {
    mockCommand("start_pregen", () =>
      Promise.reject({ kind: "db", message: "locked database" }),
    );
    expect(client.startPregen()).rejects.toEqual({
      kind: "db",
      message: "locked database",
    });
  });

  test("getCacheSize takes no arguments and hands back both counts", async () => {
    // `get_cache_size(cache_dir)` is filled by Tauri, so a payload here could
    // only be noise. Bytes and files are separate numbers because the readout
    // says both: "48 MB cached · 172 files".
    let received: unknown;
    mockCommand("get_cache_size", (args) => {
      received = args;
      return { bytes: 48_000_000, files: 172 };
    });

    expect(await client.getCacheSize()).toEqual({
      bytes: 48_000_000,
      files: 172,
    });
    expect(received).toBeUndefined();
  });

  test("getCacheSize carries an empty cache through as zeroes", async () => {
    // "Nothing cached yet" is a state the readout renders, so the seam must not
    // fold a zero into a missing value.
    mockCommand("get_cache_size", () => ({ bytes: 0, files: 0 }));
    expect(await client.getCacheSize()).toEqual({ bytes: 0, files: 0 });
  });

  test("clearCache takes no arguments and resolves with nothing", async () => {
    // Nothing to hand back: the cache is empty afterwards, and a caller wanting
    // the new size asks for it.
    let received: unknown = "unset";
    mockCommand("clear_cache", (args) => {
      received = args;
      return null;
    });

    expect(await client.clearCache()).toBeUndefined();
    expect(received).toBeUndefined();
  });

  test("clearCache surfaces a backend failure untouched", async () => {
    mockCommand("clear_cache", () =>
      Promise.reject({ kind: "io", message: "permission denied" }),
    );
    expect(client.clearCache()).rejects.toEqual({
      kind: "io",
      message: "permission denied",
    });
  });

  test("subscribe unwraps a pregen-progress payload, total included", async () => {
    // `total` arrives on every emission rather than in a start event, so a
    // listener that missed the first one still knows what it is a fraction of.
    const seen: unknown[] = [];
    const unlisten = await client.subscribe("pregen-progress", (payload) =>
      seen.push(payload),
    );

    emitEvent("pregen-progress", { done: 0, total: 42 });
    emitEvent("pregen-progress", { done: 1, total: 42 });

    expect(seen).toEqual([
      { done: 0, total: 42 },
      { done: 1, total: 42 },
    ]);
    unlisten();
    expect(emitEvent("pregen-progress", { done: 2, total: 42 })).toBe(0);
  });

  test("subscribe unwraps a pregen-complete payload, cancelled flag included", async () => {
    const seen: unknown[] = [];
    const unlisten = await client.subscribe("pregen-complete", (payload) =>
      seen.push(payload),
    );

    const delivered = emitEvent("pregen-complete", {
      generated: 40,
      failed: 1,
      cancelled: true,
    });

    expect(delivered).toBe(1);
    expect(seen).toEqual([{ generated: 40, failed: 1, cancelled: true }]);
    unlisten();
  });

  test("event subscriptions unwrap tauri payloads", async () => {
    const seen: unknown[] = [];
    const unlisten = await client.subscribe("scan-progress", (payload) =>
      seen.push(payload),
    );
    const delivered = emitEvent("scan-progress", { scanned: 10, added: 3 });
    expect(delivered).toBe(1);
    expect(seen).toEqual([{ scanned: 10, added: 3 }]);
    unlisten();
  });

  test("unlisten stops delivery", async () => {
    const unlisten = await client.subscribe("scan-failed", () => {});
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
