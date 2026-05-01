#!/usr/bin/env bash
#   orobot-claim <code>
#
# Generate the claim code at orobot.io/o/robots, then run this command.
set -euo pipefail

GATEWAY="${OROBOT_API:-https://orobot.io}"
# Join all args and strip spaces/dashes so "386 146" and "386146" both work.
CODE="${*:-}"
CODE="${CODE// /}"
CODE="${CODE//-/}"

if [[ -z "$CODE" ]]; then
  echo "Usage: $0 <claim-code>" >&2
  echo "  Generate a code at orobot.io/o/robots" >&2
  exit 1
fi

if [[ ! "$CODE" =~ ^[0-9]{6}$ ]]; then
  echo "Error: code must be 6 digits (e.g. 386146 or '386 146')" >&2
  exit 1
fi

DATA_FILE="${OROBOT_DATA_DIR:-/var/lib/orobot}/data.json"
if [[ ! -f "$DATA_FILE" ]]; then
  echo "Device not initialized — is orobot.service running?" >&2
  exit 1
fi

DEVICE_UUID=$(node -e "process.stdout.write(require('$DATA_FILE').deviceUuid || '')" 2>/dev/null)
if [[ -z "$DEVICE_UUID" ]]; then
  echo "No deviceUuid in $DATA_FILE" >&2
  exit 1
fi

RESULT=$(curl -fsSL -X POST "$GATEWAY/api/device/claim-code/redeem" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"deviceUuid\":\"$DEVICE_UUID\"}")

echo "Device $DEVICE_UUID claimed. Visit $GATEWAY/o/robots to see it."
