import { describe, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { CaptivePortalServer } from './captive-portal';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import type { ScanResult } from '../core/types';
import type { WifiManager } from './wifi-manager';

function makeTmpState(): DeviceStateService {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-portal-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid:    'test-uuid',
    networkMode:   'ap',
    wifiSettings:  null,
    knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:      0,
    devIP:         null,
  }));
  return new DeviceStateService(file);
}

describe('CaptivePortalServer', () => {
  it('GET /api/wifi returns scan results from wifiManager.scanNetworks()', async () => {
    const bus      = new EventBus();
    const state    = makeTmpState();
    const networks: ScanResult[] = [{ ssid: 'FoundNet', mac: 'cc:dd', security: 'WPA2' }];
    const mock = {
      scanNetworks:     vi.fn().mockResolvedValue(networks),
      provisionNetwork: vi.fn().mockResolvedValue(undefined),
    } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/api/wifi');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wifi: networks });
    expect(mock.scanNetworks).toHaveBeenCalledOnce();
  });

  it('POST /api/wifi calls provisionNetwork and returns { ok: true }', async () => {
    const bus   = new EventBus();
    const state = makeTmpState();
    const mock  = {
      scanNetworks:     vi.fn().mockResolvedValue([]),
      provisionNetwork: vi.fn().mockResolvedValue(undefined),
    } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp)
      .post('/api/wifi')
      .send({ ssid: 'NewNet', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mock.provisionNetwork).toHaveBeenCalledWith({ ssid: 'NewNet', password: 'pass' });
  });

  it('GET /api/known-wifi returns known networks without passwords', async () => {
    const bus    = new EventBus();
    const state  = makeTmpState();
    const mock   = { scanNetworks: vi.fn(), provisionNetwork: vi.fn() } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/api/known-wifi');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb' }] });
  });

  it('POST /api/goto-client emits wifi:goto-client-requested on bus', async () => {
    const bus     = new EventBus();
    const state   = makeTmpState();
    const handler = vi.fn();
    bus.on('wifi:goto-client-requested', handler);
    const mock   = { scanNetworks: vi.fn(), provisionNetwork: vi.fn() } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).post('/api/goto-client').send({});
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('GET /api/wifi returns 500 when scanNetworks rejects', async () => {
    const bus   = new EventBus();
    const state = makeTmpState();
    const mock  = {
      scanNetworks:     vi.fn().mockRejectedValue(new Error('scan failed')),
      provisionNetwork: vi.fn(),
    } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/api/wifi');
    expect(res.status).toBe(500);
  });
});
