#include "portal_client.h"
#include <WiFi.h>
#include <HTTPClient.h>

static bool waitForJoin(unsigned long timeoutMs) {
  unsigned long deadline = millis() + timeoutMs;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) delay(50);
  return WiFi.status() == WL_CONNECTED;
}

PortalRunResult runPortal(
  const String& ssid,
  const String& pass,
  const String& code,
  const String& portalIp
) {
  PortalRunResult r{};
  r.ok = false;

  unsigned long t0 = millis();
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  if (!waitForJoin(15000)) {
    r.error = "join-failed";
    r.detail = "WiFi.begin timed out";
    r.joinMs = millis() - t0;
    WiFi.disconnect(true, true);
    return r;
  }
  r.joinMs = millis() - t0;

  HTTPClient http;
  String url = String("http://") + portalIp + "/save";
  http.begin(url);
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  String body = "ssid=" + ssid + "&pass=" + pass + "&code=" + code;
  unsigned long t1 = millis();
  int status = http.POST(body);
  r.postMs = millis() - t1;
  r.postStatus = status;
  http.end();

  if (status < 200 || status >= 400) {
    r.error = (status <= 0) ? "post-failed" : "bad-status";
    r.detail = "HTTP " + String(status);
    WiFi.disconnect(true, true);
    return r;
  }

  WiFi.disconnect(true, true);
  r.ok = true;
  return r;
}
