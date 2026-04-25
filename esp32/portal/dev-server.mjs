#!/usr/bin/env node
// Local dev server for the captive portal.
//
// Serves index.html at / and stubs POST /save (logs the form, returns the
// same success page the firmware sends). Iterate on the HTML/CSS in a real
// browser at http://localhost:5555 — no firmware in the loop.
//
// `npm run portal-dev` from esp32/portal/.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 5555;

const successPage =
  "<meta charset=utf-8><body style='font:16px system-ui;padding:40px'>" +
  "<h1>Saved.</h1><p>Rebooting in 3 seconds…</p>";

createServer((req, res) => {
  if (req.method === "GET") {
    const html = readFileSync(resolve(here, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const fields = Object.fromEntries(new URLSearchParams(body));
      console.log("POST /save", fields);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(successPage);
    });
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => {
  console.log(`portal dev server: http://localhost:${port}`);
});
