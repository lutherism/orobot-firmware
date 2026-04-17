// ESP32 NVS backend for NvsStore.
//
// The native test env does NOT compile this file — see test/test_nvs_store
// for a mock-based round-trip test. On device this wraps Preferences.

#if defined(ARDUINO)

#include "nvs_store.h"

#include <Preferences.h>

namespace orobot {

namespace {
constexpr const char* kNamespace = "orobot";
constexpr const char* kSsidKey = "wifi_ssid";
constexpr const char* kPassKey = "wifi_pass";
}  // namespace

bool NvsStore::begin() {
  // `begin()` auto-creates the namespace if missing. Returns false on a
  // hardware-level NVS failure, which is unrecoverable from firmware.
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) {
    return false;
  }
  p.end();
  return true;
}

WifiCreds NvsStore::readWifi() {
  Preferences p;
  WifiCreds creds;
  if (!p.begin(kNamespace, /*readOnly=*/true)) {
    return creds;  // empty
  }
  creds.ssid = p.getString(kSsidKey, "");
  creds.password = p.getString(kPassKey, "");
  p.end();
  return creds;
}

bool NvsStore::writeWifi(const WifiCreds& creds) {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) {
    return false;
  }
  const bool ok =
      p.putString(kSsidKey, creds.ssid) > 0 &&
      (creds.password.length() == 0 || p.putString(kPassKey, creds.password) > 0);
  p.end();
  return ok;
}

bool NvsStore::clearWifi() {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) {
    return false;
  }
  p.remove(kSsidKey);
  p.remove(kPassKey);
  p.end();
  return true;
}

}  // namespace orobot

#endif  // ARDUINO
