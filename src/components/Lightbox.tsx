import type { GridSelection } from "@/components/WallpaperGrid";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/context/AppContext";
import { useLightboxHost } from "@/context/LightboxHostContext";
import { wallpaperImageUrl, type Wallpaper } from "@/lib/client";
import { counted, grouped, isEvaluated, score, STATUS_LABEL } from "@/lib/copy";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

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
 * It knows nothing about which page opened it. The action set #140 puts in the
 * row comes off the wallpaper's Status and nothing else, so Review's list of
 * Active rows never offers a Restore without anyone configuring that, and the
 * card and the lightbox cannot drift into offering different things.
 */
export function Lightbox({ selection, open, onClose }: LightboxProps) {
  const { container } = useLightboxHost();
  const { wallpaper, index, length } = selection;

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
            // By hand, because the primitive writes it only for a modal dialog
            // and the claim is true for a different reason here: the pages
            // behind are `inert`.
            aria-modal
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
              {/* #139 hangs the arrow buttons off the two edges of this box,
                  and clamps them at the ends of the list. */}
              <div className="relative flex h-full w-full items-center justify-center pb-14">
                <img
                  ref={image}
                  src={wallpaperImageUrl(wallpaper.id, "medium")}
                  alt={wallpaper.filename}
                  // No `key`, deliberately: a fresh one per wallpaper remounts
                  // the element and strobes the picture to black on every step,
                  // which is the prototype's bug and #139's to fix by holding
                  // the outgoing frame until the next one loads. Nothing steps
                  // yet, so the only blank here is the one on first open.
                  //
                  // Not dimmed and not desaturated, whatever the card does. The
                  // card fades a Rejected `<img>` so it recedes in a mixed
                  // grid; this surface exists to show one picture at full size,
                  // which is the opposite job, and the Status pill below
                  // carries the signal instead (ADR 0019, ADR 0022).
                  className="max-h-full max-w-full object-contain"
                />

                {/* The row, at the picture's width and absolutely positioned so
                    it cannot affect the layout it is measured against — in flow
                    the two chase each other and the measurement settles short.
                    #140 puts the buttons on the right of it and gives the row
                    the floor it needs when a portrait picture paints narrower
                    than they do; until then nothing here can be cut off. */}
                <div
                  data-slot="lightbox-row"
                  className="absolute bottom-0 left-1/2 flex h-11 -translate-x-1/2 items-center gap-4 overflow-hidden"
                  style={{ width: painted ?? "100%" }}
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
                    */}
                    <p
                      data-slot="lightbox-readout"
                      className="truncate font-mono text-[11px] text-white/50"
                      title={wallpaper.path}
                    >
                      {wallpaper.status === "rejected" && wallpaper.origin_path
                        ? wallpaper.origin_path
                        : wallpaper.path}
                    </p>
                  </div>

                  {/*
                    How much the Score beside the filename is worth, and where
                    this wallpaper sits in the list being walked.

                    The position stays even though nothing steps yet, because
                    #139 clamps rather than wrapping and that is what makes the
                    end of a fifty-row worklist mean something: reaching it is
                    the moment the sweep is done. It counts against the whole
                    list rather than the window ADR 0016 mounts cards for, which
                    is why the selection carries its own length.
                  */}
                  <div className="shrink-0 text-right text-[11px] tabular-nums text-white/50">
                    <div>
                      {counted(wallpaper.comparisons_count, "comparison")}
                    </div>
                    <div>{`${grouped(index + 1)} / ${grouped(length)}`}</div>
                  </div>
                </div>
              </div>

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
