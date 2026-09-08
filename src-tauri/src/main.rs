// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK on NVIDIA under Wayland wants NVIDIA's explicit sync off, or it
    // paints a blank window (tauri-apps/tauri#9394). The installed app gets this
    // from its launcher, /usr/bin/walltare; this covers the AppImage and
    // `bun tauri dev`, which have nothing between them and the binary.
    //
    // Set only when the variable is absent, so somebody on a driver where the
    // bug is fixed can export __NV_DISABLE_EXPLICIT_SYNC=0 and be believed.
    #[cfg(target_os = "linux")]
    if is_wayland() && is_nvidia() && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    walltare_lib::run()
}

#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v == "wayland")
        || std::env::var("WAYLAND_DISPLAY").is_ok()
}

#[cfg(target_os = "linux")]
fn is_nvidia() -> bool {
    std::path::Path::new("/proc/driver/nvidia/version").exists()
}
