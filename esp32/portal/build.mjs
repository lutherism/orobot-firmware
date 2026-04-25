#!/usr/bin/env node
// Generate src/portal_html.h from portal/index.html.
//
// Output is a single C++ header declaring `kPortalHtml` as a raw string
// literal. R-string delimiter `OROBOT_PORTAL` is long enough that we never
// collide with anything inside an HTML/CSS document.
//
// Invoked two ways:
//   1. `node portal/build.mjs` — manual / npm script
//   2. PlatformIO pre-script (portal/build.py) — every firmware build

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, "index.html");
const outPath = resolve(here, "..", "src", "portal_html.h");
const delim = "OROBOT_PORTAL";

const html = readFileSync(htmlPath, "utf8");
if (html.includes(`)${delim}"`)) {
  throw new Error(
    `index.html contains the R-string delimiter ")${delim}"; pick a different one.`,
  );
}

const header = `// GENERATED FILE — DO NOT EDIT.
// Source: esp32/portal/index.html
// Regenerate: cd esp32 && node portal/build.mjs
//
// Captive-portal HTML inlined as a constexpr. Inlined (rather than
// SPIFFS/LittleFS-backed) so the portal works on a fresh flash with no
// filesystem partition. See esp32/portal/ for the editable source + a
// browser-iterable dev server.

#pragma once

namespace orobot {

constexpr const char* kPortalHtml = R"${delim}(${html})${delim}";

}  // namespace orobot
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header);
console.log(`portal/build.mjs -> ${outPath} (${html.length} bytes html)`);
