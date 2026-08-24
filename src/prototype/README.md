# Prototype: the shell, the library grid, and the lightbox

Throwaway. For [#44](https://github.com/QuantumFF/walltare/issues/44), on the
`prototype/shell-library-lightbox` branch, and it is not going to main.

Three variants of the whole surface, switchable in the browser. No IPC and no
Tauri: `src/lib/client.ts` is the only module allowed near `invoke`, and a
prototype has no business going through it.

## Running it

```sh
./src/prototype/gen-images.sh   # once, ~2 min, reads the live DB
bun run prototype               # opens http://localhost:5273/prototype.html
```

`gen-images.sh` resizes the real library into `public/proto-images/`
(gitignored, 28MB): 512px for cards and rows, 1600px for the lightbox. Without
it every image is a broken icon and nothing about density is judgeable.

## Driving it

The bar at the bottom is the harness, not the design. It is deliberately ugly.

| control | what it does |
| --- | --- |
| `alt+←` / `alt+→` | previous / next variant. Alt because the lightbox under test claims the bare arrows |
| `h` | hide the bar. It sits over variant A's caption bar |
| page | rank, review, library, settings |
| state | ready, loading, empty |
| dark / light | both themes, since the rank surround is fixed dark in both |

Every control is a URL parameter, so a link is a state:
`?variant=B&page=library&theme=light&state=ready&open=6`. `open=<n>` opens the
lightbox on the nth row of whatever list is showing.

Inside the app: click a card to open the lightbox, `←` `→` to move, `Esc` to
close. Variant B also walks the grid with arrow keys and opens on `Enter`.
Variant C's lightbox has `i` for details.

## The three variants

**A — Toolbar.** Chrome is one fixed row: brand, tabs, gear. Everything a page
needs sits in a second bar underneath that the page owns, so the chrome never
changes height. Pre-generation is a 2px seam across the full width. The grid is
the existing Review card at higher density, actions in a hover overlay. The
lightbox puts identity, numbers, and actions in one caption bar along the
bottom.

**B — Inspector.** The bet: a wallpaper's actions do not belong on the
wallpaper. Tiles carry nothing but the badge, and a 320px right-hand panel holds
the metadata and every action for whatever is selected. Arrow keys walk the
grid, `Enter` opens. This is the variant that answers the map's fog patch on
keyboard reachability structurally rather than by bolting focus states onto a
`group-hover` overlay. Round and Evaluated live in the chrome as chips, so Rank
needs no second bar. Settings is a sheet.

**C — List.** The provocation: a library in the low thousands is a list, not a
wall. Sortable columns, a thumbnail chip, always-visible actions, a fixed row
height that makes virtualisation arithmetic trivial. Worst of the three for
judging pictures, best for finding a file. Settings is a fourth tab.

## The data

`library.json` is the live 120-wallpaper library, exported as-is: the real Score
spread, the real σ band, the real 45 Unrated wallpapers. `fixtures.ts` adds two
things on purpose and says so in a comment: statuses (every real row is Active,
so a filter would have nothing to filter) and an aged slice of 15 wallpapers
with σ under 4.0 (nothing in the live library is Evaluated, so the solid badge
would never render).

## What the reaction has to settle

1. Does the header carry tabs, the Round headline, and pre-generation without
   getting crowded? A's answer is a second bar, B's is chips, C's is a text
   line.
2. Grid or list for the library page. C exists to make that a choice rather
   than an assumption.
3. Hover overlay or inspector panel for the card's actions. This decides how the
   keyboard fog patch gets closed.
4. Caption bar, side rail, or minimal chrome for the lightbox.
5. Where Settings sits: page, sheet, or tab.
