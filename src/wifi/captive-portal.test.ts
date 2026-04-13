import { describe, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import { CaptivePortalServer } from './captive-portal';
import { EventBus } from '../core/event-bus';
import { makeTmpState } from '../test-utils/make-state';
import type { ScanResult } from '../core/types';
import type { WifiManager } from './wifi-manager';

describe('CaptivePortalServer', () => {
  it('GET /api/wifi returns scan results from wifiManager.scanNetworks()', async () => {
    const bus      = new EventBus();
    const state    = makeTmpState({ networkMode: 'ap', knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }] });
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
    const state = makeTmpState({ networkMode: 'ap', knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }] });
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
    const state  = makeTmpState({ networkMode: 'ap', knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }] });
    const mock   = { scanNetworks: vi.fn(), provisionNetwork: vi.fn() } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/api/known-wifi');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb' }] });
  });

  it('POST /api/goto-client emits wifi:goto-client-requested on bus', async () => {
    const bus     = new EventBus();
    const state   = makeTmpState({ networkMode: 'ap', knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }] });
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
    const state = makeTmpState({ networkMode: 'ap', knownNetworks: [{ ssid: 'SavedNet', mac: 'aa:bb', password: 'saved' }] });
    const mock  = {
      scanNetworks:     vi.fn().mockRejectedValue(new Error('scan failed')),
      provisionNetwork: vi.fn(),
    } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/api/wifi');
    expect(res.status).toBe(500);
  });

  it('POST /api/wifi returns 500 when provisionNetwork rejects', async () => {
    const bus   = new EventBus();
    const state = makeTmpState({ networkMode: 'ap', knownNetworks: [] });
    const mock  = {
      scanNetworks:     vi.fn(),
      provisionNetwork: vi.fn().mockRejectedValue(new Error('provision failed')),
    } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp)
      .post('/api/wifi')
      .send({ ssid: 'BadNet', password: 'bad' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'provision failed' });
  });

  it('GET / returns HTML with injected OROBOT_PORTAL config', async () => {
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-123', networkMode: 'ap', knownNetworks: [] });
    const mock  = { scanNetworks: vi.fn(), provisionNetwork: vi.fn() } as unknown as WifiManager;
    const portal = new CaptivePortalServer(mock, state, bus);
    const res    = await supertest(portal.expressApp).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('html');
    expect(res.text).toContain('window.OROBOT_PORTAL');
    expect(res.text).toContain('dev-123');
  });
});
