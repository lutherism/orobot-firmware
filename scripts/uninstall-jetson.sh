#!/usr/bin/env bash
# Reset orobot firmware on a Jetson for a clean re-install.
#
# Removes all installed artifacts (service, install dir, data dir, helpers)
# so that install-jetson.sh runs as if the board is fresh out of the box.
#
# Usage:
#   sudo ./scripts/reset-jetson.sh
#
# Flags:
#   --detach    Also detach the device from its owner on orobot.io
#               (reads deviceUuid from data.json before wiping; requires network)
set -euo pipefail

INSTALL_DIR="${OROBOT_INSTALL_DIR:-/opt/orobot}"
DATA_DIR="${OROBOT_DATA_DIR:-/var/lib/orobot}"
GATEWAY="${OROBOT_API:-https://orobot.io}"
DETACH=false

for arg in "$@"; do
  case "$arg" in
    --detach) DETACH=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root (try: sudo $0 $*)" >&2
  exit 1
fi

# ── Detach from owner before wiping ──────────────────────────────────────────
if [[ "$DETACH" == true ]]; then
  DATA_FILE="$DATA_DIR/data.json"
  if [[ -f "$DATA_FILE" ]]; then
    DEVICE_UUID=$(node -e "process.stdout.write(require('$DATA_FILE').deviceUuid || '')" 2>/dev/null || true)
    if [[ -n "$DEVICE_UUID" ]]; then
      echo "==> Detaching $DEVICE_UUID from owner on $GATEWAY"
      curl -fsSL -X DELETE "$GATEWAY/api/device/$DEVICE_UUID/owner" \
        -H "Content-Type: application/json" || echo "  (gateway detach failed — device may have no owner, or endpoint unavailable)"
    else
      echo "  No deviceUuid in $DATA_FILE — skipping detach"
    fi
  else
    echo "  No data.json found — skipping detach"
  fi
fi

# ── Stop and remove service ───────────────────────────────────────────────────
echo "==> Stopping orobot.service"
systemctl stop orobot.service 2>/dev/null || true
systemctl disable orobot.service 2>/dev/null || true
rm -f /etc/systemd/system/orobot.service
systemctl daemon-reload

# ── Remove installed files ────────────────────────────────────────────────────
echo "==> Removing install dir $INSTALL_DIR"
rm -rf "$INSTALL_DIR"

echo "==> Removing data dir $DATA_DIR"
rm -rf "$DATA_DIR"

echo "==> Removing orobot-claim helper"
rm -f /usr/local/bin/orobot-claim

echo
echo "  Reset complete. Run install-jetson.sh to reinstall from scratch."
