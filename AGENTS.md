# walltare

Local wallpaper curation: filesystem scan → pairwise voting → TrueSkill ranking → review/reject-to-folder.
Rust/Tauri backend, React/shadcn frontend.

use bun instead of npm and bunx instead of npx.
Don't prematurely close an issue. Make sure it makes it on main through a PR or a direct commit if told to.

## Domain

Read `CONTEXT.md` before touching domain logic. It defines Wallpaper, Status
(Active/Kept/Rejected), Soft reject, Comparison, and Evaluated/Participated.
Use its vocabulary exactly; don't invent synonyms.

Decisions that already went a particular way, and the reasoning that would
otherwise get undone, live in `docs/adr/`. Read the ones covering the area
you're about to change.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on QuantumFF/walltare via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
