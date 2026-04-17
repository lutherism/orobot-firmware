// AP-mode captive-portal WiFi provisioning for orobot-esp32.
//
// Serves a single HTML form on http://192.168.4.1/ that accepts SSID and
// password, persists to NVS, and reboots into STA mode. DNS hijack
// redirects every hostname to the portal so iOS/Android captive-portal
// detectors auto-open the page.
//
// The portal is *only* needed when NVS has no valid creds or STA mode has
// failed repeatedly. In the common case the device boots straight into
// STA and this module never runs.

#pragma once

#include <Arduino.h>

#include "nvs_store.h"

namespace orobot {

class WifiPortal {
 public:
  // Bring up softAP with SSID "orobot-setup-XXXX" (XXXX = last 4 hex of
  // MAC), start DNS + HTTP servers. Does not block. Returns false if the
  // radio could not start AP mode.
  bool begin(NvsStore* store);

  // Pump DNS + HTTP handlers. Call every loop() iteration while in AP mode.
  void tick();

  // True once the user has submitted creds AND they have been written to
  // NVS. The caller should reboot shortly after so the new creds take
  // effect on a clean boot.
  bool credsReceived() const { return creds_received_; }

  // Build the AP SSID from the supplied 48-bit MAC. Exposed for tests.
  // Format: "orobot-setup-" + last 4 hex digits, e.g. "orobot-setup-A1B2".
  static String apSsidFromMac(uint64_t mac);

  // Called by the portal's HTTP save handler; also callable from tests to
  // simulate a form submission without bringing up a real web server. Writes
  // to NVS via the store passed to `begin()` and flips `credsReceived()`.
  bool credsWrite(const WifiCreds& creds);

 private:
  NvsStore* store_ = nullptr;
  bool creds_received_ = false;
};

}  // namespace orobot
