import type { SelectionHandle } from "@/components/selection";
import { useApp, type View } from "@/context/AppContext";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

/**
 * What a hand-off lands on: the one part of a surface's handle it calls, so a
 * page's grid qualifies whatever it lists — Wallpapers or Results (#339).
 */
type Surface = Pick<SelectionHandle, "focusSelection">;

/**
 * Giving the keyboard back to the page.
 *
 * Review and Library answer their keys — the arrows, `K`, `Delete`, `Enter` —
 * only from inside their surface, the grid or the filmstrip, because a surface
 * on a view the shell is only hiding must not answer keys meant for the one in
 * front (ADR 0019). Rank answers from `window`, and only while nothing else has
 * marked the key. So any control that keeps the focus after it is used strands
 * the keys: a clicked tab walks the tablist with the arrows, and a clicked
 * button in a page's bar answers them with nothing at all.
 *
 * A hand-off is what a control asks for once it has done its job. After the
 * commit it belongs to, focus goes to the surface of the page that was showing
 * then, through that surface's own handle — `focusSelection`, the one way in
 * from outside (ADR 0029) — and asked not to reveal, so the scroll position the
 * shell keeps views mounted to preserve is still the curator's. On Rank and on
 * Settings there is no surface, and letting go of the focus is the whole of it.
 *
 * The hand-off stays open until the curator does something themselves, a key or
 * a press, and until then it lands again whenever the page's surface is
 * replaced. That covers the two cases where the surface is not there to take it
 * at the commit: a first visit, where the page enters the tree before its
 * listing does, and a layout switch, where the surface that would take it is
 * replaced a moment later by one in the other shape. After the curator acts, a
 * card taking the focus would be focus stolen rather than handed over.
 */
interface KeyboardHandoff {
  handOff: () => void;
  /** Say which surface a page is drawing now, or `null` for none. */
  register: (view: View, surface: Surface | null) => void;
}

const KeyboardHandoffContext = createContext<KeyboardHandoff | undefined>(
  undefined,
);

/** What the curator does that closes an open hand-off. */
const CURATOR_INPUT = ["keydown", "pointerdown"] as const;

/** Whether the focus is in a dialog, which is keeping it on purpose. */
function focusInDialog(): boolean {
  return (
    document.activeElement?.closest('[role="dialog"], [role="alertdialog"]') !=
    null
  );
}

function letGoOfFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function KeyboardHandoffProvider({
  lightboxOpen = false,
  children,
}: {
  /**
   * Whether a lightbox is up, which is the one time a hand-off waits. The page
   * behind it is `inert` (ADR 0022) and cannot take the focus, and a hand-off
   * asked for there — a toast's Undo pressed over the picture, or `Ctrl+2`,
   * which closes it — lands once it has closed, if the curator has not acted
   * first.
   */
  lightboxOpen?: boolean;
  children: ReactNode;
}) {
  const { view } = useApp();

  // A counter rather than a flag, so that a second hand-off to the page already
  // showing is a change the effects see.
  const [asked, setAsked] = useState(0);
  const handOff = useCallback(() => setAsked((n) => n + 1), []);

  const [surfaces, setSurfaces] = useState<
    Partial<Record<View, Surface>>
  >({});
  const register = useCallback(
    (at: View, surface: Surface | null) =>
      setSurfaces((prev) =>
        (prev[at] ?? null) === surface ? prev : { ...prev, [at]: surface },
      ),
    [],
  );

  // The page an open hand-off is for, or `null` when none is open. The page and
  // not "whichever is showing", because a navigation that asked for nothing
  // leaves the focus where it was.
  const openFor = useRef<View | null>(null);

  // Opening one, read at the commit the ask belongs to — the one that shows the
  // view a navigation batched with it, since a surface under `display: none`
  // cannot take focus. `view` is deliberately not a dependency, for the reason
  // above. A dialog that holds the focus keeps it: `Ctrl+Tab` under the `?`
  // sheet changes the page behind it and must not pull the curator out.
  useLayoutEffect(() => {
    if (asked === 0) return;
    if (!lightboxOpen && focusInDialog()) return;
    openFor.current = view;
    const close = () => {
      openFor.current = null;
      for (const type of CURATOR_INPUT) {
        document.removeEventListener(type, close, true);
      }
    };
    for (const type of CURATOR_INPUT) {
      document.addEventListener(type, close, true);
    }
    return close;
  }, [asked]);

  // Landing it: at the ask, when the page's surface arrives or is replaced, and
  // when the lightbox over the page closes.
  const surface = surfaces[view] ?? null;
  useLayoutEffect(() => {
    if (openFor.current !== view || lightboxOpen) return;
    if (surface) surface.focusSelection({ reveal: false });
    else letGoOfFocus();
  }, [asked, view, surface, lightboxOpen]);

  const value = useMemo(() => ({ handOff, register }), [handOff, register]);
  return (
    <KeyboardHandoffContext.Provider value={value}>
      {children}
    </KeyboardHandoffContext.Provider>
  );
}

function useKeyboardHandoffContext(): KeyboardHandoff {
  const handoff = useContext(KeyboardHandoffContext);
  if (handoff === undefined) {
    throw new Error(
      "useKeyboardHandoff must be used within a KeyboardHandoffProvider",
    );
  }
  return handoff;
}

/** Ask for the keyboard to go to the showing page once this commit lands. */
export function useKeyboardHandoff(): () => void {
  return useKeyboardHandoffContext().handOff;
}

/**
 * Name the surface a page's keys are answered from, as the handle it drew, so
 * a hand-off to that page has somewhere to land. `null` is the page's empty
 * state, or its listing still loading.
 */
export function useKeyboardSurface(
  view: View,
  surface: Surface | null,
): void {
  const { register } = useKeyboardHandoffContext();
  useLayoutEffect(() => {
    register(view, surface);
    return () => register(view, null);
  }, [register, view, surface]);
}

/**
 * Whether a click came from the pointer rather than from the keyboard.
 *
 * `detail` counts the pointer's clicks and is 0 for the click Enter or Space
 * synthesises. A `.click()` from script is 0 as well, so it reads as the
 * keyboard: nothing in the app clicks a control that way, and if something did
 * it would keep the focus, which is the harmless reading.
 */
export function pressedByPointer(event: MouseEvent): boolean {
  return event.detail > 0;
}

/**
 * A click handler for a strip of buttons: one the pointer pressed hands the
 * keyboard back once it has done its job.
 *
 * Only the pointer. From the keyboard the button keeps the focus, the way a tab
 * does. Two kinds of button are left alone as well, because each already knows
 * where the focus goes: one that opens a popup, since focus moving away as it
 * opens would close it again, and one marked `data-moves-focus`, which puts the
 * focus somewhere itself — "change in Settings" puts the caret in a field.
 */
export function useHandOffOnPointerPress(): (event: MouseEvent) => void {
  const handOff = useKeyboardHandoff();
  return useCallback(
    (event: MouseEvent) => {
      if (!pressedByPointer(event) || !(event.target instanceof Element)) {
        return;
      }
      const control = event.target.closest("button");
      if (
        !control ||
        control.matches(
          '[aria-haspopup], [role="combobox"], [data-moves-focus]',
        )
      ) {
        return;
      }
      handOff();
    },
    [handOff],
  );
}
