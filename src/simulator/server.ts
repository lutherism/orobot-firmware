/**
 * Simulator Express server
 *
 * Serves the React dashboard and exposes REST + SSE endpoints that instrument
 * the DeviceRegistry (firmware instance pool).
 *
 * Additional peer deps required (not yet in package.json):
 *   npm install styled-components
 *   npm install -D esbuild @types/styled-components
 *
 * Start with:
 *   npx tsx src/simulator/server.ts
 * Or add to package.json scripts:
 *   "simulator": "tsx src/simulator/server.ts"
 */

import express, { Request, Response, NextFunction } from 'express';
import path    from 'path';
import fs      from 'fs';
import os      from 'os';
import { DeviceRegistry } from './DeviceRegistry.js';

// ── Bundle React app at startup ───────────────────────────────────────────────

const BUNDLE_OUT = path.join(os.tmpdir(), 'orobot-simulator-bundle.js');

async function buildClient(): Promise<void> {
  // esbuild is an optional devDependency — skip bundling if absent
  let esbuild: typeof import('esbuild');
  try {
    esbuild = await import('esbuild');
  } catch {
    console.warn('[simulator] esbuild not found — UI bundle unavailable. Install with: npm i -D esbuild');
    return;
  }

  const entryPoint = path.join(__dirname, 'client.tsx');
  if (!fs.existsSync(entryPoint)) {
    console.warn('[simulator] client.tsx not found — skipping bundle');
    return;
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle:      true,
    outfile:     BUNDLE_OUT,
    platform:    'browser',
    target:      'es2017',
    jsx:         'automatic',
    jsxImportSource: 'react',
    sourcemap:    true,
    define:      { 'process.env.NODE_ENV': '"production"' },
    minify:      false,
    logLevel:    'warning',
  });
  console.log('[simulator] client bundle written to', BUNDLE_OUT);
}

// ── HTML shell ────────────────────────────────────────────────────────────────

const HTML_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ORobot Device Simulator</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f1117; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="/bundle.js"></script>
</body>
</html>`;

// ── Captive portal mock data ───────────────────────────────────────────────────

export interface MockWifiNetwork {
  ssid:     string;
  signal:   number;  // dBm, e.g. -45
  security: 'WPA2' | 'WPA3' | 'open';
}

export const MOCK_WIFI_NETWORKS: MockWifiNetwork[] = [
  { ssid: 'HomeNetwork',    signal: -45, security: 'WPA2' },
  { ssid: 'OfficeWifi',     signal: -60, security: 'WPA2' },
  { ssid: 'CafeGuest',      signal: -72, security: 'open' },
  { ssid: 'IoTNetwork',     signal: -55, security: 'WPA2' },
  { ssid: 'Mobile_Hotspot', signal: -80, security: 'WPA2' },
];

/**
 * Simulate a password check for mock networks.
 * Open networks always succeed. WPA2/WPA3 require a password of at least 4 chars.
 */
export function mockWifiAccept(ssid: string, password: string): boolean {
  const network = MOCK_WIFI_NETWORKS.find(n => n.ssid === ssid);
  if (!network) return false;
  if (network.security === 'open') return true;
  return password.length >= 4;
}

// ── Captive portal HTML page ──────────────────────────────────────────────────

function buildPortalHtml(deviceId: string, deviceName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ORobot WiFi Setup — ${deviceName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117; color: #e2e8f0; min-height: 100vh;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 32px 16px;
    }
    .card {
      background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px;
      width: 100%; max-width: 420px; overflow: hidden;
    }
    .card-header {
      background: #141929; border-bottom: 1px solid #1e293b;
      padding: 16px 20px;
    }
    .card-header h1 { font-size: 15px; font-weight: 700; color: #7c3aed; }
    .card-header p  { font-size: 12px; color: #64748b; margin-top: 3px; }
    .network-list { padding: 8px 0; }
    .network-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 20px; cursor: pointer; transition: background 0.12s;
    }
    .network-item:hover { background: #111827; }
    .signal-bars { display: flex; align-items: flex-end; gap: 2px; flex-shrink: 0; }
    .signal-bars span {
      width: 4px; border-radius: 1px; background: #334155;
    }
    .signal-bars span.active { background: #3b82f6; }
    .network-name  { font-size: 13px; font-weight: 600; color: #e2e8f0; flex: 1; }
    .network-badge {
      font-size: 10px; padding: 1px 6px; border-radius: 3px;
      background: #0a1524; border: 1px solid #1e293b; color: #64748b;
    }
    .network-badge.open { color: #10b981; border-color: #064e3b; background: #022c22; }
    .divider { border: none; border-top: 1px solid #111827; margin: 0; }
    .connect-form { padding: 20px; }
    .connect-form h2 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin-bottom: 4px; }
    .connect-form p  { font-size: 11px; color: #64748b; margin-bottom: 14px; }
    label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
    input[type=password], input[type=text] {
      width: 100%; background: #111827; border: 1px solid #2d3748;
      border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #e2e8f0;
      outline: none; margin-bottom: 12px;
    }
    input:focus { border-color: #7c3aed; }
    .btn-row { display: flex; gap: 8px; }
    .btn {
      flex: 1; padding: 8px; border-radius: 6px; font-size: 12px;
      font-weight: 600; cursor: pointer; border: none;
    }
    .btn-primary { background: #7c3aed; color: white; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
    .error-msg  { font-size: 11px; color: #ef4444; margin-bottom: 10px; }
    .success-screen { padding: 32px 20px; text-align: center; }
    .success-icon { font-size: 40px; margin-bottom: 12px; }
    .success-screen h2 { font-size: 15px; font-weight: 700; color: #10b981; margin-bottom: 6px; }
    .success-screen p  { font-size: 12px; color: #64748b; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <h1>⬡ WiFi Setup</h1>
      <p>Simulated device: <strong style="color:#94a3b8">${deviceName}</strong></p>
    </div>

    <div id="network-list-view">
      <div class="network-list" id="network-list">
        <div style="padding:20px;text-align:center;color:#475569;font-size:12px">Scanning…</div>
      </div>
    </div>

    <div id="connect-form-view" class="hidden">
      <div class="connect-form">
        <h2 id="connect-ssid-title"></h2>
        <p id="connect-ssid-hint"></p>
        <div id="password-field">
          <label for="wifi-password">Password</label>
          <input type="password" id="wifi-password" placeholder="Enter WiFi password" autocomplete="off">
        </div>
        <div class="error-msg hidden" id="connect-error"></div>
        <div class="btn-row">
          <button class="btn btn-secondary" id="back-btn">Back</button>
          <button class="btn btn-primary" id="connect-btn">Connect</button>
        </div>
      </div>
    </div>

    <div id="success-view" class="hidden">
      <div class="success-screen">
        <div class="success-icon">✓</div>
        <h2>Connected!</h2>
        <p id="success-msg"></p>
        <p style="margin-top:10px;font-size:11px;color:#334155">You can close this tab.</p>
      </div>
    </div>
  </div>

  <script>
    const DEVICE_ID = ${JSON.stringify(deviceId)};
    let selectedSsid   = null;
    let selectedIsOpen = false;

    function signalBars(dbm) {
      const strength = dbm >= -50 ? 4 : dbm >= -60 ? 3 : dbm >= -70 ? 2 : 1;
      const heights  = [6, 10, 14, 18];
      return '<div class="signal-bars">' +
        heights.map((h, i) => \`<span style="height:\${h}px" class="\${i < strength ? 'active' : ''}"></span>\`).join('') +
        '</div>';
    }

    async function loadNetworks() {
      try {
        const res  = await fetch('/api/devices/' + DEVICE_ID + '/wifi');
        const data = await res.json();
        renderNetworks(data.networks);
      } catch {
        document.getElementById('network-list').innerHTML =
          '<div style="padding:20px;text-align:center;color:#ef4444;font-size:12px">Failed to scan networks</div>';
      }
    }

    function renderNetworks(networks) {
      const list = document.getElementById('network-list');
      if (!networks.length) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#475569;font-size:12px">No networks found</div>';
        return;
      }
      list.innerHTML = networks.map((n, i) =>
        (i > 0 ? '<hr class="divider">' : '') +
        \`<div class="network-item" data-ssid="\${n.ssid}" data-open="\${n.security === 'open'}">
          \${signalBars(n.signal)}
          <span class="network-name">\${n.ssid}</span>
          <span class="network-badge \${n.security === 'open' ? 'open' : ''}">\${n.security === 'open' ? 'Open' : n.security}</span>
        </div>\`
      ).join('');
      list.querySelectorAll('.network-item').forEach(el => {
        el.addEventListener('click', () => selectNetwork(el.dataset.ssid, el.dataset.open === 'true'));
      });
    }

    function selectNetwork(ssid, isOpen) {
      selectedSsid   = ssid;
      selectedIsOpen = isOpen;
      document.getElementById('connect-ssid-title').textContent = ssid;
      document.getElementById('connect-ssid-hint').textContent  = isOpen
        ? 'This is an open network — no password required.'
        : 'Enter the password for this network.';
      document.getElementById('password-field').classList.toggle('hidden', isOpen);
      document.getElementById('wifi-password').value = '';
      document.getElementById('connect-error').classList.add('hidden');
      document.getElementById('network-list-view').classList.add('hidden');
      document.getElementById('connect-form-view').classList.remove('hidden');
    }

    document.getElementById('back-btn').addEventListener('click', () => {
      document.getElementById('connect-form-view').classList.add('hidden');
      document.getElementById('network-list-view').classList.remove('hidden');
    });

    document.getElementById('connect-btn').addEventListener('click', async () => {
      const btn      = document.getElementById('connect-btn');
      const errEl    = document.getElementById('connect-error');
      const password = document.getElementById('wifi-password').value;
      btn.disabled   = true;
      btn.textContent = 'Connecting…';
      errEl.classList.add('hidden');
      try {
        const res  = await fetch('/api/devices/' + DEVICE_ID + '/wifi', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ssid: selectedSsid, password }),
        });
        const data = await res.json();
        if (data.ok) {
          document.getElementById('connect-form-view').classList.add('hidden');
          document.getElementById('success-msg').textContent =
            'Device is now connecting to "' + selectedSsid + '"';
          document.getElementById('success-view').classList.remove('hidden');
        } else {
          errEl.textContent = data.error || 'Connection failed. Try again.';
          errEl.classList.remove('hidden');
        }
      } catch {
        errEl.textContent = 'Network error — please try again.';
        errEl.classList.remove('hidden');
      }
      btn.disabled    = false;
      btn.textContent = 'Connect';
    });

    loadNetworks();

    // ── Live reload (dev mode) ──────────────────────────────────────────────
    // Connects to /api/portal-reload SSE. When the server restarts (tsx-watch),
    // the connection drops and reconnects with a new birth timestamp, triggering
    // a page reload so changes to this HTML template are instantly visible.
    (function () {
      let knownBirth = null;
      function connectReload() {
        const es = new EventSource('/api/portal-reload');
        es.onmessage = function (ev) {
          try {
            const data = JSON.parse(ev.data);
            if (knownBirth === null) {
              knownBirth = data.birth;
            } else if (data.birth !== knownBirth) {
              location.reload();
            }
          } catch {}
        };
        es.onerror = function () {
          es.close();
          setTimeout(connectReload, 1000);
        };
      }
      connectReload();
    })();
  </script>
</body>
</html>`;
}

// ── Server birth time (used by live-reload) ───────────────────────────────────

const SERVER_BIRTH = Date.now();

// ── Express app ───────────────────────────────────────────────────────────────

export function createServer(registry: DeviceRegistry) {
  const app = express();
  app.use(express.json());

  // ── Static: HTML shell + bundled React app ──────────────────────────────────

  app.get('/', (_req, res) => res.type('html').send(HTML_SHELL));

  app.get('/bundle.js', (_req, res) => {
    if (!fs.existsSync(BUNDLE_OUT)) {
      return res.status(503).send('// Bundle not available — run with esbuild installed');
    }
    res.type('js').sendFile(BUNDLE_OUT);
  });

  // ── SSE: real-time device state stream ──────────────────────────────────────
  //
  // Events pushed:
  //   { type: 'init',           devices: Device[] }
  //   { type: 'device-added',   device:  Device   }
  //   { type: 'device-updated', device:  Device   }
  //   { type: 'device-removed', id:      string   }

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    const send = (data: unknown) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Send current state immediately on connect
    send({ type: 'init', devices: registry.getAll() });

    // Forward all subsequent registry changes
    const onChange = (event: unknown) => send(event);
    registry.on('change', onChange);

    // Heartbeat to keep connection alive through proxies
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

    req.on('close', () => {
      registry.off('change', onChange);
      clearInterval(heartbeat);
    });
  });

  // ── REST: device management ─────────────────────────────────────────────────

  /** List all devices */
  app.get('/api/devices', (_req, res) => {
    res.json({ devices: registry.getAll() });
  });

  /** Spawn a new device */
  app.post('/api/devices', async (req, res, next) => {
    try {
      const { name } = req.body as { name?: string };
      const device = await registry.spawn(name);
      res.status(201).json({ device });
    } catch (err) { next(err); }
  });

  /** Kill a device */
  app.delete('/api/devices/:id', async (req, res, next) => {
    try {
      await registry.kill(req.params.id);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  /** Connect a device (start firmware → gateway connection) */
  app.post('/api/devices/:id/connect', async (req, res, next) => {
    try {
      await registry.setConnected(req.params.id, true);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  /** Disconnect a device */
  app.post('/api/devices/:id/disconnect', async (req, res, next) => {
    try {
      await registry.setConnected(req.params.id, false);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  /** Power a device on or off */
  app.post('/api/devices/:id/power', async (req, res, next) => {
    try {
      const { on } = req.body as { on: boolean };
      if (typeof on !== 'boolean') {
        return res.status(400).json({ error: '`on` must be a boolean' });
      }
      await registry.setPower(req.params.id, on);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // ── Portal live-reload (SSE) ─────────────────────────────────────────────────
  //
  // The portal page connects here. On connect it receives the server birth time.
  // When tsx-watch restarts the process, the SSE connection drops and reconnects
  // with a new birth time, which the portal page uses to trigger a page reload.

  app.get('/api/portal-reload', (_req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ birth: SERVER_BIRTH })}\n\n`);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    _req.on('close', () => clearInterval(heartbeat));
  });

  // ── Captive portal simulation ────────────────────────────────────────────────

  /** Serve the WiFi captive portal page for a device */
  app.get('/portal/:id', (req, res) => {
    const device = registry.getById(req.params.id);
    if (!device) return res.status(404).send('Device not found');
    res.type('html').send(buildPortalHtml(device.id, device.name));
  });

  /** Return mock WiFi networks for a device */
  app.get('/api/devices/:id/wifi', (req, res) => {
    if (!registry.getById(req.params.id)) {
      return res.status(404).json({ error: 'device not found' });
    }
    res.json({ networks: MOCK_WIFI_NETWORKS });
  });

  /** Simulate connecting to a WiFi network */
  app.post('/api/devices/:id/wifi', (req, res) => {
    if (!registry.getById(req.params.id)) {
      return res.status(404).json({ error: 'device not found' });
    }
    const { ssid, password = '' } = req.body as { ssid?: string; password?: string };
    if (!ssid) return res.status(400).json({ error: 'ssid is required' });
    if (mockWifiAccept(ssid, password)) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: 'Incorrect password. Try again.' });
    }
  });

  // ── Error handler ───────────────────────────────────────────────────────────

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err.message });
  });

  return app;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const PORT = parseInt(process.env.PORT ?? '4000', 10);

  await buildClient();

  const registry = new DeviceRegistry();
  await registry.restore();
  const server   = createServer(registry);

  const http = server.listen(PORT, () => {
    console.log('');
    console.log('┌─ orobot device simulator ──────────────────────────────────────────┐');
    console.log(`│  Dashboard  : http://localhost:${PORT}`.padEnd(71) + '│');
    console.log(`│  API        : http://localhost:${PORT}/api/devices`.padEnd(71) + '│');
    console.log(`│  Events SSE : http://localhost:${PORT}/api/events`.padEnd(71) + '│');
    console.log('└────────────────────────────────────────────────────────────────────┘');
    console.log('');
  });

  const shutdown = async () => {
    console.log('[simulator] shutting down...');
    registry.destroy();
    http.close(() => process.exit(0));
  };

  process.on('SIGINT',  () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Run when invoked directly (not imported as a module)
if (process.argv[1] === __filename || process.argv[1]?.endsWith('server.ts')) {
  main().catch(err => {
    console.error('[simulator] fatal:', err);
    process.exit(1);
  });
}
