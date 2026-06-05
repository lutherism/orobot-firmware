#!/usr/bin/env bash
# orobot firstrun.sh — executed once on first boot by systemd.run=/boot/firstrun.sh
#
# Raspberry Pi Imager (systemd init_format) patches cmdline.txt to execute this
# script via systemd-run on first boot.  After the script exits successfully the
# Pi Imager-generated wrapper removes the systemd.run= argument from cmdline.txt
# so the script never runs again.
#
# What this script does:
#   1. If Imager injected WiFi credentials (WIFI_SSID / WIFI_PASSWORD env vars),
#      write a wpa_supplicant.conf and enable networking so orobot.service can
#      connect to the gateway on first boot.
#   2. If no WiFi credentials were injected, the firmware will fall back to AP
#      (hotspot) mode automatically via its WifiStateMachine.
#   3. Wait for orobot.service to start and the device UUID to be provisioned,
#      then display the claim code / device UUID on the HDMI console so the user
#      can add the device at orobot.io without SSH.
#
# Environment variables set by Pi Imager (systemd init_format):
#   WIFI_SSID        — network SSID (empty if not configured in Imager)
#   WIFI_PASSWORD    — network password (empty if not configured)
#   WIFI_COUNTRY     — 2-letter country code, e.g. US (empty if omitted)
#
# This script intentionally does NOT depend on the orobot npm package — it runs
# before Node.js is necessarily started.

set -euo pipefail

OROBOT_DATA_DIR="${OROBOT_DATA_DIR:-/var/lib/orobot}"
DATA_FILE="$OROBOT_DATA_DIR/data.json"
LOG_FILE="/var/log/orobot-firstrun.log"
DISPLAY_TIMEOUT=300   # seconds to leave claim info on screen before clearing

# ---- logging ----------------------------------------------------------------

exec > >(tee -a "$LOG_FILE") 2>&1
echo "[orobot-firstrun] Starting — $(date -Iseconds)"

# ---- WiFi provisioning (if Imager supplied credentials) ---------------------

WIFI_SSID="${WIFI_SSID:-}"
WIFI_PASSWORD="${WIFI_PASSWORD:-}"
WIFI_COUNTRY="${WIFI_COUNTRY:-GB}"  # Raspberry Pi OS default country

if [[ -n "$WIFI_SSID" ]]; then
  echo "[orobot-firstrun] Configuring WiFi: SSID=$WIFI_SSID country=$WIFI_COUNTRY"

  # Set regulatory domain
  raspi-config nonint do_wifi_country "$WIFI_COUNTRY" 2>/dev/null || true

  # Write wpa_supplicant config
  cat > /etc/wpa_supplicant/wpa_supplicant.conf <<WPA
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=$WIFI_COUNTRY

network={
  ssid="$(echo "$WIFI_SSID" | sed 's/"/\\"/g')"
  psk="$(echo "$WIFI_PASSWORD" | sed 's/"/\\"/g')"
  key_mgmt=WPA-PSK
  priority=1
}
WPA

  chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf

  # Reconfigure the running supplicant (non-fatal — may not be up yet)
  wpa_cli -i wlan0 reconfigure 2>/dev/null || true

  # Also write credentials into orobot's data.json so WifiManager picks them up
  # without needing another AP-mode provisioning round.
  mkdir -p "$OROBOT_DATA_DIR"
  if [[ -f "$DATA_FILE" ]]; then
    # Merge WiFi settings into existing data.json using Python (always available on RPi OS)
    python3 - <<PYEOF
import json, sys
with open('$DATA_FILE') as f:
    data = json.load(f)
data['wifiSettings'] = {'ssid': '$(echo "$WIFI_SSID" | sed "s/'/'\''/")', 'password': '$(echo "$WIFI_PASSWORD" | sed "s/'/'\''/")'  }
data['networkMode'] = 'client'
with open('$DATA_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print('[orobot-firstrun] WiFi settings written to data.json', file=sys.stderr)
PYEOF
  else
    # data.json doesn't exist yet (first-ever boot before orobot.service ran).
    # Write a minimal seed so WifiManager initialises into client mode.
    mkdir -p "$OROBOT_DATA_DIR"
    python3 -c "
import json
data = {
  'deviceUuid': '',
  'networkMode': 'client',
  'wifiSettings': {'ssid': '$(echo "$WIFI_SSID" | sed "s/'/'\''/")', 'password': '$(echo "$WIFI_PASSWORD" | sed "s/'/'\''/")'  },
  'knownNetworks': [{'ssid': '$(echo "$WIFI_SSID" | sed "s/'/'\''/")', 'mac': '', 'password': '$(echo "$WIFI_PASSWORD" | sed "s/'/'\''/")'  }],
  'ownerUuid': None,
  'type': 'wifi-motor',
  'hardware': 'raspi',
  'pingTime': 0,
  'devIP': None,
  'pendingClaimCode': None,
  'lastSetupError': None
}
import sys
print(json.dumps(data, indent=2))
" > "$DATA_FILE"
    chmod 640 "$DATA_FILE"
  fi

  echo "[orobot-firstrun] WiFi credentials applied."
else
  echo "[orobot-firstrun] No WiFi credentials provided — firmware will start in AP mode."
  echo "[orobot-firstrun] Connect to the 'OROBOT-Setup-*' hotspot and visit http://192.168.4.1:3006"
fi

# ---- Wait for orobot.service + device UUID ----------------------------------

echo "[orobot-firstrun] Waiting for orobot.service to provision device UUID..."

DEADLINE=$(( $(date +%s) + 90 ))
DEVICE_UUID=""
while [[ -z "$DEVICE_UUID" && $(date +%s) -lt $DEADLINE ]]; do
  if [[ -f "$DATA_FILE" ]]; then
    DEVICE_UUID=$(python3 -c "import json; d=json.load(open('$DATA_FILE')); print(d.get('deviceUuid',''))" 2>/dev/null || true)
  fi
  [[ -z "$DEVICE_UUID" ]] && sleep 3
done

if [[ -z "$DEVICE_UUID" ]]; then
  echo "[orobot-firstrun] WARNING: orobot.service did not provision a UUID within 90s."
  echo "[orobot-firstrun] Check: systemctl status orobot"
  # Not fatal — the HDMI display below will just show an incomplete message.
fi

# ---- Display claim info on HDMI console ------------------------------------
# Uses the Linux virtual console (tty1) to print setup instructions.
# This works without X11, fbterm, or plymouth — just writes to /dev/tty1.

PORTAL_URL="http://192.168.4.1:3006"
GATEWAY_URL="https://orobot.io/o/robots"

{
  echo ""
  echo "=========================================="
  echo "  Welcome to orobot.io!"
  echo "=========================================="
  echo ""
  if [[ -n "$WIFI_SSID" ]]; then
    echo "  Connecting to WiFi: $WIFI_SSID"
    echo ""
    echo "  To add this device to your account:"
    echo "    1. Visit $GATEWAY_URL"
    echo "    2. Click 'Add Device' and enter the claim code shown below"
    echo "       (the code appears in the portal once the Pi contacts the gateway)"
    echo ""
    if [[ -n "$DEVICE_UUID" ]]; then
      echo "  Device ID: $DEVICE_UUID"
    fi
    echo ""
    echo "  Alternatively, run on this Pi:"
    echo "    orobot-claim <6-digit-code>"
  else
    echo "  No WiFi configured — AP mode active."
    echo ""
    echo "  To set up WiFi:"
    echo "    1. Connect your phone/laptop to the hotspot:"
    echo "         Network: OROBOT-Setup-*"
    echo "    2. Open: $PORTAL_URL"
    echo "    3. Enter your WiFi credentials."
    echo "    4. Visit $GATEWAY_URL to claim your device."
    echo ""
    if [[ -n "$DEVICE_UUID" ]]; then
      echo "  Device ID: $DEVICE_UUID"
    fi
  fi
  echo ""
  echo "  This message will clear in ${DISPLAY_TIMEOUT}s."
  echo "=========================================="
  echo ""
} > /dev/tty1 2>/dev/null || echo "[orobot-firstrun] Could not write to /dev/tty1 (headless?)"

echo "[orobot-firstrun] Setup info displayed on HDMI console."

# ---- mDNS TXT record for claim-code discovery --------------------------------
# Publish a _orobot._tcp service so the orobot.io web UI can discover this
# device on the local network without needing to read the HDMI output.
# avahi-daemon must be installed (it is on RPi OS Bullseye/Bookworm/Trixie).
# The TXT record is updated once the firmware writes a pendingClaimCode to
# data.json.  This block polls briefly; definitive mDNS updates happen via
# the mdns-claim firmware module (see src/network/mdns-claim.ts) once
# the device is online.

if command -v avahi-publish &>/dev/null && [[ -n "$DEVICE_UUID" ]]; then
  echo "[orobot-firstrun] Publishing mDNS service _orobot._tcp..."
  # Run in background so this script can exit (avahi-publish blocks by design)
  avahi-publish -s "orobot-${DEVICE_UUID:0:8}" _orobot._tcp 3006 \
    "uuid=$DEVICE_UUID" "setup=1" &
  echo "[orobot-firstrun] mDNS announced (PID $!)."
fi

# ---- cleanup after timeout --------------------------------------------------
# Clear tty1 so it doesn't permanently show setup text on the console.
( sleep "$DISPLAY_TIMEOUT" && printf '\033[2J\033[H' > /dev/tty1 2>/dev/null ) &

echo "[orobot-firstrun] Done — $(date -Iseconds)"
exit 0
