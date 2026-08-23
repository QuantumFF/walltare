# walltare

Local wallpaper curation: filesystem scan → pairwise voting → TrueSkill ranking → review/reject-to-folder.
Rust/Tauri backend, React/shadcn frontend.

use bun instead of npm and bunx instead of npx.
Don't prematurely close an issue. Make sure it makes it on main through a PR or a direct commit if told to.

## Domain

Read `CONTEXT.md` before touching domain logic — it defines Wallpaper, Status
(Active/Kept/Rejected), Soft reject, Comparison, and Evaluated/Participated.
Use its vocabulary exactly; don't invent synonyms.

## Reference implementation

The original Python/FastAPI + React app lives at `/home/qdes/repos/rate-wallpaper`
(see its `memory-bank/` for behavior details).

## Commands

- Dev run: `bun tauri dev` (native Wayland needs `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`)
- Rust: `cargo test`, `cargo fmt`, `cargo clippy --all-targets` (from `src-tauri/`)
- Frontend: `bun test`, `bun run typecheck`, `bun run lint` (from the repo root)

Run both sides before opening a PR. The frontend tests drive the real components
against a mocked IPC seam, so a backend DTO change that the TypeScript types
don't follow shows up there rather than at runtime.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on QuantumFF/walltare via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
