/**
 * Unit tests for the sim-host HTTP service.
 *
 * `createApp` is mocked — no WS connections are opened.
 * Tests exercise route logic, auth, capacity enforcement, and graceful teardown.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import http from 'node:http';
import type { App, AppOptions } from '../main.js';

// ── Mock hardware / platform deps ──────────────────────────────────────────────

vi.mock('../hardware/mock-driver.js', () => ({
  MockGPIODriver: class {},
}));
vi.mock('../wifi/mock-shell-adapter.js', () => ({
  MockWifiShellAdapter: class {},
}));
vi.mock('../dev/noop-pty-spawner.js', () => ({
  NoopPtySpawner: class {
    spawn() { return { write() {}, kill() {}, on() {} }; }
  },
}));

// ── Mock createApp ────────────────────────────────────────────────────────────
//
// Each call returns a fresh App stub. We track them so tests can verify
// start/stop call counts.

interface MockApp extends App {
  startCalls: number;
  stopCalls:  number;
}

const createdApps: MockApp[] = [];

vi.mock('../main.js', () => ({
  createApp: vi.fn((_opts: AppOptions): App => {
    const stub: MockApp = {
      startCalls: 0,
      stopCalls:  0,
      bus:  { on: vi.fn(() => vi.fn()), emit: vi.fn() } as unknown as App['bus'],
      state: { get: vi.fn(() => ({ deviceUuid: 'stub' })) } as unknown as App['state'],
      start: vi.fn(),
      stop:  vi.fn(),
    };
    stub.start = vi.fn(async () => { stub.startCalls++; });
    stub.stop  = vi.fn(async () => { stub.stopCalls++;  });
    createdApps.push(stub);
    return stub;
  }),
}));

// ── Import after mocks are registered ─────────────────────────────────────────

import { createSimHostServer } from './server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-xyz';

function listenOnFreePort(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { reject(new Error('No address')); return; }
      resolve(`http://127.0.0.1:${addr.port}`);
    });
    server.on('error', reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function post(url: string, body: unknown, token?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, json };
}

async function get(url: string, token?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(url, { headers });
  const json = await res.json();
  return { status: res.status, json };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('sim-host server', () => {
  let server: http.Server;
  let base:   string;

  beforeEach(async () => {
    createdApps.length = 0;
    vi.clearAllMocks();
    server = createSimHostServer({ secret: SECRET, maxSims: 3 });
    base   = await listenOnFreePort(server);
  });

  afterEach(async () => {
    await closeServer(server);
  });

  // ── /healthz ─────────────────────────────────────────────────────────────

  it('GET /healthz returns 200 without auth', async () => {
    const r = await get(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('POST /spawn returns 401 with no auth header', async () => {
    const r = await post(`${base}/spawn`, { deviceUuid: 'u1', gatewayWsUrl: 'ws://x' });
    expect(r.status).toBe(401);
  });

  it('POST /spawn returns 401 with wrong secret', async () => {
    const r = await post(`${base}/spawn`, { deviceUuid: 'u1', gatewayWsUrl: 'ws://x' }, 'wrong-token');
    expect(r.status).toBe(401);
  });

  it('GET /list returns 401 without auth', async () => {
    const r = await get(`${base}/list`);
    expect(r.status).toBe(401);
  });

  it('POST /teardown returns 401 without auth', async () => {
    const r = await post(`${base}/teardown`, { deviceUuid: 'u1' });
    expect(r.status).toBe(401);
  });

  // ── POST /spawn happy path ────────────────────────────────────────────────

  it('POST /spawn starts a sim and returns ok', async () => {
    const r = await post(
      `${base}/spawn`,
      { deviceUuid: 'device-aaa', gatewayWsUrl: 'ws://localhost:1/device' },
      SECRET,
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, deviceUuid: 'device-aaa' });
    expect(createdApps).toHaveLength(1);
    expect(createdApps[0].startCalls).toBe(1);
  });

  // ── POST /spawn duplicate rejection ──────────────────────────────────────

  it('POST /spawn returns 409 for duplicate deviceUuid', async () => {
    await post(`${base}/spawn`, { deviceUuid: 'dup', gatewayWsUrl: 'ws://x' }, SECRET);
    const r2 = await post(`${base}/spawn`, { deviceUuid: 'dup', gatewayWsUrl: 'ws://x' }, SECRET);
    expect(r2.status).toBe(409);
    expect((r2.json as Record<string, unknown>).ok).toBe(false);
  });

  // ── POST /spawn capacity enforcement ─────────────────────────────────────

  it('POST /spawn returns 503 when at capacity (max=3)', async () => {
    await post(`${base}/spawn`, { deviceUuid: 'd1', gatewayWsUrl: 'ws://x' }, SECRET);
    await post(`${base}/spawn`, { deviceUuid: 'd2', gatewayWsUrl: 'ws://x' }, SECRET);
    await post(`${base}/spawn`, { deviceUuid: 'd3', gatewayWsUrl: 'ws://x' }, SECRET);
    const r4 = await post(`${base}/spawn`, { deviceUuid: 'd4', gatewayWsUrl: 'ws://x' }, SECRET);
    expect(r4.status).toBe(503);
    expect((r4.json as Record<string, unknown>).ok).toBe(false);
  });

  // ── POST /teardown happy path ─────────────────────────────────────────────

  it('POST /teardown stops a running sim and calls app.stop()', async () => {
    await post(`${base}/spawn`, { deviceUuid: 'tear-me', gatewayWsUrl: 'ws://x' }, SECRET);
    const r = await post(`${base}/teardown`, { deviceUuid: 'tear-me' }, SECRET);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(createdApps[0].stopCalls).toBe(1);
  });

  // ── POST /teardown 404 ────────────────────────────────────────────────────

  it('POST /teardown returns 404 for unknown deviceUuid', async () => {
    const r = await post(`${base}/teardown`, { deviceUuid: 'nobody' }, SECRET);
    expect(r.status).toBe(404);
    expect((r.json as Record<string, unknown>).ok).toBe(false);
  });

  // ── GET /list ─────────────────────────────────────────────────────────────

  it('GET /list returns active UUIDs, count, and capacity', async () => {
    await post(`${base}/spawn`, { deviceUuid: 'ls-1', gatewayWsUrl: 'ws://x' }, SECRET);
    await post(`${base}/spawn`, { deviceUuid: 'ls-2', gatewayWsUrl: 'ws://x' }, SECRET);

    const r = await get(`${base}/list`, SECRET);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, unknown>;
    expect(body.count).toBe(2);
    expect(body.capacity).toBe(3);
    expect(body.active).toEqual(expect.arrayContaining(['ls-1', 'ls-2']));
  });

  // ── POST /spawn — missing fields ──────────────────────────────────────────

  it('POST /spawn returns 400 when deviceUuid is missing', async () => {
    const r = await post(`${base}/spawn`, { gatewayWsUrl: 'ws://x' }, SECRET);
    expect(r.status).toBe(400);
  });

  it('POST /spawn returns 400 when gatewayWsUrl is missing', async () => {
    const r = await post(`${base}/spawn`, { deviceUuid: 'u1' }, SECRET);
    expect(r.status).toBe(400);
  });
});
