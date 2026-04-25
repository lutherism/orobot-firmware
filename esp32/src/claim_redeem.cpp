#if defined(ARDUINO)

#include "claim_redeem.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>

#include "lib/url_transform.h"

namespace orobot {

namespace {

// Pure helper does the actual ws→http transform; we just adapt to Arduino's
// String here. See src/lib/url_transform.h for the host-tested logic.
String redeemUrl() {
  const std::string s = toHttpApiUrl(OROBOT_GATEWAY_URL,
                                     "/api/device/claim-code/redeem");
  return String(s.c_str());
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
