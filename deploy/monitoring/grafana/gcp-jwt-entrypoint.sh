#!/bin/sh
# Grafana's bundled Cloud Monitoring plugin reads a bare PEM key, not the service-account
# JSON, so pull private_key out of the mounted JSON into /tmp (inside the container only).
set -eu

SRC="/etc/grafana/gcp/service-auth.json"
DEST="/tmp/gcp-service-account-private-key.pem"

if [ -f "$SRC" ]; then
  sed -n 's/.*"private_key": *"\(.*\)".*/\1/p' "$SRC" | sed 's/\\n/\n/g' > "$DEST"
  chmod 600 "$DEST"
fi

exec /run.sh "$@"
