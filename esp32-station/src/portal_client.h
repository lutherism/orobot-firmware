#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

struct PortalRunResult {
  bool ok;
  String error;        // populated when !ok: "join-failed" | "post-failed" | "bad-status"
  String detail;       // human-readable detail
  int  postStatus;     // last HTTP status seen on /save POST (0 if not reached)
  unsigned long joinMs;
  unsigned long postMs;
};

// Joins `ssid` with `pass`, POSTs ssid/pass/code to http://<portalIp>/save,
// disconnects. Returns a populated PortalRunResult either way.
PortalRunResult runPortal(
  const String& ssid,
  const String& pass,
  const String& code,
  const String& portalIp
);
