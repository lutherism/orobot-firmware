import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeartbeatService } from './heartbeat';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import os from 'os';
import path from 'path';
import fs from 'fs';

function makeTmpStateFile(partial: object = {}): string {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-hb-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid:    'hb-device-uuid',
    networkMode:   'client',
    wifiSettings:  null,
    knownNetworks: [],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:       42,
    devIP:          null,
    ...partial,
  }));
  return file;
}

type FetchCall = { url: string; body: Record<string, unknown> };

function mockFetch(calls: FetchCall[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(init?.body as string ?? '{}') });
    return new Response('ok', { status: 200 });
  };
}

describe('HeartbeatService', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('fires immediately on start()', async () => {
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile());
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(60_000);
    await Promise.resolve(); // let the async beat() run

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://robots-gateway-v2.wl.r.appspot.com/api/device/state');
    expect(calls[0].body).toMatchObject({ deviceUuid: 'hb-device-uuid' });

    svc.stop();
  });

  it('payloadJSON includes type and pingTime', async () => {
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile({ type: 'wifi-motor', pingTime: 42 }));
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(60_000);
    await Promise.resolve();

    const payload = JSON.parse(calls[0].body.payloadJSON as string);
    expect(payload).toMatchObject({ type: 'wifi-motor', pingTime: 42 });

    svc.stop();
  });

  it('emits system:heartbeat-sent after a successful POST', async () => {
    const events: number[] = [];
    const bus   = new EventBus();
    bus.on('system:heartbeat-sent', ({ pingTime }) => events.push(pingTime));
    const state = new DeviceStateService(makeTmpStateFile({ pingTime: 99 }));
    const svc   = new HeartbeatService(state, bus, mockFetch([]) as typeof fetch);

    svc.start(60_000);
    await Promise.resolve();

    expect(events).toEqual([99]);
    svc.stop();
  });

  it('fires again after the interval (fake timers)', async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile());
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(8_000);
    await vi.advanceTimersByTimeAsync(0);    // initial beat
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(8_000); // one interval
    expect(calls).toHaveLength(2);

    svc.stop();
  });

  it('stop() prevents further calls', async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile());
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(8_000);
    await vi.advanceTimersByTimeAsync(0);
    svc.stop();
    await vi.advanceTimersByTimeAsync(16_000); // two more intervals

    expect(calls).toHaveLength(1); // only the initial beat
  });

  it('calling start() twice does not leak a second interval', async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile());
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(8_000);
    await vi.advanceTimersByTimeAsync(0); // initial beat from first start
    svc.start(8_000); // second start — should reset, not add a second interval
    await vi.advanceTimersByTimeAsync(0); // initial beat from second start

    expect(calls).toHaveLength(2); // one from each start(), not three

    await vi.advanceTimersByTimeAsync(8_000); // one interval tick
    expect(calls).toHaveLength(3); // only one interval firing, not two

    svc.stop();
  });

  it('uses dev API URL when networkMode is dev', async () => {
    const calls: FetchCall[] = [];
    const bus   = new EventBus();
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'dev', devIP: '10.0.0.1' }));
    const svc   = new HeartbeatService(state, bus, mockFetch(calls) as typeof fetch);

    svc.start(60_000);
    await Promise.resolve();

    expect(calls[0].url).toBe('http://10.0.0.1:8080/api/device/state');
    svc.stop();
  });
});
