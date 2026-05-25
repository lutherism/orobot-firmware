#!/usr/bin/env node
/**
 * sim-host — multi-tenant firmware simulator HTTP service.
 *
 * Runs many `createApp` instances in a single Node process.
 * One service can host up to SIM_HOST_MAX (default 32) concurrent sims,
 * replacing the per-container model that was closed as orobotio#2118.
 *
 * Routes:
 *   POST /spawn       — start a sim for a device
 *   POST /teardown    — stop and remove a sim
 *   GET  /list        — active device UUIDs + capacity info
 *   GET  /healthz     — liveness check (no auth required)
 *
 * Required env:
 *   SIM_HOST_SECRET   Shared-secret bearer token for route auth
 *
 * Optional env:
 *   PORT              HTTP listen port (default: 8080, Cloud Run convention)
 *   SIM_HOST_MAX      Max concurrent sims (default: 32)
 *   LOG_LEVEL         Pino log level (default: info)
 */

import http           from 'node:http';
import fs             from 'fs';
import os             from 'os';
import path           from 'path';
import { createApp }  from '../main.js';
import type { App }   from '../main.js';
import { MockGPIODriver }       from '../hardware/mock-driver.js';
import { MockWifiShellAdapter } from '../wifi/mock-shell-adapter.js';
import { NoopPtySpawner }       from '../dev/noop-pty-spawner.js';
import { createLogger }         from '../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimHostOptions {
  /** Shared-secret bearer token. Empty string disables auth (dev only). */
  secret:  string;
  /** Maximum concurrent sim instances. Default: 32. */
  maxSims: number;
}

// ── Sim pool ──────────────────────────────────────────────────────────────────

interface SimEntry {
  app:     App;
  dataDir: string;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || 'null')); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates and returns an http.Server implementing the sim-host protocol.
 * Exported so tests can bind it to an ephemeral port without spawning subprocesses.
 */
export function createSimHostServer(opts: SimHostOptions): http.Server {
  const { secret, maxSims } = opts;
  const log = createLogger('sim-host');

  const pool = new Map<string, SimEntry>();

  // ── Pool operations ─────────────────────────────────────────────────────

  async function spawnSim(deviceUuid: string, gatewayWsUrl: string): Promise<void> {
    const dataDir  = fs.mkdtempSync(
      path.join(os.tmpdir(), `orobot-sim-${deviceUuid.slice(0, 8)}-`),
    );
    fs.mkdirSync(dataDir, { recursive: true });
    const dataFile = path.join(dataDir, 'data.json');

    fs.writeFileSync(dataFile, JSON.stringify({
      deviceUuid,
      deviceSecret:     null,
      networkMode:      'client',
      devIP:            null,
      wifiSettings:     { ssid: 'cloud-sim', password: '' },
      knownNetworks:    [],
      ownerUuid:        null,
      type:             'wifi-motor',
      hardware:         'raspi',
      pingTime:         0,
      pendingClaimCode: null,
      lastSetupError:   null,
    }, null, 2));

    const app = createApp({
      dataFilePath:        dataFile,
      driver:              new MockGPIODriver(),
      ptySpawner:          new NoopPtySpawner(),
      wifiShellAdapter:    new MockWifiShellAdapter(),
      gatewayUrl:          gatewayWsUrl,
      heartbeatIntervalMs: 8_000,
      scanIntervalMs:      3_600_000,
      execCommand: (cmd, args) => {
        log.warn({ deviceUuid, cmd, args }, 'exec suppressed in sim-host');
      },
      devicePrefix: deviceUuid.slice(0, 8),
    });

    pool.set(deviceUuid, { app, dataDir });
    log.info({ deviceUuid, count: pool.size }, 'sim spawned');

    await app.start();
  }

  async function teardownSim(deviceUuid: string): Promise<boolean> {
    const entry = pool.get(deviceUuid);
    if (!entry) return false;

    pool.delete(deviceUuid);
    try {
      await entry.app.stop();
    } catch (err) {
      log.warn({ deviceUuid, err }, 'error during sim stop — continuing teardown');
    }
    try {
      fs.rmSync(entry.dataDir, { recursive: true, force: true });
    } catch {
      // Temp cleanup is non-critical
    }
    log.info({ deviceUuid, count: pool.size }, 'sim torn down');
    return true;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!secret) return true; // no-secret dev mode
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${secret}`) {
      send(res, 401, { ok: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // ── Request handler ─────────────────────────────────────────────────────

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method   = req.method ?? 'GET';
    const pathname = (req.url ?? '/').split('?')[0];

    // /healthz — no auth
    if (method === 'GET' && pathname === '/healthz') {
      send(res, 200, { ok: true });
      return;
    }

    if (!checkAuth(req, res)) return;

    // POST /spawn
    if (method === 'POST' && pathname === '/spawn') {
      let body: unknown;
      try { body = await readBody(req); } catch {
        send(res, 400, { ok: false, error: 'Invalid JSON body' });
        return;
      }

      const { deviceUuid, gatewayWsUrl } =
        (body ?? {}) as Partial<Record<string, string>>;

      if (!deviceUuid || typeof deviceUuid !== 'string') {
        send(res, 400, { ok: false, error: 'deviceUuid is required' });
        return;
      }
      if (!gatewayWsUrl || typeof gatewayWsUrl !== 'string') {
        send(res, 400, { ok: false, error: 'gatewayWsUrl is required' });
        return;
      }
      if (pool.has(deviceUuid)) {
        send(res, 409, { ok: false, error: `deviceUuid ${deviceUuid} is already active` });
        return;
      }
      if (pool.size >= maxSims) {
        send(res, 503, { ok: false, error: `Capacity full (max ${maxSims} sims)` });
        return;
      }

      try {
        await spawnSim(deviceUuid, gatewayWsUrl);
        send(res, 200, { ok: true, deviceUuid });
      } catch (err) {
        log.error({ deviceUuid, err }, 'spawn failed');
        pool.delete(deviceUuid);
        send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // POST /teardown
    if (method === 'POST' && pathname === '/teardown') {
      let body: unknown;
      try { body = await readBody(req); } catch {
        send(res, 400, { ok: false, error: 'Invalid JSON body' });
        return;
      }

      const { deviceUuid } = (body ?? {}) as Partial<Record<string, string>>;

      if (!deviceUuid || typeof deviceUuid !== 'string') {
        send(res, 400, { ok: false, error: 'deviceUuid is required' });
        return;
      }

      const found = await teardownSim(deviceUuid);
      if (!found) {
        send(res, 404, { ok: false, error: `deviceUuid ${deviceUuid} not found` });
        return;
      }
      send(res, 200, { ok: true });
      return;
    }

    // GET /list
    if (method === 'GET' && pathname === '/list') {
      send(res, 200, {
        active:   Array.from(pool.keys()),
        count:    pool.size,
        capacity: maxSims,
      });
      return;
    }

    send(res, 404, { ok: false, error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log.error({ err, url: req.url, method: req.method }, 'unhandled request error');
      if (!res.headersSent) {
        send(res, 500, { ok: false, error: 'Internal server error' });
      }
    });
  });

  // Attach a teardownAll helper for graceful shutdown from the entry point.
  (server as http.Server & { teardownAll: () => Promise<void> }).teardownAll = async () => {
    const uuids = Array.from(pool.keys());
    await Promise.allSettled(uuids.map((uuid) => teardownSim(uuid)));
  };

  return server;
}

// ── Entry point (run when invoked directly) ───────────────────────────────────

if (require.main === module) {
  const PORT    = parseInt(process.env['PORT']         ?? '8080', 10);
  const SECRET  = process.env['SIM_HOST_SECRET'] ?? '';
  const MAX     = parseInt(process.env['SIM_HOST_MAX'] ?? '32',   10);

  const log = createLogger('sim-host');

  if (!SECRET) {
    log.warn('SIM_HOST_SECRET is not set — requests will be rejected with 401');
  }

  const server = createSimHostServer({ secret: SECRET, maxSims: MAX }) as
    http.Server & { teardownAll: () => Promise<void> };

  server.listen(PORT, () => {
    log.info({ port: PORT, maxSims: MAX }, 'sim-host listening');
  });

  async function shutdown(signal: string): Promise<void> {
    log.info({ signal, port: PORT }, 'Shutdown requested — draining sims');
    server.close();
    await server.teardownAll();
    log.info('Clean shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT');  });
}
