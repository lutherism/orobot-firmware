// Pure AP-SSID helper — no Arduino dependency.
//
// Used by `WifiPortal::apSsidFromMac` on device. The native build can call
// this directly from tests without a `String` shim.

#pragma once

#include <cstdint>
#include <cstdio>
#include <string>

namespace orobot {

// "orobot-setup-XXXX" where XXXX = last 4 hex digits of the 48-bit MAC.
// Matches the iOS/Android captive-portal naming convention used elsewhere in
// the platform.
inline std::string apSsidFromMacPure(std::uint64_t mac) {
  char out[18];
  std::snprintf(out, sizeof(out), "orobot-setup-%02X%02X",
                static_cast<unsigned>((mac >> 8) & 0xFF),
                static_cast<unsigned>(mac & 0xFF));
  return std::string(out);
}

}  // namespace orobot
