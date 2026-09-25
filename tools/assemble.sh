#!/usr/bin/env bash
# Assembles one build of the game into a directory, the way the Pages workflow publishes it:
#   index.html with its channel set (the source is the dev channel; the live build flips one line),
#   the installable-app files (manifest, service worker, icons) with the deployed commit stamped into the worker's
#   cache version, and, for the test build, the app renamed so both can be installed side by side.
# Every rewrite is guarded: a missing line fails the build rather than shipping the wrong thing.
# The workflow runs each branch's own copy of this script, so a packaging change on dev reaches /test/ without a ship.
# A live build can also name where it is distributed (web by default, or itch for the itch.io upload), which every telemetry
# event then carries as `source`, so a portal's players are told apart by the build they play rather than by a referrer.
# Usage: tools/assemble.sh <source dir> <output dir> <live|test> [web|itch]       (GNU sed; CI and the headless suite run on Linux)
set -eu
src=$1; out=$2; channel=$3; source=${4:-web}
case "$channel" in live|test) ;; *) echo "channel must be live or test, not '$channel'" >&2; exit 2 ;; esac
case "$source" in web|itch) ;; *) echo "source must be web or itch, not '$source'" >&2; exit 2 ;; esac
if [ "$channel" = test ] && [ "$source" != web ]; then echo "a test build is distributed on the web only" >&2; exit 2; fi
mkdir -p "$out"
cp "$src/index.html" "$out/index.html"
if [ "$channel" = live ]; then
  sed -i "s/^const BUILD = { channel: 'dev', source: 'web' };/const BUILD = { channel: 'live', source: '$source' };/" "$out/index.html"
  grep -q "^const BUILD = { channel: 'live', source: '$source' };" "$out/index.html"
fi
cp "$src/manifest.webmanifest" "$src/sw.js" "$out/"
rm -rf "$out/icons"; cp -r "$src/icons" "$out/icons"
ver=$(git -C "$src" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)
sed -i "s/^const VERSION = 'dev';$/const VERSION = '$ver';/" "$out/sw.js"
grep -q "^const VERSION = '$ver';$" "$out/sw.js"
if [ "$channel" = test ]; then
  sed -i 's/"name": "Shelf Control"/"name": "Shelf Control (test)"/; s/"short_name": "Shelf Control"/"short_name": "SC test"/' "$out/manifest.webmanifest"
  grep -q '"name": "Shelf Control (test)"' "$out/manifest.webmanifest"
  # iOS labels a home-screen app by this meta, not the manifest
  sed -i 's/^<meta name="apple-mobile-web-app-title" content="Shelf Control">$/<meta name="apple-mobile-web-app-title" content="SC test">/' "$out/index.html"
  grep -q '^<meta name="apple-mobile-web-app-title" content="SC test">$' "$out/index.html"
fi
echo "$channel build from $src at $ver -> $out"
