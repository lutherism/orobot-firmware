// GENERATED FILE — DO NOT EDIT.
// Source: esp32/portal/index.html
// Regenerate: cd esp32 && node portal/build.mjs
//
// Captive-portal HTML inlined as a constexpr. Inlined (rather than
// SPIFFS/LittleFS-backed) so the portal works on a fresh flash with no
// filesystem partition. See esp32/portal/ for the editable source + a
// browser-iterable dev server.

#pragma once

namespace orobot {

constexpr const char* kPortalHtml = R"OROBOT_PORTAL(<!doctype html>
<meta charset=utf-8>
<title>orobot setup</title>
<style>
  body{font:16px system-ui;margin:0;padding:40px 20px;background:#0f172a;color:#f1f5f9}
  main{max-width:360px;margin:0 auto}
  h1{font-size:22px;margin:0 0 24px}
  label{display:block;margin:16px 0 4px;font-size:13px;color:#94a3b8}
  input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;
    border:1px solid #334155;border-radius:8px;background:#1e293b;color:#f1f5f9}
  button{margin-top:24px;width:100%;padding:14px;font-size:16px;font-weight:600;
    background:#22d3ee;color:#0f172a;border:0;border-radius:8px}
</style>
<main>
  <h1>Connect your orobot</h1>
  <form method=POST action=/save>
    <label>Network name (SSID)<input name=ssid required maxlength=32></label>
    <label>Password<input name=pass type=password maxlength=63></label>
    <label>Pair code (from orobot.io &rarr; Devices)<input name=code inputmode=numeric pattern='[0-9]{6}' maxlength=6 placeholder='123456' required></label>
    <button type=submit>Save &amp; reboot</button>
  </form>
</main>
)OROBOT_PORTAL";

}  // namespace orobot
