# ADR 0043: A patch to a hidden view costs a millisecond, and nobody chases it

**Status:** Accepted
**Ticket:** [#233](https://github.com/QuantumFF/walltare/issues/233)
**Date:** 2026-09-10

## Context

[ADR 0015](0015-navigation-shell.md) keeps Rank, Review and Library mounted, so
while the curator votes, Library sits under `display: none` with its rows fetched
and its window mounted. It also says a patch "costs nothing", and nothing had
ever checked. [#233](https://github.com/QuantumFF/walltare/issues/233) is the
check, and it is the last child of
[#224](https://github.com/QuantumFF/walltare/issues/224).

The ticket wrote its own branch and its own bar. Under 4ms — a quarter of a 16ms
frame, spent once per vote, on a view nobody is looking at — it closes `wontfix`
with the number kept. At or above 4ms, a card subscribes to its own Wallpaper and
its own score-moved flag through the publication
[ADR 0042](0042-the-grid-owns-the-cursor.md) built, so a one-row fact costs one
card render instead of thirty-five.

The premise it was written from: every `score-changed` allocates a fresh `Set` and
re-renders roughly thirty-five cards that will not paint, and every
`status-changed` replaces the row array on both pages. That premise was true when
#224 was written. Half of it stopped being true four days later, and the
measurement is how that turned up.

## The harness

React's `<Profiler>`, `actualDuration` summed over every commit of the profiled
subtree between one published event and the next. React 19.2.8's development
build under Bun 1.3.14 and happy-dom, on an AMD Ryzen 5 7600X. Two arrangements:

**The isolated event.** `LibraryView` or `ReviewView` rendered in the app's real
providers with `view` on Rank, so the page is mounted and not showing, which is
the arrangement ADR 0015 produces. 2,000 Active Wallpapers, four columns, the
scroll box given a browser's layout — 800px of viewport over 400,000px of
content, the same arrangement `render-scope.test.tsx` makes — and scrolled 20,000px
in so the window sits in the middle of the list. **36 cards mounted**, against the
32 [ADR 0041](0041-the-library-grid-pays-for-the-mount.md) measured in a 1269x1388
window. Then `score-changed` or `status-changed` on the bus, 200 events after 20
discarded.

**The whole vote.** `<App />` itself, the Library tab clicked and scrolled and
Rank clicked back, then a real vote — a click on a pane, the 300ms pick feedback,
the `vote` command answering with the next pair and the new `Stats`, and the
`score-changed` and `stats-changed` that
[`RankView`](../../src/components/RankView.tsx) publishes. Thirty votes after ten
discarded. The control is the same thirty votes with the Library tab never
clicked, so the page is not in the tree at all; **the difference between the two
is the hidden Library's share of a vote**, which is the thing #233 asked for.

Card renders are counted the way `render-scope.test.tsx` counts them, off
`__reactProps$` on each cell.

### What this is and is not

It is React reconciliation, on the same thread as the pick, which is what #233
named as the cost and the only thing that changes if a card subscribes to its own
row. It is **not** ADR 0041's harness: no compositor, no style recalculation, no
layout, no frame times. happy-dom has none of those and a number from it must not
be read as one.

Which way the error runs, since the verdict turns on a threshold:

- **The development build overstates.** React's development build carries the
  checks and the profiler bookkeeping a production build drops. This number is
  the slower of the two by some multiple nobody here measured.
- **happy-dom understates, and barely.** A real DOM write costs more than
  happy-dom's. But in the shipped configuration `score-changed` writes no DOM at
  all — no card re-renders, see below — and `status-changed` writes one card's
  subtree. There is almost no DOM half to understate.
- **The engine is the same family.** Bun and WebKitGTK both run JavaScriptCore.
- **The machine is a fast desktop.** A slower one costs more, in the same
  proportion for every row of every table here.

The two large errors point opposite ways and neither is quantified, so the
absolute number carries a wide band. Every comparison below is between two
configurations measured the same way, which is where this run's evidence
actually is.

### Repeatability

Three runs of the whole file, same process warmth. The `score-changed` medians
land at 0.469, 0.517 and 0.518ms, a spread of 10%. The whole-vote difference
lands at 0.93, 0.94 and 0.87ms, a spread of 8%. **That is this measurement's
resolution**, and every effect claimed below is several times it.

Running the two vote tests alone, in a colder process, moves both sides up
together and the difference with them: 1.05, 1.06 and 1.08ms. So the reported
difference is 0.87 to 1.08ms depending on how warm the process is, and the
comparison inside a run is the part that holds.

## Decision

### The number is about one millisecond, and #233 closes `wontfix`

What a whole vote costs, with and without the hidden Library behind it, in
`actualDuration` over the three commits a vote produces:

| configuration | commits a vote | median | p90 |
| --- | --- | --- | --- |
| Library never visited | 3 | 0.724 / 0.727 / 0.763ms | 0.87ms |
| Library mounted and hidden, 2,000 rows, 36 cards | 3 | 1.649 / 1.668 / 1.636ms | 1.86ms |
| **the hidden Library's share** | | **0.93 / 0.94 / 0.87ms** | |

And the two events on their own, published straight onto the bus:

| event | page | cards mounted | cards re-rendered | median | p90 |
| --- | --- | --- | --- | --- | --- |
| `score-changed` | Library, hidden | 36 | **0** | 0.50ms | 0.71ms |
| `status-changed` | Library, hidden | 36 | **1** | 0.55ms | 0.73ms |
| `status-changed` | Review, hidden | 50 | **1** | 0.20ms | 0.26ms |

**One millisecond against a bar of four**, or 6% of a 16ms frame, once per vote.
The ticket's condition is met with room to spare and the change is not made.

Two of the three commits a vote produces are not the patch at all. The vote's
answer lands in one commit carrying both `score-changed` and `stats-changed`, and
that is where the difference is: 1.23 to 1.31ms with the Library mounted against
0.36 to 0.45ms without. The hidden page is reached from above in that commit as
well as from its own subscription, which matters for what the change would have
bought and is dealt with below.

### The premise had already been half retired, by #230

"Roughly thirty five cards that will not paint" was the ticket's reason for
existing. **Zero of the 36 mounted cards re-render on a `score-changed`.** Over
200 events, counted card by card: none.

ADR 0042 wrapped `WallpaperCard` in `React.memo` and
[#229](https://github.com/QuantumFF/walltare/issues/229) made every prop it takes
a value or a stable identity. `scoresMoved?.has(wallpaper.id)` is a boolean, and
for every card the Comparison did not name it is `false` before and `false`
after. The fresh `Set` the page allocates never reaches a card as an identity —
the grid reads it and hands each card the answer. So the allocation still happens
and costs what allocating a `Set` of a few hundred numbers costs, and the
thirty-five renders it was allocated for stopped happening one ticket ago.

`status-changed` is the same shape with one row moved: the array is replaced, the
memo holds for every card whose Wallpaper object came through unchanged, and the
one card whose row was rewritten re-renders. One card, on each page, which is the
smallest number a patch that changes a row can cost.

### The control, which is what makes the rest readable

The same five measurements with the card's memo defeated — `memo(Card, () =>
false)`, so every mounted card re-renders on every commit. This is the
configuration #233 describes, and it is the effect a per-card subscription would
have to remove:

| measurement | shipped | memo never holds |
| --- | --- | --- |
| `score-changed`, Library hidden | 0.50ms, 0 card renders | **2.41 / 2.85ms**, 36 card renders |
| `status-changed`, Library hidden | 0.55ms, 1 | **2.09 / 1.93ms**, 36 |
| `status-changed`, Review hidden | 0.20ms, 1 | **2.20 / 2.24ms**, 50 |
| a whole vote, Library hidden | 1.65ms | **4.53 / 3.93ms** |
| the hidden Library's share of a vote | 0.93ms | **3.75 / 3.10ms** |

**Four times the effect, against a resolution of 8 to 10%.** The harness resolves
what it was pointed at, which is the thing a null result has to establish before
it means anything.

It also says what #233 would have measured had it run against the code as #224
found it: 3.1 to 3.8ms, which is not under the bar by much and not over it
either. The ticket was a reasonable thing to schedule. #230 answered it on the
way past, and the memo it landed for the arrow key is what pays for the vote.

### What the change would have bought, and what it could not

The ceiling of the saving is the 0.93ms above, and the real saving is less than
that, because a per-card subscription does not reach two of the three commits. A
vote publishes `stats-changed` as well, the shell re-renders on it, and a page
below a shell that re-renders is a page that re-renders — `LibraryView`,
`WallpaperGrid`, `WindowedGrid`, `Grid`, and 36 memo comparisons — whatever the
cards are subscribed to. Moving the row and the flag onto the publication takes
away the `score-changed` commit's share of the work and leaves the other two
alone.

So the honest ceiling is under a millisecond, and the honest estimate is a
fraction of that, against two more facts on a publication, two more subscriptions
per card, a card that cannot be rendered outside a grid, and a test to pin it.
ADR 0042 rejected per-card subscriptions for the cursor on a version of that
trade where the payoff was 110 dropped frames. Here there is no payoff to weigh.

### Said plainly, so the next review does not re-suggest it

**A vote costs the hidden Library page about a millisecond of React
reconciliation on a 2,000 wallpaper library, and that is not worth a change.**
Not "probably fine", not "hard to say without measuring". It was measured, on the
arrangement ADR 0015 actually produces, with a control four times the size of the
effect and a resolution an order of magnitude under it. The next architecture
review that reads `setScoresMoved(new Set())` beside a mounted grid of 2,000 rows
and reaches for the same suggestion should read this table instead.

The thing that makes it cheap is named, because it is the thing that could be
taken away: the card's memo and the four stable prop identities under it. Those
are already load-bearing for ADR 0042's arrow key, which is what makes them
likely to survive; this ADR is a second reason and not a new one.

## What this does not touch

**The score-moved highlight and the status transitions.** No code ships from
#233. The badge reads `Score moved` on exactly the rows it did before, the four
transitions patch the rows they did before, and every test that pinned either is
untouched.

**ADR 0042's publication.** `WallpaperGridHandle` keeps `subscribe` and
`selection` and gains nothing. The eight exported names in `WallpaperGrid.tsx`
stay eight.

**ADR 0007's `will-change`**, still scoped to `REVIEW_LIMIT`; the library card
still animates nothing; `overscan` is still 1. ADR 0041 has the numbers behind
all three and nothing here moves them.

**Whether a hidden view should stay mounted at all.** ADR 0040 changed what a
remount costs without changing ADR 0015's decision, and ADR 0041 recorded that
the question was written down for nobody to act on inside #224. This ADR prices
what a *mounted* hidden view costs per vote and takes that question no further.
The two numbers do sit next to each other now, for whoever picks it up.

**`CONTEXT.md`.** Nothing here is domain vocabulary. Same call ADRs 0015, 0027,
0029 and 0042 made about UI plumbing.

## Alternatives rejected

**Extending #230's publication anyway, because it is cheap to do.** It is two
more facts through machinery that exists, which is exactly why #233 scheduled it
as the at-or-above branch. It is still an interface change, two subscriptions per
card, and a rule that a card needs a grid around it, bought with a saving under a
millisecond per vote that this ADR has now bounded from above. #224's whole
premise is that this codebase stops making changes on assumed payoffs, and
spending the measurement and then making the change anyway would be the ADR 0016
mistake with a number attached to it.

**Running ADR 0041's WebKitGTK harness before deciding.** It is the better
instrument and it prices the wrong thing. What #233 asked about is reconciliation
on the vote's thread, which a frame counter reports only after it has crossed a
frame budget; the arrow-key variant that settled #230 needed 110 dropped frames
in ten seconds before it separated from an idle control that recorded zero. One
millisecond every few seconds does not reach that instrument. It would also cost
a rebuilt probe, a scratch library of 2,000 JPEGs and a fresh process per variant
— ADR 0041 records what that run took — to confirm a result that is four times
under its own bar with a four-times control beside it. **Worth doing if a curator
ever reports a vote feeling slow**, which is the same trigger ADR 0016 wrote its
plan for.

**Measuring in a production build to get the truer number.** React's `<Profiler>`
reports nothing without the development build's instrumentation, so this would
mean timing `act()` by hand around a commit and measuring the harness along with
it. The development build is the slower side, which makes the recorded number an
overstatement in the direction that matters for a threshold.

**Unmounting Library while it is hidden, since this measured what keeping it
costs.** Out of scope for #224 by name, and this measurement is an argument
against reopening rather than for it: a millisecond a vote is not what would
justify undoing ADR 0015's data, DOM, scroll position and image work.

**Skipping the patch while the view is hidden and refetching on the way back.**
It trades a millisecond of reconciliation for a fetch of 2,000 rows on every tab
switch, and it is the shape ADR 0015 already refused when it chose four events
over a cache. `useRefetchWhenShown` exists for the one event that genuinely
changes which rows exist, and this would put the other three through it for no
reason.

**Shipping the harness as a test.** It is a stopwatch, and a stopwatch in a suite
that runs on every commit is a flake waiting for a loaded CI runner. #224 said
the same about ADR 0041's run: a recorded measurement, not a gate. What is pinned
in the suite is the render *count*, in `render-scope.test.tsx`, which is the
property this number depends on and the one that can be lost by a code change
rather than by a busy machine.

## Consequences

**ADR 0015's "a patch costs nothing" is now a number.** About one millisecond per
vote for a hidden 2,000-row Library, and about a fifth of that for a hidden
Review of fifty. The amendment is recorded there.

**#233 closes `wontfix` and #224 loses its last open child.** The epic ends with
the measurement it opened with, which was the point of putting it last.

**The harness does not survive, and this ADR is what it leaves behind.** It was
one file under `tests/` that printed numbers and asserted nothing, and it is not
on the branch that carries this. Re-running means rebuilding it; the description
above is what it owes its successor. The two arrangements are the whole of it —
the page in the real providers with the view on Rank, and `<App />` with a real
vote against a control that never mounted Library.

**One property this number depends on is already pinned, and one is not.** The
card's memo and its four prop identities are pinned by
`render-scope.test.tsx` and `prop-identities.test.tsx`, and ADR 0042 already
records that a fifth prop built during the grid's render would silently undo
them. The 36-card window is not pinned to anything, but it is a consequence of
`overscan: 1` and the grid's own arithmetic, and it would have to grow by a
factor of four before this verdict came back into question.

**What would reopen this.** A card that stops memoising, a library well past
2,000, or a curator reporting a vote that feels slow. The first is a code change
and the tests above would say so; the second and third are what ADR 0041's
harness is for, and the arrow-key amendment there is the template for the
variant that would price it.
