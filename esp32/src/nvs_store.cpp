// ESP32 NVS backend for NvsStore.
//
// The native test env does NOT compile this file — see test/test_nvs_store
// for a mock-based round-trip test. On device this wraps Preferences.

#if defined(ARDUINO)

#include "nvs_store.h"

#include <Preferences.h>
#include <esp_system.h>

#include "lib/identity_format.h"

namespace orobot {

namespace {
constexpr const char* kNamespace = "orobot";
constexpr const char* kSsidKey = "wifi_ssid";
constexpr const char* kPassKey = "wifi_pass";
constexpr const char* kUuidKey = "dev_uuid";
constexpr const char* kKeyKey = "dev_key";
constexpr const char* kPairCodeKey = "pair_code";

void fillRandom(uint8_t* buf, size_t n) {
  // esp_random() returns 32 bits per call from the hardware RNG (driven by
  // WiFi/BT noise once the radios are up; ring-oscillator otherwise). We
  // call it once per word; partial trailing bytes are discarded from the
  // last word.
  for (size_t i = 0; i < n; i += 4) {
    const uint32_t r = esp_random();
    for (size_t j = 0; j < 4 && (i + j) < n; ++j) {
      buf[i + j] = static_cast<uint8_t>((r >> (j * 8)) & 0xFF);
    }
  }
}
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

DeviceIdentity NvsStore::readIdentity() {
  Preferences p;
  DeviceIdentity id;
  if (!p.begin(kNamespace, /*readOnly=*/true)) {
    return id;
  }
  id.uuid = p.getString(kUuidKey, "");
  id.key = p.getString(kKeyKey, "");
  p.end();
  return id;
}

bool NvsStore::writeIdentity(const DeviceIdentity& id) {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) {
    return false;
  }
  const bool ok =
      p.putString(kUuidKey, id.uuid) > 0 && p.putString(kKeyKey, id.key) > 0;
  p.end();
  return ok;
}

String NvsStore::readPairCode() {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/true)) return String();
  String code = p.getString(kPairCodeKey, "");
  p.end();
  return code;
}

bool NvsStore::writePairCode(const String& code) {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) return false;
  const bool ok = p.putString(kPairCodeKey, code) > 0;
  p.end();
  return ok;
}

bool NvsStore::clearPairCode() {
  Preferences p;
  if (!p.begin(kNamespace, /*readOnly=*/false)) return false;
  p.remove(kPairCodeKey);
  p.end();
  return true;
}

DeviceIdentity generateIdentity() {
  DeviceIdentity id;
  uint8_t b[16];
  fillRandom(b, sizeof(b));
  applyUuidV4Bits(b);
  id.uuid = String(formatUuid(b).c_str());

  uint8_t k[32];
  fillRandom(k, sizeof(k));
  id.key = String(hexEncode(k, sizeof(k)).c_str());
  return id;
}

}  // namespace orobot

#endif  // ARDUINO
