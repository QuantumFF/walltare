import App from "@/App";
import { Layout } from "@/components/Layout";
import { AppProvider, useApp } from "@/context/AppContext";
import { AppEventsProvider } from "@/context/AppEventsContext";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { expectConsoleError } from "./console-guard";
import type { CacheSize } from "@/lib/client";
import {
  cacheSize,
  desktopColorScheme,
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
/** What the next walk of the cache directory finds, so a clear can change it. */
let cacheReading: CacheSize;
/** Walks of the cache directory, which ADR 0020 rations to three occasions. */
let cacheSizeCalls = 0;
/** Every pass command the backend heard, including the one the shell makes on boot. */
let pregenCommands: string[];
let clearCalls = 0;

afterEach(cleanup);

afterEach(() => {
  // Both the palette class and the desktop underneath it sit outside the render
  // and outlive it, so each has to go back before the next test arranges its
  // own.
  document.documentElement.classList.remove("light", "dark");
  desktopColorScheme("light");
});

beforeEach(() => {
  statsCalls = 0;
  scannedPaths = [];
  settingWrites = [];
  scanSequence = [];
  cacheReading = cacheSize();
  cacheSizeCalls = 0;
  pregenCommands = [];
  clearCalls = 0;

  // A library with wallpapers in it, so boot lands on Rank and the curator
  // reaches Settings through the gear — which is what puts a `returnTo` on the
  // navigation. The tests about a first run and a failed boot override it.
  mockCommand("get_stats", () => {
    statsCalls++;
    return stats();
  });
  mockCommand("get_settings", () => settings());
  // The shell starts a pass as soon as it mounts, so every render in this file
  // reaches this one before the curator has clicked anything (ADR 0012).
  mockCommand("start_pregen", () => {
    pregenCommands.push("start_pregen");
    return null;
  });
  mockCommand("cancel_pregen", () => {
    pregenCommands.push("cancel_pregen");
    return null;
  });
  // A walk of the cache directory, answering with whatever is on disk now — so a
  // clear can empty it between two readings the way the backend would.
  mockCommand("get_cache_size", () => {
    cacheSizeCalls++;
    return cacheReading;
  });
  mockCommand("clear_cache", () => {
    clearCalls++;
    return null;
  });
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
const destinationInput = () =>
  screen.getByLabelText("Reject destination") as HTMLInputElement;
const destinationLine = () =>
  document.querySelector(
    '[data-slot="reject-destination-status"]',
  ) as HTMLElement;
const sectionAt = (index: number) =>
  document.querySelectorAll('[data-slot="settings-section"]')[
    index
  ] as HTMLElement;
/** Both path fields have one, so a Browse click has to say which field it is for. */
const browseIn = (section: HTMLElement) =>
  within(section).getByRole("button", { name: "Browse" });
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

async function typeDestination(value: string) {
  await act(async () => {
    fireEvent.change(destinationInput(), { target: { value } });
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

  const section = sectionAt(0);
  expect(section.querySelector("h2")?.textContent).toBe("Library root");
  expect(section.contains(scanInput())).toBe(true);
  expect(section.contains(browseIn(section))).toBe(true);
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

  await click(browseIn(sectionAt(0)));

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

  await click(browseIn(sectionAt(0)));

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

// The Reject destination section, which is the only place `reject_destination`
// can be edited (ADR 0018). One test per row of ADR 0020's table, because the
// three lines are the section's real content: the field and its Browse button
// are the Library root's again, and the line is the part that is not.

/**
 * The app, plus the control ADR 0018 promises and no view carries yet.
 *
 * Review's and Library's second bars route here with `focus:
 * "reject_destination"`, and both read-outs belong to tickets of their own. This
 * stands in for them so that the arrival this section has to answer can be
 * tested against the page that answers it, rather than deferred to whichever of
 * the two lands first.
 */
function DeepLink() {
  const { setView } = useApp();
  return (
    <button
      onClick={() =>
        setView("settings", { returnTo: "review", focus: "reject_destination" })
      }
    >
      change in Settings
    </button>
  );
}

async function openSettingsOnTheDestination() {
  render(
    <AppProvider>
      <AppEventsProvider>
        <DeepLink />
        <Layout />
      </AppEventsProvider>
    </AppProvider>,
  );
  await flush();
  await click(screen.getByRole("button", { name: "change in Settings" }));
  expect(showingView()).toBe("settings");
}

test("the section holds a field, a Browse button and one status line", async () => {
  await openSettingsFromLibrary();

  const section = sectionAt(1);
  expect(section.querySelector("h2")?.textContent).toBe("Reject destination");
  expect(section.contains(destinationInput())).toBe(true);
  expect(section.contains(browseIn(section))).toBe(true);
  // One line, and nothing beside it: there is no count to print here and
  // nothing to run, so the section is the field, the button and the sentence.
  expect(section.contains(destinationLine())).toBe(true);
  expect(section.querySelectorAll("p").length).toBe(1);
  // And no button that starts anything, which is what makes Enter's job below
  // the whole of what Enter can do here.
  expect(within(section).queryAllByRole("button").length).toBe(1);
});

test("an absolute destination shows the folder it resolves to", async () => {
  mockCommand("get_settings", () => settings({ reject_destination: "~/bin" }));
  await openSettingsFromLibrary();

  // A place, so the line names it, in the same mono the Library root's resolved
  // path is in.
  expect(destinationLine().textContent).toBe(`${HOME}/bin`);
  expect(destinationLine().className).toContain("font-mono");
  expect(destinationLine().className).toContain("text-muted-foreground");
  expect(destinationInput().value).toBe("~/bin");
});

test("a relative destination states the rule instead of a place", async () => {
  await openSettingsFromLibrary();

  // The default, and the most surprising thing about this setting: relative
  // means beside each wallpaper rather than beside the library root, so a nested
  // library gets one rejected folder per source folder. Settings cannot resolve
  // it — it does not know which wallpaper — so it says what it means instead
  // (ADR 0018, ADR 0020).
  expect(destinationInput().value).toBe("./rejected");
  expect(destinationLine().textContent).toBe(
    "Relative, so one rejected folder beside each wallpaper.",
  );
  // A sentence rather than a path, so it is not set as one.
  expect(destinationLine().className).not.toContain("font-mono");
  expect(destinationLine().className).not.toContain("text-destructive");
});

test("whether a destination is relative is not read off the string", async () => {
  // `$HOME/bin` looks relative and expands absolute, which is why only
  // `expand_path` gets to decide which of the two lines is up (ADR 0018).
  mockCommand("expand_path", (args) => ({
    resolved: String(args?.input).replace(/^\$HOME/, HOME),
    exists: true,
  }));
  await openSettingsFromLibrary();
  await typeDestination("$HOME/bin");

  expect(destinationLine().textContent).toBe(`${HOME}/bin`);
  expect(destinationLine().className).toContain("font-mono");
});

test("a mistyped variable replaces the destination line, in the backend's own words", async () => {
  mockCommand("expand_path", () =>
    Promise.reject({
      kind: "invalid_path_syntax",
      message: "unknown environment variable HOEM",
    }),
  );
  await openSettingsFromLibrary();
  await typeDestination("$HOEM/rejected");

  // It fails every reject of the pass with a message naming the variable, so
  // reading it here beats reading it fifty times afterwards (ADR 0018).
  expect(destinationLine().textContent).toBe(
    "unknown environment variable HOEM",
  );
  expect(destinationLine().className).toContain("text-destructive");
});

test("no destination is ever reported as not found", async () => {
  // Nothing has to be there: a soft reject creates the destination on demand
  // (ADR 0003), so this field ignores the `exists` its own resolution answered
  // with — the one thing it reads past that the Library root reports.
  mockCommand("expand_path", (args) => ({
    resolved: String(args?.input).replace(/^~/, HOME),
    exists: false,
  }));
  await openSettingsFromLibrary();

  expect(destinationLine().textContent).toBe(
    "Relative, so one rejected folder beside each wallpaper.",
  );

  await typeDestination("~/bin/nowhere");
  expect(destinationLine().textContent).toBe(`${HOME}/bin/nowhere`);
  expect(destinationLine().textContent).not.toContain("not found");
  expect(destinationLine().className).not.toContain("text-destructive");
});

test("the destination commits on blur, and a keystroke commits nothing", async () => {
  await openSettingsFromLibrary();
  await typeDestination("~/bin/rejects");

  expect(settingWrites).toEqual([]);

  await act(async () => {
    fireEvent.blur(destinationInput());
  });
  await flush();
  expect(settingWrites).toEqual([
    { key: "reject_destination", value: "~/bin/rejects" },
  ]);

  // A second blur with nothing changed writes nothing: the store already holds
  // this string.
  await act(async () => {
    fireEvent.blur(destinationInput());
  });
  await flush();
  expect(settingWrites.length).toBe(1);
});

test("Enter commits and starts nothing", async () => {
  await openSettingsFromLibrary();
  await typeDestination("~/bin/rejects");

  await act(async () => {
    fireEvent.keyDown(destinationInput(), { key: "Enter" });
  });
  await flush();

  // The Library root's Enter scans, because that section has a walk to start.
  // There is nothing of the sort here, so Enter does the one thing the blur
  // would have done and the rest of the app is left alone (ADR 0020).
  expect(settingWrites).toEqual([
    { key: "reject_destination", value: "~/bin/rejects" },
  ]);
  expect(scanSequence).toEqual(["set_setting"]);
  expect(scannedPaths).toEqual([]);
});

test("Browse fills the destination with the folder the curator pointed at", async () => {
  const picker = mockFolderPicker("/mnt/photos/rejects");
  await openSettingsFromLibrary();

  await click(browseIn(sectionAt(1)));

  expect(picker.opened).toBe(1);
  expect(destinationInput().value).toBe("/mnt/photos/rejects");
  // Committed by the pick, since the field lost focus to this button on the way
  // here and will not blur again.
  expect(settingWrites).toEqual([
    { key: "reject_destination", value: "/mnt/photos/rejects" },
  ]);
  // And the line changes shape with it: what was a rule is now a place.
  expect(destinationLine().textContent).toBe("/mnt/photos/rejects");
});

test("a picker the curator dismissed leaves the destination alone", async () => {
  const picker = mockFolderPicker(null);
  await openSettingsFromLibrary();

  await click(browseIn(sectionAt(1)));

  expect(picker.opened).toBe(1);
  expect(destinationInput().value).toBe("./rejected");
  expect(settingWrites).toEqual([]);
});

test("arriving from a read-out puts the caret in the field without selecting what is in it", async () => {
  mockCommand("get_settings", () =>
    settings({ reject_destination: "~/bin/rejects" }),
  );
  await openSettingsOnTheDestination();

  const field = destinationInput();
  expect(document.activeElement).toBe(field);
  // Not selected: this field writes on blur, and a selected value is one
  // keystroke away from being an empty reject destination that the next blur
  // stores (ADR 0020).
  const { selectionStart, selectionEnd, value } = field;
  expect(value.slice(selectionStart ?? 0, selectionEnd ?? 0)).toBe("");
  expect(value).toBe("~/bin/rejects");
});

// The Appearance section. What the curator can observe here is two things at
// once: which of the three is chosen, and what colour the window went — so
// every test below asserts the palette on the document element rather than the
// call that put it there. The write is the one exception, pinned by argument
// for the same reason the other two are: a palette stored under the wrong key
// is invisible until the next launch.

/** The palette classes index.css keys off, in the order light-then-dark. */
function palette(): { light: boolean; dark: boolean } {
  const { classList } = document.documentElement;
  return {
    light: classList.contains("light"),
    dark: classList.contains("dark"),
  };
}

const paletteChoice = (name: string) => screen.getByRole("radio", { name });

/** Whichever of the three is chosen, by name. There is always exactly one. */
function chosenPalette(): string[] {
  return screen
    .getAllByRole("radio")
    .filter((choice) => choice.getAttribute("aria-checked") === "true")
    .map((choice) => choice.textContent ?? "");
}

/**
 * Flip the desktop underneath the window, and let the media query notice.
 *
 * happy-dom answers `prefers-color-scheme` out of its own device settings and
 * re-evaluates a live `MediaQueryList` on a window resize, so the resize is what
 * stands in for the colour-scheme change a compositor sends. It dispatches only
 * when the answer actually moved, which is why every flip here goes from light
 * to dark and never back.
 */
async function flipDesktop(scheme: "light" | "dark") {
  desktopColorScheme(scheme);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
  await flush();
}

test("the section offers three palettes, with one of them always chosen", async () => {
  await openSettingsFromLibrary();

  const section = sectionAt(2);
  expect(section.querySelector("h2")?.textContent).toBe("Appearance");
  // A radio group and not a row of toggles: `theme` has no "none" to hold, so
  // the primitive that cannot express one is the correct one (ADR 0020).
  expect(within(section).getByRole("radiogroup")).not.toBeNull();
  expect(
    within(section)
      .getAllByRole("radio")
      .map((choice) => choice.textContent),
  ).toEqual(["System", "Light", "Dark"]);

  // The default, and the state a toggle group would have let the curator click
  // their way out of.
  expect(chosenPalette()).toEqual(["System"]);
});

test("choosing Dark writes the theme and repaints there and then", async () => {
  await openSettingsFromLibrary();
  expect(palette()).toEqual({ light: true, dark: false });

  await click(paletteChoice("Dark"));

  // The palette is one of three named things rather than a string being typed,
  // so the choice writes on change and there is no blur to wait for (ADR 0010).
  expect(settingWrites).toEqual([{ key: "theme", value: "dark" }]);
  // And the window is already dark, with nothing reloaded: the write answers
  // with the whole struct, and the class on the document element follows it.
  expect(palette()).toEqual({ light: false, dark: true });
  expect(chosenPalette()).toEqual(["Dark"]);
});

test("on System the window follows the desktop when it flips", async () => {
  await openSettingsFromLibrary();
  expect(chosenPalette()).toEqual(["System"]);
  expect(palette()).toEqual({ light: true, dark: false });

  await flipDesktop("dark");

  // The point of the listener: a window that stayed light here would disagree
  // with everything around it until the next launch (ADR 0020).
  expect(palette()).toEqual({ light: false, dark: true });
  // And the choice has not moved. Following the desktop is what System means,
  // not a value the desktop got to write.
  expect(chosenPalette()).toEqual(["System"]);
  expect(settingWrites).toEqual([]);
});

test("on Light the desktop flipping changes nothing", async () => {
  mockCommand("get_settings", () => settings({ theme: "light" }));
  await openSettingsFromLibrary();
  expect(chosenPalette()).toEqual(["Light"]);

  await flipDesktop("dark");

  // Light and Dark are the curator saying which palette they want regardless of
  // what is around the window, so the flip is not theirs to answer.
  expect(palette()).toEqual({ light: true, dark: false });
});

test("moving the choice off System stops the window following the desktop", async () => {
  await openSettingsFromLibrary();
  await click(paletteChoice("Light"));
  expect(palette()).toEqual({ light: true, dark: false });

  await flipDesktop("dark");

  // The subscription is dropped when the choice moves off System, and this is
  // what a stale one would look like: it closed over `system`, so it would
  // repaint the window dark against a Light the curator had just chosen.
  expect(palette()).toEqual({ light: true, dark: false });
  expect(chosenPalette()).toEqual(["Light"]);
});

test("nothing follows the desktop once the app is gone", async () => {
  await openSettingsFromLibrary();
  expect(palette()).toEqual({ light: true, dark: false });

  cleanup();
  await flipDesktop("dark");

  // The listener lives with `AppProvider` rather than with this page, so its
  // one teardown is the app going away — and a palette written after that is a
  // subscription outliving the tree that made it.
  expect(palette()).toEqual({ light: true, dark: false });
});

test("the window keeps following the desktop after Settings is closed", async () => {
  // Why the listener is not in this section: Settings is the one view the shell
  // unmounts, so a listener owned by the page would follow the desktop only
  // while the curator happened to be looking at the page instead of at the
  // desktop that flipped (ADR 0015).
  await openSettingsFromLibrary();
  await click(gear());
  expect(showingView()).toBe("library");

  await flipDesktop("dark");

  expect(palette()).toEqual({ light: false, dark: true });
});

// The Thumbnails section, which is the only maintenance on the page: one line,
// a button that changes verb, and a confirm with a number in it. What the
// curator reads is the line and the verb, so that is what the tests below
// assert; the three commands with a side effect — the pass, the cancel and the
// clear — are pinned by call, because none of them shows on screen and a Clear
// that fired on dismissal would be silent and expensive (ADR 0020).

const thumbnails = () => sectionAt(3);
const cacheLine = () =>
  document.querySelector(
    '[data-slot="thumbnail-cache-status"]',
  ) as HTMLElement | null;
/** The one button that is Generate now or Cancel, by whichever verb it is showing. */
const passButton = () =>
  within(thumbnails()).getByRole("button", {
    name: /^(generate now|cancel)$/i,
  }) as HTMLButtonElement;
const clearButton = () =>
  within(thumbnails()).getByRole("button", {
    name: "Clear cache",
  }) as HTMLButtonElement;
const confirmDialog = () => screen.queryByRole("alertdialog");
/**
 * A control inside the open confirm, which is where every one of these queries
 * has to be scoped: the dialog carries a Clear cache of its own over the trigger
 * that opened it, and a Cancel of its own over the button that stops a pass.
 */
const inDialog = (name: string) =>
  within(confirmDialog() as HTMLElement).getByRole("button", { name });

test("the section is one line and two buttons", async () => {
  await openSettingsFromLibrary();

  const section = thumbnails();
  expect(section.querySelector("h2")?.textContent).toBe("Thumbnails");
  expect(section.contains(cacheLine())).toBe(true);
  expect(
    within(section)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Generate now", "Clear cache"]);
});

test("the line says how much is cached and how many files that is", async () => {
  await openSettingsFromLibrary();

  // Hundreds of megabytes under `app_data` that nothing else on the machine
  // explains, which is what the readout exists for (ADR 0012).
  expect(cacheLine()?.textContent).toBe("48 MB cached · 172 files");
});

test("the size is written in the decimal units every number about this cache is in", async () => {
  cacheReading = cacheSize({ bytes: 1_600_000, files: 52 });
  await openSettingsFromLibrary();

  // ADR 0012's own reading of the 52 small thumbnails, printed back as itself:
  // one decimal while the number is small enough for it to mean anything, and
  // powers of 1,000, because 46MB over 120 files is where its 383KB per file
  // came from.
  expect(cacheLine()?.textContent).toBe("1.6 MB cached · 52 files");
});

test("a running pass replaces the file count with its own", async () => {
  await openSettingsFromLibrary();

  await emit("pregen-progress", { done: 240, total: 1204 });

  // The words ADR 0021 put in the shell's report, because they are these ones:
  // one fact, one phrasing, in both places — and grouped in threes here rather
  // than through the host's locale, so a German desktop cannot print `1.204` on
  // one surface and `1,204` on the other.
  expect(cacheLine()?.textContent).toBe(
    "48 MB cached · 240 of 1,204 generated",
  );
});

test("an empty cache says so, and Clear cache offers nothing", async () => {
  cacheReading = cacheSize({ bytes: 0, files: 0 });
  await openSettingsFromLibrary();

  expect(cacheLine()?.textContent).toBe("Nothing cached yet");
  // A control that offers to remove nothing should say so rather than sit there
  // enabled (ADR 0020).
  expect(clearButton().disabled).toBe(true);
  // And the other button still has work to offer, which is the whole of what an
  // empty cache is a reason to do.
  expect(passButton().disabled).toBe(false);
});

test("Generate now starts a pass, and the same button cancels the one that runs", async () => {
  await openSettingsFromLibrary();

  // The shell has already started one on boot, and this page cannot tell: no
  // command reports whether a pass is running, so the verb is read off the
  // events and the button says Generate now until one arrives.
  expect(pregenCommands).toEqual(["start_pregen"]);
  expect(passButton().textContent).toBe("Generate now");

  await click(passButton());
  expect(pregenCommands).toEqual(["start_pregen", "start_pregen"]);

  await emit("pregen-progress", { done: 0, total: 1204 });

  // This is where `cancel_pregen` lives. ADR 0012 added the command and left it
  // homeless, and the control that started the work is the one that stops it.
  expect(passButton().textContent).toBe("Cancel");
  await click(passButton());
  expect(pregenCommands).toEqual([
    "start_pregen",
    "start_pregen",
    "cancel_pregen",
  ]);

  // And the verb goes back when the pass does, not when the request was made: a
  // cancel lands up to one wallpaper's decode late (ADR 0012), so until the
  // ending arrives there is still a thread decoding.
  expect(passButton().textContent).toBe("Cancel");
  await emit("pregen-complete", { generated: 12, failed: 0, cancelled: true });
  expect(passButton().textContent).toBe("Generate now");
});

test("a pass already running when the page opens takes the button on its next event", async () => {
  await openSettingsFromLibrary();
  expect(passButton().textContent).toBe("Generate now");

  // The honest half of what this page can do about a pass it never saw start:
  // it cannot ask, so it listens, and a pass in flight announces itself on its
  // next `pregen-progress` — one per wallpaper. Nothing was clicked here.
  await emit("pregen-progress", { done: 800, total: 1204 });

  expect(passButton().textContent).toBe("Cancel");
  expect(cacheLine()?.textContent).toBe(
    "48 MB cached · 800 of 1,204 generated",
  );
  expect(pregenCommands).toEqual(["start_pregen"]);
});

test("Clear cache asks first, with the size in the question", async () => {
  await openSettingsFromLibrary();

  await click(clearButton());

  // Act-then-undo, which every transition in the app uses instead, has nothing
  // to undo here — only to redo slowly, at 420ms a wallpaper (ADR 0009,
  // ADR 0012). So the number the line is showing goes into the question.
  const dialog = confirmDialog() as HTMLElement;
  expect(dialog.textContent).toContain("Clear 48 MB of thumbnails?");
  expect(dialog.textContent).toContain(
    "They regenerate on the next launch, which takes about a minute for 120 wallpapers.",
  );
  // Nothing has happened yet, which is the point of asking.
  expect(clearCalls).toBe(0);
});

test("the question names the pass it would cancel, and only when there is one", async () => {
  await openSettingsFromLibrary();

  await click(clearButton());
  expect(confirmDialog()?.textContent).not.toContain("pass running now");
  await click(inDialog("Cancel"));

  await emit("pregen-progress", { done: 240, total: 1204 });
  await click(clearButton());

  // The second half of what the curator is agreeing to: `clear_cache` cancels
  // any running pass before it empties the directory (ADR 0012), and the button
  // that would otherwise have done that is the one beside this one.
  expect(confirmDialog()?.textContent).toContain(
    "The pass running now will be cancelled with them.",
  );
});

test("the question keeps the numbers it opened with", async () => {
  await openSettingsFromLibrary();
  await emit("pregen-progress", { done: 1203, total: 1204 });
  await click(clearButton());

  cacheReading = cacheSize({ bytes: 96_400_000, files: 344 });
  await emit("pregen-complete", { generated: 1204, failed: 0, cancelled: false });

  // A pass finishing behind the overlay refreshes the size and clears the
  // running pass, and either would rewrite the sentence under the curator while
  // they are reading it — the second one by dropping a clause they have already
  // weighed. So the question says what it said when it opened (ADR 0020).
  expect(confirmDialog()?.textContent).toContain("Clear 48 MB of thumbnails?");
  expect(confirmDialog()?.textContent).toContain(
    "The pass running now will be cancelled with them.",
  );
});

test("dismissing the question clears nothing", async () => {
  await openSettingsFromLibrary();
  await click(clearButton());

  await click(inDialog("Cancel"));

  expect(confirmDialog()).toBeNull();
  expect(clearCalls).toBe(0);
  expect(cacheLine()?.textContent).toBe("48 MB cached · 172 files");
});

test("Escape closes the question rather than the page", async () => {
  await openSettingsFromLibrary();
  await click(clearButton());

  // Radix dismisses its layer from a capture-phase listener and marks the event,
  // and this page stands down on that mark — the same handover the shortcuts
  // dialog gets. One Escape closes one thing, and the expensive one is not it.
  await pressEscape(document.body);

  expect(confirmDialog()).toBeNull();
  expect(showingView()).toBe("settings");
  expect(clearCalls).toBe(0);
});

test("confirming clears the cache, and the line reads what is left", async () => {
  await openSettingsFromLibrary();
  await click(clearButton());

  cacheReading = cacheSize({ bytes: 0, files: 0 });
  await click(inDialog("Clear cache"));

  expect(clearCalls).toBe(1);
  expect(confirmDialog()).toBeNull();
  // Read again afterwards, because a clear is one of the three occasions the
  // number can have moved without the page hearing an event about it.
  expect(cacheLine()?.textContent).toBe("Nothing cached yet");
  expect(clearButton().disabled).toBe(true);
});

test("the size is read on mount and when a pass ends, and never per wallpaper", async () => {
  await openSettingsFromLibrary();
  expect(cacheSizeCalls).toBe(1);

  await emit("pregen-progress", { done: 1, total: 1204 });
  await emit("pregen-progress", { done: 2, total: 1204 });
  await emit("pregen-progress", { done: 3, total: 1204 });

  // `get_cache_size` is a directory read plus a `metadata` per entry, about
  // 10,000 stats on the largest library, and a wallpaper moves the number by
  // 400KB. So the walk is not what follows the pass — the `of 1,204` clause is
  // (ADR 0020).
  expect(cacheSizeCalls).toBe(1);
  expect(cacheLine()?.textContent).toBe("48 MB cached · 3 of 1,204 generated");

  cacheReading = cacheSize({ bytes: 96_400_000, files: 344 });
  await emit("pregen-complete", { generated: 1204, failed: 0, cancelled: false });

  // And the end of a pass is the moment the number on the line is furthest from
  // the truth, which is why it is one of the three that spends the walk.
  expect(cacheSizeCalls).toBe(2);
  expect(cacheLine()?.textContent).toBe("96 MB cached · 344 files");
});

test("leaving the page drops its pass subscriptions", async () => {
  await openSettingsFromLibrary();

  // Two listeners for the same event: this section's, for the line and the
  // verb, and the toast surface's, which reports the same pass wherever the
  // curator goes (ADR 0021).
  expect(await emit("pregen-progress", { done: 1, total: 10 })).toBe(2);

  await click(backControl() as HTMLButtonElement);

  // Settings is the one view the shell unmounts, so this one has to go and the
  // shell's has to stay.
  expect(await emit("pregen-progress", { done: 2, total: 10 })).toBe(1);
});
