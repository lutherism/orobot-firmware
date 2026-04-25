// ESP32 captive-portal backend for WifiPortal.
//
// Not compiled under the native test env — Unity tests only exercise the
// pure helpers (`apSsidFromMac`). The HTTP / DNS surface is exercised on
// hardware per the test plan in the idea doc (#509).

#include "wifi_portal.h"

#if defined(ARDUINO)

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

namespace orobot {

namespace {

constexpr const char* kApPassword = nullptr;  // open network during provisioning
constexpr byte kDnsPort = 53;
constexpr uint16_t kHttpPort = 80;

// Single-page provisioning form. Inlined rather than SPIFFS-backed so the
// portal keeps working even on a fresh flash that hasn't partitioned SPIFFS.
constexpr const char* kPortalHtml =
    "<!doctype html><meta charset=utf-8>"
    "<title>orobot setup</title>"
    "<style>"
    "body{font:16px system-ui;margin:0;padding:40px 20px;background:#0f172a;color:#f1f5f9}"
    "main{max-width:360px;margin:0 auto}"
    "h1{font-size:22px;margin:0 0 24px}"
    "label{display:block;margin:16px 0 4px;font-size:13px;color:#94a3b8}"
    "input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;"
    "border:1px solid #334155;border-radius:8px;background:#1e293b;color:#f1f5f9}"
    "button{margin-top:24px;width:100%;padding:14px;font-size:16px;font-weight:600;"
    "background:#22d3ee;color:#0f172a;border:0;border-radius:8px}"
    "</style>"
    "<main>"
    "<h1>Connect your orobot</h1>"
    "<form method=POST action=/save>"
    "<label>Network name (SSID)<input name=ssid required maxlength=32></label>"
    "<label>Password<input name=pass type=password maxlength=63></label>"
    "<label>Pair code (from orobot.io &rarr; Devices)"
    "<input name=code inputmode=numeric pattern='[0-9]{6}' maxlength=6 "
    "placeholder='123456' required></label>"
    "<button type=submit>Save &amp; reboot</button>"
    "</form>"
    "</main>";

DNSServer g_dns;
WebServer g_http(kHttpPort);
WifiPortal* g_self = nullptr;

void handleRoot() { g_http.send(200, "text/html", kPortalHtml); }

void handleSave() {
  if (!g_self || !g_http.hasArg("ssid")) {
    g_http.send(400, "text/plain", "missing ssid");
    return;
  }
  WifiCreds creds;
  creds.ssid = g_http.arg("ssid");
  creds.password = g_http.arg("pass");
  const String code = g_http.arg("code");
  if (!g_self->credsWrite(creds, code)) {
    g_http.send(500, "text/plain", "nvs write failed");
    return;
  }
  g_http.send(200, "text/html",
              "<meta charset=utf-8><body style='font:16px system-ui;padding:40px'>"
              "<h1>Saved.</h1><p>Rebooting in 3 seconds…</p>");
  Serial.println("creds-received");
}

}  // namespace

String WifiPortal::apSsidFromMac(uint64_t mac) {
  char buf[18];
  snprintf(buf, sizeof(buf), "orobot-setup-%02X%02X",
           static_cast<uint8_t>((mac >> 8) & 0xFF),
           static_cast<uint8_t>(mac & 0xFF));
  return String(buf);
}

bool WifiPortal::begin(NvsStore* store) {
  store_ = store;
  g_self = this;

  WiFi.mode(WIFI_AP);
  const uint64_t mac = ESP.getEfuseMac();
  const String ssid = apSsidFromMac(mac);
  if (!WiFi.softAP(ssid.c_str(), kApPassword)) {
    Serial.println("ap-start-failed");
    return false;
  }
  Serial.print("ap-start ");
  Serial.println(ssid);

  // Hijack every DNS query so captive-portal detectors route to us.
  g_dns.start(kDnsPort, "*", WiFi.softAPIP());

  g_http.on("/", handleRoot);
  g_http.on("/save", HTTP_POST, handleSave);
  g_http.onNotFound(handleRoot);  // captive-portal catch-all
  g_http.begin();

  return true;
}

void WifiPortal::tick() {
  g_dns.processNextRequest();
  g_http.handleClient();
}

// Internal: called by handleSave to persist + flip the done flag. Not in the
// public header so the test build doesn't need HTTP handlers.
bool WifiPortal::credsWrite(const WifiCreds& creds, const String& pairCode) {
  if (!store_) return false;
  if (!store_->writeWifi(creds)) return false;
  if (pairCode.length() > 0 && !store_->writePairCode(pairCode)) return false;
  creds_received_ = true;
  return true;
}

}  // namespace orobot

#endif  // ARDUINO
