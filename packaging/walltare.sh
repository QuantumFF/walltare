#!/bin/sh
# walltare's launcher, installed as /usr/bin/walltare, and what the desktop
# entry runs. The binary is /usr/lib/walltare/walltare.
#
# WebKitGTK on NVIDIA under Wayland paints a blank or flickering window unless
# NVIDIA's explicit sync is turned off (tauri-apps/tauri#9394). The launcher
# sets that, so nobody has to export anything before clicking an icon in their
# application menu.
#
# It sets it only when the variable is absent. `${VAR+set}` asks whether the
# variable exists at all rather than whether it has a value, so a user on a
# driver where the bug is fixed can put __NV_DISABLE_EXPLICIT_SYNC=0 — or an
# empty value — in their session environment and keep it.
#
# The launcher does not check for an NVIDIA card first. The variable is read by
# NVIDIA's driver and by nothing else, so on AMD and Intel it changes nothing,
# and a copy of the driver probe in shell would be a second place to keep
# correct. `main.rs` probes the hardware for the paths that have no launcher:
# the AppImage and `bun tauri dev`.

if [ -z "${__NV_DISABLE_EXPLICIT_SYNC+set}" ]; then
	__NV_DISABLE_EXPLICIT_SYNC=1
	export __NV_DISABLE_EXPLICIT_SYNC
fi

exec /usr/lib/walltare/walltare "$@"
