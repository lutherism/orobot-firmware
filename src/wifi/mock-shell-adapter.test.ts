import { describe, it, expect } from 'vitest';
import { MockWifiShellAdapter } from './mock-shell-adapter';

describe('MockWifiShellAdapter', () => {
  it('scanNetworks() returns empty array by default', async () => {
    const adapter = new MockWifiShellAdapter();
    expect(await adapter.scanNetworks()).toEqual([]);
  });

  it('setScanResults() controls what scanNetworks() returns', async () => {
    const adapter  = new MockWifiShellAdapter();
    const networks = [{ ssid: 'MyNet', mac: 'aa:bb:cc', security: 'WPA2' }];
    adapter.setScanResults(networks);
    expect(await adapter.scanNetworks()).toEqual(networks);
  });

  it('connectToNetwork() records the credentials', async () => {
    const adapter = new MockWifiShellAdapter();
    await adapter.connectToNetwork({ ssid: 'TestNet', password: 'pass123' });
    expect(adapter.connectCalls).toEqual([{ ssid: 'TestNet', password: 'pass123' }]);
  });

  it('startAP() and stopAP() record call counts independently', async () => {
    const adapter = new MockWifiShellAdapter();
    await adapter.startAP();
    await adapter.startAP();
    await adapter.stopAP();
    expect(adapter.startAPCalls).toBe(2);
    expect(adapter.stopAPCalls).toBe(1);
  });

  it('pushCredentials() records the target SSID and credentials', async () => {
    const adapter = new MockWifiShellAdapter();
    await adapter.pushCredentials('OROBOT-Setup-abc', { ssid: 'Home', password: 'secret' });
    expect(adapter.pushCalls).toEqual([{
      targetSsid: 'OROBOT-Setup-abc',
      creds: { ssid: 'Home', password: 'secret' },
    }]);
  });
});
