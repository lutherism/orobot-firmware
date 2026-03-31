import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { ScanResult, WifiCredentials } from '../core/types';
import type { WifiShellAdapter } from './types';
import type { WifiStateMachine } from './wifi-state-machine';
import { createLogger } from '../core/logger';

const log = createLogger('wifi-manager');

export class WifiManager {
  private connectFailures   = 0;
  private reconnectFailures = 0;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly adapter:              WifiShellAdapter,
    private readonly state:                DeviceStateService,
    private readonly bus:                  EventBus,
    private readonly wifiSM:               WifiStateMachine,
    private readonly maxConnectFailures  = 10,
    private readonly maxReconnectRetries = 10,
  ) {}

  async initialize(): Promise<void> {
    this.unsubscribers.push(
      this.bus.on('network:connected', () => {
        if (this.wifiSM.current === 'CONNECTING' || this.wifiSM.current === 'RECONNECTING') {
          this.connectFailures   = 0;
          this.reconnectFailures = 0;
          this.wifiSM.transition('CONNECTED');
        }
      }),
      this.bus.on('network:disconnected', () => {
        const s = this.wifiSM.current;
        if (s === 'CONNECTED') {
          this.wifiSM.transition('DEGRADED');
          this.wifiSM.transition('RECONNECTING');
        } else if (s === 'CONNECTING') {
          this.connectFailures++;
          if (this.connectFailures >= this.maxConnectFailures) {
            this.connectFailures = 0;
            this.wifiSM.transition('SETUP_MODE');
            void this.adapter.startAP();
          }
        } else if (s === 'RECONNECTING') {
          this.reconnectFailures++;
          if (this.reconnectFailures >= this.maxReconnectRetries) {
            this.reconnectFailures = 0;
            this.wifiSM.transition('SETUP_MODE');
            void this.adapter.startAP();
          }
        }
      }),
    );

    const { wifiSettings } = this.state.get();
    if (wifiSettings?.ssid) {
      this.wifiSM.transition('CONNECTING');
    } else {
      this.wifiSM.transition('SETUP_MODE');
      await this.adapter.startAP();
    }
  }

  async provisionNetwork(creds: WifiCredentials): Promise<void> {
    const s = this.state.get();
    const knownNetworks = [
      ...s.knownNetworks.filter((n) => n.ssid !== creds.ssid),
      { ssid: creds.ssid, mac: '', password: creds.password },
    ];
    await this.state.patch({ wifiSettings: creds, knownNetworks });
    log.info({ event: 'wifi:provisioning', ssid: creds.ssid }, 'Provisioning WiFi network');
    this.wifiSM.transition('PROVISIONING');
    await this.adapter.connectToNetwork(creds);
    await this.adapter.stopAP();
    this.wifiSM.transition('CONNECTING');
  }

  async scanNetworks(): Promise<ScanResult[]> {
    return this.adapter.scanNetworks();
  }

  async shareCredentials(data: string): Promise<void> {
    const { tagUuid } = JSON.parse(data) as { tagUuid: string };
    const { wifiSettings } = this.state.get();
    if (!wifiSettings) return;
    const targetSsid = `OROBOT-Setup-${tagUuid}`;
    log.info({ event: 'wifi:share', targetSsid }, 'Sharing credentials to peer');
    await this.adapter.pushCredentials(targetSsid, wifiSettings);
  }

  async gotoClient(): Promise<void> {
    if (this.wifiSM.current !== 'SETUP_MODE') return;
    const { wifiSettings } = this.state.get();
    if (!wifiSettings?.ssid) return;
    await this.adapter.stopAP();
    this.wifiSM.transition('CONNECTING');
  }

  stop(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers.length = 0;
  }
}
