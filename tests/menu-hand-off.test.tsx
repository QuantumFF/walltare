import { useApp } from "@/context/AppContext";
import {
  useKeyboardSurface,
  useMenuHandOff,
  type MenuHandOff,
} from "@/context/KeyboardHandoffContext";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { useMemo, useRef } from "react";
import { flush, mockBootedApp, renderInApp } from "./fixtures";

// Where a menu leaves the keyboard as it closes (ADR 0047, #421): Library's
// ordering and Discover's pills all take `useMenuHandOff`, so the rule is
// tested here once, through the two halves it hands a menu, over a page whose
// surface is a button standing in for the grid.
//
// The close is called the way Radix calls it, with a cancelable event, rather
// than by driving a Radix menu: Radix gives the focus back from a timeout, and
// a file before this one may have left the clock faked. What Radix does when
// the event is not prevented, putting the focus back on the trigger, is
// Radix's.

afterEach(cleanup);
beforeEach(() => {
  mockBootedApp();
});

let menu: MenuHandOff;

function Page() {
  const { view } = useApp();
  const grid = useRef<HTMLButtonElement | null>(null);
  const surface = useMemo(
    () => ({ focusSelection: () => grid.current?.focus() }),
    [],
  );
  useKeyboardSurface(view, surface);
  menu = useMenuHandOff();
  return (
    <>
      <button ref={grid}>the grid</button>
      <button {...menu.trigger}>Sort</button>
    </>
  );
}

const trigger = () => screen.getByText("Sort");
const grid = () => screen.getByText("the grid");

/** The menu closing, and whether its own focus return was stopped. */
async function closeMenu(): Promise<boolean> {
  const event = new Event("focusScope.autoFocusOnUnmount", {
    cancelable: true,
  });
  await act(async () => {
    menu.onCloseAutoFocus(event);
  });
  await flush();
  return event.defaultPrevented;
}

test("a menu the pointer opened hands the keyboard to the page as it closes", async () => {
  await renderInApp(<Page />);
  fireEvent.pointerDown(trigger());

  expect(await closeMenu()).toBe(true);
  expect(document.activeElement).toBe(grid());
});

test("a menu the keyboard opened leaves the focus to the menu's own return", async () => {
  await renderInApp(<Page />);
  await act(async () => {
    trigger().focus();
  });
  fireEvent.keyDown(trigger(), { key: "Enter" });

  expect(await closeMenu()).toBe(false);
  expect(document.activeElement).toBe(trigger());
});

test("the press that opened the menu decides, not the one before it", async () => {
  await renderInApp(<Page />);
  fireEvent.pointerDown(trigger());
  await closeMenu();
  await act(async () => {
    trigger().focus();
  });

  fireEvent.keyDown(trigger(), { key: "Enter" });
  expect(await closeMenu()).toBe(false);
  expect(document.activeElement).toBe(trigger());
});
