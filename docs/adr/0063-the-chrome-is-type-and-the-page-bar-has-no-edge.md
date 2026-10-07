# ADR 0063: The chrome is type, and the page bar has no edge

**Status:** Accepted
**Amends:** [ADR 0015](0015-navigation-shell.md)'s chrome row, as drawn
**Date:** 2026-10-08

## Context

ADR 0015 fixed what the header does: one chrome row on every view, and under it
a bar each page owns, the same height everywhere, so nothing jumps on a switch.
It said nothing about how either is drawn. The shipped look had accreted:

- **The chrome** had a wordmark on the left, the four tabs centred, and the
  gear on the right. The current tab was a `secondary` fill. That fill replaced
  a 2px underline that could not be read from across the room, and the
  comment beside it kept the fill rather than the page bars' segmented track
  for "the one row that navigates".
- **The page bar** was an `h-11` strip with a bottom rule. The rule was the one
  drawn edge between the header and the page. The title was medium-weight text,
  the filters were segmented tracks with `rounded-lg` corners, and the other
  buttons were the default rounded rectangle.

A throwaway prototype on `QuantumFF/topbar-styling-prototype` (b629811) set six
chromes and six page bars side by side, switchable live. The curator picked
chrome **F** with page bar **F4**.

## Decision

### The chrome is a centred cluster of words

The icon, the four tabs, a hairline and the gear sit together in the middle of
the row, `h-12` as before. Nothing boxes them in: no pill, no border, no fill
and no shadow.

The tabs are the view names set as type, 17px semibold. The current view is
the one word in the foreground colour, and the others are muted at 45%, coming
up to full muted on hover. No tab draws a fill in any state. The underline
failed at reading which view was up at a glance, and that is the whole job of
the control. A fill answered it by boxing one word, and the size and contrast
answer it with nothing drawn. #44's ruling still holds: a word in the
foreground colour does not assert itself the way a primary button does.

The gear keeps everything ADR 0015 and ADR 0020 gave it, its `secondary` fill
on Settings included. It is the one shape in the row, which is how it reads as
"you are on the page no tab names". The hairline before it says the same thing
to an eye that has not opened it yet.

There is no wordmark. The icon's alternative text is the app's name, so the
banner still names the window to a screen reader. The window title names it to
the window manager.

The whole empty row is still the title bar, and so is every gap in the cluster
and the hairline. The icon is draggable as the wordmark was. The tabs and the
gear are not.

### The page bar has no surface and no rule

The bar is `h-12`, the chrome's height, with no fill and no bottom border. What
sets it off from the page is what sits on it:

- **The title is a chip.** It is a `bg-muted` pill around Rank's Undecided
  headline and Review's ordering sentence. It is a component, `PageBarTitle`,
  rather than a style on whatever the bar's first child is, so a page says
  which element is its title. Library and Discover have none, since their bars
  open on a control. Settings' heading is plain semibold text: the prototype
  chipped it too, and the curator had the chip taken off once it was on screen.
  Those two titles are a count and a sentence about what the page holds;
  Settings' is only the page's name.
- **Every control is a pill.** The segmented track and its segments are pills
  everywhere they are drawn. Settings' radio groups, Appearance and the rest,
  are included, though they sit outside any bar, because the older rule is that a
  choice between options looks like the same kind of thing on every page. Any
  other button or drop-down in a bar takes `pageBarPill` where the page writes
  it: `rounded-full` and the track's 32px. At `size="sm"` a lone control was
  28px against the tracks' 32, and Library's bar, which has the most of them,
  read a size smaller than Rank's.

Discover's collapsed header is that page's bar, so it follows: `h-12`, no rule,
and its pills grow from 28px to `pageBarPill`'s 32. The bar's height lives in
`PageBar.tsx` as both the class (`pageBarHeight`) and the number
(`PAGE_BAR_HEIGHT_PX`), side by side, and `useCollapsingHeader`'s strip height
reads the number instead of keeping its own 44.

## Considered options

**The other five chromes.** A filled pill holding the whole cluster (B) put back
the box this decision takes away. An accent underline with the brand on the left
(C) is the underline that already failed, in colour. Counts riding on the tabs
(D) put Rank's headline in two places. Type on the left with the wordmark beside
the gear (E) is F's type with the cluster split across the row. The curator
compared them side by side and picked F.

**The other page bars under F.** A toolbar with a small-caps label (F's own
pairing, from D) shrank the title that the chip makes legible. A bar centred
under the cluster (F1) would move every page's controls whenever its title
changed length, which Rank's headline does as the curator votes. A hanging
sheet (F2), a shadowed shelf (F3) and a gradient wash (F5) each drew the edge
again by other means.

**Styling the bar's children from `PageBar`.** The prototype rounded the first
`span` or `h1` and every `button` underneath with descendant selectors. That
guesses the title from document order, and it rounds whatever a page puts in
the bar, including a trigger it meant to be square. The chip is a component and
the pills are the controls' own, so both are written where they are used.

**Pills only inside the bar.** This would keep Settings' radios as rounded
rectangles. A filter and a radio would then look like two kinds of thing, which
is what `SegmentedGroup` exists to prevent.

## Consequences

**`SelectTrigger`'s small corner comes from its `size` prop** rather than a
`data-[size=sm]:` utility. That utility outranked a caller's `rounded-full` on
specificity, so Discover's Ratio pill asked for a pill and drew 8px corners.
Library's ordering drop-down would have done the same.

**The test for the active tab changes.** It asserted the `bg-secondary` fill.
Now it asserts the foreground colour on the current tab, the faded one on the
others, and no fill on any of them.

**Settings' section nav loses its rule too.** It is not a page bar, but it
sits directly under one and sticks there, so its line was the one drawn edge
left in Settings' header. Its translucent ground parts it from the sections
scrolling under it.

**Rank's "nothing left to decide" row keeps its rule.** It is a row in the
page under the bar, and the edge there separates content from content rather
than header from page.
