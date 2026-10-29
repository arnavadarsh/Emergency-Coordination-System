#!/usr/bin/env bash
# Builds all four dashboards into one directory for static hosting.
#
#   deploy/public/            patient dashboard — also the shared sign-in and
#                             the public /track/<token> page
#   deploy/public/admin/      admin dashboard
#   deploy/public/driver/     driver dashboard
#   deploy/public/hospital/   hospital dashboard
#
# Each app is built with the sub-path it will be served from, because Vite bakes
# that into every asset URL at build time. The VITE_* values are inlined the
# same way, so this has to run with them set — the app configs fail the build
# rather than silently producing a bundle that points at localhost.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/public"

rm -rf "$OUT"
mkdir -p "$OUT"

build() {
  local app="$1" base="$2" dest="$3"
  echo "── building $app (base $base)"
  cd "$ROOT/web/$app"
  npm ci --no-audit --no-fund
  BASE_PATH="$base" npm run build
  mkdir -p "$dest"
  cp -R dist/. "$dest/"
}

build user-dashboard     "/"          "$OUT"
build admin-dashboard    "/admin/"    "$OUT/admin"
build driver-dashboard   "/driver/"   "$OUT/driver"
build hospital-dashboard "/hospital/" "$OUT/hospital"

echo "── done"
ls -la "$OUT" | head -12
