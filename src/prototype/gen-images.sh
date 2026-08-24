#!/usr/bin/env bash
# PROTOTYPE ONLY — see src/prototype/README.md. Throwaway.
#
# Builds the two image sizes the prototype needs out of the real library, into
# public/proto-images/ (gitignored). Vite serves public/ at /, so the prototype
# reaches them at /proto-images/<id>_card.jpg and /proto-images/<id>_large.jpg
# with no wallpaper:// protocol and no Tauri.
#
# Reads paths straight from the live DB so the fixture ids line up with
# src/prototype/fixtures.ts.
set -euo pipefail

DB="${WALLTARE_DB:-$HOME/.local/share/com.quantumff.walltare/walltare.db}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/public/proto-images"

mkdir -p "$OUT"

sqlite3 -separator '|' "$DB" 'select id, path from wallpapers order by id;' |
  while IFS='|' read -r id path; do
    [ -f "$path" ] || { echo "skip $id (missing $path)"; continue; }
    [ -f "$OUT/${id}_card.jpg" ] || magick "$path" -auto-orient -resize 512x -quality 78 "$OUT/${id}_card.jpg"
    [ -f "$OUT/${id}_large.jpg" ] || magick "$path" -auto-orient -resize 1600x -quality 82 "$OUT/${id}_large.jpg"
    echo "$id"
  done

echo "done: $(ls "$OUT" | wc -l) files in $OUT"
