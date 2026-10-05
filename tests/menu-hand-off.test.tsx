import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context/AppContext";
import {
  useKeyboardSurface,
  useMenuHandOff,
} from "@/context/KeyboardHandoffContext";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { useMemo, useRef } from "react";
import { flush, mockBootedApp, press, renderInApp } from "./fixtures";

// Where a menu leaves the keyboard as it closes (ADR 0047, #421): Library's
// ordering and Discover's pills all take `useMenuHandOff`, so the rule is
// tested here once, on a menu of its own over a page whose surface is a
// button standing in for the grid.

// The clock is faked here rather than trusted: Radix gives the focus back from
// a timeout, and a file before this one may have left the clock faked anyway.
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
beforeEach(() => {
  jest.useFakeTimers();
  mockBootedApp();
});

function Page() {
  const { view } = useApp();
  const grid = useRef<HTMLButtonElement | null>(null);
  const surface = useMemo(
    () => ({ focusSelection: () => grid.current?.focus() }),
    [],
  );
  useKeyboardSurface(view, surface);
  const handOff = useMenuHandOff();
  return (
    <>
      <button ref={grid}>the grid</button>
      <DropdownMenu>
        <DropdownMenuTrigger {...handOff.trigger}>Sort</DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={handOff.onCloseAutoFocus}>
          <DropdownMenuCheckboxItem>Newest</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Sort" });
const menuOpen = () => screen.queryByRole("menu") !== null;

async function closeMenu() {
  await press("Escape", { target: screen.getByRole("menu") });
  // Radix gives the focus back from a timeout once the menu has unmounted.
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  await flush();
}

test("a menu the pointer opened hands the keyboard to the page as it closes", async () => {
  await renderInApp(<Page />);
  await act(async () => {
    fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
  });
  await flush();
  expect(menuOpen()).toBe(true);

  await closeMenu();

  expect(menuOpen()).toBe(false);
  expect(document.activeElement).toBe(screen.getByText("the grid"));
});

test("a menu the keyboard opened gives the focus back to its trigger", async () => {
  await renderInApp(<Page />);
  await act(async () => {
    trigger().focus();
  });
  await press("Enter");
  expect(menuOpen()).toBe(true);

  await closeMenu();

  expect(menuOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger());
});
