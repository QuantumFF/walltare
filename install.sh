#!/usr/bin/env bash
#
# walltare — build and install on Arch Linux.
#
# Arch Linux only, and only Arch: this script compiles walltare from the
# checkout it sits in and hands the result to pacman, so `pacman -Qi walltare`
# knows about it and `pacman -R walltare` removes it. On any other
# distribution, download the AppImage from the releases page instead — an
# AppImage that needs a script is not an AppImage.
#
# Everything before the makepkg call is a prerequisite check. A missing package
# is named here, in one line, rather than found twenty minutes into a build at
# the bottom of a compiler error.
#
# Arguments are passed through to makepkg, so `./install.sh --noconfirm` runs
# unattended.

set -euo pipefail

# Located without calling out to dirname, so that a broken PATH reports itself
# through the checks below rather than through a bash error above them.
self="${BASH_SOURCE[0]}"
[[ $self == */* ]] || self="./$self"
repo="$(cd -- "${self%/*}" && pwd -P)"
readonly repo
readonly pkgbuild_dir="$repo/packaging"
readonly project='https://github.com/QuantumFF/walltare'
readonly releases="$project/releases"

# Every failure in this script comes out of here: a first line naming what is
# missing, and a second saying what to do about it.
die() {
	local line
	for line in "$@"; do
		printf 'install.sh: %s\n' "$line" >&2
	done
	exit 1
}

note() {
	printf '==> %s\n' "$1"
}

if [[ ! -f $pkgbuild_dir/PKGBUILD ]]; then
	die "there is no PKGBUILD at $pkgbuild_dir." \
		"This script builds walltare from a checkout of it, so it has to be run from one:" \
		"git clone $project, then cd walltare and ./install.sh"
fi

if ! command -v pacman >/dev/null 2>&1; then
	die 'pacman is missing, and this script installs walltare through pacman.' \
		'install.sh is for Arch Linux and its derivatives only.' \
		"On anything else, download the AppImage from $releases"
fi

# makepkg refuses to run as root, and is right to: a build step that goes wrong
# as root goes wrong across the whole system. Said here in walltare's own words,
# because makepkg's version arrives after the script looked like it was working.
if ((EUID == 0)); then
	die 'this script is running as root, and makepkg refuses to build as root.' \
		'Run it as your normal user. It calls sudo itself for the two pacman steps.'
fi

# base-devel, named tool by tool. gcc is here because rusqlite compiles the
# SQLite it bundles, and pkg-config — the binary the pkgconf package installs —
# because webkit2gtk-sys asks it where WebKitGTK is. Without either, the failure
# is a compiler or linker error, which is the thing this check exists to prevent.
missing_tools=()
for tool in makepkg fakeroot gcc make pkg-config sudo; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		missing_tools+=("$tool")
	fi
done
if ((${#missing_tools[@]} > 0)); then
	die "these build tools are missing: ${missing_tools[*]}" \
		'They all come with the base-devel group: sudo pacman -S --needed base-devel'
fi

# An unsynced pacman database makes every lookup below fail for a reason that
# has nothing to do with the package names in the PKGBUILD.
if (($(pacman -Sl 2>/dev/null | wc -l) == 0)); then
	die 'the pacman sync database is empty, so nothing can be looked up or installed.' \
		'Sync it first: sudo pacman -Sy'
fi

srcinfo="$(cd -- "$pkgbuild_dir" && makepkg --printsrcinfo)" ||
	die 'packaging/PKGBUILD did not parse.' \
		'This is a bug in walltare, not in your system. Please report it with the error above.'
readonly srcinfo

version="$(awk -F' = ' '$1 ~ /[[:space:]]pkgver$/ { print $2; exit }' <<<"$srcinfo")"
readonly version
[[ -n $version ]] || die 'the version could not be read from src-tauri/Cargo.toml.'

# The dependency list is read out of the PKGBUILD rather than repeated here, so
# the two cannot drift. Every name is looked up in the repositories before the
# build starts: a name that does not resolve is a typo in the PKGBUILD, and
# finding it now costs a second instead of a whole compile.
mapfile -t required < <(
	awk -F' = ' '$1 ~ /[[:space:]](make)?depends$/ { sub(/[<>=].*/, "", $2); print $2 }' <<<"$srcinfo"
)
if ((${#required[@]} == 0)); then
	die 'packaging/PKGBUILD declares no dependencies, which cannot be right.' \
		'This is a bug in walltare, not in your system. Please report it.'
fi

unknown=()
for pkg in "${required[@]}"; do
	if pacman -Si -- "$pkg" >/dev/null 2>&1; then
		continue
	fi
	# Not a package name in the repositories, but something installed may
	# already provide it — rustup provides rust, for one.
	if [[ -z "$(pacman -T -- "$pkg" 2>/dev/null)" ]]; then
		continue
	fi
	unknown+=("$pkg")
done
if ((${#unknown[@]} > 0)); then
	die "these packages are named in packaging/PKGBUILD and are in neither your repositories nor your system: ${unknown[*]}" \
		'walltare cannot be built until that is fixed. If you have the multilib or a third-party repository disabled, enable it;' \
		'otherwise this is a bug in the PKGBUILD and worth reporting.'
fi

note "walltare $version: building from $repo and installing with pacman"
note "packages this needs, installed by makepkg if they are missing: ${required[*]}"
note 'the app is compiled from source, so the first run of this takes a while'

cd -- "$pkgbuild_dir"

# --syncdeps installs what is missing, --install hands the built package to
# pacman, and --force overwrites the package file a previous run left in
# packaging/ rather than stopping to say it is already there.
exec makepkg --syncdeps --install --force "$@"
