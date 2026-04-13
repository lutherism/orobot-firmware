import { describe, it, expect, beforeEach } from 'vitest';
import { WifiManager } from './wifi-manager';
import { WifiStateMachine } from './wifi-state-machine';
import { MockWifiShellAdapter } from './mock-shell-adapter';
import { EventBus } from '../core/event-bus';
import { makeTmpState } from '../test-utils/make-state';

describe('WifiManager', () => {
  let adapter: MockWifiShellAdapter;
  let bus:     EventBus;
  let wifiSM:  WifiStateMachine;

  beforeEach(() => {
    adapter = new MockWifiShellAdapter();
    bus     = new EventBus();
    wifiSM  = new WifiStateMachine(bus);
  });

  it('initialize() with no wifiSettings → SETUP_MODE + startAP called', async () => {
    const manager = new WifiManager(adapter, makeTmpState(), bus, wifiSM);
    await manager.initialize();
    expect(wifiSM.current).toBe('SETUP_MODE');
    expect(adapter.startAPCalls).toBe(1);
  });

  it('initialize() with wifiSettings → CONNECTING, startAP NOT called', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM);
    await manager.initialize();
    expect(wifiSM.current).toBe('CONNECTING');
    expect(adapter.startAPCalls).toBe(0);
  });

  it('network:connected while CONNECTING → transitions to CONNECTED', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM);
    await manager.initialize();
    bus.emit('network:connected', { url: 'ws://test' });
    expect(wifiSM.current).toBe('CONNECTED');
  });

  it('network:disconnected while CONNECTED → DEGRADED then RECONNECTING', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM);
    await manager.initialize();
    bus.emit('network:connected',    { url: 'ws://test' });
    bus.emit('network:disconnected', { reason: 'closed' });
    expect(wifiSM.current).toBe('RECONNECTING');
  });

  it('network:connected while RECONNECTING → back to CONNECTED', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM);
    await manager.initialize();
    bus.emit('network:connected',    { url: 'ws://test' });
    bus.emit('network:disconnected', { reason: 'closed' });
    bus.emit('network:connected',    { url: 'ws://test' });
    expect(wifiSM.current).toBe('CONNECTED');
  });

  it('network:disconnected N times while CONNECTING → falls back to SETUP_MODE + startAP', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM, 3);
    await manager.initialize();
    for (let i = 0; i < 3; i++) {
      bus.emit('network:disconnected', { reason: 'error' });
    }
    expect(wifiSM.current).toBe('SETUP_MODE');
    expect(adapter.startAPCalls).toBe(1);
  });

  it('network:disconnected N times while RECONNECTING → falls back to SETUP_MODE + startAP', async () => {
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: { ssid: 'MyNet', password: 'pass' } }), bus, wifiSM, 10, 3);
    await manager.initialize();                                    // → CONNECTING
    bus.emit('network:connected',    { url: 'ws://test' });       // → CONNECTED
    bus.emit('network:disconnected', { reason: 'closed' });       // → RECONNECTING (no counter increment)
    for (let i = 0; i < 3; i++) {
      bus.emit('network:disconnected', { reason: 'error' });      // increments reconnectFailures
    }
    expect(wifiSM.current).toBe('SETUP_MODE');
    expect(adapter.startAPCalls).toBe(1);
  });

  it('provisionNetwork() patches state, calls adapter ops, transitions to CONNECTING', async () => {
    const state   = makeTmpState();
    const manager = new WifiManager(adapter, state, bus, wifiSM);
    await manager.initialize(); // → SETUP_MODE
    await manager.provisionNetwork({ ssid: 'NewNet', password: 'newpass' });
    expect(state.get().wifiSettings).toEqual({ ssid: 'NewNet', password: 'newpass' });
    expect(state.get().knownNetworks).toContainEqual(
      expect.objectContaining({ ssid: 'NewNet', password: 'newpass' }),
    );
    expect(adapter.connectCalls).toEqual([{ ssid: 'NewNet', password: 'newpass' }]);
    expect(adapter.stopAPCalls).toBe(1);
    expect(wifiSM.current).toBe('CONNECTING');
  });

  it('scanNetworks() delegates to adapter', async () => {
    const manager  = new WifiManager(adapter, makeTmpState(), bus, wifiSM);
    const networks = [{ ssid: 'TestNet', mac: 'aa:bb', security: 'WPA2' }];
    adapter.setScanResults(networks);
    await manager.initialize();
    expect(await manager.scanNetworks()).toEqual(networks);
  });

  it('shareCredentials() calls adapter.pushCredentials with correct SSID', async () => {
    const creds   = { ssid: 'Home', password: 'homepass' };
    const manager = new WifiManager(adapter, makeTmpState({ wifiSettings: creds }), bus, wifiSM);
    await manager.initialize();
    await manager.shareCredentials(JSON.stringify({ tagUuid: 'abc123' }));
    expect(adapter.pushCalls).toEqual([{
      targetSsid: 'OROBOT-Setup-abc123',
      creds,
    }]);
  });
});
