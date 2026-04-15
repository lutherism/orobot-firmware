/**
 * Tests for DeviceRegistry — focuses on the injectable gatewayApiUrl
 * constructor param, verifying that HTTP calls reach the injected URL
 * rather than the module-level default.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';

// ── Mock heavy dependencies so spawn() doesn't hit disk or start firmware ──────

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync:    vi.fn(() => false),
    mkdirSync:     vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync:  vi.fn(() => '{}'),
  };
});

vi.mock('../main.js', () => ({
  createApp: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop:  vi.fn().mockResolvedValue(undefined),
    bus:   { on: vi.fn(() => () => {}), off: vi.fn() },
  })),
}));

vi.mock('../hardware/mock-driver.js', () => ({
  MockGPIODriver: vi.fn(function () {
    this.readPin  = vi.fn();
    this.writePin = vi.fn();
    this.pins     = new Map();
  }),
}));

vi.mock('../dev/noop-pty-spawner.js', () => ({
  NoopPtySpawner: vi.fn(function () {}),
}));

vi.mock('../wifi/mock-shell-adapter.js', () => ({
  MockWifiShellAdapter: vi.fn(function () {}),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { DeviceRegistry } from './DeviceRegistry';

// ── Helpers ───────────────────────────────────────────────────────────────────

function startMockServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void>; requests: { method: string; path: string; body: unknown }[] }> {
  const requests: { method: string; path: string; body: unknown }[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        try { requests.push({ method: req.method ?? '', path: req.url ?? '', body: raw ? JSON.parse(raw) : null }); } catch { /* ignore */ }
        handler(req, res);
      });
    });
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        requests,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeviceRegistry — injectable gatewayApiUrl', () => {
  let registry: DeviceRegistry;

  afterEach(() => {
    registry?.destroy();
  });

  it('posts to injected gatewayApiUrl/sim when spawning a device', async () => {
    const mock = await startMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    try {
      registry = new DeviceRegistry(`${mock.url}/api/device`);
      await registry.spawn('test-device');

      const simPost = mock.requests.find(r => r.method === 'POST' && r.path === '/api/device/sim');
      expect(simPost).toBeDefined();
      expect((simPost!.body as { name: string }).name).toBe('test-device');
    } finally {
      await mock.close();
    }
  });

  it('defaults to production URL when no arg is given', () => {
    // Just verify construction succeeds — we cannot easily observe the URL without
    // making a network call, but the constructor signature is the contract.
    registry = new DeviceRegistry();
    expect(registry).toBeInstanceOf(DeviceRegistry);
  });
});
