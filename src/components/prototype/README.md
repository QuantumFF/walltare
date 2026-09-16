# PROTOTYPE — throwaway, do not merge to main

Answers one question for #254: what should a wallpaper look like in Library and
in Review?

Run it:

```
bun tauri dev
```

then append `?proto=masonry.hero` to the dev URL, or just `?proto=1` and pick
from the bar at the bottom of the window.

## What it does

`?proto=` swaps the grid inside Library and Review for `ProtoGrid`. Everything
else on both pages stays real: the page bar, the filters, the sort, the empty
states, the chrome. The floating bar switches the variant for both tabs at once,
so flipping between Review and Library shows the same idea doing its two jobs.

## What it deliberately does not do

- **Nothing is written.** Keep and Reject mutate a local set of ids and nothing
  else. No backend call, no database row, no file moved. Refresh brings every
  card back. The real `onAction` the host passes in is ignored on purpose.
- **No virtualisation, no perf work.** ADR 0041 measured the real Library wheel
  pass at 25 to 29fps and named card mount as the cost. Every variant here
  mounts everything. Do not read a frame time off this.
- **Dark only.** Tokens are used so light does not break, but nothing is tuned
  for it.
- **No tests.** All seven variants were smoke-mounted once against fake rows
  before this landed, in a throwaway file that is not in the repo. It could not
  stay: `PROTO` is read once at module load, so whether it is true depends on
  which test file evaluated `proto.ts` first, and the file passed alone and
  failed in the suite. The production shape is right and the test was wrong, so
  the test went.

## The dimensions problem

`Wallpaper` carries no pixel dimensions. The `thumbnails` table has width and
height in SQLite but they never reach the DTO, so every real card is a fixed
`aspect-video` box with `object-cover` and a 21:9 wallpaper loses its edges.

`useRatios` works around it by loading each `small` thumbnail through
`new Image()` and reading `naturalWidth`. That is fine for 120 wallpapers and
wrong for 5,000. Shipping any true-ratio layout means putting the dimensions on
the DTO first.

## Deleting this

`git rm -r src/components/prototype` and revert the `PROTO` branch in
`LibraryView.tsx` and `ReviewView.tsx`. Nothing else imports it.
