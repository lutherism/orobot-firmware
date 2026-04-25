// orobot-firmware esp32 — boot flow
//
// State machine lives in a handful of enums and a single loop() dispatch:
//
//   BOOT ──┬─► STA (NVS has creds)
//          └─► AP  (no creds, or 3 STA retries failed)
//
//   AP  ── user submits form ──► reboot ──► BOOT
//   STA ── sustained disconnect ► BOOT (may fall to AP after retries)
//
// Later PRs layer WebSocket client (#510) and the orobot message protocol
// (#511) on top of the STA state.

#include <Arduino.h>
#include <WiFi.h>

#include "claim_redeem.h"
#include "nvs_store.h"
#include "protocol.h"
#include "wifi_portal.h"
#include "ws_client.h"

namespace {

enum class State {
  kBoot,
  kStaConnecting,
  kStaConnected,
  kAp,
  kRebootPending,
};

constexpr uint8_t kStaMaxAttempts = 3;
constexpr uint32_t kStaConnectTimeoutMs = 15000;
constexpr uint8_t kHeartbeatPin = 2;
constexpr uint32_t kHeartbeatPeriodMs = 1000;

orobot::NvsStore g_store;
orobot::WifiPortal g_portal;
orobot::Protocol g_protocol;
orobot::WsClient g_ws;
orobot::DeviceIdentity g_identity;
bool g_ws_started = false;
State g_state = State::kBoot;
uint8_t g_sta_attempts = 0;
uint32_t g_sta_started_ms = 0;
uint32_t g_reboot_at_ms = 0;
uint32_t g_last_heartbeat_ms = 0;

void logTransition(const char* to) {
  Serial.print("state=");
  Serial.println(to);
}

void enterAp() {
  logTransition("ap");
  g_state = State::kAp;
  if (!g_portal.begin(&g_store)) {
    Serial.println("ap-start-failed; rebooting in 5s");
    g_reboot_at_ms = millis() + 5000;
    g_state = State::kRebootPending;
  }
}

void enterStaConnect(const orobot::WifiCreds& creds) {
  logTransition("sta-connecting");
  g_state = State::kStaConnecting;
  g_sta_started_ms = millis();
  WiFi.mode(WIFI_STA);
  WiFi.begin(creds.ssid.c_str(), creds.password.c_str());
}

void tickStaConnecting(const orobot::WifiCreds& creds) {
  if (WiFi.status() == WL_CONNECTED) {
    logTransition("sta-connected");
    Serial.print("ip=");
    Serial.println(WiFi.localIP());
    g_state = State::kStaConnected;
    g_sta_attempts = 0;
    return;
  }
  if (millis() - g_sta_started_ms < kStaConnectTimeoutMs) {
    return;
  }
  ++g_sta_attempts;
  Serial.print("sta-failed attempt=");
  Serial.println(g_sta_attempts);
  if (g_sta_attempts >= kStaMaxAttempts) {
    enterAp();
  } else {
    enterStaConnect(creds);
  }
}

void heartbeat() {
  const uint32_t now = millis();
  if (now - g_last_heartbeat_ms < kHeartbeatPeriodMs) return;
  g_last_heartbeat_ms = now;
  static bool on = false;
  on = !on;
  digitalWrite(kHeartbeatPin, on ? HIGH : LOW);
}

}  // namespace

// Creds re-read each boot — cheaper than caching and keeps "reset button
// clears NVS then reboots" working without special cases.
static orobot::WifiCreds g_creds;

void setup() {
  Serial.begin(115200);
  pinMode(kHeartbeatPin, OUTPUT);

  Serial.println();
  Serial.print("orobot-esp32 boot  firmware=");
  Serial.println(OROBOT_FIRMWARE_VERSION);

  if (!g_store.begin()) {
    Serial.println("nvs-init-failed; entering AP");
    enterAp();
    return;
  }

  g_identity = g_store.readIdentity();
  if (g_identity.empty()) {
    g_identity = orobot::generateIdentity();
    if (!g_store.writeIdentity(g_identity)) {
      Serial.println("identity-write-failed");
    } else {
      Serial.println("identity-generated");
    }
  }
  Serial.print("device-uuid=");
  Serial.println(g_identity.uuid);
  Serial.print("device-key=");
  Serial.println(g_identity.key);

  g_creds = g_store.readWifi();
  if (g_creds.empty()) {
    Serial.println("no-creds");
    enterAp();
  } else {
    Serial.print("have-creds ssid=");
    Serial.println(g_creds.ssid);
    enterStaConnect(g_creds);
  }
}

void loop() {
  heartbeat();

  switch (g_state) {
    case State::kBoot:
      // setup() leaves us in one of the real states; kBoot should never
      // appear here, but bail safely if it does.
      enterAp();
      break;

    case State::kStaConnecting:
      tickStaConnecting(g_creds);
      break;

    case State::kStaConnected:
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("sta-dropped");
        g_ws_started = false;
        enterStaConnect(g_creds);
        break;
      }
      if (!g_ws_started) {
        // Redeem any pending pair code before opening the WS. The gateway
        // requires the device row + PubSub provisioning to exist before
        // `connect-to-user` can subscribe — see
        // robots-gateway/src/modules/devices/service.ts:redeemClaimCode.
        const String pendingCode = g_store.readPairCode();
        if (pendingCode.length() > 0) {
          if (orobot::redeemPairCode(g_identity.uuid, pendingCode)) {
            g_store.clearPairCode();
            Serial.println("redeem-success");
          } else {
            // Keep the code in NVS so the next boot retries; surfacing the
            // failure to serial is the only signal a non-OLED device has.
            Serial.println("redeem-failed-keeping-code");
          }
        }
        g_ws.begin(g_identity, &g_protocol);
        g_ws_started = true;
      }
      g_ws.tick();
      break;

    case State::kAp:
      g_portal.tick();
      if (g_portal.credsReceived()) {
        Serial.println("creds-saved; rebooting in 3s");
        g_reboot_at_ms = millis() + 3000;
        g_state = State::kRebootPending;
      }
      break;

    case State::kRebootPending:
      if (millis() >= g_reboot_at_ms) {
        Serial.println("reboot");
        Serial.flush();
        ESP.restart();
      }
      break;
  }
}
