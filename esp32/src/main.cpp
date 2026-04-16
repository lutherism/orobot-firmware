// orobot-firmware esp32 — scaffold
//
// This is intentionally the smallest possible Arduino sketch that still
// exercises the toolchain. A 1 Hz heartbeat on GPIO 2 (the built-in LED on
// most ESP32 DevKits) proves:
//   - platformio.ini resolves the right platform/board/framework
//   - the sketch compiles with -Wall -Wextra -Werror
//   - the binary actually boots and runs on a real ESP32
//
// Later PRs replace this loop with a proper state machine driving WiFi
// (#509), WebSocket (#510), and the orobot protocol (#511). Don't let this
// file accrete placeholders for work that hasn't landed yet — keep it
// single-purpose until its successor is ready.

#include <Arduino.h>

namespace {
constexpr uint8_t kHeartbeatPin = 2;
constexpr uint32_t kHeartbeatPeriodMs = 1000;
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(kHeartbeatPin, OUTPUT);
  Serial.println();
  Serial.print("orobot-esp32 boot  firmware=");
  Serial.println(OROBOT_FIRMWARE_VERSION);
}

void loop() {
  static uint32_t beat = 0;
  digitalWrite(kHeartbeatPin, (beat & 1) ? LOW : HIGH);
  Serial.printf("heartbeat %u\n", ++beat);
  delay(kHeartbeatPeriodMs);
}
