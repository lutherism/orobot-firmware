#!/usr/bin/env node
/**
 * Headless firmware simulator — Cloud Run entry point.
 *
 * Reads identity from env vars, forces mock hardware, and runs the real
 * firmware bootstrap (`createApp`) exactly as a Raspberry Pi would — same
 * code paths, real WS protocol, mocked GPIO/WiFi/PTY only.
 *
 * Required env:
 *   GATEWAY_WS_URL   WebSocket URL of the /device endpoint
 *                    e.g. wss://robots-gateway-779307899828.us-west2.run.app/device
 *   DEVICE_UUID      UUID of an already-registered device record in the gateway
 *
 * Optional env:
 *   DEVICE_SECRET    Device secret for REST auth (camera push, heartbeat session)
 *   LOG_LEVEL        Pino log level (default: info)
 *   HEARTBEAT_MS     Heartbeat interval ms (default: 8000)
 *   SCAN_INTERVAL_MS WiFi scan poll ms (default: 3600000 — effectively disabled)
 *   OROBOT_DATA_DIR  Override path for data.json (default: /tmp/orobot-sim-<uuid>/)
 */

import fs            from 'fs';
import os            from 'os';
import path          from 'path';
import { createApp } from '../main.js';
import { MockGPIODriver }       from '../hardware/mock-driver.js';
import { MockWifiShellAdapter } from '../wifi/mock-shell-adapter.js';
import { NoopPtySpawner }       from '../dev/noop-pty-spawner.js';
import { createLogger }         from '../core/logger.js';

// ── Validate required env ─────────────────────────────────────────────────────

const GATEWAY_WS_URL = process.env['GATEWAY_WS_URL'];
const DEVICE_UUID    = process.env['DEVICE_UUID'];
const DEVICE_SECRET  = process.env['DEVICE_SECRET'];

if (!GATEWAY_WS_URL) {
  console.error(
    JSON.stringify({
      level:   'error',
      time:    Date.now(),
      msg:     'GATEWAY_WS_URL is required but not set',
      hint:    'Set GATEWAY_WS_URL to the /device WebSocket endpoint of your gateway',
    }),
  );
  process.exit(1);
}

if (!DEVICE_UUID) {
  console.error(
    JSON.stringify({
      level:   'error',
      time:    Date.now(),
      msg:     'DEVICE_UUID is required but not set',
      hint:    'Set DEVICE_UUID to a UUID that has already been registered with the gateway',
    }),
  );
  process.exit(1);
}

// Force mock platform so selectDriver() returns MockGPIODriver and the WiFi
// state machine uses the mock adapter (no real GPIO/hostapd invocations).
process.env['OROBOT_PLATFORM'] = 'mock';

// ── Logger ────────────────────────────────────────────────────────────────────

const log = createLogger('headless-sim', DEVICE_UUID.slice(0, 8));

// ── Data file ─────────────────────────────────────────────────────────────────
//
// DeviceStateService reads identity from data.json. We write a minimal file
// that sets networkMode=client so GatewayClient connects immediately
// (no AP / captive-portal flow) and injects the device identity from env.

const dataDir = process.env['OROBOT_DATA_DIR']
  ?? fs.mkdtempSync(path.join(os.tmpdir(), `orobot-sim-${DEVICE_UUID.slice(0, 8)}-`));

const dataFile = path.join(dataDir, 'data.json');

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(dataFile, JSON.stringify({
  deviceUuid:    DEVICE_UUID,
  deviceSecret:  DEVICE_SECRET ?? null,
  networkMode:   'client',
  devIP:         null,
  wifiSettings:  { ssid: 'cloud-sim', password: '' },
  knownNetworks: [],
  ownerUuid:     null,
  type:          'wifi-motor',
  hardware:      'raspi',
  pingTime:      0,
  pendingClaimCode:  null,
  lastSetupError:    null,
}, null, 2));

log.info({ gatewayUrl: GATEWAY_WS_URL, deviceUuid: DEVICE_UUID, dataFile }, 'Headless simulator starting');

// ── App ───────────────────────────────────────────────────────────────────────

const heartbeatMs   = parseInt(process.env['HEARTBEAT_MS']     ?? '8000',   10);
const scanIntervalMs = parseInt(process.env['SCAN_INTERVAL_MS'] ?? '3600000', 10);

const app = createApp({
  dataFilePath:     dataFile,
  driver:           new MockGPIODriver(),
  ptySpawner:       new NoopPtySpawner(),
  wifiShellAdapter: new MockWifiShellAdapter(),
  gatewayUrl:       GATEWAY_WS_URL,
  heartbeatIntervalMs: heartbeatMs,
  scanIntervalMs,
  execCommand: (cmd, args) => {
    log.warn({ cmd, args }, 'exec suppressed in simulator (reboot/update no-op)');
  },
  devicePrefix: DEVICE_UUID.slice(0, 8),
});

// ── Bus logging ───────────────────────────────────────────────────────────────

app.bus.on('network:connected',     ({ url }) =>
  log.info({ event: 'network:connected', url }, 'Connected to gateway'));

app.bus.on('network:disconnected',  ({ reason }) =>
  log.info({ event: 'network:disconnected', reason }, 'Disconnected from gateway'));

app.bus.on('network:message',       ({ type, data }) =>
  log.debug({ event: 'network:message', type, data }, 'Command received'));

app.bus.on('hardware:motor-moved',  ({ angle }) =>
  log.debug({ event: 'motor:moved', angle }, 'Motor moved'));

app.bus.on('system:heartbeat-sent', ({ pingTime }) =>
  log.debug({ event: 'heartbeat', pingTime }, 'Heartbeat sent'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Shutdown requested — stopping firmware');
  try {
    await app.stop();
    log.info('Clean shutdown complete');
  } catch (err) {
    log.error({ err }, 'Error during shutdown');
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT');  });

app.start().catch((err: unknown) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
