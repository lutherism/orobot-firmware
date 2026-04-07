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
