#!/usr/bin/env bash
#
# Build the Firefox version of COS Cash-Back Tracker.
#
# Firefox MV3 uses an event-page background (background.scripts) instead of Chrome's
# service worker, and needs a browser_specific_settings gecko id. All other files are
# identical to the Chrome/Edge version, so this script just copies the shared files into
# a ./firefox/ folder and drops in the Firefox manifest (renamed to manifest.json).
#
# Run it after editing any shared file (content.js, background.js, popup.*) to keep the
# Firefox build in sync with the root (Chrome/Edge) version.
#
# Usage:
#   ./build-firefox.sh
#
# Then load it in Firefox:
#   about:debugging#/runtime/this-firefox  ->  Load Temporary Add-on  ->  pick firefox/manifest.json
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/firefox"

rm -rf "$OUT"
mkdir -p "$OUT/icons"

# Shared runtime files (identical across browsers)
cp "$ROOT/content.js"   "$OUT/content.js"
cp "$ROOT/background.js" "$OUT/background.js"
cp "$ROOT/popup.html"   "$OUT/popup.html"
cp "$ROOT/popup.css"    "$OUT/popup.css"
cp "$ROOT/popup.js"     "$OUT/popup.js"
cp "$ROOT/icons/icon16.png"  "$OUT/icons/icon16.png"
cp "$ROOT/icons/icon48.png"  "$OUT/icons/icon48.png"
cp "$ROOT/icons/icon128.png" "$OUT/icons/icon128.png"

# Firefox-specific manifest (event-page background + gecko id) becomes manifest.json
cp "$ROOT/manifest-firefox.json" "$OUT/manifest.json"

echo "Built Firefox extension in: $OUT"
echo "Load it: Firefox -> about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> select $OUT/manifest.json"
