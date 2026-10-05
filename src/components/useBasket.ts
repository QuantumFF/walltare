import { useToaster } from "@/components/ToastSurface";
import { useDownload } from "@/context/DownloadRunContext";
import {
  downloadable,
  EMPTY_BASKET,
  livePicks,
  offer,
  reduceBasket,
  type Basket,
  type BasketEvent,
  type Offer,
  type SearchAt,
} from "@/lib/basket";
import type { MarkedResult } from "@/lib/client";
import { useBackendEvents } from "@/lib/useBackendEvents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface BasketControls {
  /** The Picks that could still be downloaded: what the tray counts and `D` sends. */
  picks: MarkedResult[];
  /** What a Result offers now (`offer` in `basket.ts`). */
  offer: (result: MarkedResult) => Offer;
  /**
   * Whether a Result can be picked and downloaded now, `offer`'s `offered`,
   * read off the basket as it stands at the call rather than as last
   * rendered. One identity for the life of the page, which is what lets the
   * key tables built from it keep theirs (`resultKeys` in `keymap.ts`).
   */
  offered: (result: MarkedResult) => boolean;
  /** Make the Result a Pick, or stop it being one, if it can be one. */
  pick: (result: MarkedResult) => void;
  /** Download these, as far as they can be, in the order given. */
  download: (results: readonly MarkedResult[]) => void;
  /** Download the Picks. */
  downloadPicks: () => void;
  /** The tray's Clear. */
  clear: () => void;
  /** Tell the basket what a search answered (the `searched` event). */
  searched: (results: readonly MarkedResult[], at: SearchAt) => void;
}

/**
 * Discover's basket, held for the page: the Picks and its downloads, moved by
 * the curator's presses, the backend's answer to a download, and
 * `download-progress` (#419).
 *
 * Every download starts here: the caption's, `D`'s and the tray's. The ids go
 * to the backend as one request, in the order given, and leave the Picks as
 * they go, which only ever hold what is still to come. A refusal at the click
 * queued nothing, so the basket undoes the take and the reason is said where
 * the click was.
 *
 * The basket is read from a ref as well as rendered, so two presses inside one
 * commit each see the other, and every control here keeps one identity for
 * the life of the page.
 *
 * `onLanded` hears each file that lands, for the page to mark its Result In
 * library, which is what the next search would mark it anyway.
 */
export function useBasket(onLanded: (id: string) => void): BasketControls {
  const requestDownload = useDownload();
  const { show } = useToaster();
  const [state, setState] = useState<Basket>(EMPTY_BASKET);
  const latest = useRef(state);
  const dispatch = useCallback((event: BasketEvent) => {
    latest.current = reduceBasket(latest.current, event);
    setState(latest.current);
  }, []);

  const landed = useRef(onLanded);
  useEffect(() => {
    landed.current = onLanded;
  });

  const download = useCallback(
    (results: readonly MarkedResult[]) => {
      const ids = downloadable(latest.current, results);
      if (ids.length === 0) return;
      dispatch({ type: "taken", results });
      requestDownload(ids).then(
        () => dispatch({ type: "accepted", ids }),
        (error: unknown) => {
          dispatch({ type: "refused", ids });
          show({ kind: "download-refused", error });
        },
      );
    },
    [dispatch, requestDownload, show],
  );

  const downloadPicks = useCallback(
    () => download(livePicks(latest.current)),
    [download],
  );
  const pick = useCallback(
    (result: MarkedResult) => dispatch({ type: "picked", result }),
    [dispatch],
  );
  const clear = useCallback(() => dispatch({ type: "cleared" }), [dispatch]);
  const searched = useCallback(
    (results: readonly MarkedResult[], at: SearchAt) =>
      dispatch({ type: "searched", results, at }),
    [dispatch],
  );

  useBackendEvents({
    downloadProgress: ({ item: { wallhaven_id: id, outcome } }) => {
      dispatch({ type: "progress", id, outcome });
      if (outcome.kind === "landed") landed.current(id);
    },
    // Nothing on `download-complete`: every id this page queued gets its own
    // `download-progress`, and an id clicked after the backend closed a batch
    // is already the next batch's, on the wire while that ending arrives.
  });

  const offered = useCallback(
    (result: MarkedResult) => offer(latest.current, result).offered,
    [],
  );

  const picks = useMemo(() => livePicks(state), [state]);
  const offerNow = useCallback(
    (result: MarkedResult) => offer(state, result),
    [state],
  );

  return {
    picks,
    offer: offerNow,
    offered,
    pick,
    download,
    downloadPicks,
    clear,
    searched,
  };
}
