#!/usr/bin/env bash
# Developer-only: requires Inkscape 1.2+ from its official distribution.
# Render directly from the vector at each target size (never upscale a PNG).
# Optional directory and size list support review exports, e.g. /tmp/icons 16 32 48 128.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/icons}"
if (($#)); then shift; fi
if (($# == 0)); then set -- 16 48 128; fi
mkdir -p "$out"
for size in "$@"; do
  [[ "$size" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid icon size: $size" >&2; exit 1; }
  inkscape "$root/icons/opentab-icon.svg" --export-type=png \
    --export-filename="$out/icon$size.png" --export-width="$size" --export-height="$size"
done
