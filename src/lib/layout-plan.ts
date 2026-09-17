/**
 * Where a grid's cards go, computed before any of them exists.
 *
 * A layout is a plan: rows, each carrying the cards in it and its own height,
 * plus where every row sits in the scroll height. Nothing here touches the DOM
 * and nothing here is measured, which is what lets a window ask for an exact row
 * height instead of an estimate it corrects once the row has mounted.
 *
 * Computed rather than measured, because measuring is the conventional answer
 * and it is the one that makes a library jump. A virtualiser handed an estimate
 * re-measures each row as it mounts and shifts everything below it by the
 * difference, so reaching for a card moves it; and happy-dom does no layout at
 * all, so a measured height under test is zero and the window collapses (#131).
 * The plan is the one place that says how tall a row is, and both the window and
 * the cells read it.
 *
 * The grid keeps its own geometry (ADR 0027). This module is arithmetic over
 * numbers it is handed — a gap, a padding, a width, a ratio — and it imports
 * nothing about a card, a Wallpaper or a class name.
 */

/** One row of a plan, and the whole of what a window needs about it. */
export interface PlannedRow {
  /**
   * The cards in this row, as positions in the whole list, in the order they
   * are drawn.
   *
   * A list of positions rather than a first and a last, because a row is not
   * obliged to hold a run: the uniform grid's rows do, and a layout that packs
   * by shortest column does not.
   */
  cards: number[];
  /** How tall the row is drawn, in pixels, with no gap in it. */
  height: number;
  /**
   * Where the row's top edge sits inside the scroll box, in pixels, counting
   * from the box's own top. The leading padding and every gap above the row are
   * included, so this is the offset a scroller scrolls to.
   */
  top: number;
}

/** A whole layout, as the rows it puts on screen and the way back into them. */
export interface LayoutPlan {
  /** Every row, top to bottom. */
  rows: PlannedRow[];
  /**
   * Which row holds each card, by the card's position in the whole list.
   *
   * Built while the rows are, because the way back is a lookup and deriving it
   * by scanning the rows is the same answer at the cost of the scan. The window
   * asks for it whenever the selection moves to a card with no node: the row has
   * to be brought in before the card can be focused (ADR 0019).
   */
  rowOfCard: number[];
  /**
   * The whole scroll height, both paddings included — the same number a
   * virtualiser holds the scroll range open with.
   */
  total: number;
}

/**
 * How far a tab's density may be moved, as the column counts at either end.
 *
 * Per tab rather than one pair for the app, because the two tabs are doing
 * different jobs with the same cards: Library is a browse surface where going
 * wide is the point, and Review is a worklist of fifty where a card too small to
 * judge is a card the curator has to open to use. The bound is what keeps either
 * gesture off a density that renders nothing usefully (#264).
 */
export interface DensityRange {
  /** The largest the cards go, as the fewest that share a row. */
  min: number;
  /** The smallest they go, as the most that share a row. */
  max: number;
}

/**
 * How many cards share a row once the curator has zoomed, from the count the
 * viewport asks for on its own.
 *
 * A zoom of zero is the responsive count and nothing else, so a curator who
 * never makes the gesture gets exactly the grid that was there before. A step in
 * is a card fewer — the direction the word means, and the direction a map and a
 * browser both move under the same gesture — and the breakpoints keep applying
 * underneath, so a narrowed window still narrows the grid by one.
 *
 * Offsetting the responsive count rather than replacing it is what makes the
 * second half true. A stored column count would be the curator's answer to a
 * question the viewport had not asked yet, and a window dragged narrow would
 * hold eight columns of nothing.
 */
export function densityColumns(
  base: number,
  zoom: number,
  { min, max }: DensityRange,
): number {
  return Math.max(min, Math.min(base - zoom, max));
}

/**
 * The zoom one step leaves behind: `by` of 1 for a step in, -1 for a step out.
 *
 * Clamped as a column count and expressed as a zoom again, rather than clamped
 * where it is read. Ten steps in at the top of the range would otherwise bank
 * nine that the way back has to spend before anything on screen moved, which is
 * a gesture the curator makes and watches do nothing.
 */
export function densityZoom(
  base: number,
  zoom: number,
  by: number,
  range: DensityRange,
): number {
  return base - densityColumns(base, zoom + by, range);
}

/** The space a plan lays its rows out against. Both are the grid's own CSS. */
export interface PlanSpacing {
  /** Between two rows, and between two cards in a row. */
  gap: number;
  /** Between the grid's edge and the cards, at both ends. */
  padding: number;
}

/** A row on the way to being planned: its cards, and how tall they make it. */
export interface RowOfCards {
  cards: number[];
  height: number;
}

/**
 * Stack rows into a plan: the offsets, the index back from a card, and the
 * total.
 *
 * The part every layout shares, and the reason a new layout is a function that
 * works out row heights rather than a component. The uniform grid below is the
 * only caller today; masonry and justified rows are the same call with heights
 * that differ from row to row.
 *
 * The offsets are the ones a virtualiser told the same `gap` and `padding`
 * would produce: the leading padding, then each row's height with a gap between
 * consecutive rows, and the trailing padding at the end. An empty plan is the
 * two paddings and nothing between them, which is what an empty grid occupies.
 */
export function layoutPlan(
  rows: readonly RowOfCards[],
  { gap, padding }: PlanSpacing,
): LayoutPlan {
  const planned: PlannedRow[] = [];
  const rowOfCard: number[] = [];
  let top = padding;
  for (const [at, row] of rows.entries()) {
    if (at > 0) top += gap;
    planned.push({ cards: row.cards, height: row.height, top });
    // The first row a card appears in, which for every layout whose rows are
    // disjoint is the only one. A masonry card taller than a band is listed in
    // each band it crosses, and the row to reveal is the one holding its top:
    // bringing in the last band it touches would scroll past the card.
    for (const card of row.cards) rowOfCard[card] ??= at;
    top += row.height;
  }
  return { rows: planned, rowOfCard, total: top + padding };
}

/** What one row of uniform cards gets its height from. */
export interface UniformRow extends PlanSpacing {
  /** How many cards share a row. */
  columns: number;
  /**
   * The scroll box's width, the `padding` above included at both ends — the
   * width the row has to fit its cards into rather than the width they get.
   */
  width: number;
  /**
   * The shape every card is drawn at, as height over width.
   *
   * One ratio for the whole grid, which is the whole of what makes this layout
   * uniform: the card crops each wallpaper to fill a box of this shape, so a
   * wallpaper's own ratio reaches nothing here. A layout that shows wallpapers
   * uncropped takes a ratio per card instead, and that is the difference
   * between the plans rather than a missing parameter on this one.
   */
  cardRatio: number;
  /**
   * What a row is taken to be while the box has no width to divide.
   *
   * Not an edge case: happy-dom reports every box as zero and ADR 0015 keeps a
   * view mounted under `display: none`, which zeroes it in a real browser too.
   * A window over rows of zero height is a window over nothing.
   */
  unmeasuredHeight: number;
}

/**
 * How tall one row of uniform cards is, from the width the row has to fill and
 * the number of cards sharing it.
 *
 * The cards get the box less the padding at both ends and less a gap between
 * every pair; each takes an equal share of what is left and is as tall as
 * `cardRatio` makes it.
 */
export function uniformRowHeight({
  columns,
  width,
  gap,
  padding,
  cardRatio,
  unmeasuredHeight,
}: UniformRow): number {
  const cards = width - 2 * padding - gap * (columns - 1);
  if (cards <= 0) return unmeasuredHeight;
  return (cards / columns) * cardRatio;
}

/** What the uniform grid is, once the row height above is known. */
export interface UniformGrid extends PlanSpacing {
  /** How many wallpapers the plan covers. */
  count: number;
  /** How many cards share a row. */
  columns: number;
  /** How tall every one of them is. See `uniformRowHeight`. */
  rowHeight: number;
}

/**
 * The uniform grid as a plan: the list cut into rows of `columns`, every row the
 * same height.
 *
 * The layout the app has always had, said as a plan so that the window reads its
 * heights from the same place every other layout will be read from. Rows hold
 * runs of consecutive positions, which is what a CSS grid's own auto-flow puts
 * on screen, so the plan describes the layout rather than imposing one.
 *
 * The height arrives worked out rather than as a width and a ratio, because the
 * uniform grid has one height for every row and the grid is what holds the CSS
 * it comes from (ADR 0027). A layout that shows wallpapers uncropped works out a
 * height per row from the ratios instead, and calls `layoutPlan` with them —
 * which is the whole of the difference between the plans.
 */
export function planUniformGrid({
  count,
  columns,
  rowHeight,
  gap,
  padding,
}: UniformGrid): LayoutPlan {
  const rows: RowOfCards[] = [];
  for (let from = 0; from < count; from += columns) {
    const cards: number[] = [];
    for (let at = from; at < Math.min(from + columns, count); at++) {
      cards.push(at);
    }
    rows.push({ cards, height: rowHeight });
  }
  return layoutPlan(rows, { gap, padding });
}

/** Where one card is drawn, for a layout that positions its cards itself. */
export interface PlannedBox {
  /** The left edge, from the scroll box's own left, leading padding included. */
  left: number;
  /** The top edge, from the scroll box's own top, the same way `PlannedRow.top` is. */
  top: number;
  width: number;
  height: number;
}

/**
 * A masonry plan: the rows a window reads, and where each card actually goes.
 *
 * Masonry is the first layout whose cards do not fall out of their row. A
 * uniform row draws its cards by handing them to a CSS grid, and the plan only
 * has to say how tall the row is; a masonry card sits at an offset of its own in
 * a column of its own, so the plan says where. `boxes` is indexed by a card's
 * position in the whole list, which is the index every other part of the grid
 * already works in.
 *
 * The rows are horizontal bands rather than groups of cards, because that is
 * what a window over a masonry layout has to be: the cards are staggered, so
 * there is no set of them that starts and ends together. A band runs from one
 * card top to the next, and it carries every card that overlaps it — which is at
 * most one per column, since cards inside a column never overlap. A card taller
 * than a band therefore appears in several of them, and `windowOf` mounts it
 * once.
 */
export interface MasonryPlan extends LayoutPlan {
  /** Where each card goes, by its position in the whole list. */
  boxes: PlannedBox[];
}

/** What masonry is laid out from. */
export interface MasonryGrid extends PlanSpacing {
  /**
   * Each wallpaper's shape, as height over width, in list order — or `null` for
   * one whose Dimensions the app has not read yet (CONTEXT.md, ADR 0044).
   *
   * The ratio and not the pixels. Masonry is a question about shape, and a
   * 5120x2160 ultrawide and a 1920x810 crop of it are drawn identically here.
   */
  ratios: ReadonlyArray<number | null>;
  /** How many columns the cards are packed into. */
  columns: number;
  /** The scroll box's width, the `padding` included at both ends. */
  width: number;
  /**
   * The shape a wallpaper with no Dimensions is drawn at.
   *
   * A row mid-backfill holds no width and no height, and that is ordinary rather
   * than an error: nothing waits for it. Drawn at its true ratio it would be a
   * card of no height at all, so it takes the shape the uniform grid crops every
   * wallpaper to instead — a guess that is right for about half a real library
   * and wrong by a margin nobody can act on for the rest.
   */
  unknownRatio: number;
  /**
   * What a card is taken to be tall while the box has no width to divide.
   *
   * The same branch `uniformRowHeight` answers, for the same two reasons:
   * happy-dom reports every box as zero, and ADR 0015 keeps a view mounted under
   * `display: none`. Cards of no height are a window over nothing.
   */
  unmeasuredHeight: number;
}

/**
 * Masonry: every wallpaper at its own aspect ratio, packed into columns
 * shortest-first.
 *
 * The assignment is greedy and computed — each card goes to whichever column is
 * currently shortest, ties to the leftmost — so the whole layout is known before
 * a single card has a node. That is the property this whole module exists for:
 * the window is handed exact row heights rather than estimates it corrects as
 * rows mount, so reaching for a wallpaper does not move it (ADR 0045).
 *
 * Greedy shortest-column rather than a balanced partition. A partition that
 * minimised the tallest column would reorder the list to do it, and the list's
 * order is the Score ordering the curator asked for — a layout that shuffles it
 * is answering a different question. Greedy keeps reading order down the columns
 * and still leaves the columns within one card of each other.
 *
 * It costs a box and a band per wallpaper, where the uniform grid costs a row
 * per `columns` of them: at ADR 0016's ceiling that is about ten thousand small
 * objects against a thousand. Both are rebuilt when the count, the column count
 * or the box width moves and neither is on a scroll, which is where ADR 0041
 * puts the gesture's cost.
 */
export function planMasonry({
  ratios,
  columns: asked,
  width,
  gap,
  padding,
  unknownRatio,
  unmeasuredHeight,
}: MasonryGrid): MasonryPlan {
  // At least one, because every division below is by this number and a grid
  // that reported none would divide the width by nothing.
  const columns = Math.max(1, asked);
  const available = width - 2 * padding - gap * (columns - 1);
  // A box with nothing to divide gives every card the same height, which packs
  // the columns round-robin and is the uniform grid's own degenerate answer.
  const cardWidth = available > 0 ? available / columns : 0;

  // How far down each column has reached, as the top the next card in it takes.
  const columnTop: number[] = Array.from({ length: columns }, () => padding);
  const boxes: PlannedBox[] = [];

  for (const ratio of ratios) {
    let shortest = 0;
    for (let column = 1; column < columns; column++) {
      if (columnTop[column] < columnTop[shortest]) shortest = column;
    }
    const shape = ratio === null || ratio <= 0 ? unknownRatio : ratio;
    const height = cardWidth > 0 ? cardWidth * shape : unmeasuredHeight;
    const top = columnTop[shortest];
    boxes.push({
      left: padding + shortest * (cardWidth + gap),
      top,
      width: cardWidth,
      height,
    });
    columnTop[shortest] = top + height + gap;
  }

  return { ...layoutPlan(bandsOf(boxes, padding), { gap: 0, padding }), boxes };
}

/**
 * The bands a set of staggered cards makes, and what each one holds.
 *
 * One band per distinct card top, running to the next: every card therefore
 * starts on a boundary, which is what lets `rowOfCard` answer the reveal with
 * the band that brings the card's own top on screen. A card spans as many bands
 * as it is tall, and is listed in each of them, because a window that mounted
 * only the cards *starting* inside it would leave a hole where a tall card was
 * still on screen.
 *
 * Heights carry their own spacing, so the plan above is stacked with no gap: the
 * offsets here are already the absolute ones the boxes were computed at.
 */
function bandsOf(boxes: readonly PlannedBox[], padding: number): RowOfCards[] {
  if (boxes.length === 0) return [];

  // Compared exactly, because the tops are sums of the same terms in the same
  // order and two columns that agree agree to the bit. Two that disagree by a
  // rounding epsilon cost one extra band a fraction of a pixel tall, which the
  // window reads and nothing else notices — rounding them into agreement would
  // be the worse trade, since the boxes are drawn at the unrounded numbers and a
  // band edge that no card starts on is the thing `rowOfCard` relies on.
  const tops = [...new Set(boxes.map((box) => box.top))].sort((a, b) => a - b);
  const bottom = boxes.reduce(
    (lowest, box) => Math.max(lowest, box.top + box.height),
    padding,
  );
  const edges = [...tops, bottom];

  const bands: RowOfCards[] = [];
  // The cards still open as the sweep comes down the page, and the next one to
  // open. A column's cards never overlap, so `open` holds at most one card per
  // column however tall any of them is — which is what keeps this a pass over
  // the bands rather than a search of the list per band.
  //
  // Greedy shortest-column hands the cards over in order of their tops, because
  // placing a card only ever makes a column taller; so the list is walked once,
  // forwards, and `cards` comes out in list order.
  let next = 0;
  let open: number[] = [];
  for (let at = 0; at + 1 < edges.length; at++) {
    const top = edges[at];
    const bandBottom = edges[at + 1];
    open = open.filter((card) => boxes[card].top + boxes[card].height > top);
    while (next < boxes.length && boxes[next].top < bandBottom) {
      open.push(next);
      next++;
    }
    bands.push({ cards: [...open], height: bandBottom - top });
  }
  return bands;
}

/**
 * The slice of a plan a host mounts, and the empty space that holds the rest of
 * the scroll height open around it.
 *
 * `before` and `after` are pixels and they arrive as padding on the grid
 * container rather than as spacers above and below it: the container is a CSS
 * grid, and a spacer inside one is a cell that takes a column. Both are read off
 * the plan's own offsets, so the space above the first mounted row is exactly
 * the space that row's cards would have had.
 */
export interface PlannedWindow {
  /** The cards to draw, as positions in the whole list, in drawing order. */
  cards: number[];
  /** The scroll height above the first mounted row, leading padding included. */
  before: number;
  /** The scroll height below the last, trailing padding included. */
  after: number;
}

/**
 * A window over no rows at all: what an empty plan mounts, and what a host shows
 * while the virtualiser has not reported a row yet.
 *
 * One object for the life of the module rather than a literal per read, because
 * a host may hold it across renders.
 */
export const NOTHING_MOUNTED: PlannedWindow = {
  cards: [],
  before: 0,
  after: 0,
};

/**
 * The window a run of rows makes, from the first row to mount to the last.
 *
 * Both ends inclusive, the way a virtualiser reports the items it wants. Rows
 * outside the plan are clamped into it rather than refused, because the row
 * count moves the moment the list does and a virtualiser reporting against the
 * count it last saw is ordinary.
 *
 * A card in two of the rows asked for is mounted once, in list order. Rows that
 * hold runs cannot produce one; masonry's bands routinely do, because a card
 * taller than a band is listed in every band it crosses — and a card mounted
 * twice would be two nodes claiming one cell index.
 */
export function windowOf(
  plan: LayoutPlan,
  firstRow: number,
  lastRow: number,
): PlannedWindow {
  if (plan.rows.length === 0) return NOTHING_MOUNTED;
  const last = Math.min(lastRow, plan.rows.length - 1);
  const first = Math.max(0, Math.min(firstRow, last));
  if (last < first) return NOTHING_MOUNTED;

  const mounted = plan.rows.slice(first, last + 1);
  const drawn = new Set<number>();
  for (const row of mounted) for (const card of row.cards) drawn.add(card);
  const cards = [...drawn].sort((a, b) => a - b);
  const bottom = mounted[mounted.length - 1];
  return {
    cards,
    before: mounted[0].top,
    after: plan.total - (bottom.top + bottom.height),
  };
}
