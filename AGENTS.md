# walltare

Local wallpaper curation: filesystem scan → pairwise voting → TrueSkill ranking → review/reject-to-folder.
Rust/Tauri backend, React/shadcn frontend.

## Domain

Read `CONTEXT.md` before touching domain logic — it defines Wallpaper, Status
(Active/Kept/Rejected), Soft reject, Comparison, and Evaluated/Participated.
Use its vocabulary exactly; don't invent synonyms.

## Reference implementation

The original Python/FastAPI + React app lives at `/home/qdes/repos/rate-wallpaper`
(see its `memory-bank/` for behavior details).

## Commands

- Dev run: `bun tauri dev` (native Wayland needs `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`)
- Tests / lint: `cargo test`, `cargo fmt`, `cargo clippy --all-targets`

## Agent skills

### Issue tracker

Issues live in GitHub Issues on QuantumFF/walltare via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
