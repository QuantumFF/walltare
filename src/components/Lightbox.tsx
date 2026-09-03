import {
  ACTION_CONTROLS,
  STATUS_ACTIONS,
  type CardAction,
} from "@/components/WallpaperCard";
import {
  actionFor,
  printedKey,
  type GridSelection,
} from "@/components/WallpaperGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import { useLightboxHost } from "@/context/LightboxHostContext";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { counted, grouped, isEvaluated, score, STATUS_LABEL } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How narrow the row under the picture is allowed to get, in pixels.
 *
 * The row is measured off the painted picture (#44), so a portrait wallpaper
 * paints one narrower than its own controls need: at the default 1280x800
 * window the image box is about 1216x680, and a 9:16 phone wallpaper fills the
 * height and paints 382px wide. Below this the row overhangs the picture
 * instead of shrinking with it, and the read-out is what drops — an overhanging
 * row reads as controls refusing to shrink, a row clipping its own buttons
 * reads as a bug, and the read-out is the one part that tells the curator
 * nothing they need in order to act (ADR 0022).
 *
 * The number is the widest thing the floor has to hold, which is a Kept
 * wallpaper: a Score badge (38) and a Status pill (58) with a filename between
 * them that is still worth printing (88), two gaps of 8 inside that block, the
 * position (40) and the two gaps of 16 around it, and `Make Active K` beside
 * `Reject Del` (227 with the gap between them). That is 499, so 500.
 *
 * **It has no test and cannot have one.** happy-dom does no layout, so the
 * measurement below is `null` under a test runner and the row falls back to the
 * full width; ADR 0022 records this as untested by construction, since the live
 * library holds no portrait wallpaper — 120 rows, the narrowest a square — and
 * says the arithmetic wants checking against a real 9:16 file once one exists.
 * A test standing a fake measurement in front of the component would pin the
 * arithmetic to itself rather than to a laid-out row.
 */
const ROW_FLOOR = 500;

/**
 * Whether a lightbox is up, and the two gestures that change that.
 *
 * The state is the page's, because ADR 0022 has the lightbox render the grid's
 * selection rather than a cursor of its own, and that selection is resolved
 * against a list only the page holds. What is here rather than in the page is
 * the wiring both pages would otherwise write twice — the shell's `inert`, the
 * two things that close it without anyone pressing anything — so that Review
 * and the library page differ in nothing but which list is behind them.
 */
export interface LightboxControls {
  open: boolean;
  /**
   * Open it on a wallpaper, moving the selection there first.
   *
   * A click lands on a card the selection may not be on, and under ADR 0022
   * that is a selection move rather than a second cursor: one surface cannot
   * show wallpaper 12 while the grid behind it is pointed at wallpaper 3.
   * `Enter` arrives here too, already on the selected card, where the move is
   * the selection it already holds.
   */
  openOn: (wallpaper: Wallpaper) => void;
  /**
   * Close it, and put the card holding the selection back on screen and in
   * focus.
   *
   * The curator's own Escape or Close, in other words. The two closes nobody
   * pressed do not come through here: a destination change would be asking for
   * focus inside a page the shell has just hidden, and there is no card left to
   * ask about when the list empties.
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
 */
export function useLightbox(selection: GridSelection): LightboxControls {
  const { view } = useApp();
  const { setOpen: reportToShell } = useLightboxHost();
  const [open, setOpen] = useState(false);
  const { wallpaper, selectId, requestFocus } = selection;

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

  const openOn = useCallback(
    (subject: Wallpaper) => {
      selectId(subject.id);
      setOpenEverywhere(true);
    },
    [selectId, setOpenEverywhere],
  );

  // The focus restore is asked for here rather than from the content's
  // `onCloseAutoFocus`, which is the obvious place and defers by a
  // `setTimeout(0)` inside `FocusScope`. What that handler still owes is the
  // `preventDefault` that stops Radix focusing the card this was opened from;
  // the request itself belongs in the same commit as the close, where the
  // grid's own layout effect answers it (ADR 0019, ADR 0022).
  const close = useCallback(() => {
    setOpenEverywhere(false);
    requestFocus();
  }, [requestFocus, setOpenEverywhere]);

  useEffect(() => {
    setOpenEverywhere(false);
  }, [view, setOpenEverywhere]);

  useEffect(() => {
    if (wallpaper === null) setOpenEverywhere(false);
  }, [wallpaper, setOpenEverywhere]);

  // The page that stops rendering while one is still up, which is the one case
  // no handler above covers. Nothing unmounts a view today; this is what stops
  // a future one from leaving the shell holding an `inert` nobody takes back.
  useEffect(() => {
    return () => reportToShell(false);
  }, [reportToShell]);

  return { open, openOn, close };
}

export interface LightboxProps {
  /**
   * The selection this is a second rendering of, from the page's own
   * `useGridSelection` over the list the grid is showing (ADR 0022).
   *
   * The whole selection and not the wallpaper alone, because the position line
   * counts against the list the selection was resolved over.
   */
  selection: GridSelection;
  /** Whether one is up, from `useLightbox` over that same selection. */
  open: boolean;
  /**
   * `useLightbox`'s `close`, which is the curator's own way out and the half
   * that puts focus back on the card. Radix asks for it on Escape and on the
   * Close button; the two closes nobody pressed never reach here.
   */
  onClose: () => void;
  /**
   * A transition the curator asked for while looking at the picture, on the
   * wallpaper the picture is of.
   *
   * The same entry the grid behind is handed, and the pages pass the same
   * function to both: a keep from in here is the page's own keep, with the
   * page's optimistic removal, its published patch and its toast, rather than a
   * second implementation that happens to agree. One entry rather than a
   * callback per action for the reason `WallpaperCardProps.onAction` gives —
   * this surface owns no branch on the Status either, it renders what
   * `STATUS_ACTIONS` offers — and the wallpaper travels back with the action
   * because the page answers about the row it acted on (#140).
   */
  onAction: (action: CardAction, wallpaper: Wallpaper) => void;
}

/**
 * The lightbox: one wallpaper at a size worth judging, with a row under it at
 * the picture's own width.
 *
 * #44 settled the housing and ADR 0022 the behaviour. The layout is the
 * prototype's `inline` variant — the row belongs to the picture rather than to
 * the window, so it is measured off the painted image below — with that
 * prototype's `← → navigate · Esc close` hint dropped, because the keys move
 * onto the controls they fire and the rest live in the `?` dialog.
 *
 * It knows nothing about which page opened it. The action set in the row comes
 * off the wallpaper's Status and nothing else, so Review's list of Active rows
 * never offers a Restore without anyone configuring that, and the card and the
 * lightbox cannot drift into offering different things.
 *
 * What an action does to this surface is not decided here either, and that is
 * the whole of ADR 0022: the lightbox renders the grid's selection, so a keep
 * that empties a row lands wherever the selection rule lands, which reads as
 * advancing in Review, as staying put in a library showing everything, and as a
 * close when the row was the last one. There is no rule in this file about what
 * a keep or a reject does to what is on screen, because a rule here is a second
 * answer to a question the list already answers.
 */
export function Lightbox({
  selection,
  open,
  onClose,
  onAction,
}: LightboxProps) {
  const { container } = useLightboxHost();
  const { wallpaper, index, length, moveTo } = selection;

  /**
   * One step through the list, which is a selection move and nothing else.
   *
   * ADR 0022 has this surface render the grid's selection, so a step has no
   * second cursor to keep in sync and no arithmetic of its own at the ends:
   * `moveTo` clamps into the list, which is what makes `←` on the first
   * wallpaper do nothing rather than wrap to the last. The keys and the arrow
   * buttons both come through here, so "the buttons make the movement the keys
   * make" is one function rather than two that happen to agree.
   */
  const step = useCallback((by: number) => moveTo(index + by), [index, moveTo]);

  const atFirst = index <= 0;
  const atLast = index >= length - 1;

  // The five keys, bound on `window` rather than on the content below.
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
  useEffect(() => {
    if (!open || !wallpaper) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }

      // The direct keys, before the movement keys and resolved against the
      // Status by the grid's own `actionFor`: `K`, `Delete` and `R` do exactly
      // what they do on a card, and a key the Status has no action for does
      // nothing at all. `Enter` is nowhere in that table and gets no branch of
      // its own, because it is the key that opened this.
      const action = actionFor(event.key, wallpaper.status);
      if (action) {
        event.preventDefault();
        onAction(action, wallpaper);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      // Answered at the ends too, where the clamp makes it a no-op: the key
      // belongs to this surface whether or not the selection moves.
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, wallpaper, step, onAction]);

  // Whether a `medium` has painted since this was opened, which is the whole
  // question the placeholder below answers: a step has the outgoing picture to
  // hold, and a first open has nothing.
  //
  // Not reset per wallpaper, deliberately. Once one has painted there is always
  // an outgoing frame for the next step to hold, and re-mounting the `small`
  // would put the *arriving* wallpaper's thumbnail behind the outgoing picture
  // — visible around the edges wherever two aspect ratios differ, and this
  // library holds no two the same — and spend a request per step on it. The
  // close is what resets it, because the element goes with the content and a
  // re-opened lightbox has nothing painted again.
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (!open) setArrived(false);
  }, [open]);

  // The painted picture's width, which is what the row shrink-wraps to.
  //
  // Measured rather than expressed in CSS, and that is not a shortcut: during
  // intrinsic sizing a letterboxed image contributes its *natural* width, so a
  // column wrapped around one goes full width and takes the row with it. The
  // image's own `max-w`/`max-h` box is exactly the painted picture, so the box
  // is the measurement. `null` until a layout answers, which happens to be
  // every render under a test runner that lays nothing out — the row falls back
  // to the full width there, and the fall back is what keeps the identity and
  // the position assertable without a layout engine.
  const image = useRef<HTMLImageElement | null>(null);
  const [painted, setPainted] = useState<number | null>(null);

  useEffect(() => {
    const node = image.current;
    if (!node) return;
    const measure = () => {
      const { width } = node.getBoundingClientRect();
      setPainted(width > 0 ? width : null);
    };
    measure();
    // The observer covers the two things that change the box after the first
    // measurement and announce themselves nowhere else: the window resizing,
    // and the `medium` arriving, which is when a letterboxed image first has a
    // natural aspect ratio to be fitted against.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, wallpaper?.id]);

  // Whether the picture is narrower than the row's floor, which is the one
  // thing that drops the read-out. An unmeasured box is not floored: the row
  // falls back to the full width there, and the full width holds everything.
  const floored = painted !== null && painted < ROW_FLOOR;

  // Where the open lands, which is this surface and not a control on it.
  //
  // Radix focuses the first tabbable element inside the content, which since
  // #140 is the first action button — so a lightbox opened to look at a picture
  // would open with a keep armed under Space and Enter, on the surface whose
  // whole rule is that `Enter` does nothing because `Enter` is what opened it.
  // The content itself is focusable (`FocusScope` renders it at `tabIndex=-1`),
  // so this is the same override with a target: Escape and the five keys are
  // bound above the focus rather than on it, and the first Tab still reaches
  // the row.
  const content = useRef<HTMLDivElement | null>(null);

  return (
    <Dialog.Root
      // A wallpaper is what this surface is, so there is no open state without
      // one. The hook closes on an emptied list a commit later; this is the
      // render in between.
      open={open && wallpaper !== null}
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
        {wallpaper && (
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
            // Opaque, not 97%: the prototype's translucent backdrop let the
            // chrome's tabs ghost through the top of the picture, which is a
            // distraction and a lie about what is clickable. No z-index of its
            // own — the shell's portal node is a `z-50` stacking context, so
            // this paints over the pages and under the toast by sitting in it.
            className="fixed inset-0 flex flex-col bg-neutral-950 outline-none"
          >
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
              {/* Both renderings of the wallpaper sit in one grid cell, each
                  fitted against it with `object-contain`, so the `medium`
                  arrives exactly where the `small` was and reads as a
                  sharpening rather than a jump. A cell rather than an overlay
                  positioned over the picture, because the cell already is the
                  rectangle they have to share: it is this container less the
                  height reserved for the row, and an overlay would have to be
                  handed that height a second time to land on the same box.
                  Their order in the DOM is the order they paint, and neither is
                  positioned, so the `medium` covers the `small` with no z-index
                  in it. */}
              <div className="relative grid h-full w-full grid-cols-1 grid-rows-1 place-items-center pb-14">
                {/*
                  The first frame, and the reason opening this never shows an
                  empty box. There is nothing painted to hold on a first open,
                  so the `small` the card the curator just pressed is already
                  showing paints scaled up while the `medium` arrives: one
                  element and no request, because under ADR 0016's `max-age=300`
                  that `small` is in the memory cache. The alternative shows the
                  curator a spinner instead of their wallpaper on the one path
                  where the cache is cold, and ADR 0006 measured that path at
                  386ms mean and 1962ms worst (ADR 0022).

                  Nothing announces it: an empty `alt` keeps it out of the
                  accessibility tree, because it is the same picture as the
                  `medium` over it and that one is already named.
                */}
                {!arrived && (
                  <img
                    data-slot="lightbox-placeholder"
                    src={wallpaperImageUrl(wallpaper.id, "small")}
                    alt=""
                    className="col-start-1 row-start-1 max-h-full max-w-full object-contain"
                  />
                )}

                <img
                  ref={image}
                  data-slot="lightbox-picture"
                  src={wallpaperImageUrl(wallpaper.id, "medium")}
                  alt={wallpaper.filename}
                  // No `key`, deliberately, and this is what it buys: an `<img>`
                  // whose `src` changes keeps painting the image it has until
                  // the new one decodes, so the outgoing wallpaper holds the
                  // frame for the whole of a step. A fresh element per wallpaper
                  // remounts with nothing painted, which is the prototype's bug
                  // — a held arrow key strobing to black at a median 376KB a
                  // frame (ADR 0022).
                  //
                  // `load` is what retires the placeholder above, and `error`
                  // counts as arrival for the reason ADR 0006's rank panes count
                  // it: a missing source file leaves one visibly broken picture,
                  // which is what ADR 0022 says this surface does about it,
                  // rather than a thumbnail held up in front of it for good.
                  onLoad={() => setArrived(true)}
                  onError={() => setArrived(true)}
                  // Not dimmed and not desaturated, whatever the card does. The
                  // card fades a Rejected `<img>` so it recedes in a mixed
                  // grid; this surface exists to show one picture at full size,
                  // which is the opposite job, and the Status pill below
                  // carries the signal instead (ADR 0019, ADR 0022).
                  className="col-start-1 row-start-1 max-h-full max-w-full object-contain"
                />

                {/* The row, at the picture's width and absolutely positioned so
                    it cannot affect the layout it is measured against — in flow
                    the two chase each other and the measurement settles short.

                    `minWidth` is the floor, and what it produces is an overhang
                    on both sides rather than one, because the row is centred on
                    the picture rather than aligned to an edge of it. See
                    `ROW_FLOOR` for the arithmetic and for why nothing tests
                    it. */}
                <div
                  data-slot="lightbox-row"
                  className="absolute bottom-0 left-1/2 flex h-11 -translate-x-1/2 items-center gap-4 overflow-hidden"
                  style={{ width: painted ?? "100%", minWidth: ROW_FLOOR }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {/*
                        The Score, written as every surface showing one writes
                        it, with the same solid-means-Evaluated dimming the card
                        carries. Both read `score` and `isEvaluated` out of
                        `copy.ts`, so there is one definition of confidence in
                        the app rather than one per surface (ADR 0013).
                      */}
                      <Badge
                        title={
                          isEvaluated(wallpaper)
                            ? "Evaluated"
                            : "Not yet Evaluated"
                        }
                        className={
                          isEvaluated(wallpaper)
                            ? "bg-white text-neutral-900"
                            : "border-white/30 bg-black/50 text-white/70"
                        }
                      >
                        {score(wallpaper)}
                      </Badge>

                      {/* The filename is the dialog's name. Radix wants a
                          `Dialog.Title` for `aria-labelledby`, and the one
                          thing already on this row that says which wallpaper is
                          up is the one to give it. */}
                      <Dialog.Title className="truncate text-sm font-medium text-white">
                        {wallpaper.filename}
                      </Dialog.Title>

                      {/* Every Status, unlike the card's pill. That one marks
                          the wallpapers a mixed grid should read as exceptions,
                          and stays off fifty Active cards that would all say
                          the same word; here there is one wallpaper and nothing
                          for it to repeat. */}
                      <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/70">
                        {STATUS_LABEL[wallpaper.status]}
                      </span>
                    </div>

                    {/*
                      The read-out, which names what is not already on screen —
                      ADR 0017's rule for the toast copy, applied to a line.

                      For a Rejected wallpaper that is the **Origin**: it is
                      what #140's Restore is about to act on, and it has never
                      been rendered anywhere in the app, while the folder its
                      file went to is named by ADR 0018's bar and by ADR 0019's
                      card. Every other Status shows `path`, and so does the
                      cohort ADR 0009's migration left with no Origin at all —
                      there, the `aria-disabled` Restore #140 puts beside this
                      line is what carries the explanation.

                      The `title` is always where the file is now, which is both
                      the half a Rejected row's line gives up and the full
                      string for a line that truncates.

                      This is what drops on a picture narrower than the row's
                      floor, and it is the only thing that does: it is the one
                      part of the row that tells the curator nothing they need
                      in order to act, which is what makes it the part that can
                      go (ADR 0022).
                    */}
                    {!floored && (
                      <p
                        data-slot="lightbox-readout"
                        className="truncate font-mono text-[11px] text-white/50"
                        title={wallpaper.path}
                      >
                        {wallpaper.status === "rejected" && wallpaper.origin_path
                          ? wallpaper.origin_path
                          : wallpaper.path}
                      </p>
                    )}
                  </div>

                  {/*
                    How much the Score beside the filename is worth, and where
                    this wallpaper sits in the list being walked.

                    The position is worth printing because the arrows clamp
                    rather than wrapping: reaching the end of a fifty-row
                    worklist is the moment the sweep is done, and it is also the
                    reason the arrow beside it has gone unavailable. It counts
                    against the whole list rather than the window ADR 0016
                    mounts cards for, which is why the selection carries its own
                    length.
                  */}
                  <div className="shrink-0 text-right text-[11px] tabular-nums text-white/50">
                    {/* The comparison count is read-out and goes with the line
                        above it on a floored row. The position is not: it is
                        what clamping made worth printing, and `50 / 50` is the
                        reason the arrow beside it is unavailable. */}
                    {!floored && (
                      <div>
                        {counted(wallpaper.comparisons_count, "comparison")}
                      </div>
                    )}
                    <div>{`${grouped(index + 1)} / ${grouped(length)}`}</div>
                  </div>

                  {/*
                    The action set, and the reason a curator can decide while
                    looking at the thing they are deciding about. Under ADR 0019
                    it is also the one path to acting without a hover, which is
                    what a touchscreen has.

                    One button per action the Status offers, off the same
                    `STATUS_ACTIONS` the card's overlay renders from and the
                    grid's keys resolve against: Active gets Keep and Reject,
                    Kept gets Make Active and Reject, Rejected gets Restore.
                    Nothing here knows which page opened it, so there is no
                    caller flag and the two action sets cannot drift out of
                    agreement with ADR 0009's transition table.

                    Nothing is greyed to hold its space. The row's width changes
                    on every step, because it is measured off a picture and no
                    two wallpapers in this library share an aspect ratio, so
                    reserving button space stabilises the wrong axis. The one
                    control that renders while unavailable is the Restore on an
                    origin-less row, and it renders because it has a sentence to
                    deliver.
                  */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {STATUS_ACTIONS[wallpaper.status].map((action) => {
                      const { label, Icon, destructive } =
                        ACTION_CONTROLS[action];
                      // Known before the press, because ADR 0009 put
                      // `origin_path` on the DTO for exactly this.
                      const unavailable =
                        action === "restore" && wallpaper.origin_path === null;
                      return (
                        <Button
                          key={action}
                          size="xs"
                          variant={destructive ? "destructive" : undefined}
                          // Not `disabled`, for ADR 0019's reason: a disabled
                          // button is not focusable, so the sentence explaining
                          // why a Rejected wallpaper cannot go back would be
                          // unreachable by keyboard and silent to a screen
                          // reader, which is most of the people it is written
                          // for. `aria-disabled` keeps the control focusable and
                          // lets it explain itself when pressed.
                          aria-disabled={unavailable ? true : undefined}
                          // The verb alone. On a card this carries the filename
                          // too, because a grid of fifty rows has fifty Keeps in
                          // it; here there is one wallpaper and the dialog is
                          // already named by it, so repeating the name on every
                          // control would be the third time a reader hears it.
                          // The printed key stays out of the name for the same
                          // reason it is on the button at all: it is the binding
                          // shown to an eye, not part of what the control does.
                          aria-label={label}
                          // The refusal an origin-less row gets is the host's
                          // `perform`, so pressing Restore in here, pressing it
                          // on the card, and pressing `R` on either are one
                          // event with one outcome (ADR 0023).
                          onClick={() => onAction(action, wallpaper)}
                          // The card's own treatment, because these sit on the
                          // same dark ground. Not `flex-1`: on a card the two
                          // buttons split the overlay's width, and here they are
                          // the part of the row that never shrinks.
                          className={cn(
                            destructive
                              ? "bg-destructive/90 text-white hover:bg-destructive"
                              : "bg-white/15 text-white hover:bg-white/25",
                            unavailable &&
                              "cursor-not-allowed opacity-40 hover:bg-white/15",
                          )}
                        >
                          <Icon />
                          {label}
                          {/* The key, on the control it fires. It survives the
                              row narrowing because the buttons are what never
                              drop, which is why the prototype's
                              `← → navigate · Esc close` hint went and the
                              arrows and Escape live in the `?` dialog instead
                              (ADR 0022). */}
                          <kbd className="rounded border border-white/25 px-1 py-0.5 font-mono text-[10px] leading-none text-white/70">
                            {printedKey(action)}
                          </kbd>
                        </Button>
                      );
                    })}
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
                An origin-less Restore does, because nothing on screen says why
                a Rejected wallpaper cannot go back, so it stays focusable in
                order to say it when pressed. An arrow at the end of the list
                owes nothing — the position line under the picture already reads
                `50 / 50`, which is the reason and is the whole of it — and the
                keys clamp at the same place, so a control nobody can focus
                takes nothing away from anybody.
              */}
              <button
                type="button"
                aria-label="Previous wallpaper"
                tabIndex={-1}
                disabled={atFirst}
                onClick={() => step(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/10"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <button
                type="button"
                aria-label="Next wallpaper"
                tabIndex={-1}
                disabled={atLast}
                onClick={() => step(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white/10"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              {/* The way out for a pointer, and under ADR 0019 the only one a
                  touchscreen has: there is no hover to reveal and no Escape to
                  press. */}
              <Dialog.Close
                aria-label="Close"
                className="absolute top-2 right-2 rounded-full bg-white/10 p-2 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
