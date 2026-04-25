// NVS-backed persistent store for orobot-esp32.
//
// Thin wrapper over the Arduino `Preferences` class so higher layers never
// touch the Preferences API directly. Everything goes through this interface
// so the native test env can provide a stub without pulling in ESP-IDF.
//
// Keys live in a single "orobot" namespace. Keep key names <= 15 chars per the
// NVS limit.

#pragma once

#include <Arduino.h>

namespace orobot {

// WiFi credentials the device uses to join the user's home network.
struct WifiCreds {
  String ssid;
  String password;

  bool empty() const { return ssid.length() == 0; }
};

// Persistent device identity. UUID identifies the device to the gateway in the
// `connect-to-user` handshake; `key` is the long random secret a user enters
// (or scans) once during the out-of-band claim flow. Both are generated on
// first boot from `esp_random()` and never rotate.
struct DeviceIdentity {
  String uuid;  // RFC 4122 v4, lowercase, hyphenated (36 chars)
  String key;   // 64 hex chars (32 random bytes)

  bool empty() const { return uuid.length() == 0; }
};

// Filesystem-like persistent store. Back end is ESP32 NVS in the firmware
// build and an in-memory map in the native test build.
class NvsStore {
 public:
  // Must be called exactly once before any read/write. Returns false if NVS
  // is corrupted beyond recovery — in which case a reflash is required.
  bool begin();

  // Read stored creds. Returns an empty WifiCreds (ssid.length()==0) if
  // nothing has been saved yet. Never throws.
  WifiCreds readWifi();

  // Write creds. Blocking but fast (< 50 ms on ESP32). Returns false if the
  // flash write failed; callers should surface this to serial and avoid
  // assuming success.
  bool writeWifi(const WifiCreds& creds);

  // Wipe creds. Used by the "forget wifi" path when a user holds the reset
  // button on the device. Returns false on flash failure.
  bool clearWifi();

  // Read stored identity. Returns empty if first boot.
  DeviceIdentity readIdentity();

  // Persist identity. Called once on first boot.
  bool writeIdentity(const DeviceIdentity& id);

  // Pair code captured by the captive portal. Empty when the device has
  // already redeemed (or is freshly flashed). Single-use: cleared after the
  // first successful POST to `/api/device/claim-code/redeem`.
  String readPairCode();
  bool writePairCode(const String& code);
  bool clearPairCode();
};

// Generate a fresh identity using the on-chip RNG. ARDUINO-only — the native
// test env doesn't link this. Defined in nvs_store.cpp alongside the
// Preferences-backed implementation.
DeviceIdentity generateIdentity();

}  // namespace orobot
