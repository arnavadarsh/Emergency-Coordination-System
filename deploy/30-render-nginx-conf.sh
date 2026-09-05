#!/bin/sh
# Renders the nginx config at container start.
#
# The nginx image runs everything in /docker-entrypoint.d before starting, which
# is the hook this uses. Two things cannot be baked in at build time:
#
#   PORT             Railway (and most platforms) assign a port per deploy and
#                    expect the container to listen on it. Hardcoding 80 means
#                    the service never receives traffic.
#
#   BACKEND_ORIGIN   Where to proxy /api and /socket.io. Set it (e.g.
#                    http://backend:3000) to serve everything from one origin.
#                    Leave it unset when the dashboards were built against the
#                    backend's own public URL — the proxy is then dropped
#                    entirely rather than left pointing nowhere.
#
# Markers are substituted rather than using envsubst: envsubst would also expand
# nginx's own $uri, $host and $http_upgrade and produce a broken config. Only
# POSIX sed/awk with redirection is used — `sed -i` differs between BSD, GNU and
# busybox, and this has to behave identically wherever it is run.
set -eu

TEMPLATE=/etc/nginx/ecs/nginx.conf.template
PROXY_PARTIAL=/etc/nginx/ecs/nginx-proxy.partial
OUTPUT=/etc/nginx/conf.d/default.conf

PORT="${PORT:-80}"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-}"

WORK="$(mktemp)"

if [ -n "$BACKEND_ORIGIN" ]; then
  echo "[ecs] proxying /api and /socket.io to ${BACKEND_ORIGIN}"
  # A trailing slash in proxy_pass changes how nginx rewrites the path; strip
  # one if supplied so the URI passes through unchanged either way.
  ORIGIN="$(printf '%s' "$BACKEND_ORIGIN" | sed 's:/*$::')"
  RENDERED="$(mktemp)"
  sed "s|__BACKEND_ORIGIN__|${ORIGIN}|g" "$PROXY_PARTIAL" > "$RENDERED"
  awk -v partial="$RENDERED" '
    /__PROXY_BLOCK__/ { while ((getline line < partial) > 0) print line; next }
    { print }
  ' "$TEMPLATE" > "$WORK"
  rm -f "$RENDERED"
else
  echo "[ecs] BACKEND_ORIGIN not set — serving the dashboards only."
  echo "[ecs] They must be built against the backend's public URL, and that"
  echo "[ecs] origin must appear in the backend's CORS_ORIGINS."
  awk '/__PROXY_BLOCK__/ { next } { print }' "$TEMPLATE" > "$WORK"
fi

sed "s|__PORT__|${PORT}|g" "$WORK" > "$OUTPUT"
rm -f "$WORK"

echo "[ecs] nginx will listen on ${PORT}"
