#!/usr/bin/env bash
# Claim this Jetson device to your orobot.io account.
#
# Usage:
#   orobot-claim
#
# Reads the device UUID from /var/lib/orobot/data.json, prompts for your
# orobot.io credentials, and claims the device to your account.
set -euo pipefail

GATEWAY="${OROBOT_API:-https://orobot.io}"
DATA_FILE="${OROBOT_DATA_DIR:-/var/lib/orobot}/data.json"

if [[ ! -f "$DATA_FILE" ]]; then
  echo "Device not yet initialized — is orobot.service running?" >&2
  exit 1
fi

DEVICE_UUID=$(node -e "const d=require('$DATA_FILE');process.stdout.write(d.deviceUuid||'')" 2>/dev/null || true)
if [[ -z "$DEVICE_UUID" ]]; then
  echo "No deviceUuid found in $DATA_FILE" >&2
  exit 1
fi

read -rp "orobot.io email: " EMAIL
read -rsp "orobot.io password: " PASSWORD
echo

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

LOGIN=$(curl -fsSL -c "$COOKIE_JAR" -X POST "$GATEWAY/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":$(node -e "process.stdout.write(JSON.stringify('$EMAIL'))"),\"password\":$(node -e "process.stdout.write(JSON.stringify('$PASSWORD'))")}")

if ! echo "$LOGIN" | grep -q '"uuid"'; then
  echo "Login failed." >&2
  exit 1
fi

CODE_RESP=$(curl -fsSL -b "$COOKIE_JAR" -X POST "$GATEWAY/api/device/claim-code" \
  -H "Content-Type: application/json")
CODE=$(node -e "process.stdout.write(JSON.parse('${CODE_RESP//\'/}').code)")

curl -fsSL -X POST "$GATEWAY/api/device/claim-code/redeem" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"deviceUuid\":\"$DEVICE_UUID\"}" > /dev/null

echo "Device $DEVICE_UUID claimed to your account."
echo "Visit $GATEWAY/o/robots to see it."
