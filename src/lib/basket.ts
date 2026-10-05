/**
 * Discover's basket: the page's Picks and the downloads it has asked for, and
 * the one rule both answer to (#344, #419).
 *
 * The glossary's Pick rules are stated once, by `offer`: only an unmarked
 * Result can be a Pick, and only one that is not already on its way to the
 * library. Picking, downloading and what a card or the lightbox draws all read
 * that one answer, so none of them can offer what another refuses.
 *
 * Everything here is a pure function of the basket and an event. The hook
 * that holds it, `useBasket`, is what talks to the backend.
 */
import type { DownloadOutcome, Mark, MarkedResult } from "@/lib/client";

/**
 * Where one Result's download has got to, as its caption says it (ADR 0051).
 *
 * Queued and Downloading are the page's reading of its own queue: the backend
 * downloads one file at a time in the order it was asked, so the first of the
 * page's queued ids is the one on the wire. Landed and Failed are what
 * `download-progress` said about it.
 */
export type ResultDownload =
  | { kind: "queued" }
  | { kind: "downloading" }
  | { kind: "landed" }
  | { kind: "failed"; message: string };

/** How a file ended, which is the part of a download the events set. */
type Ended = Extract<ResultDownload, { kind: "landed" | "failed" }>;

export interface Basket {
  /**
   * The Picks, in the order picked, which is the order they download in. Each
   * is held as the Result itself, as the page last knew it, so a new search or
   * a changed filter keeps them and the tray can draw one no page shown now
   * holds.
   */
  picks: readonly MarkedResult[];
  /**
   * The Picks a download took that the backend has not answered for yet. A
   * refusal puts back only the ones still here, so a Clear pressed while the
   * request was out stays a Clear.
   */
  held: readonly MarkedResult[];
  /** The ids this page has asked for and heard nothing back about, in order. */
  queue: readonly string[];
  /**
   * How each file came out, for as long as the Results it was shown on are. A
   * new search marks a landed Result In library itself, and a failed one is
   * back to a plain card that offers Download.
   */
  ended: Readonly<Record<string, Ended>>;
}

export const EMPTY_BASKET: Basket = {
  picks: [],
  held: [],
  queue: [],
  ended: {},
};

export type BasketEvent =
  /** Make the Result a Pick, or stop it being one. */
  | { type: "picked"; result: MarkedResult }
  /**
   * Download these, in this order: the ones `downloadable` lets through join
   * the queue and leave the Picks.
   */
  | { type: "taken"; results: readonly MarkedResult[] }
  /** The backend queued these ids. */
  | { type: "accepted"; ids: readonly string[] }
  /** The backend refused these ids at the click, and queued none of them. */
  | { type: "refused"; ids: readonly string[] }
  /** One file is done, as `download-progress` says it. */
  | { type: "progress"; id: string; outcome: DownloadOutcome }
  /**
   * A search answered: the first page of a new one, which replaces the
   * Results, or a Load more's, which adds to them.
   */
  | { type: "searched"; results: readonly MarkedResult[]; at: "first" | "more" }
  /** The tray's Clear. */
  | { type: "cleared" };

/** What a Result offers where Pick and Download go. */
export interface Offer {
  /** Where its download has got to, or `undefined` if it has none. */
  download: ResultDownload | undefined;
  /**
   * The mark it says in place of Pick and Download. `null` for an unmarked
   * Result, and for one whose file just landed, which says how it got there
   * rather than repeating the mark.
   */
  mark: Exclude<Mark, "unmarked"> | null;
  /**
   * Whether it can be picked and downloaded now: unmarked, and with no
   * download, or one that failed. One answer for both, since a Pick is only
   * ever gathered to be downloaded.
   */
  offered: boolean;
  /** Whether it is one of the Picks. */
  picked: boolean;
}

function downloadOf(basket: Basket, id: string): ResultDownload | undefined {
  const at = basket.queue.indexOf(id);
  if (at >= 0) return { kind: at === 0 ? "downloading" : "queued" };
  return basket.ended[id];
}

function offeredIn(basket: Basket, result: MarkedResult): boolean {
  const download = downloadOf(basket, result.id);
  return (
    result.mark === "unmarked" && (!download || download.kind === "failed")
  );
}

/**
 * What `result` offers now: the one statement of what a Result can do, which
 * the card's caption, the lightbox's row, the keys and the tray all read.
 */
export function offer(basket: Basket, result: MarkedResult): Offer {
  const download = downloadOf(basket, result.id);
  const offered = offeredIn(basket, result);
  return {
    download,
    mark:
      result.mark === "unmarked" || download?.kind === "landed"
        ? null
        : result.mark,
    offered,
    picked: offered && basket.picks.some((r) => r.id === result.id),
  };
}

/** The Picks that could still be downloaded: every one the tray counts. */
export function livePicks(basket: Basket): MarkedResult[] {
  return basket.picks.filter((r) => offeredIn(basket, r));
}

/** The ids of `results` a download would take now, in the order given. */
export function downloadable(
  basket: Basket,
  results: readonly MarkedResult[],
): string[] {
  return results.filter((r) => offeredIn(basket, r)).map((r) => r.id);
}

/**
 * `list` as `results` now has it: each Result one of them carries is replaced
 * by that copy, and one it marks leaves, since only an unmarked Result can be
 * a Pick.
 */
function refreshed(
  list: readonly MarkedResult[],
  results: readonly MarkedResult[],
): readonly MarkedResult[] {
  const fresh = new Map(results.map((r) => [r.id, r]));
  return list
    .map((r) => fresh.get(r.id) ?? r)
    .filter((r) => r.mark === "unmarked");
}

/** The basket after `event`. */
export function basket(state: Basket, event: BasketEvent): Basket {
  switch (event.type) {
    case "picked": {
      const { result } = event;
      if (!offeredIn(state, result)) return state;
      const picks = state.picks.some((r) => r.id === result.id)
        ? state.picks.filter((r) => r.id !== result.id)
        : [...state.picks, result];
      return { ...state, picks };
    }
    case "taken": {
      const ids = downloadable(state, event.results);
      if (ids.length === 0) return state;
      const taken = new Set(ids);
      const ended = { ...state.ended };
      for (const id of ids) delete ended[id];
      return {
        picks: state.picks.filter((r) => !taken.has(r.id)),
        held: [
          ...state.held.filter((r) => !taken.has(r.id)),
          ...state.picks.filter((r) => taken.has(r.id)),
        ],
        queue: [...state.queue, ...ids],
        ended,
      };
    }
    case "accepted": {
      const answered = new Set(event.ids);
      return {
        ...state,
        held: state.held.filter((r) => !answered.has(r.id)),
      };
    }
    case "refused": {
      // Nothing was queued, so the cards go back to offering Download, and the
      // Picks it took that nobody has cleared since go back ahead of any
      // picked since.
      const refused = new Set(event.ids);
      const back = state.held.filter((r) => refused.has(r.id));
      const returning = new Set(back.map((r) => r.id));
      return {
        ...state,
        held: state.held.filter((r) => !refused.has(r.id)),
        queue: state.queue.filter((id) => !refused.has(id)),
        picks: [...back, ...state.picks.filter((r) => !returning.has(r.id))],
      };
    }
    case "progress": {
      const { id, outcome } = event;
      return {
        ...state,
        queue: state.queue.filter((queued) => queued !== id),
        ended: {
          ...state.ended,
          [id]:
            outcome.kind === "landed"
              ? { kind: "landed" }
              : { kind: "failed", message: outcome.message },
        },
      };
    }
    case "searched":
      return {
        ...state,
        picks: refreshed(state.picks, event.results),
        held: refreshed(state.held, event.results),
        ended: event.at === "first" ? {} : state.ended,
      };
    case "cleared":
      return { ...state, picks: [], held: [] };
  }
}
