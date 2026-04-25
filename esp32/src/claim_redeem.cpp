#if defined(ARDUINO)

#include "claim_redeem.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>

namespace orobot {

namespace {

// Convert the compile-time gateway WS URL to its HTTP twin:
//   ws://host:port/device  →  http://host:port/api/device/claim-code/redeem
//   wss://host:port/device → https://host:port/api/device/claim-code/redeem
String redeemUrl() {
  String url(OROBOT_GATEWAY_URL);
  if (url.startsWith("ws://"))  url = String("http://")  + url.substring(5);
  else if (url.startsWith("wss://")) url = String("https://") + url.substring(6);
  const int slash = url.indexOf('/', 8);  // skip past scheme://
  const String base = (slash < 0) ? url : url.substring(0, slash);
  return base + "/api/device/claim-code/redeem";
}

}  // namespace

bool redeemPairCode(const String& deviceUuid, const String& code) {
  const String url = redeemUrl();
  Serial.print("redeem POST ");
  Serial.println(url);

  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(url)) {
    Serial.println("redeem-http-begin-failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["code"] = code;
  doc["deviceUuid"] = deviceUuid;
  String body;
  serializeJson(doc, body);

  const int status = http.POST(body);
  const String response = http.getString();
  http.end();

  Serial.print("redeem status=");
  Serial.print(status);
  Serial.print(" body=");
  Serial.println(response);

  return status == 200;
}

}  // namespace orobot

#endif  // ARDUINO
