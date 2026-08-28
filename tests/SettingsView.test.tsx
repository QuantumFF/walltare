import App from "@/App";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import {
  emptyStats,
  flush,
  settings,
  showingView,
  stats,
  wallpaper,
} from "./fixtures";
import { emitEvent, mockCommand, mockFolderPicker } from "./ipc-mocks";

// The whole page is a shell interaction: Escape, the back control and the top
// slot are all about where the curator came from and why boot sent them here.
// So every test renders the app and navigates the way a curator does, rather
// than mounting the view against arranged props it never gets in the app.
//
// What is asserted is what the curator reads: the words on the status line, the
// verb on the button, the number under the field. The two calls with a side
// effect are the exceptions and are pinned by argument and by order, because a
// setting written under the wrong key and a scan started on the expanded path
// are both invisible on screen and wrong (ADR 0020).

/** Where `~` goes on the machine the mocked backend is standing in for. */
const HOME = "/home/curator";

let statsCalls = 0;
let scannedPaths: string[];
let settingWrites: Array<{ key: string; value: string }>;
/** Just the two commands a scan makes, in the order the backend heard them. */
let scanSequence: string[];

afterEach(cleanup);

beforeEach(() => {
  statsCalls = 0;
  scannedPaths = [];
  settingWrites = [];
  scanSequence = [];

  // A library with wallpapers in it, so boot lands on Rank and the curator
  // reaches Settings through the gear — which is what puts a `returnTo` on the
  // navigation. The tests about a first run and a failed boot override it.
  mockCommand("get_stats", () => {
    statsCalls++;
    return stats();
  });
  mockCommand("get_settings", () => settings());
  mockCommand("start_pregen", () => null);
  mockCommand("get_pair", () => [wallpaper(1), wallpaper(2)]);
  mockCommand("get_review", () => []);
  mockCommand("list_wallpapers", () => []);
  // A Written path resolves the way ADR 0011 says it does, and the folder is
  // there. The status-line tests replace this with the answer they are about.
  mockCommand("expand_path", (args) => ({
    resolved: String(args?.input).replace(/^~/, HOME),
    exists: true,
  }));
  mockCommand("set_setting", (args) => {
    settingWrites.push({
      key: args?.key as string,
      value: args?.value as string,
    });
    scanSequence.push("set_setting");
    return settings({ [args?.key as string]: args?.value as string });
  });
  mockCommand("start_scan", (args) => {
    scannedPaths.push(args?.path as string);
    scanSequence.push("start_scan");
    return null;
  });
});

const gear = () =>
  screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
const backControl = () => screen.queryByRole("button", { name: /back to/i });
const scanInput = () =>
  screen.getByPlaceholderText("/home/user/wallpapers") as HTMLInputElement;
/** The button under the field, which is named by whichever of its four labels is up. */
const scanButton = () =>
  screen.getByRole("button", {
    name: /^(scan|rescan|scanning)/i,
  }) as HTMLButtonElement;
const statusLine = () =>
  document.querySelector('[data-slot="library-root-status"]') as HTMLElement;
const sectionHeadings = () =>
  Array.from(document.querySelectorAll('[data-slot="settings-section"] h2')).map(
    (el) => el.textContent,
  );

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
  await flush();
}

/** Type a Written path, one `change` the way a field reports one. */
async function type(value: string) {
  await act(async () => {
    fireEvent.change(scanInput(), { target: { value } });
  });
  await flush();
}

async function blurField() {
  await act(async () => {
    fireEvent.blur(scanInput());
  });
  await flush();
}

async function pressEnter() {
  await act(async () => {
    fireEvent.keyDown(scanInput(), { key: "Enter" });
  });
  await flush();
}

/** Emit a backend event and report how many listeners took it. */
async function emit(name: string, payload: unknown): Promise<number> {
  let delivered = 0;
  await act(async () => {
    delivered = emitEvent(name, payload);
  });
  await flush();
  return delivered;
}

async function pressEscape(target: Window | Element) {
  await act(async () => {
    fireEvent.keyDown(target, { key: "Escape" });
  });
  await flush();
}

async function openApp() {
  const rendered = render(<App />);
  await flush();
  return rendered;
}

/** Boot on Rank, then reach Settings the way the gear does, from Library. */
async function openSettingsFromLibrary() {
  await openApp();
  await click(screen.getByRole("tab", { name: "Library" }));
  await click(gear());
  expect(showingView()).toBe("settings");
}

test("the page is one column of four sections, in first-run order", async () => {
  await openSettingsFromLibrary();

  expect(sectionHeadings()).toEqual([
    "Library root",
    "Reject destination",
    "Appearance",
    "Thumbnails",
  ]);

  // happy-dom has no layout to measure, so the utility is what there is to
  // assert — and the width is the decision: four groups of one or two controls
  // read as a page at this measure and as a form at full width (ADR 0020).
  const column = document.querySelector('[data-slot="settings-section"]')
    ?.parentElement as HTMLElement;
  expect(column.className).toContain("max-w-2xl");

  // The three that are still empty, and staying that way until a ticket each
  // fills them. What is asserted here is that they are already in the page and
  // already in order, so none of those three has to decide where its section
  // goes.
  const [, ...unbuilt] = document.querySelectorAll(
    '[data-slot="settings-section"]',
  );
  for (const section of unbuilt) {
    expect(section.children.length).toBe(1);
  }
});

test("the bar names the page and the way out of it", async () => {
  await openSettingsFromLibrary();

  // Scoped to the Settings container, because the two views the curator passed
  // through on the way here are still mounted with bars of their own.
  const bar = document.querySelector(
    '[data-view="settings"] [data-slot="page-bar"]',
  ) as HTMLElement;
  expect(bar.querySelector("h1")?.textContent).toBe("Settings");

  // The label names where it goes, because the curator came from Library and
  // could have come from either of the other two, and it names the key that
  // does the same thing, because that route is otherwise invisible.
  const back = backControl() as HTMLButtonElement;
  expect(back.textContent).toBe("Back to Library· Esc");
  expect(bar.contains(back)).toBe(true);

  await click(back);
  expect(showingView()).toBe("library");
});

test("Escape closes to where the curator came from", async () => {
  await openSettingsFromLibrary();

  await pressEscape(window);
  expect(showingView()).toBe("library");

  // And from Review, so the exit follows `returnTo` rather than a hardcoded
  // destination that happened to match.
  await click(screen.getByRole("tab", { name: "Review" }));
  await click(gear());
  await pressEscape(window);
  expect(showingView()).toBe("review");
});

test("Escape closes from inside a text field, which is the whole reason the page owns it", async () => {
  await openSettingsFromLibrary();

  // The shell's handler stands down while the caret is in a field — a path may
  // hold a comma, and `?` is a character — so a shell-level Escape would be off
  // in the one place this page is mostly made of. Proved against the shell's own
  // suppression first, so this is about where Escape lives and not about a
  // keystroke that never worked.
  const input = scanInput();
  await act(async () => {
    fireEvent.keyDown(input, { key: ",", ctrlKey: true });
  });
  await flush();
  expect(showingView()).toBe("settings");

  await pressEscape(input);
  expect(showingView()).toBe("library");
});

test("Escape does not close the page out from under the shortcuts dialog", async () => {
  await openSettingsFromLibrary();

  await act(async () => {
    fireEvent.keyDown(window, { key: "?" });
  });
  await flush();
  expect(screen.queryByRole("dialog")).not.toBeNull();

  // Radix dismisses its layer from a capture-phase listener and marks the event,
  // and this page stands down on that mark. One Escape closes one thing.
  await pressEscape(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(showingView()).toBe("settings");
});

test("with no returnTo the back control is absent and Escape does nothing", async () => {
  // Boot landed the curator here, so there is nowhere to go back to and the tabs
  // are the way out of a first run.
  mockCommand("get_stats", () => emptyStats());
  await openApp();
  expect(showingView()).toBe("settings");

  expect(backControl()).toBeNull();

  await pressEscape(window);
  expect(showingView()).toBe("settings");
  await pressEscape(scanInput());
  expect(showingView()).toBe("settings");

  // The tabs still work from here, which is what makes the absent control
  // honest rather than a dead end.
  await click(screen.getByRole("tab", { name: "Library" }));
  expect(showingView()).toBe("library");
});

test("an empty library reads as an invitation", async () => {
  mockCommand("get_stats", () => emptyStats());
  await openApp();

  const block = screen.getByRole("status");
  expect(block.textContent).toContain("No wallpapers yet");
  expect(block.textContent).toContain(
    "Choose a library root and scan it to start ranking.",
  );
  // Not a fault, and nothing offers to retry a read that succeeded.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("a library that would not read reads as a fault, in the backend's own words", async () => {
  mockCommand("get_stats", () =>
    Promise.reject({ kind: "db", message: "database is locked" }),
  );
  expectConsoleError(/Failed to load library stats/);
  await openApp();
  expect(showingView()).toBe("settings");

  // The two landings must not look alike: a different heading, a different
  // colour, and one of them has a button to press rather than a field to fill.
  const block = screen.getByRole("alert");
  expect(block.textContent).toContain("Couldn't read the library");
  expect(block.textContent).toContain("database is locked");
  expect(block.querySelector("p")?.className).toContain("text-destructive");
  expect(screen.queryByRole("status")).toBeNull();
  expect(block.textContent).not.toContain("No wallpapers yet");

  // And the sections are all still there in the same order underneath, because
  // nothing in this slot is hidden or reordered between its states.
  expect(sectionHeadings()).toEqual([
    "Library root",
    "Reject destination",
    "Appearance",
    "Thumbnails",
  ]);
});

test("Retry re-reads the library, and a read that succeeds clears the block", async () => {
  mockCommand("get_stats", () => {
    statsCalls++;
    return Promise.reject({ kind: "db", message: "database is locked" });
  });
  expectConsoleError(/Failed to load library stats/);
  expectConsoleError(/Retrying the library read failed/);
  await openApp();
  expect(statsCalls).toBe(1);

  // A fault that is still there says so with whatever the backend said this
  // time, rather than leaving the first sentence up.
  mockCommand("get_stats", () => {
    statsCalls++;
    return Promise.reject({ kind: "db", message: "permission denied" });
  });
  await click(screen.getByRole("button", { name: "Retry" }));
  expect(statsCalls).toBe(2);
  expect(screen.getByRole("alert").textContent).toContain("permission denied");

  // The fault is outside the app, so a read that now works is the whole of the
  // fix and the block has nothing left to report.
  mockCommand("get_stats", () => {
    statsCalls++;
    return stats();
  });
  await click(screen.getByRole("button", { name: "Retry" }));
  expect(statsCalls).toBe(3);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

  // The page is still the page: clearing the slot leaves the sections where
  // they were, and the curator on Settings.
  expect(showingView()).toBe("settings");
  expect(sectionHeadings().length).toBe(4);
});

test("neither block is up when boot found a library it could read", async () => {
  await openSettingsFromLibrary();

  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sectionHeadings().length).toBe(4);
});

// The Library root section. Most of what follows came from `tests/ScanView.test.tsx`
// with the copy it asserted, since the screen that file drove is what this
// section replaced (ADR 0020).

test("the section holds a field, a Browse button and the button that scans", async () => {
  await openSettingsFromLibrary();

  const section = document.querySelectorAll('[data-slot="settings-section"]')[0];
  expect(section.querySelector("h2")?.textContent).toBe("Library root");
  expect(section.contains(scanInput())).toBe(true);
  expect(
    section.contains(screen.getByRole("button", { name: "Browse" })),
  ).toBe(true);
  expect(section.contains(scanButton())).toBe(true);
});

test("the status line says where the Written path points", async () => {
  await openSettingsFromLibrary();
  await type("~/pics");

  // The point of the line: `~` and variables are not a guess, and the field
  // keeps holding what the curator typed (ADR 0011).
  expect(statusLine().textContent).toBe(`${HOME}/pics`);
  expect(statusLine().className).toContain("font-mono");
  expect(statusLine().className).toContain("text-muted-foreground");
  expect(scanInput().value).toBe("~/pics");
});

test("a folder that is not there is said on the same line, and not in the destructive colour", async () => {
  mockCommand("expand_path", (args) => ({
    resolved: String(args?.input).replace(/^~/, HOME),
    exists: false,
  }));
  await openSettingsFromLibrary();
  await type("~/on-the-other-drive");

  // Where it points and that nothing is there, in one glance. The Library root
  // is a stated preference that may point somewhere that no longer exists, and
  // the usual cause is an unmounted drive rather than a mistake — so this is
  // not an error (CONTEXT.md, ADR 0020).
  expect(statusLine().textContent).toBe(
    `${HOME}/on-the-other-drive · folder not found`,
  );
  expect(statusLine().className).not.toContain("text-destructive");
});

test("a mistyped variable replaces the line, in the backend's own words", async () => {
  // The one error kind rendered verbatim: no canned string can name the
  // variable, and naming it is what sends the curator to their typo instead of
  // to their filesystem (ADR 0011).
  mockCommand("expand_path", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await openSettingsFromLibrary();
  await type("$HOEM/pics");

  expect(statusLine().textContent).toBe("unknown environment variable HOEM");
  expect(statusLine().className).toContain("text-destructive");
  // Replaces rather than joins: there is no resolved path to show beside it.
  expect(statusLine().textContent).not.toContain(HOME);
});

test("an empty field shows no line at all", async () => {
  await openSettingsFromLibrary();

  // The first-run block above is already saying it in full sentences, and an
  // empty field has nothing to resolve.
  expect(statusLine()).toBeNull();

  await type("~/pics");
  expect(statusLine()).not.toBeNull();

  await type("");
  expect(statusLine()).toBeNull();
});

test("the field commits on blur, and a keystroke commits nothing", async () => {
  await openSettingsFromLibrary();
  await type("~/pics");

  // Never per keystroke: a path would otherwise be stored one character at a
  // time (ADR 0010).
  expect(settingWrites).toEqual([]);

  await blurField();
  expect(settingWrites).toEqual([{ key: "library_root", value: "~/pics" }]);
  // And a blur never scans. It happens on the way to the Browse button beside
  // the field, and a scan walks a filesystem.
  expect(scannedPaths).toEqual([]);

  // A second blur with nothing changed writes nothing: the store already holds
  // this string.
  await blurField();
  expect(settingWrites.length).toBe(1);
});

test("Browse fills the field with the folder the curator pointed at", async () => {
  const picker = mockFolderPicker("/mnt/photos/walls");
  await openSettingsFromLibrary();
  await type("~/pics");

  await click(screen.getByRole("button", { name: "Browse" }));

  expect(picker.opened).toBe(1);
  // The cost ADR 0020 accepted for having a picker at all: it answers with an
  // absolute canonical path, so browsing after typing `~/pics` discards the
  // portability the `~` was there for. Nothing warns, because the curator has
  // just pointed at the folder they meant.
  expect(scanInput().value).toBe("/mnt/photos/walls");
  // Committed by the pick, since the field lost focus to this button on the way
  // here and will not blur again.
  expect(settingWrites).toEqual([
    { key: "library_root", value: "/mnt/photos/walls" },
  ]);
});

test("a picker the curator dismissed leaves the field alone", async () => {
  const picker = mockFolderPicker(null);
  await openSettingsFromLibrary();
  await type("~/pics");

  await click(screen.getByRole("button", { name: "Browse" }));

  // A dismissal is an answer rather than a failure, and the answer is that the
  // field keeps what it had.
  expect(picker.opened).toBe(1);
  expect(scanInput().value).toBe("~/pics");
  expect(settingWrites).toEqual([]);
});

test("Scan stores the Written path and then walks it, unexpanded", async () => {
  await openSettingsFromLibrary();
  await type("~/pics");

  await click(scanButton());

  // The order is the decision (ADR 0010): the store learns the folder, then the
  // walk starts. And it starts on the string as written, because the backend is
  // what expands a Written path and storing one expanded would freeze what a
  // variable meant this session (ADR 0011).
  expect(scanSequence).toEqual(["set_setting", "start_scan"]);
  expect(settingWrites).toEqual([{ key: "library_root", value: "~/pics" }]);
  expect(scannedPaths).toEqual(["~/pics"]);
});

test("Enter in the field does what the button does", async () => {
  // The habit the screen this section replaced taught.
  await openSettingsFromLibrary();
  await type("~/pics");

  await pressEnter();

  expect(scanSequence).toEqual(["set_setting", "start_scan"]);
  expect(scannedPaths).toEqual(["~/pics"]);
});

test("a blur on the way to the button does not make the scan write twice", async () => {
  await openSettingsFromLibrary();
  await type("~/pics");

  // What the browser does when the curator clicks the button: the field loses
  // focus first, and its commit is the write the scan would otherwise repeat.
  await blurField();
  await click(scanButton());

  expect(scanSequence).toEqual(["set_setting", "start_scan"]);
  expect(scannedPaths).toEqual(["~/pics"]);
});

test("the button reads Rescan once there is a library to rescan", async () => {
  await openSettingsFromLibrary();
  expect(scanButton().textContent).toBe("Rescan");
});

test("an empty library offers Scan, and it is the only primary control on the page", async () => {
  mockCommand("get_stats", () => emptyStats());
  await openApp();

  expect(scanButton().textContent).toBe("Scan");
  // The one thing to do on a first run, and the page says so with the only
  // filled button on it (ADR 0020).
  const primary = Array.from(document.querySelectorAll("button")).filter(
    (button) => button.className.includes("bg-primary"),
  );
  expect(primary.map((button) => button.textContent)).toEqual(["Scan"]);
});

test("an empty field cannot start a scan", async () => {
  await openSettingsFromLibrary();

  expect(scanButton().disabled).toBe(true);
  // Enter bypasses a disabled button, so the handler guards the path itself.
  await pressEnter();
  expect(scannedPaths).toEqual([]);
});

test("a running scan counts up on the button, and the completion frees it", async () => {
  await openSettingsFromLibrary();
  await type("/tmp/wallpapers");
  await click(scanButton());

  expect(scanButton().textContent).toBe("Scanning…");
  await emit("scan-progress", { scanned: 412, added: 38 });

  // The same counters the shell reports, on the page the curator started the
  // scan from and is looking at — which is why the shell's report is suppressed
  // here (ADR 0021).
  expect(scanButton().textContent).toBe("Scanning… 412 scanned, 38 added");

  await emit("scan-complete", { added_count: 38, scanned_count: 412 });
  expect(scanButton().textContent).toBe("Rescan");
  expect(scanButton().disabled).toBe(false);
});

test("a scan in flight cannot be started a second time", async () => {
  await openSettingsFromLibrary();
  await type("/tmp/wallpapers");
  await click(scanButton());

  // Nothing cancels a scan: no command exists, so the only refusal the button
  // has is to stay disabled, and Enter is guarded for the same reason.
  expect(scanButton().disabled).toBe(true);
  await pressEnter();
  expect(scannedPaths).toEqual(["/tmp/wallpapers"]);
});

test("a scan that fails mid-walk frees the button and says nothing on the line", async () => {
  await openSettingsFromLibrary();
  await type("/tmp/wallpapers");
  await click(scanButton());
  await emit("scan-progress", { scanned: 10, added: 10 });

  await emit("scan-failed", { message: "permission denied" });

  // How a scan ended is the toast's to report, where it reaches a curator who
  // has long since left this page (ADR 0021). What is left here is a button
  // with a scan to stop presenting as running.
  expect(scanButton().textContent).toBe("Rescan");
  expect(scanButton().disabled).toBe(false);
  expect(statusLine().textContent).toBe("/tmp/wallpapers");
});

test("an unreadable path lands on the status line, and the next keystroke clears it", async () => {
  expectConsoleError(/invalid_path/);
  mockCommand("start_scan", (args) =>
    Promise.reject({
      kind: "invalid_path",
      message: `${args?.path} is not a directory`,
    }),
  );
  await openSettingsFromLibrary();
  await type("/definitely/not/a/dir");
  await click(scanButton());

  // On the line and not in a toast: the field is where the fix is typed, and an
  // error the curator can read before clicking beats one that arrives after
  // (ADR 0020). `InvalidPath` carries a bare path rather than a sentence, so
  // the sentence is this one.
  expect(statusLine().textContent).toBe(
    "That directory doesn't exist or can't be read.",
  );
  expect(statusLine().className).toContain("text-destructive");
  expect(scanButton().disabled).toBe(false);

  // It holds the line until the value moves, because until then it is still the
  // newest thing anyone knows about that string.
  await type("/tmp/wallpapers");
  expect(statusLine().textContent).toBe("/tmp/wallpapers");
});

test("a scan refused for a mistyped variable is reported by name", async () => {
  expectConsoleError(/invalid_path_syntax/);
  mockCommand("start_scan", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await openSettingsFromLibrary();
  await type("$HOEM/pics");
  await click(scanButton());

  expect(statusLine().textContent).toBe("unknown environment variable HOEM");
  expect(statusLine().textContent).not.toContain("Failed to scan directory");
});

test("a scan refused for a reason the page did not expect falls back to one sentence", async () => {
  expectConsoleError(/db/);
  mockCommand("start_scan", () =>
    Promise.reject({ kind: "db", message: "database is locked" }),
  );
  await openSettingsFromLibrary();
  await type("/tmp/wallpapers");
  await click(scanButton());

  expect(statusLine().textContent).toBe(
    "Failed to scan directory. Please check the path.",
  );
  expect(scanButton().disabled).toBe(false);
});

test("the count line reports the library's size, and follows a scan", async () => {
  await openSettingsFromLibrary();

  // A fact rather than another control, from the `Stats` boot already read. No
  // last-scanned time beside it, because nothing records one (ADR 0020).
  expect(screen.queryByText("12 wallpapers in the library")).not.toBeNull();

  mockCommand("get_stats", () => {
    statsCalls++;
    return stats({ total_wallpapers: 15, eligible_count: 13 });
  });
  await emit("scan-complete", { added_count: 3, scanned_count: 40 });

  expect(screen.queryByText("15 wallpapers in the library")).not.toBeNull();
  expect(showingView()).toBe("settings");
});

test("a first run puts the caret in the field without selecting what is in it", async () => {
  mockCommand("get_stats", () => emptyStats());
  mockCommand("get_settings", () => settings({ library_root: "~/pics" }));
  await openApp();

  const field = scanInput();
  expect(document.activeElement).toBe(field);
  // Not selected: this field writes on blur, and a selected value is one
  // keystroke away from being an empty Library root that the next blur stores
  // (ADR 0020).
  const { selectionStart, selectionEnd, value } = field;
  expect(value.slice(selectionStart ?? 0, selectionEnd ?? 0)).toBe("");
  expect(value).toBe("~/pics");
});

test("leaving the page drops its scan subscriptions", async () => {
  await openSettingsFromLibrary();

  // Two listeners for the same event: this section's, for the button's label,
  // and the toast surface's, which reports the same scan wherever the curator
  // goes (ADR 0021).
  expect(await emit("scan-progress", { scanned: 1, added: 1 })).toBe(2);

  await click(backControl() as HTMLButtonElement);

  // Settings is the one view the shell unmounts, so this one has to go and the
  // shell's has to stay.
  expect(await emit("scan-progress", { scanned: 2, added: 2 })).toBe(1);
});
