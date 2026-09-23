import { useApp, type View } from "@/context/AppContext";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

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
 * commit it belongs to, whatever holds the focus lets go of it, and focus moves
 * to the showing page's surface — its tab stop, the selected card or filmstrip
 * entry, or the surface itself when nothing holds the stop yet. On Rank, and on
 * Settings, letting go is the whole of it.
 *
 * The hand-off stays open until the curator does something themselves, a key or
 * a press, and until then it re-lands whenever the surface is not holding the
 * focus. That covers the two cases where the surface is not there to take it at
 * the commit: a first visit, where the page enters the tree before its listing
 * does, and a layout switch, where the surface that would take it is replaced a
 * moment later by one in the other shape. After the curator acts, a card taking
 * the focus would be focus stolen rather than handed over.
 */
const KeyboardHandoffContext = createContext<(() => void) | undefined>(
  undefined,
);

/** Where a surface says it takes the keyboard. */
const KEYBOARD_SURFACE = "data-keyboard-surface";

/** What the curator does that ends an open hand-off. */
const ENDS_HANDOFF = ["keydown", "pointerdown"] as const;

function handFocusToPage(view: View): () => void {
  const page = document.querySelector(
    `[data-slot="view"][data-view="${view}"]`,
  );
  // Behind an open lightbox the page is inert and cannot take the focus, and
  // letting go of it would take it off the lightbox the curator is still in —
  // which is where a toast's Undo is pressed from, over a keep or a reject.
  if (page?.closest("[inert]")) return () => {};

  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  if (!page) return () => {};

  // `preventScroll`, because a hand-off that scrolled would undo the scroll
  // position the shell keeps views mounted to preserve.
  const land = () => {
    const surface = page.querySelector<HTMLElement>(`[${KEYBOARD_SURFACE}]`);
    if (!surface || surface.contains(document.activeElement)) return;
    const stop =
      surface.querySelector<HTMLElement>('[tabindex="0"]') ?? surface;
    stop.focus({ preventScroll: true });
  };
  land();

  const observer = new MutationObserver(land);
  const end = () => {
    observer.disconnect();
    for (const type of ENDS_HANDOFF) {
      document.removeEventListener(type, end, true);
    }
  };
  observer.observe(page, { childList: true, subtree: true });
  for (const type of ENDS_HANDOFF) {
    document.addEventListener(type, end, true);
  }
  return end;
}

export function KeyboardHandoffProvider({ children }: { children: ReactNode }) {
  const { view } = useApp();

  // A counter rather than a flag, so that a second hand-off to the page already
  // showing is a change the effect sees.
  const [asked, setAsked] = useState(0);
  const handOff = useCallback(() => setAsked((n) => n + 1), []);

  // Read at the commit the ask belongs to, which is the one that shows the view
  // a navigation batched with it: a surface under `display: none` cannot take
  // focus. `view` is deliberately not a dependency — a navigation that asked
  // for nothing leaves the focus where it was.
  useLayoutEffect(() => {
    if (asked > 0) return handFocusToPage(view);
  }, [asked]);

  return (
    <KeyboardHandoffContext.Provider value={handOff}>
      {children}
    </KeyboardHandoffContext.Provider>
  );
}

/** Ask for the keyboard to go to the showing page once this commit lands. */
export function useKeyboardHandoff(): () => void {
  const handOff = useContext(KeyboardHandoffContext);
  if (handOff === undefined) {
    throw new Error(
      "useKeyboardHandoff must be used within a KeyboardHandoffProvider",
    );
  }
  return handOff;
}

/**
 * A click handler for a strip of buttons: one the pointer pressed hands the
 * keyboard back once it has done its job.
 *
 * Only the pointer. From the keyboard the button keeps the focus, the way a tab
 * does, and `detail` is 0 for the click Enter or Space synthesises. A button
 * that opens a popup is left alone too, since focus moving away as it opens
 * would close it again; its popup hands off when it closes, if it should.
 */
export function useHandOffOnPointerPress(): (event: MouseEvent) => void {
  const handOff = useKeyboardHandoff();
  return useCallback(
    (event: MouseEvent) => {
      if (event.detail === 0 || !(event.target instanceof Element)) return;
      const control = event.target.closest("button");
      if (!control || control.matches('[aria-haspopup], [role="combobox"]')) {
        return;
      }
      handOff();
    },
    [handOff],
  );
}
