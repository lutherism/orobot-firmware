#include <Arduino.h>
#include <ArduinoJson.h>
#include "portal_client.h"

static String inbuf;

static void emit(const JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  Serial.println(out);
}

static void handleLine(const String& line) {
  StaticJsonDocument<512> req;
  if (deserializeJson(req, line) != DeserializationError::Ok) {
    StaticJsonDocument<128> err;
    err["event"] = "parse-error";
    err["raw"] = line;
    emit(err);
    return;
  }
  const char* cmd = req["cmd"] | "";
  if (strcmp(cmd, "run-portal") == 0) {
    PortalRunResult r = runPortal(
      String((const char*)(req["ssid"] | "")),
      String((const char*)(req["pass"] | "")),
      String((const char*)(req["code"] | "")),
      String((const char*)(req["portalIp"] | "192.168.4.1"))
    );
    StaticJsonDocument<512> resp;
    resp["event"] = "portal-result";
    resp["ok"] = r.ok;
    if (!r.ok) {
      resp["error"] = r.error;
      resp["detail"] = r.detail;
    }
    JsonObject obs = resp.createNestedObject("observed");
    obs["joinMs"] = r.joinMs;
    obs["postMs"] = r.postMs;
    obs["postStatus"] = r.postStatus;
    emit(resp);
  } else {
    StaticJsonDocument<128> err;
    err["event"] = "unknown-cmd";
    err["cmd"] = cmd;
    emit(err);
  }
}

void setup() {
  Serial.begin(115200);
  StaticJsonDocument<128> boot;
  boot["event"] = "boot";
  boot["version"] = STATION_FIRMWARE_VERSION;
  emit(boot);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      String line = inbuf;
      inbuf = "";
      line.trim();
      if (line.length() > 0) handleLine(line);
    } else if (c != '\r') {
      inbuf += c;
      if (inbuf.length() > 1024) inbuf = "";  // overrun guard
    }
  }
  delay(1);
}
