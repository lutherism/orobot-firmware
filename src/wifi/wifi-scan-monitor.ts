import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { WifiShellAdapter } from './types';
import { createLogger } from '../core/logger';

const PEER_PREFIX = 'OROBOT-Setup-';
export class WifiScanMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly log: ReturnType<typeof createLogger>;

  constructor(
    private readonly adapter: WifiShellAdapter,
    private readonly state:   DeviceStateService,
    private readonly bus:     EventBus,
    device?: string,
  ) {
    this.log = createLogger('wifi-scan-monitor', device);
  }

  start(intervalMs = 10_000): void {
    this.stop();
    this.timer = setInterval(() => void this.scan(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scan(): Promise<void> {
    try {
      const networks = await this.adapter.scanNetworks();
      for (const network of networks) {
        if (!network.ssid.startsWith(PEER_PREFIX)) continue;
        const { wifiSettings, deviceUuid } = this.state.get();
        if (!wifiSettings) continue;
        this.log.info({ event: 'peer:found', ssid: network.ssid }, 'Found peer device, pushing credentials');
        await this.adapter.pushCredentials(network.ssid, wifiSettings);
        this.bus.emit('wifi:credentials-shared', { targetSsid: network.ssid });
        this.bus.emit('network:send', {
          payload: {
            type:       'wifi-setup-found',
            data:       JSON.stringify({ uuidTag: network.ssid.slice(PEER_PREFIX.length) }),
            deviceUuid,
          },
        });
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'WiFi scan failed');
    }
  }
}
