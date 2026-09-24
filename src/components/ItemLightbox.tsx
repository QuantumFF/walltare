import { CropPreviewToggle, useCropPreview } from "@/components/CropPreview";
import {
  HeroPicture,
  usePictureBox,
  type Picture,
} from "@/components/HeroPicture";
import {
  answerKey,
  type ActionTable,
  type ListingSurface,
} from "@/components/keymap";
import {
  NO_SELECTION,
  useSelection,
  type Keyed,
  type SelectionHandle,
  type Selection,
} from "@/components/selection";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useLightboxHost } from "@/context/LightboxHostContext";
import { grouped } from "@/lib/copy";
import type { Box } from "@/lib/layout-plan";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The lightbox over any list the generic grid draws (#338): the shell ADR 0022
 * describes, with what it says about the item left to the page.
 *
 * #336 made the grid work over any keyed item so that Discover could draw
 * Results with it, and this is the same move for the surface a card opens
 * into. What is the same whatever is listed stays here: the page behind going
 * `inert`, the position line, `←` and `→` walking the grid's own cursor, the
 * way out, and the never-blank picture. What is the page's is the row under the
 * picture — the identity line, the read-out and the action buttons — and which
 * two sources the picture is drawn from. `Lightbox.tsx` is Library's and
 * Review's page of it, and keeps their markup as it was.
 */

/**
 * What the picture's area is taken to be while nothing has measured it, in
 * pixels.
 *
 * The default 1280x800 window less what this surface puts around the picture:
 * 1280 wide less the content's `p-8` at both ends is 1216, and 800 tall less
 * that same 64 and less the `pb-14` the row is given is about 680. The pair
 * Library's `ROW_FLOOR` arithmetic in `Lightbox.tsx` is written against.
 *
 * The picture, the crop bars and the row all take their box from this until a
 * browser lays the area out, and then from the measurement. Under a test runner
 * that lays nothing out it is the only answer there is (ADR 0022, #266, #279).
 */
const UNMEASURED_PICTURE: Box = { width: 1216, height: 680 };

/**
 * The three readings of the grid's publication this file takes, as module-level
 * functions because `useSelection` compares snapshots and a reader rebuilt
 * per render is a new snapshot per render.
 *
 * They are the whole of why the publication carries a reader rather than handing
 * every subscriber the object. The surface below draws the selection and wants
 * all of it; the hook above only has to know whether there is one at all; and a
 * closed lightbox wants none of it, which is what `CLOSED` says — one constant,
 * so a curator walking the grid with the arrows re-renders neither the page nor
 * a dialog that is not up. That is the property #230 is about, and it is the one
 * a `selection` prop threaded down from the page cannot have.
 *
 * `CLOSED` rather than passing no grid at all while it is down. Both read as
 * nothing selected, and the difference is when the subscription is made: a
 * lightbox that subscribes on the way open is told about the selection it opened
 * onto one commit late, and one that never unsubscribed is told inside the same
 * commit — which is the difference between the surface painting the outgoing
 * item for a frame and never painting it at all.
 */
const WHOLE = <T extends Keyed>(selection: Selection<T>) => selection;
const HAS_ITEM = <T extends Keyed>(selection: Selection<T>) =>
  selection.item !== null;
const CLOSED = <T extends Keyed>(): Selection<T> => NO_SELECTION;

/**
 * What the lightbox tells the keymap about itself: which surface it is, and so
 * which keys are its. It walks with `←` and `→` alone, since one item at a
 * time has no rows for Up and Down to move by, and `C` is one of its keys only
 * where the page offers the crop preview.
 */
const lightboxSurface = (crop: boolean) =>
  ({ kind: "lightbox", crop }) as const satisfies ListingSurface;

/**
 * Whether a lightbox is up, and the two gestures that change that.
 *
 * The state is the page's, because it is the page that decides when a lightbox
 * exists. What it is a lightbox *of* is not the page's and has not been since
 * #230: ADR 0022 has this surface render the grid's selection rather than a
 * cursor of its own, and that selection is now published by the grid that
 * resolves it. So this hook takes the grid's handle and nothing else, and the
 * two things it needs the cursor for — opening on a card, and closing when there
 * is nothing left to show — both go through that handle.
 *
 * What is here rather than in the page is the wiring both pages would otherwise
 * write twice — the shell's `inert`, the two things that close it without anyone
 * pressing anything — so that Review and the library page differ in nothing but
 * which list is behind them.
 */
export interface LightboxControls<T extends Keyed> {
  open: boolean;
  /**
   * Open it on an item, moving the selection there first.
   *
   * A click lands on a card the selection may not be on, and under ADR 0022
   * that is a selection move rather than a second cursor: one surface cannot
   * show item 12 while the grid behind it is pointed at item 3.
   * `Enter` arrives here too, already on the selected card, where the move is
   * the selection it already holds.
   */
  openOn: (item: T) => void;
  /**
   * Close it, and put the card holding the selection back on screen and in
   * focus.
   *
   * The curator's own Escape or Close, in other words. The two closes nobody
   * pressed do not come through here; what they owe the grid is decided beside
   * them, because only the caller knows which of the three closes this is
   * (ADR 0029).
   */
  close: () => void;
}

/**
 * The page's half of the lightbox: the open flag, and the two ways it goes down
 * that are nobody's keypress.
 *
 * **Changing destination closes it** (ADR 0015), which is also what makes the
 * shell's live keyboard handler safe: `Ctrl+2` under an open lightbox is not a
 * view swapped underneath a surface walking a list it can no longer see, it is
 * the lightbox closing and the swap happening. The page a lightbox belongs to
 * stays mounted under `display: none`, so nothing here can rely on an unmount.
 *
 * **The list emptying closes it**, onto the page's own empty state. ADR 0015
 * already makes every destination own an empty state that names the reason and
 * offers the route out, so a second "nothing left" panel inside the lightbox
 * would be that screen with less room.
 *
 * Two of those three hand focus back to the grid and the third does not, which
 * is why this takes the grid's handle rather than the grid watching a flag: a
 * destination change hides the page in the same pass, so focusing a card in it
 * is a no-op in a browser and a lie under happy-dom. Only the caller can tell
 * the three apart (ADR 0029).
 */
export function useLightbox<T extends Keyed>(
  grid: SelectionHandle<T> | null,
): LightboxControls<T> {
  const { view } = useApp();
  const { setOpen: reportToShell } = useLightboxHost();
  const [open, setOpen] = useState(false);
  // Whether the grid has an item selected at all, which is the one thing on
  // this page that turns on the cursor — and a boolean, so a curator walking the
  // grid with the arrows re-renders neither this hook's page nor anything above
  // it. It flips when the list empties or fills, and on no other keystroke.
  const anySelection = useSelection(grid, HAS_ITEM);

  /**
   * The page's flag and the shell's, set together.
   *
   * Together and not through an effect on the first, which is the shape this
   * started as and is one commit late. The shell's flag is the `inert` on the
   * view container, and a close that leaves it set for a commit is a close
   * whose focus restore cannot land: the grid focuses the card in a layout
   * effect, and a node inside an inert subtree does not take focus. Set in the
   * same handler, both land in one render pass — the attribute is gone from the
   * DOM before any layout effect in it runs. The other half of the shell's flag
   * is ADR 0021's suppressed report, which is only ever a frame either way.
   */
  const setOpenEverywhere = useCallback(
    (next: boolean) => {
      setOpen(next);
      reportToShell(next);
    },
    [reportToShell],
  );

  // The selection move a click is, made through the grid that owns the cursor.
  // Keyed on the handle rather than on the selection, which is what keeps this
  // one identity while the curator arrows around — it reaches every mounted card
  // as `onOpen`, so a version of it that changed with the cursor would defeat the
  // card's memo and be the thing #230 set out to remove (#229).
  //
  // It also notes whether the focus it opened from was drawn, which is how the
  // curator arrived: `Enter` on a card is keyboard focus and a click on one is
  // not. A ref, because nothing renders from it.
  //
  // The move is flushed before the open, not batched with it. The grid
  // publishes its selection from a layout effect, so an open in the same
  // commit reads the selection from before the click: the lightbox mounts its
  // `<img>`s on the item it was last left on, and the render the publication
  // forces then hands them the clicked item's sources. That is too late. An
  // `<img>` handed a source the webview has cached decodes it at once, and
  // keeps painting it while its next source arrives, so every open onto a card
  // other than the last one flashed the last one's full file for as long as
  // the clicked one's took. Flushed, the grid has published by the time the
  // open renders, and the first thing an `<img>` in here is handed is the
  // clicked item's.
  const openedWithVisibleFocus = useRef(false);
  const openOn = useCallback(
    (subject: T) => {
      openedWithVisibleFocus.current =
        document.activeElement?.matches(":focus-visible") ?? false;
      flushSync(() => grid?.selection().selectId(subject.id));
      setOpenEverywhere(true);
    },
    [grid, setOpenEverywhere],
  );

  // The focus restore is asked for here rather than from the content's
  // `onCloseAutoFocus`, which is the obvious place and defers by a
  // `setTimeout(0)` inside `FocusScope`. What that handler still owes is the
  // `preventDefault` that stops Radix focusing the card this was opened from;
  // the request itself belongs in the same commit as the close, where the
  // grid's own layout effect answers it (ADR 0019, ADR 0022).
  //
  // The focus goes back drawn only if it left drawn. A card's overlay reveals on
  // `:focus-visible`, and a close is a focus moved by script, which WebKitGTK
  // draws whenever the last focus was not a click — and the lightbox's own
  // surface taking the focus is not one. Left to that guess, a lightbox opened
  // with the mouse hands back a card with its overlay pinned open under a
  // pointer that is nowhere near it, and newer WebKit takes the Escape that
  // closed it as a reason to draw it anyway.
  //
  // It is how the lightbox was opened that counts, not how it was used: opened
  // with a click and walked with the arrows, it still hands back a card with no
  // overlay, and the next arrow in the grid draws it.
  const close = useCallback(() => {
    setOpenEverywhere(false);
    grid?.focusSelection({
      focusVisible: openedWithVisibleFocus.current,
    });
  }, [grid, setOpenEverywhere]);

  // The destination change, and the one close that hands nothing back: `Ctrl+2`
  // hides this page with `display: none` in the same pass (ADR 0015), so a card
  // focused in it is a no-op in a browser and a lie under happy-dom.
  useEffect(() => {
    setOpenEverywhere(false);
  }, [view, setOpenEverywhere]);

  // The list emptying under it, which does ask for the focus back. There is no
  // card left to land on, so what would take it is the grid container — the
  // alternative is `body`, where the next Tab starts from the top of the
  // document rather than from the page the curator is on (ADR 0029).
  //
  // Today it lands on `body` anyway, and not because of anything here: both
  // pages swap their grid for their own empty state in the same commit, so the
  // handle is null by the time this runs. The ask is still made rather than
  // left out, because which surface is on screen after the list empties is the
  // page's decision and this rule holds either way. `lightbox.test.tsx` pins
  // what a curator gets today.
  //
  // A grid that has gone reads as a grid with nothing selected, which is what
  // makes the two ways this can happen one condition: the list emptied under a
  // mounted grid, or the page swapped the grid out because the list emptied.
  //
  // `open` is in the condition and not only in the effect's own bookkeeping,
  // because a page whose first fetch has not landed renders its grid over an
  // empty list: without it, arriving on the library page would hand focus to a
  // grid the curator has not walked into.
  useEffect(() => {
    if (anySelection || !open) return;
    setOpenEverywhere(false);
    grid?.focusSelection();
  }, [anySelection, open, grid, setOpenEverywhere]);

  // The page that stops rendering while one is still up, which is the one case
  // no handler above covers. Nothing unmounts a view today; this is what stops
  // a future one from leaving the shell holding an `inert` nobody takes back.
  useEffect(() => {
    return () => reportToShell(false);
  }, [reportToShell]);

  return { open, openOn, close };
}

/**
 * The page's half of the row under the picture: everything on it but the
 * position line, which is the shell's.
 *
 * Split in the four places the row treats differently. The identity line and
 * the buttons always show. The read-out and the count beside the position are
 * what a picture narrower than the page's `rowFloor` drops, because they tell
 * the curator nothing they need in order to act (ADR 0022) — and Discover's
 * second line of facts is the same kind of thing.
 */
export interface LightboxRow {
  /**
   * The line that says which item is up. It carries a `LightboxTitle`, which
   * is the dialog's name.
   */
  identity: ReactNode;
  /** The line under the identity line. Dropped on a floored row. */
  readout?: ReactNode;
  /** A line above the position. Dropped on a floored row. */
  count?: ReactNode;
  /** The action buttons, after the crop preview's toggle when there is one. */
  buttons: ReactNode;
}

/**
 * The dialog's name, on the row's identity line.
 *
 * Radix wants a `Dialog.Title` for `aria-labelledby`, and the one thing on the
 * row that says which item is up is the one to give it — for a wallpaper its
 * filename. Exported so a page's identity line can place it without reaching
 * for the primitive.
 */
export function LightboxTitle({ children }: { children: ReactNode }) {
  return (
    <Dialog.Title className="truncate text-sm font-medium text-white">
      {children}
    </Dialog.Title>
  );
}

export interface ItemLightboxProps<T extends Keyed, A extends string> {
  /**
   * The grid whose selection this is a second rendering of (ADR 0022).
   *
   * The grid and not the selection, and that difference is the whole of what
   * #230 had to keep true. A `selection` prop would be the page reading the
   * cursor in order to hand it down, which is a page that re-renders on every
   * arrow key — and the moment the page holds it, it is a copy somebody has to
   * keep in step with the grid's. This subscribes to the same publication the
   * cells were drawn from, so there is still one cursor and still no sync rule.
   *
   * `null` while there is no grid mounted, which is how every page renders an
   * empty list. There is nothing to be a rendering of then, and the hook above
   * closes this surface in the same pass.
   */
  grid: SelectionHandle<T> | null;
  /** Whether one is up, from `useLightbox` over that same grid. */
  open: boolean;
  /**
   * `useLightbox`'s `close`, which is the curator's own way out and the half
   * that puts focus back on the card. Radix asks for it on Escape and on the
   * Close button; the two closes nobody pressed never reach here.
   */
  onClose: () => void;
  /**
   * The page's action table, the same one its grid is handed, so a key does
   * in here exactly what it does on a card (#286, #336).
   */
  actions: ActionTable<T, A>;
  /**
   * An action the curator asked for while looking at the picture, by its key,
   * on the item the picture is of. The page's own entry, the one its grid
   * takes. The buttons in `row` fire it themselves.
   */
  onAct: (action: A, item: T) => void;
  /** The item's picture: its two sources and its Dimensions. */
  picture: (item: T) => Picture;
  /** What the row under the picture says about the item, and its buttons. */
  row: (item: T) => LightboxRow;
  /**
   * How narrow the row is allowed to get, in pixels: the widest thing the
   * page's row has to hold. Below it the row overhangs the picture instead of
   * shrinking with it, and the read-out drops (ADR 0022).
   */
  rowFloor: number;
  /** What an item is called, for the arrows' names: `Previous wallpaper`. */
  noun: string;
  /**
   * What the picture's panel says when the full source never arrives, which is
   * the page's to word: a wallpaper's file is gone, a Result's preview did not
   * load.
   */
  gone: ReactNode;
  /**
   * Whether the crop preview is offered: its toggle in the row, `C`, and the
   * bars over the picture. Library and Review offer it (#266).
   */
  cropPreview?: boolean;
}

/**
 * The lightbox: one item at a size worth judging, with a row under it at the
 * picture's own width.
 *
 * #44 settled the housing and ADR 0022 the behaviour. The layout is the
 * prototype's `inline` variant — the row belongs to the picture rather than to
 * the window, so it is as wide as the picture's box below — with that
 * prototype's `← → navigate · Esc close` hint dropped, because the keys move
 * onto the controls they fire and the rest live in the `?` dialog.
 *
 * It knows nothing about which page opened it, beyond what the page hands it.
 * What an action does to this surface is not decided here either, and that is
 * the whole of ADR 0022: the lightbox renders the grid's selection, so an action
 * that empties a row lands wherever the selection rule lands, which reads as
 * advancing in Review, as staying put in a library showing everything, and as a
 * close when the row was the last one. There is no rule in this file about what
 * an action does to what is on screen, because a rule here is a second answer
 * to a question the list already answers.
 */
export function ItemLightbox<T extends Keyed, A extends string>({
  grid,
  open,
  onClose,
  actions,
  onAct,
  picture: pictureOf,
  row: rowOf,
  rowFloor,
  noun,
  gone,
  cropPreview = false,
}: ItemLightboxProps<T, A>) {
  const { container } = useLightboxHost();
  // The grid's own selection, read out of the same publication the cells were
  // drawn from — which is the whole of ADR 0022 surviving #230, since a copy
  // held anywhere on the way here would be a second cursor with a rule keeping
  // it in step.
  //
  // Subscribed whether or not this is up, and reading nothing while it is not.
  // A closed lightbox that unsubscribed would resubscribe on the way open and
  // hear about the selection it opened onto one commit later; staying subscribed
  // costs a constant snapshot that no cursor move changes, so a curator walking
  // the grid with the arrows re-renders nothing in here (#230).
  const { item, index, length, moveTo } = useSelection<Selection<T>, T>(
    grid,
    open ? WHOLE : CLOSED,
  );

  /**
   * One step through the list, which is a selection move and nothing else.
   *
   * ADR 0022 has this surface render the grid's selection, so a step has no
   * second cursor to keep in sync and no arithmetic of its own at the ends:
   * `moveTo` clamps into the list, which is what makes `←` on the first item
   * do nothing rather than wrap to the last. The arrow buttons come through
   * here, and `←` and `→` reach the same `moveTo` with the index the keymap
   * stepped to, so "the buttons make the movement the keys make" is one clamp
   * rather than two that happen to agree.
   */
  const step = useCallback((by: number) => moveTo(index + by), [index, moveTo]);

  const atFirst = index <= 0;
  const atLast = index >= length - 1;

  // The press that raises the bars, off the same stored toggle the Review strip
  // reads, so a curator who turned them on there opens this surface with them
  // still up. The picture reads the toggle to draw them (#266).
  const { toggle: toggleCrop } = useCropPreview();

  // The keys, bound on `window` rather than on the content below.
  //
  // The content's own `onKeyDown` is where ADR 0019 puts a view-local key — the
  // element that owns the focus answers it — and the buttons in here are what
  // rules it out. A pointer press lands the focus on the control pressed, and
  // acting through one is what replaces it: rejecting under a library showing
  // everything swaps Keep and Reject for a Restore, and reaching the end of the
  // list disables the arrow just clicked. Either drops the focus to `body` and
  // takes the keys with it. Nothing else claims a bare arrow or a bare letter
  // while this is up, either: everything behind is `inert`, and Rank's own
  // arrow listener is bound only while Rank is the view being shown.
  //
  // Modifiers stand down, which is what leaves the shell's live handler its
  // own: `Ctrl+Z` presses the visible toast's Undo from in here and `?` opens
  // the shortcut list, both because that handler is running and not because
  // this one reimplemented them. ADR 0022 deleted the clause that used to
  // suppress it, on the grounds that its only effect was turning off Undo in
  // the one place a reject fires from (ADR 0015 as amended, ADR 0017).
  //
  // `defaultPrevented` is the stand-down this listener makes, in the other
  // direction. An element inside the lightbox that ever answers one of these
  // itself marks the event, and this stops behind it.
  //
  // What a key means is the keymap's, prevention included: the page's keys do
  // exactly what they do on a card, and `C`, where the page offers the crop
  // preview, answers off the same stored toggle the Review strip does, so this
  // surface answers the curator's question about their screen rather than
  // sending them back to the strip to ask it (ADR 0022, #266, #286). `Enter` is
  // not one of its keys, because it is the key that opened this.
  useEffect(() => {
    if (!open || !item) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const intent = answerKey(
        event,
        {
          surface: lightboxSurface(cropPreview),
          selected: item,
          index,
          length,
        },
        actions,
      );
      switch (intent?.kind) {
        case "act":
          onAct(intent.action, intent.item);
          break;
        // Only reached where the page offers the preview: the keymap leaves
        // `C` alone on a lightbox that does not.
        case "crop":
          toggleCrop();
          break;
        case "move":
          moveTo(intent.to);
          break;
        // A held `C`: answered, and toggling nothing.
        case "held":
          break;
        // Every intent the keymap can hand this surface is answered above, so
        // only an unanswered key reaches here, and a binding newly given to
        // this surface fails to compile until it is (#286).
        default:
          intent satisfies undefined;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    item,
    index,
    length,
    moveTo,
    actions,
    onAct,
    toggleCrop,
    cropPreview,
  ]);

  // The picture's sources, read once per render for the box and the picture.
  const picture = item ? pictureOf(item) : null;

  // The picture's box: what the picture is drawn in, what the crop bars are
  // percentages of, and what the row shrink-wraps to.
  //
  // Fitted rather than expressed in CSS, and that is not a shortcut: during
  // intrinsic sizing a letterboxed image contributes its *natural* width, so a
  // column wrapped around one goes full width and takes the row with it. The
  // measuring and the arithmetic are the picture module's, the same rule the
  // Review strip's hero is fitted by; what this surface supplies is the area,
  // which is the cell less the room reserved for the row (#279).
  //
  // An item whose Dimensions nothing has read takes its shape from the decoded
  // full source once it has loaded, so a portrait of unknown shape still gets a
  // row the width of the picture rather than of the 16:9 guess (ADR 0044). The
  // guess stands only until something is known.
  const { area, box, learnNaturalSize } = usePictureBox(
    picture,
    UNMEASURED_PICTURE,
  );

  // Whether the picture is narrower than the row's floor, which is the one
  // thing that drops the read-out.
  const floored = box.width < rowFloor;

  // Where the open lands, which is this surface and not a control on it.
  //
  // Radix focuses the first tabbable element inside the content, which since
  // #140 is the first action button — so a lightbox opened to look at a picture
  // would open with an action armed under Space and Enter, on the surface whose
  // whole rule is that `Enter` does nothing because `Enter` is what opened it.
  // The content itself is focusable (`FocusScope` renders it at `tabIndex=-1`),
  // so this is the same override with a target: Escape and the keys are bound
  // above the focus rather than on it, and the first Tab still reaches the row.
  const content = useRef<HTMLDivElement | null>(null);

  const row = item ? rowOf(item) : null;

  return (
    <Dialog.Root
      // An item is what this surface is, so there is no open state without
      // one. The hook closes on an emptied list a commit later; this is the
      // render in between.
      open={open && item !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // Non-modal, which is the whole configuration ADR 0022 chose and the
      // reason `aria-modal` below is written by hand. What comes with the
      // primitive either way is `role="dialog"`, Escape through
      // `DismissableLayer` and the focus restore through `onCloseAutoFocus`.
      // What a modal one would add is a focus trap, `RemoveScroll` and
      // `hideOthers`, and the last two cost the toast twice over on the exact
      // flow it exists for: `hideOthers` marks every sibling on the way up
      // `aria-hidden`, and Radix does not portal the toast viewport, so a file
      // that just moved would be announced to nobody; and the trap's
      // document-level `focusin` handler takes back the focus F8 asks for. The
      // containment is `inert` on the view container instead, which the shell
      // applies and which touches nothing outside it.
      modal={false}
    >
      <Dialog.Portal container={container}>
        {picture && row && (
          <Dialog.Content
            ref={content}
            // By hand, because the primitive writes it only for a modal dialog
            // and the claim is true for a different reason here: the pages
            // behind are `inert`.
            aria-modal
            // See `content` above: the surface takes the focus, not the first
            // button on it.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current?.focus();
            }}
            // Nothing outside this layer dismisses it, and the two things
            // outside it are both things the curator is meant to reach. The
            // toast viewport sits above this at `z-60` and outside the inerted
            // container on purpose, so a pointer press on a toast's Undo is a
            // press outside this layer, and F8's `viewport.focus()` is a
            // `focusin` outside it. Radix's default answer to either is to
            // dismiss, which would close the lightbox on the two gestures ADR
            // 0017 built for the reject that fires from inside it. Escape and
            // the Close button are the ways out.
            onInteractOutside={(event) => event.preventDefault()}
            // Radix would focus `triggerRef`, the card this was opened from,
            // which after #139's stepping is both the wrong card and often an
            // unmounted one. Which card is right is `useLightbox`'s `close` to
            // ask for; all this owes is refusing the wrong one.
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Translucent, at the curator's request: the page stays faintly
            // visible behind the picture. #44 had it opaque because at 97% the
            // chrome's tabs ghosted through and read as clickable; the curator
            // asked for the page behind anyway, and it is inert either way
            // (ADR 0022, amended). No blur, because a translucent backdrop was
            // what was asked for and a full-window blur is a cost nobody has
            // measured. No z-index of its own — the shell's portal node is a
            // `z-50` stacking context, so this paints over the pages and under
            // the toast by sitting in it.
            className="dark fixed inset-0 flex flex-col bg-neutral-950/80 outline-none"
          >
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
              {/* The cell the picture and the row share. The bottom padding is
                  the room the row is given, so the area inside it is what the
                  picture is fitted into, and the picture is centred in an
                  absolutely positioned layer so its pixel size cannot feed back
                  into the area it was measured from. */}
              <div className="relative h-full w-full pb-14">
                <div ref={area} className="relative h-full w-full">
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* The picture, its placeholder, its crop preview and the
                        panel that says it never arrived, all of which the
                        picture module owns and the Review strip shares. Nothing
                        here resets on a close: the content goes with the
                        dialog, so a re-opened lightbox mounts a picture with
                        nothing painted, and the placeholder comes back with it
                        (ADR 0022, ADR 0032, #279).

                        `contain`, because this surface exists to show all of
                        the picture. The row below stays where it is whatever
                        the picture says, so acting on an item whose picture
                        never arrived is still one press away. */}
                    <HeroPicture
                      picture={picture}
                      box={box}
                      fit="contain"
                      cropPreview={cropPreview}
                      onNaturalSize={learnNaturalSize}
                      gone={gone}
                    />
                  </div>
                </div>

                {/* The row, at the picture's width and absolutely positioned so
                    it cannot affect the layout it is measured against — in flow
                    the two chase each other and the measurement settles short.

                    `minWidth` is the floor, and what it produces is an overhang
                    on both sides rather than one, because the row is centred on
                    the picture rather than aligned to an edge of it. */}
                <div
                  data-slot="lightbox-row"
                  className="absolute bottom-0 left-1/2 flex h-11 -translate-x-1/2 items-center gap-4 overflow-hidden"
                  style={{
                    width: box.width,
                    minWidth: rowFloor,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    {row.identity}
                    {!floored && row.readout}
                  </div>

                  {/*
                    Where this item sits in the list being walked, under
                    whatever the page counts beside it.

                    The position is worth printing because the arrows clamp
                    rather than wrapping: reaching the end of a fifty-row
                    worklist is the moment the sweep is done, and it is also the
                    reason the arrow beside it has gone unavailable. It counts
                    against the whole list rather than the window ADR 0016
                    mounts cards for, which is why the selection carries its own
                    length. It stays on a floored row, since `50 / 50` is the
                    reason the arrow beside it is unavailable.
                  */}
                  <div className="shrink-0 text-right text-[11px] tabular-nums text-white/50">
                    {!floored && row.count !== undefined && (
                      <div>{row.count}</div>
                    )}
                    <div>{`${grouped(index + 1)} / ${grouped(length)}`}</div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {cropPreview && <CropPreviewToggle />}
                    {row.buttons}
                  </div>
                </div>
              </div>

              {/*
                The pointer's step, hung off the two edges of the box the
                picture is fitted in, and under ADR 0019 the only step a
                touchscreen has: there is no hover to reveal and no arrow key to
                press. Both go through `step`, so neither can come to mean a
                different movement from the keys.

                They are out of the tab order for the reason the card's own
                overlay buttons are: the keyboard's path is `←` and `→`, listed
                in the `?` dialog as the grid's own, so a Tab that stops on two
                arrows before it reaches the way out pays for nothing
                (ADR 0019).

                `disabled` at the ends, and not ADR 0019's `aria-disabled`. That
                choice turns on whether the control owes the curator a sentence.
                An arrow at the end of the list owes nothing — the position line
                under the picture already reads `50 / 50`, which is the reason
                and is the whole of it — and the keys clamp at the same place,
                so a control nobody can focus takes nothing away from anybody.
              */}
              <Button
                variant="secondary"
                size="icon-lg"
                aria-label={`Previous ${noun}`}
                tabIndex={-1}
                disabled={atFirst}
                onClick={() => step(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full"
              >
                <ChevronLeft className="size-5" />
              </Button>

              <Button
                variant="secondary"
                size="icon-lg"
                aria-label={`Next ${noun}`}
                tabIndex={-1}
                disabled={atLast}
                onClick={() => step(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
              >
                <ChevronRight className="size-5" />
              </Button>

              {/* The way out for a pointer, and under ADR 0019 the only one a
                  touchscreen has: there is no hover to reveal and no Escape to
                  press. */}
              <Dialog.Close asChild>
                <Button
                  variant="secondary"
                  size="icon-lg"
                  aria-label="Close"
                  className="absolute top-2 right-2 rounded-full"
                >
                  <X className="size-5" />
                </Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
