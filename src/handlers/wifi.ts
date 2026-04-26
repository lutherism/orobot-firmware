import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { WifiManager } from '../wifi/wifi-manager';
import { makeEnvelope } from '../core/wire';
import type { MessageHandler } from './registry';

export function createWifiListHandler(
  wifiManager: WifiManager,
  state:       DeviceStateService,
  bus:         EventBus,
): MessageHandler {
  return async (_msg) => {
    const networks = await wifiManager.scanNetworks();
    const { knownNetworks, deviceUuid } = state.get();
    bus.emit('network:send', {
      payload: makeEnvelope('wifiList', {
        deviceUuid,
        data: {
          uniqueNetworks: networks,
          rawNetworks:    networks,
          knownNetworks:  knownNetworks.map((n) => ({ ssid: n.ssid, mac: n.mac })),
        },
      }),
    });
  };
}

export function createShareWifiHandler(wifiManager: WifiManager): MessageHandler {
  return async (msg) => {
    await wifiManager.shareCredentials(msg.data);
  };
}
