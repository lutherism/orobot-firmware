/**
 * Tests for simulator server — captive portal routes.
 *
 * Uses a stub DeviceRegistry so we don't need real firmware instances.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createServer, MOCK_WIFI_NETWORKS, mockWifiAccept } from './server';
import type { DeviceRegistry } from './DeviceRegistry';
import type { Device } from './types';

// ── Stub registry ─────────────────────────────────────────────────────────────

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id:     'device-1',
    name:   'sim-01',
    uuid:   'aaaa-1111',
    status: 'disconnected',
    uptime: '0s',
    pins:   [],
    events: [],
    ...overrides,
  };
}

function makeRegistry(devices: Device[] = [makeDevice()]): DeviceRegistry {
  return {
    getAll:      vi.fn(() => devices),
    getById:     vi.fn((id: string) => devices.find(d => d.id === id)),
    on:          vi.fn(),
    off:         vi.fn(),
    spawn:       vi.fn(),
    kill:        vi.fn(),
    setPower:    vi.fn(),
    setConnected: vi.fn(),
    restore:     vi.fn(),
    destroy:     vi.fn(),
  } as unknown as DeviceRegistry;
}

// ── mockWifiAccept unit tests ─────────────────────────────────────────────────

describe('mockWifiAccept', () => {
  it('returns false for unknown SSID', () => {
    expect(mockWifiAccept('Unknown', 'password')).toBe(false);
  });

  it('returns true for open network regardless of password', () => {
    expect(mockWifiAccept('CafeGuest', '')).toBe(true);
    expect(mockWifiAccept('CafeGuest', 'anything')).toBe(true);
  });

  it('returns false for WPA2 with short password', () => {
    expect(mockWifiAccept('HomeNetwork', 'abc')).toBe(false);
    expect(mockWifiAccept('HomeNetwork', '')).toBe(false);
  });

  it('returns true for WPA2 with password of at least 4 chars', () => {
    expect(mockWifiAccept('HomeNetwork', 'abcd')).toBe(true);
    expect(mockWifiAccept('OfficeWifi', 'mysecret')).toBe(true);
  });
});

// ── Portal live-reload SSE ────────────────────────────────────────────────────

describe('GET /api/portal-reload', () => {
  it('returns SSE content-type and birth timestamp in first chunk', () =>
    new Promise<void>((resolve, reject) => {
      const app    = createServer(makeRegistry());
      const server = app.listen(0, () => {
        const addr   = server.address() as { port: number };
        const http   = require('http') as typeof import('http');
        const req    = http.get(`http://localhost:${addr.port}/api/portal-reload`, res => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          let buf = '';
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            if (buf.includes('\n\n')) {
              req.destroy();
              server.close();
              const line = buf.split('\n').find(l => l.startsWith('data: '));
              const payload = JSON.parse(line!.slice('data: '.length));
              expect(typeof payload.birth).toBe('number');
              expect(payload.birth).toBeGreaterThan(0);
              resolve();
            }
          });
          res.on('error', (e) => { server.close(); reject(e); });
        });
        req.on('error', (e) => { server.close(); reject(e); });
      });
    }));
});

// ── Portal routes ─────────────────────────────────────────────────────────────

describe('GET /portal/:id', () => {
  it('returns 404 for unknown device', async () => {
    const app = createServer(makeRegistry([]));
    const res = await supertest(app).get('/portal/unknown-id');
    expect(res.status).toBe(404);
  });

  it('returns HTML page for known device', async () => {
    const app = createServer(makeRegistry());
    const res = await supertest(app).get('/portal/device-1');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('sim-01');
    expect(res.text).toContain('WiFi Setup');
  });

  it('embeds device id in the portal config', async () => {
    const app = createServer(makeRegistry());
    const res = await supertest(app).get('/portal/device-1');
    expect(res.text).toContain('/api/devices/device-1/wifi');
  });
});

// ── GET /api/devices/:id/wifi ─────────────────────────────────────────────────

describe('GET /api/devices/:id/wifi', () => {
  it('returns 404 for unknown device', async () => {
    const app = createServer(makeRegistry([]));
    const res = await supertest(app).get('/api/devices/nope/wifi');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'device not found' });
  });

  it('returns mock network list for known device', async () => {
    const app = createServer(makeRegistry());
    const res = await supertest(app).get('/api/devices/device-1/wifi');
    expect(res.status).toBe(200);
    expect(res.body.networks).toEqual(MOCK_WIFI_NETWORKS);
    expect(res.body.networks.length).toBeGreaterThan(0);
  });
});

// ── POST /api/devices/:id/wifi ────────────────────────────────────────────────

describe('POST /api/devices/:id/wifi', () => {
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    app = createServer(makeRegistry());
  });

  it('returns 404 for unknown device', async () => {
    const res = await supertest(app)
      .post('/api/devices/nope/wifi')
      .send({ ssid: 'HomeNetwork', password: 'secret' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when ssid is missing', async () => {
    const res = await supertest(app)
      .post('/api/devices/device-1/wifi')
      .send({ password: 'secret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ssid/i);
  });

  it('accepts an open network without a password', async () => {
    const res = await supertest(app)
      .post('/api/devices/device-1/wifi')
      .send({ ssid: 'CafeGuest', password: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('accepts WPA2 network with valid password', async () => {
    const res = await supertest(app)
      .post('/api/devices/device-1/wifi')
      .send({ ssid: 'HomeNetwork', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects WPA2 network with short password', async () => {
    const res = await supertest(app)
      .post('/api/devices/device-1/wifi')
      .send({ ssid: 'HomeNetwork', password: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  it('rejects unknown SSID', async () => {
    const res = await supertest(app)
      .post('/api/devices/device-1/wifi')
      .send({ ssid: 'NoSuchNetwork', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});
