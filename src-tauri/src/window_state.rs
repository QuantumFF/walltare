//! Where the window opens, which is nowhere near the settings table.
//!
//! Size, position and maximized state belong to `tauri-plugin-window-state`.
//! They are a side effect of dragging a window rather than a stated preference,
//! and they would write on every resize, so the `settings` table holds none of
//! them. The plugin also handles multiple monitors and a window restored
//! off-screen, which is tedious to get right and invisible when it works. See
//! [ADR 0010](../../docs/adr/0010-settings-store.md).
//!
//! It persists to `.window-state.json` in the app config dir, beside neither the
//! database nor the thumbnail cache, which both live in the app data dir.
//!
//! The plugin's three commands are its whole permission surface and nothing in
//! the frontend calls them — geometry never crosses the IPC — so
//! `capabilities/default.json` needs no entry for it.

use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use tauri_plugin_window_state::{Builder, StateFlags};

/// The plugin, restoring the three pieces of geometry the app has an opinion
/// about.
///
/// Its own default is every flag, which also persists visibility, decorations
/// and fullscreen. walltare never sets any of those itself, and a stored
/// `visible: false` — from a crash, or from someone editing the state file —
/// would reopen the app as an invisible window with nothing on screen to click.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build()
}
