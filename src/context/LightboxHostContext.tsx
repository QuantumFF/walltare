import { createContext, useContext, type ReactNode } from "react";

/**
 * The shell-owned half of the lightbox: where its pixels land, and whether the
 * page behind it is inert while it is up.
 *
 * A page keeps the list, the selection and the handlers, because the list
 * changes on every action and a shell holding it would need re-pushing each
 * time. Only the DOM node moves up here (ADR 0022), for two reasons a page
 * cannot fix from inside itself:
 *
 * - The toast has to paint above the lightbox, and ADR 0017 gave it the highest
 *   z-index precisely because keep and reject fire from in there. Ordering the
 *   two needs both of them in one file.
 * - `position: fixed` resolves against the nearest ancestor carrying a
 *   transform, filter or containment, and `ReviewView` already carries
 *   `animate-in fade-in`. A lightbox mounted inside a view is one animation
 *   variant away from being clipped to that view.
 *
 * Portalling also makes `inert` safe: the lightbox is provably outside the
 * container being inerted rather than depending on where someone mounted it.
 *
 * `useLightbox` is what reads both fields, once per page that mounts a grid.
 */
export interface LightboxHost {
  /** `Dialog.Portal`'s container. `null` until the shell's first paint. */
  container: HTMLElement | null;
  /**
   * Say whether a lightbox is up. The shell puts `inert` on the view container
   * while one is, which is what lets ADR 0022's dialog stay non-modal: nothing
   * behind it is focusable or clickable, and the toast viewport — which sits
   * outside that container — keeps the focus the F8 hotkey moves there.
   */
  setOpen: (open: boolean) => void;
}

const LightboxHostContext = createContext<LightboxHost | undefined>(undefined);

export function LightboxHostProvider({
  value,
  children,
}: {
  value: LightboxHost;
  children: ReactNode;
}) {
  return (
    <LightboxHostContext.Provider value={value}>
      {children}
    </LightboxHostContext.Provider>
  );
}

export function useLightboxHost(): LightboxHost {
  const host = useContext(LightboxHostContext);
  if (host === undefined) {
    throw new Error("useLightboxHost must be used within a LightboxHostProvider");
  }
  return host;
}
