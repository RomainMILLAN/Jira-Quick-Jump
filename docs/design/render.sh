#!/usr/bin/env bash
#
# Renders docs/assets/*.png from the HTML sources next to this script.
#
# The PNGs are committed, but they are NOT hand-made: this script is what
# produced them, so any of them can be rebuilt and compared. The extension's
# icons already work this way (scripts/make-icons.mjs, checked by a test); a
# banner exported by hand from a design tool would have been the one graphic in
# the repository whose provenance nobody could check.
#
# Needs a Chrome or Chromium on PATH. Nothing else -- the fonts are the ones
# src/ui/fonts/ already ships, so rendering makes no network request.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../assets"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

mkdir -p "$OUT"

# source                 output                width height scale
render() {
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor="$5" --window-size="$3,$4" \
    --screenshot="$OUT/$2" "file://$HERE/$1" >/dev/null 2>&1
  # Chrome stamps a tEXt/iCCP chunk and a timestamp into its PNGs. Stripping them
  # keeps the files reproducible and free of anything about the machine.
  if command -v magick >/dev/null; then
    magick "$OUT/$2" -strip "$OUT/$2"
  fi
  printf '%-24s %s\n' "$2" "$(du -h "$OUT/$2" | cut -f1)"
}

render banner-light.html   banner-light.png     1280 320  2
render banner-dark.html    banner-dark.png      1280 320  2
render social-preview.html social-preview.png   1280 640  1
render logo.html           logo-512.png          512 512  1
render promo-tile.html     promo-440x280.png     440 280  1
