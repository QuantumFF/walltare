import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, jest, test } from "bun:test";
import type { ReactNode } from "react";

/** ADR 0009's eight seconds, which the provider applies when nothing overrides it. */
const LIFETIME = 8000;

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/** The shell's arrangement: one provider, one viewport, at most one toast in it. */
function renderToast(toast: ReactNode) {
  return render(
    <ToastProvider>
      {toast}
      <ToastViewport />
    </ToastProvider>,
  );
}

/**
 * Radix defers the announcement by two frames, so that a toast replacing
 * another one does not read out twice. Wait them out rather than reaching into
 * the component: the frames are scheduled in a layout effect during render, so
 * they have fired by the time these two resolve.
 */
async function nextFrames(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
    );
  });
}

test("a toast carries a title, a description and an action named twice over", async () => {
  renderToast(
    <Toast>
      <ToastTitle>Rejected wall-7.jpg</ToastTitle>
      <ToastDescription>/library/rejected/wall-7 (2).jpg</ToastDescription>
      <ToastAction altText="Undo (Ctrl+Z)">Undo</ToastAction>
      <ToastClose />
    </Toast>,
  );

  expect(screen.getByText("Rejected wall-7.jpg")).toBeTruthy();
  expect(screen.getByText("/library/rejected/wall-7 (2).jpg")).toBeTruthy();

  // What a pointer or a Tab reaches is named by the word printed on it.
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();

  // The other name is `altText`, for a reader who cannot get to the button
  // inside eight seconds. Radix reads it out in place of the button's own
  // label, so the live region carries the binding and not the bare verb.
  await nextFrames();
  const announcement = screen.getByRole("status");
  expect(announcement.textContent).toContain("Rejected wall-7.jpg");
  expect(announcement.textContent).toContain("Undo (Ctrl+Z)");
});

test("a toast with no duration of its own closes after eight seconds", () => {
  jest.useFakeTimers();
  renderToast(
    <Toast>
      <ToastTitle>Kept wall-1.jpg</ToastTitle>
    </Toast>,
  );

  expect(screen.getByText("Kept wall-1.jpg")).toBeTruthy();

  act(() => {
    jest.advanceTimersByTime(LIFETIME);
  });

  expect(screen.queryByText("Kept wall-1.jpg")).toBeNull();
});

test("duration Infinity keeps an error toast up past its would-be lifetime", () => {
  jest.useFakeTimers();
  renderToast(
    <Toast duration={Infinity}>
      <ToastTitle>Couldn&apos;t restore wall-3.jpg</ToastTitle>
      <ToastDescription>the file is no longer in the reject folder</ToastDescription>
      <ToastClose />
    </Toast>,
  );

  // Ten times the lifetime the test above proves this clock can spend. Radix
  // never arms the close timer at all for `Infinity`, so the toast stays until
  // the user closes it or another one replaces it.
  act(() => {
    jest.advanceTimersByTime(LIFETIME * 10);
  });

  expect(screen.getByText("Couldn't restore wall-3.jpg")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
});
