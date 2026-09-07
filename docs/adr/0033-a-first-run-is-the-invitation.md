# ADR 0033: A first run is the invitation, and the rest of Settings waits

**Status:** Accepted
**Ticket:** [#201](https://github.com/QuantumFF/walltare/issues/201),
[#195](https://github.com/QuantumFF/walltare/issues/195)
**Date:** 2026-09-08

## Context

The routing was already right. [ADR 0015](0015-navigation-shell.md)'s boot rule
lands an empty library on Settings, which is the one screen where the only
useful action lives, and lands a `get_stats` that failed there too with a
different account of why. What was never checked is whether the screen the
curator arrives at says any of that.

It does not, quite. [ADR 0020](0020-settings-page.md) gave the two landings a
slot above the page — a heading, a sentence, and the field focused — and then
left the whole of Settings standing underneath it. Somebody opening walltare for
the first time reads "No wallpapers yet. Choose a library root and scan it to
start ranking", and then reads a reject destination, a theme, a thumbnail cache
and a count of missing files. Four sections about a library they do not have yet.

Two things are wrong with that, and only one of them is layout.

- **Nothing on the page says what the app is.** Epic
  [#195](https://github.com/QuantumFF/walltare/issues/195) ships this to
  strangers, and its user story 10 is somebody who wants to land on a screen
  that asks for a folder "so that I know what to do before I know what the app
  is". The existing sentence says what to do and never says why: a wallpaper app
  asking for a folder reads as an app that is about to set a wallpaper, which is
  the one thing this app does not do.
- **The instruction competes with four sections of settings.** ADR 0020 put them
  in first-run order precisely so the needed one is first. Order is what a page
  can do about priority when everything on it is equally about to be used; it is
  not what a page does when three quarters of it is about nothing yet.

ADR 0020 considered exactly this and refused it:

> **Hiding the other three sections on a first run.** Focuses the one thing that
> matters. It also produces a page that grows sections after a scan, and
> ADR 0015 already refused to hide destinations for being empty.

Both halves of that read differently now that the page is built and the boot
rule with it. ADR 0015's refusal was about **tabs** — a destination the curator
cannot reach is a dead end that explains nothing — and nothing here becomes
unreachable: Settings is one gear press away, with all five sections in it, from
the moment there is a library. And the page does not grow sections under
anybody's eye, for the reason set out below.

## Decision

### The block leads, and it names what walltare is for

Two paragraphs under a heading that is the ask rather than the state:

> **Choose a Library root**
>
> walltare ranks the wallpapers you already have by showing you two at a time
> and asking which you prefer.
>
> The Library root is the folder it scans to find them.

The heading is the imperative, because the one thing this curator has to do is
the thing the page should lead with, and "No wallpapers yet" leads with a state
they can already see.

The first line is the whole of the onboarding. One sentence, saying what the app
does to the wallpapers the curator **already has** — which is the half that
answers "why does this want a folder" — and naming the Comparison the app is
built around without using the word. Nothing about Scores, Rounds, Review or soft
rejects: those are what the app teaches by being used, and a paragraph of them
here is a wizard page with no Next button.

The second line is `CONTEXT.md`'s own definition of the Library root, said where
the term is first met. Every other place the term appears — the heading below,
the field label, the button — uses it as though it were known, and this is the
one screen where it certainly is not. Teaching the glossary is the alternative to
swapping in "folder", which is what
[ADR 0017](0017-one-toast-at-a-time.md)'s speak-the-glossary rule and ADR 0020's
own correction of "Library folder" both rule out.

### The Library root section is the only section a boot landing shows

The Reject destination, Appearance, Thumbnails and Missing files sections are
withheld while a boot notice stands. The Library root section is not, because it
is the field and the button the block is pointing at.

What the four have in common is not that they are unimportant; it is that each is
a question about wallpapers the app has not found yet. A destination for rejects
that cannot happen, a cache of thumbnails of nothing, a count of missing files
out of an Eligible pool of zero. Appearance is the one that is answerable, and it
is a preference nobody came here to set: a curator who wants a dark window will
find it, one gear press away, for the rest of the app's life.

Order never changes across the two shapes. The Library root is first on the
landing and first on the ordinary page, so nothing the curator learned about
where the field is moves once they have a library.

### Both boot landings get that shape, and stay unalike

The failed-boot landing is withheld down to the same one section. A library the
app could not read is not a library the four maintenance sections can be about
either, and the curator has exactly one thing to do — the Retry in the block —
which is the same argument as the first run's, with a different single action.

ADR 0015's "the last two rows both open Settings and must not look alike" is
unaffected and is what the shared shape is measured against. A different heading,
a different colour, a `status` against an `alert`, an invitation against the
backend's own account of a fault, and a focused field against a button to press.
Making both landings one section deep does not make them one screen; it makes
them the same shape holding two different problems, which is what the slot always
was.

### A read that succeeds retires the notice

The page is a landing for exactly as long as `bootNotice` stands, and the notice
is boot's account of why there was nothing to show. So `readLibrary` clears an
`unreadable_library` notice when the read succeeds, and
`UnreadableLibraryBlock`'s local "cleared" flag is gone.

That flag was already the wrong shape and this makes it visible: it hid the block
while leaving the navigation record saying boot had failed. Under this ADR the
page reads that record, so a Retry that worked would have left the curator on a
recovered library with four sections still missing and nothing on screen
explaining it.

Only the fault is retired. `readLibrary` is also what follows every scan, and a
first-run notice is about what the library holds rather than about whether it
could be read — so clearing that one here would drop the invitation on a scan
that found nothing, which is exactly the moment it is still true.

The state is read off the notice rather than off `libraryTotal === 0` for the
same reason ADR 0020 gave the slot: a curator who left and came back through the
gear is not on a first run any more. The notice already rides on the navigation
record so that it lives exactly as long as the landing that produced it, and the
withheld sections inherit that for free.

### Nothing else changes

No wizard, no step count, no persisted "has onboarded" flag, and no new command.
`CONTEXT.md` is untouched: every term this states is already in it. The copy is
the whole of the feature, and the mechanism is one boolean read off a notice that
already existed.

## Alternatives rejected

**ADR 0020's shape, with better copy in the block.** The cheapest fix, and it is
half of this one: the block would say what the app is for, above four sections
about nothing. What ADR 0020 was defending is a page that does not rearrange
itself, and the price it paid is that the first screen a stranger sees is three
quarters irrelevant. Copy alone cannot outrank four headings; that is what
withholding them is for.

**A wizard, or a multi-step first run.** Explicitly out of scope on #201, and it
would be wrong anyway: there is one thing to do, so a flow around it is a Next
button between the curator and a field that is already focused.

**Withholding only Thumbnails and Missing files**, on the grounds that those two
are the maintenance half and Appearance and the reject destination are settings a
curator might reasonably set up front. It keeps a first run at three sections
instead of one, which is the same problem quieter, and it draws the line at
"maintenance" when the line that matters is "about a library that does not exist
yet".

**Keeping "No wallpapers yet" as the heading.** It names the state, which is
honest, and it reads better in the one case where a first run persists — a scan
that found nothing leaves the curator here with the notice still up. That case is
already reported in full by the scan's own toast
([ADR 0021](0021-background-work-is-a-pinned-toast.md)), and "Choose a Library
root" is still the right advice for it: choose a different one.

**Leaving the failed-boot landing at five sections**, since nothing about a
database that will not open says the settings below are meaningless. It says
exactly that about four of them: the app cannot tell the curator how many files
are missing out of a pool it cannot count, and a cache size for a library it
cannot read is a number about nothing. It would also leave two boot landings with
two different page shapes for no reason a curator could read.

**Deriving the state from `libraryTotal === 0` rather than from the notice.**
Fewer moving parts, and it would cover a curator who emptied their library and
came back through the gear. It also puts a curator who came here on purpose, from
a library they know is empty, back on an onboarding screen they have read — and
it cannot cover the failed-boot landing at all, where the total is `null` because
no read succeeded.

**Putting the what-it-does line somewhere permanent**, like the page bar or an
About section. It is onboarding copy: it earns its place exactly once, and a
sentence explaining the app to somebody who has used it for a month is clutter
with a good reason behind it.

## Consequences

`SettingsView` renders one section or five, off one boolean. Both the count of
sections and the first-run copy are asserted in `SettingsView.test.tsx`, and the
three tests ADR 0032 moved when the page went from four sections to five moved
again here — which is the cost of counting sections in a test, and still cheaper
than not knowing which ones a landing shows.

A first run no longer walks the thumbnail cache directory on mount, because the
section that reads it is not there. That is `get_cache_size` off the boot path of
the one launch where the cache is certainly empty.

`NoticeBlock` stops being exported. Both blocks that wear it now live in
`SettingsNotices.tsx` and the page reaches them by name, so the copy for a
landing sits beside the landing it is for rather than being assembled from a tone
and a heading at the call site.

The onboarding copy is not covered by anything that reads it aloud. It is a
`status` region carrying two paragraphs, which is the same shape it had, and
whether a first-time curator with a screen reader hears the invitation before the
field takes focus is not something happy-dom can answer. It belongs on the
release checklist beside the content security policy and the NVIDIA launch path.
