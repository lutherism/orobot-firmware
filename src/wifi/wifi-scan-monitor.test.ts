import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WifiScanMonitor } from './wifi-scan-monitor';
import { MockWifiShellAdapter } from './mock-shell-adapter';
import { EventBus } from '../core/event-bus';
import { makeTmpState } from '../test-utils/make-state';

describe('WifiScanMonitor', () => {
  let adapter: MockWifiShellAdapter;
  let bus:     EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new MockWifiShellAdapter();
    bus     = new EventBus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not push before start() is called', async () => {
    adapter.setScanResults([{ ssid: 'OROBOT-Setup-abc', mac: 'aa:bb', security: '' }]);
    new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: { ssid: 'Home', password: 'pass' } }), bus);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(adapter.pushCalls).toHaveLength(0);
  });

  it('pushes credentials and emits wifi:credentials-shared when OROBOT-Setup-* AP is found', async () => {
    const handler = vi.fn();
    bus.on('wifi:credentials-shared', handler);
    adapter.setScanResults([{ ssid: 'OROBOT-Setup-xyz', mac: 'aa:bb', security: '' }]);
    const monitor = new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: { ssid: 'Home', password: 'pass' } }), bus);
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(adapter.pushCalls).toHaveLength(1);
    expect(adapter.pushCalls[0].targetSsid).toBe('OROBOT-Setup-xyz');
    expect(adapter.pushCalls[0].creds).toEqual({ ssid: 'Home', password: 'pass' });
    expect(handler).toHaveBeenCalledWith({ targetSsid: 'OROBOT-Setup-xyz' });
    monitor.stop();
  });

  it('does NOT push credentials for non-OROBOT-Setup SSIDs', async () => {
    adapter.setScanResults([{ ssid: 'SomeRandomNetwork', mac: 'aa:bb', security: '' }]);
    const monitor = new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: { ssid: 'Home', password: 'pass' } }), bus);
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(adapter.pushCalls).toHaveLength(0);
    monitor.stop();
  });

  it('does NOT push if device has no wifiSettings', async () => {
    adapter.setScanResults([{ ssid: 'OROBOT-Setup-abc', mac: 'aa:bb', security: '' }]);
    const monitor = new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: null }), bus);
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(adapter.pushCalls).toHaveLength(0);
    monitor.stop();
  });

  it('stop() prevents further scanning', async () => {
    adapter.setScanResults([{ ssid: 'OROBOT-Setup-abc', mac: 'aa:bb', security: '' }]);
    const monitor = new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: { ssid: 'Home', password: 'pass' } }), bus);
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(1100);
    monitor.stop();
    const countAfterStop = adapter.pushCalls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.pushCalls).toHaveLength(countAfterStop);
  });

  it('pushes to each OROBOT-Setup peer found in a single scan', async () => {
    adapter.setScanResults([
      { ssid: 'OROBOT-Setup-aaa', mac: 'aa:bb', security: '' },
      { ssid: 'OROBOT-Setup-bbb', mac: 'cc:dd', security: '' },
    ]);
    const monitor = new WifiScanMonitor(adapter, makeTmpState({ wifiSettings: { ssid: 'Home', password: 'pass' } }), bus);
    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(1100);
    const ssids = adapter.pushCalls.map((c) => c.targetSsid);
    expect(ssids).toContain('OROBOT-Setup-aaa');
    expect(ssids).toContain('OROBOT-Setup-bbb');
    monitor.stop();
  });
});
