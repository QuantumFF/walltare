# ADR 0046: The Evaluated threshold is the curator's, which makes Evaluated a domain change rather than a preference

**Status:** Accepted
**Ticket:** [#260](https://github.com/QuantumFF/walltare/issues/260)
**Date:** 2026-09-17

## Context

`CONTEXT.md` has defined **Evaluated** as a fact about a wallpaper: its rating is
confident enough to trust, meaning σ below 4.0. That number appeared twice, as a
literal in `voting.rs`'s count and as `EVALUATED_SIGMA` in `copy.ts`, and nothing
in the app could move it.

[#255](https://github.com/QuantumFF/walltare/issues/255) asks for it to be a
setting, because how many Comparisons make a Score trustworthy is a judgement the
app has no standing to make on the curator's behalf. A curator ranking two
hundred wallpapers over a weekend and one ranking five thousand over a year want
different answers, and 4.0 is a defensible default rather than a discovered
truth.

The question this ADR settles is not whether to store a number. It is what
happens to a word in the glossary when the number behind it becomes the curator's
— and where the number lives so that the two things that read it cannot come to
disagree.

**Two readers, one answer.** The Rank headline prints `n / m Evaluated` off
`voting.rs`'s `SELECT COUNT(*) … WHERE rating_sigma < 4.0`. Every Score badge in
the Library, in Review, on the strip's hero and in the Lightbox goes solid off
`copy.ts`'s `isEvaluated`. These are the same claim about the same rows made on
two sides of the IPC, and the epic's own user story is that they move together.

## Decision

### Evaluated is a threshold the curator sets, not a fact about a wallpaper

`CONTEXT.md` gains an **Evaluated threshold** entry alongside the Screen and the
Minimum resolution, and is worded the way those two are: a stated preference, not
a fact about the library. Evaluated keeps its own entry and its own meaning —
"confident enough to trust" — and stops naming a constant while doing so.

This is the change that made the ticket a domain change rather than a checkbox.
Every other setting in this epic decides what the app *shows*: which layout, what
counts as undersized, how long a Review pass is. This one decides what a word in
the glossary *means*. A reader who knows that Evaluated is σ below 4.0 and reads
a screen saying 61 wallpapers are Evaluated is entitled to work out which 61;
after this change they cannot, unless the glossary says the number came from the
curator.

It is a domain change for a second reason. Evaluated is the only term in
`CONTEXT.md` whose truth can now change without the library changing. A wallpaper
can become Evaluated while nobody voted on it, because somebody moved a
radio button — and anything that reasons about Evaluated has to survive that.

### The setting holds the σ, and the σ crosses the IPC

The stored value is the number itself, `4`, not a name for it. Both readers want
a σ: the backend puts it in a `WHERE` clause and the frontend compares it against
a row's `rating_sigma`. A name — `balanced` — would have to be resolved to 4.0
in `settings.rs` *and* in `client.ts`, which is two copies of three numbers, in
two languages, that nothing checks against each other. That is precisely the
duplication this epic already refused when it insisted on
[one Screen setting and not two](../../CONTEXT.md).

So `Settings` carries `evaluated_threshold: f64` and it serialises as a JSON
number. `Settings` drops its `Eq` derive to hold it, which is the only cost.

### Three named confidences, chosen from a radio group

The Settings page offers **Lenient** (σ 5.0), **Balanced** (σ 4.0) and **Strict**
(σ 3.0), and `settings.rs` refuses everything else, exactly as it refuses a
theme that is not one of three.

σ is the app's own uncertainty scale. It has no unit, the page has no room to
teach one, and a curator typing `6.5` into a box is guessing — so the control
names the trade-off it makes and not the number it stores. This is the rule
[#255](https://github.com/QuantumFF/walltare/issues/255) already set for the
Review worklist size, which is presets of 10, 25, 50 and 100 rather than a free
number, for the same reason.

The σ is not printed on the page at all. A curator who knows what 4.0 means
already knows what the three words mean, and one who does not would be reading a
number with no unit and no range beside it.

Refusing an off-list value on write, rather than accepting any positive σ, is
what keeps the control able to show the curator what they chose. A stored `4.2`
would be a confidence with no radio button to press and no way back to the
default except by guessing.

### The count reads the row, and it reads it in `voting.rs`

`voting::get_stats` calls `settings::evaluated_threshold(conn)` and counts
against the answer. The threshold is not a parameter threaded down from the
command layer, which would have meant `vote` — which takes its own stats snapshot
after committing — carrying a number it has nothing to do with, and two callers
who could be handed two different thresholds.

`settings::evaluated_threshold` reads the one key through the same `stored`, the
same `read` and the same default constant `resolve` uses, so the number the count
uses and the number on the struct the card compares against come from one place.
It exists as a narrow reader rather than a `settings::get` call because `get`
needs a `Detected` — the monitor the platform reported — and the count has no
business knowing what monitor is plugged in.

### The card is handed the number, not the verdict

`WallpaperCard` takes `evaluatedThreshold?: number` and makes the comparison
itself. The undersized badge next to it works the other way — the grid resolves
`isUndersized` per card and hands down a boolean — and the difference is
deliberate: `minimumResolution` is an object, and a card given one would have
props that move whenever the settings struct is replaced, whatever key was
actually written, which defeats the memo
[#229](https://github.com/QuantumFF/walltare/issues/229) and
[#230](https://github.com/QuantumFF/walltare/issues/230) built. A threshold is a
value. Nothing is gained by resolving it a step earlier, and the card that has
the number needs no second prop when the comparison changes.

The default on that prop is `DEFAULT_EVALUATED_THRESHOLD`, so a card mounted
outside the app's settings reads as the curator who has not moved it — the right
answer for most of them, and the only one available without a store.

The Lightbox reads the store directly instead. It is a second rendering of the
selection rather than a child of either grid
([ADR 0022](0022-lightbox-shares-the-selection.md)), so a prop would have to be
threaded through both pages to reach it.

## Alternatives rejected

**A free number field.** Honest about what is stored and useless to read. It
would also make "write the default back to reset" — the only reset the settings
store has ([ADR 0010](0010-settings-store.md)) — a thing the curator has to be
told the value of, since there would be no chosen-looking control to press.

**Storing a name and mapping it to a σ on each side.** Reads better in the
column and puts the same three numbers in two languages with nothing holding them
level. The failure is silent and is exactly the failure this ticket exists to
prevent: the headline counting against one number and the badges drawn against
another.

**Sending both the name and the resolved σ across the IPC.** Removes the
duplication and adds a second field for one fact, which is the shape
`detected_screen` has and earns by being a readout of something the frontend
cannot otherwise know. A name the frontend never renders is not that.

**Deriving the threshold from a target number of Comparisons.** The curator's
question really is "how many Comparisons make a Score trustworthy", so a setting
spelled in Comparisons would be the plainest possible control. There is no honest
mapping. σ falls at a rate that depends on who a wallpaper was compared against
and whether it won, so any number of Comparisons printed beside a threshold would
be a figure for one scenario presented as a fact. The control names the
trade-off instead and claims no count.

**Keeping `EVALUATED_SIGMA` in `copy.ts` as the frontend's copy.** It was
already a second copy of `voting.rs`'s literal and got away with it because
neither could move. Once one of them can, a constant that does not is a bug
waiting for its first curator.

**Recomputing `evaluated_count` on the frontend from the rows it holds.** It
would make disagreement impossible by having one reader. The Library holds every
row, but the count is over the eligible pool and Review holds fifty of them, so
the page that prints the headline — Rank — holds neither. The count stays the
backend's.

## Consequences

**A number in the Rank headline now moves without a vote.** `get_stats` is
re-fetched on the events that already trigger it; a curator who changes the
threshold while looking at Rank sees the count move on the next fetch rather than
instantly. Every badge moves immediately, because `set_setting` answers with the
whole struct and the pages read it from `AppContext`.

**`Settings` is no longer `Eq`.** Nothing compared two of them for equality in a
way `PartialEq` does not serve, and the tests that assert a whole struct still
read the same.

**The Evaluated count and the badges agree by construction and are tested for it
separately.** `voting.rs` pins that the count moves with the row, and
`LibraryView.test.tsx` pins which cards draw solid at each of the three
thresholds. Neither test can catch the two drifting apart on its own; what
prevents that is the single stored σ, which both sides compare against without
transforming.

**A hand-edited row reads as the default, silently but for a log line.** That is
the module's existing rule for a value it cannot parse, and it now also catches a
σ that is off the list — including one a future version of the app might offer.
A downgrade that meets a threshold it does not know counts against 4.0 rather
than refusing to boot.
